// 보고 내용 생성과 회사 양식 보존을 실제 C# 메서드 및 모의 DOM으로 검증한다.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {test,assert,extractCsMember} from './harness.mjs';
const widget=fileURLToPath(new URL('../widget/',import.meta.url));
const read=n=>readFileSync(join(widget,n),'utf8');
let artifact;
function compiled(){
  if(artifact)return artifact;
  const dir=mkdtempSync(join(tmpdir(),'tc-attendance-contract-'));
  try{
    const xml=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
    writeFileSync(join(dir,'test.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework><RuntimeFrameworkVersion>9.0.17</RuntimeFrameworkVersion><TargetLatestRuntimePatch>false</TargetLatestRuntimePatch><Nullable>enable</Nullable></PropertyGroup><ItemGroup>${['AttendanceDocument.cs','AttendanceCompanyScripts.cs','NetcusText.cs','AttendanceWorkflow.cs'].map(n=>`<Compile Include="${xml(join(widget,n))}" Link="${n}"/>`).join('')}</ItemGroup></Project>`);
    const svc=read('AttendanceNetcus.cs');
    const normal=extractCsMember(svc,'private static string Normal(');
    const verify=extractCsMember(svc,'internal static AttendanceReceipt AttendanceVerify(');
    const hours=extractCsMember(read('ReportDb.cs'),'internal static bool HoursInDomain(');
    writeFileSync(join(dir,'Program.cs'),`using System;using System.Threading.Tasks;using System.Globalization;using System.Collections.Generic;using System.Text.Json;using TaskCalendarWidget;using static TaskCalendarWidget.NetcusText;
namespace TaskCalendarWidget { internal static class ReportDb {${hours}} internal sealed partial class NetcusService {${normal}\n${verify}} }
class Program {
static void Check(bool ok,string m){if(!ok)throw new Exception(m);}
static void Main(){
var d=new AttendanceDocument{Kind="weekly",From="2026-10-26",To="2026-11-01",Lines=new(){new AttendanceLine{CategoryId="qa-1",Name="예시 과제",Hours=1.25m,Work="한글 & <본문>",Plan="다음 계획"}},NotEndWork="보존 값",Problem="",ResultWork="회의"};
d.Validate(); Check(d.WorkText=="[예시 과제] : 1.25시간\\n한글 & <본문>","원문 생성");
var f=new Dictionary<string,string>{{"sdate",d.From},{"edate",d.To},{"subject",d.Title},{"content",d.HoursText},{"endwork",d.WorkText},{"planwork",d.PlanText},{"iscompletion","y"},{"notendwork",d.NotEndWork},{"problem",d.Problem},{"resultwork",d.ResultWork}};
Check(NetcusService.AttendanceVerify(d,f).State=="confirmed","동일 원문 확인");f["notendwork"]="유실";Check(NetcusService.AttendanceVerify(d,f).State=="unknown","보존 항목 유실 거부");f["notendwork"]=d.NotEndWork;f["iscompletion"]="n";Check(NetcusService.AttendanceVerify(d,f).State=="unknown","작성만 한 폼을 제출로 보지 않음");
d.Lines[0].Hours=1.001m;try{d.Validate();throw new Exception("소수 단위 허용 오류");}catch(ArgumentException){}d.Lines[0].Hours=1.25m;
d.Lines.Add(d.Lines[0]);try{d.Validate();throw new Exception("중복 과제 허용 오류");}catch(ArgumentException){}d.Lines.RemoveAt(1);
d.Kind="daily";d.To=d.From;d.Status="";f=new(){{"content",d.WorkText},{"overtime","0"},{"status","4"}};Check(NetcusService.AttendanceVerify(d,f).State=="confirmed","미기록 근태 보존");d.Status="1";Check(NetcusService.AttendanceVerify(d,f).State=="unknown","지정 근태 불일치 거부");

var order=new List<string>(); int stored=0;
var fail=AttendanceWorkflow.Run(d,()=>{order.Add("company");return Task.FromResult(new AttendanceReceipt{State="failed"});},(a,b)=>{stored++;return Task.CompletedTask;},_=>{}).GetAwaiter().GetResult();Check(!fail.Ok&&stored==0,"회사 실패시 DB 요청 없음");
var unknown=AttendanceWorkflow.Run(d,()=>Task.FromResult(new AttendanceReceipt{State="unknown"}),(a,b)=>{stored++;return Task.CompletedTask;},_=>{}).GetAwaiter().GetResult();Check(!unknown.Ok&&stored==0,"회사 결과 불명시 DB 요청 없음");
order.Clear();int attempt=0;
Func<Task<AttendanceReceipt>> company=()=>{order.Add("company");return Task.FromResult(new AttendanceReceipt{State="confirmed"});};
Func<AttendanceDocument,AttendanceReceipt,Task> store=(a,b)=>{order.Add("database");if(attempt++==0)throw new InvalidOperationException("모의 DB 실패");return Task.CompletedTask;};
var first=AttendanceWorkflow.Run(d,company,store,_=>{}).GetAwaiter().GetResult();Check(!first.Ok&&first.Stage=="database","회사 성공후 DB 실패는 전체 실패");
var retry=AttendanceWorkflow.Run(d,company,store,_=>{}).GetAwaiter().GetResult();Check(retry.Ok&&string.Join(",",order)=="company,database,company,database","재시도는 회사부터 실행");
Check(first.Error==AttendanceWorkflow.Failure&&fail.Error==first.Error&&unknown.Error==first.Error,"공통 실패 안내");
Console.WriteLine(JsonSerializer.Serialize(new{checks=8,workflowChecks=5,read=AttendanceCompanyScripts.Read,post=AttendanceCompanyScripts.Post("/mock-report",new(){{"content","한글 & <본문>"},{"iscompletion","y"}})}));
}}
`);
    const build=spawnSync('dotnet',['build',join(dir,'test.csproj'),'-o',join(dir,'out'),'-v:q'],{encoding:'utf8',windowsHide:true,timeout:120000});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const run=spawnSync('dotnet',[join(dir,'out','test.dll')],{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(run.status,0,run.stdout+run.stderr);artifact=JSON.parse(run.stdout.trim());return artifact;
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test('#17 호스트: C# 원문 생성, 시간 단위, 중복 과제, 제출 확인과 보존 항목 검증',()=>assert.equal(compiled().checks,8));
test('#17 회사 폼: 추가 항목과 숨김 필드, 체크 상태 및 한글을 보존해 한 번만 전송',()=>{
  const dom=new JSDOM('<form><input name="token" value="qa-token"><textarea name="notendwork">기존 미처리</textarea><textarea name="problem">기존 문제</textarea><textarea name="resultwork">기존 회의</textarea><textarea name="content">예전 본문</textarea><input name="iscompletion" value="n"><input name="checked" type="checkbox" checked value="yes"><input name="unchecked" type="checkbox" value="no"></form>',{url:'https://fixture.invalid/report',runScripts:'outside-only'});
  try{
    let sent=0,values;
    dom.window.HTMLFormElement.prototype.submit=function(){sent++;values=Object.fromEntries(new dom.window.FormData(this));};
    assert.equal(dom.window.eval(compiled().post),'DISPATCHED');assert.equal(sent,1);
    assert.deepEqual({...values},{token:'qa-token',notendwork:'기존 미처리',problem:'기존 문제',resultwork:'기존 회의',content:'한글 & <본문>',iscompletion:'y',checked:'yes'});
    assert.equal(dom.window.document.querySelector('[data-tc-attendance]').acceptCharset,'euc-kr');
    assert.throws(()=>dom.window.eval(compiled().post),/이미 전송/);assert.equal(sent,1);
  }finally{dom.window.close();}
});
test('#17 회사 폼: 필수 내용 누락과 로그인 화면을 정상 조회로 보지 않음',()=>{
  for(const html of ['<p>오류 화면</p>','<input type="password"><textarea name="content"></textarea>']){
    const dom=new JSDOM(html,{runScripts:'outside-only'});try{assert.throws(()=>dom.window.eval(compiled().read));}finally{dom.window.close();}
  }
});

test('근태정책 호스트: 회사 실패와 응답 불명, DB 실패, 재시도 순서 및 공통 안내',()=>assert.equal(compiled().workflowChecks,5));
