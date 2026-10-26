import { test, assert, readText } from './harness.mjs';

const iss = readText(new URL('../installer/task-calendar.iss', import.meta.url));
const build = readText(new URL('../installer/build-installer.ps1', import.meta.url));
function requiredBundle(src) {
  assert.match(src, /#if !FileExists\(AddBackslash\(SourcePath\) \+ WebView2SetupSource\)\s+#error/);
  assert.doesNotMatch(src, /#if HasWebView2/);
  const files = src.split('[Files]')[1].split('[Icons]')[0];
  assert.match(files, /Source: "\{#WebView2SetupSource\}"; DestDir: "\{tmp\}"/);
  assert.doesNotMatch(files, /#if/);
}
function earlyGuard(src) {
  const guard = src.indexOf('Test-Path -LiteralPath $webviewSetup -PathType Leaf');
  assert.ok(guard >= 0 && guard < src.indexOf('& dotnet publish'));
  assert.match(src, /if \(-not \(Test-Path -LiteralPath \$webviewSetup -PathType Leaf\)\) \{\s+Fail /);
}
test('설치기: 오프라인 WebView2 파일이 필수이며 직접 컴파일도 누락을 거부', () => requiredBundle(iss));
test('설치기: 런타임은 미설치일 때만 앱보다 먼저 오프라인 설치하고 종료를 기다림', () => {
  const run = iss.split('[Run]')[1].split('[Code]')[0];
  assert.match(run, /WebView2SetupName.*Parameters: "\/silent \/install".*Flags: waituntilterminated; Check: NeedsWebView2/);
  assert.ok(run.indexOf('WebView2SetupName') < run.indexOf('MyAppExeName'));
});
test('설치기: PowerShell은 publish 전에 런타임 누락을 거부', () => earlyGuard(build));
test('변이: 런타임 필수 검사나 빌드 사전 검사를 빼면 검출', () => {
  assert.throws(() => requiredBundle(iss.replace('#error', ';error')));
  assert.throws(() => earlyGuard(build.replace('Test-Path -LiteralPath $webviewSetup -PathType Leaf', 'Test-Path $exe')));
});
