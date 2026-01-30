const isLocal =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE = isLocal
  ? (window.location.origin && window.location.origin !== "null"
      ? window.location.origin
      : "http://localhost:3000")
  : "https://tubulartutor.onrender.com";
const BACKEND_URL = `${API_BASE}/ask`;

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("sendPrompt").addEventListener("click", async () => {
        const gradeLevel = document.getElementById("grade").value;
        const rawPrompt = document.getElementById("prompt").value;
        const prompt = rawPrompt + " Please speak to me at a " + gradeLevel + " grade level.";
        
        // Show loading animation
        const loadingElement = document.getElementById("loading");
        if (loadingElement) {
            loadingElement.style.display = "block";
        }
        document.getElementById("response").innerText = "";
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
            document.getElementById("response").innerText = data.reply; // Accessing the correct property
            document.getElementById("response").style.display = "block";
        } catch (error) {
            console.error("Error:", error);
            document.getElementById("response").innerText = "Failed to generate content";
        } finally {
            // Hide loading animation
            if (loadingElement) {
                loadingElement.style.display = "none";
            }
        }
    });
});