using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace TaskCalendarWidget
{
    // 과제별 저장소 경로(gitRepo·svnRepo)의 **로컬** 보관소 — %APPDATA%\TaskCalendar\repo-paths.json
    //
    // ★ 왜 DB 가 아니라 여기인가 (설계 §4 — 이 프로젝트에서 DB 로 올리지 않는 **유일한** 항목)
    //   저장소 경로는 **PC 마다 달라야 하는 값**이고 브라우저에는 개념 자체가 없다.
    //   DB 에 올리면 A자리의 `D:\repos\report` 가 B자리까지 따라와 커밋 수집이 조용히 실패한다.
    //   더 나쁜 경우는 **경로는 유효한데 다른 저장소**인 자리다 — 그러면 실패조차 안 하고
    //   **남의 커밋이 내 보고서에 실린다.**
    //   앱도 이미 그렇게 본다(`updateOfficialLocalFields` 주석: "desc·gitRepo·svnRepo·color는 로컬 소유").
    //
    // ★ 왜 별도 파일인가 — 같은 폴더의 선례들과 소유자·수명이 다르다(§4)
    //   · `widget.settings.json` 에 **넣지 않는다**: 그쪽은 창 위치·자동시작 같은 **호스트(WPF) 소유의
    //     평평한 DTO** 다. 저장소 경로는 **웹 계층이 과제 목록과 함께 늘었다 줄었다 하는 키 맵**이라
    //     수명도 소유자도 다르다. `reminders.json` 이 이미 그 형태의 선례이고, 이 파일은 그 문체를 따른다.
    //   · `data.xml` 에 **남기지 않는다**: DB 전환 후 data.xml 은 data.xml.premigration 으로 보존만 되고
    //     앱이 더는 쓰지 않는다. 거기 남기면 로컬 유지가 아니라 **동결**이다.
    //
    // ★ 고아 키(지워진 과제의 키)는 **자동으로 지우지 않는다**(§4: "고아 키는 무해하다").
    //   조회는 OrphanKeys(), 삭제는 RemoveOrphans() — **호출자가 명시적으로** 부를 때만 지운다.
    //   이유는 RemoveOrphans() 의 주석에 있다(살아 있는 과제 목록이 비어 있을 때가 위험하다).
    //
    // ★ 이 클래스가 하지 않는 것
    //   · 경로가 실재하는 폴더인지 검사하지 않는다 — 오프라인·이동식 드라이브에서 오탐이 나고,
    //     '경로가 없다'와 '지금 그 드라이브가 안 붙어 있다'는 다른 사실이다. 판정은 커밋 수집이 한다.
    //   · 값을 경로로 **다루지 않는다**(Path.GetFullPath·Combine 등을 쓰지 않는다). 그냥 문자열이다.
    //     그래서 MAX_PATH 를 넘는 값이나 UNC·한글 경로도 그대로 왕복한다.
    //
    // 파일 형식 (버전 1)
    //   {
    //     "version": 1,
    //     "paths": {
    //       "c-3f2a…": { "git": "D:\\repos\\report", "svn": "" },
    //       "db-1041": { "git": "",                  "svn": "C:\\wc\\proj" }
    //     }
    //   }
    //   · 키 = **과제 uid**(앱의 category.id — `c-<uuid>` 또는 `db-<project.uid>`). cat_no 가 아니다(계약 G-6 ★).
    //     번호는 재사용되므로 키가 되면 나중에 '다른 과제'의 경로를 가리킨다.
    //   · 맵을 최상위에 두지 않고 "paths" 아래 넣는 이유: ① `reminders.json` 이 이미
    //     {version, acks} 형태다 ② 최상위가 맵이면 version 키와 과제 uid 가 같은 이름공간에서 부딪친다.
    internal sealed class RepoPaths
    {
        public const string FileName = "repo-paths.json";
        private const int FormatVersion = 1;
        private const string PathsKey = "paths";

        // 손상 파일 보존용 확장자. `reminders.json` 이 쓰는 관례와 같다(RemLoad 의 File.Copy(… + ".bak")).
        private const string BackupSuffix = ".bak";

        // 한글·UNC 경로를 \uXXXX 로 escape 하지 않는다. 이 파일은 **사용자가 열어 볼 수 있어야 하는
        // 설정 파일**이고(§4 의 안내가 "[과제 관리]에서 경로를 지정하세요" 로 사용자를 이 값으로 보낸다),
        // 값이 곧 사람이 고른 폴더 경로다. escape 하면 지원 요청 때 아무도 읽지 못한다.
        // ★ HTML/JS 문맥으로 새지 않는다 — 이 문자열은 JsonDocument 로 되읽을 뿐이고,
        //   웹으로 가는 state JSON 은 CalendarDb 가 **자기 직렬화기**(기본 escape)로 따로 만든다.
        private static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions
        {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        };

        private readonly string _dataDir;
        private readonly Action<string> _log;

        // uid → (git, svn). Ordinal — uid 는 기계가 만든 불투명 문자열이라 문화권 비교가 끼면 안 된다
        // (CalendarDb 의 catNoByUid·tokens 와 같은 비교자).
        private readonly Dictionary<string, (string git, string svn)> _map =
            new Dictionary<string, (string git, string svn)>(StringComparer.Ordinal);

        // 마지막 Load 가 파일을 **읽거나 해석하지 못했다.** 빈 맵으로 서 있다는 뜻이다.
        //   ★ 이 값이 true 인 채로 Save() 하면 사용자가 예전에 넣어 둔 경로가 사라진다.
        //     그래서 Save() 는 그 사실을 로그에 남기고, 원본은 이미 <파일>.bak 에 보존돼 있다.
        public bool Corrupt { get; private set; }

        /// <summary>파일이 있는데 **읽지 못했다**(배타 잠금·권한·디스크). 손상과 다르다 —
        /// 내용은 멀쩡할 가능성이 높다. 이 상태에서 <see cref="Save"/> 는 **덮어쓰기를 거부**한다.
        /// 그러지 않으면 잠깐의 잠금 때문에 이 PC 의 저장소 경로가 통째로 사라진다
        /// (§4: 경로는 DB 에 없어 복구 수단이 없다).</summary>
        public bool Unreadable { get; private set; }

        // 해석은 됐지만 모양이 틀려 **건너뛴 항목** 수(값이 객체가 아니거나 키가 빈 문자열).
        //   0 이 아니면 손편집이 있었다는 신호다. 나머지 항목은 살아 있다.
        public int SkippedEntries { get; private set; }

        // 항목 안에서 정식 키(git·svn) 대신 별칭(gitRepo·svnRepo)을 읽었다. 다음 Save 가 정식 키로 정규화한다.
        public bool AliasSeen { get; private set; }

        public static string FileOf(string dataDir) => Path.Combine(dataDir ?? "", FileName);
        public string FilePath => FileOf(_dataDir);
        public string BackupPath => FilePath + BackupSuffix;

        // ★ dataDir 을 주입받는다 — 시험이 임시 폴더에서 돌 수 있어야 하고, 실제 %APPDATA% 를
        //   건드리지 않아야 한다. 앱에서는 MainWindow 의 _dataDir(= %APPDATA%\TaskCalendar)을 준다.
        //   생성자는 **디스크를 만지지 않는다**(빈 맵). 읽으려면 RepoPaths.Load(...) 를 쓴다.
        public RepoPaths(string dataDir, Action<string>? log = null)
        {
            _dataDir = dataDir ?? "";
            _log = log ?? (_ => { });
        }

        // 파일을 읽어 맵을 채운다. **어떤 경우에도 예외를 던지지 않는다** — 이 파일 하나 때문에
        //   위젯이 안 뜨면 사용자는 고칠 방법이 없다(설정 화면 자체가 안 열린다).
        public static RepoPaths Load(string dataDir, Action<string>? log = null)
        {
            var rp = new RepoPaths(dataDir, log);
            rp.Reload();
            return rp;
        }

        // ── 읽기 ────────────────────────────────────────────────────────────────
        //
        // ★ 손상 파일을 어떻게 다루나 — 세 후보 중 하나를 고른 것이고, 근거를 남긴다.
        //   ① 예외를 던져 부팅을 멈춘다 → **채택 안 함.** 사용자는 JSON 을 못 고치고, 앱이 안 뜨면
        //      고칠 화면조차 없다. 손상 원인은 대개 디스크 오류·강제 종료라 사용자 잘못도 아니다.
        //   ② 조용히 빈 맵 → **채택 안 함.** 사용자 설정이 소리 없이 사라지고, 다음 Save 가
        //      원본을 덮어써 **복구 불가**가 된다.
        //   ③ **빈 맵 + 원본을 <파일>.bak 로 보존 + 로그 + Corrupt 플래그** → 채택.
        //      · 앱은 뜬다. 화면에는 "이 PC 에는 경로가 설정되지 않았습니다" 안내가 나온다(§4 ★) —
        //        이건 **사실이고**, 사용자가 그 자리에서 다시 지정하면 그대로 복구된다.
        //      · 원본이 .bak 에 남아 있어 지원 인력이 손으로 되살릴 수 있다.
        //      · 잃는 것은 '경로를 다시 골라야 하는 수고' 뿐이다. ①은 앱을, ②는 데이터를 잃는다.
        //   ★ 그리고 **부분 손상은 전부를 버리지 않는다** — 항목 하나가 객체가 아니면 그 항목만
        //     건너뛰고(SkippedEntries) 나머지는 살린다. 한 줄 손편집 때문에 89대의 경로가 날아가면 안 된다.
        public void Reload()
        {
            _map.Clear();
            Corrupt = false;
            Unreadable = false;
            SkippedEntries = 0;
            AliasSeen = false;

            string path = FilePath;
            string raw;
            try
            {
                if (!File.Exists(path))
                {
                    // 파일 없음은 **오류가 아니다** — 이 PC 에서 아직 아무 과제에도 경로를 지정하지 않았다.
                    _log("저장소 경로 맵 없음(빈 맵으로 시작): " + path);
                    return;
                }
                raw = File.ReadAllText(path, Encoding.UTF8);
            }
            catch (Exception ex)
            {
                // ★ 2026-08-27 정정 — 읽기 실패를 '손상'으로 취급하면 안 된다.
                //   옛 코드는 여기서 Corrupt=true 를 세우고 TryBackup 을 불렀는데, **읽지 못하는 원인
                //   (배타 잠금·권한)이 백업도 똑같이 막는다.** 그래서 .bak 이 안 만들어지고,
                //   그 뒤 Save() 가 빈 맵으로 파일을 덮어써 **이 PC 의 경로가 전부 사라졌다.**
                //   게다가 그때 찍히는 로그는 "원본은 .bak 에 있다" 였다 — 없는데 있다고 말한다.
                //   (실측 재현: 정상 파일을 FileShare.None 으로 잠근 뒤 Load → Save 하니 2건 소멸)
                //   파일이 **멀쩡할 가능성이 높은** 상태이므로 '의심스러울 때 지우지 않는다'
                //   (RemoveOrphans 가 이미 채택한 원칙)를 여기에도 적용한다.
                Unreadable = true;
                _log("저장소 경로 맵을 읽지 못했다(빈 맵으로 시작 · 저장은 거부한다): " + ex.Message + " / " + path);
                return;
            }

            if (raw.Trim().Length == 0)
            {
                // 0바이트/공백 파일. 원자적 저장을 쓰므로 정상 경로에서는 나오지 않는다.
                // 보존할 내용이 없으므로 .bak 도 만들지 않고, Corrupt 로도 세지 않는다 —
                // 결과가 '파일 없음'과 완전히 같기 때문이다(잃을 값이 0이다).
                _log("저장소 경로 맵이 빈 파일(빈 맵으로 시작): " + path);
                return;
            }

            if (!TryParse(raw, _map, out int skipped, out bool alias, out string err))
            {
                Corrupt = true;
                _map.Clear();   // 부분 결과를 남기지 않는다 — '몇 개는 맞다'가 제일 진단하기 어렵다
                _log("저장소 경로 맵 손상(빈 맵으로 시작, 원본은 " + Path.GetFileName(BackupPath) + " 로 보존): " + err);
                TryBackup(path);
                return;
            }

            // ★ 2026-08-27 — 부분 손상도 원본을 보존한다.
            //   옛 코드는 완전 손상만 .bak 을 남겼다. 그런데 부분 손상에서 살아남는 것은 *정상* 항목뿐이고
            //   **모양이 틀린 항목의 경로 문자열은 다음 Save 에서 경고 없이 영구 소멸**한다.
            //   완전 손상은 보존하면서 부분 손상은 안 하는 것은 근거의 비대칭이다 — 잃는 값의 성격이 같다.
            //   이 분기는 파일을 성공적으로 읽은 뒤라 TryBackup 이 실제로 성공한다(읽기 실패와 다르다).
            if (skipped > 0) TryBackup(path);

            SkippedEntries = skipped;
            AliasSeen = alias;
            _log("저장소 경로 맵 로드: " + _map.Count + "건" +
                 (skipped > 0 ? " (모양이 틀려 건너뜀 " + skipped + "건)" : "") +
                 (alias ? " (gitRepo/svnRepo 별칭 키를 읽었다 — 다음 저장에서 git/svn 으로 정규화된다)" : ""));
        }

        // raw JSON → into. 성공하면 true. **파일을 만지지 않는다** — 그래서 Save 의 되읽기 검증도 이걸 쓴다
        // (Reload 를 부르면 우리가 방금 쓴 파일을 .bak 로 덮어써 사용자의 예전 백업을 잃는다).
        private static bool TryParse(string raw, Dictionary<string, (string git, string svn)> into,
                                     out int skipped, out bool aliasSeen, out string err)
        {
            skipped = 0; aliasSeen = false; err = "";
            try
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object)
                {
                    err = "최상위가 객체가 아니다(" + root.ValueKind + ")";
                    return false;
                }
                if (!root.TryGetProperty(PathsKey, out var paths) || paths.ValueKind != JsonValueKind.Object)
                {
                    err = "최상위에 \"" + PathsKey + "\" 객체가 없다";
                    return false;
                }
                foreach (var p in paths.EnumerateObject())
                {
                    if (p.Name.Length == 0 || p.Value.ValueKind != JsonValueKind.Object) { skipped++; continue; }
                    string git = Field(p.Value, "git", "gitRepo", ref aliasSeen);
                    string svn = Field(p.Value, "svn", "svnRepo", ref aliasSeen);
                    into[p.Name] = (git, svn);   // 같은 키가 두 번 나오면 뒤가 이긴다(JSON 관례)
                }
                return true;
            }
            catch (Exception ex) { err = ex.Message; return false; }
        }

        // 정식 키(git·svn)를 먼저 본다. 없을 때만 별칭(gitRepo·svnRepo)을 본다.
        //   ★ 왜 별칭을 받아 주나: 이 코드베이스는 다른 곳에서 전부 gitRepo/svnRepo 로 쓴다
        //     (XML 속성 · JS state · 어댑터 게이트). 손으로 고치는 사람은 십중팔구 그렇게 쓴다.
        //     별칭을 모른 척하면 경로가 **오류 없이 사라진다** — 이 설계가 계속 경계하는 실패 모양이다.
        //   ★ 둘 다 있으면 정식 키가 이긴다(결정적). 다음 Save 가 정식 키로 정규화한다.
        //   문자열이 아닌 값(숫자·null·객체)은 "" 로 본다 — 경로가 아닌 것은 경로가 없는 것과 같다.
        private static string Field(JsonElement o, string key, string alias, ref bool aliasSeen)
        {
            if (o.TryGetProperty(key, out var v))
                return v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";
            if (o.TryGetProperty(alias, out var a) && a.ValueKind == JsonValueKind.String)
            {
                aliasSeen = true;
                return a.GetString() ?? "";
            }
            return "";
        }

        private void TryBackup(string path)
        {
            try
            {
                if (File.Exists(path)) File.Copy(path, BackupPath, true);
            }
            catch (Exception ex) { _log("저장소 경로 맵 백업 실패(원본은 그대로 둔다): " + ex.Message); }
        }

        // ── 조회 ────────────────────────────────────────────────────────────────

        // CalendarDb.LoadSnapshotAsync 의 repoPaths 인자에 그대로 넘기는 형(계약 G-6).
        //   ★ 복사본이 아니라 **살아 있는 뷰**다 — Set/Remove 가 그대로 비친다.
        //     부팅 조회에 넘기는 동안 고치지 않는다(조회는 한 스레드에서 끝난다).
        public IReadOnlyDictionary<string, (string git, string svn)> Map => _map;

        public int Count => _map.Count;

        // 없으면 ("","") — 앱의 category.gitRepo·svnRepo 기본값과 같다.
        public (string git, string svn) Get(string? uid) =>
            uid != null && _map.TryGetValue(uid, out var v) ? v : ("", "");

        // 이 PC 가 그 과제에 대해 **항목을 갖고 있는가**(값이 비어 있어도 true).
        public bool Has(string? uid) => uid != null && _map.ContainsKey(uid);

        // 이 PC 에 그 과제의 **쓸 수 있는 경로가 있는가**(git·svn 중 하나라도 비어 있지 않다).
        //   ★ §4 의 안내는 이 값과 **DB 의 '저장소를 쓰는 과제' 비트**를 함께 봐야 성립한다:
        //     DB 비트=true 인데 이 값이 false 면 → "이 PC 에는 이 과제의 저장소 경로가 설정되지
        //     않았습니다 — [과제 관리]에서 경로를 지정하세요".
        //     이 값 하나만 보면 '경로가 없다'와 '저장소를 안 쓰는 과제다'를 구분할 수 없어
        //     안내가 **모든 과제에 뜨거나 아무 데도 안 뜬다**(§4).
        public bool HasAnyPath(string? uid)
        {
            var (git, svn) = Get(uid);
            return git.Length > 0 || svn.Length > 0;
        }

        // ── 변경 (메모리만 — 확정은 Save()) ─────────────────────────────────────
        //   ★ Set 이 자동 저장하지 않는 이유: 과제 관리 화면은 여러 과제를 한 번에 고치고,
        //     그때마다 파일을 쓰면 중간 상태가 디스크에 남는다. 호출자가 끝에 한 번 Save() 한다.
        //   값은 Trim() 한다 — 앱도 그렇게 한다(폼의 `catFormRepo.trim()`). 안 하면 눈에 안 보이는
        //     뒤 공백 때문에 같은 경로가 다른 경로가 되고, 원인은 화면에 보이지 않는다.
        //   반환: 실제로 값이 바뀌었으면 true.
        public bool Set(string? uid, string? git, string? svn)
        {
            string key = (uid ?? "").Trim();
            if (key.Length == 0) { _log("저장소 경로 설정 무시(과제 id 가 비었다)"); return false; }
            var next = ((git ?? "").Trim(), (svn ?? "").Trim());
            if (_map.TryGetValue(key, out var cur) && cur.git == next.Item1 && cur.svn == next.Item2) return false;
            _map[key] = next;
            return true;
        }

        // 항목 삭제(= 이 PC 에서 그 과제의 경로를 지운다). 없으면 false.
        public bool Remove(string? uid) => uid != null && _map.Remove(uid);

        // ── 고아 키 ─────────────────────────────────────────────────────────────
        //   §4: "과제가 지워지면 그 키도 지운다. **고아 키는 무해**하다(참조하는 과제가 없으면 안 읽힌다)".
        //   그래서 조회는 언제든, 삭제는 **호출자가 명시적으로** 부를 때만 한다.

        // 살아 있는 과제 목록에 없는 키(정렬됨). 부작용 없음.
        public IReadOnlyList<string> OrphanKeys(IEnumerable<string>? liveUids)
        {
            var live = new HashSet<string>(liveUids ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
            return _map.Keys.Where(k => !live.Contains(k))
                            .OrderBy(k => k, StringComparer.Ordinal)
                            .ToList();
        }

        // ★ 자동으로 부르지 마라. 부팅 경로·타이머에서 부르면 안 된다.
        //   ★★ 살아 있는 과제 목록이 **비어 있으면 아무것도 지우지 않는다**(0 반환).
        //      과제 0개는 정상 상태가 아니라 대개 '아직 못 읽었다'(오프라인·조회 실패)이고,
        //      그 상태에서 지우면 **이 PC 의 저장소 경로 전부가 날아간다** — 게다가 그 손실은
        //      DB 로 복구되지 않는다(§4: 경로는 DB 에 없다). §4 가 고아 키를 무해하다고 한 이상,
        //      의심스러울 때 지우지 않는 쪽이 언제나 낫다.
        //   반환: 지운 개수. 파일에 반영하려면 Save() 를 따로 부른다.
        public int RemoveOrphans(IEnumerable<string>? liveUids)
        {
            var live = new HashSet<string>(liveUids ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
            if (live.Count == 0)
            {
                _log("고아 키 정리 생략 — 살아 있는 과제 목록이 비었다(조회 실패일 수 있다). 고아 키는 무해하다(§4)");
                return 0;
            }
            int n = 0;
            foreach (var k in _map.Keys.Where(k => !live.Contains(k)).ToList()) { _map.Remove(k); n++; }
            if (n > 0) _log("고아 저장소 경로 " + n + "건 제거(저장은 Save() 에서)");
            return n;
        }

        // ── 저장 ────────────────────────────────────────────────────────────────
        //
        // 원자적 저장 — <파일>.tmp 에 다 쓴 뒤 File.Move(overwrite:true) 로 갈아끼운다.
        //   `reminders.json` 의 RemSave 와 같은 관례다. 중간에 프로세스가 죽으면 .tmp 만 남고
        //   **원본은 손대지 않은 채 그대로 남는다**(Move 는 rename 이라 반쯤 쓰인 파일이 생기지 않는다).
        //
        // 되읽기 검증 — 쓰고 나서 실제로 그 값이 읽히는지 확인한 뒤에만 성공으로 본다.
        //   `UserSession.Save` 가 같은 이유로 그렇게 한다("저장 성공"을 찍고도 파일이 그대로였던
        //   사례가 있었다. 거짓 성공 보고 금지).
        //
        // 반환: (ok, msg) — msg 는 사용자에게 보여도 되는 한 줄.
        public (bool ok, string msg) Save()
        {
            string path = FilePath, tmp = path + ".tmp";
            try
            {
                // ★ 읽지 못한 상태에서는 덮어쓰지 않는다. 파일이 멀쩡한데 잠깐 잠겼을 뿐일 수 있고,
                //   그때 덮어쓰면 이 PC 의 경로가 통째로 사라진다(복구 수단 없음 — §4).
                //   호출자는 이 실패를 사용자에게 보여 주고, 잠금이 풀린 뒤 다시 시도하게 한다.
                if (Unreadable)
                {
                    _log("저장 거부 — 저장소 경로 맵을 읽지 못한 상태다(덮어쓰면 기존 경로가 사라진다): " + path);
                    return (false, "저장소 경로 파일을 읽지 못해 저장하지 않았습니다. 다른 프로그램이 열고 있는지 확인한 뒤 다시 시도하세요.");
                }

                if (Corrupt)
                    _log("★ 손상된 저장소 경로 맵을 덮어쓴다 — 원본은 " + Path.GetFileName(BackupPath) + " 에 있다: " + path);

                Directory.CreateDirectory(_dataDir);

                // 키 정렬(Ordinal) — 같은 내용이면 파일도 같아진다. 지원 요청 때 두 PC 의 파일을
                // 그대로 비교할 수 있고, 저장할 때마다 줄 순서가 바뀌는 일이 없다.
                var ordered = new SortedDictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
                foreach (var kv in _map)
                    ordered[kv.Key] = new Dictionary<string, string> { ["git"] = kv.Value.git, ["svn"] = kv.Value.svn };

                var payload = new Dictionary<string, object>
                {
                    ["version"] = FormatVersion,
                    [PathsKey] = ordered,
                };
                File.WriteAllText(tmp, JsonSerializer.Serialize(payload, JsonOpts), new UTF8Encoding(false));
                File.Move(tmp, path, true);

                // 되읽기 — 파일에서 다시 읽어 값이 하나도 어긋나지 않는지 본다.
                //   ★ Reload() 를 쓰지 않는다: 실패했을 때 방금 쓴 파일을 .bak 로 덮어써
                //     사용자의 예전 백업을 잃는다. 파싱만 하는 TryParse 를 직접 쓴다.
                var back = new Dictionary<string, (string git, string svn)>(StringComparer.Ordinal);
                string raw = File.ReadAllText(path, Encoding.UTF8);
                if (!TryParse(raw, back, out _, out _, out string err))
                {
                    _log("저장소 경로 맵 되읽기 실패(저장 실패로 본다): " + err + " / " + path);
                    return (false, "저장소 경로를 저장하지 못했습니다.");
                }
                if (back.Count != _map.Count)
                {
                    _log("저장소 경로 맵 되읽기 불일치(건수 " + _map.Count + "→" + back.Count + "): " + path);
                    return (false, "저장소 경로를 저장하지 못했습니다.");
                }
                foreach (var kv in _map)
                {
                    if (!back.TryGetValue(kv.Key, out var v) || v.git != kv.Value.git || v.svn != kv.Value.svn)
                    {
                        _log("저장소 경로 맵 되읽기 불일치(과제 " + kv.Key + "): " + path);
                        return (false, "저장소 경로를 저장하지 못했습니다.");
                    }
                }

                Corrupt = false;   // 정상 파일로 갈아끼웠다
                AliasSeen = false; // 정식 키로 정규화됐다
                SkippedEntries = 0;
                _log("저장소 경로 맵 저장: " + _map.Count + "건 · " + path);
                return (true, "");
            }
            catch (Exception ex)
            {
                // 반쯤 쓰인 .tmp 를 남기지 않는다. 지우지 못해도 원본은 이미 안전하다(Move 전이므로).
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
                _log("저장소 경로 맵 저장 실패: " + ex.Message + " / " + path);
                return (false, "저장소 경로를 저장하지 못했습니다.");
            }
        }
    }
}
