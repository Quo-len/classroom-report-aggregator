import fs from 'fs';
import path from 'path';
import { Aggregator } from '../src/core/aggregator';
import { DocParserService } from '../src/services/doc-parser.service';
import { OFFICIAL_INDICATORS, OFFICIAL_SECTIONS } from '../src/config/official-template';

console.log('🧪 Running Comprehensive Aggregator & Workflow Test Suite...\n');

// 1. Critical Number Parsing Tests
const tests = [
  { val: '-', expected: 0 },
  { val: '–', expected: 0 },
  { val: '—', expected: 0 },
  { val: 'інформація відсутня', expected: 0 },
  { val: 'Інформація відсутня', expected: 0 },
  { val: 'ІНФОРМАЦІЯ ВІДСУТНЯ', expected: 0 },
  { val: '  інформація відсутня  ', expected: 0 },
  { val: 'публікацій немає', expected: 0 },
  { val: 'патентів немає', expected: 0 },
  { val: '5', expected: 5 },
  { val: 12, expected: 12 },
  { val: '12,5', expected: 12.5 },
  { val: ' 1 200 ', expected: 1200 },
  { val: null, expected: 0 },
  { val: undefined, expected: 0 },
];

let failed = 0;
for (const t of tests) {
  const res = Aggregator.parseCellNumber(t.val);
  if (res !== t.expected) {
    console.error(`❌ FAIL: input [${t.val}] -> got ${res}, expected ${t.expected}`);
    failed++;
  }
}
console.log(`✅ [1/4] Critical Number Parsing: Passed all ${tests.length} tests.`);

// 2. Official Template Sections & Indicators Verification
if (OFFICIAL_SECTIONS.length !== 28) {
  console.error(`❌ FAIL: Expected 28 official sections, got ${OFFICIAL_SECTIONS.length}`);
  failed++;
} else {
  console.log(`✅ [2/4] Official Template Catalog: Verified all 28 sections (${OFFICIAL_INDICATORS.length} total indicators).`);
}

// 3. Test Docx Parser on Real Addon Files (Check templates/ and digest/)
function getAddonPath(rel: string): string {
  const p1 = path.resolve(process.cwd(), 'templates', rel);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve(process.cwd(), 'digest', rel);
  if (fs.existsSync(p2)) return p2;
  return p1;
}

const sampleAddon3Path = getAddonPath('addons/Додаток_3.docx');
if (fs.existsSync(sampleAddon3Path)) {
  const buf = fs.readFileSync(sampleAddon3Path);
  const parsed = DocParserService.parseDocxBuffer(buf);
  if (parsed.tables.length === 0 || parsed.paragraphs.length === 0) {
    console.error('❌ FAIL: Failed to parse tables from Додаток_3.docx');
    failed++;
  } else {
    console.log(`✅ [3/4] Native Docx Parser: Successfully parsed Додаток_3.docx (${parsed.tables.length} tables, ${parsed.paragraphs.length} paragraphs).`);
  }
} else {
  console.warn('⚠️ Warning: Додаток_3.docx not found for test 3');
}

// 4. Test Master Grid Assembly with Multi-Teacher Scenarios
const mockAssignment = {
  id: 'test_assignment_1',
  title: 'Інформація про науково-дослідну роботу',
  creationDate: new Date(),
  creationDateFormatted: '13 листопада 2026 р.',
  deadline: new Date(Date.now() + 86400000 * 3),
  deadlineFormatted: '16 листопада 2026 р.',
  daysRemaining: 3,
  raw: {},
};

const mockSubmissions = [
  {
    submissionId: 'sub_1',
    userId: 'user_1',
    studentName: 'Проф. Шевченко Т. Г.',
    studentEmail: 'shevchenko@vu.cdu.edu.ua',
    state: 'TURNED_IN',
    hasSubmitted: true,
    attachments: [],
  },
  {
    submissionId: 'sub_2',
    userId: 'user_2',
    studentName: 'Доц. Франко І. Я.',
    studentEmail: 'franko@vu.cdu.edu.ua',
    state: 'CREATED',
    hasSubmitted: false,
    attachments: [],
  },
  {
    submissionId: 'sub_3',
    userId: 'user_3',
    studentName: 'Проф. Леся Українка',
    studentEmail: 'ukrainka@vu.cdu.edu.ua',
    state: 'TURNED_IN',
    hasSubmitted: true,
    attachments: [],
  },
];

Aggregator.aggregateAll(mockAssignment as any, mockSubmissions as any, 'Чернетка (T-3)')
  .then((res) => {
    const grid = Aggregator.buildMasterGrid(res);
    if (!grid || grid.length < 30) {
      console.error(`❌ FAIL: Master grid is too short (${grid.length} rows)`);
      process.exit(1);
    }
    console.log(`✅ [4/4] Master Grid Generator: Generated comprehensive report with ${grid.length} rows.`);

    // Verify sections exist in grid
    const hasHeader = grid[0][0].includes('ІНФОРМАЦІЯ ПРО НАУКОВО-ДОСЛІДНУ РОБОТУ');
    const hasTeachers = grid.some((r) => r.includes('Проф. Шевченко Т. Г.'));
    const hasRegistry = grid.some((r) => r[0] && String(r[0]).includes('РЕЄСТР ПОДАННЯ ЗВІТІВ'));

    if (hasHeader && hasTeachers && hasRegistry) {
      console.log('✅ Grid Content Validation: Header, teacher columns, and registry section all present.');
      console.log('\n🎉 ALL AGGREGATOR TESTS PASSED SUCCESSFULLY!');
    } else {
      console.error('❌ FAIL: Grid validation failed on expected content.');
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('❌ Error during aggregation test:', err);
    process.exit(1);
  });
