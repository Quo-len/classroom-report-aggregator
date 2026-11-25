import path from 'path';
import Fastify, { FastifyInstance, LogController } from 'fastify';
import fastifyStatic from '@fastify/static';
import { getWebEnv } from './config/web-env';
import { registerAuth, getSession, Session } from './services/session.service';
import { withAccount, oauthClient } from './services/account.service';
import { database, closeDatabase, withAccountLock } from './services/database.service';
import { decrypt } from './services/token-crypto';
import { Credentials } from 'google-auth-library';
import { ClassroomService } from './services/classroom.service';
import { registerSettings } from './services/settings.service';
import { executeWorkflow, runScheduledAccounts, Phase } from './services/workflow.service';
import { timingSafeEqual } from 'crypto';
import { can, permissionsFor, registerAdmin } from './services/rbac.service';

// Routes every signed-in account may reach; every other /api route must declare a permission.
const SESSION_ROUTES = new Set(['GET /api/me', 'POST /api/logout']);

declare module 'fastify' {
  interface FastifyRequest { accountSession: Session | null; }
}

export async function createServer(): Promise<FastifyInstance> {
  const config = getWebEnv();
  const server = Fastify({ logger: true, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 32768 });
  server.decorateRequest('accountSession', null);
  server.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const url = request.routeOptions.url || request.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    request.accountSession = await getSession(request);
    if (url === '/api/me' && request.method === 'GET') return;
    if (!request.accountSession) return reply.code(401).send({ error: 'Увійдіть через Google.' });
    if (request.method !== 'GET' && (request.headers.origin !== new URL(config.APP_URL).origin ||
      request.headers['x-csrf-token'] !== request.accountSession.csrf_token)) {
      return reply.code(403).send({ error: 'Оновіть сторінку та спробуйте ще раз.' });
    }
    if (SESSION_ROUTES.has(`${request.method} ${url}`)) return;
    const permission = request.routeOptions.config?.permission;
    if (!permission || !can(request.accountSession.role, permission)) {
      return reply.code(403).send({ error: 'Ваша роль не дозволяє цю дію. Зверніться до адміністратора.' });
    }
  });
  server.setErrorHandler((error, request, reply) => {
    const failure = error as { code?: string; statusCode?: number };
    server.log.error({ code: failure.code || 'REQUEST_FAILED', route: request.routeOptions.url }, 'Request failed');
    reply.code(failure.statusCode && failure.statusCode < 500 ? failure.statusCode : 500)
      .send({ error: 'Не вдалося виконати дію. Перевірте підключення Google та налаштування.' });
  });
  server.register(fastifyStatic, { root: path.resolve('public'), prefix: '/' });
  registerAuth(server);
  registerSettings(server);
  registerAdmin(server);
  server.get('/health', async () => ({ ok: true }));
  server.get('/api/me', async request => {
    const session = request.accountSession;
    if (!session) return { user: null };
    const settings = await database().query('SELECT value, automation_enabled FROM bird.settings WHERE user_id = $1', [session.user_id]);
    return { user: { name: session.name, email: session.email, connected: session.connected, role: session.role,
      permissions: permissionsFor(session.role) }, csrfToken: session.csrf_token,
      settings: settings.rows[0]?.value || null, automationEnabled: settings.rows[0]?.automation_enabled || false };
  });
  server.get('/api/runs', { config: { permission: 'report:read' } }, async request => {
    const result = await database().query(`SELECT phase, status, sheet_url, message, started_at, finished_at
      FROM bird.runs WHERE user_id = $1 ORDER BY started_at DESC LIMIT 30`, [request.accountSession!.user_id]);
    return { runs: result.rows };
  });
  server.post('/api/disconnect', { config: { permission: 'account:self' } }, async request => withAccountLock(request.accountSession!.user_id, async () => {
    const userId = request.accountSession!.user_id;
    const result = await database().query('SELECT tokens FROM bird.users WHERE id = $1', [userId]);
    if (result.rows[0]?.tokens) {
      const tokens = decrypt<Credentials>(result.rows[0].tokens, userId);
      if (tokens.refresh_token) {
        try { await oauthClient().revokeToken(tokens.refresh_token); }
        catch { server.log.warn('Google revocation failed; local access will be removed'); }
      }
    }
    await database().query('UPDATE bird.users SET tokens = NULL, auth_version = auth_version + 1 WHERE id = $1', [userId]);
    await database().query('UPDATE bird.settings SET automation_enabled = false WHERE user_id = $1', [userId]);
    return { ok: true };
  }));
  server.get('/api/status', { config: { permission: 'report:read' } }, async request => withAccount(request.accountSession!.user_id, async () => {
    const assignment = await ClassroomService.getTargetAssignment();
    if (!assignment) return { assignment: null, teachers: [] };
    const submissions = await ClassroomService.getSubmissions(assignment.id);
    return { assignment: { id: assignment.id, title: assignment.title, creationDate: assignment.creationDateFormatted,
      deadline: assignment.deadlineFormatted, daysRemaining: assignment.daysRemaining },
      teachers: submissions.map(item => ({ name: item.studentName, email: item.studentEmail, hasSubmitted: item.hasSubmitted,
        attachments: item.attachments.map(file => file.title || 'Файл') })) };
  }));
  server.post<{ Params: { phase: string } }>('/api/trigger/:phase', { config: { permission: 'workflow:run' } }, async (request, reply) => {
    if (!['monitor', 'draft', 'reconcile', 'final', 'auto'].includes(request.params.phase)) {
      return reply.code(400).send({ error: 'Невідома дія.' });
    }
    return executeWorkflow(request.accountSession!.user_id, request.params.phase as Phase);
  });
  server.post('/internal/scheduled', async (request, reply) => {
    const actual = Buffer.from(request.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${config.CRON_SECRET}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(401).send({ error: 'Unauthorized' });
    return runScheduledAccounts();
  });
  server.addHook('onClose', closeDatabase);
  return server;
}

if (require.main === module) {
  createServer().then(server => server.listen({ port: Number(process.env.PORT || 3000), host: '0.0.0.0' }))
    .catch(() => { console.error('Server startup failed. Check the hosted environment configuration.'); process.exitCode = 1; });
}
