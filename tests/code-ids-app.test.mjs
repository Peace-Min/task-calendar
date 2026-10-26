// 코드표 번호 키 B단계(앱: 호스트 C# 과 웹) 계약 — docs/CODE-TABLE-IDS.md §3·§4·§10 (2026-10-15).
//
// 이 파일이 지키는 것 넷:
//   (가) 이름 글자로 동작을 가르는 코드가 웹과 호스트 어디에도 없다. 동작은 고정 번호(호스트 CodeIds, 웹 CODE_ID)로 판정한다.
//   (나) 상태 2(종료)의 이름을 바꿔도 엑셀 강조와 목록 색이 남는다. 상태 거르기는 체크박스의 번호로 하고 특별한 상태는 없다.
//        ★ 2026-10-26(PROJECT-ADMIN-UX §1.4): 선진행 날짜 잠금과 '진행중만' 필터를 지웠다. 구분, 상태, 날짜는 서로 독립이다.
//   (다) 구분 2, 상태 2 도 다른 행과 같다(숨김, 삭제, 이름 바꾸기, 순서). 그 행들을 막던 보호는 위 규칙과 함께 지웠다.
//   (라) 편집, 관리, 휴지통 메시지는 번호를 싣고, 표시 payload 는 이름과 번호를 함께 싣는다.
//   DB 쪽(스키마, 이관 SQL, setup)은 code-ids-db.test.mjs 가 본다.
//
//   ★ 검사는 전부 checks 의 함수다 — 변이가 같은 함수를 다시 불러 '잡았다'를 증명한다(장식 검사 방지).
import { test, skip, assert, loadAppSource, extractFunction, extractCodeIdsBlock, stripCsComments, extractCsMember,
         importOptional, useJsdom, runInJsdom, SKIP_NO_JSDOM, readText } from './harness.mjs';
import { readdirSync } from 'node:fs';

const app = loadAppSource();
const R = (p) => readText(new URL('../' + p, import.meta.url));
const pdb = R('widget/ProjectDb.cs');
const main = R('widget/MainWindow.xaml.cs');
const schema = R('db/deploy/schema-structure.sql');
const hostFiles = readdirSync(new URL('../widget/', import.meta.url)).filter((f) => f.endsWith('.cs'))
  .map((f) => [f, R('widget/' + f)]);

function mutate(src, from, to) {
  const out = src.replace(from, to);
  assert.notStrictEqual(out, src, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

// 주석 제거(웹) — 줄 주석은 공백 뒤의 // 만 친다(URL 의 :// 는 남는다). 블록 주석과 HTML 주석은 통째로 지운다.
function stripJs(text) {
  const t = String(text).replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  return t.split(/\r*\n/).map((l) => l.replace(/(^|\s)\/\/[^\r\n]*$/, '$1')).join('\n');
}
// 한 줄 const 선언을 원본 그대로 가져온다(값을 시험에 베끼지 않는다).
function constLine(src, name) {
  const m = new RegExp('^const ' + name + '\\s*=.*$', 'm').exec(src);
  if (!m) throw new Error(`const ${name} 선언을 찾지 못함`);
  return m[0];
}
// esc 는 두 줄짜리 화살표 함수다 — 다음 선언(const pad) 앞까지 그대로 오린다.
function escDecl(src) {
  const a = src.indexOf('const esc = ');
  const b = src.indexOf('\nconst pad', a);
  if (a < 0 || b < 0) throw new Error('esc 선언을 찾지 못함');
  return src.slice(a, b);
}

// ══ 이름 글자 비교 탐지기 ═══════════════════════════════════════════
//   시드 라벨(구분 셋, 상태 넷)이 **비교, switch, 사전 열쇠, 집합 질의**에 쓰이면 그것은 이름으로 동작을 가르는 코드다.
//   화면 글자(안내 문장 안의 낱말)나 메뉴 이름("종료" = 위젯 끄기)은 잡지 않는다 — 비교가 아니기 때문이다.
const NAMES = ['일반계약', '선진행', '사업부관리', '진행중', '종료', '1차 납품완료', '미정'];
const ALT = NAMES.join('|');
const JS_BAD = [
  new RegExp(`(?:===|!==|==|!=)\\s*['"\`](?:${ALT})['"\`]`),
  new RegExp(`['"\`](?:${ALT})['"\`]\\s*(?:===|!==|==|!=)`),
  new RegExp(`case\\s+['"\`](?:${ALT})['"\`]\\s*:`),
  new RegExp(`\\[\\s*['"\`](?:${ALT})['"\`]\\s*\\]`),
  new RegExp(`[{,]\\s*['"\`](?:${ALT})['"\`]\\s*:`),
  new RegExp(`\\.(?:includes|indexOf|has|get)\\(\\s*['"\`](?:${ALT})['"\`]\\s*\\)`),
];
const CS_BAD = [
  new RegExp(`(?:==|!=)\\s*"(?:${ALT})"`),
  new RegExp(`"(?:${ALT})"\\s*(?:==|!=)`),
  new RegExp(`case\\s+"(?:${ALT})"\\s*:`),
  new RegExp(`\\[\\s*"(?:${ALT})"\\s*\\]`),
  new RegExp(`Equals\\([^)\\n]*"(?:${ALT})"`),
  new RegExp(`\\.(?:Contains|IndexOf|ContainsKey|TryGetValue|StartsWith)\\(\\s*"(?:${ALT})"`),
];
function offenders(code, pats, label) {
  const bad = [];
  code.split('\n').forEach((line, i) => { for (const p of pats) if (p.test(line)) { bad.push(`${label}:${i + 1}: ${line.trim().slice(0, 140)}`); break; } });
  return bad;
}

// 호스트 상수 읽기 — public const int X = n;
function csInt(src, name) {
  const m = new RegExp('public const int ' + name + '\\s*=\\s*(\\d+);').exec(stripCsComments(src));
  assert.ok(m, `CodeIds.${name} 상수를 찾지 못했다`);
  return Number(m[1]);
}
function csStr(src, name) {
  const m = new RegExp('public const string ' + name + '\\s*=\\s*"([^"]*)";').exec(src);
  assert.ok(m, `CodeIds.${name} 문장을 찾지 못했다`);
  return m[1];
}
// 웹 고정 번호 머리를 실제로 돌려 값으로 받는다(글자 대조가 아니라 평가 결과).
function webCodeIds(src) {
  return new Function(extractCodeIdsBlock(src) + '\nreturn { CODE_ID, codeIdOf, DB_SECTION_COLORS, sectionColor };')();
}
function caseBlock(cs, name) {
  const i = cs.indexOf('case "' + name + '":');
  assert.ok(i >= 0, `MainWindow 에 case "${name}" 가 없다`);
  const e = cs.indexOf('break;', i);
  return cs.slice(i, e);
}

const checks = {
  // (가) 이름 글자로 동작을 가르는 코드가 없다.
  noNameBehavior(web, files) {
    const bad = offenders(stripJs(web), JS_BAD, 'html');
    for (const [f, s] of files) bad.push(...offenders(stripCsComments(s), CS_BAD, f));
    assert.deepStrictEqual(bad, [], '이름 글자로 동작을 가르는 코드가 남아 있다(고정 번호 CODE_ID / CodeIds 로 판정할 것):\n' + bad.join('\n'));
  },

  // ⓪ 고정 번호가 세 곳(호스트 CodeIds, 웹 CODE_ID, 시드)에서 같다. 번호는 표시(상태 색)에만 쓴다.
  //   ★ 2026-10-26: 선진행 번호(SECTION_PRE)와 보호 문장(CODE_PROTECT_WHY, SectionPreMsg, StatusEndedMsg)은 규칙과 함께 지웠다.
  fixedIdsAgree(web, cs, sql) {
    const w = webCodeIds(web);
    const host = { STATUS_ACTIVE: csInt(cs, 'StatusActive'), STATUS_ENDED: csInt(cs, 'StatusEnded') };
    assert.deepStrictEqual({ ...w.CODE_ID }, host, '웹 CODE_ID 와 호스트 CodeIds 가 다르다(선진행 번호 같은 옛 동작 번호가 남았는지 볼 것)');
    const seed = (t, id, name) => new RegExp(`INSERT INTO ${t} \\(${t === 'section_code' ? 'section_id' : 'status_id'}, name, sort_order\\) VALUES[^;]*\\(${id}, '${name}',`).test(sql);
    assert.ok(seed('status_code', host.STATUS_ENDED, '종료'), `시드에서 종료의 번호가 ${host.STATUS_ENDED} 가 아니다`);
    assert.ok(seed('status_code', host.STATUS_ACTIVE, '진행중'), `시드에서 진행중의 번호가 ${host.STATUS_ACTIVE} 가 아니다`);
    assert.ok(seed('status_code', csInt(cs, 'StatusDelivered'), '1차 납품완료'), '시드에서 1차 납품완료의 번호가 CodeIds.StatusDelivered 가 아니다');
    assert.ok(!/CODE_PROTECT_WHY|codeProtectedWhy/.test(web), '웹에 코드 행 보호 표(CODE_PROTECT_WHY, codeProtectedWhy)가 남아 있다');
    //  구분 색 표는 번호가 열쇠다(§3-4). 시드 셋 모두 색이 있고, 표에 없는 번호는 기본색.
    assert.deepStrictEqual(Object.keys(w.DB_SECTION_COLORS).sort(), ['1', '2', '3'], '구분 색 표의 열쇠가 번호 1, 2, 3 이 아니다');
    assert.strictEqual(w.sectionColor(99), '#5b6b7d', '표에 없는 번호가 기본색으로 떨어지지 않는다');
    assert.strictEqual(w.sectionColor('선진행'), '#5b6b7d', '이름을 넣었는데 색이 나온다(이름이 아직 열쇠다)');
  },

  // (나)-호스트: 엑셀 강조는 상태 번호로 판정한다. 구분은 날짜와 상태를 건드리지 않는다.
  //   ★ 2026-10-26(PROJECT-ADMIN-UX §1.4): 구분 2(선진행)이면 계약 날짜와 상태를 말없이 NULL 로 덮던 호스트 규칙을 지웠다.
  //     받은 값이 그대로 저장돼야 한다. 구분 번호로 날짜나 상태 변수를 비우는 갈래가 다시 생기면 잡는다.
  hostBehaviorById(cs, mw) {
    const up = stripCsComments(extractCsMember(cs, 'public async Task<(bool ok, string msg, bool needConfirm)> UpsertProjectAsync('));
    assert.ok(!/\bsectionId\s*==/.test(up) && !/CodeIds\.Section/.test(up),
      'UpsertProjectAsync 가 구분 번호로 갈래를 탄다(선진행 규칙이 되살아났다. 구분, 상태와 날짜는 서로 묶이지 않는다)');
    assert.ok(!/\b(sd|ed)\s*=\s*""\s*;/.test(up) && !/\bst\s*=\s*null\s*;/.test(up),
      'UpsertProjectAsync 가 받은 계약 날짜나 상태를 비운다(말없이 NULL 로 덮는 규칙은 지웠다)');
    assert.ok(!/SectionPre/.test(stripCsComments(cs)), 'CodeIds.SectionPre 가 남아 있다(구분 번호에 묶인 동작은 없다)');
    assert.ok(/Dictionary<int, XlsxWriter\.Accent> ProjectStatusAccents/.test(mw), '엑셀 상태색 표의 열쇠가 번호가 아니다');
    const rows = extractCsMember(mw, 'private static List<XlsxWriter.Row> ReadProjectExportRows(');
    assert.ok(/r\.TryGetProperty\("statusId", out var sid\)/.test(rows) && /row\.WithHint\(ProjectExportStatusCol, StatusAccentKey\(stId\)\)/.test(rows),
      '엑셀 상태색 힌트가 행의 statusId(번호)에서 오지 않는다');
    assert.ok(!/WithHint\(ProjectExportStatusCol, cells\[/.test(rows), '엑셀 상태색 힌트가 아직 상태 이름(셀 글자)에서 온다');
  },

  // (다)-호스트: 구분 2, 상태 2 도 다른 행과 같다. 숨김, 휴지통의 영구 삭제, 이름 바꾸기, 순서, 복구 어디서도 번호로 막지 않는다.
  //   ★ 2026-10-26(PROJECT-ADMIN-UX §1.4): 그 행에 묶였던 규칙(날짜와 상태 잠금, '진행중만' 필터)을 지워 보호(IsProtected,
  //     SectionPreMsg, StatusEndedMsg)도 지웠다. 쓰는 과제가 있으면 지우지 못하는 FK 판정(참조 수)은 그대로다.
  hostProtects(cs) {
    const code = stripCsComments(cs);
    assert.ok(!/\bIsProtected\b|\bProtectedMsg\b|SectionPreMsg|StatusEndedMsg/.test(code),
      '고정 번호 보호(CodeIds.IsProtected, ProtectedMsg, 보호 문장)가 남아 있다');
    const sa = stripCsComments(extractCsMember(cs, 'public async Task<(bool ok, string msg)> SetCodeActiveAsync('));
    assert.ok(!/CodeIds\./.test(sa) && !/\bid\s*==\s*\d/.test(sa), 'SetCodeActiveAsync 가 번호로 숨김을 막는다');
    const del = stripCsComments(extractCsMember(cs, 'public async Task<(bool ok, string msg)> DeleteTrashAsync('));
    assert.ok(!/CodeIds\./.test(del) && !/\btid\s*==\s*\d/.test(del), 'DeleteTrashAsync 가 번호로 영구 삭제를 막는다');
    const list = stripCsComments(extractCsMember(cs, 'private static async Task<List<Dictionary<string, object?>>> TrashCodeListAsync('));
    assert.ok(/TrashRow\(cid\.Value\.ToString\(CultureInfo\.InvariantCulture\), n, "", c, c == 0, /.test(list) && !/CodeIds\./.test(list),
      '휴지통 목록의 지울 수 있음(deletable)이 참조 수 0 하나로 정해지지 않는다(번호로 막는 갈래가 남았다)');
    for (const sig of ['public async Task<(bool ok, string msg)> RenameCodeAsync(', 'public async Task<(bool ok, string msg)> ReorderCodesAsync(',
                       'public async Task<(bool ok, string msg)> RestoreTrashAsync('])
      assert.ok(!/CodeIds\./.test(stripCsComments(extractCsMember(cs, sig))), `${sig} 가 고정 번호로 막는다`);
  },

  // (라)-호스트: 표시 payload 는 이름과 번호를 함께, 드롭다운은 [{id, name}].
  hostPayloads(cs) {
    const lp = extractCsMember(cs, 'public async Task<string?> LoadProjectsJsonAsync(');
    for (const [nm, id, col] of [['section', 'sectionId', 'section_id'], ['customer', 'customerId', 'customer_id'], ['status', 'statusId', 'status_id']]) {
      assert.ok(new RegExp('\\["' + nm + '"\\]\\s*= Str\\(rd, "' + nm + '"\\)').test(lp), `과제 payload 에 표시용 이름(${nm})이 없다`);
      assert.ok(new RegExp('\\["' + id + '"\\]\\s*= IntOrNull\\(rd, "' + col + '"\\)').test(lp), `과제 payload 에 번호(${id})가 없다`);
    }
    assert.ok(/JOIN section_code s ON s\.section_id = p\.section_id/.test(lp) && /JOIN customer c ON c\.customer_id = p\.customer_id/.test(lp) &&
              /LEFT JOIN status_code st ON st\.status_id = p\.status_id/.test(lp), '과제 이름이 번호 조인으로 만들어지지 않는다');
    for (const sig of ['public async Task<string?> LoadCustomersJsonAsync(', 'public async Task<string?> LoadCustomersFullJsonAsync(',
                       'private async Task<string?> LoadActiveCodesJsonAsync(', 'public async Task<string?> LoadCodesFullJsonAsync(']) {
      const b = extractCsMember(cs, sig);
      assert.ok(/\["id"\] = IntOrNull\(rd, "(customer_id|cid)"\)/.test(b) && /\["name"\] = n/.test(b), `${sig} 가 [{id, name}] 을 싣지 않는다`);
    }
    const mem = extractCsMember(cs, 'public async Task<string?> LoadMembersJsonAsync(');
    const i0 = mem.indexOf('var row = new Dictionary<string, object?>');
    const init = i0 < 0 ? '' : mem.slice(i0, mem.indexOf('};', i0));
    assert.ok(init.length > 0 && /\["title"\]\s*= Str\(rd, "title"\)/.test(init) && !/titleId/.test(init),
      '명부 행의 기본 키에 직급 번호(titleId)가 섞였다 — 비관리자 회신은 글자까지 종전과 같아야 한다(관리자 갈래에만 싣는다)');
    const adm = mem.indexOf('if (isAdmin)');
    assert.ok(adm > 0 && mem.indexOf('row["titleId"]') > adm, '관리자 갈래에 직급 번호(titleId)가 없다 — 편집 폼 드롭다운이 지금 값을 못 고른다');
    assert.ok(/titles\.Add\(new Dictionary<string, object\?> \{ \["id"\] = IntOrNull\(rd, "title_id"\), \["name"\] = n \}\)/.test(mem), '직급 드롭다운 소스가 [{id, name}] 이 아니다');
    const ot = extractCsMember(cs, 'public async Task<string?> LoadOrgTitleJsonAsync(');
    assert.ok(/\["titleId"\] = IntOrNull\(rd, "tid"\)/.test(ot), '직급 관리 목록이 행 열쇠(titleId)를 싣지 않는다');
  },

  // (라)-브리지: 편집, 관리, 휴지통 메시지가 번호를 읽는다. 이름은 추가할 때만 읽는다.
  bridgeById(mw) {
    const want = {
      saveProject: ['sectionId', 'customerId', 'statusId'],
      renameCustomer: ['customerId'], setCustomerActive: ['customerId'], customerRefCount: ['customerId'],
      codeRename: ['id'], codeSetActive: ['id'], codeRefCount: ['id'],
      saveUser: ['userId', 'titleId', 'orgId'],
      titleRename: ['titleId'], titleSetActive: ['titleId'],
    };
    for (const [c, ids] of Object.entries(want)) {
      const b = caseBlock(mw, c);
      for (const k of ids) assert.ok(b.includes('GetInt(doc, "' + k + '")'), `case "${c}" 가 번호 ${k} 를 읽지 않는다`);
      //  saveUser 의 name 은 사람 이름(편집 값)이라 뺀다 — 거기서 볼 것은 직급(title)이다.
      const forbid = c === 'saveUser' ? ['title'] : ['name', 'oldName', 'section', 'customer', 'status', 'title'];
      for (const k of forbid)
        assert.ok(!b.includes('GetStr(doc, "' + k + '")'), `case "${c}" 가 아직 이름(${k})을 읽는다`);
    }
    assert.ok(caseBlock(mw, 'codeReorder').includes('GetIntArray(doc, "ids")'), 'codeReorder 가 번호 배열(ids)을 읽지 않는다');
    assert.ok(caseBlock(mw, 'titleReorder').includes('GetIntArray(doc, "titleIds")'), 'titleReorder 가 번호 배열(titleIds)을 읽지 않는다');
    for (const c of ['addCustomer', 'codeAdd', 'titleAdd']) assert.ok(caseBlock(mw, c).includes('GetStr(doc, "name")'), `${c} 는 새 이름을 읽어야 한다`);
  },

  // (라)-웹: 보내는 메시지의 모양(소스).
  webSendsIds(web) {
    const save = extractFunction(web, 'offEdSaveNow');
    assert.ok(/sectionId: idv\('offEdSection'\)/.test(save) && /customerId: idv\('offEdCustomer'\)/.test(save) && /statusId: idv\('offEdStatus'\)/.test(save),
      '과제 저장이 구분, 발주처, 상태를 번호로 보내지 않는다');
    assert.ok(!/\b(section|customer|status): val\(/.test(save), '과제 저장이 아직 이름을 싣는다');
    assert.ok(/custSend\('renameCustomer', \{ customerId: it\.id, newName \}/.test(extractFunction(web, 'custCommitRename')), '발주처 개명이 번호를 싣지 않는다');
    assert.ok(/hostRequest\('customerRefCount', \{ customerId \}/.test(extractFunction(web, 'custDoHide')), '발주처 참조 수 조회가 번호를 싣지 않는다');
    assert.ok(/codeSend\('codeRename', \{ id: it\.id, newName \}/.test(extractFunction(web, 'codeCommitRename')), '코드 개명이 번호를 싣지 않는다');
    assert.ok(/hostRequest\('codeRefCount', \{ kind: codeKind, id \}/.test(extractFunction(web, 'codeDoHide')), '코드 참조 수 조회가 번호를 싣지 않는다');
    assert.ok(/otSend\('titleRename', \{ titleId: Number\(key\), newName: newName \}\)/.test(extractFunction(web, 'otCommitRename')), '직급 개명이 번호를 싣지 않는다');
    assert.ok(/otSend\('titleSetActive', \{ titleId: Number\(key\), active: false \}/.test(extractFunction(web, 'otDoHide')), '직급 숨김이 번호를 싣지 않는다');
    assert.ok(/cmd: 'titleSetActive', titleId: Number\(key\), active: true/.test(extractFunction(web, 'trOrgRestore')), '휴지통 직급 복구가 번호를 싣지 않는다');
    assert.ok(/titleId: val\('userEdTitle'\) \? Number\(val\('userEdTitle'\)\) : null,/.test(extractFunction(web, 'userEdSaveNow')), '직원 저장이 직급을 번호로(직급 없음은 null) 보내지 않는다');
  },
};

// ══ 시험 — 정적 ═════════════════════════════════════════════════════
test('번호 앱⓪: 고정 번호가 호스트 CodeIds, 웹 CODE_ID, 시드에서 같고 보호 표는 없다', () => checks.fixedIdsAgree(app, pdb, schema));
test('번호 앱①(가): 이름 글자로 동작을 가르는 코드가 웹과 호스트에 없다(비교, switch, 사전 열쇠, 집합 질의)', () => checks.noNameBehavior(app, hostFiles));
test('번호 앱②(나)-호스트: 엑셀 강조는 고정 번호로 판정하고, 구분은 계약 날짜와 상태를 건드리지 않는다(선진행 규칙 삭제)', () => checks.hostBehaviorById(pdb, main));
test('번호 앱③(다)-호스트: 구분 2, 상태 2 도 숨기고 영구 삭제할 수 있다(번호 보호 삭제, FK 참조 판정만 남음)', () => checks.hostProtects(pdb));
test('번호 앱④(라)-호스트: 표시 payload 는 이름과 번호를 함께, 드롭다운은 [{id, name}]', () => checks.hostPayloads(pdb));
test('번호 앱⑤(라)-브리지: 편집, 관리, 휴지통 메시지는 번호를 읽고 이름은 추가할 때만 읽는다', () => checks.bridgeById(main));
test('번호 앱⑥(라)-웹: 과제 저장, 발주처, 코드, 직급, 직원 메시지가 번호를 싣는다', () => checks.webSendsIds(app));

// ── 변이(정적) ───────────────────────────────────────────────────────
test('번호 앱 변이①: 웹에 이름 비교(=== \'종료\')를 되살리면 ①(가) 가 잡는다', () => {
  const bad = mutate(app, 'function offStatusKind(statusId){', "function offStatusKind(statusId){\n  if(String(statusId) === '종료') return 'end';");
  assert.throws(() => checks.noNameBehavior(bad, hostFiles), /이름 글자로 동작을 가르는 코드/);
  assert.doesNotThrow(() => checks.noNameBehavior(app, hostFiles));   // 통제군
});
test('번호 앱 변이②: 옛 이름 열쇠 색 표를 되살리면 ①(가) 와 ⓪ 이 잡는다', () => {
  const bad = mutate(app, "const DB_SECTION_COLORS = { 1: '#3e5be0', 3: '#8a5cf6', 2: '#c2770a' };",
    "const DB_SECTION_COLORS = { '일반계약':'#3e5be0', '사업부관리':'#8a5cf6', '선진행':'#c2770a' };");
  assert.throws(() => checks.noNameBehavior(bad, hostFiles), /이름 글자로 동작을 가르는 코드/);
  assert.throws(() => checks.fixedIdsAgree(bad, pdb, schema), /번호 1, 2, 3 이 아니다/);
});
//  변이③④ 의 앵커: UpsertProjectAsync 에서 구분을 검사한 바로 뒤(지운 선진행 규칙이 있던 자리)
const UPSERT_AFTER_SECTION = '            if (sectionId <= 0) return (false, "구분을 선택하세요.", false);\n';
test('번호 앱 변이③: 호스트 선진행 규칙(구분 2 면 날짜와 상태 비우기)을 되살리면 ② 가 잡는다(번호로든 이름으로든)', () => {
  const byId = mutate(pdb, UPSERT_AFTER_SECTION, UPSERT_AFTER_SECTION + '            if (sectionId == 2) { sd = ""; ed = ""; st = null; }\n');
  assert.throws(() => checks.hostBehaviorById(byId, main), /구분 번호로 갈래를 탄다/);
  const byName = mutate(pdb, UPSERT_AFTER_SECTION, UPSERT_AFTER_SECTION + '            if ("선진행" == pname) { sd = ""; ed = ""; }\n');
  assert.throws(() => checks.noNameBehavior(app, [['ProjectDb.cs', byName]]), /이름 글자로 동작을 가르는 코드/);
  assert.throws(() => checks.hostBehaviorById(byName, main), /계약 날짜나 상태를 비운다/);
  assert.doesNotThrow(() => checks.hostBehaviorById(pdb, main));   // 통제군
});
test('번호 앱 변이④: 엑셀 강조를 상태 이름 열쇠로 되돌리면 ①(가) 가 잡는다', () => {
  const bad = mutate(main, '[CodeIds.StatusEnded]     = new XlsxWriter.Accent(', '["종료"]         = new XlsxWriter.Accent(');
  assert.throws(() => checks.noNameBehavior(app, [['MainWindow.xaml.cs', bad]]), /이름 글자로 동작을 가르는 코드/);
});
test('번호 앱 변이⑤: 숨김 보호(상태 2 거부)를 되살리면 ③ 이 잡는다', () => {
  const at = '            if (id <= 0) return (false, "대상 " + lbl + "이(가) 지정되지 않았습니다.");\n';
  const bad = mutate(pdb, at, at + '            if (!active && kd == "status" && id == 2) return (false, "이 상태는 숨길 수 없습니다.");\n');
  assert.throws(() => checks.hostProtects(bad), /SetCodeActiveAsync 가 번호로 숨김을 막는다/);
  assert.doesNotThrow(() => checks.hostProtects(pdb));   // 통제군
});
test('번호 앱 변이⑥: 영구 삭제 보호(구분 2 거부)를 되살리면 ③ 이 잡는다', () => {
  const at = '                if (kd == "user") targetUserId = tid;\n';
  const bad = mutate(pdb, at, at + '                if (kd == "section" && tid == 2) return (false, "이 구분은 지울 수 없습니다.");\n');
  assert.throws(() => checks.hostProtects(bad), /DeleteTrashAsync 가 번호로 영구 삭제를 막는다/);
});
test('번호 앱 변이⑦: 휴지통 목록이 번호로 지울 수 없음을 알리면 ③ 이 잡는다', () => {
  const bad = mutate(pdb, 'n, "", c, c == 0, c == 0 ? "" : CodeInUseMsg(c)));', 'n, "", c, c == 0 && cid.Value != 2, c == 0 ? "" : CodeInUseMsg(c)));');
  assert.throws(() => checks.hostProtects(bad), /deletable\)이 참조 수 0 하나로 정해지지 않는다/);
});
test('번호 앱 변이⑧: 개명을 다시 이름으로 받으면 ⑤ 가 잡는다', () => {
  const bad = mutate(main, 'RunRenameCodeAsync(GetStr(doc, "reqId"), GetStr(doc, "kind"), GetInt(doc, "id"), GetStr(doc, "newName"))',
    'RunRenameCodeAsync(GetStr(doc, "reqId"), GetStr(doc, "kind"), GetStr(doc, "oldName"), GetStr(doc, "newName"))');
  assert.throws(() => checks.bridgeById(bad), /codeRename" 가 번호 id 를 읽지 않는다/);
});
test('번호 앱 변이⑨: 비관리자 명부에 titleId 를 실으면 ④ 가 잡는다(비관리자 회신은 종전 그대로)', () => {
  //  관리자 갈래의 row["titleId"] 가 뒤에 남아 있어도, 행의 기본 키에 실린 값은 비관리자에게 나간다.
  const bad = mutate(pdb, '                            ["title"]   = Str(rd, "title"),', '                            ["title"]   = Str(rd, "title"),\n                            ["titleId"] = IntOrNull(rd, "title_id"),');
  assert.throws(() => checks.hostPayloads(bad), /비관리자 회신은 글자까지 종전과 같아야 한다/);
  assert.doesNotThrow(() => checks.hostPayloads(pdb));   // 통제군
});

// ══ 시험 — 동작(Node 샌드박스 · jsdom) ═══════════════════════════════
//  카탈로그 판정 — 앱의 함수를 그대로 떼어 와 돌린다(DOM 없음).
function catalogCtx(src = app) {
  const body = [extractCodeIdsBlock(src), constLine(src, 'offTrim'), constLine(src, 'offNorm'), constLine(src, 'OFF_NO_STATUS'),
    extractFunction(src, 'offStatusKind'), extractFunction(src, 'offMatches'), extractFunction(src, 'mapDbRows'),
    'return { offStatusKind, offMatches, mapDbRows, sectionColor, OFF_NO_STATUS };'].join('\n');
  return new Function(body)();
}
//  필터 묶음(catalogFilters): 상태는 끈 체크박스의 열쇠(stOff, 번호 문자열 또는 OFF_NO_STATUS)다(PROJECT-ADMIN-UX §1.2).
const F = (o) => Object.assign({ q: '', qRaw: '', customerId: '', customer: '', sectionId: '', section: '', stOff: new Set(), stOffNames: [] }, o);
const behave = {
  // 상태 거르기는 끈 체크박스의 번호로 한다. 이름을 바꿔도 같고, 어느 상태(종료 포함)도 따로 다루지 않는다. 색 종류도 번호다.
  statusFilterById(src) {
    const X = catalogCtx(src);
    const ended = { name: 'a', statusId: 2, status: '완료(개명)' }, fake = { name: 'b', statusId: 3, status: '종료' }, none = { name: 'c', statusId: null, status: '' };
    //  기본(모두 켬): 종료(2)도 보인다. 옛 '진행중만'처럼 상태 2 를 몰래 빼는 규칙이 없다.
    assert.deepStrictEqual([ended, fake, none].map((c) => X.offMatches(c, F())), [true, true, true], '모두 켰는데 빠지는 상태가 있다(특별 규칙이 남았다)');
    const off2 = F({ stOff: new Set(['2']) });
    assert.strictEqual(X.offMatches(ended, off2), false, '상태 2 를 껐는데 이름을 바꾼 그 과제가 보인다(이름으로 판정한다)');
    assert.strictEqual(X.offMatches(fake, off2), true, "이름만 '종료'인 다른 상태(번호 3)가 빠진다(이름으로 판정한다)");
    assert.strictEqual(X.offMatches(none, off2), true, '상태 없음이 상태 2 와 함께 빠졌다');
    const off3 = F({ stOff: new Set(['3']) });
    assert.deepStrictEqual([ended, fake].map((c) => X.offMatches(c, off3)), [true, false], '상태 3 을 끈 결과가 번호대로가 아니다');
    assert.strictEqual(X.offMatches(none, F({ stOff: new Set([X.OFF_NO_STATUS]) })), false, '상태 없음을 껐는데 상태 없는 과제가 보인다');
    assert.strictEqual(X.offMatches(ended, F({ stOff: new Set([X.OFF_NO_STATUS]) })), true);
    assert.strictEqual(X.offStatusKind(2), 'end'); assert.strictEqual(X.offStatusKind(1), 'run');
    assert.strictEqual(X.offStatusKind(3), 'warn'); assert.strictEqual(X.offStatusKind(null), 'none');
    assert.strictEqual(X.offStatusKind('종료'), 'none', "이름 '종료'를 넣었는데 종료 색이 나온다(이름이 아직 열쇠다)");
    assert.strictEqual(X.offMatches(ended, F({ sectionId: '1' })), false, '구분 필터가 번호로 거르지 않는다');
  },
  // 표시 payload 는 이름과 번호를 함께 받는다. 색은 구분 번호로 정한다.
  displayRowCarriesBoth(src) {
    const X = catalogCtx(src);
    const [c] = X.mapDbRows([{ uid: 'u1', common_name: 'x', section: '계약전(개명)', sectionId: 2, customer: 'A청', customerId: 7, status: '', statusId: null }]);
    assert.deepStrictEqual([c.section, c.sectionId, c.customer, c.customerId, c.status, c.statusId], ['계약전(개명)', 2, 'A청', 7, '', null]);
    assert.strictEqual(c.color, '#c2770a', '구분 2 의 이름을 바꾸자 초기색이 바뀌었다');
  },
};
test('번호 앱⑦(나)-웹: 상태 거르기는 끈 체크박스의 번호로 하고 특별한 상태가 없다, 색 종류도 번호다', () => behave.statusFilterById(app));
test('번호 앱⑧(라)-웹: 과제 표시 행은 이름과 번호를 함께 갖고, 색은 구분 번호로 정한다', () => behave.displayRowCarriesBoth(app));
const ST_LINE = '  if(f.stOff && f.stOff.has(sid == null ? OFF_NO_STATUS : String(sid))) return false;';
test('번호 앱 변이⑩: 옛 진행중만(상태 2 몰래 빼기)이나 이름 비교를 되살리면 ⑦ 이 잡는다', () => {
  const special = mutate(app, ST_LINE, ST_LINE + '\n  if(sid === CODE_ID.STATUS_ENDED) return false;');
  assert.throws(() => behave.statusFilterById(special), /특별 규칙이 남았다/);
  const byName = mutate(app, ST_LINE, '  if(f.stOff && f.stOff.size && offTrim(c.status) === \'종료\') return false;');
  assert.throws(() => behave.statusFilterById(byName), /이름으로 판정한다/);
  assert.doesNotThrow(() => behave.statusFilterById(app));   // 통제군
});

//  화면(DOM) 시험 — jsdom 이 있어야 돈다.
const jsdom = useJsdom(await importOptional('jsdom'));
//  ⑨ 구분은 다른 칸을 건드리지 않는다(PROJECT-ADMIN-UX §1.4). 앱 소스에서 구분 칸 배선과 잠금 흔적을 본다.
function sectionIndependent(src) {
  const code = stripJs(src);
  assert.ok(!/function\s+offEdApplySectionRule\s*\(/.test(code), '편집 폼의 선진행 규칙 함수(offEdApplySectionRule)가 남아 있다');
  assert.ok(!/\$\('#offEdSection'\)[^\n]*addEventListener/.test(code), '구분 칸(#offEdSection)에 바뀜 처리기가 있다(구분을 바꾸면 다른 칸이 움직인다)');
  assert.ok(!/SECTION_PRE/.test(code), '선진행 번호(SECTION_PRE)가 남아 있다');
  assert.ok(!/#officialEditModal input:disabled/.test(code), '편집 폼의 잠긴 칸 모양(input:disabled)이 남아 있다(잠그는 칸이 없다)');
  const open = extractFunction(src, 'offEditOpen');
  assert.ok(/set\('offEdStart', c \? offDate\(c\.startDate\) : ''\)/.test(open) && /offEdFillEnums\(c \? c\.sectionId : '', c \? c\.statusId : ''/.test(open),
    '편집 폼이 계약 날짜와 상태를 받은 값 그대로 채우지 않는다');
}
const CODE_FIXTURE = '<!doctype html><html><body><div id="codeList"></div><div id="codeMsg"></div></body></html>';
function codeListJs(src) {
  return [extractCodeIdsBlock(src), escDecl(src), extractFunction(src, 'renderCodeList'), constLine(src, 'codeItem'),
    'var codeKind = "section", codeList = [];',
    'var __guard = 0, __req = [], __msg = "";',
    'var ICON = { alert: "!" };',
    'function offEditGuard(fn){ __guard++; }',
    'function hostRequest(c, p){ __req.push([c, p]); return Promise.resolve({ ok: true, count: 0 }); }',
    'function codeMsgSet(h){ __msg = String(h || ""); }',
    'function codeKindLabel(){ return codeKind === "status" ? "상태" : "구분"; }',
    extractFunction(src, 'codeDoHide'),
    'window.__probe = function(kind){',
    '  codeKind = kind;',
    '  codeList = [{ id: 1, name: "가", active: true, sort: 10 }, { id: 2, name: "이름바꾼고정", active: true, sort: 20 }, { id: 5, name: "다", active: true, sort: 30 }];',
    '  renderCodeList();',
    '  var rows = Array.prototype.map.call(document.querySelectorAll("#codeList .cust-row"), function(r){',
    '    var h = r.querySelector("[data-codehide]"), e = r.querySelector("[data-codeedit]");',
    '    var up = r.querySelector("[data-codeup]"), dn = r.querySelector("[data-codedown]");',
    '    return { id: r.dataset.id, name: r.dataset.name, hideAria: h.getAttribute("aria-disabled"), hideDisabled: !!h.disabled,',
    '             hideTitle: h.title || "", described: h.hasAttribute("aria-describedby"), editDisabled: !!e.disabled, up: !!up && !up.disabled, down: !!dn && !dn.disabled };',
    '  });',
    '  __guard = 0; __req = []; __msg = "";',
    '  codeDoHide("2"); var two = { guard: __guard, msg: __msg };',
    '  codeDoHide("5"); var five = { guard: __guard };',
    '  return { rows: rows, two: two, five: five };',
    '};'].join('\n');
}
const dom = {
  // 구분 2, 상태 2 도 다른 행과 같다: [숨김]이 켜져 있고 이유가 붙지 않으며, 누르면 다른 행처럼 참조 수 조회로 간다.
  codeHideOpen(src) {
    for (const kind of ['section', 'status']) {
      const r = runInJsdom(CODE_FIXTURE, codeListJs(src), '__probe', kind);
      for (const x of r.rows) {
        assert.deepStrictEqual([x.hideAria, x.hideDisabled, x.hideTitle, x.described], [null, false, '', false],
          `${kind} ${x.id} 의 [숨김]이 꺼져 있거나 막는 이유가 붙었다: ${JSON.stringify(x)}`);
        assert.strictEqual(x.editDisabled, false, `${kind} ${x.id} 의 [이름변경]이 꺼졌다`);
      }
      assert.strictEqual(r.two.guard, 1, `${kind} 2 의 [숨김]이 막혔다(관문을 지나지 않는다): ${r.two.msg}`);
      assert.strictEqual(r.five.guard, 2, `${kind} 5 의 [숨김]이 막혔다`);
    }
  },
};
if (!jsdom) {
  skip('번호 앱⑩(다)-DOM: 구분 2, 상태 2 의 [숨김]도 다른 행과 같다', SKIP_NO_JSDOM);
  skip('번호 앱 변이⑫: [숨김] 보호를 되살리면 ⑩ 이 잡는다', SKIP_NO_JSDOM);
} else {
  test('번호 앱⑩(다)-DOM: 구분 2, 상태 2 의 [숨김]도 다른 행과 같다(꺼짐, 이유, 막힘 없음)', () => dom.codeHideOpen(app));
  test('번호 앱 변이⑫: [숨김] 보호를 되살리면 ⑩ 이 잡는다', () => {
    const bad = mutate(app, '  const id = codeIdOf(key); if(id == null) return;\n  offEditGuard(async () => {',
      "  const id = codeIdOf(key); if(id == null) return;\n  if(id === 2){ codeMsgSet('막힘'); return; }\n  offEditGuard(async () => {");
    assert.throws(() => dom.codeHideOpen(bad), /2 의 \[숨김\]이 막혔다/);
    const bad2 = mutate(app, '    const hide = `<button type="button" class="btn sm danger" data-codehide="${id}">숨김</button>`;',
      '    const hide = `<button type="button" class="btn sm danger" data-codehide="${id}"${c.id === 2 ? \' aria-disabled="true"\' : \'\'}>숨김</button>`;');
    assert.throws(() => dom.codeHideOpen(bad2), /꺼져 있거나/);
    assert.doesNotThrow(() => dom.codeHideOpen(app));   // 통제군
  });
}
test('번호 앱⑨(나)-웹: 구분은 계약 날짜와 상태를 건드리지 않는다(선진행 잠금 없음, 받은 값 그대로)', () => sectionIndependent(app));
test('번호 앱 변이⑪: 편집 폼에 선진행 잠금을 되살리면 ⑨ 가 잡는다', () => {
  const anchor = "  ['#offEdStart', '#offEdEnd'].forEach(sel =>";
  const bad = mutate(app, anchor, "  { const s = $('#offEdSection'); if(s) s.addEventListener('change', () => { if(codeIdOf(s.value) === 2){ $('#offEdStart').disabled = true; } }); }\n" + anchor);
  assert.throws(() => sectionIndependent(bad), /바뀜 처리기/);
  assert.doesNotThrow(() => sectionIndependent(app));   // 통제군
});
