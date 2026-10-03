let generator;
let runtime;
let stoppingCriteria;
let generating = false;

self.onmessage = async ({data}) => {
    const {id, type, options} = data;
    let ownsGeneration = false;
    if (type === 'stop') { stoppingCriteria?.interrupt(); return; }
    try {
        if (type === 'load') {
            runtime = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
            runtime.env.allowLocalModels = false;
            runtime.env.backends.onnx.wasm.numThreads = 1;
            generator = await runtime.pipeline('text-generation', 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA', {
                device: 'wasm', dtype: 'q8',
                progress_callback: report => self.postMessage({id, type: 'progress', text: report.file ? `Downloading CPU AI: ${report.file}` : 'Preparing CPU AI…', progress: (report.progress || 0) / 100})
            });
        } else if (type === 'generate') {
            if (!generator || generating) throw new Error('AI is not ready for another message.');
            generating = true;
            ownsGeneration = true;
            stoppingCriteria = new runtime.InterruptableStoppingCriteria();
            const streamer = new runtime.TextStreamer(generator.tokenizer, {
                skip_prompt: true, skip_special_tokens: true,
                callback_function: text => self.postMessage({id, type: 'chunk', text})
            });
            await generator(options.messages, {
                max_new_tokens: Math.min(options.max_tokens || 256, 256),
                do_sample: false, return_full_text: false,
                streamer, stopping_criteria: stoppingCriteria
            });
        }
        self.postMessage({id, type: 'done'});
    } catch (error) {
        self.postMessage({id, type: 'error', message: error.message || 'CPU AI failed.'});
    } finally { if (ownsGeneration) generating = false; }
};
