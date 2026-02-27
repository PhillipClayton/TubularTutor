const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth, signToken } = require("../middleware/auth");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const user = await db.getUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const token = signToken(user.id, user.role);
  res.json({ token, userId: user.id, role: user.role });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  const payload = { id: user.id, username: user.username, role: user.role };
  if (user.role === "student") {
    const student = await db.getStudentByUserId(user.id);
    if (student) {
      payload.studentId = student.id;
      payload.displayName = student.display_name;
      payload.courses = await db.getCoursesForStudent(student.id);
    }
  }
  res.json(payload);
});

module.exports = router;
