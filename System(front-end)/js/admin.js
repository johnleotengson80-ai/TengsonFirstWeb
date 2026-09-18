const API = window.API_BASE_URL;

// ── SHARED AUTH STORAGE ──────────────────────────────────────────────
const getToken = () => localStorage.getItem('token');
const getUser  = () => JSON.parse(localStorage.getItem('user') || '{}');

// ── Chart Instances ───────────────────────────────────────────────────
let weekChartInstance      = null;
let statusChartInstance    = null;
let analyticsRevChart      = null;
let analyticsOrdChart      = null;

// ── Analytics State ───────────────────────────────────────────────────
let currentPeriod = 'daily';

// ── Universal API Handler ─────────────────────────────────────────────
async function apiCall(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        'Authorization': `Bearer ${getToken()}`
      }
    });

    if (res.status === 401) {
      handleUnauthorized();
      return null;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(`❌ ${data.error || 'Request failed'}`, 'error');
      return null;
    }

    return await res.json();

  } catch (e) {
    console.error(e);
    showToast('❌ Network error', 'error');
    return null;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────
function showToast(message, type = 'success', duration = 3000) {
  let container = document.getElementById('toast-container');

  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div>${message}</div>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Unauthorized ──────────────────────────────────────────────────────
function handleUnauthorized() {
  showToast('⚠️ Session expired', 'error', 2000);

  setTimeout(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    location.href = '../html/index.html';
  }, 2000);
}

// ── Logout ────────────────────────────────────────────────────────────
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');

  showToast('👋 Logged out', 'success');

  setTimeout(() => {
    location.href = '../html/index.html';
  }, 1000);
}

// ── Navigation ────────────────────────────────────────────────────────
function showSection(name, btn) {

  document.querySelectorAll('.section')
    .forEach(s => s.classList.remove('active'));

  document.querySelectorAll('.sidebar-item')
    .forEach(b => b.classList.remove('active'));

  const section = document.getElementById(`section-${name}`);

  if (section) section.classList.add('active');

  if (btn) btn.classList.add('active');

  switch (name) {

    case 'overview':
      loadStats();
      loadWeekChart();
      loadStatusChart();
      break;

    case 'analytics':
      populateYearSelector();
      loadAnalytics();
      loadTopProducts();
      break;

    case 'users':
      loadUsers();
      break;

    case 'orders':
      loadOrders();
      break;

    case 'drivers':
      loadDrivers();
      break;
  }
}

// ── Stats ─────────────────────────────────────────────────────────────
async function loadStats() {

  const data = await apiCall(`${API}/admin/stats`);

  if (!data?.stats) return;

  const stats = data.stats;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('stat-users', stats.total_users || 0);
  set('stat-orders', stats.total_orders || 0);
  set('stat-products', stats.total_products || 0);
  set('stat-pending', stats.pending_orders || 0);
  set('stat-delivered', stats.delivered_orders || 0);

  set(
    'stat-revenue',
    '₱' + parseFloat(stats.total_revenue || 0)
      .toLocaleString('en-PH', { minimumFractionDigits: 2 })
  );
}

// ── Week Revenue Chart ────────────────────────────────────────────────
async function loadWeekChart() {

  const data = await apiCall(`${API}/admin/analytics/recent`);

  if (!data?.recent) return;

  const recent = data.recent;

  const labels = [];
  const revenues = [];

  const today = new Date();

  for (let i = 6; i >= 0; i--) {

    const d = new Date(today);
    d.setDate(today.getDate() - i);

    const key = d.toISOString().split('T')[0];

    const day = d.toLocaleDateString('en-PH', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    const row = recent.find(r => r.date === key);

    labels.push(day);
    revenues.push(row ? row.revenue : 0);
  }

  const ctx = document.getElementById('weekChart');

  if (!ctx) return;

  if (weekChartInstance) weekChartInstance.destroy();

  weekChartInstance = new Chart(ctx, {
    type: 'bar',

    data: {
      labels,

      datasets: [{
        label: 'Revenue',

        data: revenues,

        backgroundColor: 'rgba(255,107,43,0.75)',
        borderColor: 'rgba(255,107,43,1)',
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false
      }]
    },

    options: {
      responsive: true,
      maintainAspectRatio: true,

      plugins: {
        legend: {
          display: false
        },

        tooltip: {
          callbacks: {
            label: ctx =>
              `₱${parseFloat(ctx.raw).toLocaleString('en-PH', {
                minimumFractionDigits: 2
              })}`
          }
        }
      },

      scales: {

        y: {
          beginAtZero: true,

          ticks: {
            callback: val => `₱${val.toLocaleString()}`
          },

          grid: {
            color: 'rgba(0,0,0,0.05)'
          }
        },

        x: {
          grid: {
            display: false
          }
        }
      }
    }
  });
}

// ── Status Chart ──────────────────────────────────────────────────────
async function loadStatusChart() {

  const data = await apiCall(`${API}/admin/analytics/order-status`);

  if (!data?.breakdown?.length) return;

  const breakdown = data.breakdown;

  const colorMap = {

    pending: 'rgba(243,156,18,0.8)',
    confirmed: 'rgba(52,152,219,0.8)',
    preparing: 'rgba(155,89,182,0.8)',
    out_for_delivery: 'rgba(255,107,43,0.8)',
    delivered: 'rgba(46,204,113,0.8)',
    cancelled: 'rgba(231,76,60,0.8)',

    ready_for_pickup: 'rgba(241,196,15,0.8)',
    ready_to_collect: 'rgba(26,188,156,0.8)'
  };

  const labels = breakdown.map(r =>
    r.status.replaceAll('_', ' ').toUpperCase()
  );

  const counts = breakdown.map(r => r.count);

  const colors = breakdown.map(r =>
    colorMap[r.status] || 'rgba(136,136,136,0.8)'
  );

  const ctx = document.getElementById('statusChart');

  if (!ctx) return;

  if (statusChartInstance) statusChartInstance.destroy();

  statusChartInstance = new Chart(ctx, {

    type: 'doughnut',

    data: {

      labels,

      datasets: [{
        data: counts,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },

    options: {

      responsive: true,
      maintainAspectRatio: true,
      cutout: '65%',

      plugins: {

        legend: {
          position: 'bottom',

          labels: {
            padding: 16,
            font: { size: 12 }
          }
        },

        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${ctx.raw} orders`
          }
        }
      }
    }
  });
}

// ── Populate Selectors ────────────────────────────────────────────────
function populateYearSelector() {

  const current = new Date().getFullYear();

  ['monthly-year', 'yearly-year'].forEach(id => {

    const sel = document.getElementById(id);

    if (!sel) return;

    sel.innerHTML = '';

    for (let y = current; y >= current - 4; y--) {

      const opt = document.createElement('option');

      opt.value = y;
      opt.textContent = y;

      sel.appendChild(opt);
    }
  });

  const today = new Date();

  const dailyDate = document.getElementById('daily-date');

  if (dailyDate) {
    dailyDate.value = today.toISOString().split('T')[0];
  }

  const monthlyMonth = document.getElementById('monthly-month');

  if (monthlyMonth) {
    monthlyMonth.value = today.getMonth() + 1;
  }

  const weeklyWeek = document.getElementById('weekly-week');

  if (weeklyWeek) {

    const jan1 = new Date(today.getFullYear(), 0, 1);

    const weekNum = Math.ceil(
      (
        ((today - jan1) / 86400000)
        + jan1.getDay()
        + 1
      ) / 7
    );

    weeklyWeek.value =
      `${today.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }
}

// ── Switch Analytics ──────────────────────────────────────────────────
function switchAnalytics(period, btn) {

  currentPeriod = period;

  document.querySelectorAll('.analytics-tab')
    .forEach(b => b.classList.remove('active'));

  btn.classList.add('active');

  ['daily', 'weekly', 'monthly', 'yearly']
    .forEach(p => {

      const el = document.getElementById(`selector-${p}`);

      if (el) {
        el.style.display = p === period ? 'flex' : 'none';
      }
    });

  loadAnalytics();
}

// ── Main Analytics Loader ─────────────────────────────────────────────
async function loadAnalytics() {

  switch (currentPeriod) {

    case 'daily':
      await loadDailyAnalytics();
      break;

    case 'weekly':
      await loadWeeklyAnalytics();
      break;

    case 'monthly':
      await loadMonthlyAnalytics();
      break;

    case 'yearly':
      await loadYearlyAnalytics();
      break;
  }
}

// ── Summary Pills ─────────────────────────────────────────────────────
function updateSummaryPills(revenue, orders, periodLabel, periodDisplay) {

  const avg = orders > 0 ? revenue / orders : 0;

  const fmt = v =>
    `₱${parseFloat(v).toLocaleString('en-PH', {
      minimumFractionDigits: 2
    })}`;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('analytics-revenue', fmt(revenue));
  set('analytics-orders', orders);
  set('analytics-avg', fmt(avg));
  set('period-label', periodLabel);
  set('period-display', periodDisplay);
}

// ── Render Analytics Charts ───────────────────────────────────────────
function renderAnalyticsCharts(
  labels,
  revenues,
  orders,
  revTitle,
  revSub,
  ordTitle,
  ordSub
) {

  const revCtx = document.getElementById('analyticsRevenueChart');
  const ordCtx = document.getElementById('analyticsOrdersChart');

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('revenue-chart-title', revTitle);
  set('revenue-chart-sub', revSub);

  set('orders-chart-title', ordTitle);
  set('orders-chart-sub', ordSub);

  if (analyticsRevChart) analyticsRevChart.destroy();
  if (analyticsOrdChart) analyticsOrdChart.destroy();

  if (revCtx) {

    analyticsRevChart = new Chart(revCtx, {

      type: 'line',

      data: {

        labels,

        datasets: [{

          label: 'Revenue',
          data: revenues,

          borderColor: 'rgba(255,107,43,1)',
          backgroundColor: 'rgba(255,107,43,0.08)',

          borderWidth: 3,

          pointBackgroundColor: 'rgba(255,107,43,1)',

          pointRadius: 5,

          fill: true,
          tension: 0.4
        }]
      },

      options: {

        responsive: true,
        maintainAspectRatio: false,

        plugins: {

          legend: {
            display: false
          },

          tooltip: {
            callbacks: {
              label: c =>
                `₱${parseFloat(c.raw).toLocaleString('en-PH', {
                  minimumFractionDigits: 2
                })}`
            }
          }
        },

        scales: {

          y: {
            beginAtZero: true,

            ticks: {
              callback: v => `₱${v.toLocaleString()}`
            },

            grid: {
              color: 'rgba(0,0,0,0.05)'
            }
          },

          x: {
            grid: {
              display: false
            }
          }
        }
      }
    });
  }

  if (ordCtx) {

    analyticsOrdChart = new Chart(ordCtx, {

      type: 'bar',

      data: {

        labels,

        datasets: [{

          label: 'Orders',
          data: orders,

          backgroundColor: 'rgba(46,204,113,0.75)',
          borderColor: 'rgba(46,204,113,1)',

          borderWidth: 2,
          borderRadius: 6
        }]
      },

      options: {

        responsive: true,
        maintainAspectRatio: false,

        plugins: {
          legend: {
            display: false
          }
        },

        scales: {

          y: {
            beginAtZero: true,

            ticks: {
              stepSize: 1
            },

            grid: {
              color: 'rgba(0,0,0,0.05)'
            }
          },

          x: {
            grid: {
              display: false
            }
          }
        }
      }
    });
  }
}

// ── Daily Analytics ───────────────────────────────────────────────────
async function loadDailyAnalytics() {

  const date =
    document.getElementById('daily-date')?.value
    || new Date().toISOString().split('T')[0];

  const data = await apiCall(
    `${API}/admin/analytics/daily?date=${date}`
  );

  if (!data) return;

  const hours = data.hours || [];

  const labels = hours.map(h =>
    `${String(h.hour).padStart(2, '0')}:00`
  );

  const revenues = hours.map(h => h.revenue);
  const orders = hours.map(h => h.order_count);

  updateSummaryPills(
    data.total_revenue || 0,
    data.total_orders || 0,
    'Date',
    date
  );

  renderAnalyticsCharts(
    labels,
    revenues,
    orders,

    'Hourly Revenue',
    `Revenue by hour — ${date}`,

    'Hourly Orders',
    `Orders by hour — ${date}`
  );
}

// ── Weekly Analytics ──────────────────────────────────────────────────
async function loadWeeklyAnalytics() {

  const week = document.getElementById('weekly-week')?.value;

  if (!week) return;

  const data = await apiCall(
    `${API}/admin/analytics/weekly?week=${week}`
  );

  if (!data) return;

  const days = data.days || [];

  const labels = days.map(d => d.day_name);

  const revenues = days.map(d => d.revenue);
  const orders = days.map(d => d.order_count);

  updateSummaryPills(
    data.total_revenue || 0,
    data.total_orders || 0,
    'Week',
    week
  );

  renderAnalyticsCharts(
    labels,
    revenues,
    orders,

    'Daily Revenue This Week',
    `Revenue by day — ${week}`,

    'Daily Orders This Week',
    `Orders by day — ${week}`
  );
}

// ── Monthly Analytics ─────────────────────────────────────────────────
async function loadMonthlyAnalytics() {

  const year =
    document.getElementById('monthly-year')?.value
    || new Date().getFullYear();

  const month =
    document.getElementById('monthly-month')?.value
    || (new Date().getMonth() + 1);

  const data = await apiCall(
    `${API}/admin/analytics/monthly-detail?year=${year}&month=${month}`
  );

  if (!data) return;

  const days = data.days || [];

  const labels = days.map(d => `Day ${d.day}`);

  const revenues = days.map(d => d.revenue);
  const orders = days.map(d => d.order_count);

  const monthNames = [
    '',
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec'
  ];

  const label = `${monthNames[month]} ${year}`;

  updateSummaryPills(
    data.total_revenue || 0,
    data.total_orders || 0,
    'Month',
    label
  );

  renderAnalyticsCharts(
    labels,
    revenues,
    orders,

    `Revenue — ${label}`,
    'Daily revenue breakdown',

    `Orders — ${label}`,
    'Daily orders breakdown'
  );
}

// ── Yearly Analytics ──────────────────────────────────────────────────
async function loadYearlyAnalytics() {

  const year =
    document.getElementById('yearly-year')?.value
    || new Date().getFullYear();

  const data = await apiCall(
    `${API}/admin/analytics/yearly?year=${year}`
  );

  if (!data) return;

  const months = data.months || [];

  const labels = months.map(m => m.month);

  const revenues = months.map(m => m.revenue);
  const orders = months.map(m => m.order_count);

  updateSummaryPills(
    data.year_total || 0,
    data.year_orders || 0,
    'Year',
    String(year)
  );

  renderAnalyticsCharts(
    labels,
    revenues,
    orders,

    `Revenue — ${year}`,
    'Monthly revenue breakdown',

    `Orders — ${year}`,
    'Monthly orders breakdown'
  );
}

// ── Top Products ──────────────────────────────────────────────────────
async function loadTopProducts() {

  const container = document.getElementById('top-products-list');

  if (!container) return;

  container.innerHTML =
    '<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>';

  const data = await apiCall(`${API}/admin/analytics/top-products`);

  if (!data?.top_products) return;

  const products = data.top_products;

  if (!products.length) {

    container.innerHTML =
      '<p style="text-align:center;padding:30px;color:gray">No sales data yet.</p>';

    return;
  }

  const maxSold = Math.max(...products.map(p => p.total_sold));

  const rankCls = ['gold', 'silver', 'bronze', '', ''];
  const rankIcon = ['🥇', '🥈', '🥉', '4', '5'];

  container.innerHTML = products.slice(0, 5).map((p, i) => `

    <div class="top-product-row">

      <div class="top-product-rank ${rankCls[i]}">
        ${rankIcon[i]}
      </div>

      <div class="top-product-info">

        <div class="top-product-name">
          ${p.name}
        </div>

        <div class="top-product-meta">
          ${p.total_sold} sold
        </div>

      </div>

      <div class="top-product-bar-wrap">

        <div class="top-product-bar-bg">

          <div
            class="top-product-bar-fill"
            style="width:${Math.round((p.total_sold / maxSold) * 100)}%">
          </div>

        </div>

        <span class="top-product-revenue">
          ₱${parseFloat(p.total_revenue).toLocaleString('en-PH', {
            minimumFractionDigits: 2
          })}
        </span>

      </div>

    </div>

  `).join('');
}

// ── Users ─────────────────────────────────────────────────────────────
async function loadUsers() {

  const list = document.getElementById('users-list');

  if (!list) return;

  list.innerHTML =
    '<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>';

  const data = await apiCall(`${API}/admin/users`);

  if (!data?.users) return;

  if (!data.users.length) {

    list.innerHTML =
      '<p style="text-align:center;padding:40px;color:gray">No users found.</p>';

    return;
  }

  const bgMap = {
    admin: 'var(--orange)',
    seller: 'var(--blue)',
    customer: 'var(--green)',
    driver: 'var(--purple)'
  };

  list.innerHTML = data.users.map(u => `

    <div class="user-row">

      <div class="user-info">

        <div
          class="user-avatar"
          style="background:${bgMap[u.role] || '#888'}">

          ${u.username?.[0]?.toUpperCase() || '?'}

        </div>

        <div>

          <div class="user-name">

            ${u.username}

            <span class="role-badge role-${u.role}">
              ${u.role}
            </span>

          </div>

          <div class="user-meta">

            ID: ${u.id}
            ·
            ${u.email || 'No email'}

          </div>

        </div>

      </div>

      <button
        class="btn btn-red btn-sm"
        onclick="openEditUserModal(${JSON.stringify(u).replace(/"/g, '&quot;')})">
        ✏️ Edit
      </button>
      <button
        class="btn btn-red btn-sm"
        onclick="deleteUser(${u.id}, '${u.username.replace(/'/g, "\\'")}')">
        🗑️ Delete
      </button>

    </div>

  `).join('');
}

// ── User modal helpers ───────────────────────────────────────────────
function userField(id) {
  return document.getElementById(id);
}

function setUserModalError(id, message) {
  const error = userField(id);
  if (!error) return;
  error.textContent = message || '';
  error.style.display = message ? 'block' : 'none';
}

function openCreateUserModal() {
  const overlay = userField('create-user-overlay');
  if (!overlay) return;
  ['username', 'password', 'fullname', 'email', 'phone', 'address']
    .forEach(field => {
      const input = userField(`new-user-${field}`);
      if (input) input.value = '';
    });
  const role = userField('new-user-role');
  if (role) role.value = 'driver';
  const password = userField('new-user-password');
  if (password) password.type = 'password';
  const icon = userField('new-user-pw-icon');
  if (icon) icon.textContent = 'visibility';
  setUserModalError('new-user-error', '');
  overlay.style.display = 'flex';
  userField('new-user-username')?.focus();
}

function closeCreateUserModal() {
  const overlay = userField('create-user-overlay');
  if (overlay) overlay.style.display = 'none';
}

function toggleNewUserPassword() {
  const input = userField('new-user-password');
  const icon = userField('new-user-pw-icon');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  if (icon) icon.textContent = input.type === 'password' ? 'visibility' : 'visibility_off';
}

async function submitCreateUser() {
  const username = userField('new-user-username')?.value.trim() || '';
  const password = userField('new-user-password')?.value || '';
  const role = userField('new-user-role')?.value || 'customer';
  const errorId = 'new-user-error';

  if (!username || !password) {
    setUserModalError(errorId, 'Username and password are required.');
    return;
  }
  if (password.length < 6) {
    setUserModalError(errorId, 'Password must be at least 6 characters.');
    return;
  }

  const data = await apiCall(`${API}/admin/users`, {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      role,
      full_name: userField('new-user-fullname')?.value.trim() || '',
      email: userField('new-user-email')?.value.trim() || '',
      phone: userField('new-user-phone')?.value.trim() || '',
      address: userField('new-user-address')?.value.trim() || ''
    })
  });

  if (!data) return;
  closeCreateUserModal();
  showToast(`✅ ${data.message || 'User created successfully.'}`, 'success');
  loadUsers();
  loadStats();
}

function openEditUserModal(user) {
  if (!user) return;
  const values = {
    id: user.id,
    username: user.username,
    role: user.role,
    full_name: user.full_name || '',
    email: user.email || '',
    phone: user.phone || '',
    address: user.address || ''
  };
  Object.entries(values).forEach(([field, value]) => {
    const input = userField(`edit-user-${field}`);
    if (input) input.value = value;
  });
  const password = userField('edit-user-password');
  if (password) password.value = '';
  setUserModalError('edit-user-error', '');
  const overlay = userField('edit-user-overlay');
  if (overlay) overlay.style.display = 'flex';
  userField('edit-user-username')?.focus();
}

function closeEditUserModal() {
  const overlay = userField('edit-user-overlay');
  if (overlay) overlay.style.display = 'none';
}

function toggleEditUserPassword() {
  const input = userField('edit-user-password');
  const icon = userField('edit-user-pw-icon');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  if (icon) icon.textContent = input.type === 'password' ? 'visibility' : 'visibility_off';
}

async function submitEditUser() {
  const userId = userField('edit-user-id')?.value;
  const username = userField('edit-user-username')?.value.trim() || '';
  const password = userField('edit-user-password')?.value || '';
  const errorId = 'edit-user-error';

  if (!userId || !username) {
    setUserModalError(errorId, 'Username is required.');
    return;
  }
  if (password && password.length < 6) {
    setUserModalError(errorId, 'Password must be at least 6 characters.');
    return;
  }

  const data = await apiCall(`${API}/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      username,
      password,
      role: userField('edit-user-role')?.value || '',
      full_name: userField('edit-user-fullname')?.value.trim() || '',
      email: userField('edit-user-email')?.value.trim() || '',
      phone: userField('edit-user-phone')?.value.trim() || '',
      address: userField('edit-user-address')?.value.trim() || ''
    })
  });

  if (!data) return;
  closeEditUserModal();
  showToast(`✅ ${data.message || 'User updated successfully.'}`, 'success');
  loadUsers();
  loadStats();
}

// ── Delete User ───────────────────────────────────────────────────────
async function deleteUser(userId, username) {

  if (!confirm(`Delete "${username}"?`)) return;

  const data = await apiCall(
    `${API}/admin/users/${userId}`,
    { method: 'DELETE' }
  );

  if (data) {

    showToast(`✅ ${username} deleted`, 'success');

    loadUsers();
    loadStats();
  }
}

// ── Orders ────────────────────────────────────────────────────────────
async function loadOrders() {

  const list = document.getElementById('orders-list');

  if (!list) return;

  list.innerHTML =
    '<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>';

  const data = await apiCall(`${API}/admin/orders`);

  if (!data?.orders) return;

  if (!data.orders.length) {

    list.innerHTML =
      '<p style="text-align:center;padding:40px;color:gray">No orders yet.</p>';

    return;
  }

  list.innerHTML = data.orders.map(o => `

    <div class="order-row">

      <div class="order-row-hdr">

        <span class="order-row-id">
          Order #${o.id}
        </span>

        <span class="badge badge-${o.status}">
          ${o.status.replaceAll('_', ' ')}
        </span>

      </div>

      <div class="order-row-meta">

        👤 Customer #${o.customer_id}
        ·
        💰 ₱${parseFloat(o.total_amount || 0).toFixed(2)}
        ·
        💳 ${o.payment_method || 'N/A'}
        ·
        🚚 ${o.driver_id ? `Driver #${o.driver_id}` : 'Unassigned'}
        ·
        ⏱️ ${o.est_delivery_min || 'N/A'} min

      </div>

      <div class="order-row-meta">

        🍽️ ${o.items?.map(i =>
          `${i.product_name} ×${i.quantity}`
        ).join(', ') || 'No items'}

      </div>

    </div>

  `).join('');
}

// ── Drivers ───────────────────────────────────────────────────────────
async function loadDrivers() {

  const container = document.getElementById('drivers-content');

  if (!container) return;

  container.innerHTML =
    '<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>';

  const [driversData, ordersData] = await Promise.all([
    apiCall(`${API}/admin/users?role=driver`),
    apiCall(`${API}/admin/orders`)
  ]);

  if (!driversData?.users || !ordersData?.orders) return;

  const drivers = driversData.users;
  const orders = ordersData.orders;

  const busyIds = orders
    .filter(o => o.status === 'out_for_delivery' && o.driver_id)
    .map(o => o.driver_id);

  const available = drivers.filter(d => !busyIds.includes(d.id));

  const unassigned = orders.filter(o =>
    !o.driver_id &&
    !['delivered', 'cancelled'].includes(o.status)
  );

  container.innerHTML = `

    <div class="drivers-grid">

      <div class="drivers-panel">

        <div class="panel-title">
          🏍️ Drivers (${drivers.length})
        </div>

        ${drivers.map(d => {

          const busy = busyIds.includes(d.id);

          return `

            <div class="driver-item ${busy ? 'busy' : 'available'}">

              <div>

                <div class="driver-name">
                  ${d.username}
                </div>

                <div class="driver-meta">
                  ID: ${d.id}
                </div>

              </div>

              <div class="avail-dot ${busy ? 'red' : 'green'}"></div>

            </div>

          `;
        }).join('')}

      </div>

      <div class="drivers-panel">

        <div class="panel-title">
          📦 Unassigned Orders (${unassigned.length})
        </div>

        ${unassigned.map(o => `

          <div class="assign-card">

            <div class="assign-order-id">
              Order #${o.id}
            </div>

            <div class="assign-row">

              <select
                class="assign-select"
                id="driver-select-${o.id}">

                <option value="">
                  — Select Driver —
                </option>

                ${available.map(d => `
                  <option value="${d.id}">
                    ${d.username}
                  </option>
                `).join('')}

              </select>

              <button
                class="assign-btn"
                onclick="assignDriver(${o.id})">

                Assign 🚚

              </button>

            </div>

            <div class="assign-est-row">

              <span>Est. delivery:</span>

              <input
                type="number"
                class="assign-est-input"
                id="est-${o.id}"
                value="30"
                min="5"
                max="300">

              <span>min</span>

            </div>

          </div>

        `).join('')}

      </div>

    </div>
  `;
}

// ── Assign Driver ─────────────────────────────────────────────────────
async function assignDriver(orderId) {

  const driverId =
    document.getElementById(`driver-select-${orderId}`)?.value;

  const estMin =
    parseInt(document.getElementById(`est-${orderId}`)?.value || '30');

  if (!driverId) {
    showToast('❌ Select a driver', 'error');
    return;
  }

  const data = await apiCall(
    `${API}/admin/orders/${orderId}/assign-driver`,
    {
      method: 'POST',

      body: JSON.stringify({
        driver_id: parseInt(driverId),
        est_delivery_min: estMin
      })
    }
  );

  if (data) {

    showToast(`✅ Driver assigned`, 'success');

    loadDrivers();
    loadOrders();
  }
}

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  populateYearSelector();

  loadStats();
  loadWeekChart();
  loadStatusChart();

  setInterval(() => {

    if (!getToken()) {
      location.href = '../html/index.html';
      return;
    }

    loadStats();

    const ordersSection =
      document.getElementById('section-orders');

    if (ordersSection?.classList.contains('active')) {
      loadOrders();
    }

  }, 5000);
});