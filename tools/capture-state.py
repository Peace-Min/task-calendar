#!/usr/bin/env python3
# 임의 상태 캡처 — 프로토타입 HTML에 JS 주입 후 헤드리스 Edge로 실제 렌더 PNG 저장.
# 사용: python capture-state.py <out.png> <W> <H> <inject_js_file>
import subprocess, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
proto = os.path.join(ROOT, 'task-calendar-prototype.html')
out = sys.argv[1]
W = sys.argv[2] if len(sys.argv) > 2 else '900'
H = sys.argv[3] if len(sys.argv) > 3 else '640'
inject_file = sys.argv[4] if len(sys.argv) > 4 else None

tpl = open(proto, encoding='utf-8').read()
if inject_file:
    js = open(inject_file, encoding='utf-8').read()
    snippet = ('<script>try{' + js +
               '}catch(err){document.body.insertAdjacentHTML("afterbegin",'
               '"<pre style=color:red>INJECT ERR:"+err.message+"</pre>");}</script>')
    tpl = tpl.replace('</body>', snippet + '\n</body>')

tmp = os.path.join(os.environ['TEMP'], 'tc_capture_state.html')
open(tmp, 'w', encoding='utf-8').write(tpl)

edge = r'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
if not os.path.exists(edge):
    edge = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
udd = os.path.join(os.environ['TEMP'], 'tc_edge_state')
fwd = tmp.replace(chr(92), '/')
url = 'file:///' + fwd
subprocess.run([edge, '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
                '--force-device-scale-factor=1', '--user-data-dir=' + udd,
                '--window-size=' + W + ',' + H, '--screenshot=' + out, url], timeout=90)
print('OUT', out, (os.path.getsize(out) if os.path.exists(out) else 'MISSING'))
