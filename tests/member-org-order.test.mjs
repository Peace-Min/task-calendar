import { test, assert, loadAppSource, extractFunction, importOptional, skip, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();
const jsdom = await importOptional('jsdom');
const functions = ['mbCmp', 'mbChildMap', 'uaVisible', 'uaRenderTree', 'uaApply', 'uaRender', 'uaRowActions',
  'uaEmptyText', 'uaMove', 'uaSyncControls', 'lockLineBtn', 'uaListTop', 'uaAdminBar', 'uaOrderToggle',
  'uaOrderReset', 'uaFlushPending', 'uaOrderSave', 'uaApplyData'];
const units = [{ name: '개발부', parent: null }, { name: '가팀', parent: '개발부' },
  { name: '나팀', parent: '개발부' }, { name: '빈팀', parent: null }];
const rows = [1, 2, 3, 4, 5].map(id => ({ userId: id, loginId: 'zz' + id, name: '가상' + id,
  orgUnit: id === 5 ? '' : id % 2 ? '가팀' : '나팀', isActive: true }));
function boot(source = src) {
  const start = source.indexOf('<div class="overlay hidden" id="userAdminModal">');
  const end = source.indexOf('<!-- ===== 직원 등록', start);
  const dom = new jsdom.JSDOM(source.slice(start, end), { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(`var currentUser = null;
    var __uaAdmin=true, __uaMembers=[], __uaUnits=[], __uaTitles=[], __uaInactive=false,
    __uaOrder=false, __uaOrderBackup=null, __uaSaving=false, __uaPendingData=null;
    function toast(){} function userEdOpen(id){window.edited=id} function uaReload(){};
    async function uaSend(payload){window.sent=payload;return {ok:true}};
    ${functions.map(n => (n === 'uaOrderSave' ? 'async ' : '') + extractFunction(source, n)).join('\n')}`);
  w.eval(`uaApplyData(${JSON.stringify({ admin: true, members: rows, units, titles: [] })})`);
  return { dom, w, doc: w.document,
    select(name) { const b = [...w.document.querySelectorAll('#uaTree button')].find(b => b.textContent === name); assert.ok(b); b.click(); },
    ids() { return [...w.document.querySelectorAll('#uaList .mba-line')].map(r => Number(r.dataset.uid)); },
    all() { return Array.from(w.eval('__uaMembers.map(m=>m.userId)')); } };
}
function checkMove(source = src) {
  const b = boot(source);
  try {
    b.select('가팀'); b.w.eval('uaOrderToggle(true); uaMove(1,1)');
    assert.deepStrictEqual(b.ids(), [3, 1]);
    assert.deepStrictEqual(b.all(), [3, 2, 1, 4, 5], '다른 조직의 자리를 유지해야 한다');
  } finally { b.dom.window.close(); }
}
if (!jsdom) skip('소속별 구성원 편집 DOM', SKIP_NO_JSDOM);
else {
  test('구성원 조직: 전체, 하위 포함, 소속 없음, 빈 조직과 검색', () => {
    const b = boot();
    try {
      assert.deepStrictEqual(b.ids(), [1, 2, 3, 4, 5]);
      b.select('개발부'); assert.deepStrictEqual(b.ids(), [1, 2, 3, 4]);
      b.select('가팀'); assert.deepStrictEqual(b.ids(), [1, 3]);
      b.doc.getElementById('uaSearch').value = '가상3'; b.w.eval('uaApply()');
      assert.deepStrictEqual(b.ids(), [3]);
      b.doc.querySelector('[data-uop="edit"]').click(); assert.strictEqual(b.w.edited, 3);
      b.select('소속 없음'); assert.deepStrictEqual(b.ids(), [5]);
      b.select('빈팀'); assert.deepStrictEqual(b.ids(), []);
      assert.ok(!b.doc.getElementById('uaEmpty').classList.contains('hidden'));
    } finally { b.dom.window.close(); }
  });
  test('구성원 조직: 표시된 이웃만 이동하고 다른 조직 자리는 보존', () => checkMove());
  test('변이: 전체 배열의 이웃을 이동하면 소속별 순서 시험이 실패', () => {
    const bad = src.replace('const rows = uaVisible();\n  const at =', 'const rows = __uaMembers;\n  const at =');
    assert.notStrictEqual(bad, src); assert.throws(() => checkMove(bad));
  });
  test('구성원 조직: 편집 잠금과 취소 복원', () => {
    const b = boot();
    try {
      b.select('가팀'); b.w.eval('uaOrderToggle(true); uaMove(1,1)');
      assert.ok([...b.doc.querySelectorAll('#uaTree button')].every(b => b.disabled));
      assert.ok(b.doc.getElementById('uaSearch').disabled);
      b.w.eval('uaOrderToggle(false)');
      assert.deepStrictEqual(b.all(), [1, 2, 3, 4, 5]);
      assert.deepStrictEqual(b.ids(), [1, 3]);
      b.w.eval('__uaSaving=true; uaSyncControls(); uaMove(1,1)');
      assert.deepStrictEqual(b.all(), [1, 2, 3, 4, 5]);
      assert.ok([...b.doc.querySelectorAll('#uaTree button')].every(b => b.disabled));
    } finally { b.dom.window.close(); }
  });
  test('구성원 조직: 저장은 전체 명부를 보내고 필터를 유지', async () => {
    const b = boot();
    try {
      b.select('가팀'); b.w.eval('uaOrderToggle(true); uaMove(1,1)');
      await b.w.eval('uaOrderSave()');
      assert.deepStrictEqual(Array.from(b.w.sent.userIds), [3, 2, 1, 4, 5]);
      assert.deepStrictEqual(b.ids(), [3, 1]);
      assert.ok([...b.doc.querySelectorAll('#uaTree button')].every(b => !b.disabled));
      b.select('전체'); assert.deepStrictEqual(b.ids(), [3, 2, 1, 4, 5]);
    } finally { b.dom.window.close(); }
  });
  test('구성원 조직: 조직 삭제와 권한 회수 시 전체 복귀 및 버튼 제거', () => {
    const b = boot();
    try {
      b.select('가팀'); b.w.eval('__uaUnits=[]; uaApply()');
      assert.deepStrictEqual(b.ids(), [1, 2, 3, 4, 5]);
      b.w.eval('uaApplyData({admin:false,members:[],units:[],titles:[]})');
      assert.strictEqual(b.doc.querySelectorAll('#uaTree button').length, 0);
      assert.strictEqual(b.doc.querySelectorAll('#uaList [data-uop]').length, 0);
    } finally { b.dom.window.close(); }
  });
  test('구성원 조직: 조직명은 텍스트, 순환도 중복 없이 종료', () => {
    const b = boot();
    try {
      b.w.eval(`__uaUnits=[{name:'<img src=x>',parent:'고리'},{name:'고리',parent:'<img src=x>'}]; uaApply()`);
      assert.strictEqual(b.doc.querySelector('#uaTree img'), null);
      assert.strictEqual(b.doc.querySelectorAll('#uaTree button').length, 4);
    } finally { b.dom.window.close(); }
  });
}
