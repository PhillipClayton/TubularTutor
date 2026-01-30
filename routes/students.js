const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/:id/courses", requireAuth, async (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  if (Number.isNaN(studentId)) {
    return res.status(400).json({ error: "Invalid student id" });
  }
  if (req.user.role !== "admin") {
    const student = await db.getStudentByUserId(req.user.id);
    if (!student || student.id !== studentId) {
      return res.status(403).json({ error: "Not allowed to view this student" });
    }
  }
  const courses = await db.getCoursesForStudent(studentId);
  res.json(courses);
});

router.get("/:id/progress", requireAuth, async (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  if (Number.isNaN(studentId)) {
    return res.status(400).json({ error: "Invalid student id" });
  }
  if (req.user.role !== "admin") {
    const student = await db.getStudentByUserId(req.user.id);
    if (!student || student.id !== studentId) {
      return res.status(403).json({ error: "Not allowed to view this student" });
    }
  }
  const progress = await db.getProgressForStudent(studentId);
  res.json(progress);
});

module.exports = router;
