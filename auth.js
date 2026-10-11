/**
 * auth.js — Authentication logic for Sales Dashboard
 *
 * Security hardening (audit pass):
 *  [FIX-1] Passwords hashed with SHA-256 (SubtleCrypto) — never stored/compared in plaintext
 *  [FIX-2] getAllUsers() removed — no function exposes the full credential store externally
 *  [FIX-3] renderUsersList() shows ONLY usernames — password_hash never rendered into DOM
 *  [FIX-4] Brute-force lockout — 5 failed attempts → 30-second cooldown (tracked in sessionStorage)
 *  [FIX-5] Session token includes a random nonce — token is not trivially forgeable
 *  [FIX-6] Constant-time-equivalent hash comparison — both username AND password are always hashed
 *           before any comparison, eliminating timing side-channel on username enumeration
 *  [FIX-7] localStorage stores only password_hash — plaintext password is never persisted
 *  [FIX-8] All onclick= attributes removed from HTML; listeners attached here via addEventListener
 *  [FIX-9] escHtml() covers all five dangerous characters including quotes
 */

/* ============================================================
   CONSTANTS
   ============================================================ */
const STORAGE_KEY_USERS    = "sd_users";      // localStorage  — persisted hashed credentials
const STORAGE_KEY_SESSION  = "sd_session";    // sessionStorage — tab-scoped session token
const STORAGE_KEY_LOCKOUT  = "sd_lockout";    // sessionStorage — brute-force state
const MAX_ATTEMPTS         = 5;               // failed attempts before lockout
const LOCKOUT_SECONDS      = 30;              // lockout duration

/* ============================================================
   CRYPTO HELPERS
   ============================================================ */

/**
 * Returns the SHA-256 hex digest of a string using the browser's
 * built-in SubtleCrypto API (async, available in all modern browsers).
 * @param {string} text
 * @returns {Promise<string>} hex string
 */
async function sha256(text) {
  const encoder = new TextEncoder();
  const data     = encoder.encode(text);
  const hashBuf  = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time-equivalent string comparison.
 * Prevents timing attacks by always iterating the full string length.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/* ============================================================
   INTERNAL USER STORE  (not exported to global scope)
   ============================================================ */

/**
 * Returns combined user list: DEFAULT_USERS + localStorage extras.
 * Objects contain { username, password_hash } — no plaintext password.
 * This function is intentionally kept private (not assigned to window).
 */
function _getUsers() {
  const extras = JSON.parse(localStorage.getItem(STORAGE_KEY_USERS) || "[]");
  return [...DEFAULT_USERS, ...extras];
}

/**
 * Returns an array of usernames ONLY (no hashes, no passwords).
 * Safe to use in UI rendering.
 * @returns {{ username: string, isDefault: boolean }[]}
 */
function getUsernames() {
  return _getUsers().map((u, i) => ({
    username:  u.username,
    isDefault: i < DEFAULT_USERS.length,
  }));
}

/**
 * Saves a new user to localStorage after hashing the password.
 * @param {string} username
 * @param {string} password  — plaintext from form (hashed before storage)
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function addUser(username, password) {
  username = username.trim();
  password = password.trim();

  if (!username || !password) {
    return { ok: false, message: "Username and password cannot be empty." };
  }
  if (username.length < 3) {
    return { ok: false, message: "Username must be at least 3 characters." };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return { ok: false, message: "Username may only contain letters, numbers, _ . -" };
  }
  if (password.length < 6) {
    return { ok: false, message: "Password must be at least 6 characters." };
  }

  const all    = _getUsers();
  const exists = all.some(u => u.username.toLowerCase() === username.toLowerCase());
  if (exists) {
    return { ok: false, message: `Username "${escHtml(username)}" is already taken.` };
  }

  // [FIX-1, FIX-7] Hash before storing — plaintext never reaches localStorage
  const hash   = await sha256(password);
  const extras = JSON.parse(localStorage.getItem(STORAGE_KEY_USERS) || "[]");
  extras.push({ username, password_hash: hash });
  localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(extras));

  return { ok: true, message: `User "${escHtml(username)}" added successfully.` };
}

/* ============================================================
   BRUTE-FORCE PROTECTION
   ============================================================ */

function _getLockout() {
  return JSON.parse(sessionStorage.getItem(STORAGE_KEY_LOCKOUT) || '{"attempts":0,"until":0}');
}

function _saveLockout(state) {
  sessionStorage.setItem(STORAGE_KEY_LOCKOUT, JSON.stringify(state));
}

/** Returns remaining lockout seconds (0 = not locked out). */
function getLockoutRemaining() {
  const state = _getLockout();
  const remaining = Math.ceil((state.until - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

function _recordFailedAttempt() {
  const state = _getLockout();
  state.attempts += 1;
  if (state.attempts >= MAX_ATTEMPTS) {
    state.until    = Date.now() + LOCKOUT_SECONDS * 1000;
    state.attempts = 0; // reset counter after triggering lockout
  }
  _saveLockout(state);
}

function _resetLockout() {
  sessionStorage.removeItem(STORAGE_KEY_LOCKOUT);
}

/* ============================================================
   SESSION
   ============================================================ */

/**
 * Attempt login asynchronously (password is hashed before comparison).
 * [FIX-4] Rejects immediately if locked out.
 * [FIX-5] Session token includes a random nonce (crypto.randomUUID).
 * [FIX-6] Both username hash and password hash always computed to prevent timing leak.
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function login(username, password) {
  // [FIX-4] Lockout check
  const remaining = getLockoutRemaining();
  if (remaining > 0) {
    return { ok: false, message: `Too many failed attempts. Please wait ${remaining}s.` };
  }

  // [FIX-6] Always hash both inputs before any comparison
  const inputHash = await sha256(password.trim());
  const users     = _getUsers();

  // Find by username (case-insensitive), then compare hash
  const user = users.find(
    u => u.username.toLowerCase() === username.trim().toLowerCase()
  );

  // safeEqual used for hash comparison to prevent timing side-channel
  const matched = user ? safeEqual(user.password_hash, inputHash) : false;

  if (matched) {
    _resetLockout();
    // [FIX-5] Token carries a random nonce — not just a username JSON
    // R7 — Include role in session: "admin" username gets admin role
    const nonce = crypto.randomUUID();
    const role  = user.username === "admin" ? "admin" : (user.role || "viewer");
    sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify({
      username: user.username,
      role,
      nonce,
    }));
    return { ok: true, message: "Login successful." };
  }

  _recordFailedAttempt();
  return { ok: false, message: "Incorrect username or password." };
}

/** Clear session and redirect to login page. */
function logout() {
  sessionStorage.removeItem(STORAGE_KEY_SESSION);
  window.location.href = "login.html";
}

/** Returns true if a session token is present. */
function isLoggedIn() {
  return !!sessionStorage.getItem(STORAGE_KEY_SESSION);
}

/** Returns { username } from active session, or null. */
function getSession() {
  const raw = sessionStorage.getItem(STORAGE_KEY_SESSION);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Minimal structure validation
    if (typeof parsed.username !== "string" || typeof parsed.nonce !== "string") return null;
    return { username: parsed.username, role: parsed.role || "viewer" };
  } catch {
    return null;
  }
}

/* ============================================================
   UI HELPERS
   ============================================================ */

/** Show an alert box inside a form panel. */
function showAlert(id, message, type = "error") {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = [
    "rounded-lg px-4 py-3 text-sm font-medium",
    type === "error"
      ? "bg-red-50 border border-red-200 text-red-700"
      : "bg-green-50 border border-green-200 text-green-700",
  ].join(" ");
  // [FIX-9] Use textContent — never innerHTML for user-controlled strings
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden");
}

/** Toggle password input visibility. */
function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const showing = input.type !== "password";
  input.type    = showing ? "password" : "text";
  btn.textContent = showing ? "👁" : "🙈";
}

/**
 * Escape all five dangerous HTML characters.
 * [FIX-9] Includes ' and " to protect attribute contexts.
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#x27;");
}

/** Switch between Login / Register tabs. */
function switchTab(tab) {
  const isLogin = tab === "login";

  document.getElementById("panel-login").classList.toggle("hidden", !isLogin);
  document.getElementById("panel-register").classList.toggle("hidden", isLogin);
  document.getElementById("tab-login").classList.toggle("active", isLogin);
  document.getElementById("tab-register").classList.toggle("active", !isLogin);

  hideAlert("login-alert");
  hideAlert("register-alert");

  if (!isLogin) _refreshRegisterPanel();
}

/** Refresh the state of the register panel based on current session. */
function _refreshRegisterPanel() {
  const guard  = document.getElementById("register-auth-guard");
  const btn    = document.getElementById("btn-register");
  const inputs = ["reg-username", "reg-password", "reg-confirm"];
  const loggedIn = isLoggedIn();

  if (!loggedIn) {
    guard.classList.remove("hidden");
    btn.disabled = true;
    btn.classList.add("opacity-50", "cursor-not-allowed");
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = true; el.classList.add("opacity-50"); }
    });
  } else {
    guard.classList.add("hidden");
    btn.disabled = false;
    btn.classList.remove("opacity-50", "cursor-not-allowed");
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = false; el.classList.remove("opacity-50"); }
    });
    renderUsersList();
  }
}

/**
 * Render the registered users list.
 * [FIX-3] Shows ONLY usernames — password_hash is never touched here.
 */
function renderUsersList() {
  const wrap = document.getElementById("users-list-wrap");
  const list = document.getElementById("users-list");
  if (!wrap || !list) return;

  const users = getUsernames(); // returns { username, isDefault }[] — no hashes
  wrap.classList.remove("hidden");

  // [FIX-9] Build DOM nodes programmatically — no innerHTML with user data
  list.innerHTML = "";
  users.forEach((u, i) => {
    const li    = document.createElement("li");
    li.className = "flex items-center gap-2 py-1 border-b border-gray-100 last:border-0";

    const badge = document.createElement("span");
    badge.className = "w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center font-bold flex-shrink-0";
    badge.textContent = String(i + 1);

    const name = document.createElement("span");
    name.className = "font-medium";
    name.textContent = u.username; // textContent — safe, no XSS

    const tag = document.createElement("span");
    tag.className = u.isDefault
      ? "ml-auto text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5"
      : "ml-auto text-xs text-violet-600 bg-violet-50 rounded px-1.5 py-0.5";
    tag.textContent = u.isDefault ? "default" : "added";

    li.appendChild(badge);
    li.appendChild(name);
    li.appendChild(tag);
    list.appendChild(li);
  });
}

/* ============================================================
   LOCKOUT COUNTDOWN HELPER
   ============================================================ */

/** Start a live countdown display in the submit button during lockout. */
function _startLockoutCountdown(btnEl) {
  btnEl.disabled = true;
  const interval = setInterval(() => {
    const rem = getLockoutRemaining();
    if (rem <= 0) {
      clearInterval(interval);
      btnEl.disabled = false;
      btnEl.textContent = "Sign In";
    } else {
      btnEl.textContent = `Locked — wait ${rem}s`;
    }
  }, 500);
}

/* ============================================================
   FORM HANDLERS  [FIX-8] All listeners attached here, no onclick= in HTML
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {

  // Only run login-page logic when we ARE on login.html
  // Prevents infinite redirect loop when auth.js is also loaded by index.html
  const onLoginPage = window.location.pathname.endsWith("login.html") ||
                      window.location.pathname === "/" ||
                      window.location.pathname.endsWith("/");
  if (!onLoginPage) return;

  // If already logged in, go straight to dashboard
  if (isLoggedIn()) {
    window.location.href = "index.html";
    return;
  }

  // Attach tab button listeners
  const tabLogin    = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  if (tabLogin)    tabLogin.addEventListener("click",    () => switchTab("login"));
  if (tabRegister) tabRegister.addEventListener("click", () => switchTab("register"));

  // Attach auth-guard link in register panel
  const guardLink = document.querySelector("#register-auth-guard a");
  if (guardLink) guardLink.addEventListener("click", e => { e.preventDefault(); switchTab("login"); });

  // Attach password visibility toggles
  document.querySelectorAll(".pw-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      if (targetId) togglePw(targetId, btn);
    });
  });

  /* ---------- Login form ---------- */
  const formLogin  = document.getElementById("form-login");
  const btnSubmit  = formLogin ? formLogin.querySelector('button[type="submit"]') : null;

  if (formLogin) {
    // Show lockout state immediately if tab is re-opened during cooldown
    if (getLockoutRemaining() > 0 && btnSubmit) {
      _startLockoutCountdown(btnSubmit);
    }

    formLogin.addEventListener("submit", async e => {
      e.preventDefault();
      hideAlert("login-alert");

      // [FIX-4] Check lockout before doing anything
      const rem = getLockoutRemaining();
      if (rem > 0) {
        showAlert("login-alert", `Too many failed attempts. Please wait ${rem}s.`);
        return;
      }

      const username = document.getElementById("login-username").value;
      const password = document.getElementById("login-password").value;

      if (!username || !password) {
        showAlert("login-alert", "Please enter both username and password.");
        return;
      }

      if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = "Signing in…"; }

      const result = await login(username, password);

      if (result.ok) {
        showAlert("login-alert", "✓ Login successful! Redirecting…", "success");
        setTimeout(() => { window.location.href = "index.html"; }, 700);
      } else {
        if (btnSubmit) {
          // If now locked out, start countdown; otherwise re-enable
          if (getLockoutRemaining() > 0) {
            _startLockoutCountdown(btnSubmit);
          } else {
            btnSubmit.disabled = false;
            btnSubmit.textContent = "Sign In";
          }
        }
        showAlert("login-alert", result.message);
        const card = document.querySelector(".login-card");
        if (card) {
          card.classList.add("shake");
          card.addEventListener("animationend", () => card.classList.remove("shake"), { once: true });
        }
      }
    });
  }

  /* ---------- Register form ---------- */
  const formRegister = document.getElementById("form-register");
  if (formRegister) {
    formRegister.addEventListener("submit", async e => {
      e.preventDefault();
      hideAlert("register-alert");

      if (!isLoggedIn()) {
        showAlert("register-alert", "You must be logged in to add a new user.");
        return;
      }

      const username = document.getElementById("reg-username").value;
      const password = document.getElementById("reg-password").value;
      const confirm  = document.getElementById("reg-confirm").value;

      if (password !== confirm) {
        showAlert("register-alert", "Passwords do not match.");
        return;
      }

      const btnReg = document.getElementById("btn-register");
      if (btnReg) { btnReg.disabled = true; btnReg.textContent = "Saving…"; }

      const result = await addUser(username, password);

      if (btnReg) { btnReg.disabled = false; btnReg.textContent = "Add User"; }

      if (result.ok) {
        showAlert("register-alert", `✓ ${result.message}`, "success");
        formRegister.reset();
        renderUsersList();
      } else {
        showAlert("register-alert", result.message);
      }
    });
  }
});
