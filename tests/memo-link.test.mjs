// 메모 링크(2026-11-02 사용자)와 첫 실행 최대화 시험.
//   1) 메모 속 http, https 주소를 링크로 바꾼다(개인 일정 상세 .card-memo, 과제 일정 상세 .pcd-memo, 할 일 메모 .todo-memo).
//      누르면 기본 브라우저로 연다: 메인 창은 openUrl, 열람 프레임은 바깥 열람 창을 거쳐 openUrl, 브라우저는 window.open.
//   2) 호스트 openUrl 은 http, https 절대 주소만 연다. 열람 창 허용 목록에 웹과 호스트 둘 다 있다.
//   3) 첫 실행(기억한 자리가 없음)은 작업 영역 7할 크기로 가운데 놓고 최대화로 연다.
// (S) 정적, (R) 함수 실행, (M) 변이.
import { test, assert, loadAppSource, extractFunction, readText } from './harness.mjs';

const app = loadAppSource();
const mw = readText('widget/MainWindow.xaml.cs').replace(/\r/g, '');
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
function linkifyOf(src) {
  const re = /const MEMO_URL_RE = (\/.+\/g);/.exec(src);
  assert.ok(re, 'MEMO_URL_RE 가 없다');
  const escSrc = /const esc = s => [^\n]+\n[^\n]+\n/.exec(src);
  assert.ok(escSrc, 'esc 가 없다');
  return new Function(escSrc[0] + 'const MEMO_URL_RE = ' + re[1] + ';\n' + src.slice(src.indexOf('function linkifyHtml('), src.indexOf('function openMemoLink(')) + '\nreturn linkifyHtml;')();   // extractFunction 은 정규식 속 } 에 걸린다
}

// ══ (R) 변환 ══════════════════════════════════════════════════════════
const checks = {
  convert(src) {
    const L = linkifyOf(src);
    const u = 'http://192.168.1.206/url/?key=AbC123&x=1';
    const out = L('자료: ' + u + ' 참고');
    assert.ok(out.startsWith('자료: <a class="memo-link" href="#" data-url="http://192.168.1.206/url/?key=AbC123&amp;x=1"'), '주소가 링크로 바뀌지 않았다: ' + out);
    assert.ok(out.endsWith('</a> 참고'), '주소 뒤 글이 그대로가 아니다: ' + out);
    assert.ok(L('https://a.example.com/p.').includes('data-url="https://a.example.com/p"'), '끝 마침표가 주소에 남았다');
    assert.ok(L('(https://a.example.com/p)').endsWith('</a>)'), '닫는 괄호가 주소에 남았다');
    assert.strictEqual(L('<b>x</b> & "y"'), '&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;', '주소 없는 글이 이스케이프되지 않았다');
    assert.ok(!/<a /.test(L('ftp://a.example.com file://c/x javascript:alert(1)')), 'http, https 밖 주소가 링크가 됐다');
    assert.ok(!/<script/i.test(L('https://a.example.com/<script>alert(1)</script>')), '주소 뒤 태그가 살아남았다');
    assert.strictEqual((L('https://a.com/1\nhttps://b.com/2').match(/class="memo-link"/g) || []).length, 2, '두 줄 두 주소가 둘 다 링크가 아니다');
  },
};
test('(R) linkifyHtml: 주소만 링크, 끝 문장부호 제외, 나머지 이스케이프, http/https 만', () => checks.convert(app));
test('(M) linkifyHtml 변이: 끝 문장부호를 안 빼거나 이스케이프를 빼면 잡는다', () => {
  assert.throws(() => checks.convert(mutate(app, "while(/[.,;:!?)\\]}>]$/.test(url)) url = url.slice(0, -1);", '')));
  assert.throws(() => checks.convert(mutate(app, "  return out + esc(s.slice(last));", '  return out + s.slice(last);')));
});

// ══ (S) 적용 자리와 클릭 ══════════════════════════════════════════════
//  2026-11-05(docs/PC-WATCH-2.md §7.1): 할 일 메모는 날짜 패널의 들여쓴 상세(dpTdDetHtml). 2026-11-06(docs/DAY-PANEL-CARDS.md): 일정 메모는 다시 카드(cardHtml)에 전부
test('(S) 세 메모 자리가 linkifyHtml 을 쓴다(개인 상세, 과제 일정 상세, 할 일 메모)', () => {
  assert.ok(extractFunction(app, 'cardHtml').includes('<div class="card-memo">${linkifyHtml(e.memo)}</div>'), '개인 상세 메모');
  assert.ok(app.includes("'<div class=\"pcd-memo\" tabindex=\"0\">' + linkifyHtml(e.memo) + '</div>'"), '과제 일정 상세 메모');
  assert.ok(extractFunction(app, 'dpTdDetHtml').includes('>${linkifyHtml(memo)}</div>'), '할 일 메모');
});
test('(S) 클릭: 잡기 단계에서 막고(고치기로 번지지 않게) openMemoLink 하나로 연다. 창마다 길이 다르다', () => {
  assert.ok(/document\.addEventListener\('click', ev => \{\n  const a = ev\.target && ev\.target\.closest && ev\.target\.closest\('a\.memo-link'\);\n  if\(!a\) return;\n  ev\.preventDefault\(\); ev\.stopPropagation\(\);\n  openMemoLink\(a\.dataset\.url\);\n\}, true\);/.test(app), '잡기 단계 클릭 처리가 없다');
  const f = extractFunction(app, 'openMemoLink');
  assert.ok(/if\(!\/\^https\?:\\\/\\\/\/i\.test\(url \|\| ''\)\) return;/.test(f), 'http/https 확인이 없다');
  assert.ok(/if\(!HOST\)\{ try\{ window\.open\(url, '_blank', 'noopener'\); \}/.test(f), '브라우저 모드 열기');
  assert.ok(/if\(PEER\)\{ try\{ window\.parent\.__openUrl\(url\); \}/.test(f), '열람 프레임은 바깥 창을 거친다');
  assert.ok(/hostRequest\('openUrl', \{url\}, 5000\);/.test(f), '메인 창과 열람 창은 번호 단 openUrl(열람 창 호스트는 번호 없는 명령을 거절)');
  assert.ok(/window\.__openUrl = url => \{ if\(PEERWIN\) openMemoLink\(url\); \};/.test(app), '바깥 열람 창 받이가 없다');
  assert.ok(/\.memo-link\{color:var\(--accent-2\);text-decoration:underline/.test(app), '링크 모양이 토큰이 아니다');
});

// ══ (S) 호스트 ════════════════════════════════════════════════════════
test('(S) 호스트 openUrl: http/https 절대 주소, 2048자 한도, 셸 열기, 로그에 주소 전체 안 남김. 열람 창 목록 양쪽', () => {
  assert.ok(/case "openUrl":[^\n]*\n\s*\{\n\s*OpenUrlSafe\(GetStr\(doc, "url"\)\);\n\s*string urq = GetStr\(doc, "reqId"\);\n\s*if \(urq\.Length > 0\) HostReply\(urq, new \{ ok = true \}\);/.test(mw), 'openUrl 갈래가 없거나 번호에 회신하지 않는다');
  const m = /private void OpenUrlSafe\(string url\)\n\s*\{([\s\S]*?)\n        \}/.exec(mw);
  assert.ok(m, 'OpenUrlSafe 가 없다');
  assert.ok(/url\.Length > 2048\) return;/.test(m[1]) && /Uri\.TryCreate\(url\.Trim\(\), UriKind\.Absolute, out var u\)/.test(m[1]), '주소 검사');
  assert.ok(/u\.Scheme != Uri\.UriSchemeHttp && u\.Scheme != Uri\.UriSchemeHttps\) return;/.test(m[1]), 'http/https 만');
  assert.ok(/new ProcessStartInfo\(u\.AbsoluteUri\) \{ UseShellExecute = true \}/.test(m[1]), '기본 브라우저 열기');
  assert.ok(/Log\("openUrl " \+ u\.Host\)/.test(m[1]) && !/Log\([^)]*AbsoluteUri/.test(m[1]), '로그에 주소 전체가 남는다');
  assert.ok(/"openUrl",/.test(/PeerWinCommands = new\(StringComparer\.Ordinal\)\s*\{([^}]*)\}/.exec(mw)[1]), '호스트 열람 창 목록');
  assert.ok(/const PEERWIN_CMD = new Set\(\[[^\]]*'openUrl'\]\)/.test(app), '웹 열람 창 목록');
});

// ══ (S) 첫 실행 최대화 ════════════════════════════════════════════════
test('(S) 첫 실행: 작업 영역 7할 가운데 창을 복원 자리로 두고 최대화로 연다', () => {
  assert.ok(/Width = Math\.Max\(MinWidth, Math\.Round\(wa\.Width \* 0\.7\)\);\n\s*Height = Math\.Max\(MinHeight, Math\.Round\(wa\.Height \* 0\.7\)\);/.test(mw), '7할 크기');
  assert.ok(/Left = wa\.Left \+ \(wa\.Width - Width\) \/ 2;\n\s*Top = wa\.Top \+ \(wa\.Height - Height\) \/ 2;\n\s*_firstRun = true;/.test(mw), '가운데와 첫 실행 표시');
  assert.ok(/if \(_settings\.Maximized \|\| _firstRun\) MaximizeCore\(\);/.test(mw), '첫 실행 최대화');
});
