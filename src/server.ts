import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { getWebEnv } from './config/web-env';
import { registerAuth, getSession, Session } from './services/session.service';
import { withAccount, oauthClient } from './services/account.service';
import { database, closeDatabase } from './services/database.service';
import { decrypt } from './services/token-crypto';
import { Credentials } from 'google-auth-library';
import { ClassroomService } from './services/classroom.service';
import { registerSettings } from './services/settings.service';
import { runMonitoringPhase, runDraftPhase, runReconcilePhase, runFinalPhase, runAutoDailyWorkflow } from './index';

declare module 'fastify' {
  interface FastifyRequest { accountSession: Session | null; }
}

export async function createServer(): Promise<FastifyInstance> {
  const config = getWebEnv();
  const server = Fastify({ logger: true, disableRequestLogging: true, bodyLimit: 32768 });
  server.decorateRequest('accountSession', null);
  server.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cache-Control', 'no-store');
    const url = request.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    request.accountSession = await getSession(request);
    if (url === '/api/me' && request.method === 'GET') return;
    if (!request.accountSession) return reply.code(401).send({ error: '???????? ????? Google.' });
    if (request.method !== 'GET' && (request.headers.origin !== new URL(config.APP_URL).origin ||
      request.headers['x-csrf-token'] !== request.accountSession.csrf_token)) {
      return reply.code(403).send({ error: '??????? ???????? ?? ????????? ?? ???.' });
    }
  });
  server.setErrorHandler((error, request, reply) => {
    const failure = error as { code?: string; statusCode?: number };
    server.log.error({ code: failure.code || 'REQUEST_FAILED', route: request.routeOptions.url }, 'Request failed');
    reply.code(failure.statusCode && failure.statusCode < 500 ? failure.statusCode : 500)
      .send({ error: '?? ??????? ???????? ???. ????????? ??????????? Google ?? ????????????.' });
  });
  server.register(fastifyStatic, { root: path.resolve('public'), prefix: '/' });
  registerAuth(server);
  registerSettings(server);
  server.get('/health', async () => ({ ok: true }));
  server.get('/api/me', async request => {
    const session = request.accountSession;
    if (!session) return { user: null };
    const settings = await database().query('SELECT value, automation_enabled FROM bird.settings WHERE user_id = $1', [session.user_id]);
    return { user: { name: session.name, email: session.email, connected: session.connected }, csrfToken: session.csrf_token,
      settings: settings.rows[0]?.value || null, automationEnabled: settings.rows[0]?.automation_enabled || false };
  });
  server.post('/api/disconnect', async request => {
    const userId = request.accountSession!.user_id;
    const result = await database().query('SELECT tokens FROM bird.users WHERE id = $1', [userId]);
    if (result.rows[0]?.tokens) {
      const tokens = decrypt<Credentials>(result.rows[0].tokens, userId);
      if (tokens.refresh_token) {
        try { await oauthClient().revokeToken(tokens.refresh_token); }
        catch { server.log.warn('Google revocation failed; local access will be removed'); }
      }
    }
    await database().query('UPDATE bird.users SET tokens = NULL WHERE id = $1', [userId]);
    await database().query('UPDATE bird.settings SET automation_enabled = false WHERE user_id = $1', [userId]);
    return { ok: true };
  });
  server.get('/api/status', async request => withAccount(request.accountSession!.user_id, async () => {
    const assignment = await ClassroomService.getTargetAssignment();
    if (!assignment) return { assignment: null, teachers: [] };
    const submissions = await ClassroomService.getSubmissions(assignment.id);
    return { assignment: { id: assignment.id, title: assignment.title, creationDate: assignment.creationDateFormatted,
      deadline: assignment.deadlineFormatted, daysRemaining: assignment.daysRemaining },
      teachers: submissions.map(item => ({ name: item.studentName, email: item.studentEmail, hasSubmitted: item.hasSubmitted,
        attachments: item.attachments.map(file => file.title || '????') })) };
  }));
  server.post<{ Params: { phase: string } }>('/api/trigger/:phase', async (request, reply) => {
    const actions: Record<string, () => Promise<unknown>> = {
      monitor: runMonitoringPhase, draft: runDraftPhase, reconcile: runReconcilePhase, final: runFinalPhase, auto: runAutoDailyWorkflow,
    };
    const action = actions[request.params.phase];
    if (!action) return reply.code(400).send({ error: '???????? ???.' });
    const result = await withAccount(request.accountSession!.user_id, action, false);
    return { ok: true, sheetUrl: typeof result === 'string' ? result : undefined };
  });
  server.addHook('onClose', closeDatabase);
  return server;
}

if (require.main === module) {
  createServer().then(server => server.listen({ port: Number(process.env.PORT || 3000), host: '0.0.0.0' }))
    .catch(() => { console.error('Server startup failed. Check the hosted environment configuration.'); process.exitCode = 1; });
}
