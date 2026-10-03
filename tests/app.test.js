import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';

function app({cpuError=false}={}) {
    const elements=new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id,{value:'',disabled:false,hidden:false,children:[],listeners:{},dataset:{},attributes:{},
            setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];},removeAttribute(k){delete this.attributes[k];},
            addEventListener(k,v){this.listeners[k]=v;},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},
            click(){this.clicked=true;return this.listeners.click?.({preventDefault(){}}) || this.onclick?.();},
            dispatchEvent(event){this.listeners[event.type]?.(event);},focus(){this.focused=true;}});
        return elements.get(id);
    }
    const classes=new Set();
    const storage=new Map();
    const engine={kind:'cpu',unloaded:false,chat:{completions:{async *create(){yield {choices:[{delta:{content:'Hello from CPU'}}]};}}},interruptGenerate(){this.stopped=true;},async unload(){this.unloaded=true;}};
    const prompts=[element('prompt')]; prompts[0].dataset.prompt='Explain React state.';
    const sandbox={console,setTimeout,clearTimeout,URL,AbortController,AbortSignal,Blob,Event,crypto:webcrypto,
        localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
        document:{getElementById:element,createElement:()=>({...element(Symbol()),webkitdirectory:true}),querySelectorAll:()=>prompts,
            addEventListener(){},body:{classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),toggle(k,on){if(on)classes.add(k);else classes.delete(k);}}}},
        window:{isSecureContext:true,innerWidth:1000,confirm:()=>true,SpeechRecognition:class {start(){} abort(){}},speechSynthesis:{cancel(){},speak(){}}},
        navigator:{language:'en-US'},createCpuEngine:async()=>{if(cpuError)throw new Error('Download failed');return engine;}};
    element('model').value='cpu';
    element('form').requestSubmit=()=>element('form').onsubmit({preventDefault(){}});
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(new URL('../script.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/,''),sandbox);
    return {element,engine,storage,sandbox,classes,flush:()=>new Promise(resolve=>setImmediate(resolve)),run:code=>vm.runInContext(code,sandbox)};
}
test('chat loads and replies without WebGPU, saves history and restores chats',async()=>{
    const a=app(); await a.flush();
    assert.match(a.element('status').textContent,/CPU AI ready/);
    a.element('question').value='hello'; await a.element('form').requestSubmit();
    assert.equal(a.element('chat').children.length,2);
    assert.equal(a.element('chat').children[1].children[1].textContent,'Hello from CPU');
    const saved=JSON.parse(a.storage.get('my-ai-saved-chats-v1'));assert.equal(saved[0].messages.length,2);
    a.element('clear').onclick();assert.equal(a.element('chat').children.length,0);
    a.run(`openConversation(${JSON.stringify(saved[0].id)})`);assert.equal(a.element('chat').children.length,2);
    assert.equal(a.element('send').disabled,false);
});
test('search handles encoding, Enter and empty searches; file and folder controls open pickers',async()=>{
    const a=app();await a.flush();
    a.element('googleSearchInput').value='React & files';a.element('googleSearchInput').listeners.input();
    assert.equal(a.element('googleSearchButton').href,'https://www.google.com/search?q=React%20%26%20files');
    a.element('googleSearchInput').listeners.keydown({key:'Enter',preventDefault(){}});assert.equal(a.element('googleSearchButton').clicked,true);
    a.element('googleSearchInput').value='';a.element('googleSearchButton').click();assert.equal(a.element('googleSearchButton').href,'https://www.google.com/');
    a.element('attachFilesButton').click();a.element('attachFolderButton').click();
    assert.equal(a.element('fileInput').clicked,true);assert.equal(a.element('folderInput').clicked,true);
});
test('attachment-only submission sends a review prompt, and clearing invalidates pending reads',async()=>{
    const a=app();await a.flush();
    a.sandbox.selected=[{name:'app.js',type:'text/javascript',size:12,slice(){return {text:async()=> 'const x = 1;'};}}];
    await a.run('addSelectedFiles(selected)');assert.equal(a.element('attachmentPanel').hidden,false);
    await a.element('form').requestSubmit();assert.match(a.element('chat').children[0].children[1].textContent,/Review the attached files/);
    a.element('clear').onclick();
    let resolve;a.sandbox.selected[0].slice=()=>({text:()=>new Promise(r=>{resolve=r;})});
    const read=a.run('addSelectedFiles(selected)');assert.equal(a.element('send').disabled,true);
    a.element('clear').onclick();resolve('stale');await read;assert.equal(a.run('attachedFiles.length'),0);
});
test('download failure keeps message and enables retry instead of trapping queued submission',async()=>{
    const a=app({cpuError:true});await a.flush();a.element('question').value='please help';
    await a.element('form').requestSubmit();assert.equal(a.element('question').value,'please help');
    assert.equal(a.element('load').disabled,false);assert.equal(a.run('pendingSubmission'),false);assert.equal(a.element('send').disabled,false);
});
test('generated file controls render in the visible panel and reject unsafe paths',async()=>{
    const a=app();await a.flush();
    a.sandbox.answer='```file:src/app.js\nconst x=1;\n```\n```file:../bad.js\nbad\n```';
    a.run("offerGeneratedFiles(document.getElementById('chat'), answer)");
    assert.equal(a.element('generatedFiles').hidden,false);assert.equal(a.element('generatedFiles').children.length,3);
    assert.equal(a.run('parseGeneratedFiles(answer).length'),1);
});
test('model selection unloads previous engine; voice and mobile navigation are wired',async()=>{
    const a=app();await a.flush();await a.element('model').listeners.change();assert.equal(a.engine.unloaded,true);
    a.element('mic').onclick();assert.equal(a.run('listening'),true);a.element('stop').onclick();assert.equal(a.run('listening'),false);
    a.element('sidebarToggle').click();assert.equal(a.classes.has('sidebar-open'),true);
    a.element('sidebarBackdrop').click();assert.equal(a.classes.has('sidebar-open'),false);
    a.element('prompt').click();assert.equal(a.element('question').value,'Explain React state.');
});
test('a failed CPU engine is released and the next submission reloads it',async()=>{
    const a=app();await a.flush();
    const create=a.engine.chat.completions.create;
    a.engine.chat.completions.create=async function*(){throw new Error('Object has already been disposed');};
    a.element('question').value='hello';await a.element('form').requestSubmit();
    assert.equal(a.run('engine'),null);assert.equal(a.element('load').disabled,false);assert.equal(a.engine.unloaded,true);
    a.engine.chat.completions.create=create;
    a.element('question').value='try again';await a.element('form').requestSubmit();await a.flush();
    assert.equal(a.element('chat').children.at(-1).children[1].textContent,'Hello from CPU');
});
test('Stop aborts pending Wikipedia research and releases the composer',async()=>{
    const a=app();await a.flush();a.element('research').checked=true;
    a.sandbox.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted'))));
    a.element('question').value='current news';const run=a.element('form').requestSubmit();
    a.element('stop').onclick();await run;
    assert.equal(a.element('send').disabled,false);assert.equal(a.element('chat').children.at(-1).children[1].textContent,'Reply stopped.');
});
