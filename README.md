# My AI — free browser edition

A separate static replacement for the paid API frontend. No OpenAI key, Node backend, Render API, or paid AI endpoint is used. Text generation runs in each visitor's browser using WebLLM 0.2.85. Speech recognition is browser-dependent and may use the browser provider's online service; do not advertise all voice as offline.

## Publish

Upload index.html, script.js and styles.css together to an HTTPS static host. To replace the existing frontend, back up its files first, replace these three files on the frontend deployment branch, and deploy. Existing paid server files can remain but this frontend never calls them. No remote repository or live deployment was changed by this deliverable.

For local preview, serve this folder on localhost with a static HTTP server; do not double-click index.html. If the original Express server serves these files, its OpenAI-key startup requirement remains; static hosting avoids it entirely.

## Visitor flow

Choose a model, press Load free AI, wait for the initial download, and send a question. Voice captures a question for review; press Send to submit it. Enable Read replies aloud for spoken output. Smaller models make more mistakes. No model can answer every question accurately.

Wikipedia research sends the question to the public Wikipedia API and inserts up to three excerpts with links into the AI prompt. It is not full search-engine retrieval. Search wider web opens Google separately. Network access is needed for the initial runtime/model download and Wikipedia. Visitors incur their own data usage; hosting and bandwidth limits may still apply.

WebGPU and sufficient graphics memory are required. Model downloads can be hundreds of MB or larger. Unsupported devices get an explanatory message and may use the wider-web link. All conversation state lives in the current tab; reloading clears it. Model files may be cached by WebLLM.

## Verification limits

JavaScript syntax and DOM wiring checked locally. Model identifiers verified against WebLLM v0.2.85's model catalog. Actual GPU inference, model downloads, microphone permissions, external Wikipedia access, and spoken playback require a compatible browser and have not been verified end to end here.

Sources: https://webllm.mlc.ai/docs/user/get_started.html and https://github.com/mlc-ai/web-llm/blob/v0.2.85/src/config.ts
