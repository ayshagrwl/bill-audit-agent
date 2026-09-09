/**
 * BillAudit Pro - Sales Agent Custody & Collection Tracker
 * Core Application Logic, QR Engine, LocalStorage & Google Sheets Sync
 */

(function () {
  'use strict';

  // ========================================================
  // 1. STATE & STORAGE MANAGEMENT
  // ========================================================

  const STORAGE_KEYS = {
    BILLS: 'billAudit_bills',
    AGENTS: 'billAudit_agents',
    SETTINGS: 'billAudit_settings',
    OFFLINE_QUEUE: 'billAudit_offlineQueue',
    AUDIT_LOGS: 'billAudit_auditLogs'
  };

  // Default initial agents
  const DEFAULT_AGENTS = [
    { id: 'AG-101', name: 'Rahul Sharma', phone: '9876543210' },
    { id: 'AG-102', name: 'Vikram Singh', phone: '9812345678' },
    { id: 'AG-103', name: 'Amit Patel', phone: '9765432109' }
  ];

  // Default Settings
  const DEFAULT_SETTINGS = {
    scriptUrl: '',
    theme: 'light',
    continuousScan: true,
    audioSound: true
  };

  // State object
  const State = {
    bills: [],
    agents: [],
    settings: { ...DEFAULT_SETTINGS },
    offlineQueue: [],
    auditLogs: [],
    dispatchBasket: [],
    activeSettlementAgent: null,
    settlementBills: [],
    scannerDispatch: null,
    scannerSettlement: null,
    lastScannedCode: null,
    lastScanTimestamp: 0,
    currentPaymentBill: null,
    currentReturnBill: null,
    settlementScanMode: 'PAY' // 'PAY' or 'RETURN'
  };

  // Sound Synthesizer via Web Audio API (Zero external MP3 dependency)
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
        if (this.ctx.state === 'suspended') {
          this.ctx.resume();
        }

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        const now = this.ctx.currentTime;

        if (type === 'success') {
          // Cheerful high double-tone chime
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, now); // A5
          osc.frequency.setValueAtTime(1320, now + 0.08); // E6
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
          osc.start(now);
          osc.stop(now + 0.22);
        } else if (type === 'warning' || type === 'error') {
          // Low buzz
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.setValueAtTime(160, now + 0.1);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
          osc.start(now);
          osc.stop(now + 0.3);
        }
      } catch (e) {
        console.warn('Audio feedback failed:', e);
      }
    },
    vibrate(duration = 80) {
      if (navigator.vibrate) {
        navigator.vibrate(duration);
      }
    }
  };

  // Load data from LocalStorage
  function loadLocalState() {
    try {
      const storedBills = localStorage.getItem(STORAGE_KEYS.BILLS);
      State.bills = storedBills ? JSON.parse(storedBills) : [];

      const storedAgents = localStorage.getItem(STORAGE_KEYS.AGENTS);
      State.agents = storedAgents ? JSON.parse(storedAgents) : [...DEFAULT_AGENTS];

      const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (storedSettings) {
        State.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) };
      }

      const storedQueue = localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
      State.offlineQueue = storedQueue ? JSON.parse(storedQueue) : [];

      const storedLogs = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
      State.auditLogs = storedLogs ? JSON.parse(storedLogs) : [];
    } catch (e) {
      console.error('Error loading state from localStorage:', e);
    }
  }

  // Save data to LocalStorage
  function saveState(key) {
    try {
      if (!key || key === 'bills') localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(State.bills));
      if (!key || key === 'agents') localStorage.setItem(STORAGE_KEYS.AGENTS, JSON.stringify(State.agents));
      if (!key || key === 'settings') localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(State.settings));
      if (!key || key === 'queue') localStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(State.offlineQueue));
      if (!key || key === 'logs') localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(State.auditLogs));
    } catch (e) {
      console.error('Error saving state to localStorage:', e);
    }
  }

  // Toast Notification
  function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'danger') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // Format Currency (Indian Rupee formatting with commas)
  function formatINR(val) {
    const num = Number(val) || 0;
    return '₹' + num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // Date helper
  function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }


  // ========================================================
  // 2. ROBUST QR CODE PARSER
  // ========================================================
  /**
   * Parses QR Code data containing:
   * Bill Number, Party Name with ID, Bill Amount
   * Example: IN-FY26/27-3921,Satguru Provision Store,5,465.00
   * Handles amounts with internal commas, quotes, and alternative delimiters.
   */
  function parseQRCodeData(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const text = rawText.trim();
    if (!text) return null;

    // Helper to parse standard CSV line respecting quotes
    function parseCSVLine(line) {
      const values = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      return values.map(v => v.replace(/^["']|["']$/g, '').trim());
    }

    // Check for delimiter other than comma (pipe, semicolon, tab)
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
        return { billNo, party, amount, raw: text };
      }
    }

    // Parse comma-separated
    const csvParts = parseCSVLine(text);

    if (csvParts.length === 3) {
      const billNo = csvParts[0];
      const party = csvParts[1];
      const amountStr = csvParts[2];
      const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
      return { billNo, party, amount, raw: text };
    } else if (csvParts.length > 3) {
      // Handles unquoted commas in amount:
      // ["IN-FY26/27-3921", "Satguru Provision Store", "5", "465.00"]
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
      return { billNo, party, amount, raw: text };
    } else if (csvParts.length === 2) {
      // Format: BillNo, Amount (Party omitted)
      const billNo = csvParts[0];
      const amount = parseFloat(csvParts[1].replace(/,/g, '')) || 0;
      return { billNo, party: 'Standard Account', amount, raw: text };
    }

    // Fallback if only bill number is scanned
    return {
      billNo: text,
      party: 'Unknown Party',
      amount: 0,
      raw: text
    };
  }


  // ========================================================
  // 3. UI RENDERING & TAB SWITCHING
  // ========================================================

  function initUI() {
    // Set current date on date inputs
    const today = getTodayDateString();
    const dispatchDateInput = document.getElementById('dispatchDate');
    const settlementDateInput = document.getElementById('settlementDate');
    if (dispatchDateInput) dispatchDateInput.value = today;
    if (settlementDateInput) settlementDateInput.value = today;

    // Apply stored theme
    document.documentElement.setAttribute('data-theme', State.settings.theme);
    updateThemeIcon();

    // Render agents dropdowns
    renderAgentSelects();

    // Render Global Stats
    updateGlobalStats();

    // Setup network listeners
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    updateNetworkStatus();

    // Populate Settings UI
    const scriptUrlInput = document.getElementById('googleScriptUrl');
    if (scriptUrlInput) scriptUrlInput.value = State.settings.scriptUrl || '';

    const contToggle = document.getElementById('continuousScanToggle');
    if (contToggle) contToggle.checked = State.settings.continuousScan;

    const audioToggle = document.getElementById('audioBeepToggle');
    if (audioToggle) audioToggle.checked = State.settings.audioSound;

    updateOfflineQueueBadge();
  }

  function updateThemeIcon() {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    const isDark = State.settings.theme === 'dark';
    btn.innerHTML = isDark ? '<i class="fa-solid fa-sun text-warning"></i>' : '<i class="fa-solid fa-moon"></i>';
  }

  function toggleTheme() {
    State.settings.theme = State.settings.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', State.settings.theme);
    saveState('settings');
    updateThemeIcon();
  }

  function updateNetworkStatus() {
    const pill = document.getElementById('connectionStatus');
    if (!pill) return;
    const isOnline = navigator.onLine;
    pill.className = `status-pill ${isOnline ? 'online' : 'offline'}`;
    pill.innerHTML = `<span class="dot"></span><span class="status-text">${isOnline ? 'Online' : 'Offline'}</span>`;

    if (isOnline && State.offlineQueue.length > 0) {
      // Auto-trigger sync when back online
      processOfflineQueue();
    }
  }

  function updateOfflineQueueBadge() {
    const badge = document.getElementById('pendingBadge');
    const countLabel = document.getElementById('offlineQueueCount');
    const qCount = State.offlineQueue.length;

    if (badge) {
      if (qCount > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = qCount;
      } else {
        badge.style.display = 'none';
      }
    }
    if (countLabel) countLabel.textContent = qCount;
  }

  function switchTab(tabId) {
    // Deactivate all
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.b-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });

    // Pause cameras when switching away
    if (tabId !== 'tab-dispatch' && State.scannerDispatch) {
      stopDispatchScanner();
    }
    if (tabId !== 'tab-settlement' && State.scannerSettlement) {
      stopSettlementScanner();
    }

    // Tab-specific refreshes
    if (tabId === 'tab-ledger') {
      renderMasterLedger();
    } else if (tabId === 'tab-settlement') {
      loadSettlementForSelectedAgent();
    } else if (tabId === 'tab-settings') {
      renderAgentsManager();
    }
  }

  function renderAgentSelects() {
    const selects = [
      document.getElementById('dispatchAgentSelect'),
      document.getElementById('settlementAgentSelect'),
      document.getElementById('ledgerAgentFilter')
    ];

    selects.forEach(sel => {
      if (!sel) return;
      const currentVal = sel.value;
      const isFilter = sel.id === 'ledgerAgentFilter';

      sel.innerHTML = isFilter
        ? '<option value="ALL">All Agents</option>'
        : '<option value="">-- Choose Agent --</option>';

      State.agents.forEach(agent => {
        const opt = document.createElement('option');
        opt.value = agent.name;
        opt.textContent = `${agent.name} (${agent.id})`;
        sel.appendChild(opt);
      });

      if (currentVal) sel.value = currentVal;
    });
  }

  function updateGlobalStats() {
    let inCustodyCount = 0;
    let inCustodyAmt = 0;
    let collectedCount = 0;
    let collectedAmt = 0;
    let returnedCount = 0;
    let returnedAmt = 0;
    let missingCount = 0;
    let missingAmt = 0;

    State.bills.forEach(bill => {
      const amt = Number(bill.amount) || 0;
      const colAmt = Number(bill.collectedAmt) || 0;

      if (bill.status === 'WITH_AGENT') {
        inCustodyCount++;
        inCustodyAmt += amt;
      } else if (bill.status === 'PAID_FULL') {
        collectedCount++;
        collectedAmt += colAmt;
      } else if (bill.status === 'PAID_PARTIAL') {
        collectedCount++;
        collectedAmt += colAmt;
        returnedAmt += (amt - colAmt);
      } else if (bill.status === 'RETURNED_IN_HAND') {
        returnedCount++;
        returnedAmt += amt;
      } else if (bill.status === 'MISSING_ALERT') {
        missingCount++;
        missingAmt += amt;
      }
    });

    const elCustody = document.getElementById('statInCustody');
    const elCustodyAmt = document.getElementById('statInCustodyAmt');
    const elCollected = document.getElementById('statCollected');
    const elCollectedAmt = document.getElementById('statCollectedAmt');
    const elReturned = document.getElementById('statReturned');
    const elReturnedAmt = document.getElementById('statReturnedAmt');
    const elMissing = document.getElementById('statMissing');
    const elMissingAmt = document.getElementById('statMissingAmt');
    const cardMissing = document.getElementById('statCardMissing');

    if (elCustody) elCustody.textContent = inCustodyCount;
    if (elCustodyAmt) elCustodyAmt.textContent = formatINR(inCustodyAmt);
    if (elCollected) elCollected.textContent = collectedCount;
    if (elCollectedAmt) elCollectedAmt.textContent = formatINR(collectedAmt);
    if (elReturned) elReturned.textContent = returnedCount;
    if (elReturnedAmt) elReturnedAmt.textContent = formatINR(returnedAmt);
    if (elMissing) elMissing.textContent = missingCount;
    if (elMissingAmt) elMissingAmt.textContent = formatINR(missingAmt);

    if (cardMissing) {
      cardMissing.classList.toggle('has-missing', missingCount > 0);
    }
  }


  // ========================================================
  // 4. TAB 1: DISPATCH / HANDOVER WORKFLOW
  // ========================================================

  function handleScannedCodeDispatch(decodedText) {
    const now = Date.now();
    // Debounce duplicate scans within 1.5 seconds
    if (decodedText === State.lastScannedCode && now - State.lastScanTimestamp < 1500) {
      return;
    }
    State.lastScannedCode = decodedText;
    State.lastScanTimestamp = now;

    const parsed = parseQRCodeData(decodedText);
    if (!parsed || !parsed.billNo) {
      SoundFX.playBeep('error');
      showToast('Could not recognize Bill QR format', 'warning');
      return;
    }

    addBillToDispatchBasket(parsed);
  }

  function addBillToDispatchBasket(parsed) {
    const agentSelect = document.getElementById('dispatchAgentSelect');
    if (!agentSelect.value) {
      SoundFX.playBeep('warning');
      showToast('Please select a Sales Agent first before scanning bills', 'warning');
      agentSelect.focus();
      return;
    }

    // Check if already in staging basket
    const existsInBasket = State.dispatchBasket.some(b => b.billNo === parsed.billNo);
    if (existsInBasket) {
      SoundFX.playBeep('warning');
      showToast(`Bill ${parsed.billNo} is already in the dispatch list!`, 'warning');
      return;
    }

    // Check if already active with an agent in custody
    const existingActive = State.bills.find(b => b.billNo === parsed.billNo && b.status === 'WITH_AGENT');
    if (existingActive) {
      SoundFX.playBeep('warning');
      showToast(`Bill ${parsed.billNo} is already currently with agent ${existingActive.agent}!`, 'warning');
      return;
    }

    // Add to basket
    const basketItem = {
      billNo: parsed.billNo,
      party: parsed.party,
      amount: parsed.amount,
      scannedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      raw: parsed.raw
    };

    State.dispatchBasket.push(basketItem);
    SoundFX.playBeep('success');
    SoundFX.vibrate(60);
    showToast(`Scanned: ${parsed.billNo} (${formatINR(parsed.amount)})`, 'success', 2000);

    renderDispatchBasket();

    // If continuous scan is OFF, stop camera
    if (!State.settings.continuousScan) {
      stopDispatchScanner();
    }
  }

  function renderDispatchBasket() {
    const tbody = document.getElementById('dispatchBasketTbody');
    const countBadge = document.getElementById('dispatchBasketCount');
    const totalLabel = document.getElementById('dispatchBasketTotal');
    const confirmBtn = document.getElementById('confirmDispatchBtn');
    const printBtn = document.getElementById('printHandoverSlipBtn');
    const waBtn = document.getElementById('whatsappHandoverBtn');

    if (!tbody) return;

    if (State.dispatchBasket.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="6">
            <div class="empty-state">
              <i class="fa-solid fa-qrcode"></i>
              <p>No bills scanned yet. Start camera or type QR text above.</p>
            </div>
          </td>
        </tr>
      `;
      countBadge.textContent = '0 Bills';
      totalLabel.textContent = formatINR(0);
      confirmBtn.disabled = true;
      if (printBtn) printBtn.disabled = true;
      if (waBtn) waBtn.disabled = true;
      return;
    }

    let totalVal = 0;
    tbody.innerHTML = '';

    State.dispatchBasket.forEach((item, index) => {
      totalVal += Number(item.amount) || 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td><strong class="font-mono text-primary">${item.billNo}</strong></td>
        <td>${item.party}</td>
        <td><span class="font-mono font-bold">${formatINR(item.amount)}</span></td>
        <td><small class="text-muted">${item.scannedAt}</small></td>
        <td>
          <button class="btn-xs btn-outline-danger" data-remove-index="${index}" title="Remove">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    countBadge.textContent = `${State.dispatchBasket.length} Bills`;
    totalLabel.textContent = formatINR(totalVal);
    confirmBtn.disabled = false;
    if (printBtn) printBtn.disabled = false;
    if (waBtn) waBtn.disabled = false;

    // Attach remove listeners
    tbody.querySelectorAll('[data-remove-index]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(btn.dataset.removeIndex, 10);
        State.dispatchBasket.splice(idx, 1);
        renderDispatchBasket();
      });
    });
  }

  function confirmDispatchHandover() {
    const agent = document.getElementById('dispatchAgentSelect').value;
    const date = document.getElementById('dispatchDate').value || getTodayDateString();

    if (!agent) {
      showToast('Please select a Sales Agent', 'warning');
      return;
    }
    if (State.dispatchBasket.length === 0) {
      showToast('No bills in the dispatch list to confirm', 'warning');
      return;
    }

    const timestamp = new Date().toISOString();
    const newBills = [];

    State.dispatchBasket.forEach(b => {
      // Check if bill already existed in database (e.g. from previous week)
      let billRecord = State.bills.find(item => item.billNo === b.billNo);

      if (!billRecord) {
        billRecord = {
          billNo: b.billNo,
          party: b.party,
          amount: b.amount,
          agent: agent,
          dispatchDate: date,
          status: 'WITH_AGENT',
          collectedAmt: 0,
          paymentMode: '',
          refNo: '',
          returnReason: '',
          remarks: 'Dispatched for route',
          lastActionDate: timestamp,
          history: []
        };
        State.bills.unshift(billRecord);
      } else {
        // Update existing record
        billRecord.agent = agent;
        billRecord.dispatchDate = date;
        billRecord.status = 'WITH_AGENT';
        billRecord.collectedAmt = 0;
        billRecord.paymentMode = '';
        billRecord.returnReason = '';
        billRecord.remarks = 'Re-dispatched for route';
        billRecord.lastActionDate = timestamp;
      }

      billRecord.history.push({
        action: 'DISPATCHED',
        agent: agent,
        date: date,
        timestamp: timestamp
      });

      newBills.push({ ...billRecord });

      // Add to audit logs
      State.auditLogs.unshift({
        id: 'LOG-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        billNo: b.billNo,
        action: 'DISPATCH_HANDOVER',
        agent: agent,
        amount: b.amount,
        timestamp: timestamp,
        notes: `Handed over to ${agent} for route ${date}`
      });
    });

    // Queue for Google Sheets Sync
    queueSyncAction('BATCH_DISPATCH', {
      agent: agent,
      dispatchDate: date,
      timestamp: timestamp,
      bills: newBills
    });

    saveState();
    updateGlobalStats();

    const count = State.dispatchBasket.length;
    State.dispatchBasket = [];
    renderDispatchBasket();

    SoundFX.playBeep('success');
    showToast(`Successfully issued ${count} bills to ${agent}!`, 'success', 4000);
  }


  // ========================================================
  // 5. TAB 2: END OF DAY SETTLEMENT & FRAUD PREVENTION AUDIT
  // ========================================================

  function loadSettlementForSelectedAgent() {
    const agentSelect = document.getElementById('settlementAgentSelect');
    const agent = agentSelect.value;
    State.activeSettlementAgent = agent;

    const tbody = document.getElementById('settlementTbody');
    const countBadge = document.getElementById('agentBillsCount');
    const alertBanner = document.getElementById('missingBillAlertBanner');

    if (!agent) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="7">
            <div class="empty-state">
              <i class="fa-solid fa-user-clock"></i>
              <p>Select an agent and click "Load Agent Custody" to begin EOD settlement.</p>
            </div>
          </td>
        </tr>
      `;
      countBadge.textContent = '0 Bills';
      updateSettlementAuditDashboard([]);
      if (alertBanner) alertBanner.style.display = 'none';
      return;
    }

    // Bills that were dispatched to this agent (active or audited today)
    const agentBills = State.bills.filter(b => b.agent === agent);
    State.settlementBills = agentBills;

    renderSettlementTable(agentBills);
    updateSettlementAuditDashboard(agentBills);
  }

  function updateSettlementAuditDashboard(bills) {
    let totalCount = bills.length;
    let totalAmt = 0;
    let paidCount = 0;
    let paidAmt = 0;
    let returnedCount = 0;
    let returnedAmt = 0;
    let missingCount = 0;
    let missingAmt = 0;

    bills.forEach(b => {
      const amt = Number(b.amount) || 0;
      const colAmt = Number(b.collectedAmt) || 0;
      totalAmt += amt;

      if (b.status === 'PAID_FULL') {
        paidCount++;
        paidAmt += colAmt;
      } else if (b.status === 'PAID_PARTIAL') {
        paidCount++;
        paidAmt += colAmt;
        returnedAmt += (amt - colAmt);
      } else if (b.status === 'RETURNED_IN_HAND') {
        returnedCount++;
        returnedAmt += amt;
      } else if (b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT') {
        // Bills that are still with agent or flagged missing
        missingCount++;
        missingAmt += amt;
      }
    });

    document.getElementById('audTotalCount').textContent = totalCount;
    document.getElementById('audTotalAmt').textContent = formatINR(totalAmt);
    document.getElementById('audPaidCount').textContent = paidCount;
    document.getElementById('audPaidAmt').textContent = formatINR(paidAmt);
    document.getElementById('audReturnedCount').textContent = returnedCount;
    document.getElementById('audReturnedAmt').textContent = formatINR(returnedAmt);

    const elMissingCount = document.getElementById('audMissingCount');
    const elMissingAmt = document.getElementById('audMissingAmt');
    const alertBanner = document.getElementById('missingBillAlertBanner');
    const alertCount = document.getElementById('alertMissingCount');

    elMissingCount.textContent = missingCount;
    elMissingAmt.textContent = formatINR(missingAmt);

    // Alert Banner logic: if bills remain unaccounted
    if (missingCount > 0 && bills.length > 0) {
      if (alertBanner) {
        alertBanner.style.display = 'flex';
        if (alertCount) alertCount.textContent = missingCount;
      }
    } else {
      if (alertBanner) alertBanner.style.display = 'none';
    }

    // Update filter chips counts
    const chipAll = document.getElementById('chipAllCount');
    const chipPending = document.getElementById('chipPendingCount');
    const chipPaid = document.getElementById('chipPaidCount');
    const chipReturned = document.getElementById('chipReturnedCount');
    const chipMissing = document.getElementById('chipMissingCount');

    if (chipAll) chipAll.textContent = totalCount;
    if (chipPending) chipPending.textContent = bills.filter(b => b.status === 'WITH_AGENT').length;
    if (chipPaid) chipPaid.textContent = paidCount;
    if (chipReturned) chipReturned.textContent = returnedCount;
    if (chipMissing) chipMissing.textContent = missingCount;
  }

  function renderSettlementTable(bills, filter = 'ALL') {
    const tbody = document.getElementById('settlementTbody');
    const countBadge = document.getElementById('agentBillsCount');
    if (!tbody) return;

    let filtered = bills;
    if (filter === 'PENDING') filtered = bills.filter(b => b.status === 'WITH_AGENT');
    else if (filter === 'PAID') filtered = bills.filter(b => b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL');
    else if (filter === 'RETURNED') filtered = bills.filter(b => b.status === 'RETURNED_IN_HAND');
    else if (filter === 'MISSING') filtered = bills.filter(b => b.status === 'WITH_AGENT' || b.status === 'MISSING_ALERT');

    countBadge.textContent = `${filtered.length} Bills`;

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="7">
            <div class="empty-state">
              <i class="fa-solid fa-file-circle-check"></i>
              <p>No bills match this filter.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    filtered.forEach(bill => {
      const tr = document.createElement('tr');

      // Check if this is an unaccounted/missing bill
      const isMissing = bill.status === 'WITH_AGENT' || bill.status === 'MISSING_ALERT';
      if (isMissing) {
        tr.classList.add('highlight-missing-row');
      }

      // Badge style
      let badgeHtml = '';
      if (bill.status === 'WITH_AGENT') {
        badgeHtml = '<span class="status-badge badge-missing"><i class="fa-solid fa-triangle-exclamation"></i> In Custody (Pending Scan)</span>';
      } else if (bill.status === 'PAID_FULL') {
        badgeHtml = '<span class="status-badge badge-paid"><i class="fa-solid fa-check"></i> Paid (Full)</span>';
      } else if (bill.status === 'PAID_PARTIAL') {
        badgeHtml = '<span class="status-badge badge-partial"><i class="fa-solid fa-chart-pie"></i> Paid (Partial)</span>';
      } else if (bill.status === 'RETURNED_IN_HAND') {
        badgeHtml = '<span class="status-badge badge-returned"><i class="fa-solid fa-circle-check"></i> Physical Bill in Hand</span>';
      } else if (bill.status === 'MISSING_ALERT') {
        badgeHtml = '<span class="status-badge badge-missing"><i class="fa-solid fa-triangle-exclamation"></i> MISSING ALERT</span>';
      }

      // Notes
      let detailsNote = '-';
      if (bill.status === 'PAID_FULL' || bill.status === 'PAID_PARTIAL') {
        detailsNote = `<strong>${bill.paymentMode || 'Cash'}</strong> ${bill.refNo ? '(' + bill.refNo + ')' : ''}`;
      } else if (bill.status === 'RETURNED_IN_HAND') {
        detailsNote = `<small class="text-muted">Reason: ${bill.returnReason || 'Rescheduled'}</small>`;
      }

      tr.innerHTML = `
        <td><strong class="font-mono text-primary">${bill.billNo}</strong></td>
        <td>${bill.party}</td>
        <td><span class="font-mono font-bold">${formatINR(bill.amount)}</span></td>
        <td>${badgeHtml}</td>
        <td><strong class="font-mono text-success">${bill.collectedAmt > 0 ? formatINR(bill.collectedAmt) : '-'}</strong></td>
        <td>${detailsNote}</td>
        <td>
          <div class="btn-group-sm">
            <button class="btn-xs btn-outline btn-pay" data-bill="${bill.billNo}" title="Receive Payment">
              <i class="fa-solid fa-money-bill-wave text-success"></i> Pay
            </button>
            <button class="btn-xs btn-outline btn-return" data-bill="${bill.billNo}" title="Verify Physical Return">
              <i class="fa-solid fa-hand-holding-dollar text-primary"></i> Return
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Wire action buttons
    tbody.querySelectorAll('.btn-pay').forEach(btn => {
      btn.addEventListener('click', () => {
        const billNo = btn.dataset.bill;
        const bill = State.bills.find(b => b.billNo === billNo);
        if (bill) openPaymentModal(bill);
      });
    });

    tbody.querySelectorAll('.btn-return').forEach(btn => {
      btn.addEventListener('click', () => {
        const billNo = btn.dataset.bill;
        const bill = State.bills.find(b => b.billNo === billNo);
        if (bill) openReturnModal(bill);
      });
    });
  }

  // Handle scans during Settlement
  function handleScannedCodeSettlement(decodedText) {
    const now = Date.now();
    if (decodedText === State.lastScannedCode && now - State.lastScanTimestamp < 1500) {
      return;
    }
    State.lastScannedCode = decodedText;
    State.lastScanTimestamp = now;

    const parsed = parseQRCodeData(decodedText);
    if (!parsed || !parsed.billNo) {
      SoundFX.playBeep('error');
      showToast('Could not recognize Bill QR format', 'warning');
      return;
    }

    processSettlementBill(parsed.billNo, parsed);
  }

  function processSettlementBill(billNo, parsedFallback = null) {
    if (!State.activeSettlementAgent) {
      SoundFX.playBeep('warning');
      showToast('Please select an agent first!', 'warning');
      return;
    }

    // Look for bill in master records
    let bill = State.bills.find(b => b.billNo === billNo);

    if (!bill && parsedFallback) {
      // Bill was not pre-registered in system, create it directly
      bill = {
        billNo: parsedFallback.billNo,
        party: parsedFallback.party,
        amount: parsedFallback.amount,
        agent: State.activeSettlementAgent,
        dispatchDate: getTodayDateString(),
        status: 'WITH_AGENT',
        collectedAmt: 0,
        paymentMode: '',
        refNo: '',
        returnReason: '',
        remarks: 'Scanned at settlement',
        lastActionDate: new Date().toISOString(),
        history: []
      };
      State.bills.unshift(bill);
      saveState('bills');
    }

    if (!bill) {
      SoundFX.playBeep('error');
      showToast(`Bill ${billNo} was not found in records`, 'danger');
      return;
    }

    // Verify agent ownership
    if (bill.agent !== State.activeSettlementAgent) {
      SoundFX.playBeep('warning');
      const proceed = confirm(`Warning: Bill ${billNo} was issued to ${bill.agent}, not ${State.activeSettlementAgent}. Do you want to settle it anyway?`);
      if (!proceed) return;
    }

    SoundFX.playBeep('success');
    SoundFX.vibrate(60);

    // Open appropriate modal based on active scan mode
    if (State.settlementScanMode === 'PAY') {
      openPaymentModal(bill);
    } else {
      openReturnModal(bill);
    }
  }


  // ========================================================
  // 6. MODALS: PAYMENT & PHYSICAL RETURN
  // ========================================================

  function openPaymentModal(bill) {
    State.currentPaymentBill = bill;

    document.getElementById('modalBillNo').textContent = bill.billNo;
    document.getElementById('modalPartyName').textContent = bill.party;
    document.getElementById('modalBillAmt').textContent = formatINR(bill.amount);

    const collectedInput = document.getElementById('modalCollectedAmt');
    collectedInput.value = bill.amount;
    collectedInput.max = bill.amount;

    const balanceHint = document.getElementById('modalBalanceHint');
    if (balanceHint) balanceHint.style.display = 'none';

    document.getElementById('modalPaymentRemarks').value = '';
    document.getElementById('modalRefNo').value = '';

    // Reset radio to Full
    document.querySelectorAll('input[name="paymentType"]').forEach(r => {
      r.checked = r.value === 'FULL';
    });

    document.getElementById('paymentModal').style.display = 'flex';
    collectedInput.focus();
  }

  function closePaymentModal() {
    document.getElementById('paymentModal').style.display = 'none';
    State.currentPaymentBill = null;
  }

  function savePaymentRecord(e) {
    e.preventDefault();
    const bill = State.currentPaymentBill;
    if (!bill) return;

    const form = e.target;
    const paymentType = form.elements['paymentType'].value;
    const collectedAmt = parseFloat(document.getElementById('modalCollectedAmt').value) || 0;
    const paymentMode = document.getElementById('modalPaymentMode').value;
    const refNo = document.getElementById('modalRefNo').value.trim();
    const remarks = document.getElementById('modalPaymentRemarks').value.trim();
    const timestamp = new Date().toISOString();

    bill.status = paymentType === 'FULL' || collectedAmt >= bill.amount ? 'PAID_FULL' : 'PAID_PARTIAL';
    bill.collectedAmt = collectedAmt;
    bill.paymentMode = paymentMode;
    bill.refNo = refNo;
    bill.remarks = remarks || `Payment received via ${paymentMode}`;
    bill.lastActionDate = timestamp;

    bill.history.push({
      action: bill.status,
      amount: collectedAmt,
      mode: paymentMode,
      ref: refNo,
      timestamp: timestamp
    });

    // Add to audit logs
    State.auditLogs.unshift({
      id: 'LOG-' + Date.now(),
      billNo: bill.billNo,
      action: bill.status,
      agent: bill.agent,
      amount: collectedAmt,
      timestamp: timestamp,
      notes: `Collected ${formatINR(collectedAmt)} via ${paymentMode}. Ref: ${refNo}`
    });

    // Queue for Google Sheets Sync
    queueSyncAction('SETTLEMENT_PAYMENT', {
      billNo: bill.billNo,
      agent: bill.agent,
      status: bill.status,
      collectedAmt: collectedAmt,
      paymentMode: paymentMode,
      refNo: refNo,
      remarks: bill.remarks,
      timestamp: timestamp
    });

    saveState();
    updateGlobalStats();
    closePaymentModal();
    loadSettlementForSelectedAgent();

    SoundFX.playBeep('success');
    showToast(`Saved payment of ${formatINR(collectedAmt)} for ${bill.billNo}!`, 'success');
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
    bill.remarks = remarks || `Verified physically present in hand for next round`;
    bill.lastActionDate = timestamp;

    bill.history.push({
      action: 'RETURNED_IN_HAND',
      reason: reason,
      remarks: remarks,
      timestamp: timestamp
    });

    // Add to audit logs
    State.auditLogs.unshift({
      id: 'LOG-' + Date.now(),
      billNo: bill.billNo,
      action: 'RETURNED_IN_HAND',
      agent: bill.agent,
      amount: bill.amount,
      timestamp: timestamp,
      notes: `Physical bill verified in hand. Reason: ${reason}`
    });

    // Queue for Google Sheets Sync
    queueSyncAction('SETTLEMENT_RETURN', {
      billNo: bill.billNo,
      agent: bill.agent,
      status: 'RETURNED_IN_HAND',
      returnReason: reason,
      remarks: bill.remarks,
      timestamp: timestamp
    });

    saveState();
    updateGlobalStats();
    closeReturnModal();
    loadSettlementForSelectedAgent();

    SoundFX.playBeep('success');
    showToast(`Physical return verified for ${bill.billNo} (Next Round)!`, 'success');
  }

  function finalizeDailySettlement() {
    const agent = State.activeSettlementAgent;
    if (!agent) {
      showToast('Select an agent to finalize settlement', 'warning');
      return;
    }

    const bills = State.bills.filter(b => b.agent === agent);
    const unaccounted = bills.filter(b => b.status === 'WITH_AGENT');

    if (unaccounted.length > 0) {
      SoundFX.playBeep('error');
      const confirmForce = confirm(
        `ALERT: There are still ${unaccounted.length} UNACCOUNTED BILLS that were not scanned as paid or returned.\n\n` +
        `Flag these ${unaccounted.length} bills as FRAUD / MISSING?`
      );
      if (!confirmForce) return;

      // Mark as Missing Alert
      const timestamp = new Date().toISOString();
      unaccounted.forEach(b => {
        b.status = 'MISSING_ALERT';
        b.remarks = `FRAUD RISK: Not presented at EOD settlement on ${getTodayDateString()}`;
        b.lastActionDate = timestamp;

        queueSyncAction('BILL_FLAG_MISSING', {
          billNo: b.billNo,
          agent: agent,
          status: 'MISSING_ALERT',
          timestamp: timestamp
        });
      });

      saveState();
      updateGlobalStats();
      loadSettlementForSelectedAgent();
    }

    SoundFX.playBeep('success');
    showToast(`Daily settlement closed for ${agent}!`, 'success', 4000);
    sendSettlementWhatsApp();
  }

  function sendSettlementWhatsApp() {
    const agent = State.activeSettlementAgent;
    if (!agent) {
      showToast('Select an agent first', 'warning');
      return;
    }

    const bills = State.bills.filter(b => b.agent === agent);
    let totalAmt = 0, paidAmt = 0, returnedAmt = 0, missingAmt = 0;
    let paidCount = 0, returnedCount = 0, missingCount = 0;

    bills.forEach(b => {
      const amt = Number(b.amount) || 0;
      totalAmt += amt;
      if (b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL') {
        paidCount++;
        paidAmt += Number(b.collectedAmt) || 0;
      } else if (b.status === 'RETURNED_IN_HAND') {
        returnedCount++;
        returnedAmt += amt;
      } else {
        missingCount++;
        missingAmt += amt;
      }
    });

    const agentObj = State.agents.find(a => a.name === agent);
    const phone = agentObj ? agentObj.phone : '';

    const msg = 
`*DAILY BILL SETTLEMENT REPORT*
*Agent:* ${agent}
*Date:* ${getTodayDateString()}
-------------------------
📋 *Total Dispatched:* ${bills.length} bills (${formatINR(totalAmt)})
💰 *Payment Collected:* ${paidCount} bills (${formatINR(paidAmt)})
🔄 *Returned In-Hand:* ${returnedCount} bills (${formatINR(returnedAmt)})
${missingCount > 0 ? `⚠️ *UNACCOUNTED / MISSING:* ${missingCount} bills (${formatINR(missingAmt)})` : '✅ *All Bills Accounted For!*'}
-------------------------
_Generated via BillAudit Pro_`;

    const encoded = encodeURI(msg);
    const url = phone ? `https://wa.me/91${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank');
  }


  // ========================================================
  // 7. TAB 3: MASTER LEDGER & EXPORTS
  // ========================================================

  function renderMasterLedger() {
    const tbody = document.getElementById('masterLedgerTbody');
    if (!tbody) return;

    const search = (document.getElementById('ledgerSearchInput').value || '').toLowerCase();
    const agentFilter = document.getElementById('ledgerAgentFilter').value;
    const statusFilter = document.getElementById('ledgerStatusFilter').value;
    const dateFilter = document.getElementById('ledgerDateFilter').value;

    const todayStr = getTodayDateString();

    const filtered = State.bills.filter(bill => {
      // Search
      if (search) {
        const matchBill = bill.billNo.toLowerCase().includes(search);
        const matchParty = (bill.party || '').toLowerCase().includes(search);
        if (!matchBill && !matchParty) return false;
      }

      // Agent
      if (agentFilter !== 'ALL' && bill.agent !== agentFilter) return false;

      // Status
      if (statusFilter !== 'ALL' && bill.status !== statusFilter) return false;

      // Date
      if (dateFilter === 'TODAY' && bill.dispatchDate !== todayStr) return false;

      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="9">
            <div class="empty-state">
              <i class="fa-solid fa-filter-circle-xmark"></i>
              <p>No matching bills found in ledger.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    filtered.forEach(bill => {
      const tr = document.createElement('tr');
      if (bill.status === 'MISSING_ALERT') {
        tr.classList.add('highlight-missing-row');
      }

      let statusBadge = '';
      if (bill.status === 'WITH_AGENT') {
        statusBadge = '<span class="status-badge badge-with-agent">With Agent</span>';
      } else if (bill.status === 'PAID_FULL') {
        statusBadge = '<span class="status-badge badge-paid">Paid (Full)</span>';
      } else if (bill.status === 'PAID_PARTIAL') {
        statusBadge = '<span class="status-badge badge-partial">Paid (Partial)</span>';
      } else if (bill.status === 'RETURNED_IN_HAND') {
        statusBadge = '<span class="status-badge badge-returned">Returned Next Round</span>';
      } else if (bill.status === 'MISSING_ALERT') {
        statusBadge = '<span class="status-badge badge-missing">⚠️ MISSING</span>';
      }

      let paymentOrReason = '-';
      if (bill.status === 'PAID_FULL' || bill.status === 'PAID_PARTIAL') {
        paymentOrReason = `${bill.paymentMode || 'Cash'} ${bill.refNo ? '#' + bill.refNo : ''}`;
      } else if (bill.status === 'RETURNED_IN_HAND') {
        paymentOrReason = bill.returnReason || 'Rescheduled';
      } else if (bill.status === 'MISSING_ALERT') {
        paymentOrReason = '<span class="text-danger">Not Returned</span>';
      }

      const lastDate = bill.lastActionDate ? new Date(bill.lastActionDate).toLocaleDateString() : '-';

      tr.innerHTML = `
        <td><strong class="font-mono text-primary">${bill.billNo}</strong></td>
        <td>${bill.party}</td>
        <td><span class="font-mono font-bold">${formatINR(bill.amount)}</span></td>
        <td><strong>${bill.agent || '-'}</strong></td>
        <td><small>${bill.dispatchDate || '-'}</small></td>
        <td>${statusBadge}</td>
        <td><strong class="font-mono text-success">${bill.collectedAmt > 0 ? formatINR(bill.collectedAmt) : '-'}</strong></td>
        <td><small>${paymentOrReason}</small></td>
        <td><small class="text-muted">${lastDate}</small></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function exportLedgerToCSV() {
    if (State.bills.length === 0) {
      showToast('No bills to export', 'warning');
      return;
    }

    const headers = ['Bill Number', 'Party Name', 'Bill Amount', 'Sales Agent', 'Dispatch Date', 'Status', 'Collected Amount', 'Payment Mode', 'Reference No', 'Return Reason', 'Remarks', 'Last Action'];
    const rows = State.bills.map(b => [
      `"${b.billNo}"`,
      `"${(b.party || '').replace(/"/g, '""')}"`,
      b.amount,
      `"${b.agent || ''}"`,
      `"${b.dispatchDate || ''}"`,
      `"${b.status}"`,
      b.collectedAmt || 0,
      `"${b.paymentMode || ''}"`,
      `"${b.refNo || ''}"`,
      `"${(b.returnReason || '').replace(/"/g, '""')}"`,
      `"${(b.remarks || '').replace(/"/g, '""')}"`,
      `"${b.lastActionDate || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `BillAudit_Master_Ledger_${getTodayDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast('Exported CSV successfully!', 'success');
  }


  // ========================================================
  // 8. GOOGLE SHEETS & APPS SCRIPT CLOUD INTEGRATION
  // ========================================================

  function queueSyncAction(actionType, data) {
    State.offlineQueue.push({
      id: 'Q-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      type: actionType,
      timestamp: new Date().toISOString(),
      payload: data
    });
    saveState('queue');
    updateOfflineQueueBadge();

    // If online and URL configured, try immediate sync
    if (navigator.onLine && State.settings.scriptUrl) {
      processOfflineQueue();
    }
  }

  async function processOfflineQueue() {
    if (!State.settings.scriptUrl) {
      return;
    }
    if (State.offlineQueue.length === 0) {
      return;
    }

    const quickSyncBtn = document.getElementById('quickSyncBtn');
    const syncStatusText = document.getElementById('syncStatusText');
    if (quickSyncBtn) quickSyncBtn.classList.add('syncing');
    if (syncStatusText) syncStatusText.textContent = 'Syncing...';

    const queueSnapshot = [...State.offlineQueue];

    try {
      // Send batch payload
      const response = await fetch(State.settings.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight issues with Apps Script
        body: JSON.stringify({
          action: 'BATCH_SYNC',
          queue: queueSnapshot,
          bills: State.bills,
          timestamp: new Date().toISOString()
        })
      });

      const result = await response.json();

      if (result && result.success) {
        // Clear processed items
        State.offlineQueue = [];
        saveState('queue');
        updateOfflineQueueBadge();
        showToast('Google Sheet updated successfully!', 'success');
        if (syncStatusText) syncStatusText.textContent = 'Synced';
      } else {
        throw new Error(result?.error || 'Unknown error');
      }
    } catch (err) {
      console.warn('Sync failed (will retry later):', err);
      if (syncStatusText) syncStatusText.textContent = 'Offline (Queued)';
    } finally {
      if (quickSyncBtn) quickSyncBtn.classList.remove('syncing');
    }
  }

  async function testGoogleSheetConnection() {
    const url = (document.getElementById('googleScriptUrl').value || '').trim();
    if (!url) {
      showToast('Please enter your Google Apps Script URL first', 'warning');
      return;
    }

    const testBtn = document.getElementById('testSheetConnectionBtn');
    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting...';

    try {
      const resp = await fetch(`${url}?action=PING&t=${Date.now()}`);
      const data = await resp.json();

      if (data && data.status === 'OK') {
        SoundFX.playBeep('success');
        showToast(`Connected to Google Sheets successfully! (${data.message || 'Ready'})`, 'success');
        State.settings.scriptUrl = url;
        saveState('settings');
      } else {
        throw new Error(data?.message || 'Invalid response');
      }
    } catch (err) {
      SoundFX.playBeep('error');
      alert(`Could not connect to Google Sheet URL.\n\nError: ${err.message}\n\nPlease make sure:\n1. You deployed the Apps Script as a Web App\n2. 'Who has access' is set to 'Anyone'\n3. You copied the Web App URL correctly.`);
    } finally {
      testBtn.disabled = false;
      testBtn.innerHTML = '<i class="fa-solid fa-plug"></i> Test Connection';
    }
  }

  async function pullFromGoogleSheet() {
    const url = State.settings.scriptUrl;
    if (!url) {
      showToast('Please configure Google Apps Script URL in Settings', 'warning');
      return;
    }

    const btn = document.getElementById('pullFromSheetBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching...';

    try {
      const resp = await fetch(`${url}?action=GET_DATA&t=${Date.now()}`);
      const data = await resp.json();

      if (data && data.bills) {
        State.bills = data.bills;
        if (data.agents && data.agents.length > 0) {
          State.agents = data.agents;
        }
        saveState();
        updateGlobalStats();
        renderAgentSelects();
        renderMasterLedger();
        SoundFX.playBeep('success');
        showToast(`Pulled ${data.bills.length} bills from Google Sheet!`, 'success');
      } else {
        throw new Error('No bills data returned');
      }
    } catch (err) {
      SoundFX.playBeep('error');
      showToast(`Failed to fetch from Sheet: ${err.message}`, 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Pull Latest from Sheet';
    }
  }


  // ========================================================
  // 9. AGENT MANAGEMENT & DEMO DATA
  // ========================================================

  function renderAgentsManager() {
    const container = document.getElementById('agentsListContainer');
    if (!container) return;

    container.innerHTML = '';
    State.agents.forEach((ag, idx) => {
      const row = document.createElement('div');
      row.className = 'agent-row';
      row.innerHTML = `
        <div class="agent-info">
          <i class="fa-solid fa-user-tie text-primary"></i>
          <div>
            <span>${ag.name}</span>
            <small class="text-muted" style="margin-left: 8px;">ID: ${ag.id} | Phone: ${ag.phone || 'N/A'}</small>
          </div>
        </div>
        <button class="btn-xs btn-outline-danger" data-remove-agent="${idx}">
          <i class="fa-solid fa-trash"></i>
        </button>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('[data-remove-agent]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.removeAgent, 10);
        const name = State.agents[idx].name;
        if (confirm(`Remove agent "${name}"?`)) {
          State.agents.splice(idx, 1);
          saveState('agents');
          renderAgentsManager();
          renderAgentSelects();
          showToast(`Agent ${name} removed`, 'info');
        }
      });
    });
  }

  function addNewAgent(name, phone) {
    if (!name.trim()) return;
    const newId = 'AG-' + (100 + State.agents.length + 1);
    State.agents.push({
      id: newId,
      name: name.trim(),
      phone: phone.trim()
    });
    saveState('agents');
    renderAgentsManager();
    renderAgentSelects();
    showToast(`Added agent ${name} (${newId})`, 'success');
  }

  function loadSampleTestBills() {
    const sampleQrs = [
      'IN-FY26/27-3921,Satguru Provision Store,5,465.00',
      'IN-FY26/27-3922,Mahaveer Super Market (ID: 108),12,850.00',
      'IN-FY26/27-3923,Balaji General Store,3,200.00',
      'IN-FY26/27-3924,Kailash Kirana & Oil Depot,28,400.00',
      'IN-FY26/27-3925,Shree Ganesh Retailers,8,950.50'
    ];

    const agent = State.agents[0] ? State.agents[0].name : 'Rahul Sharma';
    const date = getTodayDateString();

    sampleQrs.forEach(raw => {
      const parsed = parseQRCodeData(raw);
      if (parsed) {
        State.dispatchBasket.push({
          billNo: parsed.billNo,
          party: parsed.party,
          amount: parsed.amount,
          scannedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          raw: raw
        });
      }
    });

    // Select first agent
    const select = document.getElementById('dispatchAgentSelect');
    if (select) select.value = agent;

    renderDispatchBasket();
    switchTab('tab-dispatch');
    SoundFX.playBeep('success');
    showToast('Loaded 5 sample test bills into Dispatch basket!', 'success');
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
      // QR server API generates high res SVG/PNG QR image instantly
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(s.text)}`;
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
  // 10. HTML5 QR CODE SCANNER CONTROLLERS
  // ========================================================

  let currentCameraIndex = 0;
  let availableCameras = [];

  async function startDispatchScanner() {
    const container = document.getElementById('scannerContainer');
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');
    const switchBtn = document.getElementById('switchCameraBtn');

    if (State.scannerDispatch) {
      return;
    }

    try {
      container.style.display = 'block';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'inline-flex';

      availableCameras = await Html5Qrcode.getCameras();
      if (availableCameras && availableCameras.length > 1 && switchBtn) {
        switchBtn.style.display = 'inline-flex';
      }

      State.scannerDispatch = new Html5Qrcode('qr-reader');
      const cameraId = availableCameras.length > 0 ? availableCameras[currentCameraIndex].id : { facingMode: 'environment' };

      await State.scannerDispatch.start(
        cameraId,
        {
          fps: 15,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.333
        },
        (decodedText) => {
          handleScannedCodeDispatch(decodedText);
        },
        () => {
          // Scanner frame error, normal when searching for QR
        }
      );
    } catch (err) {
      console.error('Dispatch scanner init error:', err);
      showToast('Camera access error: ' + err.message, 'danger');
      stopDispatchScanner();
    }
  }

  async function stopDispatchScanner() {
    const container = document.getElementById('scannerContainer');
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');
    const switchBtn = document.getElementById('switchCameraBtn');

    if (State.scannerDispatch) {
      try {
        await State.scannerDispatch.stop();
        State.scannerDispatch.clear();
      } catch (e) {
        // ignore
      }
      State.scannerDispatch = null;
    }

    if (container) container.style.display = 'none';
    if (startBtn) startBtn.style.display = 'inline-flex';
    if (stopBtn) stopBtn.style.display = 'none';
    if (switchBtn) switchBtn.style.display = 'none';
  }

  async function startSettlementScanner() {
    const container = document.getElementById('settlementScannerContainer');
    const startBtn = document.getElementById('startSettlementScanBtn');
    const stopBtn = document.getElementById('stopSettlementScanBtn');

    if (State.scannerSettlement) return;

    try {
      container.style.display = 'block';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'inline-flex';

      State.scannerSettlement = new Html5Qrcode('qr-reader-settlement');
      await State.scannerSettlement.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.333
        },
        (decodedText) => {
          handleScannedCodeSettlement(decodedText);
        },
        () => {}
      );
    } catch (err) {
      console.error('Settlement scanner error:', err);
      showToast('Camera error: ' + err.message, 'danger');
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
    if (startBtn) startBtn.style.display = 'inline-flex';
    if (stopBtn) stopBtn.style.display = 'none';
  }


  // ========================================================
  // 11. EVENT LISTENERS SETUP
  // ========================================================

  function setupEventListeners() {
    // Theme toggle
    document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);

    // Tab Navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    document.querySelectorAll('.b-nav-item').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Quick sync pill
    document.getElementById('quickSyncBtn')?.addEventListener('click', processOfflineQueue);

    // --- TAB 1: DISPATCH LISTENERS ---
    document.getElementById('startScanBtn')?.addEventListener('click', startDispatchScanner);
    document.getElementById('stopScanBtn')?.addEventListener('click', stopDispatchScanner);

    document.getElementById('continuousScanToggle')?.addEventListener('change', e => {
      State.settings.continuousScan = e.target.checked;
      saveState('settings');
    });

    document.getElementById('audioBeepToggle')?.addEventListener('change', e => {
      State.settings.audioSound = e.target.checked;
      saveState('settings');
    });

    document.getElementById('addManualBillBtn')?.addEventListener('click', () => {
      const input = document.getElementById('manualQrInput');
      const val = input.value.trim();
      if (!val) {
        showToast('Please type or paste QR code text', 'warning');
        return;
      }
      const parsed = parseQRCodeData(val);
      if (parsed) {
        addBillToDispatchBasket(parsed);
        input.value = '';
      }
    });

    document.getElementById('manualQrInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('addManualBillBtn').click();
      }
    });

    document.getElementById('clearBasketBtn')?.addEventListener('click', () => {
      if (State.dispatchBasket.length > 0 && confirm('Clear all scanned bills from handover list?')) {
        State.dispatchBasket = [];
        renderDispatchBasket();
      }
    });

    document.getElementById('confirmDispatchBtn')?.addEventListener('click', confirmDispatchHandover);

    document.getElementById('printHandoverSlipBtn')?.addEventListener('click', () => {
      window.print();
    });

    document.getElementById('whatsappHandoverBtn')?.addEventListener('click', () => {
      const agent = document.getElementById('dispatchAgentSelect').value;
      if (!agent || State.dispatchBasket.length === 0) return;
      const count = State.dispatchBasket.length;
      let total = 0;
      State.dispatchBasket.forEach(b => total += Number(b.amount) || 0);

      const msg = 
`*BILL HANDOVER SLIP*
*Agent:* ${agent}
*Date:* ${document.getElementById('dispatchDate').value}
*Total Bills:* ${count}
*Total Value:* ${formatINR(total)}
-------------------------
Bills:
${State.dispatchBasket.map((b, i) => `${i + 1}. ${b.billNo} - ${b.party} (${formatINR(b.amount)})`).join('\n')}
-------------------------
_Please verify physical custody before departure._`;

      window.open(`https://wa.me/?text=${encodeURI(msg)}`, '_blank');
    });

    // Quick add agent button in dispatch
    document.getElementById('addAgentQuickBtn')?.addEventListener('click', () => {
      document.getElementById('addAgentModal').style.display = 'flex';
    });

    // --- TAB 2: SETTLEMENT LISTENERS ---
    document.getElementById('loadAgentBillsBtn')?.addEventListener('click', loadSettlementForSelectedAgent);
    document.getElementById('settlementAgentSelect')?.addEventListener('change', loadSettlementForSelectedAgent);

    // Settlement Fast Scan Mode Toggles
    const modePayBtn = document.getElementById('modePayBtn');
    const modeReturnBtn = document.getElementById('modeReturnBtn');
    const modeDescText = document.getElementById('modeDescText');

    modePayBtn?.addEventListener('click', () => {
      State.settlementScanMode = 'PAY';
      modePayBtn.classList.add('active');
      modeReturnBtn.classList.remove('active');
      if (modeDescText) modeDescText.textContent = 'Scan a bill to register payment (Full or Partial).';
    });

    modeReturnBtn?.addEventListener('click', () => {
      State.settlementScanMode = 'RETURN';
      modeReturnBtn.classList.add('active');
      modePayBtn.classList.remove('active');
      if (modeDescText) modeDescText.textContent = 'Scan physical bill QR to verify it is physically present for next round.';
    });

    document.getElementById('startSettlementScanBtn')?.addEventListener('click', startSettlementScanner);
    document.getElementById('stopSettlementScanBtn')?.addEventListener('click', stopSettlementScanner);

    document.getElementById('settlementManualSubmitBtn')?.addEventListener('click', () => {
      const input = document.getElementById('settlementManualInput');
      const val = input.value.trim();
      if (!val) return;
      const parsed = parseQRCodeData(val);
      processSettlementBill(parsed.billNo, parsed);
      input.value = '';
    });

    document.getElementById('settlementManualInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('settlementManualSubmitBtn').click();
      }
    });

    // Table Filter Chips in Settlement
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderSettlementTable(State.settlementBills, chip.dataset.filter);
      });
    });

    document.getElementById('finalizeSettlementBtn')?.addEventListener('click', finalizeDailySettlement);
    document.getElementById('shareSettlementWhatsappBtn')?.addEventListener('click', sendSettlementWhatsApp);
    document.getElementById('printSettlementBtn')?.addEventListener('click', () => window.print());

    // --- TAB 3: LEDGER LISTENERS ---
    document.getElementById('ledgerSearchInput')?.addEventListener('input', renderMasterLedger);
    document.getElementById('ledgerAgentFilter')?.addEventListener('change', renderMasterLedger);
    document.getElementById('ledgerStatusFilter')?.addEventListener('change', renderMasterLedger);
    document.getElementById('ledgerDateFilter')?.addEventListener('change', renderMasterLedger);
    document.getElementById('exportCsvBtn')?.addEventListener('click', exportLedgerToCSV);
    document.getElementById('exportExcelBtn')?.addEventListener('click', exportLedgerToCSV);

    // --- TAB 4: SETTINGS LISTENERS ---
    document.getElementById('saveScriptUrlBtn')?.addEventListener('click', () => {
      const url = (document.getElementById('googleScriptUrl').value || '').trim();
      State.settings.scriptUrl = url;
      saveState('settings');
      showToast('Google Apps Script URL saved!', 'success');
    });

    document.getElementById('testSheetConnectionBtn')?.addEventListener('click', testGoogleSheetConnection);
    document.getElementById('forceSyncSheetBtn')?.addEventListener('click', processOfflineQueue);
    document.getElementById('pullFromSheetBtn')?.addEventListener('click', pullFromGoogleSheet);
    document.getElementById('retryQueueBtn')?.addEventListener('click', processOfflineQueue);

    // Add Agent Form
    document.getElementById('saveNewAgentBtn')?.addEventListener('click', () => {
      const name = document.getElementById('newAgentNameInput').value;
      const phone = document.getElementById('newAgentPhoneInput').value;
      if (!name.trim()) {
        showToast('Please enter agent name', 'warning');
        return;
      }
      addNewAgent(name, phone);
      document.getElementById('newAgentNameInput').value = '';
      document.getElementById('newAgentPhoneInput').value = '';
    });

    // Demo Data
    document.getElementById('loadSampleBillsBtn')?.addEventListener('click', loadSampleTestBills);
    document.getElementById('generateQrCodesBtn')?.addEventListener('click', previewPrintableQRCodes);
    document.getElementById('clearAllDataBtn')?.addEventListener('click', () => {
      if (confirm('Are you sure you want to reset all local bills and logs? This cannot be undone.')) {
        State.bills = [];
        State.auditLogs = [];
        State.offlineQueue = [];
        State.dispatchBasket = [];
        saveState();
        updateGlobalStats();
        renderDispatchBasket();
        renderMasterLedger();
        showToast('All local data has been reset', 'info');
      }
    });

    // --- MODAL CLOSE LISTENERS ---
    document.getElementById('closePaymentModalBtn')?.addEventListener('click', closePaymentModal);
    document.getElementById('cancelPaymentModalBtn')?.addEventListener('click', closePaymentModal);
    document.getElementById('paymentRecordForm')?.addEventListener('submit', savePaymentRecord);

    // Payment Type Radio toggle in Modal
    document.querySelectorAll('input[name="paymentType"]').forEach(radio => {
      radio.addEventListener('change', e => {
        const bill = State.currentPaymentBill;
        if (!bill) return;
        const colInput = document.getElementById('modalCollectedAmt');
        const hint = document.getElementById('modalBalanceHint');
        if (e.target.value === 'FULL') {
          colInput.value = bill.amount;
          if (hint) hint.style.display = 'none';
        } else {
          colInput.value = (bill.amount / 2).toFixed(2);
          if (hint) {
            hint.style.display = 'block';
            hint.textContent = `Remaining Balance: ${formatINR(bill.amount - parseFloat(colInput.value))}`;
          }
        }
      });
    });

    // Modal Payment Mode change (show/hide ref no)
    document.getElementById('modalPaymentMode')?.addEventListener('change', e => {
      const refGroup = document.getElementById('modalRefGroup');
      const refLabel = document.getElementById('modalRefLabel');
      if (e.target.value === 'Cash') {
        refGroup.style.display = 'none';
      } else {
        refGroup.style.display = 'flex';
        refLabel.textContent = e.target.value === 'Cheque' ? 'Cheque No & Bank Name *' : 'UPI UTR / Reference No *';
      }
    });

    document.getElementById('closeReturnModalBtn')?.addEventListener('click', closeReturnModal);
    document.getElementById('cancelReturnModalBtn')?.addEventListener('click', closeReturnModal);
    document.getElementById('returnRecordForm')?.addEventListener('submit', saveReturnRecord);

    document.getElementById('closeAddAgentModalBtn')?.addEventListener('click', () => {
      document.getElementById('addAgentModal').style.display = 'none';
    });
    document.getElementById('cancelAddAgentModalBtn')?.addEventListener('click', () => {
      document.getElementById('addAgentModal').style.display = 'none';
    });
    document.getElementById('addAgentModalForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const name = document.getElementById('modalNewAgentName').value;
      const phone = document.getElementById('modalNewAgentPhone').value;
      addNewAgent(name, phone);
      document.getElementById('addAgentModal').style.display = 'none';
      document.getElementById('modalNewAgentName').value = '';
      document.getElementById('modalNewAgentPhone').value = '';
    });

    document.getElementById('closeQrPreviewModalBtn')?.addEventListener('click', () => {
      document.getElementById('qrPreviewModal').style.display = 'none';
    });
    document.getElementById('closeQrPreviewBottomBtn')?.addEventListener('click', () => {
      document.getElementById('qrPreviewModal').style.display = 'none';
    });
    document.getElementById('printTestQrBtn')?.addEventListener('click', () => window.print());
  }


  // ========================================================
  // 12. INITIALIZATION
  // ========================================================

  document.addEventListener('DOMContentLoaded', () => {
    loadLocalState();
    initUI();
    setupEventListeners();
  });

})();
