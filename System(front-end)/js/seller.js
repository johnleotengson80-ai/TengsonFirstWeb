const API   = window.API_BASE_URL;
const getToken = () => localStorage.getItem('token');
const getUser  = () => JSON.parse(localStorage.getItem('user') || '{}');
if (!getToken()) location.href = '../html/index.html';

let products  = [];
let orders    = [];
let editingId = null;
let deletingId = null;

let _sellerRefreshing = false;
const MAX_EMBEDDED_IMAGE_BYTES = 280 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const PRODUCT_IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;

function compressProductImage(file) {
  if (!file || file.size <= MAX_EMBEDDED_IMAGE_BYTES) return Promise.resolve(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) { reject(new Error('Image compression is unavailable in this browser.')); return; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let quality = 0.86;
      const attempt = () => canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not process this image.')); return; }
        if (blob.size <= MAX_EMBEDDED_IMAGE_BYTES || quality <= 0.5) {
          if (blob.size > MAX_EMBEDDED_IMAGE_BYTES) {
            reject(new Error('This image is still too large after compression. Please choose a smaller image.'));
            return;
          }
          resolve(new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' }));
          return;
        }
        quality -= 0.1;
        attempt();
      }, 'image/jpeg', quality);
      attempt();
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not read this image.')); };
    image.src = objectUrl;
  });
}

function refreshAllData() {
  if (!getToken()) { location.href = '../html/index.html'; return; }
  if (_sellerRefreshing) return;
  _sellerRefreshing = true;
  Promise.all([loadOrders(true), loadProducts(true)])
    .finally(() => { _sellerRefreshing = false; });
}

document.addEventListener('DOMContentLoaded', () => {
  loadOrders();
  loadProducts();
  setupUpload();
  setInterval(refreshAllData, 5000);
});

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  location.href = '../html/index.html';
}

// showTab defined below (merged version)

// ── Toast ─────────────────────────────────────────────────────────────
function showToast(message, type = 'success', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container           = document.createElement('div');
    container.id        = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function handleUnauthorized() {
  showToast('⚠️ Session expired. Redirecting...', 'error', 2000);

  setTimeout(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    location.href = '../html/index.html';
  }, 2000);
}

// ── Upload setup ──────────────────────────────────────────────────────
function setupUpload() {
  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('food-image');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!PRODUCT_IMAGE_EXTENSIONS.test(file.name)) {
      showToast('Use a PNG, JPG, JPEG, GIF, or WEBP image.', 'error');
      input.value = '';
      return;
    }
    if (file.size > MAX_SOURCE_IMAGE_BYTES) { showToast('Image too large. Max 20MB before compression.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('upload-placeholder').style.display = 'none';
      const prev = document.getElementById('image-preview');
      prev.style.display = 'block';
      prev.innerHTML = `<img src="${ev.target.result}" alt="preview">
        <button class="remove-preview" onclick="removePreview(event)">✕</button>`;
    };
    reader.readAsDataURL(file);
  });

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; input.dispatchEvent(new Event('change')); }
  });
}

function removePreview(e) {
  e.stopPropagation();
  document.getElementById('food-image').value = '';
  const prev = document.getElementById('image-preview');
  prev.style.display = 'none'; prev.innerHTML = '';
  document.getElementById('upload-placeholder').style.display = 'flex';
}

function filterProducts(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('.product-card').forEach(card => {
    const name = card.querySelector('.product-name')?.textContent.toLowerCase() || '';
    card.classList.toggle('hidden', q !== '' && !name.includes(q));
  });
}

// ── Load orders ───────────────────────────────────────────────────────
async function loadOrders(silent = false) {
  const container = document.getElementById('orders-container');
  if (!silent) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading orders...</p></div>';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res  = await fetch(`${API}/orders/incoming`, {
      headers: { 'Authorization': `Bearer ${getToken()}` },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok) { if (res.status === 401) { handleUnauthorized(); return; } return; }

    orders = data.orders || [];

    if (!orders.length) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-icon">📋</span>
        <div class="empty-title">No incoming orders</div>
        <p class="empty-sub">Orders from customers will appear here</p>
      </div>`; return;
    }

    const payLabel = (m) => ({ gcash:'GCash', paymaya:'PayMaya', cod:'Cash on Delivery', pickup:'Pick Up' }[m] || m);
    const isPickup = (order) => order.payment_method === 'pickup';

    // Statuses where seller still has actions
    const activeStatuses = ['pending','confirmed','preparing'];

    container.innerHTML = orders.map(order => {
      const pickup  = isPickup(order);
      const canAct  = activeStatuses.includes(order.status);
      const isDone  = ['ready_for_pickup','ready_to_collect','picked_up',
                       'out_for_delivery','delivered','customer_confirmed','cancelled'].includes(order.status);

      return `
        <div class="order-card">
          <div class="order-card-header">
            <span class="order-card-id">Order #${order.id}</span>
            <div style="display:flex;gap:8px;align-items:center">
              ${pickup ? '<span class="pickup-chip">🏃 Pick Up</span>' : '<span class="delivery-chip">🚚 Delivery</span>'}
              <span class="badge badge-${order.status}">${order.status.replace(/_/g,' ')}</span>
            </div>
          </div>

          <p class="order-card-items">🍽️ ${order.items.map(i=>`${i.product_name} × ${i.quantity}`).join(', ')}</p>

          <div class="order-amounts">
            <span>Subtotal: <strong>₱${parseFloat(order.subtotal).toFixed(2)}</strong></span>
            <span>Rider: <strong>${parseFloat(order.rider_fee)===0?'Free':`₱${parseFloat(order.rider_fee).toFixed(2)}`}</strong></span>
            <span>Total: <strong>₱${parseFloat(order.total_amount).toFixed(2)}</strong></span>
          </div>

          <div class="order-card-meta">
            <span>💳 ${payLabel(order.payment_method)}</span>
            ${order.reference_no?`<span>Ref: <strong>${order.reference_no}</strong></span>`:''}
            <span>📍 ${order.delivery_address||'No address'}</span>
            <span>🕐 ${new Date(order.created_at).toLocaleString()}</span>
            <span>⏱️ Est. ${order.est_delivery_min} min</span>
            ${order.notes?`<span>📝 Customer note: <em>${order.notes}</em></span>`:''}
            ${order.seller_note?`<span>💬 Your reply: <em>${order.seller_note}</em></span>`:''}
          </div>
          <!-- Seller reply note button -->
          <button class="action-btn" style="margin-top:8px;background:var(--border);color:var(--text)"
            onclick="openNoteModal(${order.id},'${(order.seller_note||'').replace(/'/g,"\\'")}')">
            💬 ${order.seller_note ? 'Edit Reply' : 'Reply to Customer'}
          </button>

          ${canAct ? `
          <div class="order-actions">
            ${order.status === 'pending' ? `
              <button class="action-btn confirm" onclick="updateStatus(${order.id},'confirmed')">✅ Confirm</button>
              <button class="action-btn cancel"  onclick="updateStatus(${order.id},'cancelled')">❌ Cancel</button>
            ` : ''}
            ${order.status === 'confirmed' ? `
              <button class="action-btn prepare" onclick="updateStatus(${order.id},'preparing')">🍳 Start Preparing</button>
              <button class="action-btn cancel"  onclick="updateStatus(${order.id},'cancelled')">❌ Cancel</button>
            ` : ''}
            ${order.status === 'preparing' ? `
              ${pickup
                ? `<button class="action-btn ready-pickup" onclick="updateStatus(${order.id},'ready_to_collect')">
                    🔔 Notify Customer: Ready for Pickup
                   </button>`
                : `<button class="action-btn ready-pickup" onclick="updateStatus(${order.id},'ready_for_pickup')">
                    🚚 Food is Ready — Notify Admin to Send Driver
                   </button>`
              }
            ` : ''}
          </div>
          <div class="est-input-row">
            <span>Update est. time:</span>
            <input type="number" id="est-${order.id}" value="${order.est_delivery_min}" min="1" max="300">
            <span>min</span>
            <button class="est-set-btn" onclick="setEstTime(${order.id})">Save</button>
          </div>` : ''}

          ${order.status === 'ready_for_pickup' ? `
          <div class="status-info-box info">
            🕐 Waiting for admin to assign a driver...
          </div>` : ''}

          ${order.status === 'ready_to_collect' ? `
          <div class="status-info-box success">
            🔔 Customer has been notified that their food is ready for pickup!
          </div>` : ''}

          ${order.status === 'picked_up' ? `
          <div class="status-info-box info">
            🏍️ Driver has picked up the order and is on the way!
          </div>` : ''}

          ${order.status === 'out_for_delivery' ? `
          <div class="status-info-box info">
            🚚 Order is out for delivery...
          </div>` : ''}

          ${order.status === 'delivered' ? `
          <div class="status-info-box warning">
            📦 Order delivered. Waiting for customer confirmation...
          </div>` : ''}

          ${order.status === 'customer_confirmed' ? `
          <div class="status-info-box success">
            ✅ Customer confirmed receipt! Order complete.
          </div>` : ''}

          ${order.status === 'cancelled' ? `
          <div class="status-info-box error">
            ❌ Order was cancelled.
          </div>` : ''}

        </div>`;
    }).join('');

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return;
    if (!silent) container.innerHTML = `<div class="empty-state"><p style="color:var(--red)">Cannot connect to server.</p></div>`;
    console.error(err);
  }
}

// ── Update status ─────────────────────────────────────────────────────
async function updateStatus(orderId, status) {
  try {
    const res  = await fetch(`${API}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type':'application/json','Authorization':`Bearer ${getToken()}` },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (!res.ok) { showToast(`❌ ${data.error||'Failed'}`, 'error'); return; }

    const labels = {
      confirmed:        '✅ Order confirmed!',
      preparing:        '🍳 Preparing started!',
      ready_for_pickup: '🚚 Admin notified to send driver!',
      ready_to_collect: '🔔 Customer notified — food is ready!',
      cancelled:        '❌ Order cancelled.'
    };
    showToast(labels[status] || '✅ Updated!', status==='cancelled'?'error':'success');
    loadOrders();
  } catch (err) {
    showToast('❌ Cannot connect to server.', 'error');
    console.error(err);
  }
}

// ── Set estimated time ────────────────────────────────────────────────
async function setEstTime(orderId) {
  const input = document.getElementById(`est-${orderId}`);
  if (!input) return;
  const val = parseInt(input.value, 10);
  if (isNaN(val) || val < 1) { showToast('Minimum 1 minute.', 'error'); return; }

  const btn = input.nextElementSibling;
  try {
    const res  = await fetch(`${API}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type':'application/json','Authorization':`Bearer ${getToken()}` },
      body: JSON.stringify({ est_delivery_min: val })
    });
    const data = await res.json();
    if (!res.ok) { showToast(`❌ ${data.error}`, 'error'); return; }
    const cached = orders.find(o => o.id === orderId);
    if (cached) cached.est_delivery_min = val;
    if (btn) {
      const orig = btn.textContent; btn.textContent = '✅ Saved'; btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
    }
  } catch (err) { showToast('❌ Cannot connect.', 'error'); }
}

// ── Load products ─────────────────────────────────────────────────────
async function loadProducts(silent = false) {
  const grid = document.getElementById('menu-grid');
  if (!silent) grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res  = await fetch(`${API}/products/mine`, {
      headers: { 'Authorization':`Bearer ${getToken()}` },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok) return;
    products = data.products;
    renderProducts();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return;
    console.error(err);
  }
}

function renderProducts() {
  const grid = document.getElementById('menu-grid');
  if (!products.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <span class="empty-icon">🍽️</span>
      <div class="empty-title">No products yet</div>
      <p class="empty-sub">Add your first item using the ➕ Add Item tab</p>
    </div>`; return;
  }
  grid.innerHTML = products.map(p => {
    const isOut  = p.quantity <= 0;
    const isLow  = p.quantity > 0 && p.quantity <= 5;
    const qtyLbl = isOut ? 'Out of Stock' : isLow ? `Low: ${p.quantity}` : `Qty: ${p.quantity}`;
    const qtyCls = isOut ? 'out' : isLow ? 'low' : '';
    return `
      <div class="product-card${isOut?' unavailable':''}">
        <div class="product-img">
          ${p.image_url?`<img src="${assetUrl(p.image_url)}" alt="${p.name}">`:'🍽️'}
          ${isOut?`<span class="product-status-badge out">Sold Out</span>`:''}
          ${isLow?`<span class="product-status-badge low">Low Stock</span>`:''}
        </div>
        <div class="product-info">
          <div class="product-name">${p.name}</div>
          <div class="product-meta">
            <span class="product-price">₱${parseFloat(p.price).toFixed(2)}</span>
            <span class="product-qty ${qtyCls}">${qtyLbl}</span>
          </div>
          <div class="product-actions">
            <button class="edit-btn"   onclick="editProduct(${p.id})">✏️ Edit</button>
            <button class="delete-btn" onclick="openDeleteModal(${p.id})">🗑️ Delete</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function editProduct(productId) {
  const p = products.find(p => p.id === productId);
  if (!p) return;
  editingId = productId;
  document.getElementById('food-name').value        = p.name;
  document.getElementById('food-price').value       = p.price;
  document.getElementById('food-quantity').value    = p.quantity;
  document.getElementById('food-description').value = p.description || '';
  const catEl = document.getElementById('food-category');
  if (catEl) catEl.value = p.category || '';
  document.getElementById('form-title').innerHTML  = `Edit <span class="accent">Food Item</span>`;
  document.getElementById('form-sub').textContent  = `Editing: ${p.name}`;
  document.getElementById('submit-label').textContent = 'Update Item';
  document.getElementById('image-required').style.display = 'none';
  document.getElementById('cancel-edit-btn').style.display = 'inline-flex';
  if (p.image_url) {
    document.getElementById('upload-placeholder').style.display = 'none';
    const prev = document.getElementById('image-preview');
    prev.style.display = 'block';
    prev.innerHTML = `<img src="${assetUrl(p.image_url)}" alt="${p.name}">
      <button class="remove-preview" onclick="removePreview(event)">✕</button>`;
  }
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-add').classList.add('active');
  document.querySelectorAll('.nav-tab')[2].classList.add('active');
  document.querySelector('.add-form-card').scrollIntoView({ behavior:'smooth' });
}

function cancelEdit() { editingId = null; resetForm(); }

function resetForm() {
  editingId = null;
  document.getElementById('food-name').value = '';
  document.getElementById('food-price').value = '';
  document.getElementById('food-quantity').value = '';
  document.getElementById('food-description').value = '';
  const catEl = document.getElementById('food-category'); if(catEl) catEl.value = '';
  document.getElementById('food-image').value = '';
  const prev = document.getElementById('image-preview');
  prev.style.display = 'none'; prev.innerHTML = '';
  document.getElementById('upload-placeholder').style.display = 'flex';
  document.getElementById('form-title').innerHTML  = `Add <span class="accent">Food Item</span>`;
  document.getElementById('form-sub').textContent  = 'List a new item on your menu';
  document.getElementById('submit-label').textContent = 'Add to Menu';
  document.getElementById('image-required').style.display = 'inline';
  document.getElementById('cancel-edit-btn').style.display = 'none';
  showFormMsg('','');
}

function showFormMsg(text, type) {
  const el = document.getElementById('form-msg');
  if (!el) return;
  el.textContent = text;
  el.style.color = type==='error'?'var(--red)':type==='success'?'var(--green)':'var(--gray)';
}

async function submitProduct() {
  const name     = (document.getElementById('food-name').value||'').trim();
  const priceRaw = (document.getElementById('food-price').value||'').trim();
  const qtyRaw   = (document.getElementById('food-quantity').value||'').trim();
  const file     = document.getElementById('food-image').files[0];
  const btn      = document.getElementById('submit-btn');

  if (!name)                          { showFormMsg('Food name is required.','error'); return; }
  const price = parseFloat(priceRaw);
  if (!priceRaw||isNaN(price)||price<=0){ showFormMsg('Valid price required.','error'); return; }
  const quantity = qtyRaw===''?0:parseInt(qtyRaw,10);
  if (isNaN(quantity)||quantity<0)    { showFormMsg('Quantity must be 0 or more.','error'); return; }
  if (!editingId&&!file)              { showFormMsg('Please upload a product image.','error'); return; }

  const formData = new FormData();
  const desc = (document.getElementById('food-description').value||'').trim();
  const cat  = (document.getElementById('food-category').value||'').trim();
  formData.append('name',name); formData.append('price',price); formData.append('quantity',quantity);
  if (desc) formData.append('description',desc);
  if (cat)  formData.append('category',cat);
  if (file) formData.append('image',file);

  showFormMsg(editingId?'Updating...':'Adding...','');
  btn.disabled = true;
  document.getElementById('submit-arrow').textContent = '⏳';

  try {
    showFormMsg(file && file.size > MAX_EMBEDDED_IMAGE_BYTES ? 'Optimizing image...' : (editingId?'Updating...':'Adding...'),'');
    const uploadFile = file ? await compressProductImage(file) : null;
    if (uploadFile) formData.set('image', uploadFile);
    const url    = editingId?`${API}/products/${editingId}`:`${API}/products/`;
    const method = editingId?'PUT':'POST';
    const res    = await fetch(url,{method,headers:{'Authorization':`Bearer ${getToken()}`},body:formData});
    const data   = await res.json();
    if (!res.ok) { showFormMsg(data.error||`Save failed (HTTP ${res.status}).`,'error'); return; }
    showFormMsg(editingId?'✅ Product updated!':'✅ Product added!','success');
    setTimeout(() => {
      resetForm(); loadProducts();
      showTab('menu', document.querySelectorAll('.nav-tab')[1]);
    }, 1000);
  } catch (err) { showFormMsg(err.message || 'Cannot save product. Please try again.','error'); }
  finally { btn.disabled=false; document.getElementById('submit-arrow').textContent='→'; }
}

function openDeleteModal(productId) {
  const p = products.find(p => p.id===productId);
  if (!p) return;
  deletingId = productId;
  document.getElementById('confirm-msg').textContent = `Delete "${p.name}"? This cannot be undone.`;
  document.getElementById('delete-overlay').style.display = 'flex';
}

function closeDeleteModal() {
  deletingId = null;
  document.getElementById('delete-overlay').style.display = 'none';
}

async function confirmDelete() {
  if (!deletingId) return;
  const btn = document.getElementById('confirm-delete-btn');
  btn.disabled = true; btn.textContent = 'Deleting...';
  try {
    const res  = await fetch(`${API}/products/${deletingId}`,{method:'DELETE',headers:{'Authorization':`Bearer ${getToken()}`}});
    const data = await res.json();
    closeDeleteModal();
    if (!res.ok) { showToast(data.error||'Delete failed.','error'); return; }
    showToast('✅ Product deleted.','success');
    loadProducts();
  } catch (err) { showToast('❌ Cannot connect.','error'); }
  finally { btn.disabled=false; btn.textContent='Yes, Delete'; }
}

document.addEventListener('click',(e)=>{
  if (e.target===document.getElementById('delete-overlay')) closeDeleteModal();
});

// ═══════════════════════════════════════════════════════════════════
// FEATURE 5 — Seller Note (reply to customer)
// ═══════════════════════════════════════════════════════════════════
let _noteOrderId = null;
function openNoteModal(orderId, currentNote) {
  _noteOrderId = orderId;
  document.getElementById('seller-note-input').value = currentNote || '';
  document.getElementById('note-overlay').style.display = 'flex';
}
function closeNoteModal() { document.getElementById('note-overlay').style.display = 'none'; _noteOrderId = null; }

async function submitSellerNote() {
  if (!_noteOrderId) return;
  const note = document.getElementById('seller-note-input').value.trim();
  try {
    const res  = await fetch(`${API}/orders/${_noteOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ seller_note: note })
    });
    const data = await res.json();
    if (!res.ok) { showToast(`❌ ${data.error || 'Could not save note.'}`, 'error'); return; }
    showToast('💬 Note sent to customer!', 'success');
    closeNoteModal();
    loadOrders();
  } catch (err) { showToast('❌ Network error.', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE 6 — Bulk Restock
// ═══════════════════════════════════════════════════════════════════
function openRestockModal() { document.getElementById('restock-overlay').style.display = 'flex'; }
function closeRestockModal() { document.getElementById('restock-overlay').style.display = 'none'; }

async function confirmRestock() {
  const amount = parseInt(document.getElementById('restock-amount').value, 10);
  if (!amount || amount < 1) { showToast('❌ Enter a valid amount.', 'error'); return; }
  try {
    const res  = await fetch(`${API}/products/bulk-restock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ amount })
    });
    const data = await res.json();
    if (!res.ok) { showToast(`❌ ${data.error}`, 'error'); return; }
    showToast(`📦 ${data.message}`, 'success');
    closeRestockModal();
    loadProducts();
  } catch (err) { showToast('❌ Network error.', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE 7 — Seller Sales Dashboard
// ═══════════════════════════════════════════════════════════════════
async function loadSalesDashboard() {
  const container = document.getElementById('sales-content');
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading sales data...</p></div>`;
  try {
    const res  = await fetch(`${API}/products/my-sales`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<p style="color:var(--red);padding:20px">${data.error}</p>`; return; }

    const { summary, top_products, recent_orders } = data;
    container.innerHTML = `
      <!-- Summary cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(255,107,43,0.1)">📦</div>
          <div><span class="stat-num">${summary.total_orders}</span><p class="stat-lbl">Completed Orders</p></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(46,204,113,0.1)">💰</div>
          <div><span class="stat-num">₱${summary.total_revenue.toLocaleString('en-PH',{minimumFractionDigits:2})}</span><p class="stat-lbl">Total Revenue</p></div>
        </div>
      </div>

      <!-- Top products -->
      <div class="card" style="margin-bottom:24px;padding:20px">
        <h3 style="margin:0 0 16px;font-size:15px;font-weight:600">🏆 Top Selling Items</h3>
        ${top_products.length ? `
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="color:var(--gray);font-weight:500">
              <th style="text-align:left;padding:6px 0">Product</th>
              <th style="text-align:right;padding:6px 0">Units Sold</th>
              <th style="text-align:right;padding:6px 0">Revenue</th>
            </tr></thead>
            <tbody>${top_products.map((p,i) => `
              <tr style="border-top:1px solid var(--border)">
                <td style="padding:8px 0">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'  '} ${p.name}</td>
                <td style="text-align:right;padding:8px 0;font-weight:600">${p.total_sold}</td>
                <td style="text-align:right;padding:8px 0;color:var(--green-dk);font-weight:600">₱${parseFloat(p.total_revenue).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : '<p style="color:var(--gray);font-size:13px">No sales data yet.</p>'}
      </div>

      <!-- Recent orders -->
      <div class="card" style="padding:20px">
        <h3 style="margin:0 0 16px;font-size:15px;font-weight:600">🕐 Recent Orders</h3>
        ${recent_orders.length ? recent_orders.map(o => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px">
            <div>
              <strong>Order #${o.id}</strong>
              <span style="margin-left:8px;color:var(--gray)">${o.items.map(i=>i.product_name).join(', ')}</span>
            </div>
            <div style="display:flex;gap:12px;align-items:center">
              <span class="badge badge-${o.status}">${o.status.replace(/_/g,' ')}</span>
              <span style="font-weight:600;color:var(--green-dk)">₱${parseFloat(o.total_amount).toFixed(2)}</span>
            </div>
          </div>`).join('') : '<p style="color:var(--gray);font-size:13px">No recent orders.</p>'}
      </div>`;
  } catch (err) { container.innerHTML = `<p style="color:var(--red);padding:20px">Failed to load sales data.</p>`; }
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE 8 — Seller Profile + Change Password
// ═══════════════════════════════════════════════════════════════════
async function loadProfileForm() {
  try {
    const res  = await fetch(`${API}/auth/me`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
    const data = await res.json();
    if (!res.ok) return;
    const u = data.user;
    document.getElementById('profile-name').value    = u.full_name || '';
    document.getElementById('profile-email').value   = u.email     || '';
    document.getElementById('profile-phone').value   = u.phone     || '';
    document.getElementById('profile-address').value = u.address   || '';
  } catch (err) { console.error('loadProfileForm error:', err); }
}

async function saveProfile() {
  const msg = document.getElementById('profile-msg');
  msg.style.color = 'var(--gray)'; msg.textContent = 'Saving...';
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
    if (!res.ok) { msg.style.color='var(--red)'; msg.textContent=`❌ ${data.error}`; return; }
    msg.style.color = 'var(--green-dk)'; msg.textContent = '✅ Profile updated!';
    showToast('✅ Profile saved!', 'success');
  } catch (err) { msg.style.color='var(--red)'; msg.textContent='❌ Network error.'; }
}

async function changePassword() {
  const msg   = document.getElementById('pw-msg');
  const oldPw = document.getElementById('pw-old').value;
  const newPw = document.getElementById('pw-new').value;
  if (!oldPw || !newPw) { msg.style.color='var(--red)'; msg.textContent='Please fill in both fields.'; return; }
  msg.style.color='var(--gray)'; msg.textContent='Changing...';
  try {
    const res  = await fetch(`${API}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ old_password: oldPw, new_password: newPw })
    });
    const data = await res.json();
    if (!res.ok) { msg.style.color='var(--red)'; msg.textContent=`❌ ${data.error}`; return; }
    msg.style.color='var(--green-dk)'; msg.textContent='✅ Password changed!';
    document.getElementById('pw-old').value=''; document.getElementById('pw-new').value='';
    showToast('🔑 Password changed!', 'success');
  } catch (err) { msg.style.color='var(--red)'; msg.textContent='❌ Network error.'; }
}

// Hook showTab to load sales/profile on demand
function baseShowTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  btn.classList.add('active');

  if (name === 'orders') loadOrders();
  if (name === 'menu')   loadProducts();
}

function showTab(name, btn) {
  baseShowTab(name, btn);

  if (name === 'sales')   loadSalesDashboard();
  if (name === 'profile') loadProfileForm();
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target === document.getElementById('restock-overlay')) closeRestockModal();
  if (e.target === document.getElementById('note-overlay'))    closeNoteModal();
});
