// 개발 PC 전용. 관리자 비밀번호는 TC_TEST_DB_ADMIN_PW 환경 변수로만 받는다.
// 실제 회사 DB를 읽지 않고 zz_attendance_* 임시 DB를 만들고 마지막에 지운다.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {splitStatements} from './release-sql-sim.mjs';
if(!process.env.TC_TEST_DB_ADMIN_PW){console.error('TC_TEST_DB_ADMIN_PW가 없어 실 DB 시험을 실행하지 않았습니다.');process.exit(2);}
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const out=join(root,'work','attendance-db-contract');mkdirSync(out,{recursive:true});
const widget=join(root,'widget');
const xml=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
writeFileSync(join(out,'test.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework><Nullable>enable</Nullable><RuntimeFrameworkVersion>9.0.17</RuntimeFrameworkVersion><TargetLatestRuntimePatch>false</TargetLatestRuntimePatch></PropertyGroup><ItemGroup><PackageReference Include="MySqlConnector" Version="2.3.7"/>${['AttendanceDb.cs','AttendanceDocument.cs','DbGate.cs','AttendanceWorkflow.cs'].map(n=>`<Compile Include="${xml(join(widget,n))}" Link="${n}"/>`).join('')}</ItemGroup></Project>`);
const migration=splitStatements(readFileSync(join(root,'db/deploy/migrations/v20-attendance-reports.sql'),'utf8'));
const tables=splitStatements(readFileSync(join(root,'db/deploy/schema-calendar.sql'),'utf8')).filter(x=>/^CREATE TABLE cal_report_(daily|hours|weekly) \(/.test(x)).map(x=>x.replace(/report_json\s+JSON\s+NULL\s*,/g,'').replace(/submitted_at\s+DATETIME\(3\)\s+NULL\s*,/g,''));
writeFileSync(join(out,'Program.cs'),`using System;using System.Linq;using System.Collections.Generic;using System.Globalization;using System.Text.Json;using System.Threading.Tasks;using MySqlConnector;using TaskCalendarWidget;
namespace TaskCalendarWidget {
internal static class DeployConfig {public static string DbHost=>Environment.GetEnvironmentVariable("TC_TEST_DB_HOST")??"127.0.0.1";public static int DbPort=>int.Parse(Environment.GetEnvironmentVariable("TC_TEST_DB_PORT")??"3306");public static string DbName="";public static string DbUser=>Environment.GetEnvironmentVariable("TC_TEST_DB_ADMIN_USER")??"root";public static string DbPassword=>Environment.GetEnvironmentVariable("TC_TEST_DB_ADMIN_PW")!;}
internal static class DbFault { public static void ThrowIfActive(){} }
internal static class ReportDb {internal static bool HoursInDomain(decimal h)=>h>0m&&h<=24m;}
}
class Program {
static int checks;static void Check(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS "+name);checks++;}
static async Task Reject(Func<Task> action,string name){try{await action();}catch(Exception e) when(e is InvalidOperationException||e is DbGateException){Check(true,name);return;}throw new Exception("거부 실패: "+name);}
static AttendanceDocument Doc()=>new(){Kind="daily",From="2026-10-26",To="2026-10-26",Lines=new(){new AttendanceLine{CategoryId="zz-cat-1",Name="변조 이름",Hours=1.25m,Work="예시 업무",Plan=""}}};
static async Task Main(){Console.OutputEncoding=new System.Text.UTF8Encoding(false);
string name="zz_attendance_"+DateTime.UtcNow.ToString("yyyyMMddHHmmssfff");if(!System.Text.RegularExpressions.Regex.IsMatch(name,"^zz_attendance_[0-9]+$"))throw new Exception("임시 DB 이름 오류");
var b=new MySqlConnectionStringBuilder{Server=DeployConfig.DbHost,Port=(uint)DeployConfig.DbPort,UserID=DeployConfig.DbUser,Password=DeployConfig.DbPassword,Pooling=false,AllowUserVariables=true};
await using var admin=new MySqlConnection(b.ConnectionString);await admin.OpenAsync();
async Task Sql(string s){await using var q=new MySqlCommand(s,admin);await q.ExecuteNonQueryAsync();}
await Sql("CREATE DATABASE "+name+" CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
try{
await Sql("USE "+name);DeployConfig.DbName=name;
await Sql("CREATE TABLE app_user(user_id SMALLINT UNSIGNED PRIMARY KEY, login_id VARCHAR(50), is_active TINYINT); INSERT INTO app_user VALUES(1,'zz-qa-1',1),(2,'zz-qa-2',1); CREATE TABLE project(uid CHAR(36) PRIMARY KEY,is_active TINYINT); CREATE TABLE cal_category(user_id SMALLINT UNSIGNED,cat_no INT UNSIGNED,uid VARCHAR(50),name VARCHAR(200),source VARCHAR(10),project_uid CHAR(36),sort_order INT,PRIMARY KEY(user_id,cat_no)); INSERT INTO cal_category VALUES(1,1,'zz-cat-1','예시 과제','local',NULL,1),(1,2,'zz-cat-extra','두 번째 과제','local',NULL,2),(2,1,'zz-cat-2','다른 사람 과제','local',NULL,1); CREATE TABLE cal_schema_meta(k VARCHAR(64) PRIMARY KEY,v VARCHAR(64),updated_at DATETIME(3)); INSERT INTO cal_schema_meta VALUES('db_structure_version','19',UTC_TIMESTAMP(3)),('db_updating','1',UTC_TIMESTAMP(3));");
foreach(var ddl in new string[]{${tables.map(x=>JSON.stringify(x)).join(',')}})await Sql(ddl);

string[] migration={${migration.map(x=>JSON.stringify(x)).join(',')}};
foreach(var s in migration)await Sql(s);Check(true,"구조19에서20 이관");
foreach(var s in migration)await Sql(s);Check(true,"이관 재실행");await Sql("UPDATE cal_schema_meta SET v='0' WHERE k='db_updating'");

var db=new AttendanceDb("zz-qa-1",_=>{});var other=new AttendanceDb("zz-qa-2",_=>{});var d=Doc();
async Task<long> Count(string table){await using var q=new MySqlCommand("SELECT COUNT(*) FROM "+table,admin);return Convert.ToInt64(await q.ExecuteScalarAsync());}
await db.Prepare(d);Check(d.Lines[0].Name=="예시 과제","서버에서 과제명 검증");Check(await Count("cal_report_daily")==0,"제출 확인 단계에 DB 선저장 없음");
await Reject(()=>db.StoreConfirmed(d,new(){State="failed"}),"회사 실패시 DB 저장 거부");Check(await Count("cal_report_daily")==0,"회사 실패 후 기존 DB 유지");
await db.StoreConfirmed(d,new(){State="confirmed",ConfirmedAt=DateTime.UtcNow});Check(await Count("cal_report_daily")==1&&await Count("cal_report_hours")==1,"본문과 시간 동시 저장");
Check(await other.Detail(d)==null,"다른 사용자 조회 격리");
d.Lines[0].Hours=2.75m;await db.StoreConfirmed(d,new(){State="confirmed"});Check(await Count("cal_report_daily")==1&&await Count("cal_report_hours")==1,"동일 날짜 재시도 덮어쓰기");
var good=JsonSerializer.Serialize(await db.Detail(d));
var broken=AttendanceDocument.Parse(d.Serialize());broken.Lines[0].Work="롤백되어야 하는 변경";broken.Lines.Add(new(){CategoryId="zz-cat-extra",Name=new string('X',1000),Hours=1m,Work="두 번째 행 오류",Plan=""});
bool failed=false;try{await db.StoreConfirmed(broken,new(){State="confirmed"});}catch(MySqlException){failed=true;}
Check(failed,"부모 갱신과 자식 일부 저장 후 실제 SQL 오류 주입");Check(JsonSerializer.Serialize(await db.Detail(d))==good,"DB 실패시 본문 전체 롤백");Check(await Count("cal_report_hours")==1,"DB 실패시 시간 행 전체 롤백");
var wrong=Doc();wrong.Lines[0].CategoryId="zz-cat-2";await Reject(()=>db.Prepare(wrong),"타인 과제 제출 전 검증");
int sent=0;var outcome=await AttendanceWorkflow.Run(d,async()=>{sent++;await Sql("UPDATE cal_schema_meta SET v='1' WHERE k='db_updating'");return new(){State="confirmed"};},db.StoreConfirmed,_=>{});
Check(!outcome.Ok&&outcome.Stage=="database","회사 성공 직후 DB 갱신 시작시 전체 실패 응답");await Sql("UPDATE cal_schema_meta SET v='0' WHERE k='db_updating'");Check(JsonSerializer.Serialize(await db.Detail(d))==good,"DB 관문 차단시 이전 기록 유지");
outcome=await AttendanceWorkflow.Run(d,()=>{sent++;return Task.FromResult(new AttendanceReceipt{State="confirmed"});},db.StoreConfirmed,_=>{});Check(outcome.Ok&&sent==2,"실패 재시도는 회사부터 다시 실행");
outcome=await AttendanceWorkflow.Run(d,()=>Task.FromResult(new AttendanceReceipt{State="confirmed"}),async(a,r)=>{await db.StoreConfirmed(a,r);throw new TimeoutException("커밋 후 응답 유실 모의");},_=>{});Check(!outcome.Ok,"DB 커밋 후 응답 유실 모의");await db.StoreConfirmed(d,new(){State="confirmed"});Check(await Count("cal_report_daily")==1,"커밋 응답 유실 후 재시도 중복 없음");
var week=AttendanceDocument.Parse(d.Serialize());week.Kind="weekly";week.To="2026-11-01";await db.StoreConfirmed(week,new(){State="confirmed"});await db.StoreConfirmed(week,new(){State="confirmed"});Check(await Count("cal_report_weekly")==1,"주간 동일 대상 DB 덮어쓰기");
var list=JsonSerializer.SerializeToElement(await db.List("weekly","2026-10-29","2026-10-29","예시",1));Check(list.GetProperty("total").GetInt32()==1,"주간 기간 겹침과 본문 검색");
Console.WriteLine("SUMMARY "+checks+" pass / 0 fail");
}finally{await Sql("DROP DATABASE "+name);Console.WriteLine("CLEANUP "+name);}
}}
`);
const b=spawnSync('dotnet',['build',join(out,'test.csproj'),'-o',join(out,'out'),'-v:q'],{encoding:'utf8',windowsHide:true,timeout:120000});
if(b.status!==0){console.error(b.stdout+b.stderr);process.exit(1);}
const r=spawnSync('dotnet',[join(out,'out','test.dll')],{encoding:'utf8',windowsHide:true,timeout:120000});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status??1;
