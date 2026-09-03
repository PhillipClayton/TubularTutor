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

// Function to update status log with new messages
function updateStatusLog(statusLog, attempts) {
    const statusLogElement = document.getElementById("statusLog");
    if (!statusLogElement) return;
    
    statusLogElement.innerHTML = "";
    attempts.forEach((attempt, index) => {
        const line = document.createElement("div");
        line.style.marginBottom = "4px";
        line.textContent = "• " + attempt;
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
        if (loadingElement) {
            loadingElement.style.display = "block";
        }
        if (statusLogElement) {
            statusLogElement.innerHTML = "• Contacting AI models...";
        }
        document.getElementById("response").innerHTML = "";
        document.getElementById("response").style.display = "none";

        try {
            const response = await fetch(BACKEND_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ prompt })
            });
            const data = await response.json();
            
            // Update status log with attempts if available
            if (data.attempts && Array.isArray(data.attempts)) {
                updateStatusLog(statusLogElement, data.attempts);
            }
            
            // Handle errors
            if (!response.ok) {
                throw new Error(data.error || "Failed to generate content");
            }
            
            // Render the response with math notation
            const renderedContent = renderMath(data.reply);
            document.getElementById("response").innerHTML = "";
            document.getElementById("response").appendChild(renderedContent);
            document.getElementById("response").style.display = "block";
        } catch (error) {
            console.error("Error:", error);
            document.getElementById("response").innerText = "Failed to generate content: " + error.message;
            document.getElementById("response").style.display = "block";
        } finally {
            // Hide loading animation
            if (loadingElement) {
                loadingElement.style.display = "none";
            }
        }
    });
});
