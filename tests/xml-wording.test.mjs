// XML 문구 — 데이터의 자리는 회사 서버 DB 다(2026-10-06 사용자 요청). XML 은 '저장되는 곳'이 아니라 **내 PC 사본 · 이전 버전 기록**이다.
//
// 지키는 것: 사용자에게 보이는 문장(주석·패치노트 제외)이 XML 을 저장 수단처럼 말하지 않는다 · ⋯ 메뉴 이름이 역할을 말한다(id 그대로) ·
//            저장 실패 문장이 '디스크'를 말하지 않는다 · 도움말·사용설명서·카드가 「서버에 자동 저장」을 말한다.
import { test, assert, loadAppSource } from './harness.mjs';

const app = loadAppSource();
//  보이는 문장만 — HTML 주석 · JS 주석 · 패치노트(#patchModal) 를 걷는다.
const visible = (() => {
  let s = app.replace(/<!--[\s\S]*?-->/g, '');
  const a = s.indexOf('id="patchModal"');
  if (a >= 0) { const b = s.indexOf('<div class="overlay', a + 10); s = s.slice(0, a) + (b > a ? s.slice(b) : ''); }
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
})();

test('XML 문구①: ⋯ 메뉴 이름이 역할(내 PC 사본 · 이전 기록)을 말한다 — id·배선은 그대로', () => {
  assert.ok(app.includes('<button id="btnExport">XML로 내보내기 (내 PC 사본)</button>'), '「XML 내보내기」가 사본임을 말하지 않는다');
  assert.ok(app.includes('<button id="btnImport">XML 가져오기… (이전 기록)</button>'), '「XML 가져오기」가 이전 기록·사본임을 말하지 않는다');
  assert.ok(app.includes("$('#btnExport').addEventListener('click', () => { closeMore(); exportXML(); });"), '내보내기 배선이 바뀌었다');
});
test('XML 문구②: XML 을 저장 수단·백업처럼 말하는 문장이 없다 · 저장 실패가 디스크를 말하지 않는다', () => {
  for (const w of ['백업은 XML 내보내기', '백업·이전은', 'XML 내보내기</b>로 백업', '디스크에 기록하지 못했습니다', '[데이터 → XML 내보내기]로 백업', '데이터 · 백업', '데이터·백업']) {
    assert.ok(!visible.includes(w), `보이는 문장에 「${w}」가 남았다 — 데이터의 자리는 서버다`);
  }
  assert.ok(visible.includes('<div class="help-row">데이터는 서버에 자동 저장됩니다</div>'), '⋯ 메뉴 끝 줄이 「데이터는 서버에 자동 저장됩니다」가 아니다');
  assert.ok(/데이터는 <b>서버에 자동 저장<\/b>됩니다/.test(visible) && /회사 서버에 자동 저장<\/b>됩니다/.test(visible), '도움말·사용설명서가 서버 자동 저장을 말하지 않는다');
  assert.ok(/card\(ICON\.download, '데이터 · 사본', '데이터는 서버에 자동 저장됩니다\./.test(visible), '도움말 카드가 서버 자동 저장을 말하지 않는다');
});
