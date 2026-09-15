/**
 * ===================================================================
 * BillAudit Pro - Google Apps Script Cloud Backend
 * 100% READ-ONLY from Master Sheet | WRITING to Dedicated Tracking Sheet
 * ===================================================================
 * 
 * SETUP INSTRUCTIONS (Takes ~2 minutes):
 * 
 * 1. Create a NEW Google Sheet for tracking:
 *    - Go to https://sheets.new
 *    - Name it "Sales Bill Daily Tracking & Custody"
 * 
 * 2. Add this Apps Script to the NEW Tracking Sheet:
 *    - In the new sheet, click menu: Extensions > Apps Script
 *    - Replace all code with this ENTIRE file
 * 
 * 3. Deploy as Web App:
 *    - Click "Deploy" (top right) > "New deployment"
 *    - Click the gear icon > Select "Web app"
 *    - Description: "BillAudit API"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"  <-- (CRITICAL so the web app can communicate)
 *    - Click "Deploy", Authorize permissions
 * 
 * 4. Connect with BillAudit:
 *    - Copy the "Web app URL" (ends in /exec)
 *    - Paste it in the BillAudit Web App under "Settings & Sheet"
 * 
 * 5. SAFETY GUARANTEE:
 *    - Your Master Sales Sheet (11J3WSXNFfu5aARNMBX3HQazajsfzBjj7wX9MWyVVBRk)
 *      is STRICTLY READ-ONLY.
 *    - No edits, rows, or writes will EVER be made to your Master Sales Sheet.
 *    - All custody, in/out logs, and daily settlements are saved strictly
 *      in your NEW tracking sheet!
 */

// Master Sales Sheet Configuration (READ-ONLY)
const MASTER_CONFIG = {
  SPREADSHEET_ID: '11J3WSXNFfu5aARNMBX3HQazajsfzBjj7wX9MWyVVBRk',
  GID: '1608276684',
  INVOICE_COL_LETTER: 'D', // Column D is unique Invoice / Bill No
  RECEIPT_KEYWORDS: ['receipt', 'receipt col', 'receipt no', 'payment', 'paid']
};

// Tracking Sheet Tab Names (Written only to the new Tracking Sheet)
const SHEET_NAMES = {
  CUSTODY: 'Active_Custody',
  AUDIT: 'Audit_Log',
  SETTLEMENT: 'Daily_Settlement',
  AGENTS: 'Agents'
};

/**
 * Handle GET requests (Health Check Ping & Data Pull)
 */
function doGet(e) {
  try {
    const action = e?.parameter?.action || 'PING';
    const trackingSS = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'PING') {
      return respondJSON({
        status: 'OK',
        message: 'Tracking Sheet Connected Successfully',
        trackingSheetName: trackingSS.getName(),
        masterSheetId: MASTER_CONFIG.SPREADSHEET_ID,
        readOnlySafeguard: 'ACTIVE',
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'GET_DATA' || action === 'GET_MASTER_SHEET') {
      ensureDatabaseSetup(trackingSS);
      const bills = getCustodyBills(trackingSS);
      const agents = getAgentsList(trackingSS);
      const masterBills = getMasterBillsFromSheet(trackingSS);

      return respondJSON({
        status: 'OK',
        bills: bills,
        agents: agents,
        masterBills: masterBills,
        timestamp: new Date().toISOString()
      });
    }

    return respondJSON({ status: 'ERROR', message: 'Invalid GET action' });
  } catch (err) {
    return respondJSON({ status: 'ERROR', message: err.toString() });
  }
}

/**
 * Handle POST requests (Batch Sync from Web App)
 * ONLY writes to the new Tracking Sheet. Never writes to Master Sheet!
 */
function doPost(e) {
  try {
    const trackingSS = SpreadsheetApp.getActiveSpreadsheet();

    // SAFETY CHECK: Ensure we NEVER write to the master sheet!
    if (trackingSS.getId() === MASTER_CONFIG.SPREADSHEET_ID) {
      return respondJSON({
        success: false,
        error: 'SAFETY BLOCKED: Writing to the Master Sales Sheet is blocked. Please deploy this script inside your NEW Tracking Sheet.'
      });
    }

    ensureDatabaseSetup(trackingSS);

    let data = {};
    if (e?.postData?.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      return respondJSON({ success: false, error: 'Empty payload' });
    }

    const action = data.action;

    if (action === 'BATCH_SYNC') {
      if (Array.isArray(data.queue) && data.queue.length > 0) {
        processQueueItems(trackingSS, data.queue);
      }

      if (Array.isArray(data.bills) && data.bills.length > 0) {
        syncAllBills(trackingSS, data.bills);
      }

      return respondJSON({
        success: true,
        message: 'Processed batch sync into Tracking Sheet successfully',
        syncedCount: data.bills ? data.bills.length : 0,
        timestamp: new Date().toISOString()
      });
    }

    return respondJSON({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return respondJSON({ success: false, error: err.toString() });
  }
}

/**
 * STRICTLY READ-ONLY function:
 * Reads Column D (Invoice No), Receipt Column, Party, Amount, and Agent from Master Sheet
 */
function getMasterBillsFromSheet(trackingSS) {
  let masterSS = null;
  try {
    masterSS = SpreadsheetApp.openById(MASTER_CONFIG.SPREADSHEET_ID);
  } catch (err) {
    // If not accessible by openById, fallback to active
    masterSS = trackingSS;
  }

  if (!masterSS) return [];

  // Find the exact tab matching GID 1608276684
  let sheet = null;
  const sheets = masterSS.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getSheetId()) === String(MASTER_CONFIG.GID)) {
      sheet = sheets[i];
      break;
    }
  }

  // Fallback if GID changed
  if (!sheet) {
    sheet = sheets.find(s => s.getName() !== SHEET_NAMES.CUSTODY && s.getName() !== SHEET_NAMES.AUDIT && s.getName() !== SHEET_NAMES.AGENTS) || sheets[0];
  }

  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol < 1) return [];

  // Read-only batch fetch
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h).trim().toLowerCase());

  // Column D = 0-indexed column 3
  const colDIndex = MASTER_CONFIG.INVOICE_COL_LETTER.charCodeAt(0) - 65;

  function findColIndex(keys) {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (keys.some(k => h === k || h.includes(k))) return i;
    }
    return -1;
  }

  const idxInv = (colDIndex < headers.length) ? colDIndex : findColIndex(['inv bill no', 'invoice', 'bill']);
  const idxReceipt = findColIndex(MASTER_CONFIG.RECEIPT_KEYWORDS);
  const idxAgent = findColIndex(['agent', 'salesman', 'delivery', 'name']);
  const idxParty = findColIndex(['party', 'customer', 'shop', 'store']);
  const idxAmt = findColIndex(['amount', 'total', 'net', 'bill']);

  const masterBills = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const billNo = String(row[idxInv] || '').trim();
    if (!billNo) continue;

    masterBills.push({
      billNo: billNo,
      agent: String(idxAgent !== -1 ? row[idxAgent] : '').trim(),
      party: String(idxParty !== -1 ? row[idxParty] : '').trim() || 'General Party',
      amount: Number(idxAmt !== -1 ? String(row[idxAmt]).replace(/[₹,\s]/g, '') : 0) || 0,
      receipt: String(idxReceipt !== -1 ? row[idxReceipt] : '').trim()
    });
  }

  return masterBills;
}

/**
 * Process granular audit log items (Appended to Tracking Sheet only)
 */
function processQueueItems(ss, queue) {
  const auditSheet = ss.getSheetByName(SHEET_NAMES.AUDIT);
  if (!auditSheet) return;

  const rowsToAppend = [];

  queue.forEach(item => {
    const type = item.type;
    const p = item.payload;
    const time = item.timestamp || new Date().toISOString();

    if (type === 'BATCH_DISPATCH' && Array.isArray(p.bills)) {
      p.bills.forEach(b => {
        rowsToAppend.push([
          time,
          b.billNo,
          b.agent || p.agent || '',
          'DISPATCH_OUT',
          b.amount,
          0,
          '',
          b.refNo || '',
          `Dispatched for route date ${p.dispatchDate}`
        ]);
      });
    } else if (type === 'SETTLEMENT_PAYMENT') {
      rowsToAppend.push([
        time,
        p.billNo,
        p.agent,
        p.status,
        0,
        p.collectedAmt,
        p.paymentMode,
        p.refNo,
        p.remarks || 'Payment checked IN'
      ]);
    } else if (type === 'SETTLEMENT_RETURN') {
      rowsToAppend.push([
        time,
        p.billNo,
        p.agent,
        'RETURNED_IN_HAND',
        0,
        0,
        '',
        '',
        `Return next round: ${p.returnReason}. Note: ${p.remarks}`
      ]);
    } else if (type === 'BILL_FLAG_MISSING') {
      rowsToAppend.push([
        time,
        p.billNo,
        p.agent,
        'LEFT_OUT_ALERT',
        0,
        0,
        '',
        '',
        'ALERT: Bill left out / not returned by agent'
      ]);
    }
  });

  if (rowsToAppend.length > 0) {
    auditSheet.getRange(auditSheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  }
}

/**
 * Sync Active Custody sheet (upsert rows by Bill Number in Tracking Sheet)
 */
function syncAllBills(ss, bills) {
  const sheet = ss.getSheetByName(SHEET_NAMES.CUSTODY);
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  let existingData = [];
  if (lastRow > 1) {
    existingData = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  }

  const billRowMap = {};
  existingData.forEach((row, idx) => {
    const bNo = String(row[0]).trim();
    if (bNo) billRowMap[bNo] = idx + 2;
  });

  const newRows = [];

  bills.forEach(b => {
    const rowValues = [
      b.billNo,
      b.party || '',
      Number(b.amount) || 0,
      b.agent || '',
      b.dispatchDate || '',
      b.status || 'WITH_AGENT',
      Number(b.collectedAmt) || 0,
      b.paymentMode || '',
      b.refNo || '',
      b.returnReason || '',
      b.remarks || '',
      b.lastActionDate || new Date().toISOString()
    ];

    const existingRowIdx = billRowMap[b.billNo];
    if (existingRowIdx) {
      sheet.getRange(existingRowIdx, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      newRows.push(rowValues);
      billRowMap[b.billNo] = lastRow + newRows.length;
    }
  });

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
}

/**
 * Retrieve current active bills from Tracking Sheet
 */
function getCustodyBills(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.CUSTODY);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  return values.map(r => ({
    billNo: String(r[0]),
    party: String(r[1]),
    amount: Number(r[2]) || 0,
    agent: String(r[3]),
    dispatchDate: String(r[4]),
    status: String(r[5]),
    collectedAmt: Number(r[6]) || 0,
    paymentMode: String(r[7]),
    refNo: String(r[8]),
    returnReason: String(r[9]),
    remarks: String(r[10]),
    lastActionDate: String(r[11])
  }));
}

/**
 * Retrieve agents list from Tracking Sheet
 */
function getAgentsList(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.AGENTS);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  return values.map(r => ({
    id: String(r[0]),
    name: String(r[1]),
    phone: String(r[2])
  }));
}

/**
 * Setup standard tracking tables in the new Tracking Sheet
 */
function ensureDatabaseSetup(ss) {
  // 1. Active Custody Sheet
  let custodySheet = ss.getSheetByName(SHEET_NAMES.CUSTODY);
  if (!custodySheet) {
    custodySheet = ss.insertSheet(SHEET_NAMES.CUSTODY);
    const headers = [
      ['Bill Number', 'Party Name & ID', 'Bill Amount', 'Assigned Agent', 'Dispatch Date', 'Current Status', 'Collected Amt', 'Payment Mode', 'Receipt / Ref No', 'Return Reason', 'Remarks', 'Last Action Time']
    ];
    custodySheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
    custodySheet.getRange(1, 1, 1, headers[0].length)
      .setBackground('#1e3a8a')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    custodySheet.setFrozenRows(1);
  }

  // 2. Audit Log Sheet
  let auditSheet = ss.getSheetByName(SHEET_NAMES.AUDIT);
  if (!auditSheet) {
    auditSheet = ss.insertSheet(SHEET_NAMES.AUDIT);
    const headers = [
      ['Timestamp', 'Bill Number', 'Sales Agent', 'Action Event', 'Bill Amount', 'Collected Amount', 'Payment Mode', 'Receipt / Ref No', 'Audit Notes']
    ];
    auditSheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
    auditSheet.getRange(1, 1, 1, headers[0].length)
      .setBackground('#0f766e')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    auditSheet.setFrozenRows(1);
  }

  // 3. Agents Sheet
  let agentsSheet = ss.getSheetByName(SHEET_NAMES.AGENTS);
  if (!agentsSheet) {
    agentsSheet = ss.insertSheet(SHEET_NAMES.AGENTS);
    const headers = [['Agent ID', 'Agent Name', 'Phone / WhatsApp']];
    agentsSheet.getRange(1, 1, 1, 3).setValues(headers);
    agentsSheet.getRange(1, 1, 1, 3)
      .setBackground('#4338ca')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    agentsSheet.setFrozenRows(1);

    agentsSheet.getRange(2, 1, 3, 3).setValues([
      ['AG-101', 'Rahul Sharma', '9876543210'],
      ['AG-102', 'Vikram Singh', '9812345678'],
      ['AG-103', 'Amit Patel', '9765432109']
    ]);
  }
}

/**
 * Return JSON response
 */
function respondJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
