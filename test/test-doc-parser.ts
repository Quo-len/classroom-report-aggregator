import fs from 'fs';
import path from 'path';
import { DocParserService } from '../src/services/doc-parser.service';

console.log('🧪 Running Deep DocParser & Edge Cases Test Suite...\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
  }
}

// ==========================================
// 1. Homoglyphs & Extreme Edge Cases in Numbers
// ==========================================
console.log('📌 1. Testing Number Parsing & Homoglyphs:');

// Dashes
assert(DocParserService.parseNumber('-') === 0, 'Standard hyphen "-" is 0');
assert(DocParserService.parseNumber('–') === 0, 'En-dash "–" is 0');
assert(DocParserService.parseNumber('—') === 0, 'Em-dash "—" is 0');
assert(DocParserService.parseNumber('−') === 0, 'Minus sign "−" is 0');
assert(DocParserService.parseNumber('―') === 0, 'Horizontal bar "―" is 0');

// "інформація відсутня" variations (Ukrainian vs English 'i', upper/lower, spaces)
assert(DocParserService.parseNumber('інформація відсутня') === 0, 'Standard ukrainian "інформація відсутня"');
assert(DocParserService.parseNumber('Інформація відсутня') === 0, 'Capitalized "Інформація відсутня"');
assert(DocParserService.parseNumber('ІНФОРМАЦІЯ ВІДСУТНЯ') === 0, 'All-caps "ІНФОРМАЦІЯ ВІДСУТНЯ"');
assert(DocParserService.parseNumber('  інформація   відсутня  ') === 0, 'Padded "  інформація   відсутня  "');
assert(DocParserService.parseNumber('информация отсутствует') === 0, 'Russian "информация отсутствует"');
assert(DocParserService.parseNumber('інформація відсутнє') === 0, 'Neutral "інформація відсутнє"');
assert(DocParserService.parseNumber('інформація відсутні') === 0, 'Plural "інформація відсутні"');
assert(DocParserService.parseNumber('публікацій немає') === 0, 'Absence "публікацій немає"');
assert(DocParserService.parseNumber('патентів немає') === 0, 'Absence "патентів немає"');
assert(DocParserService.parseNumber('немає') === 0, 'Single word "немає"');
assert(DocParserService.parseNumber('n/a') === 0, 'Latin "n/a"');
assert(DocParserService.parseNumber('N/D') === 0, 'Latin "N/D"');
assert(DocParserService.parseNumber('none') === 0, 'Latin "none"');
assert(DocParserService.parseNumber('0') === 0, 'String "0"');
assert(DocParserService.parseNumber(0) === 0, 'Numeric 0');
assert(DocParserService.parseNumber(null) === 0, 'null is 0');
assert(DocParserService.parseNumber(undefined) === 0, 'undefined is 0');

// Valid numbers and formatting
assert(DocParserService.parseNumber('42') === 42, 'Integer "42"');
assert(DocParserService.parseNumber('14,8') === 14.8, 'Comma decimal "14,8"');
assert(DocParserService.parseNumber('14.8') === 14.8, 'Dot decimal "14.8"');
assert(DocParserService.parseNumber('1 250') === 1250, 'Space thousand separator "1 250"');
assert(DocParserService.parseNumber('1\u00A0500,75') === 1500.75, 'NBSP thousand separator "1 500,75"');
assert(DocParserService.parseNumber('3 / 15.2') === 3, 'Compound format "3 / 15.2" extracts count 3');
assert(DocParserService.parseNumber('7/14') === 7, 'Compact compound format "7/14" extracts count 7');

// ==========================================
// 2. Excel Column Letter Indexing
// ==========================================
console.log('\n📌 2. Testing Column Index Conversion:');
assert(DocParserService.colLetterToIndex('A') === 0, 'Col A -> index 0');
assert(DocParserService.colLetterToIndex('B') === 1, 'Col B -> index 1');
assert(DocParserService.colLetterToIndex('Z') === 25, 'Col Z -> index 25');
assert(DocParserService.colLetterToIndex('AA') === 26, 'Col AA -> index 26');

// ==========================================
// 3. Real Addon DOCX Files Verification
// ==========================================
console.log('\n📌 3. Testing Real DOCX Files from templates/addons:');

function findTemplatePath(rel: string): string {
  const p1 = path.resolve(process.cwd(), 'templates', rel);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve(process.cwd(), 'digest', rel);
  if (fs.existsSync(p2)) return p2;
  return p1;
}

// Test Додаток 1 (Staff roster)
const addon1Path = findTemplatePath('addons/Додаток_1.docx');
if (fs.existsSync(addon1Path)) {
  const buf = fs.readFileSync(addon1Path);
  const parsed = DocParserService.parseDocxBuffer(buf);
  assert(parsed.tables.length > 0, 'Додаток 1 has at least 1 table');
  assert(parsed.fullText.includes('професорсько-викладацького складу'), 'Додаток 1 contains title text');
} else {
  console.warn(`  ⚠️ Skipped: ${addon1Path} not found`);
}

// Test Додаток 3 (Publications)
const addon3Path = findTemplatePath('addons/Додаток_3.docx');
if (fs.existsSync(addon3Path)) {
  const buf = fs.readFileSync(addon3Path);
  const parsed = DocParserService.parseDocxBuffer(buf);
  assert(parsed.tables.length > 0, 'Додаток 3 has at least 1 table');
  const normalizedText = parsed.fullText.replace(/\s+/g, ' ');
  assert(normalizedText.includes('Список опублікованих монографій'), 'Додаток 3 contains publications title');
  const metrics = DocParserService.extractMetricsFromDocx(buf, 'Додаток_3.docx');
  assert(metrics instanceof Map, 'DocParserService returns Map for Додаток 3');
} else {
  console.warn(`  ⚠️ Skipped: ${addon3Path} not found`);
}

// Test Додаток 10 (Patents)
const addon10Path = findTemplatePath('addons/Додаток_10.docx');
if (fs.existsSync(addon10Path)) {
  const buf = fs.readFileSync(addon10Path);
  const parsed = DocParserService.parseDocxBuffer(buf);
  assert(parsed.tables.length > 0, 'Додаток 10 has at least 1 table');
  assert(parsed.fullText.includes('патенти'), 'Додаток 10 mentions patents');
} else {
  console.warn(`  ⚠️ Skipped: ${addon10Path} not found`);
}

// Test Додаток 18 (Grants)
const addon18Path = findTemplatePath('addons/Додаток_18.docx');
if (fs.existsSync(addon18Path)) {
  const buf = fs.readFileSync(addon18Path);
  const parsed = DocParserService.parseDocxBuffer(buf);
  assert(parsed.tables.length > 0, 'Додаток 18 has at least 1 table');
  assert(parsed.fullText.includes('Гранти'), 'Додаток 18 mentions grants');
} else {
  console.warn(`  ⚠️ Skipped: ${addon18Path} not found`);
}

// ==========================================
// 4. Real XLSX Master Template Verification
// ==========================================
console.log('\n📌 4. Testing Master Blank XLSX Parsing:');
const excelBlankPath = findTemplatePath('2_Інформ._про_наук.роб_(бланк)_2026.xlsx');
if (fs.existsSync(excelBlankPath)) {
  const buf = fs.readFileSync(excelBlankPath);
  const grid = DocParserService.parseXlsxBuffer(buf);
  assert(grid.length > 50, `Parsed XLSX has ${grid.length} rows (expected > 50)`);

  // Check header text in cell B2/B3/B4
  const hasInfoTitle = grid.some((r) => r.some((c) => c.includes('ІНФОРМАЦІЯ')));
  assert(hasInfoTitle, 'Parsed XLSX contains "ІНФОРМАЦІЯ" header');

  const hasScopusRow = grid.some((r) => r.some((c) => c.includes('Scopus')));
  assert(hasScopusRow, 'Parsed XLSX contains "Scopus" row');
} else {
  console.warn(`  ⚠️ Skipped: ${excelBlankPath} not found`);
}

// ==========================================
// 5. Corrupted / Invalid Buffer Resilience
// ==========================================
console.log('\n📌 5. Testing Fault Tolerance & Resilience on Bad Buffers:');
const emptyBuffer = Buffer.from('');
const garbageBuffer = Buffer.from('This is not a zip or xml file at all, just garbage bytes 1234567890');

const resEmpty = DocParserService.parseDocxBuffer(emptyBuffer);
assert(resEmpty.tables.length === 0 && resEmpty.paragraphs.length === 0, 'Empty buffer returns clean empty result without throwing');

const resGarbage = DocParserService.parseDocxBuffer(garbageBuffer);
assert(resGarbage.tables.length === 0 && resGarbage.paragraphs.length === 0, 'Garbage buffer returns clean empty result without throwing');

const metricsGarbage = DocParserService.extractMetricsFromDocx(garbageBuffer, 'corrupted.docx');
assert(metricsGarbage.size === 0, 'Corrupted buffer returns empty metrics without throwing');

const xlsxGarbage = DocParserService.parseXlsxBuffer(garbageBuffer);
assert(xlsxGarbage.length === 0, 'Corrupted xlsx buffer returns empty grid without throwing');

// ==========================================
// 6. Testing Ready-Made Manual Test Docs (test/docs)
// ==========================================
console.log('\n📌 6. Testing Ready-Made Manual Test Docs (test/docs):');
const ivanenkoDocxPath = path.resolve('test/docs/01_Викладач_Іваненко_О_В/Додаток_3_Публікації_Іваненко.docx');
if (fs.existsSync(ivanenkoDocxPath)) {
  const buf = fs.readFileSync(ivanenkoDocxPath);
  const parsed = DocParserService.parseDocxBuffer(buf);
  assert(parsed.paragraphs.length > 0, 'Ivanenko test docx has extracted paragraphs');
  assert(parsed.tables.length > 0, 'Ivanenko test docx has extracted table');
}

const sydorenkoDocxPath = path.resolve('test/docs/03_Доцент_Сидоренко_А_П_нулі_та_прочерки/Додаток_3_Публікації_Сидоренко_прочерки.docx');
if (fs.existsSync(sydorenkoDocxPath)) {
  const buf = fs.readFileSync(sydorenkoDocxPath);
  const parsed = DocParserService.parseDocxBuffer(buf);
  const allText = parsed.paragraphs.join(' ');
  assert(allText.includes('інформація відсутня') || allText.includes('-'), 'Sydorenko docx contains dash or "інформація відсутня"');
}

const petrenkoXlsxPath = path.resolve('test/docs/02_Професор_Петренко_В_М/2_Інформ._про_наук.роб_(заповнений_Петренко).xlsx');
if (fs.existsSync(petrenkoXlsxPath)) {
  const buf = fs.readFileSync(petrenkoXlsxPath);
  const grid = DocParserService.parseXlsxBuffer(buf);
  assert(grid.length > 50, 'Petrenko test xlsx contains full table grid');
}

// Summary
console.log(`\n==============================================`);
console.log(`Results: ${passedTests}/${totalTests} tests passed (${failedTests} failed)`);
console.log(`==============================================`);

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL EXTENDED DOC-PARSER TESTS PASSED PERFECTLY!\n');
}
