/**
 * costumer.js — Customer Dashboard
 * New flow:
 *   DELIVERY: Shows full timeline. After 'delivered' shows "Confirm Receipt" button.
 *   PICKUP: Shows est prep time + "Food is Ready!" notification.
 *   After customer_confirmed: shows Rate Order button.
 */

const API   = window.API_BASE_URL;
const getToken = () => localStorage.getItem('token');
if (!getToken()) location.href = '../html/index.html';

const RIDER_FEE = 49;
let cart             = [];
let menuProducts     = [];
let myReviewed       = [];
let ratingSelections = {};
let pendingReviewOrder = null;

// Auto-refresh all data every 5 seconds to keep multiple tabs in sync
let _lastOrderStatuses = {};
let _customerRefreshing = false;
function refreshAllData() {
  if (!getToken()) { location.href = '../html/index.html'; return; }
  if (_customerRefreshing) return;
  _customerRefreshing = true;
  Promise.all([loadOrderHistory(true), loadMyReviews()])
    .finally(() => { _customerRefreshing = false; });
}

document.addEventListener('DOMContentLoaded', () => {
  checkDriverAvailability();
  loadMenu();
  loadOrderHistory();
  loadMyReviews();
  loadProfileForm();
  
  const savedTab = sessionStorage.getItem('customerActiveTab') || 'menu';
  const btn = Array.from(document.querySelectorAll('.nav-tab')).find(b => {
    const onclickAttr = b.getAttribute('onclick') || '';
    return onclickAttr.includes(`showTab('${savedTab}'`) || onclickAttr.includes(`showTab("${savedTab}"`);
  });
  showTab(savedTab, btn || document.querySelectorAll('.nav-tab')[0]);

  setInterval(refreshAllData, 5000);
});

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  location.href = '../html/index.html';
}

function showTab(name, btn) {
  sessionStorage.setItem('customerActiveTab', name);
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'orders') loadOrderHistory();
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

function handleUnauthorized() {
  showToast('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">warning</span> Session expired. Redirecting...', 'error', 2000);
  setTimeout(() => { localStorage.clear(); location.href = '../html/index.html'; }, 2000);
}

// ── Driver availability ───────────────────────────────────────────────
let hasAvailableDriver = true;

async function checkDriverAvailability() {
  const banner = document.getElementById('driver-banner');
  const inner  = document.getElementById('driver-banner-inner');
  banner.className = 'driver-banner loading';
  try {
    const res  = await fetch(`${API}/products/driver-availability`);
    const data = await res.json();
    hasAvailableDriver = !!data.has_available_driver;

    if (data.total_drivers === 0) {
      banner.className = 'driver-banner busy';
      inner.innerHTML  = `<span><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">warning</span></span><span>No drivers registered. Please select <strong>Pick Up</strong>.</span>`;
    } else if (data.has_available_driver) {
      banner.className = 'driver-banner ok';
      inner.innerHTML  = `<span><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span></span><span><strong>${data.available_count} driver${data.available_count>1?'s':''} available</strong></span>`;
    } else {
      banner.className = 'driver-banner busy';
      inner.innerHTML  = `<span><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">error</span></span><span>All drivers busy. Est. wait: ~${data.est_wait_minutes||30} min. Or select <strong>Pick Up</strong>.</span>`;
    }
  } catch (err) {
    banner.className = 'driver-banner busy';
    inner.innerHTML  = `<span><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">warning</span></span><span>Could not check driver availability.</span>`;
    hasAvailableDriver = false;
  }
  updatePaymentOptionsUI();
}

function updatePaymentOptionsUI() {
  const codRadio = document.querySelector('input[name="payment"][value="cod"]');
  const onlineRadio = document.querySelector('input[name="payment"][value="online"]');
  const pickupRadio = document.querySelector('input[name="payment"][value="pickup"]');

  if (!codRadio || !onlineRadio || !pickupRadio) return;

  if (!hasAvailableDriver) {
    // Disable delivery payment options
    codRadio.disabled = true;
    onlineRadio.disabled = true;
    
    // Add visual class to the parent labels to show they are disabled
    codRadio.closest('.pay-opt')?.classList.add('disabled-opt');
    onlineRadio.closest('.pay-opt')?.classList.add('disabled-opt');

    // Force "Pick Up" selection if a delivery option was selected
    const selectedPay = document.querySelector('input[name="payment"]:checked')?.value;
    if (selectedPay && selectedPay !== 'pickup') {
      pickupRadio.checked = true;
      onPaymentChange(pickupRadio);
      showToast('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">info</span> All drivers are busy. Payment method switched to Pick Up.', 'info', 4000);
    }
  } else {
    // Enable them back
    codRadio.disabled = false;
    onlineRadio.disabled = false;
    codRadio.closest('.pay-opt')?.classList.remove('disabled-opt');
    onlineRadio.closest('.pay-opt')?.classList.remove('disabled-opt');
  }
}

// ── Load menu ─────────────────────────────────────────────────────────
async function loadMenu() {
  const grid = document.getElementById('menu-grid');
  try {
    const res  = await fetch(`${API}/products/`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
    const data = await res.json();
    if (!res.ok) { if (res.status === 401) { handleUnauthorized(); return; } return; }
    menuProducts = data.products;
    renderMenu(menuProducts);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><p style="color:var(--red)">Cannot connect to server.</p></div>`;
  }
}

function renderMenu(products) {
  const grid = document.getElementById('menu-grid');
  if (!products.length) {
    grid.innerHTML = `<div class="empty-state"><span class="empty-icon"></span><div class="empty-title">No items yet</div></div>`;
    return;
  }

  const ALL_CATEGORIES = ['Rice Meals', 'Snacks', 'Drinks', 'Desserts', 'Soups', 'Pasta', 'Others'];
  
  const filterBar = `
    <div id="category-filter" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px">
      <button class="cat-btn active" onclick="filterByCategory('',this)">All</button>
      ${ALL_CATEGORIES.map(c=>`<button class="cat-btn" onclick="filterByCategory('${c}',this)">${c}</button>`).join('')}
    </div>`;

  let html = filterBar;

  // We will group by the categories present in the products, plus 'Other Items'
  const presentCategories = [...new Set(products.map(p => p.category).filter(Boolean))];
  
  if (presentCategories.length > 0) {
      presentCategories.forEach(cat => {
          const catProducts = products.filter(p => p.category === cat);
          if (catProducts.length === 0) return;
          const cards = catProducts.map(p => buildMenuCardHtml(p)).join('');
          
          html += `
          <div class="category-section" data-category="${cat}" style="margin-bottom: 40px;">
            <h2 style="font-family: var(--font-head); font-size: 20px; color: var(--dark); margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid rgba(255, 90, 31, 0.1); display: flex; align-items: center; gap: 8px;">
               <span class="material-symbols-rounded" style="color: var(--orange)">restaurant_menu</span> ${cat}
            </h2>
            <div class="menu-cards-grid">${cards}</div>
          </div>`;
      });
  }
  
  // Render uncategorized products (this is crucial if their DB has no categories)
  const noCatProducts = products.filter(p => !p.category);
  if (noCatProducts.length > 0) {
      const cards = noCatProducts.map(p => buildMenuCardHtml(p)).join('');
      html += `
      <div class="category-section" data-category="uncategorized" style="margin-bottom: 40px;">
        <h2 style="font-family: var(--font-head); font-size: 20px; color: var(--dark); margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid rgba(255, 90, 31, 0.1);">Other Items</h2>
        <div class="menu-cards-grid">${cards}</div>
      </div>`;
  }
  
  grid.innerHTML = html;

}

function buildMenuCardHtml(p) {
    const isOOS = p.quantity <= 0;
    const isLow = p.quantity > 0 && p.quantity <= 5;
    const qtyText = isOOS ? 'Sold Out' : isLow ? `Only ${p.quantity} left!` : `${p.quantity} available`;
    const avg = p.avg_rating || 0;
    const stars = buildStarsDisplay(avg);
    return `
      <div class="menu-card${isOOS?' out-of-stock':''}" data-category="${p.category||''}">
        <div class="menu-card-img">
          ${p.image_url?`<img src="${assetUrl(p.image_url)}" alt="${p.name}">`:''}
        </div>
        <div class="menu-card-body">
          ${p.category?`<span style="font-size:11px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.05em">${p.category}</span>`:''}
          <div class="menu-card-name">${p.name}</div>
          ${p.description?`<p style="font-size:12px;color:var(--gray);margin:4px 0 6px;line-height:1.45">${p.description}</p>`:''}
          <div class="menu-card-meta">
            <span class="menu-card-price">₱${parseFloat(p.price).toFixed(2)}</span>
            <span class="menu-card-qty${isLow?' low':''}">${qtyText}</span>
          </div>
          <div class="menu-card-rating">
            <span class="stars-display">${stars}</span>
            <span class="rating-count">${avg>0?`${avg} (${p.review_count})`:'No reviews'}</span>
          </div>
          <div class="menu-card-actions">
            ${isOOS
              ? `<div class="sold-out-label">Sold Out</div>`
              : `<button class="add-btn" onclick="addToCart(${p.id},\'${p.name.replace(/\'/g,"\\'")}\',${p.price},${p.quantity},\'${p.image_url||''}\')">+ Add to Order</button>`}
            ${p.review_count>0
              ? `<button class="reviews-btn" onclick="viewProductReviews(${p.id},\'${p.name.replace(/\'/g,"\\'")}\')">${p.review_count}</button>`
              : ''}
          </div>
        </div>
      </div>`;
}

let _activeCat = '';
function filterByCategory(cat, btn) {
  _activeCat = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  
  document.querySelectorAll('.category-section').forEach(section => {
    const c = section.dataset.category || '';
    if (cat === '') {
      section.style.display = 'block';
    } else {
      section.style.display = (c === cat) ? 'block' : 'none';
    }
  });
}

function buildStarsDisplay(avg) {
  let s = '';
  for (let i=1;i<=5;i++) s += i<=Math.round(avg)?'★':'☆';
  return s;
}

function filterMenu(query) {
  const q = query.trim().toLowerCase();
  
  // If there are category sections, filter within them
  const sections = document.querySelectorAll('.category-section');
  if (sections.length > 0) {
      sections.forEach(section => {
        let hasVisibleCards = false;
        section.querySelectorAll('.menu-card').forEach(card => {
          const name = card.querySelector('.menu-card-name')?.textContent.toLowerCase()||'';
          const isMatch = q==='' || name.includes(q);
          card.classList.toggle('hidden', !isMatch);
          if (isMatch) hasVisibleCards = true;
        });
        
        if (q !== '') {
            section.style.display = hasVisibleCards ? 'block' : 'none';
        } else {
            const c = section.dataset.category || '';
            if (_activeCat === '') section.style.display = 'block';
            else section.style.display = (c === _activeCat) ? 'block' : 'none';
        }
      });
  } else {
      // Fallback for flat grid (just in case)
      document.querySelectorAll('.menu-card').forEach(card => {
        const name = card.querySelector('.menu-card-name')?.textContent.toLowerCase()||'';
        card.classList.toggle('hidden', q!==''&&!name.includes(q));
      });
  }
}

// ── Cart ──────────────────────────────────────────────────────────────
function addToCart(productId, name, price, stock, imageUrl) {
  const existing = cart.find(i => i.product_id === productId);
  if (existing) {
    if (existing.quantity >= stock) { showToast(`<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">warning</span> Only ${stock} available!`, 'error'); return; }
    existing.quantity++;
  } else {
    cart.push({ product_id:productId, name, price:parseFloat(price), quantity:1, stock, image_url:imageUrl });
  }
  updateCartUI(); openCart();
  showToast(`"${name}" added!`, 'success', 1500);
}

function changeQty(productId, delta) {
  const idx = cart.findIndex(i => i.product_id === productId);
  if (idx===-1) return;
  const item = cart[idx];
  const newQty = item.quantity + delta;
  if (newQty <= 0) { const n=item.name; cart.splice(idx,1); showToast(`<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">delete</span> "${n}" removed`,'info',1500); }
  else if (delta>0&&newQty>item.stock) { showToast(`<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">warning</span> Only ${item.stock} available!`,'error'); return; }
  else item.quantity = newQty;
  updateCartUI();
}

function openCart() { document.getElementById('cart-sidebar').classList.add('open'); document.getElementById('cart-overlay').classList.add('open'); }
function toggleCart() { document.getElementById('cart-sidebar').classList.toggle('open'); document.getElementById('cart-overlay').classList.toggle('open'); }

function updateCartUI() {
  const cartBody   = document.getElementById('cart-items');
  const footer     = document.getElementById('cart-footer');
  const fab        = document.getElementById('cart-fab');
  const countEl    = document.getElementById('cart-count');
  const countLabel = document.getElementById('cart-item-count');
  const fabTotal   = document.getElementById('fab-total');
  const subtotal   = cart.reduce((s,i)=>s+i.price*i.quantity,0);
  const totalCount = cart.reduce((s,i)=>s+i.quantity,0);
  countEl.textContent  = totalCount;
  fabTotal.textContent = `₱${subtotal.toFixed(2)}`;
  if (countLabel) countLabel.textContent = `${totalCount} item${totalCount!==1?'s':''}`;

  if (!cart.length) {
    cartBody.innerHTML = `<div class="cart-empty-state"><div class="cart-empty-icon"></div><div class="cart-empty-title">Cart is empty</div><p class="cart-empty-sub">Add items from the menu</p></div>`;
    footer.style.display='none'; fab.style.display='none'; return;
  }
  fab.style.display='flex'; footer.style.display='block';
  cartBody.innerHTML = cart.map(item=>`
    <div class="cart-item">
      <div class="cart-item-img">${item.image_url?`<img src="${assetUrl(item.image_url)}" alt="${item.name}">`:''}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">₱${(item.price*item.quantity).toFixed(2)}${item.quantity>1?`<span style="color:var(--gray);font-weight:400;font-size:12px"> (₱${item.price.toFixed(2)} each)</span>`:''}</div>
      </div>
      <div class="cart-item-qty">
        <button class="qty-btn" onclick="changeQty(${item.product_id},-1)">−</button>
        <span class="qty-num">${item.quantity}</span>
        <button class="qty-btn" onclick="changeQty(${item.product_id},1)" ${item.quantity>=item.stock?'disabled':''}>+</button>
      </div>
    </div>`).join('');
  updateSummary(subtotal);
}

function updateSummary(subtotal) {
  const isPickup = document.querySelector('input[name="payment"]:checked')?.value==='pickup';
  const riderFee = isPickup?0:RIDER_FEE;
  document.getElementById('s-subtotal').textContent  = `₱${subtotal.toFixed(2)}`;
  document.getElementById('s-rider-fee').textContent = riderFee===0?'Free (Pick Up)':`₱${riderFee.toFixed(2)}`;
  document.getElementById('s-total').textContent     = `₱${(subtotal+riderFee).toFixed(2)}`;
}

function onPaymentChange(radio) {
  document.getElementById('online-sub').style.display = radio.value==='online'?'block':'none';
  updateSummary(cart.reduce((s,i)=>s+i.price*i.quantity,0));
}

// ── Place order ───────────────────────────────────────────────────────
async function placeOrder() {
  if (!cart.length) { showToast('Cart is empty!','error'); return; }
  const payRadio = document.querySelector('input[name="payment"]:checked');
  if (!payRadio)  { showToast('Select a payment method.','error'); return; }
  let paymentMethod = payRadio.value;
  if (paymentMethod==='online') {
    const onlineRadio = document.querySelector('input[name="online_method"]:checked');
    if (!onlineRadio) { showToast('Select GCash or PayMaya.','error'); return; }
    paymentMethod = onlineRadio.value;
  }

  if (paymentMethod !== 'pickup' && !hasAvailableDriver) {
    showToast('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">warning</span> No drivers available at the moment. Please select Pick Up.', 'error', 4000);
    return;
  }

  const user  = JSON.parse(localStorage.getItem('user')||'{}');
  const notes = document.getElementById('order-note')?.value.trim()||'';
  const payload = {
    payment_method: paymentMethod,
    delivery_address: user?.address||'',
    notes,
    items: cart.map(i=>({product_id:i.product_id,quantity:i.quantity}))
  };
  const btn=document.getElementById('place-order-btn');
  const label=document.getElementById('place-order-label');
  const arrow=document.getElementById('place-order-arrow');
  btn.disabled=true; label.textContent='Placing Order...'; arrow.innerHTML='<span class="material-symbols-rounded" style="font-size:18px;">hourglass_top</span>';
  try {
    const res  = await fetch(`${API}/orders/`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${getToken()}`},body:JSON.stringify(payload)});
    const data = await res.json();
    if (!res.ok) { if (res.status===401){handleUnauthorized();return;} showToast(`<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> ${data.error||'Order failed.'}`, 'error',4000); return; }
    toggleCart(); showReceipt(data.order);
    cart=[]; updateCartUI();
    if (document.getElementById('order-note')) document.getElementById('order-note').value='';
    document.querySelectorAll('input[name="payment"]').forEach(r=>r.checked=false);
    document.querySelectorAll('input[name="online_method"]').forEach(r=>r.checked=false);
    document.getElementById('online-sub').style.display='none';
    loadMenu(); loadOrderHistory();
  } catch (err) { showToast('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> Cannot connect.','error'); }
  finally { btn.disabled=false; label.textContent='Place Order'; arrow.textContent='→'; }
}

// ── Receipt ───────────────────────────────────────────────────────────
function showReceipt(order) {
  const overlay  = document.getElementById('receipt-overlay');
  const body     = document.getElementById('receipt-body');
  const refEl    = document.getElementById('receipt-ref');
  const isOnline = ['gcash','paymaya'].includes(order.payment_method);
  const isPickup = order.payment_method === 'pickup';
  refEl.textContent = order.reference_no ? `Ref: ${order.reference_no}` : '';
  const payLabel = {gcash:'GCash',paymaya:'PayMaya',cod:'Cash on Delivery',pickup:'Pick Up'}[order.payment_method]||order.payment_method;
  body.innerHTML = `
    ${isOnline?`<div class="receipt-ref-box"><p>Reference No.</p><strong>${order.reference_no}</strong><p style="margin-top:6px;font-size:11px;color:var(--gray)">Show to rider on delivery</p></div>`:''}
    <div class="receipt-section">
      <div class="receipt-section-title">Order #${order.id}</div>
      ${order.items.map(i=>`<div class="receipt-row"><span>${i.product_name} × ${i.quantity}</span><span>₱${(i.price_at_order*i.quantity).toFixed(2)}</span></div>`).join('')}
    </div>
    <div class="receipt-section">
      <div class="receipt-section-title">Charges</div>
      <div class="receipt-row"><span>Subtotal</span><span>₱${parseFloat(order.subtotal).toFixed(2)}</span></div>
      <div class="receipt-row"><span>Rider Fee</span><span>${parseFloat(order.rider_fee)===0?'Free (Pick Up)':`₱${parseFloat(order.rider_fee).toFixed(2)}`}</span></div>
      <div class="receipt-total-row"><span>Total</span><span>₱${parseFloat(order.total_amount).toFixed(2)}</span></div>
    </div>
    <div class="receipt-section">
      <div class="receipt-section-title">Details</div>
      <div class="receipt-row"><span>Customer Name</span><span>${order.customer_name || 'Customer'}</span></div>
      <div class="receipt-row"><span>Seller / Carinderia</span><span>${order.seller_name || 'Store'}</span></div>
      ${order.seller_phone?`<div class="receipt-row"><span>Seller Contact</span><span>${order.seller_phone}</span></div>`:''}
      ${order.driver_name?`<div class="receipt-row"><span>Rider / Driver</span><span>${order.driver_name}</span></div>`:''}
      ${order.driver_phone?`<div class="receipt-row"><span>Rider Contact</span><span>${order.driver_phone}</span></div>`:''}
      <div class="receipt-row"><span>Payment</span><span>${payLabel}</span></div>
      <div class="receipt-row"><span>Est. Time</span><span>~${order.est_delivery_min} min</span></div>
      ${order.notes?`<div class="receipt-row"><span>Note</span><span>${order.notes}</span></div>`:''}
    </div>
    ${isPickup?`<div style="background:rgba(255,107,43,0.08);border-radius:10px;padding:14px;text-align:center;font-size:14px;color:var(--orange);font-weight:600">Pick Up Order — We'll notify you when your food is ready!</div>`:''}`;
  overlay.style.display = 'flex';
}

function closeReceipt() {
  document.getElementById('receipt-overlay').style.display = 'none';
  showTab('orders', document.querySelectorAll('.nav-tab')[1]);
}

// ── Order History ─────────────────────────────────────────────────────

// ── Confirm Receipt ───────────────────────────────────────────────────
async function confirmReceipt(orderId) {
  const btn = document.getElementById(`confirm-btn-${orderId}`);
  if (btn) { btn.disabled=true; btn.innerHTML='<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">hourglass_top</span> Confirming...'; }

  try {
    const res  = await fetch(`${API}/orders/${orderId}/status`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${getToken()}`},
      body: JSON.stringify({ status:'customer_confirmed' })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(`<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> ${data.error||'Failed.'}`, 'error');
      if (btn) { btn.disabled=false; btn.innerHTML='<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Confirm Receipt'; }
      return;
    }

    showToast('Order confirmed! Thank you for using Hi Te!!', 'success', 4000);
    loadOrderHistory();

  } catch (err) {
    showToast('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> Cannot connect.','error');
    if (btn) { btn.disabled=false; btn.innerHTML='<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Confirm Receipt'; }
  }
}

// ── Load my reviews ───────────────────────────────────────────────────
async function loadMyReviews() {
  try {
    const res  = await fetch(`${API}/reviews/my-reviews`,{headers:{'Authorization':`Bearer ${getToken()}`}});
    if (!res.ok) return;
    const data = await res.json();
    myReviewed = data.reviewed||[];
  } catch (err) { console.error(err); }
}

// ── Review modal ──────────────────────────────────────────────────────
async function openReviewModal(orderId) {
  pendingReviewOrder = orderId; ratingSelections = {};
  try {
    const res  = await fetch(`${API}/orders/my-orders`,{headers:{'Authorization':`Bearer ${getToken()}`}});
    const data = await res.json();
    if (!res.ok) return;
    const order = data.orders.find(o=>o.id===orderId);
    if (!order) return;
    const listEl = document.getElementById('review-items-list');
    listEl.innerHTML = order.items.map(item => {
      const already = myReviewed.some(r=>r.product_id===item.product_id&&r.order_id===orderId);
      const key = `${orderId}-${item.product_id}`;
      return `
        <div class="review-item">
          <div class="review-item-name">${item.product_name}</div>
          ${already
            ?`<div class="already-reviewed"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Already reviewed!</div>`
            :`<div class="star-rating" id="stars-${key}">
                ${[1,2,3,4,5].map(n=>`<button class="star-btn" data-value="${n}"
                  onmouseenter="hoverStars('${key}',${n})"
                  onmouseleave="resetStarHover('${key}')"
                  onclick="selectStar('${key}',${n},${item.product_id})">★</button>`).join('')}
              </div>
              <p id="star-label-${key}" style="font-size:12px;color:var(--gray);margin-bottom:8px">Click a star to rate</p>
              <textarea class="review-textarea" id="comment-${key}" placeholder="Share your experience..." maxlength="500" oninput="updateCharCount('${key}',this.value)"></textarea>
              <div class="review-char-count" id="char-${key}">0 / 500</div>`}
        </div>`;
    }).join('');
    document.getElementById('review-overlay').style.display = 'flex';
  } catch (err) { showToast('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> Could not load.','error'); }
}

const starLabels = ['','Poor','Fair','Good','Great','Excellent!'];

function hoverStars(key,value) {
  document.querySelectorAll(`#stars-${key} .star-btn`).forEach(btn=>{
    btn.classList.toggle('active',parseInt(btn.dataset.value)<=value);
  });
}
function resetStarHover(key) {
  const selected = ratingSelections[key]?.rating||0;
  document.querySelectorAll(`#stars-${key} .star-btn`).forEach(btn=>{
    btn.classList.toggle('active',parseInt(btn.dataset.value)<=selected);
  });
}
function selectStar(key,value,productId) {
  ratingSelections[key] = {rating:value,product_id:productId};
  document.querySelectorAll(`#stars-${key} .star-btn`).forEach(btn=>{
    btn.classList.toggle('active',parseInt(btn.dataset.value)<=value);
  });
  const lbl = document.getElementById(`star-label-${key}`);
  if (lbl) { lbl.textContent=starLabels[value]; lbl.style.color='var(--orange)'; lbl.style.fontWeight='600'; }
}
function updateCharCount(key,value) {
  const el = document.getElementById(`char-${key}`);
  if (el) { el.textContent=`${value.length} / 500`; el.style.color=value.length>450?'var(--red)':'var(--gray)'; }
}
function closeReviewModal() { document.getElementById('review-overlay').style.display='none'; pendingReviewOrder=null; ratingSelections={}; }

async function submitAllReviews() {
  const orderId = pendingReviewOrder;
  if (!orderId) return;
  const toSubmit = Object.entries(ratingSelections).map(([key,sel])=>({
    product_id:sel.product_id, order_id:orderId, rating:sel.rating,
    comment:(document.getElementById(`comment-${key}`)?.value||'').trim()
  }));
  if (!toSubmit.length) { showToast('Rate at least one item.','error'); return; }
  const btn = document.getElementById('submit-reviews-btn');
  btn.disabled=true; btn.textContent='Submitting...';
  let ok=0, fail=0;
  for (const review of toSubmit) {
    try {
      const res = await fetch(`${API}/reviews/`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${getToken()}`},body:JSON.stringify(review)});
      res.ok ? ok++ : fail++;
    } catch { fail++; }
  }
  btn.disabled=false; btn.textContent='Submit Reviews';
  closeReviewModal();
  if (ok>0) showToast(`<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">star</span> ${ok} review${ok>1?'s':''} submitted!`,'success',3000);
  if (fail>0) showToast(`<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">warning</span> ${fail} failed.`,'error',3000);
  await loadMyReviews(); loadMenu(); loadOrderHistory();
}

async function viewProductReviews(productId, productName) {
  const overlay = document.getElementById('product-reviews-overlay');
  const title   = document.getElementById('product-reviews-title');
  const body    = document.getElementById('product-reviews-body');
  title.textContent = `Reviews for ${productName}`;
  body.innerHTML    = '<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>';
  overlay.style.display = 'flex';
  try {
    const res  = await fetch(`${API}/reviews/${productId}`);
    const data = await res.json();
    if (!res.ok||!data.reviews.length) { body.innerHTML='<p style="color:var(--gray);text-align:center;padding:30px">No reviews yet.</p>'; return; }
    body.innerHTML = `
      <div class="avg-rating-box">
        <div class="avg-rating-num">${data.avg_rating}</div>
        <div class="avg-rating-stars">${buildStarsDisplay(data.avg_rating)}</div>
        <div class="avg-rating-sub">Based on ${data.total} review${data.total!==1?'s':''}</div>
      </div>
      ${data.reviews.map(r=>`
        <div class="review-card">
          <div class="review-card-header">
            <span class="review-card-user">${r.username}</span>
            <span class="review-card-stars">${buildStarsDisplay(r.rating)}</span>
          </div>
          <div class="review-card-date">${new Date(r.created_at).toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}</div>
          ${r.comment?`<div class="review-card-comment">"${r.comment}"</div>`:`<div class="review-card-no-comment">No comment.</div>`}
        </div>`).join('')}`;
  } catch (err) { body.innerHTML='<p style="color:var(--red);text-align:center;padding:30px">Failed to load.</p>'; }
}

function closeProductReviews() { document.getElementById('product-reviews-overlay').style.display='none'; }

document.addEventListener('click',(e)=>{
  if (e.target===document.getElementById('review-overlay')) closeReviewModal();
  if (e.target===document.getElementById('product-reviews-overlay')) closeProductReviews();
  if (e.target===document.getElementById('receipt-overlay')) closeReceipt();
});

// ═══════════════════════════════════════════════════════════════════
// FEATURE 1 — Cancel Order (pending only)
// ═══════════════════════════════════════════════════════════════════
async function cancelOrder(orderId) {
  if (!confirm('Are you sure you want to cancel this order?')) return;
  try {
    const res  = await fetch(`${API}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ status: 'cancelled' })
    });
    const data = await res.json();
    if (!res.ok) { showToast(`<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> ${data.error || 'Could not cancel.'}`, 'error'); return; }
    showToast('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">block</span> Order cancelled successfully.', 'success');
    loadOrderHistory(true);
  } catch (err) { showToast('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> Network error. Please try again.', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE 2 — Print Receipt
// ═══════════════════════════════════════════════════════════════════
function printReceipt() {
  const content = document.getElementById('receipt-body')?.innerHTML || '';
  const ref     = document.getElementById('receipt-ref')?.textContent || '';
  const win = window.open('', '_blank', 'width=420,height=600');
  win.document.write(`
    <!DOCTYPE html><html><head><title>Hi Te! Receipt</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; max-width: 380px; margin: auto; }
      h2   { text-align: center; margin-bottom: 4px; }
      p    { text-align: center; color: #666; margin: 0 0 16px; }
      hr   { border: none; border-top: 1px dashed #ccc; margin: 16px 0; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      td   { padding: 4px 0; }
      td:last-child { text-align: right; font-weight: 600; }
      .total { font-size: 15px; font-weight: 700; }
      .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #999; }
    </style></head><body>
    <h2>Hi Te!</h2>
    <p>${ref}</p>
    <hr>
    ${content}
    <hr>
    <p class="footer">Thank you for ordering! — Hi Te!</p>
    <script>window.onload=()=>{window.print();window.close();}<\/script>
    </body></html>`);
  win.document.close();
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE 3 — Status Change Notifications (toast on auto-refresh)
// ═══════════════════════════════════════════════════════════════════
const STATUS_MESSAGES = {
  confirmed:          '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Your order was confirmed by the seller!',
  preparing:          '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">skillet</span> The seller is now preparing your food!',
  ready_for_pickup:   '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">inventory_2</span> Food is ready — driver will pick it up soon!',
  picked_up:          '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">two_wheeler</span> Driver has picked up your order!',
  out_for_delivery:   '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">local_shipping</span> Your food is on the way!',
  delivered:          '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">mark_email_read</span> Your order was delivered. Please confirm receipt!',
  ready_to_collect:   '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">notifications</span> Your food is ready for pickup at the store!',
  customer_confirmed: 'Order complete! Thank you for using Hi Te!!',
  cancelled:          '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">block</span> Your order has been cancelled.',
};

async function loadOrderHistory(silent = false) {
  const container = document.getElementById('order-history');
  if (!silent) container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading orders...</p></div>`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res  = await fetch(`${API}/orders/my-orders`, {
      headers: { 'Authorization': `Bearer ${getToken()}` },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok) { if (res.status === 401) { handleUnauthorized(); return; } return; }

    // ── Detect status changes and show toast notifications ──────────
    if (silent && data.orders) {
      data.orders.forEach(order => {
        const prev = _lastOrderStatuses[order.id];
        if (prev && prev !== order.status && STATUS_MESSAGES[order.status]) {
          showToast(`Order #${order.id}: ${STATUS_MESSAGES[order.status]}`, 'info', 5000);
        }
        _lastOrderStatuses[order.id] = order.status;
      });
    } else if (data.orders) {
      data.orders.forEach(o => { _lastOrderStatuses[o.id] = o.status; });
    }

    if (!data.orders.length) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon"></span><div class="empty-title">No orders yet</div><p class="empty-sub">Order something delicious!</p></div>`;
      return;
    }

    const payLabel = (m) => ({ gcash:'GCash', paymaya:'PayMaya', cod:'Cash on Delivery', pickup:'Pick Up' }[m] || m);
    const deliverySteps = [
      { key:'pending', label:'Placed' }, { key:'confirmed', label:'Confirmed' },
      { key:'preparing', label:'Preparing' }, { key:'ready_for_pickup', label:'Ready' },
      { key:'picked_up', label:'Picked Up' }, { key:'out_for_delivery', label:'On the Way' },
      { key:'delivered', label:'Delivered' }, { key:'customer_confirmed', label:'Received' },
    ];
    const pickupSteps = [
      { key:'pending', label:'Placed' }, { key:'confirmed', label:'Confirmed' },
      { key:'preparing', label:'Preparing' }, { key:'ready_to_collect', label:'Ready!' },
      { key:'customer_confirmed', label:'Collected' },
    ];

    container.innerHTML = data.orders.map(order => {
      const isPickup    = order.payment_method === 'pickup';
      const isCancelled = order.status === 'cancelled';
      const steps       = isPickup ? pickupSteps : deliverySteps;
      const statusOrder = steps.map(s => s.key);
      const currentIdx  = statusOrder.indexOf(order.status);

      const showCountdown = isPickup && ['confirmed','preparing'].includes(order.status) && order.est_delivery_min > 0;

      const progressHtml = isCancelled
        ? `<div style="background:rgba(231,76,60,0.08);padding:10px 14px;border-radius:8px;color:var(--red);font-size:13px;font-weight:600;margin-bottom:14px"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> Order Cancelled</div>`
        : `<div class="status-progress">
            ${steps.map((step, i) => {
              const isDone   = currentIdx > i;
              const isActive = currentIdx === i;
              return `${i>0?`<div class="status-line${isDone?' done':''}"></div>`:''}
                <div class="status-step${isDone?' done':isActive?' active':''}">
                  <div class="status-step-dot">${isDone?'✓':i+1}</div>
                  <div class="status-step-label">${step.label}</div>
                </div>`;
            }).join('')}
           </div>`;

      const notificationHtml = (() => {
        if (isPickup && order.status === 'ready_to_collect')
          return `<div class="order-notification success"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">notifications</span> <strong>Your food is ready!</strong> Please come to pick it up.</div>`;
        if (!isPickup && order.status === 'out_for_delivery')
          return `<div class="order-notification info"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">local_shipping</span> <strong>Your food is on the way!</strong> Est. ~${order.est_delivery_min} min</div>`;
        if (!isPickup && order.status === 'picked_up')
          return `<div class="order-notification info"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">two_wheeler</span> Driver has picked up your order!</div>`;
        if (order.status === 'delivered')
          return `<div class="order-notification warning"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">inventory_2</span> Your order was delivered. Please confirm receipt!</div>`;
        if (order.status === 'customer_confirmed')
          return `<div class="order-notification success"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Order complete! Thank you for using Hi Te!.</div>`;
        return '';
      })();

      // Seller note display
      const sellerNoteHtml = order.seller_note
        ? `<div style="background:#fffbe6;border:1px solid #ffe58f;border-radius:8px;padding:10px 14px;margin:10px 0;font-size:13px">
             <span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">chat</span> <strong>Message from seller:</strong> ${order.seller_note}
           </div>` : '';

      const actionHtml = (() => {
        if (isCancelled) return '';
        if (order.status === 'pending')
          return `<button class="cancel-order-btn" onclick="cancelOrder(${order.id})"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">block</span> Cancel Order</button>`;
        if (isPickup && order.status === 'ready_to_collect')
          return `<button class="confirm-receipt-btn" id="confirm-btn-${order.id}" onclick="confirmReceipt(${order.id})"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> I've Picked Up My Order</button>`;
        if (!isPickup && order.status === 'delivered')
          return `<button class="confirm-receipt-btn" id="confirm-btn-${order.id}" onclick="confirmReceipt(${order.id})"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> I Received My Order — Confirm Delivery</button>`;
        return '';
      })();

      const canReview  = order.status === 'customer_confirmed';
      const allReviewed = canReview && order.items.every(item =>
        myReviewed.some(r => r.product_id === item.product_id && r.order_id === order.id)
      );

      return `
        <div class="order-card">
          <div class="order-card-header">
            <span class="order-card-id">Order #${order.id}</span>
            <div style="display:flex;gap:8px;align-items:center">
              ${isPickup?'<span class="pickup-chip">Pick Up</span>':'<span class="delivery-chip"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">local_shipping</span> Delivery</span>'}
              <span class="badge badge-${order.status}">${order.status.replace(/_/g,' ')}</span>
            </div>
          </div>
          ${progressHtml}
          ${notificationHtml}
          ${sellerNoteHtml}
          ${showCountdown?`<div class="countdown-box"><span><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">timer</span> Est. prep time: </span><strong>${order.est_delivery_min} min</strong></div>`:''}
          <p class="order-card-items">${order.items.map(i=>`${i.product_name} ×${i.quantity}`).join(', ')}</p>
          <div class="order-card-meta">
            <span>Customer Name: <strong>${order.customer_name || 'Customer'}</strong></span>
            <span>Store Name: <strong>${order.seller_name || 'Carinderia'}</strong></span>
            ${order.driver_name ? `<span>Rider: <strong>${order.driver_name}</strong> ${order.driver_phone ? `· ${order.driver_phone}` : ''}</span>` : ''}
            <span>Subtotal: ₱${parseFloat(order.subtotal).toFixed(2)}</span>
            <span>Rider: ${parseFloat(order.rider_fee)===0?'Free':`₱${parseFloat(order.rider_fee).toFixed(2)}`}</span>
            <span>Total: ₱${parseFloat(order.total_amount).toFixed(2)}</span>
            <span>${payLabel(order.payment_method)}</span>
            ${order.reference_no?`<span>Ref: <strong>${order.reference_no}</strong></span>`:''}
            <span><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">schedule</span> ${new Date(order.created_at).toLocaleString()}</span>
          </div>
          ${actionHtml}
          ${canReview&&!allReviewed?`<button class="review-order-btn" onclick="openReviewModal(${order.id})">Rate This Order</button>`:''}
          ${canReview&&allReviewed?`<p style="font-size:13px;color:var(--green-dk);font-weight:600"><span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> You've reviewed all items</p>`:''}
        </div>`;
    }).join('');
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return;
    console.error('loadOrderHistory error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE 4 — Edit Profile + Change Password
// ═══════════════════════════════════════════════════════════════════
async function loadProfileForm() {
  try {
    const res  = await fetch(`${API}/auth/me`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
    const data = await res.json();
    if (!res.ok) return;
    const u = data.user;
    document.getElementById('profile-name').value    = u.full_name  || '';
    document.getElementById('profile-email').value   = u.email      || '';
    document.getElementById('profile-phone').value   = u.phone      || '';
    document.getElementById('profile-address').value = u.address    || '';
  } catch (err) { console.error('loadProfileForm error:', err); }
}

async function saveProfile() {
  const msg = document.getElementById('profile-msg');
  msg.style.color = 'var(--gray)';
  msg.textContent = 'Saving...';
  try {
    const res  = await fetch(`${API}/auth/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({
        full_name: document.getElementById('profile-name').value.trim(),
        email:     document.getElementById('profile-email').value.trim(),
        phone:     document.getElementById('profile-phone').value.trim(),
        address:   document.getElementById('profile-address').value.trim(),
      })
    });
    const data = await res.json();
    if (!res.ok) { msg.style.color = 'var(--red)'; msg.innerHTML = `<span class="material-symbols-rounded"...>cancel</span> ${data.error}`; return; }
    msg.style.color = 'var(--green-dk)';
    msg.innerHTML = '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Profile updated successfully!';
    showToast('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Profile saved!', 'success');
    // Update stored user
    const stored = JSON.parse(localStorage.getItem('user') || '{}');
    localStorage.setItem('user', JSON.stringify({ ...stored, ...data.user }));
  } catch (err) { msg.style.color = 'var(--red)'; msg.innerHTML = '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> Network error.'; }
}

async function changePassword() {
  const msg    = document.getElementById('pw-msg');
  const oldPw  = document.getElementById('pw-old').value;
  const newPw  = document.getElementById('pw-new').value;
  if (!oldPw || !newPw) { msg.style.color='var(--red)'; msg.textContent='Please fill in both fields.'; return; }
  msg.style.color = 'var(--gray)'; msg.textContent = 'Changing...';
  try {
    const res  = await fetch(`${API}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ old_password: oldPw, new_password: newPw })
    });
    const data = await res.json();
    if (!res.ok) { msg.style.color='var(--red)'; msg.innerHTML=`<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> ${data.error}`; return; }
    msg.style.color = 'var(--green-dk)';
    msg.innerHTML = '<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Password changed!';
    document.getElementById('pw-old').value = '';
    document.getElementById('pw-new').value = '';
    showToast('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">key</span> Password changed successfully!', 'success');
  } catch (err) { msg.style.color='var(--red)'; msg.innerHTML='<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">cancel</span> Network error.'; }
}

// Password visibility toggle
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type     = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden ? '<span class="material-symbols-rounded" style="font-size:20px;">visibility_off</span>' : '<span class="material-symbols-rounded" style="font-size:20px;">visibility</span>';
}
