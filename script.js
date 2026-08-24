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
const documentForm = document.getElementById("documentForm");
const documentInput = document.getElementById("documentInput");
const folderInput = document.getElementById("folderInput");
const documentQuestion = document.getElementById("documentQuestion");
const analyzeDocumentButton = document.getElementById("analyzeDocumentButton");
const selectedFileName = document.getElementById("selectedFileName");
const documentStatus = document.getElementById("documentStatus");
const documentResult = document.getElementById("documentResult");
const newChatButton = document.getElementById("newChatButton");
const chatThreadList = document.getElementById("chatThreadList");
const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskList = document.getElementById("taskList");
const composerMicButton = document.getElementById("composerMicButton");

let peerConnection = null;
let microphoneStream = null;
let eventChannel = null;
let voiceStarting = false;
let activeThreadId = null;
let chatThreads = [];
let tasks = [];

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

function appendChatMessage(label, text, citations = [], allowDownload = false) {
    const message = document.createElement("div");
    message.className = "chat-message";

    const body = document.createElement("p");
    body.textContent = `${label}: ${text}`;
    message.appendChild(body);

    if (allowDownload) {
        const download = document.createElement("button");
        download.type = "button";
        download.className = "response-download";
        download.textContent = "Download response";
        download.addEventListener("click", () => {
            const looksLikeHtml = /<!doctype html|<html[\s>]/i.test(text);
            const blob = new Blob([text], {
                type: looksLikeHtml ? "text/html;charset=utf-8" : "text/plain;charset=utf-8"
            });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = looksLikeHtml ? "my-ai-response.html" : "my-ai-response.txt";
            link.click();
            URL.revokeObjectURL(link.href);
        });
        message.appendChild(download);
    }

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

function renderThreads() {
    chatThreadList.textContent = "";

    if (chatThreads.length === 0) {
        const empty = document.createElement("p");
        empty.className = "sidebar-empty";
        empty.textContent = "No saved chats yet.";
        chatThreadList.appendChild(empty);
        return;
    }

    chatThreads.forEach((thread) => {
        const row = document.createElement("div");
        row.className = "thread-row";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "thread-button";
        button.textContent = thread.title;
        button.title = thread.title;
        button.setAttribute("aria-current", String(thread.id === activeThreadId));
        button.addEventListener("click", () => selectThread(thread.id));

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "thread-delete";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Delete chat ${thread.title}`);
        remove.addEventListener("click", () => deleteThread(thread));

        row.append(button, remove);
        chatThreadList.appendChild(row);
    });
}

async function deleteThread(thread) {
    const approved = window.confirm(
        `Delete “${thread.title}” and its saved messages? This cannot be undone.`
    );
    if (!approved) return;

    const response = await fetch(`/chats/${encodeURIComponent(thread.id)}`, {
        method: "DELETE"
    });
    if (!response.ok) {
        textStatus.textContent = "That chat could not be deleted.";
        return;
    }

    chatThreads = chatThreads.filter((item) => item.id !== thread.id);
    tasks = tasks.filter((task) => task.chatId !== thread.id);
    if (activeThreadId === thread.id) startNewChat();
    renderThreads();
    renderTasks();
}

function renderTasks() {
    taskList.textContent = "";

    if (tasks.length === 0) {
        const empty = document.createElement("p");
        empty.className = "sidebar-empty";
        empty.textContent = "No tasks yet.";
        taskList.appendChild(empty);
        return;
    }

    tasks.forEach((task) => {
        const item = document.createElement("div");
        item.className = "task-item";
        item.dataset.completed = String(task.completed);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task.completed;
        checkbox.setAttribute("aria-label", `Mark ${task.title} complete`);
        checkbox.addEventListener("change", () => updateTask(task.id, checkbox.checked));

        const title = document.createElement("button");
        title.type = "button";
        title.className = "task-title-button";
        title.textContent = task.title;
        title.addEventListener("click", () => selectThread(task.chatId));

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "task-delete";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Delete ${task.title}`);
        remove.addEventListener("click", () => deleteTask(task.id));

        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "task-pin";
        pin.textContent = task.pinned ? "Pinned" : "Pin";
        pin.setAttribute("aria-label", `${task.pinned ? "Unpin" : "Pin"} ${task.title}`);
        pin.addEventListener("click", () => updateTask(task.id, undefined, !task.pinned));

        item.append(checkbox, title, pin, remove);
        taskList.appendChild(item);
    });
}

async function loadWorkspace() {
    try {
        const response = await fetch("/workspace");
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Workspace could not load.");

        chatThreads = data.chats;
        tasks = data.tasks;
        renderThreads();
        renderTasks();
    } catch {
        chatThreadList.innerHTML = '<p class="sidebar-empty">Saved chats are unavailable.</p>';
        taskList.innerHTML = '<p class="sidebar-empty">Tasks are unavailable.</p>';
    }
}

async function selectThread(threadId) {
    activeThreadId = threadId;
    renderThreads();
    chat.textContent = "";
    textStatus.textContent = "Loading chat...";

    try {
        const response = await fetch(`/chats/${encodeURIComponent(threadId)}/messages`);
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Chat could not load.");

        data.messages.forEach((message) => {
            appendChatMessage(
                message.role === "user" ? "You" : "My AI",
                message.content,
                [],
                message.role === "assistant"
            );
        });
        textStatus.textContent = "";
    } catch {
        textStatus.textContent = "This saved chat could not be loaded.";
    }
}

function startNewChat() {
    activeThreadId = null;
    chat.textContent = "";
    textStatus.textContent = "New chat ready.";
    renderThreads();
    input.focus();
}

async function addTask(title) {
    const response = await fetch("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Task could not be added.");
    tasks.unshift(data.task);
    renderTasks();
}

async function updateTask(taskId, completed, pinned) {
    try {
        const response = await fetch(`/tasks/${encodeURIComponent(taskId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
                typeof completed === "boolean" ? { completed } : { pinned }
            )
        });
        if (!response.ok) throw new Error();
        tasks = tasks.map((task) =>
            task.id === taskId
                ? {
                      ...task,
                      ...(typeof completed === "boolean" ? { completed } : { pinned })
                  }
                : task
        );
        tasks.sort((a, b) => Number(b.pinned) - Number(a.pinned));
        renderTasks();
    } catch {
        await loadWorkspace();
    }
}

async function deleteTask(taskId) {
    const task = tasks.find((item) => item.id === taskId);
    const approved = window.confirm(
        `Delete “${task?.title || "this task"}” and its saved chat? This cannot be undone.`
    );
    if (!approved) return;

    try {
        const response = await fetch(`/tasks/${encodeURIComponent(taskId)}`, {
            method: "DELETE"
        });
        if (!response.ok) throw new Error();
        tasks = tasks.filter((task) => task.id !== taskId);
        renderTasks();
    } catch {
        await loadWorkspace();
    }
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
                searchWeb: searchWeb,
                threadId: activeThreadId
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "The message could not be sent.");
        }

        appendChatMessage("My AI", data.reply, data.citations, true);
        activeThreadId = data.threadId;

        const existingThread = chatThreads.find((thread) => thread.id === data.threadId);
        if (existingThread) {
            existingThread.title = data.threadTitle;
            chatThreads = [existingThread, ...chatThreads.filter((thread) => thread.id !== data.threadId)];
        } else {
            chatThreads.unshift({ id: data.threadId, title: data.threadTitle });
        }
        renderThreads();
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

newChatButton.addEventListener("click", startNewChat);
composerMicButton.addEventListener("click", startVoice);

taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = taskInput.value.trim();
    if (!title) return;

    taskInput.disabled = true;
    try {
        await addTask(title);
        taskInput.value = "";
    } finally {
        taskInput.disabled = false;
        taskInput.focus();
    }
});

loadWorkspace();

function selectedUploads() {
    return [...(documentInput.files ?? []), ...(folderInput.files ?? [])];
}

function updateSelectedFileSummary() {
    const files = selectedUploads();
    const totalMb = files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024;
    selectedFileName.textContent = files.length
        ? `${files.length} selected — ${totalMb.toFixed(1)} MB total`
        : "Documents, code, or images — up to 20 files and 20 MB total";
}

documentInput.addEventListener("change", updateSelectedFileSummary);
folderInput.addEventListener("change", updateSelectedFileSummary);

documentForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const files = selectedUploads();
    const question = documentQuestion.value.trim();

    if (files.length === 0) {
        documentStatus.textContent = "Choose files or a folder first.";
        return;
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (files.length > 20 || totalSize > 20 * 1024 * 1024) {
        documentStatus.textContent = "Choose no more than 20 files and 20 MB total.";
        return;
    }

    const payload = new FormData();
    files.forEach((file) => {
        payload.append("documents", file, file.webkitRelativePath || file.name);
    });
    payload.set(
        "question",
        question || "Summarize this document and suggest useful improvements or next steps."
    );

    analyzeDocumentButton.disabled = true;
    documentStatus.textContent = "Uploading and reviewing your document...";
    documentResult.textContent = "";

    try {
        const response = await fetch("/analyze-document", {
            method: "POST",
            body: payload
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "The document could not be reviewed.");
        }

        documentResult.textContent = data.reply;
        documentStatus.textContent = data.skipped?.length
            ? `Review complete. ${data.skipped.length} unsupported file(s) were skipped.`
            : "Review complete.";
    } catch (error) {
        documentStatus.textContent = error?.message || "Document review is temporarily unavailable.";
    } finally {
        analyzeDocumentButton.disabled = false;
    }
});
