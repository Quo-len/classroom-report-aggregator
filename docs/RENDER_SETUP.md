# Render + Supabase deployment

The hosted app uses Google OAuth for sign-in and the `pg` driver for Supabase PostgreSQL. It does not use Supabase Auth, its JavaScript SDK, Storage, or Edge Functions. PostgreSQL stores accounts, encrypted Google credentials, browser sessions, per-user settings, report references, and execution/delivery history.

## 1. Create the Google OAuth application

In your Google Cloud project, enable Classroom, Drive, Sheets, and Gmail APIs. Configure the consent screen and create a **Web application** OAuth client. Set the authorized redirect URI to:

```text
https://YOUR-RENDER-HOST/auth/callback
```

For local development, add `http://localhost:3000/auth/callback` as another redirect URI. The origin must match `APP_URL` exactly. Configure an external audience if users outside your Workspace organization need access. During testing, add the intended accounts as test users. Public use of the requested Google scopes requires the applicable Google verification process; Workspace administrators may also restrict access. Testing-mode refresh tokens can be short-lived, so testing configuration is not a substitute for publishing the OAuth application.

Users grant access on Google's consent screen. No user uploads `credentials.json` or `token.json`. The app identifies users by Google's immutable subject ID, not by an email address supplied by the browser. Users must be teachers in their selected Classroom course to access its submissions.

Reference: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## 2. Configure PostgreSQL and secrets

Create a Supabase project and copy its **session pooler** PostgreSQL connection string from the Connect dialog. Use session mode (normally port 5432), not transaction mode (normally port 6543): workflow concurrency protection uses session advisory locks. A direct PostgreSQL connection also works when the network supports it. URL-encode special characters in the database password.

Set these environment variables locally for setup and in the Render service:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase PostgreSQL session-pooler connection string |
| `DATABASE_CA` | Optional PEM CA certificate if the endpoint requires a custom trust chain; literal `\n` separators are supported |
| `APP_URL` | Public Render origin, such as `https://your-app.onrender.com` |
| `GOOGLE_CLIENT_ID` | Google web OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google web OAuth client secret |
| `TOKEN_ENCRYPTION_KEY` | Random 32-byte key encoded as 64 hexadecimal characters |
| `CRON_SECRET` | A separate random secret of at least 32 characters |
| `TELEGRAM_BOT_TOKEN` | Optional shared department bot token |
| `GROQ_API_KEY` | Optional existing AI integration; leave unset to disable |

Generate each random secret independently:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep the encryption key stable across deployments and retain a secure backup. Changing it makes existing encrypted Google connections unreadable. Credentials remain server-side; the frontend receives no database password or Google access token.

Apply the migrations once from your local checkout using the configured environment:

```sh
npm ci
npm run db:migrate
```

Alternatively, execute the numbered files in `migrations/` in order through Supabase SQL Editor. They are safe to rerun. The application uses the private `bird` schema; **do not add it to the Supabase Data API exposed schemas**. The setup connection needs permission to create this schema. A dedicated runtime database role needs usage on `bird` and select/insert/update/delete on its tables; it does not need Vault or cron administration privileges.

References: [PostgreSQL connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres), [database roles](https://supabase.com/docs/guides/database/postgres/roles).

## 3. Deploy the web process on Render

Create a Node web service connected to this repository, on the free plan, using Node 22 or 24:

```text
Build command: npm ci --include=dev && npm run build
Start command: npm run start:web
Health check: /health
```

The server binds to `0.0.0.0` and Render's `PORT`. Configure the environment variables above and deploy after database migration. Do not upload the local `.env`, `credentials.json`, or `token.json`. The hosted app does not use the legacy course/email variables in `.env`; users configure those in the dashboard.

Open the public URL, sign in through Google, select an active course, and enter the two source sheet links, destination folder link, and department email addresses. Setup checks Google permissions before saving. For Telegram, the recipient must first start the configured bot; then enter their chat ID. Leaving the chat ID empty disables Telegram for that account.

Dashboard actions execute real operations. Draft generation sends missing-teacher reminders; reconciliation updates the same master sheet; final delivery sends the report and JPEG attachments. A completed draft/final stage is not resent on a repeated click. Reconciliation can update the sheet again, while its already-delivered notification is not duplicated.

## 4. Enable the scheduler

In Supabase, enable the `pg_cron` and `pg_net` database extensions and ensure Vault is available. Using a database administrator connection in your local environment, run:

```sh
npm run schedule:setup
```

This stores `APP_URL` and `CRON_SECRET` in Vault and creates or updates the named `bird-account-workflows` job. Each hour it sends an authenticated HTTP POST to `/internal/scheduled`, with a two-minute HTTP timeout to accommodate Render cold starts. It only processes accounts whose dashboard automation checkbox is enabled. No Supabase SDK or additional hosted worker is needed. Re-run setup after changing the public URL or scheduler secret.

Hourly checks evaluate Kyiv calendar dates. Draft reminders occur at three days remaining (or two days if the earlier check was missed), reconciliation at one day, and final delivery on or after the deadline. Assignments without a deadline are only monitored. Execution history suppresses completed automatic stages on subsequent checks.

Inspect HTTP responses using Supabase SQL Editor:

```sql
SELECT status_code, timed_out, error_msg, content, created
FROM net._http_response
ORDER BY created DESC
LIMIT 20;
```

To stop the scheduler:

```sql
SELECT cron.unschedule('bird-account-workflows');
```

Render free services can sleep/restart, and free databases are subject to provider limits or pausing. Persistent state survives a Render restart, but free hosting does not guarantee delivery at an exact time. A timed-out HTTP call is not proof that processing stopped: inspect the app history before retrying. Large cohorts or large attachments may exceed free-tier memory/request limits.

References: [Supabase Cron](https://supabase.com/docs/guides/cron), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [Vault](https://supabase.com/docs/guides/database/vault), [Render free limits](https://render.com/docs/free).

## 5. Review interrupted deliveries

Google and Telegram delivery cannot be committed atomically with a PostgreSQL transaction. If a send may have succeeded before a crash, the application marks it as uncertain and stops automatic retries for that stage. It does not claim exactly-once delivery.

An administrator can identify the affected account and delivery:

```sql
SELECT r.user_id, r.id AS run_id, d.delivery_key, d.description, d.status
FROM bird.deliveries d JOIN bird.runs r ON r.id = d.run_id
WHERE d.status != 'sent'
ORDER BY r.started_at DESC;
```

Check Gmail Sent or the Telegram conversation, then record the actual outcome from the local CLI:

```sh
npm run delivery:review -- USER_UUID RUN_UUID DELIVERY_KEY sent
```

If the message was not delivered, authorize a retry instead:

```sh
npm run delivery:review -- USER_UUID RUN_UUID DELIVERY_KEY retry
```

The review tool acquires the account workflow lock. Once every uncertain delivery is reviewed, rerun the stage from the dashboard or wait for its next scheduled attempt. Previously confirmed sends are skipped. If the stage's date has already passed, retry that specific stage manually.

## 6. CLI compatibility and validation

With `DATABASE_URL` configured, select the account UUID explicitly:

```sh
npm start -- --account USER_UUID --monitor
npm start -- --account USER_UUID --draft
```

The optional CLI `--dry-run` suppresses email/Telegram only; it still creates a test Google Sheet and does not mark a production stage completed. It is absent from the frontend. Without `DATABASE_URL`, the original single-account credential/token-file CLI remains available.

Run the checks:

```sh
npm run build
npm run test:hosted
npm run test:browser
npm test
```

Hosted tests use a disposable embedded PostgreSQL engine and mocked Google operations, covering migrations, encryption, sessions, OAuth callbacks, CSRF, per-user data, deadline phases, and retries. Browser tests use headless installed Microsoft Edge and mocked API responses; screenshots are saved under ignored `tmp/`. Set `BROWSER_CHANNEL` to another installed Playwright-supported browser channel if needed. The original `npm test` suite can use configured Google/Groq credentials for live read/AI checks.

Actual Supabase TLS/pooler connectivity, Google consent with the deployed redirect URI, and the Vault/cron installation must be verified against your configured services. The embedded test engine does not validate remote pooler session semantics or provider availability.
