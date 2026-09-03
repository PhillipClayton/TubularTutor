const isLocal =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE = isLocal
  ? (window.location.origin && window.location.origin !== "null"
      ? window.location.origin
      : "http://localhost:3000")
  : "https://tubulartutor.onrender.com";
const BACKEND_URL = `${API_BASE}/ask`;

// Function to render LaTeX math in text
function renderMath(text) {
    const element = document.createElement("div");
    element.textContent = text;
    
    // Find all LaTeX patterns (both inline $...$ and display $$...$$)
    const mathPattern = /(\$\$[^\$]+\$\$|\$[^\$]+\$|\\[a-zA-Z]+\{[^}]*\}|\\\w+)/g;
    const parts = text.split(mathPattern);
    
    element.innerHTML = "";
    parts.forEach(part => {
        if (!part) return;
        
        // Check if it's a LaTeX expression
        if (part.match(/^\$\$.*\$\$$/) || part.match(/^\$.*\$/) || part.match(/^\\/)) {
            const span = document.createElement("span");
            try {
                // Remove $$ or $ wrappers if present
                const math = part.replace(/^\$\$|^\$|\$\$|\$$/g, "");
                katex.render(math, span, { throwOnError: false });
                element.appendChild(span);
            } catch (e) {
                // If KaTeX fails, just display the text
                element.appendChild(document.createTextNode(part));
            }
        } else {
            element.appendChild(document.createTextNode(part));
        }
    });
    
    return element;
}

// Function to update status log with formatted messages
function updateStatusLog(attempts) {
    const statusLogElement = document.getElementById("statusLog");
    if (!statusLogElement) return;
    
    statusLogElement.innerHTML = "";
    attempts.forEach((attempt, index) => {
        const line = document.createElement("div");
        line.style.marginBottom = "6px";
        
        // Format messages to be more readable
        let displayText = attempt;
        
        // Highlight model names and format attempt/fallback messages
        if (attempt.includes("Attempting model:")) {
            const modelName = attempt.match(/Attempting model: ([\w\-\.]+)/);
            if (modelName && index === 0) {
                // First attempt
                displayText = `Contacting ${modelName[1]}...`;
                line.innerHTML = "🔄 " + displayText;
            } else if (modelName) {
                // Fallback attempt
                displayText = `Trying ${modelName[1]}...`;
                line.innerHTML = "→ " + displayText;
            } else {
                line.innerHTML = "• " + displayText;
            }
        } else if (attempt.includes("failed:") || attempt.includes("error:")) {
            // Clean up error messages
            displayText = attempt.replace(/failed: /g, "→ ");
            displayText = displayText.replace(/error: /g, "→ ");
            displayText = displayText.replace(/\. (Trying next model|No models left).*/, "");
            line.innerHTML = "→ " + displayText;
        } else {
            line.innerHTML = "• " + displayText;
        }
        
        statusLogElement.appendChild(line);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("sendPrompt").addEventListener("click", async () => {
        const gradeLevel = document.getElementById("grade").value;
        const rawPrompt = document.getElementById("prompt").value;
        const prompt = rawPrompt + "Please speak to me like I'm in grade " + gradeLevel + " in school.";
        
        // Show loading animation
        const loadingElement = document.getElementById("loading");
        const statusLogElement = document.getElementById("statusLog");
        const responseElement = document.getElementById("response");
        
        if (loadingElement) {
            loadingElement.style.display = "block";
        }
        if (statusLogElement) {
            statusLogElement.innerHTML = "<div style='margin-bottom: 6px;'>🤔 Contacting AI models...</div>";
        }
        responseElement.innerHTML = "";
        responseElement.style.display = "none";

        try {
            const response = await fetch(BACKEND_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ prompt })
            });
            const data = await response.json();
            
            // Handle errors
            if (!response.ok) {
                // Show error message and attempts in status log
                if (statusLogElement) {
                    statusLogElement.innerHTML = "<div style='margin-bottom: 6px; color: #c1212b; font-weight: bold;'>Unable to generate response</div>";
                    if (data.attempts && Array.isArray(data.attempts)) {
                        updateStatusLog(data.attempts);
                    }
                    if (data.error) {
                        const errorLine = document.createElement("div");
                        errorLine.style.marginTop = "8px";
                        errorLine.style.color = "#c1212b";
                        errorLine.innerHTML = "<em>" + data.error + "</em>";
                        statusLogElement.appendChild(errorLine);
                    }
                }
                throw new Error(data.error || "Failed to generate content");
            }
            
            // Success! Update status log with final attempt info
            if (data.attempts && Array.isArray(data.attempts)) {
                updateStatusLog(data.attempts);
            }
            
            // Hide loading and show response
            if (loadingElement) {
                loadingElement.style.display = "none";
            }
            
            // Render the response with math notation
            const renderedContent = renderMath(data.reply);
            responseElement.innerHTML = "";
            responseElement.appendChild(renderedContent);
            responseElement.style.display = "block";
            
        } catch (error) {
            console.error("Error:", error);
            
            // Hide loading animation
            if (loadingElement) {
                loadingElement.style.display = "none";
            }
            
            // Show error in response area
            responseElement.innerText = "Unable to generate response. Please try again.";
            responseElement.style.color = "#c1212b";
            responseElement.style.display = "block";
        }
    });
});
