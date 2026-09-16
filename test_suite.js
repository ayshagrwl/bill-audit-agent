/**
 * Automated Verification Test Suite for BillAudit Pro
 * Tests QR Parsing, Manual Invoice Number Normalization,
 * Master Sheet Table Parsing (Agent & Receipt Column),
 * and In & Out Remaining Left-Out Audit Engine.
 */

const assert = require('assert');

// ========================================================
// 1. QR Code & Barcode Parser
// ========================================================
function parseQRCodeData(rawText, masterList = []) {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();
  if (!text) return null;

  // 1. Check Master Sheet match
  if (masterList && masterList.length) {
    const match = findMasterBill(text, masterList);
    if (match) {
      return {
        billNo: match.billNo,
        party: match.party,
        amount: match.amount,
        agent: match.agent,
        receipt: match.receipt,
        fromMaster: true,
        raw: text
      };
    }
  }

  // 2. Indian GST e-Invoice Signed QR Code (JWT format)
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) {
    try {
      const parts = text.split('.');
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
      const payload = JSON.parse(jsonStr);
      const billNo = payload.DocNo || payload.docNo || payload.billNo || payload.Irn || text;
      const party = payload.BuyerGstin || payload.buyerGstin || payload.party || 'Standard Account';
      const amount = parseFloat(payload.TotInvVal || payload.totInvVal || payload.amount) || 0;
      return {
        billNo: String(billNo).trim(),
        party,
        amount,
        raw: text,
        isEInvoice: true
      };
    } catch (e) {}
  }

  // 3. Direct JSON payload
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      const obj = JSON.parse(text);
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        const billNo = obj.DocNo || obj.docNo || obj.billNo || obj.bill_no || obj.invoice || obj.invoiceNo || obj.invoice_no || obj.invNo || obj.bill || obj.id || '';
        const party = obj.party || obj.partyName || obj.party_name || obj.buyer || obj.customer || obj.BuyerGstin || 'Standard Account';
        const amtStr = String(obj.TotInvVal || obj.amount || obj.amt || obj.total || obj.grandTotal || obj.netAmount || 0);
        const amount = parseFloat(amtStr.replace(/,/g, '')) || 0;
        if (billNo) {
          return { billNo: String(billNo).trim(), party, amount, raw: text };
        }
      }
    } catch (e) {}
  }

  // 4. UPI Payment QR
  if (text.startsWith('upi://pay')) {
    try {
      const url = new URL(text);
      const billNo = url.searchParams.get('tr') || url.searchParams.get('tn') || url.searchParams.get('refId') || text;
      const party = url.searchParams.get('pn') || 'Standard Account';
      const amount = parseFloat(url.searchParams.get('am')) || 0;
      return { billNo: String(billNo).trim(), party, amount, raw: text };
    } catch (e) {}
  }

  // 5. Multi-line Key: Value Text
  if (text.includes('\n') && (text.toLowerCase().includes('inv') || text.toLowerCase().includes('bill'))) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let billNo = '', party = '', amount = 0;
    for (const line of lines) {
      const parts = line.split(/[:=]\s*/);
      if (parts.length >= 2) {
        const key = parts[0].toLowerCase();
        const val = parts.slice(1).join(':').trim();
        if (key.includes('inv') || key.includes('bill') || key.includes('doc')) {
          billNo = val;
        } else if (key.includes('party') || key.includes('customer') || key.includes('name')) {
          party = val;
        } else if (key.includes('amount') || key.includes('total') || key.includes('amt')) {
          amount = parseFloat(val.replace(/,/g, '')) || 0;
        }
      }
    }
    if (billNo) {
      return { billNo: String(billNo).trim(), party: party || 'Standard Account', amount, raw: text };
    }
  }

  // 6. Structured multi-value formats: CSV, Pipe, Semicolon
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
    party: 'Standard Account',
    amount: 0,
    raw: text
  };
}

// ========================================================
// 2. Master Sheet Parser & Invoice Normalization
// ========================================================
function normalizeInvoiceNumber(val) {
  if (!val) return '';
  return String(val).trim().toUpperCase().replace(/[\s\-_/.]/g, '');
}

function parseMasterSheetTable(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  let delimiter = '\t';
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes(',')) delimiter = ',';
  else if (firstLine.includes(';')) delimiter = ';';

  function splitRow(row) {
    if (delimiter === '\t') return row.split('\t').map(s => s.trim().replace(/^["']|["']$/g, ''));
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '"' || c === "'") inQuotes = !inQuotes;
      else if (c === delimiter && !inQuotes) {
        cols.push(cur.trim().replace(/^["']|["']$/g, ''));
        cur = '';
      } else {
        cur += c;
      }
    }
    cols.push(cur.trim().replace(/^["']|["']$/g, ''));
    return cols;
  }

  const headers = splitRow(firstLine).map(h => h.trim().toLowerCase());

  function findColIndex(keys) {
    // 1. Exact match first
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (keys.some(k => h === k)) return i;
    }
    // 2. Substring match (skip generic keys like 'paid' matching 'paid-up')
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (keys.some(k => k.length > 3 && h.includes(k))) return i;
    }
    return -1;
  }

  const idxInvoice = findColIndex(['invoice number', 'inv bill no', 'invoice', 'bill', 'billno']);
  const idxAgent = findColIndex(['agent', 'salesman', 'deliveryagent', 'name']);
  const idxParty = findColIndex(['customer', 'party', 'shop', 'store']);
  const idxAmount = findColIndex(['amount', 'total', 'net', 'billamount']);
  const idxReceipt = findColIndex(['receipt', 'receiptno', 'receipt col']);
  const idxRemarks = findColIndex(['remarks', 'note', 'notes']);

  const parsedBills = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    if (!cols || cols.length === 0) continue;

    const billNo = (idxInvoice !== -1 ? cols[idxInvoice] : cols[3]) || cols[0] || '';
    if (!billNo) continue;

    const agent = (idxAgent !== -1 ? cols[idxAgent] : (cols[15] || '')) || '';
    const party = (idxParty !== -1 ? cols[idxParty] : (cols[4] || '')) || 'General Party';
    const rawAmt = (idxAmount !== -1 ? cols[idxAmount] : (cols[5] || '0')) || '0';
    const cleanAmt = parseFloat(String(rawAmt).replace(/[₹,\s]/g, '')) || 0;
    
    let receipt = (idxReceipt !== -1 ? cols[idxReceipt] : '') || '';
    if (!receipt && idxRemarks !== -1 && cols[idxRemarks]) {
      receipt = cols[idxRemarks].trim();
    }

    parsedBills.push({
      billNo: String(billNo).trim(),
      agent: String(agent).trim(),
      party: String(party).trim(),
      amount: cleanAmt,
      receipt: String(receipt).trim()
    });
  }

  return parsedBills;
}

function findMasterBill(invoiceInput, masterBills) {
  if (!invoiceInput || !masterBills.length) return null;
  const cleanInput = String(invoiceInput).trim();
  if (!cleanInput) return null;

  const normInput = normalizeInvoiceNumber(cleanInput);

  // 1. Exact string match
  let found = masterBills.find(b => b.billNo.trim().toUpperCase() === cleanInput.toUpperCase());
  if (found) return found;

  // 2. Normalized alphanumeric match
  found = masterBills.find(b => normalizeInvoiceNumber(b.billNo) === normInput);
  if (found) return found;

  // 3. Number suffix match (e.g. "3921" inside "IN-FY26/27-3921")
  const digitsOnly = cleanInput.replace(/\D/g, '');
  if (digitsOnly.length >= 3) {
    found = masterBills.find(b => {
      const bDigits = b.billNo.replace(/\D/g, '');
      return bDigits.endsWith(digitsOnly) || bDigits === digitsOnly;
    });
    if (found) return found;
  }

  // 4. Substring contains
  found = masterBills.find(b => 
    b.billNo.toUpperCase().includes(cleanInput.toUpperCase()) ||
    cleanInput.toUpperCase().includes(b.billNo.toUpperCase())
  );

  return found || null;
}

// ========================================================
// 3. Agent Remaining Left-Out Audit Engine
// ========================================================
function computeAgentRemainingAudit(agentName, allBills) {
  const agentBills = allBills.filter(b => b.agent === agentName);
  const leftOutBills = agentBills.filter(b => b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT');
  const checkedInBills = agentBills.filter(b => b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND');

  let totalAmt = 0, checkedInAmt = 0, leftOutAmt = 0;

  agentBills.forEach(b => totalAmt += (Number(b.amount) || 0));
  checkedInBills.forEach(b => checkedInAmt += (Number(b.collectedAmt) || Number(b.amount) || 0));
  leftOutBills.forEach(b => leftOutAmt += (Number(b.amount) || 0));

  return {
    agent: agentName,
    totalDispatchedCount: agentBills.length,
    totalDispatchedAmt: totalAmt,
    checkedInCount: checkedInBills.length,
    checkedInAmt,
    leftOutCount: leftOutBills.length,
    leftOutAmt,
    leftOutBills
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

// Test 3: Multi-comma Indian currency parsing
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

// Test 6: Master Sheet Table Parsing (Tab and CSV) with Agent and Receipt Columns
console.log('Test 6: Master Sheet Table Parsing with Agent & Receipt columns');
const sampleSheetTSV = 
`Invoice No\tAgent\tParty\tAmount\tReceipt
IN-FY26/27-3921\tRahul Sharma\tSatguru Provision Store\t5465.00\tRCT-9812
IN-FY26/27-3922\tRahul Sharma\tMahaveer Super Market\t12850.00\tPaid UPI
IN-FY26/27-3923\tVikram Singh\tBalaji General Store\t3200.00\tPending`;

const parsedMaster = parseMasterSheetTable(sampleSheetTSV);
assert.strictEqual(parsedMaster.length, 3);
assert.strictEqual(parsedMaster[0].billNo, 'IN-FY26/27-3921');
assert.strictEqual(parsedMaster[0].agent, 'Rahul Sharma');
assert.strictEqual(parsedMaster[0].receipt, 'RCT-9812');
assert.strictEqual(parsedMaster[1].agent, 'Rahul Sharma');
assert.strictEqual(parsedMaster[1].receipt, 'Paid UPI');
assert.strictEqual(parsedMaster[2].agent, 'Vikram Singh');
console.log('✅ Test 6 Passed! Agent & Receipt parsed perfectly.\n');

// Test 7: Flexible Manual Invoice Lookup (e.g. typing "3921" or "in-3921" matches full bill number)
console.log('Test 7: Flexible Invoice Number Matching (e.g. "3921" matches "IN-FY26/27-3921")');
const match1 = findMasterBill('3921', parsedMaster);
assert.ok(match1, 'Should find bill by number suffix 3921');
assert.strictEqual(match1.billNo, 'IN-FY26/27-3921');
assert.strictEqual(match1.agent, 'Rahul Sharma');
assert.strictEqual(match1.receipt, 'RCT-9812');

const match2 = findMasterBill('IN-FY26/27-3922', parsedMaster);
assert.ok(match2, 'Should find bill by exact string');
assert.strictEqual(match2.party, 'Mahaveer Super Market');
console.log('✅ Test 7 Passed! Flexible invoice number entry succeeds.\n');

// Test 8: Remaining Left-Out Bill Audit Engine
console.log('Test 8: Remaining Left-Out Bills Audit (5 dispatched OUT -> 3 checked IN -> 2 Left Out)');
const mockCustodyBills = [
  { billNo: 'IN-101', agent: 'Rahul Sharma', party: 'Party A', amount: 5000, collectedAmt: 5000, status: 'PAID_FULL' },
  { billNo: 'IN-102', agent: 'Rahul Sharma', party: 'Party B', amount: 3000, collectedAmt: 1000, status: 'PAID_PARTIAL' },
  { billNo: 'IN-103', agent: 'Rahul Sharma', party: 'Party C', amount: 2000, collectedAmt: 0, status: 'RETURNED_IN_HAND' },
  { billNo: 'IN-104', agent: 'Rahul Sharma', party: 'Party D', amount: 8000, collectedAmt: 0, status: 'WITH_AGENT' }, // LEFT OUT!
  { billNo: 'IN-105', agent: 'Rahul Sharma', party: 'Party E', amount: 4500, collectedAmt: 0, status: 'MISSING_ALERT' }, // LEFT OUT!
  { billNo: 'IN-201', agent: 'Vikram Singh', party: 'Party X', amount: 10000, collectedAmt: 10000, status: 'PAID_FULL' }
];

const rahulAudit = computeAgentRemainingAudit('Rahul Sharma', mockCustodyBills);
assert.strictEqual(rahulAudit.totalDispatchedCount, 5, 'Rahul should have 5 total dispatched');
assert.strictEqual(rahulAudit.totalDispatchedAmt, 22500, 'Total dispatched amount should be 22500');
assert.strictEqual(rahulAudit.checkedInCount, 3, '3 bills checked in');
assert.strictEqual(rahulAudit.leftOutCount, 2, 'Exactly 2 bills left out');
assert.strictEqual(rahulAudit.leftOutAmt, 12500, 'Left out amount should be 8000 + 4500 = 12500');
assert.strictEqual(rahulAudit.leftOutBills.length, 2);
assert.strictEqual(rahulAudit.leftOutBills[0].billNo, 'IN-104');
assert.strictEqual(rahulAudit.leftOutBills[1].billNo, 'IN-105');
console.log('✅ Test 8 Passed! Agent Remaining Left-Out Audit computed with 100% precision.\n');

// Test 9: Real User Sheet Sample Parsing (Column D Invoice, Remarks Receipt, Customer, Amount, Agent)
console.log('Test 9: User Real Sales Sheet Data Verification');
const realUserSheetCSV =
`Column 1,Present,DATE,Invoice Number,Customer,Amount,Overdue days,DISCOUNT/CD,PAID-UP,STATUS,MODE,OUTSTANDING,RECEIPT,REMARKS,Beat,Agent
,FALSE,22 Mar,IN-14015503-0001,Narendr Kirana Stor - 12504210,"₹7,100",0,,"₹7,100",PAID,,₹0,,R163,"PREM NAGAR",Santosh Singh(OM MARKETING)
DELIVERIED,FALSE,22 Mar,IN-14015503-0003,Ritu Dary - 12254556,"₹2,764",0,,"₹2,764",PAID,,₹0,,RECIPT 87 + 338,"PREM NAGAR",Shiv Kumar Verma(OM MARKETING)`;

const userParsed = parseMasterSheetTable(realUserSheetCSV);
assert.strictEqual(userParsed.length, 2);
assert.strictEqual(userParsed[0].billNo, 'IN-14015503-0001');
assert.strictEqual(userParsed[0].party, 'Narendr Kirana Stor - 12504210');
assert.strictEqual(userParsed[0].amount, 7100);
assert.strictEqual(userParsed[0].agent, 'Santosh Singh(OM MARKETING)');
assert.strictEqual(userParsed[0].receipt, 'R163');

assert.strictEqual(userParsed[1].billNo, 'IN-14015503-0003');
assert.strictEqual(userParsed[1].receipt, 'RECIPT 87 + 338');
assert.strictEqual(userParsed[1].agent, 'Shiv Kumar Verma(OM MARKETING)');

// Flexible lookup by suffix on real data
const suffixMatch = findMasterBill('0003', userParsed);
assert.ok(suffixMatch);
assert.strictEqual(suffixMatch.billNo, 'IN-14015503-0003');
assert.strictEqual(suffixMatch.receipt, 'RECIPT 87 + 338');
console.log('✅ Test 9 Passed! Real user sales sheet rows & receipt numbers parsed flawlessly!\n');

// Test 10: GST e-Invoice Signed QR Code (JWT Format)
console.log('Test 10: Indian GST e-Invoice Signed QR (JWT Payload)');
const mockJwtHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const mockJwtPayload = Buffer.from(JSON.stringify({
  SellerGstin: '07AAAAA0000A1Z5',
  BuyerGstin: '07BBBBB9999B1Z1',
  DocNo: 'IN-FY26-4401',
  TotInvVal: 18450.50
})).toString('base64url');
const mockJwtSignature = 'dummySignature123';
const jwtQr = `${mockJwtHeader}.${mockJwtPayload}.${mockJwtSignature}`;
const r10 = parseQRCodeData(jwtQr);
assert.ok(r10);
assert.strictEqual(r10.billNo, 'IN-FY26-4401');
assert.strictEqual(r10.amount, 18450.50);
assert.strictEqual(r10.party, '07BBBBB9999B1Z1');
assert.strictEqual(r10.isEInvoice, true);
console.log('✅ Test 10 Passed! GST e-Invoice JWT decoded with DocNo & TotInvVal!\n');

// Test 11: Direct JSON QR Code Payload
console.log('Test 11: Direct JSON QR Payload');
const jsonQr = JSON.stringify({
  DocNo: 'INV-7890',
  TotInvVal: 9800,
  party: 'Gupta Traders Pvt Ltd'
});
const r11 = parseQRCodeData(jsonQr);
assert.ok(r11);
assert.strictEqual(r11.billNo, 'INV-7890');
assert.strictEqual(r11.amount, 9800);
assert.strictEqual(r11.party, 'Gupta Traders Pvt Ltd');
console.log('✅ Test 11 Passed! JSON QR parsed with invoice & amount!\n');

// Test 12: UPI Payment QR Code
console.log('Test 12: UPI QR Payload');
const upiQr = 'upi://pay?pa=store@upi&pn=Radhey+Shyam+Store&am=3450.00&tr=BILL-5501';
const r12 = parseQRCodeData(upiQr);
assert.ok(r12);
assert.strictEqual(r12.billNo, 'BILL-5501');
assert.strictEqual(r12.amount, 3450);
assert.strictEqual(r12.party, 'Radhey Shyam Store');
console.log('✅ Test 12 Passed! UPI QR reference and amount extracted!\n');

// Test 13: Multi-line Key-Value Bill Text
console.log('Test 13: Multi-line Key-Value Text QR');
const multilineQr = `Invoice No: IN-3322
Party: Verma General Store
Amount: 14,200.00`;
const r13 = parseQRCodeData(multilineQr);
assert.ok(r13);
assert.strictEqual(r13.billNo, 'IN-3322');
assert.strictEqual(r13.amount, 14200);
assert.strictEqual(r13.party, 'Verma General Store');
console.log('✅ Test 13 Passed! Multi-line Key:Value format parsed!\n');

console.log('🎉 ALL 13 AUTOMATED TESTS COMPLETED WITH 100% SUCCESS!');
