// netcus 보고 채우기 북마클릿 빌드 스크립트 — 의존성 0(Node 내장만).
// 실행: node tools/netcus-fill/build-bookmarklet.mjs
//
// 하는 일:
//  1) bookmarklet-src.js를 읽어 주석 제거 + 공백 압축(문자열 리터럴 파손 없이).
//  2) `javascript:` + encodeURIComponent(code) 로 URL 생성.
//     ⚠ encodeURIComponent는 ' ( ) 를 인코딩하지 않으므로 추가 치환('→%27, (→%28, )→%29)
//        해서 URL이 앱 HTML의 JS 문자열 리터럴(작은따옴표) 안 href="..."에 안전히 들어가게 한다.
//  3) tools/netcus-fill/bookmarklet.txt 에 URL 전문 기록.
//  4) task-calendar-prototype.html 의 (id="tcBookmarklet" href=")[^"]*(") href를 URL로 교체(멱등).
//  5) 앱 JS 구문 검증(선택 가산점) — <script> 블록을 모아 node --check.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const srcPath = join(here, 'bookmarklet-src.js');
const outTxtPath = join(here, 'bookmarklet.txt');
const appHtmlPath = join(repoRoot, 'task-calendar-prototype.html');

// ── 1) 소스 읽기 + 주석 제거 + 공백 압축 ─────────────────────────────
// 문자열/템플릿 리터럴 내부는 절대 건드리지 않는다(리터럴을 통째로 보존).
// 라인 주석(//)·블록 주석(/* */)만 제거하고, 리터럴 밖의 연속 공백/개행을 스페이스 1개로.
function minify(source) {
  let out = '';
  let i = 0;
  const len = source.length;
  while (i < len) {
    const c = source[i];
    // 문자열/템플릿 리터럴 — 통째로 복사(내부 주석/공백 보존).
    if (c === "'" || c === '"' || c === '`') {
      const end = skipString(source, i);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    // 라인 주석 — 제거(개행은 남겨 압축 단계에서 처리).
    if (c === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i);
      continue;
    }
    // 블록 주석 — 제거.
    if (c === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i);
      out += ' '; // 토큰 경계 보존.
      continue;
    }
    out += c;
    i++;
  }
  // 리터럴 밖 공백 압축: 개행/탭/연속 스페이스 → 스페이스 1개.
  // (리터럴은 위에서 이미 원문 그대로 out에 들어갔지만, 이 단계는 리터럴도 스캔하므로
  //  다시 리터럴을 인지하며 압축한다.)
  return collapseWhitespace(out).trim();
}

// 리터럴을 인지하며 리터럴 밖의 연속 공백류를 스페이스 1개로 줄인다.
function collapseWhitespace(source) {
  let out = '';
  let i = 0;
  const len = source.length;
  while (i < len) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = skipString(source, i);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      // 연속 공백류를 스페이스 1개로.
      let j = i;
      while (j < len && /\s/.test(source[j])) j++;
      out += ' ';
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function skipString(src, i) {
  const quote = src[i];
  let k = i + 1;
  const len = src.length;
  while (k < len) {
    const c = src[k];
    if (c === '\\') { k += 2; continue; }
    if (c === quote) return k + 1;
    k++;
  }
  return len;
}

function skipLineComment(src, i) {
  let k = i + 2;
  const len = src.length;
  while (k < len && src[k] !== '\n') k++;
  return k;
}

function skipBlockComment(src, i) {
  let k = i + 2;
  const len = src.length;
  while (k < len) {
    if (src[k] === '*' && src[k + 1] === '/') return k + 2;
    k++;
  }
  return len;
}

// ── 실행 ─────────────────────────────────────────────────────────────
const source = readFileSync(srcPath, 'utf8');
const code = minify(source);

// 압축 결과 자체 구문 검증(빌드 산출 신뢰성).
checkSyntax(code, 'minified-bookmarklet');

// javascript: URL 생성 + 따옴표/괄호 추가 치환.
let url = 'javascript:' + encodeURIComponent(code);
url = url
  .replace(/'/g, '%27')
  .replace(/\(/g, '%28')
  .replace(/\)/g, '%29');

// 안전 점검: URL에 따옴표·괄호가 남으면 앱 JS 문자열 리터럴을 깨뜨린다.
if (/['"()]/.test(url)) {
  console.error('빌드 실패: javascript: URL에 따옴표/괄호가 남아 있습니다. 치환 로직을 확인하세요.');
  process.exit(1);
}

// 3) bookmarklet.txt 기록.
writeFileSync(outTxtPath, url, 'utf8');

// 4) 앱 HTML 앵커 href 교체(멱등).
const html = readFileSync(appHtmlPath, 'utf8');
const anchorRe = /(id="tcBookmarklet" href=")[^"]*(")/g;
const matches = html.match(anchorRe);
if (!matches || matches.length === 0) {
  console.error('빌드 실패: task-calendar-prototype.html 에서 id="tcBookmarklet" 앵커의 href를 찾지 못했습니다.');
  process.exit(1);
}
const newHtml = html.replace(anchorRe, '$1' + url + '$2');
writeFileSync(appHtmlPath, newHtml, 'utf8');

// 5) 앱 JS 구문 검증(가산점) — <script>(src 없는) 블록을 모아 node --check.
const appJsOk = checkAppJs(newHtml);

console.log('빌드 완료.');
console.log('  - 소스: ' + srcPath);
console.log('  - 산출 URL 길이: ' + url.length + ' bytes');
console.log('  - bookmarklet.txt: ' + outTxtPath);
console.log('  - 앱 앵커 href 교체: ' + matches.length + '곳 (멱등)');
console.log('  - 앱 JS 구문 검증: ' + (appJsOk ? 'OK' : '실패'));

// 주어진 JS 문자열을 임시파일로 써서 node --check 실행. 실패 시 예외 throw.
function checkSyntax(js, label) {
  const dir = mkdtempSync(join(tmpdir(), 'tc-bm-'));
  const file = join(dir, 'check.js');
  try {
    // 함수 선언 + IIFE 조합이므로 그대로 파싱 가능.
    writeFileSync(file, js, 'utf8');
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    console.error('구문 검증 실패(' + label + '): ' + (e.stderr ? e.stderr.toString() : e.message));
    process.exit(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 앱 HTML 내 <script>(외부 src 없는) 블록을 모아 하나의 JS로 --check.
function checkAppJs(htmlText) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let joined = '';
  while ((m = re.exec(htmlText)) !== null) {
    joined += '\n;{' + m[1] + '\n}\n';
  }
  const dir = mkdtempSync(join(tmpdir(), 'tc-appjs-'));
  const file = join(dir, 'appjs.js');
  try {
    writeFileSync(file, joined, 'utf8');
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.error('앱 JS 구문 검증 실패: ' + (e.stderr ? e.stderr.toString() : e.message));
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
