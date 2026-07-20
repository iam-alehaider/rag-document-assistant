
let mode = "login"; // or "register" - only meaningful within the login/register view
let token = localStorage.getItem("rag_token") || null;
let sessionId = null;
let activeDocId = null;
let pollTimer = null;
let currentUserEmail = null;
let cachedSessions = [];

const $ = (id) => document.getElementById(id);

// FastAPI validation errors (422) return `detail` as an array of objects;
// most other errors return `detail` as a plain string. Normalize either
// shape into readable text.
function extractErrorMessage(err, fallback) {
  if (!err) return fallback;
  const detail = err.detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg || JSON.stringify(d)).join(", ");
  }
  if (typeof detail === "string") return detail;
  return fallback;
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/* ===================== Theme system ===================== */

function resolveTheme(pref) {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

// Applies instantly (CSS variable swap, already loaded) and updates the
// settings UI's active state if the modal happens to be open.
function applyTheme(pref, { persist = true, syncServer = false } = {}) {
  document.documentElement.setAttribute("data-theme", resolveTheme(pref));
  if (persist) localStorage.setItem("rag_theme_preference", pref);
  document.querySelectorAll(".theme-option").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.themeChoice === pref);
  });
  if (syncServer && token) {
    fetch(`${API_BASE_URL}/auth/preferences`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ theme_preference: pref }),
    }).catch(() => {}); // best-effort - localStorage already has it applied
  }
}

function getCurrentThemePreference() {
  return localStorage.getItem("rag_theme_preference") || "system";
}

// Keep "system" theme live if the OS preference changes while the tab is open.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getCurrentThemePreference() === "system") applyTheme("system", { persist: false });
});

/* ===================== Toasts ===================== */

function showToast(message, type = "default") {
  const container = $("toast-container");
  const el = document.createElement("div");
  el.className = `toast${type !== "default" ? ` is-${type}` : ""}`;
  el.textContent = message;
  container.appendChild(el);
  fadeSlideIn(el, { distance: 10 });
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 200);
  }, 3200);
}

/* ===================== Landing / Auth view switching ===================== */

function showLandingView() {
  $("landing-panel").classList.remove("hidden");
  $("auth-panel").classList.add("hidden");
  $("app-panel").classList.add("hidden");
}

function showAuthView(view) {
  // view: "login" | "register" | "forgot" | "reset"
  $("landing-panel").classList.add("hidden");
  $("auth-panel").classList.remove("hidden");
  $("app-panel").classList.add("hidden");

  $("view-login-register").classList.toggle("hidden", view !== "login" && view !== "register");
  $("view-forgot").classList.toggle("hidden", view !== "forgot");
  $("view-reset").classList.toggle("hidden", view !== "reset");

  if (view === "login" || view === "register") {
    setMode(view);
  }

  const subtitles = {
    login: "Sign in to query your documents.",
    register: "Create an account to get started.",
    forgot: "Reset your password.",
    reset: "Choose a new password.",
  };
  $("auth-subtitle").textContent = subtitles[view];
}

function setMode(newMode) {
  mode = newMode;
  $("tab-login").classList.toggle("is-active", mode === "login");
  $("tab-register").classList.toggle("is-active", mode === "register");
  $("auth-submit").textContent = mode === "login" ? "Sign in" : "Create account";
  $("forgot-password-link").classList.toggle("hidden", mode !== "login");
  $("tos-row").classList.toggle("hidden", mode !== "register");
  $("resend-verification-btn").classList.add("hidden");
  $("auth-error").textContent = "";
  $("auth-error").className = "auth-message";
}

$("tab-login").onclick = () => showAuthView("login");
$("tab-register").onclick = () => showAuthView("register");
$("forgot-password-link").onclick = (e) => {
  e.preventDefault();
  $("forgot-email").value = $("email").value;
  $("forgot-message").textContent = "";
  showAuthView("forgot");
};
$("back-to-login-from-forgot").onclick = (e) => { e.preventDefault(); showAuthView("login"); };
$("back-to-login-from-reset").onclick = (e) => { e.preventDefault(); showAuthView("login"); };
$("auth-back-to-landing").onclick = () => showLandingView();

/* ---- Landing page wiring ---- */
$("landing-signin-btn").onclick = () => showAuthView("login");
$("landing-getstarted-btn").onclick = () => showAuthView("register");
$("landing-cta-btn").onclick = () => showAuthView("register");
$("landing-footer-product").onclick = (e) => { e.preventDefault(); showLandingView(); window.scrollTo(0, 0); };
$("landing-hero-submit").onclick = () => showAuthView("register");
$("landing-hero-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") showAuthView("register");
});

/* ===================== Login / Register ===================== */

$("auth-submit").onclick = async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  const msg = $("auth-error");
  msg.textContent = "";
  msg.className = "auth-message";
  $("resend-verification-btn").classList.add("hidden");

  try {
    if (mode === "register") {
      if (!$("tos-checkbox").checked) {
        throw new Error("You must accept the Terms of Service and Privacy Policy to create an account.");
      }
      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, tos_accepted: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(extractErrorMessage(err, "Registration failed"));
      }
      showAuthView("login");
      $("email").value = email;
      msg.textContent = "Account created — check your email for a verification link before signing in.";
      msg.className = "auth-message is-success";
      return;
    }

    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const message = extractErrorMessage(err, "Login failed");
      if (res.status === 403 && message.toLowerCase().includes("verify your email")) {
        $("resend-verification-btn").classList.remove("hidden");
      }
      throw new Error(message);
    }
    const data = await res.json();
    token = data.access_token;
    localStorage.setItem("rag_token", token);
    showApp();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "auth-message is-error";
  }
};

$("resend-verification-btn").onclick = async () => {
  const email = $("email").value.trim();
  const msg = $("auth-error");
  const res = await fetch(`${API_BASE_URL}/auth/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({ message: "Request sent." }));
  msg.textContent = data.message || "If that email exists, a new verification link was sent.";
  msg.className = "auth-message is-success";
  $("resend-verification-btn").classList.add("hidden");
};

/* ===================== Forgot / reset password ===================== */

$("forgot-submit").onclick = async () => {
  const email = $("forgot-email").value.trim();
  const msg = $("forgot-message");
  const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({ message: "Request sent." }));
  msg.textContent = data.message || "If that email is registered, a reset link was sent.";
  msg.className = "auth-message is-success";
};

let pendingResetToken = null;

$("reset-submit").onclick = async () => {
  const newPassword = $("reset-password").value;
  const msg = $("reset-message");
  msg.textContent = "";
  msg.className = "auth-message";

  if (!pendingResetToken) {
    msg.textContent = "Missing reset token — use the link from your email again.";
    msg.className = "auth-message is-error";
    return;
  }

  const res = await fetch(`${API_BASE_URL}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: pendingResetToken, new_password: newPassword }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    msg.textContent = extractErrorMessage(data, "Reset failed — the link may have expired.");
    msg.className = "auth-message is-error";
    return;
  }
  msg.textContent = data.message || "Password updated — you can sign in now.";
  msg.className = "auth-message is-success";
  setTimeout(() => showAuthView("login"), 1500);
};

/* ===================== Handle email links (?verify=, ?reset=) ===================== */

async function handleAuthLinkParams() {
  const params = new URLSearchParams(window.location.search);
  const verifyToken = params.get("verify");
  const resetToken = params.get("reset");

  if (verifyToken) {
    const res = await fetch(`${API_BASE_URL}/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verifyToken }),
    });
    const data = await res.json().catch(() => null);
    showAuthView("login");
    const msg = $("auth-error");
    msg.textContent = res.ok
      ? (data.message || "Email verified — you can sign in now.")
      : extractErrorMessage(data, "Verification failed — the link may have expired.");
    msg.className = res.ok ? "auth-message is-success" : "auth-message is-error";
    window.history.replaceState({}, "", window.location.pathname);
    return true;
  }

  if (resetToken) {
    pendingResetToken = resetToken;
    showAuthView("reset");
    window.history.replaceState({}, "", window.location.pathname);
    return true;
  }

  return false;
}

function logout() {
  localStorage.removeItem("rag_token");
  token = null;
  sessionId = null;
  activeDocId = null;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  showLandingView();
  $("email").value = "";
  $("password").value = "";
}

/* ===================== App shell ===================== */

async function showApp() {
  $("landing-panel").classList.add("hidden");
  $("auth-panel").classList.add("hidden");
  $("app-panel").classList.remove("hidden");
  await Promise.all([loadProfile(), loadDocuments(), loadSessions()]);
  renderEmptyState();
}

let currentUserVerified = false;

async function loadProfile() {
  const res = await fetch(`${API_BASE_URL}/auth/me`, { headers: authHeaders() });
  if (!res.ok) {
    if (res.status === 401) logout();
    return;
  }
  const user = await res.json();
  currentUserEmail = user.email;
  currentUserVerified = user.is_verified;
  $("user-email-display").textContent = user.email;
  $("user-avatar-initial").textContent = user.email[0].toUpperCase();
  $("settings-account-verified").textContent = user.is_verified ? "Yes" : "No";

  // Server is the source of truth once logged in - apply its stored
  // preference (falls back gracefully if the field is missing/invalid).
  if (user.theme_preference) {
    applyTheme(user.theme_preference, { persist: true, syncServer: false });
  }
}

$("user-menu-btn").onclick = (e) => {
  e.stopPropagation();
  const dropdown = $("user-menu-dropdown");
  const opening = dropdown.classList.contains("hidden");
  dropdown.classList.toggle("hidden");
  if (opening) fadeScaleIn(dropdown);
};
document.addEventListener("click", (e) => {
  if (!$("user-menu-dropdown").contains(e.target) && e.target !== $("user-menu-btn")) {
    $("user-menu-dropdown").classList.add("hidden");
  }
});
$("logout-btn").onclick = logout;

/* ===================== Settings modal ===================== */

$("settings-btn").onclick = () => {
  $("user-menu-dropdown").classList.add("hidden");
  $("settings-account-email").textContent = currentUserEmail || "—";
  const modal = $("settings-modal");
  modal.classList.remove("hidden");
  fadeScaleIn(modal.querySelector(".modal-card"));
  applyTheme(getCurrentThemePreference(), { persist: false }); // refresh active swatch highlight
};
$("settings-modal-close").onclick = () => $("settings-modal").classList.add("hidden");
$("settings-modal").addEventListener("click", (e) => {
  if (e.target === $("settings-modal")) $("settings-modal").classList.add("hidden");
});

document.querySelectorAll(".settings-tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".settings-tab").forEach((t) => t.classList.remove("is-active"));
    document.querySelectorAll(".settings-panel").forEach((p) => p.classList.add("hidden"));
    tab.classList.add("is-active");
    $(`settings-panel-${tab.dataset.settingsTab}`).classList.remove("hidden");
  };
});

document.querySelectorAll(".theme-option").forEach((btn) => {
  btn.onclick = () => applyTheme(btn.dataset.themeChoice, { persist: true, syncServer: true });
});

$("settings-change-password").onclick = async (e) => {
  e.preventDefault();
  if (!currentUserEmail) return;
  await fetch(`${API_BASE_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: currentUserEmail }),
  });
  showToast("Password reset link sent to your email.", "success");
};

/* ===================== Sidebar collapse ===================== */

const SIDEBAR_COLLAPSE_KEY = "rag_sidebar_collapsed";
function applySidebarCollapsed(collapsed) {
  document.querySelector(".sidebar").classList.toggle("is-collapsed", collapsed);
  $("sidebar-collapse-btn").textContent = collapsed ? "▶" : "◀";
}
$("sidebar-collapse-btn").onclick = () => {
  const collapsed = !document.querySelector(".sidebar").classList.contains("is-collapsed");
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
  applySidebarCollapsed(collapsed);
};
applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1");

/* ===================== Global keyboard shortcuts ===================== */

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "k" && !$("app-panel").classList.contains("hidden")) {
    e.preventDefault();
    $("session-search").focus();
  } else if (mod && e.key.toLowerCase() === "n" && !$("app-panel").classList.contains("hidden")) {
    e.preventDefault();
    $("new-chat-btn").click();
  }
});

/* ===================== Documents ===================== */

function statusClass(status) {
  return status === "ready" ? "is-ready" : status === "failed" ? "is-failed" : "is-processing";
}

function statusBadgeHtml(status) {
  if (status === "processing") {
    return `<span class="doc-status-bar skeleton" title="processing…"></span>`;
  }
  const label = status === "ready" ? "ready" : "failed";
  return `<span class="doc-status ${statusClass(status)}">${label}</span>`;
}

async function loadDocuments() {
  const res = await fetch(`${API_BASE_URL}/documents`, { headers: authHeaders() });
  if (!res.ok) return;
  const docs = await res.json();
  const list = $("doc-list");
  list.innerHTML = "";

  if (docs.length === 0) {
    list.innerHTML = `<p class="empty-hint">No documents uploaded.</p>`;
  }

  let anyProcessing = false;

  docs.forEach((doc, i) => {
    if (doc.status === "processing") anyProcessing = true;
    const el = document.createElement("div");
    el.className = `doc-item ${statusClass(doc.status)}${doc.id === activeDocId ? " is-scoped" : ""}`;
    el.innerHTML = `
      <span class="doc-name" title="${doc.filename}">${doc.filename}</span>
      ${statusBadgeHtml(doc.status)}
      <button class="doc-delete" title="Delete document">✕</button>
    `;
    el.querySelector(".doc-name").onclick = () => {
      if (doc.status !== "ready") return;
      activeDocId = activeDocId === doc.id ? null : doc.id;
      $("scope-label").textContent = activeDocId ? doc.filename : "All documents";
      loadDocuments();
    };
    const statusEl = el.querySelector(".doc-status");
    if (statusEl) statusEl.onclick = el.querySelector(".doc-name").onclick;
    el.querySelector(".doc-delete").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${doc.filename}"? This can't be undone.`)) return;
      const delRes = await fetch(`${API_BASE_URL}/documents/${doc.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (delRes.ok) {
        if (activeDocId === doc.id) {
          activeDocId = null;
          $("scope-label").textContent = "All documents";
        }
        showToast(`Deleted "${doc.filename}"`, "success");
        loadDocuments();
      } else {
        showToast("Failed to delete document", "error");
      }
    };
    list.appendChild(el);
    fadeSlideIn(el, { delay: i * 25 });
  });

  if (anyProcessing && !pollTimer) {
    pollTimer = setInterval(loadDocuments, 3000);
  } else if (!anyProcessing && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function uploadFile(file) {
  $("upload-status").textContent = "Uploading…";
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_BASE_URL}/documents`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const message = extractErrorMessage(err, "Unknown error");
    $("upload-status").textContent = "Upload failed: " + message;
    showToast("Upload failed: " + message, "error");
    return;
  }
  $("upload-status").textContent = "Uploaded — indexing in the background.";
  showToast("Uploaded — indexing in the background.", "success");
  await loadDocuments();
}

$("upload-btn").onclick = async () => {
  const file = $("file-input").files[0];
  if (!file) return;
  await uploadFile(file);
  $("file-input").value = "";
};

$("composer-attach-btn").onclick = () => $("file-input").click();

/* ===================== Empty state (5.1) ===================== */

function buildEmptyStateHTML() {
  const name = currentUserEmail ? currentUserEmail.split("@")[0] : "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const prompts = [
    "Summarize this document",
    "What are the key points?",
    "List any dates or deadlines mentioned",
    "Explain this in simple terms",
  ];
  const promptsHtml = prompts.map((p) => `<button class="suggested-prompt">${p}</button>`).join("");

  let recentHtml = "";
  if (cachedSessions.length > 0) {
    const recent = cachedSessions.slice(0, 3);
    const links = recent
      .map((s) => `<button data-session-id="${s.session_id}">${s.title}</button>`)
      .join("");
    recentHtml = `<div class="recent-conversations-hint"><span>Or pick up a recent conversation</span>${links}</div>`;
  }

  return `
    <div class="chat-empty-state">
      <div class="chat-empty-icon">💬</div>
      <h2>${greeting}, ${name}</h2>
      <p>Upload a PDF or text file on the left, then ask a question. Answers are grounded only in what you've uploaded.</p>
      <div class="suggested-prompts">${promptsHtml}</div>
      ${recentHtml}
    </div>`;
}

function renderEmptyState() {
  $("chat-log").innerHTML = buildEmptyStateHTML();
  $("chat-log").querySelectorAll(".suggested-prompt").forEach((btn) => {
    btn.onclick = () => {
      $("question-input").value = btn.textContent;
      $("question-input").focus();
      autoResizeComposer();
    };
  });
  $("chat-log").querySelectorAll(".recent-conversations-hint button").forEach((btn) => {
    btn.onclick = () => openSession(btn.dataset.sessionId);
  });
}

/* ===================== Chat ===================== */

let isStreaming = false;
let currentStreamController = null;

function renderSourcePills(sources) {
  const log = $("chat-log");
  if (!sources || !sources.length) return;
  const wrap = document.createElement("div");
  wrap.className = "source-list";
  sources.forEach((s) => {
    const pill = document.createElement("button");
    pill.className = "source-pill";
    const pct = Math.round(s.score * 100);
    pill.innerHTML = `
      <span class="source-pill-bar"><span class="source-pill-bar-fill" style="width:${pct}%"></span></span>
      <span class="source-pill-name">${s.filename}</span>
    `;
    pill.onclick = () => openSourceModal(s);
    wrap.appendChild(pill);
  });
  log.appendChild(wrap);
  fadeSlideIn(wrap);
  log.scrollTop = log.scrollHeight;
}

/* ===================== Markdown rendering ===================== */

// Defensive: if the markdown-it CDN script fails to load (network issue,
// ad blocker, CDN outage), `md` stays null and renderMarkdown() below falls
// back to plain text instead of throwing - a CDN hiccup should degrade
// gracefully, not take down login/chat/everything else in this file.
const md = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: true }) : null;

function injectCodeCopyButtons(bubble) {
  bubble.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".code-copy-btn")) return;
    const btn = document.createElement("button");
    btn.className = "code-copy-btn";
    btn.textContent = "Copy";
    btn.onclick = () => {
      navigator.clipboard.writeText(pre.textContent).then(() => {
        btn.textContent = "Copied";
        setTimeout(() => { btn.textContent = "Copy"; }, 1200);
      });
    };
    pre.appendChild(btn);
  });
}

// Renders markdown -> sanitized HTML -> syntax highlighting, and stores the
// original raw text on the element (bubble.rawText) so the Copy button can
// copy the actual markdown source rather than the rendered plain text.
// Falls back to plain text if the CDN libraries didn't load, rather than
// throwing and breaking the message entirely.
function renderMarkdown(bubble, rawText) {
  bubble.rawText = rawText;
  if (!md || !window.DOMPurify) {
    bubble.textContent = rawText;
    return;
  }
  bubble.innerHTML = DOMPurify.sanitize(md.render(rawText));
  if (window.Prism && Prism.highlightAllUnder) Prism.highlightAllUnder(bubble);
  injectCodeCopyButtons(bubble);
}

// Builds/rebuilds the action bar under an assistant message: Copy always,
// Regenerate whenever we know the original question (works for both live
// and historically-loaded messages), Continue only when the last stream
// ended truncated (finish_reason === "length" is never persisted for
// historical messages, so Continue is correctly unavailable after reload -
// only Regenerate survives a page refresh, which matches what's actually
// knowable).
function addMessageActions(row, bubble, { question, finishReason } = {}) {
  if (question) row.dataset.question = question;
  if (finishReason) row.dataset.finishReason = finishReason;

  const existing = row.querySelector(".msg-actions");
  if (existing) existing.remove();

  const actions = document.createElement("div");
  actions.className = "msg-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "msg-action-btn";
  copyBtn.textContent = "Copy";
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(bubble.rawText || bubble.textContent).then(() => {
      copyBtn.textContent = "Copied";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1200);
    });
  };
  actions.appendChild(copyBtn);

  if (row.dataset.question) {
    const regenBtn = document.createElement("button");
    regenBtn.className = "msg-action-btn";
    regenBtn.textContent = "↻ Regenerate";
    regenBtn.title = "Ask the same question again as a new turn";
    regenBtn.onclick = () => regenerateMessage(row);
    actions.appendChild(regenBtn);
  }

  if (row.dataset.finishReason === "length") {
    const contBtn = document.createElement("button");
    contBtn.className = "msg-action-btn is-continue";
    contBtn.textContent = "Continue";
    contBtn.title = "The answer was cut off - continue generating";
    contBtn.onclick = () => continueMessage(row, bubble);
    actions.appendChild(contBtn);
  }

  row.appendChild(actions);
}

function addMessage(role, text, sources, question) {
  const log = $("chat-log");
  const emptyState = log.querySelector(".chat-empty-state");
  if (emptyState) emptyState.remove();

  const row = document.createElement("div");
  row.className = `msg-row is-${role}`;
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  if (role === "assistant") {
    renderMarkdown(bubble, text);
    row.appendChild(bubble);
    addMessageActions(row, bubble, { question });
  } else {
    bubble.textContent = text;
    row.appendChild(bubble);
  }
  log.appendChild(row);
  fadeSlideIn(row);

  renderSourcePills(sources);
  log.scrollTop = log.scrollHeight;
}

// Creates an empty assistant bubble to be filled in token-by-token as the
// stream arrives, plus a blinking cursor shown while still streaming.
function createStreamingBubble() {
  const log = $("chat-log");
  const emptyState = log.querySelector(".chat-empty-state");
  if (emptyState) emptyState.remove();

  const row = document.createElement("div");
  row.className = "msg-row is-assistant";
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  const cursor = document.createElement("span");
  cursor.className = "typing-cursor";
  cursor.textContent = "▍";
  bubble.appendChild(cursor);
  row.appendChild(bubble);
  log.appendChild(row);
  fadeSlideIn(row);
  log.scrollTop = log.scrollHeight;
  return { row, bubble, cursor };
}

function setAskButtonState(streaming) {
  const btn = $("ask-btn");
  btn.textContent = streaming ? "Stop" : "Ask";
  btn.classList.toggle("btn-secondary", streaming);
  btn.classList.toggle("btn-primary", !streaming);
}

// Auto-scroll while streaming, but don't fight the person if they've
// scrolled up to reread something - show a "jump to latest" button instead.
function isScrolledNearBottom() {
  const log = $("chat-log");
  return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
}

function maybeAutoScroll() {
  const log = $("chat-log");
  if (isScrolledNearBottom()) {
    log.scrollTop = log.scrollHeight;
    $("scroll-to-latest-btn").classList.add("hidden");
  } else {
    $("scroll-to-latest-btn").classList.remove("hidden");
  }
}

$("scroll-to-latest-btn").onclick = () => {
  const log = $("chat-log");
  log.scrollTop = log.scrollHeight;
  $("scroll-to-latest-btn").classList.add("hidden");
};

async function streamChatRequest(question, { isContinuation = false, row: existingRow = null, bubble: existingBubble = null, seedText = "" } = {}) {
  isStreaming = true;
  setAskButtonState(true);

  let row, bubble, cursor, fullText;

  if (isContinuation && existingRow && existingBubble) {
    // Continue generation: reuse the same bubble/row rather than creating a
    // new message, and seed the running text with what's already there so
    // new tokens are appended, not a fresh answer started from scratch.
    row = existingRow;
    bubble = existingBubble;
    fullText = seedText;
    cursor = document.createElement("span");
    cursor.className = "typing-cursor";
    cursor.textContent = "▍";
    bubble.appendChild(cursor);
    const oldActions = row.querySelector(".msg-actions");
    if (oldActions) oldActions.remove(); // hide actions while it's streaming again
  } else {
    ({ row, bubble, cursor } = createStreamingBubble());
    fullText = "";
  }

  let statusNode = null;
  currentStreamController = new AbortController();

  try {
    const res = await fetch(`${API_BASE_URL}/chat/stream`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ question, document_id: activeDocId, session_id: sessionId }),
      signal: currentStreamController.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      cursor.remove();
      bubble.textContent = "Error: " + extractErrorMessage(err, "Unknown error");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pendingSources = null;
    const isNewSession = !sessionId;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // last entry may be an incomplete line - keep for next chunk

      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event.type === "status") {
          if (!statusNode) {
            statusNode = document.createTextNode("");
            bubble.insertBefore(statusNode, cursor);
          }
          statusNode.textContent = event.message + " ";
        } else if (event.type === "retrieval") {
          if (statusNode) {
            const count = event.chunks_found;
            statusNode.textContent = `Found ${count} relevant excerpt${count === 1 ? "" : "s"} — generating answer... `;
          }
        } else if (event.type === "sources") {
          pendingSources = event.sources;
        } else if (event.type === "token") {
          if (statusNode) {
            statusNode.remove();
            statusNode = null;
          }
          fullText += event.text;
          renderMarkdown(bubble, fullText);
          bubble.appendChild(cursor);
          maybeAutoScroll();
        } else if (event.type === "warning") {
          if (statusNode) {
            statusNode.textContent += event.message + " ";
          } else {
            statusNode = document.createTextNode(event.message + " ");
            bubble.insertBefore(statusNode, cursor);
          }
        } else if (event.type === "error") {
          cursor.remove();
          bubble.textContent = fullText || event.message;
        } else if (event.type === "done") {
          cursor.remove();
          if (statusNode) statusNode.remove();
          sessionId = event.session_id;
          if (pendingSources) renderSourcePills(pendingSources);
          // Preserve the ORIGINAL question on continuation, not the
          // "continue where you left off" filler prompt - Regenerate should
          // always re-ask the real question, not the continuation nudge.
          const originalQuestion = isContinuation ? row.dataset.question : question;
          addMessageActions(row, bubble, { question: originalQuestion, finishReason: event.finish_reason });
          if (isNewSession) loadSessions();
          maybeAutoScroll();
        }
      }
    }
  } catch (err) {
    // AbortError happens when the person clicks Stop - keep whatever
    // partial text has streamed in rather than treating it as a failure.
    cursor.remove();
    if (statusNode) statusNode.remove();
    if (err.name !== "AbortError") {
      bubble.textContent = fullText || "Something went wrong while streaming the answer.";
    }
  } finally {
    isStreaming = false;
    currentStreamController = null;
    setAskButtonState(false);
  }
}

// Regenerate: re-asks the same question as a brand-new turn appended at the
// end of the conversation (not an in-place replacement) - simplest correct
// behavior without deciding what should happen to messages that came after
// the one being regenerated.
function regenerateMessage(row) {
  if (isStreaming) return;
  const question = row.dataset.question;
  if (!question) return;
  streamChatRequest(question);
}

// Continue: only offered when the last stream was cut off by max_tokens.
// Sends a short continuation nudge as the "question" (used for this turn's
// retrieval), but the model's own truncated answer is what actually lets it
// continue coherently, via the conversation memory already built into every
// /chat/stream call.
function continueMessage(row, bubble) {
  if (isStreaming) return;
  const continuationPrompt = "Continue exactly where you left off, with no repetition.";
  streamChatRequest(continuationPrompt, {
    isContinuation: true,
    row,
    bubble,
    seedText: bubble.rawText || bubble.textContent || "",
  });
}

function sendCurrentQuestion() {
  if (isStreaming) {
    currentStreamController?.abort();
    return;
  }
  const question = $("question-input").value.trim();
  if (!question) return;
  addMessage("user", question);
  $("question-input").value = "";
  autoResizeComposer();
  streamChatRequest(question);
}

$("ask-btn").onclick = sendCurrentQuestion;

$("new-chat-btn").onclick = () => {
  if (isStreaming) currentStreamController?.abort();
  sessionId = null;
  renderEmptyState();
  highlightActiveSession(null);
};

/* ===================== Composer: auto-height + keyboard shortcuts (5.3) ===================== */

function autoResizeComposer() {
  const el = $("question-input");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

$("question-input").addEventListener("input", autoResizeComposer);

$("question-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    sendCurrentQuestion();
  } else if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    // Plain Enter sends too (matches prior single-line input behavior);
    // Shift+Enter inserts a newline, Cmd/Ctrl+Enter also sends explicitly.
    e.preventDefault();
    sendCurrentQuestion();
  } else if (e.key === "Escape" && isStreaming) {
    currentStreamController?.abort();
  }
});

/* ===================== Message export (5.4) ===================== */

function downloadMarkdown(md, filenamePrefix) {
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenamePrefix}-${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

$("export-chat-btn").onclick = () => {
  const rows = $("chat-log").querySelectorAll(".msg-row");
  if (!rows.length) return;
  let md = `# Conversation export\n\n_Exported ${new Date().toLocaleString()}_\n\n`;
  rows.forEach((row) => {
    const bubble = row.querySelector(".msg-bubble");
    if (!bubble) return;
    const role = row.classList.contains("is-user") ? "You" : "Assistant";
    md += `**${role}:**\n\n${bubble.rawText || bubble.textContent}\n\n---\n\n`;
  });
  downloadMarkdown(md, "documind-conversation");
};

// Exports a saved conversation without needing to open it first - used by
// the sidebar's right-click context menu.
async function exportSessionById(id) {
  const res = await fetch(`${API_BASE_URL}/chat/sessions/${id}`, { headers: authHeaders() });
  if (!res.ok) {
    showToast("Couldn't load that conversation to export", "error");
    return;
  }
  const messages = await res.json();
  let md = `# Conversation export\n\n_Exported ${new Date().toLocaleString()}_\n\n`;
  messages.forEach((m) => {
    md += `**You:**\n\n${m.question}\n\n---\n\n**Assistant:**\n\n${m.answer}\n\n---\n\n`;
  });
  downloadMarkdown(md, "documind-conversation");
}

/* ===================== Sessions ===================== */

function highlightActiveSession(id) {
  document.querySelectorAll(".session-item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.sessionId === id);
  });
}

/* ===================== Generic context menu ===================== */

function showContextMenu(x, y, items) {
  document.querySelectorAll(".context-menu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "context-menu";
  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = `context-menu-item${item.danger ? " is-danger" : ""}`;
    btn.textContent = item.label;
    btn.onclick = () => {
      menu.remove();
      item.onClick();
    };
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
  fadeScaleIn(menu, { delay: 0 });
  setTimeout(() => {
    document.addEventListener("click", function closeMenu() {
      menu.remove();
      document.removeEventListener("click", closeMenu);
    });
  }, 0);
}

// Turns a session's title into an inline `<input>` for renaming - no modal,
// per the acceptance criteria. Enter/blur saves, Escape cancels.
function startRenameSession(el, s) {
  const titleEl = el.querySelector(".session-title");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = s.title;
  input.onclick = (e) => e.stopPropagation(); // don't open the session while editing
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = async (shouldSave) => {
    if (shouldSave) {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== s.title) {
        const res = await fetch(`${API_BASE_URL}/chat/sessions/${s.session_id}`, {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        });
        if (res.ok) {
          showToast("Conversation renamed", "success");
        } else {
          const err = await res.json().catch(() => null);
          showToast("Rename failed: " + extractErrorMessage(err, "Unknown error"), "error");
        }
      }
    }
    loadSessions(); // restores the normal view whether saved, cancelled, or failed
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.dataset.cancelled = "1";
      input.blur();
    }
  });
  input.addEventListener("blur", () => finish(input.dataset.cancelled !== "1"));
}

async function toggleSessionPin(targetSessionId, currentlyPinned) {
  const res = await fetch(`${API_BASE_URL}/chat/sessions/${targetSessionId}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ is_pinned: !currentlyPinned }),
  });
  if (res.ok) {
    showToast(currentlyPinned ? "Unpinned" : "Pinned", "success");
    loadSessions();
  } else {
    showToast("Failed to update pin state", "error");
  }
}

function renderSessionList(sessions) {
  const list = $("session-list");
  list.innerHTML = "";

  if (sessions.length === 0) {
    list.innerHTML = `<p class="empty-hint">No conversations yet.</p>`;
    return;
  }

  sessions.forEach((s, i) => {
    const el = document.createElement("div");
    el.className = "session-item";
    el.dataset.sessionId = s.session_id;
    el.innerHTML = `
      <span class="session-title">${s.is_pinned ? "📌 " : ""}${s.title}</span>
      <span class="session-meta">${fmtTime(s.updated_at)} · ${s.message_count} msg${s.message_count === 1 ? "" : "s"}</span>
      <button class="session-delete" title="Delete conversation">✕</button>
    `;
    el.onclick = () => openSession(s.session_id);
    el.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: "Rename", onClick: () => startRenameSession(el, s) },
        { label: s.is_pinned ? "Unpin" : "Pin", onClick: () => toggleSessionPin(s.session_id, s.is_pinned) },
        { label: "Export as Markdown", onClick: () => exportSessionById(s.session_id) },
        {
          label: "Delete",
          danger: true,
          onClick: () => el.querySelector(".session-delete").click(),
        },
      ]);
    };
    el.querySelector(".session-delete").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this conversation?")) return;
      const delRes = await fetch(`${API_BASE_URL}/chat/sessions/${s.session_id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (delRes.ok) {
        if (sessionId === s.session_id) $("new-chat-btn").click();
        showToast("Conversation deleted", "success");
        loadSessions();
      } else {
        showToast("Failed to delete conversation", "error");
      }
    };
    list.appendChild(el);
    fadeSlideIn(el, { delay: i * 25 });
  });

  highlightActiveSession(sessionId);
}

async function loadSessions() {
  // Skeleton placeholder while the fetch is in flight.
  $("session-list").innerHTML = `
    <div class="skeleton session-skeleton-row"></div>
    <div class="skeleton session-skeleton-row"></div>
    <div class="skeleton session-skeleton-row"></div>`;

  const res = await fetch(`${API_BASE_URL}/chat/sessions`, { headers: authHeaders() });
  if (!res.ok) return;
  cachedSessions = await res.json();
  renderSessionList(cachedSessions);
}

$("session-search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q ? cachedSessions.filter((s) => s.title.toLowerCase().includes(q)) : cachedSessions;
  renderSessionList(filtered);
});

async function openSession(id) {
  const res = await fetch(`${API_BASE_URL}/chat/sessions/${id}`, { headers: authHeaders() });
  if (!res.ok) return;
  const messages = await res.json();

  sessionId = id;
  const log = $("chat-log");
  log.innerHTML = "";
  messages.forEach((m) => {
    addMessage("user", m.question);
    // historical sources and finish_reason aren't persisted per-message, only
    // the answer text and the question - so Regenerate works after reload,
    // Continue correctly doesn't (we can't know if it was truncated).
    addMessage("assistant", m.answer, null, m.question);
  });
  highlightActiveSession(id);
}

/* ===================== Source excerpt modal ===================== */

function openSourceModal(source) {
  $("source-modal-filename").textContent = source.filename;
  $("source-modal-meta").textContent = `Document ID: ${source.document_id}`;
  const pct = Math.round(source.score * 100);
  $("source-modal-relevance-fill").style.width = `${pct}%`;
  $("source-modal-relevance-pct").textContent = `${pct}% match`;
  $("source-modal-text").textContent = source.chunk_text;
  const modal = $("source-modal");
  modal.classList.remove("hidden");
  fadeScaleIn(modal.querySelector(".modal-card"));
}

$("source-modal-close").onclick = () => $("source-modal").classList.add("hidden");
$("source-modal").addEventListener("click", (e) => {
  if (e.target === $("source-modal")) $("source-modal").classList.add("hidden");
});

/* ===================== Drag & drop uploads ===================== */

const dropzone = $("app-panel");
["dragover", "dragenter"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("is-dragging");
  });
});
["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
});
dropzone.addEventListener("drop", async (e) => {
  const files = e.dataTransfer?.files;
  if (!files || !files.length) return;
  for (const file of files) {
    await uploadFile(file);
  }
});

/* ===================== Button ripple micro-interaction ===================== */

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn");
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement("span");
  const size = Math.max(rect.width, rect.height);
  ripple.className = "btn-ripple";
  ripple.style.width = ripple.style.height = size + "px";
  ripple.style.left = e.clientX - rect.left - size / 2 + "px";
  ripple.style.top = e.clientY - rect.top - size / 2 + "px";
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 500);
});

// Point Prism's autoloader at the same CDN version used for the core script,
// so it can fetch language grammars on demand as code blocks appear.
if (window.Prism && Prism.plugins && Prism.plugins.autoloader) {
  Prism.plugins.autoloader.languages_path = "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/";
}

/* ===================== Boot ===================== */

(async function boot() {
  const handledAuthLink = await handleAuthLinkParams();
  if (!handledAuthLink && token) {
    showApp();
  } else if (!handledAuthLink) {
    showLandingView();
  }
})();
