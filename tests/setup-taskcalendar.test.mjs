// Layer 1 — 새 주 DB 원큐 구축 스크립트(db/deploy/setup-taskcalendar.ps1 / .cmd)의 **계약**을
// 소스 텍스트만으로 검사한다. MySQL 을 돌리지 않는다(리허설은 사람이 실제 서버에서 한다).
//
// 왜 있나
//   이 스크립트는 운영 서버에서 한 번 도는 '이관' 이다. 한 번만 도는 코드는 고칠 기회도 한 번이라,
//   다음 사람이 손대다 순서 하나·가드 하나를 떨어뜨려도 그걸 알려 줄 실행이 없다. 그래서
//   '무엇이 반드시 이 순서로, 이 조건으로 일어나야 하는가' 를 여기서 못 박는다:
//     ① .cmd 는 ASCII 만 · ps1 을 -ExecutionPolicy Bypass 로 · 인자를 %* 로 넘긴다
//     ② 비밀번호가 명령줄에 실리지 않는다(.cnf 로만) · .cnf 는 finally 에서 지워진다
//     ③ 단계 순서: 백업 → CREATE DATABASE → 과제 DDL → 사용자 DDL → 캘린더 DDL → 회사 시드 02 → 03 → 04 →
//        sort_order 백필 → 과제 4표 복사 → 권한
//     ④ 복사 대상 = 과제 트랙 4표(FK 부모 → 자식) · 교집합 컬럼
//     ⑤ KST→UTC 이동은 과제 트랙 4표의 created_at/updated_at 에만 · -NoShift 로 끈다
//     ⑥ FK 검사를 끄고 넣은 뒤 다시 켠다 · 고아 행 검사 6관계
//     ⑦ 스키마 치환은 낱말 경계 `\btaskmgr\.` · 두 파일에만 · 05-grants.sql 은 대상 DB 선택 후 원본 그대로
//     ⑧ 대상 DB 가 있으면 -Force 없이는 멈춘다 · DROP DATABASE 는 전부 -Force 가지 안에만
//     ⑨ 기대 schema_version 은 schema-calendar.sql 에서 읽는다(숫자를 박지 않는다)
//     ⑩ 변이 주입 — 위 검사가 실제로 잡는지 증명
//     ⑪ 어떤 종료코드로 끝나든 보고서가 남는다
//     ⑫ 사용자 3표는 원본에서 옮기지 않고 회사 시드(02 → 03 → 04, 대상 DB)로 채운다 · 원본 사용자 표는
//        요구하지 않는다 · login_id 명부 대조는 정보용(경고만, 멈추지 않음) · 시딩 검사(번호 NULL·중복 0 ·
//        행 수 > 0 · AUTO_INCREMENT > MAX)
//     ⑬ mysql 세션 UTC — .cnf 의 [mysql] 그룹에 init-command SET time_zone='+00:00'
//        ([client] 아님: mysqldump 도 [client] 를 읽고 모르는 옵션에서 멈춘다)
//     ⑭ project.contract_name/common_name 의 NULL 은 복사 SELECT 의 IFNULL(<col>, '') 로(대상 NOT NULL)
//     ⑮ 창 멈춤 규칙: 리다이렉트면 안 멈춤 · ps1 직접 실행이면 늘 멈춤 · .cmd 가 TC_SETUP_LAUNCHER=cmd
//     ⑯ app_user.sort_order 백필 — migrate-2026-09-10 2단계와 같은 문장 · 04 뒤 · 과제 복사 앞
//
// 공용 기계(주석 마스커·비번 검사·종료코드 표·변이 주입기)는 tests/ps-guard-lib.mjs 의 것을 쓴다 —
// backup/restore 계약과 같은 잣대를 대기 위해서다.
import { test, assert } from './harness.mjs';
import { readFileSync } from 'node:fs';
import {
  maskPs, passwordOnCommandLineHits, exitCodeTable, exitCodesInTable, exitCodesUsed,
  mutate, nonAsciiLines,
} from './ps-guard-lib.mjs';

const PS_URL = new URL('../db/deploy/setup-taskcalendar.ps1', import.meta.url);
const CMD_URL = new URL('../db/deploy/setup-taskcalendar.cmd', import.meta.url);
const psBytes = readFileSync(PS_URL);
const cmdBytes = readFileSync(CMD_URL);
const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const psSrc = norm(readFileSync(PS_URL, 'utf8'));
const cmdSrc = norm(cmdBytes.toString('latin1'));
const appUserSqlSrc = readFileSync(new URL('../db/deploy/create-app-user.sql', import.meta.url), 'utf8');
const calGrantsSqlSrc = readFileSync(new URL('../db/deploy/grants-calendar.sql', import.meta.url), 'utf8');
const calSchemaSrc = readFileSync(new URL('../db/deploy/schema-calendar.sql', import.meta.url), 'utf8');
const sortOrderMigSrc = readFileSync(new URL('../db/deploy/migrate-2026-09-10-user-sort-order.sql', import.meta.url), 'utf8');
const structSqlSrc = readFileSync(new URL('../db/deploy/schema-structure.sql', import.meta.url), 'utf8');

// 문자열 '내용' 까지 공백으로 지운 사본(길이 동일). 중괄호 짝 맞추기에만 쓴다 —
// 서식 문자열("{0,-13}")이나 메시지 속 괄호가 블록 경계를 흐리지 않게.
function blankStrings(code) {
  const out = code.split('');
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < code.length) {
        if (c === '"' && code[k] === '`') { k += 2; continue; }
        if (code[k] === c && code[k + 1] === c) { k += 2; continue; }
        if (code[k] === c) break;
        k++;
      }
      for (let j = i + 1; j < k && j < code.length; j++) if (out[j] !== '\n') out[j] = ' ';
      i = k + 1; continue;
    }
    i++;
  }
  return out.join('');
}
// open 위치의 '{' 에 짝이 되는 '}' 위치.
function matchBrace(code, open) {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}') { depth--; if (depth === 0) return k; }
  }
  return -1;
}
// 정확히 한 번 나와야 하는 앵커의 위치.
function onlyOnce(code, re, label) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const hits = [...code.matchAll(g)];
  assert.strictEqual(hits.length, 1, `${label} 이(가) ${hits.length}번 나온다(1번이어야 한다) — 패턴 ${re}`);
  return hits[0].index;
}
function listLiteral(code, varName) {
  const m = new RegExp(`\\$${varName}\\s*=\\s*@\\(([^)]*)\\)`).exec(code);
  assert.ok(m, `$${varName} = @(...) 선언을 찾지 못했다`);
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

// ══ 검사 함수(테스트 + 변이 주입이 같은 함수를 쓴다) ═══════════════════
const checks = {
  // ② 비밀번호는 --defaults-extra-file 로만. 임시 .cnf 는 Cleanup 이 지우고, finally 가 Cleanup 을 부른다.
  secrets(ps) {
    const bad = passwordOnCommandLineHits(ps);
    assert.deepStrictEqual(bad, [],
      `비밀번호를 명령줄로 넘기는 자리가 생겼다: ${bad.join(' , ')} — 같은 사용자의 다른 프로세스가 ` +
      '명령줄을 그대로 읽는다. 자격은 --defaults-extra-file(임시 .cnf)로만 넘길 것');
    const code = maskPs(ps);
    assert.ok(/"--defaults-extra-file=\$\(\$script:cnfPath\)"/.test(code),
      '--defaults-extra-file 로 .cnf 를 넘기는 자리가 없다 — 검사가 볼 대상 자체가 사라졌다');
    const cl = /function Cleanup\(\)\{([\s\S]*?)\n\}/.exec(code);
    assert.ok(cl, 'Cleanup 함수가 사라졌다 — 비밀번호가 든 임시 .cnf 를 지울 자리가 없다');
    assert.ok(/Remove-Item -LiteralPath \$script:cnfPath/.test(cl[1]),
      'Cleanup 이 $script:cnfPath(.cnf)를 지우지 않는다 — 관리자 비번이 %TEMP% 에 평문으로 남는다');
    assert.ok(/\$script:tempFiles/.test(cl[1]),
      'Cleanup 이 임시 .sql(앱 비번이 든 create-app-user 사본 포함)을 지우지 않는다');
    assert.ok(/\}\s*finally\s*\{\s*(?:\n\s*)*Cleanup\b/.test(code),
      'finally 블록이 Cleanup 을 부르지 않는다 — 예외로 끝나면 .cnf 가 남는다');
    // BOM 없는 UTF-8 로 쓴다(BOM 이면 MySQL 이 [client] 머리를 못 읽고, ascii 면 비ASCII 비번이 '?' 가 된다).
    assert.ok(/WriteAllText\(\$script:cnfPath, \$cnfText, \(New-Object System\.Text\.UTF8Encoding\(\$false\)\)\)/.test(code),
      '.cnf 를 BOM 없는 UTF-8 로 쓰는 자리가 바뀌었다');
  },

  // ③ 단계 순서.
  order(ps) {
    const code = maskPs(ps);
    const steps = [
      ['원본 mysqldump', /\bDumpDb\s+\$SourceDb\b/],
      ['CREATE DATABASE(대상)', /"CREATE DATABASE " \+ \(BQ \$TargetDb\)/],
      ['schema-structure.sql 적용', /ApplySqlFile\s+\$structFile\b/],
      ['01-schema-users.sql 적용', /ApplySqlFile\s+\$usersFile\b/],
      ['schema-calendar.sql 적용', /ApplySqlFile\s+\$calFile\b/],
      ['02-seed-org.sql 적용', /ApplySqlFile\s+\$seedOrgFile\b/],
      ['03-seed-users.sql 적용', /ApplySqlFile\s+\$seedUsersFile\b/],
      ['04-permissions.sql 적용', /ApplySqlFile\s+\$permsFile\b/],
      ['sort_order 백필', /\$sortFilled = \[long\]\(Q \$sortSql\b/],
      ['과제 4표 복사 적용', /ApplySqlFile\s+\$copyFile\b/],
      ['권한 적용(create-app-user)', /ApplySqlFile\s+\$appUserTmp\b/],
    ];
    const at = steps.map(([label, re]) => [label, onlyOnce(code, re, label)]);
    for (let i = 1; i < at.length; i++) {
      assert.ok(at[i - 1][1] < at[i][1],
        `단계 순서가 틀렸다: '${at[i - 1][0]}' 가 '${at[i][0]}' 보다 뒤에 있다. ` +
        '백업 → 구조(과제 → 사용자 → 캘린더) → 회사 시드(02 → 03 → 04) → sort_order 백필 → 과제 4표 복사 → 권한 ' +
        '순서여야 한다. 특히 사용자 DDL 이 캘린더보다 늦으면 schema-calendar.sql 머리의 가드(app_user.user_id 필요)가 ' +
        '구축을 막고, 시드가 구조보다 앞이면 넣을 표가 없다');
    }
    // 적용 경로 자체: 파일 바이트를 그대로 흘리고, 실패하면 죽는다.
    const fn = /function ApplySqlFile\([^)]*\)\{([\s\S]*?)\n  \}/.exec(code);
    assert.ok(fn, 'ApplySqlFile 함수를 찾지 못했다');
    assert.ok(/--default-character-set=utf8mb4/.test(fn[1]) && /< `"\$file`"/.test(fn[1]),
      'ApplySqlFile 이 파일을 utf8mb4 로 stdin 에 흘려 넣지 않는다');
    assert.ok(/if\(\$rc -ne 0\)\{ Die /.test(fn[1]),
      'ApplySqlFile 이 mysql 종료코드가 0 이 아닐 때 멈추지 않는다 — 반쯤 만든 구조 위에서 다음 단계가 돈다');
    // 백업 함수: backup-taskmgr.ps1 과 같은 네 인자 + 마감 줄 · 1KB 검사.
    const dump = /function DumpDb\([^)]*\)\{([\s\S]*?)\n  \}/.exec(code);
    assert.ok(dump, 'DumpDb 함수를 찾지 못했다');
    for (const a of ['--single-transaction', '--no-tablespaces', '--routines', '--triggers']) {
      assert.ok(dump[1].includes(`"${a}"`), `mysqldump 인자 ${a} 가 빠졌다(backup-taskmgr.ps1 과 같은 네 인자여야 한다)`);
    }
    assert.ok(dump[1].includes('-- Dump completed') && /-le 1024/.test(dump[1]),
      "백업 검증('-- Dump completed' 마감 줄 · 1KB 초과)이 사라졌다");
  },

  // ④ 복사 순서.
  copyOrder(ps) {
    const code = maskPs(ps);
    assert.deepStrictEqual(listLiteral(code, 'COPY_ORDER'),
      ['section_code', 'status_code', 'customer', 'project'],
      '복사 대상·순서가 바뀌었다 — 원본에서 옮기는 것은 과제 트랙 4표(FK 부모 → 자식)뿐이다(사용자 3표는 회사 시드, ⑫)');
    assert.ok(/foreach\(\$t in \$COPY_ORDER\)\{\s*\n\s*\$colSql/.test(code),
      '복사 루프가 $COPY_ORDER 를 돌지 않는다');
    // 교집합 컬럼 — 원본에만 있는 컬럼은 이름을 보고서에 남긴다(조용히 버리지 않는다).
    assert.ok(/\$cols\s*=\s*@\(\$tgtCols \| Where-Object \{ \$srcCols -contains \$_ \}\)/.test(code),
      '복사 컬럼이 대상∩원본 교집합(대상 순서)이 아니다');
    assert.ok(/\$srcOnly\.Count -gt 0\)\{ \$line \+= /.test(code),
      '원본에만 있어 복사하지 않는 컬럼을 보고서에 적는 자리가 사라졌다 — 조용히 버려진다');
  },

  // ⑤ 시각 이동.
  shift(ps) {
    const code = maskPs(ps);
    assert.deepStrictEqual(listLiteral(code, 'SHIFT_TABLES').sort(),
      ['customer', 'project', 'section_code', 'status_code'],
      'KST→UTC 이동 대상 표는 과제 트랙 4표뿐이어야 한다(사용자 3표는 원본에서 옮기지 않는다 — 회사 시드)');
    assert.deepStrictEqual(listLiteral(code, 'SHIFT_COLS').sort(), ['created_at', 'updated_at'],
      'KST→UTC 이동 대상 컬럼은 created_at/updated_at 뿐이어야 한다');
    assert.ok(/'DATE_SUB\(' \+ \(BQ \$c\) \+ ', INTERVAL 9 HOUR\)'/.test(code),
      'DATE_SUB(<col>, INTERVAL 9 HOUR) 이동식이 사라졌거나 바뀌었다');
    assert.ok(code.includes("\n$SHIFT_TABLES = @('section_code','status_code','customer','project')\n"),
      '$SHIFT_TABLES 줄이 바뀌었다 — KST→UTC 이동 대상은 과제 트랙 4표 그대로여야 한다');
    assert.ok(/if\(\$doShift -and \(\$SHIFT_TABLES -contains \$t\) -and \(\$SHIFT_COLS -contains \$c\)\)/.test(code),
      '이동 조건이 ($doShift · $SHIFT_TABLES · $SHIFT_COLS) 셋을 모두 보지 않는다 — 엉뚱한 표/컬럼이 밀린다');
    assert.ok(!/shiftTablesEff|SHIFT_TABLES_LEGACY/.test(code),
      '옛 사용자 표용 이동 목록($shiftTablesEff · $SHIFT_TABLES_LEGACY)이 남아 있다 — 사용자 표는 시드라 밀 것이 없다');
    assert.ok(/\[switch\]\$NoShift/.test(code), '-NoShift 스위치가 사라졌다');
    assert.ok(/\$doShift = -not \$NoShift/.test(code), '-NoShift 가 이동을 끄지 않는다');
  },

  // ⑥ FK 검사 끄기/켜기 · 고아 행.
  fkAndOrphans(ps) {
    const code = maskPs(ps);
    const off = onlyOnce(code, /\$copy\.Add\('SET FOREIGN_KEY_CHECKS=0;'\)/, 'FOREIGN_KEY_CHECKS=0');
    const on = onlyOnce(code, /\$copy\.Add\('SET FOREIGN_KEY_CHECKS=1;'\)/, 'FOREIGN_KEY_CHECKS=1');
    const ins = [...code.matchAll(/\$copy\.Add\('INSERT INTO '/g)].map((m) => m.index);
    assert.ok(ins.length >= 1, '복사 INSERT 를 만드는 자리를 찾지 못했다');
    assert.ok(off < Math.min(...ins), 'FOREIGN_KEY_CHECKS=0 이 INSERT 보다 앞에 있지 않다 — org_unit 자기참조가 막힌다');
    assert.ok(on > Math.max(...ins), 'FOREIGN_KEY_CHECKS=1 이 INSERT 뒤에 없다');
    const apply = onlyOnce(code, /ApplySqlFile\s+\$copyFile\b/, '복사 적용');
    assert.ok(on < apply, 'FOREIGN_KEY_CHECKS=1 이 복사 스크립트를 적용하기 전에 스크립트에 들어가지 않는다');
    // 고아 행 6관계(자식.컬럼 → 부모.컬럼).
    const rel = [...code.matchAll(/child='(\w+)';\s*col='(\w+)';\s*parent='(\w+)';\s*pcol='(\w+)'/g)]
      .map((m) => `${m[1]}.${m[2]}->${m[3]}.${m[4]}`).sort();
    assert.deepStrictEqual(rel, [
      'app_user.org_id->org_unit.org_id',
      'app_user.title->title_code.name',
      'org_unit.parent_id->org_unit.org_id',
      'project.customer->customer.name',
      'project.section->section_code.name',
      'project.status->status_code.name',
    ], '고아 행 검사 관계가 바뀌었다 — FK 검사를 끄고 넣었으므로 이것이 유일한 정합성 관문이다');
    assert.ok(/foreach\(\$oc in \$ORPHAN_CHECKS\)/.test(code) && /" c LEFT JOIN "/.test(code) &&
      /" IS NOT NULL AND p\." \+ \(BQ \$oc\.pcol\) \+ " IS NULL;"/.test(code),
      '고아 행 질의(LEFT JOIN … 자식 NOT NULL AND 부모 IS NULL)가 바뀌었다');
    assert.ok(/if\(\$orphanTotal -ne 0\)\{ Die /.test(code), '고아 행이 있어도 멈추지 않는다');
  },

  // ⑦ 스키마 치환.
  schemaSubst(ps) {
    const code = maskPs(ps);
    assert.ok(code.includes("[regex]::Replace($text, '\\btaskmgr\\.', ($TargetDb + '.'))"),
      "스키마 치환이 낱말 경계 정규식 '\\btaskmgr\\.' 가 아니다 — 'taskmgr_app' 계정 이름이나 다른 낱말을 건드릴 수 있다");
    onlyOnce(code, /SubstSchema \$appUserText\b/, 'create-app-user.sql 치환');
    onlyOnce(code, /SubstSchema \$calGrantsText\b/, 'grants-calendar.sql 치환');
    assert.ok(!/SubstSchema \$companyGrantsText/.test(code),
      '05-grants.sql 을 치환하고 있다 — 그 파일은 DATABASE() 를 쓰므로 치환할 것이 없고, 대상 DB 선택으로 충분하다');
    onlyOnce(code, /ApplySqlFile \$companyGrantsFile \$TargetDb\b/, '05-grants.sql 을 대상 DB 선택으로 적용');
    onlyOnce(code, /ApplySqlFile \$appUserTmp ""/, 'create-app-user.sql 치환 사본 적용');
    onlyOnce(code, /ApplySqlFile \$calGrantsTmp ""/, 'grants-calendar.sql 치환 사본 적용');
    assert.ok(/\$appUserSql\.Replace\('CHANGE_ME_ON_DEPLOY', \(SqlStr \$AppPassword\)\)/.test(code),
      '-AppPassword 를 자리표에 문자 그대로(정규식 아님) 넣는 자리가 바뀌었다');
  },

  // ⑧ 대상 DB 가드.
  targetGuard(ps) {
    const code = maskPs(ps);
    const bare = blankStrings(code);
    const stop = /if\(-not \$Force\)\{\s*\n\s*Die "[^"\n]*-Force[^"\n]*"/.exec(code);
    assert.ok(stop, '대상 DB 가 이미 있을 때 -Force 없이 멈추는(메시지에 -Force 를 알리는) 자리가 사라졌다');
    const confirm = onlyOnce(code, /Read-Host "계속하려면 Y"/, '확인 질문');
    assert.ok(stop.index < confirm, '-Force 없는 대상 존재 검사가 확인 질문보다 뒤에 있다 — 사전 점검(종료코드 3)이 아니게 된다');
    const blocks = [...code.matchAll(/if\(\$Force\)\{/g)].map((m) => {
      const open = m.index + m[0].length - 1;
      return [open, matchBrace(bare, open)];
    });
    assert.ok(blocks.length >= 1, 'if($Force){ … } 가지를 찾지 못했다');
    const drops = [...code.matchAll(/DROP DATABASE/g)].map((m) => m.index);
    assert.ok(drops.length >= 1, 'DROP DATABASE 자리를 찾지 못했다(검사가 헛돈다)');
    // 예외 없음 — 이 스크립트가 지우는 DB 는 -Force 의 기존 대상 하나뿐이다(스테이징 경로는 없앴다).
    for (const d of drops) {
      assert.ok(blocks.some(([o, c]) => c > 0 && d > o && d < c),
        'DROP DATABASE 가 if($Force){ } 가지 밖에 있다 — -Force 없이도 기존 대상 DB(또는 다른 DB)가 지워질 수 있다');
    }
    // 지우기 전에 대상도 한 벌 백업한다.
    const drop = onlyOnce(code, /Q \("DROP DATABASE "/, 'DROP DATABASE 실행');
    const bk = onlyOnce(code, /DumpDb \$TargetDb \$tgtDump/, '삭제 전 대상 백업');
    assert.ok(bk < drop, '대상 DB 를 백업하기 전에 DROP 한다');
  },

  // ⑨ schema_version 은 파일에서 읽는다.
  versionFromFile(ps) {
    assert.ok(ps.includes(`[regex]::Match($calText, "VALUES \\('schema_version', '(\\d+)'")`),
      'schema-calendar.sql 에서 schema_version 을 읽는 정규식이 사라졌다');
    assert.ok(!/'12'|"12"/.test(ps),
      "ps1 에 '12' 가 박혀 있다 — 기대 schema_version 은 schema-calendar.sql 에서 읽어야 한다(스키마가 오르면 조용히 낡는다)");
    assert.ok(/if\(\$actVersion -ne \$expVersion\)\{ Die /.test(maskPs(ps)),
      '실제 schema_version 을 파일 값과 대조해 멈추는 자리가 사라졌다');
  },
  // ⑪ 어떤 종료코드로 끝나든 보고서가 남는다. 2026-09-29 실측: 사전 점검 실패(3)는 [1] 백업 단계에 못 미쳐 보고서
  // 폴더가 비어 있었고, 사용자에게는 "아무것도 결과물이 안 나오는" 것으로 보였다. 그래서 (a) -BackupDir 확정 직후 폴더를
  // 만들고 reportDir 로 잡는다 (b) 그래도 없으면 SaveReport 가 스크립트 폴더로 떨어진다 (c) Finish 는 실패에 -FAILED 를 붙인다.
  reportAlways(ps) {
    const m = maskPs(ps);
    const iResolve = m.indexOf('$BackupDir      = FullPath $BackupDir');
    const iEarly = m.indexOf('if(Test-Path -LiteralPath $BackupDir){ $script:reportDir = $BackupDir }');
    const iStep1 = m.indexOf('Step 1 ');
    assert.ok(iResolve > 0 && iEarly > iResolve && iStep1 > iEarly,
      '보고서 폴더(reportDir)를 -BackupDir 확정 직후·[1] 백업 전에 잡는 줄이 없다 — 사전 점검 실패(3)·취소(2)가 보고서 없이 끝난다');
    assert.ok(/\$dir = \$script:reportDir\s*\n\s*if\(-not \$dir\)\{ \$dir = Split-Path -Parent \$PSCommandPath \}/.test(m),
      'SaveReport 의 스크립트 폴더 대체가 사라졌다 — 백업 폴더를 못 만들면 보고서가 없다');
    assert.ok(!/if\(-not \$script:reportDir\)\{ return \}/.test(m),
      'SaveReport 가 reportDir 이 비면 조용히 돌아간다 — 그 경로가 바로 "결과물이 안 나오는" 경로다');
    assert.ok(/if\(\$code -eq \$EXIT_OK\)\{ SaveReport "" \} else \{ SaveReport "-FAILED" \}/.test(m),
      'Finish 가 실패·취소 종료에 -FAILED 보고서를 남기지 않는다');
  },

  // ⑫ 사용자 3표 = 회사 시드. 2026-09-29 결정: 폐쇄망 taskmgr 의 사용자 표는 0.16 모양(org_unit 이름 PK ·
  // app_user login_id PK)이라 번호가 없고, 회사 보고 사이트의 명부(= 폐쇄망 명부)는 이미 회사 시드에 번호까지
  // 담겨 있다. 그래서 명부는 시드가 정본이고, 원본 사용자 표는 login_id 대조(정보용)에만 읽는다.
  seedUsers(ps) {
    const code = maskPs(ps);
    const bare = blankStrings(code);
    // (a) 세 파일 = 회사 데이터 폴더의 02 · 03 · 04.
    for (const [v, f] of [['seedOrgFile', '02-seed-org.sql'], ['seedUsersFile', '03-seed-users.sql']]) {
      assert.ok(new RegExp(`\\$${v}\\s*=\\s*Join-Path \\$CompanyDataDir "${f.replace(/\./g, '\\.')}"`).test(code),
        `$${v} 가 회사 데이터 폴더(-CompanyDataDir)의 ${f} 가 아니다`);
    }
    // 04 는 이름을 쪼개 적는다(② 의 '-p…' 검사를 피하려고 — ps1 의 ※).
    assert.ok(/\$permsName\s*=\s*"04-" \+ "permissions\.sql"/.test(code) && /\$permsFile\s*=\s*Join-Path \$CompanyDataDir \$permsName\b/.test(code),
      '$permsFile 가 회사 데이터 폴더(-CompanyDataDir)의 04-permissions.sql 이 아니다');
    // (b) 사전 점검이 필요 파일 9개를 확인 질문 전에 본다(없으면 종료코드 3).
    const fc = /foreach\(\$f in @\(([^)]*)\)\)\{\s*\n\s*if\(-not \(Test-Path -LiteralPath \$f -PathType Leaf\)\)\{ Die /.exec(code);
    assert.ok(fc, '필요 파일 확인 루프(foreach($f in @(…)){ Test-Path … Die })를 찾지 못했다');
    assert.deepStrictEqual(fc[1].split(',').map((s) => s.trim()).sort(),
      ['$appUserFile', '$calFile', '$calGrantsFile', '$companyGrantsFile', '$permsFile', '$seedOrgFile', '$seedUsersFile', '$structFile', '$usersFile'].sort(),
      '사전 점검의 필요 파일 목록이 DDL 3 · 권한 3 · 회사 시드 3(02 · 03 · 04) 이 아니다');
    const confirm = onlyOnce(code, /Read-Host "계속하려면 Y"/, '확인 질문');
    assert.ok(fc.index < confirm, '필요 파일 확인이 확인 질문보다 뒤다 — 사전 점검(종료코드 3)이 아니게 된다');
    assert.ok(/Ok "필요 파일 9개 확인/.test(code), '필요 파일 수(9개) 메시지가 없다');
    // (c) 대상 DB 에 02 → 03 → 04 — 구조([2]) 뒤 · 과제 복사 앞.
    const a02 = onlyOnce(code, /ApplySqlFile\s+\$seedOrgFile\s+\$TargetDb\b/, '02-seed-org.sql 적용(대상 DB)');
    const a03 = onlyOnce(code, /ApplySqlFile\s+\$seedUsersFile\s+\$TargetDb\b/, '03-seed-users.sql 적용(대상 DB)');
    const a04 = onlyOnce(code, /ApplySqlFile\s+\$permsFile\s+\$TargetDb\b/, '04-permissions.sql 적용(대상 DB)');
    assert.ok(a02 < a03 && a03 < a04,
      '회사 시드 순서가 틀렸다: 02-seed-org.sql → 03-seed-users.sql → 04-permissions.sql 이어야 한다 ' +
      '(03 의 app_user 가 02 의 org_unit · title_code 를 FK 로 가리키고, 04 는 03 의 사람에게 UPDATE 한다)');
    const calApply = onlyOnce(code, /ApplySqlFile\s+\$calFile\b/, 'schema-calendar.sql 적용');
    const copyApply = onlyOnce(code, /ApplySqlFile\s+\$copyFile\b/, '과제 복사 적용');
    assert.ok(calApply < a02 && a04 < copyApply, '회사 시드가 구조([2]) 뒤 · 과제 4표 복사 앞이 아니다');
    // (d) 원본 사용자 표를 대상에 붓지 않는다.
    const USER = /^(title_code|org_unit|app_user)$/;
    assert.deepStrictEqual(listLiteral(code, 'COPY_ORDER').filter((t) => USER.test(t)), [],
      '복사 목록($COPY_ORDER)에 사용자 표가 있다 — 회사 시드로 채운 명부를 DELETE 로 지우고 원본(0.16 모양 · 번호 없음)의 옛 행을 붓는다');
    const ins = [...code.matchAll(/INSERT\s+(?:IGNORE\s+)?INTO\b[^\n]*\b(?:title_code|org_unit|app_user)\b[^\n]*\bSELECT\b[^\n]*\$SourceDb\b/g)].map((m) => m[0].trim());
    assert.deepStrictEqual(ins, [], `원본의 사용자 표를 대상에 INSERT … SELECT 로 붓는 자리가 있다: ${ins.join(' | ')}`);
    assert.ok(/foreach\(\$t in \$COPY_ORDER\)\{ \$copy\.Add\('DELETE FROM ' \+ \(TQ \$TargetDb \$t\) \+ ';'\) \}/.test(code) &&
      [...code.matchAll(/DELETE FROM/g)].length === 1,
      "시드 행 비우기(DELETE FROM)가 $COPY_ORDER 한 곳이 아니다 — 방금 채운 사용자 표를 지울 수 있다");
    // (e) 사전 점검은 원본 사용자 표를 요구하지 않는다.
    const kc = /\$KEY_COLS = \[ordered\]@\{([\s\S]*?)\n\}/.exec(code);
    assert.ok(kc, '$KEY_COLS 선언을 찾지 못했다');
    assert.ok(!/title_code|org_unit|app_user/.test(kc[1]),
      '$KEY_COLS 에 사용자 표가 있다 — 원본 사용자 표(0.16 모양 = 번호 없음)의 정체성 컬럼을 요구해 사전 점검에서 멈춘다');
    assert.ok(/\$lack = @\(\$COPY_ORDER \| Where-Object \{ \$srcTables -notcontains \$_ \}\)/.test(code),
      '원본에 요구하는 표 목록이 $COPY_ORDER(과제 4표)가 아니다');
    assert.ok(!/\$(legacyOrg|legacyApp|legacyUsers|StageDb|CopySrcDb|copyCounts)\b|DropStageDb|_legacy_stage/.test(code),
      '스테이징 경로(옛 사용자 표 마이그레이션)의 잔재가 남아 있다');
    // (f) 명부 대조 — 시드 뒤 · 정보용(Die 없음 · 실패하면 죽는 Q/QRows 없음).
    const xAt = onlyOnce(code, /\n  if\(\$srcLoginCheck\)\{\n/, '명부 대조 블록');
    const xOpen = code.indexOf('{', xAt);
    const xClose = matchBrace(bare, xOpen);
    assert.ok(xClose > xOpen, '명부 대조 블록의 끝을 찾지 못했다');
    const xBlk = code.slice(xOpen, xClose);
    assert.ok(xAt > a04, '명부 대조가 회사 시드 적용 뒤가 아니다');
    assert.ok(!/\bDie\b/.test(xBlk), '명부 대조 블록 안에 Die 가 있다 — 정보용 대조가 구축을 멈춘다');
    assert.ok(!/\bQ\s*[("]|\bQRows\b(?!Try)/.test(xBlk),
      '명부 대조 블록이 실패하면 죽는 Q/QRows 를 쓴다 — 콜레이션 차이 하나로 구축이 멈춘다. QRowsTry 를 쓸 것');
    assert.ok(/QRowsTry/.test(xBlk) && /login_id/.test(xBlk) && /\bWarn\b/.test(xBlk) && /\bOk "명부 대조/.test(xBlk),
      '명부 대조(login_id · QRowsTry · 다르면 Warn · 같으면 Ok)의 모양이 바뀌었다');
    const srcUserReads = [...code.matchAll(/TQ \$SourceDb '(?:title_code|org_unit|app_user)'/g)].map((m) => m.index);
    assert.ok(srcUserReads.length >= 1 && srcUserReads.every((i) => i > xOpen && i < xClose),
      '원본 사용자 표를 명부 대조 블록 밖에서 읽는다');
    const qt = /function QRowsTry\([^)]*\)\{([\s\S]*?)\n  \}/.exec(code);
    assert.ok(qt && !/\bDie\b/.test(qt[1]) && /\$LASTEXITCODE -ne 0\)\{ return @\{ ok = \$false/.test(qt[1]),
      'QRowsTry 가 실패에서 Die 하거나 ok=$false 를 돌려주지 않는다');
    assert.ok(/if\(\$srcTables -contains 'app_user'\)\{/.test(code) && /\$srcLoginCheck = \(\$srcAppCols -contains 'login_id'\)/.test(code),
      '명부 대조 조건(원본에 app_user 가 있고 login_id 컬럼이 있을 때)이 바뀌었다');
    const s5 = onlyOnce(code, /Step 5 "/, 'Step 5');
    assert.ok(/명부 대조[^\n]*\$xSrcOnly[^\n]*\$xSeedOnly/.test(code.slice(s5)), '보고서에 명부 대조 두 수(원본에만 · 시드에만)가 없다');
    // (g) 시딩 검사 — 번호 NULL·중복 0 · 3표 행 수 > 0 · AUTO_INCREMENT > MAX (시드 직후 · 과제 복사 앞).
    assert.deepStrictEqual(listLiteral(code, 'SEED_TABLES'), ['title_code', 'org_unit', 'app_user'], '$SEED_TABLES 가 사용자 3표가 아니다');
    assert.ok(/\$SEED_AUTOINC_KEYS\s*=\s*\[ordered\]@\{ org_unit = 'org_id'; app_user = 'user_id' \}/.test(code) &&
      /\$AUTOINC_KEYS\s*=\s*\[ordered\]@\{ project = 'id' \}/.test(code),
      'AUTO_INCREMENT 확인 대상이 (시드: org_unit · app_user / 복사: project) 가 아니다');
    const seedAi = onlyOnce(code, /foreach\(\$t in \$SEED_AUTOINC_KEYS\.Keys\)\{ CheckAutoInc /, '시드 AUTO_INCREMENT 확인');
    const copyAi = onlyOnce(code, /foreach\(\$t in \$AUTOINC_KEYS\.Keys\)\{ CheckAutoInc /, '복사 AUTO_INCREMENT 확인');
    assert.ok(seedAi > a04 && seedAi < copyApply && copyAi > copyApply, 'AUTO_INCREMENT 확인 위치가 (시드 직후 · 복사 직후) 가 아니다');
    const ai = /function CheckAutoInc\([^)]*\)\{([\s\S]*?)\n  \}/.exec(code);
    assert.ok(ai && /information_schema_stats_expiry=0/.test(ai[1]) && /if\(\$ai -le \$mx\)\{ Die /.test(ai[1]),
      'CheckAutoInc 가 (stats_expiry=0 으로) AUTO_INCREMENT > MAX 를 확인해 멈추지 않는다');
    assert.ok(/if\(\$nNull -ne 0 -or \$nDup -ne 0\)\{ Die /.test(code), '시드의 org_id/user_id NULL·중복 검사가 없다');
    assert.ok(/if\(\$seedCounts\[\$t\] -lt 1\)\{ Die /.test(code), '시딩 뒤 사용자 3표 행 수 > 0 검사가 없다');
    // (h) cal_user_rev 재시딩은 사람이 들어온 뒤.
    const rev = onlyOnce(code, /"INSERT IGNORE INTO " \+ \(TQ \$TargetDb 'cal_user_rev'\)/, 'cal_user_rev 재시딩');
    assert.ok(rev > a03, 'cal_user_rev 재시딩이 03-seed-users.sql 보다 앞이다 — 사용자별 rev 0 행이 하나도 안 생긴다');
  },

  // ⑬ mysql 세션 UTC. 시드 행의 created_at/updated_at 은 CURRENT_TIMESTAMP(세션 time_zone 을 따른다)이고 앱은
  // UTC 로 쓴다. init-command 는 [mysql] 그룹(= mysql.exe 만 읽음)에 둔다 — [client] 는 mysqldump 도 읽는다.
  cnfUtc(ps) {
    const code = maskPs(ps);
    const a = onlyOnce(code, /\$cnfText = "/, '.cnf 본문 조립');
    const b = code.indexOf('[IO.File]::WriteAllText($script:cnfPath', a);
    assert.ok(b > a, '.cnf 를 쓰는 자리를 찾지 못했다');
    let group = null;
    const groups = [];
    const inits = [];
    for (const p of code.slice(a, b).split(/`r`n|\n/)) {
      const g = /\[(\w+)\]/.exec(p);
      if (g) { group = g[1]; groups.push(group); }
      if (/init-command/.test(p)) inits.push([group, p.trim()]);
    }
    assert.deepStrictEqual(groups, ['client', 'mysql'], `.cnf 그룹이 [client] → [mysql] 이 아니다: ${groups.join(',')}`);
    assert.strictEqual(inits.length, 1, `.cnf 의 init-command 가 ${inits.length}개다(1개여야 한다)`);
    assert.strictEqual(inits[0][0], 'mysql',
      'init-command 가 [mysql] 그룹 밖에 있다 — [client] 면 mysqldump 도 읽어 모르는 옵션에서 멈춘다(원본 백업이 죽는다)');
    assert.ok(inits[0][1].includes(`init-command=""SET time_zone='+00:00'""`),
      `init-command 가 SET time_zone='+00:00' 이 아니다: ${inits[0][1]}`);
  },

  // ⑭ project.contract_name/common_name 의 NULL → ''. 0.16 원본은 NULL 을 허용했고 대상은 NOT NULL DEFAULT '' 다.
  // 원본은 읽기만 하므로 UPDATE 로 고칠 수 없다 — 복사 SELECT 에서 IFNULL 로 바꾼다.
  nullToEmpty(ps) {
    const code = maskPs(ps);
    assert.ok(/\$NULL_TO_EMPTY = \[ordered\]@\{ project = @\('contract_name','common_name'\) \}/.test(code),
      "$NULL_TO_EMPTY 가 project 의 contract_name · common_name 이 아니다");
    const br = /\} elseif\(\$NULL_TO_EMPTY\.Contains\(\$t\) -and \(\$NULL_TO_EMPTY\[\$t\] -contains \$c\)\)\{\n([\s\S]*?)\n      \} else \{/.exec(code);
    assert.ok(br, "NULL→'' 가지(elseif($NULL_TO_EMPTY …))를 찾지 못했다");
    assert.ok(br[1].includes(`$sel += ('IFNULL(' + (BQ $c) + ", '')")`),
      "복사 SELECT 가 contract_name/common_name 을 IFNULL(<col>, '') 로 감싸지 않는다 — 원본의 NULL 이 NOT NULL 대상에서 INSERT 를 막는다");
    assert.ok(/'\) SELECT ' \+ \(\$sel -join ','\) \+ ' FROM ' \+ \(TQ \$SourceDb \$t\)/.test(code),
      '복사 INSERT 가 $sel(IFNULL · -9h 식)로 원본에서 SELECT 하지 않는다');
    for (const c of ['contract_name', 'common_name']) {
      assert.ok(new RegExp(`\\n\\s*${c}\\s+VARCHAR\\(\\d+\\)\\s+NOT NULL DEFAULT ''`).test(structSqlSrc),
        `실물: schema-structure.sql 의 project.${c} 가 NOT NULL DEFAULT '' 가 아니다 — IFNULL 의 근거가 바뀌었다`);
    }
    assert.ok(!/"UPDATE " \+ \(TQ \$SourceDb\b/.test(code), '원본에 UPDATE 를 낸다 — 원본은 읽기만 한다');
  },

  // ⑯ app_user.sort_order 백필 — 03 은 sort_order 를 적지 않는다. migrate-2026-09-10-user-sort-order.sql 2단계와
  // 같은 순서식 · 04 뒤(사람이 다 들어온 뒤) · 과제 복사 앞.
  sortBackfill(ps) {
    const code = maskPs(ps);
    const ORDER = 'ROW_NUMBER() OVER (ORDER BY (t.sort_order IS NULL), t.sort_order, u2.name, u2.user_id) * 10';
    assert.ok(sortOrderMigSrc.includes(ORDER), '실물: migrate-2026-09-10-user-sort-order.sql 의 순서식이 바뀌었다 — 스크립트의 백필도 함께 고칠 것');
    assert.ok(/\$sortNullBefore = \[long\]\(Q \("SELECT COUNT\(\*\) FROM " \+ \(TQ \$TargetDb 'app_user'\) \+ " WHERE sort_order IS NULL;"\)/.test(code),
      '백필 조건이 "시드 뒤 대상 app_user 에 sort_order NULL 이 있음" 이 아니다');
    const blk = /\n  if\(\$sortNullBefore -gt 0\)\{\n([\s\S]*?)\n  \}/.exec(code);
    assert.ok(blk, 'if($sortNullBefore -gt 0){ … } 백필 가지를 찾지 못했다 — 03-seed-users.sql 은 sort_order 를 적지 않으므로 백필이 늘 필요하다');
    const b = blk[1];
    assert.ok(b.includes(ORDER), 'sort_order 백필의 순서식이 마이그레이션(직급 서열 NULL 뒤 → 서열 → 이름 → user_id, ×10)과 다르다');
    assert.ok(/LEFT JOIN " \+ \(TQ \$TargetDb 'title_code'\) \+ " t ON t\.name = u2\.title/.test(b), '백필이 title_code 를 LEFT JOIN 하지 않는다');
    assert.ok(b.includes('SET u.sort_order = r.n, u.updated_at = u.updated_at'),
      '백필이 updated_at 을 자기 값으로 대입하지 않는다 — ON UPDATE 가 전원의 갱신 시각을 지금으로 덮는다');
    assert.ok(/\$sortFilled = \[long\]\(Q \$sortSql /.test(b), '백필 문장을 실행하는 자리가 없다');
    assert.ok(/if\(\$sortNull -ne 0\)\{ Die /.test(code.slice(blk.index)), '백필 뒤 NULL 0 검사가 없다');
    const a04 = onlyOnce(code, /ApplySqlFile\s+\$permsFile\b/, '04-permissions.sql 적용');
    const apply = onlyOnce(code, /ApplySqlFile\s+\$copyFile\b/, '과제 복사 적용');
    assert.ok(blk.index > a04 && blk.index < apply,
      '백필이 04-permissions.sql 뒤 · 과제 복사 앞이 아니다 — 사람이 다 들어오기 전에 번호를 매기거나, 복사 뒤로 밀린다');
    assert.ok(!/userSortFill/.test(code), '백필이 원본 모양 조건($userSortFill)에 묶여 있다 — 원본 사용자 표는 이제 보지 않는다');
  },

  // ⑮ 창 멈춤 규칙(2026-09-29 사용자 실측: ps1 을 직접 실행하면 결과를 읽기 전에 창이 꺼졌다).
  pauseRule(ps, cmd) {
    const code = maskPs(ps);
    const fin = /function Finish\([^)]*\)\{([\s\S]*?)\n\}/.exec(code);
    assert.ok(fin, 'Finish 함수를 찾지 못했다');
    const f = fin[1];
    assert.ok(/\$pause = \$false\s*\n\s*if\(\[Console\]::IsInputRedirected\)\{ \$pause = \$false \}\s*\n\s*elseif\(\$env:TC_SETUP_LAUNCHER -ne 'cmd'\)\{ \$pause = \$true \}\s*\n\s*elseif\(\$code -eq \$EXIT_OK -and -not \$Yes\)\{ \$pause = \$true \}/.test(f),
      '멈춤 규칙이 (리다이렉트 → 안 멈춤) → (.cmd 아님 → 늘 멈춤) → (.cmd → 성공·-Yes 아님만) 순서가 아니다');
    assert.strictEqual([...f.matchAll(/Read-Host/g)].length, 1, 'Finish 의 Read-Host 가 한 곳이 아니다');
    assert.ok(/if\(\$pause\)\{\s*\n\s*try \{ Read-Host "엔터를 누르면 종료" \| Out-Null \} catch \{\}/.test(f),
      'Read-Host 가 $pause 가지 안의 try/catch 로 감싸여 있지 않다');
    assert.ok(f.indexOf('Read-Host') < f.indexOf('exit $code'), 'Read-Host 가 exit 뒤에 있다');
    const set = /^set "TC_SETUP_LAUNCHER=cmd"$/m.exec(cmd);
    assert.ok(set, '.cmd 가 TC_SETUP_LAUNCHER=cmd 를 두지 않는다 — ps1 이 직접 실행으로 알고 실패 때 두 번 멈춘다');
    const ps1Line = cmd.search(/^powershell /m);
    assert.ok(ps1Line > set.index, '.cmd 의 set TC_SETUP_LAUNCHER 가 powershell 줄보다 뒤다');
  },
};

// ══ ① .cmd ══════════════════════════════════════════════════════════════
test('setup-taskcalendar ① .cmd: ASCII 만 · ps1 을 -ExecutionPolicy Bypass 로 · 인자 %* 전달 · 실패 시 pause', () => {
  const nonAscii = [...cmdBytes].filter((b) => b > 0x7e || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d));
  assert.strictEqual(nonAscii.length, 0,
    `setup-taskcalendar.cmd 에 비ASCII 바이트가 ${nonAscii.length}개 있다 — cmd.exe 가 코드페이지 65001 에서 ` +
    `배치 재개 위치를 잘못 계산해 주석 조각을 명령으로 실행한다:\n${nonAsciiLines(cmdSrc).join('\n')}`);
  assert.ok(/ASCII ONLY/.test(cmdSrc), "'ASCII ONLY' 못이 사라졌다 — 이유를 모르면 다음 사람이 한글을 넣는다");
  assert.ok(/powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-taskcalendar\.ps1" %\*/.test(cmdSrc),
    '.cmd 가 setup-taskcalendar.ps1 을 -ExecutionPolicy Bypass · %* 로 부르지 않는다');
  assert.ok(/^if errorlevel 1 pause$/m.test(cmdSrc) && /^exit \/b %RC%$/m.test(cmdSrc),
    '.cmd 가 실패 시 창을 멈추거나 ps1 의 종료코드를 그대로 돌려주지 않는다');
});

test('setup-taskcalendar ① 종료코드 표: .ps1 과 .cmd 가 글자 그대로 같고, ps1 이 실제로 내는 코드와 일치', () => {
  const a = exitCodeTable(psSrc, false);
  const b = exitCodeTable(cmdSrc, true);
  assert.deepStrictEqual(a, b, '.ps1 과 .cmd 의 종료코드 표가 다르다');
  const table = exitCodesInTable(a);
  assert.deepStrictEqual(table, [0, 1, 2, 3], `종료코드 표가 0/1/2/3 이 아니다: ${table.join(',')}`);
  assert.deepStrictEqual(exitCodesUsed(psSrc), table,
    `ps1 이 실제로 내는 코드(${exitCodesUsed(psSrc).join(',')})가 표와 다르다 — 무인 호출자가 엉뚱한 분기를 탄다`);
});

test('setup-taskcalendar ① .ps1 인코딩: UTF-8 BOM(5.1 이 한국어를 ANSI 로 오독하지 않게)', () => {
  assert.deepStrictEqual([...psBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf],
    'setup-taskcalendar.ps1 에 UTF-8 BOM 이 없다 — Windows PowerShell 5.1 은 BOM 없는 파일을 시스템 ANSI(CP949)로 읽어 한국어 문자열이 깨진다');
});

test('setup-taskcalendar ① 인자 삼킴 가드: 모든 문자열 인자에 AssertNoSwallow', () => {
  const code = maskPs(psSrc);
  const strParams = [...code.matchAll(/\[string\]\$(\w+)\s*=/g)].map((m) => m[1])
    .filter((n) => n !== 'RootPassword' && n !== 'AppPassword');
  assert.ok(strParams.length >= 9, `문자열 인자를 ${strParams.length}개만 찾았다`);
  const missing = strParams.filter((n) => !new RegExp(`AssertNoSwallow\\s+"-${n}"\\s+\\$${n}\\b`).test(code));
  assert.deepStrictEqual(missing, [],
    `AssertNoSwallow 가 빠진 인자: ${missing.join(', ')} — '-BackupDir "C:\\x\\"' 처럼 역슬래시로 끝난 값이 ` +
    '뒤 인자를 삼키면 -TargetDb 가 조용히 기본값으로 돌아간다');
  for (const p of ['RootPassword', 'AppPassword']) {
    assert.ok(new RegExp(`AssertNoSwallowSecret\\s+"-${p}"\\s+\\$${p}\\b`).test(code), `-${p} 의 삼킴 가드가 빠졌다`);
  }
});

// ══ ②〜⑨ ═══════════════════════════════════════════════════════════════
test('setup-taskcalendar ② 비밀번호는 .cnf 로만 · .cnf 는 finally 에서 삭제', () => checks.secrets(psSrc));
test('setup-taskcalendar ③ 단계 순서: 백업 → CREATE DATABASE → 과제·사용자·캘린더 DDL → 시드 02 → 03 → 04 → sort_order 백필 → 과제 4표 복사 → 권한', () => checks.order(psSrc));
test('setup-taskcalendar ④ 복사 대상 = 과제 트랙 4표(FK 부모 → 자식) · 교집합 컬럼', () => checks.copyOrder(psSrc));
test('setup-taskcalendar ⑤ KST→UTC(-9h)는 과제 트랙 4표의 created_at/updated_at 에만 · -NoShift', () => checks.shift(psSrc));
test('setup-taskcalendar ⑥ FK 검사 끄고 넣고 다시 켬 · 고아 행 6관계', () => checks.fkAndOrphans(psSrc));
test('setup-taskcalendar ⑦ 스키마 치환 \\btaskmgr\\. — 두 파일만 · 05-grants 는 대상 DB 선택', () => checks.schemaSubst(psSrc));
test('setup-taskcalendar ⑧ 대상 DB 가 있으면 -Force 없이는 멈춤 · DROP DATABASE 는 전부 -Force 가지 안', () => checks.targetGuard(psSrc));
test('setup-taskcalendar ⑨ 기대 schema_version 은 schema-calendar.sql 에서 읽는다', () => checks.versionFromFile(psSrc));
test('setup-taskcalendar ⑪ 어떤 종료코드로 끝나든 보고서가 남는다(사전 점검 실패·취소 포함)', () => checks.reportAlways(psSrc));
test('setup-taskcalendar ⑫ 사용자 3표는 회사 시드(02 → 03 → 04, 대상 DB) · 원본 사용자 표는 복사·요구하지 않음 · login_id 명부 대조는 경고만', () => checks.seedUsers(psSrc));
test("setup-taskcalendar ⑬ mysql 세션 UTC: .cnf 의 [mysql] 그룹에 init-command SET time_zone='+00:00' ([client] 아님)", () => checks.cnfUtc(psSrc));
test("setup-taskcalendar ⑭ project.contract_name/common_name 은 복사 SELECT 에서 IFNULL(<col>, '')", () => checks.nullToEmpty(psSrc));
test('setup-taskcalendar ⑮ 창 멈춤: 리다이렉트면 안 멈춤 · 직접 실행이면 늘 멈춤 · .cmd 가 TC_SETUP_LAUNCHER=cmd', () => checks.pauseRule(psSrc, cmdSrc));
test('setup-taskcalendar ⑯ app_user.sort_order 백필: migrate-2026-09-10 2단계와 같은 문장 · 04 뒤 · 과제 복사 앞', () => checks.sortBackfill(psSrc));

// ══ 실물 대조 — 스크립트가 기대는 파일 형식이 실제 파일과 맞는가 ═════════
test('setup-taskcalendar ⑦ 실물: \\btaskmgr\\. 치환이 두 권한 파일의 스키마만 바꾸고 계정 이름은 남긴다', () => {
  for (const [name, src] of [['create-app-user.sql', appUserSqlSrc], ['grants-calendar.sql', calGrantsSqlSrc]]) {
    const out = src.replace(/\btaskmgr\./g, 'taskcalendar.');
    assert.ok(/\bON taskcalendar\.\w+/.test(out), `${name}: 치환 뒤 'ON taskcalendar.<표>' 가 없다 — 파일 형식이 바뀌었다`);
    assert.ok(!/\bON taskmgr\./.test(out), `${name}: 치환 뒤에도 'ON taskmgr.' 가 남았다`);
    assert.ok(out.includes("'taskmgr_app'@'%'"), `${name}: 계정 이름 'taskmgr_app'@'%' 가 치환에 망가졌다`);
  }
  assert.ok(appUserSqlSrc.includes('CHANGE_ME_ON_DEPLOY'), 'create-app-user.sql 의 비밀번호 자리표가 사라졌다 — -AppPassword 가 들어갈 자리가 없다');
});

test('setup-taskcalendar ⑨ 실물: schema-calendar.sql 에 스크립트가 읽는 schema_version 시딩 줄이 있다', () => {
  const m = /VALUES \('schema_version', '(\d+)'/.exec(calSchemaSrc);
  assert.ok(m, "schema-calendar.sql 에 VALUES ('schema_version', 'N') 줄이 없다 — 스크립트가 기대 버전을 못 읽고 사전 점검에서 멈춘다");
});

// ══ ⑩ 변이 주입 — 검사가 실제로 잡는지 증명 ═══════════════════════════
test('setup-taskcalendar ⑩ 변이: FOREIGN_KEY_CHECKS=1 줄을 지우면 ⑥ 이 잡는다', () => {
  const m = mutate(psSrc, "  $copy.Add('SET FOREIGN_KEY_CHECKS=1;')\n", '');
  assert.throws(() => checks.fkAndOrphans(m), /FOREIGN_KEY_CHECKS=1/);
});

test('setup-taskcalendar ⑩ 변이: 01-schema-users.sql 과 schema-calendar.sql 적용 순서를 바꾸면 ③ 이 잡는다', () => {
  const lines = psSrc.split('\n');
  const u = lines.findIndex((l) => /ApplySqlFile \$usersFile\b/.test(l));
  const c = lines.findIndex((l) => /ApplySqlFile \$calFile\b/.test(l));
  assert.ok(u >= 0 && c >= 0 && u < c, '변이 준비 실패: 두 적용 줄을 찾지 못했다');
  [lines[u], lines[c]] = [lines[c], lines[u]];
  const m = lines.join('\n');
  assert.notStrictEqual(m, psSrc);
  assert.throws(() => checks.order(m), /단계 순서가 틀렸다/);
});

test('setup-taskcalendar ⑩ 변이: 이른 reportDir 잡기를 지우거나 SaveReport 가 빈 reportDir 에 돌아가면 ⑪ 이 잡는다', () => {
  assert.throws(() => checks.reportAlways(mutate(psSrc,
    'if(Test-Path -LiteralPath $BackupDir){ $script:reportDir = $BackupDir }\n', '')), /사전 점검 실패\(3\)/);
  assert.throws(() => checks.reportAlways(mutate(psSrc,
    '  $dir = $script:reportDir\n', '  if(-not $script:reportDir){ return }\n  $dir = $script:reportDir\n')), /조용히 돌아간다/);
});

test('setup-taskcalendar ⑩ 변이: 명령줄 비번 · 이동 표 확대 · 05 치환 · Force 밖 DROP · 박힌 버전을 각각 잡는다', () => {
  assert.throws(() => checks.secrets(mutate(psSrc,
    '"--defaults-extra-file=$($script:cnfPath)" "-N" "-B" "-e" "SELECT 1;"',
    '"-u$DbUser" "-p$RootPassword" "-N" "-B" "-e" "SELECT 1;"')), /명령줄/);
  assert.throws(() => checks.shift(mutate(psSrc,
    "$SHIFT_TABLES = @('section_code','status_code','customer','project')",
    "$SHIFT_TABLES = @('section_code','status_code','customer','project','app_user')")), /4표/);
  assert.throws(() => checks.schemaSubst(mutate(psSrc,
    '  ApplySqlFile $companyGrantsFile $TargetDb ',
    '  $companyGrantsSql = SubstSchema $companyGrantsText "05"\n  ApplySqlFile $companyGrantsFile $TargetDb ')), /05-grants/);
  assert.throws(() => checks.targetGuard(mutate(psSrc,
    '  $script:preflight = $false\n',
    '  $script:preflight = $false\n  Q ("DROP DATABASE " + (BQ $TargetDb) + ";") "x" | Out-Null\n')), /DROP DATABASE/);
  assert.throws(() => checks.versionFromFile(mutate(psSrc,
    '$expVersion = $verMatch.Groups[1].Value',
    "$expVersion = '12'")), /'12'/);
});

test('setup-taskcalendar ⑩ 변이: 02-seed-org.sql 과 03-seed-users.sql 적용 순서를 바꾸면 ⑫ · ③ 이 잡는다', () => {
  const lines = psSrc.split('\n');
  const o = lines.findIndex((l) => /ApplySqlFile \$seedOrgFile\b/.test(l));
  const u = lines.findIndex((l) => /ApplySqlFile \$seedUsersFile\b/.test(l));
  assert.ok(o >= 0 && u >= 0 && o < u, '변이 준비 실패: 두 시드 적용 줄을 찾지 못했다');
  [lines[o], lines[u]] = [lines[u], lines[o]];
  const m = lines.join('\n');
  assert.notStrictEqual(m, psSrc);
  assert.throws(() => checks.seedUsers(m), /회사 시드 순서가 틀렸다/);
  assert.throws(() => checks.order(m), /단계 순서가 틀렸다/);
});

test('setup-taskcalendar ⑩ 변이: 원본에서 app_user 를 복사하면(복사 목록에 넣거나 INSERT … SELECT FROM 원본) ⑫ · ④ 가 잡는다', () => {
  const inList = mutate(psSrc,
    "$COPY_ORDER   = @('section_code','status_code','customer','project')",
    "$COPY_ORDER   = @('section_code','status_code','customer','app_user','project')");
  assert.throws(() => checks.seedUsers(inList), /복사 목록\(\$COPY_ORDER\)에 사용자 표/);
  assert.throws(() => checks.copyOrder(inList), /과제 트랙 4표/);
  assert.throws(() => checks.seedUsers(mutate(psSrc,
    "  $copy.Add('SET FOREIGN_KEY_CHECKS=1;')\n",
    "  $copy.Add('INSERT INTO ' + (TQ $TargetDb 'app_user') + ' SELECT * FROM ' + (TQ $SourceDb 'app_user') + ';')\n  $copy.Add('SET FOREIGN_KEY_CHECKS=1;')\n")),
    /INSERT … SELECT/);
});

test('setup-taskcalendar ⑩ 변이: 명부 대조가 다르면 멈추게 하거나 죽는 QRows 로 바꾸면 ⑫ 가 잡는다', () => {
  assert.throws(() => checks.seedUsers(mutate(psSrc,
    '        if($xSrcOnly -gt 0){  Warn ',
    '        if($xSrcOnly -gt 0){ Die "명부가 다릅니다" }\n        if($xSrcOnly -gt 0){  Warn ')), /Die 가 있다/);
  assert.throws(() => checks.seedUsers(mutate(psSrc,
    '    $rSrc  = QRowsTry (', '    $rSrc  = QRows (')), /Q\/QRows/);
});

test('setup-taskcalendar ⑩ 변이: init-command 를 [client] 로 옮기거나 [mysql] 그룹을 지우면 ⑬ 이 잡는다', () => {
  const INIT = "init-command=\"\"SET time_zone='+00:00'\"\"`r`n";
  let m = mutate(psSrc, '"[mysql]`r`n' + INIT + '"', '"[mysql]`r`n"');
  m = mutate(m, '"[client]`r`nuser=$DbUser', '"[client]`r`n' + INIT + 'user=$DbUser');
  assert.throws(() => checks.cnfUtc(m), /\[mysql\] 그룹 밖/);
  assert.throws(() => checks.cnfUtc(mutate(psSrc, '"[mysql]`r`n' + INIT + '"', '""')), /\[client\] → \[mysql\]/);
});

test("setup-taskcalendar ⑩ 변이: contract_name/common_name 의 IFNULL 을 빼면 ⑭ 가 잡는다", () => {
  assert.throws(() => checks.nullToEmpty(mutate(psSrc,
    "        $sel += ('IFNULL(' + (BQ $c) + \", '')\")\n", '        $sel += (BQ $c)\n')), /IFNULL/);
});

test('setup-taskcalendar ⑩ 변이: sort_order 백필을 지우거나 조건을 끄거나 updated_at 대입을 빼면 ⑯ 이 잡는다', () => {
  assert.throws(() => checks.sortBackfill(mutate(psSrc,
    '    $sortFilled = [long](Q $sortSql "app_user.sort_order 백필")\n', '')), /실행하는 자리가 없다/);
  assert.throws(() => checks.sortBackfill(mutate(psSrc,
    '  if($sortNullBefore -gt 0){\n', '  if($false){\n')), /백필 가지를 찾지 못했다/);
  assert.throws(() => checks.sortBackfill(mutate(psSrc,
    'SET u.sort_order = r.n, u.updated_at = u.updated_at;', 'SET u.sort_order = r.n;')), /updated_at/);
});

test('setup-taskcalendar ⑩ 변이: 리다이렉트 검사를 빼거나 .cmd 의 set 줄을 지우면 ⑮ 가 잡는다', () => {
  assert.throws(() => checks.pauseRule(mutate(psSrc,
    '  if([Console]::IsInputRedirected){ $pause = $false }\n  elseif(', '  if('), cmdSrc), /멈춤 규칙/);
  assert.throws(() => checks.pauseRule(psSrc, cmdSrc.replace('set "TC_SETUP_LAUNCHER=cmd"\n', '')), /TC_SETUP_LAUNCHER=cmd/);
});
