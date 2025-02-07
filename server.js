require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const API_KEY = process.env.GEMINI_API_KEY;
console.log(API_KEY);

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

/* require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors()); // Allow frontend to communicate with the backend

const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;

app.post("/ask", async (req, res) => {
    try {
        const userQuestion = req.body.question;
        const response = await axios.post(API_URL, {
            contents: [{
                role: "user",
                parts: [{ text: `You are a tutor. Do NOT provide direct answers. Instead, review concepts and provide a similar solved example. Question: ${userQuestion}` }]
            }]
        });

        res.json({ reply: response.data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm not sure how to answer that." });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Failed to get response from AI" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
*/