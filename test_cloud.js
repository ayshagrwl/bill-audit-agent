/**
 * Tests for the Firebase (Firestore) mapping in app.js: queued scans -> log documents,
 * custody change detection, and docs -> log rows for the Insights engine.
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
const fieldsConst = src.match(/  const CUSTODY_FIELDS = \[[\s\S]*?\];/)[0];
const names = ['normalizeInvoiceNumber', 'normalizeDateString', 'custodyRecord', 'custodyHash', 'cloudLogWritesForQueueItem',
  'cloudOutDocToRow', 'cloudInDocToRow', 'mapOutLogRow', 'mapInLogRow', 'parseLogNumber'];
const L = new Function('const dateNormCache = new Map();\n' + fieldsConst + '\n' + names.map(extract).join('\n') +
  '\nreturn { ' + names.join(', ') + ' };')();

let n = 0;
function test(name, fn) { fn(); console.log(`✅ ${++n}. ${name}`); }

test('Scan OUT batch becomes one scanOut doc per bill, with idempotent ids', () => {
  const item = { id: 'Q-1', type: 'BATCH_DISPATCH', timestamp: '2026-11-18T05:00:00.000Z',
    payload: { dispatchDate: '2026-11-18', bills: [
      { billNo: 'IN-FY26/27-5592', agent: 'Shivam', party: 'BULLET TEA STALL', amount: 840, outstanding: 500, beat: 'Pateri' },
      { billNo: 'IN-FY26/27-5593', agent: 'Shivam', party: 'X', amount: 100 }
    ] } };
  const w = L.cloudLogWritesForQueueItem(item);
  assert.strictEqual(w.length, 2);
  assert.strictEqual(w[0].col, 'scanOut');
  assert.strictEqual(w[0].id, 'Q-1_INFY26275592');
  assert.strictEqual(w[0].data.dueOut, 500);
  assert.strictEqual(w[1].data.dueOut, 100); // no outstanding -> full amount
  assert.deepStrictEqual(L.cloudLogWritesForQueueItem(item).map(x => x.id), w.map(x => x.id));
});

test('Scan IN return keeps the real remaining due (was always the full amount in the sheet)', () => {
  const [w] = L.cloudLogWritesForQueueItem({ id: 'Q-2', type: 'SETTLEMENT_RETURN',
    payload: { billNo: 'IN-FY26/27-5592', agent: 'Shivam', amount: 840, outstanding: 300, status: 'RECEIVED', timestamp: '2026-11-18T13:00:00Z' } });
  assert.strictEqual(w.col, 'scanIn');
  assert.strictEqual(w.data.dueIn, 300);
  assert.strictEqual(w.data.collected, 540);
});

test('Payment entry uses remainingDue / collectedAmt', () => {
  const [w] = L.cloudLogWritesForQueueItem({ id: 'Q-3', type: 'SETTLEMENT_PAYMENT',
    payload: { billNo: 'B1', totalAmount: 1000, collectedAmt: 400, remainingDue: 600, paymentMode: 'UPI', refNo: 'R9', status: 'PAID_PARTIAL' } });
  assert.strictEqual(w.data.dueIn, 600);
  assert.strictEqual(w.data.collected, 400);
  assert.strictEqual(w.data.mode, 'UPI');
  assert.strictEqual(w.data.receipt, 'R9');
});

test('Auto-Healed settlements and missing flags write no log rows', () => {
  assert.strictEqual(L.cloudLogWritesForQueueItem({ id: 'Q-4', type: 'SETTLEMENT_RETURN',
    payload: { billNo: 'B1', amount: 10, remarks: 'Auto-Healed: Partial on Master Sheet' } }).length, 0);
  assert.strictEqual(L.cloudLogWritesForQueueItem({ id: 'Q-5', type: 'BILL_FLAG_MISSING', payload: { billNo: 'B1' } }).length, 0);
});

test('Custody hash changes only when a stored field changes', () => {
  const b = { billNo: 'B1', party: 'P', amount: 100, agent: 'Rajesh', status: 'WITH_AGENT', history: [{ x: 1 }], _inferredBeat: 'z' };
  const h1 = L.custodyHash(L.custodyRecord(b));
  assert.strictEqual(L.custodyHash(L.custodyRecord({ ...b, history: [], _inferredBeat: 'other' })), h1);
  assert.notStrictEqual(L.custodyHash(L.custodyRecord({ ...b, status: 'RECEIVED' })), h1);
  // A record read back from Firestore hashes the same as the bill it came from
  assert.strictEqual(L.custodyHash(L.custodyRecord(L.custodyRecord(b))), h1);
});

test('Firestore log docs round-trip into the Insights row format', () => {
  const [out] = L.cloudLogWritesForQueueItem({ id: 'Q-6', type: 'BATCH_DISPATCH', timestamp: '2026-11-18T05:00:00Z',
    payload: { dispatchDate: '2026-11-18', bills: [{ billNo: 'B7', agent: 'Self', party: 'Shop', amount: 50, beat: 'Counter' }] } });
  const o = L.mapOutLogRow(L.cloudOutDocToRow(out.data));
  assert.deepStrictEqual([o.billNo, o.agent, o.party, o.amount, o.date, o.dueOut, o.beat], ['B7', 'Self', 'Shop', 50, '2026-11-18', 50, 'Counter']);
  const [inn] = L.cloudLogWritesForQueueItem({ id: 'Q-7', type: 'SETTLEMENT_RETURN',
    payload: { billNo: 'B7', amount: 50, outstanding: 0, status: 'RECEIVED', returnReason: 'shop closed', timestamp: '2026-11-18T13:00:00Z' } });
  const i = L.mapInLogRow(L.cloudInDocToRow(inn.data));
  assert.deepStrictEqual([i.billNo, i.dueIn, i.status, i.reason], ['B7', 0, 'RECEIVED', 'shop closed']);
});

console.log(`\n🎉 ALL ${n} CLOUD TESTS PASSED`);
