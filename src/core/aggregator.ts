import AdmZip from 'adm-zip';
import { accountContext } from './account-context';
import { AIService } from '../services/ai.service';
import { mapToOfficialKey, sectionForLabel, normalizeLabel, SHEETS_SUFFIX, completePublicationTotals } from './metric-mapping';
import { SheetsService } from '../services/sheets.service';
import { DriveService } from '../services/drive.service';
import { DocParserService, DigestedTeacherEvidence } from '../services/doc-parser.service';
import { CourseAssignment, StudentSubmissionItem } from '../services/classroom.service';
import { OFFICIAL_INDICATORS, OFFICIAL_TEMPLATE_ROWS } from '../config/official-template';
import { env } from '../config/env';

export interface ParsedMetric {
  indicator: string;
  value: number;
  rawString: string;
}

export interface TeacherReportData {
  studentName: string;
  studentEmail: string;
  hasSubmitted: boolean;
  submissionState: string;
  hasAddonFiles?: boolean;
  isSharedSource?: boolean;
  warnings?: string[];
  submissionDate?: string;
  attachmentsList: string;
  metrics: Map<string, number>;
  evidence?: Partial<DigestedTeacherEvidence>;
}

export interface AggregationResult {
  assignment: CourseAssignment;
  statusLabel: 'Чернетка (T-3)' | 'Звірення (T-1)' | 'Фінальний звіт (Дедлайн)' | 'Поточний зріз';
  teachers: TeacherReportData[];
  indicators: string[];
  totalsByIndicator: Map<string, number>;
  staticPlanRows: any[][];
  staticSciPlanRows: any[][];
  aiSummary?: string;
  warnings?: string[];
}

export class Aggregator {
  public static metricsFromText(text: string): Map<string, number> {
    const result = new Map<string, number>();
    let section: number | undefined;
    for (const line of text.split(/\r?\n/)) {
      const match = line.trim().match(/^(.+)(?::|\t|\s[–—-]\s)\s*(.+)$/);
      if (!match) { section = sectionForLabel(line.trim()) || section; continue; }
      const name = match[1].trim();
      if (DocParserService.isNonIndicatorOrGarbage(name)) continue;
      const key = mapToOfficialKey(name, section) || name;
      const value = DocParserService.parseNumber(match[2]);
      if (value) result.set(key, (result.get(key) || 0) + value);
      if (match[2].includes('/')) result.set(key + SHEETS_SUFFIX, DocParserService.parseNumber(match[2].split('/')[1]));
    }
    return result;
  }

  public static metricsFromRows(rows: any[][]): Map<string, number> {
    const metrics = new Map<string, number>();
    const official = normalizeLabel(String(rows[1]?.[1] || '')) === 'інформація';
    let section: number | undefined;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!row) continue;
      if (official) {
        const key = OFFICIAL_TEMPLATE_ROWS.find(item => item.row === index + 1)?.indicatorKey;
        if (key && String(row[2] ?? '').trim() && String(row[2]).trim() !== '/') {
          metrics.set(key, DocParserService.parseNumber(row[2]));
          if (String(row[2]).includes('/')) metrics.set(key + SHEETS_SUFFIX, DocParserService.parseNumber(String(row[2]).split('/')[1]));
        }
        continue;
      }
      const numbered = /^\d+$/.test(String(row[0] || '').trim());
      const name = String(row[numbered ? 1 : 0] || '').trim();
      const detectedSection = sectionForLabel(name);
      if (detectedSection) { section = detectedSection; continue; }
      if (DocParserService.isNonIndicatorOrGarbage(name)) continue;
      const key = mapToOfficialKey(name, section) || name;
      const value = DocParserService.parseNumber(row[numbered ? 2 : 1]);
      if (value) metrics.set(key, (metrics.get(key) || 0) + value);
      const raw = String(row[numbered ? 2 : 1] || '');
      if (raw.includes('/')) metrics.set(key + SHEETS_SUFFIX, DocParserService.parseNumber(raw.split('/')[1]));
    }
    return metrics;
  }


  /**
   * CRITICAL Business Rule:
   * Parse numeric value from a cell.
   * If a cell contains a dash ("-") or the string "інформація відсутня", it must be parsed and calculated as 0.
   */
  public static parseCellNumber(val: any): number {
    return DocParserService.parseNumber(val);
  }

  /**
   * Parses individual teacher submission files:
   * Supports Google Drive folders (recursive), Zip archives (.zip), Google Spreadsheets, Google Docs, native Word (.docx, e.g. Додаток_*.docx), native Excel (.xlsx), and images (.jpeg/.jpg)
   */
  public static async parseTeacherSubmission(submission: StudentSubmissionItem): Promise<TeacherReportData> {
    const reportData: TeacherReportData = {
      studentName: submission.studentName,
      studentEmail: submission.studentEmail,
      hasSubmitted: submission.hasSubmitted,
      submissionState: submission.state,
      submissionDate: submission.updateTime ? new Date(submission.updateTime).toLocaleString('uk-UA') : undefined,
      attachmentsList: submission.attachments.map((a) => a.title || 'файл').join(', ') || 'Немає файлів',
      metrics: new Map<string, number>(),
      warnings: [],
      evidence: {
        publications: [],
        patents: [],
        grants: [],
        studentsWork: [],
        photos: [],
        rawNotes: [],
      },
    };

    if (!submission.hasSubmitted || submission.attachments.length === 0) {
      return reportData;
    }

    const processedFileNames: string[] = [];

    // Inner helper to parse any individual file (standalone, from a folder, or inside a zip archive)
    const processSingleFile = async (
      fileId: string | undefined,
      title: string,
      mimeType: string,
      buffer?: Buffer
    ): Promise<void> => {
      if (mimeType === 'application/vnd.google-apps.document' && fileId && !buffer) {
        const docBuffer = await DriveService.exportDocAsDocx(fileId);
        if (docBuffer) {
          await processSingleFile(fileId, title, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docBuffer);
          return;
        }
      }
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.endsWith('.zip') || mimeType === 'application/zip') {
        if (buffer) throw new Error('Вкладені архіви не підтримуються');
        const content = fileId ? await DriveService.downloadFileBuffer(fileId, title) : null;
        if (!content) throw new Error('Не вдалося завантажити архів');
        const entries = new AdmZip(content).getEntries();
        if (entries.length > 100 || entries.reduce((sum, entry) => sum + entry.header.size, 0) > 50 * 1024 * 1024) {
          throw new Error('Архів перевищує ліміт: 100 файлів або 50 МБ');
        }
        for (const entry of entries) {
          if (entry.isDirectory) continue;
          if (/(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[a-z]:/i.test(entry.entryName) || /\.(zip|rar|7z|tar|gz)$/i.test(entry.entryName)) {
            reportData.warnings?.push(`Небезпечний або вкладений архів: ${entry.entryName}`);
            continue;
          }
          try { await processSingleFile(undefined, entry.entryName, '', entry.getData()); }
          catch { reportData.warnings?.push(`Не вдалося обробити ${entry.entryName}`); }
        }
        return;
      }


      // 1. Photos and certificates (.jpeg, .jpg)
      if (lowerTitle.endsWith('.jpeg') || lowerTitle.endsWith('.jpg') || mimeType.includes('jpeg')) {
        console.log(`📸 [${submission.studentName}] Знайдено фото/сертифікат: ${title}`);
        reportData.evidence?.photos?.push(title);
        processedFileNames.push(title);
        return;
      }

      // 2. Word documents (.docx / Додаток_*.docx)
      if (lowerTitle.endsWith('.docx') || mimeType.includes('wordprocessingml')) {
        console.log(`📝 [${submission.studentName}] Завантаження та парсинг Word документа: ${title}...`);
        const docBuffer = buffer || (fileId ? await DriveService.downloadFileBuffer(fileId, title) : null);
        if (docBuffer) {
          let extracted = DocParserService.extractMetricsFromDocx(docBuffer, title);
          if (![...extracted.keys()].some(key => mapToOfficialKey(key))) {
            const ai = await AIService.extractMetricsFromText(DocParserService.parseDocxBuffer(docBuffer).fullText, submission.studentName);
            if (ai.size) extracted = ai;
          }
          for (const [ind, val] of extracted.entries()) {
            if (DocParserService.isNonIndicatorOrGarbage(ind)) continue;
            const current = reportData.metrics.get(ind) || 0;
            reportData.metrics.set(ind, current + val);
          }

          const parsedDoc = DocParserService.parseDocxBuffer(docBuffer);
          if (!parsedDoc.fullText) throw new Error('Порожній або пошкоджений Word-файл');
          if (!extracted.size) reportData.warnings?.push(`Не розпізнано показники: ${title}`);
          const qual = DocParserService.extractQualitativeEvidence(parsedDoc.fullText, parsedDoc.paragraphs, title);
          if (qual.publications) reportData.evidence?.publications?.push(...qual.publications);
          if (qual.patents) reportData.evidence?.patents?.push(...qual.patents);
          if (qual.grants) reportData.evidence?.grants?.push(...qual.grants);
          if (qual.studentsWork) reportData.evidence?.studentsWork?.push(...qual.studentsWork);

          processedFileNames.push(title);
        } else throw new Error('Не вдалося завантажити Word-файл');
        return;
      }

      // 3. Spreadsheets (.xlsx, .csv, or Google Sheets)
      if (lowerTitle.endsWith('.xlsx') || lowerTitle.endsWith('.csv') || mimeType.includes('spreadsheet')) {
        console.log(`📑 [${submission.studentName}] Парсинг електронної таблиці: ${title}...`);
        let rows: any[][] = [];
        if (fileId && !buffer && mimeType === 'application/vnd.google-apps.spreadsheet') {
          rows = await SheetsService.readSheetRows(fileId);
        } else {
          const content = buffer || (fileId ? await DriveService.downloadFileBuffer(fileId, title) : null);
          if (!content) throw new Error('Не вдалося завантажити таблицю');
          rows = DocParserService.parseXlsxBuffer(content);
        }
        if (!rows.length) throw new Error('Порожня або пошкоджена таблиця');
        for (const [key, value] of this.metricsFromRows(rows)) {
          reportData.metrics.set(key, (reportData.metrics.get(key) || 0) + value);
        }
        processedFileNames.push(title);
        return;
      }

      if ((mimeType.includes('document') && fileId) || lowerTitle.endsWith('.txt') || mimeType.includes('text/plain')) {
        let text: string | null;
        if (mimeType.includes('document') && fileId) text = await DriveService.exportDocAsText(fileId);
        else text = (buffer || (fileId ? await DriveService.downloadFileBuffer(fileId, title) : null))?.toString('utf8') || null;
        if (!text) throw new Error('Порожній або недоступний текстовий файл');
        const extracted = this.metricsFromText(text);
        if (![...extracted.keys()].some(key => mapToOfficialKey(key))) {
          const ai = await AIService.extractMetricsFromText(text, submission.studentName);
          for (const [key, value] of ai) extracted.set(key, value);
        }
        for (const [key, value] of extracted) reportData.metrics.set(key, (reportData.metrics.get(key) || 0) + value);
        if (!extracted.size) reportData.warnings?.push(`Не розпізнано показники: ${title}`);
        processedFileNames.push(title);
        return;
      }
      reportData.warnings?.push(`Формат файлу не підтримується: ${title}`);
    };

    for (const attachment of submission.attachments) {
      if (!attachment.id) continue;

      try {
        const meta = await DriveService.getFileMetadata(attachment.id);
        const mimeType = meta?.mimeType || attachment.mimeType || '';
        const title = meta?.name || attachment.title || '';

        // Case A: Google Drive Folder (attached directly or via link)
        if (mimeType === 'application/vnd.google-apps.folder' || attachment.alternateLink?.includes('folders/')) {
          console.log(`📁 [${submission.studentName}] Виявлено прикріплену папку Google Drive: "${title}" [${attachment.id}]`);
          const folderFiles = await DriveService.listFilesInFolder(attachment.id, true);
          for (const f of folderFiles) {
            try { await processSingleFile(f.id, f.name, f.mimeType); }
            catch { reportData.warnings?.push(`Не вдалося обробити файл: ${f.name}`); }
          }
        }
        // Case C: Single standalone file
        else {
          await processSingleFile(attachment.id, title, mimeType);
        }
      } catch (err) {
        reportData.warnings?.push(`Не вдалося обробити файл: ${attachment.title || attachment.id}`);
        console.error(`⚠️ Failed to parse attachment [${attachment.title}] for ${submission.studentName}:`, err);
      }
    }

    if (processedFileNames.length > 0) {
      reportData.attachmentsList = processedFileNames.join(', ');
    }

    const mapped = new Map<string, number>();
    for (const [raw, value] of reportData.metrics) {
      const key = mapToOfficialKey(raw) || raw;
      mapped.set(key, (mapped.get(key) || 0) + value);
    }
    completePublicationTotals(mapped);
    reportData.metrics = mapped;
    return reportData;
  }

  /**
   * Scans and parses files in the Google Drive folder linked to the assignment ("папка з додатками").
   * Incorporates .docx (Додаток_*.docx), .xlsx, Google Docs, Google Sheets, Zip archives, and images into the report.
   */
  public static async parseDriveFolderAddons(
    folderId: string,
    existingTeachersData: TeacherReportData[]
  ): Promise<{ addedMetricsCount: number; filesProcessed: number }> {
    let addedMetricsCount = 0;
    let filesProcessed = 0;
    const files = await DriveService.listFilesInFolder(folderId, true);
    for (const file of files) {
      const words = file.name.toLocaleLowerCase('uk-UA').split(/[^\p{L}'’]+/u);
      const matches = existingTeachersData.filter(teacher => !teacher.isSharedSource &&
        words.includes(teacher.studentName.trim().split(/\s+/)[0].toLocaleLowerCase('uk-UA')));
      let target = matches.length === 1 ? matches[0] : existingTeachersData.find(teacher => teacher.isSharedSource);
      if (!target) {
        target = { studentName: 'Матеріали з папки додатків завдання (Google Drive)', studentEmail: '',
          hasSubmitted: false, isSharedSource: true, submissionState: 'ADDONS', attachmentsList: '', metrics: new Map(), warnings: [] };
        existingTeachersData.push(target);
      }
      const parsed = await this.parseTeacherSubmission({ submissionId: '', userId: '', studentName: target.studentName,
        studentEmail: target.studentEmail, state: 'ADDONS', hasSubmitted: true,
        attachments: [{ id: file.id, title: file.name, mimeType: file.mimeType }] });
      target.hasAddonFiles = true;
      target.attachmentsList = [target.attachmentsList === 'Немає файлів' ? '' : target.attachmentsList, parsed.attachmentsList].filter(Boolean).join(', ');
      target.warnings = [...(target.warnings || []), ...(parsed.warnings || [])];
      for (const [key, value] of parsed.metrics) {
        target.metrics.set(key, (target.metrics.get(key) || 0) + value);
        addedMetricsCount++;
      }
      filesProcessed++;
    }
    return { addedMetricsCount, filesProcessed };
  }

  /**
   * Main aggregation pipeline:
   * 1. Preload official 28 sections & indicators from the university master template
   * 2. Aggregate dynamic teacher submissions from Google Classroom
   * 3. Aggregate any addons in the linked Google Drive folder
   * 4. Sum numeric indicators across all submissions
   * 5. Fetch static rows from "План роботи кафедри" & "План наукової роботи кафедри"
   * 6. Build master report structure
   */
  public static async aggregateAll(
    assignment: CourseAssignment,
    submissions: StudentSubmissionItem[],
    statusLabel: AggregationResult['statusLabel']
  ): Promise<AggregationResult> {
    console.log(`\n⚙️ Running Aggregation Pipeline with Official 28-Section Catalog (Status: ${statusLabel})...`);

    // 1. Process all teacher submissions from Google Classroom
    const warnings: string[] = [];
    const teachersData: TeacherReportData[] = [];
    const customTeacherIndicators = new Set<string>();

    for (const sub of submissions) {
      const data = await this.parseTeacherSubmission(sub);
      teachersData.push(data);
      for (const indicator of data.metrics.keys()) {
        customTeacherIndicators.add(indicator);
      }
    }

    // 2. Process linked Google Drive folder attachments ("папка з додатками") if present
    const driveFolderId = assignment.driveFolderId || (!accountContext.getStore() ? DriveService.extractDriveFolderId(process.env.ASSIGNMENT_ADDONS_FOLDER_URL || process.env.ASSIGNMENT_ADDONS_FOLDER_ID) : null);
    if (driveFolderId) {
      console.log(`📁 Враховуємо додатки з прикріпленої папки Google Drive [${driveFolderId}]...`);
      try { await this.parseDriveFolderAddons(driveFolderId, teachersData); }
      catch { warnings.push('Не вдалося прочитати папку додатків'); }
      for (const t of teachersData) {
        for (const indicator of t.metrics.keys()) {
          customTeacherIndicators.add(indicator);
        }
      }
    }

    // 3. Build full indicators list: official 28 template indicators first, then strictly validated custom teacher indicators
    const allIndicatorsSet = new Set<string>();
    for (const officialInd of OFFICIAL_INDICATORS) {
      allIndicatorsSet.add(officialInd);
    }
    for (const customInd of customTeacherIndicators) {
      if (!DocParserService.isNonIndicatorOrGarbage(customInd)) {
        allIndicatorsSet.add(customInd);
      }
    }

    const indicatorsList = Array.from(allIndicatorsSet);
    const totalsByIndicator = new Map<string, number>();

    // Calculate sums across all teachers
    for (const indicator of indicatorsList) {
      let sum = 0;
      for (const teacher of teachersData) {
        if (teacher.hasSubmitted || teacher.hasAddonFiles) {
          sum += teacher.metrics.get(indicator) || 0;
        }
      }
      totalsByIndicator.set(indicator, sum);
    }

    // 4. Fetch static rows from "План роботи кафедри"
    console.log(`📋 Fetching static rows from "План роботи кафедри" (Sheet ID: ${env.STATIC_PLAN_SHEET_ID})...`);
    let staticPlanRows: any[][] = [];
    try {
      staticPlanRows = await SheetsService.readSheetRows(env.STATIC_PLAN_SHEET_ID, 'A1:Z100');
      console.log(`✅ Loaded ${staticPlanRows.length} rows from "План роботи кафедри"`);
    } catch (err) {
      warnings.push('Не вдалося завантажити план роботи кафедри');
      console.error(`⚠️ Failed to load static plan rows:`, err);
    }

    // 5. Fetch static rows from "План наукової роботи кафедри"
    console.log(`🔬 Fetching static rows from "План наукової роботи кафедри" (Sheet ID: ${env.STATIC_SCI_PLAN_SHEET_ID})...`);
    let staticSciPlanRows: any[][] = [];
    try {
      staticSciPlanRows = await SheetsService.readSheetRows(env.STATIC_SCI_PLAN_SHEET_ID, 'A1:Z100');
      console.log(`✅ Loaded ${staticSciPlanRows.length} rows from "План наукової роботи кафедри"`);
    } catch (err) {
      warnings.push('Не вдалося завантажити план наукової роботи кафедри');
      console.error(`⚠️ Failed to load static scientific plan rows:`, err);
    }

    // 6. Summarize parsed totals and submission status without external AI calls.
    const missingList = teachersData.filter((t) => !t.hasSubmitted && !t.isSharedSource).map((t) => t.studentName);
    const submittedCount = teachersData.filter((t) => t.hasSubmitted).length;
    const highlights = Array.from(totalsByIndicator.entries())
      .filter(([, value]) => value !== 0)
      .map(([indicator, value]) => `${indicator}: ${value}`);
    // Keep the existing field name for consumers of the report data.
    const aiSummary = [
      `Зведений звіт за напрямом «${assignment.title}» (статус: ${statusLabel}).`,
      `Подано ${submittedCount} з ${teachersData.filter(t => !t.isSharedSource).length} звітів.`,
      highlights.length > 0
        ? `Показники кафедри: ${highlights.join('; ')}.`
        : 'Ненульових числових показників не виявлено.',
      missingList.length > 0
        ? `Не подали звіти: ${missingList.join(', ')}.`
        : 'Немає викладачів, які очікують на подання звіту.',
      ...teachersData.flatMap(t => (t.warnings || []).map(w => `${t.studentName}: ${w}`)),
      ...warnings,
    ].join(' ');

    return {
      assignment,
      statusLabel,
      teachers: teachersData,
      indicators: indicatorsList,
      totalsByIndicator,
      staticPlanRows,
      staticSciPlanRows,
      aiSummary,
      warnings,
    };
  }

  /**
   * Builds the 1-to-1 official master summary grid (Sheet 1):
   * Exactly matches templates/2_Інформ._про_наук.роб_(бланк)_2026.xlsx (Rows 1 to 132).
   * Contains ONLY Columns A, B, C (№, Показник, Разом по кафедрі).
   * NO individual teacher columns, NO extra injected styles or sections at the bottom.
   */
  public static buildSummaryGrid(data: AggregationResult): any[][] {
    const grid: any[][] = [];

    // Row 1 (Empty in template)
    grid.push(['', '', '']);

    // Row 2: B2 = 'ІНФОРМАЦІЯ'
    grid.push(['', 'ІНФОРМАЦІЯ', '']);

    // Row 3: B3 = `про науково-дослідну роботу за ${data.assignment.creationDate.getFullYear()} рік`
    grid.push(['', `про науково-дослідну роботу за ${data.assignment.creationDate.getFullYear()} рік`, '']);

    // Row 4: B4 = `кафедри ${data.assignment.courseName || ''}`
    grid.push(['', `кафедри ${data.assignment.courseName || ''}`, '']);

    // Row 5: (Empty in template)
    grid.push(['', '', '']);

    // Row 6: B6 = 'Вказати інформацію (ОБОВ’ЯЗКОВО!!!):'
    grid.push(['', 'Вказати інформацію (ОБОВ’ЯЗКОВО!!!):', '']);

    // Row 7: B7 = 'кафедральна електронна адреса (або адреса, на яку можна надсилати інформацію для кафедри) '
    grid.push(['', 'кафедральна електронна адреса (або адреса, на яку можна надсилати інформацію для кафедри) ', '']);

    // Row 8: B8 = 'П.І.Б. лаборанта кафедри '
    grid.push(['', 'П.І.Б. лаборанта кафедри ', '']);

    // Row 9: B9 = 'Мобільний телефон лаборанта'
    grid.push(['', 'Мобільний телефон лаборанта', '']);

    // Row 10: B10 = 'Стаціонарний телефон кафедри'
    grid.push(['', 'Стаціонарний телефон кафедри', '']);

    // Row 11: (Empty row in template between header and Section 1)
    grid.push(['', '', '']);

    // Rows 12-132: 1-to-1 Official Indicator Rows
    for (const tRow of OFFICIAL_TEMPLATE_ROWS) {
      if (tRow.row < 12) continue;

      const rowCells: any[] = [tRow.colA || '', (tRow.colB || '').replace(/2026|2027/g, year => String(data.assignment.creationDate.getFullYear() + (year === '2027' ? 1 : 0)))];

      // Col C: Department total sum
      if (tRow.indicatorKey) {
        const totalVal = data.totalsByIndicator.get(tRow.indicatorKey) || 0;
        if (tRow.format === '/') {
          rowCells.push(`${totalVal} / ${data.totalsByIndicator.get(tRow.indicatorKey + SHEETS_SUFFIX) || 0}`);
        } else {
          rowCells.push(totalVal > 0 ? totalVal : (tRow.defaultColC || ''));
        }
      } else if (tRow.defaultColC) {
        rowCells.push(tRow.defaultColC);
      } else {
        rowCells.push('');
      }

      grid.push(rowCells);
    }

    return grid;
  }

  /**
   * Builds the detailed breakdown grid for Sheet 2 ("Деталізація по викладачах"):
   * Includes individual teacher columns (Col D, E, F...), static departmental plans,
   * and registry of teacher submissions.
   */
  public static buildDetailGrid(data: AggregationResult): any[][] {
    const grid: any[][] = [];
    const submittedTeachers = data.teachers.filter((t) => t.hasSubmitted || t.hasAddonFiles);

    // ==========================================
    // ROWS 1-10: HEADER & METADATA SECTION
    // ==========================================
    // Row 1
    grid.push([`ІНФОРМАЦІЯ ПРО НАУКОВО-ДОСЛІДНУ РОБОТУ КАФЕДРИ ЗА ${data.assignment.creationDate.getFullYear()} РІК (ДЕТАЛІЗАЦІЯ ПО ВИКЛАДАЧАХ)`]);

    // Row 2: B2 = 'ІНФОРМАЦІЯ'
    grid.push(['', 'ІНФОРМАЦІЯ']);

    // Row 3: B3 = `про науково-дослідну роботу за ${data.assignment.creationDate.getFullYear()} рік`
    grid.push(['', `про науково-дослідну роботу за ${data.assignment.creationDate.getFullYear()} рік`]);

    // Row 4: B4 = `кафедри ${data.assignment.courseName || ''}`
    grid.push(['', `кафедри ${data.assignment.courseName || ''}`]);

    // Row 5: Metadata header (Creation Date, Deadline, Report Status, Timestamp)
    grid.push([
      '',
      `Дата появи завдання в Google Classroom: ${data.assignment.creationDateFormatted} | Дедлайн: ${data.assignment.deadlineFormatted} | Статус звіту: ${data.statusLabel} | Подано звітів: ${data.teachers.filter(t => t.hasSubmitted).length} з ${data.teachers.filter(t => !t.isSharedSource).length}`,
    ]);

    // Row 6: B6 = 'Вказати інформацію (ОБОВ’ЯЗКОВО!!!):'
    grid.push(['', 'Вказати інформацію (ОБОВ’ЯЗКОВО!!!):']);

    // Row 7: B7 = 'кафедральна електронна адреса (або адреса, на яку можна надсилати інформацію для кафедри) '
    grid.push(['', 'кафедральна електронна адреса (або адреса, на яку можна надсилати інформацію для кафедри) ']);

    // Row 8: B8 = 'П.І.Б. лаборанта кафедри '
    grid.push(['', 'П.І.Б. лаборанта кафедри ']);

    // Row 9: B9 = 'Мобільний телефон лаборанта'
    grid.push(['', 'Мобільний телефон лаборанта']);

    // Row 10: B10 = 'Стаціонарний телефон кафедри'
    grid.push(['', 'Стаціонарний телефон кафедри']);

    // Row 11: Table column headers:
    // Col A: '№'
    // Col B: 'Показники наукової діяльності (відповідно до Додатків 1-28)'
    // Col C: 'РАЗОМ ПО КАФЕДРІ (СУМА)'
    // Col D, E, F...: Individual submitted teachers
    const tableHeader = [
      '№',
      'Показники наукової діяльності (відповідно до Додатків 1-28)',
      'РАЗОМ ПО КАФЕДРІ (СУМА)',
    ];
    for (const t of submittedTeachers) {
      tableHeader.push(t.studentName);
    }
    grid.push(tableHeader);

    // ==========================================
    // ROWS 12-132: 1-TO-1 OFFICIAL TEMPLATE ROWS (28 OFFICIAL SECTIONS)
    // ==========================================
    for (const tRow of OFFICIAL_TEMPLATE_ROWS) {
      if (tRow.row < 12) continue;

      const rowCells: any[] = [tRow.colA || '', (tRow.colB || '').replace(/2026|2027/g, year => String(data.assignment.creationDate.getFullYear() + (year === '2027' ? 1 : 0)))];

      // Col C: Department total
      if (tRow.indicatorKey) {
        const totalVal = data.totalsByIndicator.get(tRow.indicatorKey) || 0;
        if (tRow.format === '/') {
          rowCells.push(`${totalVal} / ${data.totalsByIndicator.get(tRow.indicatorKey + SHEETS_SUFFIX) || 0}`);
        } else {
          rowCells.push(totalVal);
        }
      } else if (tRow.defaultColC) {
        rowCells.push(tRow.defaultColC);
      } else {
        rowCells.push('');
      }

      // Col D+: Breakdown by each submitted teacher
      for (const t of submittedTeachers) {
        if (tRow.indicatorKey) {
          const val = t.metrics.get(tRow.indicatorKey) || 0;
          rowCells.push(tRow.format === '/' ? `${val} / ${t.metrics.get(tRow.indicatorKey + SHEETS_SUFFIX) || 0}` : val);
        } else {
          rowCells.push('');
        }
      }

      grid.push(rowCells);
    }

    grid.push([]);
    grid.push(['Нерозпізнані показники']);
    const officialKeys = new Set(OFFICIAL_TEMPLATE_ROWS.map(row => row.indicatorKey));
    for (const [key, value] of data.totalsByIndicator) {
      if (!officialKeys.has(key) && !key.endsWith(SHEETS_SUFFIX)) grid.push(['', key, value, ...submittedTeachers.map(t => t.metrics.get(key) || 0)]);
    }

    // ==========================================
    // ==========================================
    // SECTION 2: STATIC ROWS FROM "План роботи кафедри"
    // ==========================================
    grid.push([`РОЗДІЛ 2. ПЛАН РОБОТИ КАФЕДРИ (Статичні дані з Google Sheet ID: ${env.STATIC_PLAN_SHEET_ID})`]);
    if (data.staticPlanRows.length > 0) {
      for (const staticRow of data.staticPlanRows) {
        grid.push(staticRow);
      }
    } else {
      grid.push(['(Статичні дані відсутні або документ порожній)']);
    }
    grid.push([]); // Blank row

    // ==========================================
    // SECTION 3: STATIC ROWS FROM "План наукової роботи кафедри"
    // ==========================================
    grid.push([`РОЗДІЛ 3. ПЛАН НАУКОВОЇ РОБОТИ КАФЕДРИ (Статичні дані з Google Sheet ID: ${env.STATIC_SCI_PLAN_SHEET_ID})`]);
    if (data.staticSciPlanRows.length > 0) {
      for (const staticRow of data.staticSciPlanRows) {
        grid.push(staticRow);
      }
    } else {
      grid.push(['(Статичні дані відсутні або документ порожній)']);
    }
    grid.push([]); // Blank row

    // ==========================================
    // SECTION 4: TEACHER SUBMISSION STATUS REGISTRY
    // ==========================================
    grid.push(['РОЗДІЛ 4. РЕЄСТР ПОДАННЯ ЗВІТІВ ТА ПРИКРІПЛЕНИХ ДОДАТКІВ (включаючи папку Google Drive)']);
    grid.push(['№', 'ПІБ Викладача / Джерело', 'Електронна пошта', 'Статус', 'Дата здачі', 'Прикріплені матеріали']);

    data.teachers.forEach((t, idx) => {
      grid.push([
        idx + 1,
        t.studentName,
        t.studentEmail || 'не вказано',
        t.isSharedSource ? 'ДОДАТКИ КАФЕДРИ' : t.hasSubmitted ? 'ПОДАНО (Враховано)' : t.submissionState === 'RECLAIMED_BY_STUDENT' ? 'ПОВЕРНУТО НА РЕДАГУВАННЯ' : 'НЕ ПОДАНО (Очікується)',
        t.submissionDate || '-',
        t.attachmentsList,
      ]);
    });

    for (const teacher of data.teachers) {
      const evidence = Object.values(teacher.evidence || {}).flat().filter(Boolean);
      if (evidence.length) grid.push([], [`Наукові результати: ${teacher.studentName}`], ...evidence.map(value => [value]));
    }
    const warnings = [...(data.warnings || []), ...data.teachers.flatMap(t => (t.warnings || []).map(warning => `${t.studentName}: ${warning}`))];
    if (warnings.length) grid.push([], ['Попередження обробки'], ...warnings.map(warning => [warning]));
    if (data.aiSummary) {
      grid.push([]);
      grid.push(['АНАЛІТИЧНЕ РЕЗЮМЕ ДЛЯ НАУКОВОЇ ЧАСТИНИ ТА ЗАВІДУВАЧА КАФЕДРИ']);
      grid.push(['', data.aiSummary]);
    }

    return grid;
  }

  /**
   * Backward-compatible alias for buildDetailGrid
   */
  public static buildMasterGrid(data: AggregationResult): any[][] {
    return this.buildDetailGrid(data);
  }
}
