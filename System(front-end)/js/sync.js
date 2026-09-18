/**
 * sync.js — Real-time sync + notification bell for all dashboards.
 *
 * HOW IT WORKS:
 * 1. Connects to the backend SSE stream on page load.
 * 2. When ANY user performs an action, the backend broadcasts an event.
 * 3. This script receives it, shows a toast, updates the bell badge, 
 *    adds it to the dropdown history, and silently refreshes page data.
 */
(function () {
  const API_ROOT = window.API_BASE_URL;
  let refreshTimer = null;
  let notifCount = 0;
  let notifHistory = [];
  const MAX_NOTIF_HISTORY = 30;

  // ── localStorage persistence ─────────────────────────────────────────
  // Each role gets its own storage key so notifications don't mix
  function getStorageKey() {
    const role = getCurrentRole();
    return role ? `notif_${role}` : 'notif_unknown';
  }

  function saveToStorage() {
    try {
      const data = { count: notifCount, history: notifHistory };
      localStorage.setItem(getStorageKey(), JSON.stringify(data));
    } catch (e) { /* storage full or blocked — non-critical */ }
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(getStorageKey());
      if (raw) {
        const data = JSON.parse(raw);
        notifCount   = data.count   || 0;
        notifHistory = data.history || [];
      }
    } catch (e) { /* corrupted data — start fresh */ }
  }

  // ── Helper: safely call a function if it exists on the page ──────────
  function callIfExists(name, ...args) {
    if (typeof window[name] === 'function') {
      return window[name](...args);
    }
    return null;
  }

  // ── Helper: detect which dashboard we are on ─────────────────────────
  function getCurrentRole() {
    const path = location.pathname.toLowerCase();
    if (path.includes('admin.html'))    return 'admin';
    if (path.includes('seller.html'))   return 'seller';
    if (path.includes('driver.html'))   return 'driver';
    if (path.includes('costumer.html') || path.includes('customer.html')) return 'customer';
    return null;
  }

  // ── Helper: show notification toast ──────────────────────────────────
  function showNotification(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type || 'info', 4000);
      return;
    }
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type || 'info'}`;
    toast.innerHTML = `<div>${message}</div>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ── Play notification sound ──────────────────────────────────────────
  function playNotifSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.value = 0.08;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  }

  // ══════════════════════════════════════════════════════════════════════
  // NOTIFICATION BADGE & DROPDOWN LOGIC
  // ══════════════════════════════════════════════════════════════════════

  function updateBadge() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (notifCount <= 0) {
      badge.textContent = '0';
      badge.classList.remove('visible', 'pulse');
    } else {
      badge.textContent = notifCount > 9 ? '9+' : notifCount;
      badge.classList.add('visible');
      // Trigger pulse animation
      badge.classList.remove('pulse');
      void badge.offsetWidth; // force reflow to restart animation
      badge.classList.add('pulse');
    }
  }

  function renderNotifList() {
    const list = document.getElementById('notif-list');
    if (!list) return;

    if (notifHistory.length === 0) {
      list.innerHTML = '<div class="notif-empty"><span class="material-symbols-rounded">notifications_off</span>No notifications yet</div>';
      return;
    }

    list.innerHTML = notifHistory.map(n => {
      const iconName = n.type === 'success' ? 'check_circle' 
                     : n.type === 'error'   ? 'cancel' 
                     : 'info';
      return `
        <div class="notif-item">
          <div class="notif-item-icon ${n.type || 'info'}">
            <span class="material-symbols-rounded">${iconName}</span>
          </div>
          <div class="notif-item-content">
            <p class="notif-item-msg">${n.text}</p>
            <div class="notif-item-time">${n.time}</div>
          </div>
        </div>`;
    }).join('');
  }

  function addToHistory(message, type) {
    // Strip HTML tags for the dropdown text
    const plainText = message.replace(/<[^>]*>/g, '').trim();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    notifHistory.unshift({
      text: plainText,
      type: type || 'info',
      time: timeStr,
      ts: now.getTime()
    });

    // Keep history capped
    if (notifHistory.length > MAX_NOTIF_HISTORY) {
      notifHistory = notifHistory.slice(0, MAX_NOTIF_HISTORY);
    }

    notifCount++;
    updateBadge();
    renderNotifList();
    saveToStorage();
  }

  // ── Global functions (called from HTML onclick) ──────────────────────
  window.toggleNotifPanel = function () {
    const dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;
    const isOpen = dropdown.classList.contains('open');
    dropdown.classList.toggle('open', !isOpen);

    if (!isOpen) {
      // Reset badge count when opening (but keep history)
      notifCount = 0;
      updateBadge();
      saveToStorage();
    }
  };

  window.clearNotifications = function () {
    notifHistory = [];
    notifCount = 0;
    updateBadge();
    renderNotifList();
    saveToStorage();
  };

  // Close dropdown when clicking outside
  document.addEventListener('click', function (e) {
    const wrap = document.getElementById('notif-bell-wrap');
    const dropdown = document.getElementById('notif-dropdown');
    if (wrap && dropdown && !wrap.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // NOTIFICATION MESSAGES PER ROLE
  // ══════════════════════════════════════════════════════════════════════
  function getNotificationMessage(eventType, payload, role) {
    const icon = (name) => `<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">${name}</span>`;
    const orderId = payload?.order_id ? `#${payload.order_id}` : '';
    const status  = payload?.status || '';

    const messages = {
      order_created: {
        seller: { msg: `${icon('notifications_active')} New order ${orderId} received!`, type: 'success' },
        admin:  { msg: `${icon('shopping_cart')} New order ${orderId} placed`, type: 'info' },
      },
      order_updated: {
        customer: {
          msg: status === 'confirmed'          ? `${icon('check_circle')} Your order ${orderId} has been confirmed!`
             : status === 'preparing'          ? `${icon('skillet')} Your order ${orderId} is being prepared!`
             : status === 'ready_for_pickup'   ? `${icon('package_2')} Your order ${orderId} is ready for pickup by driver!`
             : status === 'ready_to_collect'   ? `${icon('storefront')} Your order ${orderId} is ready to collect!`
             : status === 'picked_up'          ? `${icon('local_shipping')} Driver picked up your order ${orderId}!`
             : status === 'out_for_delivery'   ? `${icon('delivery_dining')} Your order ${orderId} is on its way!`
             : status === 'delivered'          ? `${icon('where_to_vote')} Your order ${orderId} has been delivered!`
             : status === 'cancelled'          ? `${icon('cancel')} Order ${orderId} was cancelled`
             : `${icon('sync')} Order ${orderId} updated`,
          type: status === 'cancelled' ? 'error' : 'success'
        },
        seller: {
          msg: status === 'customer_confirmed' ? `${icon('verified')} Customer confirmed receipt of order ${orderId}!`
             : status === 'cancelled'          ? `${icon('cancel')} Order ${orderId} was cancelled`
             : status === 'picked_up'          ? `${icon('local_shipping')} Driver picked up order ${orderId}`
             : null,
          type: status === 'cancelled' ? 'error' : 'info'
        },
        driver: {
          msg: status === 'ready_for_pickup'   ? `${icon('package_2')} Order ${orderId} is ready for pickup!`
             : status === 'cancelled'          ? `${icon('cancel')} Order ${orderId} was cancelled`
             : null,
          type: status === 'cancelled' ? 'error' : 'success'
        },
        admin: {
          msg: `${icon('sync')} Order ${orderId} → ${status.replace(/_/g, ' ')}`,
          type: 'info'
        },
      },
      driver_assigned: {
        driver:   { msg: `${icon('delivery_dining')} You have been assigned to order ${orderId}!`, type: 'success' },
        seller:   { msg: `${icon('local_shipping')} Driver assigned to order ${orderId}`, type: 'info' },
        customer: { msg: `${icon('delivery_dining')} A driver has been assigned to your order ${orderId}!`, type: 'success' },
      },
      product_updated: {
        customer: { msg: `${icon('restaurant_menu')} Menu has been updated!`, type: 'info' },
        admin:    { msg: `${icon('inventory_2')} Product catalog updated`, type: 'info' },
      },
      admin_updated: {
        admin: { msg: `${icon('manage_accounts')} User data updated`, type: 'info' },
      },
      user_updated: {
        admin: { msg: `${icon('person_add')} New user registered`, type: 'info' },
      },
    };

    const eventMessages = messages[eventType];
    if (!eventMessages) return null;
    const roleMessage = eventMessages[role];
    if (!roleMessage || !roleMessage.msg) return null;
    return roleMessage;
  }

  // ══════════════════════════════════════════════════════════════════════
  // DATA REFRESH FUNCTIONS
  // ══════════════════════════════════════════════════════════════════════
  function refreshAdmin() {
    callIfExists('loadStats', true);
    callIfExists('loadOrders', true);
    callIfExists('loadDrivers');
    const active = document.querySelector('.section.active')?.id || '';
    if (active === 'section-users') callIfExists('loadUsers');
    if (active === 'section-analytics') {
      callIfExists('loadAnalytics');
      callIfExists('loadTopProducts');
    }
    if (active === 'section-overview') {
      callIfExists('loadWeekChart');
      callIfExists('loadStatusChart');
    }
  }

  function refreshSeller() {
    callIfExists('loadOrders', true);
    if (!window.editingId) callIfExists('loadProducts', true);
    const active = document.querySelector('.tab-content.active')?.id || '';
    if (active === 'tab-sales') callIfExists('loadSalesDashboard');
  }

  function refreshDriver() {
    callIfExists('loadDeliveries', true);
  }

  function refreshCustomer() {
    callIfExists('checkDriverAvailability');
    callIfExists('loadMenu');
    callIfExists('loadOrderHistory', true);
    callIfExists('loadMyReviews');
  }

  function refreshCurrentPage() {
    const role = getCurrentRole();
    if (role === 'admin')    refreshAdmin();
    else if (role === 'seller')   refreshSeller();
    else if (role === 'driver')   refreshDriver();
    else if (role === 'customer') refreshCustomer();
  }

  // ══════════════════════════════════════════════════════════════════════
  // EVENT HANDLER
  // ══════════════════════════════════════════════════════════════════════
  function handleEvent(eventData) {
    const role      = getCurrentRole();
    const eventType = eventData?.type || '';
    const payload   = eventData?.payload || {};
    if (!role) return;

    const notification = getNotificationMessage(eventType, payload, role);
    if (notification) {
      showNotification(notification.msg, notification.type);
      addToHistory(notification.msg, notification.type);
      playNotifSound();
    }

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshCurrentPage(), 300);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SSE CONNECTION
  // ══════════════════════════════════════════════════════════════════════
  function connect() {
    if (!window.EventSource) {
      console.warn('[sync] EventSource not supported.');
      return;
    }

    const source = new EventSource(`${API_ROOT}/realtime/events`);

    source.addEventListener('connected', () => {
      console.log('[sync] Real-time connected.');
    });

    source.addEventListener('update', (event) => {
      let data = {};
      try { data = JSON.parse(event.data || '{}'); } catch (e) {}
      handleEvent(data);
    });

    source.onerror = () => {
      console.warn('[sync] Connection dropped. Retrying...');
    };
  }

  // ── Initialize: load saved notifications, then connect ───────────────
  function init() {
    loadFromStorage();
    updateBadge();
    renderNotifList();
    connect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
