/**
 * Automated Verification Test Suite for BillAudit Pro
 * Tests QR Parsing, Currency Formatting, and Fraud Detection Reconciliation
 */

const assert = require('assert');

// 1. QR Code Parser Unit Under Test
function parseQRCodeData(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();
  if (!text) return null;

  function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values.map(v => v.replace(/^["']|["']$/g, '').trim());
  }

  let altDelimiter = null;
  if (text.includes('|')) altDelimiter = '|';
  else if (text.includes(';')) altDelimiter = ';';
  else if (text.includes('\t')) altDelimiter = '\t';

  if (altDelimiter) {
    const parts = text.split(altDelimiter).map(s => s.trim().replace(/^["']|["']$/g, ''));
    if (parts.length >= 3) {
      const billNo = parts[0];
      const party = parts[1];
      const amountStr = parts.slice(2).join('');
      const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
      return { billNo, party, amount, raw: text };
    }
  }

  const csvParts = parseCSVLine(text);

  if (csvParts.length === 3) {
    const billNo = csvParts[0];
    const party = csvParts[1];
    const amountStr = csvParts[2];
    const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
    return { billNo, party, amount, raw: text };
  } else if (csvParts.length > 3) {
    const billNo = csvParts[0];
    let amountIndex = csvParts.length - 1;
    while (amountIndex > 1 && /^[\d.]+$/.test(csvParts[amountIndex].trim())) {
      amountIndex--;
    }
    let partyParts, amountParts;
    if (amountIndex < csvParts.length - 1) {
      partyParts = csvParts.slice(1, amountIndex + 1);
      amountParts = csvParts.slice(amountIndex + 1);
    } else {
      partyParts = [csvParts[1]];
      amountParts = csvParts.slice(2);
    }
    const party = partyParts.join(', ');
    const amountStr = amountParts.join('');
    const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
    return { billNo, party, amount, raw: text };
  } else if (csvParts.length === 2) {
    const billNo = csvParts[0];
    const amount = parseFloat(csvParts[1].replace(/,/g, '')) || 0;
    return { billNo, party: 'Standard Account', amount, raw: text };
  }

  return {
    billNo: text,
    party: 'Unknown Party',
    amount: 0,
    raw: text
  };
}

// 2. Reconciliation Engine Unit Under Test
function reconcileAgentBills(dispatchedBills) {
  let totalDispatchedCount = dispatchedBills.length;
  let totalDispatchedAmt = 0;
  let collectedCount = 0;
  let collectedAmt = 0;
  let returnedCount = 0;
  let returnedAmt = 0;
  let missingCount = 0;
  let missingAmt = 0;

  dispatchedBills.forEach(b => {
    const amt = Number(b.amount) || 0;
    const colAmt = Number(b.collectedAmt) || 0;
    totalDispatchedAmt += amt;

    if (b.status === 'PAID_FULL') {
      collectedCount++;
      collectedAmt += colAmt;
    } else if (b.status === 'PAID_PARTIAL') {
      collectedCount++;
      collectedAmt += colAmt;
      returnedAmt += (amt - colAmt);
    } else if (b.status === 'RETURNED_IN_HAND') {
      returnedCount++;
      returnedAmt += amt;
    } else if (b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT') {
      // Unaccounted bill
      missingCount++;
      missingAmt += amt;
    }
  });

  return {
    totalDispatchedCount,
    totalDispatchedAmt,
    collectedCount,
    collectedAmt,
    returnedCount,
    returnedAmt,
    missingCount,
    missingAmt,
    isCleanAudit: missingCount === 0
  };
}

console.log('🧪 RUNNING BILLAUDIT PRO AUTOMATED TESTS...\n');

// Test 1: User specified exact QR format
console.log('Test 1: User exact sample: IN-FY26/27-3921,Satguru Provision Store,5,465.00');
const r1 = parseQRCodeData('IN-FY26/27-3921,Satguru Provision Store,5,465.00');
assert.strictEqual(r1.billNo, 'IN-FY26/27-3921');
assert.strictEqual(r1.party, 'Satguru Provision Store');
assert.strictEqual(r1.amount, 5465.00);
console.log('✅ Test 1 Passed!\n');

// Test 2: Sample with Party ID in name
console.log('Test 2: Sample with ID in party: IN-FY26/27-3922,Mahaveer Super Market (ID: 108),12,850.00');
const r2 = parseQRCodeData('IN-FY26/27-3922,Mahaveer Super Market (ID: 108),12,850.00');
assert.strictEqual(r2.billNo, 'IN-FY26/27-3922');
assert.strictEqual(r2.party, 'Mahaveer Super Market (ID: 108)');
assert.strictEqual(r2.amount, 12850.00);
console.log('✅ Test 2 Passed!\n');

// Test 3: Large amount with multiple Indian comma separators: 1,25,500.50
console.log('Test 3: Multi-comma Indian currency parsing: BILL-888,Wholesale Mega Mart,1,25,500.50');
const r3 = parseQRCodeData('BILL-888,Wholesale Mega Mart,1,25,500.50');
assert.strictEqual(r3.billNo, 'BILL-888');
assert.strictEqual(r3.party, 'Wholesale Mega Mart');
assert.strictEqual(r3.amount, 125500.50);
console.log('✅ Test 3 Passed!\n');

// Test 4: Quoted CSV format
console.log('Test 4: Quoted CSV format: "IN-999","Shree Krishna Store","7,200.00"');
const r4 = parseQRCodeData('"IN-999","Shree Krishna Store","7,200.00"');
assert.strictEqual(r4.billNo, 'IN-999');
assert.strictEqual(r4.party, 'Shree Krishna Store');
assert.strictEqual(r4.amount, 7200.00);
console.log('✅ Test 4 Passed!\n');

// Test 5: Pipe-separated format
console.log('Test 5: Pipe-separated format: IN-777|Apex Traders|4500');
const r5 = parseQRCodeData('IN-777|Apex Traders|4500');
assert.strictEqual(r5.billNo, 'IN-777');
assert.strictEqual(r5.party, 'Apex Traders');
assert.strictEqual(r5.amount, 4500.00);
console.log('✅ Test 5 Passed!\n');

// Test 6: Settlement Reconciliation & Fraud Detection Engine
console.log('Test 6: Reconciliation Engine - Missing Bill Detection');
const mockDispatched = [
  { billNo: 'B1', amount: 5000, collectedAmt: 5000, status: 'PAID_FULL' },
  { billNo: 'B2', amount: 3000, collectedAmt: 1000, status: 'PAID_PARTIAL' },
  { billNo: 'B3', amount: 4000, collectedAmt: 0, status: 'RETURNED_IN_HAND' },
  { billNo: 'B4', amount: 8000, collectedAmt: 0, status: 'WITH_AGENT' } // UNACCOUNTED!
];

const audit = reconcileAgentBills(mockDispatched);
assert.strictEqual(audit.totalDispatchedCount, 4);
assert.strictEqual(audit.totalDispatchedAmt, 20000);
assert.strictEqual(audit.collectedAmt, 6000); // 5000 + 1000
assert.strictEqual(audit.returnedAmt, 6000); // 2000 remaining on B2 + 4000 on B3
assert.strictEqual(audit.missingCount, 1);
assert.strictEqual(audit.missingAmt, 8000);
assert.strictEqual(audit.isCleanAudit, false);
console.log('✅ Test 6 Passed! Fraud Risk for B4 correctly detected: ₹8,000 unaccounted!\n');

console.log('🎉 ALL 6 AUTOMATED TESTS COMPLETED WITH 100% SUCCESS!');
