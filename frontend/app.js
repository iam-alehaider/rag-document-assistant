let mode = "login"; // or "register"
let token = localStorage.getItem("rag_token") || null;
let sessionId = null;
let activeDocId = null;
let pollTimer = null;

const $ = (id) => document.getElementById(id);

// FastAPI validation errors (422) return `detail` as an array of objects,
// e.g. [{"loc":["body","password"],"msg":"String should have at least 8 characters",...}]
// while most other errors return `detail` as a plain string. This normalizes
// either shape into a readable message instead of "[object Object]".
function extractErrorMessage(err, fallback) {
  if (!err) return fallback;
  const detail = err.detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg || JSON.stringify(d)).join(", ");
  }
  if (typeof detail === "string") return detail;
  return fallback;
}

function setMode(newMode) {
  mode = newMode;
  $("tab-login").className = mode === "login" ? "px-3 py-1 rounded bg-indigo-600" : "px-3 py-1 rounded bg-slate-800";
  $("tab-register").className = mode === "register" ? "px-3 py-1 rounded bg-indigo-600" : "px-3 py-1 rounded bg-slate-800";
  $("auth-submit").textContent = mode === "login" ? "Login" : "Register";
}

$("tab-login").onclick = () => setMode("login");
$("tab-register").onclick = () => setMode("register");

$("auth-submit").onclick = async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  $("auth-error").textContent = "";

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
      $("auth-error").textContent = "Registered! Now log in.";
      $("auth-error").className = "text-green-400 text-sm mt-2";
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
    $("auth-error").textContent = err.message;
    $("auth-error").className = "text-red-400 text-sm mt-2";
  }
};

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

async function showApp() {
  $("auth-panel").classList.add("hidden");
  $("app-panel").classList.remove("hidden");
  $("auth-status").textContent = "Logged in";
  await loadDocuments();
}

function statusBadge(status) {
  if (status === "ready") return `<span class="text-xs text-green-400">ready</span>`;
  if (status === "failed") return `<span class="text-xs text-red-400">failed</span>`;
  return `<span class="text-xs text-amber-400">processing…</span>`;
}

async function loadDocuments() {
  const res = await fetch(`${API_BASE_URL}/documents`, { headers: authHeaders() });
  if (!res.ok) return;
  const docs = await res.json();
  const list = $("doc-list");
  list.innerHTML = "";

  let anyProcessing = false;

  docs.forEach((doc) => {
    if (doc.status === "processing") anyProcessing = true;
    const el = document.createElement("div");
    el.className = "px-2 py-1 rounded bg-slate-800 cursor-pointer hover:bg-slate-700 flex justify-between items-center";
    el.innerHTML = `<span class="truncate">${doc.filename}</span>${statusBadge(doc.status)}`;
    el.onclick = () => {
      if (doc.status !== "ready") return;
      activeDocId = doc.id;
      addMessage("system", `Scoped to: ${doc.filename}`);
    };
    list.appendChild(el);
  });

  // Poll every 3s while anything is still processing, so status flips to
  // "ready" without the user needing to refresh.
  if (anyProcessing && !pollTimer) {
    pollTimer = setInterval(async () => {
      await loadDocuments();
    }, 3000);
  } else if (!anyProcessing && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

$("upload-btn").onclick = async () => {
  const file = $("file-input").files[0];
  if (!file) return;
  $("upload-status").textContent = "Uploading...";

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
};

function addMessage(role, text, sources) {
  const log = $("chat-log");
  const bubble = document.createElement("div");
  const isUser = role === "user";
  bubble.className = isUser
    ? "self-end bg-indigo-600 rounded-lg px-4 py-2 max-w-lg"
    : "self-start bg-slate-800 rounded-lg px-4 py-2 max-w-lg";
  bubble.textContent = text;
  log.appendChild(bubble);

  if (sources && sources.length) {
    const src = document.createElement("div");
    src.className = "self-start text-xs text-slate-500 max-w-lg";
    src.textContent = "Sources: " + sources.map((s) => `${s.filename} (${(s.score * 100).toFixed(0)}%)`).join(", ");
    log.appendChild(src);
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
  sessionId = data.session_id;
  addMessage("assistant", data.answer, data.sources);
};

$("question-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("ask-btn").click();
});

// Auto-login if token already stored
if (token) showApp();
