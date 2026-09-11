// Layer 1 — 백업 스크립트(db/deploy/backup-taskmgr.ps1 / .cmd)의 **계약**을 소스 텍스트만으로
// 검사한다. DB 도 jsdom 도 필요 없다(두 파일을 읽어 파싱할 뿐). mysqldump 를 돌리지 않는다.
//
// 왜 있나
//   restore-guards.test.mjs 가 이 저장소의 첫 배포 스크립트 계약이었는데, 정작 그 짝인
//   **백업** 쪽은 계약이 0 이었다(db/deploy 의 PowerShell 스크립트 중 migrate.ps1 만 1).
//   순서가 거꾸로다 — 백업은 복구보다 먼저 있어야 하는 것이고, 백업이 틀리면 복구할 것
//   자체가 없다. 게다가 이 스크립트는 -Install 로 **작업 스케줄러에 등록되어 무인으로** 돈다.
//   무인 경로는 조용히 썩는다.
//
//   여기서 잠그는 것은 '백업이 잘 되는가' 가 아니라(그건 실제 실행이 한다),
//   **backup-taskmgr 가 가진 안전 계약이 사라지지 않았는가** 다:
//     ① 비밀번호를 `-p<비번>` / `--password=` 로 명령줄에 싣는 자리가 없다
//     ② .ps1 과 .cmd 의 종료코드 표가 글자 그대로 같다
//     ③ 표에 적힌 숫자와 .ps1 이 **실제로 내는** 종료코드가 일치한다
//     ④ .cmd 에 비ASCII 가 한 글자도 없다
//     ⑤ mysqldump 인자 넷(--no-tablespaces · --single-transaction · --routines · --triggers)이 살아 있다
//     ⑥ 덤프 검증이 '개수' 가 아니라 '이름 집합' 을 대조한다
//     ⑦ 덤프 전에 SHOW GRANTS 로 TRIGGER 보유를 확인하는 **선검사**가 살아 있다
//     ⑧ 사람이 준 경로를 -LiteralPath 로 보고, Resolve-Path 결과를 .ProviderPath 로 받는다
//
//   ⑤⑥⑦ 은 취향이 아니라 실측에서 나온 계약이다(backup-taskmgr.ps1 머리말):
//     · --no-tablespaces 를 빼면 mysqldump 가 INFORMATION_SCHEMA.FILES 를 읽으려 하고,
//       그건 **전역 PROCESS 권한**을 요구한다 — '읽기 전용 백업 계정' 의 취지가 무너진다.
//     · --triggers / --routines 를 빼면 트리거·루틴이 **조용히** 빠진다.
//     · SELECT 만 가진 계정으로 뜨면 트리거가 통째로 빠진 채 **exit 0** 이다(실측:
//       root 6404B/트리거3 vs SELECT만 3377B/트리거0). 종료코드는 '명령이 안 죽었다' 만 말한다.
//     · 그런데 대조만으로도 부족하다 — information_schema.TRIGGERS 도 TRIGGER 권한으로
//       걸러지므로 DB 쪽도 0 으로 보여 '0 == 0' 으로 통과해 버린다. 그래서 ⑦ 이 필요하다.
//       ⑦ 이 두 겹 중 **실제로 걸러 내는 겹**이다.
//
// 검사 함수(checks)를 테스트와 변이 주입이 공유한다 — 검사가 실제로 잡는지 증명하기 위해서다.
// 공용 기계(마스커·종료코드 표 파서·변이 주입기)는 tests/ps-guard-lib.mjs 에 있다.
// restore-guards.test.mjs 와 **같은 마스커·같은 비번 규칙**을 쓴다(주석·문자열 처리가 갈리면
// 두 스크립트에 서로 다른 잣대를 대는 셈이 된다).
import { test, assert } from './harness.mjs';
import {
  loadDeploy, maskPs, passwordOnCommandLineHits,
  exitCodeTable, exitCodesInTable, exitCodesUsed, mutate, nonAsciiLines,
} from './ps-guard-lib.mjs';

const PS1 = 'backup-taskmgr.ps1';
const CMD = 'backup-taskmgr.cmd';
const psSrc = loadDeploy(PS1);
const cmdSrc = loadDeploy(CMD);

// mysqldump 에서 빠지면 안 되는 인자. 하나하나 이유가 머리말에 적혀 있다(위 ⑤ 절).
const REQUIRED_DUMP_ARGS = ['--single-transaction', '--no-tablespaces', '--routines', '--triggers'];

// ══ 검사 함수(테스트 + 변이 주입이 같은 함수를 쓴다) ═══════════════════
const checks = {
  // ① 비밀번호를 명령줄에 싣지 않는다.
  //    Windows 는 같은 사용자면 다른 프로세스의 명령줄을 그대로 읽는다(머리말의 실측).
  //    주간 백업은 무인이라 자격이 어딘가 남아야 하므로, 남기는 자리를 '아무나 읽는 명령줄' 이
  //    아니라 '권한을 좁힌 .cnf' 로 고정한다.
  noPasswordOnCommandLine(ps) {
    const bad = passwordOnCommandLineHits(ps);
    assert.deepStrictEqual(bad, [],
      `비밀번호를 명령줄로 넘기는 자리가 생겼다: ${bad.join(' , ')} — ` +
      '자격은 --defaults-extra-file(보호된 .cnf)로만 넘겨야 한다');
    // 없는 것을 확인하는 검사는 '아무 데도 안 보고 있는' 상태와 구별되지 않는다.
    // 그래서 정본 경로가 실재하는지도 함께 본다.
    assert.ok(/--defaults-extra-file=\$CnfPath/.test(ps),
      '자격을 .cnf 로 넘기는 자리가 없다 — 검사가 볼 대상 자체가 사라졌다');
    // .cnf 를 못 찾으면 만드는 법(icacls 포함)을 찍고 코드 2 로 끝내야 한다 —
    // 안내 없이 죽으면 무인 담당자는 원인을 모른다.
    assert.ok(/icacls/.test(ps),
      '.cnf 권한을 좁히는 icacls 안내가 사라졌다 — 평문 비밀번호 파일이 열린 채 방치된다');
  },

  // ② .ps1 과 .cmd 의 종료코드 표가 글자 그대로 같다.
  //    .cmd 는 비ASCII 를 담을 수 없어(④) 한글 표를 복사할 수 없다. 그래서 '기계가 대조할
  //    ASCII 사본' 을 양쪽에 한 벌씩 두고 그것을 맞춘다(restore-taskmgr 와 같은 방식).
  exitCodeTablesMatch(ps, cmd) {
    const a = exitCodeTable(ps, false);
    const b = exitCodeTable(cmd, true);
    assert.ok(a.length >= 8, `종료코드 표가 너무 짧다(${a.length}줄) — 표가 비면 대조가 성립하지 않는다`);
    assert.strictEqual(a.length, b.length,
      `종료코드 표의 줄 수가 다르다(.ps1 ${a.length} / .cmd ${b.length})`);
    for (let i = 0; i < a.length; i++) {
      assert.strictEqual(a[i], b[i],
        `종료코드 표 ${i + 1}번째 줄이 다르다\n  .ps1: ${a[i]}\n  .cmd: ${b[i]}`);
    }
    // 한 줄에 코드 하나. 옛 .cmd 는 "0 ok | 1 backup failed …" 처럼 두 코드를 `|` 로 묶어
    // 적었는데, 그 형식은 표 테두리로 오해되고(실제로 오판이 났다) 기계 대조도 어렵게 만든다.
    // 계약을 그 형식에 맞추는 대신 형식을 고쳤다 — exitCodesInTable 이 그것을 강제한다.
    const codes = exitCodesInTable(a);
    assert.deepStrictEqual(codes, [...codes].sort((x, y) => x - y),
      `종료코드 표가 오름차순이 아니다: ${codes.join(',')}`);
    assert.strictEqual(new Set(codes).size, codes.length,
      `종료코드 표에 같은 코드가 두 번 나온다: ${codes.join(',')}`);
  },

  // ③ 표의 숫자와 .ps1 이 **실제로 내는** 종료코드가 일치한다.
  //    표만 보면 '표는 맞는데 코드가 딴 값을 낸다' 를 못 잡는다.
  //    restore-taskmgr.ps1 은 $EXIT_* 상수를 쓰지만 이 파일은 exit / Die 자리에 숫자를 직접
  //    적는다. 그래서 상수가 아니라 **실제 자리**를 센다(둘 다 exitCodesUsed 가 처리한다).
  tableMatchesActualExits(ps) {
    const table = exitCodesInTable(exitCodeTable(ps, false));
    const used = exitCodesUsed(ps);
    assert.ok(used.length > 0, '종료코드를 내는 자리를 하나도 못 찾았다 — 파서가 헛돌았다');
    assert.deepStrictEqual(used, table,
      `표의 코드 목록과 실제로 내는 코드가 다르다 (실제 ${used.join(',')} / 표 ${table.join(',')}) — ` +
      '표는 호출자와의 계약이다. 표에 없는 코드를 내면 무인 호출자가 그것을 성공으로 셀 수 있다');
  },

  // ④ .cmd 에 비ASCII 가 한 글자도 없다.
  //    그 파일 머리말이 'ASCII ONLY' 라고 못 박고 이유까지 적어 뒀다: cmd.exe 는 배치를
  //    **바이트 오프셋**으로 재개하는데, 코드페이지 65001 에서 다바이트 글자가 섞이면
  //    재개 위치를 잘못 계산해 주석 조각을 명령으로 실행한다(init-calendar.cmd 로 실측).
  cmdIsPureAscii(cmd) {
    const bad = nonAsciiLines(cmd);
    assert.deepStrictEqual(bad, [],
      `backup-taskmgr.cmd 에 비ASCII 가 있다 — cmd.exe 가 코드페이지 65001 에서 배치 재개 위치를 ` +
      `잘못 계산해 주석 조각을 명령으로 실행한다:\n${bad.join('\n')}`);
    // 'ASCII ONLY' 라는 못이 박혀 있어야 다음 사람이 한글을 넣지 않는다.
    assert.ok(/ASCII ONLY/.test(cmd),
      "'ASCII ONLY' 라는 못이 사라졌다 — 이유를 모르면 다음 사람이 한글을 넣는다");
  },

  // ⑤ mysqldump 인자 넷이 살아 있다(취향이 아니라 계약이다 — 위 머리말 참조).
  dumpArgsIntact(ps) {
    const code = maskPs(ps);   // 주석에 적힌 인자 이름은 세지 않는다. 실제 호출 자리를 본다.
    const m = /&\s*\$mysqldump\s*\(MyArgs\)([^\n]*)/.exec(code);
    assert.ok(m, 'mysqldump 를 호출하는 자리를 찾지 못했다 — 백업 본체가 사라졌다');
    const call = m[1];
    const missing = REQUIRED_DUMP_ARGS.filter((a) => !call.includes(`"${a}"`));
    assert.deepStrictEqual(missing, [],
      `mysqldump 인자가 빠졌다: ${missing.join(' , ')}\n` +
      '  --no-tablespaces  : 빼면 INFORMATION_SCHEMA.FILES 를 읽으려 해 전역 PROCESS 권한이 필요해진다\n' +
      '  --single-transaction: 빼면 LOCK TABLES 권한이 필요해지고 스냅샷 일관성이 깨진다\n' +
      '  --routines / --triggers: 빼면 루틴·트리거가 조용히 빠진다(그리고 exit 0 이다)');
    // 대상 DB 인자를 반드시 준다(안 주면 뜨는 범위가 달라진다).
    assert.ok(/\$DbName\s*$/.test(call.trim()),
      'mysqldump 호출의 마지막 인자가 $DbName 이 아니다 — 뜨는 범위가 달라진다');
    // 이유가 사라지면 다음 사람이 이 인자들을 취향으로 오해하고 지운다.
    assert.ok(/전역 PROCESS 권한/.test(ps),
      '--no-tablespaces 의 이유(전역 PROCESS 권한)가 머리말에서 사라졌다');
  },

  // ⑥ 덤프 검증이 '개수' 가 아니라 '이름 집합' 을 대조한다.
  //    이 스크립트의 존재 이유 그 자체다: SELECT 만 가진 계정은 트리거 0 을 0 과 대조해
  //    통과해 버린다. 개수 비교로 바꾸면 그 구멍이 더 커진다.
  verifiesNameSetsNotCounts(ps) {
    const code = maskPs(ps);
    // 기대값을 **이름**으로 읽는다(COUNT(*) 가 아니다).
    assert.ok(/\$expTables\s*=\s*QLines "SELECT TABLE_NAME FROM information_schema\.TABLES/.test(code),
      'DB 쪽 표를 이름으로 읽지 않는다 — 개수만 읽으면 이름이 달라도 통과한다');
    assert.ok(/\$expTrigs\s*=\s*QLines "SELECT TRIGGER_NAME FROM information_schema\.TRIGGERS/.test(code),
      'DB 쪽 트리거를 이름으로 읽지 않는다');
    // 덤프에서도 **이름**을 뽑는다(세기만 하면 안 된다).
    assert.ok(/\$gotTables \+= \$m\.Groups\[1\]\.Value/.test(code),
      '덤프에서 표 이름을 뽑지 않는다 — 개수만 세면 이름이 달라도 통과한다');
    assert.ok(/\$gotTrigs \+= \$m\.Groups\[1\]\.Value/.test(code),
      '덤프에서 트리거 이름을 뽑지 않는다');
    // 대조는 차집합(-notcontains) 이어야 한다. 양쪽 방향을 다 본다.
    const pairs = [
      ['$missT', '$expTables', '$gotTables', '덤프에 빠진 표'],
      ['$extraT', '$gotTables', '$expTables', 'DB 에 없는데 덤프에 있는 표'],
      ['$missG', '$expTrigs', '$gotTrigs', '덤프에 빠진 트리거'],
      ['$extraG', '$gotTrigs', '$expTrigs', 'DB 에 없는데 덤프에 있는 트리거'],
    ];
    for (const [v, from, against, what] of pairs) {
      const re = new RegExp(
        `\\${v}\\s*=\\s*@\\(\\${from} \\| Where-Object \\{ \\${against} -notcontains \\$_ \\}\\)`);
      assert.ok(re.test(code),
        `${what} 를 이름 차집합으로 뽑지 않는다(${v}) — 개수는 같고 이름이 다를 수 있다`);
    }
    // 그리고 그 차집합이 실제로 '문제' 로 쌓여야 한다(뽑아 놓고 안 쓰면 없는 것과 같다).
    for (const v of ['$missT', '$extraT', '$missG', '$extraG']) {
      const re = new RegExp(`if\\(\\${v}\\.Count -gt 0\\)\\{\\s*\\$problems \\+=`);
      assert.ok(re.test(code),
        `${v} 를 뽑아 놓고 $problems 에 넣지 않는다 — 검증 결과에 반영되지 않는다`);
    }
    // $problems 가 하나라도 있으면 실패(1)여야 한다. 경고로 낮추면 반쪽 백업이 통과한다.
    assert.ok(/if\(\$problems\.Count -gt 0\)\{[\s\S]{0,600}?exit 1/.test(code),
      '검증에 걸려도 실패로 끝나지 않는다 — 반쪽 백업이 정상 파일로 남는다');
    // 반쪽 파일은 .partial 로 남겨 복구에 못 쓰게 한다(restore 쪽이 .partial 을 거부한다).
    assert.ok(/\.partial/.test(ps),
      '검증 실패본을 .partial 로 남기는 규약이 사라졌다 — 복구가 반쪽 파일을 집어 든다');
  },

  // ⑦ 덤프 전에 SHOW GRANTS 로 TRIGGER 보유를 확인하는 선검사가 살아 있다.
  //    머리말이 '두 겹 중 이 겹이 실제로 걸러 내는 겹' 이라고 적어 둔 그것이다.
  grantsPrecheckBeforeDump(ps) {
    const code = maskPs(ps);
    const iGrants = code.indexOf('QLines "SHOW GRANTS FOR CURRENT_USER();"');
    assert.ok(iGrants >= 0,
      'SHOW GRANTS 선검사가 사라졌다 — SELECT 만 가진 계정은 트리거 0 을 0 과 대조해 통과해 버린다');
    assert.ok(/\$hasTrigger\s*=\s*\(\$hasAll -or \$havePrivs\.ContainsKey\("TRIGGER"\)\)/.test(code),
      'TRIGGER 보유 판정이 사라졌다 — 무엇을 확인하는지가 없어졌다');
    // 판정만 하고 멈추지 않으면 아무 소용이 없다. 코드 3(접속·권한 문제)으로 끝나야 한다.
    assert.ok(/if\(-not \$hasTrigger\)\{[\s\S]{0,1200}?\n\s*exit 3\n\}/.test(code),
      'TRIGGER 가 없어도 그대로 덤프를 뜬다 — 트리거가 통째로 빠진 백업이 exit 0 으로 만들어진다');
    // SELECT 도 같은 자리에서 본다.
    assert.ok(/if\(-not \$hasSelect\)\{[\s\S]{0,400}?SELECT 권한이 없습니다/.test(code),
      'SELECT 보유 선검사가 사라졌다');
    // ★ 순서가 핵심이다 — 선검사가 mysqldump **앞**에 있어야 한다.
    const iDump = code.indexOf('& $mysqldump (MyArgs)');
    assert.ok(iDump >= 0, 'mysqldump 호출 자리를 찾지 못했다');
    assert.ok(iGrants < iDump,
      `선검사가 mysqldump 뒤로 밀렸다(SHOW GRANTS ${iGrants} / mysqldump ${iDump}) — ` +
      '뜬 다음에 확인하면 이미 반쪽 파일이 만들어진 뒤다');
    // 왜 대조만으로 부족한지가 머리말에 남아 있어야 다음 사람이 이 겹을 지우지 않는다.
    assert.ok(/information_schema\.TRIGGERS 는 TRIGGER 권한으로/.test(ps),
      "'대조만으로는 못 잡는다' 는 이유가 머리말에서 사라졌다 — 이유가 없으면 이 겹이 중복으로 보인다");
  },

  // ⑧ 사람이 준 경로는 **글자 그대로** 보고(-LiteralPath), Resolve-Path 의 결과는 **.ProviderPath** 로 받는다
  //    (2026-09-11 적대 검토 R6). restore-taskmgr.ps1 이 R3~R5 에서 닫은 그 구멍이 이 파일에는 그대로
  //    남아 있었다 — 같은 부류의 결함은 같은 잣대로 잠근다.
  //    · -LiteralPath 없이 보면 `[`·`]`·`*` 가 든 경로를 **와일드카드**로 읽어, 있는 폴더를 "없다" 고 하거나
  //      엉뚱한 자리를 고른다. -BackupDir·-CnfPath 는 사람이 타이핑하는 값이고, 공유 폴더 이름에 대괄호가
  //      들어가는 일은 드물지 않다. 백업은 무인으로 도는 경로라 그 오판이 조용히 반복된다.
  //    · UNC 경로에는 PSDrive 가 없다. 그래서 (Resolve-Path …).Path 는 네이티브 경로가 아니라 공급자 한정
  //      문자열(Microsoft.PowerShell.Core\FileSystem::\\서버\공유\…)을 돌려준다 — [IO.Path]::GetPathRoot 가
  //      그 문자열의 뿌리를 엉뚱하게 읽어 '같은 볼륨' 경고가 조용히 죽고, 백업과 원본이 한 디스크에 쌓인다.
  //      .ProviderPath 는 언제나 네이티브 경로다.
  pathsAreLiteralAndNative(ps) {
    const resolved = [...ps.matchAll(/\(Resolve-Path[^()]*\)\.(\w+)/g)];
    assert.ok(resolved.length >= 1,
      `Resolve-Path 결과를 쓰는 자리를 ${resolved.length} 개 찾았다 — 적어도 하나(-BackupDir 볼륨 대조)여야 한다(측정 불가 ≠ 통과)`);
    for (const m of resolved) {
      assert.strictEqual(m[1], 'ProviderPath',
        `Resolve-Path 결과를 .${m[1]} 로 받는다 — UNC 경로에서 그 값은 공급자 한정 문자열이라 ` +
        '.NET 이 뿌리를 읽지 못한다(.ProviderPath 는 언제나 네이티브 경로다 · R6)');
    }
    for (const v of ['BackupDir', 'CnfPath']) {
      assert.ok(!new RegExp(`(Test-Path|Resolve-Path) \\$${v}\\b`).test(ps),
        `$${v} 를 -LiteralPath 없이 본다 — 대괄호·별표가 든 경로를 와일드카드로 읽는다(R6)`);
    }
  },
};

export { checks, psSrc, cmdSrc };

// ══ 테스트 ════════════════════════════════════════════════════════════

test('백업 가드 ⓪: 마스커가 실제로 파싱한다(0건이면 아래 ①이 거짓 초록)', () => {
  const code = maskPs(psSrc);
  assert.strictEqual(code.length, psSrc.length, '마스커가 길이를 바꿨다 — 인덱스가 안 맞는다');
  assert.ok(psSrc.includes('이 스크립트의 존재 이유'), '준비 실패: 머리말 문구를 못 찾았다');
  assert.ok(!/<#/.test(code), '블록 주석이 지워지지 않았다');
  assert.ok(/function MyArgs/.test(code), '마스커가 코드까지 지웠다');
  // 문자열 '내용'은 일부러 남긴다 — 그러지 않으면 ①이 정확히 잡아야 할 자리("-p$pw")를 못 본다.
  assert.ok(/--defaults-extra-file=\$CnfPath/.test(code),
    '문자열 내용이 지워졌다 — 그러면 계약 ①이 정확히 잡아야 할 자리를 못 본다');
});

test('백업 가드 ①: 비밀번호를 -p<비번> / --password= 로 명령줄에 싣는 자리가 없다', () =>
  checks.noPasswordOnCommandLine(psSrc));

test('백업 가드 ②: .ps1 과 .cmd 의 종료코드 표가 줄 단위로 같다', () => {
  checks.exitCodeTablesMatch(psSrc, cmdSrc);
  for (const l of exitCodeTable(psSrc, false)) console.log(`      ${l}`);
});

test('백업 가드 ③: 표의 숫자와 실제로 내는 종료코드가 일치한다', () => {
  checks.tableMatchesActualExits(psSrc);
  console.log(`      실제 exit/Die 자리 = ${exitCodesUsed(psSrc).join(', ')}`);
});

test('백업 가드 ④: .cmd 에 비ASCII 가 한 글자도 없다(cmd.exe 바이트 오프셋 사고 방지)', () =>
  checks.cmdIsPureAscii(cmdSrc));

test('백업 가드 ⑤: mysqldump 인자 넷이 살아 있다(--no-tablespaces · --single-transaction · --routines · --triggers)', () =>
  checks.dumpArgsIntact(psSrc));

test('백업 가드 ⑥: 덤프 검증이 개수가 아니라 이름 집합을 대조한다', () =>
  checks.verifiesNameSetsNotCounts(psSrc));

test('백업 가드 ⑦: 덤프 전에 SHOW GRANTS 로 TRIGGER 보유를 확인한다', () =>
  checks.grantsPrecheckBeforeDump(psSrc));

test('백업 가드 ⑧: 사람이 준 경로를 글자 그대로 보고(-LiteralPath) Resolve-Path 결과를 .ProviderPath 로 받는다', () =>
  checks.pathsAreLiteralAndNative(psSrc));

// ══ 변이 주입 — 위 계약이 '정말 우는지' 증명한다 ═══════════════════════
// 주입기 mutate() 는 tests/ps-guard-lib.mjs 에 있다 — 접미사 변이 금지 · 앵커 유일성 단언 ·
// 앵커가 없으면 크게 실패하는 규약을 그 파일이 가진다.

test('변이①: 비밀번호를 -p 로 넘기는 자리를 만들면 가드 ① 이 실패한다', () => {
  // 실제로 하기 쉬운 실수 — "간단하게" .cnf 대신 인자로 넘기는 것.
  const bad = mutate(psSrc,
    'function MyArgs(){ return @("--defaults-extra-file=$CnfPath"',
    'function MyArgs(){ return @("-u$BackupUser","-p$BackupPw"');
  assert.doesNotThrow(() => checks.noPasswordOnCommandLine(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.noPasswordOnCommandLine(bad), /비밀번호를 명령줄로 넘기는 자리가 생겼다/);
});

test('변이①-b: --password= 꼴도 잡는다', () => {
  const bad = mutate(psSrc,
    '"--defaults-extra-file=$CnfPath","--default-character-set=utf8mb4"',
    '"--user=$BackupUser","--password=$BackupPw"');
  assert.throws(() => checks.noPasswordOnCommandLine(bad), /비밀번호를 명령줄로 넘기는 자리가 생겼다/);
});

test('변이①-c: 주석·문자열 안의 -p 는 세지 않는다(마스커 회귀)', () => {
  // 이 파일의 머리말은 '-p<비번> 을 쓰지 마라' 를 설명하느라 그 문자열을 담을 수 있다.
  // 마스커가 없으면 검사가 자기 설명문에 걸려 늘 빨간불이 되고, 그러면 사람이 검사를 헐겁게 고친다.
  const noise = psSrc +
    '\n# 줄 주석 안의 -p비밀번호 와 --password=x 는 세지 않는다(설명용).\n' +
    '<#\n  블록 주석 안의 -p<pw> 도 마찬가지다.\n#>\n';
  assert.doesNotThrow(() => checks.noPasswordOnCommandLine(noise), '마스커가 주석 안의 -p 를 코드로 셌다');
  // 진짜 코드 자리에 넣으면 당연히 잡아야 한다(마스커가 전부 지워 버리지 않았다는 증거).
  const real = psSrc + '\n& $mysql "-p$BackupPw" "-e" "SELECT 1;"\n';
  assert.throws(() => checks.noPasswordOnCommandLine(real), /비밀번호를 명령줄로 넘기는 자리가 생겼다/);
});

test('변이②: .cmd 의 종료코드 한 줄만 손대도 가드 ② 가 실패한다', () => {
  const bad = mutate(cmdSrc,
    'rem    4 mysqldump.exe / mysql.exe not found',
    'rem    4 tool not found');
  assert.doesNotThrow(() => checks.exitCodeTablesMatch(psSrc, cmdSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.exitCodeTablesMatch(psSrc, bad), /번째 줄이 다르다/);
});

test('변이②-b: 한쪽에서 코드 한 줄을 지우면 줄 수 대조가 실패한다', () => {
  const bad = mutate(cmdSrc,
    'rem    5 administrator rights required - -Install / -Uninstall need an elevated console\n',
    '');
  assert.throws(() => checks.exitCodeTablesMatch(psSrc, bad), /줄 수가 다르다/);
});

test('변이②-c: 옛 "0 ok | 1 …" 형식(한 줄에 두 코드)으로 되돌리면 가드 ② 가 실패한다', () => {
  // 이 형식이 내가 한 번 "불일치" 로 오판했던 그 형식이다. 계약을 형식에 맞추는 대신
  // 형식을 고쳤으므로, 되돌리면 두 파일이 어긋나 대조에서 걸린다.
  const bad = mutate(cmdSrc,
    'rem    0 ok - dump written and every verification passed (-Install / -Uninstall / -Status success is 0 too)\n' +
    'rem    1 backup or verification failed - the dump is kept as .partial and must not be restored from\n',
    'rem    0 ok | 1 backup failed or verification mismatch (file kept as .partial)\n');
  assert.throws(() => checks.exitCodeTablesMatch(psSrc, bad), /줄 수가 다르다|번째 줄이 다르다/);
});

test('변이③: 표에 없는 코드를 실제로 내면 가드 ③ 이 실패한다', () => {
  // '표는 맞는데 코드가 딴 값을 낸다' — 표만 보는 검사로는 절대 못 잡는 자리다.
  const bad = mutate(psSrc,
    'if($Keep -lt 1){ Die "-Keep 은 1 이상이어야 합니다(지금: $Keep). 0 이면 방금 뜬 백업까지 지운다." 2 }',
    'if($Keep -lt 1){ Die "-Keep 은 1 이상이어야 합니다(지금: $Keep). 0 이면 방금 뜬 백업까지 지운다." 9 }');
  assert.doesNotThrow(() => checks.tableMatchesActualExits(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.tableMatchesActualExits(bad), /표의 코드 목록과 실제로 내는 코드가 다르다/);
});

test('변이③-b: 표에서 코드를 지우면(실제로는 그 값을 내면서) 가드 ③ 이 실패한다', () => {
  const bad = mutate(psSrc,
    '    5 administrator rights required - -Install / -Uninstall need an elevated console\n',
    '');
  assert.throws(() => checks.tableMatchesActualExits(bad), /표의 코드 목록과 실제로 내는 코드가 다르다/);
});

test('변이④: .cmd 에 한글을 한 글자만 넣어도 가드 ④ 가 실패한다', () => {
  const bad = mutate(cmdSrc, 'rem  Usage:', 'rem  사용법:');
  assert.doesNotThrow(() => checks.cmdIsPureAscii(cmdSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.cmdIsPureAscii(bad), /비ASCII 가 있다/);
});

test('변이⑤: mysqldump 에서 --no-tablespaces 를 빼면 가드 ⑤ 가 실패한다', () => {
  // 빼면 INFORMATION_SCHEMA.FILES 를 읽으려 하고, 그건 전역 PROCESS 권한을 요구한다 —
  // '읽기 전용 백업 계정' 의 취지가 무너진다. 취향이 아니라 계약이다.
  const bad = mutate(psSrc, ' "--no-tablespaces"', '');
  assert.doesNotThrow(() => checks.dumpArgsIntact(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.dumpArgsIntact(bad), /--no-tablespaces/);
});

test('변이⑤-b: --triggers 를 빼면 가드 ⑤ 가 실패한다(트리거가 조용히 빠진다)', () => {
  const bad = mutate(psSrc, ' "--triggers"', '');
  assert.throws(() => checks.dumpArgsIntact(bad), /--triggers/);
});

test('변이⑤-c: --single-transaction / --routines 를 빼도 각각 잡힌다', () => {
  for (const arg of ['--single-transaction', '--routines']) {
    const bad = mutate(psSrc, ` "${arg}"`, '');
    assert.throws(() => checks.dumpArgsIntact(bad), new RegExp(arg));
  }
});

test('변이⑤-d: 인자를 주석에만 남기고 호출에서 빼면 가드 ⑤ 가 실패한다(마스커가 일한다)', () => {
  // "주석에 적혀 있으니 됐다" 는 통하지 않는다 — 검사는 실제 호출 자리를 본다.
  const bad = mutate(psSrc, ' "--triggers"', '') +
    '\n# 참고: mysqldump 는 "--triggers" 를 쓴다(설명용 주석).\n';
  assert.throws(() => checks.dumpArgsIntact(bad), /--triggers/);
});

test('변이⑥: 이름 차집합을 개수 비교로 바꾸면 가드 ⑥ 이 실패한다', () => {
  // 개수는 같고 이름이 다를 수 있다 — 이 변이는 바로 그 구멍을 만든다.
  const bad = mutate(psSrc,
    '$missT = @($expTables | Where-Object { $gotTables -notcontains $_ })',
    '$missT = @(if($expTables.Count -ne $gotTables.Count){ "개수 불일치" })');
  assert.doesNotThrow(() => checks.verifiesNameSetsNotCounts(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.verifiesNameSetsNotCounts(bad), /덤프에 빠진 표 를 이름 차집합으로 뽑지 않는다/);
});

test('변이⑥-b: 트리거 차집합을 없애면 가드 ⑥ 이 실패한다(이 스크립트의 존재 이유 그 자체)', () => {
  const bad = mutate(psSrc,
    '$missG = @($expTrigs | Where-Object { $gotTrigs -notcontains $_ })',
    '$missG = @()   # 트리거는 안 본다');
  assert.throws(() => checks.verifiesNameSetsNotCounts(bad), /덤프에 빠진 트리거 를 이름 차집합으로 뽑지 않는다/);
});

test('변이⑥-c: 차집합을 뽑아 놓고 $problems 에 안 넣으면 가드 ⑥ 이 실패한다', () => {
  const bad = mutate(psSrc,
    'if($missG.Count -gt 0){  $problems += "덤프에 빠진 트리거',
    'if($missG.Count -gt 0){  $무시 = ("덤프에 빠진 트리거');
  assert.throws(() => checks.verifiesNameSetsNotCounts(bad), /\$problems 에 넣지 않는다/);
});

test('변이⑥-d: DB 쪽 트리거를 이름 대신 개수로 읽으면 가드 ⑥ 이 실패한다', () => {
  const bad = mutate(psSrc,
    '$expTrigs  = QLines "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS',
    '$expTrigs  = QLines "SELECT COUNT(*) FROM information_schema.TRIGGERS');
  assert.throws(() => checks.verifiesNameSetsNotCounts(bad), /DB 쪽 트리거를 이름으로 읽지 않는다/);
});

test('변이⑥-e: 검증에 걸려도 실패로 끝내지 않으면 가드 ⑥ 이 실패한다', () => {
  const bad = mutate(psSrc,
    'if($problems.Count -gt 0){\n  Bad "검증 실패',
    'if($false){\n  Bad "검증 실패');
  assert.throws(() => checks.verifiesNameSetsNotCounts(bad), /실패로 끝나지 않는다/);
});

test('변이⑦: SHOW GRANTS 선검사를 없애면 가드 ⑦ 이 실패한다', () => {
  // 이 겹이 두 겹 중 **실제로 걸러 내는** 겹이다. 없으면 SELECT 만 가진 계정이
  // '트리거 0 == DB 0' 으로 대조까지 통과한 반쪽 백업을 만든다(실측).
  const bad = mutate(psSrc,
    '$grantLines = QLines "SHOW GRANTS FOR CURRENT_USER();"',
    '$grantLines = @()   # 선검사 생략');
  assert.doesNotThrow(() => checks.grantsPrecheckBeforeDump(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.grantsPrecheckBeforeDump(bad), /SHOW GRANTS 선검사가 사라졌다/);
});

test('변이⑦-b: TRIGGER 가 없어도 멈추지 않으면(경고만) 가드 ⑦ 이 실패한다', () => {
  const bad = mutate(psSrc, 'if(-not $hasTrigger){', 'if($false){');
  assert.throws(() => checks.grantsPrecheckBeforeDump(bad), /그대로 덤프를 뜬다/);
});

test('변이⑦-c: TRIGGER 보유 판정 자체를 지우면 가드 ⑦ 이 실패한다', () => {
  const bad = mutate(psSrc,
    '$hasTrigger = ($hasAll -or $havePrivs.ContainsKey("TRIGGER"))',
    '$hasTrigger = $true   # 항상 있다고 친다');
  assert.throws(() => checks.grantsPrecheckBeforeDump(bad), /TRIGGER 보유 판정이 사라졌다/);
});

test('변이⑦-d: 선검사를 mysqldump 뒤로 옮기면 가드 ⑦ 이 실패한다(순서가 계약이다)', () => {
  // 뜬 다음에 확인하면 이미 반쪽 파일이 만들어진 뒤다.
  const line = '$grantLines = QLines "SHOW GRANTS FOR CURRENT_USER();"\n';
  let bad = mutate(psSrc, line, '$grantLines = @("(뒤로 옮김)")\n');
  bad = mutate(bad, '$dumpRc = $LASTEXITCODE\n', '$dumpRc = $LASTEXITCODE\n' + line);
  assert.throws(() => checks.grantsPrecheckBeforeDump(bad), /선검사가 mysqldump 뒤로 밀렸다/);
});

test('변이⑧: Resolve-Path 결과를 .Path 로 되돌리면 가드 ⑧ 이 실패한다(UNC 에서 볼륨 경고가 조용히 죽는다 · R6)', () => {
  const bad = mutate(psSrc,
    '(Resolve-Path -LiteralPath $BackupDir).ProviderPath',
    '(Resolve-Path -LiteralPath $BackupDir).Path');
  assert.throws(() => checks.pathsAreLiteralAndNative(bad), /Resolve-Path 결과를 \.Path 로 받는다/);
  assert.doesNotThrow(() => checks.pathsAreLiteralAndNative(psSrc));   // 통제군
});

test('변이⑧-b: -BackupDir 의 -LiteralPath 를 빼면 가드 ⑧ 이 실패한다(대괄호가 든 경로를 와일드카드로 읽는다 · R6)', () => {
  const bad = mutate(psSrc,
    '(Resolve-Path -LiteralPath $BackupDir).ProviderPath',
    '(Resolve-Path $BackupDir).ProviderPath');
  assert.throws(() => checks.pathsAreLiteralAndNative(bad), /\$BackupDir 를 -LiteralPath 없이 본다/);
  assert.doesNotThrow(() => checks.pathsAreLiteralAndNative(psSrc));   // 통제군
});

test('변이⑧-c: -CnfPath 의 존재 확인에서 -LiteralPath 를 빼면 가드 ⑧ 이 실패한다(자격 파일을 "없다" 고 읽는다 · R6)', () => {
  const bad = mutate(psSrc,
    'if(-not (Test-Path -LiteralPath $CnfPath)){\n  Bad "자격 파일이 없습니다',
    'if(-not (Test-Path $CnfPath)){\n  Bad "자격 파일이 없습니다');
  assert.throws(() => checks.pathsAreLiteralAndNative(bad), /\$CnfPath 를 -LiteralPath 없이 본다/);
  assert.doesNotThrow(() => checks.pathsAreLiteralAndNative(psSrc));   // 통제군
});

test('변이⑧-d: Resolve-Path 자리가 통째로 사라지면(검사 대상 소멸) 가드 ⑧ 이 실패한다(측정 불가 ≠ 통과)', () => {
  const bad = mutate(psSrc,
    '[IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $BackupDir).ProviderPath).ToUpper()',
    '[IO.Path]::GetPathRoot($BackupDir).ToUpper()');
  assert.throws(() => checks.pathsAreLiteralAndNative(bad), /Resolve-Path 결과를 쓰는 자리를 0 개 찾았다/);
  assert.doesNotThrow(() => checks.pathsAreLiteralAndNative(psSrc));   // 통제군
});
