let mode = "login"; // or "register" - only meaningful within the login/register view
let token = localStorage.getItem("rag_token") || null;
let sessionId = null;
let activeDocId = null;
let pollTimer = null;

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

/* ===================== Auth view switching ===================== */

function showAuthView(view) {
  // view: "login" | "register" | "forgot" | "reset"
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

$("question-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("ask-btn").click();
});

function logout() {
  localStorage.removeItem("rag_token");
  token = null;
  sessionId = null;
  activeDocId = null;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  $("app-panel").classList.add("hidden");
  $("auth-panel").classList.remove("hidden");
  showAuthView("login");
  $("email").value = "";
  $("password").value = "";
}

/* ===================== App shell ===================== */

async function showApp() {
  $("auth-panel").classList.add("hidden");
  $("app-panel").classList.remove("hidden");
  await Promise.all([loadProfile(), loadDocuments(), loadSessions()]);
}

async function loadProfile() {
  const res = await fetch(`${API_BASE_URL}/auth/me`, { headers: authHeaders() });
  if (!res.ok) {
    if (res.status === 401) logout();
    return;
  }
  const user = await res.json();
  $("user-email-display").textContent = user.email;
  $("user-avatar-initial").textContent = user.email[0].toUpperCase();
}

$("user-menu-btn").onclick = (e) => {
  e.stopPropagation();
  $("user-menu-dropdown").classList.toggle("hidden");
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

function statusLabel(status) {
  return status === "ready" ? "ready" : status === "failed" ? "failed" : "processing…";
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

  docs.forEach((doc) => {
    if (doc.status === "processing") anyProcessing = true;
    const el = document.createElement("div");
    el.className = `doc-item ${statusClass(doc.status)}${doc.id === activeDocId ? " is-scoped" : ""}`;
    el.innerHTML = `
      <span class="doc-name" title="${doc.filename}">${doc.filename}</span>
      <span class="doc-status ${statusClass(doc.status)}">${statusLabel(doc.status)}</span>
      <button class="doc-delete" title="Delete document">✕</button>
    `;
    el.querySelector(".doc-name").onclick = () => {
      if (doc.status !== "ready") return;
      activeDocId = activeDocId === doc.id ? null : doc.id;
      $("scope-label").textContent = activeDocId ? doc.filename : "All documents";
      loadDocuments();
    };
    el.querySelector(".doc-status").onclick = el.querySelector(".doc-name").onclick;
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
  });

  if (anyProcessing && !pollTimer) {
    pollTimer = setInterval(loadDocuments, 3000);
  } else if (!anyProcessing && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

$("upload-btn").onclick = async () => {
  const file = $("file-input").files[0];
  if (!file) return;
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
  $("file-input").value = "";
  await loadDocuments();
};

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
  log.scrollTop = log.scrollHeight;
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
  log.appendChild(row);

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
  log.scrollTop = log.scrollHeight;
  return { bubble, cursor };
}

function setAskButtonState(streaming) {
  const btn = $("ask-btn");
  btn.textContent = streaming ? "Stop" : "Ask";
  btn.classList.toggle("btn-secondary", streaming);
  btn.classList.toggle("btn-primary", !streaming);
}

async function streamChatRequest(question) {
  isStreaming = true;
  setAskButtonState(true);

  const { bubble, cursor } = createStreamingBubble();
  let fullText = "";
  let statusNoted = false;

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

        if (event.type === "status" && !statusNoted) {
          bubble.insertBefore(document.createTextNode(event.message + " "), cursor);
          statusNoted = true;
        } else if (event.type === "sources") {
          pendingSources = event.sources;
        } else if (event.type === "token") {
          if (statusNoted) {
            // Clear the transient "Searching documents..." note once real content starts.
            bubble.textContent = "";
            bubble.appendChild(cursor);
            statusNoted = false;
          }
          fullText += event.text;
          bubble.textContent = fullText;
          bubble.appendChild(cursor);
          $("chat-log").scrollTop = $("chat-log").scrollHeight;
        } else if (event.type === "warning") {
          bubble.insertBefore(document.createTextNode(event.message + " "), cursor);
        } else if (event.type === "error") {
          cursor.remove();
          bubble.textContent = fullText || event.message;
        } else if (event.type === "done") {
          cursor.remove();
          sessionId = event.session_id;
          if (pendingSources) renderSourcePills(pendingSources);
          if (isNewSession) loadSessions();
        }
      }
    }
  } catch (err) {
    // AbortError happens when the person clicks Stop - keep whatever
    // partial text has streamed in rather than treating it as a failure.
    cursor.remove();
    if (err.name !== "AbortError") {
      bubble.textContent = fullText || "Something went wrong while streaming the answer.";
    }
  } finally {
    isStreaming = false;
    currentStreamController = null;
    setAskButtonState(false);
  }
}

$("ask-btn").onclick = () => {
  if (isStreaming) {
    currentStreamController?.abort();
    return;
  }
  const question = $("question-input").value.trim();
  if (!question) return;
  addMessage("user", question);
  $("question-input").value = "";
  streamChatRequest(question);
};

$("new-chat-btn").onclick = () => {
  if (isStreaming) currentStreamController?.abort();
  sessionId = null;
  $("chat-log").innerHTML = `
    <div class="chat-empty-state">
      <div class="chat-empty-icon">💬</div>
      <h2>Ask something about your documents</h2>
      <p>Upload a PDF or text file on the left, then ask a question. Answers are grounded only in what you've uploaded.</p>
    </div>`;
  highlightActiveSession(null);
};

/* ===================== Sessions ===================== */

function highlightActiveSession(id) {
  document.querySelectorAll(".session-item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.sessionId === id);
  });
}

async function loadSessions() {
  const res = await fetch(`${API_BASE_URL}/chat/sessions`, { headers: authHeaders() });
  if (!res.ok) return;
  const sessions = await res.json();
  const list = $("session-list");
  list.innerHTML = "";

  if (sessions.length === 0) {
    list.innerHTML = `<p class="empty-hint">No conversations yet.</p>`;
    return;
  }

  sessions.forEach((s) => {
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
  });

  highlightActiveSession(sessionId);
}

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
  $("source-modal").classList.remove("hidden");
}

$("source-modal-close").onclick = () => $("source-modal").classList.add("hidden");
$("source-modal").addEventListener("click", (e) => {
  if (e.target === $("source-modal")) $("source-modal").classList.add("hidden");
});

/* ===================== Boot ===================== */

(async function boot() {
  const handledAuthLink = await handleAuthLinkParams();
  if (!handledAuthLink && token) {
    showApp();
  } else if (!handledAuthLink) {
    showAuthView("login");
  }
})();
