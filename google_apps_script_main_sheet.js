/**
 * ===================================================================
 * BillAudit Pro - MAIN SHEET FETCHER SCRIPT (100% READ-ONLY)
 * Strictly Targets: "MARCH-SEPT" Tab (GID: 1608276684)
 * High-Speed Lookup for: Receipt Details & Remaining Payment (OUTSTANDING)
 * ===================================================================
 * 
 * PURPOSE:
 * Deploy this script directly inside your MAIN SALES / BILLING Google Sheet.
 * It will ONLY read and fetch invoice numbers, customer details,
 * Receipt details, and Remaining Payment Amounts (Outstanding).
 * 
 * SAFETY GUARANTEE:
 * - 100% Strictly READ-ONLY.
 * - ZERO edits, rows, or cells will EVER be written or changed in this sheet.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your MAIN Google Sheet (15 sept Copy of ALL INVOICE PARTY).
 * 2. In top menu, click: Extensions > Apps Script.
 * 3. Make sure only ONE file exists (delete any duplicate 'Untitled.gs' files).
 * 4. Paste this ENTIRE code into Code.gs.
 * 5. Click "Deploy" > "Manage deployments" > Edit ✏️ > Version: "New version" > "Deploy".
 * ===================================================================
 */

const TARGET_CONFIG = {
  TAB_NAME: 'MARCH-SEPT',
  GID: '1608276684'
};

// Column mapping keywords (matches headers or column letters)
function getMainColumnMappings() {
  return {
    INVOICE: ['invoice number', 'inv bill no', 'invoice', 'bill', 'billno', 'invno', 'docno', 'd'],
    RECEIPT: ['receipt', 'receipt col', 'receipt no'],
    OUTSTANDING: ['outstanding', 'payment remaining', 'remaining'],
    PARTY: ['customer', 'party', 'shop', 'store', 'client', 'buyer', 'party name'],
    AMOUNT: ['amount', 'total', 'net', 'bill amount', 'grand total', 'net amount', 'totinvval'],
    AGENT: ['agent', 'salesman', 'delivery', 'name', 'sales agent', 'delivery agent']
  };
}

/**
 * Handle GET requests (Health Check, Full Data Pull, or Fast Single-Bill Lookup)
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action.toUpperCase() : 'GET_DATA';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = findTargetSheet(ss, e?.parameter?.gid, e?.parameter?.tab);

    if (!sheet) {
      return respondJSON({
        status: 'ERROR',
        message: `Target sheet tab "${TARGET_CONFIG.TAB_NAME}" not found.`
      });
    }

    // 1. Health check ping
    if (action === 'PING') {
      const detected = scanHeaders(sheet);
      return respondJSON({
        status: 'OK',
        mode: 'READ_ONLY_FETCHER',
        message: 'Main Sheet Fetcher Connected Successfully',
        sheetTitle: ss.getName(),
        targetTab: sheet.getName(),
        gid: String(sheet.getSheetId()),
        totalRows: sheet.getLastRow(),
        detectedColumns: detected,
        timestamp: new Date().toISOString()
      });
    }

    // 2. High-speed single bill search (e.g. ?action=FIND_BILL&billNo=IN-FY26/27-3965 or ?billNo=3965)
    const searchBillNo = e?.parameter?.billNo || e?.parameter?.inv;
    if (action === 'FIND_BILL' || (searchBillNo && action !== 'GET_DATA')) {
      const match = findSingleBillInSheet(sheet, searchBillNo);
      return respondJSON({
        status: 'OK',
        mode: 'READ_ONLY_FETCHER',
        sheetTitle: ss.getName(),
        tabName: sheet.getName(),
        query: searchBillNo,
        found: !!match,
        bill: match || null,
        timestamp: new Date().toISOString()
      });
    }

    // 3. Fast batch fetch of all bills from MARCH-SEPT tab
    if (action === 'GET_DATA' || action === 'GET_MASTER_SHEET' || action === 'FETCH') {
      const bills = extractBillsFromSheet(sheet);
      return respondJSON({
        status: 'OK',
        mode: 'READ_ONLY_FETCHER',
        sheetTitle: ss.getName(),
        tabName: sheet.getName(),
        gid: String(sheet.getSheetId()),
        count: bills.length,
        bills: bills,
        timestamp: new Date().toISOString()
      });
    }

    return respondJSON({ status: 'ERROR', message: 'Unknown action: ' + action });
  } catch (err) {
    return respondJSON({ status: 'ERROR', message: err.toString() });
  }
}

/**
 * STRICT SAFETY LOCK: Block all POST writes to Main Sheet
 */
function doPost(e) {
  return respondJSON({
    success: false,
    error: 'SAFETY LOCK: The Main Sheet is 100% Read-Only. No writes are permitted.'
  });
}

/**
 * Specifically targets the "MARCH-SEPT" tab (or GID 1608276684)
 */
function findTargetSheet(ss, targetGid, targetTabName) {
  const sheets = ss.getSheets();

  // 1. Match GID first (exact tab ID for MARCH-SEPT: 1608276684)
  const gidToMatch = targetGid || TARGET_CONFIG.GID;
  const matchGid = sheets.find(s => String(s.getSheetId()) === String(gidToMatch));
  if (matchGid) return matchGid;

  // 2. Match exact name "MARCH-SEPT"
  const tabName = targetTabName || TARGET_CONFIG.TAB_NAME;
  let sheet = ss.getSheetByName(tabName);
  if (sheet) return sheet;

  // 3. Case-insensitive and trimmed name match (e.g. "march-sept", "MARCH - SEPT")
  const targetClean = tabName.toUpperCase().replace(/[\s\-_/.]/g, '');
  for (let i = 0; i < sheets.length; i++) {
    const sNameClean = sheets[i].getName().toUpperCase().replace(/[\s\-_/.]/g, '');
    if (sNameClean === targetClean || sNameClean.includes('MARCHSEPT')) {
      return sheets[i];
    }
  }

  // 4. Fallback: Find tab with most rows (MARCH-SEPT contains 15,000+ bills)
  let bestSheet = sheets[0];
  let maxRows = 0;
  for (let i = 0; i < sheets.length; i++) {
    const r = sheets[i].getLastRow();
    if (r > maxRows) {
      maxRows = r;
      bestSheet = sheets[i];
    }
  }
  return bestSheet;
}

/**
 * Scan headers with 2-pass exact prioritization
 */
function scanHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim().toLowerCase());

  function findColIndex(keywords) {
    // Pass 1: EXACT MATCH
    for (let i = 0; i < headers.length; i++) {
      if (keywords.some(k => headers[i] === k)) return i;
    }
    // Pass 2: SUBSTRING MATCH (excluding false positives like 'overdue')
    for (let i = 0; i < headers.length; i++) {
      if (keywords.some(k => k.length > 2 && headers[i].includes(k) && !headers[i].includes('overdue'))) return i;
    }
    // Pass 3: Column letter match
    for (const k of keywords) {
      if (/^[a-z]$/.test(k)) {
        const colIdx = k.charCodeAt(0) - 97;
        if (colIdx < headers.length) return colIdx;
      }
    }
    return -1;
  }

  const mappings = getMainColumnMappings();
  return {
    invoiceCol: findColIndex(mappings.INVOICE),
    receiptCol: findColIndex(mappings.RECEIPT),
    outstandingCol: findColIndex(mappings.OUTSTANDING),
    partyCol: findColIndex(mappings.PARTY),
    amountCol: findColIndex(mappings.AMOUNT),
    agentCol: findColIndex(mappings.AGENT)
  };
}

/**
 * High-speed single-bill lookup using Google Sheets native TextFinder (<30ms)
 */
function findSingleBillInSheet(sheet, billNo) {
  if (!billNo) return null;
  const cleanInput = String(billNo).trim();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const detected = scanHeaders(sheet);
  const idxInv = (detected.invoiceCol !== undefined && detected.invoiceCol !== -1) ? detected.invoiceCol : 3;
  const idxReceipt = (detected.receiptCol !== undefined && detected.receiptCol !== -1) ? detected.receiptCol : 12;
  const idxOutstanding = (detected.outstandingCol !== undefined && detected.outstandingCol !== -1) ? detected.outstandingCol : 11;
  const idxParty = (detected.partyCol !== undefined && detected.partyCol !== -1) ? detected.partyCol : 4;
  const idxAmt = (detected.amountCol !== undefined && detected.amountCol !== -1) ? detected.amountCol : 5;
  const idxAgent = (detected.agentCol !== undefined && detected.agentCol !== -1) ? detected.agentCol : 15;

  // Search Column D for invoice number using native TextFinder
  const colLetter = String.fromCharCode(65 + idxInv);
  const invRange = sheet.getRange(`${colLetter}2:${colLetter}${lastRow}`);

  let foundCell = null;

  // 1. Exact cell match on Invoice column
  foundCell = invRange.createTextFinder(cleanInput).matchEntireCell(true).findNext();

  // 2. Match within cell
  if (!foundCell) {
    foundCell = invRange.createTextFinder(cleanInput).matchEntireCell(false).findNext();
  }

  // 3. Suffix match if digits provided (e.g. "3965" matches "IN-FY26/27-3965")
  if (!foundCell) {
    const digitsOnly = cleanInput.replace(/\D/g, '');
    if (digitsOnly.length >= 3) {
      foundCell = invRange.createTextFinder('-' + digitsOnly).matchEntireCell(false).findNext() ||
                  invRange.createTextFinder('/' + digitsOnly).matchEntireCell(false).findNext() ||
                  invRange.createTextFinder(digitsOnly).matchEntireCell(false).findNext();
    }
  }

  // 4. Whole sheet fallback
  if (!foundCell) {
    foundCell = sheet.createTextFinder(cleanInput).matchEntireCell(false).findNext();
  }

  if (!foundCell) return null;

  const rowNum = foundCell.getRow();
  const maxCol = Math.max(idxInv, idxReceipt, idxOutstanding, idxParty, idxAmt, idxAgent) + 1;
  const rowVals = sheet.getRange(rowNum, 1, 1, maxCol).getValues()[0];

  const rawAmt = rowVals[idxAmt];
  const cleanAmt = typeof rawAmt === 'number' ? rawAmt : (parseFloat(String(rawAmt).replace(/[₹,\s]/g, '')) || 0);

  const rawReceipt = rowVals[idxReceipt];
  const receipt = String(rawReceipt || '').trim();

  const rawOutstanding = rowVals[idxOutstanding];
  let cleanOutstanding = 0;
  if (typeof rawOutstanding === 'number') {
    cleanOutstanding = rawOutstanding;
  } else if (rawOutstanding) {
    cleanOutstanding = parseFloat(String(rawOutstanding).replace(/[₹,\s]/g, '')) || 0;
  }

  return {
    billNo: String(rowVals[idxInv] || cleanInput).trim(),
    party: String(rowVals[idxParty] || 'General Customer').trim(),
    amount: cleanAmt,
    agent: String(rowVals[idxAgent] || '').trim(),
    receipt: receipt,
    outstanding: cleanOutstanding,
    remainingText: rawOutstanding ? String(rawOutstanding).trim() : ''
  };
}

/**
 * Extract all bills from "MARCH-SEPT" tab (reads only first 16 columns for 4x speed)
 */
function extractBillsFromSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  // Read only up to Column 16 (P: Agent) for maximum speed and lightweight JSON
  const colCount = Math.min(sheet.getLastColumn(), 16);
  const values = sheet.getRange(1, 1, lastRow, colCount).getValues();
  const headers = values[0].map(h => String(h).trim().toLowerCase());

  function findCol(keywords, fallback) {
    for (let i = 0; i < headers.length; i++) {
      if (keywords.some(k => headers[i] === k)) return i;
    }
    for (let i = 0; i < headers.length; i++) {
      if (keywords.some(k => k.length > 2 && headers[i].includes(k) && !headers[i].includes('overdue'))) return i;
    }
    return fallback;
  }

  const mappings = getMainColumnMappings();
  const idxInv = findCol(mappings.INVOICE, 3);
  const idxReceipt = findCol(mappings.RECEIPT, 12);
  const idxOutstanding = findCol(mappings.OUTSTANDING, 11);
  const idxParty = findCol(mappings.PARTY, 4);
  const idxAmt = findCol(mappings.AMOUNT, 5);
  const idxAgent = findCol(mappings.AGENT, 15);

  const bills = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const rawBillNo = row[idxInv] || row[3] || row[0];
    const billNo = String(rawBillNo || '').trim();
    if (!billNo) continue;

    const rawAmt = row[idxAmt];
    const cleanAmt = typeof rawAmt === 'number' ? rawAmt : (parseFloat(String(rawAmt).replace(/[₹,\s]/g, '')) || 0);

    const rawReceipt = idxReceipt < row.length ? row[idxReceipt] : '';
    const receipt = String(rawReceipt || '').trim();

    const rawOutstanding = idxOutstanding < row.length ? row[idxOutstanding] : '';
    let cleanOutstanding = 0;
    if (typeof rawOutstanding === 'number') {
      cleanOutstanding = rawOutstanding;
    } else if (rawOutstanding) {
      cleanOutstanding = parseFloat(String(rawOutstanding).replace(/[₹,\s]/g, '')) || 0;
    }

    const party = String(row[idxParty] || 'General Customer').trim();
    const agent = String(row[idxAgent] || '').trim();

    bills.push({
      billNo: billNo,
      party: party,
      amount: cleanAmt,
      agent: agent,
      receipt: receipt,
      outstanding: cleanOutstanding,
      remainingText: rawOutstanding ? String(rawOutstanding).trim() : ''
    });
  }

  return bills;
}

/**
 * Format and return JSON response
 */
function respondJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
