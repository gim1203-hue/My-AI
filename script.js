const input = document.getElementById("userInput");
const form = document.getElementById("chatForm");
const chat = document.getElementById("chat");
const sendButton = document.getElementById("sendButton");
const webSearchToggle = document.getElementById("webSearchToggle");
const textStatus = document.getElementById("textStatus");
const startVoiceButton = document.getElementById("startVoiceButton");
const stopVoiceButton = document.getElementById("stopVoiceButton");
const voiceStatus = document.getElementById("voiceStatus");
const voiceStatusText = document.getElementById("voiceStatusText");
const voiceOutput = document.getElementById("voiceOutput");

let peerConnection = null;
let microphoneStream = null;
let eventChannel = null;
let voiceStarting = false;

function setVoiceStatus(state, message) {
    voiceStatus.dataset.state = state;
    voiceStatusText.textContent = message;
}

function safeSourceUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

function appendChatMessage(label, text, citations = []) {
    const message = document.createElement("div");
    message.className = "chat-message";

    const body = document.createElement("p");
    body.textContent = `${label}: ${text}`;
    message.appendChild(body);

    const validCitations = citations
        .map((citation) => ({ ...citation, safeUrl: safeSourceUrl(citation.url) }))
        .filter((citation) => citation.safeUrl);

    if (validCitations.length > 0) {
        const sourceLabel = document.createElement("span");
        sourceLabel.className = "source-label";
        sourceLabel.textContent = "Sources";
        message.appendChild(sourceLabel);

        const sourceList = document.createElement("ul");
        sourceList.className = "source-list";

        validCitations.forEach((citation) => {
            const item = document.createElement("li");
            const link = document.createElement("a");
            link.href = citation.safeUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = citation.title || new URL(citation.safeUrl).hostname;
            item.appendChild(link);
            sourceList.appendChild(item);
        });

        message.appendChild(sourceList);
    }

    chat.appendChild(message);
    message.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function sendRealtimeEvent(event) {
    if (!eventChannel || eventChannel.readyState !== "open") {
        throw new Error("The voice event channel is not open.");
    }

    eventChannel.send(JSON.stringify(event));
}

async function runVoiceWebSearch(functionCall) {
    setVoiceStatus("thinking", "Searching the web...");

    let query;

    try {
        query = JSON.parse(functionCall.arguments).query;
    } catch {
        query = "";
    }

    let result;

    try {
        const response = await fetch("/web-search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ query })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Web search failed.");
        }

        result = data;
        appendChatMessage("Web result", data.reply, data.citations);
    } catch {
        result = {
            error: "Web search is temporarily unavailable. Tell the user and continue without inventing current facts."
        };
    }

    try {
        sendRealtimeEvent({
            type: "conversation.item.create",
            item: {
                type: "function_call_output",
                call_id: functionCall.call_id,
                output: JSON.stringify(result)
            }
        });
        sendRealtimeEvent({ type: "response.create" });
    } catch {
        stopVoice("Voice connection ended while returning search results.");
    }
}

function resetVoiceConnection() {
    if (eventChannel) {
        eventChannel.close();
        eventChannel = null;
    }

    if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.close();
        peerConnection = null;
    }

    if (microphoneStream) {
        microphoneStream.getTracks().forEach((track) => track.stop());
        microphoneStream = null;
    }

    voiceOutput.srcObject = null;
    voiceStarting = false;
    startVoiceButton.disabled = false;
    stopVoiceButton.disabled = true;
}

function stopVoice(message = "Voice chat ended") {
    resetVoiceConnection();
    setVoiceStatus("idle", message);
}

function handleRealtimeEvent(messageEvent) {
    let event;

    try {
        event = JSON.parse(messageEvent.data);
    } catch {
        return;
    }

    switch (event.type) {
        case "session.created":
        case "session.updated":
        case "response.done": {
            const functionCalls = (event.response?.output ?? []).filter(
                (item) => item.type === "function_call" && item.name === "search_web"
            );

            if (functionCalls.length > 0) {
                functionCalls.forEach(runVoiceWebSearch);
                break;
            }

            setVoiceStatus("listening", "Listening — speak naturally");
            break;
        }
        case "input_audio_buffer.speech_started":
            setVoiceStatus("listening", "Listening to you...");
            break;
        case "input_audio_buffer.speech_stopped":
        case "response.created":
            setVoiceStatus("thinking", "Thinking...");
            break;
        case "response.output_audio.delta":
        case "response.audio.delta":
            setVoiceStatus("speaking", "My AI is speaking");
            break;
        case "error":
            setVoiceStatus("error", "Voice service reported an error. End voice and try again.");
            break;
        default:
            break;
    }
}

async function startVoice() {
    if (voiceStarting || peerConnection) {
        return;
    }

    if (!window.isSecureContext || !["http:", "https:"].includes(window.location.protocol)) {
        setVoiceStatus(
            "error",
            "Open this app at http://localhost:3000 — voice cannot start from a file:// page."
        );
        return;
    }

    voiceStarting = true;
    startVoiceButton.disabled = true;
    stopVoiceButton.disabled = false;
    setVoiceStatus("connecting", "Requesting microphone permission...");

    try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        setVoiceStatus("connecting", "Connecting to My AI...");

        peerConnection = new RTCPeerConnection();
        peerConnection.ontrack = (event) => {
            voiceOutput.srcObject = event.streams[0];
            voiceOutput.play().catch(() => {
                setVoiceStatus("error", "Allow audio playback in your browser, then try again.");
            });
        };

        peerConnection.onconnectionstatechange = () => {
            if (!peerConnection) {
                return;
            }

            if (peerConnection.connectionState === "connected") {
                setVoiceStatus("listening", "Listening — speak naturally");
            } else if (["failed", "disconnected"].includes(peerConnection.connectionState)) {
                stopVoice("Voice connection ended. Press Start voice to reconnect.");
            }
        };

        microphoneStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, microphoneStream);
        });

        eventChannel = peerConnection.createDataChannel("oai-events");
        eventChannel.addEventListener("message", handleRealtimeEvent);

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        const response = await fetch("/session", {
            method: "POST",
            headers: {
                "Content-Type": "application/sdp"
            },
            body: offer.sdp
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || "The server could not create a voice session.");
        }

        const answer = await response.text();
        await peerConnection.setRemoteDescription({
            type: "answer",
            sdp: answer
        });

        voiceStarting = false;
    } catch (error) {
        const permissionDenied =
            error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";

        resetVoiceConnection();
        setVoiceStatus(
            "error",
            permissionDenied
                ? "Microphone permission was denied. Allow it in your browser settings and try again."
                : error?.message || "Voice could not start. Check the server terminal and try again."
        );
    }
}

if (window.location.protocol === "file:") {
    setVoiceStatus(
        "error",
        "Open this app at http://localhost:3000 — voice cannot start from a file:// page."
    );
}

form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const message = input.value.trim();

    if (message === "") {
        return;
    }

    const searchWeb = webSearchToggle.checked;
    appendChatMessage("You", message);

    input.value = "";
    sendButton.disabled = true;
    textStatus.textContent = searchWeb ? "Searching the web and preparing an answer..." : "Thinking...";

    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: message,
                searchWeb: searchWeb
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "The message could not be sent.");
        }

        appendChatMessage("My AI", data.reply, data.citations);
        textStatus.textContent = data.searchedWeb
            ? "Web search complete. Sources are listed with the answer."
            : "";

    } catch (error) {
        console.error(error);
        appendChatMessage("My AI", "Sorry, something went wrong.");
        textStatus.textContent = searchWeb
            ? "Web search is unavailable right now. Try again or turn off Search the web."
            : "The message could not be sent.";
    } finally {
        sendButton.disabled = false;
        input.focus();
    }
});

startVoiceButton.addEventListener("click", startVoice);
stopVoiceButton.addEventListener("click", () => stopVoice());
window.addEventListener("beforeunload", resetVoiceConnection);
