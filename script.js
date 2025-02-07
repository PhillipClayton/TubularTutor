const BACKEND_URL = "http://localhost:3000/ask"; // Change this to your deployed backend URL

function sendPrompt() {
    const userInput = document.getElementById("user-input");
    const userMessage = userInput.value.trim();
    if (!userMessage) return;

    addMessage(userMessage, "user");
    userInput.value = "";

    fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: userMessage })
    })
    .then(response => response.json())
    .then(data => addMessage(data.reply, "bot"))
    .catch(error => {
        console.error("Error:", error);
        addMessage("Error reaching server.", "bot");
    });
}
