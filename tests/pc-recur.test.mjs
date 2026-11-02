// 과제 일정 반복(docs/PC-RECUR.md, 2026-11-02, DB 구조 20 에 합침)
//
// 이 파일이 지키는 것:
//   (S) 정적 계약
//       - 반복 값 둘(weekly, monthly)이 정본 ENUM, 호스트 RecurFreqs, 화면 폼 선택지와 이름표(PC_RECUR_NAME)에서 같다.
//         폼의 선택지 글자는 개인 폼 #qaRecur 와 같다(안 함, 매주, 매월).
//       - 호스트(ProjectCalendarDb): 읽기가 recur_freq 를 고르고 반복 일정은 시작일만으로 범위를 거른다, 예외일은 매개변수 IN 으로 읽는다.
//         저장은 recur_freq 를 쓰고 이력(FieldMap)에 남기며 허용 값 밖은 거절한다. 반복 종류가 바뀌면 그 일정의 예외일을 지운다.
//         이 날짜만 삭제(occDate)는 반복 일정의 실제 회차만 받고(IsOccurrence), 판을 같은 낙관적 검사로 올리고 예외일을 넣고
//         이력에 update 한 줄(뒤 값 exceptDate)을 남긴다. 개인 복사는 회차 날짜로 복사한다.
//       - 웹 명령은 그대로 일곱(새 명령 없음).
//   (P) 회차 규칙: 호스트 IsOccurrence 와 화면 pcOccurrences(개인 expandOccurrences)가 같은 날짜를 회차로 본다(매주, 매월, 31일).
//   (R) jsdom(위젯 모드, 가짜 호스트): 폼의 반복 선택(새 일정은 안 함, 저장 요청에 recurFreq, 반복 일정 수정은 그 값),
//       월간 막대, 주간 줄, 그날 목록, 상세가 회차를 펼치고 예외일은 빼며 반복 표시(ICON.repeat)를 단다,
//       상세의 반복 줄과 그 회차의 날짜, 삭제는 개인과 같은 확인 창("이 날짜(M/D)만 삭제 / 반복 전체 삭제")이고 이 날짜만은 occDate 를 보낸다,
//       개인 일정에 등록은 occDate 를 보낸다, 최근 변경의 이 날짜만 삭제와 반복 바뀜 표시.
//   (M) 변이: 핵심 줄을 빼면 위 검사가 잡는다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM, readText, extractCsMember, stripCsComments } from './harness.mjs';

const src = loadAppSource();
const R = (p) => new URL('../' + p, import.meta.url);
const host = readText(R('widget/ProjectCalendarDb.cs'));
const canon = readText(R('db/deploy/schema-calendar.sql'));

function mutate(base, from, to) {
  assert.ok(base.includes(from), `변이 준비 실패: ${from.slice(0, 80)}`);
  return base.split(from).join(to);
}

/* ── (S) 정적 계약 ─────────────────────────────────────────────────── */
const statics = {
  values(app = src, cs = host) {
    const ev = canon.slice(canon.indexOf('CREATE TABLE cal_project_event ('), canon.indexOf('CREATE TABLE cal_project_event_except ('));
    const en = /^  recur_freq\s+ENUM\(([^)]*)\) NULL DEFAULT NULL\s+COMMENT '[^']*',$/m.exec(ev);
    assert.ok(en, '정본 cal_project_event 에 recur_freq ENUM(...) NULL DEFAULT NULL 줄이 없다');
    const vals = [...en[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual(vals, ['weekly', 'monthly'], '정본 ENUM 값이 weekly, monthly 가 아니다');
    const hv = /RecurFreqs = \{ ([^}]*) \};/.exec(cs);
    assert.ok(hv, '호스트 RecurFreqs 가 없다');
    assert.deepStrictEqual([...hv[1].matchAll(/"(\w+)"/g)].map((m) => m[1]), vals, '호스트 RecurFreqs 가 정본 ENUM 과 다르다');
    const opts = (id) => {
      const m = new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`).exec(app);
      assert.ok(m, `#${id} 선택이 없다`);
      return [...m[1].matchAll(/<option value="(\w*)">([^<]*)<\/option>/g)].map((x) => [x[1], x[2]]);
    };
    assert.deepStrictEqual(opts('pcfRecur'), opts('qaRecur'), '과제 폼의 반복 선택이 개인 폼(#qaRecur)과 값이나 글자가 다르다');
    assert.deepStrictEqual(opts('pcfRecur'), [['', '안 함'], ['weekly', '매주'], ['monthly', '매월']], '과제 폼의 반복 선택지가 안 함, 매주, 매월이 아니다');
    const nm = /const PC_RECUR_NAME = Object\.freeze\(\{ weekly: '매주', monthly: '매월' \}\);/.test(app);
    assert.ok(nm, '화면 이름표(PC_RECUR_NAME)가 매주, 매월이 아니다');
    //  폼 자리: 시각 블록(#pcfWhen) 다음, 장소 앞(개인 폼과 같은 순서)
    const iW = app.indexOf('id="pcfWhen"'), iR = app.indexOf('id="pcfRecur"'), iL = app.indexOf('id="pcfLoc"');
    assert.ok(iW > 0 && iR > iW && iL > iR, '과제 폼의 반복 선택이 시각 블록과 장소 사이에 있지 않다');
  },
  hostRead(cs = host) {
    const code = stripCsComments(cs);
    assert.ok(/e\.memo, e\.recur_freq, e\.row_version/.test(code), '일정 읽기(EventCols)가 recur_freq 를 고르지 않는다');
    const load = stripCsComments(extractCsMember(cs, 'private async Task<object> LoadAsync('));
    assert.ok(load.includes('AND e.start_date <= @to AND (e.recur_freq IS NOT NULL OR COALESCE(e.end_date, e.start_date) >= @from)'),
      '범위 읽기가 반복 일정을 시작일만으로 거르지 않는다(시작이 범위 앞인 반복 일정이 빠진다)');
    assert.ok(/await FillExceptAsync\(conn, null, evs, ct\)/.test(load), '범위 읽기가 예외일을 싣지 않는다');
    const fill = stripCsComments(extractCsMember(cs, 'private static async Task FillExceptAsync('));
    assert.ok(/InList\("@x", /.test(fill) && /cmd\.Parameters\.AddWithValue\(k, v\)/.test(fill), '예외일 읽기가 매개변수 IN 이 아니다');
    assert.ok(/FROM cal_project_event_except/.test(fill) && /ORDER BY event_id, except_date/.test(fill), '예외일 읽기의 표나 순서가 다르다');
    const where = stripCsComments(extractCsMember(cs, 'private static async Task<Ev?> EventWhereAsync('));
    assert.ok(/FillExceptAsync\(conn, tx, new List<Ev> \{ e \}, ct\)/.test(where), '한 일정 읽기(저장, 삭제, 충돌 회신)가 예외일을 싣지 않는다');
    const dto = stripCsComments(extractCsMember(cs, 'private static Dictionary<string, object?> EventDto('));
    assert.ok(/\["recurFreq"\] = e\.F\.RecurFreq/.test(dto) && /\["recurExcept"\] = e\.Except/.test(dto), '회신 DTO 에 recurFreq, recurExcept 가 없다');
  },
  hostSave(cs = host) {
    const save = stripCsComments(extractCsMember(cs, 'private async Task<object> SaveAsync('));
    assert.ok(/location, memo, recur_freq, " \+/.test(save) && /@loc, @memo, @rf, 1, 0,/.test(save), '생성이 recur_freq 를 쓰지 않는다');
    assert.ok(/memo=@memo, recur_freq=@rf, " \+/.test(save), '수정이 recur_freq 를 쓰지 않는다');
    const iUpd = save.indexOf('recur_freq=@rf'), iDel = save.indexOf('DELETE FROM cal_project_event_except WHERE event_id=@e'), iChg = save.indexOf('"update", me.Name');
    assert.ok(iDel > iUpd && iChg > iDel, '반복 종류가 바뀐 수정이 그 일정의 예외일을 지우지 않는다(수정 뒤, 이력 앞)');
    assert.ok(/!string\.Equals\(cur\.F\.RecurFreq, f\.RecurFreq, StringComparison\.Ordinal\)/.test(save), '예외일 지우기가 반복 종류 바뀜에 묶여 있지 않다');
    const code = stripCsComments(cs);
    assert.ok(/\("@rf", f\.RecurFreq\)/.test(code), '저장 매개변수에 @rf 가 없다');
    assert.ok(/Put\("recurFreq", a\.RecurFreq, b\?\.RecurFreq\)/.test(code), '반복 바뀜이 이력(FieldMap)에 남지 않는다');
    const val = stripCsComments(extractCsMember(cs, 'private static Fields ValidateFields('));
    assert.ok(/Array\.IndexOf\(RecurFreqs, rf\) < 0\) throw new PcFail\(Kind\.Invalid/.test(val), '허용 밖 반복 값을 거절하지 않는다');
    assert.ok(/f\.RecurFreq = rf\.Length == 0 \? null : rf;/.test(val), '빈 반복 값이 null(반복 아님)이 아니다');
  },
  hostDelete(cs = host) {
    const del = stripCsComments(extractCsMember(cs, 'private async Task<object> DeleteAsync('));
    assert.ok(/string\? occDate = OptOccDate\(q\);/.test(del), '삭제가 회차 날짜(occDate)를 받지 않는다');
    const i = del.indexOf('if (occDate != null)');
    assert.ok(i > del.indexOf('cur.RowVersion != expected'), '이 날짜만 삭제가 같은 판 검사(row_version) 뒤가 아니다');
    const b = del.slice(i, del.indexOf('int n = await Exec('));
    assert.ok(/if \(cur\.F\.RecurFreq == null\) throw new PcFail\(Kind\.Invalid, MsgNotRecurring\)/.test(b), '반복 아닌 일정의 이 날짜만 삭제를 거절하지 않는다');
    assert.ok(/if \(!IsOccurrence\(cur\.F\.StartDate, cur\.F\.RecurFreq, occDate\)\) throw new PcFail\(Kind\.Invalid, MsgNotOccurrence\)/.test(b), '회차가 아닌 날짜를 거르지 않는다');
    assert.ok(/WHERE event_id=@e AND row_version=@exp AND is_deleted=0/.test(b) && /row_version = row_version \+ 1/.test(b), '이 날짜만 삭제가 낙관적 검사로 판을 올리지 않는다');
    assert.ok(!/is_deleted=1/.test(b), '이 날짜만 삭제가 일정을 지운다');
    assert.ok(/INSERT IGNORE INTO cal_project_event_except \(event_id, except_date\) VALUES \(@e, @d\)/.test(b), '예외일을 넣지 않는다');
    assert.ok(/InsertChangeAsync\(conn, tx, projectId, cur\.EventId, mutationUid, "update", me\.Name, cur\.F\.Title, null,\s*new Dictionary<string, object\?>\(StringComparer\.Ordinal\) \{ \["exceptDate"\] = occDate \}/.test(b), '이력에 이 날짜만 삭제(update, exceptDate)가 남지 않는다');
    assert.ok(b.indexOf('CommitWithGateAsync(') > b.indexOf('InsertChangeAsync('), '이 날짜만 삭제가 관문 커밋으로 끝나지 않는다');
  },
  hostCopy(cs = host) {
    const copy = stripCsComments(extractCsMember(cs, 'private async Task<object> CopyAsync('));
    assert.ok(/string\? occDate = OptOccDate\(q\);/.test(copy), '개인 복사가 회차 날짜를 받지 않는다');
    assert.ok(/IsOccurrence\(src\.F\.StartDate, src\.F\.RecurFreq, occDate\)/.test(copy), '개인 복사가 회차가 아닌 날짜를 거르지 않는다');
    assert.ok(/\["date"\] = copyStart,/.test(copy) && /\["endDate"\] = copyEnd == copyStart \? "" : copyEnd,/.test(copy), '개인 복사가 회차 날짜로 찍지 않는다');
    assert.ok(!/\["recur/.test(copy), '개인 복사에 반복을 싣는다(반복 없이 하루로 복사해야 한다)');
  },
  commands(app = src, cs = host) {
    const web = /const PCAL_CMDS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(app);
    const hc = /internal static readonly string\[\] Commands =\s*\{([\s\S]*?)\};/.exec(cs);
    const names = (s) => [...s.matchAll(/['"](\w+)['"]/g)].map((m) => m[1]);
    assert.strictEqual(names(web[1]).length, 7, '웹 명령이 일곱이 아니다(반복은 새 명령 없이 저장, 삭제, 복사의 값으로 간다)');
    assert.deepStrictEqual(names(web[1]), names(hc[1]), '웹과 호스트 명령 목록이 다르다');
  },
};
test('반복S①: 반복 값(weekly, monthly)이 정본 ENUM, 호스트, 화면에서 같고 폼 선택은 개인 폼과 같은 글자, 같은 자리다', () => statics.values());
test('반복S②: 호스트 읽기가 recur_freq 와 예외일(매개변수 IN)을 싣고 반복 일정은 시작일만으로 범위를 거른다', () => statics.hostRead());
test('반복S③: 저장이 recur_freq 를 쓰고 이력에 남기며 허용 밖은 거절하고, 반복 종류가 바뀌면 예외일을 지운다', () => statics.hostSave());
test('반복S④: 이 날짜만 삭제는 반복의 실제 회차만, 같은 판 검사로 판을 올리고 예외일을 넣고 이력에 update 한 줄', () => statics.hostDelete());
test('반복S⑤: 개인 복사는 회차 날짜로 반복 없이 찍는다, 명령은 그대로 일곱', () => { statics.hostCopy(); statics.commands(); });

test('변이S①: 범위 읽기가 반복 일정을 종료일로 거르면 S② 가 잡는다', () => {
  const bad = mutate(host, 'AND (e.recur_freq IS NOT NULL OR COALESCE(e.end_date, e.start_date) >= @from)', 'AND COALESCE(e.end_date, e.start_date) >= @from');
  assert.throws(() => statics.hostRead(bad), /시작일만으로/);
});
test('변이S②: 이 날짜만 삭제가 회차 검사를 빼면 S④ 가 잡는다', () => {
  const bad = mutate(host, '                    if (!IsOccurrence(cur.F.StartDate, cur.F.RecurFreq, occDate)) throw new PcFail(Kind.Invalid, MsgNotOccurrence);\n', '');
  assert.throws(() => statics.hostDelete(bad), /회차가 아닌 날짜/);
});
test('변이S③: 반복 종류가 바뀌어도 예외일을 지우지 않으면 S③ 이 잡는다', () => {
  const bad = mutate(host, '"DELETE FROM cal_project_event_except WHERE event_id=@e"', '"SELECT 1"');
  assert.throws(() => statics.hostSave(bad), /예외일을 지우지 않는다/);
});
test('변이S④: 폼 선택지 글자가 개인 폼과 다르면 S① 이 잡는다', () => {
  const bad = mutate(src, '<select id="pcfRecur"><option value="">안 함</option>', '<select id="pcfRecur"><option value="">반복 없음</option>');
  assert.throws(() => statics.values(bad), /개인 폼/);
});

/* ── (P) 회차 규칙: 호스트 IsOccurrence 의 식과 화면 expandOccurrences 의 결과가 같다 ───────────────── */
//  호스트 식(정적으로 확인한 그 두 줄)을 JS 로 옮겨, 화면 함수가 펼친 회차와 날짜마다 비교한다.
function hostIsOcc(start, freq, date) {
  if (date < start) return false;
  const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  if (freq === 'weekly') return Math.round((p(date) - p(start)) / 86400000) % 7 === 0;
  if (freq === 'monthly') return Number(date.slice(8)) === Number(start.slice(8));
  return false;
}
test('반복P①: 호스트 IsOccurrence 식이 정적으로 그 모양이다(매주 7일마다, 매월 같은 날, 시작일 앞은 아님)', () => {
  const f = stripCsComments(extractCsMember(host, 'internal static bool IsOccurrence('));
  assert.ok(/string\.CompareOrdinal\(date, start\) < 0\) return false;/.test(f), '시작일 앞을 회차로 본다');
  assert.ok(/if \(freq == "weekly"\) return \(\(int\)\(d - s\)\.TotalDays\) % 7 == 0;/.test(f), '매주 규칙이 7일마다가 아니다');
  assert.ok(/if \(freq == "monthly"\) return d\.Day == s\.Day;/.test(f), '매월 규칙이 같은 날이 아니다');
});

/* ── (R) jsdom ─────────────────────────────────────────────────────── */
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('pc-recur: jsdom 미설치, 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  function fakeClock() {
    let seq = 0, now = 0;
    const timers = new Map();
    return {
      setTimeout(fn, d, ...args) { const id = ++seq; timers.set(id, { fn, args, at: now + (Number(d) || 0) }); return id; },
      clearTimeout(id) { timers.delete(id); },
      advance(ms) {
        const end = now + ms;
        for (;;) {
          let best = null;
          for (const [id, t] of timers) if (t.at <= end && (best === null || t.at < timers.get(best).at)) best = id;
          if (best === null) { now = end; return; }
          const t = timers.get(best); timers.delete(best); now = t.at;
          try { t.fn(...t.args); } catch (_) { /* 앱의 일 */ }
        }
      },
    };
  }
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const P1 = '11111111-1111-4111-8111-111111111111';
  const U = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const PROJECTS = [{ projectUid: P1, name: '장비 개발', color: '#3e5be0', active: true, writable: true, members: 3 }];
  const META = { schemaVersion: '20', expectedSchema: '20', schemaMismatch: false, gate: 'ok', rev: 1, canWrite: true, userId: 7 };
  const DATA = () => ({ categories: [{ id: 'c-1', name: '휴가', color: '#9aa2b3' }, { id: 'c-2', name: '기타', color: '#6b7a90' }], entries: [], todos: [], rooms: [] });

  async function boot(source = src) {
    const clock = fakeClock();
    const posts = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posts.push(o || {}); }, addEventListener() {}, removeEventListener() {} } };
        win.scrollTo = () => {};
        win.setTimeout = clock.setTimeout; win.clearTimeout = clock.clearTimeout;
      },
    });
    const w = dom.window, doc = w.document;
    const W = {
      w, doc, clock, posts,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      el: (id) => doc.getElementById(id),
      q: (s) => doc.querySelector(s), qa: (s) => [...doc.querySelectorAll(s)],
      cmds: (cmd) => posts.filter((p) => p.cmd === cmd),
      last: (cmd) => [...posts].reverse().find((p) => p.cmd === cmd && p.reqId),
      async reply(cmd, res) {
        const p = W.last(cmd);
        assert.ok(p, `${cmd} 요청이 나가지 않았다`);
        p.__done = true;
        w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify(res) + ')');
        await settle();
      },
      async click(sel) { const e = typeof sel === 'string' ? doc.querySelector(sel) : sel; assert.ok(e, `누를 것(${sel})이 없다`); e.click(); await settle(); clock.advance(150); await settle(); },
      async load(events) {
        const p = W.last('projectCalendarLoad');
        await W.reply('projectCalendarLoad', { ok: true, data: { projects: (p.projectUids || []).map((u) => ({ projectUid: u, writable: true })), events, excluded: [], from: p.from, to: p.to } });
      },
      async enter(events) {
        await W.click('#pcTabProject');
        await W.reply('projectCalendarBootstrap', { ok: true, data: { projects: PROJECTS, limits: { title: 200, location: 200, memo: 8000 } } });
        await W.load(events);
      },
      close: () => { try { w.close(); } catch (_) {} },
    };
    await settle();
    await W.reply('userSessionGet', { ok: true, user: { loginId: 'hjlee', name: '이현진' } });
    w.eval('__applyState(' + JSON.stringify(JSON.stringify(DATA())) + ',' + JSON.stringify(META) + ')');
    await settle(); clock.advance(5); await settle();
    for (const p of posts.filter((x) => x.cmd === 'saveState' && x.reqId && !x.__done)) { p.__done = true; w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',{"ok":true})'); }
    await settle();
    return W;
  }
  async function withBoot(fn, source) { const W = await boot(source); try { return await fn(W); } finally { W.close(); } }
  const EV = (n, o = {}) => Object.assign({ eventUid: U(n), projectUid: P1, title: '일정 ' + n, startDate: '', endDate: '', startTime: null, endTime: null,
    location: '', memo: '', recurFreq: null, recurExcept: [], rowVersion: 1, deleted: false, createdBy: '홍길동', updatedBy: '홍길동',
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }, o);
  //  매주 일정: 시작은 오늘 14일 전(월간 범위의 앞일 수도 있다), 예외일은 오늘(그 회차는 보이지 않아야 한다).
  function weekly(W, o = {}) {
    const t = W.ev('todayYmd()'), start = W.ev(`addDays(${JSON.stringify(t)}, -14)`);
    return { t, start, e: EV(1, Object.assign({ title: '주간 점검', startDate: start, endDate: start, recurFreq: 'weekly', recurExcept: [t] }, o)) };
  }
  //  [from, to] 안의 매주 회차(예외일 빼고)
  function expectWeekly(W, start, from, to, except) {
    const out = [];
    for (let k = 0; k < 200; k++) {
      const d = W.ev(`addDays(${JSON.stringify(start)}, ${7 * k})`);
      if (d > to) break;
      if (d >= from && !except.includes(d)) out.push(d);
    }
    return out;
  }
  const occsOf = (W, sel) => W.qa(sel).map((b) => b.dataset.occ).sort();

  const checks = {
    async form(W) {
      const t = W.ev('todayYmd()');
      await W.enter([EV(2, { title: '월간 보고', startDate: t, endDate: t, recurFreq: 'monthly' })]);
      await W.click('#pcView [data-act="new"]');
      assert.strictEqual(W.el('pcfRecur').value, '', '새 일정의 반복이 안 함이 아니다');
      W.el('pcfTitle').value = '정기 회의'; W.el('pcfProj').value = P1; W.el('pcfRecur').value = 'weekly';
      await W.click('#pcfSave');
      const s = W.last('projectCalendarSave');
      assert.ok(s, '저장을 보내지 않았다');
      assert.strictEqual(s.event.recurFreq, 'weekly', '저장 요청에 고른 반복(weekly)이 없다');
      await W.reply('projectCalendarSave', { ok: true, data: { event: EV(3, { eventUid: s.eventUid, title: '정기 회의', startDate: t, endDate: t, recurFreq: 'weekly' }), rowVersion: 1, replayed: false } });
      W.clock.advance(500); await settle();
      //  반복 일정 수정은 그 값으로 열리고(반복 전체), 안 함으로 바꾸면 null 을 보낸다
      W.ev(`pcOpenForm({ uid: ${JSON.stringify(U(2))} })`); await settle();
      assert.strictEqual(W.el('pcfRecur').value, 'monthly', '반복 일정 수정 폼에 그 반복이 보이지 않는다');
      assert.strictEqual(W.el('pcfStart').value, t, '수정 폼이 반복 전체(시작일)가 아니다');
      W.el('pcfRecur').value = '';
      await W.click('#pcfSave');
      const s2 = W.last('projectCalendarSave');
      assert.strictEqual(s2.event.recurFreq, null, '안 함으로 바꿨는데 recurFreq 가 null 이 아니다');
      assert.strictEqual(s2.expectedVersion, 1, '수정에 판이 없다');
    },
    async expand(W) {
      const { t, start, e } = weekly(W);
      await W.enter([e]);
      //  월간
      const R = W.evJSON('pcMonthRange(PCAL.anchor)');
      const want = expectWeekly(W, start, R.from, R.to, [t]);
      assert.ok(want.length >= 3, '시험 준비: 월간에 회차가 셋 이상이어야 한다');
      assert.deepStrictEqual(occsOf(W, `#pcView .pc-ev[data-ev="${U(1)}"]`), want, '월간 막대가 회차(예외일 뺌)와 다르다');
      assert.ok(!W.q(`#pcView .pc-ev[data-occ="${t}"]`), '예외일(이 날짜만 삭제)의 회차가 월간에 보인다');
      for (const b of W.qa(`#pcView .pc-ev[data-ev="${U(1)}"]`)) {
        assert.ok(b.querySelector('svg.ic, svg'), '반복 회차 막대에 반복 표시가 없다');
        assert.ok(/반복/.test(b.getAttribute('aria-label') || ''), '반복 회차 막대의 aria-label 에 반복이 없다');
      }
      //  그날 목록: 회차 날은 줄 하나(data-occ), 예외일은 줄 없음
      const d1 = start;
      if (d1 >= R.from) {
        W.ev(`pcOpenDayList(${JSON.stringify(d1)}, document.querySelector('#pcView .pc-day[data-date="${d1}"]'))`); await settle();
        const rows = W.qa('#pcPop .pc-dl-row');
        assert.deepStrictEqual(rows.map((r) => r.dataset.occ), [d1], '회차 날의 그날 목록이 그 회차 줄 하나가 아니다');
        assert.ok(rows[0].querySelector('svg'), '그날 목록 줄에 반복 표시가 없다');
      }
      W.ev(`pcOpenDayList(${JSON.stringify(t)}, document.querySelector('#pcView .pc-day[data-date="${t}"]'))`); await settle();
      assert.strictEqual(W.qa('#pcPop .pc-dl-row').length, 0, '예외일의 그날 목록에 그 일정이 있다');
      W.ev('pcClosePop(true)');
      //  주간: 오늘이 든 주는 예외일이라 비고, 한 주 앞은 회차 하나
      await W.click('#pcView [data-act="view"][data-v="week"]');
      await W.load([e]);
      assert.strictEqual(W.qa(`#pcView .pc-wcells .pc-ev[data-ev="${U(1)}"]`).length, 0, '예외일이 든 주의 주간 줄에 그 회차가 보인다');
      await W.click('#pcView [data-act="prev"]');
      await W.load([e]);
      const wk = W.evJSON('pcWeekRange(PCAL.anchor)');
      assert.deepStrictEqual(occsOf(W, `#pcView .pc-wcells .pc-ev[data-ev="${U(1)}"]`), expectWeekly(W, start, wk.from, wk.to, [t]), '주간 줄이 그 주의 회차와 다르다');
    },
    async detailDelete(W) {
      const { t, start, e } = weekly(W, { rowVersion: 4 });
      await W.enter([e]);
      const occ = W.ev(`addDays(${JSON.stringify(start)}, 7)`);
      W.ev(`pcOpenDetail(${JSON.stringify(U(1))}, ${JSON.stringify(occ)})`); await settle();
      const body = W.el('pcDetailBody').textContent;
      assert.ok(body.includes(W.ev(`pcMd(${JSON.stringify(occ)})`)), '상세 창의 날짜가 누른 회차가 아니다');
      const dow = ['일', '월', '화', '수', '목', '금', '토'][W.ev(`parseYmd(${JSON.stringify(start)}).getDay()`)];
      assert.ok(body.includes('반복') && body.includes('매주 ' + dow + '요일'), '상세 창에 반복 줄(매주 요일)이 없다: ' + body);
      //  삭제: 개인과 같은 확인 창. 이 날짜만 삭제는 occDate 를 보낸다
      await W.click('#pcDetailFoot [data-act="delete"]');
      assert.strictEqual(W.el('cfTitle').textContent, '반복 일정 삭제', '반복 일정 삭제 확인 창이 아니다');
      const md = W.ev(`fmtShort(${JSON.stringify(occ)})`);
      assert.strictEqual(W.el('cfOk').textContent, '이 날짜(' + md + ')만 삭제', '확인 단추 글자가 개인과 다르다');
      assert.strictEqual(W.el('cfAlt').textContent, '반복 전체 삭제', '두 번째 단추 글자가 개인과 다르다');
      await W.click('#cfOk');
      const d = W.last('projectCalendarDelete');
      assert.ok(d, '삭제를 보내지 않았다');
      assert.deepStrictEqual([d.eventUid, d.expectedVersion, d.occDate], [U(1), 4, occ], '이 날짜만 삭제가 그 회차 날짜와 판을 보내지 않는다');
      await W.reply('projectCalendarDelete', { ok: true, data: { eventUid: U(1), rowVersion: 5, deleted: false, replayed: false, recurExcept: [t, occ].sort(), exceptDate: occ } });
      assert.ok(!W.q(`#pcView .pc-ev[data-occ="${occ}"]`), '이 날짜만 지운 회차가 달력에 남았다');
      assert.ok(W.q(`#pcView .pc-ev[data-ev="${U(1)}"]`), '이 날짜만 지웠는데 다른 회차까지 사라졌다');
      assert.strictEqual(W.ev(`pcEv(${JSON.stringify(U(1))}).rowVersion`), 5, '이 날짜만 지운 뒤 판이 오르지 않았다');
      //  반복 전체 삭제는 occDate 없이
      W.ev(`pcOpenDetail(${JSON.stringify(U(1))}, ${JSON.stringify(start)})`); await settle();
      await W.click('#pcDetailFoot [data-act="delete"]');
      await W.click('#cfAlt');
      const d2 = W.last('projectCalendarDelete');
      assert.ok(d2 !== d && !('occDate' in d2) && d2.expectedVersion === 5, '반복 전체 삭제가 occDate 없이 최신 판으로 가지 않는다');
    },
    async copy(W) {
      const { start, e } = weekly(W);
      await W.enter([e]);
      const occ = W.ev(`addDays(${JSON.stringify(start)}, 7)`);
      W.ev(`pcOpenDetail(${JSON.stringify(U(1))}, ${JSON.stringify(occ)})`); await settle();
      await W.click('#pcDetailFoot [data-act="copy"]');
      W.clock.advance(1000); await settle();
      const c = W.last('projectCalendarCopy');
      assert.ok(c, '개인 일정에 등록을 보내지 않았다');
      assert.strictEqual(c.occDate, occ, '개인 일정에 등록이 누른 회차 날짜를 보내지 않는다');
    },
    async changes(W) {
      const rows = W.evJSON(`pcDiffRows('update', null, { exceptDate: '2026-11-09' })`);
      assert.deepStrictEqual(rows.map((r) => [r.label, r.b, r.a]), [['날짜', W.ev("fmtShort('2026-11-09')"), null]], '이 날짜만 삭제 이력이 지운 날짜로 보이지 않는다');
      const r2 = W.evJSON(`pcDiffRows('update', { recurFreq: null }, { recurFreq: 'weekly' })`);
      assert.deepStrictEqual(r2.map((r) => [r.label, r.b, r.a]), [['반복', '안 함', '매주']], '반복 바뀜 이력이 다르다');
      const r3 = W.evJSON(`pcDiffRows('create', null, { startDate: '2026-11-02', endDate: '2026-11-02', recurFreq: 'monthly' })`);
      assert.ok(r3.some((r) => r.label === '반복' && r.a === '매월'), '추가 이력에 반복이 없다');
      const h = W.ev(`pcRcRowHtml({ changeNo: 1, projectUid: ${JSON.stringify(P1)}, eventUid: 'x', action: 'update', actor: '가', title: '회의', before: null, after: { exceptDate: '2026-11-09' }, changedAt: '2026-11-02T01:00:00.000Z' }, false, new Set())`);
      assert.ok(/pcc-act delete">이 날짜만 삭제</.test(h), '최근 변경에 이 날짜만 삭제 표시가 없다');
    },
  };
  test('반복R①: 폼의 반복 선택(새 일정은 안 함, 저장 요청에 recurFreq, 반복 일정 수정은 그 값과 반복 전체, 안 함은 null)', () => withBoot((W) => checks.form(W)));
  test('반복R②: 월간 막대, 그날 목록, 주간 줄이 회차를 펼치고(시작이 범위 앞이어도) 예외일은 빼며 반복 표시를 단다', () => withBoot((W) => checks.expand(W)));
  test('반복R③: 상세는 그 회차 날짜와 반복 줄, 삭제는 개인과 같은 확인 창, 이 날짜만은 occDate 와 판, 전체는 occDate 없이', () => withBoot((W) => checks.detailDelete(W)));
  test('반복R④: 개인 일정에 등록은 누른 회차 날짜(occDate)를 보낸다', () => withBoot((W) => checks.copy(W)));
  test('반복R⑤: 최근 변경의 이 날짜만 삭제와 반복 바뀜 표시', () => withBoot((W) => checks.changes(W)));

  test('반복R⑥: 화면 pcOccurrences 의 회차와 호스트 IsOccurrence 식이 날짜마다 같다(매주, 매월, 31일 시작은 그날이 없는 달을 건너뜀, 시작일 앞 없음)', () => withBoot(async (W) => {
    for (const [start, freq] of [['2026-01-31', 'monthly'], ['2026-02-28', 'monthly'], ['2026-03-04', 'weekly'], ['2026-12-29', 'weekly']]) {
      const from = '2025-12-01', to = '2027-03-31';
      const occ = new Set(W.evJSON(`pcOccurrences([{ eventUid: 'x', projectUid: 'p', startDate: ${JSON.stringify(start)}, endDate: ${JSON.stringify(start)}, recurFreq: ${JSON.stringify(freq)}, recurExcept: [] }], ${JSON.stringify(from)}, ${JSON.stringify(to)}).map(o => o.occDate)`));
      let n = 0;
      for (let d = from; d <= to; d = W.ev(`addDays(${JSON.stringify(d)}, 1)`)) {
        assert.strictEqual(occ.has(d), hostIsOcc(start, freq, d), `${freq} ${start}: ${d} 를 화면과 호스트가 다르게 본다`);
        if (occ.has(d)) n++;
      }
      assert.ok(n > 3, `시험 준비: ${freq} ${start} 회차가 너무 적다(${n})`);
    }
  }));

  test('변이R①: 회차 펼치기가 예외일을 무시하면 R② 가 잡는다', async () => {
    const bad = mutate(src, "recurExcept: e.recurExcept || [] };", "recurExcept: [] };");
    await assert.rejects(() => withBoot((W) => checks.expand(W), bad), /예외일|회차/);
  });
  test('변이R②: 이 날짜만 삭제가 occDate 를 보내지 않으면 R③ 이 잡는다', async () => {
    const bad = mutate(src, '  if(occDate) req.occDate = occDate;\n', '');
    await assert.rejects(() => withBoot((W) => checks.detailDelete(W), bad), /회차 날짜와 판/);
  });
  test('변이R③: 개인 일정에 등록이 회차 날짜를 빼면 R④ 가 잡는다', async () => {
    const bad = mutate(src, '  if(e.recurFreq) creq.occDate = pcDetailOcc(e).occDate || e.startDate;', '');
    await assert.rejects(() => withBoot((W) => checks.copy(W), bad), /회차 날짜/);
  });
  test('변이R④: 범위 앞에서 시작한 반복을 펼치지 않으면(반복을 무시) R② 가 잡는다', async () => {
    const bad = mutate(src, '    if(!e.recurFreq){ if(e.startDate <= to && e.endDate >= from) out.push({ ...e, occDate: \'\' }); continue; }',
      '    { if(e.startDate <= to && e.endDate >= from) out.push({ ...e, occDate: \'\' }); continue; }');
    await assert.rejects(() => withBoot((W) => checks.expand(W), bad), /회차|월간/);
  });
}
