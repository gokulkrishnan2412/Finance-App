// ============ STORAGE & API CONFIGURATION ============
let lendings = [];
const localApiOrigin = 'http://localhost:5000';
const nativeFetch = window.fetch.bind(window);
const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);

function getGithubConfig() {
  return {
    owner: (localStorage.getItem('gh_owner') || '').trim(),
    repo: (localStorage.getItem('gh_repo') || '').trim(),
    branch: (localStorage.getItem('gh_branch') || 'main').trim(),
    token: (localStorage.getItem('gh_token') || '').trim()
  };
}

function hasGithubConfig() {
  const c = getGithubConfig();
  return Boolean(c.owner && c.repo && c.token);
}

// Base64 helper supporting full Unicode / UTF-8
function decodeBase64Utf8(base64Str) {
  try {
    const cleanStr = (base64Str || '').replace(/\s/g, '');
    const binary = atob(cleanStr);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.error('Base64 decode error:', e);
    return '[]';
  }
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const githubShaCache = {};

async function fetchGithubFile(filePath) {
  const config = getGithubConfig();
  if (!config.owner || !config.repo || !config.token) {
    throw new Error('GitHub settings not configured. Please enter your Username, Repo, and Token in Settings.');
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${filePath}?ref=${encodeURIComponent(config.branch)}&_t=${Date.now()}`;
  const response = await nativeFetch(url, {
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'If-None-Match': ''
    }
  });

  if (response.status === 404) {
    return { sha: null, data: [] };
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `GitHub API error (status ${response.status})`);
  }

  const fileData = await response.json();
  githubShaCache[filePath] = fileData.sha;
  const decodedText = decodeBase64Utf8(fileData.content);
  let parsed = [];
  try {
    parsed = JSON.parse(decodedText);
  } catch (e) {
    parsed = [];
  }
  return { sha: fileData.sha, data: Array.isArray(parsed) ? parsed : [] };
}

async function saveGithubFile(filePath, contentArray, commitMessage) {
  const config = getGithubConfig();
  if (!config.owner || !config.repo || !config.token) {
    throw new Error('GitHub settings not configured. Please enter your Username, Repo, and Token in Settings.');
  }

  // Always fetch fresh sha right before writing to prevent 409 conflict
  let sha = githubShaCache[filePath] || null;
  try {
    const checkUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${filePath}?ref=${encodeURIComponent(config.branch)}&_t=${Date.now()}`;
    const checkRes = await nativeFetch(checkUrl, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (checkRes.ok) {
      const checkData = await checkRes.json();
      sha = checkData.sha;
    }
  } catch (e) {
    // fallback to cached sha
  }

  const jsonString = JSON.stringify(contentArray, null, 2);
  const base64Content = encodeBase64Utf8(jsonString);

  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${filePath}`;
  const payload = {
    message: commitMessage || `Update ${filePath} via Finance App`,
    content: base64Content,
    branch: config.branch
  };
  if (sha) {
    payload.sha = sha;
  }

  const response = await nativeFetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `GitHub save error (${response.status})`);
  }

  const result = await response.json();
  if (result.content && result.content.sha) {
    githubShaCache[filePath] = result.content.sha;
  }
  return result;
}

async function handleGithubApi(path, options = {}) {
  let bodyData = null;
  if (options.body) {
    try {
      bodyData = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    } catch (e) {
      bodyData = options.body;
    }
  }

  const cleanPath = path.replace(/^\/+/, '');
  const pathParts = cleanPath.split('/');
  const endpoint = pathParts[0];
  const itemId = pathParts[1] || '';

  try {
    // 1. LENDINGS
    if (endpoint === 'get_lendings') {
      const { data } = await fetchGithubFile('backend/lendings.json');
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    }

    if (endpoint === 'add_lending') {
      const { data } = await fetchGithubFile('backend/lendings.json');
      const newLending = { ...bodyData, id: String(bodyData.id || Date.now()) };
      data.push(newLending);
      await saveGithubFile('backend/lendings.json', data, `Add lending: ${newLending.name || newLending.id}`);
      return { ok: true, status: 201, json: async () => ({ status: 'success', lending: newLending }) };
    }

    if (endpoint === 'record_payment') {
      const { data } = await fetchGithubFile('backend/lendings.json');
      const lending = data.find(l => String(l.id) === String(itemId));
      if (!lending) throw new Error('Lending record not found');

      const amount = Number(bodyData.amount || 0);
      const paymentDate = bodyData.date || new Date().toISOString().split('T')[0];

      lending.received = Number(lending.received || 0) + amount;
      if (!Array.isArray(lending.payments)) lending.payments = [];
      lending.payments.push({ date: paymentDate, amount: amount });

      let remaining = amount;
      if (Array.isArray(lending.schedule)) {
        for (const item of lending.schedule) {
          if (!item.received && remaining > 0) {
            const itemAmount = Number(item.amount || 0);
            if (remaining >= itemAmount) {
              item.received = true;
              item.receivedDate = paymentDate;
              item.receivedAmount = itemAmount;
              remaining -= itemAmount;
            } else {
              item.receivedAmount = Number(item.receivedAmount || 0) + remaining;
              remaining = 0;
            }
          }
        }
      }

      if (lending.received >= Number(lending.returnAmount || 0)) {
        lending.status = 'completed';
      }

      await saveGithubFile('backend/lendings.json', data, `Record payment of ₹${amount} for ${lending.name || itemId}`);
      return { ok: true, status: 200, json: async () => ({ status: 'success', lending }) };
    }

    if (endpoint === 'delete_lending') {
      const { data } = await fetchGithubFile('backend/lendings.json');
      const filtered = data.filter(l => String(l.id) !== String(itemId));
      await saveGithubFile('backend/lendings.json', filtered, `Delete lending ${itemId}`);
      return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
    }

    // 2. LOANS
    if (endpoint === 'get_loans') {
      const { data } = await fetchGithubFile('backend/loans.json');
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    }

    if (endpoint === 'add_loan') {
      const { data } = await fetchGithubFile('backend/loans.json');
      const newLoan = {
        id: String(bodyData.id || Date.now()),
        bankName: String(bodyData.bankName || '').trim(),
        date: bodyData.date,
        loanAmount: Number(bodyData.loanAmount || 0),
        monthlyInterest: Number(bodyData.monthlyInterest || 0),
        notes: bodyData.notes || '',
        interestPayments: [],
        createdAt: new Date().toISOString()
      };
      data.push(newLoan);
      await saveGithubFile('backend/loans.json', data, `Add loan: ${newLoan.bankName}`);
      return { ok: true, status: 201, json: async () => ({ status: 'success', loan: newLoan }) };
    }

    if (endpoint === 'record_loan_interest') {
      const { data } = await fetchGithubFile('backend/loans.json');
      const loan = data.find(l => String(l.id) === String(itemId));
      if (!loan) throw new Error('Loan not found');

      const amount = Number(bodyData.amount || 0);
      const paymentDate = bodyData.date || new Date().toISOString().split('T')[0];

      if (!Array.isArray(loan.interestPayments)) loan.interestPayments = [];
      loan.interestPayments.push({ date: paymentDate, amount: amount });

      await saveGithubFile('backend/loans.json', data, `Record interest payment for ${loan.bankName || itemId}`);
      return { ok: true, status: 200, json: async () => ({ status: 'success', loan }) };
    }

    if (endpoint === 'delete_loan') {
      const { data } = await fetchGithubFile('backend/loans.json');
      const filtered = data.filter(l => String(l.id) !== String(itemId));
      await saveGithubFile('backend/loans.json', filtered, `Delete loan ${itemId}`);
      return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
    }

    // 3. CHITS
    if (endpoint === 'get_chits') {
      const { data } = await fetchGithubFile('backend/chits.json');
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
    }

    if (endpoint === 'add_chit') {
      const { data } = await fetchGithubFile('backend/chits.json');
      const newChit = {
        id: String(bodyData.id || Date.now()),
        personName: String(bodyData.personName || '').trim(),
        chitAmount: Number(bodyData.chitAmount || 0),
        payments: [],
        notes: bodyData.notes || '',
        createdAt: new Date().toISOString()
      };
      data.push(newChit);
      await saveGithubFile('backend/chits.json', data, `Add chit: ${newChit.personName}`);
      return { ok: true, status: 201, json: async () => ({ status: 'success', chit: newChit }) };
    }

    if (endpoint === 'record_chit_payment') {
      const { data } = await fetchGithubFile('backend/chits.json');
      const chit = data.find(c => String(c.id) === String(itemId));
      if (!chit) throw new Error('Chit not found');

      const amount = Number(bodyData.amount || 0);
      const paymentDate = bodyData.date || new Date().toISOString().split('T')[0];
      const note = String(bodyData.note || '').trim();

      if (!Array.isArray(chit.payments)) chit.payments = [];
      chit.payments.push({ date: paymentDate, amount: amount, note: note });

      await saveGithubFile('backend/chits.json', data, `Record chit payment for ${chit.personName || itemId}`);
      return { ok: true, status: 200, json: async () => ({ status: 'success', chit }) };
    }

    if (endpoint === 'delete_chit') {
      const { data } = await fetchGithubFile('backend/chits.json');
      const filtered = data.filter(c => String(c.id) !== String(itemId));
      await saveGithubFile('backend/chits.json', filtered, `Delete chit ${itemId}`);
      return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
    }

    // 4. CLEAR ALL
    if (endpoint === 'clear_all') {
      await saveGithubFile('backend/lendings.json', [], 'Clear all lendings');
      await saveGithubFile('backend/loans.json', [], 'Clear all loans');
      await saveGithubFile('backend/chits.json', [], 'Clear all chits');
      return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
    }

    throw new Error(`Unknown endpoint: ${endpoint}`);
  } catch (error) {
    console.error('GitHub API Handler error:', error);
    return {
      ok: false,
      status: 400,
      json: async () => ({ status: 'error', message: error.message }),
      text: async () => error.message
    };
  }
}


/*
// ============ (LEGACY) GOOGLE SHEETS API HANDLER ============
// Retained for reference or future rollback if needed.
const sheetsApiOrigin = (window.GOOGLE_SHEETS_WEB_APP_URL || '').replace(/\/$/, '');

async function handleGoogleSheetsApi(url, options = {}) {
  const requestOptions = { ...options };
  const localPath = url.slice(localApiOrigin.length).replace(/^\/+/, '');
  const pathParts = localPath.split('/').filter(Boolean);
  const action = pathParts[0] || '';
  const id = pathParts.length > 1 ? pathParts[1] : '';

  const params = new URLSearchParams();
  if (action) params.set('action', action);
  if (id) params.set('id', id);

  if (requestOptions.body && requestOptions.method?.toUpperCase() === 'POST') {
    try {
      const bodyData = JSON.parse(requestOptions.body);
      params.set('data', JSON.stringify(bodyData));
    } catch (e) {}
  }

  let requestUrl = ;
  const finalOptions = { ...requestOptions };
  if (requestOptions.method?.toUpperCase() === 'POST' || requestOptions.method?.toUpperCase() === 'DELETE') {
    finalOptions.method = 'GET';
    delete finalOptions.body;
    delete finalOptions.headers?.['Content-Type'];
  }

  try {
    const response = await nativeFetch(requestUrl, finalOptions);
    const responseText = await response.text();
    let data = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (parseError) {
      data = { status: 'error', message:  };
    }
    return {
      ok: response.ok && data.status !== 'error',
      status: response.status,
      json: async () => data,
      text: async () => responseText
    };
  } catch (fetchError) {
    return {
      ok: false,
      status: 0,
      json: async () => ({ status: 'error', message: fetchError.message }),
      text: async () => fetchError.message
    };
  }
}
*/

// Start with the layout that matches the actual device width.
const deviceMode = window.matchMedia('(max-width: 768px)').matches ? 'mobile-mode' : 'desktop-mode';
document.body.classList.add(deviceMode);

window.fetch = async (url, options = {}) => {
  if (typeof url !== 'string' || !url.startsWith(localApiOrigin)) {
    return nativeFetch(url, options);
  }

  if (isLocalHost) {
    return nativeFetch(url, options);
  }

  const path = url.slice(localApiOrigin.length);

  if (hasGithubConfig()) {
    return handleGithubApi(path, options);
  }

  return {
    ok: false,
    status: 0,
    json: async () => ({
      status: 'error',
      message: 'Storage not configured. Please enter your GitHub details under Settings -> GitHub REST API Storage.'
    }),
    text: async () => 'Storage not configured'
  };
};

function apiFetch(path, options = {}) {
  const absolutePath = path.startsWith('http') ? path : `${localApiOrigin}${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(absolutePath, options);
}

function updateDeviceToggle() {
  const isMobile = document.body.classList.contains('mobile-mode');
  document.getElementById('device-toggle-label').textContent = isMobile ? 'Mobile' : 'Desktop';
  document.getElementById('device-toggle').setAttribute('aria-label', `Switch to ${isMobile ? 'desktop' : 'mobile'} view`);
  document.querySelectorAll('.device-option').forEach(option => {
    option.classList.toggle('selected', option.dataset.device === (isMobile ? 'mobile' : 'desktop'));
  });
}

document.getElementById('device-toggle').addEventListener('click', () => {
  const isMobile = document.body.classList.toggle('mobile-mode');
  document.body.classList.toggle('desktop-mode', !isMobile);
  updateDeviceToggle();
});
updateDeviceToggle();

// ============ PAGE NAVIGATION ============
const menuItems = document.querySelectorAll('.menu-item');
const pages = document.querySelectorAll('.page');

menuItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetPage = item.getAttribute('data-page');

    // Update active menu item
    menuItems.forEach(m => m.classList.remove('active'));
    item.classList.add('active');

    // Update active page
    pages.forEach(p => p.classList.remove('active'));
    document.getElementById(targetPage).classList.add('active');

    // Load data when switching to dashboards or analytics
    if (targetPage === 'dashboard-daily') {
      loadDashboard('daily');
    } else if (targetPage === 'dashboard-weekly') {
      loadDashboard('weekly');
    } else if (targetPage === 'dashboard-monthly') {
      loadDashboard('monthly');
    } else if (targetPage === 'chit') {
      loadChits();
    } else if (targetPage === 'loans') {
      loadLoans();
    } else if (targetPage === 'analytics') {
      loadAnalytics();
    }
  });
});

// ============ UPDATE LENDING TYPE FIELDS ============
function updateLendingTypeFields() {
  const type = document.getElementById('lending-type').value;

  // Hide all conditional fields
  document.getElementById('weekly-fields').style.display = 'none';
  document.getElementById('daily-fields').style.display = 'none';
  document.getElementById('monthly-fields').style.display = 'none';

  // Show selected type fields
  if (type === 'weekly') {
    document.getElementById('weekly-fields').style.display = 'block';
  } else if (type === 'daily') {
    document.getElementById('daily-fields').style.display = 'block';
  } else if (type === 'monthly') {
    document.getElementById('monthly-fields').style.display = 'block';
  }
}

// ============ FORM SUBMISSION ============
document.getElementById('lending-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const lendingType = document.getElementById('lending-type').value;
  const principalAmount = parseFloat(document.getElementById('principal-amount').value);
  const returnAmount = parseFloat(document.getElementById('return-amount').value);
  const interestAmount = parseFloat(document.getElementById('interest-amount').value);

  let lendingData = {
    id: Date.now(),
    name: document.getElementById('lender-name').value,
    date: document.getElementById('lending-date').value,
    principalAmount: principalAmount,
    returnAmount: returnAmount,
    interestAmount: interestAmount,
    type: lendingType,
    notes: document.getElementById('notes').value,
    received: 0,
    payments: [],
    status: 'active',
    createdAt: new Date().toISOString()
  };

  // Add type-specific data
  if (lendingType === 'weekly') {
    const weeks = parseInt(document.getElementById('weeks-duration').value);
    const weeklyAmount = returnAmount / weeks;
    lendingData.duration = weeks;
    lendingData.weeklyAmount = weeklyAmount;
    lendingData.schedule = generateWeeklySchedule(weeks, weeklyAmount, lendingData.date);
  } else if (lendingType === 'daily') {
    const dailyAmount = parseFloat(document.getElementById('daily-amount').value);
    const days = parseInt(document.getElementById('daily-duration').value);
    lendingData.dailyAmount = dailyAmount;
    lendingData.duration = days;
    lendingData.schedule = generateDailySchedule(days, dailyAmount, lendingData.date);
  } else if (lendingType === 'monthly') {
    const months = parseInt(document.getElementById('monthly-duration').value);
    const monthlyAmount = returnAmount / months;
    lendingData.duration = months;
    lendingData.monthlyAmount = monthlyAmount;
    lendingData.schedule = generateMonthlySchedule(months, monthlyAmount, lendingData.date);
  }

  try {
    const response = await apiFetch('/add_lending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lendingData)
    });

    if (!response.ok) {
      const errorResult = await response.json().catch(() => ({}));
      throw new Error(errorResult.message || `Server returned ${response.status}`);
    }

    document.getElementById('lending-form').reset();
    document.getElementById('lending-date').valueAsDate = new Date();
    updateLendingTypeFields();
    alert('Lending added successfully!');

    // Redirect to appropriate dashboard based on lending type
    const dashboardPage = `dashboard-${lendingType}`;
    document.querySelector(`[data-page="${dashboardPage}"]`).click();
  } catch (error) {
    console.error('Error adding lending:', error);
    alert(`Error adding lending: ${error.message}`);
  }
});

document.getElementById('loan-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const loanData = {
    id: Date.now(),
    bankName: document.getElementById('bank-name').value,
    date: document.getElementById('loan-date').value,
    loanAmount: parseFloat(document.getElementById('loan-amount').value),
    monthlyInterest: parseFloat(document.getElementById('monthly-interest').value),
    notes: document.getElementById('loan-notes').value
  };

  try {
    const response = await apiFetch('/add_loan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loanData)
    });
    if (!response.ok) {
      const errorResult = await response.json().catch(() => ({}));
      throw new Error(errorResult.message || `Server returned ${response.status}`);
    }
    document.getElementById('loan-form').reset();
    document.getElementById('loan-date').valueAsDate = new Date();
    alert('Loan added successfully!');
    document.querySelector('[data-page="loans"]').click();
  } catch (error) {
    console.error('Error adding loan:', error);
    alert(`Error adding loan: ${error.message}`);
  }
});

document.getElementById('chit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const chitData = {
    id: Date.now(),
    personName: document.getElementById('chit-person-name').value,
    chitAmount: parseFloat(document.getElementById('chit-amount').value),
    notes: document.getElementById('chit-notes').value
  };

  try {
    const response = await apiFetch('/add_chit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chitData)
    });
    if (!response.ok) {
      const errorResult = await response.json().catch(() => ({}));
      throw new Error(errorResult.message || `Server returned ${response.status}`);
    }
    document.getElementById('chit-form').reset();
    alert('Chit added successfully!');
    loadChits();
  } catch (error) {
    console.error('Error adding chit:', error);
    alert(`Error adding chit: ${error.message}`);
  }
});

// ============ CHITS ==========
async function loadChits() {
  try {
    const response = await apiFetch('/get_chits');
    if (!response.ok) throw new Error('Unable to load chits');
    displayChits(await response.json());
  } catch (error) {
    console.error('Error loading chits:', error);
  }
}

function displayChits(chitsData) {
  const list = document.getElementById('chit-list');
  let totalAmount = 0;
  let totalPaid = 0;
  let totalRemaining = 0;
  list.innerHTML = '';

  chitsData.sort((a, b) => Number(b.id) - Number(a.id)).forEach(chit => {
    const amount = Number(chit.chitAmount || 0);
    const payments = chit.payments || [];
    const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const remaining = Math.max(0, amount - paid);
    totalAmount += amount;
    totalPaid += paid;
    totalRemaining += remaining;

    const item = document.createElement('div');
    item.className = 'lending-card chit-card';
    item.innerHTML = `
      <div class="lending-header">
        <div class="lending-person"><span class="lending-icon">🧾</span><div>
          <div class="lending-name">${chit.personName}</div>
          <div class="lending-meta">CHIT RECORD</div>
        </div></div>
        <div class="lending-status">ACTIVE</div>
      </div>
      <div class="lending-amounts">
        <div class="amount-item"><span class="amount-label">Chit Amount</span><span class="amount-value">₹${amount.toFixed(2)}</span></div>
        <div class="amount-item"><span class="amount-label">Amount Paid</span><span class="amount-value">₹${paid.toFixed(2)}</span></div>
        <div class="amount-item"><span class="amount-label">Remaining</span><span class="amount-value interest">₹${remaining.toFixed(2)}</span></div>
      </div>
      ${chit.notes ? `<p class="loan-notes">${chit.notes}</p>` : ''}
      <div class="lending-actions">
        <button class="btn-small btn-secondary" onclick="recordChitPayment('${chit.id}')">Record Payment</button>
        <button class="btn-small" onclick="viewChitHistory('${chit.id}')">Payment History (${payments.length})</button>
        <button class="btn-small btn-danger" onclick="deleteChit('${chit.id}')">Delete</button>
      </div>`;
    list.appendChild(item);
  });

  if (chitsData.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #999;">No chits yet. Add one above to get started!</p>';
  }
  document.getElementById('chit-total-amount').textContent = totalAmount.toFixed(2);
  document.getElementById('chit-total-paid').textContent = totalPaid.toFixed(2);
  document.getElementById('chit-total-remaining').textContent = totalRemaining.toFixed(2);
}

function recordChitPayment(chitId) {
  apiFetch('/get_chits').then(response => response.json()).then(chitsData => {
    const chit = chitsData.find(item => String(item.id) === String(chitId));
    if (!chit) return;
    document.getElementById('chit-payment-person').textContent = chit.personName;
    document.getElementById('chit-payment-amount').value = '';
    document.getElementById('chit-payment-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('chit-payment-note').value = '';
    const modal = document.getElementById('chit-payment-modal');
    modal.dataset.chitId = chitId;
    modal.style.display = 'flex';
    document.getElementById('chit-payment-amount').focus();
  });
}

function closeChitPaymentModal() {
  document.getElementById('chit-payment-modal').style.display = 'none';
}

function submitChitPayment() {
  const modal = document.getElementById('chit-payment-modal');
  const amount = parseFloat(document.getElementById('chit-payment-amount').value);
  const date = document.getElementById('chit-payment-date').value;
  const note = document.getElementById('chit-payment-note').value.trim();
  if (!amount || amount <= 0 || !date) {
    alert('Enter a valid amount and date');
    return;
  }
  apiFetch(`/record_chit_payment/${modal.dataset.chitId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, date, note })
  }).then(response => response.json()).then(result => {
    if (result.status !== 'success') throw new Error(result.message);
    closeChitPaymentModal();
    loadChits();
  }).catch(error => alert(`Error recording chit payment: ${error.message}`));
}

async function viewChitHistory(chitId) {
  const response = await apiFetch('/get_chits');
  const chit = (await response.json()).find(item => String(item.id) === String(chitId));
  const payments = chit ? chit.payments || [] : [];
  document.getElementById('chit-history-title').textContent = `${chit ? chit.personName : 'Chit'} Payment History`;
  const historyContent = document.getElementById('chit-history-content');
  if (payments.length === 0) {
    historyContent.innerHTML = '<p style="text-align: center; color: #999;">No chit payments recorded yet.</p>';
  } else {
    const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    historyContent.innerHTML = `
      <table class="payments-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Note</th></tr></thead>
        <tbody>
          ${payments.slice().reverse().map(payment => `
            <tr><td>${formatDate(payment.date)}</td><td>₹${Number(payment.amount || 0).toFixed(2)}</td><td>${escapeHtml(payment.note || '—')}</td></tr>
          `).join('')}
          <tr class="payments-total-row"><td><strong>Total Paid</strong></td><td><strong>₹${totalPaid.toFixed(2)}</strong></td><td></td></tr>
        </tbody>
      </table>`;
  }
  document.getElementById('chit-history-modal').style.display = 'flex';
}

function closeChitHistoryModal() {
  document.getElementById('chit-history-modal').style.display = 'none';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

async function deleteChit(chitId) {
  if (!confirm('Delete this chit record?')) return;
  const response = await apiFetch(`/delete_chit/${chitId}`, { method: 'DELETE' });
  if (response.ok) loadChits();
  else alert('Error deleting chit');
}

// ============ LOANS ==========
async function loadLoans() {
  try {
    const response = await apiFetch('/get_loans');
    if (!response.ok) throw new Error('Unable to load loans');
    displayLoans(await response.json());
  } catch (error) {
    console.error('Error loading loans:', error);
  }
}

function displayLoans(loansData) {
  const list = document.getElementById('loans-list');
  let totalAmount = 0;
  let pendingInterest = 0;
  let interestPaid = 0;
  list.innerHTML = '';

  loansData.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(loan => {
    const payments = loan.interestPayments || [];
    const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const currentMonth = new Date().toISOString().slice(0, 7);
    const paidThisMonth = payments
      .filter(payment => String(payment.date || '').slice(0, 7) === currentMonth)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const pending = Math.max(0, Number(loan.monthlyInterest || 0) - paidThisMonth);
    totalAmount += Number(loan.loanAmount || 0);
    pendingInterest += pending;
    interestPaid += paid;

    const item = document.createElement('div');
    item.className = 'lending-card loan-card';
    item.innerHTML = `
      <div class="lending-header">
        <div class="lending-person"><span class="lending-icon">🏦</span><div>
          <div class="lending-name">${loan.bankName}</div>
          <div class="lending-meta">LOAN DATE • ${formatDate(loan.date)}</div>
        </div></div>
        <div class="lending-status">ACTIVE</div>
      </div>
      <div class="lending-amounts">
        <div class="amount-item"><span class="amount-label">Principal</span><span class="amount-value">₹${Number(loan.loanAmount || 0).toFixed(2)}</span></div>
        <div class="amount-item"><span class="amount-label">Pending This Month</span><span class="amount-value interest">₹${pending.toFixed(2)}</span></div>
        <div class="amount-item"><span class="amount-label">Interest Paid</span><span class="amount-value">₹${paid.toFixed(2)}</span></div>
      </div>
      ${loan.notes ? `<p class="loan-notes">${loan.notes}</p>` : ''}
      <div class="lending-actions">
        <button class="btn-small btn-secondary" onclick="recordLoanInterest('${loan.id}')">Record Interest</button>
        <button class="btn-small" onclick="viewLoanHistory('${loan.id}')">Payment History (${payments.length})</button>
        <button class="btn-small btn-danger" onclick="deleteLoan('${loan.id}')">Delete</button>
      </div>`;
    list.appendChild(item);
  });

  if (loansData.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #999;">No bank loans yet. Add one above to get started!</p>';
  }
  document.getElementById('loans-total-amount').textContent = totalAmount.toFixed(2);
  document.getElementById('loans-pending-interest').textContent = pendingInterest.toFixed(2);
  document.getElementById('loans-interest-paid').textContent = interestPaid.toFixed(2);
}

function recordLoanInterest(loanId) {
  apiFetch('/get_loans').then(response => response.json()).then(loansData => {
    const loan = loansData.find(item => String(item.id) === String(loanId));
    if (!loan) return;
    document.getElementById('loan-interest-bank').textContent = loan.bankName;
    document.getElementById('loan-interest-amount').value = Number(loan.monthlyInterest || 0).toFixed(2);
    document.getElementById('loan-interest-date').value = new Date().toISOString().split('T')[0];
    const modal = document.getElementById('loan-interest-modal');
    modal.dataset.loanId = loanId;
    modal.style.display = 'flex';
  });
}

function closeLoanInterestModal() {
  document.getElementById('loan-interest-modal').style.display = 'none';
}

function submitLoanInterest() {
  const modal = document.getElementById('loan-interest-modal');
  const amount = parseFloat(document.getElementById('loan-interest-amount').value);
  const date = document.getElementById('loan-interest-date').value;
  if (!amount || amount <= 0 || !date) {
    alert('Enter a valid amount and date');
    return;
  }
  apiFetch(`/record_loan_interest/${modal.dataset.loanId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, date })
  }).then(response => response.json()).then(result => {
    if (result.status !== 'success') throw new Error(result.message);
    closeLoanInterestModal();
    loadLoans();
  }).catch(error => alert(`Error recording interest: ${error.message}`));
}

async function viewLoanHistory(loanId) {
  const response = await apiFetch('/get_loans');
  const loan = (await response.json()).find(item => String(item.id) === String(loanId));
  const payments = loan ? loan.interestPayments || [] : [];
  alert(payments.length ? payments.map(payment => `${formatDate(payment.date)}: ₹${Number(payment.amount).toFixed(2)}`).join('\n') : 'No interest payments recorded yet.');
}

async function deleteLoan(loanId) {
  if (!confirm('Delete this loan and its interest payment history?')) return;
  const response = await apiFetch(`/delete_loan/${loanId}`, { method: 'DELETE' });
  if (response.ok) loadLoans();
  else alert('Error deleting loan');
}

// ============ GENERATE SCHEDULES ============
function generateWeeklySchedule(weeks, weeklyAmount, startDate) {
  const schedule = [];
  const start = new Date(startDate);
  for (let i = 0; i < weeks; i++) {
    const dueDate = new Date(start);
    dueDate.setDate(dueDate.getDate() + (i * 7));
    schedule.push({
      week: i + 1,
      amount: weeklyAmount,
      dueDate: dueDate.toISOString().split('T')[0],
      received: false,
      receivedDate: null,
      receivedAmount: 0
    });
  }
  return schedule;
}

function generateDailySchedule(days, dailyAmount, startDate) {
  const schedule = [];
  const start = new Date(startDate);
  for (let i = 0; i < days; i++) {
    const dueDate = new Date(start);
    dueDate.setDate(dueDate.getDate() + i);
    schedule.push({
      day: i + 1,
      amount: dailyAmount,
      dueDate: dueDate.toISOString().split('T')[0],
      received: false,
      receivedDate: null,
      receivedAmount: 0
    });
  }
  return schedule;
}

function generateMonthlySchedule(months, monthlyAmount, startDate) {
  const schedule = [];
  const start = new Date(startDate);
  for (let i = 0; i < months; i++) {
    const dueDate = new Date(start);
    dueDate.setMonth(dueDate.getMonth() + i);
    schedule.push({
      month: i + 1,
      amount: monthlyAmount,
      dueDate: dueDate.toISOString().split('T')[0],
      received: false,
      receivedDate: null,
      receivedAmount: 0
    });
  }
  return schedule;
}

// ============ LOAD AND DISPLAY LENDINGS BY TYPE ============
async function loadDashboard(type) {
  try {
    const response = await apiFetch('/get_lendings');
    const allLendings = await response.json();

    // Filter lendings by type
    const filteredLendings = allLendings.filter(lending => lending.type === type);

    // Display lendings
    displayLendingsByType(filteredLendings, type);

    // Update metrics for this type
    updateDashboardMetricsByType(filteredLendings, type);
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

function displayLendingsByType(lendingsData, type) {
  const listElementId = `${type}-lendings-list`;
  const list = document.getElementById(listElementId);
  list.innerHTML = '';

  if (lendingsData.length === 0) {
    list.innerHTML = `<p style="text-align: center; color: #999;">No ${type} lendings yet. Add one to get started!</p>`;
    return;
  }

  // Sort by date (newest first)
  lendingsData.sort((a, b) => new Date(b.date) - new Date(a.date));

  lendingsData.forEach(lending => {
    const outstanding = lending.returnAmount - lending.received;
    const progress = (lending.received / lending.returnAmount) * 100;

    const item = document.createElement('div');
    item.className = 'lending-card';

    const typeIcon = lending.type === 'weekly' ? '📅' : lending.type === 'daily' ? '📆' : '📊';

    item.innerHTML = `
      <div class="lending-header">
        <div class="lending-person">
          <span class="lending-icon">${typeIcon}</span>
          <div>
            <div class="lending-name">${lending.name}</div>
            <div class="lending-meta">${lending.type.toUpperCase()} • ${formatDate(lending.date)}</div>
          </div>
        </div>
        <div class="lending-status ${lending.status}">${lending.status.toUpperCase()}</div>
      </div>

      <div class="lending-amounts">
        <div class="amount-item">
          <span class="amount-label">Principal</span>
          <span class="amount-value">₹${lending.principalAmount.toFixed(2)}</span>
        </div>
        <div class="amount-item">
          <span class="amount-label">To Return</span>
          <span class="amount-value">₹${lending.returnAmount.toFixed(2)}</span>
        </div>
        <div class="amount-item">
          <span class="amount-label">Interest</span>
          <span class="amount-value interest">₹${lending.interestAmount.toFixed(2)}</span>
        </div>
      </div>

      <div class="lending-progress">
        <div class="progress-label">
          <span>Received: ₹${lending.received.toFixed(2)}</span>
          <span>Outstanding: ₹${outstanding.toFixed(2)}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${Math.min(progress, 100)}%"></div>
        </div>
        <div class="progress-percent">${Math.round(progress)}% Collected</div>
      </div>

      <div class="lending-actions">
        <button class="btn-small" onclick="viewLendingDetails('${lending.id}')">View Details</button>
        <button class="btn-small btn-secondary" onclick="recordPayment('${lending.id}')">Record Payment</button>
        <button class="btn-small btn-danger" onclick="deleteLending('${lending.id}')">Delete</button>
      </div>
    `;

    list.appendChild(item);
  });
}

function updateDashboardMetricsByType(lendingsData, type) {
  let totalLent = 0;
  let totalReceived = 0;
  let totalOutstanding = 0;
  let totalInterest = 0;

  lendingsData.forEach(lending => {
    totalLent += lending.principalAmount;
    totalReceived += lending.received;
    totalOutstanding += (lending.returnAmount - lending.received);
    totalInterest += lending.interestAmount;
  });

  document.getElementById(`${type}-total-lent`).textContent = totalLent.toFixed(2);
  document.getElementById(`${type}-total-received`).textContent = totalReceived.toFixed(2);
  document.getElementById(`${type}-outstanding`).textContent = totalOutstanding.toFixed(2);
  document.getElementById(`${type}-total-interest`).textContent = totalInterest.toFixed(2);
}

// ============ ANALYTICS ============
async function loadAnalytics() {
  try {
    const response = await apiFetch('/get_lendings');
    const lendingsData = await response.json();
    displayAnalytics(lendingsData);
  } catch (error) {
    console.error('Error loading analytics:', error);
  }
}

function displayAnalytics(lendingsData) {
  let totalLended = 0;
  let totalOutstanding = 0;
  let totalInHand = 0;
  let totalInterest = 0;
  const typeBreakdown = { weekly: 0, daily: 0, monthly: 0 };
  let pendingCollections = [];

  lendingsData.forEach(lending => {
    const outstanding = lending.returnAmount - lending.received;
    totalLended += lending.principalAmount;
    totalOutstanding += outstanding;
    totalInHand += lending.received;
    totalInterest += lending.interestAmount;
    typeBreakdown[lending.type] += lending.principalAmount;

    // Get pending items for next 7 days
    if (lending.schedule && lending.status === 'active') {
      const today = new Date();
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

      lending.schedule.forEach(item => {
        if (!item.received) {
          const dueDate = new Date(item.dueDate);
          if (dueDate >= today && dueDate <= nextWeek) {
            pendingCollections.push({
              person: lending.name,
              amount: item.amount,
              dueDate: item.dueDate,
              type: lending.type,
              period: item.week || item.day || item.month
            });
          }
        }
      });
    }
  });

  // Update summary cards
  document.getElementById('analytics-total-lended').textContent = totalLended.toFixed(2);
  document.getElementById('analytics-outstanding').textContent = totalOutstanding.toFixed(2);
  document.getElementById('analytics-in-hand').textContent = totalInHand.toFixed(2);
  document.getElementById('analytics-total-interest').textContent = totalInterest.toFixed(2);
  document.getElementById('analytics-active-count').textContent = lendingsData.filter(l => l.status === 'active').length;

  // Update breakdown
  const breakdownList = document.getElementById('breakdown-list');
  breakdownList.innerHTML = `
    <div class="breakdown-item">
      <span>Weekly Lendings:</span>
      <span class="breakdown-amount">₹${typeBreakdown.weekly.toFixed(2)}</span>
    </div>
    <div class="breakdown-item">
      <span>Daily Lendings:</span>
      <span class="breakdown-amount">₹${typeBreakdown.daily.toFixed(2)}</span>
    </div>
    <div class="breakdown-item">
      <span>Monthly Lendings:</span>
      <span class="breakdown-amount">₹${typeBreakdown.monthly.toFixed(2)}</span>
    </div>
  `;

  // Update pending collections
  const pendingList = document.getElementById('pending-list');
  if (pendingCollections.length === 0) {
    pendingList.innerHTML = '<p style="text-align: center; color: #999;">No pending collections for the next 7 days</p>';
  } else {
    pendingList.innerHTML = '';
    pendingCollections.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    pendingCollections.forEach(item => {
      const pendingItem = document.createElement('div');
      pendingItem.className = 'pending-item';
      pendingItem.innerHTML = `
        <div class="pending-person">${item.person}</div>
        <div class="pending-details">
          <span>${item.type.toUpperCase()} ${item.period}</span>
          <span>${formatDate(item.dueDate)}</span>
        </div>
        <div class="pending-amount">₹${item.amount.toFixed(2)}</div>
      `;
      pendingList.appendChild(pendingItem);
    });
  }
}

// ============ LENDING ACTIONS ============
async function viewLendingDetails(lendingId) {
  try {
    const response = await apiFetch('/get_lendings');
    const allLendings = await response.json();
    const lending = allLendings.find(l => String(l.id) === String(lendingId));
    if (!lending) { alert('Lending not found'); return; }

    document.getElementById('details-person').textContent = lending.name;
    document.getElementById('details-meta').textContent =
      `${(lending.type || '').toUpperCase()} • ${formatDate(lending.date)} • ${(lending.status || '').toUpperCase()}`;

    const received = lending.received || 0;
    const remaining = Math.max(0, (lending.returnAmount || 0) - received);

    document.getElementById('details-summary').innerHTML = `
      <div class="breakdown-item">
        <span>Total to Return:</span>
        <span class="breakdown-amount">₹${(lending.returnAmount || 0).toFixed(2)}</span>
      </div>
      <div class="breakdown-item">
        <span>Amount Received:</span>
        <span class="breakdown-amount" style="color: var(--success-color);">₹${received.toFixed(2)}</span>
      </div>
      <div class="breakdown-item">
        <span>Remaining Amount:</span>
        <span class="breakdown-amount" style="color: var(--danger-color);">₹${remaining.toFixed(2)}</span>
      </div>
    `;

    const paymentsDiv = document.getElementById('details-payments');
    const payments = (lending.payments || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    if (payments.length === 0) {
      paymentsDiv.innerHTML = '<p style="text-align: center; color: #999;">No payments recorded yet</p>';
    } else {
      let totalPaid = 0;
      paymentsDiv.innerHTML = `
        <table class="payments-table">
          <thead>
            <tr><th>Date</th><th>Amount</th></tr>
          </thead>
          <tbody>
            ${payments.map(p => {
              totalPaid += p.amount;
              return `<tr><td>${formatDate(p.date)}</td><td>₹${p.amount.toFixed(2)}</td></tr>`;
            }).join('')}
            <tr class="payments-total-row"><td><strong>Total Received</strong></td><td><strong>₹${totalPaid.toFixed(2)}</strong></td></tr>
          </tbody>
        </table>
      `;
    }

    const modal = document.getElementById('details-modal');
    modal.style.display = 'flex';
  } catch (error) {
    console.error('Error loading details:', error);
    alert('Error loading details');
  }
}

function closeDetailsModal() {
  document.getElementById('details-modal').style.display = 'none';
}

function recordPayment(lendingId) {
  apiFetch('/get_lendings')
    .then(res => res.json())
    .then(allLendings => {
      const lending = allLendings.find(l => String(l.id) === String(lendingId));
      if (!lending) { alert('Lending not found'); return; }

      const outstanding = Math.max(0, (lending.returnAmount || 0) - (lending.received || 0));
      const nextUnpaid = (lending.schedule || []).find(item => !item.received);

      document.getElementById('payment-person').textContent = lending.name;
      document.getElementById('payment-outstanding').textContent =
        `Outstanding: ₹${outstanding.toFixed(2)}` +
        (nextUnpaid ? ` • Next due: ₹${nextUnpaid.amount.toFixed(2)} on ${formatDate(nextUnpaid.dueDate)}` : '');

      const amountInput = document.getElementById('payment-amount');
      amountInput.value = nextUnpaid ? nextUnpaid.amount.toFixed(2) : '';
      document.getElementById('payment-date').value = new Date().toISOString().split('T')[0];

      const modal = document.getElementById('payment-modal');
      modal.style.display = 'flex';
      modal.dataset.lendingId = lendingId;
      amountInput.focus();
      amountInput.select();
    });
}

function closePaymentModal() {
  document.getElementById('payment-modal').style.display = 'none';
}

function submitPayment() {
  const modal = document.getElementById('payment-modal');
  const lendingId = modal.dataset.lendingId;
  const amount = parseFloat(document.getElementById('payment-amount').value);
  const date = document.getElementById('payment-date').value;

  if (!amount || isNaN(amount) || amount <= 0) {
    alert('Please enter a valid amount');
    return;
  }
  if (!date) {
    alert('Please select a date');
    return;
  }

  apiFetch(`/record_payment/${lendingId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, date })
  }).then(res => res.json()).then(result => {
    if (result.status === 'success') {
      closePaymentModal();
      alert('Payment recorded successfully!');
      loadDashboard('daily');
      loadDashboard('weekly');
      loadDashboard('monthly');
      loadAnalytics();
    } else {
      alert('Error recording payment: ' + (result.message || 'Unknown error'));
    }
  }).catch(() => alert('Error recording payment'));
}

// Close modal when clicking the overlay or pressing Escape
document.getElementById('payment-modal').addEventListener('click', (e) => {
  if (e.target.id === 'payment-modal') closePaymentModal();
});
document.getElementById('loan-interest-modal').addEventListener('click', (e) => {
  if (e.target.id === 'loan-interest-modal') closeLoanInterestModal();
});
document.getElementById('chit-payment-modal').addEventListener('click', (e) => {
  if (e.target.id === 'chit-payment-modal') closeChitPaymentModal();
});
document.getElementById('chit-history-modal').addEventListener('click', (e) => {
  if (e.target.id === 'chit-history-modal') closeChitHistoryModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePaymentModal(); closeLoanInterestModal(); closeChitPaymentModal(); closeChitHistoryModal(); closeDetailsModal(); }
});
document.getElementById('details-modal').addEventListener('click', (e) => {
  if (e.target.id === 'details-modal') closeDetailsModal();
});

async function deleteLending(lendingId) {
  if (confirm('Are you sure you want to delete this lending?')) {
    try {
      const response = await apiFetch(`/delete_lending/${lendingId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        // Reload all dashboards
        loadDashboard('daily');
        loadDashboard('weekly');
        loadDashboard('monthly');
      } else {
        alert('Error deleting lending');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error deleting lending');
    }
  }
}

// ============ EXPORT & CLEAR DATA ============
async function exportData() {
  try {
    const response = await apiFetch('/get_lendings');
    const lendingsData = await response.json();
    const rows = [['Report Section', 'Person', 'Date', 'Type', 'Principal', 'Return Amount', 'Interest', 'Received', 'Outstanding', 'Notes']];
    ['daily', 'weekly', 'monthly'].forEach(type => {
      rows.push([`${type.toUpperCase()} LENDINGS`]);
      lendingsData
        .filter(lending => lending.type === type)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach(lending => rows.push([
          type.toUpperCase(), lending.name, lending.date, lending.type,
          lending.principalAmount, lending.returnAmount, lending.interestAmount,
          lending.received || 0,
          Math.max(0, Number(lending.returnAmount || 0) - Number(lending.received || 0)),
          lending.notes || ''
        ]));
    });
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `lendings_report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error exporting lending report:', error);
    alert('Error exporting lending report');
  }
}

  async function exportLoanReport() {
    try {
      const response = await apiFetch('/get_loans');
      const loansData = await response.json();
      const rows = [['Bank Name', 'Loan Date', 'Loan Amount', 'Monthly Interest', 'Interest Paid Date', 'Interest Paid', 'Notes']];
      loansData.forEach(loan => {
        const payments = loan.interestPayments || [];
        if (payments.length === 0) {
          rows.push([loan.bankName, loan.date, loan.loanAmount, loan.monthlyInterest, '', '', loan.notes || '']);
        } else {
          payments.forEach(payment => rows.push([
            loan.bankName, loan.date, loan.loanAmount, loan.monthlyInterest,
            payment.date, payment.amount, loan.notes || ''
          ]));
        }
      });
      const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `loans_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting loans:', error);
      alert('Error exporting loan report');
    }
  }

// ============ EXPORT & CLEAR DATA ============
// ============ EXPORT & CLEAR DATA ============
function clearAllData() {
  if (confirm('Are you sure? This will delete ALL data (lendings, loans, chits) and cannot be undone!')) {
    apiFetch('/clear_all', {
      method: 'POST'
    }).then(res => {
      if (res.ok) {
        alert('All data cleared successfully!');
        loadDashboard('daily');
        loadDashboard('weekly');
        loadDashboard('monthly');
        loadChits();
        loadLoans();
        loadAnalytics();
      } else {
        alert('Error clearing data');
      }
    }).catch(err => alert('Error clearing data: ' + err.message));
  }
}

async function testApiConnection() {
  const statusEl = document.getElementById('api-status');
  statusEl.textContent = 'Testing connection...';
  statusEl.style.color = '#0066cc';

  try {
    const response = await apiFetch('/get_lendings');
    const data = await response.json();
    
    if (response.ok) {
      statusEl.textContent = '✅ API Connection: SUCCESS - Backend / Storage is working!';
      statusEl.style.color = '#28a745';
    } else if (data.message) {
      statusEl.textContent = `❌ API Error: ${data.message}`;
      statusEl.style.color = '#dc3545';
    } else {
      statusEl.textContent = '❌ API Connection: FAILED';
      statusEl.style.color = '#dc3545';
    }
  } catch (error) {
    statusEl.textContent = `❌ Connection Error: ${error.message}`;
    statusEl.style.color = '#dc3545';
  }
}

// ============ GITHUB REST API CONFIG & SETTINGS ============
function populateGithubSettingsForm() {
  const config = getGithubConfig();
  const ownerEl = document.getElementById('gh-owner');
  const repoEl = document.getElementById('gh-repo');
  const branchEl = document.getElementById('gh-branch');
  const tokenEl = document.getElementById('gh-token');

  if (ownerEl) ownerEl.value = config.owner;
  if (repoEl) repoEl.value = config.repo;
  if (branchEl) branchEl.value = config.branch || 'main';
  if (tokenEl) tokenEl.value = config.token;

  updateStorageStatusText();
}

function saveGithubConfig(event) {
  if (event) event.preventDefault();
  const owner = (document.getElementById('gh-owner')?.value || '').trim();
  const repo = (document.getElementById('gh-repo')?.value || '').trim();
  const branch = (document.getElementById('gh-branch')?.value || 'main').trim();
  const token = (document.getElementById('gh-token')?.value || '').trim();

  localStorage.setItem('gh_owner', owner);
  localStorage.setItem('gh_repo', repo);
  localStorage.setItem('gh_branch', branch);
  localStorage.setItem('gh_token', token);

  const statusEl = document.getElementById('github-status');
  if (statusEl) {
    statusEl.textContent = '✅ GitHub settings saved successfully! Reloading data...';
    statusEl.style.color = '#28a745';
  }

  updateStorageStatusText();

  // Reload current data
  loadDashboard('daily');
  loadDashboard('weekly');
  loadDashboard('monthly');
  loadChits();
  loadLoans();
  loadAnalytics();
}

async function testGithubConnection() {
  const statusEl = document.getElementById('github-status');
  if (statusEl) {
    statusEl.textContent = '⏳ Testing GitHub repository connection...';
    statusEl.style.color = '#0066cc';
  }

  const owner = (document.getElementById('gh-owner')?.value || localStorage.getItem('gh_owner') || '').trim();
  const repo = (document.getElementById('gh-repo')?.value || localStorage.getItem('gh_repo') || '').trim();
  const branch = (document.getElementById('gh-branch')?.value || localStorage.getItem('gh_branch') || 'main').trim();
  const token = (document.getElementById('gh-token')?.value || localStorage.getItem('gh_token') || '').trim();

  if (!owner || !repo || !token) {
    if (statusEl) {
      statusEl.textContent = '❌ Please enter your GitHub Username, Repo Name, and Token.';
      statusEl.style.color = '#dc3545';
    }
    return;
  }

  try {
    const testUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/backend/lendings.json?ref=${encodeURIComponent(branch)}&_t=${Date.now()}`;
    const res = await nativeFetch(testUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.ok) {
      const fileData = await res.json();
      if (statusEl) {
        statusEl.textContent = `✅ Connected! Successfully accessed backend/lendings.json (SHA: ${fileData.sha.substring(0, 7)})`;
        statusEl.style.color = '#28a745';
      }
    } else if (res.status === 404) {
      const repoRes = await nativeFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (repoRes.ok) {
        if (statusEl) {
          statusEl.textContent = '⚠️ Repository connected, but backend/lendings.json does not exist yet. It will be created when you add your first record.';
          statusEl.style.color = '#f39c12';
        }
      } else {
        const repoErr = await repoRes.json().catch(() => ({}));
        if (statusEl) {
          statusEl.textContent = `❌ Repository error: ${repoErr.message || res.statusText}`;
          statusEl.style.color = '#dc3545';
        }
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (statusEl) {
        statusEl.textContent = `❌ GitHub API error: ${errData.message || res.statusText}`;
        statusEl.style.color = '#dc3545';
      }
    }
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `❌ Connection error: ${error.message}`;
      statusEl.style.color = '#dc3545';
    }
  }
}

function clearGithubConfig() {
  if (confirm('Clear saved GitHub credentials from this browser?')) {
    localStorage.removeItem('gh_owner');
    localStorage.removeItem('gh_repo');
    localStorage.removeItem('gh_branch');
    localStorage.removeItem('gh_token');

    const ownerEl = document.getElementById('gh-owner');
    const repoEl = document.getElementById('gh-repo');
    const branchEl = document.getElementById('gh-branch');
    const tokenEl = document.getElementById('gh-token');
    if (ownerEl) ownerEl.value = '';
    if (repoEl) repoEl.value = '';
    if (branchEl) branchEl.value = 'main';
    if (tokenEl) tokenEl.value = '';

    const statusEl = document.getElementById('github-status');
    if (statusEl) {
      statusEl.textContent = 'GitHub credentials cleared.';
      statusEl.style.color = '#666';
    }
    updateStorageStatusText();
  }
}

function updateStorageStatusText() {
  const statusEl = document.getElementById('api-status');
  if (!statusEl) return;

  if (isLocalHost) {
    statusEl.textContent = '📌 Mode: LOCAL API (localhost:5000)';
    statusEl.style.color = '#0066cc';
  } else if (hasGithubConfig()) {
    const c = getGithubConfig();
    statusEl.textContent = `📌 Mode: GITHUB REST API (${c.owner}/${c.repo} @ ${c.branch})`;
    statusEl.style.color = '#28a745';
  } else if (sheetsApiOrigin) {
    statusEl.textContent = `📌 Mode: GOOGLE SHEETS API (${sheetsApiOrigin.substring(0, 40)}...)`;
    statusEl.style.color = '#0066cc';
  } else {
    statusEl.textContent = '⚠️ Storage NOT configured. Set your GitHub Token in Settings above.';
    statusEl.style.color = '#dc3545';
  }
}

// ============ HELPER FUNCTIONS ============
function formatDate(dateString) {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', () => {
  populateGithubSettingsForm();
  updateStorageStatusText();

  const lendingDateEl = document.getElementById('lending-date');
  if (lendingDateEl) lendingDateEl.valueAsDate = new Date();
  
  const loanDateEl = document.getElementById('loan-date');
  if (loanDateEl) loanDateEl.valueAsDate = new Date();

  // Load all dashboards and analytics on page load
  loadDashboard('daily');
  loadDashboard('weekly');
  loadDashboard('monthly');
  loadChits();
  loadLoans();
  loadAnalytics();
});
