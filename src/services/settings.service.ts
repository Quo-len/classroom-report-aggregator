import { audit } from './rbac.service';
import { z } from 'zod';
import { FastifyInstance } from 'fastify';
import { withAccount } from './account.service';
import { accountContext } from '../core/account-context';
import { database, withAccountLock } from './database.service';
import { defaultAssignmentName, workspaceLinks, WorkspaceService } from './workspace.service';

// Only human-facing choices are stored; course IDs, folders and sheets are resolved per account by WorkspaceService.
export const settingsSchema = z.object({
  COURSE_NAME: z.string().trim().max(300).default(''),
  ASSIGNMENT_NAME: z.string().trim().max(300).default(''),
  HEAD_OF_DEPT_EMAIL: z.string().trim().email(),
  SCI_DEPT_EMAIL: z.string().trim().email(),
  HEAD_OF_DEPT_CHAT_ID: z.string().trim().regex(/^(-?\d+)?$/).max(30).default(''),
}).strict();

export function registerSettings(server: FastifyInstance) {
  server.get('/api/courses', { config: { permission: 'settings:write' } }, async request =>
    withAccount(request.accountSession!.user_id, async () =>
      ({ courses: await WorkspaceService.listCourses(accountContext.getStore()!.auth) }), false, false));

  server.put('/api/settings', { config: { permission: 'settings:write' } }, async (request, reply) => {
    const parsed = z.object({ settings: settingsSchema, automationEnabled: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Перевірте обов’язкові поля та адреси пошти.' });
    const userId = request.accountSession!.user_id;
    const { automationEnabled } = parsed.data;
    const settings = { ...parsed.data.settings, ASSIGNMENT_NAME: parsed.data.settings.ASSIGNMENT_NAME || defaultAssignmentName() };
    if (settings.HEAD_OF_DEPT_CHAT_ID && !process.env.TELEGRAM_BOT_TOKEN) {
      return reply.code(400).send({ error: 'Адміністратор ще не підключив Telegram-бота.' });
    }
    // The account lock prevents two concurrent saves from creating duplicate Drive folders.
    return withAccountLock(userId, () => withAccount(userId, async () => {
      if (settings.HEAD_OF_DEPT_CHAT_ID) {
        const binding = await database().query('SELECT chat_id FROM bird.telegram_bindings WHERE user_id = $1', [userId]);
        if (binding.rows[0]?.chat_id !== settings.HEAD_OF_DEPT_CHAT_ID) return reply.code(400).send({ error: 'Спершу підтвердьте Telegram через посилання підключення.' });
      }
      const auth = accountContext.getStore()!.auth;
      const course = await WorkspaceService.resolveCourse(auth, settings.COURSE_NAME);
      const { workspace } = await WorkspaceService.load(userId);
      const provisioned = await WorkspaceService.provision(auth, userId, workspace);
      await WorkspaceService.save(userId, course, provisioned);
      await database().query(`INSERT INTO bird.settings (user_id, value, automation_enabled) VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET value = EXCLUDED.value, automation_enabled = EXCLUDED.automation_enabled, updated_at = now()`,
        [userId, settings, automationEnabled]);
      await audit(userId, userId, 'settings.updated', { automationEnabled });
      return { ok: true, settings, course, workspace: workspaceLinks(provisioned) };
    }, false, false));
  });
}
