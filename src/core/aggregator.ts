import path from 'path';
import { SheetsService } from '../services/sheets.service';
import { DriveService } from '../services/drive.service';
import { DocParserService, DigestedTeacherEvidence } from '../services/doc-parser.service';
import { AIService } from '../services/ai.service';
import { CourseAssignment, StudentSubmissionItem } from '../services/classroom.service';
import { OFFICIAL_INDICATORS, OFFICIAL_SECTIONS, OFFICIAL_TEMPLATE_ROWS } from '../config/official-template';
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
      const lowerTitle = title.toLowerCase();

      // Check author surname in filename (e.g. Додаток_1_Монографії_Петренко.docx -> Петренко)
      const authorMatch = title.match(/[_\-\s]([А-ЯІЇЄ][а-яіїє']+)(?:\.|$)/);
      if (authorMatch && authorMatch[1] && !reportData.studentName.includes(authorMatch[1])) {
        if (!reportData.studentName.includes('(')) {
          reportData.studentName = `${reportData.studentName} (${authorMatch[1]})`;
        }
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
          const extracted = DocParserService.extractMetricsFromDocx(docBuffer, title);
          for (const [ind, val] of extracted.entries()) {
            if (DocParserService.isNonIndicatorOrGarbage(ind)) continue;
            const current = reportData.metrics.get(ind) || 0;
            reportData.metrics.set(ind, current + val);
          }

          const parsedDoc = DocParserService.parseDocxBuffer(docBuffer);
          const qual = DocParserService.extractQualitativeEvidence(parsedDoc.fullText, parsedDoc.paragraphs, title);
          if (qual.publications) reportData.evidence?.publications?.push(...qual.publications);
          if (qual.patents) reportData.evidence?.patents?.push(...qual.patents);
          if (qual.grants) reportData.evidence?.grants?.push(...qual.grants);
          if (qual.studentsWork) reportData.evidence?.studentsWork?.push(...qual.studentsWork);

          if (extracted.size === 0 && parsedDoc.fullText.length > 50 && AIService.isAvailable()) {
            console.log(`🤖 [${submission.studentName}] Groq AI аналіз описового звіту: ${title}...`);
            const aiExtracted = await AIService.extractMetricsFromText(parsedDoc.fullText, submission.studentName);
            for (const [ind, val] of aiExtracted.entries()) {
              if (!DocParserService.isNonIndicatorOrGarbage(ind)) {
                const current = reportData.metrics.get(ind) || 0;
                reportData.metrics.set(ind, current + val);
              }
            }
          }
          processedFileNames.push(title);
        }
        return;
      }

      // 3. Spreadsheets (.xlsx, .csv, or Google Sheets)
      if (lowerTitle.endsWith('.xlsx') || lowerTitle.endsWith('.csv') || mimeType.includes('spreadsheet')) {
        console.log(`📑 [${submission.studentName}] Парсинг електронної таблиці: ${title}...`);
        let rows: any[][] = [];
        if (fileId && !buffer) {
          try {
            rows = await SheetsService.readSheetRows(fileId);
          } catch {
            const xlsxBuf = await DriveService.downloadFileBuffer(fileId, title);
            if (xlsxBuf) {
              rows = DocParserService.parseXlsxBuffer(xlsxBuf);
            }
          }
        } else if (buffer) {
          rows = DocParserService.parseXlsxBuffer(buffer);
        }

        for (const row of rows) {
          if (!row || row.length === 0) continue;
          let indicatorName = String(row[0] || '').trim();
          let valueColStart = 1;

          if (/^\d+$/.test(indicatorName) && row.length > 1 && String(row[1] || '').trim().length > 3) {
            indicatorName = String(row[1]).trim();
            valueColStart = 2;
          }

          if (!indicatorName || DocParserService.isNonIndicatorOrGarbage(indicatorName)) continue;

          let metricVal = 0;
          for (let c = valueColStart; c < row.length; c++) {
            const cell = row[c];
            if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
              metricVal = DocParserService.parseNumber(cell);
              if (metricVal > 0) break;
            }
          }

          if (metricVal > 0) {
            const current = reportData.metrics.get(indicatorName) || 0;
            reportData.metrics.set(indicatorName, current + metricVal);
          }
        }
        processedFileNames.push(title);
        return;
      }

      // 4. Google Docs
      if (mimeType.includes('document') && fileId) {
        console.log(`📄 [${submission.studentName}] Експорт та парсинг Google Doc: ${title}...`);
        const docText = await DriveService.exportDocAsText(fileId);
        if (docText) {
          const lines = docText.split(/\r?\n/);
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || DocParserService.isNonIndicatorOrGarbage(trimmed)) continue;
            const delimiterMatch = trimmed.match(/^([^:\-\t–]+)[:\t–\-]\s*(.+)$/);
            if (delimiterMatch) {
              const indicator = delimiterMatch[1].trim();
              if (DocParserService.isNonIndicatorOrGarbage(indicator)) continue;
              const val = DocParserService.parseNumber(delimiterMatch[2]);
              if (val > 0) {
                const current = reportData.metrics.get(indicator) || 0;
                reportData.metrics.set(indicator, current + val);
              }
            }
          }

          const qual = DocParserService.extractQualitativeEvidence(docText, lines, title);
          if (qual.publications) reportData.evidence?.publications?.push(...qual.publications);
          if (qual.patents) reportData.evidence?.patents?.push(...qual.patents);
          if (qual.grants) reportData.evidence?.grants?.push(...qual.grants);
          if (qual.studentsWork) reportData.evidence?.studentsWork?.push(...qual.studentsWork);
          processedFileNames.push(title);
        }
        return;
      }

      // 5. Plain text (.txt)
      if (lowerTitle.endsWith('.txt') || mimeType.includes('text/plain')) {
        console.log(`📄 [${submission.studentName}] Читання текстового файлу: ${title}...`);
        let text = '';
        if (buffer) {
          text = buffer.toString('utf-8');
        } else if (fileId) {
          const b = await DriveService.downloadFileBuffer(fileId, title);
          if (b) text = b.toString('utf-8');
        }
        if (text) {
          const lines = text.split(/\r?\n/);
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || DocParserService.isNonIndicatorOrGarbage(trimmed)) continue;
            const delimiterMatch = trimmed.match(/^([^:\-\t–]+)[:\t–\-]\s*(.+)$/);
            if (delimiterMatch) {
              const indicator = delimiterMatch[1].trim();
              if (DocParserService.isNonIndicatorOrGarbage(indicator)) continue;
              const val = DocParserService.parseNumber(delimiterMatch[2]);
              if (val > 0) {
                const current = reportData.metrics.get(indicator) || 0;
                reportData.metrics.set(indicator, current + val);
              }
            }
          }
          processedFileNames.push(title);
        }
        return;
      }
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
            await processSingleFile(f.id, f.name, f.mimeType);
          }
        }
        // Case B: Skip zip archives per instructions
        else if (title.toLowerCase().endsWith('.zip') || mimeType.includes('zip')) {
          console.log(`ℹ️ [${submission.studentName}] Пропускаємо zip-архів відповідно до налаштувань: "${title}"`);
        }
        // Case C: Single standalone file
        else {
          await processSingleFile(attachment.id, title, mimeType);
        }
      } catch (err) {
        console.error(`⚠️ Failed to parse attachment [${attachment.title}] for ${submission.studentName}:`, err);
      }
    }

    if (processedFileNames.length > 0) {
      reportData.attachmentsList = processedFileNames.join(', ');
    }

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
    console.log(`\n📂 [Google Drive Папка Додатків] Початок обробки файлів з прикріпленої папки [${folderId}]...`);
    let filesProcessed = 0;
    let addedMetricsCount = 0;

    try {
      const files = await DriveService.listFilesInFolder(folderId, true);
      if (files.length === 0) {
        console.log(`ℹ️ [Google Drive Папка Додатків] Файлів у папці не виявлено.`);
        return { addedMetricsCount: 0, filesProcessed: 0 };
      }

      // Helper to process an individual file buffer or Drive file into teacher metrics
      const processAddonFile = async (
        fileId: string | undefined,
        title: string,
        mimeType: string,
        buffer?: Buffer
      ): Promise<void> => {
        const lowerTitle = title.toLowerCase();

        // 1. Image files (.jpeg, .jpg)
        if (lowerTitle.endsWith('.jpeg') || lowerTitle.endsWith('.jpg') || mimeType.includes('jpeg')) {
          console.log(`📸 [Папка Додатків] Знайдено фотозвіт/сертифікат: ${title}`);
          filesProcessed++;
          return;
        }

        // 2. Identify owner teacher by name in filename
        let targetTeacher = existingTeachersData.find((t) => {
          const nameParts = t.studentName.split(/[\s()]+/);
          return nameParts.some((part) => part.length > 2 && lowerTitle.includes(part.toLowerCase()));
        });

        // If not matched to an enrolled teacher, use shared departmental entry
        if (!targetTeacher) {
          let sharedEntry = existingTeachersData.find(
            (t) => t.studentName === 'Матеріали з папки додатків завдання (Google Drive)'
          );
          if (!sharedEntry) {
            sharedEntry = {
              studentName: 'Матеріали з папки додатків завдання (Google Drive)',
              studentEmail: 'drive-folder-addons@classroom.local',
              hasSubmitted: true,
              submissionState: 'TURNED_IN',
              submissionDate: new Date().toLocaleDateString('uk-UA'),
              attachmentsList: '',
              metrics: new Map<string, number>(),
              evidence: {
                publications: [],
                patents: [],
                grants: [],
                studentsWork: [],
                photos: [],
                rawNotes: [],
              },
            };
            existingTeachersData.push(sharedEntry);
          }
          targetTeacher = sharedEntry;
        }

        // 3. Native Word doc (.docx)
        if (lowerTitle.endsWith('.docx') || mimeType.includes('wordprocessingml')) {
          console.log(`📝 [Папка Додатків] Парсинг Word документа [${title}] (Викладач: ${targetTeacher.studentName})...`);
          const docBuffer = buffer || (fileId ? await DriveService.downloadFileBuffer(fileId, title) : null);
          if (docBuffer) {
            const extracted = DocParserService.extractMetricsFromDocx(docBuffer, title);
            for (const [ind, val] of extracted.entries()) {
              if (DocParserService.isNonIndicatorOrGarbage(ind)) continue;
              const current = targetTeacher.metrics.get(ind) || 0;
              targetTeacher.metrics.set(ind, current + val);
              addedMetricsCount++;
            }

            const parsedDoc = DocParserService.parseDocxBuffer(docBuffer);
            const qual = DocParserService.extractQualitativeEvidence(parsedDoc.fullText, parsedDoc.paragraphs, title);
            if (qual.publications) targetTeacher.evidence?.publications?.push(...qual.publications);
            if (qual.patents) targetTeacher.evidence?.patents?.push(...qual.patents);
            if (qual.grants) targetTeacher.evidence?.grants?.push(...qual.grants);
            if (qual.studentsWork) targetTeacher.evidence?.studentsWork?.push(...qual.studentsWork);

            targetTeacher.hasSubmitted = true;
            const currentAtts = targetTeacher.attachmentsList === 'Немає файлів' ? '' : targetTeacher.attachmentsList;
            targetTeacher.attachmentsList = currentAtts ? `${currentAtts}, ${title}` : title;
            filesProcessed++;
          }
        }
        // 4. Spreadsheet (.xlsx or Google Sheet)
        else if (lowerTitle.endsWith('.xlsx') || lowerTitle.endsWith('.csv') || mimeType.includes('spreadsheet')) {
          console.log(`📑 [Папка Додатків] Парсинг таблиці [${title}] (Викладач: ${targetTeacher.studentName})...`);
          let rows: any[][] = [];
          if (fileId && !buffer) {
            try {
              rows = await SheetsService.readSheetRows(fileId);
            } catch {
              const xlsxBuf = await DriveService.downloadFileBuffer(fileId, title);
              if (xlsxBuf) {
                rows = DocParserService.parseXlsxBuffer(xlsxBuf);
              }
            }
          } else if (buffer) {
            rows = DocParserService.parseXlsxBuffer(buffer);
          }

          for (const row of rows) {
            if (!row || row.length === 0) continue;
            let indicatorName = String(row[0] || '').trim();
            let valueColStart = 1;

            if (/^\d+$/.test(indicatorName) && row.length > 1 && String(row[1] || '').trim().length > 3) {
              indicatorName = String(row[1]).trim();
              valueColStart = 2;
            }

            if (!indicatorName || DocParserService.isNonIndicatorOrGarbage(indicatorName)) continue;

            let metricVal = 0;
            for (let c = valueColStart; c < row.length; c++) {
              const cell = row[c];
              if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
                metricVal = DocParserService.parseNumber(cell);
                if (metricVal > 0) break;
              }
            }
            if (metricVal > 0) {
              const cur = targetTeacher.metrics.get(indicatorName) || 0;
              targetTeacher.metrics.set(indicatorName, cur + metricVal);
              addedMetricsCount++;
            }
          }

          targetTeacher.hasSubmitted = true;
          const currentAtts = targetTeacher.attachmentsList === 'Немає файлів' ? '' : targetTeacher.attachmentsList;
          targetTeacher.attachmentsList = currentAtts ? `${currentAtts}, ${title}` : title;
          filesProcessed++;
        }
        // 5. Google Doc
        else if (mimeType.includes('document') && fileId) {
          console.log(`📄 [Папка Додатків] Парсинг Google Doc [${title}] (Викладач: ${targetTeacher.studentName})...`);
          const docText = await DriveService.exportDocAsText(fileId);
          if (docText) {
            const lines = docText.split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || DocParserService.isNonIndicatorOrGarbage(trimmed)) continue;
              const match = trimmed.match(/^([^:\-\t–]+)[:\t–\-]\s*(.+)$/);
              if (match) {
                const ind = match[1].trim();
                if (DocParserService.isNonIndicatorOrGarbage(ind)) continue;
                const val = DocParserService.parseNumber(match[2]);
                if (val > 0) {
                  const cur = targetTeacher.metrics.get(ind) || 0;
                  targetTeacher.metrics.set(ind, cur + val);
                  addedMetricsCount++;
                }
              }
            }
            targetTeacher.hasSubmitted = true;
            const currentAtts = targetTeacher.attachmentsList === 'Немає файлів' ? '' : targetTeacher.attachmentsList;
            targetTeacher.attachmentsList = currentAtts ? `${currentAtts}, ${title}` : title;
            filesProcessed++;
          }
        }
        // 6. Plain text (.txt)
        else if (lowerTitle.endsWith('.txt') || mimeType.includes('text/plain')) {
          console.log(`📄 [Папка Додатків] Читання текстового файлу [${title}] (Викладач: ${targetTeacher.studentName})...`);
          let text = '';
          if (buffer) {
            text = buffer.toString('utf-8');
          } else if (fileId) {
            const b = await DriveService.downloadFileBuffer(fileId, title);
            if (b) text = b.toString('utf-8');
          }
          if (text) {
            const lines = text.split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || DocParserService.isNonIndicatorOrGarbage(trimmed)) continue;
              const match = trimmed.match(/^([^:\-\t–]+)[:\t–\-]\s*(.+)$/);
              if (match) {
                const ind = match[1].trim();
                if (DocParserService.isNonIndicatorOrGarbage(ind)) continue;
                const val = DocParserService.parseNumber(match[2]);
                if (val > 0) {
                  const cur = targetTeacher.metrics.get(ind) || 0;
                  targetTeacher.metrics.set(ind, cur + val);
                  addedMetricsCount++;
                }
              }
            }
            targetTeacher.hasSubmitted = true;
            const currentAtts = targetTeacher.attachmentsList === 'Немає файлів' ? '' : targetTeacher.attachmentsList;
            targetTeacher.attachmentsList = currentAtts ? `${currentAtts}, ${title}` : title;
            filesProcessed++;
          }
        }
      };

      for (const file of files) {
        const title = file.name;
        const mimeType = file.mimeType || '';

        // Skip zip archives per user instructions
        if (title.toLowerCase().endsWith('.zip') || mimeType.includes('zip')) {
          console.log(`ℹ️ [Папка Додатків] Пропускаємо zip-архів відповідно до налаштувань: "${title}"`);
          continue;
        }

        await processAddonFile(file.id, title, mimeType);
      }

      console.log(`✅ [Google Drive Папка Додатків] Опрацьовано ${filesProcessed} файлів, додано ${addedMetricsCount} числових показників до звіту.`);
    } catch (err) {
      console.error(`⚠️ Не вдалося повністю обробити папку Google Drive [${folderId}]:`, err);
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
    const driveFolderId = assignment.driveFolderId || DriveService.extractDriveFolderId(process.env.ASSIGNMENT_ADDONS_FOLDER_URL || process.env.ASSIGNMENT_ADDONS_FOLDER_ID);
    if (driveFolderId) {
      console.log(`📁 Враховуємо додатки з прикріпленої папки Google Drive [${driveFolderId}]...`);
      await this.parseDriveFolderAddons(driveFolderId, teachersData);
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
        if (teacher.hasSubmitted) {
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
      console.error(`⚠️ Failed to load static plan rows:`, err);
    }

    // 5. Fetch static rows from "План наукової роботи кафедри"
    console.log(`🔬 Fetching static rows from "План наукової роботи кафедри" (Sheet ID: ${env.STATIC_SCI_PLAN_SHEET_ID})...`);
    let staticSciPlanRows: any[][] = [];
    try {
      staticSciPlanRows = await SheetsService.readSheetRows(env.STATIC_SCI_PLAN_SHEET_ID, 'A1:Z100');
      console.log(`✅ Loaded ${staticSciPlanRows.length} rows from "План наукової роботи кафедри"`);
    } catch (err) {
      console.error(`⚠️ Failed to load static scientific plan rows:`, err);
    }

    // 6. Generate AI Executive Summary with digested document awareness
    const missingList = teachersData.filter((t) => !t.hasSubmitted).map((t) => t.studentName);
    const submittedCount = teachersData.filter((t) => t.hasSubmitted).length;
    const collectedEvidence: DigestedTeacherEvidence[] = teachersData
      .map((t) => t.evidence as DigestedTeacherEvidence)
      .filter(Boolean);

    const aiSummary = await AIService.generateExecutiveSummary({
      assignmentTitle: assignment.title,
      totalSubmitted: submittedCount,
      totalTeachers: teachersData.length,
      missingTeachers: missingList,
      totalsByIndicator,
      statusLabel,
      digestedEvidence: collectedEvidence,
    });

    return {
      assignment,
      statusLabel,
      teachers: teachersData,
      indicators: indicatorsList,
      totalsByIndicator,
      staticPlanRows,
      staticSciPlanRows,
      aiSummary,
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

    // Row 3: B3 = 'про науково-дослідну роботу за 2026 рік'
    grid.push(['', 'про науково-дослідну роботу за 2026 рік', '']);

    // Row 4: B4 = 'кафедри_____________________________________________________'
    grid.push(['', 'кафедри_____________________________________________________', '']);

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

      const rowCells: any[] = [tRow.colA || '', tRow.colB || ''];

      // Col C: Department total sum
      if (tRow.indicatorKey) {
        const totalVal = data.totalsByIndicator.get(tRow.indicatorKey) || 0;
        if (tRow.format === '/') {
          rowCells.push(totalVal > 0 ? `${totalVal}` : '/');
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
   * grand totals, and registry of teacher submissions.
   */
  public static buildDetailGrid(data: AggregationResult): any[][] {
    const grid: any[][] = [];
    const submittedTeachers = data.teachers.filter((t) => t.hasSubmitted);

    // ==========================================
    // ROWS 1-10: HEADER & METADATA SECTION
    // ==========================================
    // Row 1
    grid.push(['ІНФОРМАЦІЯ ПРО НАУКОВО-ДОСЛІДНУ РОБОТУ КАФЕДРИ ЗА 2026 РІК (ДЕТАЛІЗАЦІЯ ПО ВИКЛАДАЧАХ)']);

    // Row 2: B2 = 'ІНФОРМАЦІЯ'
    grid.push(['', 'ІНФОРМАЦІЯ']);

    // Row 3: B3 = 'про науково-дослідну роботу за 2026 рік'
    grid.push(['', 'про науково-дослідну роботу за 2026 рік']);

    // Row 4: B4 = 'кафедри_____________________________________________________'
    grid.push(['', 'кафедри_____________________________________________________']);

    // Row 5: Metadata header (Creation Date, Deadline, Report Status, Timestamp)
    grid.push([
      '',
      `Дата появи завдання в Google Classroom: ${data.assignment.creationDateFormatted} | Дедлайн: ${data.assignment.deadlineFormatted} | Статус звіту: ${data.statusLabel} | Подано звітів: ${submittedTeachers.length} з ${data.teachers.length}`,
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

      const rowCells: any[] = [tRow.colA || '', tRow.colB || ''];

      // Col C: Department total
      if (tRow.indicatorKey) {
        const totalVal = data.totalsByIndicator.get(tRow.indicatorKey) || 0;
        if (tRow.format === '/') {
          rowCells.push(totalVal > 0 ? `${totalVal}` : '/');
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
          rowCells.push(val);
        } else {
          rowCells.push('');
        }
      }

      grid.push(rowCells);
    }

    grid.push([]); // Blank row

    // ==========================================
    // GRAND TOTAL SUM ROW
    // ==========================================
    const totalSumsRow: any[] = ['ЗАГАЛЬНА СУМА ВСІХ ЧИСЛОВИХ ПОКАЗНИКІВ', ''];
    let grandTotal = 0;
    for (const val of data.totalsByIndicator.values()) {
      grandTotal += val;
    }
    totalSumsRow.push(grandTotal);

    for (const t of submittedTeachers) {
      let teacherTotal = 0;
      for (const val of t.metrics.values()) {
        teacherTotal += val;
      }
      totalSumsRow.push(teacherTotal);
    }
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
    grid.push(['РОЗДІЛ 4. РЕЄСТР ПОДАННЯ ЗВІТІВ ТА ПРИКРІПЛЕНИХ ДОДАТКІВ (включаючи папку Google Drive)']);
    grid.push(['№', 'ПІБ Викладача / Джерело', 'Електронна пошта', 'Статус', 'Дата здачі', 'Прикріплені матеріали']);

    data.teachers.forEach((t, idx) => {
      grid.push([
        idx + 1,
        t.studentName,
        t.studentEmail || 'не вказано',
        t.hasSubmitted ? 'ПОДАНО (Враховано)' : 'НЕ ПОДАНО (Очікується)',
        t.submissionDate || '-',
        t.attachmentsList,
      ]);
    });

    if (data.aiSummary) {
      grid.push([]);
      grid.push(['АНАЛІТИЧНЕ РЕЗЮМЕ ДЛЯ НАУКОВОЇ ЧАСТИНИ ТА ЗАВІДУВАЧА КАФЕДРИ (AI Executive Summary)']);
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
