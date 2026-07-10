
let mode = "login"; // or "register"
let token = localStorage.getItem("rag_token") || null;
let sessionId = null;
let activeDocId = null;
let pollTimer = null;
let lastSources = []; // sources for the most recently rendered assistant message, keyed for modal lookup

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

/* ===================== Auth ===================== */

function setMode(newMode) {
  mode = newMode;
  $("tab-login").classList.toggle("is-active", mode === "login");
  $("tab-register").classList.toggle("is-active", mode === "register");
  $("auth-submit").textContent = mode === "login" ? "Sign in" : "Create account";
}

$("tab-login").onclick = () => setMode("login");
$("tab-register").onclick = () => setMode("register");

$("auth-submit").onclick = async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  const msg = $("auth-error");
  msg.textContent = "";
  msg.className = "auth-message";

  try {
    if (mode === "register") {
      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(extractErrorMessage(err, "Registration failed"));
      }
      setMode("login");
      msg.textContent = "Account created — sign in below.";
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
      throw new Error(extractErrorMessage(err, "Login failed"));
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

  if (sources && sources.length) {
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
  }

  log.scrollTop = log.scrollHeight;
}

$("ask-btn").onclick = async () => {
  const question = $("question-input").value.trim();
  if (!question) return;
  addMessage("user", question);
  $("question-input").value = "";

  const res = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ question, document_id: activeDocId, session_id: sessionId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    addMessage("system", "Error: " + extractErrorMessage(err, "Unknown error"));
    return;
  }

  const data = await res.json();
  const isNewSession = !sessionId;
  sessionId = data.session_id;
  addMessage("assistant", data.answer, data.sources);
  if (isNewSession) loadSessions();
};

$("new-chat-btn").onclick = () => {
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

if (token) showApp();
