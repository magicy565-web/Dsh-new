#define AppName "Workspace Harness"
#define AppPublisher "magicy565-web"
#define AppExeName "WorkspaceHarness.exe"

#ifndef AppVersion
  #define AppVersion "0.5.0-rc.2"
#endif
#ifndef PayloadDir
  #define PayloadDir "..\build-desktop\payload"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif
#ifndef IconFile
  #define IconFile "assets\workspace-harness.ico"
#endif

[Setup]
AppId={{7E5A3C2B-6C1D-4A76-9B2E-3F0D8C41A905}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion} (Desktop)
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\WorkspaceHarness
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#OutputDir}
OutputBaseFilename=Workspace-Harness-Desktop-Setup-{#AppVersion}
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
VersionInfoVersion=0.5.0.2
VersionInfoProductName={#AppName}
VersionInfoProductVersion=0.5.0.2
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} 桌面版安装程序
CloseApplications=no
RestartApplications=no
AllowNoIcons=no
MinVersion=10.0
ShowLanguageDialog=no

[Languages]
Name: "chs"; MessagesFile: "assets\ChineseSimplified.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"; Flags: checkedonce

[InstallDelete]
; A browser-edition install used these top-level paths; the desktop layout does not.
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\desktop"
Type: filesandordirs; Name: "{app}\packages"
Type: filesandordirs; Name: "{app}\plugins"
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\scripts"
Type: filesandordirs; Name: "{app}\node_modules"
Type: files; Name: "{app}\harness.local.yml"
Type: files; Name: "{app}\package.json"
Type: files; Name: "{app}\pnpm-lock.yaml"
Type: files; Name: "{app}\INSTALL.txt"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\{#AppExeName}"
Name: "{group}\停止 {#AppName} 服务"; Filename: "{app}\{#AppExeName}"; Parameters: "--stop"; WorkingDir: "{app}"; IconFilename: "{app}\{#AppExeName}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "立即启动 {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
procedure StopRunningProduct();
var
  PidText: AnsiString;
  PidRaw: String;
  Pid: Integer;
  ResultCode: Integer;
begin
  // Stop the Electron window (and any helper processes with the same image).
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM {#AppExeName} /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Stop the harness child by the pid the desktop shell recorded; never kill
  // unrelated node.exe processes.
  if LoadStringFromFile(ExpandConstant('{localappdata}\WorkspaceHarness\server.pid'), PidText) then
  begin
    PidRaw := Trim(PidText);
    Pid := StrToIntDef(PidRaw, 0);
    if Pid > 0 then
      Exec(ExpandConstant('{sys}\taskkill.exe'), '/PID ' + IntToStr(Pid) + ' /T /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    StopRunningProduct();
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopRunningProduct();
end;
