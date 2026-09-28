using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

internal static class WindowLayer {
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int cx,int cy,uint flags);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder value,int count);
 [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string name,string title);
 static int Main(string[] args) {
  try {
   if(args.Length<3)return 2;
   IntPtr hwnd=new IntPtr(long.Parse(args[1]));uint expected=uint.Parse(args[2]),actual;
   if(!IsWindow(hwnd)){return 3;}GetWindowThreadProcessId(hwnd,out actual);if(actual!=expected)return 4;
   if(args[0]=="bottom") {
    // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE: only change the window's stacking order.
    if(!SetWindowPos(hwnd,new IntPtr(1),0,0,0,0,0x0013))return 5;
    Console.WriteLine("ok");return 0;
   }
   if(args[0]=="inspect") {
    var list=new List<IntPtr>();var visited=new HashSet<IntPtr>();
    for(var h=GetTopWindow(IntPtr.Zero);h!=IntPtr.Zero&&list.Count<10000&&visited.Add(h);h=GetWindow(h,2))list.Add(h);
    Console.WriteLine("index="+list.IndexOf(hwnd));
    Console.WriteLine("shellIndex="+list.IndexOf(GetShellWindow()));
    foreach(var h in list){
     var cls=new StringBuilder(256);GetClassName(h,cls,cls.Capacity);
     if((cls.ToString()=="Progman"||cls.ToString()=="WorkerW")&&IsWindowVisible(h)&&FindWindowEx(h,IntPtr.Zero,"SHELLDLL_DefView",null)!=IntPtr.Zero)
      Console.WriteLine("desktopIndex="+list.IndexOf(h));
    }
    if(args.Length>3)Console.WriteLine("otherIndex="+list.IndexOf(new IntPtr(long.Parse(args[3]))));
    Console.WriteLine("visible="+IsWindowVisible(hwnd).ToString().ToLowerInvariant());
    Console.WriteLine("iconic="+IsIconic(hwnd).ToString().ToLowerInvariant());
    return 0;
   }
   return 2;
  }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}
 }
}
