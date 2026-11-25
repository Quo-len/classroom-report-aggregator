import { AuthService } from './services/auth.service';
import { ClassroomService, CourseAssignment, StudentSubmissionItem } from './services/classroom.service';
import { SheetsService } from './services/sheets.service';
import { DriveService, DownloadedAsset } from './services/drive.service';
import { NotifyService } from './services/notify.service';
import { HealthService } from './services/health.service';
import { Aggregator } from './core/aggregator';
import { createServer } from './server';
import { env } from './config/env';
import { executeWorkflow, Phase } from './services/workflow.service';
import { closeDatabase } from './services/database.service';

/**
 * Custom logger helper with timestamp
 */
function logInfo(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ℹ️  ${message}`);
}

function logError(message: string, error?: any): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ ${message}`, error || '');
}

/**
 * Action: Interactive OAuth Initialization
 */
async function runAuthInit(): Promise<void> {
  console.log('🚀 Running Google OAuth2 Authorization Initialization...');
  await AuthService.getAuthClient(true);
  console.log('✅ Google Auth initialization completed successfully.');
}

/**
 * Action 1: Monitoring Phase
 * Polls Google Classroom for assignment, extracts metadata and deadline
 */
export async function runMonitoringPhase(): Promise<{ assignment: CourseAssignment; submissions: StudentSubmissionItem[] } | null> {
  logInfo(`=== STAGE 1: MONITORING PHASE ===`);
  const assignment = await ClassroomService.getTargetAssignment();

  if (!assignment) {
    logError(`Assignment "${env.ASSIGNMENT_NAME}" could not be found in course ${env.CLASSROOM_COURSE_ID}.`);
    return null;
  }

  const submissions = await ClassroomService.getSubmissions(assignment.id);
  const submittedCount = submissions.filter((s) => s.hasSubmitted).length;
  const missingCount = submissions.length - submittedCount;

  console.log('\n📊 === MONITORING SUMMARY ===');
  console.log(`📌 Assignment: ${assignment.title}`);
  console.log(`📅 Published in Classroom: ${assignment.creationDateFormatted}`);
  console.log(`⏰ Deadline: ${assignment.deadlineFormatted}`);
  console.log(`⏳ Days Remaining: ${assignment.daysRemaining !== null ? assignment.daysRemaining : 'N/A'}`);
  console.log(`👥 Total teachers: ${submissions.length} (${submittedCount} submitted, ${missingCount} pending)`);
  console.log('==============================\n');

  return { assignment, submissions };
}

/**
 * Action 2: T-minus 3 Days (Draft & Warn)
 * - Generate preliminary master Google Sheet based only on currently submitted files
 * - Send email reminder via Gmail to teachers who have not submitted (warning: 48h left)
 * - Send direct message via Telegram and email to Head of Dept listing missing teachers
 */
export async function runDraftPhase(
  existingAssignment?: CourseAssignment,
  existingSubmissions?: StudentSubmissionItem[]
): Promise<string | null> {
  logInfo(`=== STAGE 2: T-MINUS 3 DAYS (DRAFT & WARN) ===`);

  const assignment = existingAssignment || (await ClassroomService.getTargetAssignment());
  if (!assignment) {
    logError('Cannot run Draft Phase: Assignment not found.');
    return null;
  }

  const submissions = existingSubmissions || (await ClassroomService.getSubmissions(assignment.id));
  const missingTeachers = submissions
    .filter((s) => !s.hasSubmitted)
    .map((s) => ({ name: s.studentName, email: s.studentEmail }));

  // 1. Build and generate preliminary master sheet
  const aggregatedData = await Aggregator.aggregateAll(assignment, submissions, 'Чернетка (T-3)');
  const summaryGrid = Aggregator.buildSummaryGrid(aggregatedData);
  const detailGrid = Aggregator.buildDetailGrid(aggregatedData);

  const sheetTitle = `[ЧЕРНЕТКА Т-3] Зведений звіт кафедри - ${assignment.title} (${new Date().toISOString().split('T')[0]})`;
  const { spreadsheetId, webViewLink } = await SheetsService.createOrUpdateMasterSheet(sheetTitle, summaryGrid, detailGrid);

  logInfo(`Preliminary master sheet generated: ${webViewLink}`);

  // 2. Send email reminder to teachers who have not submitted (48 hours left)
  await NotifyService.sendMissingTeachersReminder(missingTeachers);

  // 3. Send Telegram and email to Head of Department with missing list
  await NotifyService.notifyHeadOfDeptMissingList(missingTeachers, webViewLink, aggregatedData.aiSummary);

  logInfo(`Draft & Warn phase completed successfully.`);
  return webViewLink;
}

/**
 * Action 3: T-minus 1 Day (Reconciliation)
 * - Check for late submissions
 * - Recalculate all sums and update master Google Sheet
 */
export async function runReconcilePhase(
  existingAssignment?: CourseAssignment,
  existingSubmissions?: StudentSubmissionItem[]
): Promise<string | null> {
  logInfo(`=== STAGE 3: T-MINUS 1 DAY (RECONCILIATION) ===`);

  const assignment = existingAssignment || (await ClassroomService.getTargetAssignment());
  if (!assignment) {
    logError('Cannot run Reconciliation Phase: Assignment not found.');
    return null;
  }

  const submissions = existingSubmissions || (await ClassroomService.getSubmissions(assignment.id));
  const aggregatedData = await Aggregator.aggregateAll(assignment, submissions, 'Звірення (T-1)');
  const summaryGrid = Aggregator.buildSummaryGrid(aggregatedData);
  const detailGrid = Aggregator.buildDetailGrid(aggregatedData);

  const sheetTitle = `[ЗВІРЕННЯ Т-1] Зведений звіт кафедри - ${assignment.title}`;
  const { spreadsheetId, webViewLink } = await SheetsService.createOrUpdateMasterSheet(sheetTitle, summaryGrid, detailGrid);

  const submittedCount = submissions.filter((s) => s.hasSubmitted).length;
  logInfo(`Reconciled and updated master Google Sheet: ${webViewLink} (${submittedCount}/${submissions.length} submitted)`);

  // Send update to Head of Department
  const tgMsg = `
<b>🔄 [Т-1 День] Звірення даних перед дедлайном</b>
<b>Завдання:</b> ${assignment.title}
<b>Подано звітів:</b> ${submittedCount} з ${submissions.length} викладачів
<b>Оновлений звіт:</b> <a href="${webViewLink}">Переглянути оновлений звіт</a>
${aggregatedData.aiSummary ? `\n\n<b>Резюме:</b>\n<i>${aggregatedData.aiSummary}</i>` : ''}
  `.trim();
  await NotifyService.sendTelegramMessage(tgMsg);

  return webViewLink;
}

/**
 * Action 4: Final Delivery (Deadline Day)
 * - Generate final master Google Sheet
 * - Download any .jpeg attachments found in submissions
 * - Email final link + JPEGs to Scientific Dept and Head of Dept
 * - Notify Head of Dept on Telegram
 */
export async function runFinalPhase(
  existingAssignment?: CourseAssignment,
  existingSubmissions?: StudentSubmissionItem[]
): Promise<string | null> {
  logInfo(`=== STAGE 4: FINAL DELIVERY (DEADLINE DAY) ===`);

  const assignment = existingAssignment || (await ClassroomService.getTargetAssignment());
  if (!assignment) {
    logError('Cannot run Final Delivery: Assignment not found.');
    return null;
  }

  const submissions = existingSubmissions || (await ClassroomService.getSubmissions(assignment.id));
  const submittedTeachers = submissions.filter((s) => s.hasSubmitted);

  // 1. Generate final master sheet
  const aggregatedData = await Aggregator.aggregateAll(assignment, submissions, 'Фінальний звіт (Дедлайн)');
  const summaryGrid = Aggregator.buildSummaryGrid(aggregatedData);
  const detailGrid = Aggregator.buildDetailGrid(aggregatedData);

  const sheetTitle = `[ФІНАЛЬНИЙ] Зведений звіт кафедри - ${assignment.title}`;
  const { spreadsheetId, webViewLink } = await SheetsService.createOrUpdateMasterSheet(sheetTitle, summaryGrid, detailGrid);

  // 2. Collect .jpeg attachments
  logInfo('Collecting all .jpeg attachments from teacher submissions...');
  const jpegFiles: DownloadedAsset[] = await DriveService.collectJpegAttachments(submittedTeachers);

  // 3. Deliver email and notifications
  await NotifyService.sendFinalDeliveryReport(
    webViewLink,
    jpegFiles,
    submittedTeachers.length,
    submissions.length,
    aggregatedData.aiSummary
  );

  logInfo(`Final delivery completed successfully!`);
  return webViewLink;
}

/**
 * Automated Daily Workflow:
 * Evaluates current date vs assignment deadline and executes appropriate stage
 */
export async function runAutoDailyWorkflow(): Promise<void> {
  logInfo('🚀 Starting Automated Daily Workflow...');
  const result = await runMonitoringPhase();
  if (!result) return;

  const { assignment, submissions } = result;

  if (assignment.daysRemaining === null) {
    logInfo('No deadline specified for this assignment. Defaulting to general data aggregation.');
    await runDraftPhase(assignment, submissions);
    return;
  }

  const days = assignment.daysRemaining;
  logInfo(`Evaluated timeline: ${days} days remaining until deadline.`);

  if (days <= 0) {
    logInfo(`Deadline reached (${days} days remaining). Executing Final Delivery.`);
    await runFinalPhase(assignment, submissions);
  } else if (days === 1) {
    logInfo(`T-minus 1 day remaining. Executing Reconciliation phase.`);
    await runReconcilePhase(assignment, submissions);
  } else if (days <= 3) {
    logInfo(`T-minus ${days} days remaining. Executing Draft & Warn phase.`);
    await runDraftPhase(assignment, submissions);
  } else {
    logInfo(`More than 3 days remaining (${days} days). Monitoring complete. No alerts needed today.`);
  }
}

/**
 * CLI Help Display
 */
function printHelp(): void {
  console.log(`
Academic Department Automation System
Usage:
  npx tsx src/index.ts [options]
  node dist/index.js [options]

Options:
  --serve         Start Fastify HTTP server with interactive web UI (public/index.html)
  --monitor       Poll Google Classroom, print assignment metadata & current submission stats
  --draft         Force execution of T-minus 3 Days workflow (Draft Sheet + Warn Missing Teachers + Telegram)
  --reconcile     Force execution of T-minus 1 Day workflow (Reconcile submissions & recalculate sums)
  --final         Force execution of Final Delivery (Final Sheet + JPEGs + Email to Sci Dept & Head)
  --dry-run, -d   Simulate workflows without sending real emails or Telegram messages
  --healthcheck   Run diagnostic health checks on Google APIs & Telegram bot connectivity
  --auto          (Default) Automatically detect timeline relative to deadline and run corresponding phase
  --auth-init     Initiate interactive Google OAuth2 consent and generate token.json
  --account ID    Select a hosted account UUID when DATABASE_URL is configured
  --help, -h      Display this help message
  `);
}

/**
 * Main Entry Point
 */
async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const isDryRun = rawArgs.includes('--dry-run') || rawArgs.includes('-d');
  if (isDryRun) {
    NotifyService.dryRun = true;
    console.log('🧪 [DRY-RUN MODE ACTIVATED] All outbound emails and Telegram alerts are simulated.\n');
  }

  // Filter out secondary modifier flags
  const args = rawArgs.filter((a) => a !== '--dry-run' && a !== '-d');

  try {
    if (args.includes('--serve') || args.includes('-s')) {
      const port = parseInt(process.env.PORT || '3000', 10);
      const server = await createServer();
      server.listen({ port, host: '0.0.0.0' }, (err, address) => {
        if (err) {
          logError('Failed to start server:', err);
          process.exit(1);
        }
        console.log(`\n============================================================`);
        console.log(`🚀 Сервер АІ-Секретаря запущено: ${address}`);
        console.log(`🌐 Веб-панель керування: http://localhost:${port}`);
        console.log(`============================================================\n`);
      });
      return; // Keep running
    }

    if (args.includes('--healthcheck') || args.includes('--check')) {
      const ok = await HealthService.runDiagnostics();
      process.exit(ok ? 0 : 1);
    } else if (process.env.DATABASE_URL) {
      const accountIndex = args.indexOf('--account');
      const userId = accountIndex >= 0 ? args[accountIndex + 1] : undefined;
      if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Use --account USER_UUID for hosted CLI workflows.');
      const phases: Phase[] = ['monitor', 'draft', 'reconcile', 'final', 'auto'];
      const phase = phases.find(value => args.includes(`--${value}`)) || 'auto';
      await executeWorkflow(userId, phase, isDryRun);
      await closeDatabase();
    } else if (args.includes('--auth-init')) {
      await runAuthInit();
    } else if (args.includes('--monitor')) {
      await runMonitoringPhase();
    } else if (args.includes('--draft')) {
      await runDraftPhase();
    } else if (args.includes('--reconcile')) {
      await runReconcilePhase();
    } else if (args.includes('--final')) {
      await runFinalPhase();
    } else if (args.includes('--auto') || args.length === 0) {
      await runAutoDailyWorkflow();
    } else {
      console.error(`Unknown argument(s): ${args.join(' ')}`);
      printHelp();
      process.exit(1);
    }

    logInfo('Program executed successfully with code 0.');
    process.exit(0);
  } catch (error) {
    logError('Fatal error during execution:', error);
    process.exit(1);
  }
}

// Run CLI only when executed directly
if (require.main === module) {
  main();
}
