import http from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync,readdirSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomInt} from 'node:crypto';
import {createRoom,join,actor,action,tick,view} from './game.js';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const DIR=process.env.DATA_DIR||path.join(ROOT,'runtime');
const MAX_ROOMS=200, TTL=24*60*60*1000;
mkdirSync(DIR,{recursive:true});
const rooms=new Map(), clients=new Map(), limits=new Map();
for(const f of readdirSync(DIR).filter(f=>/^\d{6}\.json$/.test(f))) {
  try { const r=JSON.parse(readFileSync(path.join(DIR,f))); if(r.updated>Date.now()-TTL) rooms.set(r.code,r); }
  catch { console.error('Не удалось восстановить комнату:',f); }
}
function persist(r) {
  const file=path.join(DIR,`${r.code}.json`); writeFileSync(file+'.tmp',JSON.stringify(r),{mode:0o600}); renameSync(file+'.tmp',file);
}
function online(code) { return new Set([...(clients.get(code)||[])].map(c=>c.who.id).filter(Boolean)); }
function broadcast(r) {
  const connected=online(r.code);
  for(const c of clients.get(r.code)||[]) {
    if(!c.who.host&&!r.players.some(p=>p.id===c.who.id)) {c.res.end();continue;}
    const data=`data: ${JSON.stringify(view(r,c.who,connected))}\n\n`;
    if(c.res.writableLength>128*1024) {c.res.destroy();continue;}
    c.res.write(data);
  }
}
function changed(r) {r.updated=Date.now();r.revision++;persist(r);broadcast(r);}
function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function rate(key,max,window=60000) {
  const now=Date.now(); let b=limits.get(key);
  if(!b||now>b.until) {b={count:0,until:now+window};limits.set(key,b);}
  if(++b.count>max) {const e=new Error('Слишком много запросов. Подождите немного');e.status=429;throw e;}
}
async function body(req) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw new Error('Ожидается JSON');
  const chunks=[];let bytes=0;for await(const chunk of req) {bytes+=chunk.length; if(bytes>8192)throw new Error('Слишком большой запрос');chunks.push(chunk);}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Некорректный запрос');return value;
}
const STATIC={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/icon.svg':'icon.svg','/manifest.webmanifest':'manifest.webmanifest',
  '/memes/doge.jpg':'memes/doge.jpg','/memes/this_is_fine.jpg':'memes/this_is_fine.jpg','/memes/distracted_boyfriend.jpg':'memes/distracted_boyfriend.jpg',
  '/memes/woman_yelling_cat.jpg':'memes/woman_yelling_cat.jpg','/memes/grumpy_cat.jpg':'memes/grumpy_cat.jpg','/memes/roll_safe.jpg':'memes/roll_safe.jpg',
  '/memes/hide_pain_harold.jpg':'memes/hide_pain_harold.jpg','/memes/success_kid.jpg':'memes/success_kid.jpg','/memes/confused_math.jpg':'memes/confused_math.jpg',
  '/memes/shocked_cat.jpg':'memes/shocked_cat.jpg'};
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url=new URL(req.url,'http://localhost'), pathname=url.pathname;
    if(req.method==='GET'&&pathname==='/health')return json(res,200,{ok:true});
    if(req.method==='GET'&&STATIC[pathname]) {
      const file=path.join(ROOT,'public',STATIC[pathname]);res.writeHead(200,{'Content-Type':MIME[path.extname(file)],'Cache-Control':'no-cache'});return res.end(readFileSync(file));
    }
    if(req.method==='POST') {
      // Same-origin browser requests only. Bearer credentials are never put in public URLs.
      if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Запрос с другого сайта запрещён'});
      if(req.headers.origin) {
        const allowed=process.env.PUBLIC_ORIGIN;
        if(allowed?req.headers.origin!==allowed:new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Неверный адрес сайта'});
      }
    }
    if(req.method==='POST'&&pathname==='/api/rooms') {
      // Behind a proxy this coarse limiter is intentionally shared (not trusting spoofable X-Forwarded-For).
      rate('create:'+req.socket.remoteAddress,30);if(rooms.size>=MAX_ROOMS)return json(res,503,{error:'Сервер заполнен. Попробуйте позже'});
      const b=await body(req);let code;do{code=String(randomInt(100000,1000000));}while(rooms.has(code));
      const r=createRoom(code,b.capacity,b.questionCount);persist(r);rooms.set(code,r);
      return json(res,201,{code,token:r.host,role:'host'});
    }
    const match=pathname.match(/^\/api\/rooms\/(\d{6})\/(join|state|events|action)$/);
    if(!match)return json(res,404,{error:'Не найдено'});
    const [,code,route]=match,r=rooms.get(code);if(!r)return json(res,404,{error:'Комната не найдена или срок её хранения истёк'});
    if(route==='join'&&req.method==='POST') {
      rate('join:'+req.socket.remoteAddress,120);const b=await body(req);const p=join(r,b.name);changed(r);
      return json(res,201,{code,token:p.token,role:'player'});
    }
    const token=req.headers.authorization?.replace(/^Bearer /,'');let who;
    try{who=actor(r,token);}catch{return json(res,401,{error:'Сессия не найдена. Войдите заново'});}
    if(tick(r))changed(r);
    if(route==='state'&&req.method==='GET')return json(res,200,view(r,who,online(code)));
    if(route==='events'&&req.method==='GET') {
      const set=clients.get(code)||new Set();clients.set(code,set);
      if([...set].filter(c=>c.token===token).length>=3)return json(res,429,{error:'Слишком много открытых вкладок этой игры'});
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.flushHeaders();res.write('retry: 1500\n\n');
      const client={res,who,token};set.add(client);broadcast(r);
      req.on('close',()=>{set.delete(client);if(!set.size)clients.delete(code);broadcast(r);});return;
    }
    if(route==='action'&&req.method==='POST') {
      rate('action:'+token,100,10000);const b=await body(req);
      // Prevent stale retries/double taps from grading a different answer or a later question.
      if(b.revision!==r.revision)return json(res,409,{error:'Состояние уже изменилось. Попробуйте снова',state:view(r,who,online(code))});
      action(r,who,b.type,b.payload);changed(r);return json(res,200,view(r,who,online(code)));
    }
    json(res,405,{error:'Метод не поддерживается'});
  }catch(e){if(!res.headersSent)json(res,e.status||400,{error:e instanceof SyntaxError?'Некорректные данные':e.message});else res.end();}
});
const timer=setInterval(()=>{
  for(const r of rooms.values()) {
    try {
      if(tick(r))changed(r);
      if(r.updated<Date.now()-TTL&&!clients.has(r.code)){rooms.delete(r.code);const p=path.join(DIR,r.code+'.json');if(existsSync(p))unlinkSync(p);}
    }catch(e){console.error('Ошибка сохранения комнаты',r.code,e.message);}
  }
  for(const [key,b] of limits)if(b.until<Date.now())limits.delete(key);
},250);
const heartbeat=setInterval(()=>{for(const set of clients.values())for(const c of set)c.res.write(': keep-alive\n\n');},15000);
server.listen(process.env.PORT===undefined?3000:Number(process.env.PORT),'0.0.0.0',()=>console.log('Свояк: сервер готов, порт',server.address().port));
function shutdown(){clearInterval(timer);clearInterval(heartbeat);for(const set of clients.values())for(const c of set)c.res.end();server.close(()=>process.exit(0));}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
