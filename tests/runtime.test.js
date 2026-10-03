import test from 'node:test';
import assert from 'node:assert/strict';
import {CpuEngine, createCpuEngine} from '../ai-runtime.js';

function worker() {
    return {sent: [], postMessage(data) {this.sent.push(data);}, terminate() {this.terminated=true;},
        reply(data) {this.onmessage({data});}};
}
test('CPU load, streaming, and stop use the same chat interface', async () => {
    const w=worker(); const reports=[]; const engine=new CpuEngine(w, p=>reports.push(p));
    const loading=engine.load(); const id=w.sent[0].id;
    w.reply({id,type:'progress',text:'Loading',progress:0.5});
    w.reply({id,type:'done'}); assert.equal(await loading,engine);
    assert.equal(reports.length,1);
    const output=[];
    const run=(async()=>{for await(const chunk of engine.chat.completions.create({messages:[]})) output.push(chunk.choices[0].delta.content);})();
    const generation=w.sent[1].id;
    w.reply({id:generation,type:'chunk',text:'Hello'});
    w.reply({id:generation,type:'chunk',text:' there'});
    w.reply({id:generation,type:'done'}); await run;
    assert.deepEqual(output,['Hello',' there']);
    engine.interruptGenerate(); assert.equal(w.sent.at(-1).type,'stop');
    await engine.unload(); assert.equal(w.terminated,true);
    assert.equal(engine.pending.size,0);
});
test('worker failures reject pending load and allow cleanup', async () => {
    const w=worker(); const engine=new CpuEngine(w,()=>{});
    const loading=engine.load(); w.onerror();
    await assert.rejects(loading,/worker could not run/);
    await engine.unload(); assert.equal(engine.pending.size,0);
});
test('generation errors propagate instead of leaving the page waiting', async () => {
    const w=worker(); const engine=new CpuEngine(w,()=>{});
    const stream=engine.generate({messages:[]}); const next=stream.next();
    w.reply({id:w.sent[0].id,type:'error',message:'out of memory'});
    await assert.rejects(next,/out of memory/); assert.equal(engine.pending.size,0);
});
test('cancelling CPU download terminates the worker and rejects the load', async () => {
    const previousWorker = globalThis.Worker;
    const w = worker();
    globalThis.Worker = class { constructor() {return w;} };
    try {
        const controller = new AbortController();
        const loading = createCpuEngine(()=>{}, controller.signal);
        controller.abort();
        await assert.rejects(loading,/unloaded/);
        assert.equal(w.terminated,true);
    } finally { globalThis.Worker = previousWorker; }
});
