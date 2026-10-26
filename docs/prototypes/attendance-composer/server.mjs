// 선택 사항. index.html은 파일로 직접 열어도 동작한다. 외부 패키지나 회사 API를 사용하지 않는다.
import http from 'node:http';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
const port=Number(process.env.PORT||4319);
const allowed={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js'};
http.createServer((req,res)=>{
  const name=allowed[new URL(req.url,'http://localhost').pathname];
  if(!name){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store'});
  createReadStream(fileURLToPath(new URL(name,import.meta.url))).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`근태 작성 시안: http://127.0.0.1:${port}/?case=B`));
