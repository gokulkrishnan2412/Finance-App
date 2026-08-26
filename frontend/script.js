// ============ LOCAL STORAGE & STATE ============
let lendings = [];

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
    const response = await fetch('http://localhost:5000/add_lending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lendingData)
    });

    if (response.ok) {
      document.getElementById('lending-form').reset();
      document.getElementById('lending-date').valueAsDate = new Date();
      updateLendingTypeFields();
      alert('Lending added successfully!');

      // Redirect to appropriate dashboard based on lending type
      const dashboardPage = `dashboard-${lendingType}`;
      document.querySelector(`[data-page="${dashboardPage}"]`).click();
    } else {
      alert('Error adding lending');
    }
  } catch (error) {
    console.error('Error:', error);
    alert('Error adding lending');
  }
});

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
    const response = await fetch('http://localhost:5000/get_lendings');
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
    const response = await fetch('http://localhost:5000/get_lendings');
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
    const response = await fetch('http://localhost:5000/get_lendings');
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
  fetch('http://localhost:5000/get_lendings')
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

  fetch(`http://localhost:5000/record_payment/${lendingId}`, {
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
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePaymentModal(); closeDetailsModal(); }
});
document.getElementById('details-modal').addEventListener('click', (e) => {
  if (e.target.id === 'details-modal') closeDetailsModal();
});

async function deleteLending(lendingId) {
  if (confirm('Are you sure you want to delete this lending?')) {
    try {
      const response = await fetch(`http://localhost:5000/delete_lending/${lendingId}`, {
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
function exportData() {
  fetch('http://localhost:5000/get_lendings')
    .then(res => res.json())
    .then(data => {
      const dataStr = JSON.stringify(data, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lendings_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
    });
}

function clearAllData() {
  if (confirm('Are you sure? This will delete ALL data and cannot be undone!')) {
    fetch('http://localhost:5000/clear_all', {
      method: 'POST'
    }).then(res => {
      if (res.ok) {
        alert('All data cleared!');
        loadLendings();
      }
    });
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
  document.getElementById('lending-date').valueAsDate = new Date();
  // Load all dashboards and analytics on page load
  loadDashboard('daily');
  loadDashboard('weekly');
  loadDashboard('monthly');
  loadAnalytics();
});
