namespace TaskCalendarWidget
{
    // ============================================================================
    // ★★★ 배포 구성 — 배포 전 "이 파일 한 곳"만 고치고 빌드한다 ★★★
    // ----------------------------------------------------------------------------
    // 서버 이관·환경 변경 시 여기만 바꾸면 된다. 다른 파일(MainWindow·ProjectDb 등)엔
    // 배포값을 두지 않는다 — 흩어지면 배포 때마다 여러 곳을 뒤져야 하므로.
    //
    // 런타임 오버라이드가 얹히는 값(아래 각주 참고)은 여기 값이 '초기 디폴트'다:
    //   · 업데이트 소스(UpdateSourceUrl): 설정 UI로 바꾸면 widget.settings.json에 저장돼 우선
    //   · DB 연결(Db*): 오버라이드 없음 — 항상 이 베이크 값으로 접속
    //
    // ★ 관리자 초기 자격(AdminId/AdminPw)은 폐지됐다(USER-LOGIN §3.3, 2026-07-30).
    //   공용 비밀번호로 편집을 여는 모델을 없애고, 편집 권한을 '로그인 신원 + app_user.edit_role'로
    //   작업 시점에 판정한다. 그래서 배포본에 심는 관리자 비밀번호가 더는 존재하지 않는다.
    // ============================================================================
    internal static class DeployConfig
    {
        // ── DB 연결 (앱이 붙을 중앙 MySQL) ──────────────────────────────────────
        public const string DbHost     = "localhost";       // 서버 주소 — 폐쇄망 서버 PC의 고정 IP로 교체 (localhost = 이 PC 전용)
        public const int    DbPort     = 3306;              // MySQL 포트 (기본 그대로면 유지)
        public const string DbName     = "taskmgr";         // 데이터베이스명
        // 앱 계정 = 최소권한(project·customer 두 테이블 SELECT/INSERT/UPDATE만). db/deploy/create-app-user.sql 로 생성.
        // 접속정보는 전 사용자에게 배포되므로 root 금지 — 노출돼도 피해가 '앱이 허용하는 것'까지로 제한된다.
        public const string DbUser     = "taskmgr_app";     // DB 계정 (최소권한)
        public const string DbPassword = "taskmgr1234";     // DB 비밀번호 — init-db 실행 시 정한 값과 반드시 일치

        // ── 자동 업데이트 소스 (공유폴더/FTP 경로; 설정 UI로도 지정 가능) ───────────
        public const string UpdateSourceUrl = "";           // 저장소엔 비워둠 — 배포 시 공유폴더 경로(latest.json+Setup exe 위치)
    }
}
