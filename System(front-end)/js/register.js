/**
 * register.js — Public Registration
 * Fixes:
 *   <span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Button loading state — prevents double submit
 *   <span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Correct redirect path
 *   <span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Password toggle function
 *   <span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Role never sent from frontend (security)
 */

const API = window.API_BASE_URL;

document.getElementById('registerForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const username  = (document.getElementById('username')?.value  || '').trim();
  const password  = (document.getElementById('password')?.value  || '').trim();
  const full_name = (document.getElementById('full_name')?.value || '').trim();
  const email     = (document.getElementById('email')?.value     || '').trim();
  const phone     = (document.getElementById('phone')?.value     || '').trim();
  const address   = (document.getElementById('address')?.value   || '').trim();

  const btn      = document.getElementById('register-btn');
  const btnLabel = document.getElementById('register-btn-label');

  // ── Client-side validation ─────────────────────────────────────
  if (!username) {
    showMsg('Username is required.', 'error'); return;
  }
  if (username.length < 3) {
    showMsg('Username must be at least 3 characters.', 'error'); return;
  }
  if (!password) {
    showMsg('Password is required.', 'error'); return;
  }
  if (password.length < 4) {
    showMsg('Password must be at least 4 characters.', 'error'); return;
  }
  if (email && !email.includes('@')) {
    showMsg('Please enter a valid email address.', 'error'); return;
  }

  // ── Disable button while request runs ──────────────────────────
  btn.disabled         = true;
  btnLabel.textContent = 'Creating account...';
  showMsg('', '');

  try {
    const res = await fetch(`${API}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // SECURITY: role is NOT sent — backend always assigns 'customer'
      body: JSON.stringify({ username, password, full_name, email, phone, address })
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg(data.error || 'Registration failed. Please try again.', 'error');
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('user',  JSON.stringify(data.user));

    showMsg('Account created! Redirecting...', 'success');

    // FIXED path — html/ subfolder
    setTimeout(() => { location.href = '../html/costumer.html'; }, 900);

  } catch (err) {
    showMsg('Cannot reach server. Make sure Flask is running.', 'error');
    console.error('register error:', err);
  } finally {
    btn.disabled         = false;
    btnLabel.textContent = 'Create Account';
  }
});

function showMsg(text, type) {
  const el = document.getElementById('msg');
  if (!el) return;
  el.innerHTML = text;
  el.className   = `auth-msg${type ? ' ' + type : ''}`;
}

// Password visibility toggle — shared with index.html
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden  = input.type === 'password';
  input.type      = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden ? '<span class="material-symbols-rounded" style="font-size:20px;">visibility_off</span>' : '<span class="material-symbols-rounded" style="font-size:20px;">visibility</span>';
}
