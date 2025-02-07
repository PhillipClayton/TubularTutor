const BACKEND_URL = "http://localhost:3000/ask"; // Change this to your deployed backend URL

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("sendPrompt").addEventListener("click", async () => {
        const prompt = document.getElementById("prompt").value;
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
        } catch (error) {
            console.error("Error:", error);
            document.getElementById("response").innerText = "Failed to generate content";
        }
    });
});