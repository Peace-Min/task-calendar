// XML 저장 경로 폐기 게이트 (설계 §3.9)
//
// 이 파일이 존재하는 이유:
//   TC_DATA_SOURCE 분기와 data.xml 경로는 **이관 기간에만** 필요한 임시 배선이다.
//   남겨두면 "지금 어느 경로로 도는가"가 영구히 두 배가 되고, 이관 뒤에는 data.xml 이
//   **정의상 낡은 데이터**라 참조 자체가 버그가 된다(사용자 지시 2026-08-31:
//   "이관 후에 data.xml 를 코드상에서 전혀 사용하면 안 됨").
//
//   사람의 기억에 맡기지 않는다. DeployConfig.XmlRetired 한 값이 스위치이고,
//   그걸 true 로 바꾸는 순간 이 파일이 잔재를 전수 검사한다.
//
//   ★ 2026-09-01 — 스위치를 켰다(이관 완료). 이제 폐기② 가 깨어 있고 폐기① 이 잔다.
//     그리고 폐기④ 가 **과잉 삭제**를 막는다 — 내보내기/가져오기까지 지우면 안 된다.
//
//   ★ 반대 방향도 잠근다 — false 인 동안 XML 경로를 부분적으로 걷어내는 것도 막는다.
//     반쯤 지워진 상태가 가장 위험하다(어느 경로로 도는지 아무도 모른다).
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource } from './harness.mjs';

const app = loadAppSource();
const mainwin = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../widget/DeployConfig.cs', import.meta.url), 'utf8');

// 주석을 걷어낸 '실제 코드'만 본다 — 주석에 남은 설명 문구까지 잔재로 세면
//   "왜 지웠는지"를 기록하지 못하게 된다(그 기록이 재론을 막는 장치다).
//  ★ 줄을 \r*\n 으로 자른다 — MainWindow.xaml.cs 는 줄끝이 \r\r\n(CR 중복)이다.
//    \r?\n 으로 자르면 각 줄 끝에 \r 가 남고, JS 정규식의 . 는 \r 를 먹지 않으므로
//    줄 주석 정규식이 거기서 멈춰 **주석이 하나도 안 지워진다.** 그러면 이 게이트는
//    "왜 지웠는지" 를 적은 주석까지 잔재로 세어 영원히 통과하지 못한다.
//    실제로 그렇게 조용히 망가져 있었다(2026-09-01 에 잡았다).
function stripComments(text, kind) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, ' ');          // 블록 주석
  t = t.split(/\r*\n/).map(l => l.replace(/(^|\s)\/\/[^\r\n]*$/, '')).join('\n');  // 줄 주석
  if (kind === 'html') t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  return t;
}

function xmlRetiredFlag(cs) {
  const m = /public const bool XmlRetired\s*=\s*(true|false)\s*;/.exec(cs);
  assert.ok(m, 'DeployConfig.XmlRetired 를 찾지 못했다 — 폐기 게이트의 스위치가 사라졌다');
  return m[1] === 'true';
}

//  XML **저장 경로**의 흔적들. 각 항목은 [정규식, 사람이 읽는 이름, 어느 파일].
//
//  ★★ 2026-09-01 — 이 목록에서 toXML()/fromXML() 을 뺐다. 이유를 남긴다:
//    그 둘은 **저장 경로가 아니라 「XML 내보내기/가져오기」** 다. 사용자가 파일을 고르고
//    누르는 조작이고, 셋 다 지금 실재하는 쓸모가 있다 —
//      · 폐쇄망 서버 백업(backup-taskmgr)이 아직 안 섰다. 지금 내보내기를 없애면
//        사용자 자력 백업 수단이 **0** 이 된다.
//      · 옛 data.xml 을 DB 로 들여오는 **이관 경로**가 가져오기다(자동이관을 폐기했으므로
//        이것이 유일한 문이다). 89명이 각자 이 문으로 들어온다.
//    사용자 지시("이관 후에 data.xml 을 코드상에서 전혀 사용하면 안 됨")가 가리킨 것은
//    **그 파일을 데이터 출처로 읽고 쓰는 경로**이지 XML 이라는 형식이 아니다.
//    그래서 남은 항목은 전부 "그 파일 / 그 갈래" 다.
const TRACES = [
  [/\bdata\.xml\b/,        'data.xml 경로',            'both'],
  [/__applyXml\b/,         '__applyXml 주입 경로',     'both'],
  [/\bisDbMode\s*\(/,      'isDbMode() 분기',          'app'],
  [/TC_DATA_SOURCE/,       'TC_DATA_SOURCE 스위치',    'both'],
];

function scan(re, where) {
  const hits = [];
  if (where !== 'host') { if (re.test(stripComments(app, 'html'))) hits.push('task-calendar-prototype.html'); }
  if (where !== 'app')  { if (re.test(stripComments(mainwin, 'cs'))) hits.push('widget/MainWindow.xaml.cs'); }
  return hits;
}
const target = w => (w === 'app' ? 'app' : w === 'host' ? 'host' : 'both');

const checks = {
  //  이관 완료를 선언했으면 잔재가 하나도 없어야 한다
  noTracesWhenRetired(cs, srcApp, srcHost) {
    if (!xmlRetiredFlag(cs)) return;      // 아직 이관 전 — 이 검사는 자고 있다
    const left = [];
    for (const [re, name, where] of TRACES) {
      const hits = [];
      if (where !== 'host' && re.test(stripComments(srcApp, 'html'))) hits.push('prototype.html');
      if (where !== 'app'  && re.test(stripComments(srcHost, 'cs'))) hits.push('MainWindow.xaml.cs');
      if (hits.length) left.push(`${name}(${hits.join(', ')})`);
    }
    assert.strictEqual(left.length, 0,
      'XmlRetired=true 인데 XML 경로가 남아 있다 — 이관 뒤 data.xml 은 낡은 데이터라 ' +
      '참조 자체가 버그다. 남은 것: ' + left.join(' · '));
  },

  //  이관 전인데 부분적으로 지워지는 것도 막는다(반쯤 지워진 상태가 가장 위험하다)
  pathIntactWhenNotRetired(cs, srcApp, srcHost) {
    if (xmlRetiredFlag(cs)) return;       // 이관 완료 — 위 검사가 대신 본다
    const missing = [];
    for (const [re, name, where] of TRACES) {
      const found = (where !== 'host' && re.test(stripComments(srcApp, 'html')))
                 || (where !== 'app'  && re.test(stripComments(srcHost, 'cs')));
      if (!found) missing.push(name);
    }
    assert.strictEqual(missing.length, 0,
      'XmlRetired=false 인데 XML 경로 일부가 사라졌다 — 반쯤 지워진 상태는 어느 경로로 도는지 ' +
      '알 수 없게 만든다. 지우려면 이관을 끝내고 XmlRetired 를 true 로 바꿀 것. 사라진 것: ' +
      missing.join(' · '));
  },
};

test('폐기①: 이관 전에는 XML 경로가 온전하다(반쯤 지워짐 금지)', () => {
  checks.pathIntactWhenNotRetired(deploy, app, mainwin);
});

test('폐기②: 이관 완료를 선언하면 XML 잔재가 0 이어야 한다', () => {
  checks.noTracesWhenRetired(deploy, app, mainwin);
});

test('폐기③: 스위치가 실재하고 켜져 있다(이관 완료)', () => {
  assert.strictEqual(xmlRetiredFlag(deploy), true,
    'XmlRetired 가 꺼졌다 — 끄면 폐기② 가 자고 폐기① 이 깨어나, **XML 경로가 없다는 이유로** 실패한다. 이관은 2026-09-01 에 끝났다. 되돌리려면 그 경로를 통째로 되살려야 한다');
});

// ── 변이 시험 — 게이트가 정말 발화하는지 ─────────────────────────────
test('변이⑮: 폐기 뒤에 XML 경로가 되살아나면 폐기② 가 실패한다', () => {
  //  잔재를 하나 심는다 — 되살리는 방향의 변이다(예전에는 반대 방향이었다: 스위치만 켜 보는 것).
  const bad = app + '\nwindow.__applyXml = function(t){ };\n';
  assert.throws(() => checks.noTracesWhenRetired(deploy, bad, mainwin),
    /XML 경로가 남아 있다/);
});

test('변이⑮b: 호스트에 data.xml 이 되살아나도 폐기② 가 실패한다', () => {
  const bad = mainwin + '\n// x\nvar f = Path.Combine(_dataDir, "data.xml");\n';
  assert.throws(() => checks.noTracesWhenRetired(deploy, app, bad),
    /XML 경로가 남아 있다/);
});

test('변이⑯: 이관 완료 뒤 잔재가 정말 0 이면 폐기② 가 통과한다(거짓 경보 아님)', () => {
  const retired = deploy.replace('public const bool XmlRetired = false;', 'public const bool XmlRetired = true;');
  //  XML 흔적을 모두 걷어낸 가상의 소스 — 게이트가 '통과할 수 있는' 검사인지 확인한다.
  //  통과 불가능한 게이트는 이관을 영원히 막는다(그것도 결함이다).
  const cleanApp = 'const state = {}; function renderAll(){}';
  const cleanHost = 'class MainWindow { void Boot(){ } }';
  assert.doesNotThrow(() => checks.noTracesWhenRetired(retired, cleanApp, cleanHost));
});

test('변이⑰: 스위치를 되돌리면(false) 폐기① 이 사라진 경로를 잡는다', () => {
  //  폐기① 은 이제 **자고 있다**. 깨우려면 스위치를 되돌려야 하고, 그 순간 지금 소스에는
  //  XML 경로가 없으므로 반드시 걸려야 한다 — 즉 "반쯤 지워진 상태" 를 여전히 막는다.
  const back = deploy.replace('public const bool XmlRetired = true;', 'public const bool XmlRetired = false;');
  assert.notStrictEqual(back, deploy, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => checks.pathIntactWhenNotRetired(back, app, mainwin),
    /XML 경로 일부가 사라졌다/);
});

test('폐기④: 내보내기·가져오기는 살아 있다(과잉 삭제 방지)', () => {
  //  ★ 이 검사가 없으면 다음 사람이 '깨끗하게' 한다며 toXML/fromXML 까지 지운다.
  //    그러면 폐쇄망 서버 백업이 서기 전까지 사용자 자력 백업이 0 이 되고,
  //    옛 data.xml 을 DB 로 들여올 유일한 문(가져오기)이 닫힌다.
  const code = stripComments(app, 'html');
  assert.ok(/function toXML\(/.test(code), 'toXML() 이 사라졌다 — 「XML 내보내기」가 죽는다');
  assert.ok(/function fromXML\(/.test(code), 'fromXML() 이 사라졌다 — 「XML 가져오기」가 죽는다(= 이관 경로)');
  assert.ok(/function applyImport\(/.test(code), 'applyImport() 가 사라졌다 — 교체/병합이 죽는다');
});

test('변이⑱: 스위치 선언 자체를 지우면 게이트가 멈춘다(조용히 통과하지 않는다)', () => {
  const bad = deploy.replace('public const bool XmlRetired = true;', '');
  assert.notStrictEqual(bad, deploy, '변이가 원본을 바꾸지 못했다 — 스위치 선언 형태가 바뀌었다');
  assert.throws(() => xmlRetiredFlag(bad), /XmlRetired 를 찾지 못했다/);
});
