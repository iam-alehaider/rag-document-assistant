# Absolute Zero Guide — CentOS 9 to Deployed Product

Follow this top to bottom. Every code block is meant to be copy-pasted exactly
as-is into your terminal. Do not skip steps.

---

## PART 1 — Set up your CentOS 9 machine

### Step 1.1 — Update system

```bash
sudo dnf update -y
```

### Step 1.2 — Install Git

```bash
sudo dnf install -y git
git --version
```

### Step 1.3 — Install Docker Engine + Docker Compose

CentOS 9 doesn't ship Docker by default, so add Docker's official repo:

```bash
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Start Docker and enable it on boot:

```bash
sudo systemctl start docker
sudo systemctl enable docker
```

Let your user run Docker without `sudo` every time:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

Verify everything works:

```bash
docker --version
docker compose version
docker run hello-world
```

You should see a "Hello from Docker!" message. If you see a permission error,
log out and log back in (or reboot), then try again.

---

## PART 2 — Get the project onto your machine

### Step 2.1 — Create a folder and unzip the project

If you downloaded `rag-saas.zip` from this chat, move it to your home folder
and unzip it:

```bash
cd ~
unzip rag-saas.zip
cd rag-saas
ls
```

You should see: `backend/`, `frontend/`, `docker-compose.yml`, `README.md`,
`monitoring/`.

### Step 2.2 (recommended) — Put it in your own GitHub repo

This makes it a real portfolio project and makes deployment easier later.

```bash
cd ~/rag-saas
git init
git add .
git commit -m "Initial commit: RAG document assistant"
```

Go to https://github.com/new, create a repo (e.g. `rag-document-assistant`),
then:

```bash
git remote add origin https://github.com/iam-alehaider/rag-document-assistant.git
git branch -M main
git push -u origin main
```

---

## PART 3 — Get your one free API key (Groq)

You need exactly one key to run this locally. Everything else is optional
until you deploy to the cloud.

1. Go to **https://console.groq.com**
2. Sign up (free, no credit card).
3. Click **API Keys** in the left sidebar → **Create API Key**.
4. Copy the key (starts with `gsk_...`). You will not be able to see it again,
   so paste it somewhere safe temporarily.

---

## PART 4 — Run the whole app locally

### Step 4.1 — Set your Groq key as an environment variable

```bash
cd ~/rag-saas
export GROQ_API_KEY=gsk_paste_your_key_here
```

(Tip: if you close the terminal, you'll need to re-run this `export` line
before starting the app again. To make it permanent, add that line to
`~/.bashrc`.)

### Step 4.2 — Start everything with one command

```bash
docker compose up --build
```

The first run takes a few minutes (it downloads Python packages and the
embedding model). Wait until you see a line like:

```
backend-1  | INFO:     Uvicorn running on http://0.0.0.0:8000
```

Leave this terminal running. This started 4 containers: the backend API,
Postgres, Qdrant (vector DB), and Redis — all running locally and free.

### Step 4.3 — Open the frontend

Open a **second terminal** (don't close the first one):

```bash
cd ~/rag-saas/frontend
python3 -m http.server 5500
```

Now open a browser on the same machine and go to:

```
http://localhost:5500
```

### Step 4.4 — Use the app

1. Click **Register**, enter any email + a password (8+ characters), click Register.
2. Switch to **Login**, log in with the same email/password.
3. On the left, choose a PDF or .txt file and click **Upload**. Wait for
   "Indexed successfully."
4. Type a question about the document in the box at the bottom and press
   Enter or click **Ask**.

You now have a fully working RAG product running entirely on your laptop,
for free.

### Step 4.5 — Stop everything

In the first terminal, press `Ctrl+C`, then:

```bash
docker compose down
```

(Add `-v` at the end — `docker compose down -v` — if you also want to wipe
the local database/vector data and start completely fresh next time.)

---

## PART 5 — Deploy it to the real internet, for free

This makes the app live at a public URL anyone can use, not just on your
laptop. You'll use four free services total.

### Step 5.1 — Create your free cloud accounts

Open these four sites and sign up (all free, no credit card required for the
free tiers used here):

1. **https://qdrant.io → Cloud** — for the vector database
2. **https://supabase.com** — for the Postgres database
3. **https://render.com** — for hosting your backend API
4. **https://vercel.com** — for hosting your frontend

Sign up to all four with your GitHub account if possible — it makes linking
repos later much faster.

### Step 5.2 — Create your free Qdrant Cloud cluster

1. Log into https://cloud.qdrant.io
2. Click **Create Cluster** → pick the **Free tier** (1GB).
3. Once it's created, click on the cluster → copy the **Cluster URL**
   (looks like `https://xxxx-xxxx.aws.cloud.qdrant.io`).
4. Go to **API Keys** → **Create API Key** → copy it.

Keep both values — you'll paste them into Render in Step 5.5.

### Step 5.3 — Create your free Supabase Postgres database

1. Log into https://supabase.com/dashboard
2. Click **New Project** → name it `rag-assistant` → set a database password
   (write it down) → choose the free plan → **Create new project**. Wait ~2
   minutes while it provisions.
3. Once ready, go to **Project Settings** (gear icon) → **Database** →
   scroll to **Connection string** → select **URI** format.
4. Copy it — it looks like:
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxx.supabase.co:5432/postgres`
5. Replace `[YOUR-PASSWORD]` with the database password you set in step 2.

Keep this full string — you'll paste it into Render next.

### Step 5.4 — Push your code to GitHub (if you haven't already)

```bash
cd ~/rag-saas
git add .
git commit -m "Ready for deployment"
git push
```

### Step 5.5 — Deploy the backend to Render

1. Log into https://dashboard.render.com
2. Click **New** → **Web Service**.
3. Connect your GitHub account, then select your `rag-document-assistant` repo.
4. Fill in:
   - **Name**: `rag-backend`
   - **Root Directory**: `backend`
   - **Environment**: Docker (Render auto-detects the `Dockerfile`)
   - **Instance Type**: Free
5. Scroll to **Environment Variables** and add each of these (click "Add
   Environment Variable" for each):

   | Key | Value |
   |---|---|
   | `SECRET_KEY` | any long random string, e.g. `openssl rand -hex 32` output |
   | `DATABASE_URL` | the Supabase connection string from Step 5.3 |
   | `QDRANT_URL` | the Qdrant cluster URL from Step 5.2 |
   | `QDRANT_API_KEY` | the Qdrant API key from Step 5.2 |
   | `GROQ_API_KEY` | your Groq key from Part 3 |
   | `GROQ_MODEL` | `llama-3.1-70b-versatile` |
   | `ALLOWED_ORIGINS` | `*` (tighten this to your Vercel URL after Step 5.6) |

   To generate a random `SECRET_KEY` value, run this on your CentOS machine:
   ```bash
   openssl rand -hex 32
   ```

6. Click **Create Web Service**. Render will build the Docker image and
   deploy it — this takes 5-10 minutes the first time.
7. Once live, copy your backend's URL from the top of the Render dashboard,
   e.g. `https://rag-backend.onrender.com`.

**Free tier note**: the service goes to sleep after 15 minutes of no traffic
and takes ~30 seconds to wake up on the next request. That's normal and fine
for a portfolio project.

### Step 5.6 — Deploy the frontend to Vercel

First, point the frontend at your live backend instead of localhost:

```bash
cd ~/rag-saas/frontend
```

Edit `index.html` and add this line right before `<script src="config.js">`:

```html
<script>window.RAG_API_BASE_URL = "https://rag-backend.onrender.com";</script>
```

(Replace the URL with your actual Render URL from Step 5.5.)

Commit and push:

```bash
cd ~/rag-saas
git add .
git commit -m "Point frontend at live backend"
git push
```

Now deploy on Vercel:

1. Log into https://vercel.com/new
2. Import your `rag-document-assistant` GitHub repo.
3. Set **Root Directory** to `frontend`.
4. Framework Preset: **Other** (no build step needed).
5. Click **Deploy**.
6. Once done, Vercel gives you a live URL like
   `https://rag-document-assistant.vercel.app` — this is your public app.

### Step 5.7 — Lock down CORS (recommended)

Go back to Render → your backend service → Environment → edit
`ALLOWED_ORIGINS` → set it to your exact Vercel URL (e.g.
`https://rag-document-assistant.vercel.app`) instead of `*`. Save — Render
will redeploy automatically.

---

## PART 6 — Where and how to actually use it

- **Share the Vercel URL** with anyone — that's your live product. They can
  register, upload documents, and chat, independent of your laptop.
- **Put the Vercel URL + GitHub repo link on your resume/LinkedIn/portfolio**
  as a live demo of a production RAG system you built and deployed solo.
- **Keep developing locally**: make changes in `~/rag-saas`, test with
  `docker compose up --build`, then `git push` — Vercel auto-redeploys on every
  push once the repo is connected; for Render, either enable auto-deploy on
  push (Settings → Auto-Deploy → Yes) or redeploy manually from the dashboard.

---

## Troubleshooting quick reference

| Problem | Fix |
|---|---|
| `docker: permission denied` | Run `newgrp docker` or log out/in after Step 1.3 |
| `docker compose up` fails to pull images | Check internet connection; retry |
| Backend container keeps restarting | Run `docker compose logs backend` to see the error |
| Frontend shows "Login failed" | Make sure the backend container is actually running and `config.js` / the inline script points to the right URL |
| Render deploy fails | Check the **Logs** tab on Render — usually a missing environment variable |
| Groq API errors | Double check `GROQ_API_KEY` has no extra spaces and is the full key |
