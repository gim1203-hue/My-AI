const input = document.getElementById("userInput");
const button = document.getElementById("sendButton");
const chat = document.getElementById("chat");

button.addEventListener("click", async function () {
    const message = input.value.trim();

    if (message === "") {
        return;
    }

    const userMessage = document.createElement("p");
    userMessage.textContent = "You: " + message;
    chat.appendChild(userMessage);

    input.value = "";

    try {
        const response = await fetch("http://localhost:3000/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: message
            })
        });

        const data = await response.json();

        const aiMessage = document.createElement("p");
        aiMessage.textContent = "My AI: " + data.reply;
        chat.appendChild(aiMessage);

    } catch (error) {
        console.error(error);

        const errorMessage = document.createElement("p");
        errorMessage.textContent = "My AI: Sorry, something went wrong.";
        chat.appendChild(errorMessage);
    }
});