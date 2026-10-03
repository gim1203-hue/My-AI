// A worker keeps CPU inference and downloads away from the page's controls.
export class CpuEngine {
    constructor(worker, onProgress) {
        this.worker = worker;
        this.onProgress = onProgress;
        this.pending = new Map();
        this.nextId = 0;
        this.kind = 'cpu';
        this.chat = {completions: {create: options => this.generate(options)}};
        worker.onmessage = ({data}) => {
            const request = this.pending.get(data.id);
            if (!request) return;
            if (data.type === 'progress') this.onProgress(data);
            else if (data.type === 'chunk') request.chunks.push(data.text);
            else {
                request.done = true;
                request.error = data.type === 'error' ? new Error(data.message) : null;
            }
            request.wake?.();
        };
        worker.onerror = () => this.fail(new Error('The CPU AI worker could not run. Check your connection and retry.'));
        worker.onmessageerror = () => this.fail(new Error('The CPU AI worker could not return a reply.'));
    }
    fail(error) {
        for (const request of this.pending.values()) {
            request.done = true;
            request.error = error;
            request.wake?.();
        }
    }
    async *request(type, options, timeout) {
        const id = ++this.nextId;
        const request = {chunks: [], done: false, error: null, wake: null};
        this.pending.set(id, request);
        const timer = setTimeout(() => {
            this.fail(new Error('The AI took too long. Please reload the model and try again.'));
            this.worker.terminate();
        }, timeout);
        try {
            this.worker.postMessage({id, type, options});
            while (true) {
                while (request.chunks.length) yield request.chunks.shift();
                if (request.error) throw request.error;
                if (request.done) break;
                await new Promise(resolve => {request.wake = resolve;});
            }
        } finally {
            clearTimeout(timer);
            this.pending.delete(id);
        }
    }
    async load() {
        for await (const _ of this.request('load', {}, 600000)) {}
        return this;
    }
    async *generate(options) {
        for await (const text of this.request('generate', options, 180000)) {
            yield {choices: [{delta: {content: text}}]};
        }
    }
    interruptGenerate() { this.worker.postMessage({type: 'stop'}); }
    async unload() {
        this.fail(new Error('AI model unloaded.'));
        this.worker.terminate();
    }
}

export async function createCpuEngine(onProgress, signal) {
    const engine = new CpuEngine(new Worker(new URL('./cpu-worker.js', import.meta.url), {type: 'module'}), onProgress);
    const cancel = () => engine.unload();
    signal?.addEventListener('abort', cancel, {once: true});
    try {
        if (signal?.aborted) throw new Error('Model loading cancelled.');
        return await engine.load();
    }
    catch (error) { await engine.unload(); throw error; }
    finally { signal?.removeEventListener('abort', cancel); }
}
