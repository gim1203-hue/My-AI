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
    const body = await readJson(request);
    const userMessage = body.message;

    if (typeof userMessage !== "string" || userMessage.trim() === "") {
        return json({ error: "A message is required." }, 400);
    }

    try {
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

        return json({ ...result, searchedWeb: searchWeb });
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
