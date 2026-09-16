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
    { id: 'AG-101', name: 'Rahul Sharma', phone: '9876543210' },
    { id: 'AG-102', name: 'Vikram Singh', phone: '9812345678' },
    { id: 'AG-103', name: 'Amit Patel', phone: '9765432109' }
  ];

  const DEFAULT_SETTINGS = {
    scriptUrl: 'https://script.google.com/macros/s/AKfycbyOJJkVMJw5IEDyG14mrwrjeex3hsuiUnuB-vVT_wMQqhHMsZlgyKIr-dItwiYzHMz4/exec',
    mainSheetScriptUrl: 'https://script.google.com/macros/s/AKfycbyOJJkVMJw5IEDyG14mrwrjeex3hsuiUnuB-vVT_wMQqhHMsZlgyKIr-dItwiYzHMz4/exec',
    trackingSheetScriptUrl: 'https://script.google.com/macros/s/AKfycbxZ9jDxeFTNXH5hdvN_PsuWH76iOJkZ4JZFKEgIAVFzjonrpJyRt783HZLucXdhlZcr/exec',
    sheetCsvUrl: 'https://docs.google.com/spreadsheets/d/11J3WSXNFfu5aARNMBX3HQazajsfzBjj7wX9MWyVVBRk/export?format=csv&gid=1608276684',
    theme: 'light',
    audioSound: true,
    preferredCamera: 'environment'
  };

  const DEFAULT_MAPPINGS = {
    invoice: 'Invoice Number,inv bill no,D,Invoice,Bill,BillNo,InvNo',
    agent: 'Agent,Salesman,DeliveryAgent,AgentName,Name,Sales Agent',
    party: 'Customer,Party,Shop,Store,PartyName,Customer Name',
    amount: 'Amount,Total,Net,BillAmount,Net Total',
    receipt: 'RECEIPT,REMARKS,receipt col,receipt no,Receipt,Payment,Paid',
    outstanding: 'OUTSTANDING,outstanding,payment remaining,remaining,balance,pending,due'
  };

  const State = {
    bills: [],
    agents: [],
    masterSheetBills: [],
    sheetMappings: { ...DEFAULT_MAPPINGS },
    settings: { ...DEFAULT_SETTINGS },
    offlineQueue: [],
    auditLogs: [],
    dispatchBasket: [],
    activeSettlementAgent: null,
    settlementBills: [],
    scannerDispatch: null,
    scannerSettlement: null,
    availableCameras: [],
    selectedCameraId: 'environment',
    lastScannedCode: null,
    lastScanTimestamp: 0,
    currentPaymentBill: null,
    currentReturnBill: null,
    settlementScanMode: 'PAY', // 'PAY' or 'RETURN'
    isConfirmModalOpen: false,
    pendingScannedBill: null,
    pendingScanSource: null // 'DISPATCH' or 'SETTLEMENT'
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

  function loadLocalState() {
    try {
      const storedBills = localStorage.getItem(STORAGE_KEYS.BILLS);
      State.bills = storedBills ? JSON.parse(storedBills) : [];

      const storedAgents = localStorage.getItem(STORAGE_KEYS.AGENTS);
      State.agents = storedAgents ? JSON.parse(storedAgents) : [...DEFAULT_AGENTS];

      const storedMaster = localStorage.getItem(STORAGE_KEYS.MASTER_SHEET);
      if (storedMaster) {
        try {
          const parsedM = JSON.parse(storedMaster);
          if (Array.isArray(parsedM) && parsedM.length > 0) {
            if (Array.isArray(parsedM[0])) {
              // Compact format: [billNo, receipt, outstanding, party, amount, agent]
              State.masterSheetBills = parsedM.map(r => ({
                billNo: String(r[0] || '').trim(),
                receipt: String(r[1] || '').trim(),
                outstanding: Number(r[2]) || 0,
                party: String(r[3] || 'Customer').trim(),
                amount: Number(r[4]) || 0,
                agent: String(r[5] || '').trim(),
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

      const storedMappings = localStorage.getItem(STORAGE_KEYS.SHEET_MAPPINGS);
      if (storedMappings) {
        State.sheetMappings = { ...DEFAULT_MAPPINGS, ...JSON.parse(storedMappings) };
      }

      const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (storedSettings) {
        State.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) };
      }
      if (!State.settings.mainSheetScriptUrl) {
        State.settings.mainSheetScriptUrl = DEFAULT_SETTINGS.mainSheetScriptUrl;
      }
      if (!State.settings.trackingSheetScriptUrl) {
        State.settings.trackingSheetScriptUrl = DEFAULT_SETTINGS.trackingSheetScriptUrl;
      }
      if (!State.settings.scriptUrl) {
        State.settings.scriptUrl = DEFAULT_SETTINGS.scriptUrl;
      }
      State.selectedCameraId = State.settings.preferredCamera || 'environment';

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
        const compact = State.masterSheetBills.map(b => [
          b.billNo,
          b.receipt || '',
          b.outstanding !== undefined ? b.outstanding : 0,
          b.party || '',
          b.amount || 0,
          b.agent || ''
        ]);
        localStorage.setItem(STORAGE_KEYS.MASTER_SHEET, JSON.stringify(compact));
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

  /**
   * Search Master Sheet for an Invoice Number
   * Matches exact, normalized, or numeric suffix (e.g. 3921 inside IN-FY26/27-3921)
   */
  function findMasterBill(invoiceInput) {
    if (!invoiceInput || !State.masterSheetBills.length) return null;
    const cleanInput = String(invoiceInput).trim();
    if (!cleanInput) return null;

    const normInput = normalizeInvoiceNumber(cleanInput);

    // 1. Exact string match
    let found = State.masterSheetBills.find(b => b.billNo.trim().toUpperCase() === cleanInput.toUpperCase());
    if (found) return found;

    // 2. Normalized alphanumeric match
    found = State.masterSheetBills.find(b => normalizeInvoiceNumber(b.billNo) === normInput);
    if (found) return found;

    // 3. Suffix / Number Match: If input is just the digits (e.g. "3921")
    const digitsOnly = cleanInput.replace(/\D/g, '');
    if (digitsOnly.length >= 3) {
      found = State.masterSheetBills.find(b => {
        const bDigits = b.billNo.replace(/\D/g, '');
        return bDigits.endsWith(digitsOnly) || bDigits === digitsOnly;
      });
      if (found) return found;
    }

    // 4. Substring contains match
    found = State.masterSheetBills.find(b => 
      b.billNo.toUpperCase().includes(cleanInput.toUpperCase()) ||
      cleanInput.toUpperCase().includes(b.billNo.toUpperCase())
    );

    return found || null;
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
    const idxParty = findColIndex(State.sheetMappings.party);
    const idxAmount = findColIndex(State.sheetMappings.amount);
    const idxReceipt = findColIndex(State.sheetMappings.receipt);
    const idxOutstanding = findColIndex(State.sheetMappings.outstanding || 'OUTSTANDING,outstanding,payment remaining,remaining,balance,pending,due');
    const idxRemarks = findColIndex('remarks,note,notes');

    const parsedBills = [];
    const detectedAgents = new Set();

    for (let i = 1; i < lines.length; i++) {
      const cols = splitRow(lines[i]);
      if (!cols || cols.length === 0) continue;

      // Fallbacks if columns not identified by header names
      const billNo = (idxInvoice !== -1 ? cols[idxInvoice] : cols[3]) || cols[0] || '';
      if (!billNo) continue;

      const agent = (idxAgent !== -1 ? cols[idxAgent] : (cols[15] || '')) || '';
      const party = (idxParty !== -1 ? cols[idxParty] : (cols[4] || '')) || 'General Party';
      const rawAmt = (idxAmount !== -1 ? cols[idxAmount] : (cols[5] || '0')) || '0';
      const cleanAmt = parseFloat(String(rawAmt).replace(/[₹,\s]/g, '')) || 0;
      
      let receipt = (idxReceipt !== -1 ? cols[idxReceipt] : '') || '';
      if (!receipt && idxRemarks !== -1 && cols[idxRemarks]) {
        receipt = cols[idxRemarks].trim();
      } else if (receipt && idxRemarks !== -1 && cols[idxRemarks] && cols[idxRemarks].trim() !== receipt) {
        receipt = receipt + ' / ' + cols[idxRemarks].trim();
      }

      const rawOutstanding = (idxOutstanding !== -1 ? cols[idxOutstanding] : (cols[11] || '')) || '';
      const cleanOutstanding = rawOutstanding ? (parseFloat(String(rawOutstanding).replace(/[₹,\s]/g, '')) || 0) : 0;

      if (agent) detectedAgents.add(agent.trim());

      parsedBills.push({
        billNo: String(billNo).trim(),
        agent: String(agent).trim(),
        party: String(party).trim(),
        amount: cleanAmt,
        receipt: String(receipt).trim(),
        outstanding: cleanOutstanding,
        remainingText: rawOutstanding ? String(rawOutstanding).trim() : ''
      });
    }

    // Auto add newly discovered agents to State.agents
    detectedAgents.forEach(agentName => {
      if (!State.agents.some(a => a.name.toLowerCase() === agentName.toLowerCase())) {
        State.agents.push({
          id: 'AG-' + (100 + State.agents.length + 1),
          name: agentName,
          phone: ''
        });
      }
    });

    return parsedBills;
  }

  function updateMasterSheetUI() {
    const banner = document.getElementById('masterSheetBanner');
    const bannerCount = document.getElementById('bannerSheetCount');
    const pill = document.getElementById('masterSheetStatusBtn');
    const pillText = document.getElementById('sheetStatusText');
    const pillBadge = document.getElementById('sheetCountBadge');
    const summaryText = document.getElementById('sheetSummaryText');
    const clearBtn = document.getElementById('clearMasterSheetBtn');

    const count = State.masterSheetBills.length;

    if (count > 0) {
      if (banner) {
        banner.style.display = 'flex';
        if (bannerCount) bannerCount.textContent = count;
      }
      if (pillText) pillText.textContent = `Sheet: ${count} Bills`;
      if (pillBadge) {
        pillBadge.style.display = 'inline-block';
        pillBadge.textContent = count;
      }
      if (summaryText) {
        const uniqueAgents = [...new Set(State.masterSheetBills.map(b => b.agent).filter(Boolean))];
        summaryText.innerHTML = `<strong>Active Master Sheet:</strong> ${count} bills loaded across ${uniqueAgents.length} agents (${uniqueAgents.slice(0, 4).join(', ')}${uniqueAgents.length > 4 ? '...' : ''}).`;
      }
      if (clearBtn) clearBtn.style.display = 'inline-block';
    } else {
      if (banner) banner.style.display = 'none';
      if (pillText) pillText.textContent = 'Sheet: Unlinked';
      if (pillBadge) pillBadge.style.display = 'none';
      if (summaryText) summaryText.textContent = 'No Master Sheet data loaded yet. Paste or connect your sheet above.';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }


  // ========================================================
  // 3. ROBUST QR CODE & BARCODE PARSER
  // ========================================================

  function parseQRCodeData(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const text = rawText.trim();
    if (!text) return null;

    // 1. Check if the scanned string directly matches a bill in Master Sheet
    const masterMatch = findMasterBill(text);
    if (masterMatch) {
      return {
        billNo: masterMatch.billNo,
        party: masterMatch.party,
        amount: masterMatch.amount,
        agent: masterMatch.agent,
        receipt: masterMatch.receipt,
        outstanding: masterMatch.outstanding !== undefined ? masterMatch.outstanding : 0,
        remainingText: masterMatch.remainingText || '',
        fromMaster: true,
        raw: text
      };
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
          return {
            billNo: String(billNo).trim(),
            party: mm ? mm.party : party,
            amount: mm ? mm.amount : amount,
            agent: mm ? mm.agent : '',
            receipt: mm ? mm.receipt : '',
            fromMaster: !!mm,
            raw: text,
            isEInvoice: true
          };
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
            return {
              billNo: String(billNo).trim(),
              party: mm ? mm.party : party,
              amount: mm ? mm.amount : amount,
              agent: mm ? mm.agent : '',
              receipt: mm ? mm.receipt : '',
              fromMaster: !!mm,
              raw: text
            };
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
        return {
          billNo: String(billNo).trim(),
          party: mm ? mm.party : party,
          amount: mm ? mm.amount : amount,
          agent: mm ? mm.agent : '',
          receipt: mm ? mm.receipt : '',
          fromMaster: !!mm,
          raw: text
        };
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
        return {
          billNo: String(billNo).trim(),
          party: mm ? mm.party : (party || 'Standard Account'),
          amount: mm ? mm.amount : amount,
          agent: mm ? mm.agent : '',
          receipt: mm ? mm.receipt : '',
          fromMaster: !!mm,
          raw: text
        };
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
        return {
          billNo,
          party: mm ? mm.party : party,
          amount: mm ? mm.amount : amount,
          agent: mm ? mm.agent : '',
          receipt: mm ? mm.receipt : '',
          fromMaster: !!mm,
          raw: text
        };
      }
    }

    const csvParts = parseCSVLine(text);

    if (csvParts.length === 3) {
      const billNo = csvParts[0];
      const party = csvParts[1];
      const amountStr = csvParts[2];
      const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
      const mm = findMasterBill(billNo);
      return {
        billNo,
        party: mm ? mm.party : party,
        amount: mm ? mm.amount : amount,
        agent: mm ? mm.agent : '',
        receipt: mm ? mm.receipt : '',
        fromMaster: !!mm,
        raw: text
      };
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
      return {
        billNo,
        party: mm ? mm.party : party,
        amount: mm ? mm.amount : amount,
        agent: mm ? mm.agent : '',
        receipt: mm ? mm.receipt : '',
        fromMaster: !!mm,
        raw: text
      };
    } else if (csvParts.length === 2) {
      const billNo = csvParts[0];
      const amount = parseFloat(csvParts[1].replace(/,/g, '')) || 0;
      const mm = findMasterBill(billNo);
      return {
        billNo,
        party: mm ? mm.party : 'Standard Account',
        amount: mm ? mm.amount : amount,
        agent: mm ? mm.agent : '',
        receipt: mm ? mm.receipt : '',
        fromMaster: !!mm,
        raw: text
      };
    }

    // 7. Single token (e.g. only invoice number scanned or typed)
    const mm = findMasterBill(text);
    return {
      billNo: text,
      party: mm ? mm.party : 'Standard Account',
      amount: mm ? mm.amount : 0,
      agent: mm ? mm.agent : '',
      receipt: mm ? mm.receipt : '',
      fromMaster: !!mm,
      raw: text
    };
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
      if (!parsed.receipt) parsed.receipt = mm.receipt;
      parsed.outstanding = mm.outstanding !== undefined ? mm.outstanding : 0;
      parsed.remainingText = mm.remainingText || '';
      parsed.fromMaster = true;
    }
    return parsed;
  }


  // ========================================================
  // 4. CAMERA CONTROLLERS (IOS SAFARI OPTIMIZED HIGH-SPEED)
  // ========================================================

  function checkHttpsSecurity() {
    const banner = document.getElementById('httpsWarningBanner');
    if (!banner) return;
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const isSecure = window.isSecureContext || location.protocol === 'https:' || isLocal;
    banner.style.display = isSecure ? 'none' : 'flex';
  }

  function createScannerInstance(elementId) {
    let supportedFormats = undefined;
    if (typeof Html5QrcodeSupportedFormats !== 'undefined') {
      supportedFormats = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.DATA_MATRIX
      ];
    }
    return new Html5Qrcode(elementId, {
      formatsToSupport: supportedFormats,
      verbose: false,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: false
      }
    });
  }

  function ensureVideoInline(container) {
    setTimeout(() => {
      const video = container ? container.querySelector('video') : null;
      if (video) {
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.muted = true;
        video.setAttribute('muted', 'true');
        if (video.paused) video.play().catch(() => {});
      }
    }, 250);
  }

  async function initCameraSelectors() {
    const select = document.getElementById('cameraSourceSelect');
    if (!select) return;

    try {
      const cameras = await Html5Qrcode.getCameras();
      State.availableCameras = cameras || [];

      // Sort cameras on iPhone: put 1x Main Back camera first, demote Ultra Wide (0.5x)
      State.availableCameras.sort((a, b) => {
        const aL = (a.label || '').toLowerCase();
        const bL = (b.label || '').toLowerCase();
        if (aL.includes('ultra wide') || aL.includes('0.5x')) return 1;
        if (bL.includes('ultra wide') || bL.includes('0.5x')) return -1;
        if (aL.includes('back') || aL.includes('rear') || aL.includes('environment')) return -1;
        if (bL.includes('back') || bL.includes('rear') || bL.includes('environment')) return 1;
        return 0;
      });

      select.innerHTML = '';

      const optBack = document.createElement('option');
      optBack.value = 'environment';
      optBack.textContent = '📷 Primary Back Camera (1x Auto)';
      select.appendChild(optBack);

      const optFront = document.createElement('option');
      optFront.value = 'user';
      optFront.textContent = '🤳 Front Camera';
      select.appendChild(optFront);

      if (State.availableCameras.length > 0) {
        State.availableCameras.forEach((cam, idx) => {
          const opt = document.createElement('option');
          opt.value = cam.id;
          let label = cam.label || `Camera ${idx + 1}`;
          if (label.toLowerCase().includes('ultra wide')) {
            label = `${label} (0.5x - Hard to focus)`;
          } else if (label.toLowerCase().includes('back') || label.toLowerCase().includes('rear')) {
            label = `${label} (1x Sharp Focus)`;
          }
          opt.textContent = `📹 ${label}`;
          select.appendChild(opt);
        });

        // Set default camera to first sharp back camera if available
        const sharpBack = State.availableCameras.find(c => {
          const l = (c.label || '').toLowerCase();
          return !l.includes('ultra wide') && !l.includes('front') && !l.includes('user');
        });
        if (sharpBack && !State.settings.preferredCamera) {
          State.selectedCameraId = sharpBack.id;
          select.value = sharpBack.id;
        }
      }

      if (State.selectedCameraId && select) {
        select.value = State.selectedCameraId;
      }
    } catch (e) {
      console.warn('Camera enumeration error (Safari permissions needed):', e);
    }
  }

  async function switchSelectedCamera(newCameraId) {
    State.selectedCameraId = newCameraId;
    State.settings.preferredCamera = newCameraId;
    saveState('settings');

    const select = document.getElementById('cameraSourceSelect');
    if (select) select.value = newCameraId;

    if (State.scannerDispatch) {
      await stopDispatchScanner();
      await startDispatchScanner();
    }
    if (State.scannerSettlement) {
      await stopSettlementScanner();
      await startSettlementScanner();
    }
    showToast('Camera switched', 'info', 1200);
  }

  function cycleBackLens() {
    if (!State.availableCameras || State.availableCameras.length <= 1) {
      flipCamera();
      return;
    }

    const backCams = State.availableCameras.filter(c => {
      const l = (c.label || '').toLowerCase();
      return !l.includes('front') && !l.includes('user');
    });

    if (backCams.length > 1) {
      const curIdx = backCams.findIndex(c => c.id === State.selectedCameraId);
      const nextIdx = (curIdx + 1) % backCams.length;
      switchSelectedCamera(backCams[nextIdx].id);
    } else {
      flipCamera();
    }
  }

  function flipCamera() {
    if (State.availableCameras.length > 1) {
      const currentVal = State.selectedCameraId;
      let currentIndex = State.availableCameras.findIndex(c => c.id === currentVal);
      let nextIndex = (currentIndex + 1) % State.availableCameras.length;
      switchSelectedCamera(State.availableCameras[nextIndex].id);
    } else {
      const nextMode = (State.selectedCameraId === 'environment') ? 'user' : 'environment';
      switchSelectedCamera(nextMode);
    }
  }

  function getCameraConfigForStart() {
    const camId = State.selectedCameraId || 'environment';
    if (camId === 'environment') {
      return { facingMode: 'environment' };
    }
    if (camId === 'user') {
      return { facingMode: 'user' };
    }
    return { deviceId: { exact: camId } };
  }

  function getScannerRunConfig() {
    return {
      fps: 20,
      disableFlip: false
    };
  }

  async function startDispatchScanner() {
    const container = document.getElementById('scannerContainer');
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');

    if (State.scannerDispatch) return;

    SoundFX.init();

    try {
      if (State.availableCameras.length === 0) {
        await initCameraSelectors();
      }

      container.style.display = 'block';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';

      State.scannerDispatch = createScannerInstance('qr-reader');
      const cameraConfig = getCameraConfigForStart();
      const runConfig = getScannerRunConfig();

      try {
        await State.scannerDispatch.start(
          cameraConfig,
          runConfig,
          (decodedText) => handleScannedCodeDispatch(decodedText),
          () => {}
        );
      } catch (errFirst) {
        console.warn('Initial camera start failed, retrying with flexible constraints:', errFirst);
        // Fallback for strict iOS Safari
        await State.scannerDispatch.start(
          { facingMode: 'environment' },
          { fps: 15 },
          (decodedText) => handleScannedCodeDispatch(decodedText),
          () => {}
        );
      }

      ensureVideoInline(container);
    } catch (err) {
      console.error('Dispatch scanner error:', err);
      showToast('Camera error: ' + (err.message || err), 'danger', 4500);
      stopDispatchScanner();
    }
  }

  async function stopDispatchScanner() {
    const container = document.getElementById('scannerContainer');
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');

    if (State.scannerDispatch) {
      try {
        await State.scannerDispatch.stop();
        State.scannerDispatch.clear();
      } catch (e) {}
      State.scannerDispatch = null;
    }

    if (container) container.style.display = 'none';
    if (startBtn) startBtn.style.display = 'block';
    if (stopBtn) stopBtn.style.display = 'none';
  }

  async function startSettlementScanner() {
    const container = document.getElementById('settlementScannerContainer');
    const startBtn = document.getElementById('startSettlementScanBtn');
    const stopBtn = document.getElementById('stopSettlementScanBtn');

    if (State.scannerSettlement) return;

    SoundFX.init();

    try {
      if (State.availableCameras.length === 0) {
        await initCameraSelectors();
      }

      container.style.display = 'block';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';

      State.scannerSettlement = createScannerInstance('qr-reader-settlement');
      const cameraConfig = getCameraConfigForStart();
      const runConfig = getScannerRunConfig();

      try {
        await State.scannerSettlement.start(
          cameraConfig,
          runConfig,
          (decodedText) => handleScannedCodeSettlement(decodedText),
          () => {}
        );
      } catch (errFirst) {
        console.warn('Settlement camera start retry:', errFirst);
        await State.scannerSettlement.start(
          { facingMode: 'environment' },
          { fps: 15 },
          (decodedText) => handleScannedCodeSettlement(decodedText),
          () => {}
        );
      }

      ensureVideoInline(container);
    } catch (err) {
      console.error('Settlement scanner error:', err);
      showToast('Camera error: ' + (err.message || err), 'danger', 4500);
      stopSettlementScanner();
    }
  }

  async function stopSettlementScanner() {
    const container = document.getElementById('settlementScannerContainer');
    const startBtn = document.getElementById('startSettlementScanBtn');
    const stopBtn = document.getElementById('stopSettlementScanBtn');

    if (State.scannerSettlement) {
      try {
        await State.scannerSettlement.stop();
        State.scannerSettlement.clear();
      } catch (e) {}
      State.scannerSettlement = null;
    }

    if (container) container.style.display = 'none';
    if (startBtn) startBtn.style.display = 'block';
    if (stopBtn) stopBtn.style.display = 'none';
  }

  /**
   * Fast Photo Scan Fallback for iPhone (100% Reliable via Native Camera)
   */
  async function handlePhotoScan(file, onDecoded) {
    if (!file) return;
    showToast('Analyzing bill photo...', 'info', 2000);

    const tempId = 'qr-reader';
    let tempScanner = null;
    try {
      tempScanner = createScannerInstance(tempId);
      const decodedText = await tempScanner.scanFile(file, false);
      if (decodedText) {
        onDecoded(decodedText);
      } else {
        throw new Error('No code found');
      }
    } catch (err) {
      console.warn('Photo scan error:', err);
      showToast('Could not read code. Make sure QR/barcode is clear and well-lit.', 'warning', 4000);
    } finally {
      if (tempScanner) {
        try { tempScanner.clear(); } catch(e) {}
      }
    }
  }


  // ========================================================
  // 5. TAB 1: SCAN OUT (AFTERNOON HANDOVER)
  // ========================================================

  function handleScannedCodeDispatch(decodedText) {
    if (State.isConfirmModalOpen) return;
    try {
      const now = Date.now();
      if (decodedText === State.lastScannedCode && now - State.lastScanTimestamp < 1500) {
        return;
      }
      State.lastScannedCode = decodedText;
      State.lastScanTimestamp = now;

      // Visual flash on viewfinder box
      const container = document.getElementById('scannerContainer');
      const scanBox = container ? container.querySelector('.scan-box') : null;
      if (scanBox) {
        scanBox.classList.add('scan-success-glow');
        setTimeout(() => scanBox.classList.remove('scan-success-glow'), 400);
      }

      let parsed = parseQRCodeData(decodedText);
      if (!parsed || !parsed.billNo) {
        SoundFX.playBeep('error');
        showToast('Unrecognized code: ' + (decodedText.slice(0, 30)), 'warning');
        return;
      }

      parsed = enrichWithMaster(parsed);
      SoundFX.playBeep('success');
      SoundFX.vibrate(50);
      showBillScannedConfirmation(parsed, 'DISPATCH');
    } catch (err) {
      console.error('Dispatch scan handler error:', err);
      showToast('Scan error: ' + (err.message || err), 'danger');
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
      SoundFX.playBeep('error');
      showToast('Please enter a valid invoice number', 'warning');
      return;
    }

    input.value = '';
    SoundFX.playBeep('success');
    showBillScannedConfirmation(parsed, 'DISPATCH');
  }

  function addBillToDispatchBasket(parsed) {
    const agentSelect = document.getElementById('dispatchAgentSelect');
    let assignedAgent = agentSelect ? agentSelect.value : '';

    // If AUTO mode or unassigned, try to take agent from Master Sheet match
    if (assignedAgent === 'AUTO' || !assignedAgent) {
      if (parsed.agent) {
        assignedAgent = parsed.agent;
      } else {
        const match = findMasterBill(parsed.billNo);
        if (match && match.agent) {
          assignedAgent = match.agent;
        }
      }
    }

    // If still empty and only 1 agent exists, default to that agent
    if ((assignedAgent === 'AUTO' || !assignedAgent) && State.agents.length > 0) {
      assignedAgent = State.agents[0].name;
    }

    // Check duplicate in current basket
    if (State.dispatchBasket.some(b => b.billNo === parsed.billNo)) {
      SoundFX.playBeep('warning');
      showToast(`Bill ${parsed.billNo} is already in the list`, 'warning');
      return;
    }

    // Check active custody
    const active = State.bills.find(b => b.billNo === parsed.billNo && b.status === 'WITH_AGENT');
    if (active) {
      SoundFX.playBeep('warning');
      showToast(`Bill ${parsed.billNo} is ALREADY out with ${active.agent}!`, 'warning');
      return;
    }

    State.dispatchBasket.unshift({
      billNo: parsed.billNo,
      party: parsed.party || 'Standard Account',
      amount: parsed.amount || 0,
      agent: assignedAgent,
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
          agent: b.agent || 'Sales Agent',
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

      record.history.push({ action: 'DISPATCHED', agent: record.agent, date, timestamp });
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
    showToast(`Confirmed ${count} bills handed OUT!`, 'success', 3000);
  }


  // ========================================================
  // 6. TAB 2: SCAN IN (RETURN & SETTLEMENT / NEXT DAY)
  // ========================================================

  function loadSettlementForSelectedAgent() {
    const agentSelect = document.getElementById('settlementAgentSelect');
    const agent = agentSelect ? agentSelect.value : '';
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
    let totalAmt = 0, paidAmt = 0, missingAmt = 0;
    let paidCount = 0, missingCount = 0;

    bills.forEach(b => {
      const amt = Number(b.amount) || 0;
      const colAmt = Number(b.collectedAmt) || 0;
      totalAmt += amt;

      if (b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND') {
        paidCount++;
        paidAmt += colAmt || (b.status === 'RETURNED_IN_HAND' ? amt : 0);
      } else if (b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT') {
        missingCount++;
        missingAmt += amt;
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
    if (paidCountEl) paidCountEl.textContent = `${paidCount} bills`;
    if (paidAmtEl) paidAmtEl.textContent = formatINR(paidAmt);
    if (missingCountEl) missingCountEl.textContent = `${missingCount} bills`;
    if (missingAmtEl) missingAmtEl.textContent = formatINR(missingAmt);

    const alertBanner = document.getElementById('missingBillAlertBanner');
    const alertCount = document.getElementById('alertMissingCount');
    const alertAmt = document.getElementById('alertMissingAmt');

    if (missingCount > 0 && bills.length > 0) {
      if (alertBanner) alertBanner.style.display = 'flex';
      if (alertCount) alertCount.textContent = missingCount;
      if (alertAmt) alertAmt.textContent = formatINR(missingAmt);
    } else {
      if (alertBanner) alertBanner.style.display = 'none';
    }
  }

  function renderSettlementList(bills, filter = 'ALL') {
    const list = document.getElementById('settlementListContainer');
    const countBadge = document.getElementById('agentBillsCount');
    if (!list) return;

    let filtered = bills;
    if (filter === 'MISSING') filtered = bills.filter(b => b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT');
    else if (filter === 'PAID') filtered = bills.filter(b => b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL');
    else if (filter === 'RETURNED') filtered = bills.filter(b => b.status === 'RETURNED_IN_HAND');

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
      const isMissing = bill.status === 'WITH_AGENT' || bill.status === 'MISSING_ALERT';
      const row = document.createElement('div');
      row.className = `bill-card-row ${isMissing ? 'is-missing' : ''}`;

      let statusText = '';
      if (bill.status === 'WITH_AGENT') statusText = '<span class="text-danger font-bold">⚠️ Left Out (Not Returned)</span>';
      else if (bill.status === 'PAID_FULL') statusText = `<span class="text-success font-bold">✓ Paid (${bill.paymentMode || 'Cash'})</span>`;
      else if (bill.status === 'PAID_PARTIAL') statusText = `<span class="text-success font-bold">✓ Partial (${formatINR(bill.collectedAmt)})</span>`;
      else if (bill.status === 'RETURNED_IN_HAND') statusText = '<span class="text-primary font-bold">↺ Returned Next Round</span>';
      else if (bill.status === 'MISSING_ALERT') statusText = '<span class="text-danger font-bold">⚠️ MISSING ALERT</span>';

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
            <button class="mini-action-btn pay" data-pay-bill="${bill.billNo}">Check IN / Pay</button>
            <button class="mini-action-btn ret" data-ret-bill="${bill.billNo}">Return</button>
          </div>
        </div>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('[data-pay-bill]').forEach(btn => {
      btn.addEventListener('click', () => {
        const b = State.bills.find(item => item.billNo === btn.dataset.payBill);
        if (b) openPaymentModal(b);
      });
    });

    list.querySelectorAll('[data-ret-bill]').forEach(btn => {
      btn.addEventListener('click', () => {
        const b = State.bills.find(item => item.billNo === btn.dataset.retBill);
        if (b) openReturnModal(b);
      });
    });
  }

  function handleScannedCodeSettlement(decodedText) {
    if (State.isConfirmModalOpen) return;
    try {
      const now = Date.now();
      if (decodedText === State.lastScannedCode && now - State.lastScanTimestamp < 1500) return;
      State.lastScannedCode = decodedText;
      State.lastScanTimestamp = now;

      // Visual flash on viewfinder box
      const container = document.getElementById('settlementScannerContainer');
      const scanBox = container ? container.querySelector('.scan-box') : null;
      if (scanBox) {
        scanBox.classList.add('scan-success-glow');
        setTimeout(() => scanBox.classList.remove('scan-success-glow'), 400);
      }

      processCheckInCode(decodedText);
    } catch (err) {
      console.error('Settlement scan handler error:', err);
      showToast('Scan error: ' + (err.message || err), 'danger');
    }
  }

  function handleManualInvoiceSettlement() {
    const input = document.getElementById('settlementInvoiceInput');
    const val = input.value.trim();
    if (!val) return;

    processCheckInCode(val);
    input.value = '';
    input.focus();
  }

  function processCheckInCode(rawInput) {
    let parsed = parseQRCodeData(rawInput);
    if (!parsed || !parsed.billNo) {
      parsed = { billNo: rawInput.trim(), party: 'Standard Account', amount: 0, raw: rawInput };
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

    SoundFX.playBeep('success');
    SoundFX.vibrate(50);
    showBillScannedConfirmation(parsed, 'SETTLEMENT');
  }


  // ========================================================
  // 6. INSTANT BILL DETAILS CONFIRMATION & MOVE AHEAD MODAL
  // ========================================================

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

    // Sales Agent
    let agentName = parsed.agent;
    if (!agentName) {
      if (source === 'DISPATCH') {
        const sel = document.getElementById('dispatchAgentSelect');
        agentName = (sel && sel.value !== 'AUTO') ? sel.value : 'Auto-Detect';
      } else {
        agentName = State.activeSettlementAgent || 'Auto-Detect';
      }
    }
    if (agentEl) agentEl.textContent = agentName || 'General Agent';

    // Badge styling
    if (modeBadge) {
      if (source === 'DISPATCH') {
        modeBadge.className = 'bd-badge badge-dispatch';
        modeBadge.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i> SCAN OUT';
      } else {
        modeBadge.className = 'bd-badge badge-settlement';
        modeBadge.innerHTML = '<i class="fa-solid fa-arrow-down-to-bracket"></i> SCAN IN';
      }
    }

    // Button label: "Next"
    if (confirmBtn) {
      confirmBtn.innerHTML = '<span>Next</span> <i class="fa-solid fa-arrow-right"></i>';
    }

    // Advanced adjustments option
    if (advancedBtn) {
      advancedBtn.style.display = (source === 'SETTLEMENT') ? 'inline-block' : 'none';
    }

    modal.style.display = 'flex';

    // If bill details were not pre-loaded in local cache, fetch directly from MARCH-SEPT tab
    if (!parsed.fromMaster && (State.settings.mainSheetScriptUrl || State.settings.scriptUrl)) {
      fetchSingleBillDetailsFromSheet(parsed.billNo, source);
    }
  }

  /**
   * Fast asynchronous fetch of single bill details from MARCH-SEPT tab
   */
  async function fetchSingleBillDetailsFromSheet(billNo, source) {
    const targetUrl = State.settings.mainSheetScriptUrl || State.settings.scriptUrl;
    if (!targetUrl || !billNo) return;

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
      const resp = await fetch(`${targetUrl}?action=FIND_BILL&billNo=${encodeURIComponent(billNo)}&t=${Date.now()}`);
      const data = await resp.json();

      if (data && data.found && data.bill) {
        const b = data.bill;

        // Update / Insert into master bills cache
        const idx = State.masterSheetBills.findIndex(x => normalizeInvoiceNumber(x.billNo) === normalizeInvoiceNumber(b.billNo));
        if (idx >= 0) {
          State.masterSheetBills[idx] = b;
        } else {
          State.masterSheetBills.push(b);
        }
        saveState('master');

        // Update modal in real time if currently open for this bill
        if (State.isConfirmModalOpen && State.pendingScannedBill &&
            (normalizeInvoiceNumber(State.pendingScannedBill.billNo) === normalizeInvoiceNumber(billNo) ||
             State.pendingScannedBill.billNo === b.billNo)) {
          
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
      }
    } catch (e) {
      console.warn('Fast bill lookup from sheet failed:', e);
      if (receiptEl && receiptEl.innerHTML.includes('Fetching')) {
        receiptEl.textContent = '-';
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
      // SETTLEMENT Check-IN
      let bill = State.bills.find(b => b.billNo === parsed.billNo) ||
                 State.bills.find(b => normalizeInvoiceNumber(b.billNo) === normalizeInvoiceNumber(parsed.billNo));

      const billAmt = parseFloat(parsed.amount) || 0;
      const outstanding = (parsed.outstanding !== undefined && parsed.outstanding !== null)
        ? parseFloat(parsed.outstanding)
        : 0;

      const collectedAmt = Math.max(0, billAmt - outstanding);

      if (!bill) {
        const targetAgent = parsed.agent || State.activeSettlementAgent || (State.agents[0] ? State.agents[0].name : 'Sales Agent');
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

      if (State.settlementScanMode === 'RETURN') {
        bill.status = 'RETURNED_IN_HAND';
        bill.returnReason = 'Verified Return (Next Round)';
        bill.remarks = 'Scanned return';
        const timestamp = new Date().toISOString();
        bill.lastActionDate = timestamp;
        bill.history.push({ action: 'RETURNED_IN_HAND', timestamp });

        queueSyncAction('SETTLEMENT_RETURN', {
          billNo: bill.billNo,
          agent: bill.agent,
          status: 'RETURNED_IN_HAND',
          returnReason: bill.returnReason,
          remarks: bill.remarks,
          timestamp
        });
        showToast(`Marked Return: ${bill.billNo}`, 'info');
      } else {
        bill.collectedAmt = collectedAmt;
        bill.outstanding = (parsed.outstanding !== undefined && parsed.outstanding !== null) ? Number(parsed.outstanding) : Math.max(0, bill.amount - collectedAmt);
        bill.status = (collectedAmt >= bill.amount && bill.amount > 0) ? 'PAID_FULL' : (collectedAmt > 0 ? 'PAID_PARTIAL' : 'WITH_AGENT');
        bill.paymentMode = parsed.receipt ? 'Receipt/Sheet' : 'Cash';
        bill.refNo = parsed.receipt || bill.refNo;
        bill.remarks = (parsed.receipt ? (`Receipt: ${parsed.receipt}`) : 'Checked IN') + (parsed.outstanding !== undefined ? ` | Remaining: ${formatINR(parsed.outstanding)}` : '');
        const timestamp = new Date().toISOString();
        bill.lastActionDate = timestamp;
        bill.history.push({ action: bill.status, amount: collectedAmt, mode: bill.paymentMode, ref: bill.refNo, timestamp });

        queueSyncAction('SETTLEMENT_PAYMENT', {
          billNo: bill.billNo,
          agent: bill.agent,
          party: bill.party,
          totalAmount: bill.amount,
          status: bill.status,
          collectedAmt,
          remainingDue: bill.outstanding,
          paymentMode: bill.paymentMode,
          refNo: bill.refNo,
          remarks: bill.remarks,
          timestamp
        });
        showToast(`Checked IN ${bill.billNo} (${formatINR(collectedAmt)})`, 'success');
      }

      saveState();
      updateGlobalStats();
      loadSettlementForSelectedAgent();
      renderLeftOutTab();
      SoundFX.playBeep('success');
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
    showToast(`Settlement closed for ${agent}!`, 'success', 3500);
  }


  // ========================================================
  // 8. TAB 3: REMAINING LEFT-OUT AUDIT ENGINE
  // ========================================================

  function getAgentLeftOutStats(agentName) {
    const agentBills = State.bills.filter(b => b.agent === agentName);
    const leftOutBills = agentBills.filter(b => b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT');
    const checkedInBills = agentBills.filter(b => b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND');

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
    if (!grid || !tbody) return;

    const filterVal = filterSelect ? filterSelect.value : 'ALL';

    // Populate Agent filter options if empty
    if (filterSelect && filterSelect.options.length <= 1) {
      State.agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name;
        filterSelect.appendChild(opt);
      });
    }

    grid.innerHTML = '';
    tbody.innerHTML = '';

    const allLeftOutBills = [];

    State.agents.forEach(agent => {
      const stats = getAgentLeftOutStats(agent.name);
      if (filterVal !== 'ALL' && filterVal !== agent.name) return;

      if (stats.leftOutBills.length > 0) {
        allLeftOutBills.push(...stats.leftOutBills);
      }

      // Summary Card
      const card = document.createElement('div');
      card.className = 'leftout-agent-card';
      card.innerHTML = `
        <div class="leftout-agent-head">
          <span class="leftout-agent-name">${agent.name}</span>
          <span class="leftout-count-tag">${stats.leftOutCount} Left Out</span>
        </div>
        <div class="leftout-amount-row">
          <small class="text-muted">Dispatched: ${stats.totalCount} bills</small>
          <span class="leftout-amt-val font-mono">${formatINR(stats.leftOutAmt)}</span>
        </div>
        <div style="display: flex; gap: 6px; margin-top: 4px;">
          <button class="btn btn-outline-whatsapp btn-sm flex-1" data-wa-agent="${agent.name}">
            <i class="fa-brands fa-whatsapp"></i> Alert Agent
          </button>
          <button class="btn btn-dark btn-sm" data-goto-settle="${agent.name}">
            Check-IN
          </button>
        </div>
      `;
      grid.appendChild(card);
    });

    // Populate Left Out Table
    if (allLeftOutBills.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">🎉 Zero left-out bills! All dispatched bills are accounted for.</td></tr>';
    } else {
      allLeftOutBills.forEach(b => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong class="font-mono text-danger">${b.billNo}</strong></td>
          <td><strong>${b.agent}</strong></td>
          <td>${b.party}</td>
          <td class="font-mono">${formatINR(b.amount)}</td>
          <td>${b.dispatchDate || '-'}</td>
          <td>${b.refNo ? `<span class="badge-receipt">${b.refNo}</span>` : '-'}</td>
          <td>
            <button class="btn btn-success btn-sm" data-table-checkin="${b.billNo}">
              <i class="fa-solid fa-check"></i> Check IN
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
        const agentSel = document.getElementById('settlementAgentSelect');
        if (agentSel) {
          agentSel.value = btn.dataset.gotoSettle;
          loadSettlementForSelectedAgent();
        }
        switchTab('tab-settlement');
      });
    });

    tbody.querySelectorAll('[data-table-checkin]').forEach(btn => {
      btn.addEventListener('click', () => {
        const b = State.bills.find(item => item.billNo === btn.dataset.tableCheckin);
        if (b) {
          openPaymentModal(b);
        }
      });
    });

    // Alert tab badge
    const alertTabBtn = document.querySelector('[data-tab="tab-leftout"]');
    if (alertTabBtn) {
      alertTabBtn.classList.toggle('has-leftout', allLeftOutBills.length > 0);
    }
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
  // 9. MASTER LEDGER & EXPORT
  // ========================================================

  function renderMasterLedger() {
    const tbody = document.getElementById('masterLedgerTbody');
    if (!tbody) return;

    const search = (document.getElementById('ledgerSearchInput').value || '').toLowerCase();
    const agentFilter = document.getElementById('ledgerAgentFilter').value;
    const statusFilter = document.getElementById('ledgerStatusFilter').value;

    const filtered = State.bills.filter(b => {
      if (search) {
        const matchNo = b.billNo.toLowerCase().includes(search);
        const matchParty = (b.party || '').toLowerCase().includes(search);
        if (!matchNo && !matchParty) return false;
      }
      if (agentFilter !== 'ALL' && b.agent !== agentFilter) return false;
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No matching bills found.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    filtered.forEach(b => {
      const tr = document.createElement('tr');
      let statusLabel = b.status;
      if (b.status === 'WITH_AGENT') statusLabel = '<span class="text-danger font-bold">With Agent (OUT)</span>';
      else if (b.status === 'PAID_FULL') statusLabel = '<span class="text-success font-bold">Paid (Full)</span>';
      else if (b.status === 'PAID_PARTIAL') statusLabel = '<span class="text-success font-bold">Paid (Partial)</span>';
      else if (b.status === 'RETURNED_IN_HAND') statusLabel = '<span class="text-primary font-bold">Returned Next Round</span>';
      else if (b.status === 'MISSING_ALERT') statusLabel = '<span class="text-danger font-bold">⚠️ Left Out / Missing</span>';

      tr.innerHTML = `
        <td><strong class="font-mono text-primary">${b.billNo}</strong></td>
        <td>${b.party}</td>
        <td class="font-mono">${formatINR(b.amount)}</td>
        <td><strong>${b.agent || '-'}</strong></td>
        <td>${statusLabel}</td>
        <td>${b.refNo ? `<span class="badge-receipt">${b.refNo}</span>` : (b.collectedAmt > 0 ? formatINR(b.collectedAmt) : '-')}</td>
        <td><small class="text-muted">${b.paymentMode || b.returnReason || b.remarks || '-'}</small></td>
      `;
      tbody.appendChild(tr);
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

      if (data && data.status === 'OK') {
        SoundFX.playBeep('success');
        showToast(`Connected to Main Sheet (${data.sheetTitle || 'Fetcher Active'})!`, 'success');
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

  async function pullFromSheet() {
    const targetUrl = State.settings.mainSheetScriptUrl || State.settings.scriptUrl;
    if (!targetUrl) {
      showToast('Enter Main Sheet Apps Script URL in Settings', 'warning');
      return;
    }
    const btn = document.getElementById('pullFromSheetBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching...';

    try {
      const resp = await fetch(`${targetUrl}?action=GET_DATA&t=${Date.now()}`);
      const data = await resp.json();

      let incomingBills = [];

      // 1. High-speed compact tabular format (450 KB transfer)
      if (data && data.rows && Array.isArray(data.rows)) {
        incomingBills = data.rows.map(r => ({
          billNo: String(r[0] || '').trim(),
          receipt: String(r[1] || '').trim(),
          outstanding: Number(r[2]) || 0,
          party: String(r[3] || 'General Customer').trim(),
          amount: Number(r[4]) || 0,
          agent: String(r[5] || '').trim(),
          remainingText: String(r[2] || '')
        }));
      } else if (data && (data.bills || data.masterBills)) {
        // 2. Object format fallback
        const rawList = data.bills || data.masterBills;
        if (Array.isArray(rawList)) {
          incomingBills = rawList.map(b => ({
            billNo: String(b.billNo || b.b || '').trim(),
            receipt: String(b.receipt || b.r || '').trim(),
            outstanding: b.outstanding !== undefined ? Number(b.outstanding) : (Number(b.o) || 0),
            party: String(b.party || b.p || 'General Customer').trim(),
            amount: b.amount !== undefined ? Number(b.amount) : (Number(b.a) || 0),
            agent: String(b.agent || b.ag || '').trim(),
            remainingText: String(b.remainingText || b.outstanding || '')
          }));
        }
      }

      if (incomingBills.length > 0) {
        State.masterSheetBills = incomingBills;

        const existingAgents = new Set(State.agents.map(a => a.name.toLowerCase()));
        incomingBills.forEach(b => {
          if (b.agent && !existingAgents.has(b.agent.toLowerCase())) {
            existingAgents.add(b.agent.toLowerCase());
            State.agents.push({
              id: 'AG-' + (100 + State.agents.length + 1),
              name: b.agent.trim(),
              phone: ''
            });
          }
        });

        saveState('master');
        saveState('agents');
        updateGlobalStats();
        renderAgentSelects();
        updateMasterSheetUI();
        renderLeftOutTab();
        renderMasterLedger();
        SoundFX.playBeep('success');
        showToast(`⚡ Fast Loaded ${incomingBills.length.toLocaleString()} bills with Receipts (Col M) & Remaining Dues!`, 'success');
      } else {
        showToast('No bills found in Main Sheet response.', 'warning');
      }
    } catch (e) {
      showToast('Fetch failed: ' + e.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Fetch Details from Main Sheet';
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
    State.agents.forEach((ag, idx) => {
      const row = document.createElement('div');
      row.className = 'agent-item-pill';
      row.innerHTML = `
        <div>
          <span>${ag.name}</span>
          <small class="text-muted" style="margin-left: 6px;">(${ag.phone || 'No phone'})</small>
        </div>
        <button class="text-btn text-danger" data-remove-agent="${idx}">Remove</button>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('[data-remove-agent]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.removeAgent, 10);
        State.agents.splice(idx, 1);
        saveState('agents');
        renderAgentsManager();
        renderAgentSelects();
      });
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
          agent: State.agents[0] ? State.agents[0].name : 'Rahul Sharma',
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

  function switchTab(tabId) {
    document.querySelectorAll('.tab-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.toggle('active', view.id === tabId);
    });

    if (tabId !== 'tab-dispatch' && State.scannerDispatch) stopDispatchScanner();
    if (tabId !== 'tab-settlement' && State.scannerSettlement) stopSettlementScanner();

    if (tabId === 'tab-dispatch') {
      startDispatchScanner().catch(() => {});
    } else if (tabId === 'tab-settlement') {
      loadSettlementForSelectedAgent();
      startSettlementScanner().catch(() => {});
    } else if (tabId === 'tab-ledger') {
      renderMasterLedger();
    } else if (tabId === 'tab-leftout') {
      renderLeftOutTab();
    } else if (tabId === 'tab-settings') {
      renderAgentsManager();
    }
  }

  function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-item').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Theme toggle
    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
      State.settings.theme = State.settings.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', State.settings.theme);
      saveState('settings');
    });

    // Master Sheet Status click
    document.getElementById('masterSheetStatusBtn')?.addEventListener('click', () => {
      switchTab('tab-settings');
      document.getElementById('masterSheetPasteInput')?.focus();
    });
    document.getElementById('bannerSettingsBtn')?.addEventListener('click', () => {
      switchTab('tab-settings');
    });

    // Camera Selector Dropdown Change
    document.getElementById('cameraSourceSelect')?.addEventListener('change', (e) => {
      switchSelectedCamera(e.target.value);
    });

    // Flip Camera Buttons
    document.getElementById('flipCameraBtn')?.addEventListener('click', flipCamera);
    document.getElementById('flipSettlementCameraBtn')?.addEventListener('click', flipCamera);

    // ================== TAB 1: SCAN OUT ==================
    document.getElementById('startScanBtn')?.addEventListener('click', startDispatchScanner);
    document.getElementById('stopScanBtn')?.addEventListener('click', stopDispatchScanner);

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
      const msg = 
`*BILL HANDOVER SLIP (OUT)*
*Date:* ${document.getElementById('dispatchDate').value || getTodayDateString()}
*Total Bills:* ${State.dispatchBasket.length} (${formatINR(total)})
-------------------------
${State.dispatchBasket.map((b, i) => `${i + 1}. *${b.billNo}* [${b.agent}] - ${b.party} (${formatINR(b.amount)})`).join('\n')}
-------------------------
_BillAudit Pro_`;
      window.open(`https://wa.me/?text=${encodeURI(msg)}`, '_blank');
    });

    document.getElementById('addAgentQuickBtn')?.addEventListener('click', () => {
      document.getElementById('addAgentModal').style.display = 'flex';
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

    document.getElementById('startSettlementScanBtn')?.addEventListener('click', startSettlementScanner);
    document.getElementById('stopSettlementScanBtn')?.addEventListener('click', stopSettlementScanner);

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
    document.getElementById('whatsappAllLeftOutBtn')?.addEventListener('click', sendAllLeftOutWhatsApp);

    // ================== TAB 4: LEDGER ==================
    document.getElementById('ledgerSearchInput')?.addEventListener('input', renderMasterLedger);
    document.getElementById('ledgerAgentFilter')?.addEventListener('change', renderMasterLedger);
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

    document.getElementById('saveNewAgentBtn')?.addEventListener('click', () => {
      const nameInput = document.getElementById('newAgentNameInput');
      const phoneInput = document.getElementById('newAgentPhoneInput');
      const name = nameInput.value.trim();
      const phone = phoneInput.value.trim();
      if (!name) return;
      State.agents.push({ id: 'AG-' + (100 + State.agents.length + 1), name, phone });
      saveState('agents');
      renderAgentsManager();
      renderAgentSelects();
      nameInput.value = '';
      phoneInput.value = '';
      showToast(`Added ${name}`, 'success');
    });

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

    document.getElementById('closeAddAgentModalBtn')?.addEventListener('click', () => document.getElementById('addAgentModal').style.display = 'none');
    document.getElementById('cancelAddAgentModalBtn')?.addEventListener('click', () => document.getElementById('addAgentModal').style.display = 'none');
    document.getElementById('addAgentModalForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('modalNewAgentName').value.trim();
      const phone = document.getElementById('modalNewAgentPhone').value.trim();
      if (name) {
        State.agents.push({ id: 'AG-' + (100 + State.agents.length + 1), name, phone });
        saveState('agents');
        renderAgentSelects();
        renderAgentsManager();
        document.getElementById('addAgentModal').style.display = 'none';
        document.getElementById('modalNewAgentName').value = '';
        document.getElementById('modalNewAgentPhone').value = '';
        showToast(`Added ${name}`, 'success');
      }
    });

    document.getElementById('closeQrPreviewModalBtn')?.addEventListener('click', () => document.getElementById('qrPreviewModal').style.display = 'none');
    document.getElementById('closeQrPreviewBottomBtn')?.addEventListener('click', () => document.getElementById('qrPreviewModal').style.display = 'none');
    document.getElementById('printTestQrBtn')?.addEventListener('click', () => window.print());
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
    initCameraSelectors();

    // Auto-launch camera for camera-first rapid scanning
    startDispatchScanner().catch(() => {});
  });

})();
