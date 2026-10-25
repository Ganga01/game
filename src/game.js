import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const PACK = JSON.parse(readFileSync(new URL('../data/questions.json', import.meta.url)));
export const secret = () => randomBytes(24).toString('hex');
const fail = (condition, message) => { if (!condition) throw new Error(message); };
export function createRoom(code, capacity = 4, questionCount = 60) {
  fail(Number.isInteger(capacity) && capacity >= 2 && capacity <= 12, 'Выберите от 2 до 12 игроков');
  fail([30,60,90,120].includes(questionCount), 'Выберите 30, 60, 90 или 120 вопросов');
  const roundCount = Math.ceil(questionCount / 60);
  return {code, host: secret(), capacity, roundCount, questionCount, created: Date.now(), updated: Date.now(), revision: 0,
    players: [], game: {phase:'lobby', round:0, used:[], active:null, chooser:null, message:'Ждём игроков', modifier:null, modifierNotice:'', nextModifierAt:null}, undo:null};
}
export function join(room, name) {
  fail(room.game.phase === 'lobby', 'Игра уже началась. Вернуться можно из того же браузера');
  fail(room.players.length < room.capacity, 'В комнате нет свободных мест');
  fail(typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 24, 'Имя: от 1 до 24 символов');
  name = name.trim();
  fail(!room.players.some(p => p.name.toLowerCase() === name.toLowerCase()), 'Это имя уже занято');
  const player = {id:randomUUID(), token:secret(), name, score:0}; room.players.push(player); return player;
}
export function actor(room, token) {
  if (token === room.host) return {host:true};
  const p = room.players.find(p => p.token === token); fail(p, 'Сессия не найдена. Войдите заново');
  return {host:false, id:p.id};
}
function question(room) { const a = room.game.active; return a ? PACK[room.game.round].categories[a.cat].questions[a.index] : null; }
function reveal(room, message) {
  room.game.phase = 'reveal'; room.game.active.deadline = null; room.game.message = message;
}
function wrong(room, now) {
  const g = room.game, a = g.active, p = room.players.find(p => p.id === a.buzzer);
  p.score -= a.value; a.blocked.push(p.id); a.buzzer = null;
  if (a.blocked.length >= room.players.length) reveal(room, 'Никто не угадал. Бывает даже у знатоков');
  else { g.phase = 'open'; a.deadline = now + 30000; g.message = `${p.name}: −${a.value}. Остальные могут нажимать!`; }
}
// Все переходы синхронны: первый принятый сервером buzz закрывает приём остальных.
export function action(room, who, type, payload = {}, now = Date.now()) {
  const g = room.game, a = g.active;
  if (type === 'buzz') {
    fail(!who.host, 'Ведущий не участвует в гонке кнопок');
    fail(g.phase === 'open' && a.deadline > now, 'Кнопка пока закрыта или уже нажата');
    fail(!a.blocked.includes(who.id), 'Вы уже отвечали на этот вопрос');
    room.undo = null; a.buzzer = who.id; a.deadline = now + 30000; g.phase = 'answering';
    g.message = `${room.players.find(p=>p.id===who.id).name} отвечает`; return;
  }
  fail(who.host, 'Это действие доступно только ведущему');
  if (type === 'start') {
    fail(g.phase === 'lobby' && room.players.length >= 2, 'Нужно минимум два игрока');
    g.phase = 'board'; g.chooser = room.players[0].id; g.message = 'Выберите тему и стоимость';
    g.nextModifierAt=now+randomInt(30000,90001);
  } else if (type === 'kick') {
    fail(g.phase === 'lobby', 'Удалять игроков можно до начала игры');
    room.players = room.players.filter(p=>p.id!==payload.id);
  } else if (type === 'select') {
    fail(g.phase === 'board', 'Сначала завершите текущий вопрос');
    const {cat,index} = payload;
    fail(Number.isInteger(cat) && Number.isInteger(index) && PACK[g.round].categories[cat]?.questions[index], 'Нет такого вопроса');
    const key = `${g.round}:${cat}:${index}`; fail(!g.used.includes(key), 'Вопрос уже сыгран');
    g.active = {cat,index,key,value:(index+1)*100*(g.round+1), blocked:[],buzzer:null,deadline:null};
    if(g.modifier?.type==='approx'&&!g.modifier.key)g.modifier.key=key;
    g.phase='reading'; g.message='Читаем вопрос. Кнопка откроется по команде ведущего'; room.undo=null;
  } else if (type === 'open') {
    fail(g.phase === 'reading', 'Кнопки уже открыты'); g.phase='open'; a.deadline=now+30000; g.message='Знаете ответ? Жмите!';
  } else if (type === 'correct' || type === 'wrong' || type === 'approx') {
    fail(g.phase === 'answering', 'Сейчас никто не отвечает');
    if(type==='approx')fail(g.modifier?.type==='approx'&&g.modifier.key===a.key,'Сейчас нельзя засчитать приблизительный ответ');
    room.undo = {game:structuredClone(g), scores:room.players.map(p=>[p.id,p.score])};
    if (type === 'wrong') wrong(room, now);
    else {
      const p = room.players.find(p=>p.id===a.buzzer), award=type==='approx'?Math.max(1,Math.floor(a.value/2)):a.value;
      p.score += award; g.chooser=p.id;
      if(type==='approx'){
        g.modifier=null;
        g.modifierNotice='Модификатор использован: близкий ответ засчитан за половину очков.';
        g.nextModifierAt=now+randomInt(45000,120001);
      }
      reveal(room, `${p.name}: +${award}${type==='approx'?' за приблизительный ответ. Засчитано!':'. Красиво!'}`);
    }
  } else if (type === 'reveal') {
    fail(['reading','open','answering'].includes(g.phase), 'Нет открытого вопроса');
    room.undo=null; reveal(room, 'Ответ открыт ведущим. Без дополнительных штрафов');
  } else if (type === 'undo') {
    fail(room.undo, 'Нет оценки для отмены');
    room.game=room.undo.game;
    for (const [id,score] of room.undo.scores) { const p=room.players.find(p=>p.id===id); if(p)p.score=score; }
    room.game.active.deadline=now+30000; room.undo=null;
  } else if (type === 'next') {
    fail(g.phase === 'reveal', 'Сначала откройте ответ');
    if(g.modifier?.type==='approx'&&g.modifier.key===a.key)g.modifier=null;
    g.modifierNotice='';
    if(!g.nextModifierAt||g.nextModifierAt<=now)g.nextModifierAt=now+randomInt(45000,120001);
    g.used.push(a.key); g.active=null; room.undo=null;
    const inRound=g.used.filter(key=>key.startsWith(`${g.round}:`)).length;
    const done=g.used.length>=room.questionCount;
    const roundDone=inRound>=PACK[g.round].categories.reduce((sum,c)=>sum+c.questions.length,0);
    g.phase=done ? 'finished' : roundDone ? 'roundEnd' : 'board';
    g.message=done ? 'Раунд завершён' : 'Выберите следующий вопрос';
  } else if (type === 'nextRound') {
    fail(g.phase==='roundEnd', 'Раунд ещё идёт'); g.round++; g.phase='board'; g.message='Стоимость вопросов удвоилась';
  } else if (type === 'finish') {
    fail(!['lobby','finished'].includes(g.phase), 'Нельзя завершить игру сейчас');
    g.phase='finished'; g.active=null; g.modifier=null; room.undo=null; g.message='Игра завершена ведущим';
  } else throw new Error('Неизвестное действие');
}
export function tick(room, now=Date.now()) {
  const g=room.game;
  let changed=false;
  if(!g.nextModifierAt&&!['lobby','finished'].includes(g.phase)){
    g.nextModifierAt=now+randomInt(30000,90001);changed=true;
  }
  if(['board','reading','open','answering'].includes(g.phase)&&g.nextModifierAt&&g.nextModifierAt<=now&&!g.modifier){
    if(randomInt(0,2)===0){
      for(const p of room.players)p.score=-p.score;
      g.modifierNotice='Случайный модификатор: обмен очков — знак счёта каждого игрока изменён на противоположный.';
      g.message=g.modifierNotice;
    }else{
      g.modifier={type:'approx',key:g.active?.key||null};
      g.modifierNotice='Случайный модификатор: приблизительный ответ. Ведущий может засчитать близкий ответ за половину стоимости вопроса.';
      g.message=g.modifierNotice;
    }
    g.nextModifierAt=now+randomInt(45000,120001);changed=true;
  }
  if (!g.active?.deadline || g.active.deadline > now) return changed;
  if(g.phase==='answering') {
    room.undo={game:structuredClone(g),scores:room.players.map(p=>[p.id,p.score])}; wrong(room,now);
  } else if(g.phase==='open') { room.undo=null; reveal(room,'Время вышло. Смотрим ответ'); }
  else return changed;
  return true;
}
export function view(room, who, online = new Set()) {
  const g=room.game, a=g.active, q=question(room);
  return {code:room.code,capacity:room.capacity,roundCount:room.roundCount,questionCount:room.questionCount,answeredCount:g.used.length,revision:room.revision,serverTime:Date.now(),
    role:who.host?'host':'player',me:who.id||null,phase:g.phase,round:g.round,title:PACK[g.round].title,
    message:g.message,chooser:g.chooser,canUndo:who.host&&!!room.undo,modifier:g.modifier?.type||null,
    modifierNotice:g.modifierNotice||'',approximateActive:!!(a&&g.modifier?.type==='approx'&&g.modifier.key===a.key),
    players:room.players.map(({id,name,score})=>({id,name,score,online:online.has(id)})),
    board:PACK[g.round].categories.map((c,ci)=>({title:c.title,questions:c.questions.map((_,i)=>({
      value:(i+1)*100*(g.round+1),used:g.used.includes(`${g.round}:${ci}:${i}`)}))})),
    active:a?{...a,category:PACK[g.round].categories[a.cat].title,q:q.q,
      ...(g.phase==='reveal'||who.host?{answer:q.a,note:q.note||''}:{})}:null};
}
