# Multimodal tutor configuration

The `/ask` endpoint accepts the existing text prompt plus an optional inline image. Uploads are limited to 4 MB and JPEG, PNG, and WebP. Images are validated by MIME type and file signature before being sent to Gemini; they are not stored by the application.

The tutoring page can display model-proposed graphs and geometry diagrams using SVG created from a validated, deliberately small data format. The model never returns SVG/HTML for direct insertion into the page.

## Gemini model discovery

At startup, the server queries the Gemini API for models available to `GEMINI_API_KEY` and keeps models that support `generateContent`. It ranks discovered models by generation and Flash preference, with environment variables used as ordered preferences:

- `GEMINI_TEXT_MODELS`: optional comma-separated text-model preferences.
- `GEMINI_IMAGE_MODELS`: optional comma-separated image-model preferences.
- At most three candidates are considered for each modality.
- Discovery is refreshed on process startup.
- If discovery fails, configured preferences are used if present; otherwise the server reports no candidates rather than using stale names.

Only transient failures and model-not-supported/capability failures move to the next candidate. Authentication and malformed-request failures stop immediately.
