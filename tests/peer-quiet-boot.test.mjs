// 열람 창 부팅이 「읽기 전용」 토스트를 내지 않는다(PEER-VIEW-FULL QA 2026-10-01 실측 결함)
import { test, assert, loadAppSource } from './harness.mjs';
const app = loadAppSource();
function hpostSrc(src) {
  const i = src.indexOf('function hpost(o){'); assert.ok(i > 0, 'hpost 가 없다');
  return src.slice(i, src.indexOf('\n}\n', i) + 2);
}
function check(src) {
  const body = hpostSrc(src);
  assert.ok(/const PEER_SILENT_CMD = new Set\(\[/.test(src), 'PEER_SILENT_CMD(자동 전송 목록)가 없다');
  assert.ok(/if\(!PEER_SILENT_CMD\.has\(cmd\)\)\{[\s\S]*?toast\(/.test(body), '열람 창 안내 토스트가 자동 전송 목록 조건 안에 있지 않다 — 부팅 자동 전송에도 토스트가 뜬다');
  assert.ok(/if\(PEER\)\{[\s\S]*?return;\s*\}/.test(body), '열람 창 봉인(return)이 사라졌다 — 열람 창의 전송이 호스트로 간다');
}
function run(src, cmd) {
  const m = src.match(/const PEER_SILENT_CMD = new Set\((\[[^\]]*\])\);/); assert.ok(m, 'PEER_SILENT_CMD 목록을 못 찾았다');
  return !new Set(eval(m[1])).has(cmd);   // true = 안내한다
}
test('열람 창 hpost: 토스트는 쓰기 요청일 때만 · 봉인은 그대로', () => check(app));
test('열람 창 hpost: 자동 전송(ready·reminderSync·unsavedState·loadProjects·loadCodes)은 조용하다', () => {
  for (const c of ['ready', 'reminderSync', 'unsavedState', 'loadProjects', 'loadCodes', 'loadCustomers', 'reloadState', 'updateCheck', 'dbInfoGet', 'focus']) assert.strictEqual(run(app, c), false, c + ' 가 쓰기로 잡힌다 → 부팅 토스트');
});
test('열람 창 hpost: 쓰기 요청(saveState·replaceAllState·deleteX·addX·importX)은 안내한다', () => {
  for (const c of ['saveState', 'replaceAllState', 'setProjectActive', 'netcusSubmit', 'netcusWeekSubmit', 'updateApply', 'updateSetSource', 'openFolder', 'brandNewWriteCmd']) assert.strictEqual(run(app, c), true, c + ' 가 쓰기로 안 잡힌다');
});
test('변이: 토스트를 조건 밖으로 되돌리면(모든 전송에 안내) 잡는다', () => {
  const bad = app.replace("if(!PEER_SILENT_CMD.has(cmd)){", "if(true){");
  assert.notStrictEqual(bad, app); assert.throws(() => check(bad), /자동 전송 목록 조건/);
});
