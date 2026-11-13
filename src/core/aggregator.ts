import { SheetsService } from '../services/sheets.service';
import { DriveService } from '../services/drive.service';
import { DocParserService } from '../services/doc-parser.service';
import { CourseAssignment, StudentSubmissionItem } from '../services/classroom.service';
import { OFFICIAL_INDICATORS, OFFICIAL_SECTIONS } from '../config/official-template';
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
    return DocParserService.parseNumber(val);
  }

  /**
   * Parses individual teacher submission files:
   * Supports Google Spreadsheets, Google Docs, native Word (.docx, e.g. Додаток_*.docx), and native Excel (.xlsx)
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

        // 1. If it's a native Word document (.docx / Додаток_*.docx)
        if (title.endsWith('.docx') || mimeType.includes('wordprocessingml')) {
          console.log(`📝 Downloading & parsing native Word document [${title}] for ${submission.studentName}...`);
          const buffer = await DriveService.downloadFileBuffer(attachment.id, title);
          if (buffer) {
            const extracted = DocParserService.extractMetricsFromDocx(buffer, title);
            for (const [ind, val] of extracted.entries()) {
              const current = reportData.metrics.get(ind) || 0;
              reportData.metrics.set(ind, current + val);
            }
          }
        }
        // 2. If it's a Google Spreadsheet
        else if (mimeType.includes('spreadsheet') || title.endsWith('.xlsx') || title.endsWith('.csv')) {
          console.log(`📑 Parsing spreadsheet [${title}] for ${submission.studentName}...`);
          let rows: any[][] = [];

          // Try Google Sheets API first (for Google Spreadsheets or auto-converted files)
          try {
            rows = await SheetsService.readSheetRows(attachment.id);
          } catch (e) {
            // If direct Sheets API fails on binary .xlsx, download and parse buffer
            const buffer = await DriveService.downloadFileBuffer(attachment.id, title);
            if (buffer) {
              rows = DocParserService.parseXlsxBuffer(buffer);
            }
          }

          for (const row of rows) {
            if (!row || row.length === 0) continue;
            const indicatorName = String(row[0] || '').trim();
            if (!indicatorName || indicatorName.toLowerCase().startsWith('показник') || indicatorName.toLowerCase().startsWith('№')) {
              continue;
            }

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
        // 3. If it's a Google Doc
        else if (mimeType.includes('document')) {
          console.log(`📄 Parsing teacher Google Doc [${title}] for ${submission.studentName}...`);
          const docText = await DriveService.exportDocAsText(attachment.id);
          if (docText) {
            const lines = docText.split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

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
      }
    }

    return reportData;
  }

  /**
   * Main aggregation pipeline:
   * 1. Preload official 28 sections & indicators from the university master template
   * 2. Aggregate dynamic teacher submissions
   * 3. Sum numeric indicators across all submissions
   * 4. Fetch static rows from "План роботи кафедри" & "План наукової роботи кафедри"
   * 5. Build master report structure
   */
  public static async aggregateAll(
    assignment: CourseAssignment,
    submissions: StudentSubmissionItem[],
    statusLabel: AggregationResult['statusLabel']
  ): Promise<AggregationResult> {
    console.log(`\n⚙️ Running Aggregation Pipeline with Official 28-Section Catalog (Status: ${statusLabel})...`);

    // 1. Process all teacher submissions
    const teachersData: TeacherReportData[] = [];
    const customTeacherIndicators = new Set<string>();

    for (const sub of submissions) {
      const data = await this.parseTeacherSubmission(sub);
      teachersData.push(data);
      for (const indicator of data.metrics.keys()) {
        customTeacherIndicators.add(indicator);
      }
    }

    // 2. Build full indicators list: official 28 template indicators first, then custom teacher indicators
    const allIndicatorsSet = new Set<string>();
    for (const officialInd of OFFICIAL_INDICATORS) {
      allIndicatorsSet.add(officialInd);
    }
    for (const customInd of customTeacherIndicators) {
      allIndicatorsSet.add(customInd);
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

    // 3. Fetch static rows from "План роботи кафедри"
    console.log(`📋 Fetching static rows from "План роботи кафедри" (Sheet ID: ${env.STATIC_PLAN_SHEET_ID})...`);
    let staticPlanRows: any[][] = [];
    try {
      staticPlanRows = await SheetsService.readSheetRows(env.STATIC_PLAN_SHEET_ID, 'A1:Z100');
      console.log(`✅ Loaded ${staticPlanRows.length} rows from "План роботи кафедри"`);
    } catch (err) {
      console.error(`⚠️ Failed to load static plan rows:`, err);
    }

    // 4. Fetch static rows from "План наукової роботи кафедри"
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
    // HEADER & METADATA SECTION (Exact format required by Scientific Department)
    // ==========================================
    grid.push(['ІНФОРМАЦІЯ ПРО НАУКОВО-ДОСЛІДНУ РОБОТУ КАФЕДРИ ЗА 2026 РІК']);
    grid.push([`Завдання: ${data.assignment.title}`]);
    grid.push([`Дата публікації завдання в Google Classroom: ${data.assignment.creationDateFormatted}`]);
    grid.push([
      `Кінцевий термін здачі (Дедлайн): ${data.assignment.deadlineFormatted} | Статус звіту: ${data.statusLabel} | Згенеровано: ${new Date().toLocaleString('uk-UA')}`,
    ]);
    grid.push([`Подано звітів: ${submittedTeachers.length} з ${data.teachers.length} викладачів кафедри`]);
    grid.push([]); // Blank row

    // ==========================================
    // SECTION 1: AGGREGATED SCIENTIFIC INDICATORS (28 OFFICIAL SECTIONS)
    // ==========================================
    grid.push(['РОЗДІЛ 1. ДИНАМІЧНІ ТА ЗВЕДЕНІ ПОКАЗНИКИ НАУКОВОЇ ДІЯЛЬНОСТІ (28 ОФІЦІЙНИХ РОЗДІЛІВ)']);

    // Table header row: Indicator Name | Teacher 1 | Teacher 2 | ... | РАЗОМ (СУМА)
    const tableHeader = ['№ та Показник наукової діяльності (відповідно до Додатків 1-28)'];
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
    const totalSumsRow: any[] = ['ЗАГАЛЬНА СУМА ВСІХ ЧИСЛОВИХ ПОКАЗНИКІВ'];
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
    grid.push(['РОЗДІЛ 4. РЕЄСТР ПОДАННЯ ЗВІТІВ ТА ПРИКРІПЛЕНИХ ДОДАТКІВ']);
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
