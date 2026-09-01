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
//   ★ 반대 방향도 잠근다 — false 인 동안 XML 경로를 부분적으로 걷어내는 것도 막는다.
//     반쯤 지워진 상태가 가장 위험하다(어느 경로로 도는지 아무도 모른다).
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource } from './harness.mjs';

const app = loadAppSource();
const mainwin = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../widget/DeployConfig.cs', import.meta.url), 'utf8');

// 주석을 걷어낸 '실제 코드'만 본다 — 주석에 남은 설명 문구까지 잔재로 세면
//   "왜 지웠는지"를 기록하지 못하게 된다(그 기록이 재론을 막는 장치다).
function stripComments(text, kind) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, ' ');          // 블록 주석
  t = t.split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');  // 줄 주석
  if (kind === 'html') t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  return t;
}

function xmlRetiredFlag(cs) {
  const m = /public const bool XmlRetired\s*=\s*(true|false)\s*;/.exec(cs);
  assert.ok(m, 'DeployConfig.XmlRetired 를 찾지 못했다 — 폐기 게이트의 스위치가 사라졌다');
  return m[1] === 'true';
}

//  XML 저장 경로의 흔적들. 각 항목은 [정규식, 사람이 읽는 이름, 어느 파일].
const TRACES = [
  [/\bdata\.xml\b/,        'data.xml 경로',            'both'],
  [/\bfromXML\s*\(/,       'fromXML() 파서',           'app'],
  [/\btoXML\s*\(/,         'toXML() 직렬화',           'app'],
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

test('폐기③: 스위치가 실재하고 지금은 꺼져 있다', () => {
  assert.strictEqual(xmlRetiredFlag(deploy), false,
    'XmlRetired 가 켜져 있다 — 이관이 끝났다면 폐기② 가 잔재를 검사한다. 아니라면 실수로 켠 것이다');
});

// ── 변이 시험 — 게이트가 정말 발화하는지 ─────────────────────────────
test('변이⑮: 이관 완료를 선언했는데 XML 경로가 남아 있으면 폐기② 가 실패한다', () => {
  const retired = deploy.replace('public const bool XmlRetired = false;', 'public const bool XmlRetired = true;');
  assert.notStrictEqual(retired, deploy, '변이가 원본을 바꾸지 못했다');
  //  지금 소스에는 XML 경로가 살아 있으므로, 스위치만 켜면 반드시 걸려야 한다
  assert.throws(() => checks.noTracesWhenRetired(retired, app, mainwin),
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

test('변이⑰: 이관 전에 fromXML 을 지우면 폐기① 이 실패한다', () => {
  const bad = app.replace(/\bfromXML\s*\(/g, 'gone_(');
  assert.notStrictEqual(bad, app, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => checks.pathIntactWhenNotRetired(deploy, bad, mainwin),
    /XML 경로 일부가 사라졌다/);
});

test('변이⑱: 스위치 선언 자체를 지우면 게이트가 멈춘다(조용히 통과하지 않는다)', () => {
  const bad = deploy.replace('public const bool XmlRetired = false;', '');
  assert.throws(() => xmlRetiredFlag(bad), /XmlRetired 를 찾지 못했다/);
});
