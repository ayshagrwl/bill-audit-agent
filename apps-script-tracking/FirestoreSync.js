/**
 * Firestore <-> tracking sheet bridge for BillAudit Pro (run from the Apps Script editor).
 *
 * The app stores scans in Firestore (collections scanOut, scanIn, custody). This file:
 *   importAllToFirestore()      one-time copy of the sheet history into Firestore
 *   dailyExportFromFirestore()  copies Firestore back into the sheet tabs (a readable copy)
 *   installDailyExportTrigger() runs dailyExportFromFirestore every night around 11 pm
 *
 * Calls the Firestore REST API as the script owner (needs the datastore scope in
 * appsscript.json and access to the Firebase project), so no extra keys are stored.
 *
 * Self-contained: works pasted on its own into a script attached to the tracking sheet, or next
 * to the tracking web-app code (helpers are prefixed fs* to avoid name clashes).
 */

const FS_TRACKING_SHEET_ID = '1Lu1C-aX9KCRhCrcrZNal81tt4-wD_6wqHWqsI5orTrY';
const FS_TABS = { SCAN_OUT: 'Scan_Out_Log', SCAN_IN: 'Scan_In_Log', CUSTODY: 'Live_Custody' };

const FIRESTORE_PROJECT_ID = 'billaudit-pro-bfd2d3';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/' + FIRESTORE_PROJECT_ID + '/databases/(default)/documents';

// Field names in the same order as the sheet columns
const OUT_FIELDS = ['ts', 'billNo', 'agent', 'party', 'amount', 'dispatchDate', 'dueOut', 'receipt', 'status', 'notes', 'beat', 'week'];
const IN_FIELDS = ['ts', 'billNo', 'agent', 'party', 'amount', 'collected', 'dueIn', 'mode', 'receipt', 'status', 'reason', 'remarks', 'beat', 'week'];
const CUSTODY_COLUMNS = ['billNo', 'party', 'amount', 'agent', 'dispatchDate', 'status', 'collectedAmt', 'outstanding',
  'paymentMode', 'refNo', 'returnReason', 'remarks', 'lastActionDate', 'beat', 'week'];
const NUMERIC_FIELDS = { amount: true, dueOut: true, collected: true, dueIn: true, collectedAmt: true, outstanding: true };

/** One-time: copies Scan_Out_Log, Scan_In_Log (plus BACKUP_* copies) and Live_Custody into Firestore. */
function importAllToFirestore() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FIRESTORE_IMPORT_DONE')) {
    throw new Error('Import already ran on ' + props.getProperty('FIRESTORE_IMPORT_DONE') +
      '. Delete the FIRESTORE_IMPORT_DONE script property to run it again.');
  }
  const ss = fsSpreadsheet();
  const outRows = fsReadLogRows(ss, FS_TABS.SCAN_OUT, OUT_FIELDS.length, 400);
  const inRows = fsReadLogRows(ss, FS_TABS.SCAN_IN, IN_FIELDS.length, 400);

  const writes = [];
  outRows.forEach(r => writes.push(firestoreWrite('scanOut', 'imp_' + rowKey(r), rowToFields(r, OUT_FIELDS))));
  inRows.forEach(r => writes.push(firestoreWrite('scanIn', 'imp_' + rowKey(r), rowToFields(r, IN_FIELDS))));

  const custodySheet = ss.getSheetByName(FS_TABS.CUSTODY);
  let custodyCount = 0;
  if (custodySheet && custodySheet.getLastRow() > 1) {
    const values = custodySheet.getRange(2, 1, custodySheet.getLastRow() - 1, CUSTODY_COLUMNS.length).getValues();
    const seen = {};
    values.forEach(r => {
      const id = fsNormalize(r[0]);
      if (!id || seen[id]) return; // first row wins, same as the app's dedupe of cloud bills
      seen[id] = true;
      const fields = rowToFields(r, CUSTODY_COLUMNS);
      fields.updatedAt = { timestampValue: new Date().toISOString() };
      writes.push(firestoreWrite('custody', id, fields));
      custodyCount++;
    });
  }

  commitFirestoreWrites(writes);
  props.setProperty('FIRESTORE_IMPORT_DONE', new Date().toISOString());
  Logger.log('Imported %s Scan OUT rows, %s Scan IN rows, %s custody bills', outRows.length, inRows.length, custodyCount);
}

/**
 * Copies Firestore into the sheet: appends new Scan OUT / Scan IN rows since the last run and
 * rewrites Live_Custody. The sheet is a read-only copy; the app never reads it.
 */
function dailyExportFromFirestore() {
  const ss = fsSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  // First export starts after the import, so imported history is not appended twice
  const since = props.getProperty('FIRESTORE_EXPORTED_TS') || props.getProperty('FIRESTORE_IMPORT_DONE') || new Date().toISOString();

  const outDocs = queryFirestoreSince('scanOut', since);
  const inDocs = queryFirestoreSince('scanIn', since);
  appendDocs(ss.getSheetByName(FS_TABS.SCAN_OUT), outDocs, OUT_FIELDS);
  appendDocs(ss.getSheetByName(FS_TABS.SCAN_IN), inDocs, IN_FIELDS);

  const custody = listFirestoreCollection('custody');
  const custodySheet = ss.getSheetByName(FS_TABS.CUSTODY);
  if (custodySheet && custody.length > 0) {
    const rows = custody.map(d => CUSTODY_COLUMNS.map(c => fsCell(d[c] === undefined ? '' : d[c])));
    if (custodySheet.getLastRow() > 1) {
      custodySheet.getRange(2, 1, custodySheet.getLastRow() - 1, Math.max(CUSTODY_COLUMNS.length, custodySheet.getLastColumn())).clearContent();
    }
    custodySheet.getRange(2, 1, rows.length, CUSTODY_COLUMNS.length).setValues(rows);
  }

  const maxTs = [...outDocs, ...inDocs].reduce((m, d) => (String(d.ts) > m ? String(d.ts) : m), since);
  props.setProperty('FIRESTORE_EXPORTED_TS', maxTs);
  Logger.log('Exported %s Scan OUT, %s Scan IN rows and %s custody bills', outDocs.length, inDocs.length, custody.length);
}

/** Creates the nightly trigger for dailyExportFromFirestore (removes any older copy first). */
function installDailyExportTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyExportFromFirestore')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyExportFromFirestore').timeBased().everyDays(1).atHour(23).create();
}

// ---------- helpers ----------

function rowKey(r) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(r[0]) + '|' + String(r[1]))
  ).replace(/=+$/, '');
}

function rowToFields(row, names) {
  const fields = {};
  names.forEach((name, i) => {
    let v = row[i];
    if (v instanceof Date) v = name === 'dispatchDate'
      ? Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd')
      : v.toISOString();
    if (NUMERIC_FIELDS[name]) {
      const n = parseFloat(String(v === undefined || v === null ? '' : v).replace(/[₹,\s]/g, ''));
      fields[name] = { doubleValue: isNaN(n) ? 0 : n };
    } else {
      fields[name] = { stringValue: v === undefined || v === null ? '' : String(v) };
    }
  });
  return fields;
}

function firestoreWrite(collection, id, fields) {
  return { update: { name: 'projects/' + FIRESTORE_PROJECT_ID + '/databases/(default)/documents/' + collection + '/' + id, fields: fields } };
}

function commitFirestoreWrites(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    firestoreFetch(':batchWrite', 'post', { writes: writes.slice(i, i + 400) });
  }
}

function firestoreFetch(path, method, payload) {
  const resp = UrlFetchApp.fetch(FIRESTORE_BASE + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('Firestore ' + path + ' failed (' + resp.getResponseCode() + '): ' + resp.getContentText().slice(0, 500));
  }
  return JSON.parse(resp.getContentText() || '{}');
}

function fromFirestoreFields(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(k => {
    const v = fields[k];
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('doubleValue' in v) out[k] = Number(v.doubleValue);
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('timestampValue' in v) out[k] = v.timestampValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else out[k] = '';
  });
  return out;
}

function queryFirestoreSince(collection, sinceTs) {
  const res = firestoreFetch(':runQuery', 'post', {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: 'ts' }, op: 'GREATER_THAN', value: { stringValue: sinceTs } } },
      orderBy: [{ field: { fieldPath: 'ts' }, direction: 'ASCENDING' }]
    }
  });
  return (res || []).filter(r => r.document).map(r => fromFirestoreFields(r.document.fields));
}

function listFirestoreCollection(collection) {
  const docs = [];
  let pageToken = '';
  do {
    const res = firestoreFetch('/' + collection + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), 'get');
    (res.documents || []).forEach(d => docs.push(fromFirestoreFields(d.fields)));
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function appendDocs(sheet, docs, fields) {
  if (!sheet || docs.length === 0) return;
  const rows = docs.map(d => fields.map(f => fsCell(d[f] === undefined ? '' : d[f])));
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, fields.length).setValues(rows);
}

/** Always the tracking spreadsheet, whichever sheet this script is attached to. */
function fsSpreadsheet() {
  return SpreadsheetApp.openById(FS_TRACKING_SHEET_ID);
}

/** Rows of a log tab plus its BACKUP_* copies from the last `days` days, de-duplicated. */
function fsReadLogRows(ss, tabName, numCols, days) {
  const cutoff = Date.now() - days * 86400000;
  const seen = {};
  const rows = [];
  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (name !== tabName && name.indexOf('BACKUP_' + tabName) !== 0) return;
    if (sheet.getLastRow() < 2) return;
    const width = Math.min(numCols, sheet.getLastColumn());
    sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(r => {
      const row = r.map(v => (v instanceof Date ? v.toISOString() : v));
      const t = Date.parse(String(row[0] || ''));
      if (!row[1] || (!isNaN(t) && t < cutoff)) return;
      const key = row[0] + '|' + row[1];
      if (seen[key]) return;
      seen[key] = true;
      rows.push(row);
    });
  });
  return rows;
}

/** Same as the app's normalizeInvoiceNumber: the custody document id. */
function fsNormalize(val) {
  return String(val || '').trim().toUpperCase().replace(/[\s\-_/.]/g, '');
}

/** Sheet cell value; text that starts like a formula is kept as text. */
function fsCell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  const s = String(val).trim();
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
