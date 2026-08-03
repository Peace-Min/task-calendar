// 설정창의 전역 스위치 2종 폐지 — 되살아나지 않는지 기계가 지킨다 (2026-07-30)
//
// ① 「일정 시작 알림」 전역 on/off  ★ 이게 진짜 문제였다
//    폼에서 '놓침 방지'를 골라도 전역이 꺼져 있으면 조용히 안 울렸다(무음 실패).
//    그래서 폼 힌트에 ⚠경고 + [알림 켜기] 버튼을 덧대야 했다 — 함정을 만들고 표지판을 세운 꼴.
//    알림은 시작시각이 있는 일정에만 가므로(실사용상 회의) 전역 스위치는 실익이 없다. 없앴다.
//    ★★ _remEnabled는 reminders.json의 enabled로 **영속**됐다. UI만 떼면 이미 꺼둔 사용자는
//       영원히 못 받고 켤 방법도 없다 → 로드에서 enabled를 **읽지 않는다**(무시 = 자동 구제).
//       단, version·acks(확인 이력)는 반드시 보존 — 깨지면 확인한 알림이 다시 뜬다.
//
// ② 「커밋 가져오기(Git/SVN) 전체 본문」 설정 미러
//    단일 소스 state.gitCommitBody는 그대로다. 실제로 쓰는 두 자리(일괄 불러오기·이 날 커밋)만 남기고
//    설정창의 세 번째 미러만 제거 — 기능이 아니라 중복 표면을 지운 것이다.
//
// 이 파일이 지키는 것은 두 가지다: **폐지된 것이 안 돌아온다** + **함께 지워지면 안 되는 것이 살아 있다**.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';
import { readFileSync } from 'node:fs';

const src        = loadAppSource();
const reminders  = readFileSync(new URL('../widget/Reminders.cs', import.meta.url), 'utf8');
const mainWindow = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

// ── ① 커밋 전체 본문: 설정 미러만 사라지고, 단일 소스와 나머지 두 토글은 살아 있다 ──────────

test('커밋 본문: 설정창 미러(#gitBodyChk)가 흔적 없이 제거됐다', () => {
  assert.ok(!src.includes('gitBodyChk'), '설정 미러 토글이 남아 있다: gitBodyChk');
  assert.ok(!/커밋 가져올 때 전체 본문 포함/.test(src), '설정 섹션 라벨이 남아 있다');
  assert.ok(!/커밋 가져오기 \(Git\/SVN\)/.test(src), '설정 섹션 제목이 남아 있다');
});

test('커밋 본문: syncGitBodyChecks 배열에서 #gitBodyChk가 빠지고 나머지 둘은 남았다', () => {
  const fn = extractFunction(src, 'syncGitBodyChecks');
  assert.ok(!fn.includes('#gitBodyChk'), '동기화 대상에 폐지된 셀렉터가 남아 있다');
  assert.ok(fn.includes('#bgBodyChk'), '일괄 불러오기 토글이 동기화 대상에서 빠졌다');
  assert.ok(fn.includes('#dgBodyChk'), '이 날 커밋 토글이 동기화 대상에서 빠졌다');
});

// ★ 부수피해 방지 — 지운 건 '설정 미러'뿐이다. 기능(단일 소스·영속·실제 토글 2개)은 그대로여야 한다.
test('커밋 본문: 단일 소스·공유 setter·실제 토글 2곳이 그대로다', () => {
  assert.ok(/id="bgBodyChk"/.test(src), '일괄 불러오기 모달 토글(#bgBodyChk)이 사라졌다');
  assert.ok(/id="dgBodyChk"/.test(src), '이 날 커밋 모달 토글(#dgBodyChk)이 사라졌다');
  assert.ok(/function setGitCommitBody\(/.test(src), '공유 setter(setGitCommitBody)가 사라졌다');
  assert.ok(/state\.gitCommitBody = !!on/.test(src), 'setter가 단일 소스를 더 이상 쓰지 않는다');
  // 남은 두 토글의 배선(공유 setter로 라우팅)
  assert.ok(/\$\('#bgBodyChk'\)[\s\S]{0,120}setGitCommitBody/.test(src), '#bgBodyChk 배선이 끊겼다');
  assert.ok(/\$\('#dgBodyChk'\)[\s\S]{0,120}setGitCommitBody/.test(src), '#dgBodyChk 배선이 끊겼다');
});

test('커밋 본문: XML 영속과 gitlog 호출 인자가 그대로다', () => {
  assert.ok(/setAttribute\('gitCommitBody', '1'\)/.test(src), 'XML 저장(setAttribute)이 사라졌다');
  assert.ok(/getAttribute\('gitCommitBody'\)/.test(src), 'XML 로드(getAttribute)가 사라졌다');
  // 실제 호출부만 센다(설명 주석에도 같은 문자열이 나온다) — git·svn 두 갈래 모두 본문 옵션을 전달해야 한다.
  const calls = src.split('\n').filter((l) => l.includes("hostRequest('gitlog'"));
  assert.strictEqual(calls.length, 2, `gitlog 호출은 git·svn 2곳이어야 한다(현재 ${calls.length})`);
  for (const c of calls) assert.ok(/body: !!state\.gitCommitBody/.test(c), `gitlog 호출이 본문 옵션을 잃었다: ${c.trim()}`);
});

// ── ② 시작 알림 전역 스위치: 웹 층에서 완전히 사라졌다 ──────────────────────────────

test('알림: 전역 스위치 UI·상태·브리지가 웹에서 흔적 없이 사라졌다', () => {
  for (const dead of ['remEnabled', '_remGlobalOn', 'reminderToggle', '__setReminders', 'data-remenable']) {
    assert.ok(!src.includes(dead), `폐지된 전역 스위치 잔재가 남아 있다: ${dead}`);
  }
  assert.ok(!/시작 알림 켜기/.test(src), '설정 섹션 체크박스 라벨이 남아 있다');
  assert.ok(!/일정 시작 알림 <span/.test(src), '설정 섹션 제목이 남아 있다');
});

test('알림: 폼 힌트의 ⚠경고·[알림 켜기] 분기가 사라졌다(경고할 대상이 없다)', () => {
  assert.ok(!/시작 알림이 꺼져 있어/.test(src), '경고 문구가 남아 있다');
  assert.ok(!src.includes('rem-warn'), '경고 전용 스타일(.rem-warn)이 남아 있다');
  assert.ok(!src.includes('알림 켜기'), '켜기 액션 라벨이 남아 있다');
  const fn = extractFunction(src, 'remRowSync');
  assert.ok(!fn.includes('insertAdjacentHTML'), 'remRowSync가 아직 힌트에 마크업을 덧붙인다');
  assert.ok(/hint\.textContent = remHint\(/.test(fn), '힌트 갱신 자체가 사라졌다(경고만 걷어내야 한다)');
});

// ★ 부수피해 방지 — 알림 '기능'은 남는다. 지운 건 전역 킬 스위치뿐이다.
test('알림: 일정별 미리알림 UI(폼·빠른등록 3버튼)가 그대로다', () => {
  for (const id of ['fRemSeg', 'fRemUnit', 'fRemNum', 'fRemHint', 'fRemBlock',
                    'qaRemSeg', 'qaRemUnit', 'qaRemNum', 'qaRemHint', 'qaRemBlock']) {
    assert.ok(new RegExp('id="' + id + '"').test(src), `미리알림 행 요소가 사라졌다: #${id}`);
  }
  for (const pfx of ['fRemSeg', 'qaRemSeg']) {
    const seg = src.slice(src.indexOf('id="' + pfx + '"'), src.indexOf('id="' + pfx + '"') + 700);
    for (const mode of ['def', 'none', 'cust']) {
      assert.ok(seg.includes('data-remmode="' + mode + '"'), `#${pfx}에 '${mode}' 버튼이 없다`);
    }
  }
});

test('알림: 스케줄 파이프라인(remindMinsFor·pushReminders·reminderSync)과 재동기화 함수가 살아 있다', () => {
  for (const fn of ['remindMinsFor', 'pushReminders', 'buildReminderOccs', 'fRemResync', 'qaRemResync',
                    'remRowSync', 'remSetUi', 'remReadValue']) {
    assert.doesNotThrow(() => extractFunction(src, fn), `함수가 사라졌다: ${fn}`);
  }
  assert.ok(/const REMIND_DEFAULT = \[60, 30, 10, 5\]/.test(src), '기본 사다리 상수가 사라졌다');
  assert.ok(/const _remState = /.test(src), '폼별 미리알림 상태(_remState)가 사라졌다');
  assert.ok(/cmd:'reminderSync'/.test(src), '호스트로 보내는 reminderSync 브리지가 사라졌다');
  // fRemResync/qaRemResync는 경고 표시 말고도 활성/흐림 반영 역할이 있다 — 호출부가 남아야 의미가 있다.
  assert.ok((src.match(/fRemResync\(\)/g) || []).length >= 3, 'fRemResync 호출부가 함께 지워졌다');
  assert.ok((src.match(/qaRemResync\(\)/g) || []).length >= 3, 'qaRemResync 호출부가 함께 지워졌다');
});

// ── ③ 호스트(Reminders.cs) — 여기가 핵심. 영속된 enabled를 무시해야 기존 사용자가 구제된다 ──

test('호스트: 킬 스위치 필드·게이트·통지가 사라졌다', () => {
  for (const dead of ['_remEnabled', 'SetRemindersEnabled', '__setReminders']) {
    assert.ok(!reminders.includes(dead), `Reminders.cs에 킬 스위치 잔재가 남아 있다: ${dead}`);
  }
  assert.ok(!/case "reminderToggle":/.test(mainWindow), 'MainWindow에 reminderToggle 브리지가 남아 있다');
  assert.ok(/case "reminderSync":/.test(mainWindow), 'reminderSync 브리지까지 함께 지워졌다');
});

// ★★ 구제 경로 — 예전에 알림을 꺼둔 사용자의 reminders.json에는 enabled:false가 들어 있다.
//    그 값을 다시 읽는 순간 그 사람은 켤 UI도 없이 영영 알림을 못 받는다. 읽지도 쓰지도 않아야 한다.
test('호스트: reminders.json의 enabled를 읽지도 쓰지도 않는다(기존 OFF 사용자 자동 구제)', () => {
  assert.ok(!reminders.includes('"enabled"'), 'enabled 키를 아직 다룬다(기존 OFF 사용자가 영구 침묵)');
  assert.ok(!/TryGetProperty\("enabled"/.test(reminders), '로드에서 enabled를 읽는다');
  assert.ok(!/\["enabled"\]/.test(reminders), '저장에서 enabled를 쓴다');
});

test('호스트: 저장 스키마에서 version과 acks(확인 이력)는 보존된다', () => {
  const save = reminders.slice(reminders.indexOf('private void RemSave()'));
  assert.ok(/\["version"\] = 1/.test(save), 'version이 사라졌다(스키마 판별 불가)');
  assert.ok(/\["acks"\] = _remAcks/.test(save), 'acks가 사라졌다 — 확인한 알림이 다시 뜬다');
  const load = reminders.slice(reminders.indexOf('private void RemLoad()'), reminders.indexOf('private void RemSave()'));
  assert.ok(/TryGetProperty\("acks"/.test(load), '로드가 acks를 읽지 않는다 — 재시작마다 다시 울린다');
});

test('호스트: 알림 타이머는 조건 없이 시작한다', () => {
  const init = reminders.slice(reminders.indexOf('private void ReminderInit()'),
                               reminders.indexOf('private void RemSync('));
  const starts = init.split('\n').filter((l) => l.includes('_remTimer.Start()'));
  assert.strictEqual(starts.length, 1, `ReminderInit의 타이머 시작은 1곳이어야 한다(현재 ${starts.length})`);
  assert.ok(!/\bif\s*\(/.test(starts[0]), `타이머 시작이 조건에 걸려 있다: ${starts[0].trim()}`);
  // RemTick의 조기 return 게이트도 없어야 한다(첫 문장이 곧바로 시각 계산).
  const tick = reminders.slice(reminders.indexOf('private void RemTick()'),
                               reminders.indexOf('private void ShowOrUpdate('));
  assert.ok(/RemTick\(\)\s*\{\s*var now = DateTime\.Now;/.test(tick), 'RemTick 앞에 게이트가 남아 있다');
});

// ── ④ 범위 이탈 방지 — 이번 작업에서 손대지 않기로 한 표면들 ────────────────────────

test('범위: 계정 표면과 과제 DB 섹션은 살아 있다(설정창 정리의 부수피해 아님)', () => {
  // ★ 계약 갱신(2026-08-03): 계정은 '지워진' 게 아니라 상단바 👤 「사용자 정보」 모달로 승격됐다.
  //   이 테스트가 지키려는 것(설정창 정리의 부수피해로 계정을 잃지 않았는가)은 그대로고, 확인할 id 만 옮겼다.
  for (const id of ['userModal', 'usHint', 'usName', 'usTitle', 'usOrg', 'usLogout', 'usMsg']) {
    assert.ok(new RegExp('id="' + id + '"').test(src), `사용자 정보 모달의 요소가 사라졌다: #${id}`);
  }
  for (const dead of ['accountSection', 'acctHint', 'acctName', 'acctTitle', 'acctOrg', 'acctLogout', 'acctMsg']) {
    assert.ok(!src.includes(dead), `옛 설정창 계정 섹션의 잔재가 남아 있다: ${dead}(옮긴 게 아니라 복제됐다)`);
  }
  for (const fn of ['updateUserUi', 'applyUser', 'submitLogout']) {
    assert.ok(src.includes(fn), `계정 관련 함수가 사라졌다: ${fn}`);
  }
  assert.ok(/id="dbSection"/.test(src), '과제 DB 섹션이 사라졌다');
});
