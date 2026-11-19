const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE = isLocal
  ? (window.location.origin && window.location.origin !== "null" ? window.location.origin : "http://localhost:3000")
  : "https://tubulartutor.onrender.com";
const BACKEND_URL = `${API_BASE}/ask`;
const SVG_NS = "http://www.w3.org/2000/svg";

function renderMath(text) {
  const element = document.createElement("div");
  const mathPattern = /(\$\$[^$]+\$\$|\$[^$]+\$|\\[a-zA-Z]+\{[^}]*\}|\\\w+)/g;
  text.split(mathPattern).forEach((part) => {
    if (!part) return;
    if (/^\$\$.*\$\$$/.test(part) || /^\$.*\$/.test(part) || /^\\/.test(part)) {
      const span = document.createElement("span");
      try {
        katex.render(part.replace(/^\$\$|^\$|\$\$|\$$/g, ""), span, { throwOnError: false });
        element.appendChild(span);
      } catch (_error) {
        element.appendChild(document.createTextNode(part));
      }
    } else {
      element.appendChild(document.createTextNode(part));
    }
  });
  return element;
}

function updateStatusLog(attempts) {
  const log = document.getElementById("statusLog");
  if (!log) return;
  log.replaceChildren();
  attempts.forEach((attempt, index) => {
    const line = document.createElement("div");
    line.style.marginBottom = "6px";
    const model = attempt.match(/Attempting text model: ([\w.-]+)/);
    if (model) line.textContent = `${index === 0 ? "🔄 Contacting" : "→ Trying"} ${model[1]}...`;
    else line.textContent = `→ ${attempt}`;
    log.appendChild(line);
  });
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function renderDiagram(diagram) {
  if (!diagram) return null;
  const svg = svgElement("svg", { viewBox: "0 0 640 420", role: "img", "aria-label": diagram.title || "Math diagram" });
  const title = svgElement("title");
  title.textContent = diagram.title || "Math diagram";
  svg.appendChild(title);
  svg.appendChild(svgElement("rect", { x: 0, y: 0, width: 640, height: 420, fill: "white" }));

  if (diagram.type === "graph" && Array.isArray(diagram.points) && diagram.points.length >= 2) {
    const xs = diagram.points.map((point) => point.x);
    const ys = diagram.points.map((point) => point.y);
    const minX = Math.min(0, ...xs), maxX = Math.max(0, ...xs);
    const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
    const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
    const project = (point) => ({ x: 55 + ((point.x - minX) / rangeX) * 540, y: 365 - ((point.y - minY) / rangeY) * 320 });
    const origin = project({ x: 0, y: 0 });
    svg.appendChild(svgElement("line", { x1: 55, y1: origin.y, x2: 595, y2: origin.y, stroke: "#555", "stroke-width": 1.5 }));
    svg.appendChild(svgElement("line", { x1: origin.x, y1: 45, x2: origin.x, y2: 365, stroke: "#555", "stroke-width": 1.5 }));
    svg.appendChild(svgElement("polyline", {
      points: diagram.points.map((point) => { const p = project(point); return `${p.x},${p.y}`; }).join(" "),
      fill: "none", stroke: "#2878c8", "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round"
    }));
    diagram.points.forEach((point) => { const p = project(point); svg.appendChild(svgElement("circle", { cx: p.x, cy: p.y, r: 3, fill: "#2878c8" })); });
    const xLabel = svgElement("text", { x: 580, y: Math.min(390, origin.y - 8), fill: "#333", "font-size": 14 });
    xLabel.textContent = "x";
    svg.appendChild(xLabel);
    const yLabel = svgElement("text", { x: Math.min(620, origin.x + 8), y: 55, fill: "#333", "font-size": 14 });
    yLabel.textContent = "y";
    svg.appendChild(yLabel);
  } else if (diagram.type === "geometry" && Array.isArray(diagram.points) && Array.isArray(diagram.segments)) {
    const pointById = new Map(diagram.points.map((point) => [point.id, point]));
    const project = (point) => ({ x: 40 + point.x * 5.6, y: 30 + point.y * 3.6 });
    diagram.segments.forEach(([from, to]) => {
      const a = project(pointById.get(from)), b = project(pointById.get(to));
      svg.appendChild(svgElement("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#2878c8", "stroke-width": 3 }));
    });
    diagram.points.forEach((point) => {
      const p = project(point);
      svg.appendChild(svgElement("circle", { cx: p.x, cy: p.y, r: 4, fill: "#c14747" }));
      const label = svgElement("text", { x: p.x + 8, y: p.y - 8, fill: "#222", "font-size": 16 });
      label.textContent = point.id;
      svg.appendChild(label);
    });
  } else {
    return null;
  }
  return svg;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("sendPrompt").addEventListener("click", async () => {
    const gradeLevel = Number(document.getElementById("grade").value);
    const rawPrompt = document.getElementById("prompt").value.trim();
    const responseElement = document.getElementById("response");
    if (!rawPrompt) {
      responseElement.textContent = "Enter a question to get started.";
      responseElement.style.display = "block";
      return;
    }

    const button = document.getElementById("sendPrompt");
    const loading = document.getElementById("loading");
    const statusLog = document.getElementById("statusLog");
    button.disabled = true;
    loading.style.display = "block";
    statusLog.textContent = "Contacting a tutoring model...";
    responseElement.replaceChildren();
    responseElement.style.display = "none";

    try {
      const response = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: rawPrompt, gradeLevel })
      });
      const data = await response.json();
      if (!response.ok) {
        updateStatusLog(data.attempts || []);
        const errorLine = document.createElement("div");
        errorLine.className = "error-message";
        errorLine.textContent = data.error || "Unable to generate a response.";
        statusLog.appendChild(errorLine);
        throw new Error(data.error || "Failed to generate content");
      }

      updateStatusLog(data.attempts || []);
      responseElement.appendChild(renderMath(data.reply || ""));
      const diagram = renderDiagram(data.diagram);
      if (diagram) {
        const wrapper = document.createElement("section");
        wrapper.className = "diagram-container";
        const heading = document.createElement("h2");
        heading.textContent = data.diagram.title || "Diagram";
        wrapper.append(heading, diagram);
        responseElement.appendChild(wrapper);
      }
      responseElement.style.display = "block";
    } catch (error) {
      console.error("Error:", error.message);
      if (!responseElement.childNodes.length) responseElement.textContent = "Unable to generate response. Please try again.";
      responseElement.classList.add("error-message");
      responseElement.style.display = "block";
    } finally {
      loading.style.display = "none";
      button.disabled = false;
    }
  });
});
