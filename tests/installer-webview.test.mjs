import { test, assert, readText } from './harness.mjs';

const iss = readText(new URL('../installer/task-calendar.iss', import.meta.url));
const build = readText(new URL('../installer/build-installer.ps1', import.meta.url));
const publish = readText(new URL('../installer/publish-update.ps1', import.meta.url));
function requiredBundle(src) {
  assert.match(src, /#ifndef FullInstaller\s+#define FullInstaller "0"/);
  assert.match(src, /#if FullInstaller == "1"\s+#define InstallerSuffix "-full"\s+#if !FileExists\(AddBackslash\(SourcePath\) \+ WebView2SetupSource\)\s+#error/);
  assert.match(src, /#else\s+#define InstallerSuffix ""/);
  assert.match(src, /OutputBaseFilename=TaskCalendarWidget-Setup-v\{#MyAppVersion\}\{#InstallerSuffix\}/);
  const files = src.split('[Files]')[1].split('[Icons]')[0];
  assert.match(files, /#if FullInstaller == "1"\s+Source: "\{#WebView2SetupSource\}"; DestDir: "\{tmp\}"[^\n]*\s+#endif/);
}
function earlyGuard(src) {
  const guard = src.indexOf('Test-Path -LiteralPath $webviewSetup -PathType Leaf');
  assert.ok(guard >= 0 && guard < src.indexOf('& dotnet publish'));
  assert.match(src, /if \(-not \(Test-Path -LiteralPath \$webviewSetup -PathType Leaf\)\) \{\s+Fail /);
}
test('설치기: 업데이트용과 Full 이름을 나누고 Full에만 런타임을 필수 포함', () => requiredBundle(iss));
test('설치기: 런타임은 미설치일 때만 앱보다 먼저 오프라인 설치하고 종료를 기다림', () => {
  const run = iss.split('[Run]')[1].split('[Code]')[0];
  assert.match(run, /#if FullInstaller == "1"\s+Filename: "\{tmp\}\\\{#WebView2SetupName\}"[^\n]*\s+#endif/);
  assert.match(run, /WebView2SetupName.*Parameters: "\/silent \/install".*Flags: waituntilterminated; Check: NeedsWebView2/);
  assert.ok(run.indexOf('WebView2SetupName') < run.indexOf('MyAppExeName'));
});
test('설치기: PowerShell은 publish 전에 런타임 누락을 거부', () => earlyGuard(build));
function blocksMissingRuntime(src) {
  assert.match(src, /#if FullInstaller == "0"\s+function InitializeSetup: Boolean;\s+begin\s+Result := not NeedsWebView2;/);
  assert.match(src, /if not Result then[\s\S]*SuppressibleMsgBox\([\s\S]*처음 설치용\(-full\.exe\)으로 설치하세요/);
}
test('설치기: 업데이트용은 미설치 PC에서 Full 안내 후 설치 전에 중단', () => blocksMissingRuntime(iss));
test('설치기: 한 번 publish 후 두 번 컴파일하고 각 파일의 해시를 표시', () => {
  assert.strictEqual((build.match(/& dotnet publish/g) || []).length, 1);
  assert.match(build, /Full = 0; Suffix = ''/);
  assert.match(build, /Full = 1; Suffix = '-full'/);
  assert.match(build, /foreach \(\$variant in \$variants\)[\s\S]*\/DFullInstaller=\$\(\$variant.Full\)/);
  assert.match(build, /Get-FileHash -LiteralPath \$out -Algorithm SHA256/);
});
test('배포: 자동 업데이트 파일명과 해시는 업데이트용 기준을 유지', () => {
  assert.match(publish, /\$fileName = "TaskCalendarWidget-Setup-v\$ver.exe"/);
  assert.match(publish, /\$setup\s*= Join-Path \$distDir \$fileName/);
  assert.match(publish, /\$sha = \(Get-FileHash -Algorithm SHA256 -Path \$setup\)/);
  assert.match(publish, /-InstallerFile \$fileName -Sha256 \$sha/);
  assert.match(publish, /file\s+= \$fileName\s+notes\s+= \$Notes\s+sha256\s+= \$sha/);
});
test('변이: 런타임 필수 검사나 빌드 사전 검사를 빼면 검출', () => {
  assert.throws(() => requiredBundle(iss.replace('#error', ';error')));
  assert.throws(() => earlyGuard(build.replace('Test-Path -LiteralPath $webviewSetup -PathType Leaf', 'Test-Path $exe')));
  assert.throws(() => blocksMissingRuntime(iss.replace('Result := not NeedsWebView2;', 'Result := True;')));
});
