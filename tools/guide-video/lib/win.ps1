# 창 도우미(녹화 전용). 앱 소스는 건드리지 않고 Win32 로 창 위치를 읽고, 열람 창의 바깥 틀(제목줄)을 PrintWindow 로 찍는다.
#   사용: powershell -NoProfile -File win.ps1 -Op rect   -AppPid <pid> [-TitleLike <부분 제목>]
#         powershell -NoProfile -File win.ps1 -Op shot   -AppPid <pid> -TitleLike <부분 제목> -Out <png>
#         powershell -NoProfile -File win.ps1 -Op serve  -AppPid <pid>   (stdin 한 줄 = 명령, stdout 한 줄 = JSON 결과)
param([string]$Op = 'rect', [int]$AppPid = 0, [string]$TitleLike = '', [string]$Out = '')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
public static class GvWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  public static List<IntPtr> Find(uint pid, string like) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (like == "" || sb.ToString().Contains(like)) list.Add(h);
      return true; }, IntPtr.Zero);
    return list;
  }
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static string Info(IntPtr h) {
    RECT w; GetWindowRect(h, out w);
    RECT f; if (DwmGetWindowAttribute(h, 9, out f, Marshal.SizeOf(typeof(RECT))) != 0) f = w;  // DWMWA_EXTENDED_FRAME_BOUNDS = 9 (보이는 틀)
    RECT c; GetClientRect(h, out c); POINT o = new POINT(); ClientToScreen(h, ref o);
    return string.Format("{{\"hwnd\":{0},\"title\":\"{1}\",\"win\":[{2},{3},{4},{5}],\"frame\":[{6},{7},{8},{9}],\"client\":[{10},{11},{12},{13}],\"zoomed\":{14}}}",
      h.ToInt64(), Title(h).Replace("\\", "\\\\").Replace("\"", "\\\""), w.L, w.T, w.R - w.L, w.B - w.T, f.L, f.T, f.R - f.L, f.B - f.T, o.X, o.Y, c.R, c.B, IsZoomed(h) ? "true" : "false");
  }
  // 창 전체를 PrintWindow(PW_RENDERFULLCONTENT=2)로 찍어 보이는 틀(frame) 범위만 PNG 로 저장한다.
  public static void Shot(IntPtr h, string path) {
    RECT w; GetWindowRect(h, out w);
    RECT f; if (DwmGetWindowAttribute(h, 9, out f, Marshal.SizeOf(typeof(RECT))) != 0) f = w;
    int W = w.R - w.L, H = w.B - w.T;
    using (var bmp = new Bitmap(W, H, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(bmp)) { IntPtr dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }
      var crop = new Rectangle(f.L - w.L, f.T - w.T, f.R - f.L, f.B - f.T);
      using (var c = bmp.Clone(crop, bmp.PixelFormat)) c.Save(path, ImageFormat.Png);
    }
  }
  public static void Show(IntPtr h, int cmd) { ShowWindow(h, cmd); }
  // 녹화 겹침 층의 커서와 같은 모양(30x30, 끝점 5,3)을 PNG 로 그린다. 제목줄 단추처럼 웹 밖을 가리킬 때 ffmpeg 가 덮어 그린다.
  public static void Cursor(string path) {
    using (var bmp = new Bitmap(34, 34, PixelFormat.Format32bppArgb))
    using (var g = Graphics.FromImage(bmp)) {
      g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
      g.Clear(Color.Transparent);
      var pts = new PointF[] { new PointF(5,3), new PointF(5,24), new PointF(10.2f,19.4f), new PointF(13.6f,27), new PointF(17.4f,25.3f), new PointF(14,17.9f), new PointF(21,17.6f) };
      var sh = new PointF[pts.Length]; for (int i = 0; i < pts.Length; i++) sh[i] = new PointF(pts[i].X, pts[i].Y + 2);
      using (var b = new SolidBrush(Color.FromArgb(80, 0, 0, 0))) g.FillPolygon(b, sh);
      g.FillPolygon(Brushes.White, pts);
      using (var p = new Pen(Color.FromArgb(255, 17, 24, 39), 1.7f)) { p.LineJoin = System.Drawing.Drawing2D.LineJoin.Round; g.DrawPolygon(p, pts); }
      bmp.Save(path, ImageFormat.Png);
    }
  }
  public static string AppPid() {
    foreach (var p in System.Diagnostics.Process.GetProcesses()) {
      try { var f = p.MainModule.FileName; if (f.IndexOf(@"\Programs\TaskCalendar\", StringComparison.OrdinalIgnoreCase) >= 0 && f.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && f.IndexOf("unins", StringComparison.OrdinalIgnoreCase) < 0) return p.Id.ToString(); } catch { }
    }
    return "0";
  }
  public static void Front(IntPtr h) { SetForegroundWindow(h); }
  public static void Close(IntPtr h) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
'@

function Pick([string]$like) {
  $hs = [GvWin]::Find([uint32]$AppPid, $like)
  if ($hs.Count -eq 0) { return $null }
  return $hs[0]
}
function RunOp([string]$op, [string]$like, [string]$out) {
  $h = Pick $like
  if ($null -eq $h) { return '{"ok":false,"why":"no window"}' }
  switch ($op) {
    'rect'     { return [GvWin]::Info($h) }
    'shot'     { [GvWin]::Shot($h, $out); return [GvWin]::Info($h) }
    'maximize' { [GvWin]::Show($h, 3); return '{"ok":true}' }
    'restore'  { [GvWin]::Show($h, 9); return '{"ok":true}' }
    'front'    { [GvWin]::Front($h); return '{"ok":true}' }
    'close'    { [GvWin]::Close($h); return '{"ok":true}' }
    default    { return '{"ok":false,"why":"bad op"}' }
  }
}
if ($Op -eq 'cursor') { [GvWin]::Cursor($Out); 'ok'; exit 0 }
if ($Op -eq 'pid') { [GvWin]::AppPid(); exit 0 }
if ($Op -eq 'serve') {
  # 한 줄 = "op<TAB>titleLike<TAB>out"
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line -or $line -eq 'quit') { break }
    $p = $line.Split("`t")
    try { $r = RunOp $p[0] ($(if ($p.Length -gt 1) { $p[1] } else { '' })) ($(if ($p.Length -gt 2) { $p[2] } else { '' })) } catch { $r = '{"ok":false,"why":"' + ($_.Exception.Message -replace '"', "'") + '"}' }
    [Console]::Out.WriteLine($r); [Console]::Out.Flush()
  }
} else {
  RunOp $Op $TitleLike $Out
}
