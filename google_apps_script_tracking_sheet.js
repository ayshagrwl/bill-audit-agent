/**
 * ===================================================================
 * BillAudit Pro - DEDICATED TRACKING SHEET SCRIPT (SCAN IN & OUT)
 * ===================================================================
 * 
 * PURPOSE:
 * Deploy this script directly inside your NEW Google Sheet created specifically
 * for recording all daily SCAN-OUT (dispatch) and SCAN-IN (settlement/return) operations.
 * 
 * WHAT THIS SCRIPT DOES AUTOMATICALLY:
 * 1. Creates & auto-formats 4 dedicated tabs:
 *    - "Scan_Out_Log"   : Detailed log of all bills handed OUT to agents
 *    - "Scan_In_Log"    : Detailed log of all bills checked IN (paid / returned)
 *    - "Live_Custody"   : Live real-time snapshot of every bill's active status
 *    - "Daily_Summary"  : Automated daily performance & collection summary per agent
 * 
 * 2. Provides Web App Endpoints:
 *    - POST: Receives real-time Scan-Out & Scan-In records from the dashboard
 *    - GET : Health check ping and custody data retrieval
 * 
 * SETUP INSTRUCTIONS (Takes ~2 minutes):
 * 1. Create a NEW Google Sheet:
 *    - Open https://sheets.new in your browser
 *    - Name it "Sales Bill Daily Scan-In & Scan-Out Tracking"
 * 2. In the top menu, click: Extensions > Apps Script
 * 3. Delete any existing code in the editor, and paste this ENTIRE file.
 * 4. Click the blue "Deploy" button (top right) > "New deployment"
 * 5. Click the gear icon (⚙️) next to "Select type" > choose "Web app"
 * 6. Set the settings:
 *    - Description: "BillAudit Scan Tracking Engine"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"  <-- (CRITICAL: allows the web dashboard to record scans)
 * 7. Click "Deploy", then "Authorize access" (choose your Google account, click Advanced > Go to Untitled project).
 * 8. Copy the generated "Web app URL" (ends in /exec).
 * 9. Paste this link into BillAudit Pro dashboard under "Settings > Tracking Sheet Link".
 * ===================================================================
 */

const TRACKING_TABS = {
  SCAN_OUT: 'Scan_Out_Log',
  SCAN_IN: 'Scan_In_Log',
  CUSTODY: 'Live_Custody',
  SUMMARY: 'Daily_Summary'
};

/**
 * Handle GET requests (Health Check Ping & Live Custody Pull)
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureDatabaseSetup(ss);

    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action.toUpperCase() : 'PING';

    if (action === 'PING') {
      const custodySheet = ss.getSheetByName(TRACKING_TABS.CUSTODY);
      const totalCustody = custodySheet ? Math.max(0, custodySheet.getLastRow() - 1) : 0;
      return respondJSON({
        status: 'OK',
        mode: 'TRACKING_RECORDER',
        message: 'Tracking Sheet Connected Successfully',
        sheetTitle: ss.getName(),
        totalCustodyBills: totalCustody,
        tabs: Object.values(TRACKING_TABS),
        timestamp: getFormattedTimestamp()
      });
    }

    if (action === 'GET_CUSTODY' || action === 'GET_DATA') {
      const bills = getCustodyBills(ss);
      return respondJSON({
        status: 'OK',
        mode: 'TRACKING_RECORDER',
        count: bills.length,
        bills: bills,
        timestamp: getFormattedTimestamp()
      });
    }

    return respondJSON({ status: 'ERROR', message: 'Unknown action: ' + action });
  } catch (err) {
    return respondJSON({ status: 'ERROR', message: err.toString() });
  }
}

/**
 * Handle POST requests (Record Scan-Out, Scan-In, and Batch Sync)
 */
function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureDatabaseSetup(ss);

    let data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      return respondJSON({ success: false, error: 'Empty payload received' });
    }

    const action = data.action;
    const nowIST = getFormattedTimestamp();

    // 1. Single or Basket Scan-Out Dispatch
    if (action === 'RECORD_SCAN_OUT' || action === 'BATCH_DISPATCH') {
      const bills = Array.isArray(data.bills) ? data.bills : (data.payload && Array.isArray(data.payload.bills) ? data.payload.bills : []);
      const dispatchDate = data.dispatchDate || (data.payload && data.payload.dispatchDate) || getTodayDateString();
      const defaultAgent = data.agent || (data.payload && data.payload.agent) || 'Sales Agent';

      recordScanOut(ss, bills, dispatchDate, defaultAgent, nowIST);
      return respondJSON({
        success: true,
        action: 'RECORD_SCAN_OUT',
        message: `Successfully recorded ${bills.length} Scan-Out bills`,
        count: bills.length,
        timestamp: nowIST
      });
    }

    // 2. Scan-In Settlement / Return
    if (action === 'RECORD_SCAN_IN' || action === 'SETTLEMENT_PAYMENT' || action === 'SETTLEMENT_RETURN') {
      const p = data.payload || data;
      recordScanIn(ss, p, nowIST);
      return respondJSON({
        success: true,
        action: 'RECORD_SCAN_IN',
        message: `Successfully recorded Scan-In for bill ${p.billNo}`,
        billNo: p.billNo,
        timestamp: nowIST
      });
    }

    // 3. Batch Sync from Offline Queue
    if (action === 'BATCH_SYNC') {
      if (Array.isArray(data.queue) && data.queue.length > 0) {
        processSyncQueue(ss, data.queue, nowIST);
      }
      if (Array.isArray(data.bills) && data.bills.length > 0) {
        syncCustodyBills(ss, data.bills, nowIST);
      }
      return respondJSON({
        success: true,
        action: 'BATCH_SYNC',
        message: 'Batch sync completed into Tracking Sheet',
        queuedCount: data.queue ? data.queue.length : 0,
        syncedCount: data.bills ? data.bills.length : 0,
        timestamp: nowIST
      });
    }

    return respondJSON({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return respondJSON({ success: false, error: err.toString() });
  }
}

/**
 * Record bills handed OUT into Scan_Out_Log & update Live_Custody
 */
function recordScanOut(ss, bills, dispatchDate, defaultAgent, timestamp) {
  if (!bills || bills.length === 0) return;

  const outSheet = ss.getSheetByName(TRACKING_TABS.SCAN_OUT);
  const outRows = [];

  bills.forEach(b => {
    const billNo = String(b.billNo || '').trim();
    const agent = String(b.agent || defaultAgent || '').trim();
    const party = String(b.party || 'Standard Customer').trim();
    const amount = Number(b.amount) || 0;
    const remainingDue = b.outstanding !== undefined ? Number(b.outstanding) : amount;
    const receipt = String(b.receipt || b.refNo || '').trim();
    const notes = b.remarks || `Dispatched for route ${dispatchDate}`;

    outRows.push([
      timestamp,
      billNo,
      agent,
      party,
      amount,
      dispatchDate,
      remainingDue,
      receipt,
      'WITH_AGENT',
      notes
    ]);
  });

  if (outRows.length > 0) {
    outSheet.getRange(outSheet.getLastRow() + 1, 1, outRows.length, outRows[0].length).setValues(outRows);
  }

  // Update Live_Custody & Daily_Summary
  syncCustodyBills(ss, bills, timestamp, 'WITH_AGENT', dispatchDate);
}

/**
 * Record a bill checked IN into Scan_In_Log & update Live_Custody
 */
function recordScanIn(ss, p, timestamp) {
  const inSheet = ss.getSheetByName(TRACKING_TABS.SCAN_IN);
  const billNo = String(p.billNo || '').trim();
  const agent = String(p.agent || '').trim();
  const party = String(p.party || 'Standard Customer').trim();
  const totalAmt = Number(p.amount || p.totalAmount) || 0;
  const collectedAmt = Number(p.collectedAmt) || 0;
  const remainingDue = p.remainingDue !== undefined ? Number(p.remainingDue) : Math.max(0, totalAmt - collectedAmt);
  const paymentMode = String(p.paymentMode || (p.status === 'RETURNED_IN_HAND' ? 'RETURN' : 'Cash')).trim();
  const refNo = String(p.refNo || '').trim();
  const status = String(p.status || (collectedAmt >= totalAmt && totalAmt > 0 ? 'PAID_FULL' : 'PAID_PARTIAL')).trim();
  const returnReason = String(p.returnReason || '').trim();
  const remarks = String(p.remarks || (status === 'RETURNED_IN_HAND' ? 'Verified Return' : 'Checked IN')).trim();

  const row = [
    timestamp,
    billNo,
    agent,
    party,
    totalAmt,
    collectedAmt,
    remainingDue,
    paymentMode,
    refNo,
    status,
    returnReason,
    remarks
  ];

  inSheet.appendRow(row);

  // Update Live Custody
  const custodyBill = {
    billNo,
    party,
    amount: totalAmt,
    agent,
    status,
    collectedAmt,
    outstanding: remainingDue,
    paymentMode,
    refNo,
    returnReason,
    remarks,
    lastActionDate: timestamp
  };

  syncCustodyBills(ss, [custodyBill], timestamp);
}

/**
 * Process queue items from offline sync
 */
function processSyncQueue(ss, queue, timestamp) {
  queue.forEach(item => {
    const type = item.type;
    const p = item.payload;
    const itemTime = item.timestamp || timestamp;

    if (type === 'BATCH_DISPATCH' && p && Array.isArray(p.bills)) {
      recordScanOut(ss, p.bills, p.dispatchDate || getTodayDateString(), p.agent, itemTime);
    } else if (type === 'SETTLEMENT_PAYMENT' || type === 'SETTLEMENT_RETURN') {
      recordScanIn(ss, p, itemTime);
    } else if (type === 'BILL_FLAG_MISSING') {
      const custodyBill = {
        billNo: p.billNo,
        agent: p.agent,
        status: 'LEFT_OUT_ALERT',
        remarks: 'ALERT: Bill left out / not returned by agent',
        lastActionDate: itemTime
      };
      syncCustodyBills(ss, [custodyBill], itemTime);
    }
  });
}

/**
 * Upsert rows into Live_Custody tab
 */
function syncCustodyBills(ss, bills, timestamp, defaultStatus, defaultDispatchDate) {
  const sheet = ss.getSheetByName(TRACKING_TABS.CUSTODY);
  if (!sheet || !bills || bills.length === 0) return;

  const lastRow = sheet.getLastRow();
  const billRowMap = {};

  if (lastRow > 1) {
    const existingBillNos = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    existingBillNos.forEach((r, idx) => {
      const bNo = String(r[0]).trim();
      if (bNo) billRowMap[bNo] = idx + 2;
    });
  }

  const newRows = [];

  bills.forEach(b => {
    const billNo = String(b.billNo || '').trim();
    if (!billNo) return;

    const party = String(b.party || '').trim();
    const amount = Number(b.amount) || 0;
    const agent = String(b.agent || '').trim();
    const dispatchDate = String(b.dispatchDate || defaultDispatchDate || getTodayDateString()).trim();
    const status = String(b.status || defaultStatus || 'WITH_AGENT').trim();
    const collected = Number(b.collectedAmt) || 0;
    const remainingDue = b.outstanding !== undefined ? Number(b.outstanding) : Math.max(0, amount - collected);
    const mode = String(b.paymentMode || '').trim();
    const ref = String(b.refNo || b.receipt || '').trim();
    const reason = String(b.returnReason || '').trim();
    const remarks = String(b.remarks || '').trim();
    const updated = String(b.lastActionDate || timestamp).trim();

    const rowValues = [
      billNo,
      party,
      amount,
      agent,
      dispatchDate,
      status,
      collected,
      remainingDue,
      mode,
      ref,
      reason,
      remarks,
      updated
    ];

    const existingIdx = billRowMap[billNo];
    if (existingIdx) {
      sheet.getRange(existingIdx, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      newRows.push(rowValues);
      billRowMap[billNo] = lastRow + newRows.length;
    }
  });

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }

  updateDailySummary(ss);
}

/**
 * Recompute and update Daily_Summary tab
 */
function updateDailySummary(ss) {
  const custodySheet = ss.getSheetByName(TRACKING_TABS.CUSTODY);
  const summarySheet = ss.getSheetByName(TRACKING_TABS.SUMMARY);
  if (!custodySheet || !summarySheet) return;

  const lastRow = custodySheet.getLastRow();
  if (lastRow <= 1) return;

  const data = custodySheet.getRange(2, 1, lastRow - 1, 13).getValues();
  const summaryMap = {};

  data.forEach(r => {
    const agent = String(r[3] || 'Unassigned').trim();
    const date = String(r[4] || getTodayDateString()).trim();
    const status = String(r[5] || '').trim();
    const amount = Number(r[2]) || 0;
    const collected = Number(r[6]) || 0;
    const remaining = Number(r[7]) || 0;

    const key = `${date}___${agent}`;
    if (!summaryMap[key]) {
      summaryMap[key] = {
        date,
        agent,
        dispatchedCount: 0,
        dispatchedValue: 0,
        checkedInCount: 0,
        totalCollected: 0,
        totalRemaining: 0,
        returnedCount: 0,
        leftOutCount: 0
      };
    }

    const item = summaryMap[key];
    item.dispatchedCount++;
    item.dispatchedValue += amount;

    if (status === 'PAID_FULL' || status === 'PAID_PARTIAL') {
      item.checkedInCount++;
      item.totalCollected += collected;
      item.totalRemaining += remaining;
    } else if (status === 'RETURNED_IN_HAND') {
      item.returnedCount++;
    } else if (status === 'WITH_AGENT' || status === 'LEFT_OUT_ALERT') {
      item.leftOutCount++;
      item.totalRemaining += amount;
    }
  });

  const summaryRows = Object.values(summaryMap).map(s => [
    s.date,
    s.agent,
    s.dispatchedCount,
    s.dispatchedValue,
    s.checkedInCount,
    s.totalCollected,
    s.totalRemaining,
    s.returnedCount,
    s.leftOutCount,
    getFormattedTimestamp()
  ]);

  if (summaryRows.length > 0) {
    const existingRows = summarySheet.getLastRow();
    if (existingRows > 1) {
      summarySheet.getRange(2, 1, existingRows - 1, 10).clearContent();
    }
    summarySheet.getRange(2, 1, summaryRows.length, 10).setValues(summaryRows);
  }
}

/**
 * Retrieve current active bills from Live_Custody
 */
function getCustodyBills(ss) {
  const sheet = ss.getSheetByName(TRACKING_TABS.CUSTODY);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  return values.map(r => ({
    billNo: String(r[0]),
    party: String(r[1]),
    amount: Number(r[2]) || 0,
    agent: String(r[3]),
    dispatchDate: String(r[4]),
    status: String(r[5]),
    collectedAmt: Number(r[6]) || 0,
    outstanding: Number(r[7]) || 0,
    paymentMode: String(r[8]),
    refNo: String(r[9]),
    returnReason: String(r[10]),
    remarks: String(r[11]),
    lastActionDate: String(r[12])
  }));
}

/**
 * Initialize and style the 4 database tabs
 */
function ensureDatabaseSetup(ss) {
  // 1. Scan_Out_Log
  let outSheet = ss.getSheetByName(TRACKING_TABS.SCAN_OUT);
  if (!outSheet) {
    outSheet = ss.insertSheet(TRACKING_TABS.SCAN_OUT);
    const headers = [
      ['Timestamp (IST)', 'Invoice / Bill No', 'Sales Agent', 'Party Name', 'Bill Amount (₹)', 'Dispatch Date', 'Remaining Due at Out (₹)', 'Receipt Info', 'Status', 'Notes']
    ];
    styleHeaderRow(outSheet, headers, '#1e3a8a'); // Navy Blue
    outSheet.setColumnWidth(1, 160);
    outSheet.setColumnWidth(2, 140);
    outSheet.setColumnWidth(3, 130);
    outSheet.setColumnWidth(4, 200);
    outSheet.setColumnWidth(5, 120);
    outSheet.setColumnWidth(7, 140);
  }

  // 2. Scan_In_Log
  let inSheet = ss.getSheetByName(TRACKING_TABS.SCAN_IN);
  if (!inSheet) {
    inSheet = ss.insertSheet(TRACKING_TABS.SCAN_IN);
    const headers = [
      ['Timestamp (IST)', 'Invoice / Bill No', 'Sales Agent', 'Party Name', 'Total Bill Amt (₹)', 'Collected Amt (₹)', 'Remaining Due Left (₹)', 'Payment Mode', 'Receipt / Ref No', 'Settlement Status', 'Return Reason', 'Remarks']
    ];
    styleHeaderRow(inSheet, headers, '#065f46'); // Emerald Green
    inSheet.setColumnWidth(1, 160);
    inSheet.setColumnWidth(2, 140);
    inSheet.setColumnWidth(3, 130);
    inSheet.setColumnWidth(4, 200);
    inSheet.setColumnWidth(5, 120);
    inSheet.setColumnWidth(6, 120);
    inSheet.setColumnWidth(7, 140);
  }

  // 3. Live_Custody
  let custodySheet = ss.getSheetByName(TRACKING_TABS.CUSTODY);
  if (!custodySheet) {
    custodySheet = ss.insertSheet(TRACKING_TABS.CUSTODY);
    const headers = [
      ['Invoice / Bill No', 'Party Name', 'Total Amount (₹)', 'Assigned Agent', 'Dispatch Date', 'Current Status', 'Collected Amt (₹)', 'Remaining Due (₹)', 'Payment Mode', 'Receipt / Ref No', 'Return Reason', 'Remarks', 'Last Updated (IST)']
    ];
    styleHeaderRow(custodySheet, headers, '#312e81'); // Indigo
    custodySheet.setColumnWidth(1, 140);
    custodySheet.setColumnWidth(2, 200);
    custodySheet.setColumnWidth(3, 120);
    custodySheet.setColumnWidth(4, 130);
    custodySheet.setColumnWidth(7, 120);
    custodySheet.setColumnWidth(8, 130);
    custodySheet.setColumnWidth(13, 160);
  }

  // 4. Daily_Summary
  let summarySheet = ss.getSheetByName(TRACKING_TABS.SUMMARY);
  if (!summarySheet) {
    summarySheet = ss.insertSheet(TRACKING_TABS.SUMMARY);
    const headers = [
      ['Date', 'Agent Name', 'Bills Dispatched', 'Total Out Value (₹)', 'Bills Checked In', 'Total Collected (₹)', 'Total Remaining Due (₹)', 'Returned Bills', 'Left Out Bills', 'Last Updated (IST)']
    ];
    styleHeaderRow(summarySheet, headers, '#0e7490'); // Teal
    summarySheet.setColumnWidth(1, 110);
    summarySheet.setColumnWidth(2, 140);
    summarySheet.setColumnWidth(4, 130);
    summarySheet.setColumnWidth(6, 130);
    summarySheet.setColumnWidth(7, 140);
    summarySheet.setColumnWidth(10, 160);
  }
}

/**
 * Helper to apply uniform header styling
 */
function styleHeaderRow(sheet, headers, bgColor) {
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  const headerRange = sheet.getRange(1, 1, 1, headers[0].length);
  headerRange
    .setBackground(bgColor)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10)
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 32);
  sheet.setFrozenRows(1);
}

/**
 * Format timestamp in IST (Asia/Kolkata)
 */
function getFormattedTimestamp() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Format today's date YYYY-MM-DD in IST
 */
function getTodayDateString() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
}

/**
 * Return JSON response
 */
function respondJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
