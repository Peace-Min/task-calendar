// Layer 1: 외부 검토자용 읽기 전용 MySQL 계정 도구(db/deploy/reviewer-account.ps1 / .cmd)의 계약을 소스 텍스트만으로 본다.
// MySQL 을 돌리지 않고 방화벽도 건드리지 않는다(실제 실행은 사람이 리허설한다).
//
// 왜 있나
//   이 도구는 DB 를 내부망 밖 사람에게 여는 문이다. 권한 한 단어(ALL, GRANT OPTION), 호스트 한 글자('%'),
//   로그 한 줄(비밀번호)이 새면 그대로 사고다. 그래서 못 박는다:
//     ① .cmd 는 ASCII 만, ps1 을 -ExecutionPolicy Bypass -File 로, 인자는 %* 로 넘긴다, 실패면 멈춘다
//     ② 종료코드 표가 .ps1 과 .cmd 에서 줄 단위로 같고, ps1 이 실제로 내는 코드와 같다(0, 1, 2, 3, 6)
//     ③ 기본값: reviewer, taskcalendar, 127.0.0.1, 3306, C:\mysql, MySQL84, root, dist\reviewer-account, 스위치 여섯
//     ④ 관리 비밀번호: 인자 없음, .cnf(--defaults-extra-file)로만, Cleanup 과 finally, 자격 순서
//     ⑤ 검토자 비밀번호: 인자 없음, 환경변수 또는 가려진 입력 두 번, 12자 이상, 안전한 글자만, root 와 다름.
//        흐르는 곳은 임시 .sql 과 임시 .cnf 뿐이고, 화면, 보고서, 명령줄 어디에도 가지 않는다. mysql 출력은 가린 뒤에만 찍는다
//     ⑥ 권한: GRANT 는 정확히 SELECT, SHOW VIEW ON `<db>`.* 하나. ALL, GRANT OPTION, *.* 권한, 다른 쓰기 문장이 없다
//     ⑦ 호스트: IPv4 하나나 /24 꼴만. '%', 빈 값, 이름, 127.x(-AllowLocal 의 127.0.0.1 밖)는 받지 않는다. 계정 이름 형식
//     ⑧ 검증: SHOW GRANTS 가 정확히 두 줄이어야 하고, 아니면 새로 만든 계정을 DROP USER 로 되돌리고 1 로 끝낸다
//     ⑨ 방화벽: 관리자 권한일 때만 규칙을 만들고, 아니면 New-NetFirewallRule 명령을 보여 준다. 실패는 6
//     ⑩ 순서: 인자 검사, 접속, 네트워크 점검, 있는지 확인, 확인(Y), 비밀번호, SQL, 검증, 방화벽, 안내. -Yes 와 리다이렉트
//     ⑪ 네트워크 점검: bind_address, port, skip_networking 을 보여 주고, 막혀 있으면 my.ini(--defaults-file)를 알려 준다
//     ⑫ 안내와 지우기: 접속 정보에 비밀번호가 없고, -Drop 은 DROP USER IF EXISTS 와 확인, 문서가 있다
//   각 계약에 변이 주입을 짝으로 둔다(이 저장소의 관례: 검사가 정말 잡는지 증명한다).
//
// 공용 기계(주석 마스커, 비번 검사, 종료코드 표, 변이 주입기)는 tests/ps-guard-lib.mjs 의 것을 쓴다.
import { test, assert } from './harness.mjs';
import { readFileSync } from 'node:fs';
import {
  maskPs, passwordOnCommandLineHits, exitCodeTable, exitCodesInTable, exitCodesUsed,
  mutate, nonAsciiLines,
} from './ps-guard-lib.mjs';

const PS_URL  = new URL('../db/deploy/reviewer-account.ps1', import.meta.url);
const CMD_URL = new URL('../db/deploy/reviewer-account.cmd', import.meta.url);
const README_URL = new URL('../db/deploy/README.md', import.meta.url);
const psBytes = readFileSync(PS_URL);
const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const psSrc  = norm(readFileSync(PS_URL, 'utf8'));
const cmdSrc = norm(readFileSync(CMD_URL).toString('latin1'));
const readme = norm(readFileSync(README_URL, 'utf8'));

// 마스킹한 코드. 백틱 줄 이음(` + 줄바꿈)은 한 줄로 붙인다(여러 줄에 걸친 명령을 한 줄로 보게).
const code = (ps) => maskPs(ps).replace(/`\n\s*/g, ' ');

// 정확히 한 번 나와야 하는 앵커의 위치.
function onlyOnce(src, re, label) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const hits = [...src.matchAll(g)];
  assert.strictEqual(hits.length, 1, `${label} 이(가) ${hits.length}번 나온다(1번이어야 한다), 패턴 ${re}`);
  return hits[0].index;
}
// param( ... ) 블록.
function paramBlock(c) {
  const s = c.search(/\bparam\(/);
  assert.ok(s >= 0, 'param( 블록을 찾지 못했다');
  let depth = 0;
  for (let k = c.indexOf('(', s); k < c.length; k++) {
    if (c[k] === '(') depth++;
    else if (c[k] === ')') { depth--; if (depth === 0) return c.slice(s, k + 1); }
  }
  assert.fail('param( 블록의 끝을 찾지 못했다');
}
// 함수 본문(function Name(...){ ... 짝 괄호까지).
function fnBody(c, name) {
  const s = c.search(new RegExp(`function ${name}\\(`));
  assert.ok(s >= 0, `function ${name} 을 찾지 못했다`);
  let depth = 0;
  for (let k = c.indexOf('{', s); k < c.length; k++) {
    if (c[k] === '{') depth++;
    else if (c[k] === '}') { depth--; if (depth === 0) return c.slice(s, k + 1); }
  }
  assert.fail(`function ${name} 의 끝을 찾지 못했다`);
}
// ps1 의 단일따옴표 상수 값('...')을 꺼낸다.
function psConst(c, name) {
  const m = new RegExp(`\\$${name}\\s*=\\s*'([^']*)'`).exec(c);
  assert.ok(m, `상수 $${name} 를 찾지 못했다`);
  return m[1];
}
// .NET 정규식(이 파일들이 쓰는 부분 집합)을 JS 로. \z 는 끝, JS 의 $ 는 m 플래그 없이 끝에서만 맞는다.
const jsRe = (dotnet) => new RegExp(dotnet.replace(/\\z$/, '$'));

// 검토자 비밀번호가 담기는 변수들. 이 이름이 나오는 곳이 비밀번호가 흐르는 곳 전부다.
const SECRET_VARS = ['revPw', 'envRev', 'a1', 'a2', 'cand', 'sqlLines', 'revCnfText'];
const SECRET_RE = new RegExp(`\\$(${SECRET_VARS.join('|')})\\b`, 'i');
// 화면, 보고서, 파일로 내보내는 자리.
const SINK_RE = /\b(Log|Info|Ok|Warn|Step|DiePre|Finish|Rollback|SaveReport|Write-Host|Write-Output|Write-Verbose|Write-Warning|Write-Error|Out-File|Add-Content|Set-Content|Tee-Object|Start-Transcript)\b|logLines/;

// ══ 검사 함수(테스트와 변이 주입이 같은 함수를 쓴다) ═══════════════════
const checks = {
  // ① .cmd 모양
  cmdShape(cmd) {
    assert.deepStrictEqual(nonAsciiLines(cmd), [], '.cmd 에 비ASCII 가 있다(cmd.exe 바이트 오프셋 사고)');
    const body = cmd.split('\n').filter((l) => !/^\s*rem\b/i.test(l)).join('\n');
    assert.ok(/powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reviewer-account\.ps1" %\*/.test(body),
      '.cmd 가 같은 폴더의 reviewer-account.ps1 을 -ExecutionPolicy Bypass -File 로, 인자 %* 와 함께 부르지 않는다');
    assert.ok(/set "TC_REVIEWER_LAUNCHER=cmd"/.test(body), '.cmd 가 TC_REVIEWER_LAUNCHER=cmd 를 세우지 않는다(ps1 의 창 멈춤 규칙)');
    assert.ok(/if errorlevel 1 pause/.test(body) && /exit \/b %RC%/.test(body), '.cmd 가 실패면 멈추고(pause) 종료코드를 그대로 돌려주지 않는다');
    assert.ok(/^cd \/d "%~dp0"$/m.test(body), '.cmd 가 자기 폴더로 옮겨 가지 않는다(관리자 권한 실행은 System32 에서 시작한다)');
  },

  // ② 종료코드 표
  exitCodes(ps, cmd) {
    const a = exitCodeTable(ps, false);
    const b = exitCodeTable(cmd, true);
    assert.deepStrictEqual(b, a, '.ps1 과 .cmd 의 종료코드 표가 줄 단위로 같지 않다');
    const table = exitCodesInTable(a);
    assert.deepStrictEqual(table, [0, 1, 2, 3, 6], `종료코드 표가 0, 1, 2, 3, 6 이 아니다: ${table.join(',')}`);
    assert.deepStrictEqual(exitCodesUsed(ps), table, `ps1 이 실제로 내는 코드(${exitCodesUsed(ps).join(',')})가 표와 다르다`);
    const c = code(ps);
    assert.ok(/Finish \$EXIT_FIREWALL /.test(c) && /Finish \$EXIT_CANCEL /.test(c) && /Finish \$EXIT_FAIL /.test(c) && /Finish \$EXIT_PRECHECK /.test(c),
      '표의 코드 가운데 Finish 로 실제로 내지 않는 것이 있다');
  },

  // ③ 기본값
  defaults(ps) {
    const c = code(ps);
    const p = paramBlock(c);
    const want = [
      /\[string\]\$ReviewerIp = "",/, /\[string\]\$UserName = "reviewer",/, /\[string\]\$DbName = "taskcalendar",/,
      /\[string\]\$DbHost = "127\.0\.0\.1",/, /\[int\]\$Port = 3306,/, /\[string\]\$BaseDir = "C:\\mysql",/,
      /\[string\]\$ServiceName = "MySQL84",/, /\[string\]\$DbUser = "root",/, /\[string\]\$OutDir = "",/,
      /\[switch\]\$Drop,/, /\[switch\]\$List,/, /\[switch\]\$ResetPassword,/, /\[switch\]\$NoFirewall,/, /\[switch\]\$AllowLocal,/, /\[switch\]\$Yes\b/,
    ];
    for (const re of want) assert.ok(re.test(p), `param 기본값이 바뀌었거나 사라졌다: ${re}`);
    assert.ok(/\$OutDir = Join-Path \$scriptDir "\.\.\\\.\.\\dist\\reviewer-account"/.test(c), '기본 기록 폴더가 <스크립트>\\..\\..\\dist\\reviewer-account 가 아니다');
    assert.ok(/\$toolRoots\.Add\(\$BaseDir\)/.test(c) && /Win32_Service -Filter "Name='\$ServiceName'"/.test(c) &&
      /\$DEFAULT_MYSQL_DIR = "C:\\Program Files\\MySQL\\MySQL Server 8\.4"/.test(c) && /\$toolRoots\.Add\(\$DEFAULT_MYSQL_DIR\)/.test(c),
      'mysql.exe 찾기가 -BaseDir, 서비스 binPath, 기본 설치 경로 순서를 다 보지 않는다');
    assert.ok([...psBytes.subarray(0, 3)].join() === '239,187,191', 'reviewer-account.ps1 에 UTF-8 BOM 이 없다(5.1 이 한국어를 ANSI 로 오독한다)');
  },

  // ④ 관리 비밀번호(root)
  adminSecret(ps) {
    const bad = passwordOnCommandLineHits(ps);
    assert.deepStrictEqual(bad, [], `비밀번호를 명령줄로 넘기는 자리가 생겼다: ${bad.join(' , ')}`);
    const c = code(ps);
    const p = paramBlock(c);
    // [switch]$ResetPassword 는 비밀번호 값이 아니라 스위치다. 값을 받는 인자만 본다.
    assert.ok(!/\[(?!switch\])[^\]]+\]\$\w*(Password|Passwd|Pwd|Pw)\b/i.test(p) && !/securestring/i.test(p),
      '비밀번호를 받는 인자가 param 에 있다(같은 사용자의 다른 프로세스가 명령줄을 읽는다). 환경변수, stdin, 가려진 입력으로만 받는다');
    const mysqlCalls = c.split('\n').filter((l) => /&\s*\$mysql\b/.test(l) || /cmd \/c "`"\$mysql`"/.test(l));
    assert.ok(mysqlCalls.length >= 4, `mysql 호출을 ${mysqlCalls.length}개만 찾았다(검사가 볼 대상이 사라졌다)`);
    for (const l of mysqlCalls) assert.ok(/--defaults-extra-file=/.test(l), `mysql 호출이 .cnf 없이 나간다: ${l.trim().slice(0, 100)}`);
    const cl = fnBody(c, 'Cleanup');
    for (const v of ['cnfPath', 'sqlPath', 'revCnfPath']) {
      assert.ok(new RegExp(`Remove-Item -LiteralPath \\$script:${v}\\b`).test(cl), `Cleanup 이 임시 파일 $script:${v} 를 지우지 않는다`);
    }
    assert.ok(/\}\s*finally\s*\{\s*(?:\n\s*)*Cleanup\b/.test(c), 'finally 블록이 Cleanup 을 부르지 않는다');
    const fin = fnBody(c, 'Finish');
    assert.ok(/\bCleanup\b/.test(fin) && fin.indexOf('Cleanup') < fin.indexOf('exit $code'), 'Finish 가 종료 전에 Cleanup 을 부르지 않는다');
    assert.ok(/WriteAllText\(\$script:cnfPath, \$cnfText, \(New-Object System\.Text\.UTF8Encoding\(\$false\)\)\)/.test(c), '.cnf 를 BOM 없는 UTF-8 로 쓰는 자리가 바뀌었다');
    assert.ok(/\$script:cnfPath = Join-Path \$env:TEMP /.test(c), '관리 .cnf 가 %TEMP% 밖에 생긴다');
    const envAt = onlyOnce(c, /GetEnvironmentVariable\(\$ADMIN_PW_ENV\)/, '환경변수 읽기');
    const stdinAt = onlyOnce(c, /\$r = ReadStdinLineBounded \$STDIN_WAIT_SEC/, '상한 있는 stdin 읽기');
    const promptAt = onlyOnce(c, /Read-Host "MySQL \$DbUser 비밀번호" -AsSecureString/, '가려진 입력');
    assert.ok(envAt < stdinAt && stdinAt < promptAt, '자격 순서가 환경변수, stdin, 가려진 입력이 아니다');
    assert.ok(/\$ADMIN_PW_ENV\s*=\s*"TASKMGR_ADMIN_PW"/.test(c) && /\$STDIN_WAIT_SEC\s*=\s*10\b/.test(c), '환경변수 이름(TASKMGR_ADMIN_PW)이나 stdin 상한(10초)이 다른 도구와 다르다');
    assert.ok(!/\[Console\]::In\.ReadLine\(\)/.test(c), '상한 없는 [Console]::In.ReadLine() 이 있다(무인 실행이 영원히 멎는다)');
    assert.ok(/\$adminPw = \$null/.test(c) && /\$pwEsc = \$null/.test(c), '관리 비밀번호를 .cnf 에 쓴 뒤 버리지 않는다');
  },

  // ⑤ 검토자 비밀번호
  reviewerSecret(ps) {
    const c = code(ps);
    assert.ok(/\$REVIEWER_PW_ENV\s*=\s*"TASKMGR_REVIEWER_PW"/.test(c), '검토자 비밀번호 환경변수 이름이 TASKMGR_REVIEWER_PW 가 아니다');
    assert.ok(/\$REVIEWER_PW_MIN\s*=\s*12\b/.test(c), '검토자 비밀번호 최소 길이가 12 가 아니다');
    // 받기: 환경변수, 그다음 가려진 입력 두 번과 대조.
    const get = fnBody(c, 'GetReviewerPw');
    const envAt = get.indexOf('GetEnvironmentVariable($REVIEWER_PW_ENV)');
    const masked = [...get.matchAll(/ReadMasked "/g)].map((m) => m.index);
    assert.ok(envAt >= 0 && masked.length === 2 && envAt < masked[0], '검토자 비밀번호를 환경변수, 그다음 가려진 입력 두 번으로 받지 않는다');
    assert.ok(/\$same = \(\$a1 -ceq \$a2\)/.test(get) && /if\(-not \$same\)\{ Warn /.test(get), '두 번 받은 검토자 비밀번호를 대소문자까지 대조하지 않는다');
    assert.ok(/-AsSecureString/.test(fnBody(c, 'ReadMasked')), 'ReadMasked 가 가려진 입력(-AsSecureString)이 아니다');
    // 검사: 길이, 안전한 글자, root 와 다름.
    const prob = fnBody(c, 'ReviewerPwProblem');
    assert.ok(/\$cand\.Length -lt \$REVIEWER_PW_MIN/.test(prob), '검토자 비밀번호 길이를 보지 않는다');
    assert.ok(/\$cand -cnotmatch \$PW_CHARS_RE/.test(prob), '검토자 비밀번호 글자를 보지 않는다');
    assert.ok(/\(Sha256Hex \$cand\) -eq \$script:adminPwSha/.test(prob) && /\$script:adminPwSha = Sha256Hex \$adminPw/.test(c),
      '검토자 비밀번호가 관리 비밀번호와 같은지 보지 않는다');
    const chars = jsRe(psConst(c, 'PW_CHARS_RE'));
    for (const ok of ['Abcdef!23456', 'x#$%&()*+,-./:;<=>?@[]^_{|}~0']) assert.ok(chars.test(ok), `안전한 글자로 된 비밀번호를 거부한다: ${ok}`);
    for (const bad of ["abc'defghijk", 'abc"defghijk', 'abc\\defghijk', 'abc`defghijk', 'abc defghijk', '비밀번호입니다아아아아', 'abcdefghijk\n', 'abcdefghij\tk']) {
      assert.ok(!chars.test(bad), `SQL 이나 .cnf 를 깰 수 있는 글자를 받는다: ${JSON.stringify(bad)}`);
    }
    // 실제로 쓰기 직전에 다시 검사한다(환경변수 경로도 같은 검사를 지난다).
    assert.ok(/\$revPw = GetReviewerPw\n\s*\$why = ReviewerPwProblem \$revPw\n\s*if\(\$why\)\{ DiePre /.test(c), 'SQL 에 넣기 직전에 검토자 비밀번호를 다시 검사하지 않는다');
    assert.ok(/\$why = ReviewerPwProblem \$envRev\n\s*if\(\$why\)\{ DiePre /.test(get), '환경변수로 받은 검토자 비밀번호를 검사하지 않는다');

    // 흐름: 비밀번호 변수가 나오는 줄에는 화면, 보고서, 파일로 내보내는 자리가 없다(null 로 비우는 문장은 뺀다).
    const lines = c.split('\n');
    const leaks = [];
    lines.forEach((raw, i) => {
      const l = raw.replace(/\$\w+ = \$null;?/g, '');
      if (SECRET_RE.test(l) && SINK_RE.test(l)) leaks.push(`${i + 1}: ${raw.trim()}`);
    });
    assert.deepStrictEqual(leaks, [], '검토자 비밀번호 변수가 화면이나 보고서로 가는 줄에 있다:\n' + leaks.join('\n'));
    // 큰따옴표 문자열에 비밀번호를 끼워 넣는 자리는 셋뿐이다: CREATE USER, ALTER USER, 리허설용 .cnf.
    const interp = lines.map((l) => l.replace(/\$\w+ = \$null;?/g, ''))
      .filter((l) => /"[^"\n]*\$(revPw|envRev|a1|a2|cand)\b[^"\n]*"/.test(l)).map((l) => l.trim());
    assert.strictEqual(interp.length, 3, `비밀번호를 문자열에 끼우는 자리가 ${interp.length}개다(3개여야 한다):\n${interp.join('\n')}`);
    assert.ok(/^"CREATE USER '\$UserName'@'\$acctHost' IDENTIFIED BY '\$revPw' PASSWORD EXPIRE NEVER;",$/.test(interp[0]), `첫 자리가 CREATE USER 가 아니다: ${interp[0]}`);
    assert.ok(/^"ALTER USER '\$UserName'@'\$acctHost' IDENTIFIED BY '\$revPw';",$/.test(interp[1]), `둘째 자리가 ALTER USER 가 아니다: ${interp[1]}`);
    assert.ok(/^\$revCnfText = "\[client\]/.test(interp[2]), `셋째 자리가 리허설용 .cnf 가 아니다: ${interp[2]}`);
    // 파일로는 %TEMP% 의 임시 .sql 과 임시 .cnf 로만 간다.
    const writes = lines.filter((l) => /\$(sqlLines|revCnfText)\b/.test(l) && /Write|Out-|Set-|Add-/.test(l)).map((l) => l.trim());
    assert.deepStrictEqual(writes.map((l) => (/WriteAllLines\(\$script:sqlPath, \$sqlLines, /.test(l) ? 'sql' : /WriteAllText\(\$script:revCnfPath, \$revCnfText, /.test(l) ? 'cnf' : l)),
      ['sql', 'cnf'], `비밀번호가 든 글을 쓰는 자리가 임시 .sql, 임시 .cnf 둘이 아니다:\n${writes.join('\n')}`);
    assert.ok(/\$script:sqlPath = Join-Path \$env:TEMP /.test(c) && /\$script:revCnfPath = Join-Path \$env:TEMP /.test(c), '비밀번호가 든 임시 파일이 %TEMP% 밖에 생긴다');
    // 명령줄에는 싣지 않는다: mysql 호출 줄에 비밀번호 변수가 없고, SQL 은 stdin(<)으로 간다.
    for (const l of lines.filter((x) => /\$mysql\b/.test(x))) assert.ok(!SECRET_RE.test(l), `mysql 명령줄에 비밀번호 변수가 있다: ${l.trim()}`);
    const run = lines.filter((l) => /<\s*`"\$\(\$script:sqlPath\)`"/.test(l));
    assert.strictEqual(run.length, 1, `임시 SQL 을 stdin 으로 흘리는 줄이 ${run.length}개다(1개여야 한다)`);
    assert.ok(!/--force|\s-e\s/.test(run[0]), `임시 SQL 실행에 --force 나 -e 가 있다: ${run[0].trim()}`);
    // 실행 직후 임시 SQL 을 지운다.
    const ri = lines.findIndex((l) => l === run[0]);
    assert.ok(/Remove-Item -LiteralPath \$script:sqlPath -Force/.test(lines.slice(ri + 1, ri + 3).join('\n')), '임시 SQL 을 실행 직후 지우지 않는다');
    // mysql 출력은 비밀번호 글자를 가린 $shown 으로만 화면에 간다.
    assert.ok(/\$shown = @\(\$runOut \| ForEach-Object \{ "\$_"\.Replace\(\$revPw, '\*{8}'\) \}\)/.test(c), 'mysql 출력에서 비밀번호 글자를 가리지 않는다');
    assert.ok(!lines.some((l) => /\$runOut\b/.test(l) && SINK_RE.test(l)), '가리지 않은 mysql 출력($runOut)을 화면에 찍는다');
    assert.ok(/foreach\(\$l in \$shown\)\{ if\("\$l"\.Trim\(\) -ne ""\)\{ Log /.test(c), 'mysql 출력을 가린 $shown 으로 찍지 않는다');
    // 보고서에는 화면에 찍은 줄만 간다.
    assert.ok(/WriteAllLines\(\$rp, \$script:logLines\.ToArray\(\), /.test(fnBody(c, 'SaveReport')), '보고서가 화면에 찍은 줄(logLines) 말고 다른 것을 쓴다');
    // 접속 안내에는 비밀번호 자리 대신 '따로 전달' 이 있다.
    assert.ok(/Log "  비밀번호  : 따로 전달/.test(c), '접속 안내에 "비밀번호는 따로 전달" 이 없다');
  },

  // ⑥ 권한: SELECT, SHOW VIEW 하나
  grants(ps) {
    const c = code(ps);
    assert.ok(c.includes('$REVIEWER_PRIVS = "SELECT, SHOW VIEW"'), '검토자 권한 상수가 "SELECT, SHOW VIEW" 가 아니다');
    const grantStmts = [...c.matchAll(/"GRANT [^"\n]*;"/g)].map((m) => m[0]);
    assert.deepStrictEqual(grantStmts, ['"GRANT $REVIEWER_PRIVS ON ``$dbGrant``.* TO \'$UserName\'@\'$acctHost\';"'],
      `GRANT 문장이 'GRANT SELECT, SHOW VIEW ON \`<db>\`.* TO 계정' 하나가 아니다: ${grantStmts.join(' | ')}`);
    assert.ok(!/GRANT OPTION|WITH ADMIN|ALL PRIVILEGES|\bGRANT ALL\b|PROXY/i.test(c.replace(/GRANT OPTION 없음/g, '')), 'GRANT OPTION, ALL, PROXY 같은 넓은 권한이 코드에 있다');
    assert.ok(!/"GRANT [^"\n]*\*\.\*[^"\n]*;"/.test(c), '*.* 에 권한을 주는 GRANT 문장이 있다');
    assert.ok(!/\bREVOKE\b|\bSET ROLE\b|\bCREATE ROLE\b|\bSET DEFAULT ROLE\b/.test(c), '역할이나 REVOKE 를 다루는 문장이 있다(이 도구는 계정 하나에 읽기만 준다)');
    assert.ok(/"CREATE USER '\$UserName'@'\$acctHost' IDENTIFIED BY '\$revPw' PASSWORD EXPIRE NEVER;"/.test(c) && !/CREATE USER IF NOT EXISTS/.test(c),
      'CREATE USER 가 정확한 계정과 PASSWORD EXPIRE NEVER 가 아니거나 IF NOT EXISTS 로 있는 계정을 덮는다');
    // DB 안의 표와 행은 바꾸지 않는다. 쓰기 시험(검토자 계정으로, 거부돼야 함)과 그 뒷정리만 예외다.
    const writes = c.split('\n').filter((l) => /\b(INSERT INTO|UPDATE \S+ SET|DELETE FROM|TRUNCATE|ALTER TABLE|DROP TABLE|CREATE TABLE|DROP DATABASE|CREATE DATABASE)\b/i.test(l)).map((l) => l.trim());
    assert.deepStrictEqual(writes, [
      '$probe = QRev "CREATE TABLE ``$DbName``.``reviewer_write_probe`` (x INT);"',
      '$null = QTry "DROP TABLE IF EXISTS ``$DbName``.``reviewer_write_probe``;"',
    ], `DB 의 표나 행을 바꾸는 문장이 있다(쓰기 시험 둘만 허용):\n${writes.join('\n')}`);
    // _ 는 DB 수준 GRANT 의 와일드카드다(partial_revokes 가 OFF 일 때). 그 DB 하나만 가리키게 \_ 로 적는다.
    assert.ok(/if\("\$partRev" -ne '1'\)\{ \$dbGrant = \$DbName\.Replace\('_', '\\_'\) \}/.test(c), 'DB 이름의 _ 를 GRANT 에서 이스케이프하지 않는다(다른 DB 까지 열린다)');
    assert.ok(/if\("\$mandRoles"\.Trim\(\) -ne ""\)\{\s*\n\s*DiePre /.test(c), 'mandatory_roles 가 있으면 멈추지 않는다(모든 계정에 붙는 역할이 읽기 전용을 깬다)');
  },

  // ⑦ 호스트와 계정 이름
  hostRules(ps) {
    const c = code(ps);
    const IPV4 = jsRe(psConst(c, 'IPV4_RE'));
    const NET24 = jsRe(psConst(c, 'NET24_RE'));
    const OCTET = jsRe(psConst(c, 'OCTET_RE'));
    const USER = jsRe(psConst(c, 'USER_RE'));
    const body = fnBody(c, 'ParseReviewerHost');
    // 판정 순서와 규칙이 소스에 그대로 있어야 아래 JS 판정이 소스를 대변한다.
    for (const [label, re] of [
      ['빈 값 거부', /if\(\[string\]::IsNullOrEmpty\(\$v\)\)\{ \$res\.Why = /],
      ["'%' 거부", /if\(\$v -eq '%'\)\{ \$res\.Why = /],
      ['두 꼴 밖 거부', /else \{ \$res\.Why = "IPv4 하나/],
      ['자리마다 0~255', /foreach\(\$o in \$oct\)\{ if\(-not \(OctetOk \$o\)\)\{ /],
      ['0 과 224 이상 거부', /if\(\$first -eq 0 -or \$first -ge 224\)\{ \$res\.Why = /],
      ['127.0.0.1 은 -AllowLocal 일 때만', /if\(\$m4\.Success -and \$v -eq '127\.0\.0\.1' -and \$allowLoopback\)\{/],
      ['/24 를 CIDR 로', /\$res\.Remote = \(\$oct -join '\.'\) \+ '\.0\/24'/],
    ]) assert.ok(re.test(body), `ParseReviewerHost 에 '${label}' 규칙이 없다: ${re}`);
    assert.ok(/return \(\$s -cmatch \$OCTET_RE\) -and \(\[int\]\$s -le 255\)/.test(c), 'OctetOk 가 0~255 와 앞자리 0 을 보지 않는다');
    // JS 로 같은 판정을 돌려 본다.
    const parse = (v, allow) => {
      if (!v) return null;
      if (v === '%') return null;
      const m4 = IPV4.exec(v); const m3 = NET24.exec(v);
      const oct = m4 ? m4.slice(1, 5) : m3 ? m3.slice(1, 4) : null;
      if (!oct) return null;
      if (!oct.every((o) => OCTET.test(o) && Number(o) <= 255)) return null;
      const first = Number(oct[0]);
      if (first === 0 || first >= 224) return null;
      if (first === 127) return (m4 && v === '127.0.0.1' && allow) ? { host: v, remote: v } : null;
      return m4 ? { host: v, remote: v } : { host: v, remote: oct.join('.') + '.0/24' };
    };
    assert.deepStrictEqual(parse('192.168.16.25', false), { host: '192.168.16.25', remote: '192.168.16.25' });
    assert.deepStrictEqual(parse('192.168.16.%', false), { host: '192.168.16.%', remote: '192.168.16.0/24' });
    assert.deepStrictEqual(parse('10.0.0.1', false), { host: '10.0.0.1', remote: '10.0.0.1' });
    assert.deepStrictEqual(parse('127.0.0.1', true), { host: '127.0.0.1', remote: '127.0.0.1' });
    for (const bad of ['', '%', '%%', 'localhost', 'LOCALHOST', '::1', '127.0.0.1', '192.168.%', '192.%', '192.168.16.%%', '%.168.16.1',
      '192.168.16._', '192.168.16.*', '192.168.16', '192.168.16.', '192.168.16.0/24', '192.168.016.25', '256.1.1.1', '1.2.3.256', '0.0.0.0', '224.0.0.1', '255.255.255.255',
      ' 192.168.16.25', '192.168.16.25 ', '192.168.16.25\n', '\u0661\u0669\u0662.168.16.25', 'reviewer-pc', '192.168.16.25%']) {
      assert.strictEqual(parse(bad, false), null, `받으면 안 되는 호스트를 받는다: ${JSON.stringify(bad)}`);
    }
    for (const bad of ['127.0.0.2', '127.0.0.%', '127.1.1.1']) assert.strictEqual(parse(bad, true), null, `-AllowLocal 이어도 127.0.0.1 밖의 루프백을 받는다: ${bad}`);
    // 계정 이름.
    assert.ok(/if\(\$UserName -cnotmatch \$USER_RE\)\{ DiePre /.test(c), '-UserName 형식을 대소문자 구분(-cnotmatch)으로 보지 않는다');
    for (const ok of ['reviewer', 'rev', 'ext_reviewer2', 'a' + 'b'.repeat(31)]) assert.ok(USER.test(ok), `쓸 수 있는 계정 이름을 거부한다: ${ok}`);
    for (const bad of ['re', 'Reviewer', '1reviewer', 'review-er', 'rev.iewer', "rev'x", 'a' + 'b'.repeat(32), 'reviewer\n', '']) {
      assert.ok(!USER.test(bad), `쓰면 안 되는 계정 이름을 받는다: ${JSON.stringify(bad)}`);
    }
    assert.ok(/\$RESERVED_USERS = @\('root', 'taskmgr_app', 'taskmgr_backup'\)/.test(c) &&
      /if\(\$RESERVED_USERS -contains \$UserName -or \$UserName -eq \$DbUser\)\{/.test(c),
      'root, 앱 계정, 백업 계정 이름을 막지 않는다(더 구체적인 호스트가 기존 계정을 가로챈다)');
    // 호스트는 파싱 결과(AcctHost)만 SQL 에 들어간다.
    assert.ok(/\$hostInfo = ParseReviewerHost \$ReviewerIp \(\[bool\]\$AllowLocal\)/.test(c) && /\$acctHost = \$hostInfo\.AcctHost/.test(c) &&
      /if\(-not \$hostInfo\.Ok\)\{ DiePre /.test(c), '-ReviewerIp 를 ParseReviewerHost 로 검사하고 실패면 멈추지 않는다');
    assert.ok(!/@'\$ReviewerIp'/.test(c), "SQL 에 -ReviewerIp 원문을 바로 넣는 자리가 있다(검사한 $acctHost 를 써야 한다)");
  },

  // ⑧ 검증과 되돌리기
  verify(ps) {
    const c = code(ps);
    assert.ok(/\$wantGrants = @\(\n\s*"GRANT USAGE ON \*\.\* TO ``\$UserName``@``\$acctHost``",\n\s*"GRANT \$REVIEWER_PRIVS ON ``\$dbGrant``\.\* TO ``\$UserName``@``\$acctHost``"\n\s*\)/.test(c),
      '기대 권한이 USAGE 와 그 DB 의 SELECT, SHOW VIEW 두 줄이 아니다');
    assert.ok(/\$g = QRowsTry "SHOW GRANTS FOR '\$UserName'@'\$acct';"/.test(fnBody(c, 'ShowGrants')), 'SHOW GRANTS FOR 로 권한을 읽지 않는다');
    assert.ok(/"-r" "-e" \$sql/.test(fnBody(c, 'QRowsTry')), 'SHOW GRANTS 를 --raw(-r) 로 읽지 않는다(\\_ 가 \\\\_ 로 바뀌어 대조가 어긋난다)');
    assert.ok(/if\(-not \$g\.Ok -or \(\(\$gotGrants -join "`n"\) -cne \(\$wantSorted -join "`n"\)\)\)\{/.test(c),
      '권한 대조가 줄 집합 전체를 대소문자까지 같게 보지 않는다');
    const mis = c.slice(c.indexOf('if(-not $g.Ok -or'), c.indexOf('Ok "권한 확인:'));
    assert.ok(/Rollback "권한이 읽기 전용 두 줄/.test(mis), '권한이 어긋나면 Rollback 을 부르지 않는다');
    const rb = fnBody(c, 'Rollback');
    assert.ok(/if\(\$mode -ne 'create'\)\{\s*\n\s*Finish \$EXIT_FAIL /.test(rb), 'Rollback 이 -ResetPassword(원래 있던 계정)까지 지운다');
    assert.ok(/QTry "DROP USER IF EXISTS '\$UserName'@'\$acctHost';"/.test(rb) && /SELECT COUNT\(\*\) FROM mysql\.user WHERE User = '\$UserName' AND Host = '\$acctHost';/.test(rb),
      'Rollback 이 DROP USER 로 지우고 사라졌는지 확인하지 않는다');
    assert.ok(/Finish \$EXIT_FAIL "중단: \$why \(종료코드 \$EXIT_FAIL\)\."/.test(rb), 'Rollback 이 종료코드 1 로 끝나지 않는다');
    // SQL 실패와 계정 수 어긋남도 되돌린다.
    assert.ok(/if\(\$runRc -ne 0 -or -not \$done\)\{[\s\S]{0,700}Rollback "계정 SQL 이 끝까지 가지 않았습니다/.test(c), '계정 SQL 이 실패하면 되돌리지 않는다');
    assert.ok(/if\("\$cnt" -ne '1'\)\{ \$revPw = \$null; Rollback /.test(c), '계정이 mysql.user 에 한 행인지 보지 않는다');
    // 같은 계정이 그 사이 생긴 경우(1396)는 이 실행이 만든 것이 아니라 지우지 않는다.
    assert.ok(/'ERROR 1396'[\s\S]{0,200}Finish \$EXIT_FAIL /.test(c), 'ERROR 1396(그 사이 생긴 계정)을 지우지 않고 멈추는 분기가 없다');
    // 리허설(127.0.0.1)에서는 실제로 붙어 쓰기가 거부되는지 본다.
    assert.ok(/if\(\$hostInfo\.Kind -eq 'local' -and \$dbIsLocal\)\{/.test(c) && /\$probe = QRev "CREATE TABLE /.test(c) &&
      /if\(\$probe\.Rc -eq 0\)\{[\s\S]{0,200}Rollback /.test(c), '로컬 리허설에서 쓰기 거부를 확인하지 않는다');
  },

  // ⑨ 방화벽
  firewall(ps) {
    const c = code(ps);
    assert.ok(/\$RULE_PREFIX\s*=\s*"TaskCalendar MySQL reviewer "/.test(c) && /\$ruleName = \$RULE_PREFIX \+ \$acctHost/.test(c), '방화벽 규칙 이름이 "TaskCalendar MySQL reviewer <ip>" 가 아니다');
    const fn = fnBody(c, 'IsElevated');
    assert.ok(/IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/.test(fn), 'IsElevated 가 관리자 역할을 보지 않는다');
    const news = [...c.matchAll(/^\s*New-NetFirewallRule .*$/gm)].map((m) => m[0].trim());
    assert.strictEqual(news.length, 1, `규칙을 만드는 New-NetFirewallRule 실행이 ${news.length}개다(1개여야 한다)`);
    const nl = news[0];
    for (const re of [/-DisplayName \$ruleName\b/, /-Direction Inbound\b/, /-Action Allow\b/, /-Protocol TCP\b/, /-LocalPort \$fwPort\b/, /-RemoteAddress \$hostInfo\.Remote\b/, /-Profile Domain,Private\b/, /-ErrorAction Stop\b/]) {
      assert.ok(re.test(nl), `New-NetFirewallRule 에 ${re} 가 없다: ${nl}`);
    }
    assert.ok(!/-RemoteAddress (Any|\*)/i.test(c), '방화벽 규칙이 아무 주소나 받는다');
    // 만드는 줄은 관리자 권한 분기(else) 안에만 있다. 아니면 명령을 보여 주고 실패로 치지 않는다.
    const s2 = c.indexOf('Step 2 "방화벽"');
    const s3 = c.indexOf('Step 3 "검토자에게 줄 접속 정보"');
    const seg = c.slice(s2, s3);
    const el = seg.indexOf('if(-not (IsElevated)){');
    assert.ok(s2 > 0 && s3 > s2 && el > 0, '방화벽 단계에서 관리자 권한을 먼저 보지 않는다');
    const notElev = seg.slice(el, seg.indexOf('} else {', el));
    assert.ok(/\$fwManual = \$true/.test(notElev) && /Log "     \$fwNewCmd"/.test(notElev) && !/Finish /.test(notElev) && !/New-NetFirewallRule /.test(notElev),
      '관리자 권한이 아닐 때 명령을 보여 주고 실패하지 않는 분기가 아니다');
    assert.ok(seg.indexOf('New-NetFirewallRule -DisplayName $ruleName') > seg.indexOf('} else {', el), 'New-NetFirewallRule 이 관리자 권한 분기 밖에 있다');
    assert.ok(/catch \{[\s\S]{0,300}Log "     \$fwNewCmd"[\s\S]{0,200}Finish \$EXIT_FIREWALL /.test(seg), '규칙을 만들다 실패하면 명령을 보여 주고 종료코드 6 으로 끝내지 않는다');
    // 보여 주는 명령이 실제로 만드는 규칙과 같다.
    assert.ok(c.includes('$fwNewCmd = "New-NetFirewallRule -DisplayName `"$ruleName`" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $fwPort -RemoteAddress $($hostInfo.Remote) -Profile Domain,Private"'),
      '보여 주는 New-NetFirewallRule 명령이 실제 규칙과 다르다');
    assert.ok(/if\(\$NoFirewall\)\{ \$fwSkipWhy = "-NoFirewall" \}/.test(c), '-NoFirewall 이 방화벽 단계를 건너뛰지 않는다');
    // 지우기(Remove-NetFirewallRule)도 관리자 권한 분기 안에서만.
    const removes = c.split('\n').map((l, i) => [l, i]).filter(([l]) => /\| Remove-NetFirewallRule /.test(l));
    assert.strictEqual(removes.length, 2, `Remove-NetFirewallRule 실행이 ${removes.length}개다(지우기와 다시 만들기, 2개)`);
    const lines = c.split('\n');
    for (const [, i] of removes) {
      const before = lines.slice(Math.max(0, i - 14), i).join('\n');
      assert.ok(/elseif\(-not \(IsElevated\)\)\{|if\(-not \(IsElevated\)\)\{/.test(before), `Remove-NetFirewallRule(${i + 1}행)이 관리자 권한 확인 뒤가 아니다`);
    }
  },

  // ⑩ 순서, -Yes, 리다이렉트
  order(ps) {
    const c = code(ps);
    const steps = [
      ['계정 이름 검사', /if\(\$UserName -cnotmatch \$USER_RE\)\{ DiePre /],
      ['호스트 검사', /\$hostInfo = ParseReviewerHost \$ReviewerIp/],
      ['관리 자격', /GetEnvironmentVariable\(\$ADMIN_PW_ENV\)/],
      ['접속', /\$serverVer = QTry "SELECT VERSION\(\);"/],
      ['bind_address', /\$bindAddr = QPre "SELECT @@bind_address;"/],
      ['-List 끝', /Finish \$EXIT_OK "완료: 목록을 보여 줬습니다/],
      ['있는지 확인', /\$existsNow = \[int\]\(QPre "SELECT COUNT\(\*\) FROM mysql\.user WHERE User = '\$UserName' AND Host = '\$acctHost';"/],
      ['이미 있으면 멈춤', /DiePre "'\$UserName'@'\$acctHost' 계정이 이미 있습니다\./],
      ['확인(Y)', /\$ans = Read-Host "계속하려면 Y"/],
      ['검토자 비밀번호', /\$revPw = GetReviewerPw/],
      ['임시 SQL 쓰기', /WriteAllLines\(\$script:sqlPath, \$sqlLines, /],
      ['SQL 실행', /<\s*`"\$\(\$script:sqlPath\)`"/],
      ['권한 검증', /\$g = ShowGrants \$acctHost/],
      ['방화벽', /Step 2 "방화벽"/],
      ['접속 안내', /Step 3 "검토자에게 줄 접속 정보"/],
    ];
    const at = steps.map(([label, re]) => [label, onlyOnce(c, re, label)]);
    for (let i = 1; i < at.length; i++) assert.ok(at[i - 1][1] < at[i][1], `단계 순서가 틀렸다: '${at[i - 1][0]}' 가 '${at[i][0]}' 보다 뒤에 있다`);
    assert.ok(/if\(\$mode -eq 'create' -and \$existsNow -ge 1\)\{[\s\S]{0,120}DiePre /.test(c), '계정이 이미 있으면(-ResetPassword 없이) 종료코드 3 으로 멈추지 않는다');
    assert.ok(/if\(-not \$Yes\)\{\s*\n\s*\$ans = Read-Host "계속하려면 Y"\s*\n\s*if\("\$ans"\.Trim\(\) -ne 'Y'\)\{ Finish \$EXIT_CANCEL /.test(c),
      '만들기 확인(Y)이 -Yes 로만 건너뛰어지지 않거나, Y 가 아닐 때 종료코드 2 로 끝내지 않는다');
    assert.ok(/if\(-not \$Yes\)\{\s*\n\s*\$ans = Read-Host "지우려면 Y"\s*\n\s*if\("\$ans"\.Trim\(\) -ne 'Y'\)\{ Finish \$EXIT_CANCEL /.test(c),
      '지우기 확인(Y)이 -Yes 로만 건너뛰어지지 않거나, Y 가 아닐 때 종료코드 2 로 끝내지 않는다');
    assert.ok(/if\(\[Console\]::IsInputRedirected -and -not \$Yes -and \$mode -ne 'list'\)\{ DiePre /.test(c), '리다이렉트된 무인 실행에서 -Yes 를 요구하지 않는다');
    assert.ok(/-and \[Console\]::IsInputRedirected -and\s*\n?\s*\[string\]::IsNullOrEmpty\(\[Environment\]::GetEnvironmentVariable\(\$REVIEWER_PW_ENV\)\)\)\{\s*\n\s*DiePre /.test(c),
      '무인 실행에서 검토자 비밀번호 환경변수가 없으면 접속 전에 멈추지 않는다');
    // 확인 문구: 계정, DB, 읽기 전용, 모든 직원의 데이터 경고.
    assert.ok(/Log "  권한      : 읽기 전용\(\$REVIEWER_PRIVS\)/.test(c) && /모든 직원의 일정, 할 일, 주간보고/.test(c), '확인 화면에 읽기 전용 권한과 모든 직원 데이터 경고가 없다');
  },

  // ⑪ 네트워크 점검
  network(ps) {
    const c = code(ps);
    for (const v of ['bind_address', 'port', 'skip_networking']) assert.ok(new RegExp(`QPre "SELECT @@${v};"`).test(c), `@@${v} 를 읽지 않는다`);
    assert.ok(/Info "bind_address = \$bindAddr, port = \$srvPort, skip_networking = \$skipNetText"/.test(c), 'bind_address, port, skip_networking 을 화면에 보여 주지 않는다');
    assert.ok(/\$loopOnly = .*'\^\(127\\\.\[0-9\.\]\+\|::1\|localhost\)\$'/.test(c), 'bind_address 가 루프백뿐인지 보지 않는다');
    assert.ok(/\$script:netBlocked = \("\$skipNet" -eq '1'\) -or \$loopOnly/.test(c), 'skip_networking=ON 이나 루프백 bind 를 원격 차단으로 보지 않는다');
    assert.ok(/\[regex\]::Match\(\$svcPath, '--defaults-file=/.test(c) && /Log "    고칠 곳: \$myIni \(서비스 \$ServiceName 의 --defaults-file\)"/.test(c),
      '원격 접속이 막혔을 때 서비스 binPath 의 --defaults-file(my.ini) 경로를 알려 주지 않는다');
    const blk = c.slice(c.indexOf('if($script:netBlocked){'), c.indexOf('Ok "원격 접속 설정'));
    assert.ok(!/DiePre|Finish/.test(blk), '원격 차단 경고가 멈춤이 되었다(경고하고 계속해야 한다)');
  },

  // ⑫ 안내, 지우기, 문서
  infoDropDocs(ps, doc) {
    const c = code(ps);
    assert.ok(/Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop \| Where-Object \{ \$_\.IPAddress -notmatch '\^\(127\\\.\|169\\\.254\\\.\)' \}/.test(c), '접속 안내가 루프백 밖의 IPv4 를 보여 주지 않는다');
    for (const re of [/Log "  포트      : \$srvPort"/, /Log "  사용자    : \$UserName"/, /Log "  DB\(스키마\): \$DbName"/, /MySQL Workbench: /, /DBeaver: /, /HeidiSQL: /,
      /Log "  지우는 법: \$dropHint"/, /\$dropHint = "reviewer-account\.cmd -Drop -ReviewerIp \$ReviewerIp"/,
      /if\(\$hostInfo\.Kind -eq 'local'\)\{ \$dropHint \+= " -AllowLocal -NoFirewall" \}/]) {
      assert.ok(re.test(c), `접속 안내에 빠진 줄이 있다: ${re}`);
    }
    const dropAt = onlyOnce(c, /\$dr = QTry "DROP USER IF EXISTS '\$UserName'@'\$acctHost';"/, '-Drop 의 DROP USER');
    const askAt = onlyOnce(c, /\$ans = Read-Host "지우려면 Y"/, '-Drop 확인');
    assert.ok(askAt < dropAt, '-Drop 이 확인(Y) 전에 지운다');
    assert.ok(/if\(\$null -eq \$dr -or "\$left" -ne '0'\)\{\s*\n\s*Finish \$EXIT_FAIL /.test(c), '-Drop 이 계정이 사라졌는지 확인하지 않는다');
    // 문서.
    const at = doc.indexOf('### 검토자 읽기 전용 계정(reviewer-account.cmd)');
    assert.ok(at > 0, 'db/deploy/README.md 에 "검토자 읽기 전용 계정(reviewer-account.cmd)" 절이 없다');
    const sec = doc.slice(at, doc.indexOf('\n## ', at) > 0 ? doc.indexOf('\n## ', at) : undefined);
    for (const [label, re] of [
      ['root 를 쓰지 않는 이유', /root@localhost/], ['앱 계정을 쓰지 않는 이유', /taskmgr_app/], ['관리자 권한 실행', /관리자 권한/],
      ['검토자에게 줄 것', /따로 전달/], ['데이터 노출', /모든 직원/], ['지우기', /-Drop -ReviewerIp/], ['종료코드', /종료코드/],
      ['회귀 계약', /tests\/reviewer-account-cmd\.test\.mjs/],
    ]) assert.ok(re.test(sec), `README 의 검토자 계정 절에 '${label}' 이 없다`);
    assert.ok(!/—|–| · |「|」/.test(sec), 'README 의 검토자 계정 절에 줄표, 띄운 가운데 점, 낫표가 있다');
  },
};

// ══ 계약 ════════════════════════════════════════════════════════════════
test('reviewer-account ① .cmd: ASCII 만, ps1 을 Bypass -File 로, 인자 %*, 실패면 멈춤', () => checks.cmdShape(cmdSrc));
test('reviewer-account ② 종료코드 표: .ps1 과 .cmd 가 같고 실제로 내는 코드와 같다(0, 1, 2, 3, 6)', () => checks.exitCodes(psSrc, cmdSrc));
test('reviewer-account ③ 기본값: reviewer, taskcalendar, 127.0.0.1:3306, C:\\mysql, MySQL84, root, dist\\reviewer-account', () => checks.defaults(psSrc));
test('reviewer-account ④ 관리 비밀번호: 인자 없음, .cnf 로만, Cleanup(임시 파일 셋)과 finally, 자격 순서', () => checks.adminSecret(psSrc));
test('reviewer-account ⑤ 검토자 비밀번호: 인자 없음, 두 번 입력, 12자, 안전한 글자, 임시 .sql 과 .cnf 로만, 화면과 보고서에 없음', () => checks.reviewerSecret(psSrc));
test('reviewer-account ⑥ 권한: GRANT 는 SELECT, SHOW VIEW ON `<db>`.* 하나, ALL 과 GRANT OPTION 없음, DB 쓰기 없음', () => checks.grants(psSrc));
test("reviewer-account ⑦ 호스트: IPv4 하나나 /24 꼴만, '%' 와 빈 값과 이름과 루프백(-AllowLocal 밖) 거부, 계정 이름 형식", () => checks.hostRules(psSrc));
test('reviewer-account ⑧ 검증: SHOW GRANTS 두 줄, 어긋나면 DROP USER 로 되돌리고 1', () => checks.verify(psSrc));
test('reviewer-account ⑨ 방화벽: 관리자일 때만 규칙(TCP 포트, 그 IP, Domain,Private), 아니면 명령만, 실패는 6', () => checks.firewall(psSrc));
test('reviewer-account ⑩ 순서: 검사, 접속, 있는지, 확인(Y), 비밀번호, SQL, 검증, 방화벽, 안내. -Yes 와 리다이렉트', () => checks.order(psSrc));
test('reviewer-account ⑪ 네트워크 점검: bind_address, port, skip_networking, 막혔으면 my.ini 경로', () => checks.network(psSrc));
test('reviewer-account ⑫ 안내(비밀번호 없음), -Drop(확인, DROP USER IF EXISTS, 확인), README 절', () => checks.infoDropDocs(psSrc, readme));

// ══ 변이 주입: 위 계약이 정말 우는지 ═══════════════════════════════════
// 대조군: 원본은 통과해야 한다. 통과하지 않으면 아래 throws 는 아무것도 증명하지 못한다.
test('변이①: .cmd 가 인자(%*)를 넘기지 않으면 계약① 이 실패한다', () => {
  assert.doesNotThrow(() => checks.cmdShape(cmdSrc));
  const bad = mutate(cmdSrc, '"%~dp0reviewer-account.ps1" %*', '"%~dp0reviewer-account.ps1"');
  assert.throws(() => checks.cmdShape(bad), /인자 %\*/);
});
test('변이①-b: .cmd 에 한글을 한 글자 넣으면 계약① 이 실패한다', () => {
  const bad = mutate(cmdSrc, 'rem  ASCII ONLY.', 'rem  ASCII ONLY. 한');
  assert.throws(() => checks.cmdShape(bad), /비ASCII/);
});
test('변이②: .cmd 의 종료코드 한 줄만 바꿔도 계약② 가 실패한다', () => {
  assert.doesNotThrow(() => checks.exitCodes(psSrc, cmdSrc));
  const bad = mutate(cmdSrc, 'rem    6 firewall step failed', 'rem    6 firewall step broken');
  assert.throws(() => checks.exitCodes(psSrc, bad), /줄 단위로 같지 않다/);
});
test('변이②-b: 표에 없는 코드를 실제로 내면 계약② 가 실패한다', () => {
  const bad = mutate(psSrc, '$EXIT_FIREWALL  = 6', '$EXIT_FIREWALL  = 4');
  assert.throws(() => checks.exitCodes(bad, cmdSrc), /표와 다르다/);
});
test('변이③: 기본 계정 이름을 root 로 바꾸면 계약③ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.defaults(psSrc));
  const bad = mutate(psSrc, '[string]$UserName = "reviewer",', '[string]$UserName = "root",');
  assert.throws(() => checks.defaults(bad), /param 기본값/);
});
test('변이④: 관리 비밀번호 인자를 param 에 더하면 계약④ 가 실패한다', () => {
  assert.doesNotThrow(() => checks.adminSecret(psSrc));
  const bad = mutate(psSrc, '  [string]$OutDir = "",', '  [string]$OutDir = "",\n  [string]$RootPassword = "",');
  assert.throws(() => checks.adminSecret(bad), /비밀번호를 받는 인자/);
});
test('변이④-b: Cleanup 이 임시 SQL 을 안 지우면 계약④ 가 실패한다', () => {
  const bad = mutate(psSrc, '  if($script:sqlPath){ Remove-Item -LiteralPath $script:sqlPath -Force -ErrorAction SilentlyContinue; $script:sqlPath = $null }\n', '');
  assert.throws(() => checks.adminSecret(bad), /sqlPath/);
});
test('변이④-c: finally 에서 Cleanup 을 빼면 계약④ 가 실패한다', () => {
  const bad = mutate(psSrc, '} finally {\n  # exit(Finish) 로 끝나도 finally 는 돈다. Cleanup 은 두 번 불려도 안전하다.\n  Cleanup\n}', '} finally {\n}');
  assert.throws(() => checks.adminSecret(bad), /finally 블록이 Cleanup/);
});
test('변이⑤: 검토자 비밀번호 인자를 param 에 더하면 계약④ 가 실패한다', () => {
  const bad = mutate(psSrc, '  [string]$OutDir = "",', '  [string]$OutDir = "",\n  [string]$ReviewerPw = "",');
  assert.throws(() => checks.adminSecret(bad), /비밀번호를 받는 인자/);
});
test('변이⑤-b: 검토자 비밀번호를 화면(로그)에 찍으면 계약⑤ 가 실패한다', () => {
  assert.doesNotThrow(() => checks.reviewerSecret(psSrc));
  const bad = mutate(psSrc, '  Ok "계정 SQL 완료"\n', '  Ok "계정 SQL 완료"\n  Info "검토자 비밀번호: $revPw"\n');
  assert.throws(() => checks.reviewerSecret(bad), /화면이나 보고서로 가는 줄/);
});
test('변이⑤-c: 가리지 않은 mysql 출력을 찍으면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, '  foreach($l in $shown){ if("$l".Trim() -ne ""){ Log "      $l" } }', '  foreach($l in $runOut){ if("$l".Trim() -ne ""){ Log "      $l" } }');
  assert.throws(() => checks.reviewerSecret(bad), /mysql 출력/);
});
test('변이⑤-d: 계정 SQL 을 -e(명령줄)로 넘기면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, '  $script:sqlPath = Join-Path $env:TEMP ("myreviewer_" + [IO.Path]::GetRandomFileName() + ".sql")\n',
    '  $script:sqlPath = Join-Path $env:TEMP ("myreviewer_" + [IO.Path]::GetRandomFileName() + ".sql")\n  $x = & $mysql "--defaults-extra-file=$($script:cnfPath)" "-e" ($sqlLines -join " ")\n');
  assert.throws(() => checks.reviewerSecret(bad), /mysql 명령줄에 비밀번호 변수/);
});
test('변이⑤-e: 임시 SQL 을 기록 폴더에 쓰면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, '$script:sqlPath = Join-Path $env:TEMP ("myreviewer_"', '$script:sqlPath = Join-Path $OutDir ("myreviewer_"');
  assert.throws(() => checks.reviewerSecret(bad), /%TEMP% 밖/);
});
test('변이⑤-f: 비밀번호 길이 검사를 빼면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, '  if($cand.Length -lt $REVIEWER_PW_MIN){ return "$REVIEWER_PW_MIN 자 이상이어야 합니다." }\n', '');
  assert.throws(() => checks.reviewerSecret(bad), /길이/);
});
test('변이⑤-g: 비밀번호 글자 규칙이 따옴표를 받으면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, "$PW_CHARS_RE = '^[\\x21\\x23-\\x26\\x28-\\x5B\\x5D-\\x5F\\x61-\\x7E]+\\z'", "$PW_CHARS_RE = '^[\\x21-\\x7E]+\\z'");
  assert.throws(() => checks.reviewerSecret(bad), /깰 수 있는 글자/);
});
test('변이⑤-h: 두 번 입력 대조를 빼면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, '    $same = ($a1 -ceq $a2)\n', '    $same = $true\n');
  assert.throws(() => checks.reviewerSecret(bad), /대조/);
});
test('변이⑥: GRANT 를 ALL PRIVILEGES 로 바꾸면 계약⑥ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.grants(psSrc));
  const bad = mutate(psSrc, '"GRANT $REVIEWER_PRIVS ON ``$dbGrant``.* TO \'$UserName\'@\'$acctHost\';"', '"GRANT ALL PRIVILEGES ON ``$dbGrant``.* TO \'$UserName\'@\'$acctHost\';"');
  assert.throws(() => checks.grants(bad), /GRANT 문장|넓은 권한/);
});
test('변이⑥-b: GRANT 에 WITH GRANT OPTION 을 붙이면 계약⑥ 이 실패한다', () => {
  const bad = mutate(psSrc, 'TO \'$UserName\'@\'$acctHost\';",\n      "SELECT \'account-done\';"', 'TO \'$UserName\'@\'$acctHost\' WITH GRANT OPTION;",\n      "SELECT \'account-done\';"');
  assert.throws(() => checks.grants(bad), /GRANT 문장|넓은 권한/);
});
test('변이⑥-c: 권한 상수에 INSERT 를 더하면 계약⑥ 이 실패한다', () => {
  const bad = mutate(psSrc, '$REVIEWER_PRIVS = "SELECT, SHOW VIEW"', '$REVIEWER_PRIVS = "SELECT, INSERT, SHOW VIEW"');
  assert.throws(() => checks.grants(bad), /SELECT, SHOW VIEW/);
});
test('변이⑥-d: *.* 에 SELECT 를 주면 계약⑥ 이 실패한다', () => {
  const bad = mutate(psSrc, '"GRANT $REVIEWER_PRIVS ON ``$dbGrant``.* TO \'$UserName\'@\'$acctHost\';"', '"GRANT $REVIEWER_PRIVS ON *.* TO \'$UserName\'@\'$acctHost\';"');
  assert.throws(() => checks.grants(bad), /GRANT 문장|\*\.\*/);
});
test('변이⑥-e: CREATE USER IF NOT EXISTS 로 바꾸면 계약⑥ 이 실패한다', () => {
  const bad = mutate(psSrc, '"CREATE USER \'$UserName\'', '"CREATE USER IF NOT EXISTS \'$UserName\'');
  assert.throws(() => checks.grants(bad), /CREATE USER/);
});
test("변이⑦: '%' 거부를 빼면 계약⑦ 이 실패한다", () => {
  assert.doesNotThrow(() => checks.hostRules(psSrc));
  const bad = mutate(psSrc, "  if($v -eq '%'){ $res.Why = \"'%' 는 어느 PC 에서든 접속을 허용합니다. 받지 않습니다.\"; return $res }\n", '');
  assert.throws(() => checks.hostRules(bad), /'%' 거부/);
});
test('변이⑦-b: /24 꼴 정규식의 .% 를 느슨하게 하면 계약⑦ 이 실패한다', () => {
  const bad = mutate(psSrc, "$NET24_RE = '^([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})\\.%\\z'", "$NET24_RE = '^([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})\\.?%?\\z'");
  assert.throws(() => checks.hostRules(bad), /받으면 안 되는 호스트/);
});
test('변이⑦-c: 127.0.0.1 을 -AllowLocal 없이 받으면 계약⑦ 이 실패한다', () => {
  const bad = mutate(psSrc, "if($m4.Success -and $v -eq '127.0.0.1' -and $allowLoopback){", "if($m4.Success -and $v -eq '127.0.0.1'){");
  assert.throws(() => checks.hostRules(bad), /-AllowLocal/);
});
test('변이⑦-d: IPv4 정규식 끝을 \\z 에서 빼면(뒤에 무엇이든) 계약⑦ 이 실패한다', () => {
  const bad = mutate(psSrc, "$IPV4_RE  = '^([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})\\z'", "$IPV4_RE  = '^([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})'");
  assert.throws(() => checks.hostRules(bad), /받으면 안 되는 호스트/);
});
test('변이⑦-e: 앱 계정 이름을 예약에서 빼면 계약⑦ 이 실패한다', () => {
  const bad = mutate(psSrc, "$RESERVED_USERS = @('root', 'taskmgr_app', 'taskmgr_backup')", "$RESERVED_USERS = @('root')");
  assert.throws(() => checks.hostRules(bad), /앱 계정/);
});
test('변이⑧: 권한이 어긋날 때 되돌리지 않으면 계약⑧ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.verify(psSrc));
  const bad = mutate(psSrc, '    Rollback "권한이 읽기 전용 두 줄(USAGE, $REVIEWER_PRIVS)과 다릅니다"', '    Warn "권한이 읽기 전용 두 줄(USAGE, $REVIEWER_PRIVS)과 다릅니다"');
  assert.throws(() => checks.verify(bad), /Rollback/);
});
test('변이⑧-b: Rollback 이 DROP USER 를 내지 않으면 계약⑧ 이 실패한다', () => {
  const bad = mutate(psSrc, `    $null = QTry "DROP USER IF EXISTS '$UserName'@'$acctHost';"\n`, '');
  assert.throws(() => checks.verify(bad), /DROP USER/);
});
test('변이⑧-c: 권한 대조가 USAGE 줄만 보면 계약⑧ 이 실패한다', () => {
  const bad = mutate(psSrc, '  if(-not $g.Ok -or (($gotGrants -join "`n") -cne ($wantSorted -join "`n"))){', '  if(-not $g.Ok -or ($gotGrants -notcontains $wantGrants[0])){');
  assert.throws(() => checks.verify(bad), /줄 집합 전체/);
});
test('변이⑧-d: Rollback 이 -ResetPassword 계정까지 지우면 계약⑧ 이 실패한다', () => {
  const bad = mutate(psSrc, "    if($mode -ne 'create'){\n      Finish $EXIT_FAIL", "    if($false){\n      Finish $EXIT_FAIL");
  assert.throws(() => checks.verify(bad), /ResetPassword/);
});
test('변이⑨: 관리자 권한 확인 없이 규칙을 만들면 계약⑨ 가 실패한다', () => {
  assert.doesNotThrow(() => checks.firewall(psSrc));
  const bad = mutate(psSrc, '    if(-not (IsElevated)){\n      $fwManual = $true', '    if($false){\n      $fwManual = $true');
  assert.throws(() => checks.firewall(bad), /관리자 권한/);
});
test('변이⑨-b: 규칙이 아무 주소나 받으면 계약⑨ 가 실패한다', () => {
  const bad = mutate(psSrc, '-LocalPort $fwPort -RemoteAddress $hostInfo.Remote `', '-LocalPort $fwPort -RemoteAddress Any `');
  assert.throws(() => checks.firewall(bad), /RemoteAddress|아무 주소/);
});
test('변이⑨-c: 규칙에 Public 프로필을 더하면 계약⑨ 가 실패한다', () => {
  const bad = mutate(psSrc, '          -Profile Domain,Private -ErrorAction Stop | Out-Null', '          -Profile Any -ErrorAction Stop | Out-Null');
  assert.throws(() => checks.firewall(bad), /Domain,Private/);
});
test('변이⑨-d: 관리자 권한이 아닐 때 실패로 끝내면 계약⑨ 가 실패한다', () => {
  const bad = mutate(psSrc, '      $fwManual = $true\n', '      $fwManual = $true\n      Finish $EXIT_FIREWALL "관리자 권한이 아닙니다." \'Red\'\n');
  assert.throws(() => checks.firewall(bad), /실패하지 않는 분기/);
});
test('변이⑩: 비밀번호를 확인(Y)보다 먼저 받으면 계약⑩ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.order(psSrc));
  const a = mutate(psSrc, '  $revPw = GetReviewerPw\n', '');
  const bad = mutate(a, '  if($mode -eq \'create\' -and $existsNow -ge 1){', '  $revPw = GetReviewerPw\n  if($mode -eq \'create\' -and $existsNow -ge 1){');
  assert.throws(() => checks.order(bad), /단계 순서/);
});
test('변이⑩-b: 이미 있는 계정을 멈추지 않으면 계약⑩ 이 실패한다', () => {
  const bad = mutate(psSrc, "  if($mode -eq 'create' -and $existsNow -ge 1){", "  if($false){");
  assert.throws(() => checks.order(bad), /이미 있으면/);
});
test('변이⑩-c: 리다이렉트된 무인 실행에서 -Yes 를 요구하지 않으면 계약⑩ 이 실패한다', () => {
  const bad = mutate(psSrc, "if([Console]::IsInputRedirected -and -not $Yes -and $mode -ne 'list'){ DiePre ", 'if($false){ DiePre ');
  assert.throws(() => checks.order(bad), /-Yes/);
});
test('변이⑪: 원격 차단 경고에서 my.ini 경로를 빼면 계약⑪ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.network(psSrc));
  const bad = mutate(psSrc, '    if($myIni){ Log "    고칠 곳: $myIni (서비스 $ServiceName 의 --defaults-file)" \'Yellow\' }\n    else', '    if($myIni){ }\n    else');
  assert.throws(() => checks.network(bad), /defaults-file/);
});
test('변이⑪-b: 원격 차단을 멈춤으로 바꾸면 계약⑪ 이 실패한다', () => {
  const bad = mutate(psSrc, '    Log "    계정은 계속 만듭니다. 설정을 고치기 전에는 검토자가 붙지 못합니다." \'Yellow\'\n', '    DiePre "원격 접속이 막혀 있습니다."\n');
  assert.throws(() => checks.network(bad), /멈춤/);
});
test('변이⑫: 접속 안내에서 지우는 법을 빼면 계약⑫ 가 실패한다', () => {
  assert.doesNotThrow(() => checks.infoDropDocs(psSrc, readme));
  const bad = mutate(psSrc, '  Log "  지우는 법: $dropHint" \'Cyan\'\n', '');
  assert.throws(() => checks.infoDropDocs(bad, readme), /지우는 법/);
});
test('변이⑫-b: README 의 검토자 계정 절에서 데이터 노출 안내를 빼면 계약⑫ 가 실패한다', () => {
  const at = readme.indexOf('### 검토자 읽기 전용 계정(reviewer-account.cmd)');
  const end = readme.indexOf('\n## ', at);
  const bad = readme.slice(0, at) + readme.slice(at, end).replaceAll('모든 직원', '직원') + readme.slice(end);
  assert.throws(() => checks.infoDropDocs(psSrc, bad), /데이터 노출/);
});
