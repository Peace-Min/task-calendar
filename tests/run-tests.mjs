// 테스트 러너 — tests/ 안의 *.test.mjs를 전부 동적 import한 뒤 run() 한 번 호출.
// 실행: node tests/run-tests.mjs  (프로젝트 루트 기준)
// 의존성 0 — Node 내장 모듈만.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { run, test, queuedCount, filesWithNoTests, SKIP_NO_JSDOM } from './harness.mjs';

// 수집돼야 할 시험 파일 수의 **하한**. 파일이 통째로 사라지면(개명·삭제) 여기서 걸린다.
//  · 하한이라 파일을 '추가' 할 때는 손댈 필요가 없다(마찰 없음).
//  · 파일을 의도적으로 지웠다면 이 수를 함께 낮출 것 — 그 한 줄이 '의도였다' 는 기록이 된다.
const MIN_TEST_FILES = 25;

const here = dirname(fileURLToPath(import.meta.url));

// *.test.mjs 수집(이름순 — 결과 순서 안정화). import 순서는 등록 큐에 무관.
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

if (files.length === 0) {
  console.log('실행할 테스트 파일(*.test.mjs)이 없습니다.');
  process.exit(0);
}

console.log(`테스트 파일 ${files.length}개 로드:`);
const counts = {};   // 파일 → 그 파일이 큐에 넣은 건수(인구조사)
for (const f of files) {
  const before = queuedCount();
  // 동적 import — 각 파일이 test(...)로 공용 큐에 등록.
  await import(pathToFileURL(join(here, f)).href);
  counts[f] = queuedCount() - before;
  console.log(`  - ${f} (${counts[f]}건)`);
}

// ── 인구조사 계약 — 큐에 함께 실어 결과에 보이게 한다 ──────────────────
//  console.warn 이 아니라 test 로 넣는 이유: 경고는 아무도 안 읽고 종료코드도 안 바꾼다.
//  게이트가 막아야 할 일이면 게이트의 언어(실패)로 말해야 한다.
test(`러너①: 시험 파일이 ${MIN_TEST_FILES}개 이상 수집됐다(파일 소실 감시)`, () => {
  if (files.length < MIN_TEST_FILES) {
    throw new Error(
      `시험 파일을 ${files.length}개만 수집했다(하한 ${MIN_TEST_FILES}). 파일이 개명·삭제되면 ` +
      `러너는 그것을 수집조차 하지 않으므로 skip 도 남지 않고 조용히 pass 만 줄어든다. ` +
      `의도한 삭제라면 run-tests.mjs 의 MIN_TEST_FILES 를 함께 낮출 것. 수집된 파일: ` +
      files.join(', '));
  }
});

test('러너②: 0건을 등록한 시험 파일이 없다(파일이 조용히 꺼짐 감시)', () => {
  const dark = filesWithNoTests(counts);
  if (dark.length) {
    throw new Error(
      `시험을 하나도 등록하지 않은 파일이 있다: ${dark.join(', ')} — ` +
      `계약이 조건 밖으로 밀려났거나 이른 return 이 생겼다. 0건은 통과가 아니라 판정 없음이다.`);
  }
});

console.log('');
const res = await run();

// ── jsdom 부재 힌트 ─────────────────────────────────────────────────
// Layer 2(app-context·db-conn-info·user-info·user-login)는 jsdom이 있어야 돈다.
// 없으면 그 파일들이 skip으로 넘어가고 러너는 exit 2(판정 없음)로 끝난다 — 초록이 아니다.
if (res.skipReasons && res.skipReasons.has(SKIP_NO_JSDOM)) {
  console.log('');
  console.log('  ── jsdom이 없다 — Layer 2를 판정하지 못했다 ─────────────────────────');
  console.log('    · 개발 PC:  cd tests && npm ci   (tests/package.json의 devDependency)');
  console.log('    · 폐쇄망:   같은 Node 버전 PC에서 만든 tests/node_modules 를 통째로 반입');
  console.log('    · 이 워크트리의 tests/node_modules 는 심링크다 →');
  console.log('      C:\\Users\\CEO\\Desktop\\console\\task-calendar\\tests\\node_modules (main 워크트리와 공유).');
  console.log('      새 클론·반입 PC에는 그 실물이 없으므로 여기서는 항상 이 상태가 된다.');
  console.log('    · 게이트에서 이 상태를 실패로 만들려면: TC_TEST_STRICT=1');
}

// 종료코드는 run()이 설정한다 — fail>0 → 1 · skip>0 → 2(판정 없음) · 그 외 0.
