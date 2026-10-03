# My AI — free on-device assistant

The home page is a browser-based assistant. No OpenAI key, Node backend, Render API, or paid AI endpoint is needed for text replies. Text generation runs in the visitor's browser using WebLLM 0.2.85. Speech recognition is browser-dependent and may use the browser provider's online service.

## Publish

Deploy the Vite project to an HTTPS static host using its production build. The homepage loads the on-device assistant; the legacy API-powered interface remains at `/oldindex.html` and may require API billing for its cloud-only features.

For local preview, serve this folder on localhost with a static HTTP server; do not double-click index.html. If the original Express server serves these files, its OpenAI-key startup requirement remains; static hosting avoids it entirely.

## Visitor flow

Choose a model, press Load free AI, wait for the initial download, and send a question. Voice captures a question for review; press Send to submit it. Enable Read replies aloud for spoken output. The assistant also follows a confirmed, step-by-step React project mentoring workflow. Smaller models make more mistakes. No model can answer every question accurately.

Wikipedia research sends the question to the public Wikipedia API and inserts up to three excerpts with links into the AI prompt. It is not full search-engine retrieval. Search wider web opens Google separately. Network access is needed for the initial runtime/model download and Wikipedia. Visitors incur their own data usage; hosting and bandwidth limits may still apply.

Attach text/code files or a folder to include project context. The browser accepts up to 40 files and 9,000 total characters; individual files are capped at 2 MB and selected text is trimmed to fit the local model context. Binary files are skipped. When the assistant returns `file:path` code blocks, use **Save to folder** and approve a destination directory to create the files and subfolders locally. This uses the browser File System Access API where supported; other browsers download generated files individually. Nothing is written without an explicit user action.

WebGPU and sufficient graphics memory are required. Model downloads can be hundreds of MB or larger. Unsupported devices get an explanatory message and may use the wider-web link. All conversation state lives in the current tab; reloading clears it. Model files may be cached by WebLLM.

## Verification limits

JavaScript syntax and DOM wiring checked locally. Model identifiers verified against WebLLM v0.2.85's model catalog. Actual GPU inference, model downloads, microphone permissions, external Wikipedia access, and spoken playback require a compatible browser and have not been verified end to end here.

Sources: https://webllm.mlc.ai/docs/user/get_started.html and https://github.com/mlc-ai/web-llm/blob/v0.2.85/src/config.ts
