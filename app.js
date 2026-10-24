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
    SHEET_MAPPINGS: 'billAudit_sheetMappings',
    BASKET: 'billAudit_basket'
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
    masterSheetFuzzyMap: new Map(),
    sheetMappings: { ...DEFAULT_MAPPINGS },
    settings: { ...DEFAULT_SETTINGS },
    offlineQueue: [],
    auditLogs: [],
    dispatchBasket: [],
    activeSettlementAgent: null,
    settlementBills: [],
    diffDateFilter: 'ALL', // 'ALL', 'TODAY', 'YESTERDAY', or 'OVERDUE'
    leftOutSearch: '',
    homeDateFilter: 'ALL', // 'ALL', 'TODAY', 'YESTERDAY', 'OVERDUE', or 'CUSTOM'
    homeCustomDate: null,
    homeDecisionTab: 'UNRETURNED', // 'UNRETURNED', 'OVERDUE', 'PARTIAL', 'MISSED_SHEET'
    homeDecisionAgent: 'ALL',
    homeDecisionAging: null, // aging bucket id from the dashboard chart, filters the action table
    homeDecisionSearch: '',
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
    breakdownCategory: null, // 'OUT', 'IN', 'DIFF', or 'AGENT'
    breakdownAgent: 'ALL',   // 'ALL' or specific agent name
    breakdownBeat: 'ALL',    // 'ALL' or specific beat name
    breakdownFilter: 'ALL',  // 'ALL', 'PENDING', 'PAID', 'RECEIPT'
    breakdownSearch: '',     // search query
    isSyncing: false,
    isBreakdownModalOpen: false,
    dispatchBeatFilter: 'BEAT',  // 'BEAT' (current beat only) or 'ALL'
    settlementBeatFilter: 'ALL', // Default 'ALL' so unreturned bills across beats are immediately visible
    beatAnalysisAgent: 'ALL',    // 'ALL', 'Rajesh', 'Shivam', 'Self'
    beatAnalysisDateFilter: 'ALL', // 'ALL', 'TODAY', 'YESTERDAY', 'OVERDUE'
    beatAnalysisSearch: '',
    isBeatAnalysisModalOpen: false,
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

  const beatCleanCache = new Map();
  function cleanBeatString(str) {
    if (!str) return { clean: '', routeNum: null };
    const rawKey = String(str);
    const cached = beatCleanCache.get(rawKey);
    if (cached) return cached;

    let s = rawKey.trim();
    // Strip day/week suffixes like (Mon, Week 1), (Mon), (Week 2), etc.
    s = s.replace(/\s*\((Mon|Tue|Wed|Thu|Fri|Sat)[^)]*\)/gi, '');
    s = s.replace(/\s*\(Week\s*\d+[^)]*\)/gi, '');

    // Check for route number in parentheses e.g. (1), (2), [1], [2]
    let routeNum = null;
    const parenRoute = s.match(/[\(\[]\s*(\d+)\s*[\)\]]/);
    if (parenRoute) {
      routeNum = parseInt(parenRoute[1], 10);
      s = s.replace(/[\(\[]\s*\d+\s*[\)\]]/g, '');
    }

    // Also check for trailing dash route number e.g. -1, -2, - 1, - 2
    const dashRoute = s.match(/[-–—]\s*(\d+)\s*$/);
    if (dashRoute) {
      routeNum = parseInt(dashRoute[1], 10);
      s = s.replace(/[-–—]\s*\d+\s*$/, '');
    }

    // Strip all non-alphanumeric chars for base matching
    const clean = s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const res = { clean, routeNum };
    if (beatCleanCache.size < 5000) beatCleanCache.set(rawKey, res);
    return res;
  }

  function isSameBeat(beatA, beatB) {
    if (!beatA || !beatB) return false;
    if (beatA === beatB) return true;

    const a = cleanBeatString(beatA);
    const b = cleanBeatString(beatB);
    if (!a.clean || !b.clean) return false;

    // Check route number consistency
    // If both have route numbers, they must match exactly
    if (a.routeNum !== null && b.routeNum !== null) {
      if (a.routeNum !== b.routeNum) return false;
    } else if (a.routeNum !== null && a.routeNum > 1) {
      // a is Route 2+, but b has no route number -> cannot match Route 1 / unnumbered
      return false;
    } else if (b.routeNum !== null && b.routeNum > 1) {
      // b is Route 2+, but a has no route number -> cannot match Route 1 / unnumbered
      return false;
    }

    if (a.clean === b.clean) return true;

    // Handle substring / abbreviation matches with safety
    const minLen = Math.min(a.clean.length, b.clean.length);
    if (minLen >= 4 && (a.clean.includes(b.clean) || b.clean.includes(a.clean))) {
      return true;
    }
    return false;
  }

  function loadLocalState() {
    try {
      const storedBills = localStorage.getItem(STORAGE_KEYS.BILLS);
      State.bills = storedBills ? JSON.parse(storedBills) : [];

      const storedBasket = localStorage.getItem(STORAGE_KEYS.BASKET);
      State.dispatchBasket = storedBasket ? JSON.parse(storedBasket) : [];

      // Strictly enforce the 3 designated agents only: Rajesh Chaurasiya, Shivam Dwivedi, Self
      State.agents = [...DEFAULT_AGENTS];
      localStorage.setItem(STORAGE_KEYS.AGENTS, JSON.stringify(State.agents));

      // Sanitize legacy bills so only canonical agents exist in custody
      const validAgentNames = new Set([
        'rajesh', 'shivam', 'self',
        'rajesh chaurasiya', 'shivam dwivedi',
        'rajesh chaurasiya(om marketing)'
      ]);
      const todayStr = getTodayDateString();
      State.bills.forEach(b => {
        if (!b.agent || !validAgentNames.has(b.agent.toLowerCase().trim())) {
          b.agent = 'Rajesh';
        }
        if (b.dispatchDate) {
          b.dispatchDate = normalizeDateString(b.dispatchDate);
        }
        // Auto-heal: If historical bill was stamped with today's dispatchDate, restore its true action date
        if (b.dispatchDate === todayStr && b.lastActionDate) {
          const actionDay = normalizeDateString(b.lastActionDate);
          if (actionDay && actionDay !== todayStr) {
            b.dispatchDate = actionDay;
          }
        }
      });

      // Strictly deduplicate State.bills by normalized invoice number
      const billMap = new Map();
      State.bills.forEach(b => {
        if (!b || !b.billNo) return;
        const norm = normalizeInvoiceNumber(b.billNo);
        if (!billMap.has(norm)) {
          billMap.set(norm, b);
        } else {
          const existing = billMap.get(norm);
          if (b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'WITH_AGENT') {
            billMap.set(norm, { ...existing, ...b });
          }
        }
      });
      State.bills = Array.from(billMap.values());

      // Deduplicate State.dispatchBasket by normalized invoice number
      const basketMap = new Map();
      State.dispatchBasket.forEach(b => {
        if (!b || !b.billNo) return;
        const norm = normalizeInvoiceNumber(b.billNo);
        if (!basketMap.has(norm)) {
          basketMap.set(norm, b);
        }
      });
      State.dispatchBasket = Array.from(basketMap.values());

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
      if (State.masterSheetBills.length > 0 && State.bills.length > 0) {
        reconcileCustodyWithMasterSheet();
      }

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
      // Cleanse any poisoned or auto-healed items that were mistakenly enqueued
      if (Array.isArray(State.offlineQueue)) {
        const origLen = State.offlineQueue.length;
        State.offlineQueue = State.offlineQueue.filter(item => {
          const rem = (item && item.payload && item.payload.remarks) ? String(item.payload.remarks) : '';
          return !rem.includes('Auto-Healed') && !rem.includes('Verified Paid on Master Sheet');
        });
        if (State.offlineQueue.length !== origLen) {
          saveState('queue');
        }
      }

      const storedLogs = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
      State.auditLogs = storedLogs ? JSON.parse(storedLogs) : [];
    } catch (e) {
      console.error('Local state load failed:', e);
    }
  }

  function saveState(key) {
    try {
      if (!key || key === 'bills') {
        const billsJson = JSON.stringify(State.bills);
        localStorage.setItem(STORAGE_KEYS.BILLS, billsJson);
        // When running inside the Native Rust (Tauri) Windows Desktop App, mirror custody bills to Windows AppData disk
        if (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.invoke) {
          window.__TAURI__.invoke('save_local_backup', {
            filename: 'custody_bills_backup.json',
            content: billsJson
          }).catch(() => {});
        }
      }
      if (!key || key === 'agents') localStorage.setItem(STORAGE_KEYS.AGENTS, JSON.stringify(State.agents));
      if (!key || key === 'basket') localStorage.setItem(STORAGE_KEYS.BASKET, JSON.stringify(State.dispatchBasket));
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

  /**
   * Normalizes any date format (ISO, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY) to canonical YYYY-MM-DD
   */
  const dateNormCache = new Map();
  const dateAgingCache = new Map();
  let dateAgingCacheDay = '';

  function normalizeDateString(d) {
    if (!d) return '';
    const str = String(d).trim();
    if (!str) return '';
    const cached = dateNormCache.get(str);
    if (cached !== undefined) return cached;

    let res = str;
    // Fast path for already canonical YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      res = str;
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
      const parsed = new Date(str);
      if (!isNaN(parsed.getTime())) {
        res = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      } else {
        res = str.split('T')[0];
      }
    } else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
      const parts = str.split('-');
      res = `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
    } else {
      const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (dmy) {
        res = `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
      } else {
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
          res = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
        }
      }
    }

    if (dateNormCache.size < 5000) dateNormCache.set(str, res);
    return res;
  }

  /**
   * Computes how many days a bill has been in the field since its dispatchDate (or lastActionDate).
   * Memoized by date string for O(1) instant sorting and filtering.
   */
  function getBillAgingDays(billOrDate) {
    const rawDate = (billOrDate && typeof billOrDate === 'object')
      ? (billOrDate.dispatchDate || billOrDate.lastActionDate || '')
      : billOrDate;
    if (!rawDate) return 0;
    const norm = normalizeDateString(rawDate);
    if (!norm || !/^\d{4}-\d{2}-\d{2}$/.test(norm)) return 0;

    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (dateAgingCacheDay !== todayKey) {
      dateAgingCache.clear();
      dateAgingCacheDay = todayKey;
    }
    const cachedAge = dateAgingCache.get(norm);
    if (cachedAge !== undefined) return cachedAge;

    const [y, m, d] = norm.split('-').map(Number);
    const billTime = new Date(y, m - 1, d).getTime();
    const todayTime = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const age = isNaN(billTime) ? 0 : Math.max(0, Math.floor((todayTime - billTime) / 86400000));
    dateAgingCache.set(norm, age);
    return age;
  }

  /**
   * Canonical check for whether a bill is currently unreturned in agent custody (in field).
   */
  function isBillUnreturnedInField(b) {
    if (!b) return false;
    const st = String(b.status || '').toUpperCase();
    return st === 'WITH_AGENT' || st === 'MISSING_ALERT' || st === 'LEFT_OUT_ALERT' || st === 'IN_BASKET';
  }

  /**
   * Canonical check for whether a bill has any pending/missing difference (either unreturned in field or partial due).
   */
  function isBillMissingOrPending(b) {
    if (!b) return false;
    if (isBillUnreturnedInField(b)) return true;
    const st = String(b.status || '').toUpperCase();
    if (st === 'PAID_PARTIAL') {
      return getBillPendingAmount(b) > 0;
    }
    return false;
  }

  /**
   * Returns the pending/uncollected balance on a bill.
   */
  function getBillPendingAmount(b) {
    if (!b) return 0;
    const amt = Number(b.amount) || 0;
    const st = String(b.status || '').toUpperCase();
    if (st === 'RECEIVED' || st === 'PAID_FULL' || st === 'RETURNED_IN_HAND') return 0;
    if (b.outstanding !== undefined && b.outstanding !== null && b.outstanding !== '' && !isNaN(b.outstanding)) {
      return Math.max(0, Number(b.outstanding));
    }
    if (b.collectedAmt !== undefined && b.collectedAmt !== null && !isNaN(b.collectedAmt) && Number(b.collectedAmt) > 0) {
      return Math.max(0, amt - Number(b.collectedAmt));
    }
    return amt;
  }

  /**
   * Returns the collected/accounted amount on a bill.
   */
  function getBillCollectedAmount(b) {
    if (!b) return 0;
    const amt = Number(b.amount) || 0;
    const st = String(b.status || '').toUpperCase();
    if (b.collectedAmt !== undefined && b.collectedAmt !== null && !isNaN(b.collectedAmt) && Number(b.collectedAmt) > 0) {
      return Number(b.collectedAmt);
    }
    if (st === 'RECEIVED' || st === 'PAID_FULL' || st === 'RETURNED_IN_HAND') {
      return amt;
    }
    if (b.outstanding !== undefined && b.outstanding !== null && !isNaN(b.outstanding) && Number(b.outstanding) < amt) {
      return Math.max(0, amt - Number(b.outstanding));
    }
    return 0;
  }

  /**
   * Infers a bill's Beat Route from Master Sheet or from Agent + Dispatch Date day-of-week schedule.
   * Caches result on the bill object so it never repeats lookups during rendering.
   */
  function inferBillBeat(b) {
    if (!b) return '';
    const existingBeat = String(b.beat || b.beatName || '').trim();
    if (existingBeat) return existingBeat;
    if (b._inferredBeat !== undefined) return b._inferredBeat;

    let resolved = '';
    const mm = b.billNo ? findMasterBill(b.billNo) : null;
    if (mm && mm.beat && String(mm.beat).trim()) {
      resolved = String(mm.beat).trim();
    } else {
      const agentName = String(b.agent || (mm && mm.agent) || '').trim();
      const rawDate = normalizeDateString(b.dispatchDate || b.lastActionDate || '');
      if (agentName && rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        const [y, m, d] = rawDate.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        const dayCodes = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayCode = dayCodes[dt.getDay()];
        const plan = MASTER_BEAT_PLAN[agentName] ||
          (agentName.toLowerCase().includes('shivam') ? MASTER_BEAT_PLAN.Shivam :
           (agentName.toLowerCase().includes('self') ? MASTER_BEAT_PLAN.Self : MASTER_BEAT_PLAN.Rajesh));
        if (plan && plan[dayCode] && plan[dayCode].beat) {
          resolved = plan[dayCode].beat;
        }
      }
    }
    if (resolved) b.beat = resolved;
    b._inferredBeat = resolved;
    return resolved;
  }

  /**
   * Checks whether a bill's date matches a given date filter mode (TODAY, YESTERDAY, OVERDUE, ALL, CUSTOM)
   */
  function matchesDateFilter(billDate, filterMode = 'ALL', targetCustomDate = null) {
    if (filterMode === 'ALL') {
      return true;
    }

    const normBill = normalizeDateString(billDate);
    if (filterMode === 'OVERDUE') {
      return getBillAgingDays(normBill) > 3;
    }

    if (!normBill) {
      return false;
    }

    if (filterMode === 'TODAY') {
      const today = getTodayDateString();
      return normBill === today;
    }

    if (filterMode === 'YESTERDAY') {
      const yest = getYesterdayDateString();
      return normBill === yest;
    }

    if (filterMode === 'CUSTOM' && targetCustomDate) {
      const target = normalizeDateString(targetCustomDate);
      return normBill === target;
    }

    return normBill === normalizeDateString(filterMode);
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
   * Add a bill to a candidate list in the fuzzy index (one entry per distinct invoice number)
   */
  function addFuzzyCandidate(map, key, b) {
    if (!key) return;
    const list = map.get(key);
    if (!list) {
      map.set(key, [b]);
      return;
    }
    const idx = list.findIndex(x => x._normBillNo === b._normBillNo);
    if (idx >= 0) list[idx] = b;
    else list.push(b);
  }

  /**
   * Helper to register the lookup forms of a bill's FULL invoice number.
   * Exact numbers go in State.masterSheetMap; formatting variants (case, spaces, dashes,
   * slashes, an "INV"/"VCH"/"IN-" prefix) go in State.masterSheetFuzzyMap as candidate lists.
   * There is deliberately no digits-only / last-digits key: many vouchers share the same
   * trailing number (e.g. "IN-FY25/26-3965" and "IN-FY26/27-3965").
   */
  function registerBillInMap(map, b) {
    if (!b || !b.billNo) return;
    const exact = b.billNo.trim().toUpperCase();
    const norm = normalizeInvoiceNumber(b.billNo);
    if (!b._normBillNo) b._normBillNo = norm;

    map.set(exact, b);
    const fuzzy = State.masterSheetFuzzyMap;
    addFuzzyCandidate(fuzzy, 'N:' + norm, b);
    const stripped = stripInvoicePrefix(b.billNo);
    if (stripped && stripped !== exact) {
      addFuzzyCandidate(fuzzy, 'N:' + stripped, b);
      addFuzzyCandidate(fuzzy, 'N:' + normalizeInvoiceNumber(stripped), b);
    }
  }

  /**
   * Returns the bill for a fuzzy key only when exactly one invoice matches it.
   * Ambiguous keys return null so a scan never silently picks the wrong party.
   */
  function getUniqueFuzzyMatch(key) {
    const list = State.masterSheetFuzzyMap.get(key);
    return list && list.length === 1 ? list[0] : null;
  }

  /**
   * Rebuild the O(1) Master Sheet Hash Map AND pre-index Due Bills, Beat Lists, and Beat Stats
   * in a single linear pass so UI renders never scan 15,000+ rows repeatedly.
   */
  function rebuildMasterSheetMap() {
    State.masterSheetMap.clear();
    State.masterSheetFuzzyMap.clear();
    State.masterDueBills = [];
    State.masterPaidExcludedCount = 0;
    State.masterAgentBeatsMap = { ALL: new Set(), Rajesh: new Set(), Shivam: new Set(), Self: new Set() };

    for (let i = 0; i < State.masterSheetBills.length; i++) {
      const b = State.masterSheetBills[i];
      if (!b || !b.billNo) continue;
      b._normBillNo = normalizeInvoiceNumber(b.billNo);
      registerBillInMap(State.masterSheetMap, b);

      const rawAg = String(b.agent || '').trim();
      let canonAg = '';
      if (rawAg) {
        const agLow = rawAg.toLowerCase();
        if (agLow.includes('shivam')) canonAg = 'Shivam';
        else if (agLow.includes('self')) canonAg = 'Self';
        else if (agLow.includes('rajesh')) canonAg = 'Rajesh';
        else canonAg = rawAg;
      }
      b._canonAgent = canonAg;

      const rawBeat = String(b.beat || '').trim();
      if (rawBeat.length > 1) {
        State.masterAgentBeatsMap.ALL.add(rawBeat);
        if (canonAg && State.masterAgentBeatsMap[canonAg]) {
          State.masterAgentBeatsMap[canonAg].add(rawBeat);
        }
      }

      if (rawAg) {
        const outstanding = (b.outstanding !== undefined && b.outstanding !== null && b.outstanding !== '') ? Number(b.outstanding) : null;
        const isPaid = isBillPaidInFull(b) || (outstanding !== null && outstanding <= 0 && (Number(b.amount) > 0 || b.receipt));
        b._isPaid = isPaid;
        if (isPaid) {
          State.masterPaidExcludedCount++;
        } else {
          State.masterDueBills.push(b);
        }
      }
    }

    // Clear any cached beat inference on custody bills so they pick up newly loaded Master Sheet beats
    if (State.bills && State.bills.length > 0) {
      for (let i = 0; i < State.bills.length; i++) {
        delete State.bills[i]._inferredBeat;
      }
    }
  }

  /**
   * Add or update a single bill into the O(1) Master Sheet Hash Map and state array
   */
  function addBillToMasterIndex(b) {
    if (!b || !b.billNo) return;
    b._normBillNo = normalizeInvoiceNumber(b.billNo);
    registerBillInMap(State.masterSheetMap, b);

    const norm = b._normBillNo;
    const idx = State.masterSheetBills.findIndex(x => (x._normBillNo || normalizeInvoiceNumber(x.billNo)) === norm);
    if (idx >= 0) {
      State.masterSheetBills[idx] = b;
    } else {
      State.masterSheetBills.unshift(b);
    }
  }

  /**
   * Search Master Sheet for an Invoice Number (O(1) Hash Map Lookup).
   * Matches the FULL invoice number only: exact first, then the same number written with
   * different case / spaces / dashes / slashes or an "INV"/"VCH"/"IN-" prefix.
   * Never matches on the last digits alone, since many vouchers share them.
   */
  function findMasterBill(invoiceInput) {
    if (!invoiceInput) return null;
    const cleanInput = String(invoiceInput).trim();
    if (!cleanInput) return null;

    // Ensure map is populated if bills array has items
    if (State.masterSheetMap.size === 0 && State.masterSheetBills.length > 0) {
      rebuildMasterSheetMap();
    }

    // 1. Exact uppercase match
    const upperInput = cleanInput.toUpperCase();
    let match = State.masterSheetMap.get(upperInput);
    if (match) return match;

    // 2. Same full number, different formatting (ignores spaces, dashes, slashes)
    match = getUniqueFuzzyMatch('N:' + normalizeInvoiceNumber(cleanInput));
    if (match) return match;

    // 3. Same full number without an invoice prefix (e.g. scanner sends "VCH-14015503-0001")
    const strippedInput = stripInvoicePrefix(cleanInput);
    if (strippedInput && strippedInput !== upperInput) {
      match = getUniqueFuzzyMatch('N:' + strippedInput) || getUniqueFuzzyMatch('N:' + normalizeInvoiceNumber(strippedInput));
      if (match) return match;
    }

    return null;
  }

  /**
   * Universal Payment Check: Determines if a bill is fully paid / settled.
   * Checks outstanding <= 0, status PAID/PAID_FULL, receipt remarks, or collected >= amount.
   */
  function isBillPaidInFull(b) {
    if (!b) return false;
    const status = String(b.status || '').toUpperCase();
    if (status === 'PAID' || status === 'PAID_FULL' || status === 'RECEIVED' || status === 'RETURNED_IN_HAND') {
      return true;
    }
    const receipt = String(b.receipt || b.refNo || '').trim();
    if (/^PAID/i.test(receipt)) {
      return true;
    }
    const outstanding = (b.outstanding !== undefined && b.outstanding !== null && b.outstanding !== '') ? Number(b.outstanding) : null;
    const amount = Number(b.amount) || 0;
    const collected = Number(b.collectedAmt) || 0;
    if (amount > 0 && collected >= amount) {
      return true;
    }
    if (outstanding !== null && outstanding <= 0 && (amount > 0 || receipt)) {
      return true;
    }
    return false;
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
          // Amount / date / GSTIN labels often also contain "Invoice" or "Bill" (e.g. "Bill Amount",
          // "Invoice Date"), so classify them first and keep the first invoice-number label found.
          if (key.includes('amount') || key.includes('total') || key.includes('amt') || key.includes('value')) {
            if (!amount) amount = parseFloat(val.replace(/[₹,\s]/g, '')) || 0;
          } else if (key.includes('date') || key.includes('gst') || key.includes('irn')) {
            continue;
          } else if (key.includes('party') || key.includes('customer') || key.includes('name') || key.includes('bill to') || key.includes('buyer')) {
            if (!party) party = val;
          } else if (key.includes('inv') || key.includes('bill') || key.includes('doc')) {
            if (!billNo) billNo = val;
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

  // ========================================================
  // DASHBOARD CHARTS: daily trend, agent recovery, aging & routes
  // ========================================================

  // Fixed status order for every stacked chart: the actionable part sits on the baseline.
  const VIZ_STATUS = [
    { key: 'out', label: 'Not returned yet', cls: 'viz-crit', icon: 'fa-person-walking-luggage' },
    { key: 'partial', label: 'Part-paid, balance due', cls: 'viz-warn', icon: 'fa-scale-unbalanced-flip' },
    { key: 'accounted', label: 'Accounted (paid / returned)', cls: 'viz-good', icon: 'fa-circle-check' }
  ];

  const AGING_BUCKETS = [
    { id: 'FRESH', label: '0–1 day', min: 0, max: 1 },
    { id: 'ACTIVE', label: '2–3 days', min: 2, max: 3 },
    { id: 'WARN', label: '4–7 days', min: 4, max: 7 },
    { id: 'CRIT', label: '8+ days', min: 8, max: Infinity }
  ];

  const vizTips = new Map();
  let vizTipSeq = 0;

  function formatINRCompact(val) {
    const n = Number(val) || 0;
    const abs = Math.abs(n);
    const fmt = (v, digits) => v.toFixed(digits).replace(/\.0$/, '');
    if (abs >= 10000000) return `₹${fmt(n / 10000000, abs >= 100000000 ? 0 : 1)}Cr`;
    if (abs >= 100000) return `₹${fmt(n / 100000, abs >= 1000000 ? 0 : 1)}L`;
    if (abs >= 1000) return `₹${fmt(n / 1000, abs >= 10000 ? 0 : 1)}k`;
    return `₹${Math.round(n)}`;
  }

  function niceCeil(val) {
    if (val <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(val)));
    const f = val / pow;
    const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return step * pow;
  }

  /**
   * Splits a bill's value into mutually exclusive parts so stacks always add up:
   * accounted (collected / returned), part-paid balance due, and not-returned due.
   */
  function splitBillValue(b) {
    const accounted = getBillCollectedAmount(b);
    const pending = getBillPendingAmount(b);
    if (isBillUnreturnedInField(b)) return { accounted, partial: 0, out: pending };
    return { accounted, partial: pending, out: 0 };
  }

  function sumBillValues(bills) {
    const t = { accounted: 0, partial: 0, out: 0, total: 0, count: 0, outCount: 0, partialCount: 0 };
    bills.forEach(b => {
      const v = splitBillValue(b);
      t.accounted += v.accounted;
      t.partial += v.partial;
      t.out += v.out;
      t.count++;
      if (v.out > 0) t.outCount++;
      else if (v.partial > 0) t.partialCount++;
    });
    t.total = t.accounted + t.partial + t.out;
    return t;
  }

  function registerVizTip(title, rows) {
    const id = `vt${++vizTipSeq}`;
    vizTips.set(id, { title, rows });
    return id;
  }

  function statusTipRows(t) {
    return [
      ...VIZ_STATUS.map(st => ({ cls: st.cls, label: st.label, value: formatINR(t[st.key]) })),
      { label: `Total · ${t.count} bill${t.count === 1 ? '' : 's'}`, value: formatINR(t.total), strong: true }
    ];
  }

  function renderStatusLegends() {
    const html = VIZ_STATUS.map(st => `
      <span class="viz-legend-item"><span class="viz-swatch ${st.cls}"></span><i class="fa-solid ${st.icon}"></i> ${st.label}</span>
    `).join('');
    document.querySelectorAll('[data-viz-legend="status"]').forEach(el => { el.innerHTML = html; });
  }

  function stackSegmentsHtml(t, scaleMax, vertical) {
    if (scaleMax <= 0) return '';
    return VIZ_STATUS.map(st => {
      const v = t[st.key];
      if (v <= 0) return '';
      const pct = (v / scaleMax) * 100;
      return `<span class="viz-seg ${st.cls}" style="${vertical ? 'height' : 'width'}:${pct}%"></span>`;
    }).join('');
  }

  function ensureVizTooltip() {
    let tip = document.getElementById('vizTooltip');
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'vizTooltip';
    tip.className = 'viz-tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);

    const show = (mark, x, y) => {
      const data = vizTips.get(mark.dataset.vizTip);
      if (!data) return;
      tip.textContent = '';
      const title = document.createElement('div');
      title.className = 'viz-tooltip-title';
      title.textContent = data.title;
      tip.appendChild(title);
      data.rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'viz-tooltip-row' + (r.strong ? ' is-total' : '');
        const key = document.createElement('span');
        key.className = 'viz-tooltip-key ' + (r.cls || '');
        const label = document.createElement('span');
        label.className = 'viz-tooltip-label';
        label.textContent = r.label;
        const value = document.createElement('strong');
        value.textContent = r.value;
        row.append(key, value, label);
        tip.appendChild(row);
      });
      tip.style.display = 'block';
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let left = x + 14;
      let top = y + 14;
      if (left + w > window.innerWidth - 8) left = x - w - 14;
      if (top + h > window.innerHeight - 8) top = y - h - 14;
      tip.style.left = `${Math.max(8, left)}px`;
      tip.style.top = `${Math.max(8, top)}px`;
    };
    const hide = () => { tip.style.display = 'none'; };

    document.addEventListener('pointermove', e => {
      const mark = e.target.closest && e.target.closest('[data-viz-tip]');
      if (mark) show(mark, e.clientX, e.clientY);
      else if (tip.style.display === 'block') hide();
    });
    document.addEventListener('focusin', e => {
      const mark = e.target.closest && e.target.closest('[data-viz-tip]');
      if (!mark) return hide();
      const r = mark.getBoundingClientRect();
      show(mark, r.left + r.width / 2, r.top);
    });
    document.addEventListener('scroll', hide, true);
    return tip;
  }

  /**
   * Daily stacked columns: value dispatched per day, split by recovery status.
   * Clicking a day applies it as the dashboard's custom date filter (click again to clear).
   */
  function renderTrendChart(custodyBills) {
    const el = document.getElementById('vizTrendChart');
    if (!el) return;

    const days = [];
    const byDate = new Map();
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ key, date: d, bills: [] });
      byDate.set(key, days[days.length - 1]);
    }
    custodyBills.forEach(b => {
      const day = byDate.get(normalizeDateString(b.dispatchDate) || (b.status === 'IN_BASKET' ? getTodayDateString() : ''));
      if (day) day.bills.push(b);
    });
    days.forEach(d => { d.t = sumBillValues(d.bills); });

    const maxTotal = Math.max(0, ...days.map(d => d.t.total));
    const scaleMax = niceCeil(maxTotal);
    const stillOut = days.reduce((s, d) => s + d.t.out + d.t.partial, 0);
    const headline = document.getElementById('vizTrendHeadline');
    if (headline) {
      headline.textContent = stillOut > 0 ? `${formatINR(stillOut)} still due from these 14 days` : 'Everything from these 14 days is accounted';
      headline.classList.toggle('text-danger', stillOut > 0);
      headline.classList.toggle('text-success', stillOut <= 0);
    }

    if (maxTotal <= 0) {
      el.innerHTML = `<div class="viz-empty">No bills dispatched in the last 14 days.</div>`;
      return;
    }

    const filterMode = State.homeDateFilter || 'ALL';
    const selectedKey = filterMode === 'TODAY' ? getTodayDateString()
      : filterMode === 'YESTERDAY' ? getYesterdayDateString()
      : (filterMode === 'CUSTOM' && State.homeCustomDate) ? normalizeDateString(State.homeCustomDate) : '';

    // Direct label only on the day with the most value still due
    let worstKey = '';
    let worstDue = 0;
    days.forEach(d => {
      const due = d.t.out + d.t.partial;
      if (due > worstDue) { worstDue = due; worstKey = d.key; }
    });

    const gridSteps = [1, 0.5, 0];
    const gridHtml = gridSteps.map(f => `
      <div class="viz-grid-line" style="bottom:${f * 100}%"><span>${formatINRCompact(scaleMax * f)}</span></div>
    `).join('');

    const colsHtml = days.map(d => {
      const weekday = d.date.toLocaleDateString('en-IN', { weekday: 'short' });
      const dayLabel = d.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const tipId = registerVizTip(`${weekday}, ${dayLabel}`, statusTipRows(d.t));
      const due = d.t.out + d.t.partial;
      const isSel = d.key === selectedKey;
      const aria = `${weekday} ${dayLabel}: ${formatINR(d.t.total)} dispatched, ${formatINR(due)} still due`;
      return `
        <button type="button" class="viz-col${isSel ? ' is-selected' : ''}${selectedKey && !isSel ? ' is-dimmed' : ''}" data-viz-tip="${tipId}" data-viz-day="${d.key}" aria-label="${escapeHtml(aria)}" aria-pressed="${isSel}">
          <span class="viz-col-plot">
            <span class="viz-col-stack" style="height:${(d.t.total / scaleMax) * 100}%">
              ${d.key === worstKey && worstDue > 0 ? `<span class="viz-col-label">${formatINRCompact(worstDue)} due</span>` : ''}
              ${stackSegmentsHtml(d.t, d.t.total, true)}
            </span>
          </span>
          <span class="viz-col-x"><strong>${d.date.getDate()}</strong><small>${weekday}</small></span>
        </button>
      `;
    }).join('');

    el.innerHTML = `<div class="viz-trend-plot"><div class="viz-grid-lines">${gridHtml}</div><div class="viz-cols">${colsHtml}</div></div>`;

    el.querySelectorAll('[data-viz-day]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.vizDay;
        const picker = document.getElementById('homeCustomDatePicker');
        if (key === selectedKey) {
          State.homeDateFilter = 'ALL';
          State.homeCustomDate = null;
          if (picker) picker.value = '';
        } else if (key === getTodayDateString()) {
          State.homeDateFilter = 'TODAY';
          if (picker) picker.value = '';
        } else {
          State.homeDateFilter = 'CUSTOM';
          State.homeCustomDate = key;
          if (picker) picker.value = key;
        }
        updateHomeStats();
      });
    });
  }

  /**
   * One stacked bar per agent (plus an all-agents total) for the active date filter.
   * Bar length is the agent's dispatched value, so agents compare at a glance.
   */
  function renderAgentRecoveryChart(custodyBills) {
    const el = document.getElementById('vizAgentChart');
    const badge = document.getElementById('decisionOverallRecoveryBadge');
    if (!el) return;

    const overall = sumBillValues(custodyBills);
    if (badge) {
      const pct = overall.total > 0 ? Math.round((overall.accounted / overall.total) * 100) : 0;
      badge.textContent = `${pct}% accounted`;
      badge.classList.toggle('text-success', pct >= 80);
      badge.classList.toggle('text-danger', overall.total > 0 && pct < 50);
    }

    const rows = State.agents.map(agent => ({
      name: agent.name,
      t: sumBillValues(custodyBills.filter(b => isSameAgent(b.agent, agent.name)))
    }));
    const assigned = new Set();
    custodyBills.forEach(b => { if (State.agents.some(a => isSameAgent(b.agent, a.name))) assigned.add(b); });
    const unassigned = custodyBills.filter(b => !assigned.has(b));
    if (unassigned.length > 0) rows.push({ name: 'Unassigned', t: sumBillValues(unassigned), noClick: true });

    if (overall.total <= 0) {
      el.innerHTML = `<div class="viz-empty">No dispatched bills for this date filter.</div>`;
      return;
    }

    const scaleMax = Math.max(...rows.map(r => r.t.total), 1);
    const rowHtml = (r, isTotal) => {
      const due = r.t.out + r.t.partial;
      const pct = r.t.total > 0 ? Math.round((r.t.accounted / r.t.total) * 100) : 0;
      const tipId = registerVizTip(isTotal ? 'All agents' : r.name, statusTipRows(r.t));
      const tag = r.noClick || isTotal ? 'div' : 'button';
      return `
        <${tag} ${tag === 'button' ? 'type="button"' : 'tabindex="0"'} class="viz-hbar-row${isTotal ? ' is-total' : ''}" data-viz-tip="${tipId}" ${tag === 'button' ? `data-viz-agent="${escapeHtml(r.name)}"` : ''} aria-label="${escapeHtml(`${isTotal ? 'All agents' : r.name}: ${formatINR(r.t.total)} dispatched, ${formatINR(due)} due, ${pct}% accounted`)}">
          <span class="viz-hbar-head">
            <span class="viz-hbar-name">${isTotal ? 'All agents' : escapeHtml(r.name)}</span>
            <span class="viz-hbar-value font-mono">${due > 0 ? `<strong>${formatINR(due)}</strong> due` : '<strong>Nothing due</strong>'} · ${pct}% of ${formatINRCompact(r.t.total)}</span>
          </span>
          <span class="viz-hbar-track">${stackSegmentsHtml(r.t, isTotal ? r.t.total : scaleMax, false)}</span>
        </${tag}>
      `;
    };

    el.innerHTML = rowHtml({ t: overall }, true) + rows.filter(r => r.t.count > 0).map(r => rowHtml(r, false)).join('');
    el.querySelectorAll('[data-viz-agent]').forEach(btn => {
      btn.addEventListener('click', () => openDashboardBreakdown('AGENT', btn.dataset.vizAgent));
    });
  }

  /**
   * Pending value by days in field (ordinal single-hue ramp: older = stronger) and the
   * routes holding the most pending value. Both use all missing/pending custody bills.
   */
  function renderAgingAndRouteCharts(missingBills) {
    const agingEl = document.getElementById('agingBucketsContainer');
    const beatsEl = document.getElementById('topRiskBeatsContainer');
    const avgBadge = document.getElementById('decisionAvgAgingBadge');

    const buckets = AGING_BUCKETS.map(bk => ({ ...bk, count: 0, amt: 0 }));
    let totalAge = 0;
    missingBills.forEach(b => {
      const age = getBillAgingDays(b);
      totalAge += age;
      const bk = buckets.find(x => age >= x.min && age <= x.max) || buckets[buckets.length - 1];
      bk.count++;
      bk.amt += getBillPendingAmount(b);
    });
    if (avgBadge) {
      const avg = missingBills.length > 0 ? (totalAge / missingBills.length).toFixed(1) : '0';
      avgBadge.textContent = `Avg ${avg}d in field`;
    }

    if (agingEl) {
      if (missingBills.length === 0) {
        agingEl.innerHTML = `<div class="viz-empty">✓ No unreturned or part-paid bills.</div>`;
      } else {
        const max = Math.max(...buckets.map(b => b.amt), 1);
        const active = State.homeDecisionAging;
        agingEl.innerHTML = buckets.map((bk, i) => {
          const tipId = registerVizTip(`${bk.label} in field`, [
            { cls: `viz-age-${i + 1}`, label: 'Pending value', value: formatINR(bk.amt), strong: true },
            { label: 'Bills', value: String(bk.count) }
          ]);
          return `
            <button type="button" class="viz-hbar-row viz-hbar-inline${active === bk.id ? ' is-selected' : ''}${active && active !== bk.id ? ' is-dimmed' : ''}" data-viz-tip="${tipId}" data-viz-aging="${bk.id}" aria-pressed="${active === bk.id}" aria-label="${escapeHtml(`${bk.label} in field: ${formatINR(bk.amt)} pending across ${bk.count} bills`)}">
              <span class="viz-hbar-name">${bk.label}</span>
              <span class="viz-hbar-track"><span class="viz-seg viz-age-${i + 1}" style="width:${(bk.amt / max) * 100}%"></span></span>
              <span class="viz-hbar-value font-mono"><strong>${formatINRCompact(bk.amt)}</strong> · ${bk.count}</span>
            </button>
          `;
        }).join('');
        agingEl.querySelectorAll('[data-viz-aging]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.vizAging;
            State.homeDecisionAging = State.homeDecisionAging === id ? null : id;
            renderDecisionAnalysisCenter();
            if (State.homeDecisionAging) {
              document.getElementById('homeDecisionActionCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          });
        });
      }
    }

    if (beatsEl) {
      const beatMap = new Map();
      missingBills.forEach(b => {
        const beat = b.beat || b.beatName || inferBillBeat(b) || 'Unassigned route';
        const agent = b.agent || 'Unassigned';
        const key = `${agent}___${beat}`;
        if (!beatMap.has(key)) beatMap.set(key, { agent, beat, count: 0, amt: 0 });
        const e = beatMap.get(key);
        e.count++;
        e.amt += getBillPendingAmount(b);
      });
      const top = Array.from(beatMap.values()).filter(x => x.amt > 0).sort((a, b) => b.amt - a.amt).slice(0, 5);
      if (top.length === 0) {
        beatsEl.innerHTML = `<div class="viz-empty">✓ No stuck route balances — all beats cleared!</div>`;
      } else {
        const max = top[0].amt;
        beatsEl.innerHTML = top.map(tb => {
          const tipId = registerVizTip(tb.beat, [
            { cls: 'viz-route', label: 'Pending value', value: formatINR(tb.amt), strong: true },
            { label: 'Bills', value: String(tb.count) },
            { label: 'Agent', value: tb.agent }
          ]);
          return `
            <button type="button" class="viz-hbar-row" data-viz-tip="${tipId}" data-risk-agent="${escapeHtml(tb.agent)}" data-risk-beat="${escapeHtml(tb.beat)}" aria-label="${escapeHtml(`${tb.beat} (${tb.agent}): ${formatINR(tb.amt)} pending across ${tb.count} bills`)}">
              <span class="viz-hbar-head">
                <span class="viz-hbar-name">${escapeHtml(tb.beat)} <small class="text-muted"><i class="fa-solid fa-user-tie"></i> ${escapeHtml(tb.agent)}</small></span>
                <span class="viz-hbar-value font-mono"><strong>${formatINR(tb.amt)}</strong> · ${tb.count} bill${tb.count === 1 ? '' : 's'}</span>
              </span>
              <span class="viz-hbar-track"><span class="viz-seg viz-route" style="width:${(tb.amt / max) * 100}%"></span></span>
            </button>
          `;
        }).join('');
        beatsEl.querySelectorAll('[data-risk-agent]').forEach(row => {
          row.addEventListener('click', () => {
            const agent = row.dataset.riskAgent;
            openDashboardBreakdown('AGENT', agent === 'Unassigned' ? 'ALL' : agent, row.dataset.riskBeat);
          });
        });
      }
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
      if (State.isBreakdownModalOpen) {
        closeDashboardBreakdownModal();
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Generates rich HTML badges for Receipt number and Payment Status (Recorded vs Pending)
   */
  function renderBillPaymentBadgesHtml(item) {
    const isFetching = !!item.isFetching;
    const notInSheet = !!item.notFound;
    const rawReceipt = String(item.receipt || item.refNo || '').trim();
    const amount = Number(item.amount) || 0;

    let outstanding = 0;
    if (item.outstanding !== undefined && item.outstanding !== null && !isNaN(item.outstanding)) {
      outstanding = Number(item.outstanding);
    } else if (item.status === 'RECEIVED' || item.status === 'PAID_FULL') {
      outstanding = 0;
    } else {
      outstanding = amount;
    }

    // Check if rawReceipt is a payment remark like "PAID IN FULL" or "PAID (₹...)"
    const isPaidRemark = /^PAID/i.test(rawReceipt);
    const isPartialRemark = /^PARTIAL/i.test(rawReceipt);
    const hasActualReceipt = Boolean(rawReceipt && !isPaidRemark && !isPartialRemark && !/^(nil|none|n\/a|-)$/i.test(rawReceipt));

    // 1. Receipt Badge
    let receiptBadge = '';
    if (hasActualReceipt) {
      receiptBadge = `<span class="badge-receipt" title="Column M Receipt: ${escapeHtml(rawReceipt)}"><i class="fa-solid fa-receipt"></i> Receipt: <strong>${escapeHtml(rawReceipt)}</strong></span>`;
    } else if (isPaidRemark) {
      receiptBadge = `<span class="badge-receipt" title="Recorded as Paid"><i class="fa-solid fa-receipt"></i> ${escapeHtml(rawReceipt)}</span>`;
    } else if (!isFetching) {
      receiptBadge = `<span class="badge-no-receipt" title="No receipt number on sheet"><i class="fa-solid fa-receipt"></i> No Receipt</span>`;
    }

    // 2. Payment Status Badge
    let paymentBadge = '';
    if (isFetching) {
      paymentBadge = `<span class="badge-payment-checking"><i class="fa-solid fa-spinner fa-spin"></i> Checking Payment...</span>`;
    } else if (notInSheet) {
      paymentBadge = `<span class="badge-not-in-sheet"><i class="fa-solid fa-triangle-exclamation"></i> Not In Master Sheet</span>`;
    } else if (outstanding <= 0 && (amount > 0 || isPaidRemark || hasActualReceipt || item.fromMaster || item.status === 'RECEIVED')) {
      paymentBadge = `<span class="badge-payment-recorded"><i class="fa-solid fa-circle-check"></i> Payment Recorded (Paid in Full)</span>`;
    } else if (outstanding > 0 && amount > 0 && (outstanding < amount || isPartialRemark)) {
      const paidAmt = Math.max(0, amount - outstanding);
      paymentBadge = `
        <span class="badge-payment-partial"><i class="fa-solid fa-circle-half-stroke"></i> Partial Paid (${formatINR(paidAmt)})</span>
        <span class="badge-payment-due"><i class="fa-solid fa-coins"></i> Due: ${formatINR(outstanding)}</span>
      `;
    } else if (outstanding > 0) {
      paymentBadge = `<span class="badge-payment-pending"><i class="fa-solid fa-clock"></i> Payment Pending &bull; Due: ${formatINR(outstanding)}</span>`;
    } else {
      paymentBadge = `<span class="badge-payment-recorded"><i class="fa-solid fa-circle-check"></i> Payment Recorded</span>`;
    }

    return { receiptBadge, paymentBadge, outstanding, amount, hasActualReceipt, rawReceipt };
  }

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

      // Trigger background fast sheet lookup if payment details / receipt are not cached
      if (!parsed.fromMaster || (!parsed.receipt && parsed.outstanding === undefined)) {
        parsed.isFetching = true;
        fetchSingleBillDetailsFromSheet(parsed.billNo, 'DISPATCH');
      }

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

    // Trigger background fast sheet lookup if payment details / receipt are not cached
    if (!parsed.fromMaster || (!parsed.receipt && parsed.outstanding === undefined)) {
      parsed.isFetching = true;
      fetchSingleBillDetailsFromSheet(parsed.billNo, 'DISPATCH');
    }

    addBillToDispatchBasket(parsed);
    focusActiveScannerInput();
  }

  function addBillToDispatchBasket(parsed, options = {}) {
    const silent = Boolean(options && options.silent);
    const skipRender = Boolean(options && options.skipRender);

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

    const receiptVal = parsed.receipt || parsed.refNo || '';

    // Safety Guard: Check if bill is already PAID in Master Sheet
    const isPaidOnSheet = isBillPaidInFull(parsed);
    if (isPaidOnSheet) {
      if (!silent) {
        SoundFX.playBeep('error');
        SoundFX.vibrate(200);
      }
      const allowOverride = confirm(
        `⛔ ALREADY PAID BILL!\n\n` +
        `Invoice: ${parsed.billNo}\n` +
        `Customer: ${parsed.party || 'Customer'}\n` +
        `Amount: ₹${parsed.amount || 0}\n` +
        `Receipt / Status: ${parsed.receipt || 'Paid in Full'}\n\n` +
        `This bill is already recorded as PAID in the Master Sheet. It does NOT need to be collected by ${assignedAgent}.\n\n` +
        `Do you still want to dispatch this (e.g. for goods delivery)?\n` +
        `Click CANCEL to skip, or OK to dispatch anyway.`
      );
      if (!allowOverride) {
        if (!silent) showToast(`Skipped ${parsed.billNo} — bill already paid in sheet`, 'warning', 3000);
        return;
      }
    }

    // Beat Mismatch Guard: Alert if bill is assigned to a different beat in Master Sheet
    if (State.activeBeat && parsed.beat && !isSameBeat(parsed.beat, State.activeBeat)) {
      if (!silent) {
        SoundFX.playBeep('warning');
        SoundFX.vibrate(150);
      }
      const allowOverride = confirm(
        `⚠️ BEAT MISMATCH DETECTED!\n\n` +
        `Invoice: ${parsed.billNo}\n` +
        `Customer: ${parsed.party || 'Customer'}\n` +
        `Master Sheet Beat: ${parsed.beat}\n` +
        `Master Sheet Agent: ${parsed.agent || 'Not specified'}\n\n` +
        `Current Morning Dispatch Session is for:\n` +
        `📍 Beat: ${State.activeBeat}\n` +
        `👤 Agent: ${assignedAgent}\n\n` +
        `Do you want to dispatch this bill under ${State.activeBeat} anyway?\n` +
        `Click CANCEL to skip, or OK to add to this beat.`
      );
      if (!allowOverride) {
        if (!silent) showToast(`Skipped ${parsed.billNo} — assigned to ${parsed.beat}`, 'warning', 3000);
        return;
      }
    } else if (State.activeAgent && parsed.agent && !isSameAgent(parsed.agent, State.activeAgent.name)) {
      if (!silent) {
        SoundFX.playBeep('warning');
        SoundFX.vibrate(150);
      }
      const allowAgentOverride = confirm(
        `⚠️ AGENT MISMATCH DETECTED!\n\n` +
        `Invoice: ${parsed.billNo}\n` +
        `Master Sheet Agent: ${parsed.agent}\n` +
        `Active Session Agent: ${State.activeAgent.name}\n\n` +
        `Do you want to reassign this bill to ${State.activeAgent.name} and dispatch?\n` +
        `Click CANCEL to skip, or OK to dispatch.`
      );
      if (!allowAgentOverride) {
        if (!silent) showToast(`Skipped ${parsed.billNo} — belongs to ${parsed.agent}`, 'warning', 3000);
        return;
      }
    }

    // Check duplicate in current basket — update if already present
    const normScan = normalizeInvoiceNumber(parsed.billNo);
    const existingBasketIdx = State.dispatchBasket.findIndex(b => normalizeInvoiceNumber(b.billNo) === normScan);
    if (existingBasketIdx >= 0) {
      State.dispatchBasket[existingBasketIdx].agent = assignedAgent;
      if (assignedBeat) State.dispatchBasket[existingBasketIdx].beat = assignedBeat;
      State.dispatchBasket[existingBasketIdx].beatName = assignedBeatName;
      State.dispatchBasket[existingBasketIdx].day = assignedDay;
      State.dispatchBasket[existingBasketIdx].week = assignedWeek;
      if (parsed.party && parsed.party !== 'Standard Account') State.dispatchBasket[existingBasketIdx].party = parsed.party;
      if (parsed.amount) State.dispatchBasket[existingBasketIdx].amount = parsed.amount;
      if (receiptVal) {
        State.dispatchBasket[existingBasketIdx].receipt = receiptVal;
        State.dispatchBasket[existingBasketIdx].refNo = receiptVal;
      }
      if (parsed.outstanding !== undefined) State.dispatchBasket[existingBasketIdx].outstanding = parsed.outstanding;
      if (parsed.isFetching !== undefined) State.dispatchBasket[existingBasketIdx].isFetching = parsed.isFetching;
      if (parsed.fromMaster !== undefined) State.dispatchBasket[existingBasketIdx].fromMaster = parsed.fromMaster;
      if (!silent) {
        SoundFX.playBeep('success');
        showToast(`Updated ${parsed.billNo} in dispatch list`, 'info', 1500);
      }
      if (!skipRender) {
        saveState('basket');
        renderDispatchBasket();
        updateHomeStats();
      }
      return;
    }

    // Check active custody — allow re-dispatching with alert
    const active = State.bills.find(b => normalizeInvoiceNumber(b.billNo) === normScan && b.status === 'WITH_AGENT');
    if (active && !silent) {
      SoundFX.playBeep('warning');
      showToast(`Re-assigning ${parsed.billNo} (previously with ${active.agent})`, 'warning', 2000);
    }

    const todayStr = getTodayDateString();
    State.dispatchBasket.unshift({
      billNo: parsed.billNo,
      party: parsed.party || 'Standard Account',
      amount: parsed.amount || 0,
      agent: assignedAgent,
      beat: assignedBeat,
      beatName: assignedBeatName,
      day: assignedDay,
      week: assignedWeek,
      dispatchDate: todayStr,
      lastActionDate: new Date().toISOString(),
      receipt: receiptVal,
      refNo: receiptVal,
      outstanding: parsed.outstanding !== undefined ? parsed.outstanding : (parsed.amount || 0),
      isFetching: !!parsed.isFetching,
      fromMaster: !!parsed.fromMaster,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      raw: parsed.raw
    });

    if (!silent) {
      SoundFX.playBeep('success');
      SoundFX.vibrate(50);
      showToast(`Added ${parsed.billNo} (${assignedAgent})`, 'success', 1500);
    }

    if (!skipRender) {
      saveState('basket');
      renderDispatchBasket();
      updateHomeStats();
    }
  }

  function renderDispatchBasket() {
    const list = document.getElementById('dispatchBasketList');
    const countBadge = document.getElementById('dispatchBasketCount');
    const totalLabel = document.getElementById('dispatchBasketTotal');
    const confirmBtn = document.getElementById('confirmDispatchBtn');
    const waBtn = document.getElementById('whatsappHandoverBtn');
    const printBtn = document.getElementById('printHandoverSlipBtn');
    const filterStrip = document.getElementById('dispatchBasketFilterStrip');
    const beatNameEl = document.getElementById('dispatchBasketBeatName');
    const btnBeatOnly = document.getElementById('dispatchFilterBeatOnlyBtn');
    const btnAllBeats = document.getElementById('dispatchFilterAllBeatsBtn');

    if (!list) return;

    // Determine items to display based on beat filter
    const activeBeat = State.activeBeat;
    const isFilterBeat = State.dispatchBeatFilter === 'BEAT' && Boolean(activeBeat);

    if (filterStrip) {
      if (activeBeat && State.dispatchBasket.length > 0) {
        filterStrip.style.display = 'flex';
        if (beatNameEl) beatNameEl.textContent = activeBeat;
        if (btnBeatOnly) btnBeatOnly.classList.toggle('active', isFilterBeat);
        if (btnAllBeats) btnAllBeats.classList.toggle('active', !isFilterBeat);
      } else {
        filterStrip.style.display = 'none';
      }
    }

    let displayItems = State.dispatchBasket;
    if (isFilterBeat) {
      displayItems = State.dispatchBasket.filter(item => {
        const matchAgent = State.activeAgent ? isSameAgent(item.agent, State.activeAgent.name) : true;
        const matchBeat = isSameBeat(item.beat || item.beatName, activeBeat);
        return matchAgent && matchBeat;
      });
    }

    if (displayItems.length === 0) {
      const msg = isFilterBeat
        ? `No bills added for ${escapeHtml(activeBeat)} yet.<br><small>Scan labels with your 2D gun or pick from sheet queue below.</small>`
        : `No bills added to handover basket yet.<br><small>Click "Start Camera" above or type Invoice Number.</small>`;
      list.innerHTML = `
        <div class="empty-placeholder">
          <i class="fa-solid fa-qrcode"></i>
          <p>${msg}</p>
        </div>
      `;
      countBadge.textContent = '0';
      totalLabel.textContent = formatINR(0);
      confirmBtn.disabled = true;
      if (waBtn) waBtn.disabled = true;
      if (printBtn) printBtn.disabled = true;
      renderDispatchSheetBeatQueue();
      return;
    }

    let total = 0;
    list.innerHTML = '';

    displayItems.forEach((item, index) => {
      total += Number(item.amount) || 0;
      const { receiptBadge, paymentBadge, outstanding, amount } = renderBillPaymentBadgesHtml(item);

      // Find original index in State.dispatchBasket for deletion
      const origIdx = State.dispatchBasket.indexOf(item);

      const row = document.createElement('div');
      row.className = 'bill-card-row';
      row.innerHTML = `
        <div class="bill-info-main">
          <div class="bill-pills-row">
            <span class="b-num font-mono">${escapeHtml(item.billNo)}</span>
            <span class="b-agent-pill">
              <i class="fa-solid fa-user"></i> ${escapeHtml(item.agent || 'Unassigned')}
            </span>
            ${item.beat ? `<span class="badge-beat"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(item.beat)}</span>` : ''}
            ${receiptBadge}
            ${paymentBadge}
          </div>
          <span class="b-party" title="${escapeHtml(item.party)}"><i class="fa-regular fa-building"></i> ${escapeHtml(item.party)}</span>
        </div>
        <div class="bill-info-meta">
          <span class="b-amount font-mono text-success">${formatINR(amount)}</span>
          ${outstanding > 0 ? `<span class="b-due-label font-mono text-danger">Pending: ${formatINR(outstanding)}</span>` : (amount > 0 ? `<span class="b-due-label font-mono text-success">Cleared: ₹0 Due</span>` : '')}
          <button class="del-btn" data-del-index="${origIdx >= 0 ? origIdx : index}" title="Remove">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `;
      list.appendChild(row);
    });

    countBadge.textContent = displayItems.length;
    totalLabel.textContent = formatINR(total);
    confirmBtn.disabled = false;
    if (waBtn) waBtn.disabled = false;
    if (printBtn) printBtn.disabled = false;

    list.querySelectorAll('[data-del-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.delIndex, 10);
        if (idx >= 0 && idx < State.dispatchBasket.length) {
          State.dispatchBasket.splice(idx, 1);
          renderDispatchBasket();
          renderDispatchSheetBeatQueue();
        }
      });
    });

    renderDispatchSheetBeatQueue();
  }

  function renderDispatchSheetBeatQueue() {
    const card = document.getElementById('dispatchBeatQueueCard');
    const titleEl = document.getElementById('dispatchQueueTitle');
    const countEl = document.getElementById('dispatchQueueCount');
    const listEl = document.getElementById('dispatchBeatQueueList');
    const addAllBtn = document.getElementById('dispatchAddAllQueueBtn');

    if (!card || !listEl) return;

    const activeBeat = State.activeBeat;
    const activeAgent = State.activeAgent ? State.activeAgent.name : '';

    if (!activeBeat || !State.masterSheetBills || State.masterSheetBills.length === 0) {
      card.style.display = 'none';
      return;
    }

    // Bills already in basket or already in custody
    const inBasketNorms = new Set(State.dispatchBasket.map(b => b._normBillNo || (b._normBillNo = normalizeInvoiceNumber(b.billNo))));
    const today = getTodayDateString();
    const inCustodyNorms = new Set(
      State.bills
        .filter(b => b.dispatchDate === today || isBillUnreturnedInField(b))
        .map(b => b._normBillNo || (b._normBillNo = normalizeInvoiceNumber(b.billNo)))
    );

    const dueSource = State.masterDueBills || State.masterSheetBills || [];
    const queueBills = [];
    for (let i = 0; i < dueSource.length; i++) {
      const b = dueSource[i];
      if (!b || !b.billNo) continue;
      if (activeAgent && b.agent && !isSameAgent(b._canonAgent || b.agent, activeAgent)) continue;
      if (!isSameBeat(b.beat, activeBeat)) continue;
      if (b._isPaid !== undefined ? b._isPaid : isBillPaidInFull(b)) continue;

      const norm = b._normBillNo || (b._normBillNo = normalizeInvoiceNumber(b.billNo));
      if (inBasketNorms.has(norm) || inCustodyNorms.has(norm)) continue;

      queueBills.push(b);
    }

    card.style.display = 'block';
    if (titleEl) titleEl.textContent = `${activeBeat} — Sheet Pending`;
    if (countEl) countEl.textContent = queueBills.length;

    if (addAllBtn) {
      addAllBtn.style.display = queueBills.length > 0 ? 'inline-block' : 'none';
      addAllBtn.innerHTML = `<i class="fa-solid fa-plus-double"></i> Add All (${queueBills.length})`;
      addAllBtn.onclick = () => {
        queueBills.forEach(b => {
          let parsed = { ...b, raw: b.billNo };
          parsed = enrichWithMaster(parsed);
          addBillToDispatchBasket(parsed, { silent: true, skipRender: true });
        });
        saveState('basket');
        renderDispatchBasket();
        updateHomeStats();
        SoundFX.playBeep('success');
        showToast(`Added ${queueBills.length} pending bills for ${activeBeat}`, 'success', 2500);
      };
    }

    if (queueBills.length === 0) {
      listEl.innerHTML = `
        <div style="font-size:0.78rem; color:#64748b; padding:8px; text-align:center;">
          <i class="fa-solid fa-check-circle text-success"></i> All sheet invoices for this beat are in basket or already dispatched.
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';
    queueBills.slice(0, 30).forEach(b => {
      const item = document.createElement('div');
      item.className = 'beat-queue-item';
      item.innerHTML = `
        <div class="beat-queue-item-info">
          <div><strong class="font-mono">${escapeHtml(b.billNo)}</strong> &bull; <span class="text-success font-bold font-mono">${formatINR(b.amount)}</span></div>
          <small class="text-muted" style="font-size:0.74rem;">${escapeHtml(b.party)}</small>
        </div>
        <div class="beat-queue-item-actions">
          <button type="button" class="btn btn-xs btn-primary font-bold" data-add-queue-bill="${escapeHtml(b.billNo)}">
            <i class="fa-solid fa-plus"></i> Add
          </button>
        </div>
      `;
      listEl.appendChild(item);
    });

    listEl.querySelectorAll('[data-add-queue-bill]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bNo = btn.dataset.addQueueBill;
        const b = queueBills.find(x => x.billNo === bNo);
        if (b) {
          let parsed = { ...b, raw: b.billNo };
          parsed = enrichWithMaster(parsed);
          addBillToDispatchBasket(parsed);
        }
      });
    });
  }

  function confirmDispatchHandover() {
    if (State.dispatchBasket.length === 0) return;

    const dateInput = document.getElementById('dispatchDate');
    const date = (dateInput && dateInput.value) ? dateInput.value : getTodayDateString();
    const timestamp = new Date().toISOString();
    const newBills = [];

    const activeBeat = State.activeBeat;
    const isFilterBeat = State.dispatchBeatFilter === 'BEAT' && Boolean(activeBeat);

    // Items to dispatch: if beat filter is active, only dispatch items matching active agent & beat
    const itemsToDispatch = isFilterBeat
      ? State.dispatchBasket.filter(item => {
          const matchAgent = State.activeAgent ? isSameAgent(item.agent, State.activeAgent.name) : true;
          const matchBeat = isSameBeat(item.beat || item.beatName, activeBeat);
          return matchAgent && matchBeat;
        })
      : [...State.dispatchBasket];

    if (itemsToDispatch.length === 0) {
      showToast('No bills in basket for the selected beat to confirm', 'warning', 2500);
      return;
    }

    const dispatchNorms = new Set(itemsToDispatch.map(b => normalizeInvoiceNumber(b.billNo)));

    itemsToDispatch.forEach(b => {
      const normB = normalizeInvoiceNumber(b.billNo);
      let record = State.bills.find(item => normalizeInvoiceNumber(item.billNo) === normB);
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

    const count = itemsToDispatch.length;
    State.lastHandoverBatch = {
      agent: State.activeAgent ? State.activeAgent.name : (itemsToDispatch[0]?.agent || 'Sales Agent'),
      date,
      count,
      bills: [...itemsToDispatch]
    };

    // Remove only the dispatched items from basket
    State.dispatchBasket = State.dispatchBasket.filter(b => !dispatchNorms.has(normalizeInvoiceNumber(b.billNo)));

    saveState();
    saveState('basket');
    updateGlobalStats();
    renderLeftOutTab();
    renderDispatchBasket();
    updateHomeStats();

    SoundFX.playBeep('success');
    ConfettiFX.celebrate();
    showToast(`✓ Confirmed ${count} bills handed OUT to ${State.lastHandoverBatch.agent}!`, 'success', 3000);
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
    const filterStrip = document.getElementById('settlementBeatFilterStrip');
    const beatNameEl = document.getElementById('settlementBasketBeatName');
    const btnBeatOnly = document.getElementById('settlementFilterBeatOnlyBtn');
    const btnAllBeats = document.getElementById('settlementFilterAllBeatsBtn');

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
      if (filterStrip) filterStrip.style.display = 'none';
      return;
    }

    const allAgentBills = State.bills.filter(b => isSameAgent(b.agent, agent));
    allAgentBills.forEach(b => {
      if (!b.beat && !b.beatName) {
        const inferred = inferBillBeat(b);
        if (inferred) b.beat = inferred;
      }
    });
    const activeBeat = State.activeBeat;
    let isFilterBeat = State.settlementBeatFilter === 'BEAT' && Boolean(activeBeat);

    let bills = allAgentBills;
    if (isFilterBeat) {
      const beatMatched = allAgentBills.filter(b => isSameBeat(b.beat || b.beatName || inferBillBeat(b), activeBeat));
      if (beatMatched.length > 0) {
        bills = beatMatched;
      } else {
        // Auto-fallback to ALL beats if selected beat has 0 custody bills so agent's unreturned bills are never hidden
        isFilterBeat = false;
        bills = allAgentBills;
      }
    }

    if (filterStrip) {
      if (activeBeat && allAgentBills.length > 0) {
        filterStrip.style.display = 'flex';
        if (beatNameEl) beatNameEl.textContent = isFilterBeat ? activeBeat : `${activeBeat} (Showing All Beats)`;
        if (btnBeatOnly) btnBeatOnly.classList.toggle('active', isFilterBeat);
        if (btnAllBeats) btnAllBeats.classList.toggle('active', !isFilterBeat);
      } else {
        filterStrip.style.display = 'none';
      }
    }

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
      const { receiptBadge, paymentBadge, outstanding, amount } = renderBillPaymentBadgesHtml(bill);

      const row = document.createElement('div');
      row.className = `bill-card-row ${isPending ? 'is-missing' : 'is-received'}`;

      let custodyStatusHtml = isPending
        ? '<span class="text-danger font-bold"><i class="fa-solid fa-hourglass-half"></i> Handed OUT (Pending Return)</span>'
        : '<span class="text-success font-bold"><i class="fa-solid fa-check-double"></i> Received Back</span>';

      row.innerHTML = `
        <div class="bill-info-main">
          <div class="bill-pills-row">
            <span class="b-num font-mono">${escapeHtml(bill.billNo)}</span>
            <small>${custodyStatusHtml}</small>
            ${bill.beat ? `<span class="badge-beat"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(bill.beat)}</span>` : ''}
            ${receiptBadge}
            ${paymentBadge}
          </div>
          <span class="b-party" title="${escapeHtml(bill.party)}"><i class="fa-regular fa-building"></i> ${escapeHtml(bill.party)}</span>
        </div>
        <div class="bill-info-meta">
          <span class="b-amount font-mono">${formatINR(amount)}</span>
          ${outstanding > 0 ? `<span class="b-due-label font-mono text-danger">Pending Due: ${formatINR(outstanding)}</span>` : `<span class="b-due-label font-mono text-success">Paid in Full</span>`}
          <div class="bill-action-btns">
            ${isPending ? `<button class="mini-action-btn pay" data-quick-receive="${escapeHtml(bill.billNo)}"><i class="fa-solid fa-check"></i> Receive</button>` : ''}
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
          if (!b.receipt || b.outstanding === undefined) {
            const mm = findMasterBill(b.billNo);
            if (mm) {
              b.receipt = mm.receipt || b.receipt;
              b.refNo = mm.receipt || b.refNo;
              b.outstanding = mm.outstanding !== undefined ? mm.outstanding : b.outstanding;
              if (mm.party && mm.party !== 'Customer') b.party = mm.party;
              if (mm.amount) b.amount = mm.amount;
            } else {
              fetchSingleBillDetailsFromSheet(b.billNo, 'SETTLEMENT');
            }
          }
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

    if (bill && (bill.status === 'RECEIVED' || bill.status === 'PAID_FULL' || bill.status === 'RETURNED_IN_HAND')) {
      SoundFX.playBeep('warning');
      showToast(`Bill ${bill.billNo} is already checked in (${bill.status})!`, 'info', 2000);
      return;
    }

    const billAmt = parseFloat(parsed.amount) || 0;
    const outstanding = (parsed.outstanding !== undefined && parsed.outstanding !== null)
      ? parseFloat(parsed.outstanding)
      : 0;
    const receiptVal = parsed.receipt || parsed.refNo || '';

    if (!bill) {
      const targetAgent = (State.activeAgent ? State.activeAgent.name : '') || State.activeSettlementAgent || (State.agents[0] ? State.agents[0].name : 'Rajesh');
      bill = {
        billNo: parsed.billNo,
        party: parsed.party || 'Standard Account',
        amount: billAmt,
        agent: targetAgent,
        beat: parsed.beat || '',
        dispatchDate: '',
        status: 'RECEIVED',
        collectedAmt: Math.max(0, billAmt - outstanding),
        outstanding: outstanding,
        paymentMode: '',
        refNo: receiptVal,
        receipt: receiptVal,
        isFetching: !!parsed.isFetching,
        fromMaster: !!parsed.fromMaster,
        returnReason: '',
        remarks: 'Scanned at Check-IN',
        lastActionDate: new Date().toISOString(),
        history: []
      };
      State.bills.unshift(bill);
    } else {
      bill.status = 'RECEIVED';
      if (receiptVal) {
        bill.receipt = receiptVal;
        bill.refNo = receiptVal;
      }
      if (parsed.outstanding !== undefined) {
        bill.outstanding = parsed.outstanding;
        bill.collectedAmt = Math.max(0, (bill.amount || billAmt) - parsed.outstanding);
      }
      if (parsed.party && parsed.party !== 'Standard Account' && parsed.party !== 'Customer') {
        bill.party = parsed.party;
      }
      if (parsed.amount && parsed.amount > 0) {
        bill.amount = parsed.amount;
      }
      if (parsed.beat) bill.beat = parsed.beat;
      bill.isFetching = !!parsed.isFetching;
      bill.fromMaster = parsed.fromMaster || bill.fromMaster;
      bill.remarks = 'Received back from agent';
      const timestamp = new Date().toISOString();
      bill.lastActionDate = timestamp;
      bill.history.push({ action: 'RECEIVED', agent: bill.agent, timestamp });
    }

    queueSyncAction('SETTLEMENT_RETURN', {
      billNo: bill.billNo,
      agent: bill.agent,
      party: bill.party,
      amount: bill.amount,
      status: 'RECEIVED',
      receipt: bill.receipt || '',
      outstanding: bill.outstanding !== undefined ? bill.outstanding : 0,
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
      if (!parsed.beat && existing.beat) parsed.beat = existing.beat;
      if (!parsed.receipt && (existing.receipt || existing.refNo)) {
        parsed.receipt = existing.receipt || existing.refNo;
      }
      if (parsed.outstanding === undefined) {
        parsed.outstanding = existing.outstanding !== undefined ? existing.outstanding : Math.max(0, existing.amount - (existing.collectedAmt || 0));
      }
    }

    // Trigger background fast sheet lookup if payment details / receipt are not cached
    if (!parsed.fromMaster || (!parsed.receipt && parsed.outstanding === undefined)) {
      parsed.isFetching = true;
      fetchSingleBillDetailsFromSheet(parsed.billNo, 'SETTLEMENT');
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
    const normB = normalizeInvoiceNumber(billNo);
    const activeCustody = State.bills.find(b => normalizeInvoiceNumber(b.billNo) === normB && b.status === 'WITH_AGENT');
    const receivedToday = State.bills.find(b => normalizeInvoiceNumber(b.billNo) === normB && b.status === 'RECEIVED');

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

    // If agent mismatch, handle differently for paid vs pending bills
    if (isMismatch) {
      if (outstanding <= 0 || (receipt && outstanding === 0)) {
        statusClass = 'bd-fraud-paid';
        headHtml = `<i class="fa-solid fa-circle-check"></i> ✅ ALREADY PAID (Sheet Agent: ${sheetAgent})`;
        subHtml = `Receipt: ${receipt || 'Paid in Full'} &bull; Due: ₹0.00 &bull; <span style="color:#b91c1c;font-weight:700;">No agent collection needed!</span>`;
      } else {
        statusClass = 'bd-fraud-mismatch';
        headHtml = `<i class="fa-solid fa-user-xmark"></i> ⚠️ AGENT MISMATCH &bull; ` + (receipt ? 'PARTIAL DUE' : 'PENDING DUE');
        subHtml = `Assigned in Sheet to <strong>${sheetAgent}</strong> (Scanning for <strong>${activeAgent}</strong>).<br>${subHtml}`;
      }
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
      const normP = normalizeInvoiceNumber(parsed.billNo);
      const existing = State.bills.find(b => normalizeInvoiceNumber(b.billNo) === normP);
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
        const q = s => String(s).replace(/['"\\]/g, '');
        const runQuery = async (condition) => {
          const tq = encodeURIComponent(`select D, E, F, L, M, N, O, P, I, J ${condition} limit 20`);
          const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&tq=${tq}&gid=${gid}&t=${Date.now()}`;
          const gResp = await fetch(gvizUrl);
          return gResp.ok ? parseGvizResponse(await gResp.text()) : [];
        };

        // Full invoice number only (case-insensitive). Never match on the trailing digits:
        // many vouchers share them, e.g. "IN-FY25/26-3965" and "IN-FY26/27-3965".
        const rows = await runQuery(`where upper(D) = '${q(cleanNo.toUpperCase())}'`);
        b = rows.find(r => normalizeInvoiceNumber(r.billNo) === normalizeInvoiceNumber(cleanNo)) || null;
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
        const isMatch = State.isConfirmModalOpen && State.pendingScannedBill &&
          (normalizeInvoiceNumber(pendingNo) === normalizeInvoiceNumber(billNo) ||
           normalizeInvoiceNumber(pendingNo) === normalizeInvoiceNumber(b.billNo) ||
           pendingNo === b.billNo);

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

        // 1. Update in Dispatch Basket if present
        let basketUpdated = false;
        State.dispatchBasket.forEach(item => {
          if (normalizeInvoiceNumber(item.billNo) === normalizeInvoiceNumber(billNo) ||
              normalizeInvoiceNumber(item.billNo) === normalizeInvoiceNumber(b.billNo)) {
            if (b.party && b.party !== 'Customer' && b.party !== 'Standard Account') item.party = b.party;
            if (b.amount) item.amount = b.amount;
            if (b.agent) item.agent = b.agent;
            if (b.beat) item.beat = b.beat;
            item.receipt = b.receipt || '';
            item.refNo = b.receipt || '';
            item.outstanding = b.outstanding !== undefined ? b.outstanding : 0;
            item.isFetching = false;
            item.fromMaster = true;
            basketUpdated = true;
          }
        });
        if (basketUpdated) {
          renderDispatchBasket();
        }

        // 2. Update in State.bills (Active Custody / Settlement) if present
        let billsUpdated = false;
        State.bills.forEach(item => {
          if (normalizeInvoiceNumber(item.billNo) === normalizeInvoiceNumber(billNo) ||
              normalizeInvoiceNumber(item.billNo) === normalizeInvoiceNumber(b.billNo)) {
            if (b.party && b.party !== 'Customer' && b.party !== 'Standard Account') item.party = b.party;
            if (b.amount) item.amount = b.amount;
            if (b.agent) item.agent = b.agent;
            if (b.beat) item.beat = b.beat;
            item.receipt = b.receipt || '';
            item.refNo = b.receipt || '';
            item.outstanding = b.outstanding !== undefined ? b.outstanding : 0;
            item.isFetching = false;
            item.fromMaster = true;
            billsUpdated = true;
          }
        });
        if (billsUpdated) {
          saveState('bills');
          loadSettlementForSelectedAgent();
          renderLeftOutTab();
          updateHomeStats();
        }
      } else {
        if (receiptEl && receiptEl.innerHTML.includes('Fetching')) {
          receiptEl.textContent = '-';
        }
        if (State.isConfirmModalOpen && State.pendingScannedBill) {
          State.pendingScannedBill.fromMaster = false;
          updateModalFraudBanner(State.pendingScannedBill, source, false);
        }

        let basketUpdated = false;
        State.dispatchBasket.forEach(item => {
          if (normalizeInvoiceNumber(item.billNo) === normalizeInvoiceNumber(billNo)) {
            item.isFetching = false;
            item.notFound = true;
            basketUpdated = true;
          }
        });
        if (basketUpdated) renderDispatchBasket();

        let billsUpdated = false;
        State.bills.forEach(item => {
          if (normalizeInvoiceNumber(item.billNo) === normalizeInvoiceNumber(billNo)) {
            item.isFetching = false;
            item.notFound = true;
            billsUpdated = true;
          }
        });
        if (billsUpdated) loadSettlementForSelectedAgent();
      }
    } catch (e) {
      console.warn('Fast bill lookup from sheet failed:', e);
      if (receiptEl && receiptEl.innerHTML.includes('Fetching')) {
        receiptEl.textContent = '-';
      }
      if (State.isConfirmModalOpen && State.pendingScannedBill) {
        updateModalFraudBanner(State.pendingScannedBill, source, false);
      }

      State.dispatchBasket.forEach(item => {
        if (normalizeInvoiceNumber(item.billNo) === normalizeInvoiceNumber(billNo)) {
          item.isFetching = false;
        }
      });
      renderDispatchBasket();

      State.bills.forEach(item => {
        if (normalizeInvoiceNumber(item.billNo) === normalizeInvoiceNumber(billNo)) {
          item.isFetching = false;
        }
      });
      loadSettlementForSelectedAgent();
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

  function getAgentLeftOutStats(agentName, dateFilter = null, beatFilter = null, customDate = null) {
    const activeDateFilter = dateFilter || State.diffDateFilter || 'ALL';
    let agentBills = State.bills.filter(b => isSameAgent(b.agent, agentName));

    if (activeDateFilter !== 'ALL') {
      agentBills = agentBills.filter(b => matchesDateFilter(b.dispatchDate, activeDateFilter, customDate));
    }

    if (beatFilter && beatFilter !== 'ALL') {
      agentBills = agentBills.filter(b => isSameBeat(b.beat || b.beatName || inferBillBeat(b), beatFilter));
    }

    // Include basket bills for this agent if date filter is TODAY or ALL (excluding already confirmed bills)
    const confirmedNorms = new Set(agentBills.map(b => normalizeInvoiceNumber(b.billNo)).filter(Boolean));
    let agentBasket = [];
    if ((activeDateFilter === 'TODAY' || activeDateFilter === 'ALL') && State.dispatchBasket && State.dispatchBasket.length > 0) {
      const basketMap = new Map();
      State.dispatchBasket.forEach(b => {
        if (!b || !b.billNo || !isSameAgent(b.agent, agentName)) return;
        const norm = normalizeInvoiceNumber(b.billNo);
        if (!confirmedNorms.has(norm) && !basketMap.has(norm)) {
          basketMap.set(norm, b);
        }
      });
      agentBasket = Array.from(basketMap.values());
      if (beatFilter && beatFilter !== 'ALL') {
        agentBasket = agentBasket.filter(b => isSameBeat(b.beat || b.beatName || inferBillBeat(b), beatFilter));
      }
    }

    const leftOutBills = [
      ...agentBills.filter(b => isBillMissingOrPending(b)),
      ...agentBasket.map(b => ({ ...b, isBasket: true, status: 'IN_BASKET' }))
    ];
    const checkedInBills = agentBills.filter(b => b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND');

    let totalAmt = 0, checkedInAmt = 0, leftOutAmt = 0;

    agentBills.forEach(b => totalAmt += (Number(b.amount) || 0));
    agentBasket.forEach(b => totalAmt += (Number(b.amount) || 0));
    checkedInBills.forEach(b => checkedInAmt += getBillCollectedAmount(b));
    leftOutBills.forEach(b => leftOutAmt += getBillPendingAmount(b));

    return {
      agent: agentName,
      totalCount: agentBills.length + agentBasket.length,
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
    const searchInp = document.getElementById('leftOutSearchInput');
    if (!grid || !tbody) return;

    const filterVal = filterSelect ? filterSelect.value : 'ALL';
    const beatVal = beatSelect ? beatSelect.value : 'ALL';
    const searchQuery = (searchInp ? searchInp.value : (State.leftOutSearch || '')).trim().toLowerCase();
    const activeDateFilter = State.diffDateFilter || 'ALL';

    // Highlight active date chip
    document.querySelectorAll('#diffDateFilters .diff-chip').forEach(c => {
      c.classList.toggle('active', (c.dataset.diffDate || 'ALL') === activeDateFilter);
    });

    // Populate Agent filter options with the 3 designated agents
    if (filterSelect) {
      const currentVal = filterSelect.value || 'ALL';
      filterSelect.innerHTML = '<option value="ALL">All Agents (Overview)</option>';
      State.agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.fullName || a.name;
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
        const bt = b.beatName || b.beat || inferBillBeat(b);
        if (bt) knownBeats.add(bt);
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

    // Calculate strip stats for selected date filter, agent & beat filter
    let dateFilteredBills = State.bills;
    if (activeDateFilter !== 'ALL') {
      dateFilteredBills = State.bills.filter(b => matchesDateFilter(b.dispatchDate, activeDateFilter));
    }

    if (filterVal !== 'ALL') {
      dateFilteredBills = dateFilteredBills.filter(b => isSameAgent(b.agent, filterVal));
    }
    if (beatVal !== 'ALL') {
      dateFilteredBills = dateFilteredBills.filter(b => isSameBeat(b.beat || b.beatName || inferBillBeat(b), beatVal));
    }

    let stripDispatchedCount = dateFilteredBills.length;
    let stripDispatchedAmt = dateFilteredBills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    let receivedBills = dateFilteredBills.filter(b => b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND');
    let stripReceivedCount = receivedBills.length;
    let stripReceivedAmt = receivedBills.reduce((s, b) => s + getBillCollectedAmount(b), 0);
    let diffBills = dateFilteredBills.filter(b => isBillMissingOrPending(b));
    let stripDiffCount = diffBills.length;
    let stripDiffAmt = diffBills.reduce((s, b) => s + getBillPendingAmount(b), 0);

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

    // Auto-Reconciliation Live Banner
    const autoReconciledCount = (dateFilteredBills || []).filter(b => b.status === 'PAID_FULL' && b.remarks && b.remarks.includes('Auto-Healed')).length;
    const bannerEl = document.getElementById('diffAutoReconcileBanner');
    const bannerTextEl = document.getElementById('diffAutoReconcileText');
    if (bannerEl && bannerTextEl) {
      bannerEl.style.display = 'flex';
      if (autoReconciledCount > 0) {
        bannerTextEl.innerHTML = `<strong>Auto-Reconciliation Active:</strong> <span class="text-success font-bold">${autoReconciledCount} paid bills</span> automatically reconciled from Sheet and cleared from difference!`;
      } else {
        bannerTextEl.innerHTML = `<strong>Auto-Reconciliation Active:</strong> Live sync with Master Sheet verified (${stripDiffCount} pending / missing bills in view).`;
      }
    }

    let allLeftOutBills = [];

    State.agents.forEach(agent => {
      const stats = getAgentLeftOutStats(agent.name, activeDateFilter, beatVal);
      if (filterVal !== 'ALL' && !isSameAgent(filterVal, agent.name)) return;

      if (stats.leftOutBills.length > 0) {
        allLeftOutBills.push(...stats.leftOutBills);
      }

      // Summary Card
      const card = document.createElement('div');
      card.className = 'leftout-agent-card';
      card.innerHTML = `
        <div class="leftout-agent-head">
          <span class="leftout-agent-name"><i class="fa-solid fa-user"></i> ${agent.name}</span>
          <span class="leftout-count-tag ${stats.leftOutCount > 0 ? 'bg-danger text-white' : ''}">${stats.leftOutCount} Missing / Due</span>
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

    if (searchQuery) {
      allLeftOutBills = allLeftOutBills.filter(b => {
        const bNo = String(b.billNo || '').toLowerCase();
        const party = String(b.party || '').toLowerCase();
        const beat = String(b.beat || b.beatName || inferBillBeat(b) || '').toLowerCase();
        const rec = String(b.receipt || b.refNo || '').toLowerCase();
        return bNo.includes(searchQuery) || party.includes(searchQuery) || beat.includes(searchQuery) || rec.includes(searchQuery);
      });
    }

    // Sort missing bills by Aging (oldest first), then by Pending Due amount (highest first)
    allLeftOutBills.sort((a, b) => {
      const ageDiff = getBillAgingDays(b) - getBillAgingDays(a);
      if (ageDiff !== 0) return ageDiff;
      return getBillPendingAmount(b) - getBillPendingAmount(a);
    });

    // Populate Left Out Table (capped at top 100 rows for instant DOM rendering)
    if (allLeftOutBills.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="9">🎉 Zero missing/pending bills for this filter! All dispatched bills are accounted for.</td></tr>`;
    } else {
      const fragment = document.createDocumentFragment();
      const displayBills = allLeftOutBills.slice(0, 100);
      displayBills.forEach(b => {
        const tr = document.createElement('tr');
        const resolvedBeat = b.beat || b.beatName || inferBillBeat(b) || '';
        const beatTag = resolvedBeat ? `<div style="font-size:0.75rem; color:#64748b; margin-top:2px;"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(resolvedBeat)}</div>` : '';
        const { receiptBadge, paymentBadge } = renderBillPaymentBadgesHtml(b);
        const pendingDue = getBillPendingAmount(b);
        const ageDays = getBillAgingDays(b);
        let ageBadgeHtml = `<span class="aging-pill aging-fresh">Today (0d)</span>`;
        if (ageDays > 7) {
          ageBadgeHtml = `<span class="aging-pill aging-critical"><i class="fa-solid fa-fire"></i> ${ageDays}d overdue</span>`;
        } else if (ageDays > 3) {
          ageBadgeHtml = `<span class="aging-pill aging-warn"><i class="fa-solid fa-clock"></i> ${ageDays}d in field</span>`;
        } else if (ageDays >= 1) {
          ageBadgeHtml = `<span class="aging-pill aging-fresh">${ageDays}d ago</span>`;
        }
        tr.innerHTML = `
          <td><strong class="font-mono text-danger">${escapeHtml(b.billNo)}</strong></td>
          <td><strong>${escapeHtml(b.agent)}</strong>${beatTag}</td>
          <td>${escapeHtml(b.party)}</td>
          <td class="font-mono">${formatINR(b.amount)}</td>
          <td class="font-mono font-bold text-danger">${formatINR(pendingDue)}</td>
          <td><div>${b.dispatchDate || '-'}</div><div style="margin-top:2px;">${ageBadgeHtml}</div></td>
          <td>${receiptBadge}</td>
          <td>${paymentBadge}</td>
          <td>
            <div style="display:flex; gap:4px;">
              <button class="btn btn-success btn-sm" data-table-checkin="${escapeHtml(b.billNo)}" title="Mark Received / Paid">
                <i class="fa-solid fa-check"></i> Receive
              </button>
              <button class="btn btn-outline btn-sm" data-table-paymodal="${escapeHtml(b.billNo)}" title="Record Partial / Custom Payment">
                ₹
              </button>
            </div>
          </td>
        `;
        fragment.appendChild(tr);
      });
      if (allLeftOutBills.length > 100) {
        const moreTr = document.createElement('tr');
        moreTr.className = 'empty-row';
        moreTr.innerHTML = `<td colspan="9" style="text-align:center; font-weight:600; color:var(--text-muted);">Showing top 100 of ${allLeftOutBills.length} missing/pending bills (sorted by oldest field age). Use the search box or agent/beat filter above to narrow down.</td>`;
        fragment.appendChild(moreTr);
      }
      tbody.appendChild(fragment);
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
          b.collectedAmt = Number(b.amount) || 0;
          b.outstanding = 0;
          b.remarks = 'Directly received from Difference list';
          b.lastActionDate = new Date().toISOString();
          if (!b.receipt) {
            const mm = findMasterBill(b.billNo);
            if (mm) {
              b.receipt = mm.receipt || b.receipt;
              b.refNo = mm.receipt || b.refNo;
              if (mm.party && mm.party !== 'Customer') b.party = mm.party;
              if (mm.amount) b.amount = mm.amount;
            } else {
              fetchSingleBillDetailsFromSheet(b.billNo, 'SETTLEMENT');
            }
          }
          saveState();
          updateGlobalStats();
          renderLeftOutTab();
          updateHomeStats();
          loadSettlementForSelectedAgent();
          SoundFX.playBeep('success');
          showToast(`Received ${b.billNo}`, 'success');
        }
      });
    });

    tbody.querySelectorAll('[data-table-paymodal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const b = State.bills.find(item => item.billNo === btn.dataset.tablePaymodal);
        if (b) openPaymentModal(b);
      });
    });

    // Alert tab badge
    const alertTabBtn = document.querySelector('[data-tab="tab-leftout"]');
    if (alertTabBtn) {
      alertTabBtn.classList.toggle('has-leftout', allLeftOutBills.length > 0);
    }

    // Render Missed Bills Report
    renderMissedBillsReport(filterVal, beatVal, searchQuery);
  }

  /**
   * Helper to get all Undispatched Sheet Due Bills (uses pre-indexed State.masterDueBills for <1ms lookup).
   */
  function getUndispatchedSheetDueBills(selectedAgent = 'ALL', selectedBeat = 'ALL', searchQuery = '') {
    if (!State.masterSheetBills || State.masterSheetBills.length === 0) {
      return { missed: [], paidExcludedCount: 0 };
    }
    if (!State.masterDueBills) {
      rebuildMasterSheetMap();
    }

    const custodyNorms = new Set(
      (State.bills || []).map(b => b._normBillNo || (b._normBillNo = normalizeInvoiceNumber(b.billNo))).filter(Boolean)
    );
    const basketNorms = new Set(
      (State.dispatchBasket || []).map(b => b._normBillNo || (b._normBillNo = normalizeInvoiceNumber(b.billNo))).filter(Boolean)
    );

    const missed = [];
    const q = (searchQuery || '').trim().toLowerCase();
    const dueSource = State.masterDueBills || [];

    for (let i = 0; i < dueSource.length; i++) {
      const b = dueSource[i];
      if (selectedAgent !== 'ALL' && !isSameAgent(b._canonAgent || b.agent, selectedAgent)) {
        continue;
      }
      if (selectedBeat !== 'ALL' && !isSameBeat(b.beat, selectedBeat)) {
        continue;
      }
      const norm = b._normBillNo || (b._normBillNo = normalizeInvoiceNumber(b.billNo));
      if (custodyNorms.has(norm) || basketNorms.has(norm)) {
        continue;
      }
      if (q) {
        const billNoStr = String(b.billNo || '').toLowerCase();
        const partyStr = String(b.party || '').toLowerCase();
        const beatStr = String(b.beat || '').toLowerCase();
        if (!billNoStr.includes(q) && !partyStr.includes(q) && !beatStr.includes(q)) continue;
      }
      missed.push(b);
    }

    return { missed, paidExcludedCount: State.masterPaidExcludedCount || 0 };
  }

  /**
   * Missed Bills Report: Identifies DUE bills assigned in Master Sheet that are not in custody.
   * Strictly EXCLUDES all bills that are Paid in Full or Settled.
   */
  function renderMissedBillsReport(selectedAgent = 'ALL', selectedBeat = 'ALL', searchQuery = '') {
    const box = document.getElementById('missedBillsBox');
    const countEl = document.getElementById('missedBillsCount');
    const listEl = document.getElementById('missedBillsList');
    if (!box || !countEl || !listEl) return;

    if (!State.masterSheetBills || State.masterSheetBills.length === 0) {
      box.style.display = 'none';
      return;
    }

    const { missed, paidExcludedCount } = getUndispatchedSheetDueBills(selectedAgent, selectedBeat, searchQuery);

    countEl.textContent = missed.length;
    box.style.display = missed.length > 0 ? 'block' : 'none';

    // Update subtitle to clearly show that paid bills are excluded
    const subEl = box.querySelector('.missed-sub');
    if (subEl) {
      const totalMissedDue = missed.reduce((s, b) => s + (Number(b.outstanding) || Number(b.amount) || 0), 0);
      subEl.innerHTML = `Assigned in Master Sheet with pending balance (${formatINR(totalMissedDue)}), not yet dispatched &bull; <strong style="color:var(--success);">${paidExcludedCount} paid bills excluded</strong>`;
    }

    listEl.innerHTML = '';
    missed.slice(0, 60).forEach(b => {
      const item = document.createElement('div');
      item.className = 'missed-bill-item';
      const outstanding = Number(b.outstanding) || Number(b.amount) || 0;
      const receipt = String(b.receipt || '').trim();
      let statusBadge = '';
      if (receipt) {
        statusBadge = `<span class="badge-partial">⚠️ Partial (${formatINR(outstanding)})</span>`;
      } else {
        statusBadge = `<span class="badge-pending">🔴 Due (${formatINR(outstanding)})</span>`;
      }

      item.innerHTML = `
        <div class="missed-bill-info">
          <div class="missed-bill-top">
            <strong class="font-mono text-danger">${escapeHtml(b.billNo)}</strong>
            ${statusBadge}
            <span class="badge-receipt"><i class="fa-solid fa-user"></i> ${escapeHtml(b.agent || 'Agent')}${b.beat ? ` • ${escapeHtml(b.beat)}` : ''}</span>
          </div>
          <span class="missed-bill-party">${escapeHtml(b.party || 'Customer')} &bull; Bill: ${formatINR(b.amount)}</span>
        </div>
        <div class="missed-bill-action">
          <button class="btn btn-outline-danger btn-sm" data-dispatch-missed="${escapeHtml(b.billNo)}">
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
    const stats = getAgentLeftOutStats(agentName, State.diffDateFilter || 'ALL');
    const agentObj = State.agents.find(a => isSameAgent(a.name, agentName));
    const phone = agentObj ? agentObj.phone : '';

    if (stats.leftOutBills.length === 0) {
      showToast(`No missing/pending bills for ${agentName}`, 'info');
      return;
    }

    const billLines = stats.leftOutBills.map((b, i) => {
      const due = getBillPendingAmount(b);
      const age = getBillAgingDays(b);
      return `${i + 1}. *${b.billNo}*: ${b.party} (Due: ${formatINR(due)}, ${age}d in field)${b.refNo ? ` [Receipt: ${b.refNo}]` : ''}`;
    }).join('\n');

    const msg = 
`*⚠️ PENDING / MISSING BILLS AUDIT REPORT*
*Agent:* ${agentName}
*Date:* ${getTodayDateString()}
-------------------------
📦 *Total Dispatched:* ${stats.totalCount} bills (${formatINR(stats.totalAmt)})
✅ *Checked IN / Paid:* ${stats.checkedInCount} bills (${formatINR(stats.checkedInAmt)})
⚠️ *REMAINING WITH YOU:* ${stats.leftOutCount} bills (${formatINR(stats.leftOutAmt)})

*List of Missing / Pending Bills to Account For:*
${billLines}
-------------------------
Please reconcile payments or return signed copies immediately.
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
      const agentsWithLeftOut = State.agents.filter(a => getAgentLeftOutStats(a.name, 'ALL').leftOutCount > 0);
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
   * Auto-Reconciles Live Custody (State.bills) with Master Sheet (State.masterSheetBills)
   * Also backfills missing beat, party, amount, agent, receipt, and outstanding fields
   * on all custody bills so Beat Analysis, Evening Return, and Missing Bills Dashboard have complete data.
   */
  function reconcileCustodyWithMasterSheet() {
    if (!State.bills || State.bills.length === 0) return { healedCount: 0, partialCount: 0 };

    let healedCount = 0;
    let partialCount = 0;
    const nowIST = new Date().toISOString();

    State.bills.forEach(b => {
      if (!b || !b.billNo) return;

      const mm = (State.masterSheetBills && State.masterSheetBills.length > 0) ? findMasterBill(b.billNo) : null;

      // Always backfill missing metadata (Beat, Party, Amount, Canonical Agent) on every bill
      if (mm) {
        if ((!b.party || b.party === 'Standard Customer' || b.party === 'Customer') && mm.party) {
          b.party = mm.party;
        }
        if ((!b.amount || Number(b.amount) === 0) && Number(mm.amount) > 0) {
          b.amount = Number(mm.amount);
        }
        if (!b.beat && !b.beatName && mm.beat) {
          b.beat = mm.beat;
        }
        if ((!b.agent || b.agent === 'Sales Agent') && mm.agent) {
          b.agent = mm.agent;
        }
        if (!b.receipt && mm.receipt) {
          b.receipt = mm.receipt;
        }
      }

      // Normalize agent name to canonical Rajesh / Shivam / Self
      if (b.agent) {
        if (isSameAgent(b.agent, 'Shivam')) b.agent = 'Shivam';
        else if (isSameAgent(b.agent, 'Rajesh')) b.agent = 'Rajesh';
        else if (isSameAgent(b.agent, 'Self')) b.agent = 'Self';
      }

      // If beat is still empty, infer from Agent + Dispatch Date day-of-week schedule
      if (!b.beat && !b.beatName) {
        const inferredBeat = inferBillBeat(b);
        if (inferredBeat) b.beat = inferredBeat;
      }

      if (!mm) return;

      const isPending = (b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT' || b.status === 'LEFT_OUT_ALERT');
      if (!isPending) return;

      const amt = Number(b.amount) || Number(mm.amount) || 0;
      const masterOut = (mm.outstanding !== undefined && mm.outstanding !== null && mm.outstanding !== '') ? Number(mm.outstanding) : null;
      const masterStat = String(mm.status || '').toUpperCase();
      const masterReceipt = String(mm.receipt || mm.refNo || '').trim();
      const isPaidRemark = /^PAID/i.test(masterReceipt);

      const isFullPaid = (masterStat === 'PAID') ||
                         (masterOut !== null && masterOut <= 0 && (amt > 0 || masterReceipt || isPaidRemark)) ||
                         isPaidRemark;

      const isPartial = !isFullPaid && (
        masterStat === 'PARTIAL' ||
        (masterOut !== null && masterOut > 0 && masterOut < amt) ||
        (masterReceipt && masterOut !== null && masterOut > 0)
      );

      if (isFullPaid) {
        b.status = 'PAID_FULL';
        b.collectedAmt = amt;
        b.outstanding = 0;
        b.paymentMode = masterReceipt || 'Sheet Verified';
        b.refNo = masterReceipt || 'PAID IN SHEET';
        b.returnReason = '';
        b.remarks = `Auto-Healed: Verified Paid on Master Sheet (${masterReceipt || 'Paid'})`;
        b.lastActionDate = nowIST;
        healedCount++;
      } else if (isPartial) {
        b.status = 'PAID_PARTIAL';
        const coll = Math.max(0, amt - masterOut);
        b.collectedAmt = coll;
        b.outstanding = masterOut;
        if (masterReceipt) {
          b.paymentMode = masterReceipt;
          b.refNo = masterReceipt;
        }
        b.remarks = `Auto-Healed: Partial on Master Sheet (Paid: ₹${coll}, Due: ₹${masterOut})`;
        b.lastActionDate = nowIST;
        partialCount++;
      } else if (masterOut !== null && masterOut > 0) {
        b.outstanding = masterOut;
      }
    });

    if (healedCount > 0 || partialCount > 0) {
      console.log(`[Auto-Reconciliation] Healed ${healedCount} paid bills and ${partialCount} partial bills from Master Sheet!`);
    }

    return { healedCount, partialCount };
  }

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

          let dDate = cb.dispatchDate ? normalizeDateString(cb.dispatchDate) : '';
          const todayStr = getTodayDateString();
          if (dDate === todayStr && cb.lastActionDate) {
            const actionDay = normalizeDateString(cb.lastActionDate);
            if (actionDay && actionDay !== todayStr) {
              dDate = actionDay;
            }
          }

          const mm = findMasterBill(cb.billNo);
          let rawAgent = cb.agent || (mm && mm.agent) || 'Rajesh';
          if (isSameAgent(rawAgent, 'Shivam')) rawAgent = 'Shivam';
          else if (isSameAgent(rawAgent, 'Self')) rawAgent = 'Self';
          else rawAgent = 'Rajesh';

          const formattedBill = {
            billNo: cb.billNo,
            party: (cb.party && cb.party !== 'Standard Customer') ? cb.party : ((mm && mm.party) || cb.party || 'Standard Customer'),
            amount: Number(cb.amount) || (mm ? Number(mm.amount) : 0) || 0,
            agent: rawAgent,
            beat: cb.beat || (mm && mm.beat) || '',
            dispatchDate: dDate,
            status: cb.status || 'WITH_AGENT',
            collectedAmt: Number(cb.collectedAmt) || 0,
            outstanding: cb.outstanding !== undefined ? Number(cb.outstanding) : (Number(cb.amount) || 0),
            paymentMode: cb.paymentMode || '',
            refNo: cb.refNo || (mm && mm.receipt) || '',
            receipt: (mm && mm.receipt) || cb.refNo || '',
            returnReason: cb.returnReason || '',
            remarks: cb.remarks || '',
            lastActionDate: cb.lastActionDate || new Date().toISOString(),
            history: []
          };
          if (!formattedBill.beat) {
            formattedBill.beat = inferBillBeat(formattedBill);
          }

          if (existingIdx !== undefined) {
            const b = State.bills[existingIdx];
            b.party = formattedBill.party || b.party;
            b.amount = formattedBill.amount || b.amount;
            b.agent = formattedBill.agent || b.agent;
            b.beat = formattedBill.beat || b.beat;
            b.status = formattedBill.status;
            b.collectedAmt = formattedBill.collectedAmt;
            b.outstanding = formattedBill.outstanding;
            b.paymentMode = formattedBill.paymentMode;
            b.refNo = formattedBill.refNo || b.refNo;
            b.receipt = formattedBill.receipt || b.receipt;
            b.remarks = formattedBill.remarks;
            b.lastActionDate = formattedBill.lastActionDate;
            if (dDate) b.dispatchDate = dDate;
            updatedCount++;
          } else {
            State.bills.push(formattedBill);
            existingMap.set(norm, State.bills.length - 1);
            newCount++;
          }
        });

        const reconcileRes = reconcileCustodyWithMasterSheet();
        saveState('bills');
        updateGlobalStats();
        if (State.activeTab === 'tab-leftout') renderLeftOutTab();
        else if (State.activeTab === 'tab-ledger') renderMasterLedger();
        else if (State.activeTab === 'tab-settlement') loadSettlementForSelectedAgent();
        updateHomeStats();

        if (showFeedback) {
          SoundFX.playBeep('success');
          let toastMsg = `Synced ${custodyBills.length} custody bills from Tracking Sheet!`;
          if (reconcileRes.healedCount > 0) {
            toastMsg += ` (${reconcileRes.healedCount} paid bills auto-cleared)`;
          }
          showToast(toastMsg, 'success');
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

    saveState('bills');
    updateGlobalStats();
    renderLeftOutTab();
    updateHomeStats();
    analyzeAndRenderPaymentReconciliation();
    syncCustodyToTrackingSheet();

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

      completedCount++;
      totalAmt += (Number(b.collectedAmt) || Number(b.amount) || 0);
    });

    saveState('bills');
    updateGlobalStats();
    renderLeftOutTab();
    updateHomeStats();
    analyzeAndRenderPaymentReconciliation();
    syncCustodyToTrackingSheet();

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
      if (State.masterAgentBeatsMap && State.masterAgentBeatsMap.ALL) {
        State.masterAgentBeatsMap.ALL.forEach(bName => knownBeats.add(bName));
      }
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

    // Fast O(1) map for custody lookup
    const todayCustodyMap = new Map();
    State.bills.forEach(b => {
      const norm = b._normBillNo || (b._normBillNo = normalizeInvoiceNumber(b.billNo));
      todayCustodyMap.set(norm, b);
      todayCustodyMap.set(b.billNo.toUpperCase(), b);
    });

    const results = [];
    const limit = 60;

    for (let i = 0; i < sourceBills.length; i++) {
      const b = sourceBills[i];
      if (!b || !b.billNo) continue;

      // Agent filter first (fast check)
      const bAgent = b._canonAgent || String(b.agent || '').trim();
      if (agentFilter !== 'ALL' && !isSameAgent(bAgent, agentFilter)) {
        continue;
      }

      // Search filter (Invoice or Party)
      if (search) {
        const billNoStr = String(b.billNo).toLowerCase();
        const partyStr = String(b.party || '').toLowerCase();
        if (!billNoStr.includes(search) && !partyStr.includes(search)) {
          continue;
        }
      }

      // Payment & Custody Status filter
      const outstanding = (b.outstanding !== undefined && b.outstanding !== null) ? Number(b.outstanding) : 0;
      const receipt = String(b.receipt || '').trim();
      const norm = b._normBillNo || (b._normBillNo = normalizeInvoiceNumber(b.billNo));
      const custodyRecord = todayCustodyMap.get(norm) || todayCustodyMap.get(b.billNo.toUpperCase());

      // Beat filter
      if (beatFilter !== 'ALL') {
        const matchBeat = isSameBeat(b.beat, beatFilter) ||
          (custodyRecord && isSameBeat(custodyRecord.beat || custodyRecord.beatName || inferBillBeat(custodyRecord), beatFilter));
        if (!matchBeat) {
          continue;
        }
      }

      if (statusFilter === 'PAID') {
        if (outstanding > 0 && !isBillPaidInFull(b)) continue;
      } else if (statusFilter === 'PARTIAL') {
        if (outstanding <= 0 || !receipt || isBillPaidInFull(b)) continue;
      } else if (statusFilter === 'PENDING') {
        if (outstanding <= 0 || receipt || isBillPaidInFull(b)) continue;
      } else if (statusFilter === 'DISPATCHED') {
        if (!custodyRecord || !isBillUnreturnedInField(custodyRecord)) continue;
      } else if (statusFilter === 'RECEIVED') {
        if (!custodyRecord || !(custodyRecord.status === 'RECEIVED' || custodyRecord.status === 'PAID_FULL' || custodyRecord.status === 'PAID_PARTIAL' || custodyRecord.status === 'RETURNED_IN_HAND')) continue;
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

  let syncDebounceTimer = null;

  function queueSyncAction(type, payload) {
    State.offlineQueue.push({
      id: 'Q-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      type,
      timestamp: new Date().toISOString(),
      payload
    });
    saveState('queue');
    updateOfflineQueueBadge();

    const targetUrl = State.settings.trackingSheetScriptUrl || State.settings.scriptUrl;
    if (navigator.onLine && targetUrl) {
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
      syncDebounceTimer = setTimeout(() => {
        processOfflineQueue();
      }, 350);
    }
  }

  async function processOfflineQueue() {
    const targetUrl = State.settings.trackingSheetScriptUrl || State.settings.scriptUrl;
    if (!targetUrl || State.offlineQueue.length === 0) return;
    if (State.isSyncing) return;

    State.isSyncing = true;
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
        const processedIds = new Set(queueSnapshot.map(item => item.id));
        State.offlineQueue = State.offlineQueue.filter(item => !processedIds.has(item.id));
        saveState('queue');
        updateOfflineQueueBadge();
        if (text) text.textContent = 'Synced';
        showToast('Tracking Sheet updated successfully!', 'success');
      }
    } catch (e) {
      console.warn('Sync failed, queued offline:', e);
      if (text) text.textContent = 'Queued';
    } finally {
      State.isSyncing = false;
      if (btn) btn.classList.remove('syncing');
      if (State.offlineQueue.length > 0 && navigator.onLine) {
        if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
        syncDebounceTimer = setTimeout(() => {
          processOfflineQueue();
        }, 500);
      }
    }
  }

  async function syncCustodyToTrackingSheet() {
    const targetUrl = State.settings.trackingSheetScriptUrl || State.settings.scriptUrl;
    if (!targetUrl || !State.bills || State.bills.length === 0) return;

    try {
      await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'BATCH_SYNC',
          queue: [], // Zero scan-in logs! Only updates Live_Custody & Daily_Summary
          bills: State.bills,
          timestamp: new Date().toISOString()
        })
      });
    } catch (e) {
      console.warn('Background custody sync failed:', e);
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
    const candidateSheetIds = Array.from(new Set([
      sheetId,
      '1aNzEsD0v92fVZtklSj79ZxDtXCkySQxw63HVlydg88g',
      '1BL4AhHPGPubuIh2_H29jRqR48DjclRsA1OAzTDoqsOY',
      '11J3WSXNFfu5aARNMBX3HQazajsfzBjj7wX9MWyVVBRk'
    ].filter(Boolean)));

    // 1. Direct BigTable Visualization API across candidate Master Sheet IDs
    const tq = encodeURIComponent('select D, E, F, L, M, N, O, P, I, J where D is not null');
    for (const candId of candidateSheetIds) {
      if (incomingBills && incomingBills.length > 0) break;
      try {
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${candId}/gviz/tq?tqx=out:json&tq=${tq}&gid=${gid}&t=${Date.now()}`;
        const resp = await fetch(gvizUrl);
        if (resp.ok) {
          const txt = await resp.text();
          const parsed = parseGvizResponse(txt);
          if (parsed && parsed.length > 0) {
            incomingBills = parsed;
            break;
          }
        }
      } catch (gvizErr) {
        console.warn(`[SheetSync] GViz query failed for ${candId}:`, gvizErr);
      }
    }

    // 2. Supplement and bridge recent bills via Apps Script Web App
    // (Google Sheets GViz caps at ~14,000 rows; fetchRecent bridges the gap up to the very latest row)
    const targetUrl = State.settings.mainSheetScriptUrl || State.settings.scriptUrl;
    if (targetUrl) {
      try {
        const recentResp = await fetch(`${targetUrl}?action=fetchRecent&limit=3000&t=${Date.now()}`);
        if (recentResp.ok) {
          const recentData = await recentResp.json();
          if (recentData && Array.isArray(recentData.rows) && recentData.rows.length > 0) {
            const billMap = new Map();
            (incomingBills || []).forEach(b => {
              if (b && b.billNo) billMap.set(normalizeInvoiceNumber(b.billNo), b);
            });
            recentData.rows.forEach(r => {
              const billNo = String(r[2] || '').trim();
              if (!billNo) return;
              const party = String(r[3] || 'General Customer').trim();
              const amt = parseFloat(String(r[4] || '0').replace(/[₹,\s]/g, '')) || 0;
              const out = parseFloat(String(r[8] || '0').replace(/[₹,\s]/g, '')) || 0;
              const rec = String(r[9] || '').trim();
              const rem = String(r[10] || '').trim();
              const beat = String(r[11] || '').trim();
              const agent = String(r[12] || '').trim();
              const norm = normalizeInvoiceNumber(billNo);
              billMap.set(norm, {
                billNo,
                receipt: rec || rem,
                outstanding: out,
                party,
                amount: amt,
                agent,
                beat,
                remainingText: String(r[8] || '')
              });
            });
            incomingBills = Array.from(billMap.values());
          }
        }
      } catch (recentErr) {
        console.warn('[SheetSync] Recent rows fetch failed:', recentErr);
      }
    }

    // 3. Fallback to full Apps Script fetch if neither GViz nor fetchRecent returned bills
    if (!incomingBills || incomingBills.length === 0) {
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

      // Auto-reconcile live custody with latest master sheet payment info
      const reconcileRes = reconcileCustodyWithMasterSheet();
      saveState('bills');

      updateGlobalStats();
      renderAgentSelects();
      if (State.activeTab === 'tab-leftout') renderLeftOutTab();
      else if (State.activeTab === 'tab-ledger') renderMasterLedger();
      updateHomeStats();
      updateMasterSheetUI();

      if (showFeedback) {
        SoundFX.playBeep('success');
        let msg = `⚡ Synced ${incomingBills.length.toLocaleString()} bills from MARCH-SEPT tab!`;
        if (reconcileRes.healedCount > 0) {
          msg += ` (${reconcileRes.healedCount} paid bills auto-cleared from Difference)`;
        }
        showToast(msg, 'success', 3500);
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
      const colAmt = getBillCollectedAmount(b);
      const pendAmt = getBillPendingAmount(b);

      inCustodyCount++;
      inCustodyAmt += amt;

      if (b.status === 'RECEIVED' || b.status === 'PAID_FULL') {
        collectedCount++;
        collectedAmt += colAmt;
      } else if (b.status === 'PAID_PARTIAL') {
        collectedCount++;
        collectedAmt += colAmt;
        if (pendAmt > 0) {
          missingCount++;
          missingAmt += pendAmt;
        }
      } else if (b.status === 'RETURNED_IN_HAND') {
        returnedCount++;
        returnedAmt += amt;
      } else if (isBillUnreturnedInField(b)) {
        missingCount++;
        missingAmt += pendAmt;
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

  // Updates the home tab quick stats strip, agent difference cards & Decision Analysis Center
  function updateHomeStats() {
    const filterMode = State.homeDateFilter || 'ALL';
    const customDate = State.homeCustomDate;

    // Filter bills according to active date filter (ALL, TODAY, YESTERDAY, OVERDUE, or CUSTOM)
    const filteredBills = State.bills.filter(b => matchesDateFilter(b.dispatchDate, filterMode, customDate));

    // Deduplicate basket items against confirmed bills and against itself to guarantee exact counts
    const confirmedBillNorms = new Set(filteredBills.map(b => normalizeInvoiceNumber(b.billNo)).filter(Boolean));
    const basketMap = new Map();
    if ((filterMode === 'TODAY' || filterMode === 'ALL') && State.dispatchBasket && State.dispatchBasket.length > 0) {
      State.dispatchBasket.forEach(b => {
        if (!b || !b.billNo) return;
        const norm = normalizeInvoiceNumber(b.billNo);
        if (!confirmedBillNorms.has(norm) && !basketMap.has(norm)) {
          basketMap.set(norm, b);
        }
      });
    }
    const uniqueBasketBills = Array.from(basketMap.values());
    const basketCount = uniqueBasketBills.length;
    const basketAmt = uniqueBasketBills.reduce((s, b) => s + (Number(b.amount) || 0), 0);

    const outCount = filteredBills.length + basketCount;
    const inBills = filteredBills.filter(b => b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND');
    const inCount = inBills.length;
    const diffBills = filteredBills.filter(b => isBillMissingOrPending(b));
    const diffCount = diffBills.length + basketCount;

    const outAmt = filteredBills.reduce((s, b) => s + (Number(b.amount) || 0), 0) + basketAmt;
    const inAmt = inBills.reduce((s, b) => s + getBillCollectedAmount(b), 0);
    const diffAmt = diffBills.reduce((s, b) => s + getBillPendingAmount(b), 0) + basketAmt;

    // Active Handover Basket banner on Home tab
    const banner = document.getElementById('homeBasketPendingBanner');
    const bannerCnt = document.getElementById('bannerBasketCount');
    const bannerAmt = document.getElementById('bannerBasketAmt');
    if (banner) {
      if (basketCount > 0) {
        banner.style.display = 'flex';
        if (bannerCnt) bannerCnt.textContent = basketCount;
        if (bannerAmt) bannerAmt.textContent = `(${formatINR(basketAmt)})`;
      } else {
        banner.style.display = 'none';
      }
    }

    const elOut = document.getElementById('homeStatOut');
    const elIn = document.getElementById('homeStatIn');
    const elLeft = document.getElementById('homeStatLeft');
    if (elOut) animateNumber(elOut, outCount);
    if (elIn) animateNumber(elIn, inCount);
    if (elLeft) animateNumber(elLeft, diffCount);

    const elOutAmt = document.getElementById('homeStatOutAmt');
    const elInAmt = document.getElementById('homeStatInAmt');
    const elLeftAmt = document.getElementById('homeStatLeftAmt');
    if (elOutAmt) {
      if (basketCount > 0) {
        elOutAmt.textContent = `${formatINR(outAmt)} (${basketCount} in basket ready)`;
      } else {
        elOutAmt.textContent = `${formatINR(outAmt)} dispatched`;
      }
    }
    if (elInAmt) elInAmt.textContent = `${formatINR(inAmt)} accounted`;
    const partialBackCount = inBills.filter(b => isBillMissingOrPending(b)).length;
    const inFooter = document.querySelector('#homeInCardPro .card-pro-footer');
    if (inFooter && inFooter.firstChild) {
      inFooter.firstChild.textContent = partialBackCount > 0
        ? `Bills returned or collected — ${partialBackCount} part-paid still counted in Difference `
        : 'Bills returned or collected safely ';
    }
    if (elLeftAmt) {
      if (basketCount > 0 && diffBills.length === 0) {
        elLeftAmt.textContent = `${formatINR(diffAmt)} in basket ready`;
      } else {
        elLeftAmt.textContent = `${formatINR(diffAmt)} still pending`;
      }
    }

    // Global missing count for sidebar badge
    const totalMissingCount = State.bills.filter(b => isBillMissingOrPending(b)).length + basketCount;
    const sideBadge = document.getElementById('sidebarDiffBadge');
    if (sideBadge) {
      sideBadge.textContent = totalMissingCount;
      sideBadge.style.display = totalMissingCount > 0 ? 'inline-flex' : 'none';
    }

    // Highlight active chip in home date filter bar
    document.querySelectorAll('#homeDateFilters .home-date-chip').forEach(chip => {
      const mode = chip.dataset.homeDate;
      chip.classList.toggle('active', mode === filterMode);
    });

    // Custom date picker sync
    const customPicker = document.getElementById('homeCustomDatePicker');
    if (customPicker && filterMode === 'CUSTOM' && customDate) {
      customPicker.value = customDate;
    }

    // Dynamic Title, Hint & Date Badge
    const titleEl = document.getElementById('homeCustodySectionTitle');
    const hintEl = document.getElementById('homeCustodySectionHint');
    const dateBadge = document.getElementById('homeDateBadge');

    if (filterMode === 'TODAY') {
      const now = new Date();
      const formatted = now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
      if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-chart-simple"></i> Today's Custody Status`;
      if (hintEl) hintEl.textContent = `Live totals for Today (${formatted})`;
      if (dateBadge) dateBadge.textContent = `Today · ${formatted}`;
    } else if (filterMode === 'YESTERDAY') {
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      const formatted = yest.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
      if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Yesterday's Custody Status`;
      if (hintEl) hintEl.textContent = `Custody totals for Yesterday (${formatted})`;
      if (dateBadge) dateBadge.textContent = `Yesterday · ${formatted}`;
    } else if (filterMode === 'OVERDUE') {
      if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-fire-flame-curved text-danger"></i> Overdue Custody Status (&gt;3 Days)`;
      if (hintEl) hintEl.textContent = `Bills dispatched more than 3 days ago`;
      if (dateBadge) dateBadge.textContent = 'Overdue (>3d)';
    } else if (filterMode === 'ALL') {
      if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-layer-group"></i> All Active Custody Status`;
      if (hintEl) hintEl.textContent = `Cumulative totals across all recorded dates`;
      if (dateBadge) dateBadge.textContent = `All Active Custody`;
    } else if (filterMode === 'CUSTOM' && customDate) {
      if (titleEl) titleEl.innerHTML = `<i class="fa-regular fa-calendar"></i> Custody Status for ${customDate}`;
      if (hintEl) hintEl.textContent = `Historical custody totals for selected date`;
      if (dateBadge) dateBadge.textContent = `Date: ${customDate}`;
    }

    // High-contrast alert card styling if difference > 0
    const diffCard = document.getElementById('homeDiffCardPro');
    const diffFooter = document.getElementById('homeDiffFooter');
    if (diffCard) {
      if (diffCount > 0) {
        diffCard.classList.add('has-alert');
        if (diffFooter) diffFooter.innerHTML = `<span class="text-danger font-bold">⚠️ ${diffCount} bills missing / pending</span> — Click to Audit`;
      } else {
        diffCard.classList.remove('has-alert');
        if (diffFooter) diffFooter.innerHTML = `<span class="text-success font-bold">✓ Zero differences</span> — All accounted`;
      }
    }

    vizTips.clear();
    ensureVizTooltip();
    renderStatusLegends();
    const basketAsCustody = uniqueBasketBills.map(b => ({ ...b, status: 'IN_BASKET' }));
    renderAgentRecoveryChart([...filteredBills, ...basketAsCustody]);
    const custodyNorms = new Set(State.bills.map(b => normalizeInvoiceNumber(b.billNo)));
    const trendBasket = (State.dispatchBasket || []).filter(b => b && b.billNo && !custodyNorms.has(normalizeInvoiceNumber(b.billNo)));
    renderTrendChart([...State.bills, ...trendBasket.map(b => ({ ...b, status: 'IN_BASKET' }))]);

    // Render Home Agent Difference Cards
    const diffGrid = document.getElementById('homeAgentDiffGrid');
    if (diffGrid) {
      diffGrid.innerHTML = '';
      State.agents.forEach(agent => {
        const stats = getAgentLeftOutStats(agent.name, filterMode, null, customDate);
        const card = document.createElement('div');
        card.className = 'agent-diff-card clickable-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.title = `Click to view breakdown for ${agent.name}`;
        card.innerHTML = `
          <div class="agent-diff-header">
            <span><i class="fa-solid fa-user-tie"></i> ${escapeHtml(agent.name)}</span>
            <span class="count-pill ${stats.leftOutCount > 0 ? 'bg-danger text-white' : ''}" style="font-size:0.75rem;">
              ${stats.leftOutCount} Missing / Due
            </span>
          </div>
          <div class="agent-diff-metric">
            <span class="agent-diff-val ${stats.leftOutCount > 0 ? 'has-diff text-danger' : 'text-success'}">
              ${formatINR(stats.leftOutAmt)}
            </span>
            <span class="agent-diff-sub">Dispatched: ${stats.totalCount} | Accounted: ${stats.checkedInCount}</span>
          </div>
          <div class="card-click-hint" style="display: flex; justify-content: space-between; align-items: center;">
            <span><i class="fa-solid fa-list"></i> Bills List</span>
            <button type="button" class="btn btn-xs btn-outline-primary agent-beat-analysis-btn" data-beat-agent="${escapeHtml(agent.name)}" style="padding: 2px 8px; font-weight: 700;">
              <i class="fa-solid fa-chart-pie"></i> Beat Analysis
            </button>
          </div>
        `;
        const baBtn = card.querySelector('.agent-beat-analysis-btn');
        baBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          openBeatAnalysisModal(agent.name);
        });
        card.addEventListener('click', () => openDashboardBreakdown('AGENT', agent.name));
        diffGrid.appendChild(card);
      });
    }

    renderDecisionAnalysisCenter();
  }

  // ========================================================
  // EXECUTIVE DECISION & MISSING BILLS INTELLIGENCE CENTER
  // ========================================================

  function renderDecisionAnalysisCenter() {
    const allBills = State.bills || [];
    // Basket items already locked into custody must not be counted twice
    const custodyNorms = new Set(allBills.map(b => normalizeInvoiceNumber(b.billNo)));
    const basketItems = (State.dispatchBasket || [])
      .filter(b => b && b.billNo && !custodyNorms.has(normalizeInvoiceNumber(b.billNo)))
      .map(b => ({ ...b, isBasket: true, status: 'IN_BASKET' }));
    const combinedCustody = [...allBills, ...basketItems];

    // 1. Unreturned in field (WITH_AGENT, MISSING_ALERT, LEFT_OUT_ALERT, IN_BASKET)
    const unreturnedBills = combinedCustody.filter(b => isBillUnreturnedInField(b));
    const unreturnedAmt = unreturnedBills.reduce((s, b) => s + getBillPendingAmount(b), 0);

    // 2. Overdue (> 3 days in field and still unreturned or partial due)
    const overdueBills = combinedCustody.filter(b => isBillMissingOrPending(b) && getBillAgingDays(b) > 3);
    const overdueAmt = overdueBills.reduce((s, b) => s + getBillPendingAmount(b), 0);

    // 3. Partial Balance Due (PAID_PARTIAL or has partial collection with remaining due > 0)
    const partialBills = combinedCustody.filter(b => {
      const pend = getBillPendingAmount(b);
      const coll = getBillCollectedAmount(b);
      return pend > 0 && (b.status === 'PAID_PARTIAL' || coll > 0);
    });
    const partialAmt = partialBills.reduce((s, b) => s + getBillPendingAmount(b), 0);

    // 4. Undispatched Sheet Dues (Missed in Master Sheet)
    const { missed: missedSheetBills } = getUndispatchedSheetDueBills('ALL', 'ALL', '');
    const missedSheetAmt = missedSheetBills.reduce((s, b) => s + (Number(b.outstanding) || Number(b.amount) || 0), 0);

    // Update 4 Decision KPI Cards
    const elUnretCnt = document.getElementById('decKpiUnreturnedCount');
    const elUnretAmt = document.getElementById('decKpiUnreturnedAmt');
    const elOverCnt = document.getElementById('decKpiOverdueCount');
    const elOverAmt = document.getElementById('decKpiOverdueAmt');
    const elPartCnt = document.getElementById('decKpiPartialCount');
    const elPartAmt = document.getElementById('decKpiPartialAmt');
    const elMissCnt = document.getElementById('decKpiMissedCount');
    const elMissAmt = document.getElementById('decKpiMissedAmt');

    if (elUnretCnt) elUnretCnt.textContent = unreturnedBills.length;
    if (elUnretAmt) elUnretAmt.textContent = formatINR(unreturnedAmt);
    if (elOverCnt) elOverCnt.textContent = overdueBills.length;
    if (elOverAmt) elOverAmt.textContent = formatINR(overdueAmt);
    if (elPartCnt) elPartCnt.textContent = partialBills.length;
    if (elPartAmt) elPartAmt.textContent = formatINR(partialAmt);
    if (elMissCnt) elMissCnt.textContent = missedSheetBills.length;
    if (elMissAmt) elMissAmt.textContent = formatINR(missedSheetAmt);

    // Update Tab Counts
    const tUnret = document.getElementById('decTabCntUnreturned');
    const tOver = document.getElementById('decTabCntOverdue');
    const tPart = document.getElementById('decTabCntPartial');
    const tMiss = document.getElementById('decTabCntMissed');
    if (tUnret) tUnret.textContent = unreturnedBills.length;
    if (tOver) tOver.textContent = overdueBills.length;
    if (tPart) tPart.textContent = partialBills.length;
    if (tMiss) tMiss.textContent = missedSheetBills.length;

    const totalActionItems = unreturnedBills.length + partialBills.length;
    const actionBadge = document.getElementById('decisionTotalActionBadge');
    if (actionBadge) {
      actionBadge.textContent = `${totalActionItems} Actionable Custody Bills • ${formatINR(unreturnedAmt + partialAmt)} Pending`;
    }

    // Highlight active KPI card and Tab
    const activeTab = State.homeDecisionTab || 'UNRETURNED';
    document.querySelectorAll('.decision-kpi-card').forEach(c => {
      c.classList.toggle('active', c.dataset.decisionTab === activeTab);
    });
    document.querySelectorAll('#homeDecisionTabs .decision-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.decTab === activeTab);
    });

    // Aging & bottleneck-route charts across all missing/pending custody bills
    const allMissingCustody = combinedCustody.filter(b => isBillMissingOrPending(b));
    renderAgingAndRouteCharts(allMissingCustody);

    // Render the Interactive Decision Action Table
    const tbody = document.getElementById('homeDecisionTbody');
    if (!tbody) return;

    const agentFilter = State.homeDecisionAgent || 'ALL';
    const searchQ = (State.homeDecisionSearch || '').trim().toLowerCase();

    let sourceRows = [];
    const agingBucket = AGING_BUCKETS.find(bk => bk.id === State.homeDecisionAging);
    const agingChip = document.getElementById('homeDecisionAgingChip');
    if (agingChip) {
      if (agingBucket) {
        agingChip.style.display = 'flex';
        agingChip.innerHTML = `<span><i class="fa-solid fa-filter"></i> Showing all unreturned &amp; part-paid bills <strong>${agingBucket.label}</strong> in field</span>
          <button type="button" class="btn btn-xs btn-outline-secondary" id="homeDecisionAgingClear"><i class="fa-solid fa-xmark"></i> Clear</button>`;
        agingChip.querySelector('#homeDecisionAgingClear')?.addEventListener('click', () => {
          State.homeDecisionAging = null;
          renderDecisionAnalysisCenter();
        });
      } else {
        agingChip.style.display = 'none';
      }
    }
    if (agingBucket) {
      document.querySelectorAll('#homeDecisionTabs .decision-tab-btn, .decision-kpi-card').forEach(el => el.classList.remove('active'));
      sourceRows = allMissingCustody
        .filter(b => { const age = getBillAgingDays(b); return age >= agingBucket.min && age <= agingBucket.max; })
        .map(b => ({ type: 'CUSTODY', bill: b }));
    } else if (activeTab === 'UNRETURNED') {
      sourceRows = unreturnedBills.map(b => ({ type: 'CUSTODY', bill: b }));
    } else if (activeTab === 'OVERDUE') {
      sourceRows = overdueBills.map(b => ({ type: 'CUSTODY', bill: b }));
    } else if (activeTab === 'PARTIAL') {
      sourceRows = partialBills.map(b => ({ type: 'CUSTODY', bill: b }));
    } else if (activeTab === 'MISSED_SHEET') {
      sourceRows = missedSheetBills.map(b => ({ type: 'SHEET', bill: b }));
    }

    if (agentFilter !== 'ALL') {
      sourceRows = sourceRows.filter(r => isSameAgent(r.bill.agent, agentFilter));
    }

    if (searchQ) {
      sourceRows = sourceRows.filter(r => {
        const b = r.bill;
        const bNo = String(b.billNo || '').toLowerCase();
        const party = String(b.party || '').toLowerCase();
        const beat = String(b.beat || b.beatName || inferBillBeat(b) || '').toLowerCase();
        const rec = String(b.receipt || b.refNo || '').toLowerCase();
        return bNo.includes(searchQ) || party.includes(searchQ) || beat.includes(searchQ) || rec.includes(searchQ);
      });
    }

    // Sort by oldest aging first, then highest pending amount
    sourceRows.sort((a, b) => {
      if (a.type === 'CUSTODY' && b.type === 'CUSTODY') {
        const ageDiff = getBillAgingDays(b.bill) - getBillAgingDays(a.bill);
        if (ageDiff !== 0) return ageDiff;
        return getBillPendingAmount(b.bill) - getBillPendingAmount(a.bill);
      }
      return (Number(b.bill.outstanding) || Number(b.bill.amount) || 0) - (Number(a.bill.outstanding) || Number(a.bill.amount) || 0);
    });

    if (sourceRows.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8" style="text-align:center; padding: 24px;">🎉 No bills in this category matching your filter!</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    sourceRows.slice(0, 80).forEach(({ type, bill: b }) => {
      const tr = document.createElement('tr');
      const resolvedBeat = b.beat || b.beatName || inferBillBeat(b) || '';
      const beatHtml = resolvedBeat ? `<div style="font-size:0.73rem; color:#64748b;"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(resolvedBeat)}</div>` : '';
      const { receiptBadge, paymentBadge } = renderBillPaymentBadgesHtml(b);

      if (type === 'CUSTODY') {
        const pendingDue = getBillPendingAmount(b);
        const ageDays = getBillAgingDays(b);
        let ageBadge = `<span class="aging-pill aging-fresh">Today (0d)</span>`;
        if (ageDays > 7) {
          ageBadge = `<span class="aging-pill aging-critical"><i class="fa-solid fa-fire"></i> ${ageDays}d overdue</span>`;
        } else if (ageDays > 3) {
          ageBadge = `<span class="aging-pill aging-warn"><i class="fa-solid fa-clock"></i> ${ageDays}d in field</span>`;
        } else if (ageDays >= 1) {
          ageBadge = `<span class="aging-pill aging-fresh">${ageDays}d ago</span>`;
        }

        tr.innerHTML = `
          <td><strong class="font-mono text-danger">${escapeHtml(b.billNo)}</strong></td>
          <td>${escapeHtml(b.party || 'Customer')}</td>
          <td><strong>${escapeHtml(b.agent || 'Agent')}</strong>${beatHtml}</td>
          <td><div>${escapeHtml(b.dispatchDate || '-')}</div><div style="margin-top:2px;">${ageBadge}</div></td>
          <td class="font-mono" style="text-align:right;">${formatINR(b.amount)}</td>
          <td class="font-mono font-bold text-danger" style="text-align:right;">${formatINR(pendingDue)}</td>
          <td>${paymentBadge} <div style="margin-top:2px;">${receiptBadge}</div></td>
          <td style="text-align:center;">
            <div style="display:inline-flex; gap:4px;">
              <button type="button" class="btn btn-success btn-xs font-bold" data-dec-receive="${escapeHtml(b.billNo)}" title="Mark Received / Settled">
                <i class="fa-solid fa-check"></i> Receive
              </button>
              <button type="button" class="btn btn-outline-primary btn-xs" data-dec-pay="${escapeHtml(b.billNo)}" title="Record Partial / Full Payment">
                ₹ Pay
              </button>
            </div>
          </td>
        `;
      } else {
        const due = Number(b.outstanding) || Number(b.amount) || 0;
        tr.innerHTML = `
          <td><strong class="font-mono" style="color:#7c3aed;">${escapeHtml(b.billNo)}</strong></td>
          <td>${escapeHtml(b.party || 'Customer')}</td>
          <td><strong>${escapeHtml(b.agent || 'Agent')}</strong>${beatHtml}</td>
          <td><span class="aging-pill aging-warn">In Office (Not Sent)</span></td>
          <td class="font-mono" style="text-align:right;">${formatINR(b.amount)}</td>
          <td class="font-mono font-bold text-danger" style="text-align:right;">${formatINR(due)}</td>
          <td>${paymentBadge} <div style="margin-top:2px;">${receiptBadge}</div></td>
          <td style="text-align:center;">
            <button type="button" class="btn btn-primary btn-xs font-bold" data-dec-dispatch="${escapeHtml(b.billNo)}" title="Add to Morning Dispatch Basket">
              <i class="fa-solid fa-plus"></i> Dispatch
            </button>
          </td>
        `;
      }
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-dec-receive]').forEach(btn => {
      btn.addEventListener('click', () => {
        receiveBillDirectly(btn.dataset.decReceive);
        renderDecisionAnalysisCenter();
      });
    });

    tbody.querySelectorAll('[data-dec-pay]').forEach(btn => {
      btn.addEventListener('click', () => {
        const b = State.bills.find(x => normalizeInvoiceNumber(x.billNo) === normalizeInvoiceNumber(btn.dataset.decPay));
        if (b) openPaymentModal(b);
      });
    });

    tbody.querySelectorAll('[data-dec-dispatch]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mm = findMasterBill(btn.dataset.decDispatch);
        if (mm) {
          let parsed = { ...mm, raw: mm.billNo };
          parsed = enrichWithMaster(parsed);
          addBillToDispatchBasket(parsed);
          renderDecisionAnalysisCenter();
        }
      });
    });
  }

  // ========================================================
  // DASHBOARD NUMBER CARD BREAKDOWN ENGINE
  // ========================================================

  function getBreakdownBaseBills() {
    const filterMode = State.homeDateFilter || 'ALL';
    const customDate = State.homeCustomDate;
    const category = State.breakdownCategory || 'OUT';
    const targetAgent = State.breakdownAgent || 'ALL';

    const dateFiltered = State.bills.filter(b => matchesDateFilter(b.dispatchDate, filterMode, customDate));

    // Deduplicate basket items against dateFiltered to avoid double counting
    const confirmedNorms = new Set(dateFiltered.map(b => normalizeInvoiceNumber(b.billNo)).filter(Boolean));
    const uniqueBasket = [];
    const bMap = new Map();
    if ((filterMode === 'TODAY' || filterMode === 'ALL') && State.dispatchBasket && State.dispatchBasket.length > 0) {
      State.dispatchBasket.forEach(b => {
        if (!b || !b.billNo) return;
        const norm = normalizeInvoiceNumber(b.billNo);
        if (!confirmedNorms.has(norm) && !bMap.has(norm)) {
          bMap.set(norm, b);
          uniqueBasket.push({
            ...b,
            isBasket: true,
            status: 'IN_BASKET'
          });
        }
      });
    }

    let list = [];
    if (category === 'OUT') {
      list = [...dateFiltered, ...uniqueBasket];
    } else if (category === 'IN') {
      list = dateFiltered.filter(b => b.status === 'RECEIVED' || b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'RETURNED_IN_HAND');
    } else if (category === 'DIFF') {
      list = dateFiltered.filter(b => isBillMissingOrPending(b));
      list = [...list, ...uniqueBasket];
    } else if (category === 'AGENT') {
      list = [...dateFiltered, ...uniqueBasket];
    }

    if (targetAgent && targetAgent !== 'ALL') {
      list = list.filter(b => isSameAgent(b.agent, targetAgent));
    }

    const targetBeat = State.breakdownBeat || 'ALL';
    if (targetBeat && targetBeat !== 'ALL') {
      list = list.filter(b => isSameBeat(b.beat || b.beatName || inferBillBeat(b), targetBeat));
    }

    return list;
  }

  function renderDashboardBreakdownTable() {
    const baseBills = getBreakdownBaseBills();

    let countAll = baseBills.length;
    let countPending = 0;
    let countPaid = 0;
    let countReceipt = 0;

    let totalAmt = 0;
    let paidAmt = 0;
    let dueAmt = 0;
    const uniqueAgents = new Set();

    baseBills.forEach(b => {
      const amt = Number(b.amount) || 0;
      totalAmt += amt;
      if (b.agent) uniqueAgents.add(b.agent);

      let outDue = 0;
      if (b.outstanding !== undefined && b.outstanding !== null && !isNaN(b.outstanding)) {
        outDue = Number(b.outstanding);
      } else if (b.status === 'RECEIVED' || b.status === 'PAID_FULL') {
        outDue = 0;
      } else {
        outDue = amt;
      }

      const rawReceipt = String(b.receipt || b.refNo || '').trim();
      const isPaidRemark = /^PAID/i.test(rawReceipt);
      const isPartialRemark = /^PARTIAL/i.test(rawReceipt);
      const hasActualReceipt = Boolean(rawReceipt && !isPaidRemark && !isPartialRemark && !/^(nil|none|n\/a|-)$/i.test(rawReceipt));

      if (hasActualReceipt) countReceipt++;

      if (outDue > 0) {
        countPending++;
        dueAmt += outDue;
        if (outDue < amt) {
          paidAmt += (amt - outDue);
        }
      } else {
        countPaid++;
        paidAmt += (b.collectedAmt !== undefined ? Number(b.collectedAmt) : amt);
      }
    });

    // Update KPI strip
    const elTotal = document.getElementById('breakdownKpiTotal');
    const elTotalAmt = document.getElementById('breakdownKpiTotalAmt');
    const elPaid = document.getElementById('breakdownKpiPaid');
    const elPaidAmt = document.getElementById('breakdownKpiPaidAmt');
    const elDue = document.getElementById('breakdownKpiDue');
    const elDueAmt = document.getElementById('breakdownKpiDueAmt');
    const elReceipts = document.getElementById('breakdownKpiReceipts');
    const elAgents = document.getElementById('breakdownKpiAgents');

    if (elTotal) elTotal.textContent = countAll;
    if (elTotalAmt) elTotalAmt.textContent = formatINR(totalAmt);
    if (elPaid) elPaid.textContent = countPaid;
    if (elPaidAmt) elPaidAmt.textContent = formatINR(paidAmt);
    if (elDue) elDue.textContent = countPending;
    if (elDueAmt) elDueAmt.textContent = formatINR(dueAmt);
    if (elReceipts) elReceipts.textContent = countReceipt;
    if (elAgents) elAgents.textContent = `${uniqueAgents.size} agent${uniqueAgents.size === 1 ? '' : 's'}`;

    // Filter chip count badges
    const elCntAll = document.getElementById('bCountAll');
    const elCntPending = document.getElementById('bCountPending');
    const elCntPaid = document.getElementById('bCountPaid');
    const elCntReceipt = document.getElementById('bCountReceipt');
    if (elCntAll) elCntAll.textContent = countAll;
    if (elCntPending) elCntPending.textContent = countPending;
    if (elCntPaid) elCntPaid.textContent = countPaid;
    if (elCntReceipt) elCntReceipt.textContent = countReceipt;

    // Apply sub-filter
    let filtered = baseBills.filter(b => {
      let outDue = 0;
      if (b.outstanding !== undefined && b.outstanding !== null && !isNaN(b.outstanding)) {
        outDue = Number(b.outstanding);
      } else if (b.status === 'RECEIVED' || b.status === 'PAID_FULL') {
        outDue = 0;
      } else {
        outDue = Number(b.amount) || 0;
      }

      const rawReceipt = String(b.receipt || b.refNo || '').trim();
      const isPaidRemark = /^PAID/i.test(rawReceipt);
      const isPartialRemark = /^PARTIAL/i.test(rawReceipt);
      const hasActualReceipt = Boolean(rawReceipt && !isPaidRemark && !isPartialRemark && !/^(nil|none|n\/a|-)$/i.test(rawReceipt));

      if (State.breakdownFilter === 'PENDING') return outDue > 0;
      if (State.breakdownFilter === 'PAID') return outDue <= 0;
      if (State.breakdownFilter === 'RECEIPT') return hasActualReceipt;
      return true;
    });

    // Apply search query
    const query = (State.breakdownSearch || '').trim().toLowerCase();
    if (query) {
      filtered = filtered.filter(b => {
        const billNo = String(b.billNo || '').toLowerCase();
        const party = String(b.party || '').toLowerCase();
        const agent = String(b.agent || '').toLowerCase();
        const beat = String(b.beat || b.beatName || '').toLowerCase();
        const receipt = String(b.receipt || b.refNo || '').toLowerCase();
        return billNo.includes(query) || party.includes(query) || agent.includes(query) || beat.includes(query) || receipt.includes(query);
      });
    }

    const tbody = document.getElementById('breakdownTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="10" style="text-align:center; padding: 28px 12px; color: #64748b;">
            <i class="fa-solid fa-magnifying-glass" style="font-size: 1.5rem; margin-bottom: 8px; opacity: 0.5;"></i>
            <div>No bills match the selected filter or search query.</div>
          </td>
        </tr>
      `;
    } else {
      filtered.forEach((b, idx) => {
        const tr = document.createElement('tr');
        const { receiptBadge, paymentBadge, outstanding, amount } = renderBillPaymentBadgesHtml(b);

        let custodyBadge = '';
        const isPendingCustody = (b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT');
        if (b.isBasket) {
          custodyBadge = `<span class="b-cell-custody-basket"><i class="fa-solid fa-basket-shopping"></i> In Basket</span>`;
        } else if (b.status === 'WITH_AGENT') {
          custodyBadge = `<span class="b-cell-custody-out"><i class="fa-solid fa-person-walking"></i> With Agent</span>`;
        } else if (b.status === 'MISSING_ALERT') {
          custodyBadge = `<span class="b-cell-custody-diff"><i class="fa-solid fa-triangle-exclamation"></i> Missing</span>`;
        } else if (b.status === 'RETURNED_IN_HAND') {
          custodyBadge = `<span class="b-cell-custody-in"><i class="fa-solid fa-rotate-left"></i> Returned</span>`;
        } else {
          custodyBadge = `<span class="b-cell-custody-in"><i class="fa-solid fa-check"></i> Accounted</span>`;
        }

        if (isPendingCustody) {
          tr.classList.add('row-diff');
        }

        const beatStr = b.beat || b.beatName || '';
        const beatHtml = beatStr ? `<div style="font-size:0.7rem; color:#64748b; line-height:1.2; margin-top:2px;"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(beatStr)}</div>` : '';

        let actionHtml = '';
        if (isPendingCustody) {
          actionHtml = `
            <button type="button" class="btn btn-success btn-xs b-action-btn" data-b-receive="${escapeHtml(b.billNo)}" title="Receive / Check-in this bill now">
              <i class="fa-solid fa-check"></i> Receive
            </button>
          `;
        } else if (b.isBasket) {
          actionHtml = `<span class="text-muted font-mono" style="font-size:0.75rem;">Basket</span>`;
        } else {
          actionHtml = `
            <button type="button" class="btn btn-outline-secondary btn-xs b-action-btn" data-b-details="${escapeHtml(b.billNo)}" title="View payment details">
              <i class="fa-solid fa-receipt"></i> Details
            </button>
          `;
        }

        tr.innerHTML = `
          <td class="text-muted font-mono" style="font-size:0.75rem;">${idx + 1}</td>
          <td>
            <strong class="font-mono ${isPendingCustody ? 'text-danger' : (b.isBasket ? 'text-primary' : 'text-success')}">
              ${escapeHtml(b.billNo)}
            </strong>
          </td>
          <td>
            <strong>${escapeHtml(b.agent || 'Unassigned')}</strong>
            ${beatHtml}
          </td>
          <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(b.party || '')}">
            ${escapeHtml(b.party || 'Customer')}
          </td>
          <td style="text-align: right;" class="font-mono font-bold">${formatINR(amount)}</td>
          <td>${receiptBadge}</td>
          <td>${paymentBadge}</td>
          <td style="text-align: right;" class="font-mono font-bold ${outstanding > 0 ? 'text-danger' : 'text-success'}">
            ${formatINR(outstanding)}
          </td>
          <td>${custodyBadge}</td>
          <td style="text-align: center;">${actionHtml}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Modal footer metrics
    const dispAmt = filtered.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const dispDue = filtered.reduce((s, b) => {
      if (b.outstanding !== undefined && b.outstanding !== null && !isNaN(b.outstanding)) {
        return s + Number(b.outstanding);
      }
      if (b.status === 'RECEIVED' || b.status === 'PAID_FULL') return s;
      return s + (Number(b.amount) || 0);
    }, 0);

    const foot = document.getElementById('breakdownFooterMetrics');
    if (foot) {
      foot.innerHTML = `Showing <strong>${filtered.length}</strong> of ${baseBills.length} bills &bull; Total: <strong>${formatINR(dispAmt)}</strong> &bull; Pending Due: <strong class="${dispDue > 0 ? 'text-danger' : 'text-success'}">${formatINR(dispDue)}</strong>`;
    }

    // Attach row button handlers
    tbody.querySelectorAll('[data-b-receive]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        receiveBillDirectly(btn.dataset.bReceive);
      });
    });

    tbody.querySelectorAll('[data-b-details]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const bill = State.bills.find(b => b.billNo === btn.dataset.bDetails);
        if (bill) {
          openPaymentModal(bill);
        }
      });
    });
  }

  function openDashboardBreakdown(category, targetAgent = 'ALL', targetBeat = 'ALL') {
    State.breakdownCategory = category;
    State.breakdownAgent = targetAgent;
    State.breakdownBeat = targetBeat || 'ALL';
    State.breakdownFilter = 'ALL';
    State.breakdownSearch = '';
    State.isBreakdownModalOpen = true;

    // Reset toolbar UI elements
    const searchInp = document.getElementById('breakdownSearchInput');
    if (searchInp) searchInp.value = '';
    const clearBtn = document.getElementById('breakdownClearSearchBtn');
    if (clearBtn) clearBtn.style.display = 'none';

    document.querySelectorAll('#breakdownFilterTabs .breakdown-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.bFilter === 'ALL');
    });

    // Populate Agent Select
    const agentSelect = document.getElementById('breakdownAgentSelect');
    if (agentSelect) {
      agentSelect.innerHTML = '<option value="ALL">All Agents</option>';
      State.agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name;
        if (a.name.toLowerCase() === targetAgent.toLowerCase()) opt.selected = true;
        agentSelect.appendChild(opt);
      });
      if (targetAgent === 'ALL') {
        agentSelect.value = 'ALL';
      }
    }

    // Populate Beat Select based on selected agent
    populateBreakdownBeatDropdown(targetAgent, targetBeat);

    // Modal head icon, title, subtitle
    const iconBox = document.getElementById('breakdownHeadIcon');
    const titleEl = document.getElementById('breakdownModalTitle');
    const subEl = document.getElementById('breakdownModalSubtitle');
    const dateTag = document.getElementById('breakdownDateTag');

    if (iconBox) {
      iconBox.className = 'breakdown-icon-box';
      if (category === 'OUT') {
        iconBox.classList.add('icon-out');
        iconBox.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i>';
      } else if (category === 'IN') {
        iconBox.classList.add('icon-in');
        iconBox.innerHTML = '<i class="fa-solid fa-arrow-down-left-and-up-right-to-center"></i>';
      } else if (category === 'DIFF') {
        iconBox.classList.add('icon-diff');
        iconBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
      } else if (category === 'AGENT') {
        iconBox.classList.add('icon-agent');
        iconBox.innerHTML = '<i class="fa-solid fa-user-tie"></i>';
      }
    }

    if (titleEl) {
      if (category === 'OUT') titleEl.textContent = 'Dispatched Bills Breakdown (Out)';
      else if (category === 'IN') titleEl.textContent = 'Received & Accounted Bills Breakdown (In)';
      else if (category === 'DIFF') titleEl.textContent = 'Custody Difference & Pending Bills Breakdown';
      else if (category === 'AGENT') titleEl.textContent = `${targetAgent}'s Custody & Scans Breakdown`;
    }

    if (subEl) {
      if (category === 'OUT') subEl.textContent = 'Detailed list of all bills dispatched into agent custody';
      else if (category === 'IN') subEl.textContent = 'Bills safely collected, settled or returned to office custody';
      else if (category === 'DIFF') subEl.textContent = 'Audit list of bills currently in agent custody awaiting return';
      else if (category === 'AGENT') subEl.textContent = `Individual breakdown of all bills and custody status for ${targetAgent}`;
    }

    if (dateTag) {
      const filterMode = State.homeDateFilter || 'TODAY';
      const customDate = State.homeCustomDate;
      if (filterMode === 'TODAY') {
        const now = new Date();
        const formatted = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        dateTag.textContent = `TODAY (${formatted})`;
      } else if (filterMode === 'YESTERDAY') {
        const yest = new Date();
        yest.setDate(yest.getDate() - 1);
        const formatted = yest.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        dateTag.textContent = `YESTERDAY (${formatted})`;
      } else if (filterMode === 'ALL') {
        dateTag.textContent = 'ALL CUSTODY';
      } else if (filterMode === 'CUSTOM' && customDate) {
        dateTag.textContent = customDate;
      }
    }

    renderDashboardBreakdownTable();

    const modal = document.getElementById('dashboardBreakdownModal');
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  function closeDashboardBreakdownModal() {
    State.isBreakdownModalOpen = false;
    const modal = document.getElementById('dashboardBreakdownModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  function populateBreakdownBeatDropdown(agentName = 'ALL', selectedBeat = 'ALL') {
    const beatSelect = document.getElementById('breakdownBeatSelect');
    if (!beatSelect) return;
    beatSelect.innerHTML = '<option value="ALL">All Beats &amp; Routes</option>';

    const knownBeats = new Set();
    if (agentName && agentName !== 'ALL') {
      const plan = MASTER_BEAT_PLAN[agentName] || (agentName.includes('Shivam') ? MASTER_BEAT_PLAN.Shivam : MASTER_BEAT_PLAN.Rajesh);
      if (plan) {
        Object.values(plan).forEach(item => {
          if (item.beat) knownBeats.add(item.beat);
        });
      }
    } else {
      Object.values(MASTER_BEAT_PLAN).forEach(plan => {
        Object.values(plan).forEach(item => {
          if (item.beat) knownBeats.add(item.beat);
        });
      });
    }

    const preBeats = State.masterAgentBeatsMap && (State.masterAgentBeatsMap[agentName] || State.masterAgentBeatsMap.ALL);
    if (preBeats) {
      preBeats.forEach(bName => knownBeats.add(bName));
    }

    (State.bills || []).forEach(b => {
      if (agentName === 'ALL' || isSameAgent(b.agent, agentName)) {
        if (b.beatName) knownBeats.add(b.beatName);
        else if (b.beat) knownBeats.add(b.beat);
      }
    });

    Array.from(knownBeats).sort().forEach(bName => {
      const opt = document.createElement('option');
      opt.value = bName;
      opt.textContent = bName;
      if (selectedBeat !== 'ALL' && isSameBeat(bName, selectedBeat)) {
        opt.selected = true;
      }
      beatSelect.appendChild(opt);
    });

    if (selectedBeat === 'ALL') {
      beatSelect.value = 'ALL';
    }
  }

  // ========================================================
  // AGENT & BEAT PERFORMANCE ANALYSIS ENGINE
  // ========================================================

  function getBeatAnalysisData(agentFilter = 'ALL', dateFilter = 'ALL', customDate = null, searchQuery = '') {
    const filterMode = dateFilter || State.homeDateFilter || 'ALL';
    const cDate = customDate || State.homeCustomDate;

    // Filter live bills by date
    const dateFilteredBills = State.bills.filter(b => matchesDateFilter(b.dispatchDate, filterMode, cDate));
    const confirmedNorms = new Set(dateFilteredBills.map(b => normalizeInvoiceNumber(b.billNo)).filter(Boolean));

    // Include basket if TODAY or ALL
    const basketBills = [];
    if ((filterMode === 'TODAY' || filterMode === 'ALL') && State.dispatchBasket && State.dispatchBasket.length > 0) {
      State.dispatchBasket.forEach(b => {
        if (!b || !b.billNo) return;
        const norm = normalizeInvoiceNumber(b.billNo);
        if (!confirmedNorms.has(norm)) {
          basketBills.push({ ...b, isBasket: true, status: 'IN_BASKET' });
        }
      });
    }
    const allLiveBills = [...dateFilteredBills, ...basketBills];

    // Ensure every live bill has an inferred beat if possible
    allLiveBills.forEach(b => {
      if (!b.beat && !b.beatName) {
        const inf = inferBillBeat(b);
        if (inf) b.beat = inf;
      }
    });

    // Pre-aggregate Master Sheet counts by Agent + Beat in ONE single pass (instead of 21 separate filter passes)
    const sheetBeatTotals = new Map();
    const masterRows = State.masterSheetBills || [];
    for (let i = 0; i < masterRows.length; i++) {
      const mb = masterRows[i];
      if (!mb || !mb.beat || !mb.agent) continue;
      const ag = mb._canonAgent || mb.agent;
      const bKey = `${ag}___${mb.beat.trim()}`;
      let entry = sheetBeatTotals.get(bKey);
      if (!entry) {
        entry = { agent: ag, beat: mb.beat.trim(), total: 0, paid: 0 };
        sheetBeatTotals.set(bKey, entry);
      }
      entry.total++;
      if (mb._isPaid !== undefined ? mb._isPaid : isBillPaidInFull(mb)) {
        entry.paid++;
      }
    }
    const sheetBeatEntries = Array.from(sheetBeatTotals.values());

    // Determine target agents
    const agents = State.agents.filter(a => {
      if (agentFilter === 'ALL') return true;
      return isSameAgent(a.name, agentFilter);
    });

    const todayCode = getCurrentDayCode();
    const dayFullNames = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };

    const agentResults = [];
    let grandBeatsCount = 0;
    let grandDispatchedCount = 0;
    let grandDispatchedAmt = 0;
    let grandReceivedCount = 0;
    let grandReceivedAmt = 0;
    let grandDiffCount = 0;
    let grandDiffAmt = 0;

    agents.forEach(agent => {
      const agentPlan = MASTER_BEAT_PLAN[agent.name] || (agent.name.includes('Shivam') ? MASTER_BEAT_PLAN.Shivam : MASTER_BEAT_PLAN.Rajesh);
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      const beatsList = [];
      const seenBeatKeys = new Set();

      days.forEach(day => {
        const beatInfo = agentPlan ? agentPlan[day] : null;
        if (!beatInfo || !beatInfo.beat) return;
        const bName = beatInfo.beat;
        const key = bName.toLowerCase().trim();
        seenBeatKeys.add(key);

        beatsList.push({
          beatName: bName,
          dayCode: day,
          dayName: dayFullNames[day] || day,
          area: beatInfo.area || bName,
          isToday: day === todayCode
        });
      });

      // Also pick up any additional beats present in live bills or pre-indexed Master Sheet beats for this agent
      const agentLiveBills = allLiveBills.filter(b => isSameAgent(b.agent, agent.name));
      const candidateBeatNames = new Set();
      agentLiveBills.forEach(b => {
        const bn = String(b.beatName || b.beat || '').trim();
        if (bn) candidateBeatNames.add(bn);
      });
      if (State.masterAgentBeatsMap && State.masterAgentBeatsMap[agent.name]) {
        State.masterAgentBeatsMap[agent.name].forEach(bn => candidateBeatNames.add(bn));
      }

      candidateBeatNames.forEach(rawVal => {
        let rawName = rawVal.replace(/\s*\((Mon|Tue|Wed|Thu|Fri|Sat)[^)]*\)/gi, '').replace(/\s*\(Week\s*\d+[^)]*\)/gi, '').trim();
        if (rawName && rawName.length > 1) {
          const alreadyExists = beatsList.some(bt => isSameBeat(bt.beatName, rawName));
          if (!alreadyExists && !seenBeatKeys.has(rawName.toLowerCase())) {
            seenBeatKeys.add(rawName.toLowerCase());
            beatsList.push({
              beatName: rawName,
              dayCode: '',
              dayName: 'Custom Route',
              area: rawName,
              isToday: false
            });
          }
        }
      });

      // Check if any live bills for this agent still have no matching beat in beatsList
      const unmatchedLiveBills = agentLiveBills.filter(b => {
        const bBeat = b.beat || b.beatName || '';
        return !bBeat || !beatsList.some(bt => isSameBeat(bt.beatName, bBeat));
      });
      if (unmatchedLiveBills.length > 0) {
        beatsList.push({
          beatName: 'General / Unassigned Route',
          dayCode: '',
          dayName: 'General Custody',
          area: 'Bills without specific beat tag',
          isToday: false,
          isUnassignedBucket: true
        });
      }

      const query = (searchQuery || '').trim().toLowerCase();
      const filteredBeats = beatsList.filter(bt => {
        if (!query) return true;
        return bt.beatName.toLowerCase().includes(query) || bt.dayName.toLowerCase().includes(query) || bt.area.toLowerCase().includes(query);
      });

      let agentDispatchedCount = 0;
      let agentDispatchedAmt = 0;
      let agentReceivedCount = 0;
      let agentReceivedAmt = 0;
      let agentDiffCount = 0;
      let agentDiffAmt = 0;

      const beatCards = filteredBeats.map(bt => {
        const matchBills = bt.isUnassignedBucket
          ? unmatchedLiveBills
          : agentLiveBills.filter(b => isSameBeat(b.beat || b.beatName, bt.beatName));

        const dispatchedCount = matchBills.length;
        let dispatchedAmt = 0;
        let receivedCount = 0;
        let receivedAmt = 0;
        let diffCount = 0;
        let diffAmt = 0;

        matchBills.forEach(b => {
          const amt = Number(b.amount) || 0;
          dispatchedAmt += amt;

          let outDue = 0;
          if (b.outstanding !== undefined && b.outstanding !== null && !isNaN(b.outstanding)) {
            outDue = Number(b.outstanding);
          } else if (b.status === 'RECEIVED' || b.status === 'PAID_FULL') {
            outDue = 0;
          } else {
            outDue = amt;
          }

          let collected = 0;
          if (b.collectedAmt !== undefined && b.collectedAmt !== null && !isNaN(b.collectedAmt)) {
            collected = Number(b.collectedAmt);
          } else if (outDue < amt) {
            collected = Math.max(0, amt - outDue);
          } else if (b.status === 'RECEIVED' || b.status === 'PAID_FULL') {
            collected = amt;
          }

          if (outDue <= 0) {
            receivedCount++;
            receivedAmt += (collected > 0 ? collected : amt);
          } else if (collected > 0) {
            // Partially collected bill: account for both collected and remaining pending
            receivedCount++;
            receivedAmt += collected;
            diffCount++;
            diffAmt += outDue;
          } else {
            // Completely pending / in custody
            diffCount++;
            diffAmt += outDue;
          }
        });

        let clearanceRate = 0;
        if (dispatchedAmt > 0) {
          clearanceRate = Math.min(100, Math.round((receivedAmt / dispatchedAmt) * 100));
        } else if (dispatchedCount > 0 && diffCount === 0) {
          clearanceRate = 100;
        }

        // Master sheet metrics from pre-aggregated map (fast O(K) over unique beats instead of O(15000))
        let sheetTotalCount = 0;
        let sheetPaidCount = 0;
        if (!bt.isUnassignedBucket) {
          for (let sIdx = 0; sIdx < sheetBeatEntries.length; sIdx++) {
            const sb = sheetBeatEntries[sIdx];
            if (isSameAgent(sb.agent, agent.name) && isSameBeat(sb.beat, bt.beatName)) {
              sheetTotalCount += sb.total;
              sheetPaidCount += sb.paid;
            }
          }
        }
        const sheetDueCount = Math.max(0, sheetTotalCount - sheetPaidCount);

        agentDispatchedCount += dispatchedCount;
        agentDispatchedAmt += dispatchedAmt;
        agentReceivedCount += receivedCount;
        agentReceivedAmt += receivedAmt;
        agentDiffCount += diffCount;
        agentDiffAmt += diffAmt;

        return {
          ...bt,
          dispatchedCount,
          dispatchedAmt,
          receivedCount,
          receivedAmt,
          diffCount,
          diffAmt,
          clearanceRate,
          sheetTotalCount,
          sheetPaidCount,
          sheetDueCount
        };
      });

      grandBeatsCount += filteredBeats.length;
      grandDispatchedCount += agentDispatchedCount;
      grandDispatchedAmt += agentDispatchedAmt;
      grandReceivedCount += agentReceivedCount;
      grandReceivedAmt += agentReceivedAmt;
      grandDiffCount += agentDiffCount;
      grandDiffAmt += agentDiffAmt;

      let agentClearanceRate = 0;
      if (agentDispatchedAmt > 0) {
        agentClearanceRate = Math.min(100, Math.round((agentReceivedAmt / agentDispatchedAmt) * 100));
      } else if (agentDispatchedCount > 0 && agentDiffCount === 0) {
        agentClearanceRate = 100;
      }

      agentResults.push({
        agent,
        beats: beatCards,
        totals: {
          dispatchedCount: agentDispatchedCount,
          dispatchedAmt: agentDispatchedAmt,
          receivedCount: agentReceivedCount,
          receivedAmt: agentReceivedAmt,
          diffCount: agentDiffCount,
          diffAmt: agentDiffAmt,
          clearanceRate: agentClearanceRate
        }
      });
    });

    let overallClearanceRate = 0;
    if (grandDispatchedAmt > 0) {
      overallClearanceRate = Math.min(100, Math.round((grandReceivedAmt / grandDispatchedAmt) * 100));
    } else if (grandDispatchedCount > 0 && grandDiffCount === 0) {
      overallClearanceRate = 100;
    }

    return {
      agentResults,
      summary: {
        beatsCount: grandBeatsCount,
        dispatchedCount: grandDispatchedCount,
        dispatchedAmt: grandDispatchedAmt,
        receivedCount: grandReceivedCount,
        receivedAmt: grandReceivedAmt,
        diffCount: grandDiffCount,
        diffAmt: grandDiffAmt,
        clearanceRate: overallClearanceRate
      }
    };
  }

  function openBeatAnalysisModal(initialAgent = 'ALL') {
    State.beatAnalysisAgent = initialAgent || 'ALL';
    State.beatAnalysisDateFilter = State.homeDateFilter || 'ALL';
    State.beatAnalysisSearch = '';
    State.isBeatAnalysisModalOpen = true;

    // Reset toolbar
    const searchInp = document.getElementById('beatAnalysisSearchInput');
    if (searchInp) searchInp.value = '';
    const clearBtn = document.getElementById('beatAnalysisClearSearchBtn');
    if (clearBtn) clearBtn.style.display = 'none';

    document.querySelectorAll('#beatAnalysisDateChips .diff-chip').forEach(c => {
      c.classList.toggle('active', (c.dataset.bDate || 'ALL') === State.beatAnalysisDateFilter);
    });

    // Populate agent select
    const sel = document.getElementById('beatAnalysisAgentSelect');
    if (sel) {
      sel.innerHTML = '<option value="ALL">All Agents (Overview)</option>';
      State.agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.fullName || a.name;
        if (State.beatAnalysisAgent !== 'ALL' && isSameAgent(a.name, State.beatAnalysisAgent)) {
          opt.selected = true;
        }
        sel.appendChild(opt);
      });
      if (State.beatAnalysisAgent === 'ALL') sel.value = 'ALL';
    }

    renderBeatAnalysisModal();

    const modal = document.getElementById('beatAnalysisModal');
    if (modal) modal.style.display = 'flex';
  }

  function closeBeatAnalysisModal() {
    State.isBeatAnalysisModalOpen = false;
    const modal = document.getElementById('beatAnalysisModal');
    if (modal) modal.style.display = 'none';
  }

  function renderBeatAnalysisModal() {
    const data = getBeatAnalysisData(
      State.beatAnalysisAgent,
      State.beatAnalysisDateFilter,
      State.homeCustomDate,
      State.beatAnalysisSearch
    );

    // Update KPI strip
    const elBeats = document.getElementById('baKpiBeatsCount');
    const elAgents = document.getElementById('baKpiAgentsCount');
    const elDispCnt = document.getElementById('baKpiDispatchedCount');
    const elDispAmt = document.getElementById('baKpiDispatchedAmt');
    const elRecCnt = document.getElementById('baKpiReceivedCount');
    const elRecAmt = document.getElementById('baKpiReceivedAmt');
    const elDiffCnt = document.getElementById('baKpiDiffCount');
    const elDiffAmt = document.getElementById('baKpiDiffAmt');
    const elRate = document.getElementById('baKpiClearanceRate');

    if (elBeats) elBeats.textContent = data.summary.beatsCount;
    if (elAgents) elAgents.textContent = `${data.agentResults.length} Agent${data.agentResults.length === 1 ? '' : 's'}`;
    if (elDispCnt) elDispCnt.textContent = data.summary.dispatchedCount;
    if (elDispAmt) elDispAmt.textContent = formatINR(data.summary.dispatchedAmt);
    if (elRecCnt) elRecCnt.textContent = data.summary.receivedCount;
    if (elRecAmt) elRecAmt.textContent = formatINR(data.summary.receivedAmt);
    if (elDiffCnt) elDiffCnt.textContent = data.summary.diffCount;
    if (elDiffAmt) elDiffAmt.textContent = formatINR(data.summary.diffAmt);
    if (elRate) elRate.textContent = `${data.summary.clearanceRate}%`;

    const container = document.getElementById('beatAnalysisContainer');
    if (!container) return;
    container.innerHTML = '';

    if (data.agentResults.length === 0 || data.summary.beatsCount === 0) {
      container.innerHTML = `
        <div class="empty-placeholder" style="padding: 40px 20px;">
          <i class="fa-solid fa-route" style="font-size: 2rem; color: #94a3b8; margin-bottom: 12px;"></i>
          <p>No beat route records found for the selected agent and filters.</p>
        </div>
      `;
      return;
    }

    data.agentResults.forEach(res => {
      const agent = res.agent;
      const beats = res.beats;
      const totals = res.totals;

      let avatarClass = 'avatar-rajesh-mini';
      if (agent.name.toLowerCase().includes('shivam')) avatarClass = 'avatar-shivam-mini';
      else if (agent.name.toLowerCase().includes('self')) avatarClass = 'avatar-self-mini';

      const section = document.createElement('div');
      section.className = 'beat-analysis-agent-section';

      section.innerHTML = `
        <div class="beat-analysis-agent-head">
          <div class="beat-agent-profile">
            <div class="beat-agent-avatar ${avatarClass}">
              <i class="fa-solid ${agent.name.toLowerCase().includes('self') ? 'fa-store' : 'fa-user-tie'}"></i>
            </div>
            <div class="beat-agent-details">
              <h4>${escapeHtml(agent.fullName || agent.name)}</h4>
              <small>${beats.length} Beat Routes &bull; ${totals.clearanceRate}% Clearance Rate</small>
            </div>
          </div>
          <div class="beat-agent-quick-totals font-mono">
            <span>Out: <strong>${formatINR(totals.dispatchedAmt)}</strong> (${totals.dispatchedCount})</span>
            <span class="text-success">&bull; In: <strong>${formatINR(totals.receivedAmt)}</strong> (${totals.receivedCount})</span>
            <span class="${totals.diffCount > 0 ? 'text-danger' : 'text-success'}">&bull; Diff: <strong>${formatINR(totals.diffAmt)}</strong> (${totals.diffCount})</span>
          </div>
        </div>

        <div class="beat-analysis-grid">
          ${beats.map(bt => {
            const hasPending = bt.diffCount > 0;
            const progressColorClass = bt.clearanceRate >= 100 ? '' : (hasPending ? 'is-pending' : 'is-zero');
            return `
              <div class="beat-card ${bt.isToday ? 'is-active-day' : ''}">
                <div class="beat-card-header">
                  <div>
                    <span class="beat-card-day ${bt.isToday ? 'today-tag' : ''}">
                      ${bt.isToday ? '<i class="fa-solid fa-star"></i> Today' : (bt.dayName || 'Route')}
                    </span>
                    <div class="beat-card-name">${escapeHtml(bt.beatName)}</div>
                    <small class="text-muted" style="font-size:0.73rem;">${escapeHtml(bt.area)}</small>
                  </div>
                  <span class="count-pill ${hasPending ? 'bg-danger text-white' : (bt.dispatchedCount > 0 ? 'bg-success text-white' : '')}" style="font-size:0.75rem;">
                    ${hasPending ? `${bt.diffCount} Pending` : (bt.dispatchedCount > 0 ? '✓ Cleared' : '0 Dispatched')}
                  </span>
                </div>

                <div class="beat-card-metrics font-mono">
                  <div class="beat-metric-item">
                    <span class="bm-label">Out</span>
                    <span class="bm-val">${formatINR(bt.dispatchedAmt)}</span>
                    <span class="bm-sub">${bt.dispatchedCount} bills</span>
                  </div>
                  <div class="beat-metric-item">
                    <span class="bm-label">In</span>
                    <span class="bm-val text-success">${formatINR(bt.receivedAmt)}</span>
                    <span class="bm-sub">${bt.receivedCount} bills</span>
                  </div>
                  <div class="beat-metric-item">
                    <span class="bm-label">Diff</span>
                    <span class="bm-val ${hasPending ? 'text-danger' : 'text-success'}">${formatINR(bt.diffAmt)}</span>
                    <span class="bm-sub">${bt.diffCount} bills</span>
                  </div>
                </div>

                <div class="beat-recovery-strip">
                  <span>Recovery: <strong>${bt.clearanceRate}%</strong></span>
                  ${bt.sheetTotalCount > 0 ? `<span>Sheet: ${bt.sheetDueCount} due / ${bt.sheetTotalCount}</span>` : ''}
                </div>

                <div class="beat-progress-wrap">
                  <div class="beat-progress-bar ${progressColorClass}" style="width: ${bt.clearanceRate}%;"></div>
                </div>

                <div class="beat-card-footer">
                  <div class="beat-card-actions">
                    <button type="button" class="btn btn-outline-secondary btn-xs flex-1" data-ba-view-bills="${escapeHtml(agent.name)}" data-ba-beat="${escapeHtml(bt.beatName)}" title="View bills for this beat">
                      <i class="fa-solid fa-list"></i> Bills (${bt.dispatchedCount})
                    </button>
                    <button type="button" class="btn btn-primary btn-xs" data-ba-scan-out="${escapeHtml(agent.name)}" data-ba-beat="${escapeHtml(bt.beatName)}" title="Open Morning Dispatch Scan Out for this beat">
                      <i class="fa-solid fa-arrow-up-from-bracket"></i> Scan Out
                    </button>
                    <button type="button" class="btn btn-success btn-xs" data-ba-scan-in="${escapeHtml(agent.name)}" data-ba-beat="${escapeHtml(bt.beatName)}" title="Open Evening Return Scan In for this beat">
                      <i class="fa-solid fa-arrow-down-to-bracket"></i> Scan In
                    </button>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      container.appendChild(section);
    });

    // Attach actions
    container.querySelectorAll('[data-ba-view-bills]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ag = btn.dataset.baViewBills;
        const bt = btn.dataset.baBeat;
        closeBeatAnalysisModal();
        openDashboardBreakdown('AGENT', ag, bt);
      });
    });

    container.querySelectorAll('[data-ba-scan-out]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ag = btn.dataset.baScanOut;
        const bt = btn.dataset.baBeat;
        closeBeatAnalysisModal();
        const agentObj = State.agents.find(a => isSameAgent(a.name, ag)) || { id: ag, name: ag };
        State.activeAgent = agentObj;
        State.activeBeat = bt;
        State.selectedBeatName = bt;
        State.activeScanMode = 'DISPATCH';
        proceedToScanTab(true);
      });
    });

    container.querySelectorAll('[data-ba-scan-in]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ag = btn.dataset.baScanIn;
        const bt = btn.dataset.baBeat;
        closeBeatAnalysisModal();
        const agentObj = State.agents.find(a => isSameAgent(a.name, ag)) || { id: ag, name: ag };
        State.activeAgent = agentObj;
        State.activeBeat = bt;
        State.selectedBeatName = bt;
        State.activeScanMode = 'SETTLEMENT';
        proceedToScanTab(true);
      });
    });
  }

  function copyBeatAnalysisSummary() {
    const data = getBeatAnalysisData(
      State.beatAnalysisAgent,
      State.beatAnalysisDateFilter,
      State.homeCustomDate,
      State.beatAnalysisSearch
    );

    let text = `📍 BILLAUDIT PRO - BEAT ROUTE ANALYSIS REPORT\n`;
    text += `Filter: Agent=${State.beatAnalysisAgent} | Date=${State.beatAnalysisDateFilter}\n`;
    text += `Total Dispatched: ${data.summary.dispatchedCount} bills (${formatINR(data.summary.dispatchedAmt)})\n`;
    text += `Total Received: ${data.summary.receivedCount} bills (${formatINR(data.summary.receivedAmt)})\n`;
    text += `Difference Pending: ${data.summary.diffCount} bills (${formatINR(data.summary.diffAmt)})\n`;
    text += `Overall Clearance: ${data.summary.clearanceRate}%\n`;
    text += `==============================================\n\n`;

    data.agentResults.forEach(res => {
      text += `👤 AGENT: ${res.agent.fullName || res.agent.name}\n`;
      text += `Totals: Out ${formatINR(res.totals.dispatchedAmt)} | In ${formatINR(res.totals.receivedAmt)} | Diff ${formatINR(res.totals.diffAmt)} (${res.totals.clearanceRate}%)\n`;
      text += `----------------------------------------------\n`;
      res.beats.forEach((bt, idx) => {
        text += `${idx + 1}. [${bt.dayName}] ${bt.beatName}\n`;
        text += `   Dispatched: ${bt.dispatchedCount} (${formatINR(bt.dispatchedAmt)}) | Received: ${bt.receivedCount} | Diff: ${bt.diffCount} (${formatINR(bt.diffAmt)}) | ${bt.clearanceRate}%\n`;
      });
      text += `\n`;
    });

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Beat analysis report copied to clipboard!', 'success');
      }).catch(() => {
        showToast('Could not copy automatically', 'warning');
      });
    } else {
      showToast('Clipboard not supported', 'warning');
    }
  }

  function receiveBillDirectly(billNo) {
    if (!billNo) return;
    const b = State.bills.find(item => item.billNo === billNo);
    if (!b) return;

    b.status = 'RECEIVED';
    b.remarks = 'Directly received from Breakdown modal';
    b.lastActionDate = new Date().toISOString();

    if (!b.receipt || b.outstanding === undefined) {
      const mm = findMasterBill(b.billNo);
      if (mm) {
        b.receipt = mm.receipt || b.receipt;
        b.refNo = mm.receipt || b.refNo;
        b.outstanding = mm.outstanding !== undefined ? mm.outstanding : b.outstanding;
        if (mm.party && mm.party !== 'Customer') b.party = mm.party;
        if (mm.amount) b.amount = mm.amount;
      } else {
        fetchSingleBillDetailsFromSheet(b.billNo, 'SETTLEMENT');
      }
    }

    addAuditLog('RECEIVED_BREAKDOWN', `Received invoice ${b.billNo} via Breakdown modal`, { billNo: b.billNo, agent: b.agent, amount: b.amount });
    saveState();
    updateGlobalStats();
    updateHomeStats();
    if (typeof renderLeftOutTab === 'function') renderLeftOutTab();
    if (typeof loadSettlementForSelectedAgent === 'function') loadSettlementForSelectedAgent();
    renderDashboardBreakdownTable();
    SoundFX.playBeep('success');
    showToast(`Received ${b.billNo} successfully`, 'success');
  }

  function copyBreakdownSummaryText() {
    const baseBills = getBreakdownBaseBills();
    const filterMode = State.homeDateFilter || 'TODAY';
    let catTitle = 'Custody Breakdown';
    if (State.breakdownCategory === 'OUT') catTitle = 'Dispatched Out';
    else if (State.breakdownCategory === 'IN') catTitle = 'Received / Accounted';
    else if (State.breakdownCategory === 'DIFF') catTitle = 'Custody Differences';
    else if (State.breakdownCategory === 'AGENT') catTitle = `${State.breakdownAgent || 'Agent'} Breakdown`;

    const totalAmt = baseBills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const pendingBills = baseBills.filter(b => (b.outstanding || 0) > 0 || b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT');
    const pendingAmt = pendingBills.reduce((s, b) => s + (Number(b.outstanding !== undefined ? b.outstanding : b.amount) || 0), 0);

    let text = `📊 BILLAUDIT PRO - ${catTitle.toUpperCase()}\n`;
    text += `Date Filter: ${filterMode} (${document.getElementById('breakdownDateTag')?.textContent || ''})\n`;
    text += `Total Bills: ${baseBills.length} | Amount: ${formatINR(totalAmt)}\n`;
    text += `Pending Due: ${pendingBills.length} | Due Amount: ${formatINR(pendingAmt)}\n`;
    text += `--------------------------------------\n`;

    baseBills.slice(0, 25).forEach((b, i) => {
      const rec = b.receipt || b.refNo || '-';
      text += `${i + 1}. ${b.billNo} | ${b.agent || 'No Agent'} | ${b.party} | ${formatINR(b.amount)} | [Receipt: ${rec}] | Status: ${b.status}\n`;
    });

    if (baseBills.length > 25) {
      text += `...and ${baseBills.length - 25} more bills.\n`;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Breakdown summary copied to clipboard!', 'success');
      }).catch(() => {
        showToast('Could not copy automatically', 'warning');
      });
    } else {
      showToast('Clipboard not supported', 'warning');
    }
  }

  function getAvailableBeats(agentName = '') {
    const beatsSet = new Set();
    const agentLower = (agentName || '').toLowerCase().trim();
    let canonKey = 'ALL';
    if (agentLower.includes('shivam')) canonKey = 'Shivam';
    else if (agentLower.includes('self')) canonKey = 'Self';
    else if (agentLower.includes('rajesh')) canonKey = 'Rajesh';

    if (State.masterAgentBeatsMap) {
      const agentBeats = State.masterAgentBeatsMap[canonKey];
      if (agentBeats) agentBeats.forEach(b => beatsSet.add(b));
      if (beatsSet.size < 4 && State.masterAgentBeatsMap.ALL) {
        State.masterAgentBeatsMap.ALL.forEach(b => beatsSet.add(b));
      }
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

      const dDate = document.getElementById('dispatchDate');
      if (dDate) {
        dDate.value = getTodayDateString();
      }

      State.dispatchBeatFilter = State.activeBeat ? 'BEAT' : 'ALL';

      await switchTab('tab-dispatch');
      renderDispatchBasket();
      focusActiveScannerInput();

      if (pendingScan) {
        setTimeout(() => handleScannedCodeDispatch(pendingScan), 200);
      }
    } else {
      State.activeSettlementAgent = agentName;
      State.settlementBeatFilter = State.activeBeat ? 'BEAT' : 'ALL';

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
      loadSettlementForSelectedAgent();
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

    // HOME TAB: metric cards shortcut directly to interactive breakdown views
    document.getElementById('homeOutCardPro')?.addEventListener('click', () => openDashboardBreakdown('OUT'));
    document.getElementById('homeInCardPro')?.addEventListener('click', () => openDashboardBreakdown('IN'));
    document.getElementById('homeDiffCardPro')?.addEventListener('click', () => openDashboardBreakdown('DIFF'));

    // HOME TAB: basket pending handover banner actions
    document.getElementById('bannerConfirmHandoverBtn')?.addEventListener('click', confirmDispatchHandover);
    document.getElementById('bannerViewBasketBtn')?.addEventListener('click', () => switchTab('tab-dispatch'));

    // HOME TAB: date filter chips (All Active Custody, Today, Yesterday, Overdue)
    document.querySelectorAll('#homeDateFilters .home-date-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        State.homeDateFilter = chip.dataset.homeDate || 'ALL';
        State.homeCustomDate = null;
        const picker = document.getElementById('homeCustomDatePicker');
        if (picker) picker.value = '';
        updateHomeStats();
      });
    });

    // HOME TAB: custom date picker
    document.getElementById('homeCustomDatePicker')?.addEventListener('change', (e) => {
      if (e.target.value) {
        State.homeDateFilter = 'CUSTOM';
        State.homeCustomDate = e.target.value;
        updateHomeStats();
      }
    });

    // HOME TAB: Sync & Reconcile buttons
    document.getElementById('homeSyncReconcileBtn')?.addEventListener('click', async () => {
      showToast('Syncing Master & Tracking Sheets...', 'info', 2000);
      await syncSheetDirect(false);
      await syncBillsFromTrackingSheet(true);
      updateHomeStats();
    });
    document.getElementById('btnHomeOpenReconcile')?.addEventListener('click', openPaymentReconciliationModal);

    // HOME TAB: Decision Analysis Center KPI cards & Tabs
    document.querySelectorAll('.decision-kpi-card').forEach(card => {
      card.addEventListener('click', () => {
        State.homeDecisionTab = card.dataset.decisionTab || 'UNRETURNED';
        State.homeDecisionAging = null;
        renderDecisionAnalysisCenter();
      });
    });
    document.querySelectorAll('#homeDecisionTabs .decision-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        State.homeDecisionTab = btn.dataset.decTab || 'UNRETURNED';
        State.homeDecisionAging = null;
        renderDecisionAnalysisCenter();
      });
    });
    document.getElementById('homeDecisionSearchInput')?.addEventListener('input', (e) => {
      State.homeDecisionSearch = e.target.value;
      renderDecisionAnalysisCenter();
    });
    document.getElementById('homeDecisionAgentFilter')?.addEventListener('change', (e) => {
      State.homeDecisionAgent = e.target.value;
      renderDecisionAnalysisCenter();
    });
    document.getElementById('homeDecisionWhatsappBtn')?.addEventListener('click', () => {
      const ag = State.homeDecisionAgent || 'ALL';
      if (ag !== 'ALL') {
        sendLeftOutWhatsApp(ag);
      } else {
        sendAllLeftOutWhatsApp();
      }
    });

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

    // Global Keyboard Navigation (1-6 for Tabs, B for Beat Analysis)
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) return;
      if (State.isConfirmModalOpen || State.isBreakdownModalOpen) return;

      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (State.isBeatAnalysisModalOpen) {
          closeBeatAnalysisModal();
        } else {
          openBeatAnalysisModal('ALL');
        }
        return;
      }

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
      const activeBeat = State.activeBeat;
      const isFilterBeat = State.dispatchBeatFilter === 'BEAT' && Boolean(activeBeat);
      if (isFilterBeat) {
        const targetItems = State.dispatchBasket.filter(item => {
          const matchAgent = State.activeAgent ? isSameAgent(item.agent, State.activeAgent.name) : true;
          const matchBeat = isSameBeat(item.beat || item.beatName, activeBeat);
          return matchAgent && matchBeat;
        });
        if (targetItems.length === 0) return;
        if (confirm(`Clear ${targetItems.length} scanned bills for ${activeBeat} from basket?`)) {
          const toRemoveNorms = new Set(targetItems.map(b => normalizeInvoiceNumber(b.billNo)));
          State.dispatchBasket = State.dispatchBasket.filter(b => !toRemoveNorms.has(normalizeInvoiceNumber(b.billNo)));
          saveState('basket');
          renderDispatchBasket();
        }
      } else {
        if (State.dispatchBasket.length > 0 && confirm('Clear all scanned bills from basket?')) {
          State.dispatchBasket = [];
          saveState('basket');
          renderDispatchBasket();
        }
      }
    });

    document.getElementById('confirmDispatchBtn')?.addEventListener('click', confirmDispatchHandover);
    document.getElementById('printHandoverSlipBtn')?.addEventListener('click', () => window.print());
    document.getElementById('whatsappHandoverBtn')?.addEventListener('click', () => {
      const activeBeat = State.activeBeat;
      const isFilterBeat = State.dispatchBeatFilter === 'BEAT' && Boolean(activeBeat);
      const targetItems = isFilterBeat
        ? State.dispatchBasket.filter(item => {
            const matchAgent = State.activeAgent ? isSameAgent(item.agent, State.activeAgent.name) : true;
            const matchBeat = isSameBeat(item.beat || item.beatName, activeBeat);
            return matchAgent && matchBeat;
          })
        : State.dispatchBasket;

      if (targetItems.length === 0) return;
      const total = targetItems.reduce((s, b) => s + (Number(b.amount) || 0), 0);
      const agent = State.activeAgent ? State.activeAgent.name : (targetItems[0]?.agent || 'Sales Agent');
      const beatInfo = activeBeat ? `\n*Beat/Week:* ${activeBeat}` : '';
      const msg = 
`*📦 BILL HANDOVER SLIP (OUT)*
*Agent:* ${agent}${beatInfo}
*Date:* ${document.getElementById('dispatchDate').value || getTodayDateString()}
*Total Bills:* ${targetItems.length} (${formatINR(total)})
-------------------------
${targetItems.map((b, i) => `${i + 1}. *${b.billNo}* [${b.agent}]${b.beat ? ` (${b.beat})` : ''} - ${b.party} (${formatINR(b.amount)})`).join('\n')}
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
    document.getElementById('leftOutSearchInput')?.addEventListener('input', (e) => {
      State.leftOutSearch = e.target.value;
      renderLeftOutTab();
    });
    document.getElementById('whatsappAllLeftOutBtn')?.addEventListener('click', sendAllLeftOutWhatsApp);

    // Difference date filter chips (All Active, Today, Yesterday, Overdue)
    document.querySelectorAll('#diffDateFilters .diff-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#diffDateFilters .diff-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        State.diffDateFilter = chip.dataset.diffDate || 'ALL';
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
    document.getElementById('dedupeScanInLogBtn')?.addEventListener('click', async () => {
      const url = (State.settings.trackingSheetScriptUrl || '').trim();
      if (!url) {
        showToast('Tracking sheet URL not configured', 'warning');
        return;
      }
      const btn = document.getElementById('dedupeScanInLogBtn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cleaning...';
      }
      try {
        const resp = await fetch(`${url}?action=DEDUPE_LOGS&t=${Date.now()}`);
        const res = await resp.json();
        if (res && res.status === 'OK') {
          SoundFX.playBeep('success');
          showToast(res.message || 'Scan_In_Log cleaned successfully!', 'success', 4000);
        } else {
          showToast(res.message || 'Deduplication failed', 'error');
        }
      } catch (e) {
        showToast('Failed to contact Tracking Sheet script: ' + e.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-broom"></i> Clean Duplicate Scan-In Rows';
        }
      }
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
      let bill = State.bills.find(b => normalizeInvoiceNumber(b.billNo) === normalizeInvoiceNumber(parsed.billNo));
      if (!bill) {
        bill = {
          billNo: parsed.billNo,
          party: parsed.party || 'Standard Account',
          amount: parsed.amount || 0,
          agent: parsed.agent || State.activeSettlementAgent || 'Sales Agent',
          dispatchDate: '',
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
      } else if (State.isBreakdownModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeDashboardBreakdownModal();
        }
      } else if (State.isBeatAnalysisModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeBeatAnalysisModal();
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
    document.getElementById('diffSyncReconcileBtn')?.addEventListener('click', () => syncSheetDirect(true));

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

    // Dashboard Breakdown Modal Event Listeners
    document.getElementById('closeBreakdownModalBtn')?.addEventListener('click', closeDashboardBreakdownModal);
    document.getElementById('closeBreakdownModalFooterBtn')?.addEventListener('click', closeDashboardBreakdownModal);
    document.getElementById('dashboardBreakdownModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'dashboardBreakdownModal') {
        closeDashboardBreakdownModal();
      }
    });

    document.getElementById('breakdownSearchInput')?.addEventListener('input', (e) => {
      State.breakdownSearch = e.target.value;
      const clearBtn = document.getElementById('breakdownClearSearchBtn');
      if (clearBtn) clearBtn.style.display = e.target.value ? 'inline-block' : 'none';
      renderDashboardBreakdownTable();
    });

    document.getElementById('breakdownClearSearchBtn')?.addEventListener('click', () => {
      const searchInp = document.getElementById('breakdownSearchInput');
      if (searchInp) searchInp.value = '';
      State.breakdownSearch = '';
      const clearBtn = document.getElementById('breakdownClearSearchBtn');
      if (clearBtn) clearBtn.style.display = 'none';
      renderDashboardBreakdownTable();
      searchInp?.focus();
    });

    document.querySelectorAll('#breakdownFilterTabs .breakdown-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#breakdownFilterTabs .breakdown-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        State.breakdownFilter = chip.dataset.bFilter || 'ALL';
        renderDashboardBreakdownTable();
      });
    });

    document.getElementById('breakdownAgentSelect')?.addEventListener('change', (e) => {
      State.breakdownAgent = e.target.value;
      State.breakdownBeat = 'ALL';
      populateBreakdownBeatDropdown(State.breakdownAgent, 'ALL');
      renderDashboardBreakdownTable();
    });

    document.getElementById('breakdownBeatSelect')?.addEventListener('change', (e) => {
      State.breakdownBeat = e.target.value;
      renderDashboardBreakdownTable();
    });

    document.getElementById('breakdownCopySummaryBtn')?.addEventListener('click', copyBreakdownSummaryText);

    // ================== BEAT ANALYSIS MODAL ==================
    document.getElementById('sidebarBeatAnalysisBtn')?.addEventListener('click', () => {
      openBeatAnalysisModal('ALL');
    });

    document.getElementById('btnOpenBeatAnalysis')?.addEventListener('click', () => {
      openBeatAnalysisModal('ALL');
    });

    document.getElementById('closeBeatAnalysisModalBtn')?.addEventListener('click', closeBeatAnalysisModal);
    document.getElementById('closeBeatAnalysisFooterBtn')?.addEventListener('click', closeBeatAnalysisModal);
    document.getElementById('beatAnalysisModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'beatAnalysisModal') {
        closeBeatAnalysisModal();
      }
    });

    document.getElementById('beatAnalysisAgentSelect')?.addEventListener('change', (e) => {
      State.beatAnalysisAgent = e.target.value;
      renderBeatAnalysisModal();
    });

    document.querySelectorAll('#beatAnalysisDateChips .diff-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#beatAnalysisDateChips .diff-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        State.beatAnalysisDateFilter = chip.dataset.bDate || 'TODAY';
        renderBeatAnalysisModal();
      });
    });

    document.getElementById('beatAnalysisSearchInput')?.addEventListener('input', (e) => {
      State.beatAnalysisSearch = e.target.value;
      const clearBtn = document.getElementById('beatAnalysisClearSearchBtn');
      if (clearBtn) clearBtn.style.display = e.target.value ? 'inline-block' : 'none';
      renderBeatAnalysisModal();
    });

    document.getElementById('beatAnalysisClearSearchBtn')?.addEventListener('click', () => {
      const searchInp = document.getElementById('beatAnalysisSearchInput');
      if (searchInp) searchInp.value = '';
      State.beatAnalysisSearch = '';
      const clearBtn = document.getElementById('beatAnalysisClearSearchBtn');
      if (clearBtn) clearBtn.style.display = 'none';
      renderBeatAnalysisModal();
      searchInp?.focus();
    });

    document.getElementById('beatAnalysisCopySummaryBtn')?.addEventListener('click', copyBeatAnalysisSummary);

    // Morning Dispatch Beat Filter buttons
    document.getElementById('dispatchFilterBeatOnlyBtn')?.addEventListener('click', () => {
      State.dispatchBeatFilter = 'BEAT';
      renderDispatchBasket();
    });
    document.getElementById('dispatchFilterAllBeatsBtn')?.addEventListener('click', () => {
      State.dispatchBeatFilter = 'ALL';
      renderDispatchBasket();
    });

    // Evening Return Beat Filter buttons
    document.getElementById('settlementFilterBeatOnlyBtn')?.addEventListener('click', () => {
      State.settlementBeatFilter = 'BEAT';
      loadSettlementForSelectedAgent();
    });
    document.getElementById('settlementFilterAllBeatsBtn')?.addEventListener('click', () => {
      State.settlementBeatFilter = 'ALL';
      loadSettlementForSelectedAgent();
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
    if (State.activeTab === 'tab-leftout') {
      renderLeftOutTab();
    }

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

    // Update home tab stats and basket on load
    renderDispatchBasket();
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
