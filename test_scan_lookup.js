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
const names = ['normalizeInvoiceNumber', 'stripInvoicePrefix', 'expandCanonicalInvoiceNumber', 'addFuzzyCandidate', 'getUniqueFuzzyMatch',
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
  { billNo: 'IN-FY26/27-0001', party: 'First Bill Store', amount: 50, agent: 'Self' },
  { billNo: 'IN-17063-6757', party: 'Series 17063 Store', amount: 4500, agent: 'Rajesh' },
  { billNo: 'IN-FY26/27-2472', party: 'Series 2472 Store', amount: 7200, agent: 'Shivam' },
  { billNo: 'IN-FY26/27-5613', party: 'Series 5613 Store', amount: 8900, agent: 'Self' }
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

test('Last digits alone never match a voucher (full number required)', () => {
  assert.strictEqual(L.findMasterBill('3921'), null);
  assert.strictEqual(L.findMasterBill('0001'), null);
  assert.strictEqual(L.findMasterBill('FY25/26-3921'), null);
  load(master.slice(1));
  assert.strictEqual(L.findMasterBill('3965'), null);
});

test('Prefix variants of the full number still match', () => {
  assert.strictEqual(L.findMasterBill('VCH-IN-FY26/27-3921').party, 'Satguru Provision'); // scanner prefix + full number
  assert.strictEqual(L.findMasterBill('IN-FY26/27-0001').party, 'First Bill Store');
  assert.strictEqual(L.findMasterBill('in-fy26/27-0001').party, 'First Bill Store');
  assert.strictEqual(L.findMasterBill('IN FY26 27 3921').party, 'Satguru Provision');
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

const trackingSrc = fs.readFileSync(path.join(__dirname, 'apps-script-tracking', 'Code.js'), 'utf8');
const normStart = trackingSrc.indexOf('function normalizeInvNumber(');
const normalizeInvNumber = new Function(trackingSrc.slice(normStart, trackingSrc.indexOf('\n}\n', normStart) + 2) + '\nreturn normalizeInvNumber;')();

const expandStart = trackingSrc.indexOf('function expandCanonicalInvoiceNumber(');
const trackingExpandCanonical = new Function(trackingSrc.slice(expandStart, trackingSrc.indexOf('\n}\n', expandStart) + 2) + '\nreturn expandCanonicalInvoiceNumber;')();

test('Tracking sheet keeps vouchers with the same last digits apart', () => {
  assert.notStrictEqual(normalizeInvNumber('IN-FY25/26-3965'), normalizeInvNumber('IN-FY26/27-3965'));
  assert.notStrictEqual(normalizeInvNumber('IN-FY26/27-3965'), normalizeInvNumber('3965'));
  assert.strictEqual(normalizeInvNumber('in-fy26/27-3965 '), normalizeInvNumber('IN-FY26/27-3965'));
});

test('Shorthand invoice series expansion (3-XXXX, 7-XXXX, 27-XXXX)', () => {
  assert.strictEqual(L.expandCanonicalInvoiceNumber('3-6757'), 'IN-17063-6757');
  assert.strictEqual(L.expandCanonicalInvoiceNumber('7-2472'), 'IN-FY26/27-2472');
  assert.strictEqual(L.expandCanonicalInvoiceNumber('27-5613'), 'IN-FY26/27-5613');
  assert.strictEqual(L.expandCanonicalInvoiceNumber('26/27-5613'), 'IN-FY26/27-5613');
  assert.strictEqual(L.expandCanonicalInvoiceNumber('17063-6757'), 'IN-17063-6757');

  // Verify tracking sheet Google Apps Script function matches frontend exactly
  assert.strictEqual(trackingExpandCanonical('3-6757'), 'IN-17063-6757');
  assert.strictEqual(trackingExpandCanonical('7-2472'), 'IN-FY26/27-2472');
  assert.strictEqual(trackingExpandCanonical('27-5613'), 'IN-FY26/27-5613');
});

test('Shorthand lookup returns the FULL invoice bill number as main entry', () => {
  const m3 = L.findMasterBill('3-6757');
  assert.ok(m3, 'Must match Series 17063');
  assert.strictEqual(m3.billNo, 'IN-17063-6757');
  assert.strictEqual(m3.party, 'Series 17063 Store');

  const m7 = L.findMasterBill('7-2472');
  assert.ok(m7, 'Must match Series 2472');
  assert.strictEqual(m7.billNo, 'IN-FY26/27-2472');
  assert.strictEqual(m7.party, 'Series 2472 Store');

  const m27 = L.findMasterBill('27-5613');
  assert.ok(m27, 'Must match Series 5613');
  assert.strictEqual(m27.billNo, 'IN-FY26/27-5613');
  assert.strictEqual(m27.party, 'Series 5613 Store');
});

test('Enrich parsed bill replaces shorthand with FULL invoice bill number', () => {
  const p3 = L.enrichWithMaster(L.parseQRCodeData('3-6757'));
  assert.strictEqual(p3.billNo, 'IN-17063-6757', 'billNo must be promoted to full canonical bill number');
  assert.strictEqual(p3.party, 'Series 17063 Store');
  assert.strictEqual(p3.amount, 4500);

  const p7 = L.enrichWithMaster(L.parseQRCodeData('7-2472'));
  assert.strictEqual(p7.billNo, 'IN-FY26/27-2472', 'billNo must be promoted to full canonical bill number');
  assert.strictEqual(p7.party, 'Series 2472 Store');
  assert.strictEqual(p7.amount, 7200);

  const p27 = L.enrichWithMaster(L.parseQRCodeData('27-5613'));
  assert.strictEqual(p27.billNo, 'IN-FY26/27-5613', 'billNo must be promoted to full canonical bill number');
  assert.strictEqual(p27.party, 'Series 5613 Store');
  assert.strictEqual(p27.amount, 8900);
});

console.log(`\n🎉 ALL ${n} SCAN LOOKUP TESTS PASSED`);
