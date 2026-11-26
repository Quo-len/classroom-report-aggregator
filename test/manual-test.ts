import fs from 'fs';
import path from 'path';
import { DocParserService } from '../src/services/doc-parser.service';
import { AIService } from '../src/services/ai.service';
import { OFFICIAL_INDICATORS, OFFICIAL_SECTIONS } from '../src/config/official-template';
import { Aggregator } from '../src/core/aggregator';
import { CourseAssignment, StudentSubmissionItem } from '../src/services/classroom.service';

/**
 * Manual Testing CLI Utility
 * Demonstrates and verifies the end-to-end parsing, AI extraction,
 * aggregation, and report generation using local files in test/docs.
 */
async function runManualTest() {
  console.log('================================================================');
  console.log('   🧪 РУЧНЕ ТЕСТУВАННЯ СИСТЕМИ (MANUAL TESTING PIPELINE)');
  console.log('================================================================\n');

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) process.env.GROQ_API_KEY = '';
  const docsDir = path.resolve('test/docs');
  if (!fs.existsSync(docsDir)) {
    console.error(`❌ Папку з тестовими документами не знайдено: ${docsDir}`);
    process.exit(1);
  }

  // 1. Teacher Submissions Simulation
  console.log('📂 1. Завантаження та парсинг файлів викладачів із test/docs/:');

  const teachers = [
    {
      name: 'Іваненко Олександр Васильович',
      email: 'ivanenko@univ.edu.ua',
      folder: '01_Викладач_Іваненко_О_В',
      files: [
        'Додаток_3_Публікації_Іваненко.docx',
        'Додаток_10_Патенти_Іваненко.docx',
        'Сертифікат_конференції_Scopus_2026.jpeg',
      ],
    },
    {
      name: 'Петренко Василь Миколайович',
      email: 'petrenko@univ.edu.ua',
      folder: '02_Професор_Петренко_В_М',
      files: [
        'Додаток_1_Монографії_Петренко.docx',
        'Додаток_18_Гранти_Петренко.docx',
        '2_Інформ._про_наук.роб_(заповнений_Петренко).xlsx',
        'Диплом_наукового_керівника_Петренко.jpeg',
      ],
    },
    {
      name: 'Сидоренко Андрій Петрович',
      email: 'sydorenko@univ.edu.ua',
      folder: '03_Доцент_Сидоренко_А_П_нулі_та_прочерки',
      files: [
        'Додаток_3_Публікації_Сидоренко_прочерки.docx',
        'Додаток_10_Патенти_Сидоренко_відсутні.docx',
      ],
    },
    {
      name: 'Ковальчук Ігор Іванович',
      email: 'kovalchuk@univ.edu.ua',
      folder: '04_Асистент_Ковальчук_І_І_текстовий_звіт_ШІ',
      files: [
        'Звіт_Ковальчук_наукова_робота_2026.docx',
        'Фото_доповіді_на_семінарі.jpeg',
      ],
    },
    {
      name: 'Мельник Тетяна Сергіївна',
      email: 'melnyk@univ.edu.ua',
      folder: null, // Did not submit (T-3 warning target)
      files: [],
    },
  ];

  const teacherMetricsMap = new Map<string, Map<string, number>>();
  const collectedJpegs: string[] = [];

  for (const t of teachers) {
    const combinedMetrics = new Map<string, number>();

    if (!t.folder || t.files.length === 0) {
      console.log(`  ⚪ [Не здав] ${t.name} (очікує нагадування)`);
      teacherMetricsMap.set(t.name, combinedMetrics);
      continue;
    }

    console.log(`  🟢 [Обробка] ${t.name}:`);
    for (const f of t.files) {
      const filePath = path.join(docsDir, t.folder, f);
      if (!fs.existsSync(filePath)) {
        console.warn(`    ⚠️ Файл не знайдено: ${f}`);
        continue;
      }

      if (f.toLowerCase().endsWith('.jpeg') || f.toLowerCase().endsWith('.jpg')) {
        collectedJpegs.push(`${t.name}: ${f}`);
        console.log(`    📸 [JPEG фотозвіт] ${f} (додано до переліку відправки)`);
        continue;
      }

      const buf = fs.readFileSync(filePath);
      let metrics = new Map<string, number>();

      if (f.endsWith('.docx')) {
        metrics = DocParserService.extractMetricsFromDocx(buf, f);

        // If it's narrative text, test AI extraction
        if (f.includes('Ковальчук')) {
          console.log(`    🤖 [Groq AI] Аналіз неструктурованого тексту для ${t.name}...`);
          const text = DocParserService.parseDocxBuffer(buf).fullText;
          const aiMetrics = await AIService.extractMetricsFromText(text, t.name);
          for (const [k, v] of aiMetrics.entries()) {
            metrics.set(k, (metrics.get(k) || 0) + v);
          }
        }
      } else if (f.endsWith('.xlsx')) {
        const rows = DocParserService.parseXlsxBuffer(buf);
        metrics = Aggregator.metricsFromRows(rows);
      }

      for (const [key, val] of metrics.entries()) {
        combinedMetrics.set(key, (combinedMetrics.get(key) || 0) + val);
      }
      console.log(`    📄 [Парсинг] ${f} -> знайдено показників: ${metrics.size}`);
    }

    teacherMetricsMap.set(t.name, combinedMetrics);
  }

  // 2. Critical Number Parsing Verification
  console.log('\n🔍 2. Перевірка критичного правила обробки прочерків ("-") та відсутності даних:');
  const dashTest = Aggregator.parseCellNumber('-');
  const absentTest = Aggregator.parseCellNumber('інформація відсутня');
  const zeroTest = Aggregator.parseCellNumber('0');
  const noneTest = Aggregator.parseCellNumber('немає');

  console.log(`  - Значення "-" -> ${dashTest} (очікувалось: 0) ${dashTest === 0 ? '✅' : '❌'}`);
  console.log(`  - Значення "інформація відсутня" -> ${absentTest} (очікувалось: 0) ${absentTest === 0 ? '✅' : '❌'}`);
  console.log(`  - Значення "немає" -> ${noneTest} (очікувалось: 0) ${noneTest === 0 ? '✅' : '❌'}`);
  console.log(`  - Значення "0" -> ${zeroTest} (очікувалось: 0) ${zeroTest === 0 ? '✅' : '❌'}`);

  // 3. Totals Aggregation
  console.log('\n📊 3. Розрахунок підсумкових показників кафедри (Totals by Indicator):');
  const totalsByIndicator = new Map<string, number>();
  for (const ind of OFFICIAL_INDICATORS) {
    let sum = 0;
    for (const t of teachers) {
      const val = teacherMetricsMap.get(t.name)?.get(ind) || 0;
      sum += val;
    }
    totalsByIndicator.set(ind, sum);
  }

  // Also include any valid custom indicators extracted
  const allIndicatorsSet = new Set<string>(OFFICIAL_INDICATORS);
  for (const t of teachers) {
    const m = teacherMetricsMap.get(t.name);
    if (m) {
      for (const [k, v] of m.entries()) {
        if (!DocParserService.isNonIndicatorOrGarbage(k)) {
          allIndicatorsSet.add(k);
          totalsByIndicator.set(k, (totalsByIndicator.get(k) || 0) + v);
        }
      }
    }
  }
  const fullIndicatorsList = Array.from(allIndicatorsSet);

  let nonZeroCount = 0;
  for (const [ind, total] of totalsByIndicator.entries()) {
    if (total > 0) {
      console.log(`  • ${ind}: ${total}`);
      nonZeroCount++;
    }
  }
  if (nonZeroCount === 0) {
    console.log('  • Поки що всі зведені числові показники дорівнюють 0.');
  }

  // 4. AI Executive Summary Generation
  console.log('\n🤖 4. Генерація аналітичного резюме кафедри через Groq AI:');
  const submittedTeachers = teachers.filter((t) => t.files.length > 0);
  const missingTeachers = teachers.filter((t) => t.files.length === 0).map((t) => t.name);

  const teacherEvidenceList: any[] = [];
  for (const t of teachers) {
    if (t.folder) {
      for (const f of t.files) {
        if (f.endsWith('.docx')) {
          const filePath = path.join(docsDir, t.folder, f);
          const buf = fs.readFileSync(filePath);
          const parsed = DocParserService.parseDocxBuffer(buf);
          const qual = DocParserService.extractQualitativeEvidence(parsed.fullText, parsed.paragraphs, f);
          teacherEvidenceList.push(qual);
        }
      }
    }
  }

  const aiSummary = await AIService.generateExecutiveSummary({
    assignmentTitle: 'Інформація про науково-дослідну роботу за 2026 рік',
    totalSubmitted: submittedTeachers.length,
    totalTeachers: teachers.length,
    missingTeachers,
    totalsByIndicator,
    statusLabel: 'Попередній звіт (Т-3)',
    digestedEvidence: teacherEvidenceList,
  });

  console.log(`  Резюме:\n  "${aiSummary}"\n`);

  // 5. Build Master Grid Preview
  console.log('📑 5. Формування підсумкової матриці Google Sheets (88+ рядків):');
  const mockAssignment: CourseAssignment = {
    id: 'manual-test-assign-1',
    title: 'Інформація про науково-дослідну роботу за 2026 рік',
    creationDate: new Date(),
    creationDateFormatted: '10.11.2026',
    deadline: new Date(Date.now() + 86400000 * 3),
    deadlineFormatted: '16.11.2026 23:59',
    daysRemaining: 3,
    raw: {},
  };

  const grid = Aggregator.buildMasterGrid({
    assignment: mockAssignment,
    statusLabel: 'Чернетка (T-3)',
    teachers: teachers.map((t) => ({
      studentName: t.name,
      studentEmail: t.email,
      hasSubmitted: t.files.length > 0,
      submissionState: t.files.length > 0 ? 'TURNED_IN' : 'CREATED',
      attachmentsList: t.files.join(', ') || 'Немає файлів',
      metrics: teacherMetricsMap.get(t.name) || new Map(),
    })),
    indicators: fullIndicatorsList,
    totalsByIndicator,
    staticPlanRows: [
      ['СТАТИЧНІ ДАНІ', 'План роботи кафедри на 2026 рік (рядок 1)', 'Виконано'],
      ['СТАТИЧНІ ДАНІ', 'План роботи кафедри на 2026 рік (рядок 2)', 'У процесі'],
    ],
    staticSciPlanRows: [
      ['СТАТИЧНІ ДАНІ', 'План наукової роботи кафедри на 2026 рік (НДР № 0122U)', '100%'],
    ],
    aiSummary,
  });

  console.log(`  ✅ Згенеровано рядків у таблиці: ${grid.length}`);
  console.log(`  ✅ Виявлено JPEG додатків для надсилання: ${collectedJpegs.length}`);
  for (const j of collectedJpegs) {
    console.log(`     - ${j}`);
  }

  // Save preview to test/docs/PREVIEW_REPORT.txt
  const previewPath = path.join(docsDir, 'PREVIEW_REPORT.txt');
  const previewLines = grid.map((row) => row.join('\t')).join('\n');
  if (!dryRun) fs.writeFileSync(previewPath, previewLines, 'utf-8');
  if (!dryRun) console.log(`  💾 Текстовий зразок звіту збережено у: ${previewPath}`);

  console.log('\n================================================================');
  console.log('   🎉 РУЧНЕ ТЕСТУВАННЯ УСПІШНО ЗАВЕРШЕНО БЕЗ ПОМИЛОК!');
  console.log('================================================================\n');
}

runManualTest().catch((err) => {
  console.error('Помилка під час ручного тестування:', err);
  process.exit(1);
});
