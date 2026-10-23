/**
 * Regression tests for scan -> Master Sheet lookup, run against the real functions in app.js
 * (test_suite.js tests its own copies). Guards against scans showing another bill's party/amount.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function extract(name) {
  const start = src.indexOf('  function ' + name + '(');
  if (start < 0) throw new Error('Function not found in app.js: ' + name);
  let i = src.indexOf(') {', start) + 2, depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
const names = ['normalizeInvoiceNumber', 'stripInvoicePrefix', 'addFuzzyCandidate', 'getUniqueFuzzyMatch',
  'registerBillInMap', 'isBillPaidInFull', 'rebuildMasterSheetMap', 'findMasterBill', 'buildParsedBill',
  'parseQRCodeData', 'enrichWithMaster'];
const L = new Function(
  'const State = { masterSheetMap: new Map(), masterSheetFuzzyMap: new Map(), masterSheetBills: [], bills: [] };\n' +
  names.map(extract).join('\n') + '\nreturn { State, ' + names.join(', ') + ' };'
)();

function load(bills) {
  L.State.masterSheetBills = bills.map(b => ({ ...b }));
  L.rebuildMasterSheetMap();
}
const master = [
  { billNo: '3965', party: 'Old Series Party', amount: 100, agent: 'Rajesh' },
  { billNo: 'IN-FY25/26-3965', party: 'Last Year Store', amount: 200, agent: 'Shivam' },
  { billNo: 'IN-FY26/27-3965', party: 'Correct Store', amount: 300, agent: 'Rajesh' },
  { billNo: 'IN-FY26/27-5465', party: 'Random Store', amount: 999, agent: 'Shivam' },
  { billNo: 'IN-FY26/27-3921', party: 'Satguru Provision', amount: 5465, agent: 'Rajesh' },
  { billNo: 'IN-FY26/27-0001', party: 'First Bill Store', amount: 50, agent: 'Self' }
];
let n = 0;
function test(name, fn) { load(master); fn(); console.log(`✅ ${++n}. ${name}`); }

test('Exact invoice number is never overwritten by another bill\'s suffix', () => {
  assert.strictEqual(L.findMasterBill('3965').party, 'Old Series Party');
  assert.strictEqual(L.findMasterBill('IN-FY25/26-3965').party, 'Last Year Store');
  assert.strictEqual(L.findMasterBill('IN-FY26/27-3965').party, 'Correct Store');
});

test('Formatting differences and missing prefix still match', () => {
  assert.strictEqual(L.findMasterBill('in fy26 27 3965').party, 'Correct Store');
  assert.strictEqual(L.findMasterBill('FY26/27-3965').party, 'Correct Store');
});

test('Unique short number still matches', () => {
  assert.strictEqual(L.findMasterBill('3921').party, 'Satguru Provision');
  assert.strictEqual(L.findMasterBill('0001').party, 'First Bill Store');
});

test('Ambiguous short number returns no match instead of guessing', () => {
  load(master.slice(1));
  assert.strictEqual(L.findMasterBill('3965'), null);
});

test('CSV QR digits (amount) do not match a different bill', () => {
  const r = L.parseQRCodeData('IN-FY26/27-3921,Satguru Provision,5465');
  assert.strictEqual(r.billNo, 'IN-FY26/27-3921');
  assert.strictEqual(r.party, 'Satguru Provision');
  assert.strictEqual(r.amount, 5465);
});

test('Unknown bill QR keeps its own party instead of a random sheet bill', () => {
  const r = L.enrichWithMaster(L.parseQRCodeData('IN-FY26/27-8888,New Party,13965'));
  assert.strictEqual(r.party, 'New Party');
  assert.strictEqual(r.fromMaster, false);
});

test('Multi-line QR: "Bill Amount" / "Invoice Date" do not overwrite the invoice number', () => {
  const r = L.parseQRCodeData('Invoice No: IN-FY26/27-3921\nInvoice Date: 12/05/2026\nBill Amount: 5,465\nParty Name: Satguru');
  assert.strictEqual(r.billNo, 'IN-FY26/27-3921');
  assert.strictEqual(r.party, 'Satguru Provision');
});

console.log(`\n🎉 ALL ${n} SCAN LOOKUP TESTS PASSED`);
