// 타인 일정 보기 개선(docs/PEER-VIEW-FULL.md P1–P7 · Q1–Q8) — 「열람 창에서도 내 메인 화면이 보이는 것은 다 보인다」.
//
// 이 파일이 지키는 것:
//   (H) 호스트 — LoadPeerScheduleJsonAsync 의 **범위**. 할 일·커밋·메모·장소는 온다(P2),
//       과제별 시간·근태·보고서 서식·회의실·알림 설정·저장소 경로는 **키조차** 없다(P3).
//       행 → state 변환은 부팅 조회와 **같은 함수**다(모양이 갈라지면 같은 앱이 다른 화면을 그린다).
//       권한 재판정·정렬·시간제한은 그대로다(P7).
//   (W) 웹 — 「할 일」·「커밋 내역」 탭을 연다(P2) · 편집 수단은 여전히 없다(P3) · 밀도 기본 펼침 + 열람 창
//       전용 키(P4) · 모달 크게(P5) · 그리드 클릭이 PEER 전용 길을 안 탄다(P1) · 내 겹은 일정만(P6).
//   (R) jsdom 실행 — 열람 창을 실제로 띄워 할 일·커밋이 그려지고, 「+N」 이 없고, 10/1 기간 칩을 눌러도
//       10월이 유지되고, 편집 함수가 state 를 바꾸기 전에 끊기는지(save() 까지 가지 않는지) 본다.
//   (M) 변이 — 할 일 탭 재숨김 · payload 에 taskHours · PEER 할 일 체크 무방비 · 밀도 키 공유를 각각 잡는다.
//
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 **등록되지 않고** skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, extractCsMember, stripCsComments,
         importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';
import { readFileSync } from 'node:fs';

const caldb = readFileSync(new URL('../widget/CalendarDb.cs', import.meta.url), 'utf8');
const app = loadAppSource();

// 앵커 하나를 정확히 한 번 바꾼다 — 없거나 여럿이면 실패(조용히 통과하는 껍데기 변이를 막는다).
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  const out = text.slice(0, a) + repl + text.slice(a + find.length);
  assert.notStrictEqual(out, text, '변이가 원본을 바꾸지 못했다');
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// (H) 호스트 계약 — 주석을 걷어낸 본문으로 본다(설명 주석의 낱말이 계약을 통과시키면 안 된다).
// ══════════════════════════════════════════════════════════════════════
const PEER_SIG = 'public async Task<string?> LoadPeerScheduleJsonAsync(';
const BOOT_SIG = 'private async Task<CalendarSnapshot> ReadInsideSnapshotAsync(';

// 반환 직렬화 딕셔너리의 키 목록(순서대로).
function payloadKeys(body) {
  const at = body.lastIndexOf('JsonSerializer.Serialize(new Dictionary<string, object?>');
  assert.ok(at >= 0, '타인 일정 조회의 반환 직렬화를 찾지 못했다 — 판정 불가');
  const blk = body.slice(at, body.indexOf('});', at));
  return [...blk.matchAll(/\["(\w+)"\]\s*=/g)].map((m) => m[1]);
}

const H = {
  //  P2 — 화면이 그리는 것은 온다: 표 여섯 · 컬럼 · 반환 키.
  sendsScreenScope(cs) {
    const b = extractCsMember(cs, PEER_SIG);
    for (const t of ['FROM cal_category c', 'FROM cal_entry e', 'FROM cal_entry_except', 'FROM cal_entry_commit',
                     'FROM cal_todo t', 'FROM cal_todo_day_note']) {
      assert.ok(b.includes(t), `타인 일정 조회가 ${t} 를 읽지 않는다 — 열람 창의 그 화면(P2)이 비어 거짓말을 한다`);
    }
    for (const col of ['e.memo', 'e.location', 'e.source', 'e.recur_freq', 'subject', 'body',
                       't.todo_text', 't.note', 't.done', 't.prio', 't.due', 't.end_date', 'completed_at', 'note_text',
                       'c.source', 'db_gone']) {
      assert.ok(b.includes(col), `타인 일정 조회가 ${col} 을(를) 읽지 않는다 — 내 화면이 그리는 값이다(P2)`);
    }
    assert.deepStrictEqual(payloadKeys(b), ['allowed', 'categories', 'entries', 'todos'],
      '타인 일정 조회의 반환 키가 계약(allowed·categories·entries·todos)과 다르다');
  },
  //  P3 — 보고서·알림·설정 값은 읽지도 싣지도 않는다.
  omitsReportValues(cs) {
    const b = extractCsMember(cs, PEER_SIG);
    for (const leak of ['cal_task_hours', 'cal_attendance', 'cal_user_pref', 'cal_room', 'e.remind',
                        'description', 'uses_repo', 'repoPaths', 'git_author', 'report_']) {
      assert.ok(!b.includes(leak), `타인 일정 조회가 ${leak} 을(를) 읽는다 — 과제별 시간·근태·서식·회의실·알림·저장소는 보내지 않는다(P3)`);
    }
    for (const key of ['taskHours', 'attendance', 'rooms', 'reportFormatPrefs', 'reportFont', 'reportMarker',
                       'gitAuthor', 'svnAuthor', 'remind', 'gitRepo', 'svnRepo', 'usesRepo', 'desc']) {
      assert.ok(!new RegExp('\\["' + key + '"\\]').test(b),
        `타인 일정 조회가 "${key}" 키를 만든다 — 키조차 없어야 한다(P3)`);
    }
    assert.ok(!payloadKeys(b).some((k) => !['allowed', 'categories', 'entries', 'todos'].includes(k)),
      '타인 일정 조회의 반환에 계약 밖 키가 있다: ' + payloadKeys(b).join(','));
  },
  //  행 → state 변환은 부팅과 **같은 함수**다. 알림 설정만 빠진다(withRemind:false).
  sharesBootMapping(cs) {
    const peer = extractCsMember(cs, PEER_SIG), boot = extractCsMember(cs, BOOT_SIG);
    for (const fn of ['EntryRowToState(', 'TodoRowToState(', 'CommitRow(', 'AddDbSourceFlags(']) {
      assert.ok(peer.includes(fn), `타인 일정 조회가 ${fn} 를 쓰지 않는다 — 행 변환이 부팅과 갈라진다`);
      assert.ok(boot.includes(fn), `부팅 조회가 ${fn} 를 쓰지 않는다 — 공유 변환이 한쪽에만 걸려 있다`);
    }
    assert.ok(/EntryRowToState\(rd, Iso, withRemind: false\)/.test(peer), '타인 일정 조회가 알림 설정을 뺀 변환(withRemind:false)을 쓰지 않는다');
    assert.ok(/EntryRowToState\(rd, Iso, withRemind: true\)/.test(boot), '부팅 조회가 알림 설정(remind)을 싣지 않는다 — 내 알림이 사라진다');
    const m = extractCsMember(cs, 'private static Dictionary<string, object?> EntryRowToState(');
    assert.ok(/withRemind \? IntOrNull\(rd, "remind"\) : null/.test(m), 'EntryRowToState 가 withRemind:false 에서도 remind 컬럼을 읽는다(SELECT 에 없으면 터진다)');
    assert.ok(/if \(!withRemind\) e\.Remove\("remind"\);/.test(m), 'EntryRowToState 가 withRemind:false 에서 remind 키를 지우지 않는다');
    assert.ok(/\["commits"\]\s*=\s*new List<object\?>\(\)/.test(m), 'EntryRowToState 의 commits 가 항상 배열이 아니다(G-7)');
  },
  //  P7 — 권한 재판정 · 정렬 · 시간제한 · 실패 분류는 그대로.
  keepsAuthOrderTimeout(cs) {
    const b = extractCsMember(cs, PEER_SIG);
    const auth = b.indexOf('ProjectDb.CanViewScheduleAsync(');
    assert.ok(auth >= 0, '타인 일정 조회가 권한을 다시 판정하지 않는다(view_scope)');
    assert.ok(auth < b.indexOf('FROM cal_'), '권한 판정이 데이터 읽기보다 뒤에 있다 — 읽고 나서 막으면 늦다');
    for (const ord of ['ORDER BY c.sort_order, c.uid', 'ORDER BY e.sort_order, e.uid', 'ORDER BY t.sort_order, t.uid',
                       'ORDER BY entry_no, seq', 'ORDER BY except_date', 'ORDER BY note_date']) {
      assert.ok(b.includes(ord), `타인 일정 조회의 정렬(${ord})이 부팅과 다르다 — 주인과 열람자가 다른 순서를 본다`);
    }
    assert.ok(/TimeSpan\.FromSeconds\(10\)/.test(b), '타인 일정 조회의 읽기 시간제한(10초)이 사라졌다');
    assert.ok(/START TRANSACTION WITH CONSISTENT SNAPSHOT/.test(b) && /"COMMIT"/.test(b) && /"ROLLBACK"/.test(b),
      '타인 일정 조회가 한 스냅샷에서 읽지 않는다 — 재사용되는 entry_no 에 남의 커밋이 붙을 수 있다');
    assert.ok(/DbErrors\.Observe\(ex, _log\)/.test(b), '타인 일정 조회 실패가 분류기에 닿지 않는다');
  },
};

test('(H) P2: 타인 일정 조회가 할 일·커밋·메모·장소·출처를 읽고 allowed·categories·entries·todos 를 돌려준다', () => H.sendsScreenScope(caldb));
test('(H) P3: 과제별 시간·근태·서식·회의실·알림·저장소 경로는 읽지도 싣지도 않는다(Q4)', () => H.omitsReportValues(caldb));
test('(H) 행 변환은 부팅과 같은 함수 — 열람만 remind 를 뺀다', () => H.sharesBootMapping(caldb));
test('(H) P7: 권한 재판정이 먼저 · 정렬·시간제한·스냅샷·실패 분류 유지(Q7)', () => H.keepsAuthOrderTimeout(caldb));
test('(H) 주석 걷기: 설명 주석의 「description」 같은 낱말은 판정에 끼지 않는다(본문만 본다)', () => {
  //  사전조건 — 실제 주석에 그 낱말이 있다(없으면 이 시험이 지키는 것이 없다).
  assert.ok(caldb.slice(caldb.indexOf(PEER_SIG) - 4000, caldb.indexOf(PEER_SIG)).includes('uses_repo'),
    '사전조건: 머리 주석에 uses_repo 언급이 있어야 한다');
  assert.ok(!stripCsComments(extractCsMember(caldb, PEER_SIG)).includes('uses_repo'));
});

// ── (M) 호스트 변이 ─────────────────────────────────────────────────────
test('변이 H1: payload 에 taskHours 를 실으면 P3 계약이 잡는다', () => {
  const bad = mutate(caldb, '["entries"] = entries, ["todos"] = todos,',
                            '["entries"] = entries, ["todos"] = todos, ["taskHours"] = new Dictionary<string, object?>(),');
  assert.throws(() => H.omitsReportValues(bad), /taskHours/);
  assert.throws(() => H.sendsScreenScope(bad), /반환 키가 계약/);
});
test('변이 H2: 열람 조회가 cal_task_hours 를 읽으면 P3 계약이 잡는다', () => {
  const bad = mutate(caldb, '"FROM cal_todo_day_note WHERE user_id=@u ORDER BY note_date", conn))\n                    {\n                        cmd.Parameters.AddWithValue("@u", uid);',
    '"FROM cal_todo_day_note WHERE user_id=@u ORDER BY note_date", conn))\n                    {\n                        _ = "SELECT hours FROM cal_task_hours";\n                        cmd.Parameters.AddWithValue("@u", uid);');
  assert.throws(() => H.omitsReportValues(bad), /cal_task_hours/);
});
test('변이 H3: 열람 조회가 할 일을 빼면(옛 최소 payload) P2 계약이 잡는다', () => {
  const bad = mutate(caldb, '["entries"] = entries, ["todos"] = todos,', '["entries"] = entries,');
  assert.throws(() => H.sendsScreenScope(bad), /반환 키가 계약/);
});
test('변이 H4: 열람 조회가 remind 를 싣는 변환(withRemind:true)을 쓰면 계약이 잡는다', () => {
  const bad = mutate(caldb, 'EntryRowToState(rd, Iso, withRemind: false)', 'EntryRowToState(rd, Iso, withRemind: true)');
  assert.throws(() => H.sharesBootMapping(bad), /withRemind:false/);
});

// ══════════════════════════════════════════════════════════════════════
// (W) 웹 정적 계약
// ══════════════════════════════════════════════════════════════════════
// <style> 본문(주석 제거)에서 규칙을 [선택자 목록, 선언] 으로 뽑는다.
function cssRules(src) {
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) out.push({ sel: m[1].trim(), decl: m[2] });
  return out;
}
const W = {
  //  P2 — 두 탭은 PEER 에서 감추지 않는다.
  tabsNotHidden(src) {
    for (const r of cssRules(src)) {
      if (!/display\s*:\s*none/.test(r.decl)) continue;
      for (const one of r.sel.split(',')) {
        assert.ok(!/body\[data-peer\][^,]*#dptab-(todo|git)\b/.test(one),
          `PEER 에서 ${one.trim()} 을(를) 감춘다 — 「할 일」·「커밋 내역」 탭은 열람 창에서도 보여야 한다(P2)`);
      }
    }
    for (const id of ['dptab-todo', 'dptab-git']) assert.ok(src.includes(`id="${id}"`), `#${id} 탭 마크업이 없다`);
  },
  //  P3 — 편집 수단은 감추고(CSS) 막는다(JS).
  editAffordancesGuarded(src) {
    const hidden = new Set();
    for (const r of cssRules(src)) {
      if (!/display\s*:\s*none\s*!important/.test(r.decl)) continue;
      for (const one of r.sel.split(',')) { const m = /^body\[data-peer\]\s+(\S+)$/.exec(one.trim()); if (m) hidden.add(m[1]); }
    }
    for (const sel of ['#btnAddHere', '#btnTodoNew', '#btnGitHere', '#btnGitBulk', '.todo-del', '.nd-cbtn', '.card-actions']) {
      assert.ok(hidden.has(sel), `PEER 에서 ${sel} 을(를) 감추지 않는다 — 열람 창에 편집 수단이 보인다(P3)`);
    }
    for (const fn of ['toggleTodo', 'updateTodo', 'deleteTodo', 'addTodo', 'setCommitSubject', 'setCommitMessage',
                      'setTodoText', 'setEntryTitle', 'deleteCommitRow']) {
      const body = extractFunction(src, fn);
      const g = body.indexOf('peerReadOnly()');
      assert.ok(g >= 0, `${fn} 에 PEER 관문(peerReadOnly)이 없다 — 열람 창에서 state 를 바꾼다`);
      for (const touch of ['save()', 'todoById(', 'entryById(', 'state.todos']) {
        const at = body.indexOf(touch);
        assert.ok(at < 0 || g < at, `${fn} 의 PEER 관문이 ${touch} 보다 뒤에 있다 — 바꾼 뒤에 막으면 늦다`);
      }
    }
    assert.ok(/if\(PEER\)\{ try\{ toast\('읽기 전용 보기입니다 — 여기서는 지울 수 없습니다'/.test(extractFunction(src, 'deleteEntry')),
      'deleteEntry 의 PEER 관문이 사라졌다');
    const pro = extractFunction(src, 'peerReadOnly');
    assert.ok(/if\(!PEER\) return false;/.test(pro) && /return true;/.test(pro), 'peerReadOnly 가 PEER 에서만 참이 아니다');
    //  렌더 — 할 일 행·커밋 행이 편집 버튼을 만들지 않는다.
    assert.ok(/const ro = PEER;/.test(extractFunction(src, 'todoRowHtml')), 'todoRowHtml 에 읽기 전용(PEER) 갈래가 없다');
    assert.ok(/const editable = r\.cidx >= 0 && !PEER;/.test(extractFunction(src, 'renderGitTab')), 'renderGitTab 이 PEER 에서도 커밋 수정·삭제 버튼을 만든다');
    assert.ok(/HOST && !PEER && gitEnabledCats\(\)/.test(extractFunction(src, 'renderGitTab')), 'renderGitTab 이 PEER 에서 커밋 불러오기 버튼을 만든다');
    //  끌기 — 칩은 draggable=false · dragstart 가 끊는다.
    assert.ok(/draggable="\$\{\(PEER\|\|mine\|\|kind==='recur'\)\?'false':'true'\}"/.test(extractFunction(src, 'chipHtml')), '일정 칩이 PEER 에서 끌린다');
    assert.ok(/draggable="\$\{PEER \? 'false' : 'true'\}"/.test(extractFunction(src, 'todoChipHtml')), '할 일 칩이 PEER 에서 끌린다');
    assert.ok(/grid\.addEventListener\('dragstart', ev => \{\n\s+if\(PEER\)\{ ev\.preventDefault\(\); return; \}/.test(src), 'dragstart 가 PEER 를 먼저 끊지 않는다');
  },
  //  P4 — 밀도: 열람 창은 자기 키 · 기본 펼침 · 띠에 전환.
  densitySeparated(src) {
    assert.ok(/function calDensityKey\(\)\{ return PEER \? 'tc_peerDensity' : 'tc_calDensity'; \}/.test(src),
      '밀도 키가 PEER 에서 따로가 아니다 — iframe 은 localStorage 를 부모와 함께 쓴다(내 화면 밀도를 덮는다)');
    assert.ok(/function calDensityDefault\(\)\{ return PEER \? 'expand' : 'fixed'; \}/.test(src), '열람 창 기본 밀도가 펼침이 아니다(P4)');
    for (const fn of ['calDensity', 'setCalDensity']) {
      const b = extractFunction(src, fn);
      assert.ok(b.includes('calDensityKey()'), `${fn} 가 calDensityKey() 를 거치지 않는다`);
      assert.ok(!/'tc_calDensity'/.test(b), `${fn} 가 내 화면 키(tc_calDensity)를 직접 쓴다`);
    }
    const h = extractFunction(src, 'peerDensityHtml');
    for (const v of ['fixed', 'dense', 'expand']) assert.ok(h.includes(`'${v}'`), `밀도 전환에 ${v} 가 없다`);
    assert.ok(/name="peerDensity"/.test(h) && /class="check"/.test(h), '밀도 전환이 띠의 .check 라디오 관례가 아니다');
    assert.ok(/\+ peerDensityHtml\(\);/.test(src), '열람 띠(#peerBanner)에 밀도 전환이 붙지 않는다');
  },
  //  P5 — 모달이 크다.
  modalLarge(src) {
    const r = cssRules(src);
    const modal = r.find((x) => x.sel === '#peerModal .modal');
    assert.ok(modal && /width:min\(1400px, 100%\)/.test(modal.decl) && /98vh/.test(modal.decl), '#peerModal 이 크지 않다(P5): ' + (modal && modal.decl));
    const body = r.find((x) => x.sel === '#peerModal .modal-body');
    assert.ok(body && /flex:1 1 auto/.test(body.decl) && /min-height:0/.test(body.decl), '#peerModal 본문이 남은 높이를 받지 않는다');
    assert.ok(r.some((x) => x.sel === '#peerModal :is(.pv-frame, .pv-skeleton)' && /flex:1 1 auto/.test(x.decl)), 'iframe 이 모달 본문을 채우지 않는다');
  },
  //  P1 — 그리드 클릭은 공유 처리 하나다(PEER 전용 길이 없다).
  gridClickShared(src) {
    const a = src.indexOf("grid.addEventListener('click', ev => {");
    const b = src.indexOf("grid.addEventListener('dblclick'", a);
    assert.ok(a >= 0 && b > a, '그리드 클릭 처리를 찾지 못했다');
    const h = src.slice(a, b);
    assert.ok(!/PEER/.test(h), '그리드 클릭에 PEER 전용 갈래가 생겼다 — 열람 창이 기간 칩 수정(BUG-RANGE-CHIP-CLICK)을 우회한다');
    assert.ok(/const chipDs = cellDs \|\| chip\.dataset\.occ \|\| selectedDate;/.test(h), '칩 클릭이 누른 칸의 날짜를 쓰지 않는다');
  },
  //  P6 — 내 겹은 일정만 · 상대 할 일은 받은 그대로.
  overlayEntriesOnly(src) {
    const m = extractFunction(src, 'mountPeerFrame');
    assert.ok(m.includes('todos: res.todos || []'), '부모가 받은 할 일을 열람 창에 넣지 않는다(P2)');
    assert.ok(!/state\.todos|state\.taskHours|state\.attendance|state\.rooms/.test(m), '부모가 **내** 할 일·시간·근태·회의실을 열람 창에 보낸다(P6)');
    assert.ok(m.includes('.concat(buildMineOverlay(state.entries))'), '내 겹이 일정(state.entries)에서만 만들어지지 않는다');
  },
};
test('(W) P2: 「할 일」·「커밋 내역」 탭은 PEER 에서 감추지 않는다', () => W.tabsNotHidden(app));
test('(W) P3: 편집 수단은 CSS 로 감추고 변경 함수는 PEER 관문으로 먼저 끊는다(Q6)', () => W.editAffordancesGuarded(app));
test('(W) P4: 밀도 — 열람 창 전용 키 · 기본 펼침 · 띠의 전환(고정/촘촘히/펼침)', () => W.densitySeparated(app));
test('(W) P5: 열람 모달은 위젯 창에 맞게 크고 iframe 이 본문을 채운다', () => W.modalLarge(app));
test('(W) P1: 그리드 클릭은 PEER 전용 길 없이 공유 처리(누른 칸의 날짜)를 쓴다', () => W.gridClickShared(app));
test('(W) P6: 내 겹은 일정만 · 상대 할 일은 받은 그대로 넣는다', () => W.overlayEntriesOnly(app));

// ── (M) 웹 정적 변이 ────────────────────────────────────────────────────
test('변이 W1: PEER 에서 할 일 탭을 다시 감추면 탭 계약이 잡는다', () => {
  const bad = mutate(app, 'body[data-peer] #btnAddHere,\n', 'body[data-peer] #btnAddHere,\nbody[data-peer] #dptab-todo,\n');
  assert.throws(() => W.tabsNotHidden(bad), /#dptab-todo/);
});
test('변이 W2: PEER 할 일 체크(toggleTodo)의 관문을 빼면 편집 계약이 잡는다', () => {
  const bad = mutate(app, 'function toggleTodo(id){ if(peerReadOnly()) return; ', 'function toggleTodo(id){ ');
  assert.throws(() => W.editAffordancesGuarded(bad), /toggleTodo 에 PEER 관문/);
});
test('변이 W3: 밀도가 내 화면 키를 함께 쓰면 밀도 계약이 잡는다', () => {
  const bad = mutate(app, "function calDensityKey(){ return PEER ? 'tc_peerDensity' : 'tc_calDensity'; }",
                          "function calDensityKey(){ return 'tc_calDensity'; }");
  assert.throws(() => W.densitySeparated(bad), /밀도 키가 PEER 에서 따로가 아니다/);
});
test('변이 W4: 그리드 클릭에 PEER 전용 갈래를 넣으면 P1 계약이 잡는다', () => {
  const bad = mutate(app, "      const chipDs = cellDs || chip.dataset.occ || selectedDate;\n",
                          "      const chipDs = PEER ? chip.dataset.occ : (cellDs || chip.dataset.occ || selectedDate);\n      const _keep = 'const chipDs = cellDs || chip.dataset.occ || selectedDate;';\n");
  assert.throws(() => W.gridClickShared(bad), /PEER 전용 갈래/);
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom 실행
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('peer-view-full: jsdom 미설치 — 열람 창 실행 계약(할 일·커밋 렌더 · 밀도 · 기간 칩 클릭 · 편집 차단)을 돌리지 못했다',
       SKIP_NO_JSDOM, `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  //  부팅 옵션은 팩토리 하나에서만 — peer-overlay.test.mjs 와 같은 모양(WebView2 는 iframe 에도 chrome.webview 를 넣는다).
  const bootOpts = (url, posted) => ({
    runScripts: 'dangerously', pretendToBeVisual: true, url,
    beforeParse(window) {
      window.chrome = { webview: { postMessage: (s) => posted.push(String(s)), addEventListener() {}, removeEventListener() {} } };
      if (typeof window.crypto === 'undefined') {
        window.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
      }
      window.scrollTo = () => {};
      //  jsdom 에는 scrollIntoView 가 없다 — 칩 클릭(드러내기)이 카드로 스크롤하는 자리에서 터지지 않게.
      window.HTMLElement.prototype.scrollIntoView = function () {};
      //  CSS.escape 도 없다 — 강조(flash) 해제 타이머가 그것으로 카드를 찾는다.
      if (!window.CSS) window.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
    },
  });
  const PEER_URL = 'https://tcapp.local/?peer=1';
  const MAIN_URL = 'https://tcapp.local/';
  function boot(src, url) {
    const posted = [];
    const dom = new JSDOM(src, bootOpts(url, posted));
    const w = dom.window;
    return {
      w, posted,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      close: () => { try { w.close(); } catch (_) {} },
    };
  }
  const settle = () => new Promise((r) => setTimeout(r, 60));

  //  ── 픽스처 — 호스트 payload 모양 그대로(H 계약이 지키는 키) ──────────────
  //    10월: 9/29~10/2 기간 일정(P1) · 10/1 시간 일정(장소·메모) · 10/1 작업일지(커밋) · 10/15 일정 15건(+N 유발).
  const CATS = [
    { id: 'c-A', name: '설계 검토', color: '#c0392b' },
    { id: 'c-B', name: '공식 과제', color: '#2980b9', source: 'db', dbGone: false },
  ];
  const E = (o) => Object.assign({ categoryId: 'c-A', allDay: false, startTime: '', endTime: '', hours: null,
    location: '', memo: '', source: '', commits: [], endDate: '', recur: null, recurExcept: [],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }, o);
  const ENTRIES = [
    E({ id: 'e-r1', date: '2026-09-29', endDate: '2026-10-02', allDay: true, title: '상대: 통합시험 기간' }),
    E({ id: 'e-t1', date: '2026-10-01', startTime: '09:00', endTime: '10:00', title: '상대: 설계회의',
        location: '3층 소회의실', memo: '안건 정리 메모' }),
    E({ id: 'e-g1', date: '2026-10-01', source: 'git', categoryId: 'c-B', title: '커밋 기록',
        commits: [{ hash: 'abc1234def', short: 'abc1234', time: '14:05', subject: 'fix: 열람 커밋 제목', body: '' }] }),
  ];
  for (let i = 0; i < 15; i++) ENTRIES.push(E({ id: 'e-b' + i, date: '2026-10-15', title: '상대: 바쁜 날 ' + i }));
  const TODOS = [
    { id: 't-1', text: '상대: 보고서 초안', done: false, categoryId: 'c-A', due: '2026-10-01', endDate: '', prio: 'high',
      completedAt: '', note: '초안 비고', dayNotes: {}, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 't-2', text: '상대: 끝낸 일', done: true, categoryId: 'c-B', due: '2026-10-01', endDate: '', prio: 'normal',
      completedAt: '2026-10-01T03:00:00.000Z', note: '', dayNotes: {}, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-01T03:00:00.000Z' },
  ];
  //  부모(mountPeerFrame)가 iframe 에 넣는 모양 — 호스트 payload + 빈 보고서 값.
  const DATA = { categories: CATS, entries: ENTRIES, todos: TODOS, rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  function inject(m) {
    m.ev('view = {y:2026, m:9}; selectedDate = "2026-10-01";');
    m.w.__applyState(JSON.stringify(DATA), { peerName: '홍길동', canWrite: false });
  }
  //  save() → peerRevert 가 몇 번 불렸나 — "바꾼 뒤 되돌린다" 와 "바꾸기 전에 끊는다" 를 가른다.
  function spyRevert(m) {
    m.ev('window.__rv = 0; (function(){ var o = peerRevert; peerRevert = function(){ window.__rv++; return o.apply(this, arguments); }; })();');
  }
  const rv = (m) => m.ev('window.__rv');

  let P = null, bootErr = null;
  try { P = boot(app, PEER_URL); } catch (e) { bootErr = e; }

  if (bootErr) {
    test('peer-view-full: jsdom 부팅 실패(조사 필요)', () => { throw bootErr; });
  } else {
    test('R 부팅: 열람 창(PEER)에 호스트 payload 모양을 넣으면 할 일·커밋·일정이 그대로 선다', async () => {
      await settle();
      P.ev('localStorage.setItem("tc_calDensity","fixed");');   // 내 화면 밀도 — 아래 시험이 「안 바뀜」을 본다
      inject(P);
      await settle();
      assert.strictEqual(P.ev('PEER'), true);
      assert.strictEqual(P.ev('state.todos.length'), 2, '할 일이 state 에 안 들어왔다');
      assert.strictEqual(P.ev('state.entries.find(function(e){return e.id==="e-g1";}).commits.length'), 1);
      assert.deepStrictEqual(P.posted, [], '열람 창이 호스트로 무언가 보냈다');
    });

    test('R P2: 「할 일」·「커밋 내역」 탭이 보인다(감추지 않는다)', () => {
      for (const id of ['dptab-todo', 'dptab-git']) {
        const disp = P.ev(`getComputedStyle(document.getElementById("${id}")).display`);
        assert.notStrictEqual(disp, 'none', `#${id} 가 열람 창에서 감춰져 있다`);
      }
    });

    test('R P2/Q3: 일정 상세 카드에 시간·장소·메모가 보이고 수정·삭제는 감춰진다', () => {
      P.ev('setPanelTab("detail");');
      const t = P.ev('document.getElementById("dpBody").textContent');
      for (const s of ['상대: 설계회의', '3층 소회의실', '안건 정리 메모', '09:00']) assert.ok(t.includes(s), `상세 카드에 '${s}' 가 없다`);
      assert.strictEqual(P.ev('getComputedStyle(document.querySelector("#dpBody .card .card-actions")).display'), 'none',
        '카드의 수정·삭제가 열람 창에 보인다');
    });

    test('R P2/Q2: 「할 일」 탭이 그 사람의 할 일을 내 화면과 같은 규칙(이 날 · 이 날 완료)으로 읽기 전용으로 그린다', () => {
      //  「이 날 완료」는 기본 접힘(noteCollapsed — 내 화면과 같다). 행까지 보려고 편다(보기 상태일 뿐이다).
      P.ev('noteCollapsed.delete("done"); setPanelTab("todo");');
      const body = 'document.getElementById("dpBody")';
      const t = P.ev(body + '.textContent');
      for (const s of ['상대: 보고서 초안', '초안 비고', '상대: 끝낸 일', '이 날', '이 날 완료']) assert.ok(t.includes(s), `할 일 탭에 '${s}' 가 없다`);
      assert.strictEqual(P.ev(body + '.querySelectorAll(".todo-row").length'), 2);
      //  편집 수단이 없다 — 체크 버튼·삭제·추가·편집 진입(data-act) 전부.
      assert.strictEqual(P.ev(body + '.querySelectorAll("[data-act=toggle],[data-act=del],[data-act=star],[data-act=edit]").length'), 0,
        '열람 창 할 일 행에 편집 동작(data-act)이 남아 있다');
      assert.strictEqual(P.ev(body + '.querySelectorAll("button.todo-check, .todo-del, #btnTodoNew").length'), 0, '체크 버튼·삭제·추가 버튼이 그려졌다');
      //  상태는 보인다 — 완료 표시·중요 별.
      assert.strictEqual(P.ev(body + '.querySelectorAll("span.todo-check").length'), 2, '완료 상태 표시가 없다');
      assert.strictEqual(P.ev(body + '.querySelectorAll(".todo-row.done").length'), 1);
      assert.strictEqual(P.ev(body + '.querySelectorAll("span.todo-star-btn.on").length'), 1, '중요 표시(별)가 안 보인다');
    });

    test('R P2/Q2: 「커밋 내역」 탭이 그 사람의 커밋을 그리고 수정·삭제·불러오기 버튼은 없다', () => {
      P.ev('setPanelTab("git");');
      const t = P.ev('document.getElementById("dpBody").textContent');
      for (const s of ['fix: 열람 커밋 제목', '14:05', 'abc1234', '공식 과제']) assert.ok(t.includes(s), `커밋 내역 탭에 '${s}' 가 없다`);
      assert.strictEqual(P.ev('document.querySelectorAll("#dpBody .nd-commit").length'), 1);
      assert.strictEqual(P.ev('document.querySelectorAll("#dpBody .nd-cbtn, #btnGitHere, #btnGitBulk").length'), 0,
        '열람 창에 커밋 수정·삭제·불러오기 버튼이 그려졌다');
    });

    test('R P2: 그리드에 할 일 칩이 그려지고 모든 칩이 draggable=false 다(끌기 없음)', () => {
      P.ev('setPanelTab("detail");');
      assert.ok(P.ev('document.querySelectorAll("#grid .chip.chip-todo").length') >= 2, '그리드에 할 일 칩이 없다');
      const drag = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#grid .chip"), function(c){return c.getAttribute("draggable");})');
      assert.ok(drag.length > 0 && drag.every((d) => d === 'false'), '끌 수 있는 칩이 있다: ' + JSON.stringify([...new Set(drag)]));
      const prevented = P.ev('(function(){ var c = document.querySelector("#grid .chip"); var e = new Event("dragstart", {bubbles:true, cancelable:true}); c.dispatchEvent(e); return e.defaultPrevented; })()');
      assert.strictEqual(prevented, true, 'dragstart 가 열람 창에서 끊기지 않는다');
    });

    test('R P4/Q5: 기본 밀도는 「펼침」 — 격자가 expand 이고 바쁜 날(15건)에 「+N」 이 없다', () => {
      assert.strictEqual(P.ev('calDensity()'), 'expand');
      assert.strictEqual(P.ev('document.getElementById("grid").classList.contains("expand")'), true);
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .cell[data-date=\\"2026-10-15\\"] .chip").length'), 15,
        '펼침인데 바쁜 날 칩이 다 그려지지 않았다');
      assert.strictEqual(P.ev('document.querySelector("#grid .cell[data-date=\\"2026-10-15\\"] .chips").dataset.extra'), '0');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .more").length'), 0, '펼침인데 「+N」 이 있다');
    });

    test('R P4: 열람 띠에 밀도 전환(고정/촘촘히/펼침)이 있고 처음엔 「펼침」 이 골라져 있다', () => {
      const b = P.ev('document.getElementById("peerBanner").textContent');
      for (const s of ['밀도', '고정', '촘촘히', '펼침']) assert.ok(b.includes(s), `열람 띠에 '${s}' 가 없다: ` + b);
      assert.deepStrictEqual(P.evJSON('Array.prototype.map.call(document.querySelectorAll("#peerBanner input[name=peerDensity]"), function(r){return r.value + (r.checked ? "*" : "");})'),
        ['fixed', 'dense', 'expand*']);
    });

    test('R P4/Q5: 띠에서 밀도를 바꾸면 열람 창 키(tc_peerDensity)에만 남고 내 화면 밀도(tc_calDensity)는 그대로다', () => {
      const r = 'document.querySelector("#peerBanner input[name=peerDensity][value=fixed]")';
      P.ev(r + '.checked = true; ' + r + '.dispatchEvent(new Event("change"));');
      assert.strictEqual(P.ev('localStorage.getItem("tc_peerDensity")'), 'fixed');
      assert.strictEqual(P.ev('localStorage.getItem("tc_calDensity")'), 'fixed', '내 화면 밀도가 바뀌었다(사전값 fixed)');
      assert.strictEqual(P.ev('document.getElementById("grid").classList.contains("expand")'), false);
      const d = 'document.querySelector("#peerBanner input[name=peerDensity][value=dense]")';
      P.ev(d + '.checked = true; ' + d + '.dispatchEvent(new Event("change"));');
      assert.strictEqual(P.ev('localStorage.getItem("tc_peerDensity")'), 'dense');
      assert.strictEqual(P.ev('localStorage.getItem("tc_calDensity")'), 'fixed', '열람 창 밀도가 내 화면 키를 덮었다');
      assert.strictEqual(P.ev('document.getElementById("grid").classList.contains("dense")'), true);
      P.ev('setCalDensity("expand");');   // 원상 — 아래 시험은 펼침 기준
      assert.strictEqual(P.ev('document.querySelector("#peerBanner input[name=peerDensity][value=expand]").checked'), true,
        '코드로 바꾼 밀도가 띠 라디오에 반영되지 않는다');
    });

    test('R P1/Q1: 10월 달력에서 9/29~10/2 기간 칩을 10/1 칸에서 누르면 10월 유지 · 선택 10/1', () => {
      P.ev('view = {y:2026, m:9}; selectedDate = "2026-10-03"; renderAll();');
      const has = P.ev('!!document.querySelector("#grid .cell[data-date=\\"2026-10-01\\"] .chip[data-id=\\"e-r1\\"]")');
      assert.ok(has, '사전조건: 10/1 칸에 기간 칩이 있어야 한다');
      assert.strictEqual(P.ev('document.querySelector("#grid .cell[data-date=\\"2026-10-01\\"] .chip[data-id=\\"e-r1\\"]").dataset.occ'), '2026-09-29',
        '사전조건: 칩의 data-occ 는 시작일(9/29)이다 — 그래서 이 시험이 의미가 있다');
      P.ev('document.querySelector("#grid .cell[data-date=\\"2026-10-01\\"] .chip[data-id=\\"e-r1\\"]").click();');
      assert.strictEqual(P.ev('view.m'), 9, '열람 창에서 기간 칩을 눌렀더니 달이 바뀌었다');
      assert.strictEqual(P.ev('selectedDate'), '2026-10-01');
    });

    test('R P3/Q6: 할 일·커밋·줄편집 함수는 열람 창에서 state 를 바꾸기 **전에** 끊는다(save() 까지 가지 않는다)', async () => {
      spyRevert(P);
      const before = P.ev('JSON.stringify({t:state.todos, e:state.entries})');
      const calls = [
        'toggleTodo("t-1")', 'updateTodo("t-1", {text:"침입"})', 'deleteTodo("t-1")', 'addTodo("침입 할일")',
        'setTodoText("t-1", "침입")', 'setEntryTitle("e-t1", "침입")',
        'setCommitSubject("e-g1", "abc1234def", 0, "침입")', 'setCommitMessage("e-g1", "abc1234def", 0, "침입")',
        'deleteCommitRow("e-g1", "abc1234def", 0)', 'deleteEntry("e-t1")',
      ];
      for (const c of calls) {
        P.ev('try{ ' + c + '; }catch(_){}');
        assert.strictEqual(rv(P), 0, `${c} 가 save() 까지 갔다 — state 를 먼저 바꾸고 되돌리는 깜빡임이 난다`);
      }
      assert.strictEqual(P.ev('JSON.stringify({t:state.todos, e:state.entries})'), before, '열람 창의 state 가 바뀌었다');
      //  화면 조작으로도 — 할 일 행·커밋 행을 눌러 본다.
      P.ev('setPanelTab("todo");');
      P.ev('Array.prototype.forEach.call(document.querySelectorAll("#dpBody .todo-row *"), function(el){ el.dispatchEvent(new MouseEvent("click", {bubbles:true})); });');
      P.ev('setPanelTab("git");');
      P.ev('Array.prototype.forEach.call(document.querySelectorAll("#dpBody .nd-commit *"), function(el){ el.dispatchEvent(new MouseEvent("click", {bubbles:true})); });');
      await settle();
      assert.strictEqual(rv(P), 0, '열람 창 할 일·커밋 행을 눌렀더니 save() 가 돌았다');
      assert.strictEqual(P.ev('JSON.stringify({t:state.todos, e:state.entries})'), before);
      assert.strictEqual(P.ev('document.querySelectorAll("#dpBody .todo-edit, #dpBody .nd-cedit").length'), 0, '편집기가 열렸다');
      assert.deepStrictEqual(P.posted, [], '편집 시도 끝에 호스트로 메시지가 나갔다');
      P.ev('setPanelTab("detail");');
    });

    //  ── 통제군 — 같은 스텁에서 내 창은 밀도 기본 고정 · 열람 키를 안 읽는다 · 할 일 체크가 실제로 save 한다 ──
    test('C 통제군: 내 창(PEER 아님)의 밀도는 tc_calDensity 기준 · 기본 「고정」 — 열람 키를 안 읽는다', async () => {
      const C = boot(app, MAIN_URL);
      try {
        await settle();
        assert.strictEqual(C.ev('PEER'), false);
        assert.strictEqual(C.ev('calDensity()'), 'fixed');
        C.ev('localStorage.setItem("tc_peerDensity","expand");');
        assert.strictEqual(C.ev('calDensity()'), 'fixed', '내 창이 열람 창 밀도 키를 읽는다');
        C.ev('setCalDensity("dense");');
        assert.strictEqual(C.ev('localStorage.getItem("tc_calDensity")'), 'dense');
        assert.strictEqual(C.ev('localStorage.getItem("tc_peerDensity")'), 'expand', '내 창이 열람 창 밀도 키를 덮었다');
        assert.strictEqual(C.ev('peerReadOnly()'), false, '내 창에서 peerReadOnly 가 참이다 — 내 편집이 막힌다');
      } finally { C.close(); }
    });

    // ── (M) 실행 변이 ─────────────────────────────────────────────────────
    async function withMutated(find, repl, fn) {
      const m = boot(mutate(app, find, repl), PEER_URL);
      try { await settle(); return await fn(m); } finally { m.close(); }
    }

    test('변이 R1: toggleTodo 의 PEER 관문을 빼면 「save() 까지 가지 않는다」 계약이 잡는다', async () => {
      await withMutated('function toggleTodo(id){ if(peerReadOnly()) return; ', 'function toggleTodo(id){ ', async (m) => {
        inject(m); await settle(); spyRevert(m);
        m.ev('toggleTodo("t-1");');
        assert.ok(rv(m) > 0, '변이했는데도 save() 까지 가지 않는다 — 변이가 체크 경로에 닿지 않았다(앵커 재검토)');
      });
    });

    test('변이 R2: 밀도가 내 화면 키를 함께 쓰면 「내 화면 밀도 불변」 계약이 잡는다', async () => {
      await withMutated("function calDensityKey(){ return PEER ? 'tc_peerDensity' : 'tc_calDensity'; }",
                        "function calDensityKey(){ return 'tc_calDensity'; }", async (m) => {
        m.ev('localStorage.setItem("tc_calDensity","fixed");');
        inject(m); await settle();
        assert.notStrictEqual(m.ev('calDensity()'), 'expand', '변이 앱인데 기본이 펼침이다 — 변이가 키 선택에 닿지 않았다');
        m.ev('setCalDensity("dense");');
        assert.strictEqual(m.ev('localStorage.getItem("tc_calDensity")'), 'dense',
          '변이했는데도 내 화면 키가 안 바뀐다 — 「불변」 계약이 이 변이를 잡는다는 증명이 안 된다');
      });
    });

    test('변이 R3: PEER 에서 할 일 탭을 다시 감추면 탭이 실제로 사라진다(실행 계약이 잡는다)', async () => {
      await withMutated('body[data-peer] #btnAddHere,\n', 'body[data-peer] #btnAddHere,\nbody[data-peer] #dptab-todo,\n', async (m) => {
        inject(m); await settle();
        assert.strictEqual(m.ev('getComputedStyle(document.getElementById("dptab-todo")).display'), 'none',
          '변이했는데도 할 일 탭이 보인다 — jsdom 이 이 규칙을 계산하지 못하면 R P2 는 정적 계약(W1)에만 기댄다');
      });
    });

    test('peer-view-full: 뒷정리(창 닫기)', () => { P.close(); });
  }
}
