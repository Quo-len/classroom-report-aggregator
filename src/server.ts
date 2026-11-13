import path from 'path';
import fs from 'fs';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ClassroomService, CourseAssignment, StudentSubmissionItem } from './services/classroom.service';
import { NotifyService } from './services/notify.service';
import { HealthService } from './services/health.service';
import { env } from './config/env';
import {
  runMonitoringPhase,
  runDraftPhase,
  runReconcilePhase,
  runFinalPhase,
  runAutoDailyWorkflow,
} from './index';

export async function createServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: true,
  });

  // Enable CORS so HTML opened from file:// can also fetch API
  server.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return reply.code(200).send();
    }
  });

  const publicPath = path.resolve('public');
  if (fs.existsSync(publicPath)) {
    server.register(fastifyStatic, {
      root: publicPath,
      prefix: '/',
    });
  }

  // 1. Health check endpoint
  server.get('/api/health', async () => {
    const isHealthy = await HealthService.runDiagnostics();
    return { ok: isHealthy, timestamp: new Date().toISOString() };
  });

  // 2. Status overview endpoint
  server.get('/api/status', async () => {
    try {
      let assignment: CourseAssignment | null = null;
      let submissions: StudentSubmissionItem[] = [];

      try {
        assignment = await ClassroomService.getTargetAssignment();
        if (assignment) {
          submissions = await ClassroomService.getSubmissions(assignment.id);
        }
      } catch (err: any) {
        server.log.warn(`Could not reach Google Classroom live API: ${err.message}`);
      }

      if (!assignment) {
        return {
          ok: false,
          error: `Завдання "${env.ASSIGNMENT_NAME}" не знайдено в Google Classroom курсу ${env.CLASSROOM_COURSE_ID}.`,
        };
      }

      const submittedCount = submissions.filter((s) => s.hasSubmitted).length;
      const missingList = submissions.filter((s) => !s.hasSubmitted).map((s) => s.studentName);

      return {
        ok: true,
        mode: 'live',
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        assignmentUrl: assignment.raw?.alternateLink || `https://classroom.google.com/c/${env.CLASSROOM_COURSE_ID}`,
        courseId: env.CLASSROOM_COURSE_ID,
        courseUrl: `https://classroom.google.com/c/${env.CLASSROOM_COURSE_ID}`,
        creationDateFormatted: assignment.creationDateFormatted,
        deadlineFormatted: assignment.deadlineFormatted,
        daysRemaining: assignment.daysRemaining,
        submittedCount,
        totalTeachers: submissions.length,
        missingTeachers: missingList,
        teachers: submissions.map((s) => ({
          name: s.studentName,
          email: s.studentEmail,
          hasSubmitted: s.hasSubmitted,
          attachments: s.attachments.map((a) => a.title),
        })),
        driveFolderId: env.MASTER_OUTPUT_FOLDER_ID,
        driveFolderUrl: `https://drive.google.com/drive/folders/${env.MASTER_OUTPUT_FOLDER_ID}`,
        telegramBot: '@a_birb_bot',
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // 3. Trigger action endpoint
  server.post<{
    Params: { phase: string };
    Body: { dryRun?: boolean };
  }>('/api/trigger/:phase', async (req, reply) => {
    const { phase } = req.params;
    const isDryRun = req.body?.dryRun ?? true;
    NotifyService.dryRun = isDryRun;

    server.log.info(`[TRIGGER] Executing phase: ${phase} (dryRun: ${isDryRun})`);

    try {
      if (phase === 'monitor') {
        try {
          const res = await runMonitoringPhase();
          if (!res) {
            return reply.code(404).send({
              ok: false,
              error: `Завдання "${env.ASSIGNMENT_NAME}" не знайдено в Google Classroom.`,
            });
          }
          const submitted = res.submissions.filter((s) => s.hasSubmitted).length;
          const total = res.submissions.length;
          return {
            ok: true,
            message: `Моніторинг успішно виконано (Режим: ${isDryRun ? 'Dry-Run' : 'Live'}). Зафіксовано ${submitted} здач із ${total} викладачів.`,
          };
        } catch (e: any) {
          server.log.error(`Monitoring failed: ${e.message}`);
          return reply.code(502).send({ ok: false, error: `Моніторинг не виконано: ${e.message}` });
        }
      }

      if (phase === 'draft') {
        try {
          const sheetUrl = await runDraftPhase();
          return {
            ok: true,
            message: `Фазу Т-3 (попередній звіт) успішно виконано. Боржників попереджено, завідувача кафедри сповіщено.`,
            sheetUrl,
          };
        } catch (e: any) {
          server.log.error(`Draft phase failed: ${e.message}`);
          return reply.code(502).send({ ok: false, error: `Чернетку не сформовано: ${e.message}` });
        }
      }

      if (phase === 'reconcile') {
        try {
          const sheetUrl = await runReconcilePhase();
          return {
            ok: true,
            message: `Фазу Т-1 (звірка та перерахунок) успішно виконано. Таблицю оновлено.`,
            sheetUrl,
          };
        } catch (e: any) {
          server.log.error(`Reconcile phase failed: ${e.message}`);
          return reply.code(502).send({ ok: false, error: `Звірку не виконано: ${e.message}` });
        }
      }

      if (phase === 'final') {
        try {
          const sheetUrl = await runFinalPhase();
          return {
            ok: true,
            message: `Фінальну здачу виконано: підсумковий Google Sheet та JPEG-додатки надіслано до наукового відділу (${env.SCI_DEPT_EMAIL}).`,
            sheetUrl,
          };
        } catch (e: any) {
          server.log.error(`Final phase failed: ${e.message}`);
          return reply.code(502).send({ ok: false, error: `Фінальну здачу не виконано: ${e.message}` });
        }
      }

      if (phase === 'auto') {
        try {
          await runAutoDailyWorkflow();
          return {
            ok: true,
            message: `Автоматичний щоденний розклад перевірив статус дедлайну та виконав відповідні дії.`,
          };
        } catch (e: any) {
          server.log.error(`Automatic workflow failed: ${e.message}`);
          return reply.code(502).send({ ok: false, error: `Автоматичний розклад не виконано: ${e.message}` });
        }
      }

      return reply.code(400).send({ ok: false, error: `Невідома фаза: ${phase}` });
    } catch (err: any) {
      server.log.error(err);
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  return server;
}

// If run directly: start server
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3000', 10);
  createServer()
    .then((server) => {
      server.listen({ port, host: '0.0.0.0' }, (err, address) => {
        if (err) {
          server.log.error(err);
          process.exit(1);
        }
        console.log(`\n============================================================`);
        console.log(`🚀 Сервер АІ-Секретаря запущено: ${address}`);
        console.log(`🌐 Веб-панель керування: http://localhost:${port}`);
        console.log(`============================================================\n`);
      });
    })
    .catch((err) => {
      console.error('Failed to start Fastify server:', err);
      process.exit(1);
    });
}
