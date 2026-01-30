require("dotenv").config();
const bcrypt = require("bcrypt");
const db = require("../db");

const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "admin123";

const STUDENTS = [
  { username: "evelyn", displayName: "Evelyn", courses: ["History", "Math", "Science", "English"] },
  { username: "amandalynn", displayName: "Amanda Lynn", courses: ["Math", "Computer Science", "Spanish"] },
  { username: "henry", displayName: "Henry", courses: ["English", "Biology", "Art"] },
  { username: "mali", displayName: "Mali", courses: ["English", "Biology", "Art"] },
];

const COURSES = [
  { name: "History", color: "#2196F3" },
  { name: "Math", color: "#4CAF50" },
  { name: "Science", color: "#FF9800" },
  { name: "English", color: "#9C27B0" },
  { name: "Computer Science", color: "#00BCD4" },
  { name: "Spanish", color: "#795548" },
  { name: "Biology", color: "#8BC34A" },
  { name: "Art", color: "#E91E63" },
];

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required. Set it in .env or environment.");
    process.exit(1);
  }

  await db.initDb();
  const pool = db.pool;
  const client = await pool.connect();

  try {
    const existingAdmin = await db.getUserByUsername(ADMIN_USERNAME);
    if (!existingAdmin) {
      const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await db.createUser(ADMIN_USERNAME, hash, "admin");
      console.log(`Created admin user: ${ADMIN_USERNAME} (password: ${ADMIN_PASSWORD})`);
    } else {
      console.log(`Admin user ${ADMIN_USERNAME} already exists`);
    }

    const courseIdsByName = {};
    for (const c of COURSES) {
      const existing = (await pool.query("SELECT id FROM courses WHERE name = $1", [c.name])).rows[0];
      if (existing) {
        courseIdsByName[c.name] = existing.id;
      } else {
        const created = await db.createCourse(c.name, c.color);
        courseIdsByName[c.name] = created.id;
        console.log(`Created course: ${c.name}`);
      }
    }

    for (const s of STUDENTS) {
      let user = await db.getUserByUsername(s.username);
      if (!user) {
        const hash = await bcrypt.hash(s.username + "123", 10);
        user = await db.createUser(s.username, hash, "student");
        const student = await db.createStudent(user.id, s.displayName);
        for (const courseName of s.courses) {
          const courseId = courseIdsByName[courseName];
          if (courseId) {
            await db.enrollStudentInCourse(student.id, courseId);
          }
        }
        console.log(`Created student: ${s.displayName} (username: ${s.username}, password: ${s.username}123)`);
      } else {
        const student = await db.getStudentByUserId(user.id);
        if (student) {
          for (const courseName of s.courses) {
            const courseId = courseIdsByName[courseName];
            if (courseId) {
              await db.enrollStudentInCourse(student.id, courseId);
            }
          }
        }
        console.log(`Student ${s.displayName} already exists`);
      }
    }

    console.log("Seed complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
