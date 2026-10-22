// 월간보고 단계 A 의 DB 와 그림 명령 정적 계약(docs/MONTHLY-REPORT-PLAN.md §6, §10.1)
//
// 이 파일이 지키는 것:
//   ① 정본과 이관 조각: project_schedule_image 정의가 정본(schema-calendar.sql 16)과 조각(v17)에서 글자까지 같다.
//      project.dev_start_date 의 자리와 형, CHECK chk_project_dev_dates 가 정본(schema-structure.sql)과 조각에서 같다.
//      조각은 16 에서 17 한 칸이고 앱 구조 번호와 정본 시드가 17 이다. FK 는 과제 CASCADE, 등록자 RESTRICT.
//   ② 권한과 배포 도구: grants-calendar.sql, server-app-account.sql, app-account.ps1 이 SELECT, INSERT, UPDATE, DELETE 를 준다.
//      init-calendar.ps1 명부, setup 표 수, 데모가 지우는 표, 사용자 기록 표(UserRecordTables 에 '표.열')에 들어 있다.
//   ③ 백업: backup-taskmgr.ps1(복원 전 안전 덤프, 데모 전 백업도) mysqldump 에 --hex-blob 이 있다.
//   ④ 개발 시작일 배선: ProjectDb 읽기와 쓰기(@dsd), 순서 검사, saveProject 분기, 엑셀 열, 웹 dbCatalog(mapDbRows), 편집 폼과 payload,
//      상세 보기. 선진행 잠금 배열에는 없다(개발종료일과 같은 설계 결정).
//   ⑤ 그림 명령: 추가가 형식(머리 글자와 WPF BitmapDecoder)과 크기(5MB), 과제당 5장을 검사한다. 추가, 삭제, 순서 바꾸기에
//      관리자 검사가 없다(누구나, 의도). 연결은 DbGate.OpenAsync 뿐이고 커밋은 관문 재확인 한 곳. 신원은 세션에서만.
//      PC 사본 파일 이름은 해시와 형식에서만 만든다.
//   ⑥ 메인 창 전용: 그림 명령과 exportMonthlyDocx 가 관리 창, 열람 창 허용 목록(호스트, 웹)에 없고 메인 창 스위치에 case 한 줄씩 있다.
//   그리고 변이: 위 검사들이 실제로 무는지 원본을 고쳐 본다.
import { test, assert, readText, extractCsMember, extractFunction, stripCsComments, loadAppSource } from './harness.mjs';
import { mutate } from './ps-guard-lib.mjs';
import { defOf } from './release-sql-sim.mjs';

const R = (p) => new URL('../' + p, import.meta.url);
const src = {
  sidb: readText(R('widget/ScheduleImageDb.cs')),
  mre: readText(R('widget/MonthlyReportExport.cs')),
  main: readText(R('widget/MainWindow.xaml.cs')),
  appwin: readText(R('widget/AppWindow.cs')),
  gate: readText(R('widget/DbGate.cs')),
  pdb: readText(R('widget/ProjectDb.cs')),
  canon: readText(R('db/deploy/schema-calendar.sql')),
  struct: readText(R('db/deploy/schema-structure.sql')),
  frag: readText(R('db/deploy/migrations/v17-monthly-report.sql')),
  grants: readText(R('db/deploy/grants-calendar.sql')),
  server: readText(R('db/deploy/server-app-account.sql')),
  appAcct: readText(R('db/deploy/app-account.ps1')),
  init: readText(R('db/deploy/init-calendar.ps1')),
  setup: readText(R('db/deploy/setup-taskcalendar.ps1')),
  backup: readText(R('db/deploy/backup-taskmgr.ps1')),
  restore: readText(R('db/deploy/restore-taskmgr.ps1')),
  demoPs: readText(R('db/demo/demo-db.ps1')),
  demoGen: readText(R('db/demo/build-demo-sql.mjs')),
  html: loadAppSource(),
};

const TABLE = 'project_schedule_image';
const COMMANDS = ['scheduleImageList', 'scheduleImageAdd', 'scheduleImageDelete', 'scheduleImageMove', 'scheduleImageThumb'];
const MAIN_ONLY = [...COMMANDS, 'exportMonthlyDocx'];
const CHECK_EXPR = 'dev_start_date IS NULL OR dev_end_date IS NULL OR dev_start_date <= dev_end_date';

const noLineComments = (sql) => sql.split('\n').map((l) => l.replace(/^\s*--.*$/, '')).join('\n');
// 정본의 CREATE TABLE 한 개(머리부터 COMMENT='...' 까지)
function canonDef(canon) {
  const m = new RegExp(`CREATE TABLE ${TABLE} \\(([\\s\\S]*?\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci\\s+COMMENT='[^']*')`).exec(canon);
  assert.ok(m, `정본 schema-calendar.sql 에 ${TABLE} 정의가 없다`);
  return m[1];
}
// 조각의 PREPARE 문자열 안 CREATE TABLE IF NOT EXISTS(작은따옴표를 한 겹으로 되돌린 것)
function fragDef(frag) {
  const m = new RegExp(`SET @s := IF\\(@go,\\n  'CREATE TABLE IF NOT EXISTS ${TABLE} \\(([\\s\\S]*?\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci\\s+COMMENT=''(?:[^']|'')*'')',\\n  'DO 0'\\);\\nPREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;`).exec(frag);
  assert.ok(m, `이관 조각에 ${TABLE} 를 @go 일 때만 IF NOT EXISTS 로 만드는 PREPARE 가 없다`);
  return m[1].replace(/''/g, "'");
}
// schema-structure.sql 의 project 열 이름 순서와 한 줄 정의
function projectCols(struct) {
  const m = /CREATE TABLE project \(([\s\S]*?)\n\) ENGINE/.exec(struct);
  assert.ok(m, 'schema-structure.sql 에 project 정의가 없다');
  return m[1].split('\n').map((l) => /^\s*([a-z_]+)\s+([A-Z]+[^,]*?),?\s*(?:--.*)?$/.exec(l)).filter(Boolean).map((x) => ({ name: x[1], def: x[2].trim().replace(/\s+/g, ' ') }));
}

const checks = {
  // ══ ① 정본과 조각 ══════════════════════════════════════════════════
  sameDef(canon, frag) {
    const c = canonDef(canon), f = fragDef(frag);
    assert.strictEqual(f, c, `${TABLE}: 이관 조각의 정의가 정본(schema-calendar.sql)과 글자까지 같지 않다`);
    assert.ok(!/--/.test(c), '정본 정의 안에 -- 주석이 있다(조각 문자열과 글자로 맞출 수 없다)');
    const d = defOf(`CREATE TABLE ${TABLE} (` + c);
    assert.deepStrictEqual(d, { cols: 10, fks: 2 }, `정본 정의의 열 수와 FK 수가 기대(10, 2)와 다르다: ${JSON.stringify(d)}`);
    assert.ok(new RegExp(`@m_c1 = ${d.cols} AND @m_f1 = ${d.fks}\\)`).test(frag), '조각 검증의 기대값이 정본 정의의 열 수, FK 수와 다르다');
  },
  tableRules(canon) {
    const c = canonDef(canon);
    const col = (n) => { const m = new RegExp(`^\\s*${n}\\s+([^\\n]*?)\\s+COMMENT`, 'm').exec(c); assert.ok(m, `${n} 열이 없다`); return m[1].replace(/\s+/g, ' '); };
    assert.strictEqual(col('id'), 'INT UNSIGNED NOT NULL AUTO_INCREMENT', 'id 형이 다르다');
    assert.strictEqual(col('project_id'), 'INT UNSIGNED NOT NULL', 'project_id 형이 project.id 와 다르다');
    assert.strictEqual(col('seq'), 'TINYINT UNSIGNED NOT NULL', 'seq 형이 다르다');
    assert.ok(/^VARCHAR\(20\)/.test(col('mime')), 'mime 이 VARCHAR(20) 이 아니다');
    assert.strictEqual(col('bytes'), 'MEDIUMBLOB NOT NULL', 'bytes 가 MEDIUMBLOB NOT NULL 이 아니다');
    assert.strictEqual(col('width_px'), 'SMALLINT UNSIGNED NOT NULL', 'width_px 형이 다르다');
    assert.strictEqual(col('height_px'), 'SMALLINT UNSIGNED NOT NULL', 'height_px 형이 다르다');
    assert.ok(/^CHAR\(64\)/.test(col('sha256')), 'sha256 이 CHAR(64) 가 아니다');
    assert.strictEqual(col('uploaded_by'), 'SMALLINT UNSIGNED NOT NULL', 'uploaded_by 형이 app_user.user_id 와 다르다');
    assert.ok(/^DATETIME\(3\) NOT NULL/.test(col('uploaded_at')), 'uploaded_at 이 DATETIME(3) 이 아니다');
    assert.ok(/UNIQUE KEY \w+ \(project_id, seq\)/.test(c), '(project_id, seq) UNIQUE 가 없다');
    assert.ok(/FOREIGN KEY \(project_id\) REFERENCES project\(id\)\s+ON UPDATE RESTRICT ON DELETE CASCADE/.test(c), '과제 FK 가 ON DELETE CASCADE 가 아니다');
    assert.ok(/FOREIGN KEY \(uploaded_by\) REFERENCES app_user\(user_id\)\s+ON UPDATE RESTRICT ON DELETE RESTRICT/.test(c), '등록자 FK 가 ON DELETE RESTRICT 가 아니다(UserRecordTables 와 같은 규칙)');
    assert.ok(/CHECK \(mime IN \('image\/png','image\/jpeg'\)\)/.test(c), 'mime CHECK 가 PNG, JPEG 둘이 아니다');
    const code = noLineComments(canon);
    assert.ok(new RegExp(`^DROP TABLE IF EXISTS ${TABLE};`, 'm').test(code), `정본 DROP 목록에 ${TABLE} 가 없다(재적용 1050)`);
    assert.ok(code.indexOf(`DROP TABLE IF EXISTS ${TABLE};`) < code.indexOf('DROP TABLE IF EXISTS cal_schema_meta;'), 'DROP 이 다른 표 DROP 들과 같은 자리(맨 위 묶음)에 있지 않다');
  },
  devStartColumn(struct, frag) {
    const cols = projectCols(struct);
    const names = cols.map((c) => c.name);
    const i = names.indexOf('dev_start_date');
    assert.ok(i > 0, 'schema-structure.sql 의 project 에 dev_start_date 가 없다');
    assert.strictEqual(names[i - 1], 'end_date', 'dev_start_date 바로 앞이 end_date 가 아니다(조각은 AFTER end_date)');
    assert.strictEqual(names[i + 1], 'dev_end_date', 'dev_start_date 바로 뒤가 dev_end_date 가 아니다');
    assert.strictEqual(cols[i].def, 'DATE NULL', 'dev_start_date 가 DATE NULL 이 아니다');
    assert.ok(struct.includes(`CONSTRAINT chk_project_dev_dates CHECK (${CHECK_EXPR})`), '정본 project 에 CHECK chk_project_dev_dates 가 없다');
    const code = noLineComments(frag);
    assert.ok(code.includes("'ALTER TABLE project ADD COLUMN dev_start_date DATE NULL AFTER end_date, ALGORITHM=INSTANT'"), '조각이 dev_start_date 를 같은 형, 같은 자리(AFTER end_date, INSTANT)로 더하지 않는다');
    assert.ok(code.includes(`'ALTER TABLE project ADD CONSTRAINT chk_project_dev_dates CHECK (${CHECK_EXPR})'`), '조각의 CHECK 식이 정본과 글자까지 같지 않다');
    assert.ok(/SET @s := IF\(@go AND @m_col = 0,/.test(code) && /SET @s := IF\(@go AND @m_chk = 0,/.test(code), '칸과 CHECK 를 information_schema 로 있는지 보고 없을 때만 더하지 않는다(재실행 1060, 3822)');
  },
  fragmentShape(frag) {
    const code = noLineComments(frag);
    assert.ok(/^-- @migration from=16 to=17\n/.test(frag), '첫 줄이 -- @migration from=16 to=17 이 아니다');
    assert.ok(/SET @go := \(@m_cur <=> '16'\);/.test(code) && /SET @skip := \([^;]*>= 17\);/.test(code), '자기 확인(@go 16, @skip 17 이상)이 없다');
    assert.ok(code.includes("UPDATE cal_schema_meta SET v = '17', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'db_structure_version' AND v = '16';"), '끝의 구조 번호 올리기 줄이 정확한 모양이 아니다');
    const iCol = code.indexOf('ADD COLUMN dev_start_date'), iChk = code.indexOf('ADD CONSTRAINT chk_project_dev_dates'), iTbl = code.indexOf(`CREATE TABLE IF NOT EXISTS ${TABLE}`);
    const iVer = code.indexOf('SET @g := IF(NOT @go OR (@m_cty = 1'), iBump = code.indexOf("UPDATE cal_schema_meta SET v = '17'");
    assert.ok(iCol > 0 && iCol < iChk && iChk < iTbl && iTbl < iVer && iVer < iBump, '순서가 칸, CHECK, 표, 검증, 구조 번호 올리기가 아니다');
    assert.ok(!/\bGRANT\b/.test(code), '조각이 GRANT 를 한다(배포 SQL 은 권한을 줄 수 없다)');
    assert.ok(!/START TRANSACTION/.test(code), '구조 변경 조각에 트랜잭션이 있다(DDL 은 자동 확정된다)');
  },
  versions(gate, canon) {
    assert.ok(/public const int AppStructureVersion = 17;/.test(stripCsComments(gate)), 'DbGate.AppStructureVersion 이 17 이 아니다');
    assert.ok(/VALUES \('db_structure_version', '17', UTC_TIMESTAMP\(3\)\)/.test(noLineComments(canon)), '정본 시드가 17 이 아니다');
  },

  // ══ ② 권한과 배포 도구 ═════════════════════════════════════════════
  grantsAndTools(s) {
    const g = noLineComments(s.grants), sv = noLineComments(s.server);
    assert.ok(new RegExp(`^GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr\\.${TABLE} TO 'taskmgr_app'@'%';`, 'm').test(g), 'grants-calendar.sql 의 그림 표 권한이 SELECT, INSERT, UPDATE, DELETE 가 아니다');
    assert.ok(new RegExp(`^GRANT SELECT, INSERT, UPDATE, DELETE ON \`taskcalendar\`\\.\`${TABLE}\` TO 'taskmgr_app'@'%';`, 'm').test(sv), 'server-app-account.sql 의 그림 표 권한이 SELECT, INSERT, UPDATE, DELETE 가 아니다');
    assert.ok(new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`\`\\$DbName\`\`\\.${TABLE} TO`).test(s.appAcct) && /TABLE_NAME='project_schedule_image'/.test(s.appAcct),
      'app-account.ps1 이 그림 표가 있을 때 그 권한을 주지 않는다');
    assert.ok(/\$OWN_NON_CAL = @\('project_schedule_image'\)/.test(s.init) && new RegExp(`'${TABLE}'\\s*\\n\\)`).test(s.init), 'init-calendar.ps1 의 명부나 이름 예외에 그림 표가 없다');
    const n = (t) => (t.match(/^CREATE TABLE /gm) || []).length;
    assert.ok(new RegExp(`\\$EXPECTED_TABLE_COUNT = ${n(s.struct) + n(s.canon) + 3}\\b`).test(s.setup), `setup-taskcalendar.ps1 의 표 수가 세 DDL 의 CREATE TABLE 수(구조 ${n(s.struct)}, 캘린더 ${n(s.canon)}, 사용자 3)와 다르다`);
    assert.ok(new RegExp(`WIPE_TABLES = \\[\\s*'${TABLE}',`).test(s.demoGen), '데모가 그림 표를 맨 앞에서 비우지 않는다');
    const urt = /private static readonly string\[\] UserRecordTables\s*=\s*\{([\s\S]*?)\};/.exec(stripCsComments(s.pdb));
    assert.ok(urt && urt[1].includes(`"${TABLE}.uploaded_by"`), 'UserRecordTables 에 그림 표 등록자(project_schedule_image.uploaded_by)가 없다(그림을 올린 계정을 기록 0건으로 오판한다)');
    const cnt = extractCsMember(s.pdb, 'private static string UserRefCountSql(');
    assert.ok(/UserRecordRef\(t\)/.test(cnt) && /" WHERE " \+ col \+ "=@u\)"/.test(cnt), '기록 수 세기가 표.열 의 사람 열을 쓰지 않는다');
  },

  // ══ ③ 백업 ══════════════════════════════════════════════════════════
  hexBlob(backup, restore, demoPs) {
    const dumpLine = (t, label) => {
      const l = t.split('\n').find((x) => /^\s*& \$mysqldump\b/.test(x));
      assert.ok(l, `${label} 에서 mysqldump 실행 줄을 찾지 못했다`);
      return l;
    };
    assert.ok(/"--hex-blob"/.test(dumpLine(backup, 'backup-taskmgr.ps1')), 'backup-taskmgr.ps1 의 mysqldump 에 --hex-blob 이 없다(그림 바이트)');
    assert.ok(/"--hex-blob"/.test(dumpLine(restore, 'restore-taskmgr.ps1')), 'restore-taskmgr.ps1 의 복원 전 안전 덤프에 --hex-blob 이 없다');
    assert.ok(/"--hex-blob"/.test(dumpLine(demoPs, 'demo-db.ps1')), 'demo-db.ps1 의 데모 전 백업에 --hex-blob 이 없다');
  },

  // ══ ④ 개발 시작일 배선 ════════════════════════════════════════════
  devStartWiring(pdb, main, html) {
    const lit = (head) => {
      const i = pdb.indexOf('"' + head);
      assert.ok(i >= 0, `ProjectDb 에서 ${head} 문장을 찾지 못했다`);
      return [...pdb.slice(i, pdb.indexOf(';', i)).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('');
    };
    assert.ok(lit('SELECT p.uid,').includes("DATE_FORMAT(p.dev_start_date,'%Y-%m-%d') dev_start_date"), 'ProjectDb 과제 읽기가 dev_start_date 를 읽지 않는다');
    assert.ok(/\["dev_start_date"\]\s*=\s*Str\(rd, "dev_start_date"\)/.test(pdb), 'ProjectDb 과제 읽기가 dev_start_date 를 웹에 싣지 않는다');
    const ins = lit('INSERT INTO project (');
    assert.ok(/dev_start_date, dev_end_date/.test(ins) && /@dsd,@ded/.test(ins), 'INSERT 가 dev_start_date(@dsd)를 쓰지 않는다');
    assert.ok(/dev_start_date=@dsd, dev_end_date=@ded/.test(lit('UPDATE project SET ')), 'UPDATE 가 dev_start_date(@dsd)를 갱신하지 않는다');
    assert.ok(/cmd\.Parameters\.AddWithValue\("@dsd", DateOrNull\(dsd\)\)/.test(pdb), 'BindProject 가 @dsd 를 묶지 않는다');
    const up = extractCsMember(pdb, 'public async Task<(bool ok, string msg, bool needConfirm)> UpsertProjectAsync(');
    assert.ok(/if \(!IsDateOrEmpty\(dsd\)\)/.test(up) && /string\.CompareOrdinal\(dsd, ded\) > 0/.test(up), 'UpsertProjectAsync 가 개발시작일 형식과 순서(시작 <= 종료)를 보지 않는다');
    assert.ok(!/sectionId == CodeIds\.SectionPre\) \{[^}]*dsd/.test(up), '선진행 분기가 개발시작일을 비운다(개발종료일과 같은 설계 결정 위반)');
    const mc = stripCsComments(main);
    const sp = /case "saveProject":[\s\S]*?break;/.exec(mc);
    assert.ok(sp && /GetStr\(doc, "devStartDate"\), GetStr\(doc, "devEndDate"\)/.test(sp[0]), 'saveProject 분기가 devStartDate 를 읽지 않는다');
    assert.ok(/\("개발시작일", "devStartDate",\s+12, XlsxWriter\.Align\.Center, true,\s+false\),[^\n]*\n\s*\("개발종료일"/.test(main), '엑셀 열 정의에 개발시작일이 개발종료일 바로 앞에 없다');
    const map = extractFunction(html, 'mapDbRows');
    assert.ok(/devStartDate:String\(r\.dev_start_date \|\| ''\)/.test(map), 'dbCatalog(mapDbRows)에 devStartDate 가 없다');
    assert.ok(/id="offEdDevStart"/.test(html), '편집 폼에 #offEdDevStart 칸이 없다');
    assert.ok(/devStartDate: val\('offEdDevStart'\)/.test(extractFunction(html, 'offEdSaveNow')), '편집 저장 payload 에 devStartDate 가 없다');
    assert.ok(/set\('offEdDevStart', c \? offDate\(c\.devStartDate\) : ''\)/.test(extractFunction(html, 'offEditOpen')), '편집 폼을 열 때 개발시작일을 채우지 않는다');
    assert.ok(/devStartDate: offDate\(o\.devStartDate\)/.test(extractFunction(html, 'offExportRow')), '엑셀 행에 devStartDate 가 없다');
    const lock = /\[([^\]]*)\]\s*\.forEach\s*\(/.exec(extractFunction(html, 'offEdApplySectionRule').replace(/\/\/[^\n]*/g, ''));
    assert.ok(lock && !lock[1].includes('offEdDevStart'), '선진행 잠금 배열에 offEdDevStart 가 들어갔다(개발 기간은 계약 전에도 있다)');
  },

  // ══ ⑤ 그림 명령 ════════════════════════════════════════════════════
  imageRules(sidb) {
    const code = stripCsComments(sidb);
    assert.ok(/public const int MaxBytes = 5 \* 1024 \* 1024;/.test(code) && /public const int MaxPerProject = 5;/.test(code), '상한이 5MB, 과제당 5장이 아니다');
    const inspect = extractCsMember(sidb, 'internal static Info Inspect(byte[] bytes)');
    assert.ok(/bytes\.Length > ScheduleImageDb\.Limits\.MaxBytes/.test(inspect), '그림 검사가 5MB 상한을 보지 않는다');
    assert.ok(/BitmapDecoder\.Create\(/.test(inspect) && /dec is PngBitmapDecoder/.test(inspect) && /dec is JpegBitmapDecoder/.test(inspect), '그림 검사가 WPF BitmapDecoder 로 PNG, JPEG 를 확인하지 않는다');
    assert.ok(/Sniff\(bytes\)/.test(inspect), '그림 검사가 머리 글자(PNG, JPEG)를 보지 않는다');
    const add = extractCsMember(sidb, 'public async Task<ScheduleImageReply> AddAsync(');
    assert.ok(/ScheduleImageCodec\.InspectAsync\(bytes\)/.test(add), '추가가 그림 검사를 거치지 않는다');
    assert.ok(/if \(n >= Limits\.MaxPerProject\) throw new SiFail\(Kind\.Invalid, MsgTooMany\);/.test(add), '추가가 과제당 5장을 검사하지 않는다');
    assert.ok(/ProjectIdAsync\(conn, tx, projectUid, lockRow: true, ct\)/.test(add), '추가가 과제 행을 잠그지 않는다(5장 상한과 seq 가 엇갈린다)');
    assert.ok(/ins\.Parameters\.AddWithValue\("@u", me\.UserId\)/.test(add) && /"@at"/.test(add), '추가가 등록한 사람과 시각을 남기지 않는다');
    //  관리자 검사가 없다(누구나, §6.1). 관리자 관문이나 역할 판정 낱말이 이 파일에 없다.
    assert.ok(!/OpenAdminAsync|OpenWriteAsync|edit_role|IsAdmin|AdminFrom/.test(code), '그림 명령에 관리자 검사가 있다(누구나 추가, 삭제가 의도)');
    //  연결은 관문 하나, 커밋은 재확인 한 곳
    assert.ok(!/new MySqlConnection\(/.test(code), 'ScheduleImageDb 가 관문을 거치지 않고 연결을 만든다');
    assert.ok(/await DbGate\.OpenAsync\(BuildConnString\(\), ct\)/.test(code), 'ScheduleImageDb 연결이 DbGate.OpenAsync 가 아니다');
    assert.strictEqual((code.match(/\.CommitAsync\(/g) || []).length, 1, 'CommitAsync 가 한 곳(CommitWithGateAsync)이 아니다');
    const commit = extractCsMember(sidb, 'private async Task CommitWithGateAsync(');
    assert.ok(commit.indexOf('DbGate.ReadMetaAsync(conn, tx, ct)') >= 0 && commit.indexOf('DbGate.ReadMetaAsync(conn, tx, ct)') < commit.indexOf('tx.CommitAsync(ct)'), '커밋 바로 앞에서 관문을 다시 읽지 않는다');
    for (const w of ['AddAsync(', 'WriteOnImageAsync(']) {
      const b = extractCsMember(sidb, w.startsWith('Add') ? 'public async Task<ScheduleImageReply> AddAsync(' : 'private async Task<ScheduleImageReply> WriteOnImageAsync(');
      assert.ok(/await CommitWithGateAsync\(conn, tx, ct\);/.test(b), `${w} 가 CommitWithGateAsync 로 커밋하지 않는다`);
      assert.ok(/IdentityAsync\(conn, tx, login, ct\)/.test(b) && /string login = SessionLoginId\(\);/.test(b), `${w} 의 신원이 세션에서 오지 않는다`);
    }
    assert.ok(!/"loginId"|"userId"|"uploadedBy"\)/.test(code.replace(/\["uploadedBy"\]/g, '')), '요청에서 사용자 값을 읽는다(신원은 세션에서만)');
    //  CHAR(36) 인 project.uid 는 MySqlConnector 가 Guid 로 돌려준다. 'as string' 으로 읽으면 늘 null 이라 있는 그림이 notFound 가 된다
    //  (2026-10-22 실 DB 시험 tests/db-schedule-image.mjs 에서 순서 바꾸기와 삭제가 이렇게 실패했다). 스칼라는 Convert 로 읽는다.
    assert.ok(!/ExecuteScalarAsync\([^)]*\)\)?\s*as string/.test(code), 'DB 스칼라를 as string 으로 읽는다(CHAR(36) 은 Guid 로 온다)');
    const w = extractCsMember(sidb, 'private async Task<ScheduleImageReply> WriteOnImageAsync(');
    assert.ok(/Convert\.ToString\(pv, CultureInfo\.InvariantCulture\)/.test(w), '그림의 과제 uid 를 글자로 바꿔 읽지 않는다(Guid 로 온다)');
    //  PC 사본 이름은 해시(소문자 16진수 64자)와 형식에서만
    const fileFor = extractCsMember(sidb, 'public static string? FileFor(');
    assert.ok(/if \(!ShaRe\.IsMatch\(sha \?\? ""\)\) return null;/.test(fileFor) && /sha \+ ext/.test(fileFor), 'PC 사본 파일 이름이 검사한 해시와 형식에서만 오지 않는다');
    assert.ok(/Path\.Combine\(dataDir, "schedule-images"\)/.test(code), 'PC 사본 폴더가 앱 데이터의 schedule-images 가 아니다');
    //  미리 보기는 약 40KB 이하 JPEG
    assert.ok(/public const int ThumbMaxBytes = 40 \* 1024;/.test(code) && /new JpegBitmapEncoder/.test(code), '미리 보기가 40KB 이하 JPEG 가 아니다');
  },
  // 저장: DB 가 안 되면 사본으로 저장하고, 추가와 삭제는 DB 쓰기 트랜잭션 없이는 성공하지 않는다
  offlineRules(sidb, mre) {
    const exp = extractCsMember(sidb, 'public async Task<ExportImages> ImagesForExportAsync(');
    assert.ok(/catch \(Exception ex\)[\s\S]*Cache\.Recall\(_dataDir, uid\)[\s\S]*c\.Source = c\.Count > 0 \? "cache" : "none";/.test(exp), 'DOCX 그림이 DB 실패 때 PC 사본으로 넘어가지 않는다');
    assert.ok(/Cache\.Load\(_dataDir, m\.Sha256, m\.Mime, _log\)[\s\S]*if \(b == null\)[\s\S]*FetchBytesAsync/.test(exp), 'DB 가 될 때 해시가 같은 사본이 있어도 바이트를 다시 받는다');
    const probe = extractCsMember(mre, 'private async Task<ScheduleImageReply> AddScheduleImageAsync(');
    assert.ok(probe.indexOf('await db.ProbeAddAsync(uid)') >= 0 && probe.indexOf('await db.ProbeAddAsync(uid)') < probe.indexOf('new Microsoft.Win32.OpenFileDialog'), '추가가 파일 창을 열기 전에 DB 를 확인하지 않는다(끊겼을 때 막기)');
    assert.ok(/dlg\.ShowDialog\(owner\)/.test(probe), '그림 파일 창의 주인이 요청한 창이 아니다');
    assert.ok(/ScheduleImageCodec\.ReadClipboard\(\)/.test(probe) && /mode != "file" && mode != "clipboard"/.test(probe), '추가가 파일과 클립보드 두 방법을 받지 않는다');
  },

  // ══ ⑥ 메인 창 전용 ═════════════════════════════════════════════════
  mainOnly(main, appwin, html, sidb) {
    const code = stripCsComments(main);
    const setOf = (name) => {
      const m = new RegExp(`internal static readonly HashSet<string> ${name} = new\\(StringComparer\\.Ordinal\\)\\s*\\{([\\s\\S]*?)\\};`).exec(code);
      assert.ok(m, `${name} 를 찾지 못했다`);
      return new Set([...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]));
    };
    const peer = setOf('PeerWinCommands'), admin = setOf('AdminWinCommands');
    for (const c of MAIN_ONLY) {
      assert.ok(!peer.has(c), `${c} 가 열람 창 허용 목록(PeerWinCommands)에 있다`);
      assert.ok(!admin.has(c), `${c} 가 관리 창 허용 목록(AdminWinCommands)에 있다`);
      const lines = code.split('\n').filter((l) => l.includes(`case "${c}":`));
      assert.strictEqual(lines.length, 1, `메인 창 스위치에 ${c} 의 case 줄이 하나가 아니다(${lines.length})`);
      assert.ok(/break;\s*$/.test(lines[0]), `${c} 의 case 가 한 줄이 아니다`);
    }
    assert.ok(/case "exportMonthlyDocx": RunMonthlyDocxExport\(DialogOwner\(fromWin\), GetStr\(doc, "reqId"\), raw\); break;/.test(code), 'exportMonthlyDocx 가 요청한 창을 저장 창 주인으로 넘기지 않는다');
    for (const c of COMMANDS) {
      assert.ok(new RegExp(`case "${c}": _ = RunScheduleImageAsync\\(cmd, DialogOwner\\(fromWin\\), GetStr\\(doc, "reqId"\\), raw\\); break;`).test(code), `${c} 가 RunScheduleImageAsync 로 이어지지 않는다`);
    }
    assert.ok(/if \(!fromWin\.Commands\.Contains\(cmd\)/.test(code), '따로 뜨는 창의 허용 목록 밖 명령을 거절하는 분기가 없다');
    assert.ok(/Commands = MainWindow\.PeerWinCommands/.test(appwin) && /Commands = MainWindow\.AdminWinCommands/.test(appwin), 'AppWindow 의 허용 목록이 MainWindow 의 두 집합이 아니다');
    for (const name of ['PEERWIN_CMD', 'ADMINWIN_CMD']) {
      const m = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(html);
      assert.ok(m, `웹의 ${name} 를 찾지 못했다`);
      for (const c of MAIN_ONLY) assert.ok(!m[1].includes(`'${c}'`), `웹의 ${name} 에 ${c} 가 있다`);
    }
    const listed = /internal static readonly string\[\] Commands =\s*\{([\s\S]*?)\};/.exec(stripCsComments(sidb));
    assert.ok(listed, 'ScheduleImageDb.Commands 가 없다');
    assert.deepStrictEqual([...listed[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort(), [...COMMANDS].sort(), 'ScheduleImageDb.Commands 가 다섯 명령과 다르다');
  },
};

// ══ 계약 ═══════════════════════════════════════════════════════════════
test('그림표①a: project_schedule_image 정의가 정본(schema-calendar.sql)과 이관 조각(v17)에서 글자까지 같고 열 10, FK 2 로 검증한다', () => checks.sameDef(src.canon, src.frag));
test('그림표①b: 열 형, (project_id, seq) UNIQUE, 과제 CASCADE, 등록자 RESTRICT, mime CHECK, 정본 DROP 목록', () => checks.tableRules(src.canon));
test('그림표①c: project.dev_start_date 는 end_date 와 dev_end_date 사이 DATE NULL 이고 CHECK 식이 정본과 조각에서 같다', () => checks.devStartColumn(src.struct, src.frag));
test('그림표①d: 조각은 16 에서 17 한 칸, 칸, CHECK, 표, 검증, 올리기 순서이고 GRANT 와 트랜잭션이 없다', () => checks.fragmentShape(src.frag));
test('그림표①e: 앱 구조 번호와 정본 시드가 17 이다', () => checks.versions(src.gate, src.canon));
test('그림표②: 권한(SELECT, INSERT, UPDATE, DELETE), init 명부, setup 표 수, 데모, 사용자 기록 표(표.열)', () => checks.grantsAndTools(src));
test('그림표③: 백업, 복원 전 안전 덤프, 데모 전 백업의 mysqldump 에 --hex-blob 이 있다', () => checks.hexBlob(src.backup, src.restore, src.demoPs));
test('그림표④: 개발 시작일이 과제 읽기와 쓰기, 순서 검사, saveProject, 엑셀 열, dbCatalog, 편집 폼과 payload 에 이어지고 선진행 잠금에는 없다', () => checks.devStartWiring(src.pdb, src.main, src.html));
test('그림표⑤a: 추가는 형식(머리 글자, BitmapDecoder), 5MB, 과제당 5장을 검사하고 관리자 검사가 없으며 커밋은 관문 재확인 한 곳', () => checks.imageRules(src.sidb));
test('그림표⑤b: DB 가 끊기면 DOCX 그림은 사본으로, 추가는 파일 창 전에 DB 를 확인한다(파일, 클립보드 두 방법)', () => checks.offlineRules(src.sidb, src.mre));
test('그림표⑥: 그림 명령과 exportMonthlyDocx 는 메인 창 전용이다(호스트와 웹 허용 목록 밖, case 한 줄씩)', () => checks.mainOnly(src.main, src.appwin, src.html, src.sidb));

// ══ 변이: 검사가 정말 무는지 ═══════════════════════════════════════════
test('변이SI1: 조각의 그림 표 정의를 한 글자 바꾸면 ①a 가 실패한다', () => {
  const bad = mutate(src.frag, "COMMENT ''그림 번호''", "COMMENT ''그림 id''");
  assert.throws(() => checks.sameDef(src.canon, bad), /글자까지 같지 않다/);
});
test('변이SI2: 등록자 FK 를 CASCADE 로 바꾸면 ①b 가 실패한다', () => {
  const bad = mutate(src.canon, 'REFERENCES app_user(user_id)\n    ON UPDATE RESTRICT ON DELETE RESTRICT,\n  CONSTRAINT chk_project_schedule_image_mime',
    'REFERENCES app_user(user_id)\n    ON UPDATE RESTRICT ON DELETE CASCADE,\n  CONSTRAINT chk_project_schedule_image_mime');
  assert.throws(() => checks.tableRules(bad), /ON DELETE RESTRICT 가 아니다/);
});
test('변이SI3: 조각의 CHECK 식이 정본과 다르면 ①c 가 실패한다', () => {
  const bad = mutate(src.frag, 'OR dev_start_date <= dev_end_date)\'', 'OR dev_start_date < dev_end_date)\'');
  assert.throws(() => checks.devStartColumn(src.struct, bad), /CHECK 식이 정본과/);
});
test('변이SI4: 칸 추가에서 information_schema 확인을 빼면 ①c 가 실패한다', () => {
  const bad = mutate(src.frag, 'SET @s := IF(@go AND @m_col = 0,', 'SET @s := IF(@go,');
  assert.throws(() => checks.devStartColumn(src.struct, bad), /없을 때만 더하지 않는다/);
});
test('변이SI5: 권한에서 DELETE 를 빼면 ② 가 실패한다', () => {
  const bad = mutate(src.grants, `GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.${TABLE} TO`, `GRANT SELECT, INSERT, UPDATE ON taskmgr.${TABLE} TO`);
  assert.throws(() => checks.grantsAndTools({ ...src, grants: bad }), /grants-calendar\.sql 의 그림 표 권한/);
});
test('변이SI6: UserRecordTables 에서 그림 표 등록자를 빼면 ② 가 실패한다', () => {
  const bad = mutate(src.pdb, '            "project_schedule_image.uploaded_by",\n', '');
  assert.throws(() => checks.grantsAndTools({ ...src, pdb: bad }), /UserRecordTables 에 그림 표 등록자/);
});
test('변이SI7: 백업의 --hex-blob 을 빼면 ③ 이 실패한다', () => {
  const bad = mutate(src.backup, '"--triggers" "--hex-blob" "--result-file=$partPath"', '"--triggers" "--result-file=$partPath"');
  assert.throws(() => checks.hexBlob(bad, src.restore, src.demoPs), /backup-taskmgr\.ps1 의 mysqldump 에 --hex-blob/);
});
test('변이SI8: UPDATE 에서 dev_start_date 를 빼면 ④ 가 실패한다', () => {
  const bad = mutate(src.pdb, 'dev_start_date=@dsd, dev_end_date=@ded, ', 'dev_end_date=@ded, ');
  assert.throws(() => checks.devStartWiring(bad, src.main, src.html), /UPDATE 가 dev_start_date/);
});
test('변이SI9: 선진행 잠금 배열에 offEdDevStart 를 넣으면 ④ 가 실패한다', () => {
  const bad = mutate(src.html, "['offEdStart', 'offEdEnd', 'offEdStatus'].forEach(id => {", "['offEdStart', 'offEdEnd', 'offEdDevStart', 'offEdStatus'].forEach(id => {");
  assert.throws(() => checks.devStartWiring(src.pdb, src.main, bad), /선진행 잠금 배열에 offEdDevStart/);
});
test('변이SI10: 추가에서 과제당 5장 검사를 빼면 ⑤a 가 실패한다', () => {
  const add = extractCsMember(src.sidb, 'public async Task<ScheduleImageReply> AddAsync(');
  assert.ok(add.includes('if (n >= Limits.MaxPerProject) throw new SiFail(Kind.Invalid, MsgTooMany);'), '변이 준비 실패');
  const bad = src.sidb.replace(/(public async Task<ScheduleImageReply> AddAsync\([\s\S]*?)                        if \(n >= Limits\.MaxPerProject\) throw new SiFail\(Kind\.Invalid, MsgTooMany\);\n/, '$1');
  assert.notStrictEqual(bad, src.sidb, '변이 준비 실패: 추가의 5장 검사를 찾지 못했다');
  assert.throws(() => checks.imageRules(bad), /과제당 5장을 검사하지 않는다/);
});
test('변이SI11: 그림 검사에서 5MB 상한을 빼면 ⑤a 가 실패한다', () => {
  const bad = mutate(src.sidb, '            if (bytes.Length > ScheduleImageDb.Limits.MaxBytes) throw new ArgumentException(ScheduleImageDb.MsgTooBig);\n            string mime = Sniff(bytes);',
    '            string mime = Sniff(bytes);');
  assert.throws(() => checks.imageRules(bad), /5MB 상한/);
});
test('변이SI12: 삭제에 관리자 관문을 넣으면 ⑤a 가 실패한다(누구나 삭제가 의도)', () => {
  const bad = mutate(src.sidb, '            return await WriteOnImageAsync("삭제", id, async (conn, tx, pid, ct) =>',
    '            await new ProjectDb(_dataDir, _log).OpenAdminAsync(CancellationToken.None);\n            return await WriteOnImageAsync("삭제", id, async (conn, tx, pid, ct) =>');
  assert.throws(() => checks.imageRules(bad), /관리자 검사가 있다/);
});
test('변이SI13: 커밋 앞 관문 재확인을 빼면 ⑤a 가 실패한다', () => {
  const bad = mutate(src.sidb, '            var gateMeta = await DbGate.ReadMetaAsync(conn, tx, ct);\n            if (DbGate.Observe(gateMeta) != GateVerdict.Ok)',
    '            var gateMeta = new GateMeta();\n            if (DbGate.Observe(gateMeta) != GateVerdict.Ok)');
  assert.throws(() => checks.imageRules(bad), /관문을 다시 읽지 않는다/);
});
test('변이SI14: 그림 검사를 거치지 않고 넣으면 ⑤a 가 실패한다', () => {
  const bad = mutate(src.sidb, 'var info = await ScheduleImageCodec.InspectAsync(bytes);', 'var info = new ScheduleImageCodec.Info("image/png", 1, 1);');
  assert.throws(() => checks.imageRules(bad), /그림 검사를 거치지 않는다/);
});
test('변이SI15: DB 실패 때 사본으로 넘어가지 않으면 ⑤b 가 실패한다', () => {
  const bad = mutate(src.sidb, 'c.Source = c.Count > 0 ? "cache" : "none";', 'c.Source = "none";');
  assert.throws(() => checks.offlineRules(bad, src.mre), /PC 사본으로 넘어가지 않는다/);
});
test('변이SI18: 그림의 과제 uid 를 as string 으로 읽으면(실 DB 에서 notFound 가 된 결함) ⑤a 가 실패한다', () => {
  const bad = src.sidb.replace(/object\? pv = await q\.ExecuteScalarAsync\(ct\);\n\s*uid = [^\n]*\n/, 'uid = (await q.ExecuteScalarAsync(ct)) as string;\n');
  assert.notStrictEqual(bad, src.sidb, '변이 준비 실패: uid 읽기를 찾지 못했다');
  assert.throws(() => checks.imageRules(bad), /as string|Guid/);
});
test('변이SI16: 그림 명령을 관리 창 허용 목록에 넣으면 ⑥ 이 실패한다', () => {
  const bad = mutate(src.main, '"adminWinReady", "userInfoGet", "gateRecheck",', '"adminWinReady", "userInfoGet", "gateRecheck", "scheduleImageDelete",');
  assert.throws(() => checks.mainOnly(bad, src.appwin, src.html, src.sidb), /관리 창 허용 목록/);
});
test('변이SI17: exportMonthlyDocx 를 웹 열람 창 목록에 넣으면 ⑥ 이 실패한다', () => {
  const bad = mutate(src.html, "const PEERWIN_CMD = new Set(['peerWinReady',", "const PEERWIN_CMD = new Set(['exportMonthlyDocx','peerWinReady',");
  assert.throws(() => checks.mainOnly(src.main, src.appwin, bad, src.sidb), /웹의 PEERWIN_CMD 에 exportMonthlyDocx/);
});
