import OpenAI from "openai";
import express from "express";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();

const allowedOrigins = [
    "https://aihelpall.com",
    "https://www.aihelpall.com",
    "https://gim1203-hue.github.io"
];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});


app.use(express.json({ limit: "2mb" }));

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

function collectCitations(response) {
    const citations = [];
    const seenUrls = new Set();

    for (const item of response.output ?? []) {
        if (item.type !== "message") {
            continue;
        }

        for (const content of item.content ?? []) {
            for (const annotation of content.annotations ?? []) {
                if (annotation.type !== "url_citation" || !annotation.url) {
                    continue;
                }

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

async function searchTheWeb(query) {
    const response = await client.responses.create({
        model: "gpt-5.6-luna",
        tools: [
            {
                type: "web_search",
                search_context_size: "low"
            }
        ],
        tool_choice: "auto",
        input: query
    });

    return {
        reply: response.output_text,
        citations: collectCitations(response)
    };
}

app.post("/chat", async (req, res) => {
    try {
        const userMessage = req.body.message;

        if (typeof userMessage !== "string" || userMessage.trim() === "") {
            return res.status(400).json({ error: "A message is required." });
        }

        const searchWeb = req.body.searchWeb === true;
        const result = searchWeb
            ? await searchTheWeb(userMessage)
            : {
                  reply: (
                      await client.responses.create({
                          model: "gpt-5.6-luna",
                          input: userMessage
                      })
                  ).output_text,
                  citations: []
              };

        res.json({
            reply: result.reply,
            citations: result.citations,
            searchedWeb: searchWeb
        });
    } catch (error) {
        console.error("Text response failed:", error?.message ?? "Unknown error");
        res.status(500).json({
            error: "Something went wrong."
        });
    }
});

app.post("/web-search", async (req, res) => {
    const query = req.body.query;

    if (typeof query !== "string" || query.trim() === "" || query.length > 500) {
        return res.status(400).json({ error: "A short search query is required." });
    }

    try {
        const result = await searchTheWeb(query);
        res.json(result);
    } catch (error) {
        console.error("Web search failed:", error?.message ?? "Unknown error");
        res.status(502).json({ error: "Web search is temporarily unavailable." });
    }
});

app.post("/propose-edits", async (req, res) => {
    try {
        const instruction = typeof req.body.instruction === "string" ? req.body.instruction.trim() : "";
        const rawFiles = Array.isArray(req.body.files) ? req.body.files : [];

        if (!instruction || instruction.length > 4000) {
            return res.status(400).json({ error: "Type a clear, shorter change request first." });
        }
        if (rawFiles.length === 0 || rawFiles.length > 40) {
            return res.status(400).json({ error: "Connect a folder containing up to 40 relevant text or code files." });
        }

        let totalCharacters = 0;
        const files = rawFiles.map((item) => {
            const path = typeof item?.path === "string" ? item.path.replace(/\\/g, "/") : "";
            const content = typeof item?.content === "string" ? item.content : null;
            if (!path || path.startsWith("/") || path.split("/").includes("..") || content === null) {
                throw new Error("INVALID_FILE_PATH");
            }
            totalCharacters += content.length;
            return { path, content };
        });

        if (totalCharacters > 400_000) {
            return res.status(413).json({ error: "Choose a smaller set of files for one change proposal." });
        }

        const fileText = files
            .map(({ path, content }) => `\n<file path="${path}">\n${content}\n</file>`)
            .join("\n");
        const response = await client.responses.create({
            model: "gpt-5.6-luna",
            store: false,
            instructions:
                "You propose precise edits to user-provided text and code files. Return only files that actually need changes. Never invent paths, preserve unrelated content, and provide complete replacement content for every changed file.",
            input: `Requested change:\n${instruction}\n\nAvailable files:${fileText}`,
            max_output_tokens: 20000,
            text: {
                format: {
                    type: "json_schema",
                    name: "file_change_proposal",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            summary: { type: "string" },
                            changes: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        path: { type: "string" },
                                        content: { type: "string" },
                                        explanation: { type: "string" }
                                    },
                                    required: ["path", "content", "explanation"],
                                    additionalProperties: false
                                }
                            }
                        },
                        required: ["summary", "changes"],
                        additionalProperties: false
                    }
                }
            }
        });

        const proposal = JSON.parse(response.output_text);
        const allowedPaths = new Set(files.map((file) => file.path));
        const seenPaths = new Set();
        const changes = (Array.isArray(proposal.changes) ? proposal.changes : []).filter((change) => {
            const valid =
                allowedPaths.has(change.path) &&
                !seenPaths.has(change.path) &&
                typeof change.content === "string" &&
                typeof change.explanation === "string";
            if (valid) seenPaths.add(change.path);
            return valid;
        });

        res.json({ summary: proposal.summary, changes });
    } catch (error) {
        if (error?.message === "INVALID_FILE_PATH") {
            return res.status(400).json({ error: "One of the selected file paths is invalid." });
        }
        console.error("Edit proposal failed:", error?.message ?? "Unknown error");
        res.status(502).json({ error: "File changes could not be proposed right now." });
    }
});

app.post(
    "/session",
    express.text({ type: "application/sdp", limit: "64kb" }),
    async (req, res) => {
        if (typeof req.body !== "string" || !req.body.startsWith("v=")) {
            return res.status(400).json({ error: "A valid WebRTC offer is required." });
        }

        const sessionConfig = {
            type: "realtime",
            model: "gpt-realtime-2.1",
            instructions:
                "You are My AI, a warm and helpful voice assistant. Respond naturally and concisely. The user may interrupt you, and you should continue the conversation naturally. If the user asks you to search online or asks about current, latest, or time-sensitive information, call search_web. After using it, mention that clickable sources are shown in the text chat area.",
            audio: {
                output: {
                    voice: "marin"
                }
            },
            tools: [
                {
                    type: "function",
                    name: "search_web",
                    description:
                        "Search the public web for current information. Use only when the user explicitly asks to search or needs current, latest, or time-sensitive facts.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "A concise web search query based on the user's request."
                            }
                        },
                        required: ["query"]
                    }
                }
            ],
            tool_choice: "auto"
        };

        const formData = new FormData();
        formData.set("sdp", req.body);
        formData.set("session", JSON.stringify(sessionConfig));

        try {
            const response = await fetch("https://api.openai.com/v1/realtime/calls", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
                },
                body: formData
            });

            const answer = await response.text();

            if (!response.ok) {
                let upstreamError = {};

                try {
                    upstreamError = JSON.parse(answer).error ?? {};
                } catch {
                    // The upstream service did not return a JSON error body.
                }

                console.error(
                    `Realtime session creation failed (${response.status}, ${upstreamError.code || "unknown_code"}):`,
                    upstreamError.message || "No error details were returned."
                );

                const publicError =
                    response.status === 401
                        ? "OpenAI rejected the API key. Check the private .env file and restart the server."
                        : response.status === 403
                          ? "This API project does not have access to the Realtime voice model."
                          : response.status === 429
                            ? "The Realtime API quota or rate limit was reached. Check API billing and try again."
                            : "OpenAI rejected the voice session. Check the server terminal for the reason.";

                return res.status(response.status === 401 ? 401 : 502).json({
                    error: publicError
                });
            }

            res.type("application/sdp").send(answer);
        } catch (error) {
            console.error("Realtime connection failed:", error?.message ?? "Unknown error");
            res.status(500).json({
                error: "The voice session could not be started."
            });
        }
    }
);

const publicDirectory = fileURLToPath(new URL(".", import.meta.url));
app.use(
    express.static(publicDirectory, {
        dotfiles: "deny",
        index: "index.html"
    })
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`My AI server is running on port ${PORT}`);
});