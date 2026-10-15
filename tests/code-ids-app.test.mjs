// 코드표 번호 키 B단계(앱: 호스트 C# 과 웹) 계약 — docs/CODE-TABLE-IDS.md §3·§4·§10 (2026-10-15).
//
// 이 파일이 지키는 것 넷:
//   (가) 이름 글자로 동작을 가르는 코드가 웹과 호스트 어디에도 없다. 동작은 고정 번호(호스트 CodeIds, 웹 CODE_ID)로 판정한다.
//   (나) 구분 2(선진행)의 이름을 바꿔도 날짜 잠금이 남고, 상태 2(종료)의 이름을 바꿔도 '진행중만' 필터와 엑셀 강조가 남는다.
//   (다) 동작이 묶인 두 행(구분 2, 상태 2)은 숨김과 삭제가 막힌다(호스트가 거부하고 웹은 버튼을 끄고 이유를 단다).
//        이름 바꾸기와 순서 바꾸기는 된다.
//   (라) 편집, 관리, 휴지통 메시지는 번호를 싣고, 표시 payload 는 이름과 번호를 함께 싣는다.
//   DB 쪽(스키마, 이관 SQL, setup)은 code-ids-db.test.mjs 가 본다.
//
//   ★ 검사는 전부 checks 의 함수다 — 변이가 같은 함수를 다시 불러 '잡았다'를 증명한다(장식 검사 방지).
import { test, skip, assert, loadAppSource, extractFunction, extractCodeIdsBlock, stripCsComments, extractCsMember,
         importOptional, useJsdom, runInJsdom, SKIP_NO_JSDOM } from './harness.mjs';
import { readFileSync, readdirSync } from 'node:fs';

const app = loadAppSource();
const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
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
  return new Function(extractCodeIdsBlock(src) + '\nreturn { CODE_ID, CODE_PROTECT_WHY, codeProtectedWhy, codeIdOf, DB_SECTION_COLORS, sectionColor };')();
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

  // ⓪ 고정 번호가 세 곳(호스트 CodeIds, 웹 CODE_ID, 시드)에서 같다. 거부 문장도 호스트와 웹이 같다.
  fixedIdsAgree(web, cs, sql) {
    const w = webCodeIds(web);
    const host = { SECTION_PRE: csInt(cs, 'SectionPre'), STATUS_ACTIVE: csInt(cs, 'StatusActive'), STATUS_ENDED: csInt(cs, 'StatusEnded') };
    assert.deepStrictEqual({ ...w.CODE_ID }, host, '웹 CODE_ID 와 호스트 CodeIds 가 다르다');
    const seed = (t, id, name) => new RegExp(`INSERT INTO ${t} \\(${t === 'section_code' ? 'section_id' : 'status_id'}, name, sort_order\\) VALUES[^;]*\\(${id}, '${name}',`).test(sql);
    assert.ok(seed('section_code', host.SECTION_PRE, '선진행'), `시드에서 선진행의 번호가 ${host.SECTION_PRE} 가 아니다`);
    assert.ok(seed('status_code', host.STATUS_ENDED, '종료'), `시드에서 종료의 번호가 ${host.STATUS_ENDED} 가 아니다`);
    assert.ok(seed('status_code', host.STATUS_ACTIVE, '진행중'), `시드에서 진행중의 번호가 ${host.STATUS_ACTIVE} 가 아니다`);
    assert.ok(seed('status_code', csInt(cs, 'StatusDelivered'), '1차 납품완료'), '시드에서 1차 납품완료의 번호가 CodeIds.StatusDelivered 가 아니다');
    assert.strictEqual(w.codeProtectedWhy('section', host.SECTION_PRE), csStr(cs, 'SectionPreMsg'), '구분 보호 문장이 웹과 호스트에서 다르다');
    assert.strictEqual(w.codeProtectedWhy('status', host.STATUS_ENDED), csStr(cs, 'StatusEndedMsg'), '상태 보호 문장이 웹과 호스트에서 다르다');
    for (const s of [csStr(cs, 'SectionPreMsg'), csStr(cs, 'StatusEndedMsg')])
      assert.ok(!/[—–「」]| · /.test(s), `보호 문장에 금지 기호(엠 대시, 낫표, 띄운 가운데 점)가 있다: ${s}`);
    //  구분 색 표는 번호가 열쇠다(§3-4). 시드 셋 모두 색이 있고, 표에 없는 번호는 기본색.
    assert.deepStrictEqual(Object.keys(w.DB_SECTION_COLORS).sort(), ['1', '2', '3'], '구분 색 표의 열쇠가 번호 1, 2, 3 이 아니다');
    assert.strictEqual(w.sectionColor(99), '#5b6b7d', '표에 없는 번호가 기본색으로 떨어지지 않는다');
    assert.strictEqual(w.sectionColor('선진행'), '#5b6b7d', '이름을 넣었는데 색이 나온다(이름이 아직 열쇠다)');
  },

  // (나)-호스트: 선진행 규칙과 엑셀 강조가 번호로 판정된다.
  hostBehaviorById(cs, mw) {
    const up = extractCsMember(cs, 'public async Task<(bool ok, string msg, bool needConfirm)> UpsertProjectAsync(');
    assert.ok(/if \(sectionId == CodeIds\.SectionPre\) \{ sd = ""; ed = ""; st = null; \}/.test(up),
      'UpsertProjectAsync 의 선진행 규칙이 고정 번호(CodeIds.SectionPre) 판정이 아니다');
    assert.ok(/Dictionary<int, XlsxWriter\.Accent> ProjectStatusAccents/.test(mw), '엑셀 상태색 표의 열쇠가 번호가 아니다');
    const rows = extractCsMember(mw, 'private static List<XlsxWriter.Row> ReadProjectExportRows(');
    assert.ok(/r\.TryGetProperty\("statusId", out var sid\)/.test(rows) && /row\.WithHint\(ProjectExportStatusCol, StatusAccentKey\(stId\)\)/.test(rows),
      '엑셀 상태색 힌트가 행의 statusId(번호)에서 오지 않는다');
    assert.ok(!/WithHint\(ProjectExportStatusCol, cells\[/.test(rows), '엑셀 상태색 힌트가 아직 상태 이름(셀 글자)에서 온다');
  },

  // (다)-호스트: 숨김과 삭제를 막고, 이름 바꾸기와 순서 바꾸기와 복구는 막지 않는다.
  hostProtects(cs) {
    const code = stripCsComments(cs);
    assert.ok(/public static bool IsProtected\(string kind, int id\) =>\s*\(kind == "section" && id == SectionPre\) \|\| \(kind == "status" && id == StatusEnded\);/.test(code),
      'CodeIds.IsProtected 가 구분 2(SectionPre)와 상태 2(StatusEnded) 둘이 아니다');
    const sa = extractCsMember(cs, 'public async Task<(bool ok, string msg)> SetCodeActiveAsync(');
    const gSa = sa.indexOf('if (!active && CodeIds.IsProtected(kd, id))'), oSa = sa.indexOf('OpenWriteAsync');
    assert.ok(gSa >= 0 && oSa > gSa && /return \(false, CodeIds\.ProtectedMsg\(kd\)\);/.test(sa),
      'SetCodeActiveAsync 가 고정 번호 행의 숨김을 연결 전에 거부하지 않는다');
    const del = extractCsMember(cs, 'public async Task<(bool ok, string msg)> DeleteTrashAsync(');
    const gDel = del.indexOf('if (CodeIds.IsProtected(kd, tid))'), oDel = del.indexOf('OpenAdminAsync');
    assert.ok(gDel >= 0 && oDel > gDel && /return \(false, CodeIds\.ProtectedMsg\(kd\)\);/.test(del),
      'DeleteTrashAsync 가 고정 번호 행의 영구 삭제를 연결 전에 거부하지 않는다');
    const list = extractCsMember(cs, 'private static async Task<List<Dictionary<string, object?>>> TrashCodeListAsync(');
    assert.ok(/bool locked = CodeIds\.IsProtected\(kind, cid\.Value\);/.test(list) && /c == 0 && !locked/.test(list),
      '휴지통 목록이 고정 번호 행을 지울 수 있다고 알린다(deletable)');
    for (const sig of ['public async Task<(bool ok, string msg)> RenameCodeAsync(', 'public async Task<(bool ok, string msg)> ReorderCodesAsync(',
                       'public async Task<(bool ok, string msg)> RestoreTrashAsync('])
      assert.ok(!/IsProtected/.test(extractCsMember(cs, sig)), `${sig} 가 고정 번호 행을 막는다 — 이름 바꾸기, 순서, 복구는 허용이다(§3)`);
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
test('번호 앱⓪: 고정 번호가 호스트 CodeIds, 웹 CODE_ID, 시드에서 같고 보호 문장도 한 글자까지 같다', () => checks.fixedIdsAgree(app, pdb, schema));
test('번호 앱①(가): 이름 글자로 동작을 가르는 코드가 웹과 호스트에 없다(비교, switch, 사전 열쇠, 집합 질의)', () => checks.noNameBehavior(app, hostFiles));
test('번호 앱②(나)-호스트: 선진행 규칙과 엑셀 강조는 고정 번호로 판정한다', () => checks.hostBehaviorById(pdb, main));
test('번호 앱③(다)-호스트: 구분 2, 상태 2 의 숨김과 영구 삭제를 연결 전에 거부한다(이름 바꾸기, 순서, 복구는 허용)', () => checks.hostProtects(pdb));
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
test('번호 앱 변이③: 호스트 선진행 규칙을 이름 비교로 되돌리면 ①(가) 와 ② 가 잡는다', () => {
  const bad = mutate(pdb, 'if (sectionId == CodeIds.SectionPre) { sd = ""; ed = ""; st = null; }', 'if (sectionId == 2 || "선진행" == "") { sd = ""; ed = ""; st = null; }');
  assert.throws(() => checks.noNameBehavior(app, [['ProjectDb.cs', bad]]), /이름 글자로 동작을 가르는 코드/);
  assert.throws(() => checks.hostBehaviorById(bad, main), /고정 번호\(CodeIds\.SectionPre\) 판정이 아니다/);
});
test('번호 앱 변이④: 엑셀 강조를 상태 이름 열쇠로 되돌리면 ①(가) 가 잡는다', () => {
  const bad = mutate(main, '[CodeIds.StatusEnded]     = new XlsxWriter.Accent(', '["종료"]         = new XlsxWriter.Accent(');
  assert.throws(() => checks.noNameBehavior(app, [['MainWindow.xaml.cs', bad]]), /이름 글자로 동작을 가르는 코드/);
});
test('번호 앱 변이⑤: 숨김 보호를 빼면 ③ 이 잡는다', () => {
  const bad = mutate(pdb, 'if (!active && CodeIds.IsProtected(kd, id))', 'if (false)');
  assert.throws(() => checks.hostProtects(bad), /숨김을 연결 전에 거부하지 않는다/);
  assert.doesNotThrow(() => checks.hostProtects(pdb));   // 통제군
});
test('번호 앱 변이⑥: 영구 삭제 보호를 빼면 ③ 이 잡는다', () => {
  const bad = mutate(pdb, 'if (CodeIds.IsProtected(kd, tid))', 'if (false)');
  assert.throws(() => checks.hostProtects(bad), /영구 삭제를 연결 전에 거부하지 않는다/);
});
test('번호 앱 변이⑦: 보호 목록에서 상태 2 를 빼면 ③ 이 잡는다', () => {
  const bad = mutate(pdb, '(kind == "section" && id == SectionPre) || (kind == "status" && id == StatusEnded);', '(kind == "section" && id == SectionPre);');
  assert.throws(() => checks.hostProtects(bad), /구분 2\(SectionPre\)와 상태 2\(StatusEnded\) 둘이 아니다/);
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
const F = (o) => Object.assign({ q: '', qRaw: '', customerId: '', customer: '', sectionId: '', section: '', statusId: '', status: '', activeOnly: false }, o);
const behave = {
  // 상태 2 의 이름을 바꿔도 '진행중만'이 그 과제를 빼고, 이름만 '종료'인 다른 번호는 남긴다. 색 종류도 번호다.
  activeOnlyById(src) {
    const X = catalogCtx(src);
    const ended = { name: 'a', statusId: 2, status: '완료(개명)' }, fake = { name: 'b', statusId: 3, status: '종료' }, none = { name: 'c', statusId: null, status: '' };
    const on = F({ activeOnly: true });
    assert.strictEqual(X.offMatches(ended, on), false, '상태 2 의 이름을 바꾸자 진행중만 필터가 그 과제를 다시 보인다(이름으로 판정한다)');
    assert.strictEqual(X.offMatches(fake, on), true, "이름만 '종료'인 다른 상태(번호 3)가 필터에서 빠진다(이름으로 판정한다)");
    assert.strictEqual(X.offMatches(none, on), true, '상태 없음이 진행중만 필터에서 빠졌다');
    assert.strictEqual(X.offStatusKind(2), 'end'); assert.strictEqual(X.offStatusKind(1), 'run');
    assert.strictEqual(X.offStatusKind(3), 'warn'); assert.strictEqual(X.offStatusKind(null), 'none');
    assert.strictEqual(X.offStatusKind('종료'), 'none', "이름 '종료'를 넣었는데 종료 색이 나온다(이름이 아직 열쇠다)");
    //  필터 셀렉트 값도 번호다 — 고른 번호만 남긴다.
    assert.strictEqual(X.offMatches(ended, F({ statusId: '2', status: '완료(개명)' })), true);
    assert.strictEqual(X.offMatches(fake, F({ statusId: '2', status: '완료(개명)' })), false);
    assert.strictEqual(X.offMatches(none, F({ statusId: X.OFF_NO_STATUS, status: X.OFF_NO_STATUS })), true);
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
test('번호 앱⑦(나)-웹: 상태 2 의 이름을 바꿔도 진행중만 필터와 색 종류가 그대로다(번호로 판정)', () => behave.activeOnlyById(app));
test('번호 앱⑧(라)-웹: 과제 표시 행은 이름과 번호를 함께 갖고, 색은 구분 번호로 정한다', () => behave.displayRowCarriesBoth(app));
test('번호 앱 변이⑩: 진행중만 필터를 상태 이름 비교로 되돌리면 ⑦ 이 잡는다', () => {
  const bad = mutate(app, '  if(f.activeOnly && sid === CODE_ID.STATUS_ENDED) return false;', "  if(f.activeOnly && offTrim(c.status) === '종료') return false;");
  assert.throws(() => behave.activeOnlyById(bad), /이름을 바꾸자 진행중만 필터/);
  assert.doesNotThrow(() => behave.activeOnlyById(app));   // 통제군
});

//  화면(DOM) 시험 — jsdom 이 있어야 돈다.
const jsdom = useJsdom(await importOptional('jsdom'));
const SEC_FIXTURE = '<!doctype html><html><body>' +
  '<select id="offEdSection"><option value="1">일반계약</option><option value="2">계약전(개명)</option></select>' +
  '<input id="offEdStart" value="2026-01-01"><input id="offEdEnd" value="2026-12-31"><input id="offEdDevEnd" value="2026-09-30">' +
  '<select id="offEdStatus"><option value="">상태 없음</option><option value="1" selected>진행중</option></select>' +
  '<div id="offEdHint"></div></body></html>';
function secRuleJs(src) {
  return [extractCodeIdsBlock(src), escDecl(src), constLine(src, 'offTrim'), extractFunction(src, 'offEdApplySectionRule'),
    'function snap(){ var g = function(id){ var e = document.getElementById(id); return { v: e.value, d: !!e.disabled }; };',
    '  return { start: g("offEdStart"), end: g("offEdEnd"), status: g("offEdStatus"), dev: g("offEdDevEnd"), hint: document.getElementById("offEdHint").textContent }; }',
    'window.__probe = function(){',
    '  var s = document.getElementById("offEdSection");',
    '  s.value = "2"; offEdApplySectionRule(); var pre = snap();',
    '  s.value = "1"; offEdApplySectionRule(); var gen = snap();',
    '  return { pre: pre, gen: gen };',
    '};'].join('\n');
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
    '    var dId = h.getAttribute("aria-describedby"); var d = dId ? document.getElementById(dId) : null;',
    '    return { id: r.dataset.id, name: r.dataset.name, hideAria: h.getAttribute("aria-disabled"), hideDisabled: !!h.disabled,',
    '             hideTitle: h.title || "", desc: d ? d.textContent : "", editDisabled: !!e.disabled, up: !!up && !up.disabled, down: !!dn && !dn.disabled };',
    '  });',
    '  __guard = 0; __req = []; __msg = "";',
    '  codeDoHide("2"); var locked = { guard: __guard, req: __req.length, msg: __msg };',
    '  codeDoHide("5"); var open = { guard: __guard, req: __req.length };',
    '  return { rows: rows, locked: locked, open: open };',
    '};'].join('\n');
}
const dom = {
  // 구분 2 의 이름을 바꿔도 날짜와 상태를 비우고 잠근다. 개발종료일은 잠그지 않는다. 다른 구분이면 다시 연다.
  sectionLockById(src) {
    const r = runInJsdom(SEC_FIXTURE, secRuleJs(src), '__probe');
    assert.deepStrictEqual([r.pre.start, r.pre.end, r.pre.status], [{ v: '', d: true }, { v: '', d: true }, { v: '', d: true }],
      `구분 2 의 이름을 바꾸자 계약기간과 상태가 잠기지 않는다(이름으로 판정한다): ${JSON.stringify(r.pre)}`);
    assert.deepStrictEqual(r.pre.dev, { v: '2026-09-30', d: false }, '개발종료일까지 잠갔다(선진행이어도 개발은 돈다)');
    assert.ok(r.pre.hint.includes('계약전(개명)'), `안내가 지금 이름을 쓰지 않는다: ${r.pre.hint}`);
    assert.deepStrictEqual([r.gen.start.d, r.gen.end.d, r.gen.status.d], [false, false, false], '다른 구분으로 바꿔도 잠금이 풀리지 않는다');
  },
  // 동작이 묶인 행은 [숨김]이 꺼지고 이유가 title 과 aria-describedby 로 붙는다. 이름 바꾸기와 순서는 켜져 있다.
  codeHideLocked(src) {
    const why = webCodeIds(src).CODE_PROTECT_WHY;
    for (const kind of ['section', 'status']) {
      const r = runInJsdom(CODE_FIXTURE, codeListJs(src), '__probe', kind);
      const byId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
      const lockId = kind === 'section' ? '2' : '2', w = why[kind][2];
      assert.strictEqual(byId[lockId].hideAria, 'true', `${kind} ${lockId} 의 [숨김]이 켜져 있다 — 눌러 봐야 호스트가 거부한다`);
      assert.strictEqual(byId[lockId].hideDisabled, false, '꺼진 [숨김]을 disabled 로 껐다 — 포커스가 닿지 않아 키보드로는 이유를 못 듣는다');
      assert.strictEqual(byId[lockId].hideTitle, w, `[숨김]의 이유(title)가 다르다: ${byId[lockId].hideTitle}`);
      assert.strictEqual(byId[lockId].desc, w, '[숨김]의 aria-describedby 문장이 title 과 다르다');
      assert.strictEqual(byId[lockId].editDisabled, false, '고정 번호 행의 [이름변경]까지 껐다(이름은 바꿀 수 있다)');
      assert.ok(byId[lockId].up && byId[lockId].down, '고정 번호 행의 ▲▼ 를 껐다(순서는 바꿀 수 있다)');
      for (const id of ['1', '5']) assert.strictEqual(byId[id].hideAria, null, `${kind} ${id} 는 보호 대상이 아닌데 [숨김]이 꺼졌다`);
      assert.deepStrictEqual([r.locked.guard, r.locked.req], [0, 0], '고정 번호 행의 [숨김]이 왕복(참조 수 조회)을 시작한다');
      assert.ok(r.locked.msg.includes(w), '고정 번호 행의 [숨김]을 눌렀는데 이유를 다시 보이지 않는다');
      assert.strictEqual(r.open.guard, 1, '보호 대상이 아닌 행의 [숨김]이 막혔다');
    }
  },
};
if (!jsdom) {
  skip('번호 앱⑨(나)-DOM: 구분 2 의 이름을 바꿔도 편집 폼이 날짜와 상태를 비우고 잠근다', SKIP_NO_JSDOM);
  skip('번호 앱⑩(다)-DOM: 구분 2, 상태 2 의 [숨김]은 꺼지고 이유가 붙는다', SKIP_NO_JSDOM);
  skip('번호 앱 변이⑪: 편집 폼의 선진행 판정을 이름으로 되돌리면 ⑨ 가 잡는다', SKIP_NO_JSDOM);
  skip('번호 앱 변이⑫: [숨김] 보호를 빼면 ⑩ 이 잡는다', SKIP_NO_JSDOM);
} else {
  test('번호 앱⑨(나)-DOM: 구분 2 의 이름을 바꿔도 편집 폼이 날짜와 상태를 비우고 잠근다(개발종료일은 그대로)', () => dom.sectionLockById(app));
  test('번호 앱⑩(다)-DOM: 구분 2, 상태 2 의 [숨김]은 꺼지고 이유가 붙는다(이름 바꾸기, ▲▼ 는 켜짐)', () => dom.codeHideLocked(app));
  test('번호 앱 변이⑪: 편집 폼의 선진행 판정을 이름으로 되돌리면 ⑨ 가 잡는다', () => {
    const bad = mutate(app, '  const pre = !!sec && codeIdOf(sec.value) === CODE_ID.SECTION_PRE;', "  const pre = !!sec && offTrim(sec.options[sec.selectedIndex].textContent) === '선진행';");
    assert.throws(() => dom.sectionLockById(bad), /잠기지 않는다/);
    assert.doesNotThrow(() => dom.sectionLockById(app));   // 통제군
  });
  test('번호 앱 변이⑫: [숨김] 보호를 빼면 ⑩ 이 잡는다', () => {
    const bad = mutate(app, '    const why = codeProtectedWhy(codeKind, c.id);', "    const why = '';");
    assert.throws(() => dom.codeHideLocked(bad), /\[숨김\]이 켜져 있다/);
  });
}
