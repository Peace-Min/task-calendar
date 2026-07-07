// netcus 보고 채우기 북마클릿 — 소스.
// 구조: 순수 core(tcFillCore, 테스트 대상) + 브라우저 UI 셸(즉시실행함수).
// 의존성 0. core는 doc.getElementsByName만 사용(FakeDoc 호환).
// 제출·submit 호출은 절대 하지 않는다 — 사용자가 검토 후 페이지 버튼으로 직접 제출.
//
// 빌드 압축 친화 규칙: 문자열 리터럴 안에 // 나 /* */ 를 넣지 않는다(라인주석 제거기가 오작동하지 않도록).

// ── core(순수) ──────────────────────────────────────────────────────
// doc: DOM 유사 객체(getElementsByName만 사용) / payload: 표준 페이로드 / loc: location 유사({search})
// 반환: { ok, kind?, filled?, warnings?, error? }  (에러 문구 한국어)
function tcFillCore(doc, payload, loc) {
  // payload 검증
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: '올바른 데이터가 아닙니다(객체가 아님).' };
  }
  if (payload.__tc !== 'netcus-report' || payload.v !== 1) {
    return { ok: false, error: '올바른 데이터가 아닙니다(캘린더 보고 데이터가 아님).' };
  }
  if (payload.kind !== 'daily' && payload.kind !== 'weekly') {
    return { ok: false, error: '올바른 데이터가 아닙니다(kind는 daily 또는 weekly).' };
  }

  // 첫 요소를 얻는 헬퍼(getElementsByName만 사용).
  var first = function (name) {
    var list = doc.getElementsByName(name);
    return list && list.length ? list[0] : null;
  };

  // 페이지 종류 감지
  var hasStatus = !!first('status');
  var hasOvertime = !!first('overtime');
  var hasContent = !!first('content');
  var hasSubject = !!first('subject');
  var hasEndwork = !!first('endwork');
  var hasSdate = !!first('sdate');

  var pageKind = null;
  if (hasStatus && hasOvertime && hasContent && !hasSubject) {
    pageKind = 'daily';
  } else if (hasSubject && hasEndwork && hasSdate) {
    pageKind = 'weekly';
  }
  if (!pageKind) {
    return { ok: false, error: '보고 작성 페이지가 아닙니다. 일간보고 또는 주간보고 작성 페이지에서 실행하세요.' };
  }

  // 페이로드 kind와 페이지 kind 대조
  if (payload.kind !== pageKind) {
    var kko = function (k) { return k === 'daily' ? '일간' : '주간'; };
    return { ok: false, error: '페이로드는 ' + kko(payload.kind) + '용인데 현재 페이지는 ' + kko(pageKind) + '보고 페이지입니다.' };
  }

  var f = payload.fields || {};
  var filled = [];
  var warnings = [];

  if (pageKind === 'daily') {
    // status(select value) · overtime(select selectedIndex) · content(textarea value)
    var elStatus = first('status');
    var elOvertime = first('overtime');
    var elContent = first('content');
    elStatus.value = String(f.status);
    filled.push('status');
    elOvertime.selectedIndex = Number(f.overtime) || 0;
    filled.push('overtime');
    elContent.value = String(f.content || '');
    filled.push('content');

    // 날짜 대조: loc.search에서 y/m/d 파싱 → payload.date와 비교(다르면 warning, 채움은 진행)
    var d = payload.date;
    var q = tcParseQuery(loc && loc.search ? loc.search : '');
    if (d && q.y != null && q.m != null && q.d != null) {
      var samePage = String(q.y) + '-' + String(q.m) + '-' + String(q.d);
      var target = String(d.y) + '-' + String(d.m) + '-' + String(d.d);
      if (samePage !== target) {
        warnings.push('대상 날짜는 ' + target + '인데 현재 페이지는 ' + samePage + ' — 날짜를 확인하세요.');
      }
    }
  } else {
    // weekly: sdate/edate/subject/content/endwork 각 .value = (없는 요소는 건너뛰고 warning)
    var wmap = [
      ['sdate', f.sdate],
      ['edate', f.edate],
      ['subject', f.subject],
      ['content', f.content],
      ['endwork', f.endwork]
    ];
    for (var i = 0; i < wmap.length; i++) {
      var name = wmap[i][0];
      var val = wmap[i][1];
      var el = first(name);
      if (!el) {
        warnings.push(name + ' 필드를 페이지에서 찾지 못해 건너뜀.');
        continue;
      }
      el.value = String(val == null ? '' : val);
      filled.push(name);
    }
  }

  return { ok: true, kind: pageKind, filled: filled, warnings: warnings };
}

// 쿼리스트링에서 y/m/d 숫자 파싱(문자열 → { y, m, d }). 값 없으면 해당 키 null.
function tcParseQuery(search) {
  var out = { y: null, m: null, d: null };
  var s = String(search || '');
  if (s.charAt(0) === '?') s = s.slice(1);
  var parts = s.split('&');
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    var kv = parts[i].split('=');
    var k = decodeURIComponent(kv[0] || '');
    var v = decodeURIComponent(kv[1] || '');
    if (k === 'y' || k === 'm' || k === 'd') {
      var n = parseInt(v, 10);
      if (!isNaN(n)) out[k] = n;
    }
  }
  return out;
}

// ── UI 셸(브라우저 전용) ────────────────────────────────────────────
// core를 호출하는 오버레이. 스타일은 inline. 클립보드 자동읽기는 시도하되 실패 시 조용히 폴백.
(function () {
  var OVID = 'tc-netcus-fill-overlay';
  var exist = document.getElementById(OVID);
  if (exist) {
    // 이미 있으면 재사용(포커스만).
    var taOld = exist.querySelector('textarea');
    if (taOld) taOld.focus();
    return;
  }

  var ov = document.createElement('div');
  ov.id = OVID;
  ov.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;width:340px;background:#ffffff;color:#1a1a1a;border:1px solid #d0d0d0;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.25);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:13px;line-height:1.5;padding:14px;';

  var title = document.createElement('div');
  title.textContent = 'netcus 보고 채우기';
  title.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:8px;';
  ov.appendChild(title);

  var ta = document.createElement('textarea');
  ta.placeholder = '캘린더에서 복사한 내용을 붙여넣으세요(Ctrl+V)';
  ta.style.cssText = 'width:100%;box-sizing:border-box;min-height:80px;border:1px solid #ccc;border-radius:6px;padding:8px;font-size:12px;font-family:inherit;resize:vertical;';
  ov.appendChild(ta);

  var msg = document.createElement('div');
  msg.style.cssText = 'margin-top:8px;font-size:12px;min-height:16px;white-space:pre-wrap;';
  ov.appendChild(msg);

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'margin-top:10px;display:flex;gap:8px;justify-content:flex-end;';

  var fillBtn = document.createElement('button');
  fillBtn.type = 'button';
  fillBtn.textContent = '채우기';
  fillBtn.style.cssText = 'background:#2e9e6b;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;';

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '닫기';
  closeBtn.style.cssText = 'background:#f2f2f2;color:#333;border:1px solid #ccc;border-radius:6px;padding:7px 14px;font-size:13px;cursor:pointer;';

  btnRow.appendChild(fillBtn);
  btnRow.appendChild(closeBtn);
  ov.appendChild(btnRow);

  document.body.appendChild(ov);

  var setMsg = function (text, color) {
    msg.textContent = text;
    msg.style.color = color || '#555';
  };

  var closeOverlay = function () {
    var node = document.getElementById(OVID);
    if (node && node.parentNode) node.parentNode.removeChild(node);
  };
  closeBtn.addEventListener('click', closeOverlay);

  fillBtn.addEventListener('click', function () {
    var raw = ta.value;
    var payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      setMsg('올바른 데이터가 아닙니다(JSON 파싱 실패). 캘린더에서 복사한 내용을 그대로 붙여넣으세요.', '#c0392b');
      return;
    }
    var res = tcFillCore(document, payload, location);
    if (!res.ok) {
      setMsg(res.error || '채우기에 실패했습니다.', '#c0392b');
      return;
    }
    // 채운 필드에 시각 표시
    for (var i = 0; i < res.filled.length; i++) {
      var list = document.getElementsByName(res.filled[i]);
      if (list && list.length && list[0].style) {
        list[0].style.outline = '2px solid #2e9e6b';
      }
    }
    var text = '✓ ' + res.filled.length + '개 필드 채움 — 검토 후 페이지의 제출 버튼으로 제출하세요.';
    if (res.warnings && res.warnings.length) {
      for (var w = 0; w < res.warnings.length; w++) {
        text += '\n⚠ ' + res.warnings[w];
      }
    }
    setMsg(text, '#2e9e6b');
    // 성공 시 3초 뒤 자동 닫기(선택).
    setTimeout(closeOverlay, 3000);
  });

  // 클립보드 자동 읽기 시도(성공 시 textarea 자동 채움, 실패 시 조용히 폴백).
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) {
        if (t && !ta.value) ta.value = t;
      }, function () {});
    }
  } catch (e) {}

  ta.focus();
})();
