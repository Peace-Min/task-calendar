// 테스트 러너 — tests/ 안의 *.test.mjs를 전부 동적 import한 뒤 run() 한 번 호출.
// 실행: node tests/run-tests.mjs  (프로젝트 루트 기준)
// 의존성 0 — Node 내장 모듈만.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { run } from './harness.mjs';

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
await run();
// run()이 fail>0이면 process.exitCode=1을 설정 → exit 코드로 전파.
