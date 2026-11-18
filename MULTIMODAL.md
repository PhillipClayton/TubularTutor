# Multimodal tutor configuration

The `/ask` endpoint accepts the existing text prompt plus an optional inline image. Uploads are limited to 4 MB and JPEG, PNG, and WebP. Images are validated by MIME type and file signature before they are sent to Gemini; they are not stored by the application.

The tutoring page can display model-proposed graphs and geometry diagrams using SVG created from a validated, deliberately small data format. The model never returns SVG/HTML for direct insertion into the page.

## Gemini model discovery

At startup, the server queries the Gemini API for models available to `GEMINI_API_KEY` and keeps models that support `generateContent`. It keeps only Gemini Flash and Gemma 4 candidates, excludes image, TTS, Live, audio, embedding, 1.5, and 2.0 model names, and sorts the remaining candidates by version and Flash preference.

- `GEMINI_TEXT_MODELS`: optional comma-separated text-model preferences.
- `GEMINI_IMAGE_MODELS`: optional comma-separated image-model preferences.
- At most three candidates are considered for each modality.
- Discovery is refreshed on process startup.
- If discovery fails, configured preferences are filtered and used if present; otherwise the server reports no candidates rather than using stale names.
- Name filtering does not prove that a model has free-tier quota. Google returns quota status in runtime errors.

When a model reports `limit: 0` or a free-tier quota violation, it is disabled for the rest of that server process. Temporary 429 and 503 failures place the model on a 10-second cooldown while fallback continues with another candidate. Model-not-supported and capability failures continue to the next candidate. Authentication and malformed-request failures stop immediately.
