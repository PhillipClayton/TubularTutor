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

// Gemini / Generative AI setup
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.warn("Warning: GEMINI_API_KEY is not set. /ask will return an error until the key is provided.");
}
const genAI = new GoogleGenerativeAI(API_KEY);

// Model fallback list (CSV). Configure via ENV or use sensible defaults.
// Order is priority: first is preferred, later are fallbacks.
const FALLBACK_MODELS = (process.env.GENERATIVE_MODEL_FALLBACKS || "gemini-3.8-flash,gemini-3.7,gemini-3.5").split(",").map(m => m.trim()).filter(Boolean);

// Utility: determine if an error is transient/retriable
function isRetriableError(err) {
  if (!err) return false;
  // Common shapes: err.status, err.code, err.response?.status, err.message
  const status = err.status || err.code || (err.response && err.response.status);
  if (status === 429 || status === 503 || status === 502 || status === 504) return true;
  // Network/connection errors
  if (err.code && typeof err.code === 'string') {
    const netCodes = ['ECONNRESET','ENOTFOUND','ECONNREFUSED','ETIMEDOUT'];
    if (netCodes.includes(err.code)) return true;
  }
  // Some error messages indicate overload
  if (err.message && /overload|temporar|timeout|unavailable/i.test(err.message)) return true;
  return false;
}

// Try to generate content with a given model, with retries and exponential backoff
async function tryGenerateWithModel(modelName, prompt, maxRetries = 2) {
  const model = genAI.getGenerativeModel({ model: modelName });
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const result = await model.generateContent(prompt);
      // Assume success if no exception thrown
      return { success: true, result, model: modelName };
    } catch (err) {
      // If not retriable, bail out immediately so caller can decide if they want to try next model
      if (!isRetriableError(err)) {
        return { success: false, error: err, model: modelName, retriable: false };
      }
      // If we've exhausted retries, return failure but mark retriable so caller can try next model
      if (attempt === maxRetries) {
        return { success: false, error: err, model: modelName, retriable: true };
      }
      // exponential backoff before retrying
      const delay = Math.pow(2, attempt) * 500; // 500ms, 1s, 2s ...
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
  // shouldn't reach here
  return { success: false, error: new Error('Unknown error in tryGenerateWithModel'), model: modelName };
}

// Try models in order until one succeeds
async function generateWithFallback(prompt) {
  let lastError = null;
  for (const modelName of FALLBACK_MODELS) {
    try {
      const res = await tryGenerateWithModel(modelName, prompt, 2);
      if (res.success && res.result) {
        return { text: res.result.response.text(), model: modelName };
      }
      // If non-retriable error (like bad request / invalid prompt), rethrow immediately
      if (res.error && res.retriable === false) {
        throw res.error;
      }
      // otherwise record the last error and move to next model
      lastError = res.error || lastError;
      console.warn(`Model ${modelName} failed (will try next if available):`, res.error && res.error.message ? res.error.message : res.error);
    } catch (err) {
      // If the error is not retriable or indicates a client issue, stop and surface it
      if (!isRetriableError(err)) {
        throw err;
      }
      lastError = err;
      console.warn(`Model ${modelName} threw error (will try next if available):`, err && err.message ? err.message : err);
    }
  }
  // All models failed
  const aggregateError = new Error('All configured generative models failed');
  aggregateError.cause = lastError;
  throw aggregateError;
}

app.post("/ask", async (req, res) => {
    const rawPrompt = req.body.prompt;
    if (!rawPrompt || typeof rawPrompt !== 'string') {
      return res.status(400).json({ error: 'prompt (string) is required in the request body' });
    }

    if (!API_KEY) {
      return res.status(500).json({ error: 'Generative AI key not configured on server' });
    }

    // Only remove HTML tags but preserve LaTeX notation (backslashes)
    const cleanPrompt = sanitizeHtml(rawPrompt, {
        allowedTags: [], 
        allowedAttributes: [],
        disallowedTagsMode: 'discard'
    });
    const prompt = createPrompt(cleanPrompt);
    try {
        const { text, model } = await generateWithFallback(prompt);
        // return which model responded for observability (useful when fallbacks occur)
        res.json({ reply: text, model });
    } catch (error) {
        console.error("Error getting response from AI:", error && error.message ? error.message : error);
        // If the underlying error has a status use it, otherwise default to 500
        const status = (error && (error.status || (error.cause && (error.cause.status || error.cause.code)))) || 500;
        res.status(status === 0 ? 500 : status).json({ error: "Failed to get response from AI" });
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
