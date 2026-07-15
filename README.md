
# DocuMind — RAG document assistant

Users register (with email verification), upload PDFs/text documents, and ask
questions answered only from their own documents, with sources cited. Built
with real production patterns — auth, structured logging, metrics, rate
limiting, background jobs — on a 100% free-tier stack.

**Live demo:** `https://your-project.vercel.app` ← replace with your actual URL

---

## Screenshots

> **How to add these:** in your local project folder, create a folder called
> `docs/screenshots/`, drop your PNG/JPG files in there (e.g. `login.png`,
> `chat.png`, `documents.png`), commit and push them like any other file
> (`git add docs/screenshots/*.png`). GitHub renders images referenced from
> the repo automatically — the paths below already point at that folder, so
> once you push matching filenames they'll show up here.

| Login / Register | Chat with sources | Document management |
|---|---|---|
| ![Login](docs/screenshots/login.png) | ![Chat](docs/screenshots/chat.png) | ![Documents](docs/screenshots/documents.png) |

---

## Architecture

```
Browser --> Frontend (Vercel, static)
             --> Backend API (Render, FastAPI)
                   --> Qdrant Cloud   (vector search)
                   --> Supabase       (Postgres: users, documents, chat logs)
                   --> Groq API       (LLM inference)
                   --> Resend         (verification / password-reset email)
```

- **Embeddings** run locally in the backend container (`fastembed`, ONNX) — no embedding API cost.
- **LLM inference** via Groq's free tier.
- **Vector DB**: Qdrant Cloud free tier (1GB).
- **Postgres**: Supabase free tier (500MB).
- **Transactional email**: Resend free tier (3,000 emails/month).

## Features

- JWT auth with hashed passwords (bcrypt)
- **Email verification required before login** (Resend-powered)
- **Forgot / reset password** flow
- **Terms of Service + Privacy Policy acceptance** required at signup
- Multi-tenant — every document and vector scoped by `owner_id`
- Chat history — every conversation saved and revisitable, deletable
- Document management — upload, scope chat to one doc, delete
- Source citations — click a source to see the full excerpt + relevance score
- Structured JSON logs + Prometheus `/metrics`
- Rate limiting on auth (10/min) and chat (20/min) endpoints
- Background document processing (upload returns instantly, indexing happens after)
- Alembic migrations — versioned schema changes, not `create_all()`

---

## Part 1 — Run it locally

Requirements: Docker + Docker Compose.

```bash
git clone https://github.com/YOUR_USERNAME/rag-document-assistant.git
cd rag-document-assistant

# Only one key is required to run locally — Groq, for the LLM.
export GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx

docker compose up --build
```

Then, in a second terminal:

```bash
cd frontend
python3 -m http.server 5500
```

Open `http://localhost:5500` → register → check the terminal logs for the
verification link (since `RESEND_API_KEY` isn't set locally, the app logs
the email content instead of sending it) → paste the link into your browser
to verify → log in.

Interactive API docs: `http://localhost:8000/docs`

---

## Part 2 — Get your free API keys

### 1. Groq (LLM)
`console.groq.com` → API Keys → Create. Free, no card.

### 2. Qdrant Cloud (vector DB)
`cloud.qdrant.io` → Create Cluster → Free tier (1GB) → copy the **Cluster URL** and create an **API Key**.

### 3. Supabase (Postgres)
`supabase.com/dashboard` → New Project → free tier → wait ~2 min → **Project Settings → Database → Connection string** → use the **Transaction pooler** URI (not the direct-connection one), it looks like:
```
postgresql://postgres.xxxxxxxx:[YOUR-PASSWORD]@aws-0-REGION.pooler.supabase.com:6543/postgres
```

### 4. Resend (transactional email)
`resend.com` → sign up (free, no card) → **API Keys** → **Create API Key** → copy it.

**What to put where:**

| Resend setting | What to enter |
|---|---|
| API Key | Paste into Render as `RESEND_API_KEY` (see Part 3) |
| Sender (`EMAIL_FROM`) without a domain | `DocuMind <onboarding@resend.dev>` — Resend's shared sandbox sender |
| Sender (`EMAIL_FROM`) with a domain you own | `DocuMind <noreply@yourdomain.com>` — only works after verifying the domain below |

**Sandbox limitation:** without verifying a domain, Resend's sandbox sender
only delivers to the email address on your own Resend account — not to
arbitrary users. Fine for testing, not fine for real users. To fix that,
verify a domain:

#### If your domain is on Namecheap
1. Resend dashboard → **Domains** → **Add Domain** → enter your domain (e.g. `yourdomain.com`) → Resend shows you 3–4 DNS records (usually `TXT`, `MX`, and 1–3 `CNAME` records for DKIM).
2. Log into **Namecheap** → **Domain List** → click **Manage** next to your domain → **Advanced DNS** tab.
3. Click **Add New Record** for each row Resend gave you — match the **Type** (TXT/MX/CNAME), **Host**, and **Value** exactly. For Namecheap, the "Host" field usually just needs the subdomain part (e.g. `resend._domainkey`), not the full domain.
4. Save, then go back to Resend and click **Verify DNS Records**. DNS propagation can take a few minutes up to a few hours.
5. Once verified, update `EMAIL_FROM` in Render to use `@yourdomain.com`.

#### If your domain is on AWS (Route 53)
1. Resend dashboard → **Domains** → **Add Domain** → copy the DNS records shown.
2. AWS Console → **Route 53** → **Hosted zones** → click your domain.
3. **Create record** for each entry Resend gave you — set the **Record type** (TXT/MX/CNAME) and **Value** exactly as shown. Leave the record name as just the subdomain part Resend specifies (Route 53 appends your zone's domain automatically).
4. Save, then click **Verify DNS Records** in Resend. AWS DNS usually propagates within minutes.
5. Update `EMAIL_FROM` in Render to `@yourdomain.com` once verified.

---

## Part 3 — Deploy to the internet, for free

### Backend → Render

1. Push this repo to GitHub (see **Part 4** below if you haven't yet).
2. `render.com` → **New** → **Web Service** → connect your GitHub repo.
3. **Root Directory**: `backend`. Render auto-detects the Dockerfile.
4. **Environment Variables** — add every one of these:

| Key | Value |
|---|---|
| `SECRET_KEY` | random string — generate with `openssl rand -hex 32` |
| `DATABASE_URL` | Supabase pooler connection string from Part 2 |
| `QDRANT_URL` | Qdrant cluster URL from Part 2 |
| `QDRANT_API_KEY` | Qdrant API key from Part 2 |
| `GROQ_API_KEY` | Groq key from Part 2 |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `ALLOWED_ORIGINS` | `*` for now, tighten after Vercel is live (see below) |
| `RESEND_API_KEY` | Resend key from Part 2 |
| `EMAIL_FROM` | `DocuMind <onboarding@resend.dev>` (or your verified domain) |
| `FRONTEND_URL` | your Vercel URL — set this *after* deploying the frontend below |

5. **Create Web Service** — first build takes 5–10 min.
6. Copy the generated URL, e.g. `https://rag-backend.onrender.com`.

> Free tier note: sleeps after 15 min idle, ~30s to wake on next request. Normal.

### Frontend → Vercel

1. In `frontend/index.html`, confirm this line points at your Render URL:
   ```html
   <script>window.RAG_API_BASE_URL = "https://rag-backend.onrender.com";</script>
   ```
2. `vercel.com/new` → import your GitHub repo → **Root Directory**: `frontend` → Framework Preset: **Other** → **Deploy**.
3. Copy your live URL, e.g. `https://rag-document-assistant.vercel.app`.

### Finish wiring the two together

Go back to **Render** → your backend → **Environment**:
- Set `FRONTEND_URL` to your exact Vercel URL (verification/reset email links point here).
- Set `ALLOWED_ORIGINS` to your exact Vercel URL instead of `*` (locks down CORS).

Save — Render redeploys automatically.

---

## Part 4 — Push your code (Git workflow)

**First time pushing this project:**
```bash
cd ~/rag-saas
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/rag-document-assistant.git
git branch -M main
git push -u origin main
```

**Every time after you make changes (including adding screenshots):**
```bash
cd ~/rag-saas
git add .
git commit -m "Describe what changed here"
git push
```

That's it — Vercel and Render both auto-redeploy on every push to `main`
once they're connected to the repo (Render: confirm **Settings → Auto-Deploy**
is **On**).

---

## Post-deploy checklist

- [ ] Register with a real email you can check
- [ ] Verify email arrived (check spam folder too) and the link logs you in
- [ ] If using an existing test account from before this update, run once in Supabase SQL Editor:
      ```sql
      UPDATE users SET is_verified = true WHERE created_at < now();
      ```
- [ ] Try "Forgot password" end to end
- [ ] Upload a document, confirm status flips to `ready`
- [ ] Ask a question, click a source pill to confirm the excerpt modal works
- [ ] Update `terms.html` / `privacy.html` — replace `[YOUR COMPANY]`, `[JURISDICTION]`, `[YOUR CONTACT EMAIL]` placeholders (these are templates, not legal advice — have them reviewed by a lawyer before serving real/international users)

---

## Environment variables reference

| Key | Where | Purpose |
|---|---|---|
| `SECRET_KEY` | Render | Signs JWTs |
| `DATABASE_URL` | Render | Postgres connection (Supabase) |
| `QDRANT_URL` / `QDRANT_API_KEY` | Render | Vector store |
| `GROQ_API_KEY` / `GROQ_MODEL` | Render | LLM inference |
| `ALLOWED_ORIGINS` | Render | CORS — your Vercel URL |
| `RESEND_API_KEY` / `EMAIL_FROM` | Render | Sends verification/reset emails |
| `FRONTEND_URL` | Render | Base URL used inside email links |
| `RAG_API_BASE_URL` | `frontend/index.html` (inline script) | Where the frontend calls the backend |

---

## Project structure

```
rag-saas/
├── docs/
│   └── screenshots/          # put your README images here
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── auth.py
│   │   ├── email.py           # Resend integration
│   │   ├── db.py
│   │   ├── models.py
│   │   ├── metrics.py
│   │   ├── logging_config.py
│   │   ├── rag/
│   │   └── api/
│   │       ├── routes_auth.py     # register, login, verify, reset
│   │       ├── routes_documents.py
│   │       ├── routes_chat.py
│   │       └── routes_health.py
│   ├── migrations/
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── config.js
│   ├── style.css
│   ├── terms.html
│   └── privacy.html
├── monitoring/
└── docker-compose.yml
```

---

## Roadmap — not yet built

- OAuth (Google sign-in)
- 2FA/MFA
- Billing/subscriptions (Stripe)
- Admin dashboard
- Error monitoring (Sentry)
- Object storage for original PDFs
- Celery/RQ task queue (replacing in-process `BackgroundTasks`)
- Hybrid search (BM25 + vector + reranker)
- Streaming chat responses
- Kubernetes + Terraform + ArgoCD

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Illegal header value ...\n` in Render logs | An env var (API key/URL) has a trailing newline from copy-paste. Re-paste it carefully, don't press Enter in the field. |
| Login says "verify your email" but no email arrived | Check spam. Confirm `RESEND_API_KEY` is set and correct. If using the sandbox sender, it only delivers to your own Resend account email. |
| `password authentication failed` (Postgres) | Use the **Transaction pooler** connection string from Supabase, not the direct one — see Part 2. |
| Frontend shows "Failed to fetch" | Confirm `RAG_API_BASE_URL` in `index.html` points to your live Render URL, not `localhost`. |
| Groq model errors (`decommissioned`) | Groq periodically retires models — check `console.groq.com/docs/deprecations` and update `GROQ_MODEL`. |
