// 바뀐 행만 쓰는 저장: 호스트 계약 (docs/SAVE-DIFF.md)
//
// 이 파일이 지키는 것(소스 모양). 실제 동작은 tests/loop-calendar-write.mjs 의 [바뀐 행만] 절이 실제 MySQL 로 본다.
//   ① 낡은 스냅샷 검사: rev 를 올리고 읽은 바로 뒤, 다른 쓰기보다 앞에서 스냅샷의 rev + 1 과 견준다. 전량 교체는 보지 않는다.
//   ② 건너뛰기: 과제, 일정, 할 일, 근태가 모두 스냅샷의 행 투영과 같을 때만 쓰기를 건너뛴다.
//      일정은 예외일, 할 일은 날짜별 메모까지 견준다. 과제 참조는 번호가 아니라 uid 로 견준다.
//   ③ 스냅샷 쪽 투영은 저장과 같은 파라미터 함수를 쓰고, 못 읽으면 빈 맵이다(전부 쓴다).
//   ★ 검사는 함수로 묶고 변이 시험이 같은 함수에 망가뜨린 소스를 넣어 실패를 확인한다.
import { test, assert, stripCsComments as stripCs, extractCsMember as csMember, readText } from './harness.mjs';

const WDB = readText(new URL('../widget/CalendarWriteDb.cs', import.meta.url));
const SAVE = 'public async Task<CalendarSaveResult> SaveAsync(';

function mutate(base, from, to) {
  assert.ok(base.includes(from), '변이 준비 실패: 바꿀 글자가 소스에 없다: ' + from.slice(0, 60));
  return base.replace(from, to);
}

const checks = {
  revGuard(wdb) {
    const b = stripCs(csMember(wdb, SAVE));
    const read = b.indexOf('SELECT rev FROM cal_user_rev');
    const guard = b.indexOf('if (!replaceAll && newRev != prev.Rev + 1)');
    const wipe = b.indexOf('DELETE FROM cal_entry ');
    const firstNo = b.indexOf('SELECT IFNULL(MAX(cat_no),0)');
    assert.ok(read >= 0 && guard > read, 'rev 를 읽은 뒤에 스냅샷의 rev + 1 과 견주지 않는다(낡은 스냅샷이 건너뛴 행을 지나간다)');
    assert.ok(guard < wipe && guard < firstNo, '낡은 스냅샷 검사가 다른 쓰기(전량 삭제, 번호 발급)보다 뒤에 있다');
    assert.ok(/if \(!replaceAll && newRev != prev\.Rev \+ 1\)\s*throw new ConflictException\(/.test(b),
      '낡은 스냅샷이 충돌(ConflictException)로 끝나지 않는다');
  },

  skips(wdb) {
    const b = stripCs(csMember(wdb, SAVE));
    for (const [what, re] of [
      ['과제', /catNo\.TryGetValue\(uid, out no\) && SameAsPrev\(prevSig, "category:" \+ uid, RowSig\(p, null, null\)\)/],
      ['일정', /entNo\.TryGetValue\(uid, out no\) &&\s*SameAsPrev\(prevSig, "entry:" \+ uid, RowSig\(p, cno != null \? cuid : null, ExceptDates\(e\)\)\)/],
      ['할 일', /todNo\.TryGetValue\(uid, out no\) &&\s*SameAsPrev\(prevSig, "todo:" \+ uid, RowSig\(p, cno != null \? cuid : null, DayNotes\(t\)\)\)/],
      ['근태', /tokens\.ContainsKey\(key\) && SameAsPrev\(prevSig, key, RowSig\(p, null, null\)\)/],
    ]) assert.ok(re.test(b), `${what}: 스냅샷과 같은지 보지 않고 건너뛰거나, 자식과 과제 참조를 견주지 않는다`);
    //  건너뛴 행은 순서 번호를 세고 넘어간다. 안 세면 뒤 행의 sort_order 가 하나씩 당겨진다.
    assert.strictEqual((b.match(/same\+\+; i\+\+;\s*continue;/g) || []).length, 3, '과제, 일정, 할 일의 건너뛰기가 순서 번호를 세지 않는다');
    assert.ok(/var prevSig = replaceAll \? new Dictionary<string, string>\(StringComparer\.Ordinal\) : PrevSigs\(prev\);/.test(b),
      '전량 교체가 스냅샷과 견준다(지운 뒤라 전부 새 행이어야 한다)');
    const same = csMember(wdb, 'private static bool SameAsPrev(Dictionary<string, string> prevSig, string key, string sig)');
    assert.ok(/prevSig\.TryGetValue\(key, out var ps\) && string\.Equals\(ps, sig, StringComparison\.Ordinal\)/.test(same),
      '스냅샷에 없는 행을 같다고 본다');
  },

  prevSide(wdb) {
    const p = stripCs(csMember(wdb, 'private static Dictionary<string, string> PrevSigs(CalendarSnapshot prev)'));
    for (const call of ['RowSig(CategoryParams(c, i), null, null)', 'RowSig(EntryParams(e, i, null), CatRef(e), ExceptDates(e))',
                        'RowSig(TodoParams(t, i, null), CatRef(t), DayNotes(t))'])
      assert.ok(p.includes(call), '스냅샷 쪽 투영이 저장과 다른 값을 본다: ' + call);
    assert.ok(/catch \{ map\.Clear\(\); \}/.test(p), '스냅샷을 못 읽었을 때 빈 맵(전부 쓰기)으로 가지 않는다');
    assert.ok(/prev\.CategoryNoByUid\.ContainsKey\(cu\) \? cu : null/.test(p), '스냅샷 쪽 과제 참조가 번호 맵에 있는 과제만 세지 않는다');
    const sig = stripCs(csMember(wdb, 'private static string RowSig(List<(string, object?)> ps, string? catUid, IEnumerable<string>? children)'));
    assert.ok(/if \(k == "@c"\) continue;/.test(sig) && /sb\.Append\("@c="\);/.test(sig), '과제 참조를 번호로 견준다(스냅샷마다 번호가 다를 수 있다)');
    assert.ok(/if \(v == null\) sb\.Append\('\\u0000'\);/.test(sig), 'NULL 과 빈 글자를 가르지 않는다');
  },
};

test('차분①: 낡은 스냅샷은 rev 로 걸러 충돌로 끝낸다(다른 쓰기보다 앞, 전량 교체 제외)', () => checks.revGuard(WDB));
test('차분②: 과제, 일정, 할 일, 근태는 스냅샷의 행 투영과 같을 때만 건너뛴다', () => checks.skips(WDB));
test('차분③: 스냅샷 쪽 투영은 저장과 같은 함수를 쓰고 못 읽으면 전부 쓴다', () => checks.prevSide(WDB));

test('변이D1: rev 검사를 빼면 잡는다', () => {
  const bad = mutate(WDB, 'if (!replaceAll && newRev != prev.Rev + 1)', 'if (false)');
  assert.throws(() => checks.revGuard(bad), /견주지 않는다/);
  assert.doesNotThrow(() => checks.revGuard(WDB));
});
test('변이D2: 일정이 예외일을 견주지 않으면 잡는다', () => {
  const bad = mutate(WDB, 'RowSig(p, cno != null ? cuid : null, ExceptDates(e))', 'RowSig(p, cno != null ? cuid : null, null)');
  assert.throws(() => checks.skips(bad), /일정/);
  assert.doesNotThrow(() => checks.skips(WDB));
});
test('변이D3: 스냅샷을 못 읽었을 때 맵을 비우지 않으면 잡는다', () => {
  const bad = mutate(WDB, 'catch { map.Clear(); }', 'catch { }');
  assert.throws(() => checks.prevSide(bad), /빈 맵/);
  assert.doesNotThrow(() => checks.prevSide(WDB));
});
