/**
 * BillAudit - Minimalist Sales Bill Tracker
 * Camera Selection, QR Parser, EOD Reconciliation & Google Sheets Cloud Sync
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
    AUDIT_LOGS: 'billAudit_auditLogs'
  };

  const DEFAULT_AGENTS = [
    { id: 'AG-101', name: 'Rahul Sharma', phone: '9876543210' },
    { id: 'AG-102', name: 'Vikram Singh', phone: '9812345678' },
    { id: 'AG-103', name: 'Amit Patel', phone: '9765432109' }
  ];

  const DEFAULT_SETTINGS = {
    scriptUrl: '',
    theme: 'light',
    audioSound: true,
    preferredCamera: 'environment' // default to back camera!
  };

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
    availableCameras: [],
    selectedCameraId: 'environment', // 'environment' or deviceId
    lastScannedCode: null,
    lastScanTimestamp: 0,
    currentPaymentBill: null,
    currentReturnBill: null,
    settlementScanMode: 'PAY' // 'PAY' or 'RETURN'
  };

  // Web Audio Synthesizer
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
          osc.frequency.setValueAtTime(880, now);
          osc.frequency.setValueAtTime(1320, now + 0.08);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
          osc.start(now);
          osc.stop(now + 0.2);
        } else {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.setValueAtTime(160, now + 0.1);
          gain.gain.setValueAtTime(0.15, now);
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

      const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (storedSettings) {
        State.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) };
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
  // 2. ROBUST QR CODE PARSER
  // ========================================================
  function parseQRCodeData(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const text = rawText.trim();
    if (!text) return null;

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

    const csvParts = parseCSVLine(text);

    if (csvParts.length === 3) {
      const billNo = csvParts[0];
      const party = csvParts[1];
      const amountStr = csvParts[2];
      const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
      return { billNo, party, amount, raw: text };
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
      return { billNo, party, amount, raw: text };
    } else if (csvParts.length === 2) {
      const billNo = csvParts[0];
      const amount = parseFloat(csvParts[1].replace(/,/g, '')) || 0;
      return { billNo, party: 'Standard Account', amount, raw: text };
    }

    return { billNo: text, party: 'Unknown Party', amount: 0, raw: text };
  }


  // ========================================================
  // 3. CAMERA DETECTION, SELECTION & FLIP
  // ========================================================

  async function initCameraSelectors() {
    const select = document.getElementById('cameraSourceSelect');
    if (!select) return;

    try {
      // Query cameras if supported
      const cameras = await Html5Qrcode.getCameras();
      State.availableCameras = cameras || [];

      select.innerHTML = '';

      // Default generic options
      const optBack = document.createElement('option');
      optBack.value = 'environment';
      optBack.textContent = '📷 Back Camera (Default)';
      select.appendChild(optBack);

      const optFront = document.createElement('option');
      optFront.value = 'user';
      optFront.textContent = '🤳 Front Camera';
      select.appendChild(optFront);

      // If physical cameras with labels were found, add specific devices
      if (cameras && cameras.length > 0) {
        cameras.forEach((cam, idx) => {
          const opt = document.createElement('option');
          opt.value = cam.id;
          const label = cam.label || `Camera ${idx + 1}`;
          opt.textContent = `📹 ${label}`;
          select.appendChild(opt);
        });
      }

      // Restore user's previous camera preference
      if (State.selectedCameraId) {
        select.value = State.selectedCameraId;
      }
    } catch (e) {
      console.warn('Camera enumeration error (permissions may be needed first):', e);
    }
  }

  async function switchSelectedCamera(newCameraId) {
    State.selectedCameraId = newCameraId;
    State.settings.preferredCamera = newCameraId;
    saveState('settings');

    const select = document.getElementById('cameraSourceSelect');
    if (select) select.value = newCameraId;

    // If Dispatch scanner is actively running, restart with new camera
    if (State.scannerDispatch) {
      await stopDispatchScanner();
      await startDispatchScanner();
    }
    // If Settlement scanner is actively running, restart
    if (State.scannerSettlement) {
      await stopSettlementScanner();
      await startSettlementScanner();
    }

    showToast('Camera switched', 'info', 1500);
  }

  function flipCamera() {
    const select = document.getElementById('cameraSourceSelect');
    if (!select) return;

    if (State.availableCameras.length > 1) {
      // Cycle to next available physical camera
      const currentVal = State.selectedCameraId;
      let currentIndex = State.availableCameras.findIndex(c => c.id === currentVal);
      let nextIndex = (currentIndex + 1) % State.availableCameras.length;
      switchSelectedCamera(State.availableCameras[nextIndex].id);
    } else {
      // Toggle between environment and user
      const nextMode = (State.selectedCameraId === 'environment') ? 'user' : 'environment';
      switchSelectedCamera(nextMode);
    }
  }


  // ========================================================
  // 4. SCANNER CONTROLLERS
  // ========================================================

  function getCameraConfigForStart() {
    const camId = State.selectedCameraId || 'environment';
    if (camId === 'environment' || camId === 'user') {
      return { facingMode: camId };
    }
    return { deviceId: { exact: camId } };
  }

  async function startDispatchScanner() {
    const container = document.getElementById('scannerContainer');
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');

    if (State.scannerDispatch) return;

    try {
      container.style.display = 'block';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';

      State.scannerDispatch = new Html5Qrcode('qr-reader');
      const cameraConfig = getCameraConfigForStart();

      await State.scannerDispatch.start(
        cameraConfig,
        {
          fps: 15,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.333
        },
        (decodedText) => {
          handleScannedCodeDispatch(decodedText);
        },
        () => {}
      );

      // Enumerate cameras once permission granted to populate specific labels
      if (State.availableCameras.length === 0) {
        await initCameraSelectors();
      }
    } catch (err) {
      console.error('Dispatch scanner error:', err);
      showToast('Camera error: ' + err.message, 'danger');
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

    try {
      container.style.display = 'block';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';

      State.scannerSettlement = new Html5Qrcode('qr-reader-settlement');
      const cameraConfig = getCameraConfigForStart();

      await State.scannerSettlement.start(
        cameraConfig,
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
    if (startBtn) startBtn.style.display = 'block';
    if (stopBtn) stopBtn.style.display = 'none';
  }


  // ========================================================
  // 5. TAB 1: GIVE BILLS (DISPATCH)
  // ========================================================

  function handleScannedCodeDispatch(decodedText) {
    const now = Date.now();
    if (decodedText === State.lastScannedCode && now - State.lastScanTimestamp < 1500) {
      return;
    }
    State.lastScannedCode = decodedText;
    State.lastScanTimestamp = now;

    const parsed = parseQRCodeData(decodedText);
    if (!parsed || !parsed.billNo) {
      SoundFX.playBeep('error');
      showToast('Unrecognized Bill QR code', 'warning');
      return;
    }

    addBillToDispatchBasket(parsed);
  }

  function addBillToDispatchBasket(parsed) {
    const agentSelect = document.getElementById('dispatchAgentSelect');
    if (!agentSelect.value) {
      SoundFX.playBeep('warning');
      showToast('Please select a Sales Agent first', 'warning');
      agentSelect.focus();
      return;
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
      showToast(`Bill ${parsed.billNo} is currently with ${active.agent}!`, 'warning');
      return;
    }

    State.dispatchBasket.unshift({
      billNo: parsed.billNo,
      party: parsed.party,
      amount: parsed.amount,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      raw: parsed.raw
    });

    SoundFX.playBeep('success');
    SoundFX.vibrate(60);
    showToast(`Added ${parsed.billNo}`, 'success', 1800);

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
          <p>No bills scanned yet.<br><small>Click "Start Scanner" above or paste QR code.</small></p>
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
          <span class="b-num font-mono">${item.billNo}</span>
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
    const agent = document.getElementById('dispatchAgentSelect').value;
    const date = document.getElementById('dispatchDate').value || getTodayDateString();

    if (!agent) {
      showToast('Select a Sales Agent', 'warning');
      return;
    }
    if (State.dispatchBasket.length === 0) return;

    const timestamp = new Date().toISOString();
    const newBills = [];

    State.dispatchBasket.forEach(b => {
      let record = State.bills.find(item => item.billNo === b.billNo);
      if (!record) {
        record = {
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
        State.bills.unshift(record);
      } else {
        record.agent = agent;
        record.dispatchDate = date;
        record.status = 'WITH_AGENT';
        record.collectedAmt = 0;
        record.paymentMode = '';
        record.returnReason = '';
        record.lastActionDate = timestamp;
      }

      record.history.push({ action: 'DISPATCHED', agent, date, timestamp });
      newBills.push({ ...record });
    });

    // Cloud Queue
    queueSyncAction('BATCH_DISPATCH', { agent, dispatchDate: date, timestamp, bills: newBills });

    saveState();
    updateGlobalStats();

    const count = State.dispatchBasket.length;
    State.dispatchBasket = [];
    renderDispatchBasket();

    SoundFX.playBeep('success');
    showToast(`Issued ${count} bills to ${agent}!`, 'success', 3500);
  }


  // ========================================================
  // 6. TAB 2: RETURN & SETTLEMENT
  // ========================================================

  function loadSettlementForSelectedAgent() {
    const agentSelect = document.getElementById('settlementAgentSelect');
    const agent = agentSelect.value;
    State.activeSettlementAgent = agent;

    const list = document.getElementById('settlementListContainer');
    const countBadge = document.getElementById('agentBillsCount');
    const alertBanner = document.getElementById('missingBillAlertBanner');

    if (!agent) {
      list.innerHTML = `
        <div class="empty-placeholder">
          <i class="fa-solid fa-user-check"></i>
          <p>Select an agent above to view bills and start settlement.</p>
        </div>
      `;
      countBadge.textContent = '0';
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
    let totalAmt = 0, paidAmt = 0, returnedAmt = 0, missingAmt = 0;
    let paidCount = 0, returnedCount = 0, missingCount = 0;

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
        missingCount++;
        missingAmt += amt;
      }
    });

    document.getElementById('audTotalCount').textContent = `${bills.length} bills`;
    document.getElementById('audTotalAmt').textContent = formatINR(totalAmt);
    document.getElementById('audPaidCount').textContent = `${paidCount} bills`;
    document.getElementById('audPaidAmt').textContent = formatINR(paidAmt);
    document.getElementById('audReturnedCount').textContent = `${returnedCount} bills`;
    document.getElementById('audReturnedAmt').textContent = formatINR(returnedAmt);

    const alertBanner = document.getElementById('missingBillAlertBanner');
    const alertCount = document.getElementById('alertMissingCount');
    const alertAmt = document.getElementById('audMissingAmt');

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

    countBadge.textContent = filtered.length;

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
      if (bill.status === 'WITH_AGENT') statusText = '<span class="text-danger font-bold">⚠️ In Custody (Pending)</span>';
      else if (bill.status === 'PAID_FULL') statusText = `<span class="text-success font-bold">✓ Paid (${bill.paymentMode || 'Cash'})</span>`;
      else if (bill.status === 'PAID_PARTIAL') statusText = `<span class="text-success font-bold">✓ Partial (${formatINR(bill.collectedAmt)})</span>`;
      else if (bill.status === 'RETURNED_IN_HAND') statusText = '<span class="text-primary font-bold">↺ Returned Next Round</span>';
      else if (bill.status === 'MISSING_ALERT') statusText = '<span class="text-danger font-bold">⚠️ MISSING</span>';

      row.innerHTML = `
        <div class="bill-info-main">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="b-num font-mono">${bill.billNo}</span>
            <small>${statusText}</small>
          </div>
          <span class="b-party">${bill.party}</span>
        </div>
        <div class="bill-info-meta">
          <span class="b-amount font-mono">${formatINR(bill.amount)}</span>
          <div class="bill-action-btns">
            <button class="mini-action-btn pay" data-pay-bill="${bill.billNo}">Pay</button>
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
    const now = Date.now();
    if (decodedText === State.lastScannedCode && now - State.lastScanTimestamp < 1500) return;
    State.lastScannedCode = decodedText;
    State.lastScanTimestamp = now;

    const parsed = parseQRCodeData(decodedText);
    if (!parsed || !parsed.billNo) {
      SoundFX.playBeep('error');
      showToast('Unrecognized Bill QR', 'warning');
      return;
    }

    if (!State.activeSettlementAgent) {
      SoundFX.playBeep('warning');
      showToast('Please choose an agent above first!', 'warning');
      return;
    }

    let bill = State.bills.find(b => b.billNo === parsed.billNo);
    if (!bill) {
      // Auto register if missing from dispatch
      bill = {
        billNo: parsed.billNo,
        party: parsed.party,
        amount: parsed.amount,
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

    SoundFX.playBeep('success');
    SoundFX.vibrate(60);

    if (State.settlementScanMode === 'PAY') {
      openPaymentModal(bill);
    } else {
      openReturnModal(bill);
    }
  }


  // ========================================================
  // 7. PAYMENT & RETURN MODALS
  // ========================================================

  function openPaymentModal(bill) {
    State.currentPaymentBill = bill;

    document.getElementById('modalBillNo').textContent = bill.billNo;
    document.getElementById('modalPartyName').textContent = bill.party;
    document.getElementById('modalBillAmt').textContent = formatINR(bill.amount);

    const input = document.getElementById('modalCollectedAmt');
    input.value = bill.amount;

    document.getElementById('modalRefNo').value = '';
    document.getElementById('modalPaymentRemarks').value = '';

    // Default cash mode
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

    bill.status = (collectedAmt >= bill.amount) ? 'PAID_FULL' : 'PAID_PARTIAL';
    bill.collectedAmt = collectedAmt;
    bill.paymentMode = mode;
    bill.refNo = refNo;
    bill.remarks = remarks || `Payment received via ${mode}`;
    bill.lastActionDate = timestamp;

    bill.history.push({ action: bill.status, amount: collectedAmt, mode, ref: refNo, timestamp });

    queueSyncAction('SETTLEMENT_PAYMENT', {
      billNo: bill.billNo,
      agent: bill.agent,
      status: bill.status,
      collectedAmt,
      paymentMode: mode,
      refNo,
      remarks: bill.remarks,
      timestamp
    });

    saveState();
    updateGlobalStats();
    closePaymentModal();
    loadSettlementForSelectedAgent();

    SoundFX.playBeep('success');
    showToast(`Saved payment of ${formatINR(collectedAmt)}`, 'success');
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

    SoundFX.playBeep('success');
    showToast(`Physical return verified for ${bill.billNo}`, 'success');
  }

  function finalizeDailySettlement() {
    const agent = State.activeSettlementAgent;
    if (!agent) {
      showToast('Select an agent first', 'warning');
      return;
    }

    const bills = State.bills.filter(b => b.agent === agent);
    const unaccounted = bills.filter(b => b.status === 'WITH_AGENT');

    if (unaccounted.length > 0) {
      SoundFX.playBeep('error');
      const proceed = confirm(`⚠️ WARNING: ${unaccounted.length} bills are MISSING / not accounted for. Do you want to flag them as Missing Risk?`);
      if (!proceed) return;

      const timestamp = new Date().toISOString();
      unaccounted.forEach(b => {
        b.status = 'MISSING_ALERT';
        b.remarks = `MISSING at EOD settlement on ${getTodayDateString()}`;
        b.lastActionDate = timestamp;
        queueSyncAction('BILL_FLAG_MISSING', { billNo: b.billNo, agent, status: 'MISSING_ALERT', timestamp });
      });

      saveState();
      updateGlobalStats();
      loadSettlementForSelectedAgent();
    }

    SoundFX.playBeep('success');
    showToast(`Settlement closed for ${agent}!`, 'success', 3500);
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
${missingCount > 0 ? `⚠️ *MISSING BILLS:* ${missingCount} bills (${formatINR(missingAmt)})` : '✅ *All Bills Accounted For!*'}
-------------------------
_BillAudit Pro_`;

    const url = phone ? `https://wa.me/91${phone}?text=${encodeURI(msg)}` : `https://wa.me/?text=${encodeURI(msg)}`;
    window.open(url, '_blank');
  }


  // ========================================================
  // 8. MASTER LEDGER & EXPORT
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
      if (b.status === 'WITH_AGENT') statusLabel = 'With Agent';
      else if (b.status === 'PAID_FULL') statusLabel = 'Paid (Full)';
      else if (b.status === 'PAID_PARTIAL') statusLabel = 'Paid (Partial)';
      else if (b.status === 'RETURNED_IN_HAND') statusLabel = 'Returned Next Round';
      else if (b.status === 'MISSING_ALERT') statusLabel = '⚠️ MISSING';

      tr.innerHTML = `
        <td><strong class="font-mono text-primary">${b.billNo}</strong></td>
        <td>${b.party}</td>
        <td class="font-mono">${formatINR(b.amount)}</td>
        <td>${b.agent || '-'}</td>
        <td><strong>${statusLabel}</strong></td>
        <td class="font-mono text-success">${b.collectedAmt > 0 ? formatINR(b.collectedAmt) : '-'}</td>
        <td><small class="text-muted">${b.paymentMode || b.returnReason || '-'}</small></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function exportCSV() {
    if (State.bills.length === 0) {
      showToast('No bills to export', 'warning');
      return;
    }
    const headers = ['Bill Number', 'Party', 'Amount', 'Agent', 'Date', 'Status', 'Collected Amount', 'Mode', 'Reason'];
    const rows = State.bills.map(b => [
      `"${b.billNo}"`,
      `"${(b.party || '').replace(/"/g, '""')}"`,
      b.amount,
      `"${b.agent || ''}"`,
      `"${b.dispatchDate || ''}"`,
      `"${b.status}"`,
      b.collectedAmt || 0,
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
  // 9. GOOGLE SHEETS CLOUD SYNC
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

    if (navigator.onLine && State.settings.scriptUrl) {
      processOfflineQueue();
    }
  }

  async function processOfflineQueue() {
    if (!State.settings.scriptUrl || State.offlineQueue.length === 0) return;

    const btn = document.getElementById('quickSyncBtn');
    const text = document.getElementById('syncStatusText');
    if (btn) btn.classList.add('syncing');
    if (text) text.textContent = 'Syncing...';

    const queueSnapshot = [...State.offlineQueue];

    try {
      const resp = await fetch(State.settings.scriptUrl, {
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
        showToast('Google Sheet updated!', 'success');
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
      showToast('Enter your Google Apps Script URL first', 'warning');
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
        showToast('Connected to Google Sheet successfully!', 'success');
        State.settings.scriptUrl = url;
        saveState('settings');
      } else {
        throw new Error(data?.message || 'Invalid response');
      }
    } catch (err) {
      SoundFX.playBeep('error');
      alert(`Could not connect: ${err.message}\nMake sure your Web App deployment access is set to 'Anyone'.`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-plug"></i> Test Connection';
    }
  }

  async function pullFromSheet() {
    if (!State.settings.scriptUrl) {
      showToast('Enter Google Apps Script URL in Settings', 'warning');
      return;
    }
    const btn = document.getElementById('pullFromSheetBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching...';

    try {
      const resp = await fetch(`${State.settings.scriptUrl}?action=GET_DATA&t=${Date.now()}`);
      const data = await resp.json();
      if (data && data.bills) {
        State.bills = data.bills;
        if (data.agents && data.agents.length > 0) State.agents = data.agents;
        saveState();
        updateGlobalStats();
        renderAgentSelects();
        renderMasterLedger();
        showToast(`Pulled ${data.bills.length} bills from Sheet`, 'success');
      }
    } catch (e) {
      showToast('Pull failed: ' + e.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Pull from Sheet';
    }
  }


  // ========================================================
  // 10. AGENT MANAGER & DEMO DATA
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
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          raw
        });
      }
    });

    const select = document.getElementById('dispatchAgentSelect');
    if (select && State.agents[0]) select.value = State.agents[0].name;

    renderDispatchBasket();
    switchTab('tab-dispatch');
    SoundFX.playBeep('success');
    showToast('Loaded 5 sample test bills!', 'success');
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
  // 11. UI HELPERS & LISTENERS
  // ========================================================

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

      sel.innerHTML = isFilter ? '<option value="ALL">All Agents</option>' : '<option value="">Select Sales Agent...</option>';

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

    document.getElementById('statInCustodyAmt').textContent = formatINR(inCustodyAmt);
    document.getElementById('statInCustody').textContent = `${inCustodyCount} bills`;

    document.getElementById('statCollectedAmt').textContent = formatINR(collectedAmt);
    document.getElementById('statCollected').textContent = `${collectedCount} bills`;

    document.getElementById('statReturnedAmt').textContent = formatINR(returnedAmt);
    document.getElementById('statReturned').textContent = `${returnedCount} bills`;

    document.getElementById('statMissingAmt').textContent = formatINR(missingAmt);
    document.getElementById('statMissing').textContent = `${missingCount} bills`;

    const cardMissing = document.getElementById('statCardMissing');
    if (cardMissing) cardMissing.classList.toggle('has-missing', missingCount > 0);
  }

  function updateOfflineQueueBadge() {
    const badge = document.getElementById('pendingBadge');
    const label = document.getElementById('offlineQueueCount');
    const qCount = State.offlineQueue.length;
    if (badge) {
      badge.style.display = qCount > 0 ? 'inline-block' : 'none';
      badge.textContent = qCount;
    }
    if (label) label.textContent = qCount;
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

    if (tabId === 'tab-ledger') renderMasterLedger();
    else if (tabId === 'tab-settlement') loadSettlementForSelectedAgent();
    else if (tabId === 'tab-settings') renderAgentsManager();
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

    // Camera Selector Dropdown Change
    document.getElementById('cameraSourceSelect')?.addEventListener('change', (e) => {
      switchSelectedCamera(e.target.value);
    });

    // Flip Camera Buttons
    document.getElementById('flipCameraBtn')?.addEventListener('click', flipCamera);
    document.getElementById('flipSettlementCameraBtn')?.addEventListener('click', flipCamera);

    // Tab 1: Dispatch
    document.getElementById('startScanBtn')?.addEventListener('click', startDispatchScanner);
    document.getElementById('stopScanBtn')?.addEventListener('click', stopDispatchScanner);

    document.getElementById('addManualBillBtn')?.addEventListener('click', () => {
      const input = document.getElementById('manualQrInput');
      const val = input.value.trim();
      if (!val) return;
      const parsed = parseQRCodeData(val);
      if (parsed) {
        addBillToDispatchBasket(parsed);
        input.value = '';
      }
    });

    document.getElementById('manualQrInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('addManualBillBtn').click();
      }
    });

    document.getElementById('clearBasketBtn')?.addEventListener('click', () => {
      if (State.dispatchBasket.length > 0 && confirm('Clear all scanned bills?')) {
        State.dispatchBasket = [];
        renderDispatchBasket();
      }
    });

    document.getElementById('confirmDispatchBtn')?.addEventListener('click', confirmDispatchHandover);
    document.getElementById('printHandoverSlipBtn')?.addEventListener('click', () => window.print());
    document.getElementById('whatsappHandoverBtn')?.addEventListener('click', () => {
      const agent = document.getElementById('dispatchAgentSelect').value;
      if (!agent || State.dispatchBasket.length === 0) return;
      const total = State.dispatchBasket.reduce((s, b) => s + (Number(b.amount) || 0), 0);
      const msg = 
`*BILL HANDOVER SLIP*
*Agent:* ${agent}
*Date:* ${document.getElementById('dispatchDate').value}
*Total Bills:* ${State.dispatchBasket.length} (${formatINR(total)})
-------------------------
${State.dispatchBasket.map((b, i) => `${i + 1}. ${b.billNo} - ${b.party} (${formatINR(b.amount)})`).join('\n')}`;
      window.open(`https://wa.me/?text=${encodeURI(msg)}`, '_blank');
    });

    document.getElementById('addAgentQuickBtn')?.addEventListener('click', () => {
      document.getElementById('addAgentModal').style.display = 'flex';
    });

    // Tab 2: Settlement
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

    document.getElementById('settlementManualSubmitBtn')?.addEventListener('click', () => {
      const input = document.getElementById('settlementManualInput');
      const val = input.value.trim();
      if (!val) return;
      const parsed = parseQRCodeData(val);
      if (parsed) {
        handleScannedCodeSettlement(val);
        input.value = '';
      }
    });

    document.getElementById('settlementManualInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('settlementManualSubmitBtn').click();
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
    document.getElementById('shareSettlementWhatsappBtn')?.addEventListener('click', sendSettlementWhatsApp);

    // Tab 3: Ledger
    document.getElementById('ledgerSearchInput')?.addEventListener('input', renderMasterLedger);
    document.getElementById('ledgerAgentFilter')?.addEventListener('change', renderMasterLedger);
    document.getElementById('ledgerStatusFilter')?.addEventListener('change', renderMasterLedger);
    document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);

    // Tab 4: Settings
    document.getElementById('quickSyncBtn')?.addEventListener('click', processOfflineQueue);
    document.getElementById('saveScriptUrlBtn')?.addEventListener('click', () => {
      const url = (document.getElementById('googleScriptUrl').value || '').trim();
      State.settings.scriptUrl = url;
      saveState('settings');
      showToast('Google Sheet URL saved', 'success');
    });
    document.getElementById('testSheetConnectionBtn')?.addEventListener('click', testSheetConnection);
    document.getElementById('forceSyncSheetBtn')?.addEventListener('click', processOfflineQueue);
    document.getElementById('pullFromSheetBtn')?.addEventListener('click', pullFromSheet);
    document.getElementById('retryQueueBtn')?.addEventListener('click', processOfflineQueue);

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
      if (confirm('Reset all bills and local logs?')) {
        State.bills = [];
        State.offlineQueue = [];
        State.dispatchBasket = [];
        saveState();
        updateGlobalStats();
        renderDispatchBasket();
        renderMasterLedger();
        showToast('All local data reset', 'info');
      }
    });

    // Quick Payment 1-Tap modes in modal
    document.querySelectorAll('.btn-mode-quick').forEach(btn => {
      btn.addEventListener('click', () => setQuickPaymentMode(btn.dataset.mode));
    });

    // Modal forms
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

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    loadLocalState();

    // Set today date
    const today = getTodayDateString();
    const dDate = document.getElementById('dispatchDate');
    const sDate = document.getElementById('settlementDate');
    if (dDate) dDate.value = today;
    if (sDate) sDate.value = today;

    document.documentElement.setAttribute('data-theme', State.settings.theme);

    renderAgentSelects();
    updateGlobalStats();
    updateOfflineQueueBadge();

    const scriptInput = document.getElementById('googleScriptUrl');
    if (scriptInput) scriptInput.value = State.settings.scriptUrl || '';

    setupEventListeners();
    initCameraSelectors();
  });

})();
