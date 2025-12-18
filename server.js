require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const sanitizeHtml = require("sanitize-html");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Express setup
const app = express();
app.use(express.json());
app.use(cors()); // Allow frontend to communicate with the backend

// Gemini API
const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

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
