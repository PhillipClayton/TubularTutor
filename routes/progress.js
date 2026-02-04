const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/", requireAuth, async (req, res) => {
  if (req.user.role !== "student") {
    return res.status(403).json({ error: "Students only" });
  }
  const student = await db.getStudentByUserId(req.user.id);
  if (!student) {
    return res.status(403).json({ error: "Student profile not found" });
  }
  const { courseId, percentage, date: dateStr } = req.body;
  if (courseId == null || percentage == null) {
    return res.status(400).json({ error: "courseId and percentage required" });
  }
  const pct = parseFloat(percentage);
  if (Number.isNaN(pct) || pct < 0 || pct > 100) {
    return res.status(400).json({ error: "percentage must be 0-100" });
  }
  const courses = await db.getCoursesForStudent(student.id);
  const allowed = courses.some((c) => c.id === parseInt(courseId, 10));
  if (!allowed) {
    return res.status(400).json({ error: "Course not enrolled for this student" });
  }
  const row = await db.upsertProgress(student.id, parseInt(courseId, 10), pct, dateStr || undefined);
  res.status(201).json(row);
});

module.exports = router;
