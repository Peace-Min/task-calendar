// Layer 1 — 복구 스크립트(db/deploy/restore-taskmgr.ps1 / .cmd)의 **계약**을 소스 텍스트만으로
// 검사한다. DB 도 jsdom 도 필요 없다(두 파일을 읽어 파싱할 뿐).
//
// 왜 있나
//   복구는 1년에 한 번 쓸까 말까 한 경로다. 그래서 조용히 썩는다 — 누가 가드 한 줄을 지워도
//   다음 릴리스까지 아무도 모르고, 알게 되는 날은 서버가 죽어 있는 날이다.
//   여기서 잠그는 것은 '복구가 잘 되는가' 가 아니라(그건 실제 리허설이 한다),
//   **복구 스크립트가 가진 안전 계약이 사라지지 않았는가** 다:
//     ① 라이브 DB 를 덮어쓰지 못하게 하는 가드가 있고, 스위치 하나로 열리지 않는다
//     ② 비밀번호를 `-p<비번>` 꼴로 명령줄에 실어 보내는 자리가 없다
//     ③ 검증이 '개수' 가 아니라 '이름 집합' 을 대조한다 (개수는 같고 이름이 다를 수 있다)
//     ④ -Grants 경로가 create-app-user.sql + grants-calendar.sql 을 둘 다 참조하고,
//        **세 번째 정본**인 비공개 taskmgr-company-data/05-grants.sql 도 찾아 적용하거나 경고한다
//        (복구방법.txt 4번 — 이 단계를 건너뛰면 위젯이 첫 조회에서 ERROR 1044/1142 로 죽는다)
//     ⑤ .ps1 과 .cmd 의 종료코드 표가 글자 그대로 같다
//     ⑥ 라이브에 못 붙으면 '검증 못 함' 으로 끝난다 — 통과(0)로 세지 않는다
//     ⑦ .cmd 에 비ASCII 가 한 글자도 없다
//     ⑧ ★ stdin 첫 줄 읽기에 **상한**이 있다 — 무인 실행이 영원히 멎지 않는다
//     ⑨ ★ 자격 획득 순서에서 .cnf 와 환경변수가 stdin 보다 **앞선다**
//
//   ⑧⑨ 는 2026-09-07 에 실측된 결함의 회귀 잠금이다:
//     stdin 이 리다이렉트돼 있고 파이프가 **열린 채 비어 있으면**(작업 스케줄러·CI·다른
//     스크립트 안에서 흔한 모양) [Console]::In.ReadLine() 이 영원히 돌아오지 않아
//     `restore-taskmgr.ps1 -WhatIf` 가 5분이 지나도 끝나지 않았다. `< NUL`(즉시 EOF)에서는
//     멀쩡했으므로 대화형·수동 실행에서는 절대 드러나지 않는 결함이다.
//     무인 실행에서 **실패는 알람이 되지만 무한 대기는 아무 신호도 내지 않는다** —
//     백업 계정에 SELECT 만 줬을 때 mysqldump 가 조용히 exit 0 으로 끝나던 것과 같은 침묵이다.
//
// 검사 함수(checks)를 테스트와 변이 주입이 공유한다 — 검사가 실제로 잡는지 증명하기 위해서다
// (이 저장소의 관례. schema-guards.test.mjs · holiday.test.mjs 와 같은 꼴).
//
// 공용 기계(마스커·종료코드 표 파서·변이 주입기)는 tests/ps-guard-lib.mjs 에 있다 —
// backup-guards.test.mjs 가 같은 것을 쓴다. 두 시험 파일이 서로를 import 하면 러너의
// 파일별 등록 인구조사가 무너지므로(ES 모듈은 한 번만 평가된다) 공용부를 따로 뺐다.
import { test, assert } from './harness.mjs';
import {
  loadDeploy, maskPs, passwordOnCommandLineHits,
  exitCodeTable, exitCodesInTable, exitCodesUsed, mutate, nonAsciiLines,
} from './ps-guard-lib.mjs';

const PS1 = 'restore-taskmgr.ps1';
const CMD = 'restore-taskmgr.cmd';
const psSrc = loadDeploy(PS1);
const cmdSrc = loadDeploy(CMD);

// -Grants **실행** 분기의 본문(계정·권한을 실제로 먹이는 자리).
//   ★ 2026-09-11 적대 검토(R4) — '첫 번째 if($Grants){' 로 잡으면 안 된다. 맨 앞 인자 검증 구역에도
//     같은 조건이 한 벌 있고(거기서는 두 SQL 의 **존재만** 본다), 그것을 잡으면 두 구역 사이가 통째로
//     한 덩어리가 돼 아래 검사들이 엉뚱한 텍스트를 본다. 기준은 **SQL 을 실제로 읽는 줄**이다.
function grantsBranchBody(ps) {
  const iUse = ps.indexOf('$appUserText = [IO.File]::ReadAllText($appUserSql)');
  assert.ok(iUse >= 0, '-Grants 분기가 create-app-user.sql 을 읽지 않는다 — 계정·권한 재적용 경로가 사라졌다');
  const iStart = ps.lastIndexOf('\nif($Grants){', iUse);
  assert.ok(iStart >= 0, '-Grants 분기를 찾지 못했다 — 계정·권한 재적용 경로가 사라졌다');
  const iEnd = ps.indexOf('\n} else {', iUse);
  assert.ok(iEnd > iStart, '-Grants 분기의 끝(} else {)을 찾지 못했다 — 판정 불가');
  return ps.slice(iStart, iEnd);
}

// ══ 검사 함수(테스트 + 변이 주입이 같은 함수를 쓴다) ═══════════════════
const checks = {
  // ① 라이브 덮어쓰기 거부 가드 — 스위치 하나로 열리지 않는다.
  liveOverwriteGuard(ps) {
    assert.ok(/Bad "라이브 덮어쓰기 거부 —/.test(ps),
      '라이브 덮어쓰기 거부 가드가 없다 — -TargetDb 가 -LiveDb 와 같을 때 멈추는 자리가 사라졌다');
    assert.ok(/if\(-not \$OverwriteLive\)\{/.test(ps),
      '-OverwriteLive 없이도 라이브를 덮어쓸 수 있는 상태다');
    // 스위치만으로는 부족해야 한다 — 사람이 DB 이름을 직접 타이핑해야 열린다.
    assert.ok(/Read-Host "덮어쓸 DB 이름을 입력/.test(ps),
      '이름 타이핑 확인이 없다 — -OverwriteLive 스위치 하나로 라이브가 열린다');
    assert.ok(/if\("\$typed" -cne "\$LiveDb"\)\{/.test(ps),
      '타이핑한 이름을 대소문자까지(-cne) 대조하지 않는다 — 확인 절차가 느슨해졌다');
    // 비대화형에서는 그 타이핑이 불가능하므로 무조건 거부해야 한다(무인 배치가 이 문을 못 열게).
    assert.ok(/if\(\[Console\]::IsInputRedirected\)\{[\s\S]{0,400}?라이브 덮어쓰기는 사람이 DB 이름을 직접 타이핑/.test(ps),
      '비대화형(stdin 리다이렉트)에서도 라이브 덮어쓰기가 열린다 — 무인 실행에서 열려서는 안 된다');
    // -DropTarget 으로 라이브를 지우는 조합은 어떤 스위치로도 열리지 않아야 한다.
    assert.ok(/-DropTarget 으로 라이브 DB\(\$LiveDb\) 를 지울 수는 없습니다/.test(ps),
      '-DropTarget + 라이브 DB 조합을 막는 자리가 없다');
  },

  // ② 비밀번호를 명령줄에 싣지 않는다.
  //    Windows 는 같은 사용자면 다른 프로세스의 명령줄을 그대로 읽는다(파일 머리말의 실측).
  noPasswordOnCommandLine(ps) {
    // -p<값> (mysql/mysqldump 의 비번 인자) · --password=<값>.
    // 마스커와 이 규칙은 ps-guard-lib 에 있다 — backup-guards.test.mjs 가 **같은 것**을 쓴다.
    const bad = passwordOnCommandLineHits(ps);
    assert.deepStrictEqual(bad, [],
      `비밀번호를 명령줄로 넘기는 자리가 생겼다: ${bad.join(' , ')} — ` +
      '자격은 --defaults-extra-file(보호된 .cnf)로만 넘겨야 한다');
    // 없는 것을 확인하는 검사는 '아무 데도 안 보고 있는' 상태와 구별되지 않는다.
    // 그래서 정본 경로가 실재하는지도 함께 본다.
    assert.ok(/--defaults-extra-file=\$adminCnf/.test(ps),
      '자격을 .cnf 로 넘기는 자리가 없다 — 검사가 볼 대상 자체가 사라졌다');
  },

  // ③ 검증이 개수가 아니라 이름 집합을 대조한다.
  verifiesNameSetsNotCounts(ps) {
    const m = /function NameSetDiff\(\$expect, \$actual\)\{([\s\S]*?)\n\}/.exec(ps);
    assert.ok(m, 'NameSetDiff 함수가 없다 — 이름 집합 대조가 통째로 사라졌다');
    const body = m[1];
    assert.ok(/Missing\s*=\s*@\(\$e \| Where-Object \{ \$a -notcontains \$_ \}\)/.test(body),
      'NameSetDiff 가 "라이브에 있는데 복구본에 없는 이름"을 뽑지 않는다');
    assert.ok(/Extra\s*=\s*@\(\$a \| Where-Object \{ \$e -notcontains \$_ \}\)/.test(body),
      'NameSetDiff 가 "복구본에만 있는 이름"을 뽑지 않는다');
    assert.ok(!/\.Count\s*-(eq|ne)\s*/.test(body),
      'NameSetDiff 가 개수 비교로 바뀌었다 — 개수는 같고 이름이 다를 수 있다');
    // 표·뷰·트리거·루틴 넷 다 이름으로 본다.
    const calls = [...ps.matchAll(/^CheckNames\s+"([^"]+)"/gm)].map((x) => x[1]);
    assert.deepStrictEqual(calls, ['base table 이름', '뷰 이름', '트리거 이름', '루틴 이름'],
      `이름 집합으로 대조하는 대상이 바뀌었다: [${calls.join(', ')}] — ` +
      '표·뷰·트리거·루틴 넷을 모두 이름으로 봐야 한다');
    // CheckNames 자신이 NameSetDiff 를 쓰는지(호출만 남고 알맹이가 바뀌지 않았는지).
    assert.ok(/function CheckNames\([\s\S]*?\$d = NameSetDiff \$expect \$actual/.test(ps),
      'CheckNames 가 NameSetDiff 를 쓰지 않는다');
    // 표별 행 수는 information_schema 의 추정치가 아니라 실제 COUNT(*) 여야 한다.
    assert.ok(/COUNT\(\*\) AS n FROM/.test(ps),
      '표별 행 수를 COUNT(*) 로 세지 않는다 — information_schema.TABLE_ROWS 는 InnoDB 에서 추정치다');
  },

  // ④ -Grants 경로가 두 SQL 을 둘 다 참조한다(복구방법.txt 4번).
  grantsPathUsesBothSqlFiles(ps) {
    const body = grantsBranchBody(ps);
    assert.ok(/Join-Path \$scriptDir "create-app-user\.sql"/.test(ps),
      'create-app-user.sql 을 가리키는 자리가 없다');
    assert.ok(/Join-Path \$scriptDir "grants-calendar\.sql"/.test(ps),
      'grants-calendar.sql 을 가리키는 자리가 없다');
    assert.ok(/\$appUserSql/.test(body) && /\$grantsSql/.test(body),
      '-Grants 분기가 두 SQL 을 둘 다 쓰지 않는다 — 하나만 돌리면 앱은 1044/1142 로 죽는다');
    // 두 파일은 DB 이름을 글자로 박아 두었다. 대상이 다르면 사본에서 바꿔 돌려야 한다 —
    // 안 그러면 리허설이 라이브 계정 권한을 건드린다.
    // ★ '분기가 있다'만 보면 안 된다 — 분기 조건만 죽여도(if($false)) 통과해 버린다(변이④-b 로 실측).
    //   조건과 **치환 자체**가 한 덩어리로 살아 있는지 본다.
    assert.ok(
      /if\(\$TargetDb -ne \$grantSchema\)\{[\s\S]{0,2000}?\[regex\]::Replace\([\s\S]{0,200}?\[regex\]::Escape\(\$grantSchema\)[\s\S]{0,160}?\$TargetDb/.test(body),
      'grants 파일의 하드코딩된 DB 이름을 대상에 맞추는 자리가 없다 — 리허설이 라이브 권한을 건드린다');
    assert.ok(/DROP DATABASE 로 표 단위 권한\(mysql\.tables_priv\)을 지우지 않습니다/.test(ps),
      'DROP DATABASE 가 표 단위 권한을 남긴다는 경고가 사라졌다(그 권한은 같은 이름의 DB 가 생기면 되살아난다)');
  },

  // ④-b **세 번째 정본** — 비공개 taskmgr-company-data/05-grants.sql (app_user 의 SELECT/INSERT/UPDATE/DELETE).
  //
  //   왜 따로 잠그나: 그 파일은 이 저장소에 **없다**(비공개 형제 저장소). 그래서 db/deploy 의 두 파일만
  //   적용하고 끝내면 복구본은 '캘린더는 도는데 직원 관리와 휴지통의 인력 영구 삭제가 전부 ERROR 1142'
  //   라는 상태가 된다(USER-ADMIN §11-11 · TRASH-DELETE §3.3). 두 파일만 보는 ④ 는 그 구멍을 못 본다.
  //
  //   여기서 요구하는 것은 셋이다 — **찾고**(경로·매개변수) · **적용하고** · 없으면 **경고를 남긴다**.
  //   셋 중 하나만 빠져도 사고는 조용해진다(경고 없이 넘어가면 아무도 모른 채 복구가 '성공' 한다).
  grantsPathHandlesPrivateUserGrants(ps) {
    const body = grantsBranchBody(ps);
    // 1) 찾는 자리 — 형제 폴더 후보 + 직접 지정 매개변수.
    //  ★ 2026-09-11(R5) — 옛 판은 `function FindUserGrants(){[\s\S]{0,1200}?…` 로 **창 길이**를 박아 두어,
    //    함수 안에 주석 두 줄이 붙는 것만으로 계약이 무너졌다(창 길이가 판정을 정하는 것은 계약이 아니다).
    //    이제 함수 **본문**을 오려 내어 그 안을 본다 — 아래 재확인 검사도 같은 슬라이스를 쓴다.
    const fug = /function FindUserGrants\(\)\{([\s\S]*?)\n\}/.exec(ps);
    assert.ok(fug, 'FindUserGrants 본문을 찾지 못했다 — 판정 불가');
    const fugBody = fug[1];
    assert.ok(/taskmgr-company-data\\05-grants\.sql/.test(fugBody),
      '05-grants.sql 을 찾는 자리(FindUserGrants)가 없다 — app_user 권한의 정본은 이 저장소에 없다');
    assert.ok(/\[string\]\$UserGrantsPath\s*=\s*""/.test(ps),
      '-UserGrantsPath 매개변수가 없다 — 형제 폴더가 아닌 곳에 둔 사람이 지정할 길이 사라졌다');
    // 2) 적용하는 자리 — -Grants 분기 안에서 실제로 mysql 에 먹인다.
    assert.ok(/\$userGrants = FindUserGrants/.test(body),
      '-Grants 분기가 05-grants.sql 을 찾지 않는다 — 두 파일만 돌면 직원 관리가 1142 로 죽는다');
    assert.ok(/if\(\$userGrants\)\{[\s\S]{0,600}?--defaults-extra-file=\$adminCnf[\s\S]{0,200}?\$userGrants/.test(body),
      '찾아 놓고 적용하지 않는다 — 경로만 구하고 mysql 에 먹이는 자리가 없다');
    // 3) 못 찾았을 때 — 화면 경고 + 복구방법.txt 에 같은 말.
    assert.ok(/UserGrantsWarnText/.test(body) && /WriteUserGrantsHowto/.test(body),
      '05-grants.sql 이 없을 때 경고를 남기지 않는다 — 조용히 넘어가면 복구가 "성공" 으로 끝난다');
    assert.ok(/ERROR 1142/.test(ps) && /직원 등록/.test(ps) && /영구 삭제/.test(ps),
      '경고문이 무엇이 죽는지(직원 관리·인력 영구 삭제 = ERROR 1142) 말하지 않는다');
    //  ★ 2026-09-11 적대 검토(R6) — **직접 지정한 경로가 없으면 그 자리에서 죽는다**(EXIT_CONFIG).
    //    옛 판은 $null 을 돌려 '형제 폴더에 없음' 경고로 떨어졌다. 사람은 형제 폴더가 아니라 자기가 준
    //    경로를 찾게 했으므로 그 경고는 사실이 아니고, 오타 하나가 "권한 파일이 원래 없는 환경" 으로
    //    둔갑해 복구가 경고만 남긴 채 '성공' 으로 끝났다. 기본 탐색(형제 폴더)의 부재는 그대로 경고다.
    //  ★ 2026-09-11 적대 검토(R2) — 그 죽음의 **자리**도 함께 잠근다. 옛 판은 FindUserGrants 안에 있었는데,
    //    그 함수는 8단계(권한 적용)와 -WhatIf 계획 출력에서만 불린다 — 곧 오타 하나가 **대상 DB 를 이미
    //    드롭·복구한 뒤**에야 드러났다(사람은 "설정 문제(코드 2)" 를 읽으며 갈아엎힌 DB 를 받는다).
    //    지금은 맨 앞 인자 검증 구역이고, 아래에서 그 자리를 기준점 셋으로 못박는다.
    //    (맨 앞 자리는 힌트 문장으로 가린다 — 같은 확인이 쓰는 자리(FindUserGrants)에도 한 벌 더 있고,
    //     그쪽 문장으로 이 검사가 통과해 버리면 '맨 앞' 이라는 계약이 비어 버린다.)
    assert.ok(/if\(\$UserGrantsPath\)\{\s*RequireFile "[^"]*-UserGrantsPath[^"]*" \$UserGrantsPath "\(경로를 확인하거나/.test(ps),
      '-UserGrantsPath 로 지정한 경로가 없을 때 그 경로를 이름으로 말하며 죽지 않는다 — ' +
      "'형제 폴더에 없음' 경고로 떨어지면 오타 하나가 \"원래 없는 환경\" 으로 둔갑하고 복구가 '성공' 으로 끝난다(R6)");
    //  ★ 2026-09-11 적대 검토(R4) — 그 확인의 **형태**를 한 벌로 잠근다(RequireFile). 옛 판은 다섯 자리가
    //    저마다 `if(… -and -not (Test-Path -LiteralPath …)){ Die … }` 를 베껴 적고 있었고, 그래서
    //    **-PathType Leaf 가 어디에도 없었다** — 폴더를 준 실수는 맨 앞 문을 그냥 통과해 한참 뒤
    //    (mysql 입력 · [IO.File]::ReadAllText)에, 곧 **드롭·복구 뒤**에 터졌다. 같은 모양을 여섯 벌
    //    베껴 두면 한 벌만 고쳐진다는 그 사실 자체가 결함이었으므로, 함수 하나로 모으고 여기서 잠근다.
    const rf = /function RequireFile\(\$label, \$path, \$hint\)\{([\s\S]*?)\n\}/.exec(ps);
    assert.ok(rf, 'RequireFile 본문을 찾지 못했다 — 파일 인자 확인의 정본이 사라졌다(R4 · 판정 불가)');
    assert.ok(/Test-Path -LiteralPath "\$path" -PathType Leaf/.test(rf[1]),
      'RequireFile 이 -LiteralPath · -PathType Leaf 로 보지 않는다 — 대괄호가 든 경로를 와일드카드로 읽거나 ' +
      '**폴더를 파일로 통과시킨다**(그 실수는 드롭·복구 뒤에야 터진다 · R4)');
    assert.ok(/Die "[^"]*\$path[^"]*" \$EXIT_CONFIG/.test(rf[1]),
      'RequireFile 이 Die … $EXIT_CONFIG(설정 문제 = 코드 2)로 끝나지 않는다 — 경고로 흘리면 아무도 모른다(R4)');
    //  ★ 2026-09-11 적대 검토(R3) — 그 규율을 **직접 준 경로 인자 전부**로 넓힌다. 옛 판은
    //    -UserGrantsPath 하나만 맨 앞에서 봤고, -AppCnfPath 는 9-7 스모크 자리에서, -Grants 의 두 SQL 은
    //    8단계 자리에서 죽었다 — 둘 다 **드롭·복구 뒤**다. -DeployConfigPath 는 더 나빴다: 직접 준
    //    경로가 없어도 `if(Test-Path …)` 로 말없이 건너뛰어 스모크가 '검증 못 함' 으로 끝났다(사람은
    //    자기가 준 경로가 무시된 줄 모른다). 지금은 다섯이 한 구역에 모여 있고, 전부 Die + 코드 2 다.
    //  ★ 2026-09-11 적대 검토(R4) — 그 다섯에 **-DumpPath·-CnfPath** 를 더한다. 둘은 원래부터 맨 Test-Path
    //    였는데(대괄호가 든 경로를 와일드카드로 읽고, 폴더도 통과시킨다), 확인이 한 벌로 모인 지금은
    //    같은 함수를 지나야 한다 — 파일 인자는 일곱 **전부** RequireFile 이다.
    const upfront = [
      ['RequireFile "-UserGrantsPath 로 지정한 05-grants.sql" $UserGrantsPath "(경로를 확인하거나', '-UserGrantsPath'],
      ['RequireFile "-AppCnfPath 로 지정한 앱 자격 파일" $AppCnfPath', '-AppCnfPath'],
      ['RequireFile "-DeployConfigPath 로 지정한 DeployConfig.cs" $DeployConfigPath', '-DeployConfigPath(직접 준 경우)'],
      ['RequireFile "create-app-user.sql" $appUserSql', '-Grants 의 create-app-user.sql'],
      ['RequireFile "grants-calendar.sql" $grantsSql', '-Grants 의 grants-calendar.sql'],
      ['RequireFile "덤프 파일(-DumpPath)" $DumpPath', '-DumpPath'],
      ['RequireFile "자격 파일(-CnfPath)" $CnfPath', '-CnfPath'],
    ];
    //    기준점 셋: -WhatIf 계획 출력 · 복구 전 안전 덤프 · 대상 DB DROP. 검증은 셋보다 앞이어야 한다
    //    (리허설에서도 같은 오타가 같은 자리에서 걸려야 하므로 -WhatIf 도 기준점이다).
    const landmarks = [
      ['---- 계획 (-WhatIf: 아무것도 바꾸지 않습니다) ----', '-WhatIf 계획 출력'],
      ['$prePath = Join-Path $BackupDir', '복구 전 안전 덤프'],
      ['DROP DATABASE IF EXISTS', '대상 DB DROP'],
    ];
    for (const [needle, label] of upfront) {
      const iChk = ps.indexOf(needle);
      assert.ok(iChk >= 0,
        `${label} 존재 확인이 맨 앞 인자 검증 구역에 없다 — 오타가 DB 를 갈아엎은 뒤에야 드러난다(R2 → R3)`);
      //  ★ 2026-09-11 적대 검토(R5) — 옛 판은 여기서 `ps.slice(iChk).startsWith('RequireFile ')` 를
      //    봤는데, iChk 는 바로 그 `RequireFile …` 문자열을 찾은 자리다: **항상 참인 검사**였다
      //    (아무것도 못 잡는 검사는 초록 한 줄을 거짓으로 늘릴 뿐이다). 실제로 지켜야 하는 것은
      //    '이 자리가 RequireFile 이다' 가 아니라 **'확인이 한 벌뿐이다'** 이므로, 아래에서
      //    손으로 적은 Test-Path 갈래가 스크립트 어디에도 없음을 본다.
      for (const [marker, what] of landmarks) {
        const i = ps.indexOf(marker);
        assert.ok(i >= 0, `기준점을 못 찾았다(측정 불가 ≠ 통과): ${what}`);
        assert.ok(iChk < i,
          `${label} 존재 확인이 '${what}' 보다 뒤에 있다 — 경로 오타가 그 단계를 지나고 나서야 터진다(R2 → R3)`);
      }
    }
    //  ★ 2026-09-11 적대 검토(R5) — 확인의 **형태가 한 벌**인지는 '그 자리' 가 아니라 **스크립트 전체**에서
    //    본다: 파일 인자 어디에도 손으로 적은 `if($X -and -not (Test-Path …)){ Die … }` 갈래가 없어야 한다.
    //    그 꼴이 하나라도 살아나면 -PathType Leaf 가 빠진 벌이 생기고(폴더를 준 실수가 드롭·복구 뒤에야
    //    터진다 · R4), 문구도 Die + 코드 2 에서 갈린다. 확인은 RequireFile 한 벌뿐이다.
    //    (맨 Test-Path 자체는 금지가 아니다 — 9-7 의 '기본 위치가 없을 수도 있다' 처럼 **확인이 아닌**
    //     갈래가 따로 있다. 잡는 것은 '있는지 보고 죽는' 그 모양 하나다.)
    for (const v of ['UserGrantsPath', 'AppCnfPath', 'DeployConfigPath', 'appUserSql', 'grantsSql',
                     'DumpPath', 'CnfPath']) {
      const handRolled = new RegExp(
        `if\\(\\s*\\$${v}\\b[^\\n]*-not\\s*\\(Test-Path` +
        `|-not\\s*\\(Test-Path[^\\n]*\\$${v}\\b`);
      assert.ok(!handRolled.test(ps),
        `$${v} 의 존재 확인을 손으로 적은 Test-Path 갈래가 있다 — 확인 형태가 RequireFile 한 벌에서 갈라졌다(R5). ` +
        '갈라진 벌에는 -PathType Leaf 가 빠지고(폴더가 파일로 통과한다), 그 실수는 드롭·복구 뒤에야 터진다(R4)');
    }
    //  ★ 2026-09-11 적대 검토(R5) — Resolve-Path 의 결과는 **.ProviderPath** 로 받는다. PSDrive 가 없는
    //    경로(UNC)에서 .Path 는 공급자 한정 문자열(Microsoft.PowerShell.Core\FileSystem::…)이라
    //    [IO.File]::ReadAllText 도 `cmd /c … < "경로"` 도 열지 못한다 — '경로를 굳히는' 한 줄이 정작
    //    그 경로를 **못 여는 꼴**로 바꿔 놓고, 그 사실은 복구 뒤(9-7 스모크 · 8단계 권한 적용)에 드러난다.
    const resolved = [...ps.matchAll(/\(Resolve-Path[^()]*\)\.(\w+)/g)];
    assert.ok(resolved.length >= 3,
      `Resolve-Path 결과를 쓰는 자리를 ${resolved.length} 개만 찾았다 — 셋(-DeployConfigPath · 지정 05-grants · 형제 폴더)이어야 한다(측정 불가 ≠ 통과)`);
    for (const m of resolved) {
      assert.strictEqual(m[1], 'ProviderPath',
        `Resolve-Path 결과를 .${m[1]} 로 받는다 — UNC 경로에서 그 값은 공급자 한정 문자열이라 ` +
        '.NET 도 cmd 리다이렉션도 열지 못한다(.ProviderPath 는 언제나 네이티브 경로다 · R5)');
    }
    //  ★ 2026-09-11 적대 검토(R3) — 경로는 **글자 그대로** 본다(-LiteralPath). `[`·`]`·`*` 가 든 경로를
    //    와일드카드로 읽으면 있는 파일을 "없다" 고 하거나(맨 앞에서 헛되이 죽는다) 엉뚱한 파일을 고른다.
    for (const v of ['UserGrantsPath', 'AppCnfPath', 'DeployConfigPath', 'appUserSql', 'grantsSql', 'c',
                     'DumpPath', 'CnfPath']) {
      assert.ok(!new RegExp(`(Test-Path|Resolve-Path) \\$${v}\\b`).test(ps),
        `$${v} 를 -LiteralPath 없이 본다 — 대괄호·별표가 든 경로를 와일드카드로 읽는다(R3 → R4)`);
    }
    //  ★ 2026-09-11 적대 검토(R4) — 그 경로들은 **인자 뒤엉킴 방어도 빠짐없이** 지나야 한다.
    //    AssertNoSwallow 의 정규식은 -AppCnfPath·-DeployConfigPath 의 이름을 이미 알고 있었는데 정작
    //    호출이 없었다 — 삼켜진 값이 그대로 존재 확인까지 내려가 '경로가 없다' 는 엉뚱한 이유로 죽었고,
    //    사람은 있지도 않은 오타를 찾았다. 이름을 아는 인자는 전부 실제로 검사한다.
    for (const p of ['DumpPath', 'BackupDir', 'BaseDir', 'CnfPath', 'TargetDb', 'LiveDb',
                     'UserGrantsPath', 'AppCnfPath', 'DeployConfigPath']) {
      assert.ok(new RegExp(`AssertNoSwallow "-${p}" +\\$${p}\\b`).test(ps),
        `-${p} 가 AssertNoSwallow 를 지나지 않는다 — 뒤엉켜 삼켜진 값이 엉뚱한 이유로 죽는다(R4)`);
    }
    //  ★ 2026-09-11 적대 검토(R3) — **쓰는 자리에서도 한 번 더 본다.** 맨 앞 검증과 8단계 사이는 몇 분
    //    (덤프 주입)이고, 그 사이에 파일이 사라지면 Resolve-Path 가 아무것도 못 돌려줘 FindUserGrants 가
    //    $null 이 된다 — 호출부는 그것을 '형제 폴더에 없음' 경고로 읽는다. 정확히 R6 이 막으려던 거짓말이
    //    맨 앞 검증을 통과한 경로로 되살아난다. 그래서 지정 경로는 여기서도 Die 로 끝난다.
    //    ★ 재확인도 맨 앞 검증과 **같은 한 벌**(RequireFile)이다(R4) — 여기만 맨 Test-Path 로 남으면
    //      대괄호·폴더 갈래가 이 자리에서만 다시 열린다.
    const iRecheck = fugBody.indexOf('RequireFile "-UserGrantsPath 로 지정한 05-grants.sql" $UserGrantsPath "(시작할 때는');
    assert.ok(iRecheck >= 0,
      '쓰는 자리(FindUserGrants)에서 지정 경로의 존재를 다시 보지 않는다 — 그 사이에 사라지면 ' +
      "'형제 폴더에 없음' 경고로 둔갑한다(R3 → R4)");
    //    ★ 'return $null' 은 이 함수의 주석에도 적혀 있다(무엇이 경고 갈래인지 설명한다) —
    //      자리를 재는 기준은 **코드 줄**이어야 한다(주석 줄은 '  #' 으로 시작한다).
    assert.ok(iRecheck < fugBody.search(/\n  return \$null/),
      '재확인이 경고 갈래(return $null)보다 뒤에 있다 — 지정 경로의 부재가 형제 폴더 경고로 새 나간다(R3)');
    assert.ok(/\n  return \$null\n\}/.test(ps),
      '기본 탐색(형제 폴더)의 부재까지 죽이면 비공개 저장소가 없는 PC 에서 캘린더 복구 자체가 막힌다 — 그쪽은 경고여야 한다');

    assert.ok(/function WriteUserGrantsHowto\(\)\{[\s\S]{0,800}?복구방법\.txt/.test(ps),
      '같은 경고를 복구방법.txt 에 남기는 자리가 없다 — 화면은 스크롤로 사라진다');
  },

  // ⑤ .ps1 과 .cmd 의 종료코드 표가 글자 그대로 같다.
  exitCodeTablesMatch(ps, cmd) {
    const a = exitCodeTable(ps, false);
    const b = exitCodeTable(cmd, true);
    assert.ok(a.length >= 8, `종료코드 표가 너무 짧다(${a.length}줄) — 표가 비면 대조가 성립하지 않는다`);
    assert.strictEqual(a.length, b.length,
      `종료코드 표의 줄 수가 다르다(.ps1 ${a.length} / .cmd ${b.length})`);
    for (let i = 0; i < a.length; i++) {
      assert.strictEqual(a[i], b[i],
        `종료코드 표 ${i + 1}번째 줄이 다르다\n  .ps1: ${a[i]}\n  .cmd: ${b[i]}`);
    }
    // 표에 적힌 숫자와 스크립트 안의 $EXIT_* 상수가 어긋나면, 표는 맞는데 코드가 딴 값을 낸다.
    const declared = new Map();
    for (const m of ps.matchAll(/^\$(EXIT_[A-Z_]+)\s*=\s*(\d+)/gm)) declared.set(m[1], Number(m[2]));
    assert.ok(declared.size >= 8, `$EXIT_* 상수를 ${declared.size}개밖에 못 찾았다 — 숫자가 코드에 흩어져 있다`);
    const inTable = a.slice(1, -1).map((l) => Number(/^(\d+)\s/.exec(l)?.[1]));
    assert.deepStrictEqual(inTable, [...new Set(declared.values())].sort((x, y) => x - y),
      `표의 코드 목록과 $EXIT_* 상수 값이 다르다 (표 ${inTable.join(',')} / 상수 ${[...declared.values()].join(',')})`);
  },

  // ⑥ 라이브에 못 붙으면 '검증 못 함' — 통과가 아니다.
  cannotVerifyIsNotAPass(ps) {
    assert.ok(/\$EXIT_NOBASELINE\s*=\s*7/.test(ps),
      "'검증 못 함' 전용 종료코드가 없다 — 판정 불가와 통과가 호출자에게 같아 보인다");
    assert.ok(/if\(-not \$liveExists\)\{[\s\S]{0,300}?검증 못 함 — 라이브/.test(ps),
      "라이브가 없을 때 '검증 못 함'으로 표시하는 분기가 없다");
    assert.ok(/\$script:unknown \+= \$label/.test(ps),
      "'검증 못 함' 항목을 따로 모으는 자리가 없다 — 모으지 않으면 판정에 반영되지 않는다");
    assert.ok(/Warn "검증 못 함 — 아래 항목은 판정하지 않았습니다\./.test(ps),
      "'검증 못 함' 을 사람에게 알리는 자리가 없다");
    assert.ok(/if\(-not \$DropTarget\)\{ Cleanup; exit \$EXIT_NOBASELINE \}/.test(ps),
      "'검증 못 함' 이 있는데도 0(성공)으로 끝난다 — 판정 불가를 통과로 세고 있다");
    // 스모크 자격을 못 구한 경우도 통과가 아니라 '검증 못 함' 이어야 한다.
    assert.ok(/앱 계정 자격을 못 구했습니다/.test(ps),
      '앱 스모크 자격을 못 구했을 때 조용히 넘어간다 — 그 상태는 통과가 아니다');
  },

  // ⑧ ★ stdin 첫 줄 읽기에 상한이 있다 — 무인 실행이 영원히 멎지 않는다.
  //    2026-09-07 실측: 파이프가 열린 채 비어 있으면 [Console]::In.ReadLine() 이 돌아오지 않아
  //    -WhatIf 가 5분이 지나도 끝나지 않았다. 무한 대기는 실패와 달리 아무 신호도 내지 않는다.
  stdinReadIsBounded(ps) {
    // (a) 상한 값이 상수로 있고, 사람이 기다릴 수 있는 범위다. 0(즉시 만료)도 무한도 아니다.
    const m = /^\$STDIN_WAIT_SEC\s*=\s*(\d+)/m.exec(ps);
    assert.ok(m, 'stdin 읽기 상한 상수($STDIN_WAIT_SEC)가 없다 — 상한 없는 읽기는 무인 실행을 멈춰 세운다');
    const sec = Number(m[1]);
    assert.ok(sec >= 1 && sec <= 60,
      `stdin 읽기 상한이 ${sec}초다 — 1~60초 사이여야 한다(0 이면 정상 파이프도 못 읽고, 너무 길면 무한 대기와 다를 바 없다)`);

    // (b) 상한 있는 읽기 함수가 실재하고, 완료 대기에 **인자 있는** WaitOne 을 쓴다.
    //     WaitOne() 은 무한 대기다 — 인자가 없으면 함수 이름만 바뀐 채 결함이 그대로 남는다.
    const fn = /function ReadStdinLineBounded\(\[int\]\$timeoutSec\)\{([\s\S]*?)\n\}\n/.exec(ps);
    assert.ok(fn, 'ReadStdinLineBounded 함수가 없다 — 상한 있는 stdin 읽기가 통째로 사라졌다');
    const body = fn[1];
    assert.ok(/\$stdin\.BeginRead\(/.test(body),
      '비동기 읽기(BeginRead)를 쓰지 않는다 — PS 5.1 의 동기 읽기에는 상한을 걸 수 없다');
    assert.ok(/AsyncWaitHandle\.WaitOne\(\$?[A-Za-z_][A-Za-z0-9_]*\)/.test(body),
      '완료 대기에 상한 인자가 없다(WaitOne() 은 무한 대기다) — 결함이 그대로 남는다');
    assert.ok(/\$res\.TimedOut = \$true/.test(body),
      '상한 초과를 호출자에게 알리는 자리가 없다 — 알리지 않으면 빈 비번과 구별되지 않는다');

    // (c) 무한 대기의 원인이던 동기 읽기가 코드에 남아 있으면 안 된다(주석의 설명은 세지 않는다).
    const code = maskPs(ps);
    assert.ok(!/\[Console\]::In\.ReadLine\(\)/.test(code),
      '상한 없는 [Console]::In.ReadLine() 이 코드에 남아 있다 — 이것이 무한 대기의 원인이었다');

    // (d) 상한을 넘기면 **끝낸다**. 경고만 하고 계속 가면 침묵이 그대로다.
    assert.ok(/if\(\$r\.TimedOut\)\{\n\s*Die "stdin 첫 줄을 \$STDIN_WAIT_SEC 초 안에 받지 못했습니다/.test(ps),
      '상한을 넘겨도 Die 로 끝내지 않는다 — 무인 호출자에게 아무 신호도 가지 않는다');
    // 종료코드는 '설정 문제'(2) 여야 한다 — 자격을 못 구한 것이지 복구가 실패한 것이 아니다.
    const die = /Die "stdin 첫 줄을 [^\n]*?" (\$EXIT_[A-Z_]+)/.exec(ps);
    assert.ok(die, '상한 초과 Die 의 종료코드를 읽지 못했다');
    assert.strictEqual(die[1], '$EXIT_CONFIG',
      `상한 초과가 ${die[1]} 로 끝난다 — 자격을 못 구한 것은 '설정 문제'($EXIT_CONFIG)다`);

    // (e) 사람이 다음에 무엇을 해야 하는지 메시지에 적혀 있다.
    assert.ok(/받지 못했습니다\(파이프가 열린 채 비어 있습니다\)\. 무인 실행이면 -CnfPath 를 주거나 \$ADMIN_PW_ENV 를 설정하세요\./.test(ps),
      '상한 초과 메시지가 조치(-CnfPath / 환경변수)를 알려 주지 않는다');
  },

  // ⑨ ★ 자격 획득 순서 — .cnf 와 환경변수가 stdin 보다 앞선다.
  //    앞서지 않으면, 자격을 이미 갖고 있는 무인 호출자도 stdin 앞에서 상한만큼 서게 된다.
  credentialOrderPrefersCnfAndEnv(ps) {
    const code = maskPs(ps);   // 순서는 '코드' 의 순서다. 주석에 적힌 순서는 순서가 아니다.

    // 환경변수 이름은 상수 한 곳에서 정한다(에러 메시지·머리말·README 가 같은 글자를 가리키게).
    const envName = /^\$ADMIN_PW_ENV\s*=\s*"([A-Z_][A-Z0-9_]*)"/m.exec(ps);
    assert.ok(envName, '환경변수 이름 상수($ADMIN_PW_ENV)가 없다 — 이름이 흩어지면 사람이 못 찾는다');
    assert.ok(ps.slice(0, ps.indexOf('#>')).includes(envName[1]),
      `머리말이 환경변수 이름(${envName[1]})을 적어 두지 않았다 — 무인 호출자가 읽는 곳은 머리말이다`);

    // ② 기본 .cnf 자리 관례 — backup-taskmgr.ps1 과 같은 %ProgramData%\taskmgr\ 아래.
    const iDefaultCnf = code.indexOf('$defaultCnf = Join-Path $env:ProgramData');
    assert.ok(iDefaultCnf >= 0,
      '기본 .cnf(%ProgramData%\\taskmgr\\restore-taskmgr.cnf)를 찾는 자리가 없다 — 무인 실행의 1순위 통로가 없다');
    assert.ok(/if\(-not \$CnfPath -and \(Test-Path \$defaultCnf\)\)\{\n\s*\$CnfPath = \$defaultCnf/.test(code),
      '기본 .cnf 가 있어도 쓰지 않는다 — 찾기만 하고 쓰지 않으면 아무 일도 안 한 것이다');

    // ③ 환경변수 · ④ stdin — 코드 순서가 환경변수 → stdin 이어야 한다.
    const iEnv = code.indexOf('$envPw = [Environment]::GetEnvironmentVariable($ADMIN_PW_ENV)');
    assert.ok(iEnv >= 0, `환경변수(${envName[1]})를 읽는 자리가 없다 — 무인 호출자가 값을 넘길 통로가 없다`);
    const iStdin = code.indexOf('$r = ReadStdinLineBounded $STDIN_WAIT_SEC');
    assert.ok(iStdin >= 0, 'stdin 첫 줄을 읽는 자리를 찾지 못했다');
    assert.ok(iDefaultCnf < iEnv,
      `자격 획득 순서가 뒤집혔다 — 기본 .cnf(${iDefaultCnf})가 환경변수(${iEnv})보다 뒤에 있다`);
    assert.ok(iEnv < iStdin,
      `자격 획득 순서가 뒤집혔다 — 환경변수(${iEnv})를 stdin(${iStdin})보다 나중에 본다. ` +
      '그러면 자격을 이미 가진 무인 호출자도 stdin 앞에서 상한만큼 서게 된다');

    // 순서만 맞고 분기가 죽어 있으면(if($false)) 아무 소용이 없다 — 구조까지 본다.
    assert.ok(/if\(-not \[string\]::IsNullOrEmpty\(\$envPw\)\)\{[\s\S]{0,400}?\} elseif\(\[Console\]::IsInputRedirected\)\{/.test(code),
      '환경변수 분기가 stdin 분기보다 앞선 elseif 사슬이 아니다 — 둘 다 실행되거나 순서가 무의미해진다');

    // ① -CnfPath / ② 기본 .cnf 를 쓰는 갈래에서는 stdin 을 **아예 읽지 않는다**.
    const cnfBranch = /\nif\(\$CnfPath\)\{([\s\S]*?)\n\} else \{/.exec(code);
    assert.ok(cnfBranch, '.cnf 를 쓰는 분기를 찾지 못했다');
    assert.ok(!/ReadStdinLineBounded|IsInputRedirected|Read-Host/.test(cnfBranch[1]),
      '.cnf 가 있는데도 stdin 을 읽는다 — 자격이 이미 있는데 파이프를 기다릴 이유가 없다');

    // 대화형(⑤)은 그대로 물어본다 — 사람이 보고 있으니 기다려도 된다.
    assert.ok(/\} else \{\n[\s\S]{0,200}?\$s = Read-Host "MySQL \$AdminUser 비밀번호" -AsSecureString/.test(code),
      '대화형 질문 갈래가 사라졌다 — 사람이 직접 돌릴 때 물어볼 곳이 없다');
  },
};

export { checks, psSrc, cmdSrc };

// ══ 테스트 ════════════════════════════════════════════════════════════

test('복구 가드 ⓪: 마스커가 실제로 파싱한다(0건이면 아래 ②가 거짓 초록)', () => {
  const code = maskPs(psSrc);
  assert.strictEqual(code.length, psSrc.length, '마스커가 길이를 바꿨다 — 인덱스가 안 맞는다');
  // 머리말(<# … #>)이 실제로 지워졌는가.
  assert.ok(psSrc.includes('라이브 덮어쓰기 가드'), '준비 실패: 머리말 문구를 못 찾았다');
  assert.ok(!/<#/.test(code), '블록 주석이 지워지지 않았다');
  // 코드는 남아 있는가(전부 지워 버리면 ②가 늘 통과한다).
  assert.ok(/function NameSetDiff/.test(code), '마스커가 코드까지 지웠다');
  // 문자열 '내용'은 일부러 남긴다(위 ★). 대신 따옴표 안의 '#' 이 가짜 주석을 만들지 않는지 본다.
  assert.ok(/Write-Host "\[OK\] \$m"/.test(code) || /\[OK\] \$m/.test(code),
    '문자열 내용이 지워졌다 — 그러면 계약 ②가 정확히 잡아야 할 자리를 못 본다');
  const stripped = psSrc.length - code.replace(/ /g, 'x').length;
  assert.strictEqual(stripped, 0, '마스커가 길이를 바꿨다');
});

test('복구 가드 ①: 라이브 DB 덮어쓰기 거부 가드가 있고 스위치 하나로 열리지 않는다', () =>
  checks.liveOverwriteGuard(psSrc));

test('복구 가드 ②: 비밀번호를 -p<비번> 으로 명령줄에 싣는 자리가 없다', () =>
  checks.noPasswordOnCommandLine(psSrc));

test('복구 가드 ③: 검증이 개수가 아니라 이름 집합을 대조한다', () =>
  checks.verifiesNameSetsNotCounts(psSrc));

test('복구 가드 ④: -Grants 가 create-app-user.sql + grants-calendar.sql 을 둘 다 쓴다', () =>
  checks.grantsPathUsesBothSqlFiles(psSrc));

test('복구 가드 ④-b: -Grants 가 비공개 05-grants.sql 을 찾아 적용하거나 경고를 남긴다', () =>
  checks.grantsPathHandlesPrivateUserGrants(psSrc));

test('복구 가드 ⑤: .ps1 과 .cmd 의 종료코드 표가 줄 단위로 같다', () => {
  checks.exitCodeTablesMatch(psSrc, cmdSrc);
  for (const l of exitCodeTable(psSrc, false)) console.log(`      ${l}`);
});

test('복구 가드 ⑥: 라이브에 못 붙으면 "검증 못 함"으로 끝난다(통과가 아니다)', () =>
  checks.cannotVerifyIsNotAPass(psSrc));

test('복구 가드 ⑦: .cmd 에 비ASCII 가 한 글자도 없다(cmd.exe 바이트 오프셋 사고 방지)', () => {
  const bad = nonAsciiLines(cmdSrc);
  assert.deepStrictEqual(bad, [],
    `restore-taskmgr.cmd 에 비ASCII 가 있다 — cmd.exe 가 코드페이지 65001 에서 배치 재개 위치를 ` +
    `잘못 계산해 주석 조각을 명령으로 실행한다(init-calendar.cmd 로 실측):\n${bad.join('\n')}`);
});

// ══ 변이 주입 — 위 계약이 '정말 우는지' 증명한다 ═══════════
// 주입기 mutate() 는 tests/ps-guard-lib.mjs 에 있다 — 접미사 변이 금지 · 앵커 유일성 단언 ·
// 앵커가 없으면 크게 실패하는 규약을 그 파일이 가진다.

test('변이①: 라이브 덮어쓰기 거부 자체를 없애면 가드 ① 이 실패한다', () => {
  const bad = mutate(psSrc, 'Bad "라이브 덮어쓰기 거부 —', 'Info "그냥 진행합니다 (');
  assert.doesNotThrow(() => checks.liveOverwriteGuard(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.liveOverwriteGuard(bad), /라이브 덮어쓰기 거부 가드가 없다/);
});

test('변이①-b: 이름 타이핑 확인을 없애고 스위치만으로 열면 가드 ① 이 실패한다', () => {
  const bad = mutate(psSrc,
    '  $typed = ""\n  try { $typed = Read-Host "덮어쓸 DB 이름을 입력(\'$LiveDb\')" } catch { $typed = "" }',
    '  $typed = $LiveDb   # 확인 없이 통과');
  assert.throws(() => checks.liveOverwriteGuard(bad), /이름 타이핑 확인이 없다/);
});

test('변이①-c: 타이핑 대조를 대소문자 무시(-cne → -ne)로 낮추면 가드 ① 이 실패한다', () => {
  const bad = mutate(psSrc, 'if("$typed" -cne "$LiveDb"){', 'if("$typed" -ne "$LiveDb"){');
  assert.throws(() => checks.liveOverwriteGuard(bad), /대소문자까지\(-cne\) 대조하지 않는다/);
});

test('변이①-d: 비대화형 거부를 없애면(무인 실행에 문이 열리면) 가드 ① 이 실패한다', () => {
  const bad = mutate(psSrc,
    '  if([Console]::IsInputRedirected){\n    Write-Host "  -OverwriteLive 가 있지만 stdin 이 리다이렉트돼 있습니다(비대화형)."',
    '  if($false){\n    Write-Host "  (비대화형 거부를 없앤 변이)"');
  assert.throws(() => checks.liveOverwriteGuard(bad), /비대화형\(stdin 리다이렉트\)에서도 라이브 덮어쓰기가 열린다/);
});

test('변이②: 비밀번호를 -p 로 넘기는 자리를 만들면 가드 ② 가 실패한다', () => {
  // 실제로 하기 쉬운 실수 — "간단하게" .cnf 대신 인자로 넘기는 것.
  const bad = mutate(psSrc,
    'function AdminArgs(){ return @("--defaults-extra-file=$adminCnf","--default-character-set=utf8mb4") }',
    'function AdminArgs(){ return @("-u$AdminUser","-p$AdminPw","--default-character-set=utf8mb4") }');
  assert.doesNotThrow(() => checks.noPasswordOnCommandLine(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.noPasswordOnCommandLine(bad), /비밀번호를 명령줄로 넘기는 자리가 생겼다/);
});

test('변이②-b: --password= 꼴도 잡는다', () => {
  const bad = mutate(psSrc,
    '"--defaults-extra-file=$adminCnf","--default-character-set=utf8mb4"',
    '"--user=$AdminUser","--password=$AdminPw"');
  assert.throws(() => checks.noPasswordOnCommandLine(bad), /비밀번호를 명령줄로 넘기는 자리가 생겼다/);
});

test('변이②-c: .cnf 경로가 통째로 사라지면(검사 대상 소멸) 가드 ② 가 실패한다', () => {
  const bad = psSrc.split('--defaults-extra-file=$adminCnf').join('--defaults-file=NONE');
  assert.notStrictEqual(bad, psSrc, '변이 준비 실패: .cnf 인자를 못 찾았다');
  assert.throws(() => checks.noPasswordOnCommandLine(bad), /검사가 볼 대상 자체가 사라졌다/);
});

test('변이③: 이름 집합 대조를 개수 비교로 바꾸면 가드 ③ 이 실패한다', () => {
  // 개수는 같고 이름이 다를 수 있다 — 이 변이는 바로 그 구멍을 만든다.
  const bad = mutate(psSrc,
    '  return @{\n    Missing = @($e | Where-Object { $a -notcontains $_ })\n    Extra   = @($a | Where-Object { $e -notcontains $_ })\n  }',
    '  if($e.Count -eq $a.Count){ return @{ Missing = @(); Extra = @() } }\n  return @{ Missing = @("개수가 다름"); Extra = @() }');
  assert.doesNotThrow(() => checks.verifiesNameSetsNotCounts(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.verifiesNameSetsNotCounts(bad), /뽑지 않는다|개수 비교로 바뀌었다/);
});

test('변이③-b: 트리거를 이름 대조 대상에서 빼면 가드 ③ 이 실패한다', () => {
  const bad = mutate(psSrc,
    'CheckNames "트리거 이름"      $liveTrigs  $gotTrigs\n',
    '');
  assert.throws(() => checks.verifiesNameSetsNotCounts(bad), /이름 집합으로 대조하는 대상이 바뀌었다/);
});

test('변이③-c: 행 수를 COUNT(*) 대신 추정치로 바꾸면 가드 ③ 이 실패한다', () => {
  // information_schema.TABLE_ROWS 는 InnoDB 에서 추정치다 — 대조에 쓰면 조용히 어긋난다.
  const bad = mutate(psSrc, "COUNT(*) AS n FROM", "TABLE_ROWS AS n FROM information_schema.TABLES t --");
  assert.throws(() => checks.verifiesNameSetsNotCounts(bad), /COUNT\(\*\) 로 세지 않는다/);
});

test('변이④: -Grants 가 grants-calendar.sql 을 안 쓰면 가드 ④ 가 실패한다', () => {
  // 이게 복구방법.txt 4번의 사고 그 자체다 — 계정만 만들고 cal_* 권한을 안 주면
  // 표와 데이터가 다 있는데 위젯이 첫 조회에서 ERROR 1142 로 죽는다(2026-09-07 실측).
  const bad = mutate(psSrc,
    '$grantsSql  = Join-Path $scriptDir "grants-calendar.sql"',
    '$grantsSql  = $null   # cal_* 권한을 건너뛴다');
  assert.doesNotThrow(() => checks.grantsPathUsesBothSqlFiles(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.grantsPathUsesBothSqlFiles(bad), /grants-calendar\.sql 을 가리키는 자리가 없다/);
});

test('변이④-b: 하드코딩된 DB 이름을 대상에 맞추는 자리를 없애면 가드 ④ 가 실패한다', () => {
  // 없애면 리허설이 **라이브 계정 권한**을 건드린다(두 SQL 은 ON taskmgr.<표> 를 글자로 박아 뒀다).
  // 앵커는 1회만 나와야 한다. `if($TargetDb -ne $grantSchema){` 자체는 두 곳(치환 · REVOKE 안내)에
  // 있으므로 뒤 문구까지 붙여 자리를 특정한다.
  const bad = mutate(psSrc,
    '  if($TargetDb -ne $grantSchema){\n    Warn "대상이',
    '  if($false){\n    Warn "대상이');
  assert.throws(() => checks.grantsPathUsesBothSqlFiles(bad), /리허설이 라이브 권한을 건드린다/);
});

test('변이④-c: 세 번째 정본(05-grants.sql) 적용을 빼면 가드 ④-b 가 실패한다', () => {
  // 2026-09-10 리뷰가 잡은 실제 구멍이다 — 두 파일만 돌린 복구본은 조회는 되고 쓰기만 죽는다.
  const bad = mutate(psSrc,
    '  $userGrants = FindUserGrants',
    '  $userGrants = $null   # app_user 권한을 건너뛴다');
  assert.doesNotThrow(() => checks.grantsPathHandlesPrivateUserGrants(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /05-grants\.sql 을 찾지 않는다/);
});

test('변이④-d: 못 찾았을 때의 경고를 없애면 가드 ④-b 가 실패한다', () => {
  // '조용한 실패' 가 가장 나쁘다 — 경고가 없으면 복구는 exit 0 으로 끝나고 아무도 모른다.
  const bad = mutate(psSrc, '\n    WriteUserGrantsHowto\n', '\n    # (경고를 남기지 않는다)\n');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /경고를 남기지 않는다/);
});

test('변이④-e: -UserGrantsPath 매개변수를 없애면 가드 ④-b 가 실패한다', () => {
  const bad = mutate(psSrc, '[string]$UserGrantsPath = ""', '[string]$UnusedGrantsPath = ""');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /-UserGrantsPath 매개변수가 없다/);
});

test('변이⑤: .cmd 의 종료코드 한 줄만 손대도 가드 ⑤ 가 실패한다', () => {
  const bad = mutate(cmdSrc,
    'rem    6 refused - live-overwrite guard tripped; nothing was changed',
    'rem    6 refused - guard tripped');
  assert.doesNotThrow(() => checks.exitCodeTablesMatch(psSrc, cmdSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.exitCodeTablesMatch(psSrc, bad), /번째 줄이 다르다/);
});

test('변이⑤-b: 한쪽에서 코드 한 줄을 지우면 줄 수 대조가 실패한다', () => {
  const bad = mutate(cmdSrc,
    'rem    7 cannot verify - no live baseline to compare against; this is NOT a pass\n',
    '');
  assert.throws(() => checks.exitCodeTablesMatch(psSrc, bad), /줄 수가 다르다/);
});

test('변이⑤-c: 표는 그대로 두고 상수만 바꾸면(표가 거짓말하면) 가드 ⑤ 가 실패한다', () => {
  const bad = mutate(psSrc, '$EXIT_NOBASELINE = 7', '$EXIT_NOBASELINE = 9');
  assert.throws(() => checks.exitCodeTablesMatch(bad, cmdSrc), /표의 코드 목록과 \$EXIT_\* 상수 값이 다르다/);
});

test('변이⑥: "검증 못 함"을 통과(0)로 바꾸면 가드 ⑥ 이 실패한다', () => {
  const bad = mutate(psSrc,
    'if(-not $DropTarget){ Cleanup; exit $EXIT_NOBASELINE }',
    'if(-not $DropTarget){ Cleanup; exit $EXIT_OK }');
  assert.doesNotThrow(() => checks.cannotVerifyIsNotAPass(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.cannotVerifyIsNotAPass(bad), /판정 불가를 통과로 세고 있다/);
});

test('변이⑥-b: 라이브 부재 분기를 없애면 가드 ⑥ 이 실패한다', () => {
  const bad = mutate(psSrc,
    '  if(-not $liveExists){\n    Row "unk" $label "검증 못 함 — 라이브',
    '  if($false){\n    Row "ok" $label "통과 — 라이브');
  assert.throws(() => checks.cannotVerifyIsNotAPass(bad), /'검증 못 함'으로 표시하는 분기가 없다/);
});

test('변이⑥-c: "검증 못 함" 항목을 모으지 않으면(판정에 반영 안 되면) 가드 ⑥ 이 실패한다', () => {
  const bad = mutate(psSrc, '    $script:unknown += $label\n', '');
  assert.throws(() => checks.cannotVerifyIsNotAPass(bad), /따로 모으는 자리가 없다/);
});

test('변이⑦: 주석 안의 -p 를 세면 안 된다(마스커 회귀)', () => {
  // restore-taskmgr.ps1 의 머리말은 '-p<pw> 를 쓰지 마라'고 설명하느라 그 문자열을 담는다.
  // 마스커가 없으면 가드 ②가 자기 설명문에 걸려 늘 빨간불이 되고, 그러면 사람이 검사를 헐겁게 고친다.
  const noise = psSrc +
    '\n# 줄 주석 안의 -p비밀번호 와 --password=x 는 세지 않는다(설명용).\n' +
    '<#\n  블록 주석 안의 -p<pw> 도 마찬가지다.\n#>\n';
  assert.doesNotThrow(() => checks.noPasswordOnCommandLine(noise),
    '마스커가 주석 안의 -p 를 코드로 셌다');
  // ★ 반대로 **문자열 리터럴 안**은 일부러 코드로 센다. PowerShell 에서 명령 인자는 문자열이라
  //   ("-p$pw") 문자열을 봐주면 정확히 잡아야 할 자리를 못 본다. 안내 문구에 -p 를 적고 싶으면
  //   주석에 적을 것 — 그것이 이 저장소의 규약이다.
  const inString = psSrc + '\n$안내 = "mysql -p비밀번호 는 쓰지 마세요"\n';
  assert.throws(() => checks.noPasswordOnCommandLine(inString),
    /비밀번호를 명령줄로 넘기는 자리가 생겼다/);
  // 진짜 코드 자리에 넣으면 당연히 잡아야 한다(마스커가 전부 지워 버리지 않았다는 증거).
  const real = psSrc + '\n& $mysql "-p$AdminPw" "-e" "SELECT 1;"\n';
  assert.throws(() => checks.noPasswordOnCommandLine(real), /비밀번호를 명령줄로 넘기는 자리가 생겼다/);
});

test('복구 가드 ⑧: stdin 첫 줄 읽기에 상한이 있다(무인 실행 무한 대기 회귀)', () =>
  checks.stdinReadIsBounded(psSrc));

test('복구 가드 ⑨: 자격 획득 순서에서 .cnf·환경변수가 stdin 보다 앞선다', () =>
  checks.credentialOrderPrefersCnfAndEnv(psSrc));

test('복구 가드 ⑩: 환경변수 이름이 스크립트·머리말·README 셋에 같은 글자로 적혀 있다', () => {
  // 이름이 한 곳에서만 바뀌면 무인 호출자는 '설정했는데 안 먹는' 상태에 빠지고,
  // 그때 스크립트는 상한만큼 기다렸다가 코드 2 로 죽는다 — 원인은 아무 데도 안 적혀 있다.
  const m = /^\$ADMIN_PW_ENV\s*=\s*"([A-Z_][A-Z0-9_]*)"/m.exec(psSrc);
  assert.ok(m, '환경변수 이름 상수($ADMIN_PW_ENV)가 없다');
  const name = m[1];
  const readme = loadDeploy('README.md');
  assert.ok(readme.includes(name),
    `db/deploy/README.md 에 환경변수 이름(${name})이 없다 — 무인 실행 방법을 읽는 곳은 README 다`);
  assert.ok(readme.includes('restore-taskmgr.cnf'),
    'README 에 기본 .cnf 경로(restore-taskmgr.cnf)가 없다 — ①②③ 중 첫 통로를 아무도 못 찾는다');
  console.log(`      환경변수 = ${name} · 기본 .cnf = %ProgramData%\\taskmgr\\restore-taskmgr.cnf · 상한 = ${/^\$STDIN_WAIT_SEC\s*=\s*(\d+)/m.exec(psSrc)[1]}초`);
});

test('변이⑧: WaitOne 의 상한 인자를 빼면(무한 대기) 가드 ⑧ 이 실패한다', () => {
  // 이것이 정확히 고치기 전의 상태다 — 파이프가 열린 채 비어 있으면 영원히 돌아오지 않는다.
  const bad = mutate(psSrc,
    'if(-not $ar.AsyncWaitHandle.WaitOne($leftMs)){ $res.TimedOut = $true; return $res }',
    'if(-not $ar.AsyncWaitHandle.WaitOne()){ $res.TimedOut = $true; return $res }');
  assert.doesNotThrow(() => checks.stdinReadIsBounded(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.stdinReadIsBounded(bad), /완료 대기에 상한 인자가 없다/);
});

test('변이⑧-b: 상한 있는 읽기를 옛 [Console]::In.ReadLine() 으로 되돌리면 가드 ⑧ 이 실패한다', () => {
  const bad = mutate(psSrc,
    '    $r = ReadStdinLineBounded $STDIN_WAIT_SEC\n',
    '    $r = @{ Line = [Console]::In.ReadLine(); TimedOut = $false }\n');
  assert.throws(() => checks.stdinReadIsBounded(bad),
    /\[Console\]::In\.ReadLine\(\) 이 코드에 남아 있다/);
});

test('변이⑧-c: 상한 값을 0(또는 하루)으로 바꾸면 가드 ⑧ 이 실패한다', () => {
  const zero = mutate(psSrc, '$STDIN_WAIT_SEC = 10', '$STDIN_WAIT_SEC = 0');
  assert.throws(() => checks.stdinReadIsBounded(zero), /1~60초 사이여야 한다/);
  const day = mutate(psSrc, '$STDIN_WAIT_SEC = 10', '$STDIN_WAIT_SEC = 86400');
  assert.throws(() => checks.stdinReadIsBounded(day), /1~60초 사이여야 한다/);
});

test('변이⑧-d: 상한을 넘겨도 Die 하지 않고 경고만 하면 가드 ⑧ 이 실패한다', () => {
  // 무인 실행에서 '경고 후 계속' 은 침묵과 같다 — 아무도 그 화면을 안 본다.
  const bad = mutate(psSrc,
    '      Die "stdin 첫 줄을 $STDIN_WAIT_SEC 초 안에 받지 못했습니다',
    '      Warn "stdin 첫 줄을 $STDIN_WAIT_SEC 초 안에 받지 못했습니다');
  assert.throws(() => checks.stdinReadIsBounded(bad), /Die 로 끝내지 않는다/);
});

test('변이⑧-e: 상한 초과를 코드 2 가 아닌 값으로 끝내면 가드 ⑧ 이 실패한다', () => {
  const bad = mutate(psSrc,
    '(파이프가 열린 채 비어 있습니다). 무인 실행이면 -CnfPath 를 주거나 $ADMIN_PW_ENV 를 설정하세요." $EXIT_CONFIG',
    '(파이프가 열린 채 비어 있습니다). 무인 실행이면 -CnfPath 를 주거나 $ADMIN_PW_ENV 를 설정하세요." $EXIT_OK');
  assert.throws(() => checks.stdinReadIsBounded(bad), /설정 문제.*\$EXIT_CONFIG/s);
});

test('변이⑨: 환경변수 조회를 stdin 읽기 뒤로 옮기면 가드 ⑨ 가 실패한다', () => {
  // 순서가 뒤집히면 자격을 이미 가진 무인 호출자도 stdin 앞에서 상한만큼 서게 된다.
  const line = '  $envPw = [Environment]::GetEnvironmentVariable($ADMIN_PW_ENV)\n';
  let bad = mutate(psSrc, line, '  $envPw = $null\n');
  bad = mutate(bad, '    $pwFrom = "stdin 첫 줄"\n', '    $pwFrom = "stdin 첫 줄"\n' + line);
  assert.doesNotThrow(() => checks.credentialOrderPrefersCnfAndEnv(psSrc), '원본은 통과해야 한다');
  assert.throws(() => checks.credentialOrderPrefersCnfAndEnv(bad),
    /환경변수\(\d+\)를 stdin\(\d+\)보다 나중에 본다/);
});

test('변이⑨-b: 기본 .cnf 를 찾기만 하고 쓰지 않으면 가드 ⑨ 가 실패한다', () => {
  const bad = mutate(psSrc,
    'if(-not $CnfPath -and (Test-Path $defaultCnf)){\n  $CnfPath = $defaultCnf',
    'if($false){\n  $unused = $defaultCnf');
  assert.throws(() => checks.credentialOrderPrefersCnfAndEnv(bad), /기본 \.cnf 가 있어도 쓰지 않는다/);
});

test('변이⑨-c: .cnf 가 있는데도 stdin 을 읽게 만들면 가드 ⑨ 가 실패한다', () => {
  const bad = mutate(psSrc,
    '  $adminCnf = $CnfPath\n',
    '  $null = ReadStdinLineBounded $STDIN_WAIT_SEC\n  $adminCnf = $CnfPath\n');
  assert.throws(() => checks.credentialOrderPrefersCnfAndEnv(bad),
    /\.cnf 가 있는데도 stdin 을 읽는다/);
});

test('변이⑨-d: 환경변수 분기를 죽이면(if($false)) 가드 ⑨ 가 실패한다', () => {
  const bad = mutate(psSrc,
    '  if(-not [string]::IsNullOrEmpty($envPw)){',
    '  if($false){');
  assert.throws(() => checks.credentialOrderPrefersCnfAndEnv(bad),
    /elseif 사슬이 아니다/);
});

test('변이⑨-e: 머리말에서 환경변수 이름을 지우면 가드 ⑨ 가 실패한다', () => {
  // 머리말은 무인 호출자가 실제로 읽는 곳이다. 코드에만 있고 문서에 없으면 아무도 못 쓴다.
  const head = psSrc.slice(0, psSrc.indexOf('#>'));
  const rest = psSrc.slice(psSrc.indexOf('#>'));
  const bad = head.split('TASKMGR_ADMIN_PW').join('<그 환경변수>') + rest;
  assert.notStrictEqual(bad, psSrc, '변이 준비 실패: 머리말에서 이름을 못 찾았다');
  assert.throws(() => checks.credentialOrderPrefersCnfAndEnv(bad),
    /머리말이 환경변수 이름/);
});

//  ★ 2026-09-11 적대 검토(R4) — 확인이 RequireFile 한 벌로 모였으므로 변이도 그 한 벌을 겨눈다.
const RF_UG = 'RequireFile "-UserGrantsPath 로 지정한 05-grants.sql" $UserGrantsPath ' +
  '"(경로를 확인하거나, 형제 폴더에서 찾게 하려면 이 인자를 빼고 실행하세요)"';

test('변이④-f: 지정한 -UserGrantsPath 가 없을 때 죽지 않고 경고로 떨어지면 가드 ④-b 가 실패한다(R6)', () => {
  const bad = mutate(psSrc, '  ' + RF_UG + '\n', '');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /그 경로를 이름으로 말하며 죽지 않는다/);
  assert.doesNotThrow(() => checks.grantsPathHandlesPrivateUserGrants(psSrc));   // 통제군
});

test('변이④-g: 그 검증을 8단계(FindUserGrants 안)로 되돌리면 가드 ④-b 가 실패한다(R2 — 갈아엎은 뒤에 죽는다)', () => {
  //  옛 배치를 그대로 되살린다: 맨 앞 검증을 걷어 내고 같은 문장을 8단계의 호출부 앞에 넣는다.
  //  문장은 글자 하나 안 바뀌므로 '그 문장이 있는가' 만 보는 검사는 통과한다 — 자리를 보는 검사만 잡는다.
  const block = 'if($UserGrantsPath){\n  ' + RF_UG + '\n}\n';
  const late  = '  if($UserGrantsPath){\n    ' + RF_UG + '\n  }\n';
  const bad = mutate(mutate(psSrc, block, ''),
    '  $userGrants = FindUserGrants', late + '  $userGrants = FindUserGrants');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /보다 뒤에 있다/);
  assert.doesNotThrow(() => checks.grantsPathHandlesPrivateUserGrants(psSrc));   // 통제군
});

test('변이④-h: -LiteralPath 를 빼면 가드 ④-b 가 실패한다(대괄호가 든 경로를 와일드카드로 읽는다 · R3)', () => {
  const bad = mutate(psSrc,
    'return (Resolve-Path -LiteralPath $UserGrantsPath).ProviderPath',
    'return (Resolve-Path $UserGrantsPath).ProviderPath');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /-LiteralPath 없이 본다/);
  assert.doesNotThrow(() => checks.grantsPathHandlesPrivateUserGrants(psSrc));   // 통제군
});

test('변이④-i: -AppCnfPath 확인을 9-7 스모크 자리로 되돌리면 가드 ④-b 가 실패한다(드롭·복구 뒤에 죽는다 · R3)', () => {
  const call = 'RequireFile "-AppCnfPath 로 지정한 앱 자격 파일" $AppCnfPath ""';
  const blk  = 'if($AppCnfPath){\n  ' + call + '\n}\n';
  const late = '    ' + call + '\n';
  const bad = mutate(mutate(psSrc, blk, ''), '    $smokeCnf = $AppCnfPath', late + '    $smokeCnf = $AppCnfPath');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /보다 뒤에 있다/);
});

test('변이④-j: 직접 준 -DeployConfigPath 를 말없이 건너뛰게 되돌리면 가드 ④-b 가 실패한다(무시된 줄 모른다 · R3)', () => {
  const bad = mutate(psSrc,
    '  RequireFile "-DeployConfigPath 로 지정한 DeployConfig.cs" $DeployConfigPath "(경로를 확인하거나', '  # ');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /-DeployConfigPath\(직접 준 경우\) 존재 확인이 맨 앞/);
});

test('변이④-k: -Grants 두 SQL 확인을 8단계로 되돌리면 가드 ④-b 가 실패한다(이미 DROP 뒤다 · R3)', () => {
  const one = 'RequireFile "create-app-user.sql" $appUserSql "(스크립트 폴더: $scriptDir)"\n';
  const bad = mutate(mutate(psSrc, '  ' + one, ''),
    '  $appUserText = [IO.File]::ReadAllText($appUserSql)', '  ' + one + '  $appUserText = [IO.File]::ReadAllText($appUserSql)');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /보다 뒤에 있다/);
});

test('변이④-l: 쓰는 자리의 재확인을 지우면 가드 ④-b 가 실패한다(실행 중에 사라지면 경고로 둔갑한다 · R3)', () => {
  const bad = mutate(psSrc,
    '    RequireFile "-UserGrantsPath 로 지정한 05-grants.sql" $UserGrantsPath "(시작할 때는', '    # ');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /다시 보지 않는다/);
  assert.doesNotThrow(() => checks.grantsPathHandlesPrivateUserGrants(psSrc));   // 통제군
});

test('변이④-m: RequireFile 에서 -PathType Leaf 를 빼면 가드 ④-b 가 실패한다(폴더가 파일로 통과한다 · R4)', () => {
  //  이 변이가 되살리는 것이 정확히 R4 가 잡은 결함이다 — 폴더를 준 실수는 맨 앞 문을 통과해
  //  mysql 입력 · ReadAllText 자리에서, 곧 **드롭·복구 뒤**에 터졌다.
  const bad = mutate(psSrc,
    'Test-Path -LiteralPath "$path" -PathType Leaf', 'Test-Path -LiteralPath "$path"');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /폴더를 파일로 통과시킨다/);
  assert.doesNotThrow(() => checks.grantsPathHandlesPrivateUserGrants(psSrc));   // 통제군
});

test('변이④-n: -AppCnfPath 의 AssertNoSwallow 를 지우면 가드 ④-b 가 실패한다(삼켜진 값이 그대로 내려간다 · R4)', () => {
  const bad = mutate(psSrc, 'AssertNoSwallow "-AppCnfPath" $AppCnfPath\n', '');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad),
    /-AppCnfPath 가 AssertNoSwallow 를 지나지 않는다/);
  assert.doesNotThrow(() => checks.grantsPathHandlesPrivateUserGrants(psSrc));   // 통제군
});

test('변이④-o: 파일 확인을 손으로 적은 Test-Path 로 한 벌 더 만들면 가드 ④-b 가 실패한다(형태가 갈라진다 · R5)', () => {
  //  R4 가 걷어 낸 그 모양이다 — -PathType Leaf 가 빠진 벌이 생기면 폴더를 준 실수가 맨 앞 문을
  //  그냥 통과해 드롭·복구 뒤(mysql 입력 · ReadAllText)에 터진다. 옛 판의 검사는 이 변이를 못 잡았다
  //  (`ps.slice(iChk).startsWith('RequireFile ')` — iChk 가 바로 그 문자열의 자리라 항상 참이었다).
  const hand = 'if($AppCnfPath -and -not (Test-Path -LiteralPath $AppCnfPath)){ Die "-AppCnfPath 가 없습니다: $AppCnfPath" $EXIT_CONFIG }\n';
  const anchor = 'AssertNoSwallow "-AppCnfPath" $AppCnfPath\n';
  const bad = mutate(psSrc, anchor, anchor + hand);
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /손으로 적은 Test-Path 갈래가 있다/);
  assert.doesNotThrow(() => checks.grantsPathHandlesPrivateUserGrants(psSrc));   // 통제군
});

test('변이④-p: Resolve-Path 결과를 .Path 로 되돌리면 가드 ④-b 가 실패한다(UNC 에서 못 여는 경로가 된다 · R5)', () => {
  const bad = mutate(psSrc,
    '$DeployConfigPath = (Resolve-Path -LiteralPath $DeployConfigPath).ProviderPath',
    '$DeployConfigPath = (Resolve-Path -LiteralPath $DeployConfigPath).Path');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /Resolve-Path 결과를 \.Path 로 받는다/);
  assert.doesNotThrow(() => checks.grantsPathHandlesPrivateUserGrants(psSrc));   // 통제군
});

test('변이④-q: 형제 폴더 갈래만 .Path 로 되돌려도 가드 ④-b 가 실패한다(세 자리 전부를 본다 · R5)', () => {
  const bad = mutate(psSrc,
    'return (Resolve-Path -LiteralPath $c).ProviderPath',
    'return (Resolve-Path -LiteralPath $c).Path');
  assert.throws(() => checks.grantsPathHandlesPrivateUserGrants(bad), /Resolve-Path 결과를 \.Path 로 받는다/);
});
