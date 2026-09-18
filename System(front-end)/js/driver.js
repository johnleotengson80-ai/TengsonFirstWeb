/**
 * driver.js — Driver Dashboard
 * New flow:
 *   1. Driver sees order assigned (status: ready_for_pickup)
 *   2. Driver clicks "Confirm Pickup" → status: picked_up
 *   3. Driver clicks "Out for Delivery" → status: out_for_delivery
 *   4. Driver clicks "Mark as Delivered" → status: delivered
 *   5. Customer confirms receipt → status: customer_confirmed
 */

const API   = window.API_BASE_URL;
const getToken = () => localStorage.getItem('token');
if (!getToken()) location.href = '../html/index.html';

let _driverRefreshing = false;
function refreshAllData() {
  if (!getToken()) { location.href = '../html/index.html'; return; }
  if (_driverRefreshing) return;
  _driverRefreshing = true;
  loadDeliveries(true).finally(() => { _driverRefreshing = false; });
}

document.addEventListener('DOMContentLoaded', () => {
  loadDeliveries();
  setInterval(refreshAllData, 5000);
});

function logout() {
  clearDriverSession();
  location.href = '../html/index.html';
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
  toast.innerHTML = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function clearDriverSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

function handleUnauthorized() {
  showToast('⚠️ Session expired. Redirecting...', 'error', 2000);

  setTimeout(() => {
    clearDriverSession();
    location.href = '../html/index.html';
  }, 2000);
}

// ── Load Deliveries ───────────────────────────────────────────────────
async function loadDeliveries(silent = false) {
  const container = document.getElementById('deliveries-container');
  if (!silent) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading deliveries...</p></div>';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res  = await fetch(`${API}/driver/deliveries`, {
      headers: { 'Authorization': `Bearer ${getToken()}` },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) { handleUnauthorized(); return; }
      container.innerHTML = `<div class="empty-state">
        <p style="color:var(--red)">${data.error || 'Failed to load.'}</p>
      </div>`; return;
    }

    const deliveries = data.deliveries;
    const active = deliveries.filter(d =>
      !['delivered','customer_confirmed','cancelled'].includes(d.status)
    ).length;
    const done = deliveries.filter(d =>
      ['delivered','customer_confirmed'].includes(d.status)
    ).length;

    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-done').textContent   = done;

    if (!deliveries.length) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🏍️</span>
          <div class="empty-title">No deliveries yet</div>
          <p class="empty-sub">Admin will assign orders to you. Refreshes every 30 seconds.</p>
        </div>`; return;
    }

    const payLabel = (m) => ({
      gcash:'📱 GCash', paymaya:'💜 PayMaya',
      cod:'💵 Cash on Delivery', pickup:'🏃 Pick Up'
    }[m] || m);

    container.innerHTML = deliveries.map(order => {
      const isOnline    = ['gcash','paymaya'].includes(order.payment_method);
      const isReadyForPickup   = order.status === 'ready_for_pickup';
      const isPickedUp         = order.status === 'picked_up';
      const isOutForDelivery   = order.status === 'out_for_delivery';
      const isDelivered        = order.status === 'delivered';
      const isConfirmed        = order.status === 'customer_confirmed';
      const isActive = ['ready_for_pickup','picked_up','out_for_delivery'].includes(order.status);

      return `
        <div class="delivery-card${isActive ? ' active-delivery' : ''}">

          <div class="delivery-header">
            <span class="delivery-id">Order #${order.id}</span>
            <span class="badge badge-${order.status}">
              ${order.status.replace(/_/g,' ').toUpperCase()}
            </span>
          </div>

          <div class="delivery-body">

            ${isActive
              ? `<div class="est-time-badge">
                  🕐 Est. delivery: ~${order.est_delivery_min} min
                 </div>`
              : ''}

            <!-- Receipt -->
            <div class="receipt-box">
              <div class="receipt-box-title">📄 Order Receipt</div>
              ${order.items.map(i => `
                <div class="receipt-box-row">
                  <span>${i.product_name} × ${i.quantity}</span>
                  <span>₱${(i.price_at_order * i.quantity).toFixed(2)}</span>
                </div>`).join('')}
              <div class="receipt-box-row">
                <span>Subtotal</span>
                <span>₱${parseFloat(order.subtotal).toFixed(2)}</span>
              </div>
              <div class="receipt-box-row">
                <span>Rider Fee</span>
                <span>${parseFloat(order.rider_fee) === 0
                  ? 'Free (Pick Up)'
                  : `₱${parseFloat(order.rider_fee).toFixed(2)}`}</span>
              </div>
              <div class="receipt-box-total">
                <span>Total</span>
                <span>₱${parseFloat(order.total_amount).toFixed(2)}</span>
              </div>
            </div>

            ${isOnline && order.reference_no ? `
            <div class="ref-badge">
              🧾 Ref: <strong>${order.reference_no}</strong>
              — Verify with customer before handing over
            </div>` : ''}

            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Payment</span>
                <span class="info-value">${payLabel(order.payment_method)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Address</span>
                <span class="info-value">${order.delivery_address || 'Not provided'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Order Time</span>
                <span class="info-value">${new Date(order.created_at).toLocaleString()}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Notes</span>
                <span class="info-value">${order.notes || '—'}</span>
              </div>
            </div>

            <!-- Action buttons based on current status -->
            ${isReadyForPickup ? `
              <div class="driver-action-info">
                📦 Food is ready at the seller. Go pick it up!
              </div>
              <button class="deliver-btn deliver-btn-blue"
                id="btn-${order.id}"
                onclick="updateOrderStatus(${order.id}, 'picked_up', this)">
                ✅ Confirm Pickup — I Have the Order
              </button>` : ''}

            ${isPickedUp ? `
              <div class="driver-action-info">
                ✅ You have picked up the order. Head to the customer now.
              </div>
              <button class="deliver-btn deliver-btn-orange"
                id="btn-${order.id}"
                onclick="updateOrderStatus(${order.id}, 'out_for_delivery', this)">
                🚚 I'm On My Way to the Customer
              </button>` : ''}

            ${isOutForDelivery ? `
              <div class="driver-action-info">
                🚚 You are on the way. Hand over the order and mark as delivered.
              </div>
              <button class="deliver-btn"
                id="btn-${order.id}"
                onclick="updateOrderStatus(${order.id}, 'delivered', this)">
                📦 Mark as Delivered
              </button>` : ''}

            ${isDelivered ? `
              <div class="delivered-box">
                📦 Marked as delivered. Waiting for customer confirmation...
              </div>` : ''}

            ${isConfirmed ? `
              <div class="delivered-box" style="background:rgba(46,204,113,0.1);color:var(--green-dk)">
                🎉 Customer confirmed receipt! Order complete.
              </div>` : ''}

          </div>
        </div>`;
    }).join('');

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return;
    if (!silent) container.innerHTML = `<div class="empty-state"><p style="color:var(--red)">Cannot connect to server.</p></div>`;
    console.error('loadDeliveries error:', err);
  }
}

// ── Update order status ───────────────────────────────────────────────
async function updateOrderStatus(orderId, status, btn) {
  const labels = {
    picked_up:        'confirming pickup...',
    out_for_delivery: 'updating...',
    delivered:        'marking delivered...'
  };

  if (btn) { btn.disabled = true; btn.textContent = `⏳ ${labels[status] || 'updating...'}`; }

  try {
    const res  = await fetch(`${API}/orders/${orderId}/status`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body:    JSON.stringify({ status })
    });
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) { handleUnauthorized(); return; }
      showToast(`❌ ${data.error || 'Failed to update.'}`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Try Again'; }
      return;
    }

    const successLabels = {
      picked_up:        '✅ Pickup confirmed! Head to the customer.',
      out_for_delivery: '🚚 Status updated — safe travels!',
      delivered:        '📦 Marked as delivered! Waiting for customer...'
    };
    showToast(successLabels[status] || '✅ Updated!', 'success');
    loadDeliveries();

  } catch (err) {
    showToast('❌ Cannot connect to server.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Try Again'; }
    console.error('updateOrderStatus error:', err);
  }
}
