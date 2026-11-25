import { z } from 'zod';
import { google } from 'googleapis';
import { FastifyInstance } from 'fastify';
import { withAccount } from './account.service';
import { accountContext } from '../core/account-context';
import { database } from './database.service';

const resourceId = z.string().trim().regex(/^[\w-]{1,200}$/);
export const settingsSchema = z.object({
  CLASSROOM_COURSE_ID: resourceId,
  ASSIGNMENT_NAME: z.string().trim().min(1).max(300),
  STATIC_PLAN_SHEET_ID: resourceId,
  STATIC_SCI_PLAN_SHEET_ID: resourceId,
  MASTER_OUTPUT_FOLDER_ID: resourceId,
  HEAD_OF_DEPT_EMAIL: z.string().trim().email(),
  SCI_DEPT_EMAIL: z.string().trim().email(),
  HEAD_OF_DEPT_CHAT_ID: z.string().trim().regex(/^(-?\d+)?$/).max(30).default(''),
}).strict();

export function registerSettings(server: FastifyInstance) {
  server.get('/api/courses', async request => withAccount(request.accountSession!.user_id, async () => {
    const api = google.classroom({ version: 'v1', auth: accountContext.getStore()!.auth });
    const courses: { id: string; name: string }[] = [];
    let pageToken: string | undefined;
    do {
      const response = await api.courses.list({ teacherId: 'me', courseStates: ['ACTIVE'], pageSize: 100, pageToken });
      for (const course of response.data.courses || []) if (course.id) courses.push({ id: course.id, name: course.name || course.id });
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
    return { courses };
  }, false, false));

  server.put('/api/settings', async (request, reply) => {
    const parsed = z.object({ settings: settingsSchema, automationEnabled: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Перевірте обов’язкові поля, адреси пошти та ідентифікатори файлів.' });
    const userId = request.accountSession!.user_id;
    const { settings, automationEnabled } = parsed.data;
    if (settings.HEAD_OF_DEPT_CHAT_ID && !process.env.TELEGRAM_BOT_TOKEN) {
      return reply.code(400).send({ error: 'Адміністратор ще не підключив Telegram-бота.' });
    }
    await withAccount(userId, async () => {
      const auth = accountContext.getStore()!.auth;
      const classroom = google.classroom({ version: 'v1', auth });
      const sheets = google.sheets({ version: 'v4', auth });
      const drive = google.drive({ version: 'v3', auth });
      await classroom.courses.teachers.get({ courseId: settings.CLASSROOM_COURSE_ID, userId: 'me' });
      await Promise.all([settings.STATIC_PLAN_SHEET_ID, settings.STATIC_SCI_PLAN_SHEET_ID].map(spreadsheetId =>
        sheets.spreadsheets.get({ spreadsheetId, fields: 'spreadsheetId' })));
      const folder = await drive.files.get({ fileId: settings.MASTER_OUTPUT_FOLDER_ID, fields: 'mimeType,capabilities(canAddChildren),trashed', supportsAllDrives: true });
      if (folder.data.trashed || folder.data.mimeType !== 'application/vnd.google-apps.folder' || !folder.data.capabilities?.canAddChildren) {
        throw new Error('Output folder is not writable');
      }
    }, false, false);
    await database().query(`INSERT INTO bird.settings (user_id, value, automation_enabled) VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET value = EXCLUDED.value, automation_enabled = EXCLUDED.automation_enabled, updated_at = now()`,
      [userId, settings, automationEnabled]);
    return { ok: true };
  });
}
