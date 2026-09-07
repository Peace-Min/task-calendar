// db/deploy 의 PowerShell 배포 스크립트를 **소스 텍스트만으로** 검사하는 공용 기계.
// DB 도 jsdom 도 필요 없다(파일을 읽어 파싱할 뿐).
//
// 왜 별도 파일인가
//   restore-guards.test.mjs 가 이 저장소의 첫 배포 스크립트 계약이었고, backup-guards.test.mjs
//   가 같은 기계를 그대로 쓴다. 두 시험 파일이 서로를 import 하면 러너(run-tests.mjs)의
//   '파일별 등록 건수' 인구조사가 무너진다 — ES 모듈은 한 번만 평가되므로 먼저 import 한
//   파일이 상대의 test() 등록까지 삼키고, 뒤에 오는 파일은 0건이 되어 러너② 가 실패한다.
//   그래서 공용 부분만 *.test.mjs 가 아닌 이 파일로 뺀다(러너는 *.test.mjs 만 수집한다).
//
// ★ 파일 이름을 ps-guard-lib.mjs 로 둔 이유도 같다. `.test.mjs` 로 끝나면 러너가 수집하고,
//   시험을 0건 등록한 파일로 잡혀 러너② 가 실패한다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const DEPLOY = new URL('../db/deploy/', import.meta.url);

// BOM 을 떼고 줄바꿈을 LF 로 통일한다(.ps1 은 LF, .cmd 는 CRLF 라 변이 앵커가 어긋난다).
export function loadDeploy(name) {
  return readFileSync(new URL(name, DEPLOY), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

// ══ PowerShell 잡음 마스킹 ═════════════════════════════════════════════
// '코드에 -p<비번> 이 없다' 는 계약은 **주석**을 지우지 않으면 성립하지 않는다:
// backup/restore 두 스크립트의 머리말이 바로 그 위험을 설명하느라 `-p<pw>` 같은 문자열을
// 담고 있어서, 마스킹이 없으면 검사가 자기 설명문에 걸려 늘 빨간불이 된다. 그러면 사람이
// 검사를 느슨하게 고친다 — 그게 진짜 사고다. 그래서 주석을 지운다.
//
// schema-guards.test.mjs 의 maskSql 과 같은 발상, 다른 문법:
//   PowerShell = `<# #>` 블록 주석 · `#` 줄 주석 · '단일따옴표(''로 이스케이프)' ·
//                "이중따옴표(백틱으로 이스케이프)"
// 반환 문자열은 **길이가 원문과 같다**(인덱스가 그대로 통한다).
//
// ★ 문자열 '내용'은 지우지 않는다 — 지우면 비번 계약이 무력해진다.
//   PowerShell 에서 명령 인자는 대부분 문자열 리터럴이라("-p$pw"), 내용을 지우면 정확히
//   잡아야 할 것만 안 보이게 된다. 그래서 문자열은 **건너뛰되 내용은 남긴다**(따옴표 안의
//   `#` 이 가짜 주석을 만들지 못하게 추적만 한다). 대신 주석은 통째로 지운다.
export function maskPs(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    // <# ... #> 블록 주석 (중첩 가능 — PowerShell 이 실제로 중첩을 허용한다)
    if (c === '<' && src[i + 1] === '#') {
      let depth = 1;
      let k = i + 2;
      while (k < len && depth > 0) {
        if (src[k] === '<' && src[k + 1] === '#') { depth++; k += 2; continue; }
        if (src[k] === '#' && src[k + 1] === '>') { depth--; k += 2; continue; }
        k++;
      }
      blank(i, k); i = k; continue;
    }
    // # 줄 주석
    if (c === '#') {
      let k = i; while (k < len && src[k] !== '\n') k++;
      blank(i, k); i = k; continue;
    }
    // '단일따옴표' — '' 가 이스케이프. 백틱은 이스케이프가 아니다.
    if (c === "'") {
      let k = i + 1;
      while (k < len) {
        if (src[k] === "'" && src[k + 1] === "'") { k += 2; continue; }
        if (src[k] === "'") { k++; break; }
        k++;
      }
      i = k; continue;   // 내용은 남긴다(위 ★)
    }
    // "이중따옴표" — 백틱이 이스케이프, "" 도 이스케이프
    if (c === '"') {
      let k = i + 1;
      while (k < len) {
        if (src[k] === '`') { k += 2; continue; }
        if (src[k] === '"' && src[k + 1] === '"') { k += 2; continue; }
        if (src[k] === '"') { k++; break; }
        k++;
      }
      i = k; continue;   // 내용은 남긴다(위 ★)
    }
    i++;
  }
  return out.join('');
}

// ── 비밀번호를 명령줄에 싣는 자리 찾기 ────────────────────────────────
// Windows 는 같은 사용자 권한이면 다른 프로세스의 명령줄을 그대로 읽는다
// (두 스크립트 머리말의 실측). 그래서 mysql/mysqldump 에 -p<값> · --password=<값> 을
// 붙이는 자리가 한 군데도 없어야 한다. 주석은 세지 않는다(마스킹), 문자열은 센다(위 ★).
export function passwordOnCommandLineHits(psSrc) {
  const code = maskPs(psSrc);
  const bad = [];
  for (const m of code.matchAll(/-p(?=[^\s\r\n])[^\s"']*/g)) bad.push(m[0]);
  for (const m of code.matchAll(/--password\s*=/g)) bad.push(m[0]);
  return bad;
}

// ── 종료코드 표 뽑기 ──────────────────────────────────────────────────
// .ps1 과 .cmd 에 같은 ASCII 블록이 들어 있다. .cmd 는 비ASCII 를 넣을 수 없으므로
// (cmd.exe 가 바이트 오프셋으로 배치를 재개한다 — 두 .cmd 파일 머리말 참조) 한글 표를
// 그대로 복사할 수 없다. 그래서 '기계가 대조할 사본' 을 ASCII 로 따로 두고 그것을 맞춘다.
export const EXIT_BEGIN = '--- EXITCODES';
export const EXIT_END = '--- END EXITCODES ---';

export function exitCodeTable(src, isCmd) {
  const lines = src.split(/\r?\n/).map((l) => (isCmd ? l.replace(/^\s*rem\b\s?/i, '') : l).trim());
  const a = lines.findIndex((l) => l.startsWith(EXIT_BEGIN));
  const b = lines.findIndex((l) => l === EXIT_END);
  assert.ok(a >= 0, `종료코드 블록의 시작('${EXIT_BEGIN}')을 못 찾았다`);
  assert.ok(b > a, `종료코드 블록의 끝('${EXIT_END}')을 못 찾았다`);
  return lines.slice(a, b + 1);
}

// 표 안쪽 줄(머리·꼬리 제외)에서 코드 숫자만 뽑는다. 오름차순·중복 없음을 함께 요구한다.
export function exitCodesInTable(table) {
  const inner = table.slice(1, -1);
  const nums = inner.map((l) => {
    const m = /^(\d+)\s/.exec(l);
    assert.ok(m, `종료코드 표의 줄이 '숫자 공백 설명' 형식이 아니다: [${l}] — ` +
      `한 줄에 코드 하나만 적는다(옛 "0 ok | 1 ..." 형식은 기계 대조를 막았다)`);
    return Number(m[1]);
  });
  return nums;
}

// ── .ps1 이 **실제로 내는** 종료코드 값 모으기 ────────────────────────
// 표만 보면 '표는 맞는데 코드가 딴 값을 낸다' 를 못 잡는다. 그래서 실행체를 직접 센다.
//   · `exit <숫자>`            — 직접 종료
//   · `Die "..." <숫자>`       — 죽는 함수(마지막 인자가 코드다)
//   · `$EXIT_XXX = <숫자>`     — 상수를 쓰는 판(restore-taskmgr.ps1)
// 주석은 마스킹으로 지운다. 문자열 안의 'exit 0' 같은 설명 문구는 줄 끝이 숫자가 아니라
// 걸리지 않는다(예: Write-Host "... 없이 exit 0 으로 끝납니다(...트리거0)." ).
export function exitCodesUsed(psSrc) {
  const code = maskPs(psSrc);
  const found = new Set();
  for (const raw of code.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/\$EXIT_[A-Z_]+\s*=\s*\d+/.test(line)) {
      for (const m of line.matchAll(/\$EXIT_[A-Z_]+\s*=\s*(\d+)/g)) found.add(Number(m[1]));
      continue;
    }
    if (!/\bDie\b/.test(line) && !/\bexit\b/.test(line)) continue;
    const m = /(?:^|[\s(){};])(\d+)\s*\}?\s*$/.exec(line);
    if (m) found.add(Number(m[1]));
  }
  return [...found].sort((x, y) => x - y);
}

// ══ 변이 주입기 ════════════════════════════════════════════════════════
// ★ 접미사 변이(foo → foo_MUTATED)는 부분문자열 검사에 그대로 걸려 거짓 초록이 된다.
//   그래서 의미를 바꾸는 변이만 쓴다(가드를 지우거나, 이름 집합을 개수로 바꾸거나).
// ★ 앵커는 소스에 정확히 1회만 나와야 한다. 못 찾으면 크게 실패한다 — 판정 불가는 통과가 아니다.
export function mutate(base, from, to) {
  const at = base.indexOf(from);
  assert.ok(at >= 0, `변이 준비 실패: 앵커를 못 찾았다 — [${from}]`);
  assert.strictEqual(at, base.lastIndexOf(from),
    `변이 준비 실패: 앵커가 ${base.split(from).length - 1}번 나온다(1번이어야 한다) — [${from}]`);
  const out = base.slice(0, at) + to + base.slice(at + from.length);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다 — [${from}]`);
  return out;
}

// 비ASCII 가 섞인 줄 목록. .cmd 는 한 글자도 있어서는 안 된다
// (cmd.exe 가 코드페이지 65001 에서 배치 재개 위치를 바이트로 잘못 계산해
//  주석 조각을 명령으로 실행한다 — init-calendar.cmd 로 실측).
export function nonAsciiLines(src) {
  const bad = [];
  src.split(/\r?\n/).forEach((l, i) => {
    // eslint-disable-next-line no-control-regex
    if (/[^\x09\x20-\x7e]/.test(l)) bad.push(`${i + 1}: ${l}`);
  });
  return bad;
}
