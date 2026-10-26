// 회사에 접속하지 않는 정책 회귀 검증. 실제 회사 및 실제 DB 시험과 구분한다.
import {readFileSync} from 'node:fs';
import {test,assert,extractCsMember,run} from './harness.mjs';
await import('./attendance-reports.test.mjs');
await import('./attendance-host.test.mjs');
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('정책 정적: 제출 준비에 DB 쓰기 없음, 확정 저장은 회사 성공 조건 및 단일 트랜잭션',()=>{
  const db=read('widget/AttendanceDb.cs');
  const prepare=extractCsMember(db,'internal async Task Prepare(');
  assert.doesNotMatch(prepare,/INSERT INTO|UPDATE |DELETE FROM|BeginTransaction/);
  const store=extractCsMember(db,'internal async Task StoreConfirmed(');
  assert.ok(store.indexOf('receipt.State != "confirmed"')<store.indexOf('BeginTransactionAsync'));
  assert.equal((store.match(/BeginTransactionAsync/g)||[]).length,1);
  assert.equal((store.match(/CommitAsync/g)||[]).length,1);
  assert.doesNotMatch(db,/draft_json|attempt_state|attempt_json|cal_report_document/);
});
test('정책 정적: 기존 일간도 DB 저장을 기다린 뒤 완료 안내, 주간 폼 채움만으로 DB 보고 기록 안 남김',()=>{
  const service=read('widget/NetcusService.cs');
  const save=service.indexOf('bool stored = await _host.SaveDailyReport(');
  assert.ok(save>=0&&service.indexOf('NetcusResult(stored,',save)>save);
  assert.doesNotMatch(service,/_host\.SaveWeeklyReport\(/);
  const main=read('widget/MainWindow.xaml.cs');
  const daily=extractCsMember(main,'async Task<bool> INetcusHost.SaveDailyReport(');
  assert.doesNotMatch(daily,/SaveReportRecordWithRetryAsync/);
});
test('정책 정적: LLM 필수 지침에서 정본을 참조하고 DB 전용 재시도 명령 없음',()=>{
  assert.match(read('AGENTS.md'),/ATTENDANCE-REPORT-POLICY\.md/);
  assert.doesNotMatch(read('widget/AttendanceHost.cs'),/attendanceReceiptRetry|attendanceVerify|_attendanceReceipts/);
  assert.doesNotMatch(read('task-calendar-prototype.html').slice(read('task-calendar-prototype.html').indexOf('const AR =')),/attendanceReceiptRetry|attendanceSave/);
});
await run();
