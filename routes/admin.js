const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get("/students", async (req, res) => {
  const students = await db.getAllStudents();
  res.json(students);
});

router.post("/students", async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: "username, password, and displayName required" });
  }
  const existing = await db.getUserByUsername(username);
  if (existing) {
    return res.status(400).json({ error: "Username already exists" });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = await db.createUser(username, hash, "student");
  const student = await db.createStudent(user.id, displayName);
  res.status(201).json({ ...student, username: user.username });
});

router.patch("/students/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid student id" });
  }
  const { displayName, courseIds } = req.body;
  const student = await db.getStudentById(id);
  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }
  if (displayName != null) {
    await db.updateStudent(id, displayName);
  }
  if (Array.isArray(courseIds)) {
    await db.setStudentCourses(id, courseIds);
  }
  const updated = await db.getStudentById(id);
  const courses = await db.getCoursesForStudent(id);
  res.json({ ...updated, courses });
});

router.get("/courses", async (req, res) => {
  const courses = await db.getAllCourses();
  res.json(courses);
});

router.post("/courses", async (req, res) => {
  const { name, color } = req.body;
  if (!name) {
    return res.status(400).json({ error: "name required" });
  }
  const course = await db.createCourse(name, color || null);
  res.status(201).json(course);
});

router.patch("/courses/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid course id" });
  }
  const { name, color } = req.body;
  const course = await db.updateCourse(id, name, color);
  if (!course) {
    return res.status(404).json({ error: "Course not found" });
  }
  res.json(course);
});

router.delete("/courses/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid course id" });
  }
  const deleted = await db.deleteCourse(id);
  if (!deleted) {
    return res.status(404).json({ error: "Course not found" });
  }
  res.status(204).send();
});

router.patch("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid user id" });
  }
  const { username, password } = req.body;
  const existing = await db.getUserById(id);
  if (!existing) {
    return res.status(404).json({ error: "User not found" });
  }
  if (username != null && username.trim() === "") {
    return res.status(400).json({ error: "Username cannot be empty" });
  }
  if (username != null) {
    const taken = await db.getUserByUsername(username.trim());
    if (taken && taken.id !== id) {
      return res.status(400).json({ error: "Username already exists" });
    }
  }
  let passwordHash = null;
  if (password != null && password !== "") {
    passwordHash = await bcrypt.hash(password, 10);
  }
  const updated = await db.updateUser(id, username != null ? username.trim() : null, passwordHash);
  res.json(updated);
});

router.delete("/students/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid student id" });
  }
  const student = await db.getStudentById(id);
  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }
  await db.deleteUser(student.user_id);
  res.status(204).send();
});

router.delete("/students/:studentId/progress/:progressId", async (req, res) => {
  const studentId = parseInt(req.params.studentId, 10);
  const progressId = parseInt(req.params.progressId, 10);
  if (Number.isNaN(studentId) || Number.isNaN(progressId)) {
    return res.status(400).json({ error: "Invalid student or progress id" });
  }
  const deleted = await db.deleteProgressById(progressId, studentId);
  if (!deleted) {
    return res.status(404).json({ error: "Progress entry not found" });
  }
  res.status(204).send();
});

router.post("/students/:id/courses", async (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const { courseIds } = req.body;
  if (Number.isNaN(studentId) || !Array.isArray(courseIds)) {
    return res.status(400).json({ error: "student id and courseIds array required" });
  }
  await db.setStudentCourses(studentId, courseIds);
  const courses = await db.getCoursesForStudent(studentId);
  res.json({ studentId, courses });
});

module.exports = router;
