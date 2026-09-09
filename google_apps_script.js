/**
 * ===================================================================
 * BillAudit Pro - Google Apps Script Cloud Backend
 * ===================================================================
 * 
 * INSTRUCTIONS TO DEPLOY:
 * 1. Open Google Sheets (https://sheets.new).
 * 2. Rename sheet to "Sales Agent Bill Tracking".
 * 3. Go to menu: Extensions > Apps Script.
 * 4. Replace any existing code with this entire file.
 * 5. Click "Deploy" (top right) > "New deployment".
 * 6. Click the gear icon > Select "Web app".
 * 7. Set:
 *    - Description: "BillAudit Pro API"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"  <-- (CRITICAL for GitHub Pages to sync)
 * 8. Click "Deploy", Authorize permissions.
 * 9. Copy the "Web app URL" and paste it into the Web App Settings!
 */

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
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'PING') {
      return respondJSON({
        status: 'OK',
        message: 'Google Sheets Connected Successfully',
        spreadsheetName: ss.getName(),
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'GET_DATA') {
      ensureDatabaseSetup(ss);
      const bills = getCustodyBills(ss);
      const agents = getAgentsList(ss);

      return respondJSON({
        status: 'OK',
        bills: bills,
        agents: agents,
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
 */
function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureDatabaseSetup(ss);

    let data = {};
    if (e?.postData?.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      return respondJSON({ success: false, error: 'Empty payload' });
    }

    const action = data.action;

    if (action === 'BATCH_SYNC') {
      // Process queue entries
      if (Array.isArray(data.queue) && data.queue.length > 0) {
        processQueueItems(ss, data.queue);
      }

      // Update Active Custody table with latest state
      if (Array.isArray(data.bills) && data.bills.length > 0) {
        syncAllBills(ss, data.bills);
      }

      return respondJSON({
        success: true,
        message: 'Processed batch sync successfully',
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
 * Process granular audit log queue items
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
          p.agent,
          'DISPATCH_HANDOVER',
          b.amount,
          0,
          '',
          '',
          `Handed over for route date ${p.dispatchDate}`
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
        p.remarks || 'Payment collected'
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
        `Physical return: ${p.returnReason}. Note: ${p.remarks}`
      ]);
    } else if (type === 'BILL_FLAG_MISSING') {
      rowsToAppend.push([
        time,
        p.billNo,
        p.agent,
        'MISSING_ALERT',
        0,
        0,
        '',
        '',
        'ALERT: Bill not accounted for during settlement'
      ]);
    }
  });

  if (rowsToAppend.length > 0) {
    auditSheet.getRange(auditSheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  }
}

/**
 * Sync Active Custody sheet (upsert rows by Bill Number)
 */
function syncAllBills(ss, bills) {
  const sheet = ss.getSheetByName(SHEET_NAMES.CUSTODY);
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  let existingData = [];
  if (lastRow > 1) {
    existingData = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  }

  // Map of billNo -> rowIndex in sheet
  const billRowMap = {};
  existingData.forEach((row, idx) => {
    const bNo = String(row[0]).trim();
    if (bNo) billRowMap[bNo] = idx + 2; // 1-indexed, starts at row 2
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
      // Update in-place
      sheet.getRange(existingRowIdx, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      // Append new
      newRows.push(rowValues);
      billRowMap[b.billNo] = lastRow + newRows.length;
    }
  });

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
}

/**
 * Retrieve current active bills
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
 * Retrieve agents list
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
 * Helper to ensure formatted sheets exist
 */
function ensureDatabaseSetup(ss) {
  // 1. Active Custody Sheet
  let custodySheet = ss.getSheetByName(SHEET_NAMES.CUSTODY);
  if (!custodySheet) {
    custodySheet = ss.insertSheet(SHEET_NAMES.CUSTODY);
    const headers = [
      ['Bill Number', 'Party Name & ID', 'Bill Amount', 'Assigned Agent', 'Dispatch Date', 'Current Status', 'Collected Amt', 'Payment Mode', 'Reference / Cheque No', 'Return Reason', 'Remarks', 'Last Action Time']
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
      ['Timestamp', 'Bill Number', 'Sales Agent', 'Action Event', 'Bill Amount', 'Collected Amount', 'Payment Mode', 'Ref / Cheque No', 'Audit Notes']
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

    // Add default sample agents
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
