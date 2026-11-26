import { audit } from './rbac.service';
import { phaseFor } from '../core/deadline';
import { accountContext } from '../core/account-context';
import { UserError } from './api-error';
import { withAccount } from './account.service';
import { database, withAccountLock } from './database.service';
import { ClassroomService } from './classroom.service';
import { WorkspaceService } from './workspace.service';
import { runDraftPhase, runReconcilePhase, runFinalPhase } from '../index';

export type Phase = 'monitor' | 'draft' | 'reconcile' | 'final' | 'auto';

export async function executeWorkflow(userId: string, requested: Phase, dryRun = false) {
  return withAccountLock(userId, () => withAccount(userId, async () => {
    const context = accountContext.getStore()!;
    // Re-validates the Drive workspace each run so trashed folders or sheets are recreated before reporting.
    await WorkspaceService.ensure({ drive: true });
    const assignment = await ClassroomService.getTargetAssignment();
    if (!assignment) throw new UserError(`Завдання «${context.settings.ASSIGNMENT_NAME}» не знайдено в обраному курсі.`, 404);
    const phase = requested === 'auto' ? phaseFor(assignment.deadline) : requested;
    if (phase === 'monitor') return { ok: true, message: 'Перевірку завершено. Звіт за розкладом ще не потрібний.' };
    context.assignmentId = assignment.id;
    if (dryRun) {
      const submissions = await ClassroomService.getSubmissions(assignment.id);
      const actions = { draft: runDraftPhase, reconcile: runReconcilePhase, final: runFinalPhase };
      return { ok: true, sheetUrl: await actions[phase](assignment, submissions), message: 'Notification dry run completed; a test report was created.' };
    }
    const courseId = context.settings.CLASSROOM_COURSE_ID!;
    const previous = await database().query(`SELECT id, status, sheet_url FROM bird.runs
      WHERE user_id = $1 AND course_id = $2 AND assignment_id = $3 AND phase = $4 ORDER BY started_at DESC, id DESC LIMIT 1`, [userId, courseId, assignment.id, phase]);
    const last = previous.rows[0];
    if (last?.status === 'completed' && requested === 'auto') {
      return { ok: true, sheetUrl: last.sheet_url, message: 'Цей етап уже виконано. Повторні сповіщення не надсилалися.' };
    }
    if (last) {
      const uncertain = await database().query("SELECT 1 FROM bird.deliveries WHERE run_id = $1 AND status != 'sent' LIMIT 1", [last.id]);
      if (uncertain.rowCount) {
        await database().query("UPDATE bird.runs SET status = 'needs_review', message = $2 WHERE id = $1", [last.id, 'Доставку перервано. Перевірте надіслані повідомлення перед повторним запуском.']);
        throw Object.assign(new Error('Notification delivery requires review'), { statusCode: 409 });
      }
    }
    if (last && last.status !== 'completed') {
      context.runId = last.id;
      await database().query("UPDATE bird.runs SET status = 'running', finished_at = NULL, message = NULL WHERE id = $1", [last.id]);
    } else {
      const run = await database().query(`INSERT INTO bird.runs (user_id, course_id, assignment_id, phase, status)
        VALUES ($1, $2, $3, $4, 'running') RETURNING id`, [userId, courseId, assignment.id, phase]);
      context.runId = run.rows[0].id;
    }
    await audit(userId, userId, 'workflow.started', { phase, runId: context.runId });
    try {
      const submissions = await ClassroomService.getSubmissions(assignment.id);
      const actions = { draft: runDraftPhase, reconcile: runReconcilePhase, final: runFinalPhase };
      const sheetUrl = await actions[phase](assignment, submissions);
      if (!sheetUrl) throw new Error('Report generation failed');
      await database().query("UPDATE bird.runs SET status = 'completed', sheet_url = $2, finished_at = now() WHERE id = $1", [context.runId, sheetUrl]);
      await audit(userId, userId, 'workflow.completed', { phase, runId: context.runId });
      return { ok: true, sheetUrl, message: 'Звіт оновлено. Сповіщення надіслано відповідно до етапу.' };
    } catch (error) {
      await database().query(`UPDATE bird.runs SET status = CASE WHEN EXISTS
        (SELECT 1 FROM bird.deliveries WHERE run_id = $1 AND status != 'sent') THEN 'needs_review' ELSE 'failed' END,
        message = $2, finished_at = now() WHERE id = $1`, [context.runId, 'Виконання перервано. Перевірте доступ до Google та стан доставки.']);
      throw error;
    }
  }, dryRun));
}

export async function runScheduledAccounts() {
  return withAccountLock('scheduled-workflow', async () => {
    await database().query('DELETE FROM bird.sessions WHERE expires_at < now()');
    await database().query('DELETE FROM bird.oauth_attempts WHERE expires_at < now()');
    const accounts = await database().query(`SELECT s.user_id FROM bird.settings s JOIN bird.users u ON u.id = s.user_id
      WHERE s.automation_enabled AND u.tokens IS NOT NULL AND u.role IN ('admin', 'editor') ORDER BY s.user_id`);
    let completed = 0, failed = 0;
    for (const { user_id } of accounts.rows) {
      try { await executeWorkflow(user_id, 'auto'); completed++; }
      catch { failed++; console.error(`Scheduled workflow failed for account ${user_id}`); }
    }
    return { ok: failed === 0, completed, failed };
  });
}
