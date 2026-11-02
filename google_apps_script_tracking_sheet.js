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

    if (action === 'DEDUPE_LOGS' || action === 'CLEAN_LOGS') {
      const res = cleanDuplicateScanInRows(ss);
      return respondJSON({
        status: 'OK',
        message: `Deduplication complete: cleaned ${res.removedCount} duplicate / auto-healed rows from Scan_In_Log!`,
        keptCount: res.keptCount,
        removedCount: res.removedCount,
        timestamp: getFormattedTimestamp()
      });
    }

    if (action === 'BACKFILL_BEAT_WEEK' || action === 'UPDATE_BEAT_WEEK') {
      const targetAgent = e.parameter.agent || '';
      const targetDate = e.parameter.date || '';
      const targetBeat = e.parameter.beat || '';
      const targetWeek = e.parameter.week || 'Week 1';
      const updatedCount = backfillBeatAndWeek(ss, targetAgent, targetDate, targetBeat, targetWeek);
      return respondJSON({
        status: 'OK',
        action: 'BACKFILL_BEAT_WEEK',
        message: `Successfully updated Beat ("${targetBeat}") and Week ("${targetWeek}") for ${updatedCount} bills`,
        updatedCount: updatedCount,
        agent: targetAgent,
        date: targetDate,
        beat: targetBeat,
        week: targetWeek,
        timestamp: getFormattedTimestamp()
      });
    }

    if (action === 'CANONICALIZE_LOGS' || action === 'EXPAND_SHORTHAND_BILLS') {
      const res = canonicalizeTrackingSheets(ss);
      return respondJSON({
        status: 'OK',
        action: 'CANONICALIZE_LOGS',
        message: `Canonicalization complete: ${res.custodyCount} unique custody rows, ${res.outUpdated} Scan_Out shorthand rows expanded, ${res.inUpdated} Scan_In shorthand rows expanded`,
        custodyCount: res.custodyCount,
        outUpdated: res.outUpdated,
        inUpdated: res.inUpdated,
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

    // 4. Backfill / Update Beat & Week
    if (action === 'BACKFILL_BEAT_WEEK' || action === 'UPDATE_BEAT_WEEK') {
      const p = data.payload || data;
      const targetAgent = p.agent || '';
      const targetDate = p.date || '';
      const targetBeat = p.beat || '';
      const targetWeek = p.week || 'Week 1';
      const updatedCount = backfillBeatAndWeek(ss, targetAgent, targetDate, targetBeat, targetWeek);
      return respondJSON({
        success: true,
        action: 'BACKFILL_BEAT_WEEK',
        message: `Successfully updated Beat ("${targetBeat}") and Week ("${targetWeek}") for ${updatedCount} bills`,
        updatedCount: updatedCount,
        agent: targetAgent,
        date: targetDate,
        beat: targetBeat,
        week: targetWeek,
        timestamp: nowIST
      });
    }

    // 5. Canonicalize all invoice numbers & deduplicate Live_Custody
    if (action === 'CANONICALIZE_LOGS' || action === 'EXPAND_SHORTHAND_BILLS') {
      const res = canonicalizeTrackingSheets(ss);
      return respondJSON({
        success: true,
        action: 'CANONICALIZE_LOGS',
        message: `Canonicalization complete: ${res.custodyCount} unique custody rows, ${res.outUpdated} Scan_Out shorthand rows expanded, ${res.inUpdated} Scan_In shorthand rows expanded`,
        custodyCount: res.custodyCount,
        outUpdated: res.outUpdated,
        inUpdated: res.inUpdated,
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
    const billNo = expandCanonicalInvoiceNumber(String(b.billNo || '').trim());
    const agent = String(b.agent || defaultAgent || '').trim();
    const party = String(b.party || 'Standard Customer').trim();
    const amount = Number(b.amount) || 0;
    const remainingDue = b.outstanding !== undefined ? Number(b.outstanding) : amount;
    const receipt = String(b.receipt || b.refNo || '').trim();
    const notes = b.remarks || `Dispatched for route ${dispatchDate}`;
    const beat = String(b.beat || b.beatName || '').trim();
    const week = String(b.week || '').trim();

    outRows.push([
      timestamp,
      sanitizeCellForSheet(billNo),
      sanitizeCellForSheet(agent),
      sanitizeCellForSheet(party),
      amount,
      dispatchDate,
      remainingDue,
      sanitizeCellForSheet(receipt),
      'WITH_AGENT',
      sanitizeCellForSheet(notes),
      sanitizeCellForSheet(beat),
      sanitizeCellForSheet(week)
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
  if (!inSheet) return;

  const billNo = expandCanonicalInvoiceNumber(String(p.billNo || '').trim());
  if (!billNo) return;

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
  const beat = String(p.beat || p.beatName || '').trim();
  const week = String(p.week || '').trim();

  // Guard: If this was an automated reconciliation/heal, do NOT create rows in Scan_In_Log!
  if (remarks.indexOf('Auto-Healed') !== -1 || remarks.indexOf('Verified Paid on Master Sheet') !== -1) {
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
      lastActionDate: timestamp,
      beat,
      week
    };
    syncCustodyBills(ss, [custodyBill], timestamp);
    return;
  }

  const row = [
    timestamp,
    sanitizeCellForSheet(billNo),
    sanitizeCellForSheet(agent),
    sanitizeCellForSheet(party),
    totalAmt,
    collectedAmt,
    remainingDue,
    sanitizeCellForSheet(paymentMode),
    sanitizeCellForSheet(refNo),
    status,
    sanitizeCellForSheet(returnReason),
    sanitizeCellForSheet(remarks),
    sanitizeCellForSheet(beat),
    sanitizeCellForSheet(week)
  ];

  // Anti-duplication check: if bill was already recorded today in Scan_In_Log, update that row instead of appending duplicate rows
  const lastRow = inSheet.getLastRow();
  let existingRow = -1;
  const todayPrefix = String(timestamp || '').slice(0, 10);

  if (lastRow > 1) {
    const numRows = Math.min(lastRow - 1, 300);
    const startRow = lastRow - numRows + 1;
    const existingData = inSheet.getRange(startRow, 1, numRows, 2).getValues();
    const targetNorm = normalizeInvNumber(billNo);

    for (let i = existingData.length - 1; i >= 0; i--) {
      const rowTime = String(existingData[i][0] || '');
      const rowBill = String(existingData[i][1] || '').trim();
      if (rowBill && normalizeInvNumber(rowBill) === targetNorm) {
        if (!todayPrefix || rowTime.indexOf(todayPrefix) === 0) {
          existingRow = startRow + i;
          break;
        }
      }
    }
  }

  if (existingRow > 0) {
    inSheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    inSheet.appendRow(row);
  }

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
    lastActionDate: timestamp,
    beat,
    week
  };

  syncCustodyBills(ss, [custodyBill], timestamp);
}

/**
 * Process queue items from offline sync
 */
function processSyncQueue(ss, queue, timestamp) {
  if (!queue || !Array.isArray(queue) || queue.length === 0) return;

  // Deduplicate queue items by billNo and type so each bill is only processed once in this batch
  const seenKeys = new Set();
  const dedupedQueue = [];

  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i];
    if (!item) continue;
    const p = item.payload;
    const billNo = p && p.billNo ? normalizeInvNumber(p.billNo) : null;
    if (billNo) {
      const key = `${item.type}_${billNo}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    dedupedQueue.unshift(item);
  }

  dedupedQueue.forEach(item => {
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
        lastActionDate: itemTime,
        beat: p.beat || '',
        week: p.week || ''
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
      if (bNo) {
        billRowMap[bNo] = idx + 2;
        billRowMap[normalizeInvNumber(bNo)] = idx + 2;
        billRowMap[normalizeInvNumber(expandCanonicalInvoiceNumber(bNo))] = idx + 2;
      }
    });
  }

  const newRows = [];

  bills.forEach(b => {
    const billNo = expandCanonicalInvoiceNumber(String(b.billNo || '').trim());
    if (!billNo) return;

    const party = String(b.party || '').trim();
    const amount = Number(b.amount) || 0;
    const agent = String(b.agent || '').trim();
    const dispatchDate = String(b.dispatchDate || defaultDispatchDate || (b.lastActionDate ? b.lastActionDate.slice(0, 10) : '')).trim();
    const status = String(b.status || defaultStatus || 'WITH_AGENT').trim();
    const collected = Number(b.collectedAmt) || 0;
    const remainingDue = b.outstanding !== undefined ? Number(b.outstanding) : Math.max(0, amount - collected);
    const mode = String(b.paymentMode || '').trim();
    const ref = String(b.refNo || b.receipt || '').trim();
    const reason = String(b.returnReason || '').trim();
    const remarks = String(b.remarks || '').trim();
    const updated = String(b.lastActionDate || timestamp).trim();
    const beat = String(b.beat || b.beatName || '').trim();
    const week = String(b.week || '').trim();

    const rowValues = [
      sanitizeCellForSheet(billNo),
      sanitizeCellForSheet(party),
      amount,
      sanitizeCellForSheet(agent),
      dispatchDate,
      status,
      collected,
      remainingDue,
      sanitizeCellForSheet(mode),
      sanitizeCellForSheet(ref),
      sanitizeCellForSheet(reason),
      sanitizeCellForSheet(remarks),
      updated,
      sanitizeCellForSheet(beat),
      sanitizeCellForSheet(week)
    ];

    const existingIdx = billRowMap[billNo] || billRowMap[normalizeInvNumber(billNo)] || billRowMap[normalizeInvNumber(expandCanonicalInvoiceNumber(billNo))];
    if (existingIdx) {
      if (!beat || !week) {
        const existingRowVals = sheet.getRange(existingIdx, 14, 1, 2).getValues()[0];
        if (!beat && existingRowVals[0]) rowValues[13] = existingRowVals[0];
        if (!week && existingRowVals[1]) rowValues[14] = existingRowVals[1];
      }
      sheet.getRange(existingIdx, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      newRows.push(rowValues);
      const newIdx = lastRow + newRows.length;
      billRowMap[billNo] = newIdx;
      billRowMap[normalizeInvNumber(billNo)] = newIdx;
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

  const lastCol = Math.max(15, sheet.getLastColumn());
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
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
    lastActionDate: String(r[12]),
    beat: String(r[13] || '').trim(),
    week: String(r[14] || '').trim()
  }));
}

/**
 * Initialize and style the 4 database tabs
 */
function ensureDatabaseSetup(ss) {
  if (!ss) {
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById('1Lu1C-aX9KCRhCrcrZNal81tt4-wD_6wqHWqsI5orTrY');
    } catch (e) {
      ss = SpreadsheetApp.openById('1Lu1C-aX9KCRhCrcrZNal81tt4-wD_6wqHWqsI5orTrY');
    }
  }

  // 1. Scan_Out_Log
  let outSheet = ss.getSheetByName(TRACKING_TABS.SCAN_OUT);
  if (!outSheet) {
    outSheet = ss.insertSheet(TRACKING_TABS.SCAN_OUT);
    const headers = [
      ['Timestamp (IST)', 'Invoice / Bill No', 'Sales Agent', 'Party Name', 'Bill Amount (₹)', 'Dispatch Date', 'Remaining Due at Out (₹)', 'Receipt Info', 'Status', 'Notes', 'Beat Route', 'Week']
    ];
    styleHeaderRow(outSheet, headers, '#1e3a8a'); // Navy Blue
    outSheet.setColumnWidth(1, 160);
    outSheet.setColumnWidth(2, 140);
    outSheet.setColumnWidth(3, 130);
    outSheet.setColumnWidth(4, 200);
    outSheet.setColumnWidth(5, 120);
    outSheet.setColumnWidth(7, 140);
    outSheet.setColumnWidth(11, 160);
    outSheet.setColumnWidth(12, 100);
  } else {
    const colCount = outSheet.getLastColumn();
    if (colCount < 11 || !outSheet.getRange(1, 11).getValue()) {
      outSheet.getRange(1, 11).setValue('Beat Route').setBackground('#1e3a8a').setFontColor('#ffffff').setFontWeight('bold');
      outSheet.setColumnWidth(11, 160);
    }
    if (colCount < 12 || !outSheet.getRange(1, 12).getValue()) {
      outSheet.getRange(1, 12).setValue('Week').setBackground('#1e3a8a').setFontColor('#ffffff').setFontWeight('bold');
      outSheet.setColumnWidth(12, 100);
    }
  }

  // 2. Scan_In_Log
  let inSheet = ss.getSheetByName(TRACKING_TABS.SCAN_IN);
  if (!inSheet) {
    inSheet = ss.insertSheet(TRACKING_TABS.SCAN_IN);
    const headers = [
      ['Timestamp (IST)', 'Invoice / Bill No', 'Sales Agent', 'Party Name', 'Total Bill Amt (₹)', 'Collected Amt (₹)', 'Remaining Due Left (₹)', 'Payment Mode', 'Receipt / Ref No', 'Settlement Status', 'Return Reason', 'Remarks', 'Beat Route', 'Week']
    ];
    styleHeaderRow(inSheet, headers, '#065f46'); // Emerald Green
    inSheet.setColumnWidth(1, 160);
    inSheet.setColumnWidth(2, 140);
    inSheet.setColumnWidth(3, 130);
    inSheet.setColumnWidth(4, 200);
    inSheet.setColumnWidth(5, 120);
    inSheet.setColumnWidth(6, 120);
    inSheet.setColumnWidth(7, 140);
    inSheet.setColumnWidth(13, 160);
    inSheet.setColumnWidth(14, 100);
  } else {
    const colCount = inSheet.getLastColumn();
    if (colCount < 13 || !inSheet.getRange(1, 13).getValue()) {
      inSheet.getRange(1, 13).setValue('Beat Route').setBackground('#065f46').setFontColor('#ffffff').setFontWeight('bold');
      inSheet.setColumnWidth(13, 160);
    }
    if (colCount < 14 || !inSheet.getRange(1, 14).getValue()) {
      inSheet.getRange(1, 14).setValue('Week').setBackground('#065f46').setFontColor('#ffffff').setFontWeight('bold');
      inSheet.setColumnWidth(14, 100);
    }
  }

  // 3. Live_Custody
  let custodySheet = ss.getSheetByName(TRACKING_TABS.CUSTODY);
  if (!custodySheet) {
    custodySheet = ss.insertSheet(TRACKING_TABS.CUSTODY);
    const headers = [
      ['Invoice / Bill No', 'Party Name', 'Total Amount (₹)', 'Assigned Agent', 'Dispatch Date', 'Current Status', 'Collected Amt (₹)', 'Remaining Due (₹)', 'Payment Mode', 'Receipt / Ref No', 'Return Reason', 'Remarks', 'Last Updated (IST)', 'Beat Route', 'Week']
    ];
    styleHeaderRow(custodySheet, headers, '#312e81'); // Indigo
    custodySheet.setColumnWidth(1, 140);
    custodySheet.setColumnWidth(2, 200);
    custodySheet.setColumnWidth(3, 120);
    custodySheet.setColumnWidth(4, 130);
    custodySheet.setColumnWidth(7, 120);
    custodySheet.setColumnWidth(8, 130);
    custodySheet.setColumnWidth(13, 160);
    custodySheet.setColumnWidth(14, 160);
    custodySheet.setColumnWidth(15, 100);
  } else {
    const colCount = custodySheet.getLastColumn();
    if (colCount < 14 || !custodySheet.getRange(1, 14).getValue()) {
      custodySheet.getRange(1, 14).setValue('Beat Route').setBackground('#312e81').setFontColor('#ffffff').setFontWeight('bold');
      custodySheet.setColumnWidth(14, 160);
    }
    if (colCount < 15 || !custodySheet.getRange(1, 15).getValue()) {
      custodySheet.getRange(1, 15).setValue('Week').setBackground('#312e81').setFontColor('#ffffff').setFontWeight('bold');
      custodySheet.setColumnWidth(15, 100);
    }
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

/**
 * Normalize an invoice number for comparison: case, spaces, dashes, slashes, dots.
 * Keeps the FULL number. Stripping the "IN-FY26/27-" prefix made different vouchers with the
 * same trailing number (e.g. IN-FY25/26-3965 and IN-FY26/27-3965) overwrite / dedupe each other.
 */
function normalizeInvNumber(val) {
  if (!val) return '';
  return String(val).trim().toUpperCase().replace(/[\s\-_/.'"`]/g, '');
}

/**
 * Neutralize CSV / Spreadsheet formula injection (CWE-1236).
 * Prepends a single quote (') if a string begins with formula triggers (=, +, -, @, \t, \r)
 * so Google Sheets safely treats it as a plain-text literal rather than an executable formula.
 */
function sanitizeCellForSheet(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  const s = String(val).trim();
  if (/^[=+\-@\t\r]/.test(s)) {
    return "'" + s;
  }
  return s;
}

/**
 * Expand shorthand invoice inputs into their full canonical series representation.
 * e.g. "3-6757" -> "IN-17063-6757" (Series 17063)
 * e.g. "7-2472" or "27-5613" -> "IN-FY26/27-2472" or "IN-FY26/27-5613" (Series FY26/27)
 */
function expandCanonicalInvoiceNumber(val) {
  if (!val) return '';
  const s = String(val).trim();
  const upper = s.toUpperCase();
  if (/^IN[-_\s]?(17063|FY26\/27)[-_\s]?\d+/i.test(upper)) {
    return upper.replace(/^IN[-_\s]*17063[-_\s]*/i, 'IN-17063-')
                .replace(/^IN[-_\s]*FY26\/27[-_\s]*/i, 'IN-FY26/27-')
                .replace(/^N[-_\s]*FY26\/27[-_\s]*/i, 'IN-FY26/27-');
  }
  const match3 = s.match(/^3[-_\s]?(\d{3,6})$/);
  if (match3) return 'IN-17063-' + match3[1];
  const match27 = s.match(/^27[-_\s]?(\d{3,6})$/);
  if (match27) return 'IN-FY26/27-' + match27[1];
  const match7 = s.match(/^7[-_\s]?(\d{3,6})$/);
  if (match7) return 'IN-FY26/27-' + match7[1];
  const matchFY = s.match(/^(?:FY)?26\/27[-_\s]?(\d{3,6})$/i);
  if (matchFY) return 'IN-FY26/27-' + matchFY[1];
  const match17 = s.match(/^17063[-_\s]?(\d{3,6})$/i);
  if (match17) return 'IN-17063-' + match17[1];
  return s;
}

/**
 * Deduplicate and cleanse Scan_In_Log:
 * - Removes auto-healed phantom rows mistakenly recorded
 * - Deduplicates multiple check-in rows for the same bill on the same date, keeping the latest row
 */
function cleanDuplicateScanInRows(ss) {
  const sheet = ss.getSheetByName(TRACKING_TABS.SCAN_IN);
  if (!sheet) return { removedCount: 0, keptCount: 0 };

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { removedCount: 0, keptCount: 0 };

  const numCols = Math.max(14, sheet.getLastColumn());
  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const seen = new Map();
  let removedCount = 0;

  data.forEach(row => {
    const timestamp = String(row[0] || '').trim();
    const dateStr = timestamp.slice(0, 10);
    const billNo = String(row[1] || '').trim();
    const remarks = String(row[11] || '').trim();

    // Remove unintended auto-healed rows
    if (remarks.indexOf('Auto-Healed') !== -1 || remarks.indexOf('Verified Paid on Master Sheet') !== -1) {
      removedCount++;
      return;
    }

    if (!billNo) {
      removedCount++;
      return;
    }

    const norm = normalizeInvNumber(billNo);
    const key = `${dateStr}_${norm}`;

    if (seen.has(key)) {
      removedCount++;
    }
    seen.set(key, row);
  });

  const cleanRows = Array.from(seen.values());

  sheet.getRange(2, 1, Math.max(1, lastRow - 1), numCols).clearContent();
  if (cleanRows.length > 0) {
    sheet.getRange(2, 1, cleanRows.length, cleanRows[0].length).setValues(cleanRows);
  }

  return { removedCount, keptCount: cleanRows.length };
}

function isSameAgent(a, b) {
  if (!a || !b) return false;
  const sA = String(a).toLowerCase().trim();
  const sB = String(b).toLowerCase().trim();
  if (sA === sB) return true;
  if (sA.indexOf('shivam') !== -1 && sB.indexOf('shivam') !== -1) return true;
  if (sA.indexOf('rajesh') !== -1 && sB.indexOf('rajesh') !== -1) return true;
  if (sA.indexOf('self') !== -1 && sB.indexOf('self') !== -1) return true;
  return false;
}

/**
 * Backfill Beat Route and Week for existing bills in Live_Custody and Scan_Out_Log
 */
function backfillBeatAndWeek(ss, targetAgent, targetDate, targetBeat, targetWeek) {
  if (!ss) {
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById('1Lu1C-aX9KCRhCrcrZNal81tt4-wD_6wqHWqsI5orTrY');
    } catch (e) {
      ss = SpreadsheetApp.openById('1Lu1C-aX9KCRhCrcrZNal81tt4-wD_6wqHWqsI5orTrY');
    }
  }

  const custodySheet = ss.getSheetByName(TRACKING_TABS.CUSTODY);
  const outSheet = ss.getSheetByName(TRACKING_TABS.SCAN_OUT);
  let updatedCount = 0;

  // 1. Update Live_Custody
  if (custodySheet) {
    const lastRow = custodySheet.getLastRow();
    if (lastRow > 1) {
      const colCount = Math.max(15, custodySheet.getLastColumn());
      const values = custodySheet.getRange(2, 1, lastRow - 1, colCount).getValues();
      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        const agent = String(row[3] || '').trim();
        const dDate = String(row[4] || '').trim();
        const lastAction = String(row[12] || '').trim();

        const agentMatch = !targetAgent || targetAgent === 'ALL' || isSameAgent(agent, targetAgent);
        const dateMatch = !targetDate || targetDate === 'ALL' || dDate.indexOf(targetDate) !== -1 || lastAction.indexOf(targetDate) !== -1;

        if (agentMatch && dateMatch) {
          if (targetBeat) custodySheet.getRange(i + 2, 14).setValue(targetBeat);
          if (targetWeek) custodySheet.getRange(i + 2, 15).setValue(targetWeek);
          updatedCount++;
        }
      }
    }
  }

  // 2. Update Scan_Out_Log
  if (outSheet) {
    const lastRow = outSheet.getLastRow();
    if (lastRow > 1) {
      const colCount = Math.max(12, outSheet.getLastColumn());
      const values = outSheet.getRange(2, 1, lastRow - 1, colCount).getValues();
      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        const ts = String(row[0] || '').trim();
        const agent = String(row[2] || '').trim();
        const dDate = String(row[5] || '').trim();

        const agentMatch = !targetAgent || targetAgent === 'ALL' || isSameAgent(agent, targetAgent);
        const dateMatch = !targetDate || targetDate === 'ALL' || ts.indexOf(targetDate) !== -1 || dDate.indexOf(targetDate) !== -1;

        if (agentMatch && dateMatch) {
          if (targetBeat) outSheet.getRange(i + 2, 11).setValue(targetBeat);
          if (targetWeek) outSheet.getRange(i + 2, 12).setValue(targetWeek);
        }
      }
    }
  }

  return updatedCount;
}

/**
 * Canonicalize all invoice numbers across Live_Custody, Scan_Out_Log, and Scan_In_Log.
 * - Expands shorthand series bill numbers ("3-6757" -> "IN-17063-6757", "7-2472" -> "IN-FY26/27-2472", "27-5613" -> "IN-FY26/27-5613")
 * - Deduplicates Live_Custody rows, merging beat/week and retaining the latest status
 */
function canonicalizeTrackingSheets(ss) {
  if (!ss) {
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById('1Lu1C-aX9KCRhCrcrZNal81tt4-wD_6wqHWqsI5orTrY');
    } catch (e) {
      ss = SpreadsheetApp.openById('1Lu1C-aX9KCRhCrcrZNal81tt4-wD_6wqHWqsI5orTrY');
    }
  }

  let custodyUpdated = 0;
  let outUpdated = 0;
  let inUpdated = 0;

  // 1. Live_Custody
  const custodySheet = ss.getSheetByName(TRACKING_TABS.CUSTODY);
  if (custodySheet) {
    const lastRow = custodySheet.getLastRow();
    if (lastRow > 1) {
      const colCount = Math.max(15, custodySheet.getLastColumn());
      const values = custodySheet.getRange(2, 1, lastRow - 1, colCount).getValues();
      const dedupMap = new Map();

      values.forEach(row => {
        const rawBillNo = String(row[0] || '').trim();
        if (!rawBillNo) return;
        const canon = expandCanonicalInvoiceNumber(rawBillNo);
        row[0] = canon;
        const norm = normalizeInvNumber(canon);

        if (dedupMap.has(norm)) {
          const existing = dedupMap.get(norm);
          // Preserve Beat / Week if existing had it
          if (!row[13] && existing[13]) row[13] = existing[13];
          if (!row[14] && existing[14]) row[14] = existing[14];
          // Preserve payment info if existing was paid and current row is not
          if (row[5] === 'WITH_AGENT' && (existing[5] === 'PAID_FULL' || existing[5] === 'PAID_PARTIAL')) {
            row[5] = existing[5];
            row[6] = existing[6];
            row[7] = existing[7];
            row[8] = existing[8];
            row[9] = existing[9];
          }
        }
        dedupMap.set(norm, row);
      });

      const cleanRows = Array.from(dedupMap.values());
      custodySheet.getRange(2, 1, lastRow - 1, colCount).clearContent();
      if (cleanRows.length > 0) {
        custodySheet.getRange(2, 1, cleanRows.length, cleanRows[0].length).setValues(cleanRows);
      }
      custodyUpdated = cleanRows.length;
    }
  }

  // 2. Scan_Out_Log
  const outSheet = ss.getSheetByName(TRACKING_TABS.SCAN_OUT);
  if (outSheet) {
    const lastRow = outSheet.getLastRow();
    if (lastRow > 1) {
      const colCount = Math.max(12, outSheet.getLastColumn());
      const values = outSheet.getRange(2, 1, lastRow - 1, colCount).getValues();
      let changed = false;
      for (let i = 0; i < values.length; i++) {
        const rawBillNo = String(values[i][1] || '').trim();
        if (rawBillNo) {
          const canon = expandCanonicalInvoiceNumber(rawBillNo);
          if (canon !== rawBillNo) {
            values[i][1] = canon;
            changed = true;
            outUpdated++;
          }
        }
      }
      if (changed) {
        outSheet.getRange(2, 1, values.length, colCount).setValues(values);
      }
    }
  }

  // 3. Scan_In_Log
  const inSheet = ss.getSheetByName(TRACKING_TABS.SCAN_IN);
  if (inSheet) {
    const lastRow = inSheet.getLastRow();
    if (lastRow > 1) {
      const colCount = Math.max(14, inSheet.getLastColumn());
      const values = inSheet.getRange(2, 1, lastRow - 1, colCount).getValues();
      let changed = false;
      for (let i = 0; i < values.length; i++) {
        const rawBillNo = String(values[i][1] || '').trim();
        if (rawBillNo) {
          const canon = expandCanonicalInvoiceNumber(rawBillNo);
          if (canon !== rawBillNo) {
            values[i][1] = canon;
            changed = true;
            inUpdated++;
          }
        }
      }
      if (changed) {
        inSheet.getRange(2, 1, values.length, colCount).setValues(values);
      }
    }
  }

  updateDailySummary(ss);

  return { custodyCount: custodyUpdated, outUpdated, inUpdated };
}
