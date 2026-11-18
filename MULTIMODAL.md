# Multimodal tutor configuration

The `/ask` endpoint accepts the existing text prompt plus an optional inline image. Uploads are limited to 4 MB and JPEG, PNG, and WebP. Images are validated by MIME type and file signature before being sent to Gemini; they are not stored by the application.

The tutoring page can display model-proposed graphs and geometry diagrams using SVG created from a validated, deliberately small data format. The model never returns SVG/HTML for direct insertion into the page. A graph is a sequence of numeric points; a geometry diagram is a set of labeled points and connecting segments. Generated diagrams are explanatory illustrations, not certified mathematical constructions.

Model selection is explicitly bounded so fallback stays within the request modality:

- `GEMINI_TEXT_MODELS`: comma-separated text models, tried in order.
- `GEMINI_IMAGE_MODELS`: comma-separated image-capable models, tried in order.
- Both default to `gemini-2.5-flash,gemini-2.5-flash-lite`.

Configure only models that are available to the Gemini API key/project. At most three configured models are considered per modality. Only transient failures (such as overload, rate limits, and network failures) move to the next configured model; invalid requests stop immediately. There is no repeated retry of a model, keeping latency bounded.

Example environment variables:

```text
GEMINI_TEXT_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite
GEMINI_IMAGE_MODELS=gemini-2.5-flash,gemini-2.5-flash-lite
```
