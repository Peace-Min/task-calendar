// Layer 1 — 새 주 DB 원큐 구축 스크립트(db/deploy/setup-taskcalendar.ps1 / .cmd)의 **계약**을
// 소스 텍스트만으로 검사한다. MySQL 을 돌리지 않는다(리허설은 사람이 실제 서버에서 한다).
//
// 왜 있나
//   이 스크립트는 운영 서버에서 한 번 도는 '이관' 이다. 한 번만 도는 코드는 고칠 기회도 한 번이라,
//   다음 사람이 손대다 순서 하나·가드 하나를 떨어뜨려도 그걸 알려 줄 실행이 없다. 그래서
//   '무엇이 반드시 이 순서로, 이 조건으로 일어나야 하는가' 를 여기서 못 박는다:
//     ① .cmd 는 ASCII 만 · ps1 을 -ExecutionPolicy Bypass 로 · 인자를 %* 로 넘긴다
//     ② 비밀번호가 명령줄에 실리지 않는다(.cnf 로만) · .cnf 는 finally 에서 지워진다
//     ③ 단계 순서: 백업 → CREATE DATABASE → 과제 DDL → 사용자 DDL → 캘린더 DDL → 복사 → 권한
//     ④ 복사 순서 7표(FK 부모 → 자식)
//     ⑤ KST→UTC 이동은 과제 트랙 4표의 created_at/updated_at 에만 · -NoShift 로 끈다
//     ⑥ FK 검사를 끄고 넣은 뒤 다시 켠다 · 고아 행 검사 6관계
//     ⑦ 스키마 치환은 낱말 경계 `\btaskmgr\.` · 두 파일에만 · 05-grants.sql 은 대상 DB 선택 후 원본 그대로
//     ⑧ 대상 DB 가 있으면 -Force 없이는 멈춘다 · DROP DATABASE 는 -Force 가지 안에만
//     ⑨ 기대 schema_version 은 schema-calendar.sql 에서 읽는다(숫자를 박지 않는다)
//     ⑩ 변이 주입 — 위 검사가 실제로 잡는지 증명
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
      ['CREATE DATABASE', /"CREATE DATABASE "/],
      ['schema-structure.sql 적용', /ApplySqlFile\s+\$structFile\b/],
      ['01-schema-users.sql 적용', /ApplySqlFile\s+\$usersFile\b/],
      ['schema-calendar.sql 적용', /ApplySqlFile\s+\$calFile\b/],
      ['INSERT 복사 적용', /ApplySqlFile\s+\$copyFile\b/],
      ['권한 적용(create-app-user)', /ApplySqlFile\s+\$appUserTmp\b/],
    ];
    const at = steps.map(([label, re]) => [label, onlyOnce(code, re, label)]);
    for (let i = 1; i < at.length; i++) {
      assert.ok(at[i - 1][1] < at[i][1],
        `단계 순서가 틀렸다: '${at[i - 1][0]}' 가 '${at[i][0]}' 보다 뒤에 있다. ` +
        '백업 → 구조(과제 → 사용자 → 캘린더) → 복사 → 권한 순서여야 한다. 특히 사용자 DDL 이 캘린더보다 ' +
        '늦으면 schema-calendar.sql 머리의 가드(app_user.user_id 필요)가 구축을 막는다');
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
      ['section_code', 'status_code', 'customer', 'title_code', 'org_unit', 'app_user', 'project'],
      '복사 순서(FK 부모 → 자식)가 바뀌었다');
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
      'KST→UTC 이동 대상 표는 과제 트랙 4표뿐이어야 한다(사용자 3표는 이미 UTC 사본과 같다)');
    assert.deepStrictEqual(listLiteral(code, 'SHIFT_COLS').sort(), ['created_at', 'updated_at'],
      'KST→UTC 이동 대상 컬럼은 created_at/updated_at 뿐이어야 한다');
    assert.ok(/'DATE_SUB\(' \+ \(BQ \$c\) \+ ', INTERVAL 9 HOUR\)'/.test(code),
      'DATE_SUB(<col>, INTERVAL 9 HOUR) 이동식이 사라졌거나 바뀌었다');
    assert.ok(/if\(\$doShift -and \(\$SHIFT_TABLES -contains \$t\) -and \(\$SHIFT_COLS -contains \$c\)\)/.test(code),
      '이동 조건이 ($doShift · $SHIFT_TABLES · $SHIFT_COLS) 셋을 모두 보지 않는다 — 엉뚱한 표/컬럼이 밀린다');
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
    for (const d of drops) {
      assert.ok(blocks.some(([o, c]) => c > 0 && d > o && d < c),
        'DROP DATABASE 가 if($Force){ } 가지 밖에 있다 — -Force 없이도 기존 대상 DB 가 지워질 수 있다');
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
test('setup-taskcalendar ③ 단계 순서: 백업 → CREATE DATABASE → 과제 → 사용자 → 캘린더 DDL → 복사 → 권한', () => checks.order(psSrc));
test('setup-taskcalendar ④ 복사 순서 7표(FK 부모 → 자식) · 교집합 컬럼', () => checks.copyOrder(psSrc));
test('setup-taskcalendar ⑤ KST→UTC(-9h)는 과제 트랙 4표의 created_at/updated_at 에만 · -NoShift', () => checks.shift(psSrc));
test('setup-taskcalendar ⑥ FK 검사 끄고 넣고 다시 켬 · 고아 행 6관계', () => checks.fkAndOrphans(psSrc));
test('setup-taskcalendar ⑦ 스키마 치환 \\btaskmgr\\. — 두 파일만 · 05-grants 는 대상 DB 선택', () => checks.schemaSubst(psSrc));
test('setup-taskcalendar ⑧ 대상 DB 가 있으면 -Force 없이는 멈춤 · DROP DATABASE 는 -Force 가지 안', () => checks.targetGuard(psSrc));
test('setup-taskcalendar ⑨ 기대 schema_version 은 schema-calendar.sql 에서 읽는다', () => checks.versionFromFile(psSrc));

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
