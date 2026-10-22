#define AppName "Workspace Harness"
#define AppPublisher "magicy565-web"
#define AppExeName "WorkspaceHarness.exe"

#ifndef AppVersion
  #define AppVersion "0.5.0-rc.2"
#endif
#ifndef PayloadDir
  #define PayloadDir "..\build\payload"
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
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\WorkspaceHarness
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#OutputDir}
OutputBaseFilename=Workspace-Harness-Setup-{#AppVersion}
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
VersionInfoDescription={#AppName} 本地工作台安装程序
CloseApplications=no
RestartApplications=no
AllowNoIcons=yes
MinVersion=10.0
ShowLanguageDialog=no

[Languages]
Name: "chs"; MessagesFile: "assets\ChineseSimplified.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\{#AppExeName}"
Name: "{group}\停止 {#AppName} 服务"; Filename: "{app}\{#AppExeName}"; Parameters: "--stop"; WorkingDir: "{app}"; IconFilename: "{app}\{#AppExeName}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "立即启动 {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#AppExeName}"; Parameters: "--stop"; Flags: runhidden; RunOnceId: "StopWorkspaceHarness"

[Code]
procedure StopInstalledServer();
var
  ResultCode: Integer;
  Exe: String;
begin
  Exe := ExpandConstant('{app}\{#AppExeName}');
  if FileExists(Exe) then
  begin
    Exec(Exe, '--stop', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    StopInstalledServer();
end;
