// 부팅 실패 재시도(P1-2) — Layer 1(순수) + 배선 계약.
//
// 왜 있나 (실제 사고)
//   아침에 PC 가 서버보다 먼저 켜지면 부팅 조회가 그냥 실패하고, 그 상태의 유일한 탈출구가
//   "위젯을 다시 켜세요" 였다. 기다리면 풀리는 실패인데 사람이 재시작해야 하는 구조라
//   89명 규모에서는 그것이 그대로 장애 신고가 된다(ROADMAP §2-2 P1).
//
// 두 층을 나눠 본다:
//   ① **순수** — 스케줄러(createBootRetry)에 타이머를 주입해 실제 시간을 기다리지 않고
//      지연 순서(15·30·60)·3회 상한·성공 시 해제·수동 즉시 1회를 그대로 실행해 본다.
//      정규식으로 '15000 이 소스에 있다'만 보면, 그 숫자를 **쓰지 않는** 코드와 구분되지 않는다.
//   ② **배선** — 순수 로직이 맞아도 배선이 틀리면 화면에서는 아무 일도 안 일어난다.
//      특히 재시도가 hostRequest 로 가면 **성공해도 25초 뒤 '응답 시간 초과'** 로 끝난다
//      (reloadState 는 회신이 없는 명령이다). 그 결함은 소스에서만 보인다.
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const src = loadAppSource();
const mainwin = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

// 함수 본문을 중괄호 균형으로 잘라낸다(data-source.test.mjs 와 같은 꼴).
function bodyOf(text, header) {
  const i = text.indexOf(header);
  assert.ok(i > 0, `${header} 를 찾지 못했다`);
  let k = text.indexOf('{', i), depth = 0;
  for (let p = k; p < text.length; p++) {
    if (text[p] === '{') depth++;
    else if (text[p] === '}') { depth--; if (depth === 0) return text.slice(i, p + 1); }
  }
  assert.fail(`${header} 의 끝을 찾지 못했다`);
}

/* ── ① 순수 — 앱 소스의 스케줄러를 그대로 되살려 돌린다 ─────────────────── */

// `const BOOT_RETRY_DELAYS = [...]` 를 소스에서 그대로 읽는다(테스트가 값을 다시 적지 않는다).
function delaysLiteral(app) {
  const m = /const\s+BOOT_RETRY_DELAYS\s*=\s*(\[[^\]]*\])\s*;/.exec(app);
  assert.ok(m, 'BOOT_RETRY_DELAYS 선언을 찾지 못했다');
  return m[1];
}

const mod = new Function(
  'const BOOT_RETRY_DELAYS = ' + delaysLiteral(src) + ';\n' +
  extractFunction(src, 'nextRetryDelay') + '\n' +
  extractFunction(src, 'createBootRetry') + '\n' +
  'return { BOOT_RETRY_DELAYS, nextRetryDelay, createBootRetry };'
)();

// 가짜 시계 — setTimeout/clearTimeout 을 대신한다. 시간은 advance() 로만 흐른다.
function fakeClock() {
  let seq = 0, now = 0;
  const timers = new Map();
  return {
    at: () => now,
    setTimeout(fn, d) { const id = ++seq; timers.set(id, { fn, at: now + (d || 0) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    pending() { return timers.size; },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best = null;
        for (const [id, t] of timers) if (t.at <= end && (best === null || t.at < timers.get(best).at)) best = id;
        if (best === null) { now = end; return; }
        const t = timers.get(best); timers.delete(best); now = t.at; t.fn();
      }
    },
  };
}

// 스케줄러 + 발사 기록 + 마지막 render 상태.
function harness(delays) {
  const clock = fakeClock();
  const posts = [];        // 발사된 시각(ms)
  const renders = [];
  const r = mod.createBootRetry({
    post: () => posts.push(clock.at()),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    render: (st) => renders.push(st),
    delays: delays,
  });
  return { clock, posts, renders, r, last: () => renders[renders.length - 1] };
}

test('재시도①: nextRetryDelay 가 15·30·60 을 차례로 주고 그 뒤는 null(중단)', () => {
  assert.deepStrictEqual(mod.BOOT_RETRY_DELAYS, [15000, 30000, 60000]);
  assert.strictEqual(mod.nextRetryDelay(0), 15000);
  assert.strictEqual(mod.nextRetryDelay(1), 30000);
  assert.strictEqual(mod.nextRetryDelay(2), 60000);
  assert.strictEqual(mod.nextRetryDelay(3), null, '3회를 넘겨도 지연을 주면 무한 재시도가 된다');
  assert.strictEqual(mod.nextRetryDelay(-1), null);
});

test('재시도②: 실패가 이어지면 15초 → 30초 → 60초 뒤에 정확히 한 번씩 보낸다', () => {
  const h = harness();
  h.r.onError(true);
  h.clock.advance(14000);
  assert.deepStrictEqual(h.posts, [], '14초 만에 보냈다 — 첫 지연은 15초다');
  h.clock.advance(1000);
  assert.deepStrictEqual(h.posts, [15000]);

  h.r.onError(true);                       // 그 재시도도 실패했다
  h.clock.advance(30000);
  assert.deepStrictEqual(h.posts, [15000, 45000]);

  h.r.onError(true);
  h.clock.advance(60000);
  assert.deepStrictEqual(h.posts, [15000, 45000, 105000]);
});

test('재시도③: 3회를 쓰면 멈춘다(무한 재시도 금지) — 상태는 exhausted', () => {
  const h = harness();
  for (let i = 0; i < 3; i++) { h.r.onError(true); h.clock.advance(60000); }
  assert.strictEqual(h.posts.length, 3);
  h.r.onError(true);                        // 네 번째 실패
  assert.strictEqual(h.last().phase, 'exhausted');
  assert.strictEqual(h.clock.pending(), 0, '중단인데 타이머가 남아 있다 — 언젠가 혼자 한 번 더 보낸다');
  h.clock.advance(600000);
  assert.strictEqual(h.posts.length, 3, '중단 뒤에도 보냈다');
});

test('재시도④: 성공하면 타이머를 걷고 카운터를 리셋한다(다음 실패는 다시 15초부터)', () => {
  const h = harness();
  h.r.onError(true);
  h.clock.advance(5000);
  assert.strictEqual(h.clock.pending(), 1, '대기 중이어야 한다');
  h.r.onSuccess();
  assert.strictEqual(h.clock.pending(), 0, '성공했는데 타이머가 남았다 — 살아난 화면 위에서 계속 서버를 두드린다');
  h.clock.advance(600000);
  assert.deepStrictEqual(h.posts, [], '성공 뒤에 보냈다');
  //  리셋 확인 — 다시 실패하면 60초가 아니라 15초다.
  h.r.onError(true);
  h.clock.advance(15000);
  assert.strictEqual(h.posts.length, 1, '성공 뒤 첫 실패가 15초에서 시작하지 않는다');
});

test('재시도⑤: 수동 [다시 시도]는 즉시 한 번 보내되 자동 시리즈를 리셋하지 않는다', () => {
  const h = harness();
  h.r.onError(true);                        // 15초 대기 시작
  h.r.manual();
  assert.deepStrictEqual(h.posts, [0], '수동이 즉시 보내지 않았다');
  assert.strictEqual(h.clock.pending(), 0, '수동으로 보냈는데 예약된 자동 발사가 남았다 — 두 번 간다');
  //  ★ 리셋했다면 여기서 15초가 다시 나온다. 리셋하지 않으므로 다음은 30초다.
  h.r.onError(true);
  h.clock.advance(15000);
  assert.strictEqual(h.posts.length, 1, '수동이 시리즈를 리셋했다 — 사람이 누를 때마다 상한이 되살아나면 중단이 영영 안 온다');
  h.clock.advance(15000);
  assert.strictEqual(h.posts.length, 2);
});

test('재시도⑥: retryable=false 면 자동 재시도를 걸지 않는다(로그인 없음·미등록)', () => {
  const h = harness();
  h.r.onError(false);
  assert.strictEqual(h.last().phase, 'manual');
  assert.strictEqual(h.clock.pending(), 0);
  h.clock.advance(600000);
  assert.deepStrictEqual(h.posts, [], '기다려도 안 풀리는 실패인데 자동으로 다시 걸었다');
  //  수동은 여전히 된다 — 로그인·등록은 이 창 밖에서 해결되고, 해결한 사람이 이어 갈 문이다.
  h.r.manual();
  assert.strictEqual(h.posts.length, 1);
});

test('재시도⑦: 카운트다운이 1초마다 남은 초와 회차를 알린다', () => {
  const h = harness();
  h.r.onError(true);
  assert.deepStrictEqual({ p: h.last().phase, s: h.last().secondsLeft, a: h.last().attempt, t: h.last().total },
    { p: 'waiting', s: 15, a: 1, t: 3 });
  h.clock.advance(1000);
  assert.strictEqual(h.last().secondsLeft, 14);
  h.clock.advance(13000);
  assert.strictEqual(h.last().secondsLeft, 1);
  h.clock.advance(1000);
  assert.strictEqual(h.last().phase, 'sending', '발사 순간에는 "연결 중"으로 바뀌어야 한다');
});

/* ── 변이 시험 — 위 검사가 정말 잡는지 ───────────────────────────────── */

function rebuild(app) {
  return new Function(
    'const BOOT_RETRY_DELAYS = ' + delaysLiteral(app) + ';\n' +
    extractFunction(app, 'nextRetryDelay') + '\n' +
    extractFunction(app, 'createBootRetry') + '\n' +
    'return { BOOT_RETRY_DELAYS, nextRetryDelay, createBootRetry };'
  )();
}

test('변이①: 상한을 없애면(무한 재시도) 재시도③ 이 잡는다', () => {
  const bad = rebuild(mutate('      const d = nextRetryDelay(attempt, delays);', '      const d = nextRetryDelay(attempt, delays) || 60000;', src));
  const clock = fakeClock(); const posts = [];
  const r = bad.createBootRetry({ post: () => posts.push(clock.at()), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  for (let i = 0; i < 4; i++) { r.onError(true); clock.advance(60000); }
  assert.strictEqual(posts.length, 4, '변이가 무한 재시도를 만들지 못했다');   // 원본이면 3
});

test('변이②: 성공 시 타이머를 안 걷으면 재시도④ 가 잡는다', () => {
  const bad = rebuild(mutate('    onSuccess(){ stopTimer(); attempt = 0; left = 0; },',
    '    onSuccess(){ attempt = 0; left = 0; },', src));
  const clock = fakeClock(); const posts = [];
  const r = bad.createBootRetry({ post: () => posts.push(clock.at()), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  r.onError(true); clock.advance(5000); r.onSuccess(); clock.advance(60000);
  assert.ok(posts.length > 0, '변이가 유령 타이머를 만들지 못했다');
});

test('변이③: 수동이 시리즈를 리셋하면 재시도⑤ 가 잡는다', () => {
  const bad = rebuild(mutate('    manual(){ fire(); },', '    manual(){ attempt = 0; fire(); },', src));
  const clock = fakeClock(); const posts = [];
  const r = bad.createBootRetry({ post: () => posts.push(clock.at()), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  r.onError(true); r.manual(); r.onError(true); clock.advance(15000);
  assert.strictEqual(posts.length, 2, '변이가 리셋을 만들지 못했다');   // 원본이면 1(다음 지연이 30초)
});

/* ── ② 배선 계약 — 순수 로직이 맞아도 여기가 틀리면 화면에서는 안 돈다 ──── */

const wiring = {
  //  ②-1 재시도는 **회신 없는 명령**이라 hpost 로 간다. hostRequest 로 보내면 성공해도
  //       25초 뒤 '응답 시간 초과'로 끝나고, 사용자에게는 계속 실패로 보인다.
  retryPostsWithoutReply(app) {
    const b = bodyOf(app, 'function bootRetry(){');
    assert.ok(/hpost\(\s*\{\s*cmd\s*:\s*'reloadState'\s*\}\s*\)/.test(b),
      '재시도가 hpost({cmd:\'reloadState\'}) 로 가지 않는다');
    assert.ok(!/hostRequest\(/.test(b),
      '재시도가 hostRequest 로 간다 — reloadState 는 회신이 없어 25초 뒤 타임아웃으로만 끝난다(성공해도 실패로 보인다)');
  },

  //  ②-2 실패 상자에 [다시 시도] 버튼이 있고, 그 버튼이 스케줄러의 수동 경로를 부른다.
  errorBoxHasRetryButton(app) {
    const b = bodyOf(app, 'function ensureBootErrorBox(){');
    assert.ok(/dsErrorRetry/.test(b) && /다시 시도/.test(b), '실패 상자에 [다시 시도] 버튼이 없다');
    assert.ok(/bootRetry\(\)\.manual\(\)/.test(b), '버튼이 눌려도 아무것도 보내지 않는다');
    const e = bodyOf(app, 'window.__applyStateError = function(msg, opt){');
    assert.ok(/ensureBootErrorBox\(\)/.test(e) && /bootRetry\(\)\.onError\(/.test(e),
      '실패 통지가 상자·스케줄러로 이어지지 않는다');
    assert.ok(/opt && opt\.retryable === false/.test(e),
      '실패 통지가 retryable 을 읽지 않는다 — 로그인 없음까지 자동 재시도한다');
  },

  //  ②-3 성공하면 상자와 타이머를 **함께** 걷는다(부수 결함이었다 — 재시도로 살아난 화면 위에
  //       빨간 상자가 그대로 남아 있었다).
  successClearsBox(app) {
    const b = bodyOf(app, 'window.__applyState = function(json, meta){');
    assert.ok(/clearBootError\(\)/.test(b), '부팅 성공이 실패 상자를 걷지 않는다');
    const c = bodyOf(app, 'function clearBootError(){');
    assert.ok(/onSuccess\(\)/.test(c), '상자만 걷고 타이머를 안 걷는다 — 살아난 뒤에도 서버를 두드린다');
    assert.ok(/getElementById\('dsError'\)/.test(c) && /remove\(\)/.test(c), '타이머만 걷고 상자를 안 걷는다');
  },

  //  ②-4 호스트가 '기다리면 풀릴 실패인가'를 실제로 갈라서 넘긴다.
  hostSplitsRetryable(cs) {
    assert.ok(/private void ApplyStateError\(string msg, bool retryable = true\)/.test(cs),
      '호스트가 retryable 을 갈라 넘기지 않는다 — 웹은 전부 자동 재시도한다');
    assert.ok(/window\.__applyStateError\("\s*\+\s*JsonSerializer\.Serialize\(msg\)\s*\+\s*","\s*\+\s*opt/.test(cs),
      'JS 호출에 retryable 옵션이 실리지 않는다');
    for (const [needle, why] of [
      ['ApplyStateError("로그인 정보가 없습니다 — 로그인 후 다시 시작하세요", retryable: false)', '로그인 없음'],
      ['ApplyStateError("이 계정이 서버에 등록돼 있지 않습니다 — 관리자에게 문의하세요", retryable: false)', '미등록 사용자'],
    ]) assert.ok(cs.includes(needle),
      `${why} 을(를) 재시도 가능으로 넘긴다 — 몇 번을 다시 걸어도 같은 답이 오는데 서버만 두드린다`);
    //  연결 실패는 반대로 **재시도 대상**이어야 한다(기본값 true 를 그대로 쓴다).
    assert.ok(/ApplyStateError\("서버에 연결하지 못했습니다: " \+ ex\.Message\);/.test(cs),
      '연결 실패를 재시도 불가로 바꿨다 — 아침 부팅 순서 문제가 바로 이 경로다');
    assert.ok(/ApplyStateError\("서버에서 캘린더를 받지 못했습니다"\);/.test(cs),
      '조회 실패(오프라인)를 재시도 불가로 바꿨다');
  },
};

test('배선①: 재시도가 회신 없는 명령(hpost)으로 간다', () => wiring.retryPostsWithoutReply(src));
test('배선②: 실패 상자에 [다시 시도]가 있고 retryable 을 읽는다', () => wiring.errorBoxHasRetryButton(src));
test('배선③: 부팅 성공이 상자와 타이머를 함께 걷는다', () => wiring.successClearsBox(src));
test('배선④: 호스트가 재시도 가능/불가를 갈라 넘긴다', () => wiring.hostSplitsRetryable(mainwin));

test('변이④: 재시도를 hostRequest 로 되돌리면 배선① 이 실패한다', () => {
  const bad = mutate("    post: () => hpost({ cmd:'reloadState' }),", "    post: () => hostRequest('reloadState', {}, 25000),", src);
  assert.throws(() => wiring.retryPostsWithoutReply(bad), /hpost/);
});

test('변이⑤: 성공 시 상자를 안 걷으면 배선③ 이 실패한다', () => {
  const bad = mutate('    clearBootError();\n  }catch(e){', '  }catch(e){', src);
  assert.throws(() => wiring.successClearsBox(bad), /실패 상자를 걷지 않는다/);
});

test('변이⑥: 미등록 사용자를 재시도 대상으로 바꾸면 배선④ 가 실패한다', () => {
  const bad = mutate('ApplyStateError("이 계정이 서버에 등록돼 있지 않습니다 — 관리자에게 문의하세요", retryable: false);',
    'ApplyStateError("이 계정이 서버에 등록돼 있지 않습니다 — 관리자에게 문의하세요");', mainwin);
  assert.throws(() => wiring.hostSplitsRetryable(bad), /미등록 사용자/);
});
