/**
 * BillAudit Pro - Sales Bill Daily In & Out Tracker
 * High-Speed Camera Scanning, Instant Manual Invoice Entry,
 * Master Sheet Auto-Mapping (Agent & Receipt Column),
 * and Live Remaining Left-Out Bill Reconciliation.
 */

(function () {
  'use strict';

  // ========================================================
  // 1. STATE & STORAGE
  // ========================================================

  const STORAGE_KEYS = {
    BILLS: 'billAudit_bills',
    AGENTS: 'billAudit_agents',
    SETTINGS: 'billAudit_settings',
    OFFLINE_QUEUE: 'billAudit_offlineQueue',
    AUDIT_LOGS: 'billAudit_auditLogs',
    MASTER_SHEET: 'billAudit_masterSheet',
    SHEET_MAPPINGS: 'billAudit_sheetMappings'
  };

  const DEFAULT_AGENTS = [
    { id: 'AG-001', name: 'Rajesh', fullName: 'Rajesh Chaurasiya', phone: '' },
    { id: 'AG-002', name: 'Shivam', fullName: 'Shivam Dwivedi', phone: '' },
    { id: 'AG-003', name: 'Self', fullName: 'Self / Counter', phone: '' }
  ];

  const DEFAULT_SETTINGS = {
    scriptUrl: 'https://script.google.com/macros/s/AKfycbxIDIzSZzSkZwB4nuMrOkVFHNNY56ad_KVZqt8n3zZ2bEA8FR13hhxQ1xz4kZP_O4NBNA/exec',
    mainSheetScriptUrl: 'https://script.google.com/macros/s/AKfycbxIDIzSZzSkZwB4nuMrOkVFHNNY56ad_KVZqt8n3zZ2bEA8FR13hhxQ1xz4kZP_O4NBNA/exec',
    trackingSheetScriptUrl: 'https://script.google.com/macros/s/AKfycbxZ9jDxeFTNXH5hdvN_PsuWH76iOJkZ4JZFKEgIAVFzjonrpJyRt783HZLucXdhlZcr/exec',
    sheetCsvUrl: 'https://docs.google.com/spreadsheets/d/11J3WSXNFfu5aARNMBX3HQazajsfzBjj7wX9MWyVVBRk/export?format=csv&gid=1608276684',
    theme: 'light',
    audioSound: true,
    preferredCamera: 'environment'
  };

  const DEFAULT_MAPPINGS = {
    invoice: 'Invoice Number,inv bill no,D,Invoice,Bill,BillNo,InvNo',
    agent: 'Agent,Salesman,DeliveryAgent,AgentName,Name,Sales Agent',
    beat: 'Beat,Beats,Route,Area,Week,Weeks,Beat Week,col o,o',
    party: 'Customer,Party,Shop,Store,PartyName,Customer Name',
    amount: 'Amount,Total,Net,BillAmount,Net Total',
    receipt: 'RECEIPT,REMARKS,receipt col,receipt no,Receipt,Payment,Paid',
    outstanding: 'OUTSTANDING,outstanding,payment remaining,remaining,balance,pending,due'
  };

  /**
   * Master Recurring Beat Plan by Agent & Day of Week (Monday to Saturday)
   * Matches Official Agent Daily Beat Schedule:
   * - Shivam Dwivedi: Mukhtiyarganj Market-2, Rajendra Nagar / Jawahar Nagar, Pateri Virat Nagar, Kothi Road Khama Khuja, Prem Nagar Dhawari, Pateri VITS Road
   * - Rajesh Chaurasiya: Mukhtiyarganj Market-1, Civil Line Panna Naka, Bharhut Nagar Bank Colony, Kothi Road Bagha, Dhawari Mahadeva, Pul Gadi – Raigaon
   */
  const MASTER_BEAT_PLAN = {
    Rajesh: {
      Mon: { beat: 'Mukhtiyarganj Market-1', area: 'Mukhtiyarganj Market-1' },
      Tue: { beat: 'Civil Line Panna Naka', area: 'Civil Line Panna Naka' },
      Wed: { beat: 'Bharhut Nagar Bank Colony', area: 'Bharhut Nagar Bank Colony' },
      Thu: { beat: 'Kothi Road Bagha', area: 'Kothi Road Bagha' },
      Fri: { beat: 'Dhawari Mahadeva', area: 'Dhawari Mahadeva' },
      Sat: { beat: 'Pul Gadi – Raigaon', area: 'Pul Gadi – Raigaon' }
    },
    Shivam: {
      Mon: { beat: 'Mukhtiyarganj Market-2', area: 'Mukhtiyarganj Market-2' },
      Tue: { beat: 'Rajendra Nagar / Jawahar Nagar', area: 'Rajendra Nagar / Jawahar Nagar' },
      Wed: { beat: 'Pateri Virat Nagar', area: 'Pateri Virat Nagar' },
      Thu: { beat: 'Kothi Road Khama Khuja', area: 'Kothi Road Khama Khuja' },
      Fri: { beat: 'Prem Nagar Dhawari', area: 'Prem Nagar Dhawari' },
      Sat: { beat: 'Pateri VITS Road', area: 'Pateri VITS Road' }
    },
    Self: {
      Mon: { beat: 'In-Store Counter / Self', area: 'Direct Party Pickup / Walk-in' },
      Tue: { beat: 'In-Store Counter / Self', area: 'Direct Party Pickup / Walk-in' },
      Wed: { beat: 'In-Store Counter / Self', area: 'Direct Party Pickup / Walk-in' },
      Thu: { beat: 'In-Store Counter / Self', area: 'Direct Party Pickup / Walk-in' },
      Fri: { beat: 'In-Store Counter / Self', area: 'Direct Party Pickup / Walk-in' },
      Sat: { beat: 'In-Store Counter / Self', area: 'Direct Party Pickup / Walk-in' }
    }
  };
  MASTER_BEAT_PLAN['Rajesh Chaurasiya'] = MASTER_BEAT_PLAN.Rajesh;
  MASTER_BEAT_PLAN['Shivam Dwivedi'] = MASTER_BEAT_PLAN.Shivam;

  const State = {
    bills: [],
    agents: [],
    masterSheetBills: [],
    masterSheetMap: new Map(),
    sheetMappings: { ...DEFAULT_MAPPINGS },
    settings: { ...DEFAULT_SETTINGS },
    offlineQueue: [],
    auditLogs: [],
    dispatchBasket: [],
    activeSettlementAgent: null,
    settlementBills: [],
    diffDateFilter: 'TODAY', // 'TODAY', 'YESTERDAY', or 'ALL'
    activeTab: 'tab-home',
    lastScannedCode: null,
    lastScanTimestamp: 0,
    currentPaymentBill: null,
    currentReturnBill: null,
    settlementScanMode: 'PAY', // 'PAY' or 'RETURN'
    isConfirmModalOpen: false,
    pendingScannedBill: null,
    pendingScanSource: null, // 'DISPATCH' or 'SETTLEMENT'
    activeAgent: null,       // { id, name } — set by agent picker before scanning
    activeBeat: null,        // e.g. "MUKHTIYARGANJ MARKET (Mon, Week 1)"
    selectedDay: 'Mon',
    selectedWeek: 'Week 1',
    selectedBeatName: '',
    activeScanMode: null,    // 'DISPATCH' or 'SETTLEMENT' — set by home card tap

  };

  // Web Audio Synthesizer for Fast Scan Feedback
  const SoundFX = {
    ctx: null,
    init() {
      if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
    },
    playBeep(type = 'success') {
      if (!State.settings.audioSound) return;
      try {
        this.init();
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        const now = this.ctx.currentTime;
        if (type === 'success') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(950, now);
          osc.frequency.setValueAtTime(1400, now + 0.06);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
          osc.start(now);
          osc.stop(now + 0.18);
        } else if (type === 'warning') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.setValueAtTime(330, now + 0.08);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
          osc.start(now);
          osc.stop(now + 0.22);
        } else {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.setValueAtTime(150, now + 0.1);
          gain.gain.setValueAtTime(0.18, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
          osc.start(now);
          osc.stop(now + 0.25);
        }
      } catch (e) {
        console.warn('Audio error:', e);
      }
    },
    vibrate(ms = 70) {
      if (navigator.vibrate) navigator.vibrate(ms);
    }
  };

  function isSameAgent(agentA, agentB) {
    if (!agentA || !agentB) return false;
    if (agentA === agentB) return true;
    const a = String(agentA).toLowerCase().trim();
    const b = String(agentB).toLowerCase().trim();
    if (a === b) return true;
    if (a.includes('shivam') && b.includes('shivam')) return true;
    if (a.includes('rajesh') && b.includes('rajesh')) return true;
    if (a.includes('self') && b.includes('self')) return true;
    return false;
  }

  function loadLocalState() {
    try {
      const storedBills = localStorage.getItem(STORAGE_KEYS.BILLS);
      State.bills = storedBills ? JSON.parse(storedBills) : [];

      // Strictly enforce the 3 designated agents only: Rajesh Chaurasiya, Shivam Dwivedi, Self
      State.agents = [...DEFAULT_AGENTS];
      localStorage.setItem(STORAGE_KEYS.AGENTS, JSON.stringify(State.agents));

      // Sanitize legacy bills so only canonical agents exist in custody
      const validAgentNames = new Set([
        'rajesh', 'shivam', 'self',
        'rajesh chaurasiya', 'shivam dwivedi',
        'rajesh chaurasiya(om marketing)'
      ]);
      State.bills.forEach(b => {
        if (!b.agent || !validAgentNames.has(b.agent.toLowerCase().trim())) {
          b.agent = 'Rajesh';
        }
      });

      const storedMaster = localStorage.getItem(STORAGE_KEYS.MASTER_SHEET);
      if (storedMaster) {
        try {
          const parsedM = JSON.parse(storedMaster);
          if (Array.isArray(parsedM) && parsedM.length > 0) {
            if (Array.isArray(parsedM[0])) {
              // Compact format: [billNo, receipt, outstanding, party, amount, agent, beat]
              State.masterSheetBills = parsedM.map(r => ({
                billNo: String(r[0] || '').trim(),
                receipt: String(r[1] || '').trim(),
                outstanding: Number(r[2]) || 0,
                party: String(r[3] || 'Customer').trim(),
                amount: Number(r[4]) || 0,
                agent: String(r[5] || '').trim(),
                beat: String(r[6] || '').trim(),
                remainingText: String(r[2] || '')
              }));
            } else {
              State.masterSheetBills = parsedM;
            }
          } else {
            State.masterSheetBills = [];
          }
        } catch (e) {
          State.masterSheetBills = [];
        }
      } else {
        State.masterSheetBills = [];
      }
      rebuildMasterSheetMap();

      const storedMappings = localStorage.getItem(STORAGE_KEYS.SHEET_MAPPINGS);
      if (storedMappings) {
        State.sheetMappings = { ...DEFAULT_MAPPINGS, ...JSON.parse(storedMappings) };
      }

      const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (storedSettings) {
        State.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) };
      }
      // If user had an older/stale URL stored in localStorage, update to current default
      if (!State.settings.mainSheetScriptUrl || State.settings.mainSheetScriptUrl.includes('AKfycbwm') || State.settings.mainSheetScriptUrl.includes('AKfycbwBdKP')) {
        State.settings.mainSheetScriptUrl = DEFAULT_SETTINGS.mainSheetScriptUrl;
        State.settings.scriptUrl = DEFAULT_SETTINGS.scriptUrl;
      }
      if (!State.settings.trackingSheetScriptUrl) {
        State.settings.trackingSheetScriptUrl = DEFAULT_SETTINGS.trackingSheetScriptUrl;
      }
      if (!State.settings.scriptUrl) {
        State.settings.scriptUrl = DEFAULT_SETTINGS.scriptUrl;
      }
      if (State.settings.preferredCamera === 'user') {
        State.selectedCameraId = 'user';
      } else {
        // Always default to back camera (cleanses any old corrupted device ID)
        State.selectedCameraId = 'environment';
      }

      const storedQueue = localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
      State.offlineQueue = storedQueue ? JSON.parse(storedQueue) : [];

      const storedLogs = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
      State.auditLogs = storedLogs ? JSON.parse(storedLogs) : [];
    } catch (e) {
      console.error('Local state load failed:', e);
    }
  }

  function saveState(key) {
    try {
      if (!key || key === 'bills') localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(State.bills));
      if (!key || key === 'agents') localStorage.setItem(STORAGE_KEYS.AGENTS, JSON.stringify(State.agents));
      if (!key || key === 'master') {
        // Super-fast compact serialization (saves in 2ms instead of freezing UI)
        try {
          const compact = State.masterSheetBills.map(b => [
            b.billNo,
            b.receipt || '',
            b.outstanding !== undefined ? b.outstanding : 0,
            b.party || '',
            b.amount || 0,
            b.agent || '',
            b.beat || ''
          ]);
          localStorage.setItem(STORAGE_KEYS.MASTER_SHEET, JSON.stringify(compact));
        } catch (quotaErr) {
          console.warn('LocalStorage quota reached, caching latest 5,000 bills:', quotaErr);
          try {
            const compactRecent = State.masterSheetBills.slice(-5000).map(b => [
              b.billNo,
              b.receipt || '',
              b.outstanding !== undefined ? b.outstanding : 0,
              b.party || '',
              b.amount || 0,
              b.agent || '',
              b.beat || ''
            ]);
            localStorage.setItem(STORAGE_KEYS.MASTER_SHEET, JSON.stringify(compactRecent));
          } catch (e2) {}
        }
      }
      if (!key || key === 'mappings') localStorage.setItem(STORAGE_KEYS.SHEET_MAPPINGS, JSON.stringify(State.sheetMappings));
      if (!key || key === 'settings') localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(State.settings));
      if (!key || key === 'queue') localStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(State.offlineQueue));
      if (!key || key === 'logs') localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(State.auditLogs));
    } catch (e) {
      console.error('Local state save failed:', e);
    }
  }

  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'danger') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-6px)';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  function formatINR(val) {
    const num = Number(val) || 0;
    return '₹' + num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function getTodayDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getYesterdayDateString() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }


  // ========================================================
  // 2. MASTER SHEET INTEGRATION & AUTO-LOOKUP ENGINE
  // ========================================================

  /**
   * Normalize an invoice or bill string for comparison
   * Strips spaces, leading zeroes, dashes for flexible matching
   */
  function normalizeInvoiceNumber(val) {
    if (!val) return '';
    return String(val)
      .trim()
      .toUpperCase()
      .replace(/[\s\-_/.]/g, '');
  }

  function stripInvoicePrefix(val) {
    if (!val) return '';
    return String(val)
      .trim()
      .toUpperCase()
      .replace(/^(INVOICE|INV|VCH|VOUCHER|BILL|NO)[-_\s/.]*/i, '')
      .replace(/^IN[-_\s/.]*/i, '');
  }

  /**
   * Helper to register all lookup variations of a bill in the Hash Map
   */
  function registerBillInMap(map, b) {
    if (!b || !b.billNo) return;
    const exact = b.billNo.trim().toUpperCase();
    const norm = normalizeInvoiceNumber(b.billNo);
    const digits = b.billNo.replace(/\D/g, '');

    map.set(exact, b);
    if (norm) map.set(norm, b);

    // Register without invoice prefixes (e.g. "14015503-0001", "17063-1408", "FY26/27-3921")
    const stripped = stripInvoicePrefix(b.billNo);
    if (stripped && stripped !== exact) {
      map.set(stripped, b);
      const normStrip = normalizeInvoiceNumber(stripped);
      if (normStrip) map.set(normStrip, b);
    }

    if (digits.length >= 3) map.set(digits, b);

    // Index trailing numeric suffix (e.g. "3965" from "IN-FY26/27-3965" or "0001" from "IN-14015503-0001")
    const matchTrailing = b.billNo.match(/(\d+)\s*$/);
    if (matchTrailing && matchTrailing[1]) {
      const trail = matchTrailing[1];
      if (trail.length >= 2) {
        map.set(trail, b);
        const trailNoZeros = trail.replace(/^0+/, '');
        if (trailNoZeros && trailNoZeros !== trail) {
          map.set(trailNoZeros, b);
        }
      }
    }
  }

  /**
   * Rebuild the O(1) Master Sheet Hash Map for instant 0.001ms bill lookup
   */
  function rebuildMasterSheetMap() {
    State.masterSheetMap.clear();
    for (let i = 0; i < State.masterSheetBills.length; i++) {
      registerBillInMap(State.masterSheetMap, State.masterSheetBills[i]);
    }
  }

  /**
   * Add or update a single bill into the O(1) Master Sheet Hash Map and state array
   */
  function addBillToMasterIndex(b) {
    if (!b || !b.billNo) return;
    registerBillInMap(State.masterSheetMap, b);

    const norm = normalizeInvoiceNumber(b.billNo);
    const idx = State.masterSheetBills.findIndex(x => normalizeInvoiceNumber(x.billNo) === norm);
    if (idx >= 0) {
      State.masterSheetBills[idx] = b;
    } else {
      State.masterSheetBills.unshift(b);
    }
  }

  /**
   * Search Master Sheet for an Invoice Number (O(1) Instant Hash Map Lookup)
   * Matches exact, normalized, prefix-stripped, or numeric suffix (e.g. 3921 inside IN-FY26/27-3921)
   */
  function findMasterBill(invoiceInput) {
    if (!invoiceInput) return null;
    const cleanInput = String(invoiceInput).trim();
    if (!cleanInput) return null;

    // Ensure map is populated if bills array has items
    if (State.masterSheetMap.size === 0 && State.masterSheetBills.length > 0) {
      rebuildMasterSheetMap();
    }

    // 1. O(1) exact uppercase match (0.001ms)
    let match = State.masterSheetMap.get(cleanInput.toUpperCase());
    if (match) return match;

    // 2. O(1) normalized alphanumeric match
    const normInput = normalizeInvoiceNumber(cleanInput);
    match = State.masterSheetMap.get(normInput);
    if (match) return match;

    // 3. O(1) stripped prefix match (e.g. user/barcode scans "VCH-3965" or "14015503-0001")
    const strippedInput = stripInvoicePrefix(cleanInput);
    if (strippedInput && strippedInput !== cleanInput.toUpperCase()) {
      match = State.masterSheetMap.get(strippedInput) || State.masterSheetMap.get(normalizeInvoiceNumber(strippedInput));
      if (match) return match;
    }

    // 4. O(1) numeric digits match (e.g. "3965" matches "IN-FY26/27-3965")
    const digitsOnly = cleanInput.replace(/\D/g, '');
    if (digitsOnly.length >= 2) {
      match = State.masterSheetMap.get(digitsOnly);
      if (match) return match;
      const noZeros = digitsOnly.replace(/^0+/, '');
      if (noZeros && noZeros !== digitsOnly) {
        match = State.masterSheetMap.get(noZeros);
        if (match) return match;
      }
    }

    // 5. Suffix match fallback on digit string
    if (digitsOnly.length >= 3) {
      for (let i = 0; i < State.masterSheetBills.length; i++) {
        const b = State.masterSheetBills[i];
        const bDigits = b.billNo.replace(/\D/g, '');
        if (bDigits.endsWith(digitsOnly)) return b;
      }
    }

    // 5. Substring contains match (fallback only)
    for (let i = 0; i < State.masterSheetBills.length; i++) {
      const b = State.masterSheetBills[i];
      if (b.billNo.toUpperCase().includes(cleanInput.toUpperCase()) || cleanInput.toUpperCase().includes(b.billNo.toUpperCase())) {
        return b;
      }
    }

    return null;
  }

  /**
   * Parse CSV or Tab-Separated Table Text into Master Sheet Bills
   */
  function parseMasterSheetTable(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return [];

    // Detect delimiter: Tab vs Comma vs Semicolon
    const firstLine = lines[0];
    let delimiter = '\t';
    if (firstLine.includes('\t')) delimiter = '\t';
    else if (firstLine.includes(',')) delimiter = ',';
    else if (firstLine.includes(';')) delimiter = ';';

    function splitRow(row) {
      if (delimiter === '\t') return row.split('\t').map(s => s.trim().replace(/^["']|["']$/g, ''));
      // Simple CSV splitter
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

    // Match column indexes using State.sheetMappings (supports column letters like D, col D, or header names)
    function findColIndex(mappingListString) {
      const keys = mappingListString.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      // 1. Check exact header match
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (keys.some(k => h === k)) return i;
      }
      // 2. Check substring header match
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (keys.some(k => (k.length > 2 && h.includes(k)) || (h.length > 2 && k.includes(h)))) return i;
      }
      // 3. Check column letter match (e.g. 'd' -> 3)
      for (const k of keys) {
        if (/^[a-z]$/.test(k)) {
          const colIdx = k.charCodeAt(0) - 97;
          if (colIdx < headers.length) return colIdx;
        }
        if (/^col\s*([a-z])$/.test(k)) {
          const match = k.match(/^col\s*([a-z])$/);
          const colIdx = match[1].charCodeAt(0) - 97;
          if (colIdx < headers.length) return colIdx;
        }
      }
      return -1;
    }

    const idxInvoice = findColIndex(State.sheetMappings.invoice);
    const idxAgent = findColIndex(State.sheetMappings.agent);
    const idxBeat = findColIndex(State.sheetMappings.beat || 'Beat,Beats,Route,Area,Week,Weeks,Beat Week,col o,o');
    const idxParty = findColIndex(State.sheetMappings.party);
    const idxAmount = findColIndex(State.sheetMappings.amount);
    const idxReceipt = findColIndex(State.sheetMappings.receipt);
    const idxOutstanding = findColIndex(State.sheetMappings.outstanding || 'OUTSTANDING,outstanding,payment remaining,remaining,balance,pending,due');
    const idxRemarks = findColIndex('remarks,note,notes,col n,n');
    const idxPaidUp = findColIndex('paid-up,paid up,paidup,paid amt,amount paid,col i,i');
    const idxStatus = findColIndex('status,col j,j');

    const parsedBills = [];
    const detectedAgents = new Set();

    for (let i = 1; i < lines.length; i++) {
      const cols = splitRow(lines[i]);
      if (!cols || cols.length === 0) continue;

      // Fallbacks if columns not identified by header names
      const billNo = (idxInvoice !== -1 ? cols[idxInvoice] : cols[3]) || cols[0] || '';
      if (!billNo) continue;

      const agent = (idxAgent !== -1 ? cols[idxAgent] : (cols[15] || '')) || '';
      const beat = (idxBeat !== -1 ? cols[idxBeat] : (cols[14] || '')) || '';
      const party = (idxParty !== -1 ? cols[idxParty] : (cols[4] || '')) || 'General Party';
      const rawAmt = (idxAmount !== -1 ? cols[idxAmount] : (cols[5] || '0')) || '0';
      const cleanAmt = parseFloat(String(rawAmt).replace(/[₹,\s]/g, '')) || 0;

      const rawOutstanding = (idxOutstanding !== -1 ? cols[idxOutstanding] : (cols[11] || '')) || '';
      const cleanOutstanding = rawOutstanding ? (parseFloat(String(rawOutstanding).replace(/[₹,\s]/g, '')) || 0) : 0;

      const rawReceiptCol = (idxReceipt !== -1 ? cols[idxReceipt] : (cols[12] || '')) || '';
      const rawRemarksCol = (idxRemarks !== -1 ? cols[idxRemarks] : (cols[13] || '')) || '';
      const rawPaidUpCol = (idxPaidUp !== -1 ? cols[idxPaidUp] : (cols[8] || '')) || '';
      const rawStatusCol = (idxStatus !== -1 ? cols[idxStatus] : (cols[9] || '')) || '';
      const receipt = resolveIntelligentReceipt(rawReceiptCol, rawRemarksCol, rawPaidUpCol, rawStatusCol, cleanOutstanding, cleanAmt);

      if (agent) detectedAgents.add(agent.trim());

      parsedBills.push({
        billNo: String(billNo).trim(),
        agent: String(agent).trim(),
        beat: String(beat).trim(),
        party: String(party).trim(),
        amount: cleanAmt,
        receipt: String(receipt).trim(),
        outstanding: cleanOutstanding,
        remainingText: rawOutstanding ? String(rawOutstanding).trim() : ''
      });
    }

    return parsedBills;
  }

  function updateMasterSheetUI(syncState = null) {
    const banner = document.getElementById('masterSheetBanner');
    const bannerCount = document.getElementById('bannerSheetCount');
    const pill = document.getElementById('masterSheetStatusBtn');
    const pillText = document.getElementById('sheetStatusText');
    const pillBadge = document.getElementById('sheetCountBadge');
    const summaryText = document.getElementById('sheetSummaryText');
    const clearBtn = document.getElementById('clearMasterSheetBtn');

    const count = State.masterSheetBills.length;

    if (syncState === 'syncing') {
      if (pillText) pillText.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Syncing...';
      return;
    }

    if (count > 0) {
      if (banner) {
        banner.style.display = 'flex';
        if (bannerCount) bannerCount.textContent = count.toLocaleString();
      }
      if (pillText) pillText.textContent = `Sheet: ${count.toLocaleString()} Bills`;
      if (pillBadge) {
        pillBadge.style.display = 'inline-block';
        pillBadge.textContent = count > 999 ? `${(count / 1000).toFixed(1)}k` : count;
      }
      if (summaryText) {
        const uniqueAgents = [...new Set(State.masterSheetBills.map(b => b.agent).filter(Boolean))];
        summaryText.innerHTML = `<strong>Active Master Sheet (MARCH-SEPT):</strong> ${count.toLocaleString()} bills loaded across ${uniqueAgents.length} agents (${uniqueAgents.slice(0, 4).join(', ')}${uniqueAgents.length > 4 ? '...' : ''}). Auto-syncs directly on page refresh.`;
      }
      if (clearBtn) clearBtn.style.display = 'inline-block';
    } else {
      if (banner) banner.style.display = 'none';
      if (pillText) pillText.textContent = 'Sheet: Auto-Syncing...';
      if (pillBadge) pillBadge.style.display = 'none';
      if (summaryText) summaryText.textContent = 'Connecting to MARCH-SEPT sheet tab in background...';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }


  // ========================================================
  // 3. ROBUST QR CODE & BARCODE PARSER
  // ========================================================

  function buildParsedBill(billNo, party, amount, mm, raw, isEInvoice = false) {
    const finalBillNo = String(billNo || '').trim();
    return {
      billNo: finalBillNo,
      party: mm ? mm.party : (party || 'Standard Account'),
      amount: mm ? mm.amount : (amount || 0),
      agent: mm ? mm.agent : '',
      beat: mm ? (mm.beat || '') : '',
      receipt: mm ? (mm.receipt || '') : '',
      outstanding: mm && mm.outstanding !== undefined ? mm.outstanding : 0,
      remainingText: mm ? (mm.remainingText || '') : '',
      fromMaster: !!mm,
      raw: raw || finalBillNo,
      isEInvoice
    };
  }

  function parseQRCodeData(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const text = rawText.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '').trim();
    if (!text) return null;

    // 1. Check if the scanned string directly matches a bill in Master Sheet
    const masterMatch = findMasterBill(text);
    if (masterMatch) {
      return buildParsedBill(masterMatch.billNo, masterMatch.party, masterMatch.amount, masterMatch, text);
    }

    // 2. Indian GST e-Invoice Signed QR Code (JWT format: header.payload.signature)
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) {
      try {
        const parts = text.split('.');
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        let jsonStr = '';
        if (typeof atob === 'function') {
          jsonStr = decodeURIComponent(escape(atob(base64)));
        } else if (typeof Buffer !== 'undefined') {
          jsonStr = Buffer.from(base64, 'base64').toString('utf8');
        }
        if (jsonStr) {
          const payload = JSON.parse(jsonStr);
          const billNo = payload.DocNo || payload.docNo || payload.billNo || payload.Irn || text;
          const party = payload.BuyerGstin || payload.buyerGstin || payload.party || 'Standard Account';
          const amount = parseFloat(payload.TotInvVal || payload.totInvVal || payload.amount) || 0;
          const mm = findMasterBill(billNo);
          return buildParsedBill(billNo, party, amount, mm, text, true);
        }
      } catch (e) {}
    }

    // 3. Direct JSON payload (e.g. {"DocNo":"3921","TotInvVal":5465})
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      try {
        const obj = JSON.parse(text);
        if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
          const billNo = obj.DocNo || obj.docNo || obj.billNo || obj.bill_no || obj.invoice || obj.invoiceNo || obj.invoice_no || obj.invNo || obj.bill || obj.id || '';
          const party = obj.party || obj.partyName || obj.party_name || obj.buyer || obj.customer || obj.BuyerGstin || 'Standard Account';
          const amtStr = String(obj.TotInvVal || obj.amount || obj.amt || obj.total || obj.grandTotal || obj.netAmount || 0);
          const amount = parseFloat(amtStr.replace(/,/g, '')) || 0;
          if (billNo) {
            const mm = findMasterBill(billNo);
            return buildParsedBill(billNo, party, amount, mm, text);
          }
        }
      } catch (e) {}
    }

    // 4. UPI Payment QR (e.g. upi://pay?pa=...&am=5465&tr=3921)
    if (text.startsWith('upi://pay')) {
      try {
        const url = new URL(text);
        const billNo = url.searchParams.get('tr') || url.searchParams.get('tn') || url.searchParams.get('refId') || text;
        const party = url.searchParams.get('pn') || 'Standard Account';
        const amount = parseFloat(url.searchParams.get('am')) || 0;
        const mm = findMasterBill(billNo);
        return buildParsedBill(billNo, party, amount, mm, text);
      } catch (e) {}
    }

    // 5. Multi-line Key: Value Text (e.g. "Invoice: 3921\nAmount: 5465")
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
        const mm = findMasterBill(billNo);
        return buildParsedBill(billNo, party || 'Standard Account', amount, mm, text);
      }
    }

    // 6. Structured multi-value formats: CSV, Pipe, Semicolon
    function parseCSVLine(line) {
      const values = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) {
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
        const mm = findMasterBill(billNo);
        return buildParsedBill(billNo, party, amount, mm, text);
      }
    }

    const csvParts = parseCSVLine(text);

    if (csvParts.length === 3) {
      const billNo = csvParts[0];
      const party = csvParts[1];
      const amountStr = csvParts[2];
      const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
      const mm = findMasterBill(billNo);
      return buildParsedBill(billNo, party, amount, mm, text);
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
      const mm = findMasterBill(billNo);
      return buildParsedBill(billNo, party, amount, mm, text);
    } else if (csvParts.length === 2) {
      const billNo = csvParts[0];
      const amount = parseFloat(csvParts[1].replace(/,/g, '')) || 0;
      const mm = findMasterBill(billNo);
      return buildParsedBill(billNo, 'Standard Account', amount, mm, text);
    }

    // 7. Single token (e.g. only invoice number scanned or typed)
    const mm = findMasterBill(text);
    return buildParsedBill(text, 'Standard Account', 0, mm, text);
  }

  /**
   * Enriches parsed bill with full Master Sheet columns (Receipt, Outstanding / Remaining, Agent, Party)
   */
  function enrichWithMaster(parsed) {
    if (!parsed || !parsed.billNo) return parsed;
    const mm = findMasterBill(parsed.billNo) || (parsed.raw ? findMasterBill(parsed.raw) : null);
    if (mm) {
      if (!parsed.party || parsed.party === 'Standard Account' || parsed.party === 'General Party') {
        parsed.party = mm.party;
      }
      if (!parsed.amount || parsed.amount === 0) {
        parsed.amount = mm.amount;
      }
      if (!parsed.agent) parsed.agent = mm.agent;
      if (!parsed.beat && mm.beat) parsed.beat = mm.beat;
      if (mm.receipt) parsed.receipt = mm.receipt;
      parsed.outstanding = mm.outstanding !== undefined ? mm.outstanding : 0;
      parsed.remainingText = mm.remainingText || '';
      parsed.fromMaster = true;
    }
    return parsed;
  }


  // ========================================================
  // 4. DESKTOP ANIMATIONS, 2D HARDWARE SCANNER & CONFETTI FX
  // ========================================================

  const ConfettiFX = {
    canvas: null,
    ctx: null,
    particles: [],
    animationId: null,

    init() {
      this.canvas = document.getElementById('confettiCanvas');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      window.addEventListener('resize', () => this.resize());
    },

    resize() {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },

    burst({ count = 35, x = 0.35, y = 0.45 } = {}) {
      this.init();
      if (!this.ctx) return;

      const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
      const originX = x * window.innerWidth;
      const originY = y * window.innerHeight;

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 6;
        this.particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          size: 4 + Math.random() * 5,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * 360,
          rotationSpeed: (Math.random() - 0.5) * 12,
          life: 1,
          decay: 0.015 + Math.random() * 0.02
        });
      }

      if (!this.animationId) {
        this.loop();
      }
    },

    celebrate() {
      this.burst({ count: 70, x: 0.3, y: 0.35 });
      setTimeout(() => this.burst({ count: 70, x: 0.7, y: 0.35 }), 150);
      setTimeout(() => this.burst({ count: 80, x: 0.5, y: 0.4 }), 300);
    },

    loop() {
      if (!this.ctx) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.16;
        p.vx *= 0.98;
        p.rotation += p.rotationSpeed;
        p.life -= p.decay;

        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }

        this.ctx.save();
        this.ctx.translate(p.x, p.y);
        this.ctx.rotate((p.rotation * Math.PI) / 180);
        this.ctx.fillStyle = p.color;
        this.ctx.globalAlpha = Math.max(0, p.life);
        this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.5);
        this.ctx.restore();
      }

      if (this.particles.length > 0) {
        this.animationId = requestAnimationFrame(() => this.loop());
      } else {
        this.animationId = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }
  };

  const ScanFX = {
    success(mode, code, parsed) {
      SoundFX.init();
      SoundFX.playBeep('success');
      SoundFX.vibrate(50);

      const cardId = mode === 'DISPATCH' ? 'dispatchScannerCard' : 'settlementScannerCard';
      const card = document.getElementById(cardId);
      if (card) {
        card.classList.add('scan-success-flash');
        setTimeout(() => card.classList.remove('scan-success-flash'), 500);
      }

      if (mode === 'DISPATCH') {
        const badge = document.getElementById('dispatchLastScanBadge');
        const details = document.getElementById('dispatchLastScanDetails');
        if (badge && parsed) badge.textContent = parsed.billNo;
        if (details && parsed) {
          details.textContent = `${parsed.party || 'Customer'} · ${formatINR(parsed.amount)}`;
        }
      }

      ConfettiFX.burst({ count: 28, x: 0.28, y: 0.35 });
    },

    error(mode, message) {
      SoundFX.init();
      SoundFX.playBeep('error');
      SoundFX.vibrate(100);

      const cardId = mode === 'DISPATCH' ? 'dispatchScannerCard' : 'settlementScannerCard';
      const card = document.getElementById(cardId);
      if (card) {
        card.classList.add('scan-error-shake');
        setTimeout(() => card.classList.remove('scan-error-shake'), 400);
      }

      showToast(message, 'warning', 3000);
    }
  };

  function animateNumber(element, targetVal, isCurrency = false) {
    if (!element) return;
    const target = Number(targetVal) || 0;
    const currentText = (element.textContent || '').replace(/[^0-9.-]+/g, '');
    const start = parseFloat(currentText) || 0;
    if (start === target) {
      element.textContent = isCurrency ? formatINR(target) : target;
      return;
    }

    const duration = 360;
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (target - start) * ease);

      element.textContent = isCurrency ? formatINR(current) : current;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        element.textContent = isCurrency ? formatINR(target) : target;
      }
    }

    requestAnimationFrame(step);
  }

  function renderHomeCharts(outCount, inCount, diffCount, outAmt, inAmt, diffAmt) {
    const total = outCount || 0;
    const receivedPct = total > 0 ? (inCount / total) : 0;
    const pendingPct = total > 0 ? (diffCount / total) : 0;

    const circumference = 389.56;
    const receivedLength = receivedPct * circumference;
    const pendingLength = pendingPct * circumference;

    const segReceived = document.getElementById('donutSegReceived');
    const segPending = document.getElementById('donutSegPending');
    const centerTotal = document.getElementById('donutCenterTotal');

    if (centerTotal) centerTotal.textContent = total;

    if (segReceived) {
      segReceived.style.strokeDasharray = `${receivedLength} ${circumference}`;
      segReceived.style.strokeDashoffset = '0';
    }

    if (segPending) {
      segPending.style.strokeDasharray = `${pendingLength} ${circumference}`;
      segPending.style.strokeDashoffset = `${-receivedLength}`;
    }

    const legRec = document.getElementById('chartLegendReceived');
    const legPend = document.getElementById('chartLegendPending');
    const legTot = document.getElementById('chartLegendTotal');

    if (legRec) legRec.textContent = `${inCount} (${Math.round(receivedPct * 100)}%)`;
    if (legPend) legPend.textContent = `${diffCount} (${Math.round(pendingPct * 100)}%)`;
    if (legTot) legTot.textContent = `${total} (${formatINR(outAmt)})`;

    const container = document.getElementById('agentBarsContainer');
    if (container) {
      container.innerHTML = '';
      State.agents.forEach(agent => {
        const stats = getAgentLeftOutStats(agent.name);
        const agTotal = stats.totalCount || 0;
        const agRec = stats.checkedInCount || 0;
        const agPct = agTotal > 0 ? Math.round((agRec / agTotal) * 100) : 0;

        const row = document.createElement('div');
        row.className = 'agent-bar-row';
        row.innerHTML = `
          <div class="agent-bar-info">
            <span><i class="fa-solid fa-user-tie"></i> ${agent.name}</span>
            <span class="font-mono">${agRec}/${agTotal} (${agPct}%)</span>
          </div>
          <div class="agent-bar-track">
            <div class="agent-bar-fill" style="width: ${agPct}%;"></div>
          </div>
        `;
        container.appendChild(row);
      });
    }
  }

  function focusActiveScannerInput() {
    setTimeout(() => {
      if (State.activeTab === 'tab-dispatch') {
        const input = document.getElementById('dispatchInvoiceInput');
        if (input && document.activeElement !== input) input.focus();
      } else if (State.activeTab === 'tab-settlement') {
        const input = document.getElementById('settlementInvoiceInput');
        if (input && document.activeElement !== input) input.focus();
      }
    }, 80);
  }

  function initSystemClock() {
    function tick() {
      const clock = document.getElementById('systemClock');
      if (clock) {
        const now = new Date();
        clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    }
    tick();
    setInterval(tick, 1000);
  }

  function flashHardwareScannerIndicator(text) {
    const pills = [document.getElementById('dispatchHwPill'), document.getElementById('settlementHwPill')];
    pills.forEach(p => {
      if (p) {
        p.classList.add('active-flash');
        const origHtml = p.innerHTML;
        const displayTxt = text.length > 12 ? text.slice(0, 10) + '…' : text;
        p.innerHTML = `<i class="fa-solid fa-check"></i> Scanned: ${displayTxt}`;
        setTimeout(() => {
          p.classList.remove('active-flash');
          p.innerHTML = origHtml;
        }, 1200);
      }
    });
  }

  /**
   * Hardware USB & Bluetooth Barcode / QR Scanner Wedge Listener
   * Desktop-first high-speed keyboard emulation listener
   */
  const HardwareScanner = {
    buffer: '',
    lastKeyTime: 0,
    scannerThresholdMs: 95,
    isScanningBurst: false,
    _timeout: null,
    _burstTimer: null,

    init() {
      window.addEventListener('keydown', (e) => {
        const now = Date.now();
        const diff = now - this.lastKeyTime;
        this.lastKeyTime = now;

        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) {
          return;
        }

        if (e.key === 'Enter' || e.key === 'Tab') {
          clearTimeout(this._burstTimer);
          if (this.buffer.length >= 2 && this.isScanningBurst) {
            e.preventDefault();
            e.stopPropagation();

            const scannedCode = this.buffer.trim();
            this.buffer = '';
            this.isScanningBurst = false;

            // Clear any active invoice input to avoid leftover text
            const dInp = document.getElementById('dispatchInvoiceInput');
            const sInp = document.getElementById('settlementInvoiceInput');
            if (dInp) dInp.value = '';
            if (sInp) sInp.value = '';

            this.processScannedCode(scannedCode);
            return;
          }

          this.buffer = '';
          this.isScanningBurst = false;
          return;
        }

        if (e.key.length === 1) {
          if (diff <= this.scannerThresholdMs) {
            this.isScanningBurst = true;
            this.buffer += e.key;
          } else {
            this.buffer = e.key;
            this.isScanningBurst = false;
          }

          clearTimeout(this._timeout);
          this._timeout = setTimeout(() => {
            this.buffer = '';
            this.isScanningBurst = false;
          }, 250);

          // Trailing timer: auto-fire if scanner does not append Enter/Tab suffix
          clearTimeout(this._burstTimer);
          if (this.isScanningBurst && this.buffer.length >= 3) {
            this._burstTimer = setTimeout(() => {
              if (this.buffer.length >= 3 && this.isScanningBurst) {
                const scannedCode = this.buffer.trim();
                this.buffer = '';
                this.isScanningBurst = false;

                const dInp = document.getElementById('dispatchInvoiceInput');
                const sInp = document.getElementById('settlementInvoiceInput');
                if (dInp) dInp.value = '';
                if (sInp) sInp.value = '';

                this.processScannedCode(scannedCode);
              }
            }, 110);
          }
        }
      }, true);
    },

    processScannedCode(rawText) {
      if (!rawText) return;
      const clean = String(rawText).replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '').trim();
      if (!clean) return;

      const now = Date.now();
      if (clean === State.lastScannedCode && (now - State.lastScanTimestamp) < 800) {
        return;
      }
      State.lastScannedCode = clean;
      State.lastScanTimestamp = now;

      flashHardwareScannerIndicator(clean);

      // Close modal if open so scanning is never blocked
      if (State.isConfirmModalOpen) {
        closeBillConfirmModal();
      }

      this.routeScannedCode(clean);
    },

    async routeScannedCode(rawText) {
      const activeTab = State.activeTab;

      if (activeTab === 'tab-dispatch') {
        handleScannedCodeDispatch(rawText);
      } else if (activeTab === 'tab-settlement') {
        handleScannedCodeSettlement(rawText);
      } else {
        if (!State.activeAgent) {
          State.pendingHardwareScan = rawText;
          showToast(`⚡ Scanned: "${rawText}". Select agent:`, 'info', 3000);
          openAgentPicker('DISPATCH');
        } else {
          await switchTab('tab-dispatch');
          handleScannedCodeDispatch(rawText);
        }
      }
    }
  };

  // ========================================================
  // 5. TAB 1: SCAN OUT (MORNING DISPATCH)
  // ========================================================

  function handleScannedCodeDispatch(decodedText) {
    if (!decodedText) return;
    try {
      let parsed = parseQRCodeData(decodedText);
      if (!parsed || !parsed.billNo) {
        const cleanText = String(decodedText).replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '').trim();
        if (cleanText) {
          parsed = { billNo: cleanText, party: 'Standard Account', amount: 0, raw: cleanText };
        }
      }

      if (!parsed || !parsed.billNo) {
        ScanFX.error('DISPATCH', 'Unrecognized code: ' + (decodedText.slice(0, 30)));
        return;
      }

      parsed = enrichWithMaster(parsed);
      ScanFX.success('DISPATCH', decodedText, parsed);

      // Directly add to dispatch basket so the list shows the scanned bill immediately!
      addBillToDispatchBasket(parsed);
    } catch (err) {
      console.error('Dispatch scan handler error:', err);
      ScanFX.error('DISPATCH', 'Scan error: ' + (err.message || err));
    }
  }

  function handleManualInvoiceDispatch() {
    const input = document.getElementById('dispatchInvoiceInput');
    const val = input.value.trim();
    if (!val) return;

    let parsed = parseQRCodeData(val);
    if (!parsed || !parsed.billNo) {
      parsed = { billNo: val, party: 'Standard Account', amount: 0, raw: val };
    }
    parsed = enrichWithMaster(parsed);

    if (!parsed || !parsed.billNo) {
      ScanFX.error('DISPATCH', 'Please enter a valid invoice number');
      return;
    }

    input.value = '';
    ScanFX.success('DISPATCH', val, parsed);
    addBillToDispatchBasket(parsed);
    focusActiveScannerInput();
  }

  function addBillToDispatchBasket(parsed) {
    // Agent is strictly locked in from the Morning Dispatch selection (State.activeAgent)
    let assignedAgent = State.activeAgent ? State.activeAgent.name : '';
    const assignedBeat = State.activeBeat || parsed.beat || '';
    const assignedBeatName = State.selectedBeatName || parsed.beat || '';
    const assignedDay = State.selectedDay || '';
    const assignedWeek = State.selectedWeek || '';

    // If still not set, check if parsed.agent matches one of our 3 designated agents
    if (!assignedAgent && parsed.agent) {
      const matchAgent = State.agents.find(a => a.name.toLowerCase() === String(parsed.agent).trim().toLowerCase());
      if (matchAgent) {
        assignedAgent = matchAgent.name;
      }
    }

    // Default to active or first designated agent
    if (!assignedAgent && State.agents.length > 0) {
      assignedAgent = State.agents[0].name;
    }

    // Check duplicate in current basket — update if already present
    const existingBasketIdx = State.dispatchBasket.findIndex(b => b.billNo === parsed.billNo);
    if (existingBasketIdx >= 0) {
      State.dispatchBasket[existingBasketIdx].agent = assignedAgent;
      if (assignedBeat) State.dispatchBasket[existingBasketIdx].beat = assignedBeat;
      State.dispatchBasket[existingBasketIdx].beatName = assignedBeatName;
      State.dispatchBasket[existingBasketIdx].day = assignedDay;
      State.dispatchBasket[existingBasketIdx].week = assignedWeek;
      if (parsed.party && parsed.party !== 'Standard Account') State.dispatchBasket[existingBasketIdx].party = parsed.party;
      if (parsed.amount) State.dispatchBasket[existingBasketIdx].amount = parsed.amount;
      if (parsed.receipt) State.dispatchBasket[existingBasketIdx].receipt = parsed.receipt;
      if (parsed.outstanding !== undefined) State.dispatchBasket[existingBasketIdx].outstanding = parsed.outstanding;
      SoundFX.playBeep('success');
      showToast(`Updated ${parsed.billNo} in dispatch list`, 'info', 1500);
      renderDispatchBasket();
      return;
    }

    // Check active custody — allow re-dispatching with alert
    const active = State.bills.find(b => b.billNo === parsed.billNo && b.status === 'WITH_AGENT');
    if (active) {
      SoundFX.playBeep('warning');
      showToast(`Re-assigning ${parsed.billNo} (previously with ${active.agent})`, 'warning', 2000);
    }

    State.dispatchBasket.unshift({
      billNo: parsed.billNo,
      party: parsed.party || 'Standard Account',
      amount: parsed.amount || 0,
      agent: assignedAgent,
      beat: assignedBeat,
      beatName: assignedBeatName,
      day: assignedDay,
      week: assignedWeek,
      receipt: parsed.receipt || '',
      outstanding: parsed.outstanding !== undefined ? parsed.outstanding : (parsed.amount || 0),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      raw: parsed.raw
    });

    SoundFX.playBeep('success');
    SoundFX.vibrate(50);
    showToast(`Added ${parsed.billNo} (${assignedAgent})`, 'success', 1500);

    renderDispatchBasket();
  }

  function renderDispatchBasket() {
    const list = document.getElementById('dispatchBasketList');
    const countBadge = document.getElementById('dispatchBasketCount');
    const totalLabel = document.getElementById('dispatchBasketTotal');
    const confirmBtn = document.getElementById('confirmDispatchBtn');
    const waBtn = document.getElementById('whatsappHandoverBtn');
    const printBtn = document.getElementById('printHandoverSlipBtn');

    if (!list) return;

    if (State.dispatchBasket.length === 0) {
      list.innerHTML = `
        <div class="empty-placeholder">
          <i class="fa-solid fa-qrcode"></i>
          <p>No bills added to handover basket yet.<br><small>Click "Start Camera" above or type Invoice Number.</small></p>
        </div>
      `;
      countBadge.textContent = '0';
      totalLabel.textContent = formatINR(0);
      confirmBtn.disabled = true;
      if (waBtn) waBtn.disabled = true;
      if (printBtn) printBtn.disabled = true;
      return;
    }

    let total = 0;
    list.innerHTML = '';

    State.dispatchBasket.forEach((item, index) => {
      total += Number(item.amount) || 0;
      const row = document.createElement('div');
      row.className = 'bill-card-row';
      row.innerHTML = `
        <div class="bill-info-main">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="b-num font-mono">${item.billNo}</span>
            <span class="count-pill" style="font-size: 0.68rem; background: var(--bg-subtle); color: var(--text-main);">
              <i class="fa-solid fa-user"></i> ${item.agent || 'Unassigned'}
            </span>
            ${item.beat ? `<span class="badge-beat"><i class="fa-solid fa-location-dot"></i> ${item.beat}</span>` : ''}
            ${item.receipt ? `<span class="badge-receipt"><i class="fa-solid fa-receipt"></i> ${item.receipt}</span>` : ''}
            ${(item.outstanding !== undefined && item.outstanding > 0) ? `<span class="badge-pending" style="font-size: 0.68rem; background: #fef2f2; color: #dc2626; padding: 1px 6px; border-radius: 4px; font-weight: 600;"><i class="fa-solid fa-coins"></i> Due: ${formatINR(item.outstanding)}</span>` : ''}
          </div>
          <span class="b-party">${item.party}</span>
        </div>
        <div class="bill-info-meta">
          <span class="b-amount font-mono text-success">${formatINR(item.amount)}</span>
          <button class="del-btn" data-del-index="${index}" title="Remove">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `;
      list.appendChild(row);
    });

    countBadge.textContent = State.dispatchBasket.length;
    totalLabel.textContent = formatINR(total);
    confirmBtn.disabled = false;
    if (waBtn) waBtn.disabled = false;
    if (printBtn) printBtn.disabled = false;

    list.querySelectorAll('[data-del-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.delIndex, 10);
        State.dispatchBasket.splice(idx, 1);
        renderDispatchBasket();
      });
    });
  }

  function confirmDispatchHandover() {
    if (State.dispatchBasket.length === 0) return;

    const dateInput = document.getElementById('dispatchDate');
    const date = (dateInput && dateInput.value) ? dateInput.value : getTodayDateString();
    const timestamp = new Date().toISOString();
    const newBills = [];

    State.dispatchBasket.forEach(b => {
      let record = State.bills.find(item => item.billNo === b.billNo);
      if (!record) {
        record = {
          billNo: b.billNo,
          party: b.party,
          amount: b.amount,
          agent: b.agent || (State.activeAgent ? State.activeAgent.name : 'Sales Agent'),
          beat: b.beat || State.activeBeat || '',
          beatName: b.beatName || State.selectedBeatName || '',
          day: b.day || State.selectedDay || '',
          week: b.week || State.selectedWeek || '',
          dispatchDate: date,
          status: 'WITH_AGENT',
          collectedAmt: 0,
          outstanding: b.outstanding !== undefined ? b.outstanding : b.amount,
          paymentMode: '',
          refNo: b.receipt || '',
          receipt: b.receipt || '',
          returnReason: '',
          remarks: 'Dispatched for route',
          lastActionDate: timestamp,
          history: []
        };
        State.bills.unshift(record);
      } else {
        record.agent = b.agent || record.agent;
        if (b.beat || State.activeBeat) record.beat = b.beat || State.activeBeat;
        record.beatName = b.beatName || State.selectedBeatName || record.beatName || '';
        record.day = b.day || State.selectedDay || record.day || '';
        record.week = b.week || State.selectedWeek || record.week || '';
        record.dispatchDate = date;
        record.status = 'WITH_AGENT';
        record.collectedAmt = 0;
        record.outstanding = b.outstanding !== undefined ? b.outstanding : record.outstanding;
        record.paymentMode = '';
        record.refNo = b.receipt || record.refNo;
        record.receipt = b.receipt || record.receipt || '';
        record.returnReason = '';
        record.lastActionDate = timestamp;
      }

      record.history.push({
        action: 'DISPATCHED',
        agent: record.agent,
        beat: record.beat || '',
        beatName: record.beatName || '',
        day: record.day || '',
        week: record.week || '',
        date,
        timestamp
      });
      newBills.push({ ...record });
    });

    // Cloud Sync Queue for Tracking Sheet
    queueSyncAction('BATCH_DISPATCH', { dispatchDate: date, timestamp, bills: newBills });

    saveState();
    updateGlobalStats();
    renderLeftOutTab();

    const count = State.dispatchBasket.length;
    State.dispatchBasket = [];
    renderDispatchBasket();

    SoundFX.playBeep('success');
    ConfettiFX.celebrate();
    showToast(`Confirmed ${count} bills handed OUT!`, 'success', 3000);
  }


  // ========================================================
  // 6. TAB 2: SCAN IN (RETURN & SETTLEMENT / NEXT DAY)
  // ========================================================

  function loadSettlementForSelectedAgent() {
    // Agent comes from State.activeAgent (set by picker), fall back to select element
    const agentSelect = document.getElementById('settlementAgentSelect');
    const agent = (State.activeAgent ? State.activeAgent.name : '') || (agentSelect ? agentSelect.value : '');
    State.activeSettlementAgent = agent;

    const list = document.getElementById('settlementListContainer');
    const countBadge = document.getElementById('agentBillsCount');
    const alertBanner = document.getElementById('missingBillAlertBanner');

    if (!agent) {
      if (list) {
        list.innerHTML = `
          <div class="empty-placeholder">
            <i class="fa-solid fa-user-check"></i>
            <p>Select an agent above to view bills and start Check-IN.</p>
          </div>
        `;
      }
      if (countBadge) countBadge.textContent = '0';
      updateSettlementSummary([]);
      if (alertBanner) alertBanner.style.display = 'none';
      return;
    }

    const bills = State.bills.filter(b => b.agent === agent);
    State.settlementBills = bills;

    renderSettlementList(bills);
    updateSettlementSummary(bills);
  }

  function updateSettlementSummary(bills) {
    let totalAmt = 0, receivedAmt = 0, diffAmt = 0;
    let receivedCount = 0, diffCount = 0;

    bills.forEach(b => {
      const amt = Number(b.amount) || 0;
      totalAmt += amt;

      if (b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND') {
        receivedCount++;
        receivedAmt += amt;
      } else {
        diffCount++;
        diffAmt += amt;
      }
    });

    const totalCountEl = document.getElementById('audTotalCount');
    const totalAmtEl = document.getElementById('audTotalAmt');
    const paidCountEl = document.getElementById('audPaidCount');
    const paidAmtEl = document.getElementById('audPaidAmt');
    const missingCountEl = document.getElementById('audMissingCount');
    const missingAmtEl = document.getElementById('audMissingAmt');

    if (totalCountEl) totalCountEl.textContent = `${bills.length} bills`;
    if (totalAmtEl) totalAmtEl.textContent = formatINR(totalAmt);
    if (paidCountEl) paidCountEl.textContent = `${receivedCount} bills`;
    if (paidAmtEl) paidAmtEl.textContent = formatINR(receivedAmt);
    if (missingCountEl) missingCountEl.textContent = `${diffCount} bills`;
    if (missingAmtEl) missingAmtEl.textContent = formatINR(diffAmt);

    const alertBanner = document.getElementById('missingBillAlertBanner');
    const alertCount = document.getElementById('alertMissingCount');
    const alertAmt = document.getElementById('alertMissingAmt');

    if (diffCount > 0 && bills.length > 0) {
      if (alertBanner) alertBanner.style.display = 'flex';
      if (alertCount) alertCount.textContent = diffCount;
      if (alertAmt) alertAmt.textContent = formatINR(diffAmt);
    } else {
      if (alertBanner) alertBanner.style.display = 'none';
    }
  }

  function renderSettlementList(bills, filter = 'ALL') {
    const list = document.getElementById('settlementListContainer');
    const countBadge = document.getElementById('agentBillsCount');
    if (!list) return;

    let filtered = bills;
    if (filter === 'MISSING') {
      filtered = bills.filter(b => b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT');
    } else if (filter === 'PAID') {
      filtered = bills.filter(b => b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND');
    }

    if (countBadge) countBadge.textContent = filtered.length;

    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="empty-placeholder">
          <i class="fa-solid fa-file-circle-check"></i>
          <p>No bills in this category.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = '';
    filtered.forEach(bill => {
      const isPending = bill.status === 'WITH_AGENT' || bill.status === 'MISSING_ALERT';
      const row = document.createElement('div');
      row.className = `bill-card-row ${isPending ? 'is-missing' : ''}`;

      let statusText = '';
      if (isPending) {
        statusText = '<span class="text-danger font-bold">⚠️ Pending Difference</span>';
      } else {
        statusText = '<span class="text-success font-bold">✓ Received</span>';
      }

      row.innerHTML = `
        <div class="bill-info-main">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="b-num font-mono">${bill.billNo}</span>
            <small>${statusText}</small>
            ${bill.refNo ? `<span class="badge-receipt"><i class="fa-solid fa-receipt"></i> ${bill.refNo}</span>` : ''}
          </div>
          <span class="b-party">${bill.party}</span>
        </div>
        <div class="bill-info-meta">
          <span class="b-amount font-mono">${formatINR(bill.amount)}</span>
          <div class="bill-action-btns">
            ${isPending ? `<button class="mini-action-btn pay" data-quick-receive="${bill.billNo}">✓ Receive</button>` : ''}
          </div>
        </div>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('[data-quick-receive]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bNo = btn.dataset.quickReceive;
        const b = State.bills.find(item => item.billNo === bNo);
        if (b) {
          b.status = 'RECEIVED';
          b.remarks = 'Manually received';
          b.lastActionDate = new Date().toISOString();
          saveState();
          updateGlobalStats();
          loadSettlementForSelectedAgent();
          renderLeftOutTab();
          updateHomeStats();
          SoundFX.playBeep('success');
          showToast(`Received ${b.billNo}`, 'success');
        }
      });
    });
  }

  function handleScannedCodeSettlement(decodedText) {
    if (!decodedText) return;
    try {
      let parsed = parseQRCodeData(decodedText);
      if (!parsed || !parsed.billNo) {
        const cleanText = String(decodedText).replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '').trim();
        if (cleanText) {
          parsed = { billNo: cleanText, party: 'Standard Account', amount: 0, raw: cleanText };
        }
      }

      if (!parsed || !parsed.billNo) {
        ScanFX.error('SETTLEMENT', 'Unrecognized code: ' + (decodedText.slice(0, 30)));
        return;
      }

      parsed = enrichWithMaster(parsed);
      ScanFX.success('SETTLEMENT', decodedText, parsed);

      processCheckInCode(decodedText);
    } catch (err) {
      console.error('Settlement scan handler error:', err);
      ScanFX.error('SETTLEMENT', 'Scan error: ' + (err.message || err));
    }
  }

  function handleManualInvoiceSettlement() {
    const input = document.getElementById('settlementInvoiceInput');
    const val = input.value.trim();
    if (!val) return;

    processCheckInCode(val);
    input.value = '';
    focusActiveScannerInput();
  }

  function receiveBillSettlement(parsed) {
    if (!parsed || !parsed.billNo) return;

    let bill = State.bills.find(b => b.billNo === parsed.billNo) ||
               State.bills.find(b => normalizeInvoiceNumber(b.billNo) === normalizeInvoiceNumber(parsed.billNo));

    const billAmt = parseFloat(parsed.amount) || 0;
    const outstanding = (parsed.outstanding !== undefined && parsed.outstanding !== null)
      ? parseFloat(parsed.outstanding)
      : 0;

    if (!bill) {
      const targetAgent = (State.activeAgent ? State.activeAgent.name : '') || State.activeSettlementAgent || (State.agents[0] ? State.agents[0].name : 'Rajesh');
      bill = {
        billNo: parsed.billNo,
        party: parsed.party || 'Standard Account',
        amount: billAmt,
        agent: targetAgent,
        dispatchDate: getTodayDateString(),
        status: 'WITH_AGENT',
        collectedAmt: 0,
        paymentMode: '',
        refNo: parsed.receipt || '',
        returnReason: '',
        remarks: 'Scanned at Check-IN',
        lastActionDate: new Date().toISOString(),
        history: []
      };
      State.bills.unshift(bill);
    }

    // Direct settlement: Mark as RECEIVED and refresh lists immediately
    bill.status = 'RECEIVED';
    bill.remarks = 'Received back from agent';
    const timestamp = new Date().toISOString();
    bill.lastActionDate = timestamp;
    bill.history.push({ action: 'RECEIVED', agent: bill.agent, timestamp });

    queueSyncAction('SETTLEMENT_RETURN', {
      billNo: bill.billNo,
      agent: bill.agent,
      party: bill.party,
      amount: bill.amount,
      status: 'RECEIVED',
      remarks: bill.remarks,
      timestamp
    });

    saveState();
    updateGlobalStats();
    loadSettlementForSelectedAgent();
    renderLeftOutTab();
    updateHomeStats();
    SoundFX.playBeep('success');
    ConfettiFX.burst({ count: 25, x: 0.35, y: 0.45 });
    showToast(`✓ Received ${bill.billNo} (${bill.agent})`, 'success', 2500);
  }

  function processCheckInCode(rawInput) {
    let parsed = parseQRCodeData(rawInput);
    if (!parsed || !parsed.billNo) {
      const clean = String(rawInput).replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '').trim();
      parsed = { billNo: clean, party: 'Standard Account', amount: 0, raw: rawInput };
    }
    parsed = enrichWithMaster(parsed);

    if (!parsed || !parsed.billNo) {
      SoundFX.playBeep('error');
      showToast('Unrecognized bill number', 'warning');
      return;
    }

    // If bill already exists in State.bills, enrich with custody data
    const existing = State.bills.find(b => b.billNo === parsed.billNo) ||
                     State.bills.find(b => normalizeInvoiceNumber(b.billNo) === normalizeInvoiceNumber(parsed.billNo));
    if (existing) {
      if (!parsed.party || parsed.party === 'Standard Account' || parsed.party === 'General Party') {
        parsed.party = existing.party;
      }
      if (!parsed.amount || parsed.amount === 0) {
        parsed.amount = existing.amount;
      }
      if (!parsed.agent) parsed.agent = existing.agent;
      if (!parsed.receipt && existing.refNo) parsed.receipt = existing.refNo;
      if (parsed.outstanding === undefined) {
        parsed.outstanding = Math.max(0, existing.amount - (existing.collectedAmt || 0));
      }
    }

    receiveBillSettlement(parsed);
  }


  // ========================================================
  // 6. INSTANT BILL DETAILS CONFIRMATION & MOVE AHEAD MODAL
  // ========================================================

  /**
   * Evaluates and updates the fraud alert / payment verification banner in the scan modal
   */
  function updateModalFraudBanner(parsed, source, isFetching = false) {
    const banner = document.getElementById('bdFraudStatus');
    if (!banner || !parsed) return;

    if (isFetching) {
      banner.className = 'bd-fraud-banner bd-fraud-checking';
      banner.style.display = 'flex';
      banner.innerHTML = `
        <div class="bd-fraud-head"><i class="fa-solid fa-spinner fa-spin"></i> Checking Master Sheet...</div>
        <div class="bd-fraud-sub">Verifying Column L & M payment status from Google Sheets</div>
      `;
      return;
    }

    const billNo = parsed.billNo;
    const activeAgent = State.activeAgent ? State.activeAgent.name : (source === 'DISPATCH' ? (document.getElementById('dispatchAgentSelect')?.value) : State.activeSettlementAgent);
    const hasMaster = State.masterSheetBills && State.masterSheetBills.length > 0;
    const isFromMaster = !!parsed.fromMaster;
    const outstanding = (parsed.outstanding !== undefined && parsed.outstanding !== null) ? Number(parsed.outstanding) : 0;
    const receipt = (parsed.receipt !== undefined && parsed.receipt !== null) ? String(parsed.receipt).trim() : '';
    const amount = Number(parsed.amount) || 0;
    const sheetAgent = parsed.agent ? String(parsed.agent).trim() : '';

    // Check 1: Custody / Duplicate status
    let custodyNote = '';
    const activeCustody = State.bills.find(b => b.billNo === billNo && b.status === 'WITH_AGENT');
    const receivedToday = State.bills.find(b => b.billNo === billNo && b.status === 'RECEIVED');

    if (source === 'DISPATCH' && activeCustody) {
      custodyNote = `⚠️ Already out with ${activeCustody.agent}! Re-dispatching will update handover.`;
    } else if (source === 'SETTLEMENT' && receivedToday) {
      custodyNote = `ℹ️ Previously received today. Re-confirming will refresh status.`;
    }

    // Check 2: Not in master sheet
    if (hasMaster && !isFromMaster) {
      banner.className = 'bd-fraud-banner bd-fraud-notfound';
      banner.style.display = 'flex';
      banner.innerHTML = `
        <div class="bd-fraud-head"><i class="fa-solid fa-triangle-exclamation"></i> ❌ NOT IN MASTER SHEET</div>
        <div class="bd-fraud-sub">Bill ${billNo} not found in sales records. Verify physical bill authenticity!${custodyNote ? '<br>' + custodyNote : ''}</div>
      `;
      return;
    }

    // Check 3: Agent mismatch
    const isMismatch = activeAgent && activeAgent !== 'AUTO' && sheetAgent &&
      sheetAgent.toLowerCase() !== activeAgent.toLowerCase() &&
      sheetAgent.toLowerCase() !== 'general agent' &&
      sheetAgent.toLowerCase() !== 'sales agent';

    // Check 4: Payment status from Sheet
    let statusClass = 'bd-fraud-paid';
    let headHtml = '';
    let subHtml = '';

    if (outstanding <= 0 || (receipt && outstanding === 0)) {
      statusClass = 'bd-fraud-paid';
      headHtml = `<i class="fa-solid fa-circle-check"></i> ✅ FULLY PAID (NO DUES)`;
      subHtml = `Receipt: ${receipt || 'Paid in Full'} &bull; Balance Due: ₹0.00`;
    } else if (outstanding > 0 && receipt) {
      statusClass = 'bd-fraud-partial';
      headHtml = `<i class="fa-solid fa-circle-exclamation"></i> ⚠️ PARTIAL PAYMENT (DUE: ${formatINR(outstanding)})`;
      subHtml = `Receipt: ${receipt} &bull; Remaining Due: ${formatINR(outstanding)}`;
    } else if (outstanding > 0) {
      statusClass = 'bd-fraud-pending';
      headHtml = `<i class="fa-solid fa-triangle-exclamation"></i> 🔴 PENDING PAYMENT (DUE: ${formatINR(outstanding)})`;
      subHtml = `Due Amount: ${formatINR(outstanding)} &bull; No receipt recorded in Col M`;
    } else if (amount === 0) {
      statusClass = 'bd-fraud-paid';
      headHtml = `<i class="fa-solid fa-circle-info"></i> ZERO AMOUNT BILL`;
      subHtml = `Amount is ₹0.00`;
    }

    // If agent mismatch, override class to mismatch
    if (isMismatch) {
      statusClass = 'bd-fraud-mismatch';
      headHtml = `<i class="fa-solid fa-user-xmark"></i> ⚠️ AGENT MISMATCH &bull; ` + (outstanding > 0 ? (receipt ? 'PARTIAL DUE' : 'PENDING DUE') : 'PAID');
      subHtml = `Assigned in Sheet to <strong>${sheetAgent}</strong> (Scanning for <strong>${activeAgent}</strong>).<br>${subHtml}`;
    }

    if (custodyNote) {
      subHtml += `<br><strong>${custodyNote}</strong>`;
    }

    banner.className = `bd-fraud-banner ${statusClass}`;
    banner.style.display = 'flex';
    banner.innerHTML = `
      <div class="bd-fraud-head">${headHtml}</div>
      <div class="bd-fraud-sub">${subHtml}</div>
    `;
  }

  function showBillScannedConfirmation(parsed, source = 'DISPATCH') {
    if (!parsed || !parsed.billNo) return;
    State.pendingScannedBill = parsed;
    State.pendingScanSource = source;
    State.isConfirmModalOpen = true;

    const modal = document.getElementById('billDetailConfirmModal');
    const modeBadge = document.getElementById('bdModeBadge');
    const billNoEl = document.getElementById('bdBillNo');
    const partyEl = document.getElementById('bdParty');
    const amountEl = document.getElementById('bdAmount');
    const receiptEl = document.getElementById('bdReceipt');
    const remainingEl = document.getElementById('bdRemaining');
    const remainingBox = document.getElementById('bdRemainingBox');
    const remainingStatus = document.getElementById('bdRemainingStatus');
    const agentEl = document.getElementById('bdAgent');
    const advancedBtn = document.getElementById('bdAdvancedBtn');
    const confirmBtn = document.getElementById('bdConfirmMoveAheadBtn');

    if (!modal) return;

    if (billNoEl) billNoEl.textContent = parsed.billNo;
    if (partyEl) partyEl.textContent = parsed.party || 'Standard Customer';
    if (amountEl) amountEl.textContent = formatINR(parsed.amount || 0);

    // Receipt details from Master Sheet (Column M text format)
    const receiptText = (parsed.receipt !== undefined && parsed.receipt !== null && String(parsed.receipt).trim()) ? String(parsed.receipt).trim() : '';
    if (receiptEl) {
      if (receiptText) {
        receiptEl.innerHTML = `<span class="badge-receipt" style="background:#e0f2fe;color:#0284c7;font-weight:700;padding:2px 8px;border-radius:6px;font-size:0.92rem;"><i class="fa-solid fa-receipt"></i> ${receiptText}</span>`;
      } else {
        receiptEl.textContent = '-';
      }
      receiptEl.title = receiptText || 'No receipt in Col M';
    }

    // Remaining payment (OUTSTANDING from Master Sheet)
    const billAmt = parseFloat(parsed.amount) || 0;
    let outstanding = 0;
    if (parsed.outstanding !== undefined && parsed.outstanding !== null) {
      outstanding = parseFloat(parsed.outstanding);
    } else if (source === 'SETTLEMENT') {
      const existing = State.bills.find(b => b.billNo === parsed.billNo);
      if (existing) {
        outstanding = Math.max(0, existing.amount - (existing.collectedAmt || 0));
      }
    }

    if (remainingEl) remainingEl.textContent = formatINR(outstanding);

    if (remainingBox) {
      if (outstanding <= 0) {
        remainingBox.classList.remove('has-due');
        if (remainingStatus) remainingStatus.textContent = 'Fully Paid / No Due';
      } else {
        remainingBox.classList.add('has-due');
        if (remainingStatus) remainingStatus.textContent = `⚠️ Pending Due (${formatINR(outstanding)})`;
      }
    }

    // Sales Agent taking custody
    let agentName = (State.activeAgent ? State.activeAgent.name : '') || (source === 'DISPATCH' ? (document.getElementById('dispatchAgentSelect')?.value) : State.activeSettlementAgent);
    if (!agentName || agentName === 'AUTO') {
      agentName = parsed.agent || (State.agents[0] ? State.agents[0].name : 'Rajesh');
    }
    if (agentEl) agentEl.textContent = agentName;

    // Badge styling
    if (modeBadge) {
      if (source === 'DISPATCH') {
        modeBadge.className = 'bd-badge badge-dispatch';
        modeBadge.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i> DISPATCH';
      } else {
        modeBadge.className = 'bd-badge badge-settlement';
        modeBadge.innerHTML = '<i class="fa-solid fa-arrow-down-to-bracket"></i> RETURN';
      }
    }

    // Button label
    if (confirmBtn) {
      if (source === 'DISPATCH') {
        confirmBtn.innerHTML = '<span>Add to Dispatch</span> <i class="fa-solid fa-plus"></i>';
      } else {
        confirmBtn.innerHTML = '<span>Confirm Received ✓</span> <i class="fa-solid fa-check"></i>';
      }
    }

    if (advancedBtn) {
      advancedBtn.style.display = 'none';
    }

    // Render Live Instant Fraud & Payment Status
    const needsFetch = !parsed.fromMaster && !!(State.settings.mainSheetScriptUrl || State.settings.scriptUrl);
    updateModalFraudBanner(parsed, source, needsFetch);

    modal.style.display = 'flex';

    // If bill details were not pre-loaded in local cache, fetch directly from MARCH-SEPT tab
    if (needsFetch) {
      fetchSingleBillDetailsFromSheet(parsed.billNo, source);
    }
  }

  /**
   * Fast asynchronous fetch of single bill details from MARCH-SEPT tab
   */
  async function fetchSingleBillDetailsFromSheet(billNo, source) {
    if (!billNo) return;
    const cleanNo = String(billNo).trim();
    const digitsOnly = cleanNo.replace(/\D/g, '');

    const receiptEl = document.getElementById('bdReceipt');
    const remainingEl = document.getElementById('bdRemaining');
    const remainingBox = document.getElementById('bdRemainingBox');
    const remainingStatus = document.getElementById('bdRemainingStatus');
    const partyEl = document.getElementById('bdParty');
    const amountEl = document.getElementById('bdAmount');
    const agentEl = document.getElementById('bdAgent');

    if (receiptEl && (!State.pendingScannedBill?.receipt || receiptEl.textContent === '-')) {
      receiptEl.innerHTML = '<span class="text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Fetching...</span>';
    }

    try {
      let b = null;

      // 1. Ultra-fast direct Google Sheet BigTable Visualization query (<1 second)
      try {
        const { sheetId, gid } = getSheetCredentials();
        const condition = digitsOnly.length >= 3
          ? `where D contains '${cleanNo}' or D contains '${digitsOnly}'`
          : `where D contains '${cleanNo}'`;
        const tq = encodeURIComponent(`select D, E, F, L, M, N, O, P, I, J ${condition} limit 1`);
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&tq=${tq}&gid=${gid}&t=${Date.now()}`;
        const gResp = await fetch(gvizUrl);
        if (gResp.ok) {
          const gTxt = await gResp.text();
          const rows = parseGvizResponse(gTxt);
          if (rows && rows.length > 0) {
            b = rows[0];
          }
        }
      } catch (gErr) {
        console.warn('[BillLookup] Direct GViz single lookup failed:', gErr);
      }

      // 2. Fallback to Apps Script FIND_BILL if GViz didn't return
      if (!b) {
        const targetUrl = State.settings.mainSheetScriptUrl || State.settings.scriptUrl;
        if (targetUrl) {
          const resp = await fetch(`${targetUrl}?action=FIND_BILL&billNo=${encodeURIComponent(cleanNo)}&t=${Date.now()}`);
          const data = await resp.json();
          if (data && data.found && data.bill) {
            b = data.bill;
          }
        }
      }

      if (b) {
        // Cache and index bill for instant 0.003ms future lookups
        addBillToMasterIndex(b);
        saveState('master');

        // Update modal in real time if currently open for this bill
        const pendingNo = State.pendingScannedBill?.billNo ? String(State.pendingScannedBill.billNo).trim() : '';
        const pendingDigits = pendingNo.replace(/\D/g, '');
        const billDigits = String(b.billNo || '').replace(/\D/g, '');
        const isMatch = State.isConfirmModalOpen && State.pendingScannedBill &&
          (normalizeInvoiceNumber(pendingNo) === normalizeInvoiceNumber(billNo) ||
           normalizeInvoiceNumber(pendingNo) === normalizeInvoiceNumber(b.billNo) ||
           pendingNo === b.billNo ||
           (pendingDigits.length >= 3 && billDigits.endsWith(pendingDigits)));

        if (isMatch) {
          State.pendingScannedBill.party = b.party;
          State.pendingScannedBill.amount = b.amount;
          State.pendingScannedBill.agent = b.agent;
          State.pendingScannedBill.receipt = b.receipt;
          State.pendingScannedBill.outstanding = b.outstanding;
          State.pendingScannedBill.remainingText = b.remainingText;
          State.pendingScannedBill.fromMaster = true;

          if (partyEl) partyEl.textContent = b.party;
          if (amountEl) amountEl.textContent = formatINR(b.amount);
          if (receiptEl) {
            if (b.receipt && b.receipt.trim()) {
              receiptEl.innerHTML = `<span class="badge-receipt" style="background:#e0f2fe;color:#0284c7;font-weight:700;padding:2px 8px;border-radius:6px;font-size:0.92rem;"><i class="fa-solid fa-receipt"></i> ${b.receipt.trim()}</span>`;
            } else {
              receiptEl.textContent = '-';
            }
            receiptEl.title = b.receipt || '-';
          }
          if (remainingEl) remainingEl.textContent = formatINR(b.outstanding);
          if (remainingBox) {
            if (b.outstanding <= 0) {
              remainingBox.classList.remove('has-due');
              if (remainingStatus) remainingStatus.textContent = 'Fully Paid / No Due';
            } else {
              remainingBox.classList.add('has-due');
              if (remainingStatus) remainingStatus.textContent = `⚠️ Pending Due (${formatINR(b.outstanding)})`;
            }
          }
          if (agentEl && b.agent) agentEl.textContent = b.agent;

          // Update fraud banner with verified sheet details
          updateModalFraudBanner(State.pendingScannedBill, source, false);
        }

        // Also update in dispatch basket if already confirmed
        const basketItem = State.dispatchBasket.find(x => normalizeInvoiceNumber(x.billNo) === normalizeInvoiceNumber(billNo));
        if (basketItem) {
          basketItem.party = b.party;
          basketItem.amount = b.amount;
          if (b.agent) basketItem.agent = b.agent;
          basketItem.receipt = b.receipt;
          basketItem.outstanding = b.outstanding;
          renderDispatchBasket();
        }
      } else {
        if (receiptEl && receiptEl.innerHTML.includes('Fetching')) {
          receiptEl.textContent = '-';
        }
        if (State.isConfirmModalOpen && State.pendingScannedBill) {
          State.pendingScannedBill.fromMaster = false;
          updateModalFraudBanner(State.pendingScannedBill, source, false);
        }
      }
    } catch (e) {
      console.warn('Fast bill lookup from sheet failed:', e);
      if (receiptEl && receiptEl.innerHTML.includes('Fetching')) {
        receiptEl.textContent = '-';
      }
      if (State.isConfirmModalOpen && State.pendingScannedBill) {
        updateModalFraudBanner(State.pendingScannedBill, source, false);
      }
    }
  }

  function confirmPendingScannedBill() {
    const parsed = State.pendingScannedBill;
    const source = State.pendingScanSource;
    if (!parsed) {
      closeBillConfirmModal();
      return;
    }

    if (source === 'DISPATCH') {
      addBillToDispatchBasket(parsed);
    } else {
      receiveBillSettlement(parsed);
    }

    closeBillConfirmModal();
  }

  function closeBillConfirmModal() {
    const modal = document.getElementById('billDetailConfirmModal');
    if (modal) modal.style.display = 'none';
    State.pendingScannedBill = null;
    State.pendingScanSource = null;
    State.isConfirmModalOpen = false;
    State.lastScanTimestamp = Date.now();
    focusActiveScannerInput();
  }


  // ========================================================
  // 7. PAYMENT & RETURN MODALS
  // ========================================================

  function openPaymentModal(bill) {
    State.currentPaymentBill = bill;

    document.getElementById('modalBillNo').textContent = bill.billNo;
    document.getElementById('modalPartyName').textContent = bill.party;
    document.getElementById('modalBillAmt').textContent = formatINR(bill.amount);

    // Show Sheet Receipt column info if present!
    const receiptRow = document.getElementById('modalSheetReceiptRow');
    const receiptVal = document.getElementById('modalSheetReceiptVal');
    const refInput = document.getElementById('modalRefNo');

    if (bill.refNo) {
      if (receiptRow) receiptRow.style.display = 'block';
      if (receiptVal) receiptVal.textContent = bill.refNo;
      if (refInput && !refInput.value) refInput.value = bill.refNo;
    } else {
      if (receiptRow) receiptRow.style.display = 'none';
    }

    // Show Remaining Due / Outstanding
    const remainingRow = document.getElementById('modalRemainingDueRow');
    const remainingVal = document.getElementById('modalRemainingDueVal');
    const currentDue = (bill.outstanding !== undefined && bill.outstanding !== null)
      ? Number(bill.outstanding)
      : Math.max(0, bill.amount - (bill.collectedAmt || 0));

    if (remainingRow && remainingVal) {
      remainingRow.style.display = 'block';
      remainingVal.textContent = formatINR(currentDue);
    }

    const input = document.getElementById('modalCollectedAmt');
    input.value = bill.amount;

    const balanceHint = document.getElementById('modalBalanceHint');
    const updateBalanceHint = () => {
      const entered = parseFloat(input.value) || 0;
      const remainingAfter = Math.max(0, bill.amount - entered);
      if (balanceHint) {
        balanceHint.style.display = 'block';
        balanceHint.textContent = `Remaining Due After This: ${formatINR(remainingAfter)}`;
        balanceHint.className = remainingAfter > 0 ? 'hint text-danger' : 'hint text-success';
      }
    };
    input.oninput = updateBalanceHint;
    updateBalanceHint();

    document.getElementById('modalPaymentRemarks').value = '';
    setQuickPaymentMode('Cash');

    document.getElementById('paymentModal').style.display = 'flex';
    input.focus();
  }

  function closePaymentModal() {
    document.getElementById('paymentModal').style.display = 'none';
    State.currentPaymentBill = null;
    focusActiveScannerInput();
  }

  function setQuickPaymentMode(mode) {
    document.querySelectorAll('.btn-mode-quick').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    document.getElementById('modalPaymentMode').value = mode;
  }

  function savePaymentRecord(e) {
    e.preventDefault();
    const bill = State.currentPaymentBill;
    if (!bill) return;

    const collectedAmt = parseFloat(document.getElementById('modalCollectedAmt').value) || 0;
    const mode = document.getElementById('modalPaymentMode').value;
    const refNo = document.getElementById('modalRefNo').value.trim();
    const remarks = document.getElementById('modalPaymentRemarks').value.trim();
    const timestamp = new Date().toISOString();
    const remainingDue = Math.max(0, bill.amount - collectedAmt);

    bill.status = (collectedAmt >= bill.amount) ? 'PAID_FULL' : (collectedAmt > 0 ? 'PAID_PARTIAL' : 'WITH_AGENT');
    bill.collectedAmt = collectedAmt;
    bill.outstanding = remainingDue;
    bill.paymentMode = mode;
    bill.refNo = refNo || bill.refNo;
    bill.remarks = remarks || `Checked IN / Paid via ${mode}`;
    bill.lastActionDate = timestamp;

    bill.history.push({ action: bill.status, amount: collectedAmt, mode, ref: refNo, timestamp });

    queueSyncAction('SETTLEMENT_PAYMENT', {
      billNo: bill.billNo,
      agent: bill.agent,
      party: bill.party,
      totalAmount: bill.amount,
      status: bill.status,
      collectedAmt,
      remainingDue,
      paymentMode: mode,
      refNo: bill.refNo,
      remarks: bill.remarks,
      timestamp
    });

    saveState();
    updateGlobalStats();
    closePaymentModal();
    loadSettlementForSelectedAgent();
    renderLeftOutTab();

    SoundFX.playBeep('success');
    showToast(`Checked IN ${bill.billNo} (${formatINR(collectedAmt)})`, 'success');
  }

  function openReturnModal(bill) {
    State.currentReturnBill = bill;

    document.getElementById('returnModalBillNo').textContent = bill.billNo;
    document.getElementById('returnModalParty').textContent = bill.party;
    document.getElementById('returnModalAmt').textContent = formatINR(bill.amount);
    document.getElementById('returnRemarks').value = '';

    document.getElementById('returnModal').style.display = 'flex';
  }

  function closeReturnModal() {
    document.getElementById('returnModal').style.display = 'none';
    State.currentReturnBill = null;
    focusActiveScannerInput();
  }

  function saveReturnRecord(e) {
    e.preventDefault();
    const bill = State.currentReturnBill;
    if (!bill) return;

    const reason = document.getElementById('returnReasonSelect').value;
    const remarks = document.getElementById('returnRemarks').value.trim();
    const timestamp = new Date().toISOString();

    bill.status = 'RETURNED_IN_HAND';
    bill.returnReason = reason;
    bill.remarks = remarks || `Physical return verified for next round`;
    bill.lastActionDate = timestamp;

    bill.history.push({ action: 'RETURNED_IN_HAND', reason, remarks, timestamp });

    queueSyncAction('SETTLEMENT_RETURN', {
      billNo: bill.billNo,
      agent: bill.agent,
      status: 'RETURNED_IN_HAND',
      returnReason: reason,
      remarks: bill.remarks,
      timestamp
    });

    saveState();
    updateGlobalStats();
    closeReturnModal();
    loadSettlementForSelectedAgent();
    renderLeftOutTab();

    SoundFX.playBeep('success');
    showToast(`Return logged for ${bill.billNo}`, 'success');
  }

  function finalizeDailySettlement() {
    const agent = State.activeSettlementAgent;
    if (!agent) {
      showToast('Select an agent first', 'warning');
      return;
    }

    const bills = State.bills.filter(b => b.agent === agent);
    const leftOut = bills.filter(b => b.status === 'WITH_AGENT');

    if (leftOut.length > 0) {
      SoundFX.playBeep('warning');
      const proceed = confirm(`⚠️ NOTICE: ${leftOut.length} bills are LEFT OUT / unreturned with ${agent}. Mark them as Left-Out audit risk?`);
      if (!proceed) return;

      const timestamp = new Date().toISOString();
      leftOut.forEach(b => {
        b.status = 'MISSING_ALERT';
        b.remarks = `LEFT OUT at EOD settlement on ${getTodayDateString()}`;
        b.lastActionDate = timestamp;
        queueSyncAction('BILL_FLAG_MISSING', { billNo: b.billNo, agent, status: 'MISSING_ALERT', timestamp });
      });

      saveState();
      updateGlobalStats();
      loadSettlementForSelectedAgent();
      renderLeftOutTab();
    }

    SoundFX.playBeep('success');
    ConfettiFX.celebrate();
    showToast(`Settlement closed for ${agent}!`, 'success', 3500);
  }


  // ========================================================
  // 8. TAB 3: REMAINING LEFT-OUT AUDIT ENGINE
  // ========================================================

  function getAgentLeftOutStats(agentName, dateFilter = null, beatFilter = null) {
    const activeDateFilter = dateFilter || State.diffDateFilter || 'TODAY';
    let agentBills = State.bills.filter(b => b.agent === agentName);

    if (activeDateFilter === 'TODAY') {
      const today = getTodayDateString();
      agentBills = agentBills.filter(b => b.dispatchDate === today);
    } else if (activeDateFilter === 'YESTERDAY') {
      const yest = getYesterdayDateString();
      agentBills = agentBills.filter(b => b.dispatchDate === yest);
    }

    if (beatFilter && beatFilter !== 'ALL') {
      const filterLower = beatFilter.toLowerCase().trim();
      agentBills = agentBills.filter(b => {
        const beatStr = String(b.beat || b.beatName || '').toLowerCase();
        return beatStr.includes(filterLower);
      });
    }

    const leftOutBills = agentBills.filter(b => b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT');
    const checkedInBills = agentBills.filter(b => b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND');

    let totalAmt = 0, checkedInAmt = 0, leftOutAmt = 0;

    agentBills.forEach(b => totalAmt += (Number(b.amount) || 0));
    checkedInBills.forEach(b => checkedInAmt += (Number(b.collectedAmt) || Number(b.amount) || 0));
    leftOutBills.forEach(b => leftOutAmt += (Number(b.amount) || 0));

    return {
      agent: agentName,
      totalCount: agentBills.length,
      totalAmt,
      checkedInCount: checkedInBills.length,
      checkedInAmt,
      leftOutCount: leftOutBills.length,
      leftOutAmt,
      leftOutBills
    };
  }

  function renderLeftOutTab() {
    const grid = document.getElementById('leftOutSummaryGrid');
    const tbody = document.getElementById('leftOutTbody');
    const filterSelect = document.getElementById('leftOutAgentFilter');
    const beatSelect = document.getElementById('leftOutBeatFilter');
    if (!grid || !tbody) return;

    const filterVal = filterSelect ? filterSelect.value : 'ALL';
    const beatVal = beatSelect ? beatSelect.value : 'ALL';
    const activeDateFilter = State.diffDateFilter || 'TODAY';

    // Highlight active date chip
    document.querySelectorAll('.diff-chip').forEach(c => {
      c.classList.toggle('active', (c.dataset.diffDate || 'TODAY') === activeDateFilter);
    });

    // Populate Agent filter options with the 3 designated agents
    if (filterSelect) {
      const currentVal = filterSelect.value || 'ALL';
      filterSelect.innerHTML = '<option value="ALL">All Agents (Overview)</option>';
      State.agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name;
        if (a.name === currentVal) opt.selected = true;
        filterSelect.appendChild(opt);
      });
    }

    // Populate Beat filter options
    if (beatSelect) {
      const curBeat = beatSelect.value || 'ALL';
      beatSelect.innerHTML = '<option value="ALL">All Beats & Routes</option>';
      const knownBeats = new Set();
      Object.values(MASTER_BEAT_PLAN).forEach(plan => {
        Object.values(plan).forEach(item => {
          if (item.beat) knownBeats.add(item.beat);
        });
      });
      (State.bills || []).forEach(b => {
        if (b.beatName) knownBeats.add(b.beatName);
        else if (b.beat) knownBeats.add(b.beat);
      });
      Array.from(knownBeats).sort().forEach(bName => {
        const opt = document.createElement('option');
        opt.value = bName;
        opt.textContent = bName;
        if (bName === curBeat) opt.selected = true;
        beatSelect.appendChild(opt);
      });
    }

    grid.innerHTML = '';
    tbody.innerHTML = '';

    // Calculate strip stats for selected date filter & beat filter
    let dateFilteredBills = State.bills;
    if (activeDateFilter === 'TODAY') {
      const today = getTodayDateString();
      dateFilteredBills = State.bills.filter(b => b.dispatchDate === today);
    } else if (activeDateFilter === 'YESTERDAY') {
      const yest = getYesterdayDateString();
      dateFilteredBills = State.bills.filter(b => b.dispatchDate === yest);
    }

    if (filterVal !== 'ALL') {
      dateFilteredBills = dateFilteredBills.filter(b => b.agent === filterVal);
    }
    if (beatVal !== 'ALL') {
      const bLower = beatVal.toLowerCase().trim();
      dateFilteredBills = dateFilteredBills.filter(b => {
        const beatStr = String(b.beat || b.beatName || '').toLowerCase();
        return beatStr.includes(bLower);
      });
    }

    let stripDispatchedCount = dateFilteredBills.length;
    let stripDispatchedAmt = dateFilteredBills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    let receivedBills = dateFilteredBills.filter(b => b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND');
    let stripReceivedCount = receivedBills.length;
    let stripReceivedAmt = receivedBills.reduce((s, b) => s + (Number(b.collectedAmt) || Number(b.amount) || 0), 0);
    let diffBills = dateFilteredBills.filter(b => b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT');
    let stripDiffCount = diffBills.length;
    let stripDiffAmt = diffBills.reduce((s, b) => s + (Number(b.amount) || 0), 0);

    const elOutAmt = document.getElementById('statInCustodyAmt');
    const elOutCnt = document.getElementById('statInCustody');
    const elInAmt = document.getElementById('statCollectedAmt');
    const elInCnt = document.getElementById('statCollected');
    const elDiffAmt = document.getElementById('statMissingAmt');
    const elDiffCnt = document.getElementById('statMissing');

    if (elOutAmt) elOutAmt.textContent = formatINR(stripDispatchedAmt);
    if (elOutCnt) elOutCnt.textContent = `${stripDispatchedCount} bills`;
    if (elInAmt) elInAmt.textContent = formatINR(stripReceivedAmt);
    if (elInCnt) elInCnt.textContent = `${stripReceivedCount} bills`;
    if (elDiffAmt) elDiffAmt.textContent = formatINR(stripDiffAmt);
    if (elDiffCnt) elDiffCnt.textContent = `${stripDiffCount} bills`;

    const allLeftOutBills = [];

    State.agents.forEach(agent => {
      const stats = getAgentLeftOutStats(agent.name, activeDateFilter, beatVal);
      if (filterVal !== 'ALL' && filterVal !== agent.name) return;

      if (stats.leftOutBills.length > 0) {
        allLeftOutBills.push(...stats.leftOutBills);
      }

      // Summary Card
      const card = document.createElement('div');
      card.className = 'leftout-agent-card';
      card.innerHTML = `
        <div class="leftout-agent-head">
          <span class="leftout-agent-name"><i class="fa-solid fa-user"></i> ${agent.name}</span>
          <span class="leftout-count-tag ${stats.leftOutCount > 0 ? 'bg-danger text-white' : ''}">${stats.leftOutCount} Difference</span>
        </div>
        <div class="leftout-amount-row">
          <small class="text-muted">Out: ${stats.totalCount} | In: ${stats.checkedInCount}</small>
          <span class="leftout-amt-val font-mono ${stats.leftOutCount > 0 ? 'text-danger' : ''}">${formatINR(stats.leftOutAmt)}</span>
        </div>
        <div style="display: flex; gap: 6px; margin-top: 4px;">
          <button class="btn btn-outline-whatsapp btn-sm flex-1" data-wa-agent="${agent.name}">
            <i class="fa-brands fa-whatsapp"></i> Alert Agent
          </button>
          <button class="btn btn-dark btn-sm" data-goto-settle="${agent.name}">
            Receive
          </button>
        </div>
      `;
      grid.appendChild(card);
    });

    // Populate Left Out Table
    if (allLeftOutBills.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">🎉 Zero difference for ${activeDateFilter.toLowerCase()}! All dispatched bills are accounted for.</td></tr>`;
    } else {
      allLeftOutBills.forEach(b => {
        const tr = document.createElement('tr');
        const beatTag = b.beat ? `<div style="font-size:0.75rem; color:#64748b; margin-top:2px;"><i class="fa-solid fa-location-dot"></i> ${b.beat}</div>` : '';
        tr.innerHTML = `
          <td><strong class="font-mono text-danger">${b.billNo}</strong></td>
          <td><strong>${b.agent}</strong>${beatTag}</td>
          <td>${b.party}</td>
          <td class="font-mono font-bold">${formatINR(b.amount)}</td>
          <td>${b.dispatchDate || '-'}</td>
          <td>${b.refNo ? `<span class="badge-receipt">${b.refNo}</span>` : '-'}</td>
          <td>
            <button class="btn btn-success btn-sm" data-table-checkin="${b.billNo}">
              <i class="fa-solid fa-check"></i> Receive
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Attach Action Listeners
    grid.querySelectorAll('[data-wa-agent]').forEach(btn => {
      btn.addEventListener('click', () => sendLeftOutWhatsApp(btn.dataset.waAgent));
    });

    grid.querySelectorAll('[data-goto-settle]').forEach(btn => {
      btn.addEventListener('click', () => {
        State.activeScanMode = 'SETTLEMENT';
        selectAgentAndStartScan(btn.dataset.gotoSettle);
      });
    });

    tbody.querySelectorAll('[data-table-checkin]').forEach(btn => {
      btn.addEventListener('click', () => {
        const b = State.bills.find(item => item.billNo === btn.dataset.tableCheckin);
        if (b) {
          b.status = 'RECEIVED';
          b.remarks = 'Directly received from Difference list';
          b.lastActionDate = new Date().toISOString();
          saveState();
          updateGlobalStats();
          renderLeftOutTab();
          updateHomeStats();
          SoundFX.playBeep('success');
          showToast(`Received ${b.billNo}`, 'success');
        }
      });
    });

    // Alert tab badge
    const alertTabBtn = document.querySelector('[data-tab="tab-leftout"]');
    if (alertTabBtn) {
      alertTabBtn.classList.toggle('has-leftout', allLeftOutBills.length > 0);
    }

    // Render Missed Bills Report
    renderMissedBillsReport(filterVal);
  }

  /**
   * Missed Bills Report: Identifies bills assigned in Master Sheet that were NOT dispatched today
   */
  function renderMissedBillsReport(selectedAgent = 'ALL') {
    const box = document.getElementById('missedBillsBox');
    const countEl = document.getElementById('missedBillsCount');
    const listEl = document.getElementById('missedBillsList');
    if (!box || !countEl || !listEl) return;

    if (!State.masterSheetBills || State.masterSheetBills.length === 0) {
      box.style.display = 'none';
      return;
    }

    const today = getTodayDateString();
    const todayDispatchedNos = new Set(
      State.bills
        .filter(b => b.dispatchDate === today)
        .map(b => normalizeInvoiceNumber(b.billNo))
    );

    const missed = [];
    State.masterSheetBills.forEach(b => {
      if (!b || !b.billNo) return;
      const bAgent = String(b.agent || '').trim();
      if (!bAgent) return;

      if (selectedAgent !== 'ALL' && bAgent.toLowerCase() !== selectedAgent.toLowerCase()) {
        return;
      }

      const norm = normalizeInvoiceNumber(b.billNo);
      if (!todayDispatchedNos.has(norm)) {
        missed.push(b);
      }
    });

    countEl.textContent = missed.length;
    box.style.display = missed.length > 0 ? 'block' : 'none';

    listEl.innerHTML = '';
    missed.slice(0, 40).forEach(b => {
      const item = document.createElement('div');
      item.className = 'missed-bill-item';
      const outstanding = Number(b.outstanding) || 0;
      const receipt = String(b.receipt || '').trim();
      let statusBadge = '';
      if (outstanding <= 0) {
        statusBadge = `<span class="badge-paid">✅ Paid</span>`;
      } else if (receipt) {
        statusBadge = `<span class="badge-partial">⚠️ Partial (${formatINR(outstanding)})</span>`;
      } else {
        statusBadge = `<span class="badge-pending">🔴 Due (${formatINR(outstanding)})</span>`;
      }

      item.innerHTML = `
        <div class="missed-bill-info">
          <div class="missed-bill-top">
            <strong class="font-mono text-danger">${b.billNo}</strong>
            ${statusBadge}
            <span class="badge-receipt"><i class="fa-solid fa-user"></i> ${b.agent || 'Agent'}</span>
          </div>
          <span class="missed-bill-party">${b.party || 'Customer'} &bull; ${formatINR(b.amount)}</span>
        </div>
        <div class="missed-bill-action">
          <button class="btn btn-outline-danger btn-sm" data-dispatch-missed="${b.billNo}">
            <i class="fa-solid fa-plus"></i> Dispatch
          </button>
        </div>
      `;
      listEl.appendChild(item);
    });

    listEl.querySelectorAll('[data-dispatch-missed]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bNo = btn.dataset.dispatchMissed;
        const b = findMasterBill(bNo);
        if (b) {
          showBillScannedConfirmation(b, 'DISPATCH');
        }
      });
    });
  }

  function sendLeftOutWhatsApp(agentName) {
    if (!agentName) return;
    const stats = getAgentLeftOutStats(agentName);
    const agentObj = State.agents.find(a => a.name === agentName);
    const phone = agentObj ? agentObj.phone : '';

    if (stats.leftOutBills.length === 0) {
      showToast(`No left out bills for ${agentName}`, 'info');
      return;
    }

    const billLines = stats.leftOutBills.map((b, i) => 
      `${i + 1}. *${b.billNo}*: ${b.party} (${formatINR(b.amount)})${b.refNo ? ` [Receipt: ${b.refNo}]` : ''}`
    ).join('\n');

    const msg = 
`*⚠️ PENDING / LEFT OUT BILLS REPORT*
*Agent:* ${agentName}
*Date:* ${getTodayDateString()}
-------------------------
📦 *Total Dispatched:* ${stats.totalCount} bills (${formatINR(stats.totalAmt)})
✅ *Checked IN / Paid:* ${stats.checkedInCount} bills (${formatINR(stats.checkedInAmt)})
⚠️ *REMAINING WITH YOU:* ${stats.leftOutCount} bills (${formatINR(stats.leftOutAmt)})

*List of Bills to Account For:*
${billLines}
-------------------------
Please reconcile payments or return signed copies tomorrow.
_BillAudit Pro_`;

    const url = phone ? `https://wa.me/91${phone}?text=${encodeURI(msg)}` : `https://wa.me/?text=${encodeURI(msg)}`;
    window.open(url, '_blank');
  }

  function sendAllLeftOutWhatsApp() {
    const filterSelect = document.getElementById('leftOutAgentFilter');
    const agent = filterSelect ? filterSelect.value : 'ALL';
    if (agent !== 'ALL') {
      sendLeftOutWhatsApp(agent);
    } else {
      // Send for first agent with left out bills or show alert
      const agentsWithLeftOut = State.agents.filter(a => getAgentLeftOutStats(a.name).leftOutCount > 0);
      if (agentsWithLeftOut.length === 0) {
        showToast('All agents have 0 left-out bills!', 'success');
        return;
      }
      sendLeftOutWhatsApp(agentsWithLeftOut[0].name);
    }
  }

  // ========================================================
  // 8B. AUDIT & PAYMENT RECONCILIATION ENGINE
  // ========================================================

  /**
   * Synchronize active custody bills directly from Tracking Sheet (Live_Custody tab)
   */
  async function syncBillsFromTrackingSheet(showFeedback = false) {
    const targetUrl = State.settings.trackingSheetScriptUrl;
    if (!targetUrl) return;

    try {
      const resp = await fetch(`${targetUrl}?action=GET_CUSTODY&t=${Date.now()}`);
      const data = await resp.json();

      if (data && data.status === 'OK' && Array.isArray(data.bills)) {
        const custodyBills = data.bills;
        const existingMap = new Map();
        State.bills.forEach((b, idx) => {
          existingMap.set(normalizeInvoiceNumber(b.billNo), idx);
        });

        let updatedCount = 0;
        let newCount = 0;

        custodyBills.forEach(cb => {
          if (!cb || !cb.billNo) return;
          const norm = normalizeInvoiceNumber(cb.billNo);
          const existingIdx = existingMap.get(norm);

          const formattedBill = {
            billNo: cb.billNo,
            party: cb.party || 'Standard Customer',
            amount: Number(cb.amount) || 0,
            agent: cb.agent || 'Sales Agent',
            dispatchDate: cb.dispatchDate ? String(cb.dispatchDate).slice(0, 10) : getTodayDateString(),
            status: cb.status || 'WITH_AGENT',
            collectedAmt: Number(cb.collectedAmt) || 0,
            outstanding: cb.outstanding !== undefined ? Number(cb.outstanding) : (Number(cb.amount) || 0),
            paymentMode: cb.paymentMode || '',
            refNo: cb.refNo || '',
            returnReason: cb.returnReason || '',
            remarks: cb.remarks || '',
            lastActionDate: cb.lastActionDate || new Date().toISOString(),
            history: []
          };

          if (existingIdx !== undefined) {
            const b = State.bills[existingIdx];
            b.party = formattedBill.party;
            b.amount = formattedBill.amount || b.amount;
            b.agent = formattedBill.agent;
            b.status = formattedBill.status;
            b.collectedAmt = formattedBill.collectedAmt;
            b.outstanding = formattedBill.outstanding;
            b.paymentMode = formattedBill.paymentMode;
            b.refNo = formattedBill.refNo;
            b.remarks = formattedBill.remarks;
            b.lastActionDate = formattedBill.lastActionDate;
            updatedCount++;
          } else {
            State.bills.push(formattedBill);
            existingMap.set(norm, State.bills.length - 1);
            newCount++;
          }
        });

        saveState('bills');
        updateGlobalStats();
        renderLeftOutTab();
        updateHomeStats();

        if (showFeedback) {
          SoundFX.playBeep('success');
          showToast(`Synced ${custodyBills.length} custody bills from Tracking Sheet!`, 'success');
        }
      }
    } catch (err) {
      console.warn('Failed to sync custody bills from Tracking Sheet:', err);
      if (showFeedback) {
        showToast('Could not fetch tracking bills. Check connection.', 'warning');
      }
    }
  }

  let reconciliationData = {
    all: [],
    paid: [],
    partial: [],
    unpaid: [],
    activeFilter: 'ALL',
    activeAgent: 'ALL'
  };

  async function openPaymentReconciliationModal() {
    const modal = document.getElementById('paymentReconcileModal');
    if (!modal) return;
    modal.style.display = 'flex';

    const tbody = document.getElementById('reconcileTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 24px;"><i class="fa-solid fa-spinner fa-spin"></i> Cross-referencing payment records from Master Invoice Sheet...</td></tr>`;
    }

    await syncBillsFromTrackingSheet(false).catch(() => {});
    analyzeAndRenderPaymentReconciliation();
  }

  function closePaymentReconciliationModal() {
    const modal = document.getElementById('paymentReconcileModal');
    if (modal) modal.style.display = 'none';
  }

  function analyzeAndRenderPaymentReconciliation() {
    const bills = State.bills || [];
    const paidList = [];
    const partialList = [];
    const unpaidList = [];
    const allList = [];

    let paidAmt = 0;
    let partCollAmt = 0;
    let partDueAmt = 0;
    let unpaidDueAmt = 0;

    const agentsSet = new Set();

    bills.forEach(b => {
      if (b.agent) agentsSet.add(b.agent);

      const mm = findMasterBill(b.billNo) || {};
      const amt = Number(b.amount) || Number(mm.amount) || 0;
      const outstanding = (mm.outstanding !== undefined) ? Number(mm.outstanding) : (b.outstanding !== undefined ? Number(b.outstanding) : amt);
      const receipt = mm.receipt || b.refNo || '';
      const mode = mm.mode || b.paymentMode || 'Cash';
      const sheetStatus = (mm.status || '').toUpperCase();

      const isCurrentComplete = b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'RETURNED_IN_HAND';

      let statusType = 'UNPAID';
      let paidAmount = 0;
      let remainingDue = amt;

      if (sheetStatus === 'PAID' || (outstanding <= 0 && (amt > 0 || receipt))) {
        statusType = 'PAID';
        paidAmount = amt;
        remainingDue = 0;
      } else if (sheetStatus === 'PARTIAL' || (receipt && outstanding > 0) || (amt > outstanding && outstanding > 0)) {
        statusType = 'PARTIAL';
        paidAmount = Math.max(0, amt - outstanding);
        remainingDue = outstanding;
      } else if (isCurrentComplete) {
        statusType = 'PAID';
        paidAmount = Number(b.collectedAmt) || amt;
        remainingDue = 0;
      } else {
        statusType = 'UNPAID';
        paidAmount = 0;
        remainingDue = amt;
      }

      const item = {
        billNo: b.billNo,
        agent: b.agent || mm.agent || 'Sales Agent',
        party: b.party || mm.party || 'Standard Customer',
        amount: amt,
        sheetStatus: sheetStatus || (statusType === 'PAID' ? 'PAID' : (statusType === 'PARTIAL' ? 'PARTIAL' : 'PENDING')),
        statusType: statusType,
        paidAmount: paidAmount,
        remainingDue: remainingDue,
        receipt: receipt,
        mode: mode,
        currentCustodyStatus: b.status,
        originalBill: b
      };

      allList.push(item);

      if (statusType === 'PAID') {
        paidList.push(item);
        paidAmt += amt;
      } else if (statusType === 'PARTIAL') {
        partialList.push(item);
        partCollAmt += paidAmount;
        partDueAmt += remainingDue;
      } else {
        unpaidList.push(item);
        unpaidDueAmt += remainingDue;
      }
    });

    reconciliationData = {
      all: allList,
      paid: paidList,
      partial: partialList,
      unpaid: unpaidList,
      activeFilter: reconciliationData.activeFilter || 'ALL',
      activeAgent: reconciliationData.activeAgent || 'ALL'
    };

    const elPaidCnt = document.getElementById('recPaidCount');
    const elPaidAmt = document.getElementById('recPaidAmt');
    const elPartCnt = document.getElementById('recPartialCount');
    const elPartAmt = document.getElementById('recPartialAmt');
    const elUnpaidCnt = document.getElementById('recUnpaidCount');
    const elUnpaidAmt = document.getElementById('recUnpaidAmt');
    const elBtnPaidCount = document.getElementById('btnPaidCount');

    if (elPaidCnt) elPaidCnt.textContent = `${paidList.length} bills`;
    if (elPaidAmt) elPaidAmt.textContent = formatINR(paidAmt);
    if (elPartCnt) elPartCnt.textContent = `${partialList.length} bills`;
    if (elPartAmt) elPartAmt.textContent = `Coll: ${formatINR(partCollAmt)} | Due: ${formatINR(partDueAmt)}`;
    if (elUnpaidCnt) elUnpaidCnt.textContent = `${unpaidList.length} bills`;
    if (elUnpaidAmt) elUnpaidAmt.textContent = `Pending: ${formatINR(unpaidDueAmt)}`;
    if (elBtnPaidCount) elBtnPaidCount.textContent = paidList.length;

    const tabAll = document.getElementById('recTabAllCount');
    const tabPaid = document.getElementById('recTabPaidCount');
    const tabPart = document.getElementById('recTabPartCount');
    const tabUnpaid = document.getElementById('recTabUnpaidCount');

    if (tabAll) tabAll.textContent = allList.length;
    if (tabPaid) tabPaid.textContent = paidList.length;
    if (tabPart) tabPart.textContent = partialList.length;
    if (tabUnpaid) tabUnpaid.textContent = unpaidList.length;

    const agentSelect = document.getElementById('reconcileAgentSelect');
    if (agentSelect) {
      const curAgent = reconciliationData.activeAgent || 'ALL';
      agentSelect.innerHTML = '<option value="ALL">All Agents</option>';
      Array.from(agentsSet).sort().forEach(ag => {
        const opt = document.createElement('option');
        opt.value = ag;
        opt.textContent = ag;
        if (ag === curAgent) opt.selected = true;
        agentSelect.appendChild(opt);
      });
    }

    renderReconcileTable();
  }

  function renderReconcileTable() {
    const tbody = document.getElementById('reconcileTableBody');
    if (!tbody) return;

    let items = reconciliationData.all;
    if (reconciliationData.activeFilter === 'PAID') {
      items = reconciliationData.paid;
    } else if (reconciliationData.activeFilter === 'PARTIAL') {
      items = reconciliationData.partial;
    } else if (reconciliationData.activeFilter === 'UNPAID') {
      items = reconciliationData.unpaid;
    }

    if (reconciliationData.activeAgent && reconciliationData.activeAgent !== 'ALL') {
      items = items.filter(it => it.agent === reconciliationData.activeAgent);
    }

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: #64748b;">No bills found for the selected filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    items.forEach(it => {
      const tr = document.createElement('tr');

      let statusBadge = '';
      if (it.statusType === 'PAID') {
        statusBadge = '<span class="status-tag-paid"><i class="fa-solid fa-circle-check"></i> FULLY PAID</span>';
      } else if (it.statusType === 'PARTIAL') {
        statusBadge = '<span class="status-tag-partial"><i class="fa-solid fa-circle-exclamation"></i> PARTIAL</span>';
      } else {
        statusBadge = '<span class="status-tag-unpaid"><i class="fa-solid fa-clock"></i> UNPAID</span>';
      }

      const isComplete = it.currentCustodyStatus === 'PAID_FULL' || it.currentCustodyStatus === 'RECEIVED';
      const actionBtn = isComplete
        ? `<span class="text-success font-bold" style="font-size:0.85rem;"><i class="fa-solid fa-check"></i> Complete</span>`
        : `<button class="btn btn-success btn-xs" data-reconcile-bill="${it.billNo}">
             <i class="fa-solid fa-check"></i> Complete Audit
           </button>`;

      tr.innerHTML = `
        <td><strong class="font-mono">${it.billNo}</strong></td>
        <td><strong>${it.agent}</strong></td>
        <td>${it.party}</td>
        <td class="font-mono font-bold">${formatINR(it.amount)}</td>
        <td>${statusBadge}</td>
        <td class="font-mono text-success">${formatINR(it.paidAmount)}</td>
        <td class="font-mono ${it.remainingDue > 0 ? 'text-danger font-bold' : ''}">${formatINR(it.remainingDue)}</td>
        <td>${it.receipt ? `<span class="badge-receipt"><i class="fa-solid fa-receipt"></i> ${it.receipt}</span>` : '-'}</td>
        <td>${actionBtn}</td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-reconcile-bill]').forEach(btn => {
      btn.addEventListener('click', () => {
        completeSingleBillAudit(btn.dataset.reconcileBill);
      });
    });
  }

  function completeSingleBillAudit(billNo) {
    const item = reconciliationData.all.find(it => it.billNo === billNo);
    if (!item) return;

    const b = item.originalBill;
    const nowIST = new Date().toISOString();

    b.status = item.statusType === 'PARTIAL' ? 'PAID_PARTIAL' : 'PAID_FULL';
    b.collectedAmt = item.paidAmount || b.amount;
    b.outstanding = item.remainingDue;
    b.refNo = item.receipt || b.refNo || 'PAID IN FULL';
    b.paymentMode = item.mode || 'Cash';
    b.remarks = `Audit Complete: Payment verified in sheet (Receipt: ${b.refNo}, Paid: ${formatINR(b.collectedAmt)})`;
    b.lastActionDate = nowIST;

    b.history.push({
      action: b.status,
      amount: b.collectedAmt,
      ref: b.refNo,
      timestamp: nowIST
    });

    queueSyncAction('SETTLEMENT_PAYMENT', {
      billNo: b.billNo,
      agent: b.agent,
      party: b.party,
      totalAmount: b.amount,
      status: b.status,
      collectedAmt: b.collectedAmt,
      remainingDue: b.outstanding,
      paymentMode: b.paymentMode,
      refNo: b.refNo,
      remarks: b.remarks,
      timestamp: nowIST
    });

    saveState('bills');
    updateGlobalStats();
    renderLeftOutTab();
    updateHomeStats();
    analyzeAndRenderPaymentReconciliation();

    SoundFX.playBeep('success');
    showToast(`Audit Completed for ${billNo}!`, 'success');
  }

  function completeAuditForAllPaidBills() {
    const paidItems = reconciliationData.paid.filter(it => it.currentCustodyStatus !== 'PAID_FULL' && it.currentCustodyStatus !== 'RECEIVED');
    if (paidItems.length === 0) {
      showToast('All received bills are already marked complete in audit!', 'info');
      return;
    }

    const nowIST = new Date().toISOString();
    let completedCount = 0;
    let totalAmt = 0;

    paidItems.forEach(it => {
      const b = it.originalBill;
      b.status = 'PAID_FULL';
      b.collectedAmt = it.paidAmount || b.amount;
      b.outstanding = 0;
      b.refNo = it.receipt || b.refNo || 'PAID IN FULL';
      b.paymentMode = it.mode || 'Settled in Full';
      b.remarks = `Audit Complete: Fully paid in sheet (Receipt: ${b.refNo})`;
      b.lastActionDate = nowIST;

      b.history.push({
        action: 'PAID_FULL',
        amount: b.collectedAmt,
        ref: b.refNo,
        timestamp: nowIST
      });

      queueSyncAction('SETTLEMENT_PAYMENT', {
        billNo: b.billNo,
        agent: b.agent,
        party: b.party,
        totalAmount: b.amount,
        status: 'PAID_FULL',
        collectedAmt: b.collectedAmt,
        remainingDue: 0,
        paymentMode: b.paymentMode,
        refNo: b.refNo,
        remarks: b.remarks,
        timestamp: nowIST
      });

      completedCount++;
      totalAmt += (Number(b.collectedAmt) || Number(b.amount) || 0);
    });

    saveState('bills');
    updateGlobalStats();
    renderLeftOutTab();
    updateHomeStats();
    analyzeAndRenderPaymentReconciliation();

    SoundFX.playBeep('success');
    ConfettiFX.celebrate();
    showToast(`🎉 Made ${completedCount} bills complete from audit (${formatINR(totalAmt)})!`, 'success', 4000);
  }


  // ========================================================
  // 9. MASTER LEDGER (LIVE MASTER SHEET BILL BROWSER)
  // ========================================================

  function renderMasterLedger() {
    const tbody = document.getElementById('masterLedgerTbody');
    const countInfo = document.getElementById('ledgerCountInfo');
    if (!tbody) return;

    const search = (document.getElementById('ledgerSearchInput')?.value || '').trim().toLowerCase();
    const agentFilter = document.getElementById('ledgerAgentFilter')?.value || 'ALL';
    const beatFilterEl = document.getElementById('ledgerBeatFilter');
    const beatFilter = beatFilterEl?.value || 'ALL';
    const statusFilter = document.getElementById('ledgerStatusFilter')?.value || 'ALL';

    // Populate ledger beat filter dropdown if needed
    if (beatFilterEl && beatFilterEl.options.length <= 1) {
      const curBeatVal = beatFilterEl.value || 'ALL';
      beatFilterEl.innerHTML = '<option value="ALL">All Beats & Routes</option>';
      const knownBeats = new Set();
      Object.values(MASTER_BEAT_PLAN).forEach(plan => {
        Object.values(plan).forEach(item => {
          if (item.beat) knownBeats.add(item.beat);
        });
      });
      (State.masterSheetBills || []).forEach(b => {
        if (b.beat && b.beat.trim().length > 1) knownBeats.add(b.beat.trim());
      });
      (State.bills || []).forEach(b => {
        if (b.beatName) knownBeats.add(b.beatName);
        else if (b.beat) knownBeats.add(b.beat);
      });
      Array.from(knownBeats).sort().forEach(bName => {
        const opt = document.createElement('option');
        opt.value = bName;
        opt.textContent = bName;
        if (bName === curBeatVal) opt.selected = true;
        beatFilterEl.appendChild(opt);
      });
    }

    const useMaster = State.masterSheetBills && State.masterSheetBills.length > 0;
    const sourceBills = useMaster ? State.masterSheetBills : State.bills;

    // Fast O(1) map for today's custody lookup
    const today = getTodayDateString();
    const todayCustodyMap = new Map();
    State.bills.forEach(b => {
      const norm = normalizeInvoiceNumber(b.billNo);
      todayCustodyMap.set(norm, b);
      todayCustodyMap.set(b.billNo.toUpperCase(), b);
    });

    const results = [];
    const limit = 60;

    for (let i = 0; i < sourceBills.length; i++) {
      const b = sourceBills[i];
      if (!b || !b.billNo) continue;

      const billNoStr = String(b.billNo).toLowerCase();
      const partyStr = String(b.party || '').toLowerCase();

      // Search filter (Invoice or Party)
      if (search) {
        if (!billNoStr.includes(search) && !partyStr.includes(search)) {
          continue;
        }
      }

      // Agent filter
      const bAgent = String(b.agent || '').trim();
      if (agentFilter !== 'ALL' && bAgent.toLowerCase() !== agentFilter.toLowerCase()) {
        continue;
      }

      // Payment & Custody Status filter
      const outstanding = (b.outstanding !== undefined && b.outstanding !== null) ? Number(b.outstanding) : 0;
      const receipt = String(b.receipt || '').trim();
      const norm = normalizeInvoiceNumber(b.billNo);
      const custodyRecord = todayCustodyMap.get(norm) || todayCustodyMap.get(b.billNo.toUpperCase());

      // Beat filter
      if (beatFilter !== 'ALL') {
        const beatFilterLower = beatFilter.toLowerCase().trim();
        const bBeat = String(b.beat || '').toLowerCase();
        const custodyBeat = custodyRecord ? String(custodyRecord.beat || custodyRecord.beatName || '').toLowerCase() : '';
        if (!bBeat.includes(beatFilterLower) && !custodyBeat.includes(beatFilterLower)) {
          continue;
        }
      }

      if (statusFilter === 'PAID') {
        if (outstanding > 0) continue;
      } else if (statusFilter === 'PARTIAL') {
        if (outstanding <= 0 || !receipt) continue;
      } else if (statusFilter === 'PENDING') {
        if (outstanding <= 0 || receipt) continue;
      } else if (statusFilter === 'DISPATCHED') {
        if (!custodyRecord || custodyRecord.status !== 'WITH_AGENT') continue;
      } else if (statusFilter === 'RECEIVED') {
        if (!custodyRecord || custodyRecord.status !== 'RECEIVED') continue;
      }

      results.push({ bill: b, custody: custodyRecord, outstanding, receipt });
      if (results.length >= limit) break;
    }

    if (countInfo) {
      if (useMaster) {
        countInfo.textContent = `Showing ${results.length} of ${sourceBills.length.toLocaleString()} Master Sheet bills`;
      } else {
        countInfo.textContent = `Showing ${results.length} bills`;
      }
    }

    if (results.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No matching bills found in ${useMaster ? 'Master Sheet' : 'records'}.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    results.forEach(({ bill, custody, outstanding, receipt }) => {
      const tr = document.createElement('tr');

      let paymentBadge = '';
      if (outstanding <= 0) {
        paymentBadge = `<span class="badge-paid">✅ Paid (${receipt || 'Full'})</span>`;
      } else if (receipt) {
        paymentBadge = `<span class="badge-partial">⚠️ Partial (${formatINR(outstanding)})</span>`;
      } else {
        paymentBadge = `<span class="badge-pending">🔴 Due (${formatINR(outstanding)})</span>`;
      }

      let custodyBadge = '<span class="text-muted" style="font-size:0.75rem;">Not Out</span>';
      if (custody) {
        if (custody.status === 'WITH_AGENT') {
          custodyBadge = `<span class="badge-custody-out">📤 Out (${custody.agent})</span>`;
        } else if (custody.status === 'RECEIVED') {
          custodyBadge = `<span class="badge-custody-in">📥 Received</span>`;
        }
      }

      const beatTag = bill.beat ? `<div style="font-size:0.75rem; color:#64748b; margin-top:2px;"><i class="fa-solid fa-location-dot"></i> ${bill.beat}</div>` : '';

      tr.innerHTML = `
        <td><strong class="font-mono text-primary">${bill.billNo}</strong></td>
        <td>${bill.party || 'Standard Account'}</td>
        <td class="font-mono font-bold">${formatINR(bill.amount)}</td>
        <td>${paymentBadge}</td>
        <td><strong>${bill.agent || '-'}</strong>${beatTag}</td>
        <td>${custodyBadge}</td>
        <td>
          <button class="btn btn-dark btn-sm" data-ledger-view="${bill.billNo}">
            <i class="fa-solid fa-eye"></i> View
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-ledger-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bNo = btn.dataset.ledgerView;
        const b = findMasterBill(bNo) || State.bills.find(item => item.billNo === bNo);
        if (b) {
          showBillScannedConfirmation(b, 'DISPATCH');
        }
      });
    });
  }

  function exportCSV() {
    if (State.bills.length === 0) {
      showToast('No bills to export', 'warning');
      return;
    }
    const headers = ['Invoice Number', 'Party', 'Amount', 'Agent', 'Date', 'Status', 'Collected Amount', 'Receipt / Ref', 'Mode', 'Reason'];
    const rows = State.bills.map(b => [
      `"${b.billNo}"`,
      `"${(b.party || '').replace(/"/g, '""')}"`,
      b.amount,
      `"${b.agent || ''}"`,
      `"${b.dispatchDate || ''}"`,
      `"${b.status}"`,
      b.collectedAmt || 0,
      `"${b.refNo || ''}"`,
      `"${b.paymentMode || ''}"`,
      `"${(b.returnReason || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = `BillAudit_Ledger_${getTodayDateString()}.csv`;
    link.click();
    showToast('Exported CSV', 'success');
  }


  // ========================================================
  // 10. GOOGLE SHEETS & MASTER SHEET SYNC
  // ========================================================

  function queueSyncAction(type, payload) {
    State.offlineQueue.push({
      id: 'Q-' + Date.now(),
      type,
      timestamp: new Date().toISOString(),
      payload
    });
    saveState('queue');
    updateOfflineQueueBadge();

    const targetUrl = State.settings.trackingSheetScriptUrl || State.settings.scriptUrl;
    if (navigator.onLine && targetUrl) {
      processOfflineQueue();
    }
  }

  async function processOfflineQueue() {
    const targetUrl = State.settings.trackingSheetScriptUrl || State.settings.scriptUrl;
    if (!targetUrl || State.offlineQueue.length === 0) return;

    const btn = document.getElementById('quickSyncBtn');
    const text = document.getElementById('syncStatusText');
    if (btn) btn.classList.add('syncing');
    if (text) text.textContent = 'Syncing...';

    const queueSnapshot = [...State.offlineQueue];

    try {
      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'BATCH_SYNC',
          queue: queueSnapshot,
          bills: State.bills,
          timestamp: new Date().toISOString()
        })
      });

      const res = await resp.json();
      if (res && res.success) {
        State.offlineQueue = [];
        saveState('queue');
        updateOfflineQueueBadge();
        if (text) text.textContent = 'Synced';
        showToast('Tracking Sheet updated successfully!', 'success');
      }
    } catch (e) {
      console.warn('Sync failed, queued offline:', e);
      if (text) text.textContent = 'Queued';
    } finally {
      if (btn) btn.classList.remove('syncing');
    }
  }

  async function testSheetConnection() {
    const url = (document.getElementById('googleScriptUrl').value || '').trim();
    if (!url) {
      showToast('Enter your Main Sheet Apps Script URL first', 'warning');
      return;
    }

    const btn = document.getElementById('testSheetConnectionBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting...';

    try {
      const resp = await fetch(`${url}?action=PING&t=${Date.now()}`);
      const data = await resp.json();

      if (data && (data.status === 'OK' || data.status === 'ok')) {
        SoundFX.playBeep('success');
        showToast(`Connected to Main Sheet (${data.sheetTitle || data.sheet || 'Fetcher Active'})!`, 'success');
        State.settings.mainSheetScriptUrl = url;
        State.settings.scriptUrl = url;
        saveState('settings');
        updateMasterSheetUI();
      } else {
        throw new Error(data?.message || 'Invalid response');
      }
    } catch (err) {
      SoundFX.playBeep('error');
      alert(`Could not connect to Main Sheet: ${err.message}\nMake sure your Web App deployment access is set to 'Anyone'.`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-plug"></i> Test Connection';
    }
  }

  async function testTrackingSheetConnection() {
    const url = (document.getElementById('trackingSheetScriptUrl')?.value || '').trim();
    if (!url) {
      showToast('Enter your Tracking Sheet Apps Script URL first', 'warning');
      return;
    }

    const btn = document.getElementById('testTrackingSheetBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting...';
    }

    try {
      const resp = await fetch(`${url}?action=PING&t=${Date.now()}`);
      const data = await resp.json();

      if (data && data.status === 'OK') {
        SoundFX.playBeep('success');
        showToast(`Connected to Tracking Sheet (${data.sheetTitle || 'Recorder Active'})!`, 'success');
        State.settings.trackingSheetScriptUrl = url;
        saveState('settings');
        updateTrackingSheetUI();
      } else {
        throw new Error(data?.message || 'Invalid response');
      }
    } catch (err) {
      SoundFX.playBeep('error');
      alert(`Could not connect to Tracking Sheet: ${err.message}\nMake sure your Web App deployment access is set to 'Anyone'.`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-plug"></i> Test Tracking Connection';
      }
    }
  }

  function updateTrackingSheetUI() {
    const summaryText = document.getElementById('trackingSheetSummaryText');
    const trackingUrl = State.settings.trackingSheetScriptUrl;
    if (trackingUrl) {
      if (summaryText) {
        summaryText.innerHTML = `<strong>Tracking Sheet Active:</strong> Connected to live cloud recorder. Scan-Out and Scan-In logs will be automatically recorded.`;
      }
    } else {
      if (summaryText) {
        summaryText.textContent = 'Tracking Sheet: Ready to link. Enter your Tracking Web App URL above.';
      }
    }
  }

  /**
   * Helper to extract Google Sheet ID and GID from sheetCsvUrl or default
   */
  function getSheetCredentials() {
    const csvUrl = State.settings.sheetCsvUrl || DEFAULT_SETTINGS.sheetCsvUrl;
    let sheetId = '11J3WSXNFfu5aARNMBX3HQazajsfzBjj7wX9MWyVVBRk';
    let gid = '1608276684';

    const idMatch = csvUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (idMatch) sheetId = idMatch[1];

    const gidMatch = csvUrl.match(/[?&]gid=([0-9]+)/);
    if (gidMatch) gid = gidMatch[1];

    return { sheetId, gid };
  }

  /**
   * Intelligent Receipt and Payment Resolver
   * Combines Column M (Receipt), Column N (Remarks), and Column I/J (Paid-up / Status)
   */
  function resolveIntelligentReceipt(rawRec, rawRem, rawPaidUp, rawStatus, rawOut, rawAmt) {
    const rec = String(rawRec || '').trim();
    const rem = String(rawRem || '').trim();
    const status = String(rawStatus || '').trim().toUpperCase();
    const paidUp = parseFloat(String(rawPaidUp || '').replace(/[₹,\s]/g, '')) || 0;
    const out = parseFloat(String(rawOut || '').replace(/[₹,\s]/g, '')) || 0;
    const amt = parseFloat(String(rawAmt || '').replace(/[₹,\s]/g, '')) || 0;

    // 1. Column M text receipt (e.g. "R4083")
    if (rec) {
      const isGenericRem = /^(ok|good|normal|followup|n\/a|nil)$/i.test(rem);
      if (rem && !isGenericRem && rem.toLowerCase() !== rec.toLowerCase()) {
        return `${rec} (${rem})`;
      }
      return rec;
    }

    // 2. Column N Remarks payment receipt (e.g. "R163", "RECIPT 87 + 338", "WA ONLINE")
    if (rem) {
      const isGeneric = /^(ok|good|normal|followup|n\/a|nil)$/i.test(rem);
      if (!isGeneric) {
        return rem;
      }
    }

    // 3. Paid in full
    if (status === 'PAID' || (out <= 0 && amt > 0)) {
      if (paidUp > 0) return `PAID (₹${paidUp.toLocaleString('en-IN')})`;
      return 'PAID IN FULL';
    }

    // 4. Partial payment
    if (status === 'PARTIAL' || (out > 0 && paidUp > 0)) {
      return `PARTIAL (₹${paidUp.toLocaleString('en-IN')} Paid)`;
    }

    // 5. Cancelled
    if (status === 'CANCELLED') {
      return 'CANCELLED';
    }

    return '';
  }

  /**
   * Fast parser for Google Visualization API (GViz / BigTable query) responses.
   * Extracts Columns D (Invoice), E (Party), F (Amount), L (Due), M (Receipt), N (Remarks), O (Beat), P (Agent), I (Paid-up), J (Status)
   */
  function parseGvizResponse(txt) {
    if (!txt || typeof txt !== 'string') return [];
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start === -1 || end === -1) return [];
    try {
      const json = JSON.parse(txt.substring(start, end + 1));
      const rows = [];
      if (!json.table || !json.table.rows) return rows;

      // Extract column indices by column letter ID if present in table.cols
      const colIds = (json.table.cols || []).map(col => String(col.id || col.label || '').toUpperCase());
      const idxD = colIds.indexOf('D');
      const idxE = colIds.indexOf('E');
      const idxF = colIds.indexOf('F');
      const idxL = colIds.indexOf('L');
      const idxM = colIds.indexOf('M');
      const idxN = colIds.indexOf('N');
      const idxO = colIds.indexOf('O');
      const idxP = colIds.indexOf('P');
      const idxI = colIds.indexOf('I');
      const idxJ = colIds.indexOf('J');

      for (let i = 0; i < json.table.rows.length; i++) {
        const r = json.table.rows[i];
        if (!r || !r.c) continue;

        // Bill No (Col D)
        const cellD = idxD !== -1 ? r.c[idxD] : r.c[0];
        const billNo = cellD ? String(cellD.v || '').trim() : '';
        if (!billNo) continue;

        // Party (Col E)
        const cellE = idxE !== -1 ? r.c[idxE] : r.c[1];
        const party = cellE ? String(cellE.v || 'General Customer').trim() : 'General Customer';

        // Amount (Col F)
        const cellF = idxF !== -1 ? r.c[idxF] : r.c[2];
        const rawAmt = cellF ? (Number(cellF.v) || parseFloat(String(cellF.f || '').replace(/[₹,\s]/g, '')) || 0) : 0;

        // Outstanding (Col L)
        const cellL = idxL !== -1 ? r.c[idxL] : r.c[3];
        const rawOut = cellL ? (Number(cellL.v) || parseFloat(String(cellL.f || '').replace(/[₹,\s]/g, '')) || 0) : 0;
        const remainingText = cellL ? String(cellL.f || cellL.v || '').trim() : '';

        // Raw Receipt (Col M)
        const cellM = idxM !== -1 ? r.c[idxM] : (r.c.length > 4 ? r.c[4] : null);
        const rawRec = cellM ? String(cellM.f || cellM.v || '').trim() : '';

        // Remarks (Col N)
        const cellN = idxN !== -1 ? r.c[idxN] : null;
        const rawRem = cellN ? String(cellN.f || cellN.v || '').trim() : '';

        // Paid-Up (Col I)
        const cellI = idxI !== -1 ? r.c[idxI] : null;
        const rawPaidUp = cellI ? (Number(cellI.v) || parseFloat(String(cellI.f || '').replace(/[₹,\s]/g, '')) || 0) : 0;

        // Status (Col J)
        const cellJ = idxJ !== -1 ? r.c[idxJ] : null;
        const rawStatus = cellJ ? String(cellJ.v || '').trim() : '';

        // Beat (Col O)
        let beat = '';
        if (idxO !== -1 && r.c[idxO]) {
          beat = String(r.c[idxO].v || '').trim();
        } else if (r.c.length >= 7) {
          beat = r.c[5] ? String(r.c[5].v || '').trim() : '';
        }

        // Agent (Col P)
        let agent = '';
        if (idxP !== -1 && r.c[idxP]) {
          agent = String(r.c[idxP].v || '').trim();
        } else if (r.c.length >= 7) {
          agent = r.c[6] ? String(r.c[6].v || '').trim() : '';
        } else if (r.c.length === 6) {
          agent = r.c[5] ? String(r.c[5].v || '').trim() : '';
        }

        // Intelligent Receipt Resolution
        const receipt = resolveIntelligentReceipt(rawRec, rawRem, rawPaidUp, rawStatus, rawOut, rawAmt);

        rows.push({ billNo, receipt, outstanding: rawOut, party, amount: rawAmt, agent, beat, remainingText });
      }
      return rows;
    } catch (e) {
      console.warn('Failed to parse GViz JSON response:', e);
      return [];
    }
  }

  /**
   * Ultra-Fast Direct Google Sheet Synchronizer.
   * Pulls directly from Google BigTable endpoint in ~3 seconds for all 15,000 bills.
   * Auto-called in background on website load / refresh, and on-demand via header sync button.
   */
  async function syncSheetDirect(showFeedback = false) {
    const { sheetId, gid } = getSheetCredentials();
    updateMasterSheetUI('syncing');

    let incomingBills = [];

    // 1. Direct BigTable Visualization API (3 seconds for 15,000 bills)
    try {
      const tq = encodeURIComponent('select D, E, F, L, M, N, O, P, I, J where D is not null');
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&tq=${tq}&gid=${gid}&t=${Date.now()}`;
      const resp = await fetch(gvizUrl);
      if (resp.ok) {
        const txt = await resp.text();
        incomingBills = parseGvizResponse(txt);
      }
    } catch (gvizErr) {
      console.warn('[SheetSync] Direct GViz query failed, falling back to Apps Script:', gvizErr);
    }

    // 2. Fallback to Apps Script if GViz query did not return rows
    if (!incomingBills || incomingBills.length === 0) {
      const targetUrl = State.settings.mainSheetScriptUrl || State.settings.scriptUrl;
      if (targetUrl) {
        try {
          const resp = await fetch(`${targetUrl}?action=GET_DATA&t=${Date.now()}`);
          const data = await resp.json();
          if (data && data.rows && Array.isArray(data.rows)) {
            incomingBills = data.rows.map(r => ({
              billNo: String(r[0] || '').trim(),
              receipt: String(r[1] || '').trim(),
              outstanding: Number(r[2]) || 0,
              party: String(r[3] || 'General Customer').trim(),
              amount: Number(r[4]) || 0,
              agent: String(r[5] || '').trim(),
              beat: String(r[6] || '').trim(),
              remainingText: String(r[2] || '')
            }));
          }
        } catch (scriptErr) {
          console.warn('[SheetSync] Apps Script fallback failed:', scriptErr);
        }
      }
    }

    if (incomingBills && incomingBills.length > 0) {
      State.masterSheetBills = incomingBills;
      rebuildMasterSheetMap();
      saveState('master');
      saveState('agents');
      updateGlobalStats();
      renderAgentSelects();
      renderLeftOutTab();
      renderMasterLedger();
      updateMasterSheetUI();

      if (showFeedback) {
        SoundFX.playBeep('success');
        showToast(`⚡ Synced ${incomingBills.length.toLocaleString()} bills directly from MARCH-SEPT tab!`, 'success', 3000);
      }
      return true;
    } else {
      updateMasterSheetUI();
      if (showFeedback) {
        showToast('Could not retrieve updated bills from sheet. Using cached data.', 'warning', 4000);
      }
      return false;
    }
  }

  async function pullRecentBillsFromSheet() {
    const btn = document.getElementById('pullRecentSheetBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';
    }
    try {
      await syncSheetDirect(true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Quick Load Recent (Last 500)';
      }
    }
  }

  async function pullFromSheet() {
    const btn = document.getElementById('pullFromSheetBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';
    }
    try {
      await syncSheetDirect(true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Fetch Full Archive (15k)';
      }
    }
  }

  async function fetchFromSheetCsvUrl() {
    const urlInput = document.getElementById('googleSheetCsvUrl');
    const url = urlInput ? urlInput.value.trim() : '';
    if (!url) {
      showToast('Enter a published Google Sheet CSV URL', 'warning');
      return;
    }

    const btn = document.getElementById('fetchSheetCsvBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Downloading...';

    try {
      const resp = await fetch(url);
      const csvText = await resp.text();
      const parsed = parseMasterSheetTable(csvText);

      if (parsed.length > 0) {
        State.masterSheetBills = parsed;
        State.settings.sheetCsvUrl = url;
        saveState();
        updateMasterSheetUI();
        renderAgentSelects();
        SoundFX.playBeep('success');
        showToast(`Loaded ${parsed.length} bills from Sheet CSV!`, 'success');
      } else {
        throw new Error('No valid rows found in CSV');
      }
    } catch (e) {
      showToast('CSV fetch failed: ' + e.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-download"></i> Fetch';
    }
  }

  function importPastedSheetData() {
    const input = document.getElementById('masterSheetPasteInput');
    const raw = input ? input.value.trim() : '';
    if (!raw) {
      showToast('Please paste your sheet rows first', 'warning');
      return;
    }

    const parsed = parseMasterSheetTable(raw);
    if (parsed.length === 0) {
      SoundFX.playBeep('error');
      showToast('Could not parse sheet data. Check headers and format.', 'danger');
      return;
    }

    State.masterSheetBills = parsed;
    saveState('master');
    saveState('agents');
    updateMasterSheetUI();
    renderAgentSelects();

    SoundFX.playBeep('success');
    showToast(`Successfully loaded ${parsed.length} bills with Agent & Receipt mapping!`, 'success', 3500);
  }

  function loadSampleMasterSheet() {
    const sampleTSV = 
`Invoice No\tAgent\tParty\tAmount\tReceipt\tOutstanding
IN-FY26/27-3921\tRahul Sharma\tSatguru Provision Store\t5465.00\tRCT-9812\t0.00
IN-FY26/27-3922\tRahul Sharma\tMahaveer Super Market\t12850.00\tPaid UPI\t0.00
IN-FY26/27-3923\tVikram Singh\tBalaji General Store\t3200.00\tPending\t3200.00
IN-FY26/27-3924\tVikram Singh\tKailash Kirana & Oil Depot\t28400.00\tRCT-9815\t5000.00
IN-FY26/27-3925\tAmit Patel\tShree Ganesh Retailers\t8950.50\tCheque #4412\t0.00
IN-FY26/27-3926\tAmit Patel\tNational Mart & Dry Fruits\t15200.00\tCash Received\t0.00
IN-FY26/27-3927\tRahul Sharma\tModern Bakery & Sweets\t7400.00\tRCT-9820\t1400.00`;

    const input = document.getElementById('masterSheetPasteInput');
    if (input) input.value = sampleTSV;

    const parsed = parseMasterSheetTable(sampleTSV);
    State.masterSheetBills = parsed;
    saveState('master');
    saveState('agents');
    updateMasterSheetUI();
    renderAgentSelects();

    SoundFX.playBeep('success');
    showToast('Loaded 7 sample master sheet bills with Agent & Receipt mapping!', 'success');
  }


  // ========================================================
  // 11. AGENT MANAGER & DEMO DATA
  // ========================================================

  function renderAgentsManager() {
    const container = document.getElementById('agentsListContainer');
    if (!container) return;

    container.innerHTML = '';
    State.agents.forEach((ag) => {
      const row = document.createElement('div');
      row.className = 'agent-item-pill';
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-circle-check text-success"></i>
          <strong>${ag.name}</strong>
          <span class="badge-count-pill" style="display: inline-block;">Active</span>
        </div>
      `;
      container.appendChild(row);
    });
  }

  function loadSampleBills() {
    const samples = [
      'IN-FY26/27-3921,Satguru Provision Store,5,465.00',
      'IN-FY26/27-3922,Mahaveer Super Market,12,850.00',
      'IN-FY26/27-3923,Balaji General Store,3,200.00',
      'IN-FY26/27-3924,Kailash Kirana & Oil Depot,28,400.00',
      'IN-FY26/27-3925,Shree Ganesh Retailers,8,950.50'
    ];

    samples.forEach(raw => {
      const parsed = parseQRCodeData(raw);
      if (parsed) {
        State.dispatchBasket.push({
          billNo: parsed.billNo,
          party: parsed.party,
          amount: parsed.amount,
          agent: State.agents[0] ? State.agents[0].name : 'Rajesh',
          receipt: 'RCT-001',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          raw
        });
      }
    });

    renderDispatchBasket();
    switchTab('tab-dispatch');
    SoundFX.playBeep('success');
    showToast('Loaded 5 sample bills into OUT basket!', 'success');
  }

  function previewPrintableQRCodes() {
    const modal = document.getElementById('qrPreviewModal');
    const grid = document.getElementById('qrSampleGrid');
    if (!modal || !grid) return;

    const samples = [
      { text: 'IN-FY26/27-3921,Satguru Provision Store,5,465.00', bill: 'IN-FY26/27-3921', party: 'Satguru Provision Store', amt: '₹5,465.00' },
      { text: 'IN-FY26/27-3922,Mahaveer Super Market,12,850.00', bill: 'IN-FY26/27-3922', party: 'Mahaveer Super Market', amt: '₹12,850.00' },
      { text: 'IN-FY26/27-3923,Balaji General Store,3,200.00', bill: 'IN-FY26/27-3923', party: 'Balaji General Store', amt: '₹3,200.00' },
      { text: 'IN-FY26/27-3924,Kailash Kirana,28,400.00', bill: 'IN-FY26/27-3924', party: 'Kailash Kirana', amt: '₹28,400.00' }
    ];

    grid.innerHTML = '';
    samples.forEach(s => {
      const card = document.createElement('div');
      card.className = 'qr-card-item';
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(s.text)}`;
      card.innerHTML = `
        <img src="${qrUrl}" alt="QR ${s.bill}" />
        <div class="bill-no">${s.bill}</div>
        <div class="party">${s.party}</div>
        <div class="amt">${s.amt}</div>
      `;
      grid.appendChild(card);
    });

    modal.style.display = 'flex';
  }


  // ========================================================
  // 12. UI HELPERS & LISTENERS
  // ========================================================

  function renderAgentSelects() {
    const dispatchSelect = document.getElementById('dispatchAgentSelect');
    const settleSelect = document.getElementById('settlementAgentSelect');
    const ledgerSelect = document.getElementById('ledgerAgentFilter');
    const leftOutSelect = document.getElementById('leftOutAgentFilter');

    if (dispatchSelect) {
      const cur = dispatchSelect.value;
      dispatchSelect.innerHTML = '<option value="AUTO">⚡ Auto-Detect from Master Sheet</option>';
      State.agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = `${a.name} (${a.id})`;
        dispatchSelect.appendChild(opt);
      });
      if (cur) dispatchSelect.value = cur;
    }

    if (settleSelect) {
      const cur = settleSelect.value;
      settleSelect.innerHTML = '<option value="">Select Agent returning bills...</option>';
      State.agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = `${a.name} (${a.id})`;
        settleSelect.appendChild(opt);
      });
      if (cur) settleSelect.value = cur;
    }

    if (ledgerSelect) {
      const cur = ledgerSelect.value;
      ledgerSelect.innerHTML = '<option value="ALL">All Agents</option>';
      State.agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name;
        ledgerSelect.appendChild(opt);
      });
      if (cur) ledgerSelect.value = cur;
    }

    if (leftOutSelect) {
      const cur = leftOutSelect.value;
      leftOutSelect.innerHTML = '<option value="ALL">All Agents (Overview)</option>';
      State.agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name;
        leftOutSelect.appendChild(opt);
      });
      if (cur) leftOutSelect.value = cur;
    }
  }

  function updateGlobalStats() {
    let inCustodyAmt = 0, inCustodyCount = 0;
    let collectedAmt = 0, collectedCount = 0;
    let returnedAmt = 0, returnedCount = 0;
    let missingAmt = 0, missingCount = 0;

    State.bills.forEach(b => {
      const amt = Number(b.amount) || 0;
      const colAmt = Number(b.collectedAmt) || 0;

      if (b.status === 'WITH_AGENT') {
        inCustodyCount++;
        inCustodyAmt += amt;
        missingCount++;
        missingAmt += amt;
      } else if (b.status === 'RECEIVED') {
        collectedCount++;
        collectedAmt += amt;
      } else if (b.status === 'PAID_FULL') {
        collectedCount++;
        collectedAmt += colAmt;
      } else if (b.status === 'PAID_PARTIAL') {
        collectedCount++;
        collectedAmt += colAmt;
        returnedAmt += (amt - colAmt);
      } else if (b.status === 'RETURNED_IN_HAND') {
        returnedCount++;
        returnedAmt += amt;
      } else if (b.status === 'MISSING_ALERT') {
        missingCount++;
        missingAmt += amt;
      }
    });

    document.querySelectorAll('.statInCustodyAmt, #statInCustodyAmt').forEach(el => el.textContent = formatINR(inCustodyAmt));
    document.querySelectorAll('.statInCustody, #statInCustody').forEach(el => el.textContent = `${inCustodyCount} bills`);
    document.querySelectorAll('.statCollectedAmt, #statCollectedAmt').forEach(el => el.textContent = formatINR(collectedAmt));
    document.querySelectorAll('.statCollected, #statCollected').forEach(el => el.textContent = `${collectedCount} bills`);
    document.querySelectorAll('.statReturnedAmt, #statReturnedAmt').forEach(el => el.textContent = formatINR(returnedAmt));
    document.querySelectorAll('.statReturned, #statReturned').forEach(el => el.textContent = `${returnedCount} bills`);
    document.querySelectorAll('.statMissingAmt, #statMissingAmt').forEach(el => el.textContent = formatINR(missingAmt));
    document.querySelectorAll('.statMissing, #statMissing').forEach(el => el.textContent = `${missingCount} bills`);
    document.querySelectorAll('.statCardMissing, #statCardMissing').forEach(card => card.classList.toggle('has-missing', missingCount > 0));
  }

  function updateOfflineQueueBadge() {
    const badge = document.getElementById('pendingBadge');
    const qCount = State.offlineQueue.length;
    if (badge) {
      badge.style.display = qCount > 0 ? 'inline-block' : 'none';
      badge.textContent = qCount;
    }
  }

  async function switchTab(tabId) {
    if (State.activeTab === tabId) return;
    State.activeTab = tabId;

    if (State.isConfirmModalOpen) {
      closeBillConfirmModal();
    }

    document.querySelectorAll('.tab-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.toggle('active', view.id === tabId);
    });

    if (tabId === 'tab-home') {
      updateHomeStats();
    } else if (tabId === 'tab-dispatch') {
      renderDispatchBasket();
      focusActiveScannerInput();
    } else if (tabId === 'tab-settlement') {
      loadSettlementForSelectedAgent();
      focusActiveScannerInput();
    } else if (tabId === 'tab-ledger') {
      renderMasterLedger();
    } else if (tabId === 'tab-leftout') {
      renderLeftOutTab();
    } else if (tabId === 'tab-settings') {
      renderAgentsManager();
    }
  }

  // Updates the home tab quick stats strip & agent difference cards
  function updateHomeStats() {
    const today = getTodayDateString();
    const todayBills = State.bills.filter(b => b.dispatchDate === today);
    const outCount = todayBills.length;
    const inBills = todayBills.filter(b => b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND');
    const inCount = inBills.length;
    const diffBills = todayBills.filter(b => b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT');
    const diffCount = diffBills.length;

    const outAmt = todayBills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const inAmt = inBills.reduce((s, b) => s + (Number(b.collectedAmt !== undefined ? b.collectedAmt : b.amount) || 0), 0);
    const diffAmt = diffBills.reduce((s, b) => s + (Number(b.outstanding !== undefined ? b.outstanding : b.amount) || 0), 0);

    const elOut = document.getElementById('homeStatOut');
    const elIn = document.getElementById('homeStatIn');
    const elLeft = document.getElementById('homeStatLeft');
    if (elOut) animateNumber(elOut, outCount);
    if (elIn) animateNumber(elIn, inCount);
    if (elLeft) animateNumber(elLeft, diffCount);

    const elOutAmt = document.getElementById('homeStatOutAmt');
    const elInAmt = document.getElementById('homeStatInAmt');
    const elLeftAmt = document.getElementById('homeStatLeftAmt');
    if (elOutAmt) elOutAmt.textContent = `${formatINR(outAmt)} in transit`;
    if (elInAmt) elInAmt.textContent = `${formatINR(inAmt)} accounted`;
    if (elLeftAmt) elLeftAmt.textContent = `${formatINR(diffAmt)} still pending`;

    const sideBadge = document.getElementById('sidebarDiffBadge');
    if (sideBadge) {
      sideBadge.textContent = diffCount;
      sideBadge.style.display = diffCount > 0 ? 'inline-flex' : 'none';
    }

    // Format today's date badge
    const dateBadge = document.getElementById('homeDateBadge');
    if (dateBadge) {
      const now = new Date();
      dateBadge.textContent = now.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    }

    // High-contrast alert card styling if difference > 0
    const diffCard = document.getElementById('homeDiffCardPro');
    const diffFooter = document.getElementById('homeDiffFooter');
    if (diffCard) {
      if (diffCount > 0) {
        diffCard.classList.add('has-alert');
        if (diffFooter) diffFooter.innerHTML = `<span class="text-danger font-bold">⚠️ ${diffCount} bills unreturned</span> — Click to Audit`;
      } else {
        diffCard.classList.remove('has-alert');
        if (diffFooter) diffFooter.innerHTML = `<span class="text-success font-bold">✓ Zero differences</span> — All accounted`;
      }
    }

    renderHomeCharts(outCount, inCount, diffCount, outAmt, inAmt, diffAmt);

    // Render Home Agent Difference Cards
    const diffGrid = document.getElementById('homeAgentDiffGrid');
    if (diffGrid) {
      diffGrid.innerHTML = '';
      State.agents.forEach(agent => {
        const stats = getAgentLeftOutStats(agent.name);
        const card = document.createElement('div');
        card.className = 'agent-diff-card';
        card.innerHTML = `
          <div class="agent-diff-header">
            <span><i class="fa-solid fa-user-tie"></i> ${agent.name}</span>
            <span class="count-pill ${stats.leftOutCount > 0 ? 'bg-danger text-white' : ''}" style="font-size:0.75rem;">
              ${stats.leftOutCount} Pending
            </span>
          </div>
          <div class="agent-diff-metric">
            <span class="agent-diff-val ${stats.leftOutCount > 0 ? 'has-diff text-danger' : 'text-success'}">
              ${formatINR(stats.leftOutAmt)}
            </span>
            <span class="agent-diff-sub">Dispatched: ${stats.totalCount} | Received: ${stats.checkedInCount}</span>
          </div>
        `;
        diffGrid.appendChild(card);
      });
    }
  }

  function getAvailableBeats(agentName = '') {
    const beatsSet = new Set();
    const agentLower = (agentName || '').toLowerCase().trim();

    // 1. Beats specifically mapped to this agent in Master Sheet
    if (agentLower && State.masterSheetBills && State.masterSheetBills.length > 0) {
      State.masterSheetBills.forEach(b => {
        if (b.beat && b.agent && b.agent.toLowerCase().includes(agentLower)) {
          beatsSet.add(b.beat.trim());
        }
      });
    }

    // 2. If fewer than 4 beats found for this agent, include all beats from Master Sheet
    if (beatsSet.size < 4 && State.masterSheetBills && State.masterSheetBills.length > 0) {
      State.masterSheetBills.forEach(b => {
        if (b.beat && b.beat.trim().length > 1) {
          beatsSet.add(b.beat.trim());
        }
      });
    }

    // 3. Fallback standard routes if Master Sheet hasn't loaded yet
    if (beatsSet.size === 0) {
      ['PREM NAGAR', 'RAM NAGAR', 'CENTRAL MARKET', 'STATION ROAD', 'MAIN BAZAAR', 'INDUSTRIAL AREA'].forEach(b => beatsSet.add(b));
    }

    return Array.from(beatsSet).filter(Boolean);
  }

  function resetPickerSteps() {
    const step1 = document.getElementById('pickerStepAgent');
    const step2 = document.getElementById('pickerStepBeat');
    if (step1) step1.style.display = 'block';
    if (step2) step2.style.display = 'none';
  }

  function getCurrentDayCode() {
    const dayIndex = new Date().getDay(); // 0 is Sun, 1 is Mon, ..., 6 is Sat
    const map = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const code = map[dayIndex];
    return (code === 'Sun') ? 'Mon' : code;
  }

  function updatePrimaryBeatDisplay(agentName, dayCode) {
    const card = document.getElementById('primaryBeatRefCard');
    const label = document.getElementById('primaryBeatDayAgentLabel');
    const nameEl = document.getElementById('primaryBeatNameDisplay');
    const areaEl = document.getElementById('primaryBeatAreaSub');
    if (!card || !nameEl) return;

    const day = dayCode || State.selectedDay || getCurrentDayCode();
    const agent = agentName || (State.activeAgent ? State.activeAgent.name : 'Rajesh');

    const dayFullNames = {
      Mon: 'Monday',
      Tue: 'Tuesday',
      Wed: 'Wednesday',
      Thu: 'Thursday',
      Fri: 'Friday',
      Sat: 'Saturday'
    };

    const agentPlan = MASTER_BEAT_PLAN[agent] || (agent.includes('Shivam') ? MASTER_BEAT_PLAN.Shivam : MASTER_BEAT_PLAN.Rajesh);
    const beatInfo = agentPlan ? agentPlan[day] : null;

    if (beatInfo && day) {
      card.style.display = 'block';
      const agentDisplay = (State.activeAgent && State.activeAgent.fullName) ? State.activeAgent.fullName : agent;
      if (label) label.textContent = `${dayFullNames[day] || day} · ${agentDisplay}`;
      nameEl.textContent = beatInfo.beat;
      if (areaEl) areaEl.textContent = beatInfo.area || beatInfo.beat;
      State.selectedBeatName = beatInfo.beat;

      const customInput = document.getElementById('customBeatInput');
      if (customInput) customInput.value = beatInfo.beat;

      // Highlight matching discovered beat chip if present
      document.querySelectorAll('#discoveredBeatsContainer .beat-chip-btn').forEach(c => {
        c.classList.toggle('active', c.dataset.beat === beatInfo.beat);
      });
    } else {
      if (label) label.textContent = `All Days (${agent})`;
      nameEl.textContent = 'All Beat Routes';
      if (areaEl) areaEl.textContent = 'General Route / All Areas';
    }
  }

  function updateConfirmButton(beatName) {
    const btn = document.getElementById('confirmBeatBtn');
    if (btn) {
      if (beatName) {
        btn.innerHTML = `<i class="fa-solid fa-camera"></i> Start Scanning &mdash; ${beatName}`;
      } else {
        btn.innerHTML = `<i class="fa-solid fa-camera"></i> Start Scanning`;
      }
    }
  }

  function renderWeeklyRoutesList(agentName) {
    const container = document.getElementById('weeklyRoutesList');
    if (!container) return;

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayFullNames = {
      Mon: 'Monday',
      Tue: 'Tuesday',
      Wed: 'Wednesday',
      Thu: 'Thursday',
      Fri: 'Friday',
      Sat: 'Saturday'
    };

    const todayCode = getCurrentDayCode();
    const agentPlan = MASTER_BEAT_PLAN[agentName] || (agentName.includes('Shivam') ? MASTER_BEAT_PLAN.Shivam : MASTER_BEAT_PLAN.Rajesh);

    container.innerHTML = days.map(day => {
      const beatInfo = agentPlan ? agentPlan[day] : null;
      const beatName = beatInfo ? beatInfo.beat : 'Route';
      const isToday = day === todayCode;
      const isSelected = (day === State.selectedDay) || (State.selectedBeatName === beatName);

      return `
        <button type="button" class="beat-option-row ${isSelected ? 'active' : ''}" data-day="${day}" data-beat="${beatName.replace(/"/g, '&quot;')}">
          <div class="beat-opt-left">
            <div class="beat-opt-day-wrap">
              <span class="beat-opt-day ${isToday ? 'is-today' : ''}">${dayFullNames[day]}</span>
              ${isToday ? '<span class="today-tag"><i class="fa-solid fa-star"></i> Today</span>' : ''}
            </div>
            <div class="beat-opt-title">${beatName}</div>
          </div>
          <div class="beat-opt-right">
            <i class="fa-solid ${isSelected ? 'fa-circle-check text-success' : 'fa-circle-dot text-muted'} beat-radio-icon"></i>
          </div>
        </button>
      `;
    }).join('');

    // Attach click and double click listeners to each row
    container.querySelectorAll('.beat-option-row').forEach(row => {
      row.addEventListener('click', () => {
        container.querySelectorAll('.beat-option-row').forEach(r => {
          r.classList.remove('active');
          const ic = r.querySelector('.beat-radio-icon');
          if (ic) ic.className = 'fa-solid fa-circle-dot text-muted beat-radio-icon';
        });

        row.classList.add('active');
        const ic = row.querySelector('.beat-radio-icon');
        if (ic) ic.className = 'fa-solid fa-circle-check text-success beat-radio-icon';

        const selDay = row.dataset.day;
        const selBeat = row.dataset.beat;
        State.selectedDay = selDay;
        State.selectedBeatName = selBeat;

        updateConfirmButton(selBeat);
      });

      // Double-click to instantly confirm and start scanning
      row.addEventListener('dblclick', () => {
        const selDay = row.dataset.day;
        const selBeat = row.dataset.beat;
        State.selectedDay = selDay;
        State.selectedBeatName = selBeat;
        confirmBeatAndStartScan();
      });
    });
  }

  function openBeatPickerForAgent(agentName) {
    const agent = State.agents.find(a => isSameAgent(a.name, agentName)) || { id: agentName, name: agentName, fullName: agentName };
    State.activeAgent = agent;

    const todayDay = getCurrentDayCode();
    State.selectedDay = todayDay;

    const agentPlan = MASTER_BEAT_PLAN[agent.name] || (agent.name.includes('Shivam') ? MASTER_BEAT_PLAN.Shivam : MASTER_BEAT_PLAN.Rajesh);
    const todayBeat = agentPlan && agentPlan[todayDay] ? agentPlan[todayDay].beat : '';
    State.selectedBeatName = todayBeat;

    const agentIndicator = document.getElementById('beatSelectedAgentName');
    if (agentIndicator) agentIndicator.textContent = agent.fullName || agent.name;

    const beatTitle = document.getElementById('beatPickerTitle');
    if (beatTitle) {
      beatTitle.textContent = State.activeScanMode === 'DISPATCH' ? 'Morning Dispatch — Choose Beat' : 'Evening Return — Choose Beat';
    }

    // Render the 6 beats for the selected agent and pre-select today
    renderWeeklyRoutesList(agent.name);
    updateConfirmButton(todayBeat);

    // Switch view to Step 2
    const step1 = document.getElementById('pickerStepAgent');
    const step2 = document.getElementById('pickerStepBeat');
    if (step1) step1.style.display = 'none';
    if (step2) step2.style.display = 'block';
  }

  async function confirmBeatAndStartScan() {
    const beatName = State.selectedBeatName || '';
    State.activeBeat = beatName;
    await proceedToScanTab(true);
  }

  async function proceedToScanTab() {
    const modal = document.getElementById('agentPickerModal');
    if (modal) modal.style.display = 'none';
    resetPickerSteps();

    const mode = State.activeScanMode || 'DISPATCH';
    const agentName = State.activeAgent ? State.activeAgent.name : 'Rajesh';
    const displayAgentName = State.activeAgent ? (State.activeAgent.fullName || State.activeAgent.name) : 'Rajesh';
    const pendingScan = State.pendingHardwareScan;
    State.pendingHardwareScan = null;

    if (mode === 'DISPATCH') {
      const badge = document.getElementById('dispatchAgentBadge');
      if (badge) badge.textContent = displayAgentName;

      const beatBadge = document.getElementById('dispatchBeatBadge');
      if (beatBadge) {
        beatBadge.textContent = State.activeBeat ? `📍 ${State.activeBeat}` : '📍 All Routes';
        beatBadge.style.display = 'inline-flex';
      }

      const sel = document.getElementById('dispatchAgentSelect');
      if (sel) {
        sel.innerHTML = `<option value="${agentName}" selected>${displayAgentName}</option>`;
        sel.value = agentName;
      }

      await switchTab('tab-dispatch');
      focusActiveScannerInput();

      if (pendingScan) {
        setTimeout(() => handleScannedCodeDispatch(pendingScan), 200);
      }
    } else {
      State.activeSettlementAgent = agentName;
      const badge = document.getElementById('settlementAgentBadge');
      if (badge) badge.textContent = displayAgentName;

      const beatBadge = document.getElementById('settlementBeatBadge');
      if (beatBadge) {
        beatBadge.textContent = State.activeBeat ? `📍 ${State.activeBeat}` : '📍 All Routes';
        beatBadge.style.display = 'inline-flex';
      }

      const sel = document.getElementById('settlementAgentSelect');
      if (sel) {
        sel.innerHTML = `<option value="${agentName}" selected>${displayAgentName}</option>`;
        sel.value = agentName;
      }

      await switchTab('tab-settlement');
      focusActiveScannerInput();

      if (pendingScan) {
        setTimeout(() => handleScannedCodeSettlement(pendingScan), 200);
      }
    }
  }

  // Opens agent picker modal before scanning
  function openAgentPicker(mode) {
    State.activeScanMode = mode;
    resetPickerSteps();
    const modal = document.getElementById('agentPickerModal');
    const title = document.getElementById('agentPickerTitle');
    const subtitle = document.getElementById('agentPickerSubtitle');
    if (title) title.textContent = mode === 'DISPATCH' ? 'Morning Dispatch — Choose Agent' : 'Evening Return — Choose Agent';
    if (subtitle) subtitle.textContent = mode === 'DISPATCH' ? 'Select sales agent taking bills out today' : 'Select sales agent checking bills in today';

    // Populate today's route previews on the agent cards in Step 1
    const todayDay = getCurrentDayCode();
    const dayFullNames = { Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat' };
    const shivamBeat = MASTER_BEAT_PLAN.Shivam[todayDay]?.beat || '';
    const rajeshBeat = MASTER_BEAT_PLAN.Rajesh[todayDay]?.beat || '';

    const shivamEl = document.getElementById('shivamTodayRoutePreview');
    if (shivamEl) {
      shivamEl.innerHTML = `<i class="fa-solid fa-location-dot"></i> Today (${dayFullNames[todayDay]}): <strong>${shivamBeat}</strong>`;
    }
    const rajeshEl = document.getElementById('rajeshTodayRoutePreview');
    if (rajeshEl) {
      rajeshEl.innerHTML = `<i class="fa-solid fa-location-dot"></i> Today (${dayFullNames[todayDay]}): <strong>${rajeshBeat}</strong>`;
    }

    if (modal) modal.style.display = 'flex';
  }

  // Direct shortcut (e.g. from Custody card check-in)
  async function selectAgentAndStartScan(agentName) {
    const agent = State.agents.find(a => isSameAgent(a.name, agentName)) || { id: agentName, name: agentName, fullName: agentName };
    State.activeAgent = agent;
    State.activeBeat = '';
    await proceedToScanTab(true);
  }

  // Returns home and stops camera
  async function goBackHome() {
    closeBillConfirmModal();
    State.activeAgent = null;
    State.activeBeat = null;
    State.activeScanMode = null;
    resetPickerSteps();
    await switchTab('tab-home');
  }

  function setupEventListeners() {
    // Tab switching (only nav tabs, not scan tabs)
    document.querySelectorAll('.tab-item').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // HOME TAB: action cards open agent picker
    document.getElementById('homeDispatchCard')?.addEventListener('click', () => openAgentPicker('DISPATCH'));
    document.getElementById('homeSettlementCard')?.addEventListener('click', () => openAgentPicker('SETTLEMENT'));

    // HOME TAB: metric cards shortcut directly to detailed views
    document.getElementById('homeDiffCardPro')?.addEventListener('click', () => switchTab('tab-leftout'));
    document.getElementById('homeOutCardPro')?.addEventListener('click', () => switchTab('tab-history'));
    document.getElementById('homeInCardPro')?.addEventListener('click', () => switchTab('tab-history'));

    // AGENT & BEAT / WEEK PICKER MODAL
    document.querySelectorAll('.agent-pick-btn, .agent-select-card').forEach(btn => {
      btn.addEventListener('click', () => openBeatPickerForAgent(btn.dataset.agent));
    });
    document.getElementById('backToAgentStepBtn')?.addEventListener('click', resetPickerSteps);
    document.getElementById('closeAgentPickerBtn')?.addEventListener('click', () => {
      document.getElementById('agentPickerModal').style.display = 'none';
      resetPickerSteps();
    });
    document.getElementById('closeBeatPickerBtn')?.addEventListener('click', () => {
      document.getElementById('agentPickerModal').style.display = 'none';
      resetPickerSteps();
    });
    document.getElementById('confirmBeatBtn')?.addEventListener('click', confirmBeatAndStartScan);

    // Allow clicking agent and beat badges on scan screens to switch agent or beat
    document.getElementById('dispatchAgentBadge')?.addEventListener('click', () => openAgentPicker('DISPATCH'));
    document.getElementById('dispatchBeatBadge')?.addEventListener('click', () => {
      if (State.activeAgent) {
        State.activeScanMode = 'DISPATCH';
        openBeatPickerForAgent(State.activeAgent.name);
      } else {
        openAgentPicker('DISPATCH');
      }
    });
    document.getElementById('settlementAgentBadge')?.addEventListener('click', () => openAgentPicker('SETTLEMENT'));
    document.getElementById('settlementBeatBadge')?.addEventListener('click', () => {
      if (State.activeAgent) {
        State.activeScanMode = 'SETTLEMENT';
        openBeatPickerForAgent(State.activeAgent.name);
      } else {
        openAgentPicker('SETTLEMENT');
      }
    });

    // BACK BUTTONS on scan tabs
    document.getElementById('backFromDispatchBtn')?.addEventListener('click', goBackHome);
    document.getElementById('backFromSettlementBtn')?.addEventListener('click', goBackHome);

    // Theme toggle
    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
      State.settings.theme = State.settings.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', State.settings.theme);
      saveState('settings');
    });

    // Master Sheet Status click: triggers live direct sync from Google Sheet
    document.getElementById('masterSheetStatusBtn')?.addEventListener('click', () => {
      syncSheetDirect(true);
    });
    document.getElementById('bannerSettingsBtn')?.addEventListener('click', () => {
      switchTab('tab-settings');
    });

    // Global Keyboard Navigation (1-6 for Tabs)
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) return;
      if (State.isConfirmModalOpen) return;

      const tabMap = {
        '1': 'tab-home',
        '2': 'tab-dispatch',
        '3': 'tab-settlement',
        '4': 'tab-leftout',
        '5': 'tab-ledger',
        '6': 'tab-settings'
      };

      if (tabMap[e.key]) {
        e.preventDefault();
        switchTab(tabMap[e.key]);
      }
    });

    // Dedicated Fast Manual Invoice Entry (OUT)
    document.getElementById('dispatchAddInvoiceBtn')?.addEventListener('click', handleManualInvoiceDispatch);
    document.getElementById('dispatchInvoiceInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleManualInvoiceDispatch();
      }
    });

    document.getElementById('clearBasketBtn')?.addEventListener('click', () => {
      if (State.dispatchBasket.length > 0 && confirm('Clear all scanned bills from basket?')) {
        State.dispatchBasket = [];
        renderDispatchBasket();
      }
    });

    document.getElementById('confirmDispatchBtn')?.addEventListener('click', confirmDispatchHandover);
    document.getElementById('printHandoverSlipBtn')?.addEventListener('click', () => window.print());
    document.getElementById('whatsappHandoverBtn')?.addEventListener('click', () => {
      if (State.dispatchBasket.length === 0) return;
      const total = State.dispatchBasket.reduce((s, b) => s + (Number(b.amount) || 0), 0);
      const agent = State.activeAgent ? State.activeAgent.name : (State.dispatchBasket[0]?.agent || 'Sales Agent');
      const beatInfo = State.activeBeat ? `\n*Beat/Week:* ${State.activeBeat}` : '';
      const msg = 
`*📦 BILL HANDOVER SLIP (OUT)*
*Agent:* ${agent}${beatInfo}
*Date:* ${document.getElementById('dispatchDate').value || getTodayDateString()}
*Total Bills:* ${State.dispatchBasket.length} (${formatINR(total)})
-------------------------
${State.dispatchBasket.map((b, i) => `${i + 1}. *${b.billNo}* [${b.agent}]${b.beat ? ` (${b.beat})` : ''} - ${b.party} (${formatINR(b.amount)})`).join('\n')}
-------------------------
_BillAudit Pro_`;
      window.open(`https://wa.me/?text=${encodeURI(msg)}`, '_blank');
    });

    // ================== TAB 2: SCAN IN ==================
    document.getElementById('settlementAgentSelect')?.addEventListener('change', loadSettlementForSelectedAgent);

    const modePay = document.getElementById('modePayBtn');
    const modeRet = document.getElementById('modeReturnBtn');
    modePay?.addEventListener('click', () => {
      State.settlementScanMode = 'PAY';
      modePay.classList.add('active');
      modeRet.classList.remove('active');
    });
    modeRet?.addEventListener('click', () => {
      State.settlementScanMode = 'RETURN';
      modeRet.classList.add('active');
      modePay.classList.remove('active');
    });



    // Dedicated Fast Manual Invoice Entry (IN)
    document.getElementById('settlementManualSubmitBtn')?.addEventListener('click', handleManualInvoiceSettlement);
    document.getElementById('settlementInvoiceInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleManualInvoiceSettlement();
      }
    });

    document.querySelectorAll('.filter-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderSettlementList(State.settlementBills, chip.dataset.filter);
      });
    });

    document.getElementById('finalizeSettlementBtn')?.addEventListener('click', finalizeDailySettlement);
    document.getElementById('shareSettlementWhatsappBtn')?.addEventListener('click', () => {
      if (State.activeSettlementAgent) sendLeftOutWhatsApp(State.activeSettlementAgent);
    });
    document.getElementById('quickWhatsappLeftOutBtn')?.addEventListener('click', () => {
      if (State.activeSettlementAgent) sendLeftOutWhatsApp(State.activeSettlementAgent);
    });

    // ================== TAB 3: LEFT OUT ==================
    document.getElementById('leftOutAgentFilter')?.addEventListener('change', renderLeftOutTab);
    document.getElementById('leftOutBeatFilter')?.addEventListener('change', renderLeftOutTab);
    document.getElementById('whatsappAllLeftOutBtn')?.addEventListener('click', sendAllLeftOutWhatsApp);

    // Difference date filter chips (Today, Yesterday, All Time)
    document.querySelectorAll('.diff-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.diff-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        State.diffDateFilter = chip.dataset.diffDate || 'TODAY';
        renderLeftOutTab();
      });
    });

    // Toggle Missed Bills list visibility
    document.getElementById('toggleMissedBillsBtn')?.addEventListener('click', () => {
      const list = document.getElementById('missedBillsList');
      const btn = document.getElementById('toggleMissedBillsBtn');
      if (!list || !btn) return;
      const isHidden = list.style.display === 'none';
      list.style.display = isHidden ? 'flex' : 'none';
      btn.textContent = isHidden ? 'Hide List' : 'Show List';
    });

    // ================== TAB 4: LEDGER ==================
    document.getElementById('ledgerSearchInput')?.addEventListener('input', renderMasterLedger);
    document.getElementById('ledgerAgentFilter')?.addEventListener('change', renderMasterLedger);
    document.getElementById('ledgerBeatFilter')?.addEventListener('change', renderMasterLedger);
    document.getElementById('ledgerStatusFilter')?.addEventListener('change', renderMasterLedger);
    document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);

    // ================== TAB 5: SHEET & SETUP ==================
    // Source Panel Selector Tabs
    const btnPaste = document.getElementById('btnSourcePaste');
    const btnScript = document.getElementById('btnSourceScript');
    const btnCsvUrl = document.getElementById('btnSourceCsvUrl');
    const panelPaste = document.getElementById('panelSourcePaste');
    const panelScript = document.getElementById('panelSourceScript');
    const panelCsvUrl = document.getElementById('panelSourceCsvUrl');

    btnPaste?.addEventListener('click', () => {
      btnPaste.classList.add('active');
      btnScript.classList.remove('active');
      btnCsvUrl.classList.remove('active');
      if (panelPaste) panelPaste.style.display = 'block';
      if (panelScript) panelScript.style.display = 'none';
      if (panelCsvUrl) panelCsvUrl.style.display = 'none';
    });

    btnScript?.addEventListener('click', () => {
      btnScript.classList.add('active');
      btnPaste.classList.remove('active');
      btnCsvUrl.classList.remove('active');
      if (panelPaste) panelPaste.style.display = 'none';
      if (panelScript) panelScript.style.display = 'block';
      if (panelCsvUrl) panelCsvUrl.style.display = 'none';
    });

    btnCsvUrl?.addEventListener('click', () => {
      btnCsvUrl.classList.add('active');
      btnPaste.classList.remove('active');
      btnScript.classList.remove('active');
      if (panelPaste) panelPaste.style.display = 'none';
      if (panelScript) panelScript.style.display = 'none';
      if (panelCsvUrl) panelCsvUrl.style.display = 'block';
    });

    document.getElementById('importPastedSheetBtn')?.addEventListener('click', importPastedSheetData);
    document.getElementById('loadSampleMasterSheetBtn')?.addEventListener('click', loadSampleMasterSheet);
    document.getElementById('clearMasterSheetBtn')?.addEventListener('click', () => {
      if (confirm('Clear loaded Master Sheet data?')) {
        State.masterSheetBills = [];
        saveState('master');
        updateMasterSheetUI();
        showToast('Master Sheet data cleared', 'info');
      }
    });

    document.getElementById('fetchSheetCsvBtn')?.addEventListener('click', fetchFromSheetCsvUrl);

    // Column Mapping Inputs
    const mapInvoice = document.getElementById('mapColInvoice');
    const mapAgent = document.getElementById('mapColAgent');
    const mapParty = document.getElementById('mapColParty');
    const mapAmount = document.getElementById('mapColAmount');
    const mapReceipt = document.getElementById('mapColReceipt');
    const mapOutstanding = document.getElementById('mapColOutstanding');

    if (mapInvoice) mapInvoice.value = State.sheetMappings.invoice;
    if (mapAgent) mapAgent.value = State.sheetMappings.agent;
    if (mapParty) mapParty.value = State.sheetMappings.party;
    if (mapAmount) mapAmount.value = State.sheetMappings.amount;
    if (mapReceipt) mapReceipt.value = State.sheetMappings.receipt;
    if (mapOutstanding) mapOutstanding.value = State.sheetMappings.outstanding || DEFAULT_MAPPINGS.outstanding;

    function saveMappingsFromInputs() {
      State.sheetMappings.invoice = mapInvoice?.value || DEFAULT_MAPPINGS.invoice;
      State.sheetMappings.agent = mapAgent?.value || DEFAULT_MAPPINGS.agent;
      State.sheetMappings.party = mapParty?.value || DEFAULT_MAPPINGS.party;
      State.sheetMappings.amount = mapAmount?.value || DEFAULT_MAPPINGS.amount;
      State.sheetMappings.receipt = mapReceipt?.value || DEFAULT_MAPPINGS.receipt;
      State.sheetMappings.outstanding = mapOutstanding?.value || DEFAULT_MAPPINGS.outstanding;
      saveState('mappings');
    }

    [mapInvoice, mapAgent, mapParty, mapAmount, mapReceipt, mapOutstanding].forEach(inp => {
      inp?.addEventListener('change', saveMappingsFromInputs);
    });

    // Google Apps Script controls
    document.getElementById('quickSyncBtn')?.addEventListener('click', processOfflineQueue);
    document.getElementById('saveScriptUrlBtn')?.addEventListener('click', () => {
      const url = (document.getElementById('googleScriptUrl').value || '').trim();
      State.settings.mainSheetScriptUrl = url;
      State.settings.scriptUrl = url;
      saveState('settings');
      showToast('Main Sheet Apps Script URL saved', 'success');
    });
    document.getElementById('testSheetConnectionBtn')?.addEventListener('click', testSheetConnection);
    document.getElementById('pullRecentSheetBtn')?.addEventListener('click', pullRecentBillsFromSheet);
    document.getElementById('pullFromSheetBtn')?.addEventListener('click', pullFromSheet);

    document.getElementById('saveTrackingScriptUrlBtn')?.addEventListener('click', () => {
      const url = (document.getElementById('trackingSheetScriptUrl')?.value || '').trim();
      State.settings.trackingSheetScriptUrl = url;
      saveState('settings');
      updateTrackingSheetUI();
      showToast('Tracking Sheet Apps Script URL saved', 'success');
    });
    document.getElementById('testTrackingSheetBtn')?.addEventListener('click', testTrackingSheetConnection);
    document.getElementById('forceSyncSheetBtn')?.addEventListener('click', processOfflineQueue);

    document.getElementById('loadSampleBillsBtn')?.addEventListener('click', loadSampleBills);
    document.getElementById('generateQrCodesBtn')?.addEventListener('click', previewPrintableQRCodes);
    document.getElementById('clearAllDataBtn')?.addEventListener('click', () => {
      if (confirm('Reset all bills, master sheet, and local records?')) {
        State.bills = [];
        State.masterSheetBills = [];
        State.offlineQueue = [];
        State.dispatchBasket = [];
        saveState();
        updateGlobalStats();
        updateMasterSheetUI();
        renderDispatchBasket();
        renderLeftOutTab();
        renderMasterLedger();
        showToast('All local data reset', 'info');
      }
    });

    // Instant Bill Details Confirmation & Move Ahead Modal Listeners
    document.getElementById('bdConfirmMoveAheadBtn')?.addEventListener('click', confirmPendingScannedBill);
    document.getElementById('bdCancelBtn')?.addEventListener('click', closeBillConfirmModal);
    document.getElementById('closeBdModalBtn')?.addEventListener('click', closeBillConfirmModal);
    document.getElementById('bdAdvancedBtn')?.addEventListener('click', () => {
      const parsed = State.pendingScannedBill;
      closeBillConfirmModal();
      if (!parsed) return;
      let bill = State.bills.find(b => b.billNo === parsed.billNo);
      if (!bill) {
        bill = {
          billNo: parsed.billNo,
          party: parsed.party || 'Standard Account',
          amount: parsed.amount || 0,
          agent: parsed.agent || State.activeSettlementAgent || 'Sales Agent',
          dispatchDate: getTodayDateString(),
          status: 'WITH_AGENT',
          collectedAmt: 0,
          paymentMode: '',
          refNo: parsed.receipt || '',
          returnReason: '',
          remarks: 'Scanned at Check-IN',
          lastActionDate: new Date().toISOString(),
          history: []
        };
        State.bills.unshift(bill);
      }
      if (State.settlementScanMode === 'RETURN') {
        openReturnModal(bill);
      } else {
        openPaymentModal(bill);
      }
    });

    // Keyboard Shortcuts: Enter to Move Ahead, Escape to Cancel
    window.addEventListener('keydown', (e) => {
      if (State.isConfirmModalOpen) {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmPendingScannedBill();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeBillConfirmModal();
        }
      }
    });

    // Quick Payment modal buttons
    document.querySelectorAll('.btn-mode-quick').forEach(btn => {
      btn.addEventListener('click', () => setQuickPaymentMode(btn.dataset.mode));
    });

    document.getElementById('closePaymentModalBtn')?.addEventListener('click', closePaymentModal);
    document.getElementById('cancelPaymentModalBtn')?.addEventListener('click', closePaymentModal);
    document.getElementById('paymentRecordForm')?.addEventListener('submit', savePaymentRecord);

    document.getElementById('closeReturnModalBtn')?.addEventListener('click', closeReturnModal);
    document.getElementById('cancelReturnModalBtn')?.addEventListener('click', closeReturnModal);
    document.getElementById('returnRecordForm')?.addEventListener('submit', saveReturnRecord);



    document.getElementById('closeQrPreviewModalBtn')?.addEventListener('click', () => document.getElementById('qrPreviewModal').style.display = 'none');
    document.getElementById('closeQrPreviewBottomBtn')?.addEventListener('click', () => document.getElementById('qrPreviewModal').style.display = 'none');
    document.getElementById('printTestQrBtn')?.addEventListener('click', () => window.print());

    // Audit & Payment Reconciliation Modal Controls
    document.getElementById('btnOpenReconcileModal')?.addEventListener('click', openPaymentReconciliationModal);
    document.getElementById('btnSettlementReconcile')?.addEventListener('click', openPaymentReconciliationModal);
    document.getElementById('closeReconcileModalBtn')?.addEventListener('click', closePaymentReconciliationModal);
    document.getElementById('btnCloseReconcileModal')?.addEventListener('click', closePaymentReconciliationModal);
    document.getElementById('btnRefreshReconcile')?.addEventListener('click', () => {
      syncBillsFromTrackingSheet(true).then(() => analyzeAndRenderPaymentReconciliation());
    });
    document.getElementById('btnApplyAllReconcile')?.addEventListener('click', completeAuditForAllPaidBills);

    document.querySelectorAll('#reconcileFilterTabs [data-rec-filter]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#reconcileFilterTabs [data-rec-filter]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        reconciliationData.activeFilter = tab.dataset.recFilter;
        renderReconcileTable();
      });
    });

    document.getElementById('reconcileAgentSelect')?.addEventListener('change', (e) => {
      reconciliationData.activeAgent = e.target.value;
      renderReconcileTable();
    });
  }

  // Application Startup
  document.addEventListener('DOMContentLoaded', () => {
    loadLocalState();

    const today = getTodayDateString();
    const dDate = document.getElementById('dispatchDate');
    const sDate = document.getElementById('settlementDate');
    if (dDate) dDate.value = today;
    if (sDate) sDate.value = today;

    document.documentElement.setAttribute('data-theme', State.settings.theme);

    renderAgentSelects();
    updateGlobalStats();
    updateOfflineQueueBadge();
    updateMasterSheetUI();
    renderLeftOutTab();

    const scriptInput = document.getElementById('googleScriptUrl');
    if (scriptInput) scriptInput.value = State.settings.mainSheetScriptUrl || State.settings.scriptUrl || '';

    const trackingInput = document.getElementById('trackingSheetScriptUrl');
    if (trackingInput) trackingInput.value = State.settings.trackingSheetScriptUrl || '';

    updateTrackingSheetUI();

    const csvUrlInput = document.getElementById('googleSheetCsvUrl');
    if (csvUrlInput) csvUrlInput.value = State.settings.sheetCsvUrl || '';

    setupEventListeners();

    // Initialize Hardware USB & Bluetooth Barcode / QR Scanner Listener
    HardwareScanner.init();

    // Update home tab stats on load
    updateHomeStats();

    initSystemClock();
    ConfettiFX.init();
    focusActiveScannerInput();

    // Auto-sync Google Sheet & Tracking Sheet directly in background on website load / refresh
    setTimeout(() => {
      syncSheetDirect(false).catch(err => {
        console.warn('Background auto-sync warning:', err);
      });
      syncBillsFromTrackingSheet(false).catch(err => {
        console.warn('Background tracking custody sync warning:', err);
      });
    }, 300);
  });

})();
