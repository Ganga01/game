import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
const dir=mkdtempSync(path.join(tmpdir(),'svoyak-test-'));
let child,base;
async function start(){
 child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','inherit']});
 const port=await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.on('data',chunk=>{const m=String(chunk).match(/порт (\d+)/);if(m)resolve(m[1]);});child.once('exit',()=>reject(new Error('Server exited before ready')));});base=`http://127.0.0.1:${port}`;
}
async function stop(){const p=once(child,'exit');child.kill('SIGTERM');await p;}
async function req(url,data,token){const res=await fetch(base+url,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});return {status:res.status,body:await res.json()};}
test('HTTP: SSE, authority, racing buzz, duplicate grading, persistence, private data',{timeout:20000},async()=>{
 try{
 await start();const created=await req('/api/rooms',{capacity:2,roundCount:1});assert.equal(created.status,201);
 const {code,token:host}=created.body,prefix=`/api/rooms/${code}`;
 const a=(await req(prefix+'/join',{name:'Первый'})).body,b=(await req(prefix+'/join',{name:'Второй'})).body;
 assert.equal((await req('/data/questions.json')).status,404);assert.equal((await req('/src/game.js')).status,404);assert.equal((await req(prefix+'/state',null,'invalid')).status,401);
 const state=async token=>(await req(prefix+'/state',null,token)).body;
 const act=async(type,payload={},token=host)=>req(prefix+'/action',{type,payload,revision:(await state(token)).revision},token);
 assert.equal((await act('start',{},a.token)).status,400);await act('start');await act('select',{cat:0,index:0});await act('open');
 const before=await state(a.token);assert.equal(before.active.answer,undefined);
 const abort=new AbortController();const stream=await fetch(base+prefix+'/events',{headers:{Authorization:'Bearer '+a.token},signal:abort.signal});assert.equal(stream.status,200);const reader=stream.body.getReader();const packet=new TextDecoder().decode((await reader.read()).value);assert.ok(packet.includes('data: '));assert.ok(!packet.includes('Скотч.'));
 const results=await Promise.all([a,b].map(p=>req(prefix+'/action',{type:'buzz',payload:{},revision:before.revision},p.token)));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 let live='';while(!live.includes('"phase":"answering"')){const next=await reader.read();assert.equal(next.done,false);live+=new TextDecoder().decode(next.value);}assert.ok(!live.includes('Скотч.'));abort.abort();
 const answering=await state(host);const verdict={type:'correct',revision:answering.revision};assert.equal((await req(prefix+'/action',verdict,host)).status,200);assert.equal((await req(prefix+'/action',verdict,host)).status,409);
 const after=await state(a.token);assert.equal(after.phase,'reveal');assert.ok(after.active.answer);assert.equal(after.players.reduce((s,p)=>s+p.score,0),100);
 await stop();await start();assert.equal((await state(host)).phase,'reveal');assert.equal((await state(host)).players.reduce((s,p)=>s+p.score,0),100);
 const html=await fetch(base+'/');assert.ok((await html.text()).includes('app.js'));
 }finally{if(child?.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});
