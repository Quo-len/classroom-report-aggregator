import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Aggregator } from '../src/core/aggregator';
import { DocParserService } from '../src/services/doc-parser.service';
import { DriveService } from '../src/services/drive.service';
import { SheetsService } from '../src/services/sheets.service';
import { phaseFor, classroomDeadline, calendarDaysRemaining } from '../src/core/deadline';
import { mapToOfficialKey, SHEETS_SUFFIX } from '../src/core/metric-mapping';
import { OFFICIAL_TEMPLATE_ROWS } from '../src/config/official-template';
import { NotifyService, escapeHtml } from '../src/services/notify.service';
import { ClassroomService } from '../src/services/classroom.service';
import { AIService } from '../src/services/ai.service';
import { accountContext } from '../src/core/account-context';
import { OAuth2Client } from 'google-auth-library';
import { withLocalRun, localRun } from '../src/core/local-state';
import { deliverOnce } from '../src/services/delivery.service';
import os from 'node:os';

Object.assign(process.env, { TELEGRAM_BOT_TOKEN: 'test', HEAD_OF_DEPT_CHAT_ID: '1', HEAD_OF_DEPT_EMAIL: 'head@example.com', SCI_DEPT_EMAIL: 'science@example.com', GROQ_API_KEY: '' });

function docx(body: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(`<w:document><w:body>${body}</w:body></w:document>`));
  return zip.toBuffer();
}
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;

async function main() {
  const folder = path.resolve('test/docs/02_Професор_Петренко_В_М');
  const filename = fs.readdirSync(folder).find(name => name.endsWith('.xlsx'))!;
  const workbook = new AdmZip(fs.readFileSync(path.join(folder, filename)));
  // The checked-in "filled" fixture is a blank copy; populate known cells without changing it.
  const xml = workbook.readAsText('xl/worksheets/sheet1.xml')
    .replace(/<c r="C24"[^>]*>[\s\S]*?<\/c>/, '<c r="C24" t="inlineStr"><is><t>3 / 12,5</t></is></c>');
  workbook.updateFile('xl/worksheets/sheet1.xml', Buffer.from(xml));
  const buffer = workbook.toBuffer();
  const originalMeta = DriveService.getFileMetadata;
  const originalDownload = DriveService.downloadFileBuffer;
  const originalRead = SheetsService.readSheetRows;
  DriveService.getFileMetadata = async () => ({ id: 'xlsx', name: filename, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  DriveService.downloadFileBuffer = async () => buffer;
  SheetsService.readSheetRows = async () => { throw new Error('Native Excel must not use Sheets API'); };
  try {
    const report = await Aggregator.parseTeacherSubmission({ submissionId: 's', userId: 'u', studentName: 'Петренко В. М.', studentEmail: '', state: 'TURNED_IN', hasSubmitted: true, attachments: [{ id: 'xlsx', title: filename }] });
    assert.ok(report.metrics.size > 0);
    const keys = new Set(OFFICIAL_TEMPLATE_ROWS.map(row => row.indicatorKey));
    assert.ok([...report.metrics.keys()].every(key => keys.has(key.replace(SHEETS_SUFFIX, ''))));
    assert.ok([...report.metrics.values()].some(value => value > 0));
    const key = mapToOfficialKey('монографії')!;
    assert.equal(report.metrics.get(key), 3);
    assert.equal(report.metrics.get(key + SHEETS_SUFFIX), 12.5);
    const data: any = { assignment: { creationDate: new Date('2028-01-01'), courseName: 'Інформатики' }, teachers: [report], totalsByIndicator: report.metrics, staticPlanRows: [], staticSciPlanRows: [] };
    assert.equal(Aggregator.buildSummaryGrid(data)[23][2], '3 / 12.5');
    assert.match(Aggregator.buildSummaryGrid(data)[2][1], /2028/);
    assert.match(Aggregator.buildSummaryGrid(data)[3][1], /Інформатики/);
    report.metrics.set('Невідомий показник', 7);
    assert.ok(Aggregator.buildDetailGrid(data).some(row => row[1] === 'Невідомий показник' && row[2] === 7));
    assert.ok(!Aggregator.buildDetailGrid(data).some(row => String(row[0]).includes('ЗАГАЛЬНА СУМА')));
  } finally {
    DriveService.getFileMetadata = originalMeta;
    DriveService.downloadFileBuffer = originalDownload;
    SheetsService.readSheetRows = originalRead;
  }
  const monograph = fs.readdirSync(folder).find(name => name.includes('Монографії'))!;
  const metrics = DocParserService.extractMetricsFromDocx(fs.readFileSync(path.join(folder, monograph)), monograph);
  assert.ok([...metrics.keys()].some(key => key.includes('монографії')));
  assert.ok(![...metrics.keys()].some(key => key.startsWith('Розділ 1.')));
  assert.ok(mapToOfficialKey('монографії')?.startsWith('Розділ 3.'));
  assert.equal(mapToOfficialKey('вказати кількість'), undefined);
  assert.ok(mapToOfficialKey('вказати кількість', 10)?.startsWith('Розділ 10.'));
  const deadline = new Date('2026-11-26T21:59:00Z');
  assert.notEqual(phaseFor(deadline, new Date('2026-11-26T08:00:00Z')), 'final');
  assert.equal(phaseFor(deadline, deadline), 'final');
  assert.equal(phaseFor(null), 'monitor');
  assert.equal(classroomDeadline({ dueDate: { year: 2026, month: 11, day: 26 } })?.toISOString(), '2026-11-26T21:59:59.000Z');
  assert.equal(classroomDeadline({ dueDate: { year: 2026, month: 7, day: 26 } })?.toISOString(), '2026-07-26T20:59:59.000Z');
  assert.equal(classroomDeadline({ dueDate: { year: 2026, month: 11, day: 26 }, dueTime: { hours: 10 } })?.toISOString(), '2026-11-26T10:00:00.000Z');
  assert.equal(calendarDaysRemaining(classroomDeadline({ dueDate: { year: 2026, month: 11, day: 26 } })!, new Date('2026-11-23T10:00:00Z')), 3);
  for (const [input, expected] of [['2 шт.', 2], ['5 статей', 5], ['-3', 0], [Infinity, 0], ['2 інформація відсутня', 0], ['iнфoрмaцiя вiдсутня 5', 0]] as const) assert.equal(DocParserService.parseNumber(input), expected);
  assert.equal(Aggregator.metricsFromText('Науково-дослідні роботи: 2').get('Науково-дослідні роботи'), 2);
  assert.equal(Aggregator.metricsFromText('Розділ 10\nвказати кількість: 2').get(mapToOfficialKey('вказати кількість', 10)!), 2);
  assert.equal(DocParserService.decodeXml('R&amp;D &lt;x&gt; &quot;q&quot; &apos;a&apos; &#65; &#x42;'), 'R&D <x> "q" \'a\' A B');
  const patents = docx(`<w:tbl><w:tr>${cell('№')}${cell('Назва')}</w:tr><w:tr>${cell('1')}${cell('Науково-технічний патент 2026-05-01')}</w:tr><w:tr>${cell('2')}${cell('-')}</w:tr></w:tbl>`);
  assert.equal(DocParserService.extractMetricsFromDocx(patents, 'Додаток_10.docx').get(mapToOfficialKey('вказати кількість', 10)!), 1);
  const nested = DocParserService.parseDocxBuffer(docx(`<w:tbl><w:tr><w:tc>${paragraph('R&amp;D')}<w:tbl><w:tr>${cell('вкладений')}</w:tr></w:tbl></w:tc></w:tr></w:tbl>`));
  assert.equal(nested.tables.length, 2);
  assert.ok(nested.fullText.includes('R&D'));
  const reordered = new AdmZip();
  reordered.addFile('xl/workbook.xml', Buffer.from('<workbook><sheets><sheet r:id="rId2"/></sheets></workbook>'));
  reordered.addFile('xl/_rels/workbook.xml.rels', Buffer.from('<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'));
  reordered.addFile('xl/worksheets/sheet2.xml', Buffer.from('<worksheet><sheetData><row r="4"><c r="A4"/><c r="B4" t="inlineStr"><is><t>R&amp;D</t></is></c><c r="C4"><v>7</v></c></row></sheetData></worksheet>'));
  assert.deepEqual(DocParserService.parseXlsxBuffer(reordered.toBuffer())[3], ['', 'R&D', '7']);
  const oversized = new AdmZip();
  oversized.addFile('word/document.xml', Buffer.alloc(11 * 1024 * 1024, 32));
  assert.equal(DocParserService.parseDocxBuffer(oversized.toBuffer()).fullText, '');

  const originalList = DriveService.listFilesInFolder;
  const aiExtract = AIService.extractMetricsFromText;
  try {
    const zip = new AdmZip();
    zip.addFile('звіт.txt', Buffer.from('монографії: 2'));
    zip.addFile('nested.zip', Buffer.from('not allowed'));
    DriveService.getFileMetadata = async id => ({ id, name: 'Іваненко_звіт.zip', mimeType: 'application/zip' });
    DriveService.downloadFileBuffer = async () => zip.toBuffer();
    const submission = { submissionId: 's', userId: 'u', studentName: 'Іваненко Олег', studentEmail: '', hasSubmitted: true, state: 'TURNED_IN', attachments: [{ id: 'zip' }] };
    const result = await Aggregator.parseTeacherSubmission(submission);
    assert.equal(result.studentName, 'Іваненко Олег');
    assert.equal(result.metrics.get(mapToOfficialKey('монографії')!), 2);
    assert.ok(result.warnings?.some(warning => warning.includes('nested.zip')));
    DriveService.listFilesInFolder = async () => [{ id: 'zip', name: 'Іваненко_звіт.zip', mimeType: 'application/zip' }];
    const teachers = [{ ...result, hasSubmitted: false, metrics: new Map<string, number>() }];
    await Aggregator.parseDriveFolderAddons('folder', teachers);
    assert.equal(teachers[0].hasSubmitted, false);
    assert.equal(teachers[0].hasAddonFiles, true);
    DriveService.listFilesInFolder = async () => [{ id: 'zip', name: 'Олег_звіт.zip', mimeType: 'application/zip' }];
    await Aggregator.parseDriveFolderAddons('folder', teachers);
    assert.equal(teachers.length, 2, 'A first name must not identify an add-on owner');
    let aiCalls = 0;
    AIService.extractMetricsFromText = async () => { aiCalls++; return new Map([[mapToOfficialKey('монографії')!, 4]]); };
    DriveService.getFileMetadata = async id => ({ id, name: 'звіт.txt', mimeType: 'text/plain' });
    DriveService.downloadFileBuffer = async () => Buffer.from('Довільний текст наукового звіту викладача.');
    const narrative = await Aggregator.parseTeacherSubmission(submission);
    assert.equal(aiCalls, 1);
    assert.equal(narrative.metrics.get(mapToOfficialKey('монографії')!), 4);
    DriveService.downloadFileBuffer = async () => null;
    assert.ok((await Aggregator.parseTeacherSubmission(submission)).warnings?.length);
  } finally {
    DriveService.getFileMetadata = originalMeta;
    DriveService.downloadFileBuffer = originalDownload;
    DriveService.listFilesInFolder = originalList;
    AIService.extractMetricsFromText = aiExtract;
  }

  const ai = AIService as any;
  const originalCall = ai.callGroqChat;
  const originalAvailable = ai.isAvailable;
  ai.isAvailable = () => true;
  ai.callGroqChat = async () => JSON.stringify({ [mapToOfficialKey('монографії')!]: 3, invented: 100, [mapToOfficialKey('підручники')!]: -2 });
  try {
    const result = await AIService.extractMetricsFromText('Достатньо довгий текст наукового звіту');
    assert.deepEqual([...result], [[mapToOfficialKey('монографії')!, 3]]);
  } finally { ai.callGroqChat = originalCall; ai.isAvailable = originalAvailable; }

  const classroom = ClassroomService as any;
  const originalClassroomClient = classroom.getClient;
  const pages: any[] = [];
  classroom.getClient = async () => ({ courses: { courseWork: { list: async (request: any) => {
    pages.push(request.pageToken);
    return { data: request.pageToken ? { courseWork: [{ id: 'new', title: 'ЗВІТ за 2030 рік', creationTime: '2026-01-01', dueDate: { year: 2030, month: 1, day: 1 } }] } : { courseWork: [{ id: 'old', title: 'Звіт', creationTime: '2025-01-01' }], nextPageToken: 'next' } };
  } }, students: { list: async () => { throw new Error('Roster unavailable'); } } } });
  const context = { userId: 'test', auth: new OAuth2Client(), dryRun: false, settings: { CLASSROOM_COURSE_ID: 'course', ASSIGNMENT_NAME: 'Звіт' } };
  const oldFolder = process.env.ASSIGNMENT_ADDONS_FOLDER_ID;
  process.env.ASSIGNMENT_ADDONS_FOLDER_ID = 'global-folder';
  try {
    await accountContext.run(context, async () => {
      const assignment = await ClassroomService.getTargetAssignment();
      assert.equal(assignment?.id, 'new');
      assert.equal(assignment?.driveFolderId, undefined);
      assert.deepEqual(pages, [undefined, 'next']);
      await assert.rejects(ClassroomService.getCourseStudents(), /Roster unavailable/);
    });
  } finally {
    classroom.getClient = originalClassroomClient;
    if (oldFolder === undefined) delete process.env.ASSIGNMENT_ADDONS_FOLDER_ID; else process.env.ASSIGNMENT_ADDONS_FOLDER_ID = oldFolder;
  }

  assert.equal(escapeHtml('<x>&"'), '&lt;x&gt;&amp;&quot;');
  const originalEmail = NotifyService.sendEmail, originalTelegram = NotifyService.sendTelegramMessage;
  const emails: any[] = [], telegram: string[] = [];
  NotifyService.sendEmail = async options => { emails.push(options); return true; };
  NotifyService.sendTelegramMessage = async text => { telegram.push(text); return true; };
  try {
    await NotifyService.sendMissingTeachersReminder([{ name: '<script>&', email: 'test@example.com' }], deadline);
    await NotifyService.notifyHeadOfDeptMissingList([{ name: '<script>&', email: 'test@example.com' }], 'https://docs.google.com/test', '<summary>');
    await NotifyService.sendFinalDeliveryReport('https://docs.google.com/test', [{ filename: 'large.jpeg', mimeType: 'image/jpeg', data: Buffer.alloc(0), driveFileId: 'photo', webViewLink: 'https://drive.google.com/folder' }], 1, 1, '<summary>');
    assert.ok(emails.every(email => !email.bodyHtml.includes('<script>') && !email.bodyHtml.includes('<summary>')));
    assert.ok(telegram.every(text => !text.includes('<script>') && !text.includes('<summary>')));
    assert.ok(!emails[0].bodyHtml.includes('48 годин'));
    assert.ok(emails[0].bodyHtml.includes('26.11.2026'));
    assert.equal(emails[2].attachments.length, 0);
    assert.match(emails[2].bodyHtml, /https:\/\/drive.google.com\/folder/);
  } finally { NotifyService.sendEmail = originalEmail; NotifyService.sendTelegramMessage = originalTelegram; }

  const drive = DriveService as any;
  const originalDriveClient = drive.getClient;
  let downloads = 0, copies = 0;
  drive.getClient = async () => ({ files: {
    create: async () => ({ data: { id: 'evidence-folder' } }),
    copy: async (request: any) => { copies++; assert.deepEqual(request.requestBody.parents, ['evidence-folder']); return { data: { id: 'copied' } }; },
  } });
  DriveService.getFileMetadata = async id => ({ id, name: `${id}.jpeg`, mimeType: 'image/jpeg', size: Number(id) * 1024 * 1024 });
  DriveService.downloadFileBuffer = async id => { downloads++; return Buffer.alloc(Number(id) * 1024 * 1024); };
  try {
    const assets = await DriveService.collectJpegAttachments([{ studentName: 'Викладач', attachments: [{ id: '4' }, { id: '5' }, { id: '3' }, { id: '2' }, { id: '8' }] }]);
    assert.equal(downloads, 3);
    assert.equal(copies, 2);
    assert.equal(assets.reduce((sum, asset) => sum + asset.data.length, 0), 12 * 1024 * 1024);
    assert.equal(assets.filter(asset => asset.webViewLink).length, 2);
  } finally {
    drive.getClient = originalDriveClient; DriveService.getFileMetadata = originalMeta; DriveService.downloadFileBuffer = originalDownload;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-review-'));
  try {
    const filename = path.join(temporary, 'state.json');
    let sends = 0, runs = 0;
    const action = async () => { runs++; localRun.getStore()!.state.spreadsheetId = 'reused'; await deliverOnce('reminder', async () => { sends++; }); return 'ok'; };
    await withLocalRun('course', 'assignment', 'draft', action, filename);
    await withLocalRun('course', 'assignment', 'draft', action, filename);
    await withLocalRun('course', 'assignment', 'final', async () => { assert.equal(localRun.getStore()!.state.spreadsheetId, 'reused'); return 'ok'; }, filename);
    assert.equal(runs, 1); assert.equal(sends, 1);
    const notify = NotifyService as any;
    const originalBot = notify.getTelegramBot;
    let telegramSends = 0;
    notify.getTelegramBot = () => ({ telegram: { sendMessage: async () => { telegramSends++; } } });
    try {
      await withLocalRun('course', 'telegram', 'draft', async () => {
        await NotifyService.sendTelegramMessage('first', '1');
        await NotifyService.sendTelegramMessage('first', '1');
        await NotifyService.sendTelegramMessage('second', '1');
      }, filename);
      assert.equal(telegramSends, 2);
    } finally { notify.getTelegramBot = originalBot; }
    await assert.rejects(withLocalRun('course', 'other', 'final', async () => { await deliverOnce('uncertain', async () => { throw new Error('network'); }); }, filename));
    await assert.rejects(withLocalRun('course', 'other', 'final', action, filename), /потребує перевірки/);
  } finally { fs.rmSync(temporary, { recursive: true }); }
  const writes: any[] = [];
  const updates: any[] = [];
  const service = SheetsService as any;
  const originalClient = service.getClient;
  const originalMove = DriveService.moveFileToMasterFolder;
  service.getClient = async () => ({ spreadsheets: {
    create: async () => ({ data: { spreadsheetId: 'report' } }),
    get: async () => ({ data: { sheets: [{ properties: { sheetId: 0, title: 'Підсумковий звіт' } }, { properties: { sheetId: 1, title: 'Деталізація по викладачах' } }] } }),
    batchUpdate: async (request: any) => { updates.push(...request.requestBody.requests); return {}; },
    values: { clear: async () => {}, update: async (request: any) => { writes.push(request); } },
  } });
  DriveService.moveFileToMasterFolder = async () => {};
  try {
    await SheetsService.createOrUpdateMasterSheet('Звіт', [['=1+1', 2]], [['=IMPORTXML("x","y")']]);
    assert.equal(writes.length, 2);
    assert.ok(writes.every(request => request.valueInputOption === 'RAW'));
    assert.equal(writes[0].requestBody.values[0][0], '=1+1');
    await SheetsService.createOrUpdateMasterSheet('Фінальний', [['value']], [['teacher']], 'report');
    assert.ok(updates.some(request => request.updateSpreadsheetProperties?.properties.title === 'Фінальний'));
  } finally {
    service.getClient = originalClient;
    DriveService.moveFileToMasterFolder = originalMove;
  }
  console.log('Review regression tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
