import { SheetsService } from '../services/sheets.service';
import { DriveService } from '../services/drive.service';
import { CourseAssignment, StudentSubmissionItem } from '../services/classroom.service';
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
  submissionDate?: string;
  attachmentsList: string;
  metrics: Map<string, number>;
}

export interface AggregationResult {
  assignment: CourseAssignment;
  statusLabel: 'Чернетка (T-3)' | 'Звірення (T-1)' | 'Фінальний звіт (Дедлайн)' | 'Поточний зріз';
  teachers: TeacherReportData[];
  indicators: string[];
  totalsByIndicator: Map<string, number>;
  staticPlanRows: any[][];
  staticSciPlanRows: any[][];
}

export class Aggregator {
  /**
   * CRITICAL Business Rule:
   * Parse numeric value from a cell.
   * If a cell contains a dash ("-") or the string "інформація відсутня", it must be parsed and calculated as 0.
   */
  public static parseCellNumber(val: any): number {
    if (val === null || val === undefined) {
      return 0;
    }

    if (typeof val === 'number') {
      return isNaN(val) ? 0 : val;
    }

    const str = String(val).trim();

    // Check critical rule: dash or "інформація відсутня"
    if (
      str === '-' ||
      str === '–' ||
      str === '—' ||
      /^інформація\s*відсутня$/i.test(str) ||
      str.toLowerCase().includes('інформація відсутня')
    ) {
      return 0;
    }

    // Clean formatting (spaces, non-breaking spaces, commas for decimals)
    const cleaned = str
      .replace(/[\s\u00A0]/g, '')
      .replace(/,/g, '.');

    // Strict regex for numeric values (integer or decimal)
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    }

    return 0;
  }

  /**
   * Parses individual teacher submission files (Google Sheets / Google Docs)
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
    };

    if (!submission.hasSubmitted || submission.attachments.length === 0) {
      return reportData;
    }

    for (const attachment of submission.attachments) {
      if (!attachment.id) continue;

      try {
        const meta = await DriveService.getFileMetadata(attachment.id);
        const mimeType = meta?.mimeType || '';
        const title = meta?.name || attachment.title || '';

        // If it's a Google Spreadsheet
        if (mimeType.includes('spreadsheet') || title.endsWith('.xlsx') || title.endsWith('.csv')) {
          console.log(`📑 Parsing teacher spreadsheet [${title}] for ${submission.studentName}...`);
          const rows = await SheetsService.readSheetRows(attachment.id);

          for (const row of rows) {
            if (!row || row.length === 0) continue;
            // Expected format: Column 0: Indicator name / question, Column 1 or 2: Count / Value
            const indicatorName = String(row[0] || '').trim();
            if (!indicatorName || indicatorName.toLowerCase().startsWith('показник') || indicatorName.toLowerCase().startsWith('№')) {
              continue; // skip table header rows
            }

            // Find first numeric or dash column
            let metricVal = 0;
            let foundValue = false;

            for (let c = 1; c < row.length; c++) {
              const cell = row[c];
              if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
                metricVal = this.parseCellNumber(cell);
                foundValue = true;
                break;
              }
            }

            if (foundValue) {
              const currentVal = reportData.metrics.get(indicatorName) || 0;
              reportData.metrics.set(indicatorName, currentVal + metricVal);
            }
          }
        } 
        // If it's a Google Doc
        else if (mimeType.includes('document')) {
          console.log(`📄 Parsing teacher document [${title}] for ${submission.studentName}...`);
          const docText = await DriveService.exportDocAsText(attachment.id);
          if (docText) {
            const lines = docText.split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              // Match lines like: "1. Кількість опублікованих статей: 3" or "Статті Scopus: -"
              const delimiterMatch = trimmed.match(/^([^:\-\t–]+)[:\t–\-]\s*(.+)$/);
              if (delimiterMatch) {
                const indicator = delimiterMatch[1].trim();
                const rawVal = delimiterMatch[2].trim();
                const numVal = this.parseCellNumber(rawVal);
                const currentVal = reportData.metrics.get(indicator) || 0;
                reportData.metrics.set(indicator, currentVal + numVal);
              }
            }
          }
        }
      } catch (err) {
        console.error(`⚠️ Failed to parse attachment [${attachment.title}] for ${submission.studentName}:`, err);
        // Continue processing remaining attachments/teachers, do not crash
      }
    }

    return reportData;
  }

  /**
   * Main aggregation pipeline:
   * 1. Aggregate dynamic teacher submissions
   * 2. Sum numeric indicators across all submissions
   * 3. Fetch static rows from the two plan sheets
   * 4. Build master report structure
   */
  public static async aggregateAll(
    assignment: CourseAssignment,
    submissions: StudentSubmissionItem[],
    statusLabel: AggregationResult['statusLabel']
  ): Promise<AggregationResult> {
    console.log(`\n⚙️ Running Aggregation Pipeline (Status: ${statusLabel})...`);

    // 1. Process all teacher submissions
    const teachersData: TeacherReportData[] = [];
    const allIndicatorsSet = new Set<string>();

    for (const sub of submissions) {
      const data = await this.parseTeacherSubmission(sub);
      teachersData.push(data);
      for (const indicator of data.metrics.keys()) {
        allIndicatorsSet.add(indicator);
      }
    }

    // Default indicators if none found in teacher sheets (ensures standard departmental sections)
    if (allIndicatorsSet.size === 0) {
      [
        '1. Опубліковано статей у виданнях Scopus / Web of Science',
        '2. Опубліковано статей у фахових виданнях України (категорія Б)',
        '3. Опубліковано монографій (розділів монографій)',
        '4. Опубліковано тез доповідей на міжнародних конференціях',
        '5. Отримано патентів / авторських свідоцтв',
        '6. Подано заявок на фінансування наукових грантів',
        '7. Керівництво науковою роботою студентів (кількість публікацій зі студентами)',
      ].forEach((ind) => allIndicatorsSet.add(ind));
    }

    const indicatorsList = Array.from(allIndicatorsSet);
    const totalsByIndicator = new Map<string, number>();

    // Calculate sums
    for (const indicator of indicatorsList) {
      let sum = 0;
      for (const teacher of teachersData) {
        if (teacher.hasSubmitted) {
          sum += teacher.metrics.get(indicator) || 0;
        }
      }
      totalsByIndicator.set(indicator, sum);
    }

    // 2. Fetch static rows from "План роботи кафедри"
    console.log(`📋 Fetching static rows from "План роботи кафедри" (Sheet ID: ${env.STATIC_PLAN_SHEET_ID})...`);
    let staticPlanRows: any[][] = [];
    try {
      staticPlanRows = await SheetsService.readSheetRows(env.STATIC_PLAN_SHEET_ID, 'A1:Z100');
      console.log(`✅ Loaded ${staticPlanRows.length} rows from "План роботи кафедри"`);
    } catch (err) {
      console.error(`⚠️ Failed to load static plan rows:`, err);
    }

    // 3. Fetch static rows from "План наукової роботи кафедри"
    console.log(`🔬 Fetching static rows from "План наукової роботи кафедри" (Sheet ID: ${env.STATIC_SCI_PLAN_SHEET_ID})...`);
    let staticSciPlanRows: any[][] = [];
    try {
      staticSciPlanRows = await SheetsService.readSheetRows(env.STATIC_SCI_PLAN_SHEET_ID, 'A1:Z100');
      console.log(`✅ Loaded ${staticSciPlanRows.length} rows from "План наукової роботи кафедри"`);
    } catch (err) {
      console.error(`⚠️ Failed to load static scientific plan rows:`, err);
    }

    return {
      assignment,
      statusLabel,
      teachers: teachersData,
      indicators: indicatorsList,
      totalsByIndicator,
      staticPlanRows,
      staticSciPlanRows,
    };
  }

  /**
   * Converts the aggregated result into the complete 2D spreadsheet matrix for Google Sheets
   */
  public static buildMasterGrid(data: AggregationResult): any[][] {
    const grid: any[][] = [];
    const submittedTeachers = data.teachers.filter((t) => t.hasSubmitted);

    // ==========================================
    // HEADER & METADATA SECTION
    // ==========================================
    grid.push(['ЗВЕДЕНИЙ ЗВІТ ПРО НАУКОВО-ДОСЛІДНУ РОБОТУ КАФЕДРИ']);
    grid.push([`Завдання: ${data.assignment.title}`]);
    grid.push([`Дата публікації завдання в Google Classroom: ${data.assignment.creationDateFormatted}`]);
    grid.push([
      `Кінцевий термін здачі (Дедлайн): ${data.assignment.deadlineFormatted} | Статус звіту: ${data.statusLabel} | Згенеровано: ${new Date().toLocaleString('uk-UA')}`,
    ]);
    grid.push([`Подано звітів: ${submittedTeachers.length} з ${data.teachers.length} викладачів`]);
    grid.push([]); // Blank row

    // ==========================================
    // SECTION 1: AGGREGATED DYNAMIC DATA
    // ==========================================
    grid.push(['РОЗДІЛ 1. ДИНАМІЧНІ ПОКАЗНИКИ НАУКОВОЇ ДІЯЛЬНОСТІ ВИКЛАДАЧІВ (АГРЕГОВАНІ ДАНІ)']);

    // Table header row: Indicator Name | Teacher 1 | Teacher 2 | ... | РАЗОМ (СУМА)
    const tableHeader = ['Показник наукової діяльності'];
    for (const t of submittedTeachers) {
      tableHeader.push(t.studentName);
    }
    tableHeader.push('РАЗОМ ПО КАФЕДРІ (СУМА)');
    grid.push(tableHeader);

    // Dynamic data rows
    for (const indicator of data.indicators) {
      const row: any[] = [indicator];
      for (const t of submittedTeachers) {
        const val = t.metrics.get(indicator);
        row.push(val !== undefined ? val : 0);
      }
      row.push(data.totalsByIndicator.get(indicator) || 0);
      grid.push(row);
    }

    // Total indicators sum row
    const totalSumsRow: any[] = ['ЗАГАЛЬНА СУМА ВСІХ ПОКАЗНИКІВ'];
    let grandTotal = 0;
    for (const t of submittedTeachers) {
      let teacherTotal = 0;
      for (const indicator of data.indicators) {
        teacherTotal += t.metrics.get(indicator) || 0;
      }
      totalSumsRow.push(teacherTotal);
      grandTotal += teacherTotal;
    }
    totalSumsRow.push(grandTotal);
    grid.push(totalSumsRow);
    grid.push([]); // Blank row

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
    grid.push(['РОЗДІЛ 4. РЕЄСТР ПОДАННЯ ЗВІТІВ ВИКЛАДАЧАМИ КАФЕДРИ']);
    grid.push(['№', 'ПІБ Викладача', 'Електронна пошта', 'Статус у Google Classroom', 'Дата здачі', 'Прикріплені матеріали']);

    data.teachers.forEach((t, idx) => {
      grid.push([
        idx + 1,
        t.studentName,
        t.studentEmail || 'не вказано',
        t.hasSubmitted ? 'ПОДАНО (Вчасно)' : 'НЕ ПОДАНО (Очікується)',
        t.submissionDate || '-',
        t.attachmentsList,
      ]);
    });

    return grid;
  }
}
