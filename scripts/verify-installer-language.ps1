param(
  [Parameter(Mandatory = $true)][string]$NsisDirectory,
  [Parameter(Mandatory = $true)][string]$PluginDirectory
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$workRoot = Join-Path $taskRoot '_work'
$testId = 'orange-schedule-language-verification-' + [Guid]::NewGuid().ToString('N')
$testRoot = Join-Path $workRoot ('_verify_' + $testId)
$reportRoot = Join-Path $taskRoot 'outputs\verification'
$registryPath = 'HKCU:\Software\' + $testId
$compiler = Join-Path $NsisDirectory 'Bin\makensis.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw "NSIS compiler not found: $compiler" }
if (!(Test-Path -LiteralPath $PluginDirectory)) { throw "NSIS plugins not found: $PluginDirectory" }
if (Test-Path -LiteralPath $registryPath) { throw 'Refusing to use an existing registry key.' }
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
$scriptPath = Join-Path $testRoot 'language-harness.nsi'
$harnessExe = Join-Path $testRoot 'language-harness.exe'
$script = @'
Unicode true
RequestExecutionLevel user
AutoCloseWindow true
Name "橙子日程"
BrandingText "橙子日程 test"
OutFile "__HARNESS_EXE__"
InstallDir "__TEST_ROOT__\installed"
!define APP_GUID "__TEST_ID__"
!define VERSION "test"
!define SHELL_CONTEXT HKCU
!addplugindir /x86-unicode "__PLUGIN_DIRECTORY__"
!addincludedir "__TASK_ROOT__\node_modules\app-builder-lib\templates\nsis\include"
!include MUI2.nsh
!include FileFunc.nsh
!include UAC.nsh
!include "__TASK_ROOT__\scripts\installer.nsh"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro customHeader
Function .onInit
  !insertmacro preInit
  !insertmacro MUI_LANGDLL_DISPLAY
  !insertmacro customInit
FunctionEnd
Function un.onInit
  !insertmacro customUnInit
FunctionEnd
Section
  SetShellVarContext current
  CreateDirectory "$INSTDIR\resources"
  !insertmacro customInstall
  FileOpen $0 "$INSTDIR\installer-caption.txt" w
  FileWriteUTF16LE $0 "$(^Name)"
  FileClose $0
  WriteUninstaller "$INSTDIR\uninstall-harness.exe"
SectionEnd
Section Uninstall
SectionEnd
'@
foreach ($entry in @{
  '__HARNESS_EXE__' = $harnessExe
  '__TEST_ROOT__' = $testRoot
  '__TEST_ID__' = $testId
  '__PLUGIN_DIRECTORY__' = $PluginDirectory
  '__TASK_ROOT__' = $taskRoot
}.GetEnumerator()) {
  $script = $script.Replace($entry.Key, $entry.Value.Replace('$', '$$').Replace('"', '$\"'))
}
$cases = @()
try {
  [IO.File]::WriteAllText($scriptPath, $script, [Text.UTF8Encoding]::new($false))
  & $compiler /WX /INPUTCHARSET UTF8 $scriptPath
  if ($LASTEXITCODE -ne 0) { throw 'NSIS language harness compilation failed.' }
  foreach ($case in @(
    @{ Name = 'English command line'; Arguments = '/S /LANGUAGE=1033'; Expected = 'en' },
    @{ Name = 'Remember English'; Arguments = '/S'; Expected = 'en' },
    @{ Name = 'Chinese command line'; Arguments = '/S /LANGUAGE=2052'; Expected = 'zh-CN' },
    @{ Name = 'Remember Chinese'; Arguments = '/S'; Expected = 'zh-CN' },
    @{ Name = 'Ignore unsupported command line'; Arguments = '/S /LANGUAGE=9999'; Expected = 'zh-CN' }
  )) {
    $process = Start-Process -FilePath $harnessExe -ArgumentList $case.Arguments -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(20000)) {
      Stop-Process -Id $process.Id -Force
      throw 'The isolated silent harness did not finish; a dialog may have appeared.'
    }
    if ($process.ExitCode -ne 0) { throw "Harness failed with exit code $($process.ExitCode)" }
    $language = (Get-Content -LiteralPath (Join-Path $testRoot 'installed\resources\installer-language.json') -Raw | ConvertFrom-Json).language
    $storedLanguage = (Get-ItemProperty -LiteralPath $registryPath -ErrorAction SilentlyContinue).InstallerLanguage
    if ($language -ne $case.Expected) { throw "$($case.Name): expected $($case.Expected), got $language; registry language: $storedLanguage" }
    $cases += @{ name = $case.Name; language = $language; silentExitCode = $process.ExitCode }
  }
  # Exercise the real MUI chooser in an isolated test process, never a user's app.
  Add-Type -AssemblyName System.Drawing
  if (!('OrangeScheduleLanguageHarnessUi' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class OrangeScheduleLanguageHarnessUi {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  static void RequireProcess(IntPtr h, int processId) { uint p; GetWindowThreadProcessId(h, out p); if (p != processId) throw new Exception("Unexpected UI process"); }
  public static IntPtr[] FindChooser(int processId) {
    IntPtr dialog=IntPtr.Zero, combo=IntPtr.Zero;
    EnumWindows((h,p)=> { uint id; GetWindowThreadProcessId(h, out id); if(id!=processId || !IsWindowVisible(h)) return true;
      EnumChildWindows(h,(c,q)=>{ var b=new StringBuilder(256); GetClassName(c,b,b.Capacity); if(b.ToString()=="ComboBox") { dialog=h; combo=c; } return true; },IntPtr.Zero);
      return combo==IntPtr.Zero;
    },IntPtr.Zero);
    return new [] { dialog, combo };
  }
  public static string Title(IntPtr h, int p) { RequireProcess(h,p); var b=new StringBuilder(512); GetWindowText(h,b,b.Capacity); return b.ToString(); }
  public static string[] Items(IntPtr combo, int p) {
    RequireProcess(combo,p); int count=SendMessage(combo,0x146,IntPtr.Zero,IntPtr.Zero).ToInt32();
    if(count<1 || count>5) throw new Exception("Unexpected language option count");
    var items=new List<string>(); for(int i=0;i<count;i++) { var b=new StringBuilder(512); SendMessage(combo,0x148,new IntPtr(i),b); items.Add(b.ToString()); } return items.ToArray();
  }
  public static int Selection(IntPtr combo,int p) { RequireProcess(combo,p); return SendMessage(combo,0x147,IntPtr.Zero,IntPtr.Zero).ToInt32(); }
  public static void SetSelection(IntPtr combo,int p,int index) {
    RequireProcess(combo,p); SendMessage(combo,0x14E,new IntPtr(index),IntPtr.Zero);
    if(Selection(combo,p)!=index) throw new Exception("Failed to select language");
  }
  public static void Choose(IntPtr dialog,IntPtr combo,int p,int index) {
    RequireProcess(dialog,p); RequireProcess(combo,p);
    SetSelection(combo,p,index);
    var button=GetDlgItem(dialog,1); RequireProcess(button,p); PostMessage(button,0xF5,IntPtr.Zero,IntPtr.Zero);
  }
}
'@
  }
  foreach ($case in @(
    @{ Name = 'Interactive English'; Expected = 'en'; Pattern = 'English'; Previous = 'zh-CN'; ProductName = 'Orange Schedule' },
    @{ Name = 'Interactive Chinese'; Expected = 'zh-CN'; Pattern = '中文(简体)'; Previous = 'en'; ProductName = '橙子日程' }
  )) {
    $process = Start-Process -FilePath $harnessExe -WindowStyle Hidden -PassThru
    try {
      $deadline = [DateTime]::UtcNow.AddSeconds(10)
      do {
        $handles = [OrangeScheduleLanguageHarnessUi]::FindChooser($process.Id)
        if ($handles[1] -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 100
      } while ([DateTime]::UtcNow -lt $deadline -and !$process.HasExited)
      if ($handles[1] -eq [IntPtr]::Zero) { throw 'Interactive mode did not display the language chooser.' }
      $items = [OrangeScheduleLanguageHarnessUi]::Items($handles[1], $process.Id)
      if ($items.Count -ne 2 -or !($items -contains 'English') -or !($items -contains '中文(简体)')) { throw "Unexpected language choices: $items" }
      $selected = [OrangeScheduleLanguageHarnessUi]::Selection($handles[1], $process.Id)
      $expectedDefault = if ($case.Previous -eq 'en') { 'English' } else { '中文(简体)' }
      if ($items[$selected] -ne $expectedDefault) { throw 'The chooser did not remember its previous language.' }
      $title = [OrangeScheduleLanguageHarnessUi]::Title($handles[0], $process.Id)
      $index = [Array]::IndexOf($items, $case.Pattern)
      [OrangeScheduleLanguageHarnessUi]::SetSelection($handles[1], $process.Id, $index)
      $rectangle = New-Object OrangeScheduleLanguageHarnessUi+Rect
      [OrangeScheduleLanguageHarnessUi]::GetWindowRect($handles[0], [ref]$rectangle) | Out-Null
      $width = $rectangle.Right - $rectangle.Left
      $height = $rectangle.Bottom - $rectangle.Top
      if ($width -le 0 -or $height -le 0 -or $width -gt 1200 -or $height -gt 800) { throw 'Unexpected test dialog bounds.' }
      $imagePath = Join-Path $reportRoot ('installer-language-chooser-' + $case.Expected + '.png')
      $bitmap = New-Object Drawing.Bitmap($width, $height)
      $graphics = [Drawing.Graphics]::FromImage($bitmap)
      $dc = $graphics.GetHdc()
      try { if (![OrangeScheduleLanguageHarnessUi]::PrintWindow($handles[0], $dc, 0)) { throw 'Could not capture test dialog.' } }
      finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
      try { $bitmap.Save($imagePath, [Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
      [OrangeScheduleLanguageHarnessUi]::Choose($handles[0], $handles[1], $process.Id, $index)
      if (!$process.WaitForExit(20000)) { throw 'Interactive test installer did not finish.' }
      if ($process.ExitCode -ne 0) { throw "Interactive test exited with $($process.ExitCode)." }
      $language = (Get-Content -LiteralPath (Join-Path $testRoot 'installed\resources\installer-language.json') -Raw | ConvertFrom-Json).language
      if ($language -ne $case.Expected) { throw 'Interactive selection did not reach the installation resource.' }
      $caption = Get-Content -LiteralPath (Join-Path $testRoot 'installed\installer-caption.txt') -Raw -Encoding Unicode
      if ($caption -ne $case.ProductName) { throw "Installer display name does not match selected language: $caption" }
      $cases += @{ name = $case.Name; language = $language; title = $title; options = $items; previousSelection = $expectedDefault; screenshot = $imagePath; productName = $case.ProductName }
    } finally {
      if (!$process.HasExited) { Stop-Process -Id $process.Id -Force }
    }
  }
  $report = @{
    success = $true
    cases = $cases
    scope = 'Isolated NSIS harness only; no app, shortcut, real installation key or user plans were changed.'
  }
  $reportFile = Join-Path $reportRoot 'installer-language-harness.json'
  [IO.File]::WriteAllText($reportFile, ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
  Write-Output "Verified $($cases.Count) silent and interactive language cases. Report: $reportFile"
} finally {
  # Both targets are generated by this run, never the production installation.
  if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
  $resolvedWorkRoot = [IO.Path]::GetFullPath($workRoot).TrimEnd('\') + '\'
  $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
  if (!$resolvedTestRoot.StartsWith($resolvedWorkRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe scratch cleanup path.' }
  if (Test-Path -LiteralPath $resolvedTestRoot) {
    $items = @(Get-Item -LiteralPath $resolvedTestRoot) + @(Get-ChildItem -LiteralPath $resolvedTestRoot -Recurse -Force)
    if ($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Refusing cleanup through a reparse point.' }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}
