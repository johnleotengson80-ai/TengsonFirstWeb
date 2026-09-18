/**
 * app.js — Login Page
 * Fixes:
 *   <span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Correct redirect paths (../html/)
 *   <span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Button loading state — prevents double-click
 *   <span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Password visibility toggle
 */

const API = window.API_BASE_URL;

// =========================================================================
// THE FRONTEND LOGIN ALGORITHM
// This code listens for the user to click the "Sign In" button.
// It grabs what they typed, sends it to the backend, and handles the response.
// =========================================================================
document.getElementById('loginForm').addEventListener('submit', async function (e) {
  // STEP 1: Prevent the page from refreshing when the form is submitted.
  e.preventDefault();

  // STEP 2: Grab the text the user typed into the input boxes.
  // .trim() removes any accidental spaces at the beginning or end.
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const msg      = document.getElementById('msg');
  const btn      = document.getElementById('login-btn');
  const btnLabel = document.getElementById('login-btn-label');

  // STEP 3: Client-Side Validation.
  // Before we even bother the backend, check if the boxes are empty.
  if (!username) {
    showMsg('Please enter your username.', 'error'); return;
  }
  if (!password) {
    showMsg('Please enter your password.', 'error'); return;
  }

  // STEP 4: UI Feedback.
  // Disable the login button so they can't click it 10 times and crash the server.
  // Change the text to "Signing in..." so they know something is happening.
  btn.disabled         = true;
  btnLabel.textContent = 'Signing in...';
  showMsg('', '');

  try {
    // STEP 5: Communicate with the Backend (The API Call).
    // We send a 'POST' request to '/api/auth/login' (which we commented in auth.py!).
    // We package the username and password into a JSON string to send it over the internet.
    const res  = await fetch(`${API}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password })
    });
    
    // STEP 6: Read the Backend's Response.
    const data = await res.json();

    if (!res.ok) {
      // If the backend sent an error (like 401 Unauthorized), show it on the screen.
      showMsg(data.error || 'Invalid username or password.', 'error');
      return;
    }

    // STEP 7: Save the "Digital ID Card" (JWT Token) and User Details.
    // localStorage saves this data in the browser so the user stays logged in
    // even if they close the tab and come back later.
    localStorage.setItem('token', data.token);
    localStorage.setItem('user',  JSON.stringify(data.user));

    // Show a success message
    showMsg('<span class="material-symbols-rounded" style="font-size:1.15em;vertical-align:-0.2em;margin-right:4px;">check_circle</span> Success! Redirecting...', 'success');

    // STEP 8: Redirect the user to their specific dashboard based on their role!
    // We wait 600 milliseconds just so they have time to see the "Success!" message.
    const role = data.user.role;
    setTimeout(() => {
      if (role === 'customer')    location.href = '../html/costumer.html';
      else if (role === 'seller') location.href = '../html/seller.html';
      else if (role === 'driver') location.href = '../html/driver.html';
      else                        location.href = '../html/admin.html';
    }, 600);

  } catch (err) {
    // This catches network errors (e.g., if your Flask server isn't running or WiFi drops)
    showMsg('Cannot reach server. Is Flask running?', 'error');
    console.error('login error:', err);
  } finally {
    // STEP 9: Cleanup. 
    // Always re-enable the button when the process is done (whether it succeeded or failed).
    btn.disabled         = false;
    btnLabel.textContent = 'Sign In';
  }
});

// Show message below the form
function showMsg(text, type) {
  const el = document.getElementById('msg');
  if (!el) return;
  el.innerHTML = text;
  el.className   = `auth-msg${type ? ' ' + type : ''}`;
}

// Password visibility toggle
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type     = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden ? '<span class="material-symbols-rounded" style="font-size:20px;">visibility_off</span>' : '<span class="material-symbols-rounded" style="font-size:20px;">visibility</span>';
}
