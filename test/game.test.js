import test from 'node:test';
import assert from 'node:assert/strict';
import {PACK,createRoom,join,action,actor,view,tick} from '../src/game.js';
const host={host:true};
function setup(){const r=createRoom('123456',3,60);const a=join(r,'Анна'),b=join(r,'Борис'),c=join(r,'Вера');action(r,host,'start');return {r,a,b,c};}
function open(r,now=1000){action(r,host,'select',{cat:0,index:0},now);action(r,host,'open',{},now);}
test('120 questions with answers, two full boards',()=>{assert.equal(PACK.length,2);for(const round of PACK){assert.equal(round.categories.length,12);for(const cat of round.categories){assert.equal(cat.questions.length,5);for(const q of cat.questions){assert.ok(q.q&&q.a);}}}});
test('capacity and names checked',()=>{assert.throws(()=>createRoom('123456',13));const r=createRoom('123456',2,30);join(r,'Тест');assert.throws(()=>join(r,' тест '));assert.throws(()=>join(r,''));join(r,'Друг');assert.throws(()=>join(r,'Третий'));});
test('first buzz only, wrong reopens for others, correct scores once',()=>{
 const {r,a,b}=setup();open(r);action(r,{id:a.id},'buzz',{},1100);assert.throws(()=>action(r,{id:b.id},'buzz',{},1101));
 action(r,host,'wrong',{},1200);assert.equal(a.score,-100);assert.throws(()=>action(r,{id:a.id},'buzz',{},1300));
 action(r,{id:b.id},'buzz',{},1300);action(r,host,'correct',{},1400);assert.equal(b.score,100);assert.equal(r.game.phase,'reveal');assert.throws(()=>action(r,host,'correct'));assert.equal(b.score,100);
});
test('players cannot grade or see hidden answers',()=>{const {r,a}=setup();open(r);assert.throws(()=>action(r,{id:a.id},'correct'));assert.equal(view(r,{id:a.id}).active.answer,undefined);assert.ok(view(r,host).active.answer);action(r,host,'reveal');assert.ok(view(r,{id:a.id}).active.answer);assert.ok(!JSON.stringify(view(r,{id:a.id})).includes(a.token));assert.throws(()=>actor(r,'bad'));});
test('timeout blocks expired buzz and applies one penalty',()=>{const {r,a}=setup();open(r);action(r,{id:a.id},'buzz',{},2000);assert.equal(tick(r,17000),true);assert.equal(a.score,-100);assert.equal(tick(r,17001),false);assert.equal(a.score,-100);assert.equal(r.game.phase,'open');tick(r,37000);assert.equal(r.game.phase,'reveal');});
test('empty buzzer times out with no scores changed',()=>{const {r,a}=setup();open(r);assert.throws(()=>action(r,{id:a.id},'buzz',{},21000));tick(r,21000);assert.equal(r.game.phase,'reveal');assert.equal(a.score,0);});
test('undo restores scores and responder with fresh timer',()=>{const {r,a}=setup();open(r);action(r,{id:a.id},'buzz',{},2000);action(r,host,'correct',{},3000);action(r,host,'undo',{},4000);assert.equal(a.score,0);assert.equal(r.game.active.buzzer,a.id);assert.equal(r.game.phase,'answering');assert.equal(r.game.active.deadline,34000);assert.throws(()=>action(r,host,'undo'));});
test('all players wrong reveals answer',()=>{const {r,a,b,c}=setup();open(r);for(const p of[a,b,c]){action(r,{id:p.id},'buzz',{},2000);action(r,host,'wrong',{},3000);}assert.equal(r.game.phase,'reveal');assert.deepEqual(r.players.map(p=>p.score),[-100,-100,-100]);});
test('complete two rounds, used questions cannot repeat',()=>{
 const r=createRoom('123456',3,120);join(r,'Анна');join(r,'Борис');action(r,host,'start');for(let round=0;round<2;round++){
  for(let cat=0;cat<12;cat++)for(let index=0;index<5;index++){action(r,host,'select',{cat,index});assert.equal(r.game.active.value,(index+1)*100*(round+1));action(r,host,'reveal');action(r,host,'next');if(index===0&&cat===0)assert.throws(()=>action(r,host,'select',{cat,index}));}
  if(round===0){assert.equal(r.game.phase,'roundEnd');action(r,host,'nextRound');}
 }assert.equal(r.game.phase,'finished');assert.equal(r.game.used.length,120);
});
test('lobby closed after start; single-round game ends',()=>{const {r}=setup();assert.throws(()=>join(r,'Поздний'));r.questionCount=30;r.roundCount=1;for(let cat=0;cat<6;cat++)for(let index=0;index<5;index++){action(r,host,'select',{cat,index});action(r,host,'reveal');action(r,host,'next');}assert.equal(r.game.phase,'finished');});
