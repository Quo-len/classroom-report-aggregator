import { AIService } from '../src/services/ai.service';

console.log('🧪 Running Groq AI Service Test Suite...\n');

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

async function runTests() {
  console.log('📌 1. Testing Availability & Fallback Configuration:');
  const isAvail = AIService.isAvailable();
  console.log(`  ℹ️ Groq API Available: ${isAvail ? 'YES (Key detected)' : 'NO (Graceful fallback mode)'}`);

  // Test 1: Extract metrics with empty text
  const emptyRes = await AIService.extractMetricsFromText('', 'Проф. Шевченко');
  assert(emptyRes.size === 0, 'Empty text returns empty metrics without throwing');

  // Test 2: Fallback Executive Summary Generation
  console.log('\n📌 2. Testing Executive Summary Generation (Fallback & Live):');
  const mockTotals = new Map<string, number>();
  mockTotals.set('Розділ 3. Публікації — статті в журналах Scopus', 14);
  mockTotals.set('Розділ 3. Публікації — монографії', 3);
  mockTotals.set('Розділ 10. Авторські свідоцтва, патенти, ліцензії — кількість', 2);
  mockTotals.set('Розділ 18. Гранти та міжнародні проєкти — кількість', 1);

  const summary = await AIService.generateExecutiveSummary({
    assignmentTitle: 'Інформація про науково-дослідну роботу за 2026 рік',
    totalSubmitted: 9,
    totalTeachers: 11,
    missingTeachers: ['Доц. Петренко П. П.', 'Проф. Ковальчук В. М.'],
    totalsByIndicator: mockTotals,
    statusLabel: 'Чернетка (T-3)',
  });

  assert(typeof summary === 'string' && summary.length > 20, 'Generated summary is a non-empty string');
  assert(summary.includes('Інформація про науково-дослідну роботу') || summary.includes('звіт'), 'Summary references assignment context');
  console.log(`\n  📄 Generated Summary Preview:\n  "${summary}"\n`);

  // Test 3: Unstructured text parsing (if live Groq key present, tests LLM; otherwise tests fallback safety)
  console.log('📌 3. Testing Unstructured Narrative Extraction:');
  const narrative = `
    У 2026 календарному році мною, як доцентом кафедри, опубліковано:
    - 2 статті у виданнях, що входять до бази Scopus (журнал Applied Sciences);
    - 1 колективну монографію обсягом 6 друкованих аркушів;
    - отримано 1 патент України на корисну модель;
    - щодо грантів: інформація відсутня, заявок не подавав.
  `;

  const extracted = await AIService.extractMetricsFromText(narrative, 'Доц. Іваненко');
  assert(extracted instanceof Map, 'Extraction returns Map instance');
  if (isAvail) {
    assert(extracted.size > 0, `Groq LLM successfully extracted ${extracted.size} metrics from narrative`);
  } else {
    assert(extracted.size === 0, 'Safe fallback returns empty map when API key is not configured');
  }

  // Summary
  console.log(`\n==============================================`);
  console.log(`Results: ${passedTests}/${totalTests} tests passed (${failedTests} failed)`);
  console.log(`==============================================`);

  if (failedTests > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL GROQ AI SERVICE TESTS PASSED PERFECTLY!\n');
  }
}

runTests().catch((err) => {
  console.error('Fatal error during AI tests:', err);
  process.exit(1);
});
