import assert from 'assert/strict';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { OAuth2Client } from 'google-auth-library';
import { createServer } from '../src/server';
import { hash, secret, saveTokens, withAccount } from '../src/services/account.service';
import { encrypt, decrypt } from '../src/services/token-crypto';
import { accountContext } from '../src/core/account-context';
import { deliverOnce } from '../src/services/delivery.service';
import { calendarDaysRemaining } from '../src/core/deadline';
import { phaseForDays, executeWorkflow } from '../src/services/workflow.service';
import { ClassroomService } from '../src/services/classroom.service';
import { Aggregator } from '../src/core/aggregator';
import { SheetsService } from '../src/services/sheets.service';
import { NotifyService } from '../src/services/notify.service';
import { SCOPES } from '../src/services/auth.service';
import { google } from 'googleapis';

// All queries go to this disposable PostgreSQL engine, never the developer's database.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test:test@localhost/test', APP_URL: 'https://bird.example',
  GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
  TOKEN_ENCRYPTION_KEY: 'a'.repeat(64), CRON_SECRET: 'b'.repeat(64),
});

async function main() {
  const db = new PGlite();
  const originalQuery = Pool.prototype.query, originalConnect = Pool.prototype.connect;
  const originalEnd = Pool.prototype.end;
  const query = async (sql: string, params?: unknown[]) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  Pool.prototype.query = query as any;
  Pool.prototype.connect = (async () => Object.assign(new EventEmitter(), { query, release() {} })) as any;
  Pool.prototype.end = (async () => {}) as any;
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const name of (await fs.readdir('migrations')).filter(name => /^\d.*\.sql$/.test(name)).sort()) {
        await db.exec(await fs.readFile(`migrations/${name}`, 'utf8'));
      }
    }
    console.log('PASS: migrations apply and can be rerun');
    const users = await query("INSERT INTO bird.users (google_sub, email, name) VALUES ('alice', 'alice@example.com', 'Alice'), ('bob', 'bob@example.com', 'Bob') RETURNING id");
    const alice = (users.rows[0] as any).id, bob = (users.rows[1] as any).id;
    const encrypted = encrypt({ refresh_token: 'private' }, alice);
    assert.deepEqual(decrypt(encrypted, alice), { refresh_token: 'private' });
    assert.throws(() => decrypt(encrypted, bob));
    const pieces = encrypted.split('.'); pieces[1] = Buffer.alloc(16).toString('base64url');
    assert.throws(() => decrypt(pieces.join('.'), alice));
    await saveTokens(alice, { refresh_token: 'refresh', access_token: 'access', expiry_date: Date.now() + 86400000 });
    await saveTokens(alice, { access_token: 'updated' }, 1);
    const saved = await query('SELECT tokens FROM bird.users WHERE id = $1', [alice]);
    assert.equal(decrypt<any>((saved.rows[0] as any).tokens, alice).refresh_token, 'refresh');
    await query('UPDATE bird.users SET tokens = NULL, auth_version = auth_version + 1 WHERE id = $1', [alice]);
    await assert.rejects(saveTokens(alice, { access_token: 'stale' }, 1));
    await saveTokens(alice, { access_token: 'access', refresh_token: 'refresh', expiry_date: Date.now() + 86400000 });
    console.log('PASS: authenticated encryption, token merging, stale refresh rejection');

    const sessionToken = secret(), csrf = secret();
    await query("INSERT INTO bird.sessions VALUES ($1, $2, $3, now() + interval '1 hour')", [hash(sessionToken), alice, csrf]);
    await query('INSERT INTO bird.settings (user_id, value) VALUES ($1, $2), ($3, $4)', [alice, { CLASSROOM_COURSE_ID: 'alice-course' }, bob, { CLASSROOM_COURSE_ID: 'bob-course' }]);
    server = await createServer();
    const cookie = `bird_session=${sessionToken}`;
    const headers = { cookie, origin: 'https://bird.example', 'x-csrf-token': csrf };
    assert.equal((await server.inject('/api/status')).statusCode, 401);
    assert.equal((await server.inject({ method: 'POST', url: '/api/trigger/final', payload: {} })).statusCode, 401);
    assert.equal((await server.inject({ method: 'POST', url: '/api/trigger/final', headers: { cookie }, payload: {} })).statusCode, 403);
    assert.equal((await server.inject({ method: 'POST', url: '/api/trigger/final', headers: { ...headers, origin: 'https://evil.example' }, payload: {} })).statusCode, 403);
    assert.equal((await server.inject({ method: 'POST', url: '/internal/scheduled', payload: {} })).statusCode, 401);
    assert.equal((await server.inject({ method: 'PUT', url: '/api/settings', headers, payload: { settings: {} } })).statusCode, 400);
    const me = (await server.inject({ url: '/api/me', headers: { cookie } })).json();
    assert.equal(me.user.email, 'alice@example.com');
    assert.equal(me.settings.CLASSROOM_COURSE_ID, 'alice-course');
    assert.equal(me.tokens, undefined);
    await server.close(); server = await createServer();
    assert.equal((await server.inject({ url: '/api/me', headers: { cookie } })).json().user.email, 'alice@example.com');
    const html = (await server.inject('/')).body;
    assert.match(html, /Секретар кафедри/);
    assert.doesNotMatch(html, /dry.?run|\?{3,}/i);
    assert.doesNotMatch(await fs.readFile('public/app.js', 'utf8'), /dry.?run|\?{3,}/i);
    console.log('PASS: protected routes, CSRF, session restart persistence, account-owned settings and UTF-8 frontend');

    await query("UPDATE bird.users SET role = 'admin' WHERE id = $1", [alice]);
    await query("UPDATE bird.users SET role = 'viewer' WHERE id = $1", [bob]);
    await query('UPDATE bird.settings SET automation_enabled = true WHERE user_id = $1', [bob]);
    const bobToken = secret(), bobCsrf = secret();
    await query("INSERT INTO bird.sessions VALUES ($1, $2, $3, now() + interval '1 hour')", [hash(bobToken), bob, bobCsrf]);
    const bobHeaders = { cookie: `bird_session=${bobToken}`, origin: 'https://bird.example', 'x-csrf-token': bobCsrf };
    const bobMe = (await server.inject({ url: '/api/me', headers: bobHeaders })).json();
    assert.equal(bobMe.user.role, 'viewer');
    assert.deepEqual(bobMe.user.permissions, ['account:self', 'report:read']);
    assert.equal((await server.inject({ url: '/api/runs', headers: bobHeaders })).statusCode, 200);
    assert.equal((await server.inject({ method: 'POST', url: '/api/trigger/draft', headers: bobHeaders, payload: {} })).statusCode, 403);
    assert.equal((await server.inject({ method: 'PUT', url: '/api/settings', headers: bobHeaders, payload: {} })).statusCode, 403);
    assert.equal((await server.inject({ url: '/api/courses', headers: bobHeaders })).statusCode, 403);
    assert.equal((await server.inject({ url: '/api/admin/users', headers: bobHeaders })).statusCode, 403);
    assert.equal((await server.inject({ url: '/api/unknown', headers: bobHeaders })).statusCode, 404);
    const listing = (await server.inject({ url: '/api/admin/users', headers })).json();
    assert.deepEqual(listing.users.map((user: any) => user.email).sort(), ['alice@example.com', 'bob@example.com']);
    assert.doesNotMatch(JSON.stringify(listing), /tokens|refresh|course/);
    const setRole = (id: string, role: string, as = headers) => server!.inject({ method: 'PUT', url: `/api/admin/users/${id}/role`, headers: as, payload: { role } });
    assert.equal((await setRole(alice, 'viewer')).statusCode, 400);
    assert.equal((await setRole(bob, 'owner')).statusCode, 400);
    assert.equal((await setRole(alice, 'admin', bobHeaders)).statusCode, 403);
    assert.equal((await setRole(bob, 'disabled')).statusCode, 200);
    assert.equal((await server.inject({ url: '/api/me', headers: bobHeaders })).json().user, null);
    assert.equal((await query('SELECT * FROM bird.sessions WHERE user_id = $1', [bob])).rows.length, 0);
    assert.equal((await query('SELECT automation_enabled FROM bird.settings WHERE user_id = $1', [bob])).rows[0].automation_enabled, false);
    assert.equal((await setRole(bob, 'admin')).statusCode, 200);
    assert.equal((await setRole(alice, 'editor', headers)).statusCode, 400);
    assert.equal((await setRole(bob, 'editor')).statusCode, 200);
    const audit = (await server.inject({ url: '/api/admin/users', headers })).json().audit;
    assert.deepEqual(audit.map((event: any) => event.detail.to), ['editor', 'admin', 'disabled']);
    console.log('PASS: role permissions, default-deny API routes, admin user management, audit log and session revocation');

    const login = await server.inject('/auth/login');
    const location = new URL(login.headers.location!);
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    const state = location.searchParams.get('state')!;
    const binding = String(login.headers['set-cookie']).split(';')[0];
    const denied = await server.inject(`/auth/callback?state=${state}&code=unused`);
    assert.equal(denied.headers.location, '/?login=failed');
    assert.equal((await query('SELECT * FROM bird.oauth_attempts WHERE state_hash = $1', [hash(state)])).rows.length, 1);
    const getToken = OAuth2Client.prototype.getToken, verify = OAuth2Client.prototype.verifyIdToken;
    OAuth2Client.prototype.getToken = (async () => ({ tokens: { id_token: 'test', refresh_token: 'oauth-refresh', access_token: 'oauth-access', scope: SCOPES.join(' ') } })) as any;
    OAuth2Client.prototype.verifyIdToken = (async () => ({ getPayload: () => ({ sub: 'oauth-user', email: 'oauth@example.com', email_verified: true, nonce: location.searchParams.get('nonce') }) })) as any;
    try {
      const callback = await server.inject({ url: `/auth/callback?state=${state}&code=unused`, headers: { cookie: binding } });
      assert.equal(callback.headers.location, '/');
      assert.match(String(callback.headers['set-cookie']), /HttpOnly; SameSite=Lax.*Secure/);
      const replay = await server.inject({ url: `/auth/callback?state=${state}&code=unused`, headers: { cookie: binding } });
      assert.equal(replay.headers.location, '/?login=failed');
      assert.equal((await query("SELECT role FROM bird.users WHERE google_sub = 'oauth-user'")).rows[0].role, 'editor');
    } finally { OAuth2Client.prototype.getToken = getToken; OAuth2Client.prototype.verifyIdToken = verify; }
    console.log('PASS: browser-bound OAuth state, PKCE, identity callback and replay rejection');

    const run = await query("INSERT INTO bird.runs (user_id, course_id, assignment_id, phase, status) VALUES ($1, 'course', 'assignment', 'draft', 'running') RETURNING id", [alice]);
    const runId = (run.rows[0] as any).id;
    let sends = 0;
    await accountContext.run({ userId: alice, auth: new OAuth2Client(), settings: {}, dryRun: false, runId }, async () => {
      await deliverOnce('sent', async () => { sends++; });
      await deliverOnce('sent', async () => { sends++; });
      assert.equal(sends, 1);
      await assert.rejects(deliverOnce('uncertain', async () => { sends++; throw new Error('Connection lost after send'); }));
      await assert.rejects(deliverOnce('uncertain', async () => { sends++; }));
      assert.equal(sends, 2);
    });
    await query("INSERT INTO bird.runs (user_id, course_id, assignment_id, phase, status) VALUES ($1, 'bob-course', 'private', 'final', 'completed')", [bob]);
    const history = (await server.inject({ url: '/api/runs', headers: { cookie } })).json();
    assert.equal(history.runs.length, 1);
    console.log('PASS: notification deduplication, ambiguous-delivery blocking, account-owned history');

    assert.equal(calendarDaysRemaining(new Date('2026-11-25T10:00:00Z'), new Date('2026-11-24T23:00:00Z')), 0);
    assert.equal(calendarDaysRemaining(new Date('2026-03-30T10:00:00Z'), new Date('2026-03-27T10:00:00Z')), 3);
    assert.deepEqual([null, 5, 3, 2, 1, 0, -1].map(phaseForDays), ['monitor', 'monitor', 'draft', 'draft', 'reconcile', 'final', 'final']);

    const originals = { assignment: ClassroomService.getTargetAssignment, submissions: ClassroomService.getSubmissions,
      aggregate: Aggregator.aggregateAll, summary: Aggregator.buildSummaryGrid, detail: Aggregator.buildDetailGrid,
      sheet: SheetsService.createOrUpdateMasterSheet, remind: NotifyService.sendMissingTeachersReminder, head: NotifyService.notifyHeadOfDeptMissingList };
    let reports = 0;
    ClassroomService.getTargetAssignment = async () => ({ id: 'workflow-assignment', daysRemaining: 3, title: 'Test' } as any);
    ClassroomService.getSubmissions = async () => [];
    Aggregator.aggregateAll = async () => ({} as any);
    Aggregator.buildSummaryGrid = () => [];
    Aggregator.buildDetailGrid = () => [];
    SheetsService.createOrUpdateMasterSheet = async () => { reports++; return { spreadsheetId: 'test', webViewLink: 'https://docs.google.com/spreadsheets/d/test/edit' }; };
    NotifyService.sendMissingTeachersReminder = async () => {};
    NotifyService.notifyHeadOfDeptMissingList = async () => {};
    try {
      await executeWorkflow(alice, 'auto');
      await executeWorkflow(alice, 'auto');
      assert.equal(reports, 1);
      await withAccount(alice, async () => assert.equal(accountContext.getStore()!.settings.CLASSROOM_COURSE_ID, 'alice-course'));
      await assert.rejects(withAccount(bob, async () => {}));
    } finally {
      ClassroomService.getTargetAssignment = originals.assignment; ClassroomService.getSubmissions = originals.submissions;
      Aggregator.aggregateAll = originals.aggregate; Aggregator.buildSummaryGrid = originals.summary; Aggregator.buildDetailGrid = originals.detail;
      SheetsService.createOrUpdateMasterSheet = originals.sheet; NotifyService.sendMissingTeachersReminder = originals.remind; NotifyService.notifyHeadOfDeptMissingList = originals.head;
    }
    console.log('PASS: Kyiv deadline phases and persistent automatic-workflow deduplication');

    const sheetsFactory = google.sheets, driveFactory = google.drive;
    let createdSheets = 0, writes = 0;
    (google as any).sheets = () => ({ spreadsheets: {
      create: async () => { createdSheets++; return { data: { spreadsheetId: 'reused-sheet' } }; },
      get: async () => ({ data: { sheets: [
        { properties: { sheetId: 0, title: 'Підсумковий звіт' } },
        { properties: { sheetId: 1, title: 'Деталізація по викладачах' } },
      ] } }),
      batchUpdate: async () => ({ data: {} }),
      values: { clear: async () => {}, update: async () => { writes++; } },
    } });
    (google as any).drive = () => ({ files: {
      get: async () => ({ data: { parents: ['folder'] } }), update: async () => ({ data: {} }),
    } });
    try {
      await accountContext.run({ userId: alice, assignmentId: 'reuse', auth: new OAuth2Client(), dryRun: false,
        settings: { CLASSROOM_COURSE_ID: 'course', MASTER_OUTPUT_FOLDER_ID: 'folder' } }, async () => {
        await SheetsService.createOrUpdateMasterSheet('Draft', [['value']], [['teacher']]);
        await SheetsService.createOrUpdateMasterSheet('Final', [['updated']], [['teacher'], ['late teacher']]);
      });
      assert.equal(createdSheets, 1);
      assert.equal(writes, 4);
    } finally { google.sheets = sheetsFactory; google.drive = driveFactory; }
    const accessToken = OAuth2Client.prototype.getAccessToken;
    OAuth2Client.prototype.getAccessToken = (async function (this: OAuth2Client) {
      this.emit('tokens', { access_token: 'refreshed-access', expiry_date: Date.now() + 86400000 });
      return { token: 'refreshed-access' };
    }) as any;
    try {
      await withAccount(alice, async () => {});
      const refreshed = await query('SELECT tokens FROM bird.users WHERE id = $1', [alice]);
      assert.equal(decrypt<any>((refreshed.rows[0] as any).tokens, alice).access_token, 'refreshed-access');
      assert.equal(decrypt<any>((refreshed.rows[0] as any).tokens, alice).refresh_token, 'refresh');
    } finally { OAuth2Client.prototype.getAccessToken = accessToken; }
    console.log('PASS: report reuse across phases and persisted token refresh events');
    assert.equal((await server.inject({ method: 'POST', url: '/api/logout', headers, payload: {} })).statusCode, 200);
    assert.equal((await server.inject({ url: '/api/me', headers: { cookie } })).json().user, null);
    console.log('Hosted integration tests passed');
  } finally {
    await server?.close();
    Pool.prototype.query = originalQuery; Pool.prototype.connect = originalConnect; Pool.prototype.end = originalEnd;
    await db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
