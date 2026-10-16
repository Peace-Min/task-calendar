// Layer 1: 모든 직원의 열람 범위를 전체로 바꾸는 운영 도구(db/deploy/scope-all.ps1 / .cmd)의 계약을 소스 텍스트만으로 본다.
// MySQL 을 돌리지 않는다(실제 실행은 사람이 격리 DB 와 실 DB 에서 한다).
//
// 왜 있나
//   이 도구는 app_user 전 행의 권한 열 하나를 한 번에 바꾼다. 순서 하나(되돌리기 파일보다 UPDATE 가 먼저),
//   가드 하나(바뀐 행 수 확인, 비밀번호 인자)가 빠지면 되돌릴 근거가 없거나 다른 열까지 바뀐다. 그래서 못 박는다:
//     ① .cmd 는 ASCII 만, ps1 을 -ExecutionPolicy Bypass -File 로, 인자는 %* 로 넘긴다, 실패면 멈춘다
//     ② 종료코드 표가 .ps1 과 .cmd 에서 줄 단위로 같고, ps1 이 실제로 내는 코드와 같다(0, 1, 2, 3, 5)
//     ③ 기본값: DbName taskcalendar, 127.0.0.1, 3306, C:\mysql, MySQL84, root, OutDir(dist\scope-all), -Yes
//     ④ 비밀번호는 인자로 받지 않고 .cnf(--defaults-extra-file)로만 넘기며, .cnf 는 Cleanup 이 지우고 finally 가 부른다
//     ⑤ 순서: 사전 점검, 계획(0 이면 0 으로 끝), 확인(Y), 되돌리기 파일 쓰기와 검증, 그다음에야 UPDATE.
//        -Yes 가 확인만 건너뛰고, 리다이렉트된 무인 실행은 -Yes 를 요구한다
//     ⑥ 변경은 트랜잭션 하나: 계획한 user_id 목록 확인, UPDATE, ROW_COUNT 가 계획과 같을 때만 COMMIT, --force 없음
//     ⑦ view_scope 만 바꾼다(UPDATE 의 SET 이 view_scope 하나, edit_role 이나 updated_at 을 쓰지 않는다)
//     ⑧ 'all' 판정 식은 $NOT_ALL 하나(이진 비교)로, 세기, 계획, UPDATE, 확인이 모두 그것을 쓴다
//     ⑨ 되돌리기 파일: HEX 로 읽은 옛 값, 숫자 user_id, 줄 모양과 검증 식이 맞물린다, 실패면 5
//     ⑩ 실물: 위젯이 view_scope 를 요청마다 새로 읽는다는 안내가 호스트 코드와 맞는다
//   각 계약에 변이 주입을 짝으로 둔다(이 저장소의 관례: 검사가 정말 잡는지 증명한다).
//
// 공용 기계(주석 마스커, 비번 검사, 종료코드 표, 변이 주입기)는 tests/ps-guard-lib.mjs 의 것을 쓴다.
import { test, assert } from './harness.mjs';
import { readFileSync } from 'node:fs';
import {
  maskPs, passwordOnCommandLineHits, exitCodeTable, exitCodesInTable, exitCodesUsed,
  mutate, nonAsciiLines,
} from './ps-guard-lib.mjs';

const PS_URL  = new URL('../db/deploy/scope-all.ps1', import.meta.url);
const CMD_URL = new URL('../db/deploy/scope-all.cmd', import.meta.url);
const psBytes = readFileSync(PS_URL);
const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const psSrc  = norm(readFileSync(PS_URL, 'utf8'));
const cmdSrc = norm(readFileSync(CMD_URL).toString('latin1'));
const R = (p) => norm(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const hostSrc = {
  projectDb: R('widget/ProjectDb.cs'),
  calendarDb: R('widget/CalendarDb.cs'),
  mainWindow: R('widget/MainWindow.xaml.cs'),
  userSession: R('widget/UserSession.cs'),
};

// 정확히 한 번 나와야 하는 앵커의 위치(마스킹한 코드에서).
function onlyOnce(code, re, label) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const hits = [...code.matchAll(g)];
  assert.strictEqual(hits.length, 1, `${label} 이(가) ${hits.length}번 나온다(1번이어야 한다), 패턴 ${re}`);
  return hits[0].index;
}
// param( ... ) 블록(마스킹한 코드에서 첫 param 부터 짝 괄호까지).
function paramBlock(code) {
  const s = code.search(/\bparam\(/);
  assert.ok(s >= 0, 'param( 블록을 찾지 못했다');
  let depth = 0;
  for (let k = code.indexOf('(', s); k < code.length; k++) {
    if (code[k] === '(') depth++;
    else if (code[k] === ')') { depth--; if (depth === 0) return code.slice(s, k + 1); }
  }
  assert.fail('param( 블록의 끝을 찾지 못했다');
}
// 적용 트랜잭션의 SQL 줄 묶음($txLines = @( ... )).
function txBlock(code) {
  const m = /\$txLines = @\(\n([\s\S]*?)\n\s*\)\n/.exec(code);
  assert.ok(m, '$txLines = @( ... ) 블록(적용 트랜잭션)을 찾지 못했다');
  return m[1].split('\n').map((l) => l.trim()).filter(Boolean);
}
// 적용 SQL 을 mysql 에 흘려 넣는 줄.
function applyLine(code) {
  const lines = code.split('\n').filter((l) => /<\s*`"\$applySql`"/.test(l));
  assert.strictEqual(lines.length, 1, `적용 SQL 을 mysql 에 흘려 넣는 줄이 ${lines.length}개다(1개여야 한다)`);
  return lines[0];
}
// C# 의 // 주석을 걷어낸 코드(문자열 속 // 는 이 파일들의 판정 대상 줄에 없다).
const csCode = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

// ══ 검사 함수(테스트와 변이 주입이 같은 함수를 쓴다) ═══════════════════
const checks = {
  // ① .cmd 모양
  cmdShape(cmd) {
    assert.deepStrictEqual(nonAsciiLines(cmd), [], '.cmd 에 비ASCII 가 있다(cmd.exe 바이트 오프셋 사고)');
    const body = cmd.split('\n').filter((l) => !/^\s*rem\b/i.test(l)).join('\n');
    assert.ok(/powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scope-all\.ps1" %\*/.test(body),
      '.cmd 가 같은 폴더의 scope-all.ps1 을 -ExecutionPolicy Bypass -File 로, 인자 %* 와 함께 부르지 않는다');
    assert.ok(/set "TC_SCOPE_ALL_LAUNCHER=cmd"/.test(body), '.cmd 가 TC_SCOPE_ALL_LAUNCHER=cmd 를 세우지 않는다(ps1 의 창 멈춤 규칙)');
    assert.ok(/if errorlevel 1 pause/.test(body) && /exit \/b %RC%/.test(body),
      '.cmd 가 실패면 멈추고(pause) 종료코드를 그대로 돌려주지 않는다');
  },

  // ② 종료코드 표
  exitCodes(ps, cmd) {
    const a = exitCodeTable(ps, false);
    const b = exitCodeTable(cmd, true);
    assert.deepStrictEqual(b, a, '.ps1 과 .cmd 의 종료코드 표가 줄 단위로 같지 않다');
    const table = exitCodesInTable(a);
    assert.deepStrictEqual(table, [0, 1, 2, 3, 5], `종료코드 표가 0, 1, 2, 3, 5 가 아니다: ${table.join(',')}`);
    assert.deepStrictEqual(exitCodesUsed(ps), table, `ps1 이 실제로 내는 코드(${exitCodesUsed(ps).join(',')})가 표와 다르다`);
  },

  // ③ 기본값
  defaults(ps) {
    const code = maskPs(ps);
    const p = paramBlock(code);
    const want = [
      /\[string\]\$DbName = "taskcalendar",/, /\[string\]\$DbHost = "127\.0\.0\.1",/, /\[int\]\$Port = 3306,/,
      /\[string\]\$BaseDir = "C:\\mysql",/, /\[string\]\$ServiceName = "MySQL84",/, /\[string\]\$DbUser = "root",/,
      /\[string\]\$OutDir = "",/, /\[switch\]\$Yes\b/,
    ];
    for (const re of want) assert.ok(re.test(p), `param 기본값이 바뀌었거나 사라졌다: ${re}`);
    assert.ok(/\$OutDir = Join-Path \$scriptDir "\.\.\\\.\.\\dist\\scope-all"/.test(code),
      '기본 기록 폴더가 <스크립트>\\..\\..\\dist\\scope-all 이 아니다');
    assert.ok(/\$toolRoots\.Add\(\$BaseDir\)/.test(code) && /Win32_Service -Filter "Name='\$ServiceName'"/.test(code) &&
      /\$DEFAULT_MYSQL_DIR = "C:\\Program Files\\MySQL\\MySQL Server 8\.4"/.test(code) && /\$toolRoots\.Add\(\$DEFAULT_MYSQL_DIR\)/.test(code),
      'mysql.exe 찾기가 -BaseDir, 서비스 binPath, 기본 설치 경로 순서를 다 보지 않는다');
  },

  // ④ 비밀번호
  secrets(ps) {
    const bad = passwordOnCommandLineHits(ps);
    assert.deepStrictEqual(bad, [], `비밀번호를 명령줄로 넘기는 자리가 생겼다: ${bad.join(' , ')}`);
    const code = maskPs(ps);
    const p = paramBlock(code);
    assert.ok(!/\$\w*(Password|Passwd|Pwd|Pw)\b/i.test(p),
      '비밀번호를 받는 인자가 param 에 있다(같은 사용자의 다른 프로세스가 명령줄을 읽는다). 환경변수, stdin, 가려진 입력으로만 받는다');
    const extra = code.match(/--defaults-extra-file=/g) || [];
    assert.ok(extra.length >= 3, '--defaults-extra-file 로 .cnf 를 넘기는 자리가 없다(검사가 볼 대상이 사라졌다)');
    for (const l of code.split('\n')) {
      if (/&\s*\$mysql\b/.test(l) || /cmd \/c "`"\$mysql`"/.test(l)) {
        assert.ok(/--defaults-extra-file=/.test(l), `mysql 호출이 .cnf 없이 나간다: ${l.trim().slice(0, 100)}`);
      }
    }
    const cl = /function Cleanup\(\)\{([\s\S]*?)\n\}/.exec(code);
    assert.ok(cl && /Remove-Item -LiteralPath \$script:cnfPath/.test(cl[1]), 'Cleanup 이 임시 .cnf 를 지우지 않는다');
    assert.ok(/\}\s*finally\s*\{\s*(?:\n\s*)*Cleanup\b/.test(code), 'finally 블록이 Cleanup 을 부르지 않는다');
    const fin = /function Finish\([^)]*\)\{([\s\S]*?)\n\}/.exec(code);
    assert.ok(fin && /\bCleanup\b/.test(fin[1]) && fin[1].indexOf('Cleanup') < fin[1].indexOf('exit $code'),
      'Finish 가 종료 전에 Cleanup 을 부르지 않는다');
    assert.ok(/WriteAllText\(\$script:cnfPath, \$cnfText, \(New-Object System\.Text\.UTF8Encoding\(\$false\)\)\)/.test(code),
      '.cnf 를 BOM 없는 UTF-8 로 쓰는 자리가 바뀌었다');
    const envAt = onlyOnce(code, /GetEnvironmentVariable\(\$ADMIN_PW_ENV\)/, '환경변수 읽기');
    const stdinAt = onlyOnce(code, /\$r = ReadStdinLineBounded \$STDIN_WAIT_SEC/, '상한 있는 stdin 읽기');
    const promptAt = onlyOnce(code, /Read-Host "MySQL \$DbUser 비밀번호" -AsSecureString/, '가려진 입력');
    assert.ok(envAt < stdinAt && stdinAt < promptAt, '자격 순서가 환경변수, stdin, 가려진 입력이 아니다');
    assert.ok(/\$ADMIN_PW_ENV\s*=\s*"TASKMGR_ADMIN_PW"/.test(code) && /\$STDIN_WAIT_SEC\s*=\s*10\b/.test(code),
      '환경변수 이름(TASKMGR_ADMIN_PW)이나 stdin 상한(10초)이 migrate-code-ids 와 다르다');
    assert.ok(!/\[Console\]::In\.ReadLine\(\)/.test(code), '상한 없는 [Console]::In.ReadLine() 이 있다(무인 실행이 영원히 멎는다)');
    assert.ok([...psBytes.subarray(0, 3)].join() === '239,187,191', 'scope-all.ps1 에 UTF-8 BOM 이 없다(5.1 이 한국어를 ANSI 로 오독한다)');
  },

  // ⑤ 순서와 -Yes
  order(ps) {
    const code = maskPs(ps);
    const steps = [
      ['app_user 표 확인', /TABLE_NAME = 'app_user';" "app_user 유무"/],
      ['user_id, view_scope 열 확인', /COLUMN_NAME IN \('user_id','view_scope'\)/],
      ['계획(바뀔 행 목록)', /\$planRes = QRowsTry "SELECT user_id, HEX\(view_scope\) FROM \$userQ WHERE \$NOT_ALL ORDER BY user_id;"/],
      ['0 이면 끝', /if\(\$planCount -eq 0\)\{/],
      ['확인(Y)', /Read-Host "계속하려면 Y"/],
      ['되돌리기 파일 쓰기', /WriteAllLines\(\$partPath, /],
      ['되돌리기 파일 다시 읽기', /ReadAllLines\(\$partPath, /],
      ['되돌리기 파일 검증', /if\(\$updLines\.Count -ne \$planCount /],
      ['검증된 되돌리기 파일 이름 확정', /Move-Item -LiteralPath \$partPath -Destination \$revertPath/],
      ['UPDATE 문', /UPDATE app_user SET view_scope = 'all'/],
      ['적용 실행', /<\s*`"\$applySql`"/],
      ['확인 단계의 재집계', /\$left = QTry \$SQL_NOT_ALL/],
    ];
    const at = steps.map(([label, re]) => [label, onlyOnce(code, re, label)]);
    for (let i = 1; i < at.length; i++) {
      assert.ok(at[i - 1][1] < at[i][1], `단계 순서가 틀렸다: '${at[i - 1][0]}' 가 '${at[i][0]}' 보다 뒤에 있다`);
    }
    assert.ok(/if\(\$planCount -eq 0\)\{\s*\n\s*Finish \$EXIT_OK "이미 모두 전체입니다\. 할 일이 없습니다\."/.test(code),
      '바뀔 행이 0 이면 "이미 모두 전체입니다. 할 일이 없습니다." 로 종료코드 0 을 내지 않는다');
    // -Yes: 확인 질문만 건너뛴다. 리다이렉트된 무인 실행은 -Yes 를 요구한다(확인에 답할 사람이 없다).
    assert.ok(/if\(-not \$Yes\)\{\s*\n\s*\$a = Read-Host "계속하려면 Y"\s*\n\s*if\("\$a"\.Trim\(\) -ne 'Y'\)\{\s*\n\s*Finish \$EXIT_CANCEL /.test(code),
      '확인(Y)이 -Yes 로만 건너뛰어지지 않거나, Y 가 아닐 때 종료코드 2 로 끝내지 않는다');
    assert.ok(/if\(\[Console\]::IsInputRedirected -and -not \$Yes\)\{ DiePre /.test(code), '리다이렉트된 무인 실행에서 -Yes 를 요구하지 않는다');
    const uses = [...code.matchAll(/\$Yes\b/g)].length;
    assert.strictEqual(uses, 4, `$Yes 가 ${uses}번 쓰인다(param, 무인 실행 요구, 확인 건너뛰기, 창 멈춤 규칙의 4번이어야 한다)`);
  },

  // ⑥ 트랜잭션 하나와 바뀐 행 수 확인
  transaction(ps) {
    const code = maskPs(ps);
    const tx = txBlock(code);
    const idx = (re, label) => {
      const hits = tx.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
      assert.strictEqual(hits.length, 1, `적용 트랜잭션에 ${label} 이(가) ${hits.length}번 있다(1번이어야 한다)`);
      return hits[0];
    };
    const iStart = idx(/^"START TRANSACTION;",?$/, 'START TRANSACTION');
    const iLock  = idx(/FOR UPDATE;",?$/, '바뀔 행 잠금(FOR UPDATE)');
    const iIds   = idx(/^"SET @g := IF\(@ids = '\$idList', 'DO 0', /, '계획한 user_id 목록 확인');
    const iUpd   = idx(/^"UPDATE app_user SET view_scope = 'all' WHERE \$NOT_ALL;",?$/, 'UPDATE');
    const iRc    = idx(/^"SET @n := ROW_COUNT\(\);",?$/, 'ROW_COUNT');
    const iCnt   = idx(/^"SET @g := IF\(@n = \$planCount, 'DO 0', /, '바뀐 행 수 확인');
    const iCommit = idx(/^"COMMIT;",?$/, 'COMMIT');
    const order = [iStart, iLock, iIds, iUpd, iRc, iCnt, iCommit];
    for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], '트랜잭션 안의 순서가 START, 잠금, 목록 확인, UPDATE, ROW_COUNT, 수 확인, COMMIT 이 아니다');
    // 확인 식이 틀리면 없는 표를 SELECT 해 멈추고(PREPARE/EXECUTE), 그 뒤에야 다음 줄로 간다.
    assert.ok(/^"PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;",?$/.test(tx[iIds + 1]) &&
      /^"PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;",?$/.test(tx[iCnt + 1]),
      '확인 식 바로 다음에 PREPARE/EXECUTE 가 없다(조건이 틀려도 멈추지 않는다)');
    assert.ok(tx.filter((l) => /ROLLBACK|autocommit/i.test(l)).length === 0, '적용 트랜잭션에 ROLLBACK 이나 autocommit 조작이 끼었다');
    // 실행: --force 없이, utf8mb4, 대상 DB, 출력과 오류는 기록 파일로.
    const line = applyLine(code);
    assert.ok(!/--force|\s-f\b/.test(line), `적용 SQL 을 --force 로 돌린다(확인 식이 무력화된다): ${line.trim()}`);
    assert.ok(/--default-character-set=utf8mb4/.test(line) && /`"\$DbName`"/.test(line) && /> `"\$applyLog`" 2>&1/.test(line),
      '적용 SQL 을 utf8mb4, 대상 DB 인자, 기록 파일로 돌리지 않는다');
    assert.ok(!/"--force"/.test(code), 'mysql 에 "--force" 인자를 넘기는 자리가 있다');
    // 성공 판정: 종료코드 0, committed 줄, affected 가 계획과 같아야 한다. 아니면 1.
    assert.ok(/if\(\$applyRc -ne 0 -or -not \$committed -or "\$affected" -ne "\$planCount"\)\{/.test(code),
      '적용 성공 판정이 종료코드, committed, 바뀐 행 수를 다 보지 않는다');
    const failBlock = code.slice(code.indexOf('if($applyRc -ne 0'), code.indexOf('Ok "변경 커밋'));
    assert.ok(/Finish \$EXIT_FAIL /.test(failBlock) && !/Finish \$EXIT_OK /.test(failBlock), '적용 실패 분기가 종료코드 1 로 끝나지 않는다');
    assert.ok(/\$leftNow = QTry \$SQL_NOT_ALL/.test(failBlock), '적용 실패 뒤 DB 상태를 다시 세어 되돌려졌는지 가르지 않는다');
  },

  // ⑦ view_scope 만
  onlyViewScope(ps) {
    const code = maskPs(ps);
    const upd = [...code.matchAll(/UPDATE\s+(?:[`$\w.]*app_user)\s+SET\s+([\s\S]*?)\s+WHERE/g)];
    assert.ok(upd.length >= 2, `app_user UPDATE 를 ${upd.length}개 찾았다(적용과 되돌리기, 2개 이상이어야 한다)`);
    for (const m of upd) {
      const set = m[1];
      assert.ok(/^view_scope\s*=/.test(set) && !/,/.test(set.replace(/\(.*\)/g, '')),
        `app_user UPDATE 가 view_scope 하나만 바꾸지 않는다: SET ${set}`);
    }
    assert.ok(!/edit_role\s*=/.test(code), 'edit_role 을 쓰는 자리가 있다(이 도구는 view_scope 만 바꾼다)');
    assert.ok(!/updated_at\s*=/.test(code), 'updated_at 을 직접 쓰는 자리가 있다(표의 ON UPDATE 에 맡긴다)');
    assert.ok(!/\b(DELETE|INSERT|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/.test(code.replace(/DEALLOCATE PREPARE/g, '')),
      'app_user 를 바꾸는 UPDATE 밖의 쓰기 문장(DELETE, INSERT, ALTER 등)이 있다');
  },

  // ⑧ 'all' 판정 식 하나
  notAllExpr(ps) {
    const code = maskPs(ps);
    assert.ok(code.includes(`$NOT_ALL = "view_scope COLLATE utf8mb4_0900_bin <> 'all'"`),
      "'all' 판정 식이 이진 비교(utf8mb4_0900_bin)가 아니다. 위젯은 'all' 을 글자 그대로 비교한다");
    const uses = [...code.matchAll(/WHERE \$NOT_ALL\b/g)].length;
    assert.ok(uses >= 5, `WHERE $NOT_ALL 이 ${uses}번 쓰인다(세기, 계획, 잠금, 목록 확인, UPDATE 의 5번 이상이어야 한다)`);
    const raw = code.split('\n').filter((l) => /view_scope\s*(<>|!=)\s*'all'/.test(l) && !/\$NOT_ALL = /.test(l));
    assert.deepStrictEqual(raw, [], `$NOT_ALL 을 거치지 않은 'all' 비교가 있다(식이 갈리면 센 수와 바꾼 수가 어긋난다): ${raw.join(' | ')}`);
  },

  // ⑨ 되돌리기 파일
  revertFile(ps) {
    const code = maskPs(ps);
    assert.ok(/\$revertPath = Join-Path \$OutDir \("\$DbName-scope-before-" \+ \$script:ts \+ "\.sql"\)/.test(code),
      '되돌리기 파일 이름이 <OutDir>\\<DbName>-scope-before-<시각>.sql 이 아니다');
    assert.ok(/\$script:ts\s*=\s*Get-Date -Format 'yyyyMMdd-HHmmss'/.test(code), '시각 형식이 yyyyMMdd-HHmmss 가 아니다');
    // 줄 모양과 검증 식이 맞물린다: 생성 줄의 머리와 꼬리를 검증 식이 그대로 잡는다.
    const gen = /\$out\.Add\("UPDATE app_user SET view_scope=" \+ \(SqlValue \$p\.Hex\) \+ " WHERE user_id=" \+ \$p\.Id \+ ";"\)/.test(code);
    assert.ok(gen, '되돌리기 줄이 UPDATE app_user SET view_scope=<옛 값> WHERE user_id=<번호>; 모양이 아니다');
    const head = /\$updLines = @\(\$back \| Where-Object \{ "\$_" -match '(\^UPDATE app_user SET view_scope=)' \}\)/.exec(code);
    const tail = /-match ' WHERE user_id=\(\\d\+\);\$'/.test(code);
    assert.ok(head && tail, '되돌리기 파일 검증 식(UPDATE 줄 머리, user_id 꼬리)이 생성 줄 모양과 맞지 않는다');
    for (const v of ["'self'", "'unit_tree'", "CONVERT(X'414C4C' USING utf8mb4)"]) {
      const line = `UPDATE app_user SET view_scope=${v} WHERE user_id=42;`;
      assert.ok(new RegExp('^UPDATE app_user SET view_scope=').test(line) && / WHERE user_id=(\d+);$/.test(line), `검증 식이 생성 줄을 못 잡는다: ${line}`);
    }
    assert.ok(/\$planIds -join ','/.test(code) && /\(\$backIds -join ','\) -ne \(\$planIds -join ','\)/.test(code),
      '되돌리기 파일 검증이 user_id 목록까지 계획과 대조하지 않는다');
    // 값은 DB 에서 HEX 로 읽고, user_id 는 숫자, HEX 는 짝수 자리 16진수여야 한다.
    assert.ok(/if\(\$uid -notmatch '\^\\d\+\$'\)\{ DiePre /.test(code), 'user_id 가 숫자인지 확인하지 않는다');
    assert.ok(/if\(\$hex -notmatch '\^\(\[0-9A-F\]\{2\}\)\*\$'\)\{ DiePre /.test(code), 'HEX 값 모양을 확인하지 않는다');
    assert.ok(/-cmatch '\^\[a-z_\]\{1,20\}\\z'\)\{ return "'" \+ \$t \+ "'" \}/.test(code) &&
      /return "CONVERT\(X'" \+ \$h \+ "' USING utf8mb4\)"/.test(code),
      '평범하지 않은 옛 값을 HEX 리터럴로 적지 않는다(따옴표가 든 값이 SQL 을 깬다)');
    // 실패는 5, 그리고 .partial 이름으로 두고 검증 뒤에만 확정한다.
    assert.ok(/\$partPath = \$revertPath \+ "\.partial"/.test(code), '되돌리기 파일을 .partial 로 먼저 쓰지 않는다');
    const rv = [...code.matchAll(/Finish \$EXIT_REVERT /g)].length;
    assert.ok(rv >= 3, `되돌리기 파일 실패(쓰기, 검증, 이름 확정)에서 종료코드 5 로 끝내는 자리가 ${rv}개다(3개 이상)`);
    // 머리말: DB 이름, 시각, mysql 로 붓는 법.
    for (const re of [/\$out\.Add\("-- DB       : \$DbName/, /\$out\.Add\("-- 만든 때  : "/, /\$out\.Add\("--   \$mysqlHint"\)/]) {
      assert.ok(re.test(code), `되돌리기 파일 머리말이 빠졌다: ${re}`);
    }
    assert.ok(/\$mysqlHint \+= " -u \$DbUser -p \$DbName < `"\$revertPath`""/.test(code), '되돌리는 mysql 명령(비밀번호는 mysql 이 묻는 꼴)이 바뀌었다');
  },

  // ⑩ 위젯이 새 범위를 읽는 시점: 안내 문구와 호스트 코드가 맞는다
  hostPickup(ps, host) {
    const code = maskPs(ps);
    assert.ok(/"  위젯은 다시 시작할 필요가 없습니다\./.test(code) && /"  이미 열려 있는 구성원 창이나 사람 고르기 목록만 닫았다가 다시 여세요\."/.test(code),
      '완료 안내에 "다시 시작할 필요 없음, 열린 창만 다시 열기" 가 없다');
    // 위 안내가 참이려면: 세션에 권한이 없고, 명부와 타인 일정 조회가 요청마다 view_scope 를 DB 에서 읽어야 한다.
    assert.ok(!/\bViewScope\b/.test(csCode(host.userSession)), 'UserSession 이 view_scope 를 담기 시작했다(부팅 때 캐시하면 "다시 시작할 필요 없음" 이 거짓이 된다)');
    const pd = csCode(host.projectDb);
    const lm = pd.indexOf('public async Task<string?> LoadMembersJsonAsync(');
    const cv = pd.indexOf('internal static async Task<bool> CanViewScheduleAsync(');
    assert.ok(lm > 0 && /SELECT o\.name AS org_unit, u\.view_scope, u\.edit_role, u\.is_active /.test(pd.slice(lm, lm + 3000)),
      'LoadMembersJsonAsync 가 호출마다 view_scope 를 DB 에서 읽지 않는다');
    assert.ok(cv > 0 && /SELECT u\.login_id, o\.name AS org_unit, u\.view_scope /.test(pd.slice(cv, cv + 2000)),
      'CanViewScheduleAsync 가 호출마다 view_scope 를 DB 에서 읽지 않는다');
    assert.ok(/await ProjectDb\.CanViewScheduleAsync\(conn, viewerLoginId, targetLoginId, ct\)/.test(csCode(host.calendarDb)),
      '타인 일정 조회가 CanViewScheduleAsync 로 다시 판정하지 않는다');
    assert.ok(/case "membersGet":[\s\S]{0,600}RunMembersGetAsync\(/.test(csCode(host.mainWindow)),
      'membersGet 이 RunMembersGetAsync(요청마다 DB 조회)로 가지 않는다');
  },
};

// ══ 계약 ════════════════════════════════════════════════════════════════
test('scope-all ① .cmd: ASCII 만, ps1 을 Bypass -File 로, 인자 %*, 실패면 멈춤', () => checks.cmdShape(cmdSrc));
test('scope-all ② 종료코드 표: .ps1 과 .cmd 가 같고 실제로 내는 코드와 같다(0, 1, 2, 3, 5)', () => checks.exitCodes(psSrc, cmdSrc));
test('scope-all ③ 기본값: taskcalendar, 127.0.0.1:3306, C:\\mysql, MySQL84, root, dist\\scope-all', () => checks.defaults(psSrc));
test('scope-all ④ 비밀번호: 인자 없음, .cnf 로만, Cleanup 과 finally, 자격 순서', () => checks.secrets(psSrc));
test('scope-all ⑤ 순서: 점검, 계획(0 이면 0), 확인, 되돌리기 파일과 검증, 그다음 UPDATE. -Yes 는 확인만 건너뜀', () => checks.order(psSrc));
test('scope-all ⑥ 트랜잭션 하나: 목록 확인, UPDATE, ROW_COUNT 가 계획과 같을 때만 COMMIT, --force 없음', () => checks.transaction(psSrc));
test('scope-all ⑦ view_scope 만 바꾼다(edit_role, updated_at, 다른 쓰기 없음)', () => checks.onlyViewScope(psSrc));
test("scope-all ⑧ 'all' 판정 식은 이진 비교 하나($NOT_ALL)", () => checks.notAllExpr(psSrc));
test('scope-all ⑨ 되돌리기 파일: HEX 로 읽은 옛 값, 줄 모양과 검증 식, .partial, 실패면 5', () => checks.revertFile(psSrc));
test('scope-all ⑩ 실물: 위젯이 view_scope 를 요청마다 읽는다는 안내가 호스트 코드와 맞는다', () => checks.hostPickup(psSrc, hostSrc));

// ══ 변이 주입: 위 계약이 정말 우는지 ═══════════════════════════════════
// 대조군: 원본은 통과해야 한다. 통과하지 않으면 아래 throws 는 아무것도 증명하지 못한다.
test('변이①: .cmd 가 인자(%*)를 넘기지 않으면 계약① 이 실패한다', () => {
  assert.doesNotThrow(() => checks.cmdShape(cmdSrc));
  const bad = mutate(cmdSrc, '"%~dp0scope-all.ps1" %*', '"%~dp0scope-all.ps1"');
  assert.throws(() => checks.cmdShape(bad), /인자 %\*/);
});
test('변이①-b: .cmd 에 한글을 한 글자 넣으면 계약① 이 실패한다', () => {
  const bad = mutate(cmdSrc, 'rem  ASCII ONLY.', 'rem  ASCII ONLY. 한');
  assert.throws(() => checks.cmdShape(bad), /비ASCII/);
});
test('변이②: .cmd 의 종료코드 한 줄만 바꿔도 계약② 가 실패한다', () => {
  assert.doesNotThrow(() => checks.exitCodes(psSrc, cmdSrc));
  const bad = mutate(cmdSrc, 'rem    5 revert file failed', 'rem    5 revert file broken');
  assert.throws(() => checks.exitCodes(psSrc, bad), /줄 단위로 같지 않다/);
});
test('변이②-b: 표에 없는 코드를 실제로 내면 계약② 가 실패한다', () => {
  const bad = mutate(psSrc, '$EXIT_REVERT    = 5', '$EXIT_REVERT    = 4');
  assert.throws(() => checks.exitCodes(bad, cmdSrc), /표와 다르다/);
});
test('변이③: 기본 DB 를 taskmgr 로 바꾸면 계약③ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.defaults(psSrc));
  const bad = mutate(psSrc, '[string]$DbName = "taskcalendar",', '[string]$DbName = "taskmgr",');
  assert.throws(() => checks.defaults(bad), /param 기본값/);
});
test('변이③-b: 서비스 binPath 를 찾아보지 않으면 계약③ 이 실패한다', () => {
  const bad = mutate(psSrc, `Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"`, '$null');
  assert.throws(() => checks.defaults(bad), /서비스 binPath/);
});
test('변이④: 비밀번호 인자를 param 에 더하면 계약④ 가 실패한다', () => {
  assert.doesNotThrow(() => checks.secrets(psSrc));
  const bad = mutate(psSrc, '  [string]$OutDir = "",', '  [string]$OutDir = "",\n  [string]$AdminPw = "",');
  assert.throws(() => checks.secrets(bad), /비밀번호를 받는 인자/);
});
test('변이④-b: mysql 에 -p<비번> 을 붙이면 계약④ 가 실패한다', () => {
  const bad = mutate(psSrc, '"-N" "-B" "-e" $sql\n    if($LASTEXITCODE -ne 0){ return $null }', '"-p$pw" "-N" "-B" "-e" $sql\n    if($LASTEXITCODE -ne 0){ return $null }');
  assert.throws(() => checks.secrets(bad), /명령줄로 넘기는 자리/);
});
test('변이④-c: Cleanup 이 .cnf 를 안 지우면 계약④ 가 실패한다', () => {
  const bad = mutate(psSrc, 'if($script:cnfPath){ Remove-Item -LiteralPath $script:cnfPath -Force -ErrorAction SilentlyContinue; $script:cnfPath = $null }', '');
  assert.throws(() => checks.secrets(bad), /\.cnf 를 지우지 않는다/);
});
test('변이④-d: finally 에서 Cleanup 을 빼면 계약④ 가 실패한다', () => {
  const bad = mutate(psSrc, '} finally {\n  # exit(Finish) 로 끝나도 finally 는 돈다. Cleanup 은 두 번 불려도 안전하다.\n  Cleanup\n}', '} finally {\n}');
  assert.throws(() => checks.secrets(bad), /finally 블록이 Cleanup/);
});
test('변이⑤: UPDATE 를 되돌리기 파일보다 먼저 돌리면 계약⑤ 가 실패한다', () => {
  assert.doesNotThrow(() => checks.order(psSrc));
  // 적용 블록(Step 2 부터 확인 직전까지)을 Step 1 앞으로 옮긴다.
  const s1 = psSrc.indexOf('  Step 1 "되돌리기 파일"');
  const s2 = psSrc.indexOf('  # ==========================================================================\n  #  [2/3]');
  const s3 = psSrc.indexOf('  Ok "변경 커밋: ');
  assert.ok(s1 > 0 && s2 > s1 && s3 > s2, '변이 준비 실패: 앵커');
  const bad = psSrc.slice(0, s1) + psSrc.slice(s2, s3) + psSrc.slice(s1, s2) + psSrc.slice(s3);
  assert.throws(() => checks.order(bad), /단계 순서가 틀렸다/);
});
test('변이⑤-b: 되돌리기 파일 검증을 지우면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, 'if($updLines.Count -ne $planCount -or', 'if($false -and');
  assert.throws(() => checks.order(bad), /되돌리기 파일 검증/);
});
test('변이⑤-c: 0 행일 때 0 으로 끝내지 않으면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, 'Finish $EXIT_OK "이미 모두 전체입니다. 할 일이 없습니다."', 'Warn "이미 모두 전체입니다. 할 일이 없습니다."');
  assert.throws(() => checks.order(bad), /이미 모두 전체입니다/);
});
test('변이⑤-d: 확인(Y)을 -Yes 와 무관하게 건너뛰면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, '  if(-not $Yes){\n    $a = Read-Host "계속하려면 Y"', '  if($false){\n    $a = Read-Host "계속하려면 Y"');
  assert.throws(() => checks.order(bad), /-Yes/);
});
test('변이⑤-e: 리다이렉트된 무인 실행에서 -Yes 를 요구하지 않으면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, 'if([Console]::IsInputRedirected -and -not $Yes){ DiePre ', 'if($false){ DiePre ');
  assert.throws(() => checks.order(bad), /-Yes/);
});
test('변이⑥: ROW_COUNT 확인을 지우면 계약⑥ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.transaction(psSrc));
  const bad = mutate(psSrc, `    "SET @g := IF(@n = $planCount, 'DO 0', 'SELECT 1 FROM \`\`stop: affected rows differ from the plan\`\`');",\n`, '');
  assert.throws(() => checks.transaction(bad), /바뀐 행 수 확인/);
});
test('변이⑥-b: COMMIT 을 UPDATE 앞으로 옮기면(트랜잭션이 갈리면) 계약⑥ 이 실패한다', () => {
  const a = mutate(psSrc, '    "COMMIT;",\n', '');
  const bad = mutate(a, `    "UPDATE app_user SET view_scope = 'all' WHERE $NOT_ALL;",\n`, `    "COMMIT;",\n    "UPDATE app_user SET view_scope = 'all' WHERE $NOT_ALL;",\n`);
  assert.throws(() => checks.transaction(bad), /순서가 START/);
});
test('변이⑥-c: 적용 SQL 에 --force 를 붙이면 계약⑥ 이 실패한다', () => {
  const bad = mutate(psSrc, '--default-character-set=utf8mb4 -N -B `"$DbName`" < `"$applySql`"', '--default-character-set=utf8mb4 --force -N -B `"$DbName`" < `"$applySql`"');
  assert.throws(() => checks.transaction(bad), /--force/);
});
test('변이⑥-d: 성공 판정이 바뀐 행 수를 안 보면 계약⑥ 이 실패한다', () => {
  const bad = mutate(psSrc, 'if($applyRc -ne 0 -or -not $committed -or "$affected" -ne "$planCount"){', 'if($applyRc -ne 0 -or -not $committed){');
  assert.throws(() => checks.transaction(bad), /성공 판정/);
});
test('변이⑦: UPDATE 가 edit_role 까지 바꾸면 계약⑦ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.onlyViewScope(psSrc));
  const bad = mutate(psSrc, `"UPDATE app_user SET view_scope = 'all' WHERE $NOT_ALL;"`, `"UPDATE app_user SET view_scope = 'all', edit_role = 'viewer' WHERE $NOT_ALL;"`);
  assert.throws(() => checks.onlyViewScope(bad), /view_scope 하나만/);
});
test('변이⑦-b: updated_at 을 직접 쓰면 계약⑦ 이 실패한다', () => {
  const bad = mutate(psSrc, `"UPDATE app_user SET view_scope = 'all' WHERE $NOT_ALL;"`, `"UPDATE app_user SET view_scope = 'all', updated_at = NOW(3) WHERE $NOT_ALL;"`);
  assert.throws(() => checks.onlyViewScope(bad), /view_scope 하나만|updated_at/);
});
test("변이⑧: 'all' 판정을 정렬 규칙 비교로 바꾸면 계약⑧ 이 실패한다", () => {
  assert.doesNotThrow(() => checks.notAllExpr(psSrc));
  const bad = mutate(psSrc, `$NOT_ALL = "view_scope COLLATE utf8mb4_0900_bin <> 'all'"`, `$NOT_ALL = "view_scope <> 'all'"`);
  assert.throws(() => checks.notAllExpr(bad), /이진 비교/);
});
test("변이⑧-b: UPDATE 가 $NOT_ALL 대신 자기 식을 쓰면 계약⑧ 이 실패한다", () => {
  const bad = mutate(psSrc, `"UPDATE app_user SET view_scope = 'all' WHERE $NOT_ALL;"`, `"UPDATE app_user SET view_scope = 'all' WHERE view_scope <> 'all';"`);
  assert.throws(() => checks.notAllExpr(bad), /\$NOT_ALL/);
});
test('변이⑨: 되돌리기 검증이 user_id 목록을 안 보면 계약⑨ 가 실패한다', () => {
  assert.doesNotThrow(() => checks.revertFile(psSrc));
  const bad = mutate(psSrc, " -or (($backIds -join ',') -ne ($planIds -join ','))", '');
  assert.throws(() => checks.revertFile(bad), /user_id 목록/);
});
test('변이⑨-b: 옛 값을 HEX 리터럴 없이 그대로 따옴표에 넣으면 계약⑨ 가 실패한다', () => {
  const bad = mutate(psSrc, `return "CONVERT(X'" + $h + "' USING utf8mb4)"`, `return "'" + $t + "'"`);
  assert.throws(() => checks.revertFile(bad), /HEX 리터럴/);
});
test('변이⑨-c: 되돌리기 줄 모양을 바꿔 검증 식과 어긋나면 계약⑨ 가 실패한다', () => {
  const bad = mutate(psSrc, '$out.Add("UPDATE app_user SET view_scope=" + (SqlValue $p.Hex) + " WHERE user_id=" + $p.Id + ";")', '$out.Add("UPDATE app_user SET view_scope = " + (SqlValue $p.Hex) + " WHERE user_id = " + $p.Id + ";")');
  assert.throws(() => checks.revertFile(bad), /모양/);
});
test('변이⑩: 세션이 ViewScope 를 담기 시작하면 계약⑩ 이 실패한다(안내가 거짓이 된다)', () => {
  assert.doesNotThrow(() => checks.hostPickup(psSrc, hostSrc));
  const bad = { ...hostSrc, userSession: hostSrc.userSession.replace(/(public string LoginId[^\n]*\n)/, '$1    public string ViewScope { get; set; } = "";\n') };
  assert.notStrictEqual(bad.userSession, hostSrc.userSession, '변이 준비 실패: UserSession 앵커(public string LoginId)');
  assert.throws(() => checks.hostPickup(psSrc, bad), /UserSession/);
});
test('변이⑩-b: 타인 일정 조회가 권한을 다시 판정하지 않으면 계약⑩ 이 실패한다', () => {
  const bad = { ...hostSrc, calendarDb: mutate(hostSrc.calendarDb, 'await ProjectDb.CanViewScheduleAsync(conn, viewerLoginId, targetLoginId, ct)', 'true') };
  assert.throws(() => checks.hostPickup(psSrc, bad), /다시 판정/);
});
