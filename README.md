# My AI — free on-device assistant

The home page is a browser-based assistant. No OpenAI key, Node backend, Render API, or paid AI endpoint is needed for text replies. The default CPU model runs in a Web Worker using Transformers.js 3.8.1 and quantized SmolLM2-135M-Instruct ONNX weights. Optional larger models use WebLLM 0.2.85 and WebGPU. If graphics initialization fails, loading falls back to the CPU model. Speech recognition is browser-dependent and may use the browser provider's online service.

## Publish

The repository currently publishes its root through GitHub Pages at https://aihelpall.com. Keep `ai-runtime.js` and `cpu-worker.js` beside `script.js` when deploying the source files. Vite builds also emit the CPU worker as a separate asset. The `.openai/hosting.json` manifest refers to an older Sites project and does not control GitHub Pages. The legacy API-powered interface remains in `my ai upgrades` and requires a separate server and API billing for its cloud-only features.

For local preview, serve this folder on localhost with a static HTTP server; do not double-click index.html. If the original Express server serves these files, its OpenAI-key startup requirement remains; static hosting avoids it entirely.

## Visitor flow

The compatible CPU model loads automatically. Its first download is roughly 137 MB plus the runtime and tokenizer. Type a question while downloading to queue it, or press Stop to cancel loading while keeping your draft. Choose a larger graphics model from the selector when supported. Voice captures a question for review; press Send to submit it. Read aloud speaks the response, and Stop cancels speech or generation. The small CPU model is intended for simple questions and can struggle with programming or complex instructions. No model can answer every question accurately.

Wikipedia research sends the question to the public Wikipedia API and inserts up to three excerpts with links into the AI prompt. It is not full search-engine retrieval. Search wider web opens Google separately. Network access is needed for the initial runtime/model download and Wikipedia. Visitors incur their own data usage; hosting and bandwidth limits may still apply.

Attach text/code files or a folder to include project context. The browser accepts up to 40 files and 9,000 total characters; individual files are capped at 2 MB and selected text is trimmed to fit the local model context. Binary files are skipped. When the assistant returns `file:path` code blocks, use **Save to folder** and approve a destination directory to create the files and subfolders locally. This uses the browser File System Access API where supported; other browsers download generated files individually. Nothing is written without an explicit user action.

CPU mode needs WebAssembly and sufficient device memory; graphics mode additionally needs WebGPU. HTTPS or localhost is required. Saved chats remain in this browser's local storage across reloads; New chat starts a separate conversation. Model files may be cached by the browser. Search and file selection remain available when AI loading fails. Download failures preserve the draft and allow retry.

## Verification limits

`npm test` checks syntax and exercises CPU worker streaming/error cleanup, chat without WebGPU, saved history, search, uploads, generated-file controls, voice wiring, model switching, and navigation using controlled test doubles. `npm run build` checks the production bundle and separate worker output. Actual model inference, microphone permissions, external Wikipedia access, and spoken playback require a compatible browser; test doubles do not verify those services.

Sources: https://huggingface.co/docs/transformers.js and https://huggingface.co/onnx-community/SmolLM2-135M-Instruct-ONNX-MHA and https://webllm.mlc.ai/docs/user/get_started.html
