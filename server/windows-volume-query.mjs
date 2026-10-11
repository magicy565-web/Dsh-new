// Fixed read-only command; directory is passed as an environment value, never
// interpolated into executable text. No ExecutionPolicy switch or elevation.
export const windowsVolumeQuery = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;
using Microsoft.Win32.SafeHandles;
public static class WorkspaceVolumeQuery {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle, StringBuilder name, uint nameSize, out uint serial, out uint maximum, out uint flags, StringBuilder fileSystem, uint fileSystemSize);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool GetVolumePathNameW(string path, StringBuilder root, uint size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
  static extern uint GetDriveTypeW(string root);
  public static string Read(string path) {
    using (var handle = CreateFileW(path, 0x80, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      var fileSystem = new StringBuilder(261);
      uint serial, maximum, flags;
      if (!GetVolumeInformationByHandleW(handle, null, 0, out serial, out maximum, out flags, fileSystem, 261)) throw new Win32Exception(Marshal.GetLastWin32Error());
      var root = new StringBuilder(32768);
      if (!GetVolumePathNameW(path, root, 32768)) throw new Win32Exception(Marshal.GetLastWin32Error());
      var name = fileSystem.ToString().Replace("\\", "\\\\").Replace("\"", "\\\"");
      return "{\"fileSystem\":\"" + name + "\",\"driveType\":" + GetDriveTypeW(root.ToString()) + ",\"flags\":" + flags + "}";
    }
  }
}
'@
[WorkspaceVolumeQuery]::Read($env:WORKSPACE_VOLUME_QUERY_DIRECTORY)
`;
