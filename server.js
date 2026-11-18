require("dotenv").config();
const express = require("express");
const cors = require("cors");
const sanitizeHtml = require("sanitize-html");
const { randomUUID } = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const db = require("./db");
const authRoutes = require("./routes/auth");
const studentsRoutes = require("./routes/students");
const progressRoutes = require("./routes/progress");
const adminRoutes = require("./routes/admin");

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

function configuredModels(variable) {
  const configured = process.env[variable];
  const models = (configured ? configured.split(",") : DEFAULT_MODELS)
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set(models)].slice(0, 3);
}

const TEXT_MODELS = configuredModels("GEMINI_TEXT_MODELS");
const IMAGE_MODELS = configuredModels("GEMINI_IMAGE_MODELS");

// Express setup
const app = express();
app.use(express.json({ limit: "6mb" }));
app.use(cors());

// API (database + auth)
app.use("/api/auth", authRoutes);
app.use("/api/students", studentsRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/admin", adminRoutes);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Set it in .env (see .env.example).");
  process.exit(1);
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.warn("Warning: GEMINI_API_KEY is not set. /ask will return an error until the key is provided.");
}
const genAI = new GoogleGenerativeAI(API_KEY || "");

function isRetriableError(err) {
  let current = err;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
    const status = current.status || (current.response && current.response.status);
    if ([429, 500, 502, 503, 504].includes(status)) return true;
    if (typeof current.code === "string" && /ECONNRESET|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|UND_ERR|FETCH_FAILED/i.test(current.code)) return true;
    if (typeof current.message === "string" && /fetch failed|network|socket|overload|temporar|timeout|unavailable/i.test(current.message)) return true;
  }
  return false;
}

function errorSummary(err) {
  const details = [];
  let current = err;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
    details.push({ name: current.name, message: current.message, code: current.code, status: current.status });
  }
  return JSON.stringify(details);
}

function validateImage(image) {
  if (image === undefined || image === null) return null;
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    const error = new Error("image must contain a supported image upload");
    error.status = 400;
    throw error;
  }
  const { mimeType, data } = image;
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    const error = new Error("Supported image types are JPEG, PNG, and WebP");
    error.status = 415;
    throw error;
  }
  if (typeof data !== "string" || !data || data.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    const error = new Error("Image is invalid or exceeds the 4 MB limit");
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(data, "base64");
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES || buffer.toString("base64").replace(/=+$/, "") !== data.replace(/=+$/, "")) {
    const error = new Error("Image is invalid or exceeds the 4 MB limit");
    error.status = 400;
    throw error;
  }
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (!(mimeType === "image/png" && isPng) && !(mimeType === "image/jpeg" && isJpeg) && !(mimeType === "image/webp" && isWebp)) {
    const error = new Error("Image content does not match its file type");
    error.status = 415;
    throw error;
  }
  return { mimeType, data };
}

function finiteNumber(value, min = -10000, max = 10000) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

// Validate the model's small diagram schema before sending it to the browser.
function validateDiagram(diagram) {
  if (!diagram || typeof diagram !== "object" || Array.isArray(diagram)) return null;

  if (diagram.type === "graph" && Array.isArray(diagram.points) && diagram.points.length >= 2 && diagram.points.length <= 100) {
    const points = diagram.points.filter((point) => point && finiteNumber(point.x) && finiteNumber(point.y));
    if (points.length !== diagram.points.length) return null;
    return {
      type: "graph",
      title: typeof diagram.title === "string" ? diagram.title.slice(0, 100) : "Graph",
      points
    };
  }

  if (diagram.type === "geometry" && Array.isArray(diagram.points) && diagram.points.length >= 2 && diagram.points.length <= 20 && Array.isArray(diagram.segments) && diagram.segments.length <= 40) {
    const ids = new Set();
    const points = [];
    for (const point of diagram.points) {
      if (!point || typeof point.id !== "string" || !/^[A-Za-z0-9]{1,8}$/.test(point.id) || ids.has(point.id) || !finiteNumber(point.x, 0, 100) || !finiteNumber(point.y, 0, 100)) return null;
      ids.add(point.id);
      points.push({ id: point.id, x: point.x, y: point.y });
    }
    const segments = [];
    for (const segment of diagram.segments) {
      if (!Array.isArray(segment) || segment.length !== 2 || !ids.has(segment[0]) || !ids.has(segment[1])) return null;
      segments.push(segment);
    }
    return { type: "geometry", title: typeof diagram.title === "string" ? diagram.title.slice(0, 100) : "Diagram", points, segments };
  }

  return null;
}

function parseTutorResponse(text) {
  try {
    const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(unfenced);
    if (!parsed || typeof parsed.reply !== "string") throw new Error("Invalid response shape");
    return { reply: parsed.reply.slice(0, 12000), diagram: validateDiagram(parsed.diagram) };
  } catch (_err) {
    // Preserve a useful tutor reply even if the model fails to follow the JSON format.
    return { reply: text, diagram: null };
  }
}

function createPrompt(cleanPrompt, gradeLevel, hasImage) {
  const imageInstruction = hasImage
    ? " Carefully inspect the student's uploaded image. If it contains a graph or geometry task, you may include an optional diagram in the schema below. Do not guess unclear labels; mention uncertainty."
    : " You may include an optional diagram when it would help explain the concept.";
  return `You are a supportive K-12 tutor speaking to a student in grade ${gradeLevel}. Do not give the final answer to an assigned problem. Explain the relevant concept and guide the student with a similar worked example. Return ONLY valid JSON with this shape: {"reply":"tutoring explanation as plain text","diagram":null} or an optional diagram. A graph diagram is {"type":"graph","title":"...","points":[{"x":0,"y":0},{"x":1,"y":1}]}; provide 2-100 numeric points in order. A geometry diagram is {"type":"geometry","title":"...","points":[{"id":"A","x":10,"y":20},{"id":"B","x":80,"y":20}],"segments":[["A","B"]]}; use coordinates from 0 to 100 and only points/segments. Do not include SVG, HTML, scripts, or other markup.${imageInstruction}\nStudent question: ${cleanPrompt}`;
}

async function generateWithFallback(prompt, image) {
  const models = image ? IMAGE_MODELS : TEXT_MODELS;
  if (models.length === 0) throw new Error(`No ${image ? "image" : "text"} models configured`);
  const parts = image ? [prompt, { inlineData: { mimeType: image.mimeType, data: image.data } }] : [prompt];
  const attempts = [];
  let lastError;

  for (const modelName of models) {
    attempts.push(`Attempting ${image ? "image" : "text"} model: ${modelName}`);
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: "application/json" }
      });
      const result = await model.generateContent(parts);
      const parsed = parseTutorResponse(result.response.text());
      return { ...parsed, model: modelName, attempts };
    } catch (err) {
      lastError = err;
      const message = errorSummary(err);
      attempts.push(`${modelName} failed: ${message}`);
      console.warn(`Gemini ${image ? "image" : "text"} model ${modelName} failed:`, message);
      // Do not waste time trying sibling models for invalid requests/auth/config problems.
      if (!isRetriableError(err)) break;
    }
  }

  const error = new Error("Unable to generate a tutoring response");
  error.cause = lastError;
  error.attempts = attempts;
  error.status = lastError && lastError.status;
  throw error;
}

app.post("/ask", async (req, res) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  try {
    const rawPrompt = req.body && req.body.prompt;
    const image = validateImage(req.body && req.body.image);
    if ((!rawPrompt || typeof rawPrompt !== "string" || !rawPrompt.trim()) && !image) {
      return res.status(400).json({ error: "prompt (string) or image is required in the request body" });
    }
    if (rawPrompt !== undefined && typeof rawPrompt !== "string") {
      return res.status(400).json({ error: "prompt must be a string" });
    }
    if (!API_KEY) return res.status(500).json({ error: "Generative AI key not configured on server" });

    const gradeLevel = Number(req.body.gradeLevel);
    if (!Number.isInteger(gradeLevel) || gradeLevel < 1 || gradeLevel > 12) {
      return res.status(400).json({ error: "gradeLevel must be an integer from 1 to 12" });
    }
    const cleanPrompt = sanitizeHtml((rawPrompt || "Please help me understand this assignment image.").slice(0, 4000), {
      allowedTags: [], allowedAttributes: [], disallowedTagsMode: "discard"
    });
    console.info(`[ask:${requestId}] started modality=${image ? "image" : "text"}`);
    const result = await generateWithFallback(createPrompt(cleanPrompt, gradeLevel, Boolean(image)), image);
    console.info(`[ask:${requestId}] completed model=${result.model} durationMs=${Date.now() - startedAt}`);
    return res.json({ ...result, requestId });
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 502;
    console.error(`[ask:${requestId}] failed status=${status} durationMs=${Date.now() - startedAt}:`, errorSummary(error));
    return res.status(status).json({ error: "Failed to get response from AI", attempts: error.attempts || [], requestId });
  }
});

// Return useful JSON for oversized JSON/image requests.
app.use((err, _req, res, next) => {
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Request is too large; images must be 4 MB or smaller" });
  return next(err);
});

const PORT = process.env.PORT || 3000;
db.initDb()
  .then(() => {
    console.info(`Gemini model configuration: text=${TEXT_MODELS.join(",")} image=${IMAGE_MODELS.join(",")}`);
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("DB init error:", err.message);
    process.exit(1);
  });
