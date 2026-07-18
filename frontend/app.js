

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

async function loadProfile() {
  const res = await fetch(`${API_BASE_URL}/auth/me`, { headers: authHeaders() });
  if (!res.ok) {
    if (res.status === 401) logout();
    return;
  }
  const user = await res.json();
  currentUserEmail = user.email;
  $("user-email-display").textContent = user.email;
  $("user-avatar-initial").textContent = user.email[0].toUpperCase();
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
        loadDocuments();
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
    $("upload-status").textContent = "Upload failed: " + extractErrorMessage(err, "Unknown error");
    return;
  }
  $("upload-status").textContent = "Uploaded — indexing in the background.";
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

function addCopyButton(row, bubble) {
  const btn = document.createElement("button");
  btn.className = "msg-copy-btn";
  btn.textContent = "Copy";
  btn.onclick = () => {
    navigator.clipboard.writeText(bubble.textContent).then(() => {
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = "Copy"; }, 1200);
    });
  };
  row.appendChild(btn);
}

function addMessage(role, text, sources) {
  const log = $("chat-log");
  const emptyState = log.querySelector(".chat-empty-state");
  if (emptyState) emptyState.remove();

  const row = document.createElement("div");
  row.className = `msg-row is-${role}`;
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  if (role === "assistant") addCopyButton(row, bubble);
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

async function streamChatRequest(question) {
  isStreaming = true;
  setAskButtonState(true);

  const { bubble, cursor } = createStreamingBubble();
  let fullText = "";
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
          bubble.textContent = fullText;
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
          addCopyButton(bubble.closest(".msg-row"), bubble);
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

$("export-chat-btn").onclick = () => {
  const rows = $("chat-log").querySelectorAll(".msg-row");
  if (!rows.length) return;
  let md = `# Conversation export\n\n_Exported ${new Date().toLocaleString()}_\n\n`;
  rows.forEach((row) => {
    const bubble = row.querySelector(".msg-bubble");
    if (!bubble) return;
    const role = row.classList.contains("is-user") ? "You" : "Assistant";
    md += `**${role}:**\n\n${bubble.textContent}\n\n---\n\n`;
  });
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `documind-conversation-${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/* ===================== Sessions ===================== */

function highlightActiveSession(id) {
  document.querySelectorAll(".session-item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.sessionId === id);
  });
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
      <span class="session-title">${s.title}</span>
      <span class="session-meta">${fmtTime(s.updated_at)} · ${s.message_count} msg${s.message_count === 1 ? "" : "s"}</span>
      <button class="session-delete" title="Delete conversation">✕</button>
    `;
    el.onclick = () => openSession(s.session_id);
    el.querySelector(".session-delete").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this conversation?")) return;
      const delRes = await fetch(`${API_BASE_URL}/chat/sessions/${s.session_id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (delRes.ok) {
        if (sessionId === s.session_id) $("new-chat-btn").click();
        loadSessions();
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
    addMessage("assistant", m.answer); // historical sources aren't stored per-message, only the answer
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

/* ===================== Boot ===================== */

(async function boot() {
  const handledAuthLink = await handleAuthLinkParams();
  if (!handledAuthLink && token) {
    showApp();
  } else if (!handledAuthLink) {
    showLandingView();
  }
})();
