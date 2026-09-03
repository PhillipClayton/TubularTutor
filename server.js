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

// Cache of discovered available models in priority order
let AVAILABLE_MODELS = [];
let MODELS_DISCOVERED = false;

// Model priority scoring: prefer newer, lighter models
// (e.g., 3.8-flash > 3.5-flash > 2.0-flash > lite variants)
function scoreModelForPriority(modelName) {
  const name = modelName.toLowerCase();
  
  // Extract version number
  const versionMatch = name.match(/(\d+)\.(\d+)/);
  let majorVersion = 0;
  let minorVersion = 0;
  if (versionMatch) {
    majorVersion = parseInt(versionMatch[1], 10);
    minorVersion = parseInt(versionMatch[2], 10);
  }
  
  let score = majorVersion * 1000 + minorVersion * 100;
  
  // Boost flash models (they're fast and efficient)
  if (name.includes('flash') && !name.includes('lite')) score += 50;
  if (name.includes('flash') && name.includes('lite')) score += 25;
  
  // Penalize lite/experimental variants slightly
  if (name.includes('lite')) score -= 10;
  
  return score;
}

// Discover available models that support generateContent using REST API
async function discoverAvailableModels() {
  if (MODELS_DISCOVERED) return AVAILABLE_MODELS;
  
  try {
    console.log("Discovering available models for generateContent...");
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`
    );
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const models = [];
    
    // Filter for models that support generateContent
    if (data.models && Array.isArray(data.models)) {
      for (const model of data.models) {
        if (model.supportedGenerationMethods && 
            model.supportedGenerationMethods.includes('generateContent')) {
          // Extract the model name (remove 'models/' prefix if present)
          const modelName = model.name.replace(/^models\//, '');
          models.push(modelName);
        }
      }
    }
    
    // Sort by priority (newest/best first)
    models.sort((a, b) => scoreModelForPriority(b) - scoreModelForPriority(a));
    
    AVAILABLE_MODELS = models;
    MODELS_DISCOVERED = true;
    
    if (models.length === 0) {
      console.warn("⚠️  No models found that support generateContent. Check your API key and quotas.");
    } else {
      console.log(`✓ Discovered ${models.length} available models for generateContent`);
      console.log(`  Primary model: ${models[0]}`);
      console.log(`  Fallbacks: ${models.slice(1).join(', ') || '(none)'}`);
    }
    
    return models;
  } catch (err) {
    console.error("Error discovering models:", err.message);
    MODELS_DISCOVERED = true;
    return [];
  }
}

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
  // Some error messages indicate overload or model not found
  if (err.message && /overload|temporar|timeout|unavailable|not found|not supported/i.test(err.message)) return true;
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

// Try models in order until one succeeds; return detailed status info
async function generateWithFallback(prompt) {
  let lastError = null;
  const attemptLog = [];
  const fallbackModels = AVAILABLE_MODELS;
  
  if (fallbackModels.length === 0) {
    throw new Error('No available generative models discovered. Check your API key and model availability.');
  }
  
  for (let idx = 0; idx < fallbackModels.length; idx++) {
    const modelName = fallbackModels[idx];
    attemptLog.push(`Attempting model: ${modelName}`);
    
    try {
      const res = await tryGenerateWithModel(modelName, prompt, 2);
      if (res.success && res.result) {
        return { 
          text: res.result.response.text(), 
          model: modelName,
          attempts: attemptLog,
          success: true
        };
      }
      // If non-retriable error (like bad request / invalid prompt), rethrow immediately
      if (res.error && res.retriable === false) {
        throw res.error;
      }
      // otherwise record the last error and move to next model
      lastError = res.error || lastError;
      const errorMsg = res.error && res.error.message ? res.error.message : String(res.error);
      attemptLog.push(`${modelName} failed: ${errorMsg}. ${idx < fallbackModels.length - 1 ? 'Trying next model...' : 'No models left.'}`);
      console.warn(`Model ${modelName} failed (will try next if available):`, errorMsg);
    } catch (err) {
      // If the error is not retriable or indicates a client issue, stop and surface it
      if (!isRetriableError(err)) {
        throw err;
      }
      lastError = err;
      const errorMsg = err && err.message ? err.message : String(err);
      attemptLog.push(`${modelName} error: ${errorMsg}. ${idx < fallbackModels.length - 1 ? 'Trying next model...' : 'No models left.'}`);
      console.warn(`Model ${modelName} threw error (will try next if available):`, errorMsg);
    }
  }
  // All models failed
  const aggregateError = new Error('All configured generative models failed');
  aggregateError.cause = lastError;
  aggregateError.attempts = attemptLog;
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
        const { text, model, attempts } = await generateWithFallback(prompt);
        // return which model responded for observability (useful when fallbacks occur)
        res.json({ reply: text, model, attempts });
    } catch (error) {
        console.error("Error getting response from AI:", error && error.message ? error.message : error);
        // If the underlying error has a status use it, otherwise default to 500
        const status = (error && (error.status || (error.cause && (error.cause.status || error.cause.code)))) || 500;
        const attempts = error.attempts || [];
        res.status(status === 0 ? 500 : status).json({ 
          error: "Failed to get response from AI",
          attempts 
        });
    }
});

const PORT = process.env.PORT || 3000;
db.initDb()
  .then(async () => {
    // Discover available models on startup
    await discoverAvailableModels();
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
