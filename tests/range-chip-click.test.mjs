// 버그 — 기간 칩을 누르면 달이 바뀐다(docs/BUG-RANGE-CHIP-CLICK.md — B1~B5 · 수용 K1~K7)의 웹 쪽 계약.
//
// 이 파일이 지키는 것:
//   ① 그리드 칩 클릭은 **누른 칸의 날짜**를 고른다(B1). 칩의 data-occ 는 그 발생의 시작일이라 기간 막대의
//      다른 칸에서 누르면 시작일 달로 넘어갔다 — 10월 달력의 10/1 칸에서 9/29~10/2 막대를 누르면 9월로.
//   ② 드러내기는 그대로(B2) — 일정 칩 → 「일정 상세」 탭 + 그 카드 강조, 할 일 칩 → 「할 일」 탭 + 그 행 강조.
//      고른 날짜(시작일이 아닌 날)에서도 그 카드·행이 **실제로 목록에 있다**.
//   ③ 흐린 칸(다른 달)은 누른 칸 기준으로 그 달로 넘어간다(B3) · 칸 밖 칩은 data-occ 로 대체(B4).
//   ④ 끌어 옮기기는 계속 data-occ(시작일) 기준이다(B5·K6).
//
// 검사 함수를 테스트와 변이 시험이 공유한다 — 검사가 정말 잡는지 같은 함수를 변이된 소스에 다시 돌려 증명한다.
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}
// JS 주석 제거(문자열·템플릿 리터럴은 보존) — 계약이 보는 것은 코드지 설명 글자가 아니다.
function stripJs(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === c) { j++; break; } j++; }
      out += s.slice(i, j); i = j; continue;
    }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
//  배선 구간 — 시작 앵커부터 끝 앵커 직전까지(주석 제거).
function slice(app, from, to) {
  const i = app.indexOf(from);
  assert.ok(i > 0, `앵커를 찾지 못했다: ${from}`);
  const j = app.indexOf(to, i + from.length);
  assert.ok(j > i, `끝 앵커를 찾지 못했다: ${to}`);
  return stripJs(app.slice(i, j));
}

//  변이 — 각각 '되돌아가면 안 되는 판'을 만든다.
const MUT = {
  //  data-occ(시작일)를 누른 칸보다 먼저 쓴다 — 버그 판(B1 위반)
  occFirst: (s) => mutate(
    'const chipDs = cellDs || chip.dataset.occ || selectedDate;',
    'const chipDs = chip.dataset.occ || cellDs || selectedDate;',
    s),
  //  할 일 칩이 접힌 「이 날」 섹션을 펴지 않는다(B2 — 행이 안 보인다)
  noOndayOpen: (s) => mutate(
    "if(td && td.done) noteCollapsed.delete('done'); else noteCollapsed.delete('onday');",
    "if(td && td.done) noteCollapsed.delete('done');",
    s),
};

/* ── 정적 계약(jsdom 불필요) ─────────────────────────────────────────── */

const CLICK_FROM = "grid.addEventListener('click', ev => {";
const CLICK_TO = "grid.addEventListener('dblclick'";

const statics = {
  //  클릭 처리: 누른 칸(chip.closest('.cell'))의 날짜를 data-occ 보다 먼저 쓴다 · 두 갈래(할 일·일정) 모두 그 값을 쓴다
  clickUsesCell(app) {
    const b = slice(app, CLICK_FROM, CLICK_TO);
    const ic = b.indexOf("chip.closest('.cell')");
    assert.ok(ic > 0, "칩 클릭이 누른 칸(chip.closest('.cell'))을 찾지 않는다(B1)");
    const m = /const chipDs = ([^;]+);/.exec(b);
    assert.ok(m, '칩 클릭의 선택 날짜(chipDs)를 한 곳에서 정하지 않는다');
    const parts = m[1].split('||').map((x) => x.trim());
    assert.deepStrictEqual(parts, ['cellDs', 'chip.dataset.occ', 'selectedDate'],
      '선택 날짜의 우선순위가 「누른 칸 → data-occ → 현재 선택」이 아니다(B1·B4): ' + m[1]);
    assert.ok(ic < b.indexOf('chip.dataset.occ'), '누른 칸보다 data-occ 를 먼저 본다(B1)');
    assert.ok(!/selectDate\(\s*chip\.dataset\.occ/.test(b), '칩 클릭이 아직 data-occ(시작일)로 날짜를 고른다(B1)');
    assert.strictEqual((b.match(/selectDate\(chipDs\)/g) || []).length, 2, '할 일 칩·일정 칩 두 갈래가 모두 chipDs 로 고르지 않는다');
    //  드러내기(B2)는 그대로
    assert.ok(/noteTab = 'todo';\s*flashTodoId = chip\.dataset\.todo;/.test(b), '할 일 칩의 드러내기(할 일 탭 + 행 강조)가 사라졌다(B2)');
    assert.ok(/noteTab = 'detail';\s*flashTargetId = chip\.dataset\.id;/.test(b), '일정 칩의 드러내기(상세 탭 + 카드 강조)가 사라졌다(B2)');
  },
  //  끌어 옮기기는 data-occ 그대로(B5)
  dragUsesOcc(app) {
    const ds = slice(app, "grid.addEventListener('dragstart', ev => {", "grid.addEventListener('dragover'");
    assert.ok(ds.includes('occ:chip.dataset.occ'), '끌기 시작이 data-occ(시작일)를 싣지 않는다(B5)');
    assert.ok(!ds.includes(".closest('.cell')"), '끌기 시작이 누른 칸을 본다 — 시작일 기준 이동이 깨진다(B5)');
    const dr = slice(app, "grid.addEventListener('drop', ev => {", '/* 날짜 패널 */');
    assert.ok(dr.includes('diffDays(p.occ || e.date, target)'), '기간 일정 드롭이 data-occ(시작일) 기준 이동이 아니다(B5)');
  },
  //  패널 의미 — 상세 탭은 그날에 걸친 발생을, 할 일 탭은 그날을 덮는 할 일을 보인다(시작일만 보이지 않는다 · B2 의 전제)
  panelsCoverRange(app) {
    const dd = stripJs(extractFunction(app, 'dayDetailHtml'));
    assert.ok(/entriesOn\(selectedDate\)/.test(dd), '일정 상세가 entriesOn(selectedDate)(그날에 걸친 발생)를 쓰지 않는다');
    const tl = stripJs(extractFunction(app, 'renderTodoListTab'));
    assert.ok(/const covers = t => t\.due && t\.due <= ds && /.test(tl), '할 일 탭의 「이 날」이 기간을 덮는 판정(covers)이 아니다');
  },
};

test('정적①: 칩 클릭은 누른 칸의 날짜 → data-occ → 현재 선택 순으로 고르고, 드러내기는 그대로(B1·B2·B4)', () => statics.clickUsesCell(src));
test('정적②: 끌어 옮기기는 계속 data-occ(시작일) 기준(B5)', () => statics.dragUsesOcc(src));
test('정적③: 상세 탭·할 일 탭은 그날에 걸친 기간 항목을 보인다(B2 의 전제)', () => statics.panelsCoverRange(src));
test('변이①s: data-occ 를 먼저 쓰면 정적① 이 실패한다', () => {
  assert.throws(() => statics.clickUsesCell(MUT.occFirst(src)), /우선순위|먼저 본다/);
});

/* ── 행동 — jsdom 위젯 모드 ──────────────────────────────────────────── */

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('range-chip-click: jsdom 미설치 — 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const ENT = (id, date, extra) => Object.assign({ id, date, title: '업무 ' + id, categoryId: 'c-a', allDay: true, startTime: '', endTime: '',
    memo: '', location: '', source: '', commits: [], createdAt: CA, updatedAt: CA }, extra || {});
  const TODO = (id, due, extra) => Object.assign({ id, text: '할 일 ' + id, done: false, categoryId: 'c-a', due, endDate: '',
    prio: 'normal', createdAt: CA }, extra || {});
  const DATA = {
    categories: [{ id: 'c-a', name: '알파', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
    entries: [
      ENT('e-r', '2026-09-29', { endDate: '2026-10-02', title: '프로젝트 포팅 진행 중' }),   // 기간(9/29~10/2)
      ENT('e-s', '2026-10-07', { title: '단일일 회의' }),                                    // 단일일
      ENT('e-w', '2026-09-03', { title: '주간 점검', recur: { freq: 'weekly', interval: 1 } }), // 매주 목요일
    ],
    todos: [
      TODO('t-r', '2026-09-29', { endDate: '2026-10-02', text: '포팅 체크리스트' }),          // 기간 할 일
    ],
    rooms: ['201호'],
  };

  function boot(source) {
    const log = [];
    const handlers = { saveState: { ok: true } };
    const dom = new JSDOM(source, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://tcapp.local/',
      virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} log.push({ post: o && o.cmd, msg: o }); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') {
          win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        }
        win.scrollTo = () => {};
        //  시계는 멈춰 둔다 — 강조(flash) 해제 타이머·토스트 타이머가 시험 중에 끼어들지 않게.
        win.setTimeout = () => 0;
        win.clearTimeout = () => {};
      },
    });
    const w = dom.window;
    w.__fakeReply = (cmd, params) => {
      log.push({ req: cmd, params });
      const h = handlers[cmd];
      const r = typeof h === 'function' ? h(params) : h;
      return (r && typeof r.then === 'function') ? r : Promise.resolve(r === undefined ? { ok: false, error: 'no handler' } : r);
    };
    w.eval('hostRequest = function(cmd, params){ return window.__fakeReply(cmd, params || {}); };');
    const sess = log.find((x) => x.post === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'hjlee', name: '이현진' } }) + ')');
    const doc = w.document;
    return {
      w, log, doc,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      applyState: (data) => w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(META) + ')'),
      //  보고 있는 달·선택 날짜를 정한다(오늘 날짜에 기대지 않는다). 패널은 상세 탭에서 시작.
      show: (y, m, sel) => w.eval(`view = {y:${y}, m:${m}}; selectedDate = '${sel}'; focusDs = null; noteTab = 'detail'; renderAll();`),
      view: () => JSON.parse(w.eval('JSON.stringify(view)')),
      sel: () => w.eval('selectedDate'),
      tab: () => w.eval('noteTab'),
      title: () => doc.getElementById('btnTitle').textContent,
      evChip: (date, id) => doc.querySelector(`#grid .cell[data-date="${date}"] .chip[data-id="${id}"]`),
      todoChip: (date, id) => doc.querySelector(`#grid .cell[data-date="${date}"] .chip[data-todo="${id}"]`),
      card: (id) => doc.querySelector(`#dpBody .card[data-id="${id}"]`),
      todoRow: (id) => doc.querySelector(`#dpBody .todo-row[data-id="${id}"]`),
      selCells: () => [...doc.querySelectorAll('#grid .cell.sel')].map((c) => c.dataset.date),
      close: () => { try { w.close(); } catch (_) {} },
    };
  }
  async function withBoot(source, fn) {
    const W = boot(source);
    try {
      W.applyState(DATA);
      await settle();
      return await fn(W);
    } finally { W.close(); }
  }
  //  누른다 = 칩 안쪽 글자를 클릭(사람이 막대를 누를 때처럼 이벤트가 칩 → 칸 → 그리드로 올라간다).
  function press(el, what) {
    assert.ok(el, `${what} 이(가) 그리드에 없다(시드·렌더 문제)`);
    el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  const V = (y, m) => ({ y, m });

  const checks = {
    //  K1 — 10월 달력, 기간 일정의 10/1 칸 막대 → 달 그대로 · 선택 10/1 · 상세 탭에 그 카드 강조
    async k1(source) {
      await withBoot(source, async (W) => {
        W.show(2026, 9, '2026-10-15');
        assert.ok(W.evChip('2026-09-29', 'e-r') && W.evChip('2026-10-02', 'e-r'), '기간 막대가 9/29~10/2 칸에 걸쳐 그려지지 않았다(시드 문제)');
        assert.strictEqual(W.evChip('2026-10-01', 'e-r').dataset.occ, '2026-09-29', 'data-occ 는 시작일이어야 한다(B5 전제)');
        press(W.evChip('2026-10-01', 'e-r'), '10/1 칸의 기간 막대');
        assert.deepStrictEqual(W.view(), V(2026, 9), `10/1 칸 막대를 눌렀는데 달이 바뀌었다(B1): ${JSON.stringify(W.view())} · 선택 ${W.sel()}`);
        assert.strictEqual(W.title(), '2026년 10월', '달 제목이 10월이 아니다');
        assert.strictEqual(W.sel(), '2026-10-01', '선택 날짜가 누른 칸(10/1)이 아니다(B1)');
        assert.deepStrictEqual(W.selCells(), ['2026-10-01'], '그리드의 선택 표시가 누른 칸이 아니다');
        assert.strictEqual(W.tab(), 'detail', '일정 칩이 「일정 상세」 탭으로 드러내지 않는다(B2)');
        const card = W.card('e-r');
        assert.ok(card, '10/1 의 일정 상세에 그 기간 일정 카드가 없다(B2)');
        assert.ok(card.classList.contains('flash'), '그 카드가 강조(flash)되지 않았다(B2)');
        assert.ok(/3일째 \/ 4일/.test(card.textContent),'카드의 「n일째」가 누른 날(10/1 = 3일째)이 아니다: ' + card.textContent.replace(/\s+/g, ' ').trim());
      });
    },
    //  K2 — 같은 막대의 10/2 칸 → 선택 10/2 · 달 그대로
    async k2(source) {
      await withBoot(source, async (W) => {
        W.show(2026, 9, '2026-10-15');
        press(W.evChip('2026-10-02', 'e-r'), '10/2 칸의 기간 막대');
        assert.deepStrictEqual(W.view(), V(2026, 9), '10/2 칸 막대를 눌렀는데 달이 바뀌었다(B1)');
        assert.strictEqual(W.sel(), '2026-10-02', '선택 날짜가 누른 칸(10/2)이 아니다(B1)');
        assert.ok(W.card('e-r') && W.card('e-r').classList.contains('flash'), '10/2 의 상세에 그 카드가 강조되지 않았다(B2)');
      });
    },
    //  K3 — 9월 달력, 흐린 10/1 칸의 막대 → 10월로 넘어가고 선택 10/1(누른 칸 기준 · B3)
    async k3(source) {
      await withBoot(source, async (W) => {
        W.show(2026, 8, '2026-09-15');
        const chip = W.evChip('2026-10-01', 'e-r');
        assert.ok(chip && chip.closest('.cell').classList.contains('dim'), '9월 달력의 10/1 칸이 흐린 칸이 아니다(시드 문제)');
        press(chip, '9월 달력 흐린 10/1 칸의 기간 막대');
        assert.deepStrictEqual(W.view(), V(2026, 9), '흐린 10/1 칸 막대를 눌렀는데 10월로 넘어가지 않았다(B3)');
        assert.strictEqual(W.sel(), '2026-10-01', '선택 날짜가 누른 칸(10/1)이 아니다(B3)');
        assert.ok(W.card('e-r') && W.card('e-r').classList.contains('flash'), '10/1 의 상세에 그 카드가 강조되지 않았다(B2)');
        //  같은 9월 달력에서 9/30(이 달 칸) 막대 → 9월에 머문다
        W.show(2026, 8, '2026-09-15');
        press(W.evChip('2026-09-30', 'e-r'), '9/30 칸의 기간 막대');
        assert.deepStrictEqual(W.view(), V(2026, 8), '9/30 칸 막대를 눌렀는데 달이 바뀌었다');
        assert.strictEqual(W.sel(), '2026-09-30');
      });
    },
    //  K4 — 기간 할 일 막대도 K1 과 같다(할 일 탭 + 행 강조) · 「이 날」을 접어 두었어도 펼친다
    async k4(source) {
      await withBoot(source, async (W) => {
        W.show(2026, 9, '2026-10-15');
        const chip = W.todoChip('2026-10-01', 't-r');
        assert.ok(chip, '기간 할 일 막대가 10/1 칸에 없다(시드 문제)');
        assert.strictEqual(chip.dataset.occ, '2026-09-29', '할 일 칩 data-occ 는 시작일(due)이어야 한다(B5 전제)');
        press(chip, '10/1 칸의 기간 할 일 막대');
        assert.deepStrictEqual(W.view(), V(2026, 9), '10/1 칸 할 일 막대를 눌렀는데 달이 바뀌었다(B1)');
        assert.strictEqual(W.sel(), '2026-10-01', '할 일 칩: 선택 날짜가 누른 칸(10/1)이 아니다(B1)');
        assert.strictEqual(W.tab(), 'todo', '할 일 칩이 「할 일」 탭으로 드러내지 않는다(B2)');
        const row = W.todoRow('t-r');
        assert.ok(row, '10/1 의 할 일 탭에 그 기간 할 일 행이 없다(B2)');
        assert.ok(row.classList.contains('flash'), '그 행이 강조(flash)되지 않았다(B2)');
        //  10/2 칸 · 「이 날」 섹션을 사용자가 접어 둔 상태 — 행이 보여야 한다
        W.ev("noteTab = 'detail'; noteCollapsed.add('onday'); renderPanel();");
        press(W.todoChip('2026-10-02', 't-r'), '10/2 칸의 기간 할 일 막대');
        assert.strictEqual(W.sel(), '2026-10-02');
        assert.deepStrictEqual(W.view(), V(2026, 9));
        assert.ok(W.todoRow('t-r'), '「이 날」 섹션이 접혀 있으면 드러낸 할 일 행이 안 보인다(B2)');
        assert.ok(W.todoRow('t-r').classList.contains('flash'), '접혔던 섹션을 편 뒤 그 행이 강조되지 않았다(B2)');
      });
    },
    //  K5 — 단일일·반복 일정 칩은 그 칸의 날짜(= 그 발생일)를 고른다(지금과 같다)
    async k5(source) {
      await withBoot(source, async (W) => {
        W.show(2026, 9, '2026-10-15');
        press(W.evChip('2026-10-07', 'e-s'), '10/7 단일일 칩');
        assert.strictEqual(W.sel(), '2026-10-07', '단일일 칩: 선택 날짜가 그 칸이 아니다(K5)');
        assert.deepStrictEqual(W.view(), V(2026, 9));
        assert.ok(W.card('e-s') && W.card('e-s').classList.contains('flash'), '단일일 카드가 강조되지 않았다');
        const rc = W.evChip('2026-10-08', 'e-w');
        assert.ok(rc, '매주 목요일 반복이 10/8 칸에 없다(시드 문제)');
        assert.strictEqual(rc.dataset.occ, '2026-10-08', '반복 칩 data-occ 는 그 발생일이다(시드 전제)');
        press(rc, '10/8 반복 칩');
        assert.strictEqual(W.sel(), '2026-10-08', '반복 칩: 선택 날짜가 그 칸이 아니다(K5)');
        assert.deepStrictEqual(W.view(), V(2026, 9));
        assert.ok(W.card('e-w') && W.card('e-w').classList.contains('flash'), '반복 일정 카드가 강조되지 않았다');
        //  칩이 아닌 칸 빈 곳 클릭도 그대로
        press(W.doc.querySelector('#grid .cell[data-date="2026-10-20"]'), '10/20 칸');
        assert.strictEqual(W.sel(), '2026-10-20');
      });
    },
    //  B4 — 칸 밖 칩(칸을 못 찾음)은 data-occ 로 대체
    async b4(source) {
      await withBoot(source, async (W) => {
        W.show(2026, 9, '2026-10-15');
        const orphan = W.doc.createElement('div');
        orphan.className = 'chip chip-range';
        orphan.dataset.id = 'e-r'; orphan.dataset.occ = '2026-09-29'; orphan.dataset.kind = 'range';
        orphan.textContent = '프로젝트 포팅 진행 중';
        W.doc.getElementById('grid').appendChild(orphan);
        assert.strictEqual(orphan.closest('.cell'), null, '시험 칩이 칸 안에 들어갔다(전제)');
        press(orphan, '칸 밖 칩');
        assert.strictEqual(W.sel(), '2026-09-29', '칸 밖 칩이 data-occ 로 대체되지 않았다(B4)');
        assert.deepStrictEqual(W.view(), V(2026, 8), '칸 밖 칩의 data-occ 달(9월)로 넘어가지 않았다(B4)');
        assert.strictEqual(W.tab(), 'detail');
        assert.ok(W.card('e-r') && W.card('e-r').classList.contains('flash'), '칸 밖 칩: 카드가 강조되지 않았다');
      });
    },
    //  K6 — 끌어 옮기기는 시작일(data-occ) 기준: 10/1 칸 막대를 10/3 칸에 놓으면 +4일(9/29→10/3), 길이 보존
    async k6(source) {
      await withBoot(source, async (W) => {
        W.show(2026, 9, '2026-10-15');
        const store = {};
        const dt = { setData: (k, v) => { store[k] = v; }, getData: (k) => store[k] || '', effectAllowed: '', dropEffect: '' };
        const fire = (el, type) => {
          const e = new W.w.Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(e, 'dataTransfer', { value: dt });
          el.dispatchEvent(e);
        };
        fire(W.evChip('2026-10-01', 'e-r'), 'dragstart');
        assert.strictEqual(JSON.parse(store['text/plain']).occ, '2026-09-29', '끌기 시작이 data-occ(시작일)를 싣지 않았다(B5)');
        fire(W.doc.querySelector('#grid .cell[data-date="2026-10-03"]'), 'drop');
        const e = W.evJSON("(function(){ var e = entryById('e-r'); return { date: e.date, endDate: e.endDate }; })()");
        assert.deepStrictEqual(e, { date: '2026-10-03', endDate: '2026-10-06' }, '기간 일정 드롭이 시작일 기준 이동이 아니다(B5·K6): ' + JSON.stringify(e));
      });
    },
  };

  test('K1: 10월 달력 · 9/29~10/2 기간 일정의 10/1 칸 막대 클릭 → 달 그대로 · 선택 10/1 · 상세 탭에 그 카드 강조', () => checks.k1(src));
  test('K2: 같은 막대의 10/2 칸 클릭 → 선택 10/2 · 달 그대로', () => checks.k2(src));
  test('K3: 9월 달력 · 흐린 10/1 칸의 막대 클릭 → 10월로 넘어가고 선택 10/1(누른 칸 기준)', () => checks.k3(src));
  test('K4: 기간 할 일 막대 10/1 클릭 → 달 그대로 · 할 일 탭 + 행 강조 · 접힌 「이 날」도 편다', () => checks.k4(src));
  test('K5: 단일일·주간 반복 칩은 누른 칸(= 그 발생일)을 고른다', () => checks.k5(src));
  test('B4: 칸 밖 칩은 data-occ 로 대체한다', () => checks.b4(src));
  test('K6: 끌어 옮기기는 시작일(data-occ) 기준 — 10/1 칸에서 끌어 10/3 에 놓으면 9/29~10/2 → 10/3~10/6', () => checks.k6(src));

  test('변이①: data-occ 를 누른 칸보다 먼저 쓰면 K1 이 실패한다', async () => {
    await assert.rejects(() => checks.k1(MUT.occFirst(src)), /달이 바뀌었다/);
  });
  test('변이②: data-occ 를 먼저 쓰면 K4(할 일 막대)도 실패한다', async () => {
    await assert.rejects(() => checks.k4(MUT.occFirst(src)), /달이 바뀌었다/);
  });
  test('변이③: 할 일 칩이 접힌 「이 날」을 펴지 않으면 K4 가 실패한다', async () => {
    await assert.rejects(() => checks.k4(MUT.noOndayOpen(src)), /접혀 있으면/);
  });
}
