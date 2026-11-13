import fs from 'fs';
import { google } from 'googleapis';
import { Telegraf } from 'telegraf';
import { AuthService } from './auth.service';
import { env } from '../config/env';

export interface CheckItem {
  name: string;
  passed: boolean;
  message: string;
  warning?: boolean;
}

export class HealthService {
  /**
   * Runs diagnostic health checks on all integrations
   */
  public static async runDiagnostics(): Promise<boolean> {
    console.log('\n================== SYSTEM HEALTH DIAGNOSTICS ==================');
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    const checks: CheckItem[] = [];

    // 1. Check credentials and token files
    checks.push(this.checkFileExistence('Google Credentials file', env.credentialsPath));
    checks.push(this.checkFileExistence('Google Token cache file', env.tokenPath, true));

    // 2. Check Google Auth
    let authClient: any = null;
    try {
      authClient = await AuthService.getAuthClient();
      checks.push({
        name: 'Google OAuth2 / Service Account Authentication',
        passed: true,
        message: 'Successfully initialized authenticated Google client.',
      });
    } catch (err: any) {
      checks.push({
        name: 'Google OAuth2 / Service Account Authentication',
        passed: false,
        message: err.message || 'Failed to authenticate.',
      });
    }

    // If auth succeeded, check Google APIs
    if (authClient) {
      // 3. Google Classroom Course check
      try {
        const classroom = google.classroom({ version: 'v1', auth: authClient });
        const courseRes = await classroom.courses.get({ id: env.CLASSROOM_COURSE_ID });
        checks.push({
          name: `Classroom Course [${env.CLASSROOM_COURSE_ID}]`,
          passed: true,
          message: `Connected! Course title: "${courseRes.data.name || 'Unnamed'}"`,
        });

        // Check target assignment
        const workList = await classroom.courses.courseWork.list({
          courseId: env.CLASSROOM_COURSE_ID,
          courseWorkStates: ['PUBLISHED'],
        });
        const found = (workList.data.courseWork || []).some(
          (w) => w.title?.trim().toLowerCase() === env.ASSIGNMENT_NAME.trim().toLowerCase()
        );
        checks.push({
          name: `Classroom Assignment ["${env.ASSIGNMENT_NAME}"]`,
          passed: found,
          warning: !found,
          message: found
            ? 'Assignment found and active in course!'
            : 'Assignment not published yet (expected before teacher uploads).',
        });
      } catch (err: any) {
        checks.push({
          name: `Classroom Course [${env.CLASSROOM_COURSE_ID}]`,
          passed: false,
          message: `Could not access course: ${err.message || err}`,
        });
      }

      // 4. Google Drive Folder check
      try {
        const drive = google.drive({ version: 'v3', auth: authClient });
        const folder = await drive.files.get({
          fileId: env.MASTER_OUTPUT_FOLDER_ID,
          fields: 'id, name, mimeType',
          supportsAllDrives: true,
        });
        checks.push({
          name: `Drive Output Folder [${env.MASTER_OUTPUT_FOLDER_ID}]`,
          passed: true,
          message: `Connected! Folder name: "${folder.data.name}"`,
        });
      } catch (err: any) {
        checks.push({
          name: `Drive Output Folder [${env.MASTER_OUTPUT_FOLDER_ID}]`,
          passed: false,
          message: `Could not access Drive folder: ${err.message || err}`,
        });
      }

      // 5. Google Sheets (Static plans) check
      try {
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const plan1 = await sheets.spreadsheets.get({ spreadsheetId: env.STATIC_PLAN_SHEET_ID });
        checks.push({
          name: `Static Sheet "План роботи" [${env.STATIC_PLAN_SHEET_ID}]`,
          passed: true,
          message: `Accessible! Title: "${plan1.data.properties?.title || 'OK'}"`,
        });
      } catch (err: any) {
        checks.push({
          name: `Static Sheet "План роботи" [${env.STATIC_PLAN_SHEET_ID}]`,
          passed: false,
          warning: true,
          message: `Sheet not found or restricted permissions: ${err.message || err}`,
        });
      }

      try {
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const plan2 = await sheets.spreadsheets.get({ spreadsheetId: env.STATIC_SCI_PLAN_SHEET_ID });
        checks.push({
          name: `Static Sheet "План наукової роботи" [${env.STATIC_SCI_PLAN_SHEET_ID}]`,
          passed: true,
          message: `Accessible! Title: "${plan2.data.properties?.title || 'OK'}"`,
        });
      } catch (err: any) {
        checks.push({
          name: `Static Sheet "План наукової роботи" [${env.STATIC_SCI_PLAN_SHEET_ID}]`,
          passed: false,
          warning: true,
          message: `Sheet not found or restricted permissions: ${err.message || err}`,
        });
      }

      // 6. Gmail API check
      try {
        const gmail = google.gmail({ version: 'v1', auth: authClient });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        checks.push({
          name: `Gmail API Profile`,
          passed: true,
          message: `Authenticated as sender: <${profile.data.emailAddress}>`,
        });
      } catch (err: any) {
        checks.push({
          name: `Gmail API Profile`,
          passed: false,
          message: `Failed to connect to Gmail: ${err.message || err}`,
        });
      }
    }

    // 7. Telegram Bot check
    try {
      const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
      const botInfo = await bot.telegram.getMe();
      checks.push({
        name: `Telegram Bot [@${botInfo.username}]`,
        passed: true,
        message: `Token valid! Bot name: "${botInfo.first_name}"`,
      });
    } catch (err: any) {
      checks.push({
        name: `Telegram Bot Connection`,
        passed: false,
        message: `Invalid token or Telegram network issue: ${err.message || err}`,
      });
    }

    // Print summary
    let allPassed = true;
    for (const c of checks) {
      if (c.passed) {
        console.log(`✅ [PASS] ${c.name}`);
        console.log(`          ${c.message}`);
      } else if (c.warning) {
        console.log(`⚠️  [WARN] ${c.name}`);
        console.log(`          ${c.message}`);
      } else {
        console.log(`❌ [FAIL] ${c.name}`);
        console.log(`          ${c.message}`);
        allPassed = false;
      }
    }

    console.log('\n================================================================');
    if (allPassed) {
      console.log('🎉 All critical diagnostic checks passed! System is ready to run.\n');
    } else {
      console.log('⚠️ Some checks failed. Please review the errors above and update .env or permissions.\n');
    }

    return allPassed;
  }

  private static checkFileExistence(name: string, filePath: string, isWarningOnly = false): CheckItem {
    const exists = fs.existsSync(filePath);
    return {
      name,
      passed: exists,
      warning: isWarningOnly && !exists,
      message: exists
        ? `Found file at: ${filePath}`
        : `File not found at: ${filePath}${isWarningOnly ? ' (will be created after npm run auth:init)' : ''}`,
    };
  }
}
