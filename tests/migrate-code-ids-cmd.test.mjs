// Layer 1: 기존 PC 의 DB 이관 마스터 도구(db/deploy/migrate-code-ids.ps1 / .cmd)의 계약을 소스 텍스트만으로 본다.
// MySQL 을 돌리지 않는다(실 리허설은 사람이 격리 DB 와 실 DB 에서 한다).
//
// 왜 있나
//   이 도구는 데이터가 든 v12 DB 를 v13 으로 옮기는 단 한 번의 실행이다. 그 한 번에 순서 하나(백업보다 이관이 먼저),
//   가드 하나(--force, 비밀번호 인자)가 빠지면 되돌릴 길이 백업 하나뿐인데 그 백업이 없을 수 있다. 그래서 못 박는다:
//     ① .cmd 는 ASCII 만, ps1 을 -ExecutionPolicy Bypass -File 로, 인자는 %* 로 넘긴다, 실패면 멈춘다
//     ② 종료코드 표가 .ps1 과 .cmd 에서 줄 단위로 같고, ps1 이 실제로 내는 코드와 같다
//     ③ 기본값: DbName taskcalendar, 127.0.0.1, 3306, C:\mysql, MySQL84, root, taskmgr_app, 백업 폴더
//     ④ 비밀번호는 인자로 받지 않고 .cnf(--defaults-extra-file)로만 넘기며, .cnf 는 Cleanup 이 지우고 finally 가 부른다.
//        자격 순서는 환경변수 TASKMGR_ADMIN_PW, 상한 있는 stdin, 가려진 입력
//     ⑤ 이관 SQL 은 같은 폴더의 migrate-2026-10-15-code-ids.sql 을 이름으로, --force 없이, utf8mb4 와 -t 로 돌린다
//     ⑥ 순서: 판번호(13 이면 0 으로 끝, 12 가 아니면 멈춤), 앱 세션 확인, 확인(Y), 백업과 검증, 이관 SQL
//     ⑦ 백업 인자(--single-transaction 등)와 검증(1KB, '-- Dump completed'), --databases 는 쓰지 않는다
//     ⑧ 앱 세션 확인은 PROCESSLIST 의 앱 계정과 DB 로 세고, 있으면 종료코드 4. -Force 는 이 확인만 건너뛴다
//     ⑨ 실패 판정은 DB 상태(판번호, 옛 열, 옛 기본키, 옛 외래키)로 가르고, 절단 전 문구와 되돌리기 명령을 낸다
//   각 계약에 변이 주입을 짝으로 둔다(이 저장소의 관례: 검사가 정말 잡는지 증명한다).
//
// 공용 기계(주석 마스커, 비번 검사, 종료코드 표, 변이 주입기)는 tests/ps-guard-lib.mjs 의 것을 쓴다.
import { test, assert } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import {
  maskPs, passwordOnCommandLineHits, exitCodeTable, exitCodesInTable, exitCodesUsed,
  mutate, nonAsciiLines,
} from './ps-guard-lib.mjs';
import { canonSchemaVersion } from './canon-schema.mjs';

const PS_URL  = new URL('../db/deploy/migrate-code-ids.ps1', import.meta.url);
const CMD_URL = new URL('../db/deploy/migrate-code-ids.cmd', import.meta.url);
const SQL_NAME = 'migrate-2026-10-15-code-ids.sql';
const SQL_URL = new URL('../db/deploy/' + SQL_NAME, import.meta.url);
const psBytes = readFileSync(PS_URL);
const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const psSrc  = norm(readFileSync(PS_URL, 'utf8'));
const cmdSrc = norm(readFileSync(CMD_URL).toString('latin1'));
const sqlSrc = readFileSync(SQL_URL, 'utf8');

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
// 마이그레이션 실행 줄(같은 폴더의 이관 SQL 을 mysql 에 흘려 넣는 줄).
function migrationLine(code) {
  const lines = code.split('\n').filter((l) => /<\s*`"\$sqlFile`"/.test(l));
  assert.strictEqual(lines.length, 1, `이관 SQL 을 mysql 에 흘려 넣는 줄이 ${lines.length}개다(1개여야 한다)`);
  return lines[0];
}

// ══ 검사 함수(테스트와 변이 주입이 같은 함수를 쓴다) ═══════════════════
const checks = {
  // ① .cmd 모양
  cmdShape(cmd) {
    assert.deepStrictEqual(nonAsciiLines(cmd), [], '.cmd 에 비ASCII 가 있다(cmd.exe 바이트 오프셋 사고)');
    const body = cmd.split('\n').filter((l) => !/^\s*rem\b/i.test(l)).join('\n');
    assert.ok(/powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0migrate-code-ids\.ps1" %\*/.test(body),
      '.cmd 가 같은 폴더의 migrate-code-ids.ps1 을 -ExecutionPolicy Bypass -File 로, 인자 %* 와 함께 부르지 않는다');
    assert.ok(/set "TC_MIGRATE_LAUNCHER=cmd"/.test(body), '.cmd 가 TC_MIGRATE_LAUNCHER=cmd 를 세우지 않는다(ps1 의 창 멈춤 규칙)');
    assert.ok(/if errorlevel 1 pause/.test(body) && /exit \/b %RC%/.test(body),
      '.cmd 가 실패면 멈추고(pause) 종료코드를 그대로 돌려주지 않는다');
  },

  // ② 종료코드 표
  exitCodes(ps, cmd) {
    const a = exitCodeTable(ps, false);
    const b = exitCodeTable(cmd, true);
    assert.deepStrictEqual(b, a, '.ps1 과 .cmd 의 종료코드 표가 줄 단위로 같지 않다');
    const table = exitCodesInTable(a);
    assert.deepStrictEqual(table, [0, 1, 2, 3, 4, 5], `종료코드 표가 0~5 가 아니다: ${table.join(',')}`);
    assert.deepStrictEqual(exitCodesUsed(ps), table, `ps1 이 실제로 내는 코드(${exitCodesUsed(ps).join(',')})가 표와 다르다`);
  },

  // ③ 기본값
  defaults(ps) {
    const code = maskPs(ps);
    const p = paramBlock(code);
    const want = [
      /\[string\]\$DbName = "taskcalendar",/, /\[string\]\$DbHost = "127\.0\.0\.1",/, /\[int\]\$Port = 3306,/,
      /\[string\]\$BaseDir = "C:\\mysql",/, /\[string\]\$ServiceName = "MySQL84",/, /\[string\]\$DbUser = "root",/,
      /\[string\]\$AppUser = "taskmgr_app",/, /\[string\]\$BackupDir = "",/, /\[switch\]\$Yes,/, /\[switch\]\$Force\b/,
    ];
    for (const re of want) assert.ok(re.test(p), `param 기본값이 바뀌었거나 사라졌다: ${re}`);
    assert.ok(/\$BackupDir = Join-Path \$scriptDir "\.\.\\\.\.\\dist\\migrate-code-ids\\backup"/.test(code),
      '기본 백업 폴더가 <스크립트>\\..\\..\\dist\\migrate-code-ids\\backup 이 아니다');
    // 도구 찾기: -BaseDir, 서비스 binPath, 기본 설치 경로
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
    // mysql, mysqldump 를 부르는 줄은 전부 --defaults-extra-file 을 단다.
    for (const l of code.split('\n')) {
      if (/&\s*\$mysql(dump)?\b/.test(l) || /cmd \/c "`"\$mysql`"/.test(l)) {
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
    // 자격 순서: 환경변수, stdin(상한), 가려진 입력
    const envAt = onlyOnce(code, /GetEnvironmentVariable\(\$ADMIN_PW_ENV\)/, '환경변수 읽기');
    const stdinAt = onlyOnce(code, /\$r = ReadStdinLineBounded \$STDIN_WAIT_SEC/, '상한 있는 stdin 읽기');
    const promptAt = onlyOnce(code, /Read-Host "MySQL \$DbUser 비밀번호" -AsSecureString/, '가려진 입력');
    assert.ok(envAt < stdinAt && stdinAt < promptAt, '자격 순서가 환경변수, stdin, 가려진 입력이 아니다');
    assert.ok(/\$ADMIN_PW_ENV\s*=\s*"TASKMGR_ADMIN_PW"/.test(code) && /\$STDIN_WAIT_SEC\s*=\s*10\b/.test(code),
      '환경변수 이름(TASKMGR_ADMIN_PW)이나 stdin 상한(10초)이 restore-taskmgr 와 다르다');
    assert.ok(!/\[Console\]::In\.ReadLine\(\)/.test(code), '상한 없는 [Console]::In.ReadLine() 이 있다(무인 실행이 영원히 멎는다)');
    assert.ok([...psBytes.subarray(0, 3)].join() === '239,187,191', 'migrate-code-ids.ps1 에 UTF-8 BOM 이 없다(5.1 이 한국어를 ANSI 로 오독한다)');
  },

  // ⑤ 이관 SQL 호출
  migrationCall(ps) {
    const code = maskPs(ps);
    assert.ok(new RegExp(`\\$MIGRATION_SQL\\s*=\\s*"${SQL_NAME.replace(/\./g, '\\.')}"`).test(code),
      `이관 SQL 이름이 ${SQL_NAME} 이 아니다`);
    assert.ok(/\$sqlFile = Join-Path \$scriptDir \$MIGRATION_SQL/.test(code), '이관 SQL 을 스크립트와 같은 폴더에서 찾지 않는다');
    const line = migrationLine(code);
    assert.ok(!/--force|\s-f\b/.test(line), `이관 SQL 을 --force 로 돌린다(관문이 무력화된다): ${line.trim()}`);
    assert.ok(/--default-character-set=utf8mb4/.test(line) && /\s-t\s/.test(line) && /`"\$DbName`"/.test(line),
      '이관 SQL 을 utf8mb4, -t, 대상 DB 인자로 돌리지 않는다');
    assert.ok(/> `"\$migLog`" 2>&1/.test(line), '이관 SQL 의 출력과 오류를 기록 파일로 받지 않는다');
    // 어떤 mysql 호출에도 --force 인자가 없다.
    assert.ok(!/"--force"/.test(code), 'mysql 에 "--force" 인자를 넘기는 자리가 있다');
  },

  // ⑥ 순서
  order(ps) {
    const code = maskPs(ps);
    const steps = [
      ['판번호 읽기', /\$verBefore = QPre \$SQL_VERSION/],
      ['v13 이면 0 으로 끝', /if\(\$verBefore -eq \$toVersion\)\{/],
      ['12 가 아니면 멈춤', /if\(\$verBefore -ne \$fromVersion\)\{/],
      ['앱 세션 확인', /FROM information_schema\.PROCESSLIST WHERE/],
      ['확인(Y)', /Read-Host "계속하려면 Y"/],
      ['백업(mysqldump)', /&\s*\$mysqldump\b/],
      ["백업 검증('-- Dump completed')", /StartsWith\("-- Dump completed"\)/],
      ['검증된 백업 이름 확정', /Move-Item -LiteralPath \$partPath -Destination \$dumpPath/],
      ['이관 SQL', /<\s*`"\$sqlFile`"/],
    ];
    const at = steps.map(([label, re]) => [label, onlyOnce(code, re, label)]);
    for (let i = 1; i < at.length; i++) {
      assert.ok(at[i - 1][1] < at[i][1], `단계 순서가 틀렸다: '${at[i - 1][0]}' 가 '${at[i][0]}' 보다 뒤에 있다`);
    }
    // v13 은 0 으로, 그 문구 그대로.
    assert.ok(/if\(\$verBefore -eq \$toVersion\)\{[^}]*Finish \$EXIT_OK "이미 v\$toVersion 입니다\. 할 일이 없습니다\."/.test(code),
      '판번호가 이미 13 이면 "이미 v13 입니다. 할 일이 없습니다." 로 종료코드 0 을 내지 않는다');
    assert.ok(/if\(\$verBefore -ne \$fromVersion\)\{\s*\n\s*DiePre /.test(code), '판번호가 12 가 아니면 사전 점검 실패로 멈추지 않는다');
    // 무인 실행은 -Yes 가 있어야 한다(확인에 답할 사람이 없다).
    assert.ok(/if\(\[Console\]::IsInputRedirected -and -not \$Yes\)\{ DiePre /.test(code), '리다이렉트된 무인 실행에서 -Yes 를 요구하지 않는다');
  },

  // ⑦ 백업 인자와 검증
  backup(ps) {
    const code = maskPs(ps);
    const line = code.split('\n').find((l) => /&\s*\$mysqldump\b/.test(l)) || '';
    for (const a of ['--single-transaction', '--no-tablespaces', '--routines', '--triggers', '--events', '--default-character-set=utf8mb4']) {
      assert.ok(line.includes(`"${a}"`), `mysqldump 인자 ${a} 가 빠졌다`);
    }
    // --set-gtid-purged=OFF 는 비번 검사(-p...)를 피하려고 이름을 둘로 나눈 상수로 넘긴다.
    assert.ok(/ \$GTID_PURGED_OFF /.test(line) && code.includes('$GTID_PURGED_OFF = "--set-gtid-" + "purged=OFF"'),
      'mysqldump 에 --set-gtid-purged=OFF 가 빠졌다');
    assert.ok(/"--result-file=\$partPath"/.test(line), 'mysqldump 가 .partial 로 쓰지 않는다(검증 전 파일을 restore 가 고를 수 있다)');
    assert.ok(!/--databases|--all-databases/.test(code),
      '--databases 를 쓴다. 덤프에 USE 가 들어가 restore-taskmgr -TargetDb 가 라이브 DB 로 들어간다');
    assert.ok(/\$dumpSize -le 1024\)\{ Finish \$EXIT_BACKUP /.test(code), '백업 1KB 검사가 없거나 종료코드 5 로 멈추지 않는다');
    assert.ok(/if\(-not \$dumpDone\)\{ Finish \$EXIT_BACKUP /.test(code), "'-- Dump completed' 가 없을 때 종료코드 5 로 멈추지 않는다");
    assert.ok(/if\(\$dumpRc -ne 0\)\{ Finish \$EXIT_BACKUP /.test(code), 'mysqldump 실패에서 종료코드 5 로 멈추지 않는다');
    assert.ok(/\$dumpPath = Join-Path \$BackupDir \("\$DbName-before-code-ids-" \+ \$script:ts \+ "\.sql"\)/.test(code),
      '백업 파일 이름이 <BackupDir>\\<DbName>-before-code-ids-<시각>.sql 이 아니다');
  },

  // ⑧ 앱 세션 확인과 -Force
  sessions(ps) {
    const code = maskPs(ps);
    assert.ok(/FROM information_schema\.PROCESSLIST WHERE USER = '\$AppUser' AND DB = '\$DbName'/.test(code),
      '앱 세션을 PROCESSLIST 에서 앱 계정과 DB 로 세지 않는다');
    assert.ok(/if\(\$sessions\.Count -gt 0\)\{[\s\S]*?Finish \$EXIT_BUSY /.test(code), '앱 세션이 있을 때 종료코드 4 로 멈추지 않는다');
    const uses = [...code.matchAll(/\$Force\b/g)].length;
    assert.strictEqual(uses, 2, `$Force 가 ${uses}번 쓰인다(param 선언과 세션 확인 분기, 2번이어야 한다). -Force 는 세션 확인만 건너뛴다`);
    assert.ok(/if\(\$Force\)\{\s*\n\s*Warn [^\n]*\n\s*\} else \{\s*\n\s*\$sessRes = QRowsTry /.test(code),
      '-Force 분기가 세션 확인만 감싸지 않는다');
  },

  // ⑨ 실패 판정과 안내
  failure(ps) {
    const code = maskPs(ps);
    assert.ok(/\$intact = \(\$verNow -eq \$fromVersion\) -and \(\$colsNow -eq '4'\) -and \(\$pkNow -eq '4'\) -and \(\$fkNow -eq "\$oldFkBefore"\)/.test(code),
      '절단 전 판정이 DB 상태(판번호, 옛 열 4, 이름 기본키 4, 이관 전과 같은 옛 외래키)를 다 보지 않는다');
    assert.ok(/if\(\$intact\)\{[\s\S]*?"  옛 열은 그대로입니다\. 메시지대로 데이터를 고친 뒤 다시 실행하세요\."[\s\S]*?Finish \$EXIT_FAIL /.test(code),
      '절단 전 실패에서 "옛 열은 그대로입니다. 메시지대로 데이터를 고친 뒤 다시 실행하세요." 를 내고 1 로 끝내지 않는다');
    const rh = /function RestoreHelp\(\)\{([\s\S]*?)\n  \}/.exec(code);
    assert.ok(rh, 'RestoreHelp 함수가 없다');
    assert.ok(/\$restoreCmd = Join-Path \$scriptDir "restore-taskmgr\.cmd"/.test(rh[1]) &&
      /`"\$restoreCmd`" -DumpPath `"\$dumpPath`" -BackupDir `"\$BackupDir`" -LiveDb \$DbName -TargetDb \$scratch/.test(rh[1]),
      '되돌리기 안내에 별도 DB 로 되살리는 restore-taskmgr 명령이 없다');
    assert.ok(/-LiveDb \$DbName -TargetDb \$DbName -OverwriteLive/.test(rh[1]), '라이브를 되돌리는 restore-taskmgr -OverwriteLive 명령이 없다');
    assert.ok(!/password|-p\$|TASKMGR_ADMIN_PW/i.test(rh[1]), '되돌리기 안내에 비밀번호가 실린다');
    // 절단 뒤나 알 수 없음은 되돌리기 안내를 내고 1 로 끝낸다(절단 전, 권한 회수 분기 다음).
    const iIntact = code.indexOf('if($intact){'), iDone = code.indexOf('if($schemaDone){');
    const iHelp = code.indexOf('RestoreHelp\n', iDone);
    assert.ok(iIntact > 0 && iDone > iIntact && iHelp > iDone, '실패 분기 순서(절단 전, 권한 회수만 실패, 그 밖은 되돌리기)가 바뀌었다');
    // 성공 판정: 판번호를 다시 읽어 13 인지 보고, 관문 표 셋을 본다.
    assert.ok(/\$verAfter = QTry \$SQL_VERSION\s*\n\s*if\(\$verAfter -ne \$toVersion\)\{/.test(code), '이관 뒤 판번호를 다시 읽어 13 인지 보지 않는다');
    for (const h of ['customer_empty_name', 'cut_parent', 'e1_orphan']) assert.ok(code.includes(`'${h}'`), `관문 표 ${h} 를 읽지 않는다`);
    assert.ok(/"  다음 단계: 이제 0\.21\.0 이상\(최신\) 앱을 설치하세요\./.test(code), '성공 뒤 "이제 0.21.0 이상(최신) 앱을 설치하세요" 안내가 없다');
  },

  // ⑩ 실물: 판번호를 이관 SQL 에서 읽는 식이 실제 파일과 맞고, 그 판이 정본과 같다
  versionsFromSql(ps, sql) {
    const code = maskPs(ps);
    assert.ok(code.includes(`[regex]::Match($sqlText, "SET @g := IF\\(@v = '(\\d+)'")`) &&
      code.includes(`[regex]::Match($sqlText, "UPDATE cal_schema_meta SET v = '(\\d+)'")`),
      '앞뒤 판번호를 이관 SQL 에서 읽는 식이 바뀌었다');
    const from = /SET @g := IF\(@v = '(\d+)'/.exec(sql), to = /UPDATE cal_schema_meta SET v = '(\d+)'/.exec(sql);
    assert.ok(from && to, '이관 SQL 에서 앞뒤 판번호를 읽지 못했다(파일 형식이 바뀌었다)');
    assert.strictEqual(from[1], '12', '이관 SQL 의 가드가 12 가 아니다');
    //  2026-10-21 부터 정본은 다음 판(14, 이관 조각 db/deploy/migrations/v14-version-gate.sql)이다. 이 이관은 이력이라 13 에서 멈춘다.
    assert.strictEqual(to[1], '13', '이관 SQL 이 올리는 판번호가 13 이 아니다');
    assert.strictEqual(String(Number(to[1]) + 2), canonSchemaVersion(), '이 이관 뒤 두 판(13 에서 14 버전 관문, 14 에서 15 회의실 공용화)이 정본(schema-calendar.sql)과 이어지지 않는다');
  },
};

// ══ 계약 ════════════════════════════════════════════════════════════════
test('migrate-code-ids ① .cmd: ASCII 만, ps1 을 Bypass -File 로, 인자 %*, 실패면 멈춤', () => checks.cmdShape(cmdSrc));
test('migrate-code-ids ② 종료코드 표: .ps1 과 .cmd 가 같고 실제로 내는 코드와 같다(0~5)', () => checks.exitCodes(psSrc, cmdSrc));
test('migrate-code-ids ③ 기본값: taskcalendar, 127.0.0.1:3306, C:\\mysql, MySQL84, root, taskmgr_app, 백업 폴더', () => checks.defaults(psSrc));
test('migrate-code-ids ④ 비밀번호: 인자 없음, .cnf 로만, Cleanup 과 finally, 자격 순서', () => checks.secrets(psSrc));
test('migrate-code-ids ⑤ 이관 SQL: 같은 폴더의 이름으로, --force 없이, utf8mb4 와 -t, 출력은 기록 파일로', () => checks.migrationCall(psSrc));
test('migrate-code-ids ⑥ 순서: 판번호, 앱 세션, 확인, 백업과 검증, 이관 SQL (v13 이면 0, 12 가 아니면 멈춤)', () => checks.order(psSrc));
test('migrate-code-ids ⑦ 백업: 인자 일곱, .partial, 1KB 와 마감 줄 검증, --databases 없음', () => checks.backup(psSrc));
test('migrate-code-ids ⑧ 앱 세션 확인: PROCESSLIST 로 세고 있으면 4, -Force 는 이것만 건너뜀', () => checks.sessions(psSrc));
test('migrate-code-ids ⑨ 실패 판정은 DB 상태로, 절단 전 문구와 되돌리기 명령', () => checks.failure(psSrc));
test('migrate-code-ids ⑩ 실물: 판번호를 이관 SQL 에서 읽고, 그 판이 정본과 같다', () => checks.versionsFromSql(psSrc, sqlSrc));
test('migrate-code-ids ⑪ 실물: 이관 SQL 이 스크립트와 같은 폴더에 있다', () => {
  assert.ok(existsSync(SQL_URL), `${SQL_NAME} 이 db/deploy 에 없다`);
});

// ══ 변이 주입: 위 계약이 정말 우는지 ═══════════════════════════════════
// 대조군: 원본은 통과해야 한다. 통과하지 않으면 아래 throws 는 아무것도 증명하지 못한다.
const MIG_LINE_ANCHOR = '--default-character-set=utf8mb4 -t `"$DbName`" < `"$sqlFile`"';

test('변이①: .cmd 가 인자(%*)를 넘기지 않으면 계약① 이 실패한다', () => {
  assert.doesNotThrow(() => checks.cmdShape(cmdSrc));
  const bad = mutate(cmdSrc, '"%~dp0migrate-code-ids.ps1" %*', '"%~dp0migrate-code-ids.ps1"');
  assert.throws(() => checks.cmdShape(bad), /인자 %\*/);
});
test('변이①-b: .cmd 에 한글을 한 글자 넣으면 계약① 이 실패한다', () => {
  const bad = mutate(cmdSrc, 'rem  ASCII ONLY.', 'rem  ASCII ONLY. 한');
  assert.throws(() => checks.cmdShape(bad), /비ASCII/);
});
test('변이②: .cmd 의 종료코드 한 줄만 바꿔도 계약② 가 실패한다', () => {
  assert.doesNotThrow(() => checks.exitCodes(psSrc, cmdSrc));
  const bad = mutate(cmdSrc, 'rem    4 app sessions open', 'rem    4 app sessions still open');
  assert.throws(() => checks.exitCodes(psSrc, bad), /줄 단위로 같지 않다/);
});
test('변이②-b: 표에 없는 코드를 실제로 내면 계약② 가 실패한다', () => {
  const bad = mutate(psSrc, '$EXIT_BACKUP    = 5', '$EXIT_BACKUP    = 6');
  assert.throws(() => checks.exitCodes(bad, cmdSrc), /표와 다르다/);
});
test('변이③: 기본 DB 를 taskmgr 로 되돌리면 계약③ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.defaults(psSrc));
  const bad = mutate(psSrc, '[string]$DbName = "taskcalendar",', '[string]$DbName = "taskmgr",');
  assert.throws(() => checks.defaults(bad), /param 기본값/);
});
test('변이③-b: 기본 설치 경로를 찾아보지 않으면 계약③ 이 실패한다', () => {
  const bad = mutate(psSrc, '$toolRoots.Add($DEFAULT_MYSQL_DIR)', '');
  assert.throws(() => checks.defaults(bad), /기본 설치 경로/);
});
test('변이④: 비밀번호 인자를 param 에 더하면 계약④ 가 실패한다', () => {
  assert.doesNotThrow(() => checks.secrets(psSrc));
  const bad = mutate(psSrc, '  [switch]$Yes,', '  [string]$RootPassword = "",\n  [switch]$Yes,');
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
test('변이④-d: stdin 을 상한 없이 읽으면 계약④ 가 실패한다', () => {
  const bad = mutate(psSrc, '$r = ReadStdinLineBounded $STDIN_WAIT_SEC', '$r = @{ Line = [Console]::In.ReadLine(); TimedOut = $false }');
  assert.throws(() => checks.secrets(bad), /상한 있는 stdin 읽기|ReadLine/);
});
test('변이⑤: 이관 SQL 에 --force 를 붙이면 계약⑤ 가 실패한다', () => {
  assert.doesNotThrow(() => checks.migrationCall(psSrc));
  const bad = mutate(psSrc, MIG_LINE_ANCHOR, '--default-character-set=utf8mb4 --force -t `"$DbName`" < `"$sqlFile`"');
  assert.throws(() => checks.migrationCall(bad), /--force/);
});
test('변이⑤-b: 이관 SQL 이름을 바꾸면 계약⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, '$MIGRATION_SQL  = "migrate-2026-10-15-code-ids.sql"', '$MIGRATION_SQL  = "migrate-code-ids.sql"');
  assert.throws(() => checks.migrationCall(bad), /이관 SQL 이름/);
});
test('변이⑤-c: utf8mb4 를 빼면 계약⑤ 가 실패한다(고정 번호 지도의 한글 이름이 안 맞는다)', () => {
  const bad = mutate(psSrc, MIG_LINE_ANCHOR, '-t `"$DbName`" < `"$sqlFile`"');
  assert.throws(() => checks.migrationCall(bad), /utf8mb4/);
});
test('변이⑥: 이관 SQL 을 백업보다 먼저 돌리면 계약⑥ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.order(psSrc));
  const code = psSrc;
  const migStart = code.indexOf('  cmd /c "`"$mysql`"');
  const migEnd = code.indexOf('\n', migStart) + 1;
  const migLine = code.slice(migStart, migEnd);
  const dumpAt = code.indexOf('  & $mysqldump ');
  assert.ok(migStart > 0 && dumpAt > 0, '변이 준비 실패: 앵커');
  const bad = code.slice(0, dumpAt) + migLine + code.slice(dumpAt, migStart) + code.slice(migEnd);
  assert.throws(() => checks.order(bad), /단계 순서가 틀렸다/);
});
test('변이⑥-b: v13 을 0 으로 끝내지 않으면 계약⑥ 이 실패한다', () => {
  const bad = mutate(psSrc, 'Finish $EXIT_OK "이미 v$toVersion 입니다. 할 일이 없습니다."', 'Finish $EXIT_PREFLIGHT "이미 v$toVersion 입니다. 할 일이 없습니다."');
  assert.throws(() => checks.order(bad), /이미 v13/);
});
test('변이⑥-c: 백업 검증을 지우면 계약⑥ 이 실패한다', () => {
  const bad = mutate(psSrc, 'foreach($l in $tail){ if("$l".StartsWith("-- Dump completed")){ $dumpDone = $true } }', 'foreach($l in $tail){ $dumpDone = $true }');
  assert.throws(() => checks.order(bad), /Dump completed/);
});
test('변이⑦: mysqldump 에 --databases 를 쓰면 계약⑦ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.backup(psSrc));
  const bad = mutate(psSrc, '"--result-file=$partPath" $DbName', '"--result-file=$partPath" "--databases" $DbName');
  assert.throws(() => checks.backup(bad), /--databases/);
});
test('변이⑦-b: --events 를 빼면 계약⑦ 이 실패한다', () => {
  const bad = mutate(psSrc, '"--triggers" "--events"', '"--triggers"');
  assert.throws(() => checks.backup(bad), /--events/);
});
test('변이⑦-c: 마감 줄이 없어도 멈추지 않으면 계약⑦ 이 실패한다', () => {
  const bad = mutate(psSrc, 'if(-not $dumpDone){ Finish $EXIT_BACKUP ', 'if(-not $dumpDone){ Warn ');
  assert.throws(() => checks.backup(bad), /Dump completed/);
});
test('변이⑧: 앱 세션 확인을 지우면 계약⑧ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.sessions(psSrc));
  const bad = mutate(psSrc, "FROM information_schema.PROCESSLIST WHERE USER = '$AppUser' AND DB = '$DbName'", "FROM information_schema.PROCESSLIST WHERE 1 = 0");
  assert.throws(() => checks.sessions(bad), /PROCESSLIST/);
});
test('변이⑧-b: -Force 가 다른 확인까지 건너뛰면 계약⑧ 이 실패한다', () => {
  const bad = mutate(psSrc, 'if($verBefore -ne $fromVersion){', 'if($verBefore -ne $fromVersion -and -not $Force){');
  assert.throws(() => checks.sessions(bad), /\$Force 가 3번/);
});
test('변이⑨: 절단 전 판정이 옛 외래키를 안 보면 계약⑨ 가 실패한다', () => {
  assert.doesNotThrow(() => checks.failure(psSrc));
  const bad = mutate(psSrc, ' -and ($fkNow -eq "$oldFkBefore")', '');
  assert.throws(() => checks.failure(bad), /절단 전 판정/);
});
test('변이⑨-b: 되돌리기 안내에서 별도 DB 복구 명령을 빼면 계약⑨ 가 실패한다', () => {
  const bad = mutate(psSrc, '-LiveDb $DbName -TargetDb $scratch$extra"', '-LiveDb $DbName$extra"');
  assert.throws(() => checks.failure(bad), /별도 DB/);
});
test('변이⑩: 이관 SQL 의 가드 판번호가 바뀌면 계약⑩ 이 실패한다', () => {
  assert.doesNotThrow(() => checks.versionsFromSql(psSrc, sqlSrc));
  const bad = mutate(sqlSrc, "SET @g := IF(@v = '12'", "SET @g := IF(@v = '11'");
  assert.throws(() => checks.versionsFromSql(psSrc, bad), /12 가 아니다/);
});
