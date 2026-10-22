// 회의실 공용화: docs/SHARED-ROOMS.md(2026-10-21, 장소 칸 A안, 관리 화면 가안).
//
// 지키는 것:
//   (S) 정적
//     - 일반 사용자 화면에 회의실 관리 진입점이 없다(⋯ 메뉴 #btnRooms, 일정 입력 창 #fRoomMgr, 빠른 추가 #qaRoomMgr,
//       창 #roomModal). 개인 회의실 상태(state.rooms, DEFAULT_ROOMS, normRooms)와 '(미등록)' 보존 옵션도 없다.
//     - 장소 칸 두 곳(#fLoc, #qaLoc)은 글자 입력 콤보박스(role=combobox + role=listbox)다.
//     - loadCodes 가 공용 회의실을 세 번째 목록으로 싣는다(호스트 LoadCodesToWebAsync → __applyCodes(…, rooms)).
//     - 관리 화면: 묶음 '일정' 의 '회의실' 항목이 #roomAdminModal 을 도킹하고, 조작이 다섯 명령(roomsFull, roomAdd,
//       roomRename, roomDelete, roomReorder)으로 간다. 호스트의 회의실 쓰기 넷은 OpenAdminAsync 만 지난다.
//     - CalendarDb, CalendarWriteDb, xml-to-db 는 cal_room 을 다루지 않는다. ProjectDb.UserRecordTables 에도 없다.
//     - 정본: schema-structure.sql 에 room_code, schema-calendar.sql 에 cal_room 이 없고 구조 번호 15. 권한 파일 정합.
//     - 이관 조각 v15: 머리, 건너뛰기, 닫힘 확인, db_updating 쓰지 않음, INSERT IGNORE 로 모으기, 검증, 지우기, 15 올리기, 순서.
//   (R) jsdom: 장소 칸 걸러 보기(강조), ↑↓ Enter Esc, 직접 입력 저장, 옛 장소 그대로, 빠른 추가, 관리 화면 조작 명령.
//   (M) 변이: 진입점을 되살리거나, 관문을 내리거나, 조각의 검증, 순서, db_updating 을 건드리면 잡힌다.
import { test, skip, assert, loadAppSource, extractFunction, stripCsComments, listCsMembers, importOptional, countTestsBelow, SKIP_NO_JSDOM, readText } from './harness.mjs';

const R = (p) => readText(new URL('../' + p, import.meta.url)).replace(/\r+\n/g, '\n');
const app = loadAppSource();
const projectDb = R('widget/ProjectDb.cs');
const mainWindow = R('widget/MainWindow.xaml.cs');
const calDb = R('widget/CalendarDb.cs');
const calWrite = R('widget/CalendarWriteDb.cs');
const gateCs = R('widget/DbGate.cs');
const xmlToDb = R('db/deploy/xml-to-db/Program.cs');
const struct = R('db/deploy/schema-structure.sql');
const cal = R('db/deploy/schema-calendar.sql');
const frag = R('db/deploy/migrations/v15-shared-rooms.sql');
const grantsCal = R('db/deploy/grants-calendar.sql');
const createApp = R('db/deploy/create-app-user.sql');
const serverApp = R('db/deploy/server-app-account.sql');
const appAcct = R('db/deploy/app-account.ps1');

const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const stripSql = (s) => s.replace(/^[ \t]*--.*$/gm, '').replace(/[ \t]+--[^\n']*$/gm, '');
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
const member = (src, name) => {
  const m = listCsMembers(src).find((x) => x.name === name);   // name = 멤버 이름(시그니처가 아니다)
  assert.ok(m, `C# 멤버 ${name} 을 찾지 못했다(측정 불가 ≠ 통과)`);
  return m.body;
};

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 계약
// ══════════════════════════════════════════════════════════════════════
const checks = {
  //  일반 사용자의 회의실 관리 진입점과 개인 회의실 상태가 없다
  noUserEntry(src) {
    for (const id of ['btnRooms', 'fRoomMgr', 'qaRoomMgr', 'roomModal', 'roomMgrList', 'roomName', 'btnRoomAdd']) {
      assert.ok(!new RegExp('id="' + id + '"').test(src), `일반 사용자 화면에 회의실 관리 진입점 #${id} 가 남았다(SHARED-ROOMS §1)`);
    }
    const code = stripJs(src);
    for (const fn of ['addRoom', 'deleteRoom', 'openRoomModal', 'renderRoomMgr', 'refreshOpenRoomSelects', 'fillRoomSelect', 'normRooms']) {
      assert.ok(!new RegExp('function ' + fn + '\\(').test(code), `개인 회의실 함수 ${fn} 이 남았다`);
    }
    assert.ok(!/\bDEFAULT_ROOMS\b/.test(code), 'DEFAULT_ROOMS 가 남았다');
    assert.ok(!/state\.rooms\b/.test(code), '개인 상태 state.rooms 를 아직 쓴다');
    assert.ok(!/\(미등록\)<\/option>/.test(code), "장소 칸의 '(미등록)' 보존 옵션이 남았다(직접 입력이라 필요 없다)");
    assert.ok(!/\bcreateElement\('rooms'\)/.test(code), 'toXML 이 아직 <rooms> 를 쓴다');
  },
  //  장소 칸 두 곳은 콤보박스(글자 입력 + 펼침 목록)다
  locCombo(src) {
    for (const pfx of ['f', 'qa']) {
      const re = new RegExp(`<input type="text" class="loc-in" id="${pfx}Loc" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${pfx}LocPop" maxlength="200"`);
      assert.ok(re.test(src), `#${pfx}Loc 가 글자 입력 콤보박스가 아니다(role=combobox, aria-controls)`);
      assert.ok(new RegExp(`<div class="loc-pop hidden" id="${pfx}LocPop" role="listbox" aria-label="장소 추천"></div>`).test(src), `#${pfx}LocPop 목록(role=listbox)이 없다`);
      assert.ok(!new RegExp(`<select id="${pfx}Loc">`).test(src), `#${pfx}Loc 가 아직 select 다`);
    }
    const bind = extractFunction(src, 'locBind');
    for (const k of ["'ArrowDown'", "'ArrowUp'", "'Enter'", "'Escape'", "'Tab'"]) assert.ok(bind.includes(k), `장소 칸 키보드 ${k} 처리가 없다`);
    assert.ok(/ev\.isComposing \|\| ev\.keyCode === 229/.test(bind), '한글 조합 중 키 처리를 거르지 않는다');
    assert.ok(/ev\.stopPropagation\(\); locClose\(pfx\)/.test(bind), 'Esc 가 목록만 닫지 않는다(창까지 닫힐 수 있다)');
    assert.ok(/<mark>/.test(extractFunction(src, 'locHl')), '맞는 부분 강조(mark)가 없다');
    //  저장은 적은 그대로(앞뒤 공백만)
    assert.ok(/location: locRead\('f'\)/.test(extractFunction(src, 'saveEntryFromForm')), '일정 입력 창 저장이 장소 칸 글자를 그대로 쓰지 않는다');
    assert.ok(/location:lcEl \? String\(lcEl\.value \|\| ''\)\.trim\(\) : ''/.test(extractFunction(src, 'qaEventFormData')), '빠른 추가 저장이 장소 칸 글자를 그대로 쓰지 않는다');
  },
  //  loadCodes 의 세 번째 목록 = 공용 회의실
  codesCarryRooms(src, mw) {
    const ac = src.slice(src.indexOf('window.__applyCodes = function'), src.indexOf('window.__applyCodes = function') + 1200);
    assert.ok(/window\.__applyCodes = function\(sectionsJson, statusesJson, roomsJson\)\{/.test(ac), '__applyCodes 가 세 번째 인자(roomsJson)를 받지 않는다');
    assert.ok(/sharedRooms = parse\(roomsJson, sharedRooms\);/.test(ac), '__applyCodes 가 공용 회의실(sharedRooms)을 싣지 않는다(실패면 지금 목록 유지)');
    const ld = member(mw, 'LoadCodesToWebAsync');
    assert.ok(/_projectDb\.LoadRoomsJsonAsync\(\)/.test(ld), 'LoadCodesToWebAsync 가 공용 회의실을 읽지 않는다');
    assert.ok(/JsonSerializer\.Serialize\(st \?\? ""\) \+ "," \+ JsonSerializer\.Serialize\(rooms \?\? ""\) \+ "\)"/.test(ld), 'LoadCodesToWebAsync 가 회의실을 세 번째 인자로 싣지 않는다');
  },
  //  관리 화면: 묶음 일정 › 회의실, 도킹, 명령 다섯
  adminPanel(src, mw) {
    assert.ok(src.includes("{ id: 'sched',  ic: '🗓', t: '일정',      items: ['rooms'] },"), "관리 화면에 묶음 '일정'(회의실)이 없다(가안)");
    assert.ok(/rooms:\s+\{ ic: '🚪', t: '회의실',\s+ov: 'roomAdminModal', open: \(\) => openRoomAdmin\(\) \},/.test(src), '회의실 항목이 #roomAdminModal 을 열지 않는다');
    assert.ok(/const AH_DOCK_OV  = new Set\(\[[^\]]*'roomAdminModal'[^\]]*\]\);/.test(src), '#roomAdminModal 이 도킹 대상이 아니다');
    const hubAt = src.indexOf('<div class="overlay hidden" id="adminHub">'), ovAt = src.indexOf('<div class="overlay hidden" id="roomAdminModal">');
    assert.ok(hubAt > 0 && ovAt > hubAt, '#roomAdminModal 이 #adminHub 뒤에 없다(안에서 뜬 확인창이 아래에 깔린다)');
    const cmds = { roomsFull: 'raReload', roomAdd: 'raDoAdd', roomRename: 'raCommitRename', roomDelete: 'raDoDelete', roomReorder: 'raMove' };
    for (const [cmd, fn] of Object.entries(cmds)) {
      assert.ok(new RegExp(`'${cmd}'`).test(stripJs(extractFunction(src, fn))), `${fn} 이 호스트 명령 ${cmd} 를 보내지 않는다`);
      assert.ok(new RegExp(`case "${cmd}":`).test(mw), `브리지에 case "${cmd}" 가 없다`);
    }
    assert.ok(/hpost\(\{ cmd: 'loadCodes' \}\)/.test(stripJs(extractFunction(src, 'raSend'))), '회의실 관리 성공 뒤 loadCodes 가 없다(열린 장소 칸이 낡는다)');
    assert.ok(/일정에 이미 적힌 장소 글자는 그대로 남습니다/.test(extractFunction(src, 'raDoDelete')), '삭제 확인 문구가 기획과 다르다');
    assert.ok(/confirmBox\(/.test(extractFunction(src, 'raDoDelete')), '삭제가 확인 창을 거치지 않는다');
    //  브리지 → ProjectDb, 회신 {ok,msg,list}
    for (const [cmd, fn] of [['roomAdd', 'AddRoomAsync'], ['roomRename', 'RenameRoomAsync'], ['roomDelete', 'DeleteRoomAsync'], ['roomReorder', 'ReorderRoomsAsync'], ['roomsFull', 'LoadRoomsFullJsonAsync']]) {
      assert.ok(new RegExp('_projectDb\\.' + fn + '\\(').test(stripCsComments(mw)), `브리지가 ${fn} 을 부르지 않는다(${cmd})`);
    }
    assert.ok(/RunRoomReorderAsync\(GetStr\(doc, "reqId"\), GetIntArray\(doc, "ids"\)\)/.test(mw), 'roomReorder 가 번호 배열(ids)을 읽지 않는다');
    assert.ok(/RunRoomRenameAsync\(GetStr\(doc, "reqId"\), GetInt\(doc, "id"\), GetStr\(doc, "newName"\)\)/.test(mw), 'roomRename 이 번호(id)로 받지 않는다');
    const reply = member(mw, 'ReplyRoomsAsync');
    assert.ok(/ReplyOnUi\(reqId, new \{ ok, msg, list = json \?\? "" \}\)/.test(reply), '회의실 쓰기 회신이 {ok,msg,list} 가 아니다');
  },
};
//  호스트: 쓰기 넷은 관리자 관문만, 순서는 전체 집합 대조, 추가는 MAX+10(멤버는 이름으로 찾는다)
checks.hostWrites = (pdb) => {
  const members = listCsMembers(pdb);
  for (const fn of ['AddRoomAsync', 'RenameRoomAsync', 'DeleteRoomAsync', 'ReorderRoomsAsync']) {
    const m = members.find((x) => x.name === fn);
    assert.ok(m, `ProjectDb.${fn} 이 없다`);
    assert.ok(/OpenAdminAsync\(/.test(m.body), `${fn} 이 관리자 관문을 지나지 않는다`);
    assert.ok(!/OpenWriteAsync\(|OpenReadAsync\(/.test(m.body), `${fn} 이 관리자 관문 말고 다른 관문으로 연다`);
    assert.ok(/room_code/.test(m.body), `${fn} 이 room_code 를 쓰지 않는다`);
  }
  const add = members.find((x) => x.name === 'AddRoomAsync').body;
  assert.ok(/SELECT COALESCE\(MAX\(sort_order\),0\)\+10 FROM room_code/.test(add), '회의실 추가가 끝에 붙지 않는다(MAX+10)');
  assert.ok(/mex\.Number == 1062\) \{ return \(false, RoomDupMsg\); \}/.test(add), '같은 이름(1062)을 친절한 문장으로 돌려주지 않는다');
  assert.ok(/NormRoomName\(name\)/.test(add) && /RoomNameMax/.test(add), '추가가 이름을 정리하고 길이를 보지 않는다');
  const ro = members.find((x) => x.name === 'ReorderRoomsAsync').body;
  assert.ok(/SELECT room_id FROM room_code FOR UPDATE/.test(ro), '순서 바꾸기가 지금 집합을 잠근 채 읽지 않는다');
  assert.ok(/!given\.SetEquals\(live\)/.test(ro) && /return \(false, OrgTitleStaleMsg\);/.test(ro), '순서 바꾸기가 집합이 다르면 거부하지 않는다(화면이 낡았다)');
  const norm = members.find((x) => x.name === 'NormRoomName');
  assert.ok(norm && /Regex\.Replace\(name \?\? "", @"\\s\+", " "\)\.Trim\(\)/.test(norm.body), '이름 정리(공백 접기, 앞뒤 공백)가 없다');
  const users = /private static readonly string\[\] UserRecordTables\s*=\s*\{([\s\S]*?)\};/.exec(stripCsComments(pdb));
  assert.ok(users && !/cal_room/.test(users[1]), 'UserRecordTables 에 없앤 표 cal_room 이 남았다');
};
//  캘린더 읽기·쓰기·이관 도구가 cal_room 을 다루지 않는다
checks.calendarNoRooms = (cdb, cwd, x2d) => {
  for (const [name, s] of [['CalendarDb.cs', cdb], ['CalendarWriteDb.cs', cwd]]) {
    const code = stripCsComments(s);
    assert.ok(!/cal_room/.test(code), `${name} 의 코드가 아직 cal_room 을 다룬다`);
    assert.ok(!/"rooms"/.test(code), `${name} 의 코드가 아직 state 의 "rooms" 를 다룬다`);
  }
  //  XML 이관 도구는 <rooms> 를 세기만 한다(옮기지 않는다는 안내용). cal_room 에 쓰지 않는다.
  const x = stripCsComments(x2d);
  assert.ok(!/cal_room/.test(x), 'xml-to-db/Program.cs 의 코드가 아직 cal_room 을 다룬다');
  assert.ok(!/INSERT INTO cal_room|rooms\[i\]/.test(x), 'xml-to-db 가 아직 회의실을 옮긴다');
};
//  정본과 권한
checks.canon = (st, cl, gate, grants) => {
  const s = stripSql(st);
  assert.ok(/DROP TABLE IF EXISTS room_code;/.test(s), 'schema-structure.sql 이 room_code 를 먼저 지우지 않는다(재적용 1050)');
  const ddl = /CREATE TABLE room_code \(([\s\S]*?)\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci\s+COMMENT='([^']*)';/.exec(s);
  assert.ok(ddl, 'schema-structure.sql 에 room_code 가 없다');
  for (const re of [/room_id\s+SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT/, /name\s+VARCHAR\(40\)\s+NOT NULL/, /sort_order\s+INT\s+NOT NULL/,
    /created_at\s+DATETIME\(3\)/, /updated_at\s+DATETIME\(3\)/, /PRIMARY KEY \(room_id\)/, /UNIQUE KEY uq_room_code_name \(name\)/, /CONSTRAINT chk_room_code_name CHECK \(name <> ''\)/]) {
    assert.ok(re.test(ddl[1]), `room_code 정의에 ${re} 가 없다`);
  }
  assert.ok(!/\bis_active\b/.test(ddl[1]), 'room_code 에 숨김(is_active)이 있다(기획: 숨김과 휴지통 없음)');
  const c = stripSql(cl);
  assert.ok(!/CREATE TABLE cal_room\b/.test(c) && !/DROP TABLE IF EXISTS cal_room\b/.test(c), 'schema-calendar.sql 에 cal_room 이 남았다');
  assert.ok(/VALUES \('db_structure_version', '15', UTC_TIMESTAMP\(3\)\)/.test(c), '정본 구조 번호가 15 가 아니다');
  assert.ok(/public const int AppStructureVersion = 15;/.test(gate), 'DbGate.AppStructureVersion 이 15 가 아니다');
  const { grantsCal: gc, createApp: ca, serverApp: sa, appAcct: aa } = grants;
  assert.ok(!/ON\s+\S*cal_room\b/.test(stripSql(gc)) && !/cal_room/.test(stripSql(sa)) && !/cal_room/.test(stripSql(ca)), '권한 파일에 없앤 표 cal_room 의 GRANT 가 남았다');
  assert.ok(/GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr\.room_code\s+TO 'taskmgr_app'@'%';/.test(ca), 'create-app-user.sql 에 room_code 권한이 없다');
  assert.ok(/GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`\.`room_code` TO 'taskmgr_app'@'%';/.test(sa), 'server-app-account.sql 에 room_code 권한이 없다');
  assert.ok(/GRANT SELECT, INSERT, UPDATE, DELETE ON ``\$DbName``\.room_code TO '\$AppUser'@'%';/.test(aa), 'app-account.ps1 에 room_code 권한이 없다');
};
//  이관 조각 v15(release-sql.ps1 의 기계 검사와 같은 규칙 + 이 조각의 내용)
checks.fragment = (text, st) => {
  const t = text.replace(/\r\n/g, '\n');
  assert.ok(/^-- @migration from=14 to=15[ \t]*\n/.test(t), "첫 줄이 '-- @migration from=14 to=15' 가 아니다");
  assert.strictEqual((t.match(/^-- @migration /gm) || []).length, 1, "'-- @migration' 줄이 하나가 아니다");
  const code = t.replace(/^[ \t]*--.*$/gm, '');
  const bump = "UPDATE cal_schema_meta SET v = '15', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'db_structure_version' AND v = '14';";
  assert.ok(code.includes(bump), '끝에서 구조 번호를 14 에서 15 로 올리는 UPDATE 가 없다');
  assert.ok(!/\b(UPDATE|INSERT|REPLACE|DELETE)\b[^;]*db_updating/i.test(code), 'db_updating 을 쓴다(닫기와 열기는 release SQL 의 몫)');
  assert.ok(!/\b(DELIMITER|PROCEDURE|FUNCTION|TRIGGER|DEFINER)\b/i.test(code), '저장 프로그램이나 DELIMITER 를 쓴다');
  assert.ok(!code.includes('@r_'), '감싸개 변수(@r_)를 쓴다');
  //  잠금 대기 상한은 release SQL 맨 위에서 한 번만 건다(release-sql.test.mjs ②a). 조각이 다시 걸면 규칙 위반(④)이다.
  assert.ok(!/SET SESSION|lock_wait_timeout/.test(code), '조각이 잠금 대기 상한을 건다(release SQL 맨 위의 몫)');
  //  변수 이름은 조각 규칙(DB-RELEASE-OPS §5.2)과 release-sql.test.mjs ④ 가 보는 @go, @skip, @g 를 쓴다
  //  건너뛰기와 멈춤: 15 이상이면 건너뛰고, 14 도 15 이상도 아니면 1146, 14 인데 닫히지 않았으면 1146
  assert.ok(/SET @skip := \(@m_cur REGEXP '\^\[0-9\]\{1,6\}\$' AND CAST\(@m_cur AS UNSIGNED\) >= 15\);/.test(code), '이미 15 이상인 DB 를 건너뛰지 않는다');
  assert.ok(/SET @go := \(@m_cur <=> '14'\);/.test(code), '14 에서만 바꾸지 않는다');
  assert.ok(/IF\(@go OR @skip, 'DO 0',\s*'SELECT 1 FROM `중단: [^`]+`'\)/.test(code), '14 도 15 이상도 아니면 멈추지 않는다(1146)');
  assert.ok(/IF\(NOT @go OR @m_upd <=> '1', 'DO 0',\s*'SELECT 1 FROM `중단: [^`]+`'\)/.test(code), '닫히지 않은 DB(db_updating 이 1 이 아님)에서 멈추지 않는다');
  //  바꾸는 문장은 전부 PREPARE 로(건너뛸 때는 아무것도 하지 않는다). 정적 쓰기는 마지막 구조 번호 한 줄뿐
  const staticWrites = (code.match(/^\s*(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE)\b/gim) || []);
  assert.strictEqual(staticWrites.length, 1, '조건 없이 바로 도는 쓰기 문장이 구조 번호 UPDATE 말고도 있다: ' + staticWrites.join(','));
  //  내용
  const at = (re, what) => { const m = re.exec(code); assert.ok(m, what + ' 이 없다'); return m.index; };
  const create = at(/'CREATE TABLE IF NOT EXISTS room_code \(/, 'room_code 만들기(IF NOT EXISTS)');
  at(/TABLE_NAME = 'cal_room'/, 'cal_room 이 있는지 보는 확인(information_schema)');
  const insert = at(/'INSERT IGNORE INTO room_code \(name, sort_order, created_at, updated_at\)[\s\S]*?FROM cal_room WHERE TRIM\(name\) <> '''' GROUP BY TRIM\(name\) COLLATE utf8mb4_0900_ai_ci\) t'/, 'cal_room 이름 모으기(INSERT IGNORE, 공백 정리, 같은 이름 합치기)');
  assert.ok(/ROW_NUMBER\(\) OVER \(ORDER BY users DESC, nm\) \* 10/.test(code), '모은 이름의 순서(쓰는 사람 수, 이름)와 10 간격이 없다');
  const verify = at(/IF\(NOT @go OR \(@m_rows >= 0 AND \(NOT @m_take OR \(@m_miss = 0 AND @m_rows = @m_dist\)\)\), 'DO 0',/, '검증(넣은 줄 수 = 고유 이름 수, 빠진 이름 0)');
  const drop = at(/IF\(@m_take, 'DROP TABLE cal_room', 'DO 0'\)/, 'cal_room 지우기(있을 때만, PREPARE)');
  const up = code.indexOf(bump);
  assert.ok(create < insert && insert < verify && verify < drop && drop < up, '순서가 (만들기, 모으기, 검증, 지우기, 구조 번호) 가 아니다');
  //  만드는 정의가 정본과 같다(열, 키, CHECK, 표 설명)
  const norm = (x) => x.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const canon = /CREATE TABLE room_code \(([\s\S]*?\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci\s+COMMENT='[^']*')/.exec(st);
  const mine = /'CREATE TABLE IF NOT EXISTS room_code \(([\s\S]*?\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci\s+COMMENT=''[^']*'')',/.exec(code);
  assert.ok(canon && mine, 'room_code 정의를 두 곳에서 읽지 못했다');
  //  조각 쪽은 SQL 문자열 안이라 따옴표가 두 겹('')이다. 한 겹으로 풀어 비교한다.
  assert.strictEqual(norm(mine[1]).replace(/''/g, "'"), norm(canon[1]), '이관 조각의 room_code 정의가 정본(schema-structure.sql)과 다르다');
};

test('일반 화면: 회의실 관리 진입점 넷과 개인 회의실 상태, (미등록) 옵션이 없다', () => checks.noUserEntry(app));
test('장소 칸: #fLoc, #qaLoc 는 글자 입력 콤보박스(↑↓ Enter Esc Tab, 강조), 저장은 적은 그대로', () => checks.locCombo(app));
test('loadCodes: 공용 회의실을 세 번째 목록으로 싣는다(호스트와 웹)', () => checks.codesCarryRooms(app, mainWindow));
test('관리 화면: 일정 › 회의실이 #roomAdminModal 을 도킹하고 다섯 명령으로 조작한다', () => checks.adminPanel(app, mainWindow));
test('호스트: 회의실 쓰기 넷은 관리자 관문만, 추가는 끝에, 순서는 전체 집합 대조', () => checks.hostWrites(projectDb));
test('캘린더 읽기, 쓰기, XML 이관 도구가 cal_room 과 rooms 를 다루지 않는다', () => checks.calendarNoRooms(calDb, calWrite, xmlToDb));
test('정본: room_code 가 있고 cal_room 이 없으며 구조 번호 15, 권한 파일이 맞물린다', () =>
  checks.canon(struct, cal, gateCs, { grantsCal, createApp, serverApp, appAcct }));
test('이관 조각 v15: 머리, 건너뛰기, 닫힘 확인, 모으기, 검증, 지우기, 15 올리기, 정본과 같은 정의', () => checks.fragment(frag, struct));

// ── 변이 ─────────────────────────────────────────────────────────────
test('변이R1: ⋯ 메뉴의 회의실 관리를 되살리면 진입점 검사가 잡는다', () => {
  const bad = mutate(app, '<button id="btnUpdateCheck">업데이트 확인</button>', '<button id="btnUpdateCheck">업데이트 확인</button><button id="btnRooms">회의실 관리</button>');
  assert.throws(() => checks.noUserEntry(bad), /#btnRooms/);
});
test('변이R2: 장소 칸을 select 로 되돌리면 콤보박스 검사가 잡는다', () => {
  const bad = mutate(app, '<input type="text" class="loc-in" id="fLoc"', '<select id="fLoc"></select><input type="text" class="loc-in" id="fLocX"');
  assert.throws(() => checks.locCombo(bad), /#fLoc 가 글자 입력 콤보박스가 아니다/);
});
test('변이R3: 회의실 추가를 쓰기 관문으로 내리면 호스트 검사가 잡는다', () => {
  const bad = mutate(projectDb,
    'try { conn = await OpenAdminAsync(cts.Token); }\n                catch (NotAuthorizedException nex) { _log("권한 거부(회의실 추가): "',
    'try { conn = await OpenWriteAsync(cts.Token); }\n                catch (NotAuthorizedException nex) { _log("권한 거부(회의실 추가): "');
  assert.throws(() => checks.hostWrites(bad), /AddRoomAsync 이 관리자 관문을 지나지 않는다/);
});
test('변이R4: 조각의 검증을 끄면 잡는다', () => {
  const bad = mutate(frag, 'IF(NOT @go OR (@m_rows >= 0 AND (NOT @m_take OR (@m_miss = 0 AND @m_rows = @m_dist))), ', 'IF(1, ');
  assert.throws(() => checks.fragment(bad, struct), /검증/);
});
test('변이R5: 조각이 db_updating 을 쓰거나 지우기를 검증 앞으로 옮기면 잡는다', () => {
  const w = mutate(frag, "UPDATE cal_schema_meta SET v = '15', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'db_structure_version' AND v = '14';",
    "UPDATE cal_schema_meta SET v = '15', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'db_structure_version' AND v = '14';\nUPDATE cal_schema_meta SET v = '0' WHERE k = 'db_updating';");
  assert.throws(() => checks.fragment(w, struct), /db_updating 을 쓴다/);
  const d = mutate(frag, "SET @s := IF(@m_take, 'DROP TABLE cal_room', 'DO 0');", "SELECT 1;");
  const moved = mutate(d, '-- 4) 검증', "SET @s := IF(@m_take, 'DROP TABLE cal_room', 'DO 0');\n-- 4) 검증");
  assert.throws(() => checks.fragment(moved, struct), /순서가/);
});
test('변이R6: 조각의 room_code 정의가 정본과 갈라지면 잡는다', () => {
  const bad = mutate(frag, '  name        VARCHAR(40)  NOT NULL,\n', '  name        VARCHAR(80)  NOT NULL,\n');
  assert.throws(() => checks.fragment(bad, struct), /정본\(schema-structure\.sql\)과 다르다/);
});
test('변이R7: CalendarWriteDb 가 cal_room 저장을 되살리면 잡는다', () => {
  const bad = calWrite + '\n        private const string X = "DELETE FROM cal_room WHERE user_id=1";\n';
  assert.throws(() => checks.calendarNoRooms(calDb, bad, xmlToDb), /CalendarWriteDb\.cs 의 코드가 아직 cal_room/);
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('shared-rooms: jsdom 미설치. 장소 칸과 관리 화면 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const ME = { loginId: 'phmin', name: '박현민', title: '수석연구원', orgUnit: 'SW 3팀' };
  const CA = '2026-10-01T00:00:00.000Z';
  const STATE = {
    categories: [{ id: 'c-1', name: '과제', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
    entries: [{ id: 'e-old', date: '2026-10-21', title: '옛 회의', categoryId: 'c-1', allDay: false, startTime: '09:00', endTime: '10:00',
      location: '없어진 회의실 B', memo: '', source: '', commits: [], hours: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }],
    todos: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '',
  };
  const ROOMS = [{ id: 1, name: '대회의실' }, { id: 2, name: '소회의실 A' }, { id: 3, name: '3층 세미나실' }];
  const LIST = (rows) => JSON.stringify(rows.map((r, i) => ({ id: r.id, name: r.name, sort: (i + 1) * 10 })));
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

  //  관리 화면은 관리 창(?win=admin)에서만 열린다(2026-10-22, docs/ADMIN-WINDOW.md). 회의실 관리 시험은 그 창(A)에서 돈다.
  //    관리 창의 window.close() 는 호스트가 창을 닫는 길이라 시험에서는 횟수만 센다.
  function boot(src, url = 'https://tcapp.local/') {
    const posted = [], errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => errors.push(String(e && (e.stack || e.message) || e)));
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
      beforeParse(win) {
        win.chrome = { webview: { postMessage: (s) => posted.push(String(s)), addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.__closeCalls = 0; win.close = function () { win.__closeCalls++; };
      },
    });
    const w = dom.window;
    const B = { w, posted, errors, doc: w.document, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')) };
    w.eval(`window.__calls = []; window.__rep = {};
      hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
        var r = __rep[cmd];
        if(r === undefined) return Promise.resolve({ ok:false, msg:'시험: 회신 없음' });
        return Promise.resolve(JSON.parse(JSON.stringify(typeof r === 'function' ? r(p) : r))); };`);
    const sess = posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).find((m) => m && m.cmd === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: ME }) + ')');
    w.eval('currentUser = ' + JSON.stringify(ME));
    if (!/win=admin/.test(url)) w.__applyState(JSON.stringify(STATE), {});   // 관리 창은 내 달력을 받지 않는다(호스트가 __applyState 를 메인 창에만 민다)
    w.eval('dbOnline = true;');
    w.__applyCodes('', '', JSON.stringify(ROOMS));
    return B;
  }
  const $ = (B, s) => B.doc.querySelector(s);
  const key = (B, el, k) => el.dispatchEvent(new B.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = (B, el, v) => { el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); };
  const opts = (B, pfx) => [...B.doc.querySelectorAll(`#${pfx}LocPop .loc-opt`)].map((o) => o.textContent.replace('✓', '').trim());
  const popOpen = (B, pfx) => !$(B, `#${pfx}LocPop`).classList.contains('hidden');
  const calls = (B, cmd) => B.evJSON('__calls').filter((c) => !cmd || c[0] === cmd);
  const postedCmds = (B) => B.posted.map((s) => { try { return JSON.parse(s).cmd; } catch (_) { return ''; } });

  let B = null, A = null;
  test('(R) 부팅: 오류 없이 뜨고 공용 회의실 셋이 sharedRooms 에 실린다(개인 state.rooms 없음)', () => {
    B = boot(app);
    assert.deepStrictEqual(B.errors, [], '부팅 중 페이지 오류');
    assert.deepStrictEqual(B.evJSON('sharedRooms.map(function(r){ return r.name; })'), ['대회의실', '소회의실 A', '3층 세미나실']);
    assert.strictEqual(B.ev('typeof state.rooms'), 'undefined', '개인 회의실 상태가 남았다');
    //  실패('')나 깨진 값은 지금 목록을 그대로 둔다
    B.w.__applyCodes('', '', '');
    B.w.__applyCodes('', '', '{깨짐');
    assert.strictEqual(B.ev('sharedRooms.length'), 3, '회의실 목록 실패 회신이 지금 목록을 지웠다');
  });

  test('(R) 일정 입력 창: 칸을 누르면 목록, 글자로 걸러지고 강조, ↓ Enter 로 넣기, Esc 는 목록만 닫는다', async () => {
    B.ev("openEntryModal('new', '2026-10-22')");
    await settle(40);
    const inp = $(B, '#fLoc');
    assert.strictEqual(inp.getAttribute('role'), 'combobox');
    inp.dispatchEvent(new B.w.Event('focus'));
    await settle();
    assert.ok(popOpen(B, 'f'), '칸에 들어가도 목록이 펼쳐지지 않는다');
    assert.strictEqual(inp.getAttribute('aria-expanded'), 'true');
    assert.deepStrictEqual(opts(B, 'f'), ['대회의실', '소회의실 A', '3층 세미나실']);
    type(B, inp, '회의');
    assert.deepStrictEqual(opts(B, 'f'), ['대회의실', '소회의실 A'], '친 글자로 걸러지지 않는다');
    assert.ok(/<mark>회의<\/mark>/.test($(B, '#fLocPop').innerHTML), '맞는 부분이 강조되지 않는다');
    key(B, inp, 'ArrowDown'); key(B, inp, 'ArrowDown');
    assert.strictEqual(inp.getAttribute('aria-activedescendant'), 'fLocOpt1', '↓ 가 두 번째 줄을 가리키지 않는다');
    key(B, inp, 'ArrowUp');
    assert.strictEqual(inp.getAttribute('aria-activedescendant'), 'fLocOpt0');
    key(B, inp, 'ArrowDown'); key(B, inp, 'Enter');
    assert.strictEqual(inp.value, '소회의실 A', 'Enter 가 고른 회의실을 넣지 않는다');
    assert.ok(!popOpen(B, 'f'), '고른 뒤 목록이 닫히지 않는다');
    key(B, inp, 'ArrowDown');
    assert.ok(popOpen(B, 'f'), '닫힌 칸에서 ↓ 가 목록을 열지 않는다');
    key(B, inp, 'Escape');
    assert.ok(!popOpen(B, 'f'), 'Esc 가 목록을 닫지 않는다');
    assert.ok(!$(B, '#entryModal').classList.contains('hidden'), 'Esc 가 일정 입력 창까지 닫았다');
  });

  test('(R) 직접 입력: 목록에 없는 장소는 적은 그대로 저장되고 안내가 뜬다', async () => {
    const inp = $(B, '#fLoc');
    type(B, inp, '고객사 3층 회의실');
    assert.deepStrictEqual(opts(B, 'f'), []);
    assert.ok(/목록에 없는 장소입니다\. 적은 그대로 저장됩니다\./.test($(B, '#fLocPop').textContent), '직접 입력 안내가 없다');
    B.ev("$('#fTitle').value = '고객 협의'; saveEntryFromForm();");
    await settle(40);
    const saved = B.evJSON("state.entries.filter(function(e){ return e.title === '고객 협의'; }).map(function(e){ return e.location; })");
    assert.deepStrictEqual(saved, ['고객사 3층 회의실'], '직접 적은 장소가 그대로 저장되지 않았다');
  });

  test('(R) 옛 일정: 목록에 없는 장소도 그대로 열리고 (미등록) 꼬리가 없다', async () => {
    B.ev("openEntryModal('edit', 'e-old')");
    await settle(40);
    assert.strictEqual($(B, '#fLoc').value, '없어진 회의실 B');
    assert.ok(!/미등록/.test($(B, '#entryModal').textContent), "'(미등록)' 표시가 남았다");
    const clr = $(B, '#entryModal .loc-clr');
    assert.ok(!clr.classList.contains('hidden'), '값이 있는데 지우기 × 가 숨어 있다');
    clr.click();
    assert.strictEqual($(B, '#fLoc').value, '', '× 가 장소를 지우지 않는다');
    B.ev("closeOverlay(document.getElementById('entryModal'))");
    await settle(200);
  });

  test('(R) 빠른 추가: 장소, 반복 두 칸 나란히, 같은 콤보박스, 직접 입력 저장', async () => {
    B.ev("openQuickAdd('2026-10-23', 'event'); qaToggleDetail();");
    await settle(40);
    const inp = $(B, '#qaLoc');
    assert.ok(inp && inp.getAttribute('role') === 'combobox', '빠른 추가 장소 칸이 콤보박스가 아니다');
    assert.ok($(B, '#qaDetail .row2 #qaRecur'), '반복 칸이 장소 옆(row2)에 없다');
    assert.ok(!$(B, '#qaRoomMgr'), '빠른 추가에 회의실 관리 링크가 남았다');
    inp.dispatchEvent(new B.w.Event('focus'));
    type(B, inp, '세미');
    assert.deepStrictEqual(opts(B, 'qa'), ['3층 세미나실']);
    key(B, inp, 'ArrowDown'); key(B, inp, 'Enter');
    assert.strictEqual(inp.value, '3층 세미나실');
    type(B, inp, '  판교 현장  ');
    B.ev("$('#qaTitle').value = '현장 점검'; qaSave();");
    await settle(40);
    const saved = B.evJSON("state.entries.filter(function(e){ return e.title === '현장 점검'; }).map(function(e){ return e.location; })");
    assert.deepStrictEqual(saved, ['판교 현장'], '빠른 추가의 직접 입력 장소가 저장되지 않았다(앞뒤 공백만 지운다)');
  });

  test('(R) 관리 화면 › 일정 › 회의실: 목록을 읽고, ▲▼ 순서, 이름변경(Enter), 삭제(확인), 추가, 같은 이름 거절', async () => {
    A = boot(app, 'https://tcapp.local/?win=admin');
    let rows = ROOMS.slice();
    A.ev(`__rep = {
      roomsFull: { ok: true, msg: '', list: ${JSON.stringify(LIST(rows))} },
      roomReorder: function(p){ return { ok: true, msg: '회의실 순서를 바꿨습니다.', list: JSON.stringify(p.ids.map(function(id, i){ var r = ${JSON.stringify(rows)}.find(function(x){ return x.id === id; }); return { id: id, name: r.name, sort: (i + 1) * 10 }; })) }; },
      roomRename: { ok: true, msg: '바꿨습니다.', list: ${JSON.stringify(LIST([{ id: 1, name: '대회의실(본관)' }, rows[1], rows[2]]))} },
      roomDelete: { ok: true, msg: '회의실을 지웠습니다.', list: ${JSON.stringify(LIST([rows[0], rows[1]]))} },
      roomAdd: { ok: true, msg: '추가했습니다.', list: ${JSON.stringify(LIST([rows[0], rows[1], { id: 4, name: '4층 소회의실' }]))} },
    }; __calls.length = 0; ahNoteRole(true);`);
    A.ev("openAdminHub('rooms')");
    await settle(80);
    assert.ok(A.ev("isOverlayOpen(document.getElementById('adminHub'))"), '관리 화면이 열리지 않았다');
    assert.strictEqual($(A, '#roomAdminModal').parentElement.id, 'ahSlot', '회의실 창이 관리 화면 칸에 도킹되지 않았다');
    assert.ok($(A, '#ahSeg [data-ahgrp="sched"]').classList.contains('on'), "묶음 '일정' 이 고른 상태가 아니다");
    assert.deepStrictEqual(calls(A).map((c) => c[0]).filter((c) => c !== 'userInfoGet'), ['roomsFull']);
    const names = () => [...A.doc.querySelectorAll('#raList .cust-row .cust-nm')].map((n) => n.textContent);
    assert.deepStrictEqual(names(), ['대회의실', '소회의실 A', '3층 세미나실']);
    assert.strictEqual($(A, '#ahNrooms').textContent, '3', '항목 개수가 목록과 다르다');
    //  ▼: 번호 배열 전체를 보낸다
    $(A, '#raList [data-radown="1"]').click();
    await settle(40);
    assert.deepStrictEqual(calls(A, 'roomReorder').map((c) => c[1]), [{ ids: [2, 1, 3] }], '순서 바꾸기가 번호 전체 배열을 보내지 않는다');
    assert.ok(postedCmds(A).includes('loadCodes'), '성공 뒤 loadCodes 로 장소 칸 목록을 다시 받지 않는다');
    //  이름변경: 그 자리, Enter 저장
    $(A, '#raList [data-raedit="1"]').click();
    const ed = $(A, '#raList .cust-edit input');
    assert.ok(ed, '그 자리 이름 칸이 열리지 않는다');
    ed.value = '대회의실(본관)';
    key(A, ed, 'Enter');
    await settle(40);
    assert.deepStrictEqual(calls(A, 'roomRename').map((c) => c[1]), [{ id: 1, newName: '대회의실(본관)' }]);
    //  Esc 는 취소(창은 그대로)
    $(A, '#raList [data-raedit="2"]').click();
    key(A, $(A, '#raList .cust-edit input'), 'Escape');
    assert.ok(!$(A, '#raList .cust-edit'), 'Esc 가 이름 바꾸기를 취소하지 않는다');
    assert.ok(A.ev("isOverlayOpen(document.getElementById('adminHub'))"), 'Esc 가 관리 화면까지 닫았다');
    //  삭제: 확인 창 한 번
    $(A, '#raList [data-radel="3"]').click();
    await settle(40);
    assert.ok(!$(A, '#confirmModal').classList.contains('hidden'), '삭제 확인 창이 뜨지 않는다');
    assert.ok(/일정에 이미 적힌 장소 글자는 그대로 남습니다/.test($(A, '#cfMsg').textContent), '삭제 확인 문구가 기획과 다르다');
    assert.strictEqual(calls(A, 'roomDelete').length, 0, '확인 전에 지웠다');
    $(A, '#cfOk').click();
    await settle(250);
    assert.deepStrictEqual(calls(A, 'roomDelete').map((c) => c[1]), [{ id: 3 }]);
    assert.deepStrictEqual(names(), ['대회의실', '소회의실 A'], '삭제 회신의 목록으로 다시 그리지 않았다');
    //  같은 이름(띄어쓰기, 대소문자만 다름)은 보내지 않는다
    $(A, '#raNewName').value = ' 소회의실a ';
    $(A, '#raAddBtn').click();
    await settle(20);
    assert.strictEqual(calls(A, 'roomAdd').length, 0, '같은 이름을 호스트에 보냈다');
    assert.ok(/이미 목록에 있습니다/.test($(A, '#raMsg').textContent), '같은 이름 안내가 없다');
    //  추가: 앞뒤 공백, 안쪽 공백 정리
    $(A, '#raNewName').value = '  4층   소회의실 ';
    key(A, $(A, '#raNewName'), 'Enter');
    await settle(40);
    assert.deepStrictEqual(calls(A, 'roomAdd').map((c) => c[1]), [{ name: '4층 소회의실' }]);
    assert.strictEqual($(A, '#raNewName').value, '', '추가 뒤 칸이 비지 않는다');
  });

  test('(R) 관리자가 아니면 관리 화면(회의실 항목 포함)이 열리지 않는다', async () => {
    A.ev("document.getElementById('adminHub').classList.add('hidden')");   // 관리 창을 닫았다 다시 연 자리
    await settle(250);
    A.ev('__calls.length = 0; ahNoteRole(false);');
    A.ev("openAdminHub('rooms')");
    await settle(60);
    assert.ok(!A.ev("isOverlayOpen(document.getElementById('adminHub'))"), '관리자가 아닌데 관리 화면이 열렸다');
    assert.strictEqual(calls(A, 'roomsFull').length, 0, '관리자가 아닌데 회의실 목록을 물었다');
    assert.deepStrictEqual(A.errors, [], '시험 중 페이지 오류');
  });
}
