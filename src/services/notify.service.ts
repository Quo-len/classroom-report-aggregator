import { deliverOnce } from './delivery.service';
import { accountContext } from '../core/account-context';
import { google, gmail_v1 } from 'googleapis';
import { Telegraf } from 'telegraf';
import { AuthService } from './auth.service';
import { DownloadedAsset } from './drive.service';
import { env } from '../config/env';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  bodyHtml: string;
  attachments?: DownloadedAsset[];
}

export class NotifyService {
  private static cliDryRun = false;
  public static get dryRun(): boolean {
    return accountContext.getStore()?.dryRun ?? this.cliDryRun;
  }
  public static set dryRun(value: boolean) {
    const account = accountContext.getStore();
    if (account) account.dryRun = value;
    else this.cliDryRun = value;
  }

  private static async getGmail(): Promise<gmail_v1.Gmail> {
    const auth = await AuthService.getAuthClient();
    return google.gmail({ version: 'v1', auth });
  }

  private static getTelegramBot(): Telegraf {
    return new Telegraf(env.TELEGRAM_BOT_TOKEN);
  }

  /**
   * Helper to encode strings for MIME headers (RFC 2047)
   */
  private static encodeMimeHeader(text: string): string {
    return `=?UTF-8?B?${Buffer.from(text, 'utf-8').toString('base64')}?=`;
  }

  /**
   * Builds an RFC 2822 MIME message with optional binary attachments
   */
  private static buildMimeMessage(options: EmailOptions): string {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const recipients = Array.isArray(options.to) ? options.to.join(', ') : options.to;

    let messageParts: string[] = [
      `To: ${recipients}`,
      `Subject: ${this.encodeMimeHeader(options.subject)}`,
      'MIME-Version: 1.0',
    ];

    if (!options.attachments || options.attachments.length === 0) {
      // Simple HTML message
      messageParts.push('Content-Type: text/html; charset=UTF-8');
      messageParts.push('Content-Transfer-Encoding: base64');
      messageParts.push('');
      messageParts.push(Buffer.from(options.bodyHtml, 'utf-8').toString('base64'));
    } else {
      // Multipart message with attachments
      messageParts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      messageParts.push('');
      messageParts.push(`--${boundary}`);
      messageParts.push('Content-Type: text/html; charset=UTF-8');
      messageParts.push('Content-Transfer-Encoding: base64');
      messageParts.push('');
      messageParts.push(Buffer.from(options.bodyHtml, 'utf-8').toString('base64'));

      for (const att of options.attachments) {
        messageParts.push(`--${boundary}`);
        messageParts.push(`Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${this.encodeMimeHeader(att.filename)}"`);
        messageParts.push('Content-Transfer-Encoding: base64');
        messageParts.push(`Content-Disposition: attachment; filename="${this.encodeMimeHeader(att.filename)}"`);
        messageParts.push('');
        messageParts.push(att.data.toString('base64'));
      }

      messageParts.push(`--${boundary}--`);
    }

    const fullMessage = messageParts.join('\r\n');
    return Buffer.from(fullMessage, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Sends an email via Google Gmail API
   */
  public static async sendEmail(options: EmailOptions): Promise<boolean> {
    const recipients = Array.isArray(options.to) ? options.to.join(', ') : options.to;

    if (this.dryRun) {
      console.log(`🧪 [DRY-RUN] Simulating email delivery to: [${recipients}]`);
      console.log(`   Subject: "${options.subject}"`);
      console.log(`   Attachments: ${options.attachments?.length || 0} files`);
      return true;
    }

    try {
      const gmail = await this.getGmail();
      const raw = this.buildMimeMessage(options);

      console.log(`📧 Sending email via Gmail to: [${recipients}], Subject: "${options.subject}"...`);

      await deliverOnce(`email:${recipients}:${options.subject}`, () => gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw,
        },
      }));

      console.log(`✅ Email successfully sent to [${recipients}]`);
      return true;
    } catch (error) {
      if (accountContext.getStore()) throw error;
      console.error(`❌ Failed to send email to [${options.to}]:`, error);
      return false;
    }
  }

  /**
   * Sends a message via Telegram to the specified or default chat ID
   */
  public static async sendTelegramMessage(text: string, chatId: string = env.HEAD_OF_DEPT_CHAT_ID): Promise<boolean> {
    if (accountContext.getStore() && !chatId) return true;
    if (this.dryRun) {
      console.log(`🧪 [DRY-RUN] Simulating Telegram notification to chat [${chatId}]`);
      const preview = text.replace(/<[^>]*>/g, '').trim().split('\n')[0] || '';
      console.log(`   Preview: "${preview}"`);
      return true;
    }

    try {
      console.log(`📱 Sending Telegram notification to chat [${chatId}]...`);
      const bot = this.getTelegramBot();
      await deliverOnce(`telegram:${chatId}`, () => bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' }));
      console.log(`✅ Telegram message sent successfully to [${chatId}]`);
      return true;
    } catch (error) {
      if (accountContext.getStore()) throw error;
      console.error(`❌ Error sending Telegram notification to [${chatId}]:`, error);
      return false;
    }
  }

  /**
   * Workflow Notification: T-minus 3 Days Reminder to Missing Teachers
   */
  public static async sendMissingTeachersReminder(teachers: { name: string; email: string }[]): Promise<void> {
    if (teachers.length === 0) {
      console.log('🎉 No missing teachers! All reports have been submitted.');
      return;
    }

    console.log(`📢 Sending reminder email to ${teachers.length} teachers with pending submissions...`);

    for (const teacher of teachers) {
      if (!teacher.email) {
        console.warn(`⚠️ Teacher "${teacher.name}" has no email registered in Google Classroom. Skipping email.`);
        continue;
      }

      const bodyHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #c0392b;">Шановний(а) ${teacher.name}!</h2>
          <p>Нагадуємо, що в Google Classroom опубліковано завдання: <strong>«${env.ASSIGNMENT_NAME}»</strong>.</p>
          <p style="background-color: #fff3cd; padding: 12px; border-left: 5px solid #ffc107; font-size: 15px;">
            ⚠️ <strong>Увага:</strong> До кінцевого терміну здачі звіту залишилося <strong>менше 48 годин</strong>!
          </p>
          <p>Будь ласка, завантажте ваш звіт про науково-дослідну роботу якомога швидше для своєчасного формування кафедрального зведеного звіту.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #7f8c8d;">З повагою,<br/>Автоматизована система кафедри</p>
        </div>
      `;

      await this.sendEmail({
        to: teacher.email,
        subject: `[Терміново: 48 годин] Нагадування про здачу звіту: ${env.ASSIGNMENT_NAME}`,
        bodyHtml,
      });
    }
  }

  /**
   * Workflow Notification: T-minus 3 Days Alert to Head of Department
   */
  public static async notifyHeadOfDeptMissingList(
    missingTeachers: { name: string; email: string }[],
    preliminarySheetUrl: string,
    aiSummary?: string
  ): Promise<void> {
    const namesList = missingTeachers.length > 0
      ? missingTeachers.map((t, idx) => `${idx + 1}. ${t.name} (${t.email || 'без email'})`).join('\n')
      : 'Усі викладачі вчасно подали звіти!';

    const summarySection = aiSummary
      ? `\n\n<b>Резюме кафедри:</b>\n<i>${aiSummary}</i>`
      : '';

    // Telegram message
    const tgMessage = `
<b>📋 [Т-3 Дні] Попередній стан подання звітів</b>

<b>Завдання:</b> ${env.ASSIGNMENT_NAME}
<b>Попередній звіт:</b> <a href="${preliminarySheetUrl}">Переглянути Google Sheet</a>

<b>⚠️ Не подали звіт (${missingTeachers.length} викладачів):</b>
${namesList}
${summarySection}

<i>Викладачам надіслано автоматичне попередження (залишилось 48 годин).</i>
    `.trim();

    await this.sendTelegramMessage(tgMessage);

    // Email to Head of Department
    const htmlEmail = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #2c3e50;">Попередній звіт про стан подання наукових звітів (Т-3 дні)</h2>
        <p>Завдання: <strong>«${env.ASSIGNMENT_NAME}»</strong></p>
        ${aiSummary ? `<div style="background-color: #e8f4f8; padding: 12px; border-left: 4px solid #2980b9; margin: 15px 0;"><strong>Аналітичне резюме:</strong><br/>${aiSummary}</div>` : ''}
        <p>Сформовано попередній зведений Google Sheet на основі наявних на цей момент матеріалів:</p>
        <p><a href="${preliminarySheetUrl}" style="background-color: #2980b9; color: white; padding: 10px 18px; text-decoration: none; border-radius: 4px; display: inline-block;">Відкрити попередній зведений звіт</a></p>
        <h3 style="color: #c0392b;">Список викладачів, які ще не подали звіт (${missingTeachers.length} осіб):</h3>
        <ol>
          ${missingTeachers.map((t) => `<li><strong>${t.name}</strong> (${t.email || 'email відсутній'})</li>`).join('')}
        </ol>
        <p>Усім зазначеним викладачам щойно надіслано попередження про дедлайн (48 годин).</p>
      </div>
    `;

    await this.sendEmail({
      to: env.HEAD_OF_DEPT_EMAIL,
      subject: `[Звітність кафедри] Т-3 дні: стан подання звітів («${env.ASSIGNMENT_NAME}»)`,
      bodyHtml: htmlEmail,
    });
  }

  /**
   * Workflow Notification: Final Delivery on Deadline Day
   */
  public static async sendFinalDeliveryReport(
    finalSheetUrl: string,
    jpegAttachments: DownloadedAsset[],
    totalSubmitted: number,
    totalEnrolled: number,
    aiSummary?: string
  ): Promise<void> {
    const recipients = [env.SCI_DEPT_EMAIL, env.HEAD_OF_DEPT_EMAIL];

    const bodyHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #27ae60;">🎓 Фінальний зведений звіт про науково-дослідну роботу кафедри</h2>
        <p>Термін здачі звітів вичерпано. Звіт сформовано та агреговано автоматичною системою кафедри.</p>
        ${aiSummary ? `<div style="background-color: #eafaf1; padding: 12px; border-left: 4px solid #27ae60; margin: 15px 0;"><strong>Підсумкове резюме:</strong><br/>${aiSummary}</div>` : ''}
        <ul>
          <li><strong>Назва завдання:</strong> «${env.ASSIGNMENT_NAME}»</li>
          <li><strong>Подано звітів:</strong> ${totalSubmitted} з ${totalEnrolled} викладачів</li>
          <li><strong>Додано фотоматеріалів (.jpeg):</strong> ${jpegAttachments.length} шт.</li>
        </ul>
        <p>
          <a href="${finalSheetUrl}" style="background-color: #27ae60; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            📊 Відкрити підсумковий зведений Google Sheet
          </a>
        </p>
        <p>Усі додані викладачами фотоматеріали у форматі JPEG прикріплено до цього листа як вкладення.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #7f8c8d;">Лист згенеровано автоматично системою кафедри.</p>
      </div>
    `;

    await this.sendEmail({
      to: recipients,
      subject: `[ФІНАЛЬНИЙ ЗВІТ] Зведена інформація про науково-дослідну роботу кафедри`,
      bodyHtml,
      attachments: jpegAttachments,
    });

    const summarySection = aiSummary
      ? `\n\n<b>Підсумкове резюме:</b>\n<i>${aiSummary}</i>`
      : '';

    // Notify Head of Dept on Telegram
    const tgMessage = `
<b>🚀 Фінальний кафедральний звіт успішно надіслано!</b>

<b>Завдання:</b> ${env.ASSIGNMENT_NAME}
<b>Подано звітів:</b> ${totalSubmitted} / ${totalEnrolled}
<b>Додано JPEG фотозвітів:</b> ${jpegAttachments.length}
<b>Отримувачі:</b> Науковий відділ (${env.SCI_DEPT_EMAIL}) та Завідувач кафедри
${summarySection}

<b>Посилання на підсумковий Google Sheet:</b>
<a href="${finalSheetUrl}">Переглянути фінальний документ</a>
    `.trim();

    await this.sendTelegramMessage(tgMessage);
  }
}
