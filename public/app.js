'use strict';
const $=id=>document.getElementById(id), app=$('app');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session=null,state=null,connected=false,streamController=null,streamGeneration=0,busy=false,timeOffset=0,lastFrame=0;
let mode=new URLSearchParams(location.search).has('room')?'join':'create';
let toastTimer, confirmationResolve, saved=null;
try {saved=JSON.parse(localStorage.getItem('svoyak-session'));}catch{}
function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500);}
function confirmAction(text){$('confirm-text').textContent=text;$('confirm').showModal();return new Promise(resolve=>confirmationResolve=resolve);}
function resolveConfirm(value){$('confirm').close();confirmationResolve?.(value);confirmationResolve=null;}
$('cancel-confirm').onclick=()=>resolveConfirm(false);$('accept-confirm').onclick=()=>resolveConfirm(true);$('confirm').addEventListener('cancel',e=>{e.preventDefault();resolveConfirm(false);});
function saveSession(s){saved=s;try {localStorage.setItem('svoyak-session',JSON.stringify(s));}catch{toast('Браузер запретил сохранение. Не закрывайте вкладку до конца игры');}}
function status(){const el=$('connection');el.textContent=session?(connected?'● На связи':'○ Восстанавливаем связь…'):'Своя компания';el.className='connection '+(session?(connected?'live':'offline'):'');}
async function api(url,data,auth=session){
  const headers={};if(auth)headers.Authorization=`Bearer ${auth.token}`;if(data)headers['Content-Type']='application/json';
  const res=await fetch(url,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(10000)});
  const result=await res.json();if(!res.ok){if(result.state)apply(result.state);throw new Error(result.error||'Не удалось выполнить действие');}return result;
}
function apply(next){
  if(!session||next.code!==session.code||state&&next.revision<state.revision)return;
  const previous=state;state=next;timeOffset=next.serverTime-Date.now();
  if(next.phase==='answering'&&next.active.buzzer===next.me&&previous?.phase!=='answering')navigator.vibrate?.([80,50,80]);
  render();
}
async function connect(s){
  session=s;state=null;connected=false;saveSession(s);status();app.innerHTML='<div class="card"><h2>Подключаемся к компании…</h2><p class="muted">Комната '+esc(s.code)+'</p><button data-event="home" class="secondary">На главную</button></div>';
  await startStream();
}
async function startStream(){
  const generation=++streamGeneration;streamController?.abort();
  while(session&&generation===streamGeneration){
    streamController=new AbortController();
    try{
      const res=await fetch(`/api/rooms/${session.code}/events`,{headers:{Authorization:`Bearer ${session.token}`},signal:streamController.signal});
      if([401,404].includes(res.status)){
        const error=await res.json();session=null;state=null;saved=null;try{localStorage.removeItem('svoyak-session');}catch{}status();renderHome();toast(error.error);return;
      }
      if(!res.ok)throw new Error('Нет соединения');
      connected=true;lastFrame=Date.now();status();
      const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
      while(generation===streamGeneration){
        const {value,done}=await reader.read();if(done)throw new Error('Поток закрыт');lastFrame=Date.now();buffer+=decoder.decode(value,{stream:true});
        let end;while((end=buffer.indexOf('\n\n'))!==-1){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=frame.split('\n').find(x=>x.startsWith('data: '));if(line)apply(JSON.parse(line.slice(6)));}
      }
    }catch{if(generation!==streamGeneration)return;connected=false;status();if(state)render();}
    await new Promise(r=>setTimeout(r,1500));
  }
}
setInterval(()=>{if(connected&&Date.now()-lastFrame>35000)streamController?.abort();updateTimer();},200);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&session)startStream();});
function home(){streamGeneration++;streamController?.abort();session=null;state=null;connected=false;status();renderHome();}
function renderHome(){
  const room=new URLSearchParams(location.search).get('room')||'';
  app.innerHTML=`<div class="home-layout"><section class="hero"><div class="eyebrow">Вечер, который запомнят</div><h1>Свои люди.<br>Не свои<br><span>ответы.</span></h1><p>Викторина для компании, где скорость пальца иногда опережает скорость мысли.</p><div class="hero-art"><span class="pill">2–12 игроков</span><span class="pill">до 120 вопросов</span><span class="pill">С телефона</span></div><details><summary>Как это работает</summary><p>Один человек — ведущий, остальные — игроки. Все открывают сайт на своих телефонах. Ведущий читает вопрос и открывает кнопки. Первый нажавший отвечает вслух. Верно — плюс очки, неверно — минус, и шанс получают остальные.</p><p>На нажатие кнопки и устный ответ — по 30 секунд. В случайный момент включается модификатор: счёт может поменять знак или ведущий сможет принять близкий ответ за половину очков.</p><p>При нуле на ответе снимаются очки. Играть удобно в одной компании или с отдельным голосовым звонком.</p></details></section><section class="card"><div class="tabs"><button data-mode="create" class="${mode==='create'?'selected':''}">Я ведущий</button><button data-mode="join" class="${mode==='join'?'selected':''}">Я игрок</button></div>
    ${mode==='create'?`<h2>Собираем своих</h2><p class="muted">Создайте комнату и отправьте друзьям ссылку.</p><form id="create-form"><label for="capacity">Сколько мест для игроков?</label><select id="capacity">${Array.from({length:11},(_,i)=>i+2).map(n=>`<option value="${n}" ${n===4?'selected':''}>${n} игроков</option>`).join('')}</select><label for="question-count">Сколько вопросов сыграть?</label><select id="question-count"><option value="30">30 вопросов · короткая игра</option><option value="60" selected>60 вопросов · 1 раунд</option><option value="90">90 вопросов · 1,5 раунда</option><option value="120">120 вопросов · 2 раунда</option></select><p class="host-hint">На нажатие кнопки и устный ответ даётся по 30 секунд.</p><button class="wide" type="submit">Создать комнату ↗</button></form><p class="host-hint">Ведущий не занимает место игрока и видит ответы.</p>`:`<h2>Вы уже почти свои</h2><p class="muted">Введите код от ведущего и имя для таблицы.</p><form id="join-form"><label for="code">Код комнаты</label><input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="123456" value="${esc(/^\d{6}$/.test(room)?room:'')}" required autocomplete="off"><label for="name">Как вас представить?</label><input id="name" name="name" maxlength="24" placeholder="Например, Игорь" required autocomplete="nickname"><button class="wide" type="submit">Войти в игру ↗</button></form>`}
    ${saved?`<div class="divider"></div><button class="ghost wide" data-event="resume">Вернуться в комнату ${esc(saved.code)}</button>`:''}</section></div>`;
}
function people(){return `<div class="people">${state.players.map((p,i)=>`<div class="person"><span class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</span><div class="person-name">${esc(p.name)}${p.id===state.me?' <span class="muted">· вы</span>':''}<small><span class="live-dot ${p.online?'':'offline-dot'}"></span>${p.online?'На связи':'Не в сети'}${state.chooser===p.id?' · выбирает вопрос':''}</small></div>${state.phase==='lobby'&&state.role==='host'?`<button class="ghost tiny" data-kick="${p.id}" aria-label="Удалить игрока ${esc(p.name)}">Убрать</button>`:`<span class="score ${p.score<0?'negative':''}">${p.score}</span>`}</div>`).join('')}</div>`;}
function control(type,label,cls=''){return `<button data-action="${type}" class="${cls}" ${!connected||busy?'disabled':''}>${label}</button>`;}
function render(){
  if(!state)return;const s=state,host=s.role==='host';
  status();
  if(s.phase==='lobby'){
    const link=location.origin+'/?room='+s.code;
    app.innerHTML=`<div class="lobby-layout"><div class="section-head"><div class="eyebrow">${host?'Пульт ведущего':'Вы в игре'}</div><h2>Компания собирается</h2></div><section class="card"><div class="row"><span class="muted">Код комнаты</span><span class="tag">${s.players.length} / ${s.capacity}</span></div><div class="room-code">${s.code}</div><div class="actions"><button data-event="share">Пригласить друзей ↗</button><button data-event="copy" class="secondary">Копировать</button></div><p class="share-link">${esc(link)}</p><div class="divider"></div>${s.players.length?people():'<div class="empty">Пока тихо. Самое время позвать друзей.</div>'}${host?`<button class="wide" data-action="start" ${s.players.length<2||!connected?'disabled':''}>Все на месте. Начать →</button><p class="host-hint">Можно начать от двух игроков, не заполняя все места.</p>`:'<p class="status">Ведущий начнёт игру, когда все соберутся.</p>'}</section><p class="notice">У каждого свой телефон. Отвечайте вслух: встроенного голосового чата нет. Не закрывайте вкладку во время вопроса.</p><button class="back" data-event="home">На главную (место сохранится)</button></div>`;return;
  }
  let content='';
  if(s.phase==='finished'){
    const ranked=[...s.players].sort((a,b)=>b.score-a.score),winners=ranked.filter(p=>p.score===ranked[0].score);
    content=`<section class="card winner"><div class="winner-symbol">✦</div><div class="eyebrow">${winners.length>1?'Дружба победила. Почти.':'Сегодня вы великолепны'}</div><h1>${winners.map(p=>esc(p.name)).join(' + ')}</h1><p class="muted">${winners.length>1?'Делят первое место':'Победитель игры'} · ${ranked[0].score} очков</p><button data-event="home">Собрать новую компанию ↗</button></section><div class="score-title">Итоговая таблица</div>`;
  }else if(s.phase==='roundEnd'){
    content=`<section class="card winner"><div class="winner-symbol">↗</div><h2>Разогрелись?</h2><p class="muted">Во втором раунде ставки удваиваются.<br>Самоуверенность — бесплатно.</p>${host?control('nextRound','Начать второй раунд →'):'<p>Ждём ведущего</p>'}</section>`;
  }else if(s.phase==='board'){
    content=`<p class="muted">${host?'Выберите вопрос по просьбе игрока.':'Игрок выбирает тему и стоимость вслух, ведущий открывает вопрос.'}</p>${s.modifierNotice?`<p class="notice modifier-notice">${esc(s.modifierNotice)}</p>`:''}<div class="board">${s.board.map((cat,ci)=>`<section class="category"><h3>${esc(cat.title)}</h3><div class="values">${cat.questions.map((q,i)=>`<button class="${!host?'viewer ':''}${q.used?'used':''}" data-select="${ci},${i}" ${q.used||!host||!connected?'disabled':''} aria-label="${esc(cat.title)}, ${q.value} очков${q.used?', сыгран':''}">${q.used?'—':q.value}</button>`).join('')}</div></section>`).join('')}</div>`;
  }else{
    const a=s.active,mine=a.buzzer===s.me,blocked=a.blocked.includes(s.me),answerer=s.players.find(p=>p.id===a.buzzer);
    content=`<section class="card question"><div class="question-meta"><span class="tag">${esc(a.category)} · ${a.value}</span><span id="timer" class="timer" aria-label="Осталось секунд"></span></div>${s.modifierNotice?`<p class="notice modifier-notice">${esc(s.modifierNotice)}</p>`:''}<h2>${esc(a.q)}</h2><p class="status">${esc(s.message)}</p>${s.approximateActive&&s.phase!=='reveal'?'<p class="tag modifier-tag">≈ Можно ответить приблизительно</p>':''}${s.phase==='reveal'?`<div class="answer"><div class="eyebrow">Правильный ответ</div><strong>${esc(a.answer)}</strong>${a.note?`<p>${esc(a.note)}</p>`:''}</div>`:''}${host&&s.phase!=='reveal'?`<details><summary>Подсказка ведущему: показать ответ</summary><p>${esc(a.answer)}</p>${a.note?`<p>${esc(a.note)}</p>`:''}</details>`:''}</section>`;
    if(host){
      content+='<div class="actions">';
      if(s.phase==='reading')content+=control('open','Открыть кнопки →');
      if(s.phase==='answering')content+=control('correct','✓ Верно')+(s.approximateActive?control('approx','≈ Близко · половина очков'): '')+control('wrong','✕ Неверно','danger');
      if(s.phase==='reveal')content+=control('next','Дальше →');
      content+='</div>';
      if(['reading','open','answering'].includes(s.phase))content+=`<button class="ghost wide" data-event="reveal" ${!connected?'disabled':''}>Открыть ответ без оценки</button>`;
      if(s.canUndo)content+=`<button class="ghost wide" data-action="undo" ${!connected?'disabled':''}>↶ Отменить последнюю оценку</button>`;
      if(s.phase==='answering')content+=`<p class="host-hint">Отвечает ${esc(answerer?.name)}. Через 30 секунд без ответа снимутся очки.</p>`;
    }else if(s.phase!=='reveal'){
      const can=s.phase==='open'&&!blocked&&connected&&!busy;
      const title=mine?'Ваш ответ':blocked?'Уже был':s.phase==='reading'?'Готовимся':s.phase==='answering'?'Отвечают':'ЖМИ!';
      const subtitle=mine?'Говорите вслух':blocked?'Шанс у остальных':s.phase==='reading'?'Ждём команду ведущего':s.phase==='answering'?esc(answerer?.name):'Я знаю ответ';
      content+=`<div class="buzz-wrap"><button id="buzz" class="buzz ${mine?'mine':''}" ${!can?'disabled':''}><span>${title}</span><small>${subtitle}</small></button></div>`;
    }
  }
  app.innerHTML=`<div class="game-layout"><div class="section-head row"><div><div class="eyebrow">Комната ${s.code} · ${host?'Ведущий':'Игрок'}</div><h2>${s.phase==='finished'?'Вот это партия':`Раунд ${s.round+1} из ${s.roundCount}`}</h2><span class="muted">Вопрос ${s.answeredCount} из ${s.questionCount}</span><span class="muted">${esc(s.title)}</span></div><span class="tag">${host?'Пульт':'На старте'}</span></div>${content}<section class="score-list"><h3 class="score-title">${s.phase==='finished'?'Очки':'Кто здесь умный'}</h3>${people()}</section>${host&&!['finished'].includes(s.phase)?'<button class="back" data-event="finish">Завершить игру досрочно</button>':''}<button class="back" data-event="home">На главную (вернуться можно позже)</button></div>`;
  updateTimer();
  const buzz=$('buzz');if(buzz){buzz.addEventListener('pointerdown',e=>{if(e.button!==0||buzz.disabled)return;e.preventDefault();send('buzz');});buzz.addEventListener('click',e=>{if(e.detail===0&&!buzz.disabled)send('buzz');});}
}
function updateTimer(){const t=$('timer');if(t&&state?.active){const left=state.active.deadline?Math.max(0,Math.ceil((state.active.deadline-Date.now()-timeOffset)/1000)):null;t.textContent=left===null?'':`${left}с`;}}
async function send(type,payload={}){
  if(busy||!session||!connected)return;busy=true;const current=session;
  if(type==='buzz'&&$('buzz'))$('buzz').disabled=true;
  try{const result=await api(`/api/rooms/${current.code}/action`,{type,payload,revision:state.revision},current);if(session===current)apply(result);}
  catch(e){toast(e.name==='TimeoutError'?'Запрос задержался. Сверьтесь с состоянием игры':e.message);}
  finally{busy=false;if(state)render();}
}
app.addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target,button=form.querySelector('button[type="submit"]');button.disabled=true;
  try{
    if(form.id==='create-form'){const s=await api('/api/rooms',{capacity:Number($('capacity').value),questionCount:Number($('question-count').value)},null);connect(s);}
    if(form.id==='join-form'){const code=$('code').value.trim(),name=$('name').value.trim();if(!/^\d{6}$/.test(code)||!name)throw new Error('Введите шестизначный код и имя');const s=await api(`/api/rooms/${code}/join`,{name},null);connect(s);}
  }catch(e){toast(e.message);button.disabled=false;}
});
app.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.mode){mode=b.dataset.mode;renderHome();return;}
  if(b.dataset.action){send(b.dataset.action);return;}
  if(b.dataset.select){const [cat,index]=b.dataset.select.split(',').map(Number);send('select',{cat,index});return;}
  if(b.dataset.kick){if(await confirmAction('Убрать этого игрока из комнаты?'))send('kick',{id:b.dataset.kick});return;}
  const event=b.dataset.event;
  if(event==='home')home();
  if(event==='resume'&&saved)connect(saved);
  if(event==='finish'&&await confirmAction('Завершить игру сейчас и показать итоговые очки?'))send('finish');
  if(event==='reveal'&&await confirmAction('Открыть ответ всем? Текущий вопрос закончится без дополнительных штрафов.'))send('reveal');
  if(event==='share'||event==='copy'){
    const url=location.origin+'/?room='+state.code;
    try{if(event==='share'&&navigator.share)await navigator.share({title:'Сыграем в Свояк?',text:'Заходи в комнату '+state.code,url});else{await navigator.clipboard.writeText(url);toast('Ссылка скопирована');}}catch(e){if(e.name!=='AbortError')toast('Ссылка указана под кнопками — скопируйте её вручную');}
  }
});
renderHome();
