/**
 * Tests for the Weekly Insights engine (trips, repeats, collections), run against the real
 * functions in app.js.
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
const consts = ['PAY_MODE_RE', 'GENERIC_REMARK_RE', 'PAID_STATUS_RE', 'SYSTEM_IN_ROW_RE', 'CHECKED_IN_STATUS_RE']
  .map(n => src.match(new RegExp('  const ' + n + ' = .*;'))[0]).join('\n');
const names = ['normalizeInvoiceNumber', 'normalizeDateString', 'getTodayDateString', 'isSameAgent', 'cleanBeatString',
  'canonicalAgentName', 'parseLogNumber', 'mapOutLogRow', 'mapInLogRow', 'extractTripNote', 'daysBetween',
  'buildBillInsights', 'getInsightsWeek', 'summarizeTrips', 'summarizeOutlets', 'summarizeBeats',
  'planBeatFor', 'tripBeatLabel', 'parseInvoiceDate', 'receiptNumbers', 'buildBillReview'];
const L = new Function(
  'const dateNormCache = new Map();\nconst State = { agents: [{ name: "Rajesh" }, { name: "Shivam" }, { name: "Self" }] };\n' +
  src.match(/  const MASTER_BEAT_PLAN = \{[\s\S]*?\n  \};/)[0] + "\nconst REVIEW_PLAN_SUFFIX = ' (beat plan)';\n" +
  consts + '\n' + names.map(extract).join('\n') + '\nreturn { ' + names.join(', ') + ' };'
)();

// Log rows in the Scan_Out_Log / Scan_In_Log column order
const out = (ts, bill, agent, party, amt, date, dueOut) => L.mapOutLogRow([ts, bill, agent, party, amt, date, dueOut, '', 'WITH_AGENT', 'Dispatched for route']);
const inn = (ts, bill, agent, dueIn, mode = 'Cash', remarks = 'Scanned at Check-IN', status = 'RECEIVED') =>
  L.mapInLogRow([ts, bill, agent, 'X', 1000, 0, dueIn, mode, '', status, '', remarks]);

let n = 0;
function test(name, fn) { fn(); console.log(`✅ ${++n}. ${name}`); }

test('Money collected on a trip = drop in due between Scan OUT and Scan IN', () => {
  const [b] = L.buildBillInsights(
    [out('2026-10-01T05:00:00Z', 'IN-FY26/27-100', 'Shivam', 'A Store', 1000, '2026-10-01', 1000)],
    [inn('2026-10-01T13:00:00Z', 'IN-FY26/27-100', 'Shivam', 600)],
    { today: '2026-10-05' });
  assert.strictEqual(b.trips.length, 1);
  assert.strictEqual(b.trips[0].collected, 400);
  assert.strictEqual(b.trips[0].outcome, 'paid');
  assert.strictEqual(b.missing, false);
});

test('Re-dispatch without Scan IN counts as "came back"; collection taken from the next dispatch', () => {
  const [b] = L.buildBillInsights([
    out('2026-10-01T05:00:00Z', 'IN-FY26/27-200', 'SHIVAM', 'B Store', 1000, '2026-10-01', 1000),
    out('2026-10-08T05:00:00Z', 'IN-FY26/27-200', 'Shivam', 'B Store', 1000, '2026-10-08', 700)
  ], [], { today: '2026-10-20' });
  assert.strictEqual(b.tripCount, 2);
  assert.strictEqual(b.trips[0].back, true);
  assert.strictEqual(b.trips[0].scanned, false);
  assert.strictEqual(b.trips[0].collected, 300);
  assert.strictEqual(b.agent, 'Shivam');
  assert.strictEqual(b.missing, true); // latest trip never came back
  assert.strictEqual(b.blocked, false); // something was collected
});

test('Blocked: 2+ trips, nothing collected, still due; reason note picked from Payment Mode', () => {
  const [b] = L.buildBillInsights([
    out('2026-10-01T05:00:00Z', 'IN-FY26/27-300', 'Rajesh Chaurasiya(OM MARKETING)', 'C Store', 900, '2026-10-01', 900),
    out('2026-10-08T05:00:00Z', 'IN-FY26/27-300', 'Rajesh', 'C Store', 900, '2026-10-08', 900)
  ], [
    inn('2026-10-01T13:00:00Z', 'IN-FY26/27-300', 'Rajesh', 900, 'dukkan band ho gyi'),
    inn('2026-10-08T13:00:00Z', 'IN-FY26/27-300', 'Rajesh', 900, 'R4732')
  ], { today: '2026-10-10' });
  assert.strictEqual(b.blocked, true);
  assert.strictEqual(b.agent, 'Rajesh');
  assert.strictEqual(b.lastNote, 'dukkan band ho gyi'); // "R4732" is a receipt, not a note
  assert.strictEqual(b.missing, false);
});

test('System "Auto-Healed" rows are not treated as scan-ins', () => {
  const [b] = L.buildBillInsights(
    [out('2026-10-01T05:00:00Z', 'IN-FY26/27-400', 'Self', 'D', 500, '2026-10-01', 500)],
    [inn('2026-10-02T13:00:00Z', 'IN-FY26/27-400', 'Self', 500, '', 'Auto-Healed: Partial on Master Sheet', 'PAID_PARTIAL')],
    { today: '2026-10-05' });
  assert.strictEqual(b.trips[0].scanned, false);
  assert.strictEqual(b.missing, true);
});

test('Live_Custody check-in marks the latest trip as back', () => {
  const [b] = L.buildBillInsights(
    [out('2026-10-01T05:00:00Z', 'IN-FY26/27-500', 'Self', 'E', 500, '2026-10-01', 500)], [],
    { today: '2026-10-05', getCustody: () => ({ status: 'RECEIVED', lastActionDate: '2026-10-01T14:00:00Z' }) });
  assert.strictEqual(b.trips[0].back, true);
  assert.strictEqual(b.missing, false);
});

test('Payment check: Scan IN reported less due than the Master Sheet shows', () => {
  const [b] = L.buildBillInsights(
    [out('2026-10-01T05:00:00Z', 'IN-FY26/27-600', 'Shivam', 'F', 1000, '2026-10-01', 1000)],
    [inn('2026-10-01T13:00:00Z', 'IN-FY26/27-600', 'Shivam', 0, 'Cash', 'Scanned at Check-IN', 'PAID_FULL')],
    { today: '2026-10-06', getMaster: () => ({ outstanding: 1000, party: 'F Store', amount: 1000 }) });
  assert.strictEqual(b.paymentCheck, true);
  assert.strictEqual(b.currentDue, 1000);
});

test('Same-day duplicate Scan OUT rows are one trip; week summary counts repeats', () => {
  const bills = L.buildBillInsights([
    out('2026-10-13T05:00:00Z', 'IN-FY26/27-700', 'Shivam', 'G', 800, '2026-10-13', 800),
    out('2026-10-13T06:00:00Z', 'IN-FY26/27-700', 'Shivam', 'G', 800, '2026-10-13', 800),
    out('2026-10-15T05:00:00Z', 'IN-FY26/27-700', 'Shivam', 'G', 800, '2026-10-15', 800)
  ], [], { today: '2026-10-18' });
  assert.strictEqual(bills[0].tripCount, 2);
  const wk = L.getInsightsWeek(0, '2026-10-18');
  assert.deepStrictEqual([wk.start, wk.end], ['2026-10-12', '2026-10-18']);
  const { total } = L.summarizeTrips(bills, wk.start, wk.end);
  assert.strictEqual(total.trips, 2);
  assert.strictEqual(total.repeats, 1);
  assert.strictEqual(total.notBack, 1);
  assert.strictEqual(total.backNoPay, 1);
});

test('Outlets group bills by party, biggest due first', () => {
  const bills = L.buildBillInsights([
    out('2026-10-01T05:00:00Z', 'IN-FY26/27-801', 'Shivam', 'Pawan kirana', 1000, '2026-10-01', 1000),
    out('2026-10-01T05:00:00Z', 'IN-FY26/27-802', 'Shivam', 'pawan  KIRANA', 500, '2026-10-01', 500),
    out('2026-10-01T05:00:00Z', 'IN-FY26/27-803', 'Rajesh', 'Other', 2000, '2026-10-01', 2000)
  ], [], { today: '2026-10-05' });
  const outlets = L.summarizeOutlets(bills, '2026-10-05');
  assert.strictEqual(outlets[0].party, 'Other');
  assert.strictEqual(outlets[1].bills.length, 2);
  assert.strictEqual(outlets[1].due, 1500);
});

test('Beats & outlets: visits, usual gap, visits since paid, and status', () => {
  const rows = [
    // Stuck outlet: 3 visits, nothing collected
    out('2026-10-01T05:00:00Z', 'IN-FY26/27-901', 'Shivam', 'Stuck Store', 1000, '2026-10-01', 1000),
    out('2026-10-08T05:00:00Z', 'IN-FY26/27-901', 'Shivam', 'Stuck Store', 1000, '2026-10-08', 1000),
    out('2026-10-15T05:00:00Z', 'IN-FY26/27-901', 'Shivam', 'Stuck Store', 1000, '2026-10-15', 1000),
    // Paying outlet: due dropped between visits
    out('2026-10-08T05:00:00Z', 'IN-FY26/27-902', 'Shivam', 'Paying Store', 1000, '2026-10-08', 1000),
    out('2026-10-15T05:00:00Z', 'IN-FY26/27-902', 'Shivam', 'Paying Store', 1000, '2026-10-15', 600),
    // Outlet on another beat, last seen long ago
    out('2026-09-01T05:00:00Z', 'IN-FY26/27-903', 'Rajesh', 'Old Store', 500, '2026-09-01', 500)
  ];
  rows[0].beat = rows[1].beat = rows[2].beat = rows[3].beat = rows[4].beat = 'Pateri';
  rows[5].beat = 'Bagha';
  const bills = L.buildBillInsights(rows, [], { today: '2026-10-20' });
  const beats = L.summarizeBeats(bills, '2026-10-20');
  const pateri = beats.find(b => b.beat === 'Pateri');
  assert.strictEqual(pateri.outlets.length, 2);
  const stuck = pateri.outlets.find(o => o.party === 'Stuck Store');
  assert.strictEqual(stuck.status, 'STUCK');
  assert.strictEqual(stuck.visitsSincePaid, 3);
  assert.strictEqual(Math.round(stuck.avgGap), 7);
  const paying = pateri.outlets.find(o => o.party === 'Paying Store');
  assert.strictEqual(paying.status, 'PAYING');
  assert.strictEqual(paying.lastPaid, '2026-10-08');
  assert.strictEqual(paying.lastPaidAmt, 400);
  assert.strictEqual(pateri.stuck, 1);
  const old = beats.find(b => b.beat === 'Bagha').outlets[0];
  assert.strictEqual(old.status, 'VISIT_DUE');
  assert.strictEqual(old.daysSinceVisit, 49);
});

test('Bill review: invoice dates, receipt numbers and the beat-plan fallback', () => {
  assert.strictEqual(L.parseInvoiceDate('22 Mar', 'IN-FY26/27-3921'), '2027-03-22'); // FY26/27: Jan-Mar fall in 2027
  assert.strictEqual(L.parseInvoiceDate('1 Oct', 'IN-FY26/27-3921'), '2026-10-01');
  assert.strictEqual(L.parseInvoiceDate('14 Mar', 'IN-17063-10205'), '2026-03-14'); // older series = FY25/26
  assert.strictEqual(L.parseInvoiceDate('', 'X'), '');
  assert.deepStrictEqual(L.receiptNumbers('R4228 + R4255 (NO VCH) r 4255'), ['R4228', 'R4255']);
  // 2026-10-20 is a Tuesday: Rajesh's plan says Civil Line Panna Naka
  assert.strictEqual(L.tripBeatLabel({ agent: 'Rajesh', date: '2026-10-20', beat: '' }), 'Civil Line Panna Naka (beat plan)');
  assert.strictEqual(L.tripBeatLabel({ agent: 'Rajesh', date: '2026-10-20', beat: 'Kothi Road Bagha' }), 'Kothi Road Bagha');
});

test('Bill review follows the agent & beat chosen in the app, not the Master Sheet', () => {
  const rows = [
    out('2026-10-13T05:00:00Z', 'IN-FY26/27-951', 'Rajesh', 'Neema', 1000, '2026-10-13', 1000),
    out('2026-10-20T05:00:00Z', 'IN-FY26/27-951', 'Rajesh', 'Neema', 1000, '2026-10-20', 600),
    out('2026-10-20T05:00:00Z', 'IN-FY26/27-952', 'Shivam', 'Other', 500, '2026-10-20', 500),
    out('2026-10-21T05:00:00Z', 'IN-FY26/27-953', 'Rajesh', 'Unknown Bill Shop', 300, '2026-10-21', 300)
  ];
  rows[3].beat = 'Kothi Road Bagha'; // recorded at Scan OUT
  const bills = L.buildBillInsights(rows, [], { today: '2026-10-22', getMaster: no => (no.endsWith('953') ? null : { outstanding: no.endsWith('951') ? 600 : 500 }) });
  // The master sheet would say another agent/beat; the review only uses the scans
  const master = no => (no.endsWith('953') ? null : { billNo: no, billDate: '1 Oct', receipt: 'R4026', agent: 'SHEET AGENT', beat: 'SHEET BEAT' });
  const all = L.buildBillReview(bills, { agent: 'Rajesh', beat: 'ALL', range: ['0000-00-00', '9999-12-31'] }, master);
  assert.deepStrictEqual(all.map(r => r.billNo).sort(), ['IN-FY26/27-951', 'IN-FY26/27-953']);
  const neema = all.find(r => r.billNo === 'IN-FY26/27-951');
  assert.strictEqual(neema.tripsTotal, 2);
  assert.strictEqual(neema.lastPaidDate, '2026-10-13'); // due dropped between the two trips
  assert.strictEqual(neema.lastPaidAmt, 400);
  assert.deepStrictEqual(neema.receipts, ['R4026']);
  assert.strictEqual(neema.invoiceDate, '2026-10-01');
  assert.strictEqual(all.find(r => r.billNo === 'IN-FY26/27-953').inMaster, false);
  const kothi = L.buildBillReview(bills, { agent: 'Rajesh', beat: 'Kothi Road Bagha', range: ['0000-00-00', '9999-12-31'] }, master);
  assert.deepStrictEqual(kothi.map(r => r.billNo), ['IN-FY26/27-953']);
  const oneDay = L.buildBillReview(bills, { agent: 'Rajesh', beat: 'ALL', range: ['2026-10-13', '2026-10-13'] }, master);
  assert.deepStrictEqual(oneDay.map(r => r.billNo), ['IN-FY26/27-951']);
});

console.log(`\n🎉 ALL ${n} INSIGHTS TESTS PASSED`);
