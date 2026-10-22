using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

// Workspace Harness one-click launcher.
//
//   WorkspaceHarness.exe            start the local harness (if needed) and open /home
//   WorkspaceHarness.exe --no-browser  start only (used by installers and tests)
//   WorkspaceHarness.exe --stop     stop the server this launcher started
//   WorkspaceHarness.exe --status   exit 0 when the port is listening, 1 otherwise
//
// The server is a normal child process: hidden window, stdout redirected by
// desktop/start.mjs into %LOCALAPPDATA%\WorkspaceHarness\logs\server.log, and a
// pid file used only by --stop. The app itself stays in the install directory;
// all mutable state lives in %LOCALAPPDATA%\WorkspaceHarness.
internal static class Program
{
    private const int Port = 8790;
    private const string MutexName = "Local\\WorkspaceHarnessLauncher";
    private static string _root;
    private static string _appData;

    [STAThread]
    private static int Main(string[] args)
    {
        _root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        _appData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "WorkspaceHarness");

        string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "--start";
        bool openBrowser = true;
        foreach (string arg in args)
            if (string.Equals(arg, "--no-browser", StringComparison.OrdinalIgnoreCase)) openBrowser = false;

        try
        {
            Directory.CreateDirectory(_appData);
            Directory.CreateDirectory(Path.Combine(_appData, "logs"));
            Directory.CreateDirectory(Path.Combine(_appData, "data"));
            Log("launcher " + mode + " root=" + _root);

            if (mode == "--stop") return StopServer();
            if (mode == "--status") return PortOpen() ? 0 : 1;
            return Start(openBrowser);
        }
        catch (Exception error)
        {
            Log("fatal: " + error);
            Fail("Workspace Harness 启动失败", error.Message + "\n\n日志：" + Path.Combine(_appData, "logs", "server.log"));
            return 9;
        }
    }

    private static int Start(bool openBrowser)
    {
        using (Mutex mutex = new Mutex(false, MutexName))
        {
            if (!mutex.WaitOne(TimeSpan.FromSeconds(15)))
            {
                Log("another launcher is starting; open the page only");
                if (openBrowser) OpenBrowser();
                return 0;
            }

            try
            {
                if (!PortOpen())
                {
                    string composition = PrepareComposition();
                    string node = Path.Combine(_root, "runtime", "node.exe");
                    string entry = Path.Combine(_root, "desktop", "start.mjs");
                    if (!File.Exists(node) || !File.Exists(entry))
                    {
                        Fail("安装不完整", "找不到 runtime\\node.exe 或 desktop\\start.mjs。请重新运行安装包。");
                        return 2;
                    }

                    ProcessStartInfo info = new ProcessStartInfo(node, Quote(entry));
                    info.WorkingDirectory = _root;
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.EnvironmentVariables["HARNESS_COMPOSITION"] = composition;
                    info.EnvironmentVariables["WORKSPACE_HARNESS_LOG"] = Path.Combine(_appData, "logs", "server.log");

                    Log("starting " + node + " " + Quote(entry));
                    Process child = Process.Start(info);
                    File.WriteAllText(Path.Combine(_appData, "server.pid"), child.Id.ToString(CultureInfo.InvariantCulture));

                    if (!WaitForPort(90000))
                    {
                        KillTree(child.Id);
                        Fail(
                            "服务没有在 90 秒内就绪",
                            "端口 " + Port + " 没有监听。请查看日志：\n" + Path.Combine(_appData, "logs", "server.log"));
                        return 3;
                    }
                }
                else
                {
                    Log("port " + Port + " already listening; reuse it");
                }

                if (openBrowser) OpenBrowser();
                return 0;
            }
            finally
            {
                mutex.ReleaseMutex();
            }
        }
    }

    /// Copy the shipped composition next to the user data and point storage at it.
    /// Rewritten on every launch so an upgrade always picks up new plugin rows.
    private static string PrepareComposition()
    {
        string template = Path.Combine(_root, "harness.local.yml");
        if (!File.Exists(template)) throw new FileNotFoundException("缺少 harness.local.yml", template);

        string dataPath = Path.Combine(_appData, "data").Replace('\\', '/');
        string text = File.ReadAllText(template);
        string needle = "directory: .harness-data";
        if (text.IndexOf(needle, StringComparison.Ordinal) < 0)
            throw new InvalidOperationException("harness.local.yml 里找不到 storage 的 \"" + needle + "\"。");

        text = text.Replace(needle, "directory: '" + dataPath + "'");
        string target = Path.Combine(_appData, "harness.yml");
        File.WriteAllText(target, text);
        Log("composition " + target + " -> " + dataPath);
        return target;
    }

    private static int StopServer()
    {
        int pid = ReadPid();
        if (pid > 0) KillTree(pid);
        else
        {
            int owner = FindPortOwner();
            if (owner > 0) KillTree(owner);
        }

        for (int i = 0; i < 40 && PortOpen(); i++) Thread.Sleep(250);
        try { File.Delete(Path.Combine(_appData, "server.pid")); } catch { }
        Log("stopped; listening=" + PortOpen());
        return PortOpen() ? 4 : 0;
    }

    private static int ReadPid()
    {
        try
        {
            string file = Path.Combine(_appData, "server.pid");
            if (!File.Exists(file)) return 0;
            int pid;
            return int.TryParse(File.ReadAllText(file).Trim(), out pid) ? pid : 0;
        }
        catch { return 0; }
    }

    private static int FindPortOwner()
    {
        try
        {
            ProcessStartInfo info = new ProcessStartInfo("netstat.exe", "-ano -p tcp");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            using (Process process = Process.Start(info))
            {
                string output = process.StandardOutput.ReadToEnd();
                process.WaitForExit(5000);
                foreach (string line in output.Split('\n'))
                {
                    string text = line.Trim();
                    if (!text.Contains(":" + Port)) continue;
                    if (!text.EndsWith("LISTENING", StringComparison.OrdinalIgnoreCase)) continue;
                    string[] parts = text.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    int pid;
                    if (parts.Length > 0 && int.TryParse(parts[parts.Length - 1], out pid)) return pid;
                }
            }
        }
        catch (Exception error) { Log("netstat failed: " + error.Message); }
        return 0;
    }

    private static void KillTree(int pid)
    {
        try
        {
            ProcessStartInfo info = new ProcessStartInfo("taskkill.exe", "/PID " + pid.ToString(CultureInfo.InvariantCulture) + " /T /F");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            using (Process process = Process.Start(info))
            {
                process.StandardOutput.ReadToEnd();
                process.StandardError.ReadToEnd();
                process.WaitForExit(10000);
            }
            Log("taskkill pid=" + pid);
        }
        catch (Exception error) { Log("taskkill failed: " + error.Message); }
    }

    private static bool WaitForPort(int timeoutMs)
    {
        int waited = 0;
        while (waited < timeoutMs)
        {
            if (PortOpen()) return true;
            Thread.Sleep(250);
            waited += 250;
        }
        return PortOpen();
    }

    private static bool PortOpen()
    {
        try
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult result = client.BeginConnect("127.0.0.1", Port, null, null);
                if (!result.AsyncWaitHandle.WaitOne(500)) return false;
                client.EndConnect(result);
                return true;
            }
        }
        catch { return false; }
    }

    private static void OpenBrowser()
    {
        Process.Start(new ProcessStartInfo("http://127.0.0.1:" + Port + "/home") { UseShellExecute = true });
    }

    private static string Quote(string value)
    {
        return "\"" + value + "\"";
    }

    private static void Log(string message)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(_appData, "logs", "launcher.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + " " + message + Environment.NewLine);
        }
        catch { }
    }

    private static void Fail(string title, string message)
    {
        Log("fail: " + title + " / " + message);
        MessageBox.Show(message, title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
