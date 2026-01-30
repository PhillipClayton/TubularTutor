# TubularTutor
AI chatbot for K-12 tutoring without revealing answers.

## API (TheLearningMatrix)

The server exposes an API for auth, students, progress, and admin. TheLearningMatrix uses the same backend.

- **Base URL (production):** `https://tubulartutor.onrender.com`
- **Local:** `http://localhost:3000`

---

## Full setup: GitHub, Neon, and Render

This is the simplest path to a live app: code on **GitHub**, persistent Postgres on **Neon** (free, no 90-day deletion), and the API running on **Render**.

### 1. GitHub

1. Create a repo on [github.com](https://github.com) (e.g. `TubularTutor`).
2. Clone it locally, copy your TubularTutor code into it, then:
   ```bash
   git add .
   git commit -m "Initial TubularTutor app"
   git push -u origin main
   ```
   (Use `master` if that’s your default branch.)  
   If the repo already exists and you’re just pushing updates, use your usual `git push`.

### 2. Neon (database)

1. Sign up at [neon.tech](https://neon.tech).
2. **Create a project** (e.g. `tubulartutor`). Neon creates a database and a connection string.
3. In the dashboard, open your project and copy the **connection string** (URI format, e.g. `postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`).  
   You’ll use this as `DATABASE_URL` in the next step and (optionally) locally for seeding.

### 3. Render (web service)

1. Go to [render.com](https://render.com) and log in. Connect your **GitHub** account if you haven’t.
2. Click **New** → **Web Service**.
3. Select your **TubularTutor** repo. Use the same branch you push to (e.g. `main`).
4. Configure the service:
   - **Name:** e.g. `tubulartutor`
   - **Region:** pick one close to you or your users
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Open **Environment** (or **Advanced** → **Environment Variables**) and add:

   | Key             | Value |
   |-----------------|--------|
   | `DATABASE_URL`  | The Neon connection string from step 2 |
   | `JWT_SECRET`    | A long random string (e.g. run `openssl rand -hex 32` and paste the output) |
   | `GEMINI_API_KEY`| Your Gemini API key (for the `/ask` chatbot) |

   Save. Render will treat these as secret.

6. Click **Create Web Service**. Render builds and deploys; the first deploy may take a few minutes.
7. After the first successful deploy, your API is live at `https://<your-service-name>.onrender.com`.

### 4. Seed the database (once)

You need to run the seed script once so the app has an admin user, courses, and sample students.

**Option A – From your machine (recommended)**  
Set `DATABASE_URL` in your local `.env` to the **same** Neon connection string you used on Render. Then in the repo:

```bash
npm install
npm run seed
```

**Option B – From Render**  
In the Render dashboard, open your Web Service → **Shell**. In the shell run:

```bash
npm run seed
```

When seeding finishes, you’re done. The app uses GitHub for code, Neon for persistent Postgres, and Render to serve the API. TheLearningMatrix (or any client) can call `https://<your-service-name>.onrender.com` when not on localhost.

---

## Running PostgreSQL locally (test before committing)

To test the app against a real Postgres DB on your machine (no cloud, no account), run Postgres in Docker or install it with Homebrew.

**Option A: Docker (recommended for local development)**

1. Start PostgreSQL with Docker Compose (creates a DB named `postgres`, user `postgres`, password `local`, data in a named volume):
   ```bash
   docker compose up -d
   ```
   If you previously ran a one-off `docker run` for Postgres, remove the old container first: `docker rm -f tubulartutor-db`.
2. Copy `.env.example` to `.env` and set:
   ```text
   DATABASE_URL=postgresql://postgres:local@localhost:5432/postgres
   JWT_SECRET=any-random-string-for-local-only
   ```
3. Run `npm install`, `npm run seed`, then `npm start`. The app will create tables and seed data in this local DB.
4. To stop the DB: `docker compose down`. To stop but keep data: `docker compose stop`. To start again: `docker compose up -d`.
5. To wipe the DB and start fresh: `docker compose down -v` (removes the volume), then `docker compose up -d` and `npm run seed` again.

**Option B: Homebrew on macOS**

1. Install and start Postgres:
   ```bash
   brew install postgresql@16
   brew services start postgresql@16
   ```
2. Create a database (optional; you can use the default `postgres` DB):
   ```bash
   createdb tubulartutor
   ```
3. In `.env` set:
   ```text
   DATABASE_URL=postgresql://localhost:5432/tubulartutor
   ```
   (If your macOS user is your Postgres user, you often don’t need a password for local connections. If you do, use `postgresql://user:password@localhost:5432/tubulartutor`.)
4. Run `npm run seed` then `npm start`.

Using a **local** DB keeps your tests off the cloud and lets you try changes before pushing or connecting to a hosted DB.

---

## Deploying to Render (step-by-step)

### 1. Create a PostgreSQL database

You need a PostgreSQL database that **persists** (Render’s free web services have an ephemeral filesystem, so the app cannot use a local SQLite file).

**Render free Postgres** is deleted after 90 days on the free tier. If you want a **free DB that won’t be deleted**, use one of the options below instead; you can still run the TubularTutor **web service** on Render and point it at that external DB.

**Option A: Render Postgres (same account, 90-day limit on free tier)**

1. Log in at [render.com](https://render.com).
2. Click **New** → **PostgreSQL**.
3. Name it (e.g. `tubulartutor-db`), choose a region, and create.
4. In the database’s **Info** tab, find **Internal Database URL**. It looks like:
   ```text
   postgresql://user:password@hostname/dbname?option=value
   ```
5. Copy that URL; this is your `DATABASE_URL`.  
   Note: free instances are removed after 90 days; use Neon or Supabase if you need a long-lived free DB.

**Option B: Neon (free tier, no automatic deletion)**

1. Sign up at [neon.tech](https://neon.tech).
2. Create a project and a database.
3. In the dashboard, copy the **connection string**. Use it as `DATABASE_URL` in Render’s Environment (and locally if you seed from your machine).  
   Neon’s free tier does not delete your database after a set period; it stays as long as the project exists.

**Option C: Supabase (free tier, no automatic deletion)**

1. Sign up at [supabase.com](https://supabase.com).
2. Create a project; it comes with a Postgres database.
3. In **Project Settings** → **Database**, copy the **Connection string** (URI format). Use it as `DATABASE_URL`.  
   Supabase’s free tier keeps your project/DB; no time-based deletion.

---

### 2. Set JWT_SECRET

The app signs login tokens with a secret. It must be the same on every run and **never** shared or committed.

- **Generate a random value** (one option):
  ```bash
  openssl rand -hex 32
  ```
- **Locally:** In the TubularTutor repo, copy `.env.example` to `.env` and add:
  ```text
  JWT_SECRET=the-long-random-string-you-generated
  ```
- **On Render:** You’ll add this same value in the Render dashboard in step 4 so the deployed server uses it.

---

### 3. Run the seed once

The seed script creates the admin user, student users, courses, and enrollments. Run it **once** per database (local or production).

**If you’re seeding the same DB you’ll use on Render (e.g. Render Postgres or Neon):**

- Set `DATABASE_URL` in your local `.env` to that database’s URL (for Neon use the external connection string; for Render Postgres you can use the **External** URL from the DB’s Info tab if you’re running the seed from your machine).
- In the TubularTutor repo:
  ```bash
  npm install
  npm run seed
  ```
- You should see messages like “Created admin user…”, “Created course…”, “Created student…”, “Seed complete.”

**If you prefer to seed after deploying:**

- Deploy the web service first (step 4).
- In Render, open your **Web Service** → **Shell**.
- Run `npm run seed` in that shell (the Shell already has `DATABASE_URL` and `JWT_SECRET` from the dashboard).

---

### 4. Deploy the web service and set env vars

1. On Render, click **New** → **Web Service**.
2. Connect the **TubularTutor** repo and select it.
3. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start` (or `node server.js`)
4. Before or after the first deploy, open **Environment** and add:
   - **Key:** `DATABASE_URL`  
     **Value:** the PostgreSQL URL from step 1 (paste the full string; Render will keep it secret).
   - **Key:** `JWT_SECRET`  
     **Value:** the same secret you used in step 2.
   - **Key:** `GEMINI_API_KEY`  
     **Value:** your Gemini API key (needed for the `/ask` chatbot).
5. Click **Save** (or **Create Web Service**). Render will build and start the app; the service will use the env vars you added.

After the first successful deploy, your API is live at `https://<your-service-name>.onrender.com` (e.g. `https://tubulartutor.onrender.com`). TheLearningMatrix (e.g. on GitHub Pages) will call this URL when users are not on localhost.

---

## Local testing (no Render)

Use **Running PostgreSQL locally** above for a DB on your machine (Docker or Homebrew), or a free cloud DB (Neon/Supabase). Then:

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
2. Run `npm install` then `npm run seed`.
3. Run `npm start`. Server runs on port 3000.
4. Open TheLearningMatrix from localhost so it uses `http://localhost:3000` as the API base.

**Seed logins:** Admin `admin` / `admin123`. Students: `evelyn`/`evelyn123`, `amandalynn`/`amandalynn123`, `henry`/`henry123`, `mali`/`mali123`.
