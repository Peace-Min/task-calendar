// 설정창의 전역 스위치 2종 폐지 — 되살아나지 않는지 기계가 지킨다 (2026-07-30)
//
// ① 「일정 시작 알림」 전역 on/off  ★ 이게 진짜 문제였다
//    폼에서 '놓침 방지'를 골라도 전역이 꺼져 있으면 조용히 안 울렸다(무음 실패).
//    그래서 폼 힌트에 ⚠경고 + [알림 켜기] 버튼을 덧대야 했다 — 함정을 만들고 표지판을 세운 꼴.
//    알림은 시작시각이 있는 일정에만 가므로(실사용상 회의) 전역 스위치는 실익이 없다. 없앴다.
//    ★★ _remEnabled는 reminders.json의 enabled로 **영속**됐다. UI만 떼면 이미 꺼둔 사용자는
//       영원히 못 받고 켤 방법도 없다 → 로드에서 enabled를 **읽지 않는다**(무시 = 자동 구제).
//       단, version·acks(확인 이력)는 반드시 보존 — 깨지면 확인한 알림이 다시 뜬다.
//
// ② 「커밋 가져오기(Git/SVN) 전체 본문」 설정 미러
//    처음(2026-07-30)에는 설정창의 세 번째 미러만 지웠다. 2026-10-26 Git, SVN 기능 전량 삭제로
//    단일 소스 state.gitCommitBody 와 나머지 두 토글(일괄 불러오기, 이 날 커밋)까지 함께 사라졌다.
//
// 이 파일이 지키는 것은 두 가지다: **폐지된 것이 안 돌아온다** + **함께 지워지면 안 되는 것이 살아 있다**.
//
// ─────────────────────────────────────────────────────────────────────
// 2026-09-04 보강 — 변이 감사에서 이 파일의 '살아 있어야 하는 쪽' 단언이 전부
//   *문자열/선언이 소스 어딘가에 있는가* 수준이라 **심볼은 남기고 동작만 죽이는 변이**에
//   무력하다는 것이 실측됐다. 구체적으로 셋:
//     갭1  `if(state.gitCommitBody) prefs.setAttribute('gitCommitBody','1')` 의 가드를
//          오타(gitCommitBodyZZ)나 반전으로 죽여도 저장소 896건 중 0건이 반응했다.
//          → 실제 코드를 잘라 돌리는 **XML 왕복 시험**을 추가했다(가드 오타·반전·로드측 비교값
//            셋 다 같은 시험 하나로 덮인다).
//     갭2  알림 스케줄 파이프라인은 `extractFunction` 존재 검사뿐이라 본문을 통째로 비워도 통과했다.
//          → remindMinsFor→buildReminderOccs→pushReminders 를 **실제로 실행**해
//            발생 목록이 호스트로 나가는지 본다. remSetUi/remReadValue 도 왕복으로 덮는다.
//     갭3  토글 배선 단언이 근접성만 봐서 `setGitCommitBody(false)` 로 고정해도 통과했다.
//          → 인자까지 못박고, 공유 setter·동기화를 실행해 단일 소스를 실제로 읽고 쓰는지 본다.
//   각 보강 아래에는 그 단언이 정말 우는지 증명하는 test('변이…') 가 따라붙는다.
// ─────────────────────────────────────────────────────────────────────
import { test, assert, loadAppSource, extractFunction, readText } from './harness.mjs';

const src        = loadAppSource();
const reminders  = readText(new URL('../widget/Reminders.cs', import.meta.url));
const mainWindow = readText(new URL('../widget/MainWindow.xaml.cs', import.meta.url));

// ── 공용 도우미 ──────────────────────────────────────────────────────

// 변이 주입 — 원형이 남지 않게 치환한다. 치환이 안 되면(표식 증발) 변이 시험 자체가 무효이므로 실패시킨다.
function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${String(from).slice(0, 90)}`);
  return out;
}

// 소스에서 [from, to) 구간을 원문 그대로 잘라낸다. 표식이 사라지면 조용히 통과하지 않고 큰 소리로 실패한다.
function sliceUpTo(source, from, to, what) {
  const i = source.indexOf(from);
  assert.ok(i >= 0, `${what}: 시작 표식을 못 찾음 — ${from}`);
  const j = source.indexOf(to, i);
  assert.ok(j > i, `${what}: 끝 표식을 못 찾음 — ${to}`);
  return source.slice(i, j);
}

// 계약을 소스의 함수로 둔다 — 같은 검사를 '변이된 소스'에 다시 먹여 정말 우는지 증명하기 위함(boot-retry.test.mjs 관례).
const checks = {};

// ── ① 커밋 전체 본문: 2026-10-26 Git, SVN 기능 전량 삭제로 설정 미러뿐 아니라 단일 소스와 두 토글까지 사라졌다 ──────────
//    예전 이 자리는 '미러만 지우고 나머지는 살아 있다'를 지켰다(갭1, 갭3 보강 포함). 이제는 전부 없어야 한다.
//    되살아나면 커밋 가져오기 일부가 돌아온 것이다(docs/GIT-SVN-REMOVAL.md §4).
const GIT_BODY_GONE = ['gitBodyChk', 'bgBodyChk', 'dgBodyChk', 'gitCommitBody', 'setGitCommitBody', 'syncGitBodyChecks',
  "hostRequest('gitlog'", '커밋 가져오기 (Git/SVN)'];
//  옛 저장본의 gitCommitBody 키를 지우는 한 곳(dropLegacyGit)은 예외다. 그 함수는 '읽지 않고 버린다'를 하는 자리다.
checks.gitBodyGone = (source) => {
  let code = source;
  try { code = code.replace(extractFunction(code, 'dropLegacyGit'), ''); } catch (_) { /* 함수가 없어도 검사는 그대로 */ }
  for (const t of GIT_BODY_GONE) assert.ok(!code.includes(t), `커밋 본문 설정의 흔적이 되살아났다: ${t}`);
};

test('커밋 본문: 설정 미러, 단일 소스(gitCommitBody), 공유 setter, 두 토글, gitlog 호출이 흔적 없이 사라졌다', () => checks.gitBodyGone(src));

test('변이: 공유 setter 를 되살리면 제거 계약이 실패한다', () => {
  const bad = mutate('function qaRemResync(){', 'function setGitCommitBody(on){ if(state){ state.gitCommitBody = !!on; save(); } }\nfunction qaRemResync(){', src);
  assert.throws(() => checks.gitBodyGone(bad), /setGitCommitBody|gitCommitBody/);
});

test('변이: XML 저장에 gitCommitBody 속성을 되살리면 제거 계약이 실패한다', () => {
  const bad = mutate("  const fmtPrefs = normalizeReportFormatPrefs(state);",
    "  if(state.gitCommitBody) prefs.setAttribute('gitCommitBody', '1');\n  const fmtPrefs = normalizeReportFormatPrefs(state);", src);
  assert.throws(() => checks.gitBodyGone(bad), /gitCommitBody/);
});

// ── ② 시작 알림 전역 스위치: 웹 층에서 완전히 사라졌다 ──────────────────────────────

test('알림: 전역 스위치 UI·상태·브리지가 웹에서 흔적 없이 사라졌다', () => {
  for (const dead of ['remEnabled', '_remGlobalOn', 'reminderToggle', '__setReminders', 'data-remenable']) {
    assert.ok(!src.includes(dead), `폐지된 전역 스위치 잔재가 남아 있다: ${dead}`);
  }
  assert.ok(!/시작 알림 켜기/.test(src), '설정 섹션 체크박스 라벨이 남아 있다');
  assert.ok(!/일정 시작 알림 <span/.test(src), '설정 섹션 제목이 남아 있다');
});

test('알림: 폼 힌트의 ⚠경고·[알림 켜기] 분기가 사라졌다(경고할 대상이 없다)', () => {
  assert.ok(!/시작 알림이 꺼져 있어/.test(src), '경고 문구가 남아 있다');
  assert.ok(!src.includes('rem-warn'), '경고 전용 스타일(.rem-warn)이 남아 있다');
  assert.ok(!src.includes('알림 켜기'), '켜기 액션 라벨이 남아 있다');
  const fn = extractFunction(src, 'remRowSync');
  assert.ok(!fn.includes('insertAdjacentHTML'), 'remRowSync가 아직 힌트에 마크업을 덧붙인다');
  assert.ok(/hint\.textContent = remHint\(/.test(fn), '힌트 갱신 자체가 사라졌다(경고만 걷어내야 한다)');
});

// ★ 부수피해 방지 — 알림 '기능'은 남는다. 지운 건 전역 킬 스위치뿐이다.
//  (예전 기록 창의 #fRem* 행은 2026-10-26 Git 기능과 함께 기록 창째 없앴다. 일정 입력은 한 화면 폼 하나다.)
test('알림: 일정별 미리알림 UI(한 화면 폼 3버튼)가 그대로다', () => {
  for (const id of ['qaRemSeg', 'qaRemUnit', 'qaRemNum', 'qaRemHint', 'qaRemBlock']) {
    assert.ok(new RegExp('id="' + id + '"').test(src), `미리알림 행 요소가 사라졌다: #${id}`);
  }
  for (const pfx of ['qaRemSeg']) {
    const seg = src.slice(src.indexOf('id="' + pfx + '"'), src.indexOf('id="' + pfx + '"') + 700);
    for (const mode of ['def', 'none', 'cust']) {
      assert.ok(seg.includes('data-remmode="' + mode + '"'), `#${pfx}에 '${mode}' 버튼이 없다`);
    }
  }
});

checks.reminderPipelineDeclared = (source) => {
  for (const fn of ['remindMinsFor', 'pushReminders', 'buildReminderOccs', 'qaRemResync',
                    'remRowSync', 'remSetUi', 'remReadValue']) {
    assert.doesNotThrow(() => extractFunction(source, fn), `함수가 사라졌다: ${fn}`);
  }
  assert.ok(/const REMIND_DEFAULT = \[60, 30, 10, 5\]/.test(source), '기본 사다리 상수가 사라졌다');
  assert.ok(/const _remState = /.test(source), '폼별 미리알림 상태(_remState)가 사라졌다');
  assert.ok(/cmd:'reminderSync'/.test(source), '호스트로 보내는 reminderSync 브리지가 사라졌다');
  // qaRemResync는 경고 표시 말고도 활성/흐림 반영 역할이 있다 — 호출부가 남아야 의미가 있다.
  assert.ok((source.match(/qaRemResync\(\)/g) || []).length >= 3, 'qaRemResync 호출부가 함께 지워졌다');
  // ★ 갭2(값싼 층) — 선언 존재만으로는 '빈 껍데기'를 못 잡는다. 재동기화 함수는 아래 실행 시험이
  //   닿지 않으므로(행 UI는 DOM 의존) 최소한 무엇을 부르는지까지 못박는다 — 활성/흐림 반영이 통째로 죽는 회귀 차단.
  assert.ok(/remRowSync\('qa',/.test(extractFunction(source, 'qaRemResync')),
            'qaRemResync가 remRowSync를 부르지 않는다(빈 껍데기)');
  assert.ok(/buildReminderOccs\(\)/.test(extractFunction(source, 'pushReminders')),
            'pushReminders가 빈 껍데기다(발생 목록을 만들지 않는다)');
  assert.ok(/remindMinsFor\(/.test(extractFunction(source, 'buildReminderOccs')),
            'buildReminderOccs가 리드타임 해석(remindMinsFor)을 더 이상 호출하지 않는다');
};

test('알림: 스케줄 파이프라인(remindMinsFor·pushReminders·reminderSync)과 재동기화 함수가 살아 있다', () =>
  checks.reminderPipelineDeclared(src));

test('변이: qaRemResync 본문을 비우면 재동기화 계약이 실패한다', () => {
  const bad = mutate(extractFunction(src, 'qaRemResync'), 'function qaRemResync(){ return; }', src);
  assert.throws(() => checks.reminderPipelineDeclared(bad), /qaRemResync가 remRowSync를 부르지 않는다/);
});

// ★★ 갭2의 본 수리 — 파이프라인을 **실제로 돌린다**.
//    remindMinsFor→buildReminderOccs→pushReminders 를 원문 그대로 이어붙여 스텁 위에서 실행하고,
//    호스트로 나가는 발생 목록을 검사한다. 셋 중 어느 하나라도 껍데기가 되면 이 시험이 운다.
function runReminderPipeline(source, entries) {
  const sent = [];
  const body = extractFunction(source, 'remindMinsFor') + '\n' +
               extractFunction(source, 'buildReminderOccs') + '\n' +
               extractFunction(source, 'pushReminders') + '\n' +
               'pushReminders();';
  const m = /const REMIND_DEFAULT = (\[[^\]]*\])/.exec(source);
  assert.ok(m, 'REMIND_DEFAULT 선언을 찾지 못했다');
  new Function('HOST', 'state', 'REMIND_DEFAULT', 'todayYmd', 'addDays', 'catById', 'validColor',
               'expandOccurrences', 'reminderTheme', 'hpost', body)(
    true,                                   // HOST=true(위젯 안) — 웹 미리보기에서는 알림을 안 보낸다
    { entries },
    JSON.parse(m[1]),
    () => '2026-09-04',
    () => '2026-09-06',
    () => null,                             // catById — 과제 없음
    () => '#888888',                        // validColor
    (e) => [{ _occStart: e.date }],         // expandOccurrences — 반복 전개는 여기서 관심사가 아니다
    () => 'light',                          // reminderTheme
    (msg) => { sent.push(msg); },           // hpost — 호스트 브리지 캡처
  );
  return sent;
}

// ★ 제외 사유가 서로를 가리지 않게 케이스를 분리한다 — 종일 케이스에 startTime 을 남겨 두지 않으면
//   `if(e.allDay) continue;` 를 지워도 뒤의 시작시각 정규식이 대신 걸러서 변이가 조용히 통과한다.
//   (실데이터에서도 종일로 바꾼 일정에 옛 startTime 이 남아 있을 수 있다 — 그게 정확히 이 가드의 존재 이유다.)
const REM_ENTRIES = [
  { id: 'e-def',    date: '2026-09-04', title: '주간회의', allDay: false, startTime: '9:30',  endTime: '10:30', location: '3층', categoryId: null, remind: null },
  { id: 'e-15',     date: '2026-09-04', title: '점검',     allDay: false, startTime: '14:00', endTime: '',      location: '',    categoryId: null, remind: 15 },
  { id: 'e-off',    date: '2026-09-04', title: '무알림',   allDay: false, startTime: '16:00', endTime: '',      location: '',    categoryId: null, remind: 0 },
  { id: 'e-allday', date: '2026-09-04', title: '종일',     allDay: true,  startTime: '13:00', endTime: '',      location: '',    categoryId: null, remind: null },
  { id: 'e-notime', date: '2026-09-04', title: '시각없음', allDay: false, startTime: '',      endTime: '',      location: '',    categoryId: null, remind: null },
];

checks.reminderPipelineRuns = (source) => {
  const sent = runReminderPipeline(source, REM_ENTRIES);
  assert.strictEqual(sent.length, 1,
    `pushReminders가 호스트로 아무것도 보내지 않았다(파이프라인이 빈 껍데기다) — 전송 ${sent.length}건`);
  assert.strictEqual(sent[0].cmd, 'reminderSync', '호스트로 보내는 명령이 reminderSync가 아니다');
  assert.ok(sent[0].theme, '알림 카드 테마가 함께 가지 않는다');

  const occ = sent[0].occ;
  assert.ok(Array.isArray(occ) && occ.length > 0,
            'buildReminderOccs가 발생 목록을 만들지 않는다(알림이 하나도 예약되지 않는다)');
  const by = Object.fromEntries(occ.map((o) => [o.seriesId, o]));

  // 기본(remind 미설정) = 기본 사다리가 그대로 실려야 한다 — remindMinsFor가 죽으면 여기서 운다.
  assert.ok(by['e-def'], '기본 미리알림 일정이 발생 목록에서 빠졌다');
  assert.strictEqual(by['e-def'].mins, '60,30,10,5', '기본 사다리(60·30·10·5)가 호스트로 가지 않는다');
  assert.strictEqual(by['e-def'].startTime, '09:30', '시작시각 0패딩이 사라졌다(호스트 파싱 실패)');
  assert.strictEqual(by['e-def'].occStart, '2026-09-04', '발생 시작일이 실리지 않았다');

  // 직접 지정(n분 전 1회)
  assert.ok(by['e-15'], '직접 지정(15분 전) 일정이 발생 목록에서 빠졌다');
  assert.strictEqual(by['e-15'].mins, '15', 'n분 전 1회 설정이 사다리로 뭉개졌다');

  // 제외 규칙 — 0=알림 없음, 종일·시작시각 없음은 애초에 대상이 아니다(과잉 통과 방지).
  assert.ok(!by['e-off'], "remind=0('알림 없음')인데 알림이 예약됐다");
  assert.ok(!by['e-allday'], '종일 일정에 알림이 예약됐다(종일 가드가 죽었다)');
  assert.ok(!by['e-notime'], '시작시각 없는 일정에 알림이 예약됐다(호스트로 빈 시각이 나간다)');
};

test('알림: 스케줄 파이프라인이 실제로 발생 목록을 만들어 호스트로 보낸다(실행)', () =>
  checks.reminderPipelineRuns(src));

test('변이: pushReminders 본문을 비우면 파이프라인 실행 계약이 실패한다', () => {
  const bad = mutate(extractFunction(src, 'pushReminders'), 'function pushReminders(){ return; }', src);
  assert.throws(() => checks.reminderPipelineRuns(bad), /호스트로 아무것도 보내지 않았다/);
});

test('변이: buildReminderOccs 를 빈 껍데기로 만들면 파이프라인 실행 계약이 실패한다', () => {
  const bad = mutate(extractFunction(src, 'buildReminderOccs'), 'function buildReminderOccs(){ return []; }', src);
  assert.throws(() => checks.reminderPipelineRuns(bad), /발생 목록을 만들지 않는다/);
});

test('변이: remindMinsFor 가 항상 null 을 주면(전 일정 무음) 파이프라인 실행 계약이 실패한다', () => {
  const bad = mutate(extractFunction(src, 'remindMinsFor'), 'function remindMinsFor(e){ return null; }', src);
  assert.throws(() => checks.reminderPipelineRuns(bad), /발생 목록을 만들지 않는다/);
});

test("변이: remindMinsFor 가 remind=0('알림 없음')을 기본 사다리로 흡수하면 실행 계약이 실패한다", () => {
  const bad = mutate("  if(r === 0) return null;                         // 명시적 '알림 없음'\n", '', src);
  assert.throws(() => checks.reminderPipelineRuns(bad), /알림이 예약됐다/);
});

test('변이: buildReminderOccs 가 종일 일정을 거르지 않으면 실행 계약이 실패한다', () => {
  const bad = mutate('    if(e.allDay) continue;\n', '', src);
  assert.throws(() => checks.reminderPipelineRuns(bad), /종일 가드가 죽었다/);
});

test('변이: buildReminderOccs 가 시작시각 유무를 안 보면 실행 계약이 실패한다', () => {
  const bad = mutate("    if(!/^\\d{1,2}:\\d{2}$/.test(e.startTime || '')) continue;   // 명시적 시작시각만\n", '', src);
  assert.throws(() => checks.reminderPipelineRuns(bad), /빈 시각이 나간다/);
});

test('변이: 시작시각 0패딩을 없애면 실행 계약이 실패한다(호스트 파싱 깨짐)', () => {
  const bad = mutate("const st = ('0' + e.startTime).slice(-5);", 'const st = e.startTime;', src);
  assert.throws(() => checks.reminderPipelineRuns(bad), /0패딩이 사라졌다/);
});

// ── ②-a 미리알림 행 컨트롤(remSetUi/remReadValue)도 **실제로 돌린다** ─────
//   존재 검사만 있으면 두 함수를 비워도 통과한다 — 그러면 폼을 다시 열 때 설정이 def 로 리셋되고
//   저장 시 null(기본)만 나간다(일정별 알림 설정이 조용히 증발). 저장값→UI→저장값 왕복으로 못박는다.
function mkRemRowRoundTrip(source) {
  const stateDecl = /const _remState = \{[^\n]*\};/.exec(source);
  assert.ok(stateDecl, '_remState 선언(한 줄)을 찾지 못했다');
  const max = /const REMIND_MAX = (\d+)/.exec(source);
  assert.ok(max, 'REMIND_MAX 선언을 찾지 못했다');
  const body = extractFunction(source, 'normRemind') + '\n' +
               extractFunction(source, 'remindToUi') + '\n' +
               extractFunction(source, 'uiToRemind') + '\n' +
               stateDecl[0] + '\n' +
               extractFunction(source, 'remSetUi') + '\n' +
               extractFunction(source, 'remReadValue') + '\n' +
               'return function(pfx, r){ remSetUi(pfx, r); return remReadValue(pfx); };';
  const els = { '#qaRemNum': { value: '' } };
  return new Function('$', 'REMIND_MAX', body)((sel) => els[sel] || null, Number(max[1]));
}

checks.remRowRoundTrip = (source) => {
  const trip = mkRemRowRoundTrip(source);
  for (const r of [null, 0, 15, 30, 120, 2880, 10080]) {
    const got = trip('qa', r);
    assert.strictEqual(got, r,
      `미리알림 행 왕복 손실: 저장값 ${r} 을 폼에 세팅했다가 다시 읽으니 ${got} 이다(폼 재열림에 설정 증발)`);
  }
  // 이어서 세팅해도 앞 값이 남지 않는다(직접 120분 다음 '알림 없음').
  //  (예전 기록 창 'f' 와의 독립 검사는 2026-10-26 기록 창과 함께 없앴다.)
  assert.strictEqual(trip('qa', 120), 120, '한 화면 폼의 미리알림 왕복이 깨졌다');
  assert.strictEqual(trip('qa', 0), 0, "앞 값이 남았다(직접 120분 뒤 '알림 없음'이 덮이지 않는다)");
};

test('알림: 미리알림 행 왕복 — remSetUi→remReadValue 가 저장값을 보존한다(실행)', () =>
  checks.remRowRoundTrip(src));

test('변이: remSetUi 본문을 비우면 행 왕복 계약이 실패한다', () => {
  const bad = mutate(extractFunction(src, 'remSetUi'), 'function remSetUi(pfx, r){ return; }', src);
  assert.throws(() => checks.remRowRoundTrip(bad), /미리알림 행 왕복 손실/);
});

test('변이: remReadValue 가 항상 null 을 주면(전부 기본으로 저장) 행 왕복 계약이 실패한다', () => {
  const bad = mutate(extractFunction(src, 'remReadValue'), 'function remReadValue(pfx){ return null; }', src);
  assert.throws(() => checks.remRowRoundTrip(bad), /미리알림 행 왕복 손실/);
});

test('변이: remSetUi 가 단위를 버리면(항상 분) 행 왕복 계약이 실패한다', () => {
  const bad = mutate('_remState[pfx] = { mode:u.mode, unit:u.unit };',
                     '_remState[pfx] = { mode:u.mode, unit:1 };', src);
  assert.throws(() => checks.remRowRoundTrip(bad), /미리알림 행 왕복 손실/);
});

// ── ③ 호스트(Reminders.cs) — 여기가 핵심. 영속된 enabled를 무시해야 기존 사용자가 구제된다 ──

test('호스트: 킬 스위치 필드·게이트·통지가 사라졌다', () => {
  for (const dead of ['_remEnabled', 'SetRemindersEnabled', '__setReminders']) {
    assert.ok(!reminders.includes(dead), `Reminders.cs에 킬 스위치 잔재가 남아 있다: ${dead}`);
  }
  assert.ok(!/case "reminderToggle":/.test(mainWindow), 'MainWindow에 reminderToggle 브리지가 남아 있다');
  assert.ok(/case "reminderSync":/.test(mainWindow), 'reminderSync 브리지까지 함께 지워졌다');
});

// ★★ 구제 경로 — 예전에 알림을 꺼둔 사용자의 reminders.json에는 enabled:false가 들어 있다.
//    그 값을 다시 읽는 순간 그 사람은 켤 UI도 없이 영영 알림을 못 받는다. 읽지도 쓰지도 않아야 한다.
test('호스트: reminders.json의 enabled를 읽지도 쓰지도 않는다(기존 OFF 사용자 자동 구제)', () => {
  assert.ok(!reminders.includes('"enabled"'), 'enabled 키를 아직 다룬다(기존 OFF 사용자가 영구 침묵)');
  assert.ok(!/TryGetProperty\("enabled"/.test(reminders), '로드에서 enabled를 읽는다');
  assert.ok(!/\["enabled"\]/.test(reminders), '저장에서 enabled를 쓴다');
});

test('호스트: 저장 스키마에서 version과 acks(확인 이력)는 보존된다', () => {
  const save = reminders.slice(reminders.indexOf('private void RemSave()'));
  assert.ok(/\["version"\] = 1/.test(save), 'version이 사라졌다(스키마 판별 불가)');
  assert.ok(/\["acks"\] = _remAcks/.test(save), 'acks가 사라졌다 — 확인한 알림이 다시 뜬다');
  const load = reminders.slice(reminders.indexOf('private void RemLoad()'), reminders.indexOf('private void RemSave()'));
  assert.ok(/TryGetProperty\("acks"/.test(load), '로드가 acks를 읽지 않는다 — 재시작마다 다시 울린다');
});

test('호스트: 알림 타이머는 조건 없이 시작한다', () => {
  const init = reminders.slice(reminders.indexOf('private void ReminderInit()'),
                               reminders.indexOf('private void RemSync('));
  const starts = init.split('\n').filter((l) => l.includes('_remTimer.Start()'));
  assert.strictEqual(starts.length, 1, `ReminderInit의 타이머 시작은 1곳이어야 한다(현재 ${starts.length})`);
  assert.ok(!/\bif\s*\(/.test(starts[0]), `타이머 시작이 조건에 걸려 있다: ${starts[0].trim()}`);
  // RemTick의 조기 return 게이트도 없어야 한다(첫 문장이 곧바로 시각 계산).
  const tick = reminders.slice(reminders.indexOf('private void RemTick()'),
                               reminders.indexOf('private void ShowOrUpdate('));
  assert.ok(/RemTick\(\)\s*\{\s*var now = DateTime\.Now;/.test(tick), 'RemTick 앞에 게이트가 남아 있다');
});

// ── ④ 범위 이탈 방지 — 이번 작업에서 손대지 않기로 한 표면들 ────────────────────────

test('범위: 계정 표면과 과제 DB 섹션은 살아 있다(설정창 정리의 부수피해 아님)', () => {
  // ★ 계약 갱신(2026-08-03): 계정은 '지워진' 게 아니라 상단바 👤 「사용자 정보」 모달로 승격됐다.
  //   이 테스트가 지키려는 것(설정창 정리의 부수피해로 계정을 잃지 않았는가)은 그대로고, 확인할 id 만 옮겼다.
  for (const id of ['userModal', 'usHint', 'usName', 'usTitle', 'usOrg', 'usLogout', 'usMsg']) {
    assert.ok(new RegExp('id="' + id + '"').test(src), `사용자 정보 모달의 요소가 사라졌다: #${id}`);
  }
  for (const dead of ['accountSection', 'acctHint', 'acctName', 'acctTitle', 'acctOrg', 'acctLogout', 'acctMsg']) {
    assert.ok(!src.includes(dead), `옛 설정창 계정 섹션의 잔재가 남아 있다: ${dead}(옮긴 게 아니라 복제됐다)`);
  }
  for (const fn of ['updateUserUi', 'applyUser', 'submitLogout']) {
    assert.ok(src.includes(fn), `계정 관련 함수가 사라졌다: ${fn}`);
  }
  assert.ok(/id="dbSection"/.test(src), '과제 DB 섹션이 사라졌다');
});
