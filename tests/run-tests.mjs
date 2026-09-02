// 테스트 러너 — tests/ 안의 *.test.mjs를 전부 동적 import한 뒤 run() 한 번 호출.
// 실행: node tests/run-tests.mjs  (프로젝트 루트 기준)
// 의존성 0 — Node 내장 모듈만.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { run, SKIP_NO_JSDOM } from './harness.mjs';

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
for (const f of files) {
  console.log(`  - ${f}`);
  // 동적 import — 각 파일이 test(...)로 공용 큐에 등록.
  await import(pathToFileURL(join(here, f)).href);
}

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
