function json(data, status = 200) {
    return Response.json(data, { status });
}

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return {};
    }
}

let schemaReady;

function ensureDatabase(env) {
    if (!schemaReady) {
        schemaReady = env.DB.batch([
            env.DB.prepare(`CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )`),
            env.DB.prepare(`CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
            )`),
            env.DB.prepare(`CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                title TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
            )`),
            env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC)"),
            env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, id)"),
            env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_pinned_completed_created ON tasks(pinned DESC, completed, created_at DESC)"),
            env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_chat_id ON tasks(chat_id)")
        ]).catch((error) => {
            schemaReady = null;
            throw error;
        });
    }

    return schemaReady;
}

function mapTask(row) {
    return {
        id: row.id,
        chatId: row.chat_id,
        title: row.title,
        completed: Boolean(row.completed),
        pinned: Boolean(row.pinned)
    };
}

async function handleWorkspace(env) {
    await ensureDatabase(env);
    const [chatResult, taskResult] = await env.DB.batch([
        env.DB.prepare("SELECT id, title FROM chats ORDER BY updated_at DESC LIMIT 100"),
        env.DB.prepare(
            "SELECT id, chat_id, title, completed, pinned FROM tasks ORDER BY pinned DESC, completed ASC, created_at DESC LIMIT 200"
        )
    ]);

    return json({
        chats: chatResult.results ?? [],
        tasks: (taskResult.results ?? []).map(mapTask)
    });
}

async function handleChatMessages(env, chatId) {
    await ensureDatabase(env);
    const result = await env.DB.prepare(
        "SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC LIMIT 500"
    )
        .bind(chatId)
        .all();
    return json({ messages: result.results ?? [] });
}

async function handleCreateTask(request, env) {
    await ensureDatabase(env);
    const body = await readJson(request);
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!title || title.length > 160) {
        return json({ error: "Enter a short task title." }, 400);
    }

    const taskId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.batch([
        env.DB.prepare("INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(
            chatId,
            title,
            now,
            now
        ),
        env.DB.prepare(
            "INSERT INTO tasks (id, chat_id, title, completed, pinned, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)"
        ).bind(taskId, chatId, title, now, now)
    ]);

    return json({ task: { id: taskId, chatId, title, completed: false, pinned: false } }, 201);
}

async function handleUpdateTask(request, env, taskId) {
    await ensureDatabase(env);
    const body = await readJson(request);

    if (typeof body.completed !== "boolean" && typeof body.pinned !== "boolean") {
        return json({ error: "A completed or pinned value is required." }, 400);
    }

    if (typeof body.completed === "boolean") {
        await env.DB.prepare("UPDATE tasks SET completed = ?, updated_at = ? WHERE id = ?")
            .bind(body.completed ? 1 : 0, new Date().toISOString(), taskId)
            .run();
    } else {
        await env.DB.prepare("UPDATE tasks SET pinned = ?, updated_at = ? WHERE id = ?")
            .bind(body.pinned ? 1 : 0, new Date().toISOString(), taskId)
            .run();
    }
    return json({ ok: true });
}

async function handleDeleteTask(env, taskId) {
    await ensureDatabase(env);
    const task = await env.DB.prepare("SELECT chat_id FROM tasks WHERE id = ?").bind(taskId).first();
    if (!task) return json({ error: "Task not found." }, 404);

    await env.DB.batch([
        env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(taskId),
        env.DB.prepare("DELETE FROM chats WHERE id = ?").bind(task.chat_id)
    ]);
    return json({ ok: true });
}

function outputText(response) {
    return (response.output ?? [])
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? [])
        .filter((content) => content.type === "output_text")
        .map((content) => content.text)
        .join("\n");
}

function collectCitations(response) {
    const citations = [];
    const seenUrls = new Set();

    for (const item of response.output ?? []) {
        if (item.type !== "message") continue;

        for (const content of item.content ?? []) {
            for (const annotation of content.annotations ?? []) {
                if (annotation.type !== "url_citation" || !annotation.url) continue;

                if (!seenUrls.has(annotation.url)) {
                    seenUrls.add(annotation.url);
                    citations.push({
                        title: annotation.title || "Source",
                        url: annotation.url
                    });
                }
            }
        }
    }

    return citations;
}

async function openAIResponse(env, body) {
    const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data?.error?.message || "OpenAI request failed.");
    }

    return data;
}

async function searchTheWeb(env, query) {
    const response = await openAIResponse(env, {
        model: "gpt-5.6-luna",
        tools: [{ type: "web_search", search_context_size: "low" }],
        tool_choice: "auto",
        input: query
    });

    return {
        reply: outputText(response),
        citations: collectCitations(response)
    };
}

async function handleChat(request, env) {
    await ensureDatabase(env);
    const body = await readJson(request);
    const userMessage = body.message;

    if (typeof userMessage !== "string" || userMessage.trim() === "") {
        return json({ error: "A message is required." }, 400);
    }

    try {
        let threadId = typeof body.threadId === "string" ? body.threadId : null;
        let threadTitle = userMessage.trim().replace(/\s+/g, " ").slice(0, 60);
        const now = new Date().toISOString();

        if (threadId) {
            const existing = await env.DB.prepare("SELECT title FROM chats WHERE id = ?").bind(threadId).first();
            if (existing) {
                threadTitle = existing.title;
            } else {
                threadId = null;
            }
        }

        if (!threadId) {
            threadId = crypto.randomUUID();
            await env.DB.prepare("INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
                .bind(threadId, threadTitle, now, now)
                .run();
        }

        const searchWeb = body.searchWeb === true;
        const result = searchWeb
            ? await searchTheWeb(env, userMessage)
            : {
                  reply: outputText(
                      await openAIResponse(env, {
                          model: "gpt-5.6-luna",
                          input: userMessage
                      })
                  ),
                  citations: []
              };

        await env.DB.batch([
            env.DB.prepare(
                "INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, 'user', ?, ?)"
            ).bind(threadId, userMessage, now),
            env.DB.prepare(
                "INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)"
            ).bind(threadId, result.reply, new Date().toISOString()),
            env.DB.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").bind(
                new Date().toISOString(),
                threadId
            )
        ]);

        return json({
            ...result,
            searchedWeb: searchWeb,
            threadId,
            threadTitle
        });
    } catch (error) {
        console.error("Text response failed:", error?.message ?? "Unknown error");
        return json({ error: "Something went wrong." }, 500);
    }
}

async function handleWebSearch(request, env) {
    const body = await readJson(request);
    const query = body.query;

    if (typeof query !== "string" || query.trim() === "" || query.length > 500) {
        return json({ error: "A short search query is required." }, 400);
    }

    try {
        return json(await searchTheWeb(env, query));
    } catch (error) {
        console.error("Web search failed:", error?.message ?? "Unknown error");
        return json({ error: "Web search is temporarily unavailable." }, 502);
    }
}

async function handleSession(request, env) {
    const offer = await request.text();

    if (!offer.startsWith("v=")) {
        return json({ error: "A valid WebRTC offer is required." }, 400);
    }

    const sessionConfig = {
        type: "realtime",
        model: "gpt-realtime-2.1",
        instructions:
            "You are My AI, a warm and helpful voice assistant. Respond naturally and concisely. The user may interrupt you. If the user asks for current information, call search_web and mention that sources appear in text chat.",
        audio: { output: { voice: "marin" } },
        tools: [
            {
                type: "function",
                name: "search_web",
                description: "Search the public web for current information.",
                parameters: {
                    type: "object",
                    properties: { query: { type: "string" } },
                    required: ["query"]
                }
            }
        ],
        tool_choice: "auto"
    };

    const formData = new FormData();
    formData.set("sdp", offer);
    formData.set("session", JSON.stringify(sessionConfig));

    try {
        const response = await fetch("https://api.openai.com/v1/realtime/calls", {
            method: "POST",
            headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
            body: formData
        });
        const answer = await response.text();

        if (!response.ok) {
            return json(
                { error: "OpenAI rejected the voice session. Check API access and billing." },
                response.status === 401 ? 401 : 502
            );
        }

        return new Response(answer, {
            headers: { "Content-Type": "application/sdp" }
        });
    } catch (error) {
        console.error("Realtime connection failed:", error?.message ?? "Unknown error");
        return json({ error: "The voice session could not be started." }, 500);
    }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }

    return btoa(binary);
}

async function handleDocumentAnalysis(request, env) {
    try {
        const form = await request.formData();
        const file = form.get("document");
        const question = String(form.get("question") || "").trim();

        if (!(file instanceof File) || file.size === 0) {
            return json({ error: "Choose a document first." }, 400);
        }

        if (file.size > 10 * 1024 * 1024) {
            return json({ error: "The document must be 10 MB or smaller." }, 413);
        }

        const allowedExtensions = [".pdf", ".doc", ".docx", ".txt", ".md", ".csv"];
        const lowerName = file.name.toLowerCase();

        if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
            return json({ error: "Use a PDF, Word, text, Markdown, or CSV document." }, 415);
        }

        const base64 = arrayBufferToBase64(await file.arrayBuffer());
        const mimeType = file.type || "application/octet-stream";
        const response = await openAIResponse(env, {
            model: "gpt-5.6-luna",
            store: false,
            input: [
                {
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text:
                                question ||
                                "Summarize this document and suggest useful improvements or next steps."
                        },
                        {
                            type: "input_file",
                            filename: file.name,
                            file_data: `data:${mimeType};base64,${base64}`
                        }
                    ]
                }
            ]
        });

        return json({ reply: outputText(response) });
    } catch (error) {
        console.error("Document analysis failed:", error?.message ?? "Unknown error");
        return json({ error: "The document could not be reviewed right now." }, 502);
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === "GET" && url.pathname === "/workspace") {
            return handleWorkspace(env);
        }
        const messageMatch = url.pathname.match(/^\/chats\/([^/]+)\/messages$/);
        if (request.method === "GET" && messageMatch) {
            return handleChatMessages(env, decodeURIComponent(messageMatch[1]));
        }
        if (request.method === "POST" && url.pathname === "/tasks") {
            return handleCreateTask(request, env);
        }
        const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
        if (request.method === "PATCH" && taskMatch) {
            return handleUpdateTask(request, env, decodeURIComponent(taskMatch[1]));
        }
        if (request.method === "DELETE" && taskMatch) {
            return handleDeleteTask(env, decodeURIComponent(taskMatch[1]));
        }

        if (request.method === "POST" && url.pathname === "/chat") {
            return handleChat(request, env);
        }
        if (request.method === "POST" && url.pathname === "/web-search") {
            return handleWebSearch(request, env);
        }
        if (request.method === "POST" && url.pathname === "/session") {
            return handleSession(request, env);
        }
        if (request.method === "POST" && url.pathname === "/analyze-document") {
            return handleDocumentAnalysis(request, env);
        }

        return env.ASSETS.fetch(request);
    }
};
