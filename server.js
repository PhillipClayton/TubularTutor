require("dotenv").config();
const express = require("express");
const cors = require("cors");
const sanitizeHtml = require("sanitize-html");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const db = require("./db");
const authRoutes = require("./routes/auth");
const studentsRoutes = require("./routes/students");
const progressRoutes = require("./routes/progress");
const adminRoutes = require("./routes/admin");

// Express setup
const app = express();
app.use(express.json());
app.use(cors());

// API (database + auth)
app.use("/api/auth", authRoutes);
app.use("/api/students", studentsRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/admin", adminRoutes);

// Start server only after DB is ready (so /api/auth/login etc. work)
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Set it in .env (see .env.example).");
  process.exit(1);
}

// Gemini API
const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

app.post("/ask", async (req, res) => {
    const rawPrompt = req.body.prompt;
    const cleanPrompt = sanitizeHtml(rawPrompt, {allowedTags: [], allowedAttributes: []});
    const prompt = createPrompt(cleanPrompt);
    try {
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Failed to get response from AI" });
    }
});

const PORT = process.env.PORT || 3000;
db.initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("DB init error:", err.message);
    process.exit(1);
  });

// Prompt parameters
function createPrompt(cleanPrompt) {
    return "You are a tutor. Do NOT provide direct answers. Instead, review concepts and provide a similar solved example. Question: " + cleanPrompt;
}

// RAW Gemini API test
/* 
const prompt = "Please give me a humorous Hiaku poem about John Carmack.";
async function generateContent() {
    try {
        const result = await model.generateContent(prompt);
        console.log(result.response.text());
    } catch (error) {
        console.error("Error generating content:", error);
    }
}

generateContent();
*/
