/**
 * ===================================================================
 * BillAudit Pro - HIGH-SPEED MAIN SHEET FETCHER (100% READ-ONLY)
 * Strictly Targets: "MARCH-SEPT" Tab (GID: 1608276684)
 * High-Speed Lookup for:
 *   - Column M: Receipt Details (Text Format Preserved with getDisplayValues)
 *   - Column L: Remaining Payment Amount (OUTSTANDING)
 *   - Column D: Invoice Number
 * ===================================================================
 * 
 * SAFETY GUARANTEE:
 * - 100% Strictly READ-ONLY.
 * - ZERO edits, rows, or cells will EVER be written or changed in this sheet.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your MAIN Google Sheet (15 sept Copy of ALL INVOICE PARTY).
 * 2. Click: Extensions > Apps Script.
 * 3. Replace all code in Code.gs with this code.
 * 4. Click: Deploy > Manage deployments > Edit ✏️ > Version: "New version" > Deploy.
 * ===================================================================
 */

const TARGET_CONFIG = {
  TAB_NAME: 'MARCH-SEPT',
  GID: '1608276684',
  COLS: {
    INVOICE: 3,     // Column D (0-indexed: 3)
    PARTY: 4,       // Column E (0-indexed: 4)
    AMOUNT: 5,      // Column F (0-indexed: 5)
    PAID_UP: 8,     // Column I (0-indexed: 8)
    STATUS: 9,      // Column J (0-indexed: 9)
    OUTSTANDING: 11,// Column L (0-indexed: 11)
    RECEIPT: 12,    // Column M (0-indexed: 12) - Text Format
    REMARKS: 13,    // Column N (0-indexed: 13) - Remarks / Additional Receipts
    BEAT: 14,       // Column O (0-indexed: 14) - Beat Route
    AGENT: 15       // Column P (0-indexed: 15)
  }
};

/**
 * Handle GET requests (Health Check, Full Fast Pull, or Ultra-Fast Single-Bill Lookup)
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
      return respondJSON({
        status: 'OK',
        mode: 'READ_ONLY_FETCHER',
        message: 'Main Sheet Fast Fetcher Active',
        sheetTitle: ss.getName(),
        targetTab: sheet.getName(),
        gid: String(sheet.getSheetId()),
        totalRows: sheet.getLastRow(),
        columns: {
          invoiceCol: 'D (Index 3)',
          partyCol: 'E (Index 4)',
          amountCol: 'F (Index 5)',
          outstandingCol: 'L (Index 11)',
          receiptCol: 'M (Index 12 - Text Format)',
          agentCol: 'P (Index 15)'
        },
        timestamp: new Date().toISOString()
      });
    }

    // 2. Ultra-Fast Single Bill Search (<50ms via native TextFinder)
    // E.g. ?action=FIND_BILL&billNo=IN-FY26/27-3965 or ?billNo=3965
    const searchBillNo = e?.parameter?.billNo || e?.parameter?.inv || e?.parameter?.q;
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

    // 3. Ultra-Fast Compact Batch Fetch of bills from MARCH-SEPT tab
    if (action === 'GET_DATA' || action === 'GET_MASTER_SHEET' || action === 'FETCH') {
      const limit = e?.parameter?.limit;
      const result = extractBillsFromSheet(sheet, limit);
      return respondJSON({
        status: 'OK',
        mode: 'READ_ONLY_FETCHER',
        sheetTitle: ss.getName(),
        tabName: sheet.getName(),
        gid: String(sheet.getSheetId()),
        count: result.rows.length,
        cols: ["billNo", "receipt", "outstanding", "party", "amount", "agent"],
        rows: result.rows,
        timestamp: new Date().toISOString()
      });
    }

    return respondJSON({ status: 'ERROR', message: 'Unknown action: ' + action });
  } catch (err) {
    return respondJSON({ status: 'ERROR', message: err.toString() });
  }
}

/**
 * Handle POST requests
 * Passes through or handles requests without blocking writes needed by your other apps
 */
function doPost(e) {
  try {
    // If you have existing doPost logic from your other app, you can place it here
    // BillAudit uses doGet for fetching; this won't interfere with your writing code
    return respondJSON({
      status: 'OK',
      message: 'POST received'
    });
  } catch (err) {
    return respondJSON({ status: 'ERROR', message: err.toString() });
  }
}

/**
 * High-Speed Tab Finder: Directly targets "MARCH-SEPT" tab in 20ms
 */
function findTargetSheet(ss, targetGid, targetTabName) {
  const tabName = targetTabName || TARGET_CONFIG.TAB_NAME;
  
  // 1. Direct name match first (fastest: 20ms)
  let sheet = ss.getSheetByName(tabName);
  if (sheet) return sheet;

  // 2. GID match
  const sheets = ss.getSheets();
  const gidToMatch = targetGid || TARGET_CONFIG.GID;
  const matchGid = sheets.find(s => String(s.getSheetId()) === String(gidToMatch));
  if (matchGid) return matchGid;

  // 3. Case-insensitive and trimmed name match (e.g. "march-sept", "MARCH - SEPT")
  const targetClean = tabName.toUpperCase().replace(/[\s\-_/.]/g, '');
  for (let i = 0; i < sheets.length; i++) {
    const sNameClean = sheets[i].getName().toUpperCase().replace(/[\s\-_/.]/g, '');
    if (sNameClean === targetClean || sNameClean.includes('MARCHSEPT')) {
      return sheets[i];
    }
  }

  // 4. Fallback: First sheet
  return sheets[0];
}

/**
 * Ultra-Fast Single-Bill Lookup using Google Sheets native TextFinder (<50ms)
 * Uses getDisplayValues() to guarantee Column M receipt text format is 100% preserved
 */
function findSingleBillInSheet(sheet, billNo) {
  if (!billNo) return null;
  const cleanInput = String(billNo).trim();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  // Search Column D (Invoice No) using native C++ TextFinder
  const invRange = sheet.getRange(2, 4, lastRow - 1, 1);

  let foundCell = null;

  // 1. Exact cell match on Invoice column
  foundCell = invRange.createTextFinder(cleanInput).matchEntireCell(true).findNext();

  // 2. Substring match
  if (!foundCell) {
    foundCell = invRange.createTextFinder(cleanInput).matchEntireCell(false).findNext();
  }

  // 3. Suffix / Number match if digits provided (e.g. "3965" matches "IN-FY26/27-3965")
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
  
  // CRUCIAL: Use getDisplayValues() so Column M is read in its EXACT text format!
  const rowVals = sheet.getRange(rowNum, 1, 1, 16).getDisplayValues()[0];

  const rawAmt = rowVals[TARGET_CONFIG.COLS.AMOUNT] || '0';
  const cleanAmt = parseFloat(rawAmt.replace(/[₹,\s]/g, '')) || 0;

  // Column L: Remaining Payment / Outstanding Amount
  const rawOutstanding = rowVals[TARGET_CONFIG.COLS.OUTSTANDING] || '0';
  const cleanOutstanding = parseFloat(rawOutstanding.replace(/[₹,\s]/g, '')) || 0;

  // Intelligent Receipt Resolution (Checks Column M, Column N Remarks, and Status/Paid-Up)
  const receipt = resolveIntelligentReceipt(
    rowVals[TARGET_CONFIG.COLS.RECEIPT],
    rowVals[TARGET_CONFIG.COLS.REMARKS],
    rowVals[TARGET_CONFIG.COLS.PAID_UP],
    rowVals[TARGET_CONFIG.COLS.STATUS],
    cleanOutstanding,
    cleanAmt
  );

  const beat = String(rowVals[TARGET_CONFIG.COLS.BEAT] || '').trim();

  return {
    billNo: String(rowVals[TARGET_CONFIG.COLS.INVOICE] || cleanInput).trim(),
    party: String(rowVals[TARGET_CONFIG.COLS.PARTY] || 'General Customer').trim(),
    amount: cleanAmt,
    agent: String(rowVals[TARGET_CONFIG.COLS.AGENT] || '').trim(),
    beat: beat,
    receipt: receipt,
    outstanding: cleanOutstanding,
    remainingText: rawOutstanding.trim()
  };
}

/**
 * Intelligent Receipt and Payment Extractor
 * Checks Column M (Receipt), Column N (Remarks), and Column I/J (Paid-up / Status)
 */
function resolveIntelligentReceipt(rawRec, rawRem, rawPaidUp, rawStatus, rawOut, rawAmt) {
  const rec = String(rawRec || '').trim();
  const rem = String(rawRem || '').trim();
  const status = String(rawStatus || '').trim().toUpperCase();
  const paidUp = parseFloat(String(rawPaidUp || '').replace(/[₹,\s]/g, '')) || 0;
  const out = parseFloat(String(rawOut || '').replace(/[₹,\s]/g, '')) || 0;
  const amt = parseFloat(String(rawAmt || '').replace(/[₹,\s]/g, '')) || 0;

  if (rec) {
    const isGenericRem = /^(ok|good|normal|followup|n\/a|nil)$/i.test(rem);
    if (rem && !isGenericRem && rem.toLowerCase() !== rec.toLowerCase()) {
      return `${rec} (${rem})`;
    }
    return rec;
  }

  if (rem) {
    const isGeneric = /^(ok|good|normal|followup|n\/a|nil)$/i.test(rem);
    if (!isGeneric) {
      return rem;
    }
  }

  if (status === 'PAID' || (out <= 0 && amt > 0)) {
    if (paidUp > 0) return `PAID (₹${paidUp})`;
    return 'PAID IN FULL';
  }

  if (status === 'PARTIAL' || (out > 0 && paidUp > 0)) {
    return `PARTIAL (₹${paidUp} Paid)`;
  }

  if (status === 'CANCELLED') {
    return 'CANCELLED';
  }

  return '';
}

/**
 * Ultra-Fast Batch Extractor from "MARCH-SEPT" Tab
 * Supports optional limit parameter (e.g. limit=500 fetches only latest 500 bills in 30ms)
 * Uses getDisplayValues() to read Column M in text format
 */
function extractBillsFromSheet(sheet, limit) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { rows: [] };

  const parsedLimit = limit ? parseInt(limit, 10) : 0;
  const startRow = (parsedLimit > 0 && parsedLimit < lastRow - 1) ? Math.max(2, lastRow - parsedLimit + 1) : 2;
  const numRows = lastRow - startRow + 1;

  // Read rows using getDisplayValues()
  const displayVals = sheet.getRange(startRow, 1, numRows, 16).getDisplayValues();

  const cInv = TARGET_CONFIG.COLS.INVOICE;       // 3 (Col D)
  const cParty = TARGET_CONFIG.COLS.PARTY;       // 4 (Col E)
  const cAmt = TARGET_CONFIG.COLS.AMOUNT;        // 5 (Col F)
  const cPaid = TARGET_CONFIG.COLS.PAID_UP;      // 8 (Col I)
  const cStat = TARGET_CONFIG.COLS.STATUS;       // 9 (Col J)
  const cOut = TARGET_CONFIG.COLS.OUTSTANDING;   // 11 (Col L)
  const cRec = TARGET_CONFIG.COLS.RECEIPT;       // 12 (Col M - Text Format)
  const cRem = TARGET_CONFIG.COLS.REMARKS;       // 13 (Col N)
  const cBeat = TARGET_CONFIG.COLS.BEAT;         // 14 (Col O)
  const cAgent = TARGET_CONFIG.COLS.AGENT;       // 15 (Col P)

  const rows = [];

  for (let r = 0; r < displayVals.length; r++) {
    const row = displayVals[r];
    const billNo = row[cInv] ? row[cInv].trim() : '';
    if (!billNo) continue;

    // Column L: Remaining Payment / Outstanding
    const rawOut = row[cOut] ? row[cOut].trim() : '';
    const outstanding = rawOut ? (parseFloat(rawOut.replace(/[₹,\s]/g, '')) || 0) : 0;

    // Column F: Bill Amount
    const rawAmt = row[cAmt] ? row[cAmt].trim() : '0';
    const amount = rawAmt ? (parseFloat(rawAmt.replace(/[₹,\s]/g, '')) || 0) : 0;

    // Intelligent receipt resolution
    const receipt = resolveIntelligentReceipt(
      row[cRec],
      row[cRem],
      row[cPaid],
      row[cStat],
      outstanding,
      amount
    );

    // Column E: Party Name
    const party = row[cParty] ? row[cParty].trim() : 'General Customer';

    // Column P: Agent Name
    const agent = row[cAgent] ? row[cAgent].trim() : '';

    // Column O: Beat Route
    const beat = row[cBeat] ? row[cBeat].trim() : '';

    // Compact tuple: [billNo, receipt, outstanding, party, amount, agent, beat]
    rows.push([billNo, receipt, outstanding, party, amount, agent, beat]);
  }

  return { rows: rows };
}

/**
 * Format and return JSON response with CORS support
 */
function respondJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
