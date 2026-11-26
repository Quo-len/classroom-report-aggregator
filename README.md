# AI Bird Secretary (Automated Department Secretary) 🎓

**Multi-user web version:** Google sign-in, role-based access control (`admin`, `editor`, `viewer`), per-user settings, and Supabase/PostgreSQL (via `pg`, without the Supabase SDK). Each user has their own Classroom course (selected by name), assignment name, notification recipients, and an auto-provisioned Google Drive workspace folder with sheets. Hosted deployment is configured for **Fly.io** ([fly.toml](fly.toml), [Dockerfile](Dockerfile), [.github/workflows/fly-deploy.yml](.github/workflows/fly-deploy.yml)). Dashboard actions execute real operations; `--dry-run` is available in the CLI only. The `credentials.json` / `token.json` settings below apply to the local single-account CLI.

> Autonomous modular CLI and web system for automating academic department reporting. It monitors Google Classroom assignments, aggregates faculty research reports (`.docx`, `.xlsx`, Google Docs/Sheets), applies business rules, combines them with static department plans, generates a master Google Sheet report, and sends notifications via Gmail and Telegram.

👉 **Quick Guides:**
* [📖 SETUP_GUIDE.md — Detailed guide: configuring `.env` and publishing in Google Classroom](SETUP_GUIDE.md)
* [🧪 test/MANUAL_TESTING_GUIDE.md — Manual testing guide and verification checklist](test/MANUAL_TESTING_GUIDE.md)

---

## 📑 Table of Contents

- [Architecture and Workflow](#architecture-and-workflow)
- [Requirements and Tech Stack](#requirements-and-tech-stack)
- [Getting Started](#getting-started)
  - [1. Install Dependencies](#1-install-dependencies)
  - [2. Configure Google Cloud and Telegram](#2-configure-google-cloud-and-telegram)
  - [3. Configure Environment Variables (.env)](#3-configure-environment-variables-env)
  - [4. Initial Google OAuth2 Authorization (CLI)](#4-initial-google-oauth2-authorization-cli)
- [CLI Usage](#cli-usage)
  - [Command-Line Options](#command-line-options)
- [Report Lifecycle Stages](#report-lifecycle-stages)
  - [1. Monitoring Phase](#1-monitoring-phase)
  - [2. T-3 Days: Preliminary Draft & Warning](#2-t-3-days-preliminary-draft--warning)
  - [3. T-1 Day: Reconciliation](#3-t-1-day-reconciliation)
  - [4. Deadline Day: Final Delivery](#4-deadline-day-final-delivery)
- [Data Aggregation Business Rules](#data-aggregation-business-rules)
- [Automation via Windows Task Scheduler](#automation-via-windows-task-scheduler)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Hosted Deployment & Post-Review Notes](#hosted-deployment--post-review-notes)

---

## 🏛 Architecture and Workflow

```mermaid
flowchart TD
    A[Daily Run: Windows Task Scheduler / Cron] --> B[src/index.ts or Hosted Workflow]
    B --> C[ClassroomService: Find Assignment & Analyze Deadline]

    C -->|More than 3 days left| D[Monitoring: Log submission stats]

    C -->|3 or 2 days left| E[T-3 Days: Draft & Warn]
    E --> E1[Aggregator: Preliminary Master Google Sheet]
    E --> E2[Gmail API: Reminder emails to missing teachers]
    E --> E3[Telegram + Gmail: Notify Head of Department with missing list]

    C -->|1 day left| F[T-1 Day: Reconciliation]
    F --> F1[Update Master Google Sheet with late submissions]
    F --> F2[Telegram: Reconciliation status to Head of Department]

    C -->|Deadline reached| G[Deadline Day: Final Delivery]
    G --> G1[Aggregator + Sheets: Final Master Sheet]
    G --> G2[Drive API: Collect .jpeg photo reports]
    G --> G3[Gmail API: Send link + JPEGs to Scientific Dept & Head]
    G --> G4[Telegram: Final delivery confirmation]
```

---

## 💻 Requirements and Tech Stack

- **Runtime:** Node.js (v18+ LTS, tested on Node.js v22/v24)
- **Language:** TypeScript 5.x
- **Web Server & Database:** Fastify 5, `@fastify/static`, PostgreSQL (`pg`)
- **Google APIs (`googleapis`):**
  - **Google Classroom API:** Fetch assignments, deadlines, teacher/student rosters, and submission statuses.
  - **Google Drive API:** Download files, export Google Docs, organize Master Google Sheets in the target folder, and collect JPEG attachments.
  - **Google Sheets API:** Read static/dynamic sheets, generate and format the master report.
  - **Gmail API:** Send reminder emails and final reports with MIME/Base64 attachments.
- **Telegram:** `telegraf` (alerts and verified chat binding).
- **Validation & Parsing:** `zod`, `dotenv`, `adm-zip`.

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
git clone <repository-url>
cd ai-bird-secretary
npm install
```

### 2. Configure Google Cloud and Telegram

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the following APIs:
   - **Google Classroom API**
   - **Google Drive API**
   - **Google Sheets API**
   - **Gmail API**
3. Go to **APIs & Services > Credentials** and create an **OAuth 2.0 Client ID**:
   - *Web application* for the hosted web server (set Authorized redirect URI to `<APP_URL>/auth/callback`).
   - *Desktop app* (`credentials.json`) if using the local CLI.
4. Create a Telegram bot via [@BotFather](https://t.me/BotFather) and obtain `TELEGRAM_BOT_TOKEN`.
5. For the local CLI, get your `chat_id` (e.g., via [@userinfobot](https://t.me/userinfobot)) for `HEAD_OF_DEPT_CHAT_ID`. In hosted mode, users link Telegram directly from the web dashboard.

### 3. Configure Environment Variables (.env)

Copy the example configuration:
```bash
cp .env.example .env
```

#### Hosted Web Server (`npm run serve`)

| Variable | Description | Example Value |
|---|---|---|
| `DATABASE_URL` | PostgreSQL / Supabase connection string (session pooler recommended) | `postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres` |
| `DATABASE_CA` | Optional PEM CA certificate for PostgreSQL TLS verification | — |
| `APP_URL` | Public origin of the web server (`https://...`, or `http://localhost:3000` locally) | `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` | Google Web OAuth2 Client ID | `123456789.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google Web OAuth2 Client Secret | `GOCSPX-...` |
| `TOKEN_ENCRYPTION_KEY` | Random 32-byte hex key (64 hex chars) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CRON_SECRET` | Random secret for `/internal/scheduled` (min 32 chars) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_EMAILS` | Optional comma-separated list of admin Google emails (when empty, the first user becomes admin) | `admin@university.edu.ua` |
| `DEFAULT_ROLE` | Role for newly registered accounts: `editor` (default) or `viewer` | `editor` |
| `ASSIGNMENT_NAME` | Default Classroom assignment name | `Інформація про науково-дослідну роботу` |
| `WORKSPACE_FOLDER_NAME` | Root folder name in My Drive (auto-created/reused) | `Секретар кафедри` |
| `TELEGRAM_BOT_TOKEN` | Optional Telegram bot token | `123456789:ABCdef...` |
| `TELEGRAM_WEBHOOK_SECRET` | Optional secret for verified Telegram webhook binding | — |
| `GROQ_API_KEY` | Optional Groq API key (AI parsing activates only when both `GROQ_API_KEY` and `GROQ_MODEL` are set) | — |

#### Legacy Single-Account CLI Variables

| Variable | Description | Example Value |
|---|---|---|
| `GOOGLE_CREDENTIALS_FILE` | Path to Google OAuth2 client secrets JSON | `credentials.json` |
| `GOOGLE_TOKEN_FILE` | Path to cached OAuth2 tokens | `token.json` |
| `CLASSROOM_COURSE_NAME` | Google Classroom course name (case-insensitive, partial match; leave empty if you teach one course) | `Кафедра інформатики` |
| `HEAD_OF_DEPT_CHAT_ID` | Head of Department Telegram Chat ID | `987654321` |
| `HEAD_OF_DEPT_EMAIL` | Head of Department email | `head@university.edu.ua` |
| `SCI_DEPT_EMAIL` | Scientific Department email | `science@university.edu.ua` |

Sheet and folder IDs do not need to be entered manually. On startup, the system finds or creates `WORKSPACE_FOLDER_NAME` in My Drive with a `"Зведені звіти"` subfolder and the `"План роботи кафедри"` / `"План наукової роботи кафедри"` sheets. Existing files with those names are adopted, renaming or moving them does not break the link, and trashed items are recreated.

### 4. Initial Google OAuth2 Authorization (CLI)

For local CLI first-time login, run:
```bash
npm run auth:init
```
1. Use `credentials.json` from a **Desktop app** OAuth client. Only `GOOGLE_CREDENTIALS_FILE` and `GOOGLE_TOKEN_FILE` are required for authorization.
2. Your browser will open automatically (or open the URL printed in the terminal).
3. Sign in with the teacher/department secretary Google account and grant permissions.
4. Access/refresh tokens are saved to `token.json` and refreshed automatically.

---

## 🛠 CLI Usage

Run via TypeScript directly or the compiled build:

```bash
# Compile TypeScript
npm run build

# Run compiled CLI
npm start
# or
node dist/index.js [options]

# Run in development mode
npm run dev -- [options]

# Run hosted web server
npm run serve
```

### Command-Line Options

```text
Academic Department Automation System
Usage:
  npx tsx src/index.ts [options]
  node dist/index.js [options]

Options:
  --auto          (Default) Checks the current date against the deadline and runs the matching stage.
  --monitor       Polls Classroom, prints assignment metadata and current submission statistics.
  --draft         Forces the T-3 days stage (creates preliminary Master Sheet, emails reminders, notifies Head).
  --reconcile     Forces the T-1 day stage (reconciles late submissions and recalculates totals).
  --final         Forces the Deadline Day stage (builds final report, collects .jpeg photos, emails Sci Dept).
  --dry-run, -d   Simulation mode: aggregates data but blocks sending real emails and Telegram messages.
  --healthcheck   Runs diagnostics for Google APIs and Telegram connectivity.
  --auth-init     Runs the Google OAuth2 authorization wizard.
  --help, -h      Shows command help.
```

---

## 🔄 Report Lifecycle Stages

### 1. Monitoring Phase
*Active when more than 3 days remain before the deadline.*
- Polls Google Classroom for the assignment matching `ASSIGNMENT_NAME`.
- Extracts creation date and deadline.
- Logs submission statistics without notifying teachers.

### 2. T-3 Days: Preliminary Draft & Warning
*Active at 3 or 2 days remaining (`--draft`).*
- Generates a preliminary Master Google Sheet from currently submitted reports.
- **Gmail:** Sends reminder emails to teachers who have not submitted yet.
- **Telegram + Email:** Notifies the Head of Department with the full names and emails of missing teachers plus a link to the preliminary sheet.

### 3. T-1 Day: Reconciliation
*Active at 1 day remaining (`--reconcile`).*
- Checks for late submissions and recalculates all totals.
- Updates the existing Master Google Sheet.
- Sends a reconciliation status update to the Head of Department via Telegram.

### 4. Deadline Day: Final Delivery
*Active once the actual deadline timestamp has passed (`--final`).*
- Produces the final Master Google Sheet and updates its title.
- Collects `.jpeg` / `.jpg` photo reports attached by teachers.
- Emails the final Master Sheet link and attachments (up to 20 JPEGs / 12 MB total, 5 MB each; overflow photos are copied to a `"Підтвердження"` subfolder on Drive and linked in the email) to `SCI_DEPT_EMAIL` and `HEAD_OF_DEPT_EMAIL`.
- Confirms final delivery via Telegram.

---

## 📐 Data Aggregation Business Rules

1. **Zero-Value Parsing:**
   - Cells containing dashes (`"-"`, `"–"`, `"—"`) or absence phrases such as `"інформація відсутня"` (case-insensitive) are parsed as **`0`**.
   - Comma decimals (e.g. `"12,5"`), thousand separators (e.g. `"1 200"`), and compound `count / printed sheets` formats are parsed into numeric values.
2. **Static Data:**
   - Rows from `"План роботи кафедри"` and `"План наукової роботи кафедри"` (inside `WORKSPACE_FOLDER_NAME`) are copied as-is into the corresponding sections of the master report.
3. **Metadata:**
   - The assignment creation date from Google Classroom is recorded in the master sheet header.
4. **Fault Tolerance:**
   - Corrupted or unreadable teacher files log warnings (and are listed in the detail sheet) without crashing the rest of the aggregation.

---

## ⏰ Automation via Windows Task Scheduler

To run the local CLI daily:

1. Open **Task Scheduler** (`Win + R` → `taskschd.msc`).
2. Create a task (e.g., `AI Bird Secretary Daily`) with a **Daily** trigger (e.g., `08:00:00`).
3. Add an **Action → Start a program**:
   - **Program/script:** `node.exe` (e.g., `C:\Program Files\nodejs\node.exe`)
   - **Add arguments:** `dist/index.js --auto`
   - **Start in:** path to your `ai-bird-secretary` directory.

---

## 📂 Project Structure

```text
src/
├── config/
│   ├── env.ts                     # Typed .env loading & Zod validation (CLI + shared)
│   └── web-env.ts                 # Hosted web server Zod environment validation
├── core/
│   ├── account-context.ts         # AsyncLocalStorage per-user execution context
│   ├── aggregator.ts              # Report aggregation, indicator mapping, 2D sheet matrix
│   ├── deadline.ts                # Kyiv timezone deadline & phase calculation
│   ├── local-state.ts             # Local CLI idempotency state (state.json)
│   ├── metric-mapping.ts          # Maps extracted rows to official template indicators
│   └── official-template-rows.ts  # 28-section official report template catalog
├── services/
│   ├── account.service.ts         # Encrypted token storage & account execution wrapper
│   ├── ai.service.ts              # Optional Groq AI text extraction
│   ├── auth.service.ts            # CLI OAuth2 / Service Account auth
│   ├── classroom.service.ts       # Google Classroom API integration
│   ├── database.service.ts        # PostgreSQL pool & session advisory locks
│   ├── delivery.service.ts        # Idempotent delivery tracking
│   ├── doc-parser.service.ts      # Native .docx / .xlsx / number parser
│   ├── drive.service.ts           # Google Drive API integration
│   ├── notify.service.ts          # Gmail & Telegram notifications
│   ├── rbac.service.ts            # Role permissions & admin user management
│   ├── session.service.ts         # Browser OAuth2/PKCE & cookie sessions
│   ├── settings.service.ts        # Per-user settings endpoints
│   ├── sheets.service.ts          # Google Sheets API integration & formatting
│   ├── telegram-binding.service.ts# Verified Telegram chat linking
│   ├── workflow.service.ts        # Hosted workflow orchestration
│   └── workspace.service.ts       # Per-user Drive workspace provisioning
├── index.ts                       # CLI entry point
├── migrate.ts                     # Compiled migration runner
└── server.ts                      # Fastify web server entry point
```

---

## 🧪 Testing

```bash
# Build TypeScript
npm run build

# Unit & regression tests (aggregator, doc-parser, AI service, review fixes)
npm test

# Hosted integration tests (embedded PostgreSQL, auth, RBAC, workspaces, workflows)
npm run test:hosted

# Headless browser UI tests (Playwright)
npm run test:browser
```

---

## 🚀 Hosted Deployment & Post-Review Notes

- Before starting the hosted server, run `npm run build` and `npm run db:migrate`. On Fly.io, `fly.toml` runs `npm run db:migrate` automatically via `release_command`; applied migrations are recorded in `bird.schema_migrations`.
- PostgreSQL TLS verifies against `DATABASE_CA` when set, or connects without strict CA verification when `DATABASE_CA` is unset.
- **Telegram linking (hosted):** Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (random secret), and `APP_URL`, then run `npm run telegram:setup` from a checkout with dev dependencies. In the dashboard settings, click **Підключити Telegram**, open the link, and press **Start**. Unverified raw chat IDs are no longer used.
- **AI text parsing:** Enabled only when both `GROQ_API_KEY` and `GROQ_MODEL` are configured. Without them, rule-based parsing runs and unrecognized items/warnings appear in the detail sheet.
- **Local CLI state:** The CLI stores phase progress, delivery state, and spreadsheet IDs in `state.json` in the working directory. Run the scheduler from a single working directory; if a process crashes, ensure it is no longer running before removing `state.json.lock`, and verify any `sending` delivery before marking it `sent` or retrying.
- **Final delivery attachments:** Emails include up to 20 JPEGs totaling up to 12 MB (max 5 MB per file); overflow photos are copied to a `"Підтвердження"` Drive folder next to the report and linked in the email.
