import { Aggregator } from '../src/core/aggregator';

const tests = [
  { val: '-', expected: 0 },
  { val: '–', expected: 0 },
  { val: '—', expected: 0 },
  { val: 'інформація відсутня', expected: 0 },
  { val: 'Інформація відсутня', expected: 0 },
  { val: 'ІНФОРМАЦІЯ ВІДСУТНЯ', expected: 0 },
  { val: '  інформація відсутня  ', expected: 0 },
  { val: '5', expected: 5 },
  { val: 12, expected: 12 },
  { val: '12,5', expected: 12.5 },
  { val: ' 1 200 ', expected: 1200 },
  { val: null, expected: 0 },
  { val: undefined, expected: 0 }
];

let failed = 0;
for (const t of tests) {
  const res = Aggregator.parseCellNumber(t.val);
  if (res !== t.expected) {
    console.error(`❌ FAIL: input [${t.val}] -> got ${res}, expected ${t.expected}`);
    failed++;
  }
}

if (failed === 0) {
  console.log(`✅ All ${tests.length} test assertions passed!`);
} else {
  console.error(`❌ ${failed} tests failed!`);
  process.exit(1);
}
