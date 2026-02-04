require("dotenv").config();
const { Pool } = require("pg");

// Normalize SSL mode to verify-full to avoid "treated as alias" security warning from pg/Render
function normalizeConnectionString(url) {
  if (!url || url.includes("localhost")) return url;
  return url.replace(/sslmode=(prefer|require|verify-ca)/gi, "sslmode=verify-full");
}

const connectionString = normalizeConnectionString(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('student', 'admin')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        user_id INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        display_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        color VARCHAR(7),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS student_courses (
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        PRIMARY KEY (student_id, course_id)
      );
      CREATE TABLE IF NOT EXISTS progress (
        id SERIAL PRIMARY KEY,
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        percentage NUMERIC(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } finally {
    client.release();
  }
}

async function getUserByUsername(username) {
  const { rows } = await pool.query(
    "SELECT id, username, password_hash, role FROM users WHERE username = $1",
    [username]
  );
  return rows[0] || null;
}

async function getUserById(id) {
  const { rows } = await pool.query(
    "SELECT id, username, role FROM users WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

async function createUser(username, passwordHash, role) {
  const { rows } = await pool.query(
    "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role",
    [username, passwordHash, role]
  );
  return rows[0];
}

async function getStudentByUserId(userId) {
  const { rows } = await pool.query(
    "SELECT id, user_id, display_name FROM students WHERE user_id = $1",
    [userId]
  );
  return rows[0] || null;
}

async function getStudentById(id) {
  const { rows } = await pool.query(
    "SELECT id, user_id, display_name FROM students WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

async function createStudent(userId, displayName) {
  const { rows } = await pool.query(
    "INSERT INTO students (user_id, display_name) VALUES ($1, $2) RETURNING id, user_id, display_name",
    [userId, displayName]
  );
  return rows[0];
}

async function getCoursesForStudent(studentId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.color
     FROM courses c
     JOIN student_courses sc ON c.id = sc.course_id
     WHERE sc.student_id = $1
     ORDER BY c.name`,
    [studentId]
  );
  return rows;
}

async function getAllCourses() {
  const { rows } = await pool.query("SELECT id, name, color FROM courses ORDER BY name");
  return rows;
}

async function createCourse(name, color) {
  const { rows } = await pool.query(
    "INSERT INTO courses (name, color) VALUES ($1, $2) RETURNING id, name, color",
    [name, color || null]
  );
  return rows[0];
}

async function updateCourse(id, name, color) {
  const { rows } = await pool.query(
    "UPDATE courses SET name = COALESCE($2, name), color = COALESCE($3, color) WHERE id = $1 RETURNING id, name, color",
    [id, name, color]
  );
  return rows[0] || null;
}

async function enrollStudentInCourse(studentId, courseId) {
  await pool.query(
    "INSERT INTO student_courses (student_id, course_id) VALUES ($1, $2) ON CONFLICT (student_id, course_id) DO NOTHING",
    [studentId, courseId]
  );
}

async function setStudentCourses(studentId, courseIds) {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM student_courses WHERE student_id = $1", [studentId]);
    for (const courseId of courseIds) {
      await client.query(
        "INSERT INTO student_courses (student_id, course_id) VALUES ($1, $2)",
        [studentId, courseId]
      );
    }
  } finally {
    client.release();
  }
}

async function getProgressForStudent(studentId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.student_id, p.course_id, p.percentage, p.recorded_at, c.name AS course_name, c.color AS course_color
     FROM progress p
     JOIN courses c ON p.course_id = c.id
     WHERE p.student_id = $1
     ORDER BY p.recorded_at ASC`,
    [studentId]
  );
  return rows;
}

async function insertProgress(studentId, courseId, percentage) {
  const recordedAt = new Date().toISOString();
  const { rows } = await pool.query(
    "INSERT INTO progress (student_id, course_id, percentage, recorded_at) VALUES ($1, $2, $3, $4) RETURNING id, student_id, course_id, percentage, recorded_at",
    [studentId, courseId, percentage, recordedAt]
  );
  return rows[0];
}

/**
 * Upsert progress: only one row per (student, course, calendar day).
 * If the client sends a date (YYYY-MM-DD), we update any existing row for that day or insert.
 * Uses UTC for date comparison.
 */
async function upsertProgress(studentId, courseId, percentage, dateStr) {
  const dateToUse = dateStr || new Date().toISOString().slice(0, 10);
  const updateResult = await pool.query(
    `UPDATE progress
     SET percentage = $4, recorded_at = NOW()
     WHERE student_id = $1 AND course_id = $2
       AND (recorded_at AT TIME ZONE 'UTC')::date = $3::date
     RETURNING id, student_id, course_id, percentage, recorded_at`,
    [studentId, courseId, dateToUse, percentage]
  );
  if (updateResult.rowCount > 0) {
    return updateResult.rows[0];
  }
  const recordedAt = (dateToUse + "T12:00:00Z");
  const { rows } = await pool.query(
    `INSERT INTO progress (student_id, course_id, percentage, recorded_at)
     VALUES ($1, $2, $3, $4::timestamptz)
     RETURNING id, student_id, course_id, percentage, recorded_at`,
    [studentId, courseId, percentage, recordedAt]
  );
  return rows[0];
}

/**
 * Delete a progress record by id. If studentId is provided, only deletes when the row belongs to that student (for admin safety).
 */
async function deleteProgressById(progressId, studentId) {
  const params = studentId != null
    ? [progressId, studentId]
    : [progressId];
  const clause = studentId != null
    ? "id = $1 AND student_id = $2"
    : "id = $1";
  const { rowCount } = await pool.query(
    "DELETE FROM progress WHERE " + clause,
    params
  );
  return rowCount > 0;
}

async function getAllStudents() {
  const { rows } = await pool.query(
    "SELECT s.id, s.user_id, s.display_name, u.username FROM students s JOIN users u ON s.user_id = u.id ORDER BY s.display_name"
  );
  return rows;
}

async function updateStudent(id, displayName) {
  const { rows } = await pool.query(
    "UPDATE students SET display_name = COALESCE($2, display_name) WHERE id = $1 RETURNING id, user_id, display_name",
    [id, displayName]
  );
  return rows[0] || null;
}

async function updateUser(id, username, passwordHash) {
  const updates = [];
  const values = [id];
  let i = 2;
  if (username != null) {
    updates.push(`username = $${i}`);
    values.push(username);
    i++;
  }
  if (passwordHash != null) {
    updates.push(`password_hash = $${i}`);
    values.push(passwordHash);
    i++;
  }
  if (updates.length === 0) return await getUserById(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $1 RETURNING id, username, role`,
    values
  );
  return rows[0] || null;
}

async function deleteUser(id) {
  const { rowCount } = await pool.query("DELETE FROM users WHERE id = $1", [id]);
  return rowCount > 0;
}

async function deleteCourse(id) {
  const { rowCount } = await pool.query("DELETE FROM courses WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = {
  pool,
  initDb,
  getUserByUsername,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getStudentByUserId,
  getStudentById,
  createStudent,
  getCoursesForStudent,
  getAllCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  enrollStudentInCourse,
  setStudentCourses,
  getProgressForStudent,
  insertProgress,
  upsertProgress,
  deleteProgressById,
  getAllStudents,
  updateStudent,
};
