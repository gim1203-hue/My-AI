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
const documentQuestion = input;
const analyzeDocumentButton = document.getElementById("analyzeDocumentButton") || sendButton;
const selectedFileName = document.getElementById("selectedFileName");
const selectedFilesPanel = document.getElementById("selectedFilesPanel");
const selectedFolderName = document.getElementById("selectedFolderName");
const selectedFilesList = document.getElementById("selectedFilesList");
const documentStatus = document.getElementById("documentStatus");
const documentResult = document.getElementById("documentResult");
const newChatButton = document.getElementById("newChatButton");
const chatThreadList = document.getElementById("chatThreadList");
const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskList = document.getElementById("taskList");
const composerMicButton = document.getElementById("composerMicButton");
const connectFolderButton = document.getElementById("connectFolderButton");
const proposeChangesButton = document.getElementById("proposeChangesButton");
const editableFolderStatus = document.getElementById("editableFolderStatus");
const editProposal = document.getElementById("editProposal");
const editProposalSummary = document.getElementById("editProposalSummary");
const editProposalList = document.getElementById("editProposalList");
const applyChangesButton = document.getElementById("applyChangesButton");
const connectedFileSelect = document.getElementById("connectedFileSelect");
const codeEditor = document.getElementById("codeEditor");
const codeEditorStatus = document.getElementById("codeEditorStatus");
const copyCodeButton = document.getElementById("copyCodeButton");
const saveCodeButton = document.getElementById("saveCodeButton");

let peerConnection = null;
let microphoneStream = null;
let eventChannel = null;
let voiceStarting = false;
let activeThreadId = null;
let chatThreads = [];
let tasks = [];
let connectedDirectoryHandle = null;
let connectedFolderFiles = [];
let connectedFileHandles = new Map();
let pendingFileChanges = [];
let activeEditablePath = null;

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

    if (selectedUploads().length > 0) {
        documentForm.requestSubmit();
        return;
    }

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
    return [
        ...(documentInput.files ?? []),
        ...(folderInput.files ?? []),
        ...connectedFolderFiles,
        ...cameraCapturedAttachedFiles
    ];
}

const supportedUploadExtensions = [
    ".pdf", ".doc", ".docx", ".txt", ".md", ".csv", ".html", ".htm",
    ".css", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".json", ".xml",
    ".py", ".java", ".c", ".cpp", ".h", ".sql", ".yaml", ".yml",
    ".png", ".jpg", ".jpeg", ".webp", ".gif"
];

function isSupportedUpload(file) {
    const name = file.name.toLowerCase();
    return file.size > 0 && supportedUploadExtensions.some((extension) => name.endsWith(extension));
}

const editableTextExtensions = [
    ".txt", ".md", ".csv", ".html", ".htm", ".css", ".js", ".mjs",
    ".ts", ".tsx", ".jsx", ".json", ".xml", ".py", ".java", ".c",
    ".cpp", ".h", ".sql", ".yaml", ".yml"
];

function isEditableTextFile(name) {
    const lowerName = name.toLowerCase();
    return editableTextExtensions.some((extension) => lowerName.endsWith(extension));
}

async function collectEditableFolderFiles(directoryHandle, relativePath = "", result = []) {
    const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", ".wrangler", ".my-ai-backups"]);

    for await (const [name, handle] of directoryHandle.entries()) {
        if (handle.kind === "directory") {
            if (!ignoredDirectories.has(name)) {
                await collectEditableFolderFiles(handle, `${relativePath}${name}/`, result);
            }
            continue;
        }

        if (!isSupportedUpload({ name, size: 1 })) {
            continue;
        }

        const file = await handle.getFile();
        Object.defineProperty(file, "myAiRelativePath", {
            value: `${relativePath}${name}`,
            configurable: true
        });
        result.push(file);
        connectedFileHandles.set(`${relativePath}${name}`, handle);
    }

    return result;
}

async function connectEditableFolder() {
    if (!("showDirectoryPicker" in window)) {
        editableFolderStatus.textContent = "Editable folders require a current Chrome or Edge browser.";
        return;
    }

    try {
        const handle = await window.showDirectoryPicker({ mode: "readwrite" });
        connectedFileHandles = new Map();
        connectedDirectoryHandle = handle;
        connectedFolderFiles = await collectEditableFolderFiles(handle);
        populateConnectedFileSelect();
        folderInput.value = "";
        documentInput.value = "";
        updateSelectedFileSummary();
        proposeChangesButton.disabled = connectedFolderFiles.length === 0;
        editableFolderStatus.textContent = connectedFolderFiles.length
            ? `${handle.name} connected — ${connectedFolderFiles.length} readable file(s). Nothing changes until you approve it.`
            : `${handle.name} connected, but no supported readable files were found.`;
    } catch (error) {
        if (error?.name !== "AbortError") {
            editableFolderStatus.textContent = "The folder could not be connected. Check the browser permission and try again.";
        }
    }
}

function populateConnectedFileSelect() {
    connectedFileSelect.replaceChildren();
    const paths = [...connectedFileHandles.keys()].filter(isEditableTextFile).sort();

    if (!paths.length) {
        const option = document.createElement("option");
        option.textContent = "No editable text or code files found";
        connectedFileSelect.append(option);
        connectedFileSelect.disabled = true;
        codeEditor.disabled = true;
        copyCodeButton.disabled = true;
        saveCodeButton.disabled = true;
        return;
    }

    paths.forEach((path) => {
        const option = document.createElement("option");
        option.value = path;
        option.textContent = path;
        connectedFileSelect.append(option);
    });
    connectedFileSelect.disabled = false;
    connectedFileSelect.selectedIndex = 0;
    loadSelectedConnectedFile();
}

async function loadSelectedConnectedFile() {
    const path = connectedFileSelect.value;
    const handle = connectedFileHandles.get(path);
    if (!handle) return;

    try {
        const file = await handle.getFile();
        codeEditor.value = await file.text();
        activeEditablePath = path;
        codeEditor.disabled = false;
        copyCodeButton.disabled = false;
        saveCodeButton.disabled = false;
        codeEditorStatus.textContent = `${path} — edit here, copy it, or save with a backup.`;
    } catch {
        codeEditorStatus.textContent = "That file could not be opened.";
    }
}

async function copyVisibleCode() {
    try {
        await navigator.clipboard.writeText(codeEditor.value);
        codeEditorStatus.textContent = `${activeEditablePath} copied to the clipboard.`;
    } catch {
        codeEditorStatus.textContent = "The browser could not copy the code. Select it manually and press Control-C.";
    }
}

async function saveVisibleCode() {
    const handle = connectedFileHandles.get(activeEditablePath);
    if (!handle || !connectedDirectoryHandle) return;

    if (!window.confirm(`Save your changes to ${activeEditablePath}? The original will be backed up first.`)) {
        codeEditorStatus.textContent = "No file was changed.";
        return;
    }

    const permission = await connectedDirectoryHandle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") {
        codeEditorStatus.textContent = "Write permission was not granted. No file was changed.";
        return;
    }

    saveCodeButton.disabled = true;
    try {
        const originalContent = await (await handle.getFile()).text();
        const backupName = new Date().toISOString().replace(/[:.]/g, "-");
        await createBackupFile(connectedDirectoryHandle, backupName, activeEditablePath, originalContent);
        const writable = await handle.createWritable();
        await writable.write(codeEditor.value);
        await writable.close();
        codeEditorStatus.textContent = `${activeEditablePath} saved. The original is in .my-ai-backups.`;
    } catch (error) {
        codeEditorStatus.textContent = error?.message || "The file could not be saved.";
    } finally {
        saveCodeButton.disabled = false;
    }
}

function renderEditProposal(proposal) {
    pendingFileChanges = proposal.changes;
    editProposalSummary.textContent = proposal.summary;
    editProposalList.replaceChildren();

    proposal.changes.forEach((change, index) => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        const text = document.createElement("span");
        const explanation = document.createElement("small");

        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.dataset.changeIndex = String(index);
        text.append(change.path);
        explanation.textContent = change.explanation;
        text.append(explanation);
        label.append(checkbox, text);
        editProposalList.append(label);
    });

    editProposal.hidden = false;
    applyChangesButton.disabled = proposal.changes.length === 0;
}

async function proposeFolderChanges() {
    const instruction = input.value.trim();
    if (!connectedDirectoryHandle) {
        editableFolderStatus.textContent = "Connect an editable folder first.";
        return;
    }
    if (!instruction) {
        editableFolderStatus.textContent = "Type the change you want in the message box first.";
        input.focus();
        return;
    }

    const candidates = [];
    let totalCharacters = 0;
    for (const file of connectedFolderFiles) {
        const path = file.myAiRelativePath || file.name;
        if (!isEditableTextFile(path) || candidates.length >= 40) continue;
        const content = await file.text();
        if (totalCharacters + content.length > 400_000) continue;
        candidates.push({ path, content });
        totalCharacters += content.length;
    }

    if (!candidates.length) {
        editableFolderStatus.textContent = "No editable text or code files were found in that folder.";
        return;
    }

    if (!window.confirm(
        `Send ${candidates.length} text or code file(s) to OpenAI to propose changes? No local files will be changed yet.`
    )) {
        editableFolderStatus.textContent = "Change proposal canceled. No files were sent.";
        return;
    }

    proposeChangesButton.disabled = true;
    editableFolderStatus.textContent = "Reading the connected folder and preparing proposed changes...";
    try {
        const response = await fetch("/propose-edits", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instruction, files: candidates })
        });
        const proposal = await response.json();
        if (!response.ok) {
            throw new Error(proposal.error || "Changes could not be proposed.");
        }
        renderEditProposal(proposal);
        editableFolderStatus.textContent = "Review the proposed files below. Nothing has been written yet.";
    } catch (error) {
        editableFolderStatus.textContent = error?.message || "Changes could not be proposed.";
    } finally {
        proposeChangesButton.disabled = false;
    }
}

async function createBackupFile(rootHandle, backupName, relativePath, originalContent) {
    let directory = await rootHandle.getDirectoryHandle(".my-ai-backups", { create: true });
    directory = await directory.getDirectoryHandle(backupName, { create: true });
    const parts = relativePath.split("/");
    const fileName = parts.pop();
    for (const part of parts) {
        directory = await directory.getDirectoryHandle(part, { create: true });
    }
    const backupHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await backupHandle.createWritable();
    await writable.write(originalContent);
    await writable.close();
}

async function applyApprovedChanges() {
    const approved = [...editProposalList.querySelectorAll('input[type="checkbox"]:checked')]
        .map((checkbox) => pendingFileChanges[Number(checkbox.dataset.changeIndex)])
        .filter(Boolean);

    if (!approved.length) {
        editableFolderStatus.textContent = "Select at least one proposed file change.";
        return;
    }

    if (!window.confirm(
        `Apply ${approved.length} selected change(s) to ${connectedDirectoryHandle.name}? Original files will be backed up first.`
    )) {
        editableFolderStatus.textContent = "No local files were changed.";
        return;
    }

    const permission = await connectedDirectoryHandle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") {
        editableFolderStatus.textContent = "Write permission was not granted. No files were changed.";
        return;
    }

    applyChangesButton.disabled = true;
    const backupName = new Date().toISOString().replace(/[:.]/g, "-");
    try {
        for (const change of approved) {
            const handle = connectedFileHandles.get(change.path);
            if (!handle) throw new Error(`The file ${change.path} is no longer available.`);
            const originalContent = await (await handle.getFile()).text();
            await createBackupFile(connectedDirectoryHandle, backupName, change.path, originalContent);
            const writable = await handle.createWritable();
            await writable.write(change.content);
            await writable.close();
        }

        connectedFileHandles = new Map();
        connectedFolderFiles = await collectEditableFolderFiles(connectedDirectoryHandle);
        populateConnectedFileSelect();
        updateSelectedFileSummary();
        editProposal.hidden = true;
        pendingFileChanges = [];
        editableFolderStatus.textContent = `${approved.length} file(s) updated. Backups are saved inside .my-ai-backups.`;
    } catch (error) {
        editableFolderStatus.textContent = error?.message || "The approved changes could not be applied.";
    } finally {
        applyChangesButton.disabled = false;
    }
}

connectFolderButton.addEventListener("click", connectEditableFolder);
proposeChangesButton.addEventListener("click", proposeFolderChanges);
applyChangesButton.addEventListener("click", applyApprovedChanges);
connectedFileSelect.addEventListener("change", loadSelectedConnectedFile);
copyCodeButton.addEventListener("click", copyVisibleCode);
saveCodeButton.addEventListener("click", saveVisibleCode);

function uploadBatchesForReview(files, question) {
    const supported = files.filter(isSupportedUpload);
    const wantsHtml = /\bhtml?\b/i.test(question);
    if (wantsHtml) {
        supported.sort((left, right) => {
            const leftHtml = /\.html?$/i.test(left.name) ? 0 : 1;
            const rightHtml = /\.html?$/i.test(right.name) ? 0 : 1;
            return leftHtml - rightHtml;
        });
    }

    const batches = [];
    let currentBatch = [];
    let currentSize = 0;
    let skippedCount = files.length - supported.length;

    for (const file of supported) {
        if (file.size > 20 * 1024 * 1024) {
            skippedCount += 1;
            continue;
        }

        if (currentBatch.length >= 20 || currentSize + file.size > 20 * 1024 * 1024) {
            batches.push(currentBatch);
            currentBatch = [];
            currentSize = 0;
        }

        currentBatch.push(file);
        currentSize += file.size;
    }

    if (currentBatch.length) {
        batches.push(currentBatch);
    }

    return { batches, skippedCount };
}

function updateSelectedFileSummary() {
    const files = selectedUploads();
    const totalMb = files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024;
    selectedFileName.textContent = files.length
        ? `${files.length} selected — ${totalMb.toFixed(1)} MB total`
        : "Documents, code, or images";

    selectedFilesPanel.hidden = files.length === 0;
    selectedFilesList.replaceChildren();

    if (!files.length) {
        selectedFolderName.textContent = "";
        documentStatus.textContent = "";
        return;
    }

    const firstPath = files[0].webkitRelativePath || files[0].myAiRelativePath || "";
    const folder = firstPath.includes("/") ? firstPath.split("/")[0] : "Selected files";
    selectedFolderName.textContent = `${folder} — ${files.length} item${files.length === 1 ? "" : "s"}`;

    files.slice(0, 50).forEach((file) => {
        const item = document.createElement("li");
        item.textContent = file.webkitRelativePath || file.myAiRelativePath || file.name;
        selectedFilesList.append(item);
    });

    if (files.length > 50) {
        const item = document.createElement("li");
        item.textContent = `And ${files.length - 50} more…`;
        selectedFilesList.append(item);
    }

    documentStatus.textContent = "Files are shown below. Type what you want My AI to do, then press Analyze document.";
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

    const { batches, skippedCount } = uploadBatchesForReview(files, question);
    if (batches.length === 0) {
        documentStatus.textContent = "This folder has no supported documents, code, or images to analyze.";
        return;
    }

    if (batches.length > 1 && !window.confirm(
        `This folder needs ${batches.length} separate AI analysis requests. Each request uses API credit. Continue?`
    )) {
        documentStatus.textContent = "Folder analysis canceled. No files were sent.";
        return;
    }

    analyzeDocumentButton.disabled = true;
    documentResult.textContent = "";

    try {
        const replies = [];
        for (let index = 0; index < batches.length; index += 1) {
            const batch = batches[index];
            documentStatus.textContent = `Reviewing batch ${index + 1} of ${batches.length} (${batch.length} files)...`;

            const payload = new FormData();
            batch.forEach((file) => {
                payload.append("documents", file, file.webkitRelativePath || file.myAiRelativePath || file.name);
            });
            payload.set(
                "question",
                `${question || "Summarize these files and suggest useful improvements or next steps."}\n\nThis is batch ${index + 1} of ${batches.length} from the selected folder.`
            );

            const response = await fetch("/analyze-document", {
                method: "POST",
                body: payload
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `Batch ${index + 1} could not be reviewed.`);
            }

            replies.push(batches.length > 1 ? `Batch ${index + 1}\n${data.reply}` : data.reply);
        }

        const combinedReply = replies.join("\n\n────────────────────\n\n");
        appendChatMessage("You", question || "Analyze the selected files.");
        appendChatMessage("My AI", combinedReply, [], true);
        chat.scrollTop = chat.scrollHeight;
        documentResult.textContent = "";
        input.value = "";
        documentInput.value = "";
        folderInput.value = "";
        updateSelectedFileSummary();
        documentStatus.textContent = skippedCount
            ? `Review complete. ${skippedCount} unsupported or oversized file(s) stayed on your device.`
            : "Review complete.";
    } catch (error) {
        documentStatus.textContent = error?.message || "Document review is temporarily unavailable.";
    } finally {
        analyzeDocumentButton.disabled = false;
    }
});

/* ============================================================
   ADDED FEATURES — everything below is new. Nothing above this
   line was changed except selectedUploads(), which now also
   includes photos captured with the camera tool and attached
   by the user.
   ============================================================ */

let cameraCapturedAttachedFiles = [];

/* ---------------- Floating window: drag / resize / minimize / maximize ---------------- */
(function setupWindowChrome() {
    const win = document.getElementById("aiWindow");
    const titlebar = document.getElementById("aiWindowTitlebar");
    const minimizeBtn = document.getElementById("aiMinimizeBtn");
    const maximizeBtn = document.getElementById("aiMaximizeBtn");
    const restoreLauncher = document.getElementById("aiRestoreLauncher");
    const resizeHandle = document.getElementById("aiResizeHandle");
    if (!win || !titlebar || !minimizeBtn || !maximizeBtn || !restoreLauncher || !resizeHandle) return;

    let dragOffset = null;
    let previousState = null;

    function clearInlinePosition() {
        win.style.left = "";
        win.style.top = "";
        win.style.right = "";
        win.style.bottom = "";
        win.style.transform = "";
    }

    titlebar.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".ai-window-btn")) return;
        if (win.dataset.state === "maximized") return;

        const rect = win.getBoundingClientRect();
        win.style.left = `${rect.left}px`;
        win.style.top = `${rect.top}px`;
        win.style.right = "auto";
        win.style.bottom = "auto";
        win.style.transform = "none";

        dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        win.classList.add("is-dragging");
        titlebar.setPointerCapture(event.pointerId);
    });

    titlebar.addEventListener("pointermove", (event) => {
        if (!dragOffset) return;
        const margin = 16;
        const rect = win.getBoundingClientRect();
        const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
        const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
        const left = Math.min(Math.max(event.clientX - dragOffset.x, margin), maxLeft);
        const top = Math.min(Math.max(event.clientY - dragOffset.y, margin), maxTop);
        win.style.left = `${left}px`;
        win.style.top = `${top}px`;
    });

    function endDrag(event) {
        if (!dragOffset) return;
        dragOffset = null;
        win.classList.remove("is-dragging");
        try {
            titlebar.releasePointerCapture(event.pointerId);
        } catch {
            // pointer capture may already be released
        }
    }

    titlebar.addEventListener("pointerup", endDrag);
    titlebar.addEventListener("pointercancel", endDrag);

    let resizeStart = null;

    resizeHandle.addEventListener("pointerdown", (event) => {
        if (win.dataset.state === "maximized") return;
        const rect = win.getBoundingClientRect();
        win.style.left = `${rect.left}px`;
        win.style.top = `${rect.top}px`;
        win.style.right = "auto";
        win.style.bottom = "auto";
        win.style.transform = "none";
        resizeStart = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
        win.classList.add("is-resizing");
        resizeHandle.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    resizeHandle.addEventListener("pointermove", (event) => {
        if (!resizeStart) return;
        const margin = 16;
        const currentLeft = parseFloat(win.style.left) || 0;
        const currentTop = parseFloat(win.style.top) || 0;
        const maxWidth = Math.max(360, window.innerWidth - currentLeft - margin);
        const maxHeight = Math.max(320, window.innerHeight - currentTop - margin);
        const nextWidth = Math.max(360, resizeStart.width + (event.clientX - resizeStart.x));
        const nextHeight = Math.max(320, resizeStart.height + (event.clientY - resizeStart.y));
        win.style.width = `${Math.min(nextWidth, maxWidth)}px`;
        win.style.height = `${Math.min(nextHeight, maxHeight)}px`;
    });

    function endResize(event) {
        if (!resizeStart) return;
        resizeStart = null;
        win.classList.remove("is-resizing");
        try {
            resizeHandle.releasePointerCapture(event.pointerId);
        } catch {
            // pointer capture may already be released
        }
    }

    resizeHandle.addEventListener("pointerup", endResize);
    resizeHandle.addEventListener("pointercancel", endResize);

    minimizeBtn.addEventListener("click", () => {
        win.dataset.state = "minimized";
        restoreLauncher.hidden = false;
    });

    restoreLauncher.addEventListener("click", () => {
        win.dataset.state = previousState || "normal";
        restoreLauncher.hidden = true;
    });

    maximizeBtn.addEventListener("click", () => {
        if (win.dataset.state === "maximized") {
            win.dataset.state = "normal";
            maximizeBtn.title = "Maximize";
            maximizeBtn.setAttribute("aria-label", "Maximize");
        } else {
            previousState = "normal";
            clearInlinePosition();
            win.style.width = "";
            win.style.height = "";
            win.dataset.state = "maximized";
            maximizeBtn.title = "Restore";
            maximizeBtn.setAttribute("aria-label", "Restore");
        }
    });
})();

/* ---------------- Tool modal open/close helper ---------------- */
function wireToolModal(backdropId, openButtonIds, closeButtonId, onOpen) {
    const backdrop = document.getElementById(backdropId);
    const closeButton = document.getElementById(closeButtonId);
    if (!backdrop || !closeButton) return;

    function open() {
        backdrop.hidden = false;
        if (typeof onOpen === "function") onOpen();
    }

    function close() {
        backdrop.hidden = true;
    }

    openButtonIds.forEach((id) => {
        const button = document.getElementById(id);
        if (button) button.addEventListener("click", open);
    });

    closeButton.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) close();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !backdrop.hidden) close();
    });
}

/* ---------------- Web search tool (Google-style results) ---------------- */
(function setupSearchTool() {
    const form = document.getElementById("searchToolForm");
    const input = document.getElementById("searchToolInput");
    const status = document.getElementById("searchToolStatus");
    const results = document.getElementById("searchToolResults");
    if (!form || !input || !status || !results) return;

    wireToolModal("searchModalBackdrop", ["openSearchBtn"], "searchModalClose", () => {
        input.focus();
    });

    function safeUrl(value) {
        try {
            const url = new URL(value);
            return ["http:", "https:"].includes(url.protocol) ? url : null;
        } catch {
            return null;
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const query = input.value.trim();
        if (!query) return;

        status.textContent = `Searching for "${query}"...`;
        results.textContent = "";

        try {
            const response = await fetch("/web-search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Search failed.");

            if (data.reply) {
                const summary = document.createElement("div");
                summary.className = "search-summary-card";
                summary.textContent = data.reply;
                results.appendChild(summary);
            }

            const citations = (data.citations || [])
                .map((citation) => ({ ...citation, safe: safeUrl(citation.url) }))
                .filter((citation) => citation.safe);

            citations.forEach((citation) => {
                const card = document.createElement("div");
                card.className = "search-result-card";

                const domain = document.createElement("span");
                domain.className = "result-domain";
                domain.textContent = citation.safe.hostname;

                const link = document.createElement("a");
                link.href = citation.safe.href;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = citation.title || citation.safe.hostname;

                card.append(domain, link);
                results.appendChild(card);
            });

            status.textContent = citations.length
                ? `${citations.length} source${citations.length === 1 ? "" : "s"} for "${query}"`
                : `Results for "${query}"`;
        } catch (error) {
            status.textContent = error?.message || "Search is temporarily unavailable.";
        }
    });
})();

/* ---------------- Record & playback (up to 24 hours) ---------------- */
(function setupRecordTool() {
    const startButton = document.getElementById("startRecordButton");
    const stopButton = document.getElementById("stopRecordButton");
    const timerLabel = document.getElementById("recordTimer");
    const status = document.getElementById("recordStatus");
    const playbackWrap = document.getElementById("recordPlaybackWrap");
    const playbackAudio = document.getElementById("recordPlayback");
    const downloadLink = document.getElementById("recordDownloadLink");
    if (!startButton || !stopButton || !timerLabel || !status) return;

    const MAX_RECORD_MS = 24 * 60 * 60 * 1000;
    let mediaRecorder = null;
    let recordingStream = null;
    let recordedChunks = [];
    let timerInterval = null;
    let autoStopTimeout = null;
    let startedAt = 0;

    wireToolModal("recordModalBackdrop", ["openRecordBtn"], "recordModalClose");

    function formatElapsed(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
        const seconds = String(totalSeconds % 60).padStart(2, "0");
        return `${hours}:${minutes}:${seconds}`;
    }

    function tickTimer() {
        timerLabel.textContent = formatElapsed(Date.now() - startedAt);
    }

    async function startRecording() {
        try {
            recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
            status.textContent =
                error?.name === "NotAllowedError"
                    ? "Microphone permission was denied."
                    : "The microphone could not be started.";
            return;
        }

        recordedChunks = [];
        const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
        mediaRecorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);

        mediaRecorder.addEventListener("dataavailable", (event) => {
            if (event.data && event.data.size > 0) recordedChunks.push(event.data);
        });

        mediaRecorder.addEventListener("stop", () => {
            const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
            const url = URL.createObjectURL(blob);
            if (playbackAudio) playbackAudio.src = url;
            if (downloadLink) downloadLink.href = url;
            if (playbackWrap) playbackWrap.hidden = false;
            status.textContent = `Recording ready — ${formatElapsed(Date.now() - startedAt)} long.`;

            if (recordingStream) {
                recordingStream.getTracks().forEach((track) => track.stop());
                recordingStream = null;
            }
        });

        mediaRecorder.start(1000);
        startedAt = Date.now();
        timerLabel.textContent = "00:00:00";
        status.textContent = "Recording...";
        startButton.disabled = true;
        stopButton.disabled = false;

        timerInterval = setInterval(tickTimer, 1000);
        autoStopTimeout = setTimeout(() => stopRecording(), MAX_RECORD_MS);
    }

    function stopRecording() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (autoStopTimeout) {
            clearTimeout(autoStopTimeout);
            autoStopTimeout = null;
        }
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
        startButton.disabled = false;
        stopButton.disabled = true;
    }

    startButton.addEventListener("click", startRecording);
    stopButton.addEventListener("click", () => stopRecording());
})();

/* ---------------- Camera capture ---------------- */
(function setupCameraTool() {
    const openStreamButton = document.getElementById("openCameraStreamButton");
    const closeStreamButton = document.getElementById("closeCameraStreamButton");
    const captureButton = document.getElementById("capturePhotoButton");
    const video = document.getElementById("cameraPreview");
    const canvas = document.getElementById("cameraCanvas");
    const status = document.getElementById("cameraStatus");
    const gallery = document.getElementById("cameraGallery");
    if (!openStreamButton || !closeStreamButton || !captureButton || !video || !canvas || !status || !gallery) return;

    let cameraStream = null;
    let shotCount = 0;

    wireToolModal("cameraModalBackdrop", ["openCameraBtn"], "cameraModalClose", () => {});

    async function openCamera() {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
                audio: false
            });
        } catch {
            status.textContent = "The camera could not be started. Check permissions and try again.";
            return;
        }

        video.srcObject = cameraStream;
        status.textContent = "Camera is on.";
        openStreamButton.disabled = true;
        closeStreamButton.disabled = false;
        captureButton.disabled = false;
    }

    function closeCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach((track) => track.stop());
            cameraStream = null;
        }
        video.srcObject = null;
        status.textContent = "Camera is off.";
        openStreamButton.disabled = false;
        closeStreamButton.disabled = true;
        captureButton.disabled = true;
    }

    function capturePhoto() {
        if (!cameraStream) return;
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 480;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(video, 0, 0, width, height);

        canvas.toBlob((blob) => {
            if (!blob) return;
            shotCount += 1;
            const fileName = `camera-photo-${shotCount}.jpg`;
            const file = new File([blob], fileName, { type: "image/jpeg" });
            const previewUrl = URL.createObjectURL(blob);

            const figure = document.createElement("figure");
            const img = document.createElement("img");
            img.src = previewUrl;
            img.alt = fileName;

            const figcaption = document.createElement("figcaption");
            const attachButton = document.createElement("button");
            attachButton.type = "button";
            attachButton.textContent = "Attach";
            attachButton.addEventListener("click", () => {
                cameraCapturedAttachedFiles.push(file);
                attachButton.textContent = "Attached";
                attachButton.disabled = true;
                if (typeof updateSelectedFileSummary === "function") updateSelectedFileSummary();
                status.textContent = `${fileName} attached — it will be sent with your next message.`;
            });

            figcaption.appendChild(attachButton);
            figure.append(img, figcaption);
            gallery.prepend(figure);
        }, "image/jpeg", 0.92);
    }

    openStreamButton.addEventListener("click", openCamera);
    closeStreamButton.addEventListener("click", closeCamera);
    captureButton.addEventListener("click", capturePhoto);
})();
