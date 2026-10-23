const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require(require.resolve('jsdom',{paths:[path.join(process.cwd(),'tests')]}));
const html=fs.readFileSync(path.join(__dirname,'personal-improve.html'),'utf8');
assert(!/[—–「」]| · /.test(html),'엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점 없음');
assert(!/<script[^>]+src=|<link[^>]+href=|@import|url\(\s*['"]?https?:/i.test(html),'외부 자원 없음');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,d=w.document,q=s=>d.querySelector(s),all=s=>[...d.querySelectorAll(s)],click=s=>{assert(q(s),s);q(s).click();};
const vis=()=>all('.scene').filter(s=>!s.hidden).map(s=>s.dataset.scene);
const P=w.__P;

// 장면 전환: 하나만 보이고 단추가 눌린 상태
for(const id of ['month','memo','form','decide','summary']){
  click(`button[data-scene=${id}]`);
  assert.deepEqual(vis(),[id]);
  assert.equal(q(`button[data-scene=${id}]`).getAttribute('aria-pressed'),'true');
  assert(q(`.scene[data-scene=${id}] .scene-notes h2`).textContent.length>0);
}
// 지금과 바꾼 안이 같은 줄에 나란히(장면 1, 3)
const sameRow=(a,b)=>{const x=q(a),y=q(b);assert(x&&y,a+' '+b);assert.equal(x.closest('.cmp-row'),y.closest('.cmp-row'));};
click('button[data-scene=month]');
sameRow('[data-pid=m-now][data-side=now]','[data-pid=m-new][data-side=new]');
click('button[data-scene=form]');
for(const row of all('.scene[data-scene=form] .cmp-row')){
  const sides=[...row.children].map(p=>p.dataset.side);
  assert(sides.includes('now')&&sides.includes('new'),'폼 줄마다 지금과 바꾼 안');
}
// A/B 짝: 같은 줄에 두 개, 추천은 하나
click('button[data-scene=memo]');
click('button[data-scene=decide]');
for(const k of ['a','b','c']){
  const row=q(`.cmp-row[data-decision=${k}]`);assert(row,k);
  assert.deepEqual([...row.children].map(p=>p.dataset.side),['A','B'],k+' A 와 B 가 나란히');
  assert.equal(row.querySelectorAll('.rec-tag').length,1,k+' 추천 하나');
  for(const p of row.children) assert(p.querySelector('.tc-frame .modal'),k+' 두 안 모두 폼이 그려짐');
}
click('button[data-scene=memo]');
{const row=q('.cmp-row[data-decision=memo]');const s=[...row.children].map(p=>p.dataset.side);assert.deepEqual(s,['now','A','B']);assert.equal(row.querySelectorAll('.rec-tag').length,1);
 assert(row.querySelectorAll('[data-fid=memo-A] .pm-mline').length>0,'A 는 메모 첫 줄');assert.equal(row.querySelectorAll('[data-fid=memo-B] .pm-mline').length,0,'B 는 없음');
 q('[data-memo-toggle]').checked=false;q('[data-memo-toggle]').dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(all('[data-fid=memo-A] .pm-mline').length,0,'A 체크 끄기');}

// 폭 단추: 창 틀 폭이 1280 과 400 으로 바뀐다(폼 장면 포함)
for(const sc of ['month','form','decide']){
  click(`button[data-scene=${sc}]`);
  click('[data-width=narrow]');assert.equal(q('[data-width=narrow]').getAttribute('aria-pressed'),'true');
  assert(all('.scene:not([hidden]) .tc-frame').every(f=>f.dataset.w==='400'),sc+' 400');
  assert(all('.scene:not([hidden]) .tc-frame .modal').length>=(sc==='month'?0:2),sc+' 400 에서도 폼');
  click('[data-width=wide]');
  const ws=all('.scene:not([hidden]) .tc-frame').map(f=>f.dataset.w);
  assert(ws.includes('1280'),sc+' 1280');
  if(sc==='decide') assert(all('.cmp-row[data-decision=c] .tc-frame').every(f=>f.dataset.w==='400'),'(c) 는 늘 400');
}
console.log('PASS: 장면 전환, 지금과 바꾼 안 나란히, A/B 짝과 추천, 폭 단추(1280, 400), 문구 규칙, 외부 자원 없음.');

// 장면 1: 막대 모양
click('button[data-scene=month]');
const nb=s=>all(`[data-fid=m-new] ${s}`);
const e2=nb('.pm-bar[data-id=e2]');assert.equal(e2.length,2,'시제품 조립은 주 경계에서 두 조각');
assert(e2[0].classList.contains('cr')&&e2[1].classList.contains('cl'),'잘린 쪽 표시');
assert(e2[0].textContent.includes('▸')&&e2[1].textContent.includes('◂'),'◂ ▸');
assert(e2[0].textContent.includes('10/5 ~ 10/13'),'기간 글자');
assert.equal(all('[data-fid=m-now] .chip[data-id=e2]').length,9,'지금은 칸마다 조각 9개');
const t1=nb('.pm-bar[data-id=t1]')[0];assert(t1.classList.contains('todo')&&t1.classList.contains('range'),'기간 할 일 점선 띠');
assert(nb('.pm-bar.timed[data-id=e4]')[0].querySelector('.pm-dot,.pm-time'),'시간 일정 점 + 시각');
assert.equal(nb('.pm-bar[data-id=e5]')[0].getAttribute('draggable'),'false','반복은 끌기 금지');
assert(nb('.pm-bar[data-id=e5]')[0].querySelector('.ic'),'반복 표시');
assert(nb('.hol').some(h=>h.textContent==='한글날'),'공휴일');
assert(nb('.pm-more[data-more="2026-10-23"]').length===1,'+N');
assert.equal(all('.scene:not([hidden]) .pc-pop, .scene:not([hidden]) [role=dialog]').length,0,'개인 탭에 팝오버 없음');
// 누르기: 날짜 선택과 오른쪽 패널
nb('.pm-day[data-date="2026-10-22"]')[0].click();
assert.equal(P.S.sel,'2026-10-22');assert(q('[data-fid=m-now] .dp-date').textContent.startsWith('10월 22일'),'두 창 패널이 같이 바뀜');
nb('.pm-bar[data-id=e2]')[1].click();assert.equal(P.S.sel,'2026-10-11','좌표가 없으면 그 조각의 첫 칸');
assert(q('[data-fid=m-new] [data-card=e2].flash'),'카드 강조');
nb('.pm-bar[data-id=t1]')[0].click();assert.equal(P.S.tab,'todo','할 일은 할 일 탭');
nb('.pm-more[data-more="2026-10-23"]')[0].click();assert.equal(P.S.sel,'2026-10-23');assert.equal(P.S.tab,'detail');
assert.equal(all('[data-fid=m-new] .dp-list .card').length,5,'+N 날짜의 기록 전부가 패널에');
// 끌기: 잡은 자리 기준, 길이 유지
const fire=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true}));
fire(nb('.pm-bar[data-id=e2]')[0],'dragstart');            // 좌표 없음: 첫 칸(10/5)을 잡은 것으로
fire(nb('.pm-day[data-date="2026-10-07"]')[0],'dragover');
assert(q('[data-fid=m-new] .pm-day.drop'),'놓을 칸 표시');
fire(nb('.pm-day[data-date="2026-10-07"]')[0],'drop');
let e=P.D.ev.find(x=>x.id==='e2');assert.equal(e.s,'2026-10-07');assert.equal(e.e,'2026-10-15');
// 지금: 시작일 기준(앱 그대로)
fire(all('[data-fid=m-now] .cell[data-date="2026-10-12"] .chip[data-id=e2]')[0],'dragstart');
fire(q('[data-fid=m-now] .cell[data-date="2026-10-14"]'),'drop');
e=P.D.ev.find(x=>x.id==='e2');assert.equal(e.s,'2026-10-14','지금 앱은 시작일이 놓은 칸으로');assert.equal(e.e,'2026-10-22');
// 할 일 끌기, 반복 끌기 금지
click('[data-reset]');
fire(nb('.pm-bar[data-id=t4]')[0]||nb('.pm-bar[data-id=t2]')[0],'dragstart');
fire(nb('.pm-day[data-date="2026-10-28"]')[0],'drop');
assert(P.D.td.some(t=>t.due==='2026-10-28'),'할 일 끌기');
const rec=nb('.pm-bar[data-id=e5]')[0];const ds=new w.Event('dragstart',{bubbles:true,cancelable:true});rec.dispatchEvent(ds);assert(ds.defaultPrevented,'반복 끌기 막음');
click('[data-reset]');assert.equal(P.D.ev.find(x=>x.id==='e2').s,'2026-10-05');
// 좁은 창: 날짜를 누르면 패널 시트가 열림
click('[data-width=narrow]');nb('.pm-day[data-date="2026-10-15"]')[0].click();
assert(q('[data-fid=m-new] .tc-root').classList.contains('sheet-open'));assert(!q('[data-fid=m-now] .tc-root').classList.contains('sheet-open'));
q('[data-fid=m-new] [data-sheetclose]').click();assert(!q('[data-fid=m-new] .tc-root').classList.contains('sheet-open'));
click('[data-width=wide]');
console.log('PASS: 막대 조각과 ◂ ▸, 기간 글자, 할 일 점선, 시간 점, 반복, 공휴일, +N, 팝오버 없음, 날짜 선택과 패널, 끌기(잡은 자리, 지금은 시작일), 좁은 창 시트.');

// 장면 3: 한 화면 폼의 칸 순서, 옵션 더보기 없음, 할 일 칸
click('button[data-scene=form]');
const order=pid=>[...q(`[data-form=${pid}]`).querySelectorAll('[data-field]')].map(x=>x.dataset.field);
assert.deepEqual(order('f-ev'),['type','title','start','end','cat','time','remind','recur','loc','memo']);
assert.deepEqual(order('f-td'),['type','title','start','end','cat','prio','memo']);
assert.equal(q('[data-form=f-ev]').querySelectorAll('.qa-more,.qa-advanced').length,0,'옵션 더보기, 자세히 편집 없음');
assert.deepEqual([...q('[data-form=f-ev] .qa-foot').querySelectorAll('button')].map(b=>b.textContent),['취소','저장']);
assert(q('[data-fid=q-open] .qa-more').textContent.includes('▾'),'지금: 펼치기 단추');
assert(q('[data-fid=q-edit] .em'),'지금: 기록 창');
// 폼 조작: 유형 전환, 종일, 반복 펼침, 장소 고르기, 종료일 검사
q('[data-form=f-ev] [data-qtype=todo]').click();assert.deepEqual(order('f-ev'),['type','title','start','end','cat','prio','memo']);
q('[data-form=f-ev] [data-qtype=event]').click();
const setv=(pid,k,v)=>{const el=q(`[data-form=${pid}] [data-k=${k}]`);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
setv('f-ev','allDay',true);assert(!q('[data-form=f-ev] .timepick'),'종일이면 시각 숨김');assert(q('[data-form=f-ev] .rem-block.rem-off'),'종일이면 미리알림 꺼짐');
setv('f-ev','allDay',false);
setv('f-ev','recur','weekly');assert(q('[data-form=f-ev] .pf-rc'),'반복 세부 펼침');assert(q('[data-form=f-ev] .pf-rc').textContent.includes('매주 목요일, 계속'));
q('[data-form=f-ev] [data-loc-tog]').click();assert(q('[data-form=f-ev] .loc-pop'));q('[data-form=f-ev] [data-loc-pick="2"]').click();assert.equal(q('[data-form=f-ev] [data-k=loc]').value,'(예시) 대회의실');
setv('f-ev','e','2026-10-10');assert(q('[data-form=f-ev] .pf-err').textContent.includes('빠를 수 없습니다'));
setv('f-ev','e','2026-10-17');assert.equal(q('[data-form=f-ev] .pf-err').textContent,'');assert(q('[data-form=f-ev]').textContent.includes('3일 기간 일정'));
setv('f-td','tE','');assert(q('[data-form=f-td] [data-field=memo]').textContent.startsWith('설명'),'할 일 종료일 없으면 설명');
console.log('PASS: 한 화면 폼 칸 순서(일정, 할 일), 옵션 더보기 없음, 취소와 저장, 지금 세 화면, 유형 전환, 종일, 반복 펼침, 장소 콤보, 종료일 검사.');

// 장면 4: 각 A/B 의 차이
click('button[data-scene=decide]');
assert(q('[data-form=a-A] .timepick')&&!q('[data-form=a-A] input[type=time]'),'(a) A 시/분 고르기');
assert(q('[data-form=a-B] input[type=time]')&&!q('[data-form=a-B] .timepick'),'(a) B 시각 칸');
assert(q('[data-form=b-A] .pf-rc'),'(b) A 펼침');
assert(q('[data-form=b-B] .pf-rsum')&&q('[data-fid=b-B] .overlay.sub'),'(b) B 요약 + 작은 창');
q('[data-fid=b-B] .overlay.sub [data-sub-close]').click();assert(!q('[data-fid=b-B] .overlay.sub'));
q('[data-form=b-B] [data-sub-open]').click();assert(q('[data-fid=b-B] .overlay.sub'));
assert(q('[data-fid=c-A] .overlay.place-center')&&!q('[data-fid=c-B] .overlay.place-center'),'(c) A 가운데, B 시트');
assert(q('[data-fid=c-A] .qa-foot.hl')&&q('[data-fid=c-B] .qa-foot.hl'),'(c) 저장 줄 표시');
click('button[data-scene=summary]');assert.equal(all('.scene[data-scene=summary] .sum-card').length,4);
console.log('PASS: (a) 시각 입력, (b) 반복 세부와 작은 창, (c) 가운데와 시트, 정리 카드.');
