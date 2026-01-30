# TubularTutor — Architectural Overview

TubularTutor is a K–12 tutoring web app: a static frontend that talks to a Node/Express API, which uses PostgreSQL for persistence and Google Gemini for AI tutoring. The frontend can be served from the same server, from a file, or from another host (e.g. GitHub Pages); the backend is the single source of truth for auth, students, courses, progress, and the `/ask` chatbot.

---

## High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (static)                                    │
│  index.html  →  styles.css  →  script.js                                          │
│  (UI)            (layout)       (API_BASE + /ask, grade + prompt)                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTP (POST /ask, /api/*)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Node.js)                                    │
│  server.js  →  express, cors, dotenv                                              │
│       │                                                                           │
│       ├── POST /ask           (Gemini; no auth)                                    │
│       ├── /api/auth/*         routes/auth.js    (login, me)                       │
│       ├── /api/students/*     routes/students.js (courses, progress; requireAuth) │
│       ├── /api/progress       routes/progress.js (POST progress; student only)    │
│       └── /api/admin/*        routes/admin.js   (CRUD students/courses/users;    │
│                                                  requireAuth + requireAdmin)       │
│       │                                                                           │
│       └── middleware/auth.js  (requireAuth, requireAdmin, signToken)               │
└─────────────────────────────────────────────────────────────────────────────────┘
         │                                    │
         │ pg Pool (db.js)                    │ Google Generative AI
         ▼                                    ▼
┌──────────────────────┐            ┌──────────────────────┐
│   PostgreSQL         │            │   Gemini API          │
│   (db.js schema)     │            │   (/ask prompt)        │
│   users, students,   │            └──────────────────────┘
│   courses,           │
│   student_courses,    │
│   progress            │
└──────────────────────┘
```

---

## 1. Frontend

The frontend is **static HTML/CSS/JS**: no build step, no framework. It can be opened from the filesystem or served by the same Express server (if you add static middleware) or from another host (e.g. GitHub Pages). It only needs the backend’s base URL to call the API and `/ask`.

| File | Role |
|------|------|
| **`index.html`** | Single page: title “Tubular Tutor”, textarea for the question, grade dropdown (1–12), “Seek wisdom” button, loading area, and a response div. Loads `styles.css` and `script.js`. |
| **`styles.css`** | Layout and styling: centered body, card for the form, spinner for loading, responsive layout. |
| **`script.js`** | Chooses `API_BASE` from hostname (localhost/127.0.0.1 → `window.location.origin`, else `https://tubulartutor.onrender.com`). Builds `BACKEND_URL = API_BASE + '/ask'`. On “Seek wisdom” click: reads prompt + grade, POSTs `{ prompt }` (with grade level in the prompt text) to `BACKEND_URL`, shows loading, then displays `data.reply` in `#response`. No auth for `/ask`. |
| **`loading.gif`** | Shown in `#loading` while the `/ask` request is in flight. |

**Data flow (frontend):**

- User enters question and grade → `script.js` sends `POST /ask` with `{ prompt: "… Please speak to me at a N grade level." }` → backend returns `{ reply }` → script shows `reply` in `#response`.

The frontend does **not** call `/api/auth`, `/api/students`, `/api/progress`, or `/api/admin`; those are for other clients (e.g. “TheLearningMatrix” or an admin UI). So in the current TubularTutor static app, the only backend dependency is the `/ask` endpoint and `API_BASE`.

---

## 2. Backend

The backend is a single Node process started with `node server.js` (or `npm start`). It uses **Express**, **CORS**, **dotenv**, and does not serve the frontend by default (you could add `express.static` for the same repo).

| File | Role |
|------|------|
| **`server.js`** | Loads `dotenv`, creates Express app, `express.json()`, `cors()`. Mounts routes: `/api/auth`, `/api/students`, `/api/progress`, `/api/admin`. Checks `DATABASE_URL` and exits if missing. Creates Google Generative AI client with `GEMINI_API_KEY`, defines `POST /ask`: reads `req.body.prompt`, sanitizes with `sanitize-html`, builds tutor prompt (“Do NOT provide direct answers…”), calls Gemini, returns `{ reply }`. Calls `db.initDb()` then `app.listen(PORT)`. |
| **`routes/auth.js`** | `POST /api/auth/login`: body `username`, `password` → `db.getUserByUsername`, `bcrypt.compare`, then `signToken` → responds `{ token, userId, role }`. `GET /api/auth/me`: `requireAuth` → `db.getUserById` and, if student, student profile + `db.getCoursesForStudent` → current user payload. |
| **`routes/students.js`** | `GET /api/students/:id/courses`: `requireAuth`, admin or self only → `db.getCoursesForStudent`. `GET /api/students/:id/progress`: `requireAuth`, admin or self only → `db.getProgressForStudent`. |
| **`routes/progress.js`** | `POST /api/progress`: `requireAuth`, role must be `student` → body `courseId`, `percentage` → validates enrollment via `db.getCoursesForStudent`, then `db.insertProgress` → 201 with new progress row. |
| **`routes/admin.js`** | All routes use `requireAuth` and `requireAdmin`. CRUD: students (GET all, POST, PATCH, DELETE), courses (GET all, POST, PATCH, DELETE), users (PATCH), and `POST /api/admin/students/:id/courses` with `courseIds` → `db.setStudentCourses`. Uses `db` for all persistence. |
| **`middleware/auth.js`** | `requireAuth`: reads `Authorization: Bearer <token>`, `jwt.verify` with `JWT_SECRET`, sets `req.user = { id, role }`. `requireAdmin`: checks `req.user.role === 'admin'`. `signToken(userId, role)`: JWT with 7d expiry. |

**Environment (backend):** `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, optional `PORT` (default 3000). See **`.env.example`**.

---

## 3. Database

PostgreSQL is the only persistent store. Connection and schema live in **`db.js`**; the schema is created on startup via **`initDb()`** (and by **`scripts/seed.js`** when seeding).

| File | Role |
|------|------|
| **`db.js`** | Creates `pg.Pool` from `DATABASE_URL`, SSL for non-localhost. `initDb()` runs DDL: `users`, `students`, `courses`, `student_courses`, `progress`. Exposes pool and all accessors/mutators used by the routes (e.g. `getUserByUsername`, `getUserById`, `createUser`, `updateUser`, `deleteUser`, `getStudentByUserId`, `getStudentById`, `createStudent`, `getCoursesForStudent`, `getAllCourses`, `createCourse`, `updateCourse`, `deleteCourse`, `enrollStudentInCourse`, `setStudentCourses`, `getProgressForStudent`, `insertProgress`, `getAllStudents`, `updateStudent`). |
| **`scripts/seed.js`** | Uses `db.initDb()` and `db.pool`. Creates default admin user (from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`), seeds courses and students with enrollments. Run once per environment: `npm run seed`. |

**Schema (from `db.js`):**

- **`users`** — `id`, `username` (unique), `password_hash`, `role` ('student' | 'admin'), `created_at`.
- **`students`** — `id`, `user_id` (unique FK → users), `display_name`, `created_at`.
- **`courses`** — `id`, `name`, `color`, `created_at`.
- **`student_courses`** — `(student_id, course_id)` composite PK, FKs to `students` and `courses`.
- **`progress`** — `id`, `student_id`, `course_id`, `percentage` (0–100), `recorded_at`; FKs to `students` and `courses`.

**Relationship summary:** One user has at most one student record. Students have many courses (via `student_courses`) and many progress rows per course. Admin is a user with `role = 'admin'` and no student row.

---

## 4. Request flow summary

| Client goal | Endpoint | Auth | Backend flow |
|-------------|----------|------|--------------|
| Get AI tutor reply | `POST /ask` | None | Sanitize prompt → Gemini → `{ reply }`. |
| Log in | `POST /api/auth/login` | None | Verify credentials → JWT → `{ token, userId, role }`. |
| Current user | `GET /api/auth/me` | Bearer | Decode JWT → load user (+ student + courses if student). |
| Student’s courses | `GET /api/students/:id/courses` | Bearer, self or admin | `db.getCoursesForStudent`. |
| Student’s progress | `GET /api/students/:id/progress` | Bearer, self or admin | `db.getProgressForStudent`. |
| Record progress | `POST /api/progress` | Bearer, student | Validate course enrollment → `db.insertProgress`. |
| Admin: list/create/update/delete students, courses, users, enrollments | ` /api/admin/*` | Bearer, admin | Corresponding `db.*` calls. |

---

## 5. Diagram (layers and files)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND                                                                     │
│  ├── index.html     (page structure, grade select, prompt textarea, button)  │
│  ├── styles.css     (layout, spinner, #call, #response)                      │
│  ├── script.js      (API_BASE, BACKEND_URL, fetch POST /ask, show reply)     │
│  └── loading.gif    (loading indicator)                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │  POST /ask  (JSON { prompt })
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BACKEND — server.js                                                          │
│  ├── POST /ask  →  sanitize-html → createPrompt() → Gemini → { reply }       │
│  ├── /api/auth      → routes/auth.js      (login, me)                        │
│  ├── /api/students  → routes/students.js  (/:id/courses, /:id/progress)       │
│  ├── /api/progress  → routes/progress.js  (POST)                              │
│  └── /api/admin     → routes/admin.js     (students, courses, users CRUD)     │
│                                                                               │
│  middleware/auth.js  → requireAuth (JWT), requireAdmin, signToken             │
└─────────────────────────────────────────────────────────────────────────────┘
         │                                              │
         │  pool.query(...)                              │  genAI.generateContent
         ▼                                              ▼
┌──────────────────────┐                    ┌──────────────────────┐
│  db.js               │                    │  Gemini (external)   │
│  Pool(DATABASE_URL)   │                    │  GEMINI_API_KEY      │
│  initDb() → DDL      │                    └──────────────────────┘
│  users, students,    │
│  courses,            │
│  student_courses,    │
│  progress            │
└──────────────────────┘
         ▲
         │  initDb + pool
         │
┌──────────────────────┐
│  scripts/seed.js     │
│  Admin + courses +   │
│  students + enroll   │
└──────────────────────┘
```

---

## 6. Deployment (reference)

- **Backend:** Node (e.g. Render): set `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`; start with `npm start`.
- **Database:** PostgreSQL (e.g. Neon or Supabase); same `DATABASE_URL` for backend and for running `npm run seed`.
- **Frontend:** Any static host (same origin as API, or file://, or GitHub Pages); `script.js` already switches `API_BASE` by hostname so production uses `https://tubulartutor.onrender.com` when not on localhost.

For a step-by-step deploy path (GitHub, Neon, Render), see the README section **“Full setup: GitHub, Neon, and Render”.**
