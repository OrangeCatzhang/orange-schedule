param([Parameter(Mandatory=$true)][string]$InputPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ReadOnlyWindowBranding {
 [StructLayout(LayoutKind.Sequential)] public struct PropertyKey {
  public Guid Format; public uint Id;
  public PropertyKey(uint id) { Format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); Id=id; }
 }
 [StructLayout(LayoutKind.Explicit, Size=24)] public struct PropVariant {
  [FieldOffset(0)] public ushort Type;
  [FieldOffset(8)] public IntPtr Pointer;
 }
 [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 public interface IReadOnlyPropertyStore {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint index, out PropertyKey key);
  [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
 }
 [DllImport("shell32.dll")] private static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IReadOnlyPropertyStore store);
 [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
 [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
 public static void VerifyOwner(long handle, uint expected) {
  uint owner;
  if (expected==0 || GetWindowThreadProcessId(new IntPtr(handle), out owner)==0 || owner!=expected)
   throw new InvalidOperationException("Window does not belong to the isolated test process");
 }
 public static string Read(long handle, uint expected, uint id) {
  VerifyOwner(handle, expected);
  var iid=typeof(IReadOnlyPropertyStore).GUID;
  IReadOnlyPropertyStore store;
  Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(new IntPtr(handle), ref iid, out store));
  try {
   var key=new PropertyKey(id); PropVariant value;
   Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
   try { return value.Type==31 ? Marshal.PtrToStringUni(value.Pointer) : "VT_"+value.Type; }
   finally { PropVariantClear(ref value); }
  } finally { Marshal.ReleaseComObject(store); }
 }
}
"@
$inputData = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$records = @()
foreach ($item in $inputData.windows) {
 $handle = [long]$item.handle
 $expectedProcess = [uint32]$inputData.pid
 [ReadOnlyWindowBranding]::VerifyOwner($handle, $expectedProcess)
 $nativeHandle = [IntPtr]$handle
 $record = [ordered]@{
  role=$item.role; handle=$handle; pid=$expectedProcess
  visible=[ReadOnlyWindowBranding]::IsWindowVisible($nativeHandle)
  toolWindow=([ReadOnlyWindowBranding]::GetWindowLongPtr($nativeHandle,-20).ToInt64() -band 0x80) -ne 0
  appId=[ReadOnlyWindowBranding]::Read($handle,$expectedProcess,5)
  iconResource=[ReadOnlyWindowBranding]::Read($handle,$expectedProcess,3)
  relaunchCommand=[ReadOnlyWindowBranding]::Read($handle,$expectedProcess,2)
  displayName=[ReadOnlyWindowBranding]::Read($handle,$expectedProcess,4)
  icons=@()
 }
 foreach ($kind in @(0,1)) {
  [ReadOnlyWindowBranding]::VerifyOwner($handle, $expectedProcess)
  $iconHandle = [IntPtr]::Zero
  $sent = [ReadOnlyWindowBranding]::SendMessageTimeout($nativeHandle,0x7f,[IntPtr]$kind,[IntPtr]::Zero,2,1000,[ref]$iconHandle)
  if ($sent -eq [IntPtr]::Zero -or $iconHandle -eq [IntPtr]::Zero) { throw "Missing window icon $kind for test window $handle" }
  # The HICON is owned by the tested window, so never destroy it here.
  $icon = [Drawing.Icon]::FromHandle($iconHandle)
  $bitmap = $icon.ToBitmap()
  try {
   $orange = 0
   for ($y=0; $y -lt $bitmap.Height; $y++) {
    for ($x=0; $x -lt $bitmap.Width; $x++) {
     $pixel = $bitmap.GetPixel($x,$y)
     if ($pixel.A -gt 32 -and $pixel.R -ge 170 -and $pixel.G -ge 55 -and $pixel.G -le 210 -and $pixel.B -le 135 -and $pixel.R -gt ($pixel.G*1.1) -and $pixel.R -gt ($pixel.B*1.7)) { $orange++ }
    }
   }
   $record.icons += [pscustomobject]@{kind=$kind;width=$bitmap.Width;height=$bitmap.Height;orangePixels=$orange;totalPixels=$bitmap.Width*$bitmap.Height}
  } finally { $bitmap.Dispose(); $icon.Dispose() }
 }
 $records += [pscustomobject]$record
}
ConvertTo-Json -InputObject @($records) -Depth 5 -Compress
