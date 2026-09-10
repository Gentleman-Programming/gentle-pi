# PS5.1 bootstrap helper for the Windows session transport. It intentionally has
# no pipe server or publication RPCs: start is partial and initialize is the
# only stateful operation in this batch.
# Native definitions adapted from windows-native-boundary-clean/tests/windows-native-boundary/native.ps1
# at c59e1598 (NtCreateFile rooted opens, GetSecurityInfo, and ABI layout).
# API provenance: NtCreateFile / OBJECT_ATTRIBUTES / NtQueryDirectoryFile are
# documented by Microsoft Win32/WDK; this helper has no external binary dependency.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$maxControlBytes = 16384
$maxBootstrapDiagnosticText = 4096
$nativeReady = $false

function Add-BootstrapDiagnosticText([System.Text.StringBuilder]$builder, [object]$value) {
	if ($null -eq $value -or $builder.Length -ge $maxBootstrapDiagnosticText) { return }
	$text = [string]$value
	$remaining = $maxBootstrapDiagnosticText - $builder.Length
	if ($text.Length -gt $remaining) { $text = $text.Substring(0, $remaining) }
	[void]$builder.Append($text)
}

function Get-BootstrapLanguageMode {
	try {
		switch ([string]$ExecutionContext.SessionState.LanguageMode) {
			'FullLanguage' { return 'full' }
			'ConstrainedLanguage' { return 'constrained' }
			'RestrictedLanguage' { return 'restricted' }
			'NoLanguage' { return 'no-language' }
			default { return 'unknown' }
		}
	} catch { return 'unknown' }
}

function Get-BootstrapProperty([object]$value, [string]$name) {
	try {
		if ($null -eq $value) { return $null }
		$property = $value.PSObject.Properties[$name]
		if ($null -eq $property) { return $null }
		return $property.Value
	} catch { return $null }
}

function ConvertTo-BootstrapDiagnosticRecord([object]$entry) {
	$candidate = $entry
	for ($depth = 0; $depth -lt 8 -and $null -ne $candidate; $depth++) {
		if ($candidate -is [System.Management.Automation.ErrorRecord]) {
			$fqid = Get-BootstrapProperty $candidate 'FullyQualifiedErrorId'
			$categoryInfo = Get-BootstrapProperty $candidate 'CategoryInfo'
			$category = Get-BootstrapProperty $categoryInfo 'Category'
			$errorDetails = Get-BootstrapProperty $candidate 'ErrorDetails'
			$errorDetailsMessage = Get-BootstrapProperty $errorDetails 'Message'
			$exception = Get-BootstrapProperty $candidate 'Exception'
			$targetObject = Get-BootstrapProperty $candidate 'TargetObject'
			return [pscustomobject]@{
				FullyQualifiedErrorId = if ($fqid -is [string]) { $fqid } else { $null }
				Category = if ($category -is [System.Management.Automation.ErrorCategory]) { $category } else { $null }
				ErrorDetailsMessage = if ($errorDetailsMessage -is [string]) { $errorDetailsMessage } else { $null }
				Exception = if ($exception -is [System.Exception]) { $exception } else { $null }
				TargetObject = if ($targetObject -is [System.CodeDom.Compiler.CompilerError]) { $targetObject } else { $null }
			}
		}
		$wrapped = Get-BootstrapProperty $candidate 'ErrorRecord'
		if ($wrapped -is [System.Management.Automation.ErrorRecord]) {
			$candidate = $wrapped
			continue
		}
		if ($candidate -is [System.Exception]) {
			return [pscustomobject]@{ FullyQualifiedErrorId = $null; Category = $null; ErrorDetailsMessage = $null; Exception = $candidate }
		}
		$candidate = $wrapped
	}
	return $null
}

function Get-BootstrapCompilerErrorCode([object]$target) {
	try {
		if ($target -isnot [System.CodeDom.Compiler.CompilerError]) { return $null }
		$errorNumber = Get-BootstrapProperty $target 'ErrorNumber'
		if ($errorNumber -is [string] -and $errorNumber -cmatch '\ACS[0-9]{4}\z') { return $errorNumber }
	} catch {}
	return $null
}

function Get-BootstrapAddTypeReason([object]$record) {
	$fqid = Get-BootstrapProperty $record 'FullyQualifiedErrorId'
	if ($fqid -isnot [string]) { return 'unknown' }
	$id = [regex]::Match($fqid, '^[^,]+').Value
	switch ($id) {
		'SOURCE_CODE_ERROR' { return 'source-code-error' }
		'TYPE_ALREADY_EXISTS' { return 'type-already-exists' }
		default { return 'unknown' }
	}
}

function Get-BootstrapDiagnosticCategory([object]$record) {
	$recordCategory = Get-BootstrapProperty $record 'Category'
	switch ($recordCategory) {
		([System.Management.Automation.ErrorCategory]::InvalidArgument) { return 'argument' }
		([System.Management.Automation.ErrorCategory]::InvalidOperation) { return 'invalid-operation' }
		([System.Management.Automation.ErrorCategory]::NotImplemented) { return 'not-supported' }
		([System.Management.Automation.ErrorCategory]::SecurityError) { return 'security' }
	}
	$exception = Get-BootstrapProperty $record 'Exception'
	for ($depth = 0; $depth -lt 8 -and $exception -is [System.Exception]; $depth++) {
		if ($exception -is [System.ArgumentException]) { return 'argument' }
		if ($exception -is [System.InvalidOperationException]) { return 'invalid-operation' }
		if ($exception -is [System.NotSupportedException]) { return 'not-supported' }
		if ($exception -is [System.Security.SecurityException] -or $exception -is [System.UnauthorizedAccessException]) { return 'security' }
		if ($exception -is [System.IO.FileLoadException] -or $exception -is [System.IO.FileNotFoundException] -or $exception -is [System.BadImageFormatException]) { return 'assembly-load' }
		if ($exception -is [System.TypeLoadException] -or $exception -is [System.Reflection.ReflectionTypeLoadException]) { return 'type-load' }
		$next = Get-BootstrapProperty $exception 'InnerException'
		$exception = if ($next -is [System.Exception]) { $next } else { $null }
	}
	return 'other'
}

function Write-BootstrapDiagnosticFallback {
	try {
		[Console]::Error.WriteLine(([pscustomobject]@{ kind = 'windows-session-bootstrap-diagnostic'; category = 'other'; compilerCodes = @(); reason = 'unknown'; languageMode = 'unknown' } | ConvertTo-Json -Compress))
	} catch {}
}

function Write-BootstrapDiagnostic([object[]]$records) {
	try {
		$category = 'other'
		$reason = 'unknown'
		$compilerCodes = [System.Collections.Generic.List[string]]::new()
		$seenCompilerCodes = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
		$text = [System.Text.StringBuilder]::new()
		$captured = @()
		foreach ($entry in $records) {
			if ($captured.Count -ge 8) { break }
			$record = ConvertTo-BootstrapDiagnosticRecord $entry
			if ($null -ne $record) { $captured += $record }
		}
		foreach ($record in $captured) {
			if ($category -eq 'other') { $category = Get-BootstrapDiagnosticCategory $record }
			if ($reason -eq 'unknown') { $reason = Get-BootstrapAddTypeReason $record }
			Add-BootstrapDiagnosticText $text (Get-BootstrapProperty $record 'FullyQualifiedErrorId')
			Add-BootstrapDiagnosticText $text (Get-BootstrapProperty $record 'ErrorDetailsMessage')
		}
		foreach ($record in $captured) {
			$code = Get-BootstrapCompilerErrorCode (Get-BootstrapProperty $record 'TargetObject')
			if ($code -is [string] -and $seenCompilerCodes.Add($code) -and $compilerCodes.Count -lt 8) { $compilerCodes.Add($code) }
		}
		foreach ($record in $captured) {
			$exception = Get-BootstrapProperty $record 'Exception'
			for ($depth = 0; $depth -lt 8 -and $exception -is [System.Exception]; $depth++) {
				$message = Get-BootstrapProperty $exception 'Message'
				if ($message -is [string]) { Add-BootstrapDiagnosticText $text $message }
				$next = Get-BootstrapProperty $exception 'InnerException'
				$exception = if ($next -is [System.Exception]) { $next } else { $null }
			}
		}
		foreach ($match in [regex]::Matches($text.ToString(), 'CS[0-9]{4}')) {
			$code = $match.Value
			if ($seenCompilerCodes.Add($code) -and $compilerCodes.Count -lt 8) { $compilerCodes.Add($code) }
		}
		if ($compilerCodes.Count -gt 0) {
			$category = 'compiler'
			if ($reason -eq 'unknown') { $reason = 'compiler-errors' }
		}
		$languageMode = Get-BootstrapLanguageMode
		[Console]::Error.WriteLine(([pscustomobject]@{ kind = 'windows-session-bootstrap-diagnostic'; category = $category; compilerCodes = @($compilerCodes.ToArray()); reason = $reason; languageMode = $languageMode } | ConvertTo-Json -Compress))
	} catch { Write-BootstrapDiagnosticFallback }
}

$addTypeErrors = @()
try {
	Add-Type -ErrorAction Stop -ErrorVariable +addTypeErrors -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;

public sealed class BootstrapFailure : Exception {
  public readonly string Code;
  public BootstrapFailure(string code) { Code = code; }
}

public static class WindowsSessionBootstrap {
  [StructLayout(LayoutKind.Sequential)] struct UNICODE_STRING { public ushort Length, MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)] struct OBJECT_ATTRIBUTES { public uint Length; public IntPtr RootDirectory, ObjectName; public uint Attributes; public IntPtr SecurityDescriptor, SecurityQualityOfService; }
  [StructLayout(LayoutKind.Sequential)] struct IO_STATUS_BLOCK { public IntPtr Status; public UIntPtr Information; }
  [StructLayout(LayoutKind.Sequential)] struct BY_HANDLE_FILE_INFORMATION {
    public uint FileAttributes; public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
    public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
  }
  // FILE_ID_BOTH_DIR_INFORMATION layout from Microsoft's ntifs.h / winternl documentation.
  [StructLayout(LayoutKind.Sequential)] struct FILE_ID_BOTH_DIR_HEADER {
    public uint NextEntryOffset, FileIndex; public long CreationTime, LastAccessTime, LastWriteTime, ChangeTime, EndOfFile, AllocationSize;
    public uint FileAttributes, FileNameLength, EaSize; public byte ShortNameLength;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst=24)] public byte[] ShortName; public long FileId; public ushort FileName;
  }
  struct OpenResult { public IntPtr Handle; public uint Status; public OpenResult(IntPtr handle, uint status) { Handle = handle; Status = status; } }

  const uint OBJ_CASE_INSENSITIVE = 0x40, OBJ_DONT_REPARSE = 0x1000;
  const uint FILE_LIST_DIRECTORY = 1, FILE_TRAVERSE = 0x20, FILE_READ_ATTRIBUTES = 0x80, READ_CONTROL = 0x00020000, SYNCHRONIZE = 0x00100000;
  const uint FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2;
  const uint FILE_OPEN = 1, FILE_CREATE = 2, FILE_DIRECTORY_FILE = 1, FILE_SYNCHRONOUS_IO_NONALERT = 0x20, FILE_OPEN_REPARSE_POINT = 0x00200000;
  const uint FILE_ATTRIBUTE_DIRECTORY = 0x10, FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
  const uint SE_FILE_OBJECT = 1, OWNER_SECURITY_INFORMATION = 1, DACL_SECURITY_INFORMATION = 4;
  const uint STATUS_OBJECT_NAME_NOT_FOUND = 0xC0000034, STATUS_OBJECT_NAME_COLLISION = 0xC0000035;
  const int FileIdBothDirectoryInformation = 37;
  static readonly object Gate = new object();
  static readonly List<IntPtr> Handles = new List<IntPtr>();
  static IntPtr Presence = IntPtr.Zero;

  [DllImport("ntdll.dll", CallingConvention=CallingConvention.Winapi)] static extern uint NtCreateFile(out IntPtr fileHandle, uint desiredAccess, ref OBJECT_ATTRIBUTES objectAttributes, out IO_STATUS_BLOCK ioStatusBlock, IntPtr allocationSize, uint fileAttributes, uint shareAccess, uint createDisposition, uint createOptions, IntPtr eaBuffer, uint eaLength);
  [DllImport("ntdll.dll", CallingConvention=CallingConvention.Winapi)] static extern uint NtQueryDirectoryFile(IntPtr fileHandle, IntPtr eventHandle, IntPtr apcRoutine, IntPtr apcContext, out IO_STATUS_BLOCK ioStatusBlock, IntPtr fileInformation, uint length, int fileInformationClass, bool returnSingleEntry, IntPtr fileName, bool restartScan);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr handle, out BY_HANDLE_FILE_INFORMATION info);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetVolumeNameForVolumeMountPoint(string rootPathName, System.Text.StringBuilder volumeName, uint cchBufferLength);
  [DllImport("advapi32.dll", SetLastError=true)] static extern uint GetSecurityInfo(IntPtr handle, uint objectType, uint securityInformation, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);

  static void Fail(string code) { throw new BootstrapFailure(code); }
  static void Close(IntPtr handle) { if (handle != IntPtr.Zero) CloseHandle(handle); }
  static IntPtr Unicode(string value, out IntPtr chars) {
    chars = Marshal.StringToHGlobalUni(value); var text = new UNICODE_STRING();
    text.Length = checked((ushort)(value.Length * 2)); text.MaximumLength = text.Length; text.Buffer = chars;
    IntPtr valuePointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UNICODE_STRING))); Marshal.StructureToPtr(text, valuePointer, false); return valuePointer;
  }
  static OpenResult Open(IntPtr root, string name, bool privateDirectory, bool create, byte[] descriptor) {
    IntPtr chars = IntPtr.Zero, unicode = IntPtr.Zero, security = IntPtr.Zero, handle = IntPtr.Zero;
    try {
      unicode = Unicode(name, out chars); var attributes = new OBJECT_ATTRIBUTES();
      attributes.Length = (uint)Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES)); attributes.RootDirectory = root; attributes.ObjectName = unicode;
      attributes.Attributes = OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE;
      if (create) { if (descriptor == null || descriptor.Length == 0) Fail("unavailable"); security = Marshal.AllocHGlobal(descriptor.Length); Marshal.Copy(descriptor, 0, security, descriptor.Length); attributes.SecurityDescriptor = security; }
      uint access = SYNCHRONIZE | FILE_TRAVERSE | FILE_READ_ATTRIBUTES;
      if (privateDirectory) access |= FILE_LIST_DIRECTORY | READ_CONTROL;
      IO_STATUS_BLOCK statusBlock; uint status = NtCreateFile(out handle, access, ref attributes, out statusBlock, IntPtr.Zero, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, create ? FILE_CREATE : FILE_OPEN, FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT, IntPtr.Zero, 0);
      if (status != 0) { Close(handle); return new OpenResult(IntPtr.Zero, status); }
      return new OpenResult(handle, status);
    } finally { if (security != IntPtr.Zero) Marshal.FreeHGlobal(security); if (unicode != IntPtr.Zero) Marshal.FreeHGlobal(unicode); if (chars != IntPtr.Zero) Marshal.FreeHGlobal(chars); }
  }
  static void AssertDirectory(IntPtr handle) {
    if (handle == IntPtr.Zero) throw new BootstrapFailure("unsafe");
    BY_HANDLE_FILE_INFORMATION info;
    if (!GetFileInformationByHandle(handle, out info)) throw new BootstrapFailure("unsafe");
    if ((info.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != FILE_ATTRIBUTE_DIRECTORY) Fail("unsafe");
  }
  static IntPtr RequireOpen(IntPtr root, string component, bool privateDirectory) {
    OpenResult result = Open(root, component, privateDirectory, false, null);
    if (result.Handle == IntPtr.Zero) Fail(result.Status == STATUS_OBJECT_NAME_NOT_FOUND ? "unavailable" : "unsafe");
    try { AssertDirectory(result.Handle); return result.Handle; } catch { Close(result.Handle); throw; }
  }
  static void AssertOwned(IntPtr handle, string sid) {
    IntPtr owner, group, dacl, sacl, descriptor = IntPtr.Zero;
    uint status = GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, out owner, out group, out dacl, out sacl, out descriptor);
    if (status != 0 || descriptor == IntPtr.Zero) Fail("unsafe");
    try {
      uint length = GetSecurityDescriptorLength(descriptor); if (length == 0 || length > 65536) Fail("unsafe");
      byte[] bytes = new byte[length]; Marshal.Copy(descriptor, bytes, 0, (int)length); var raw = new RawSecurityDescriptor(bytes, 0);
      if (raw.Owner == null || raw.Owner.Value != sid || (raw.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0 || raw.DiscretionaryAcl == null || raw.DiscretionaryAcl.Count != 1) Fail("unsafe");
      CommonAce ace = raw.DiscretionaryAcl[0] as CommonAce;
      if (ace == null || ace.IsCallback || ace.AceFlags != AceFlags.None || ace.AceQualifier != AceQualifier.AccessAllowed || ace.IsInherited || ace.SecurityIdentifier == null || ace.SecurityIdentifier.Value != sid || ace.AccessMask != 0x1F01FF) Fail("unsafe");
    } finally { LocalFree(descriptor); }
  }
  static IntPtr CreateOrOpenOwned(IntPtr parent, string name, byte[] descriptor, string sid) {
    OpenResult created = Open(parent, name, true, true, descriptor); IntPtr handle = created.Handle;
    if (handle == IntPtr.Zero) {
      if (created.Status != STATUS_OBJECT_NAME_COLLISION) Fail(created.Status == STATUS_OBJECT_NAME_NOT_FOUND ? "unavailable" : "unsafe");
      handle = RequireOpen(parent, name, true);
    }
    try { AssertDirectory(handle); AssertOwned(handle, sid); return handle; } catch { Close(handle); throw; }
  }
  static string[] Components(string agentHome) {
    if (String.IsNullOrEmpty(agentHome) || agentHome.Length > 4096 || !Regex.IsMatch(agentHome, @"^[A-Za-z]:\\(?:[^\\]+\\)*[^\\]+$") /* "^[A-Za-z]:\\\\(?:[^\\\\]+\\\\)*[^\\\\]+$")) */ ) Fail("invalid");
    if (agentHome.StartsWith("\\\\") || agentHome.IndexOf(':', 2) >= 0 || agentHome.IndexOf("\0") >= 0) Fail("invalid");
    string[] parts = agentHome.Substring(3).Split('\\'); if (parts.Length == 0) Fail("invalid");
    foreach (string part in parts) if (part.Length == 0 || part == "." || part == ".." || part.IndexOf(':') >= 0 || part.IndexOfAny(new char[] {'/', '\0'}) >= 0) Fail("invalid");
    return parts;
  }
  static string VolumePath(string agentHome) {
    var name = new System.Text.StringBuilder(128); string mount = agentHome.Substring(0, 3);
    if (!GetVolumeNameForVolumeMountPoint(mount, name, (uint)name.Capacity)) Fail("unavailable");
    string volume = name.ToString(); if (!Regex.IsMatch(volume, @"^\\\\\?\\Volume\{[0-9A-Fa-f-]+\}\\$") /* "^\\\\\\?\\\\Volume\\{[0-9A-Fa-f-]+\\}\\\\$")) */ ) Fail("unsafe");
    return @"\??\" + volume.Substring(4);
  }
  // The helper keeps this capability local. Publication/list RPCs are intentionally absent.
  static string[] EnumeratePinned(IntPtr directory) {
    const int MaxEntries = 64, MaxBytes = 8192; const uint STATUS_NO_MORE_FILES = 0x80000006;
        int Header = Marshal.OffsetOf(typeof(FILE_ID_BOTH_DIR_HEADER), "FileName").ToInt32(); if (Header <= 0 || Header >= MaxBytes) Fail("unavailable"); var names = new List<string>(); IntPtr buffer = Marshal.AllocHGlobal(MaxBytes);
    try {
      bool restart = true;
      for (;;) {
        IO_STATUS_BLOCK io; uint status = NtQueryDirectoryFile(directory, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out io, buffer, MaxBytes, FileIdBothDirectoryInformation, false, IntPtr.Zero, restart); restart = false;
        if (status == STATUS_NO_MORE_FILES) return names.ToArray();
            if (status != 0) Fail("unsafe");
            ulong available64 = io.Information.ToUInt64(); if (available64 == 0 || available64 > MaxBytes) Fail("unsafe"); int available = (int)available64;
        int offset = 0;
        while (offset < available) {
              if (available - offset < Header) Fail("unsafe");
          int next = Marshal.ReadInt32(buffer, offset), nameLength = Marshal.ReadInt32(buffer, offset + 60);
              int recordLength = next == 0 ? available - offset : next;
          if (recordLength < Header || recordLength > available - offset || (next != 0 && (next & 7) != 0) || nameLength < 0 || (nameLength & 1) != 0 || nameLength > recordLength - Header) Fail("unsafe");
          string name = Marshal.PtrToStringUni(IntPtr.Add(buffer, offset + Header), nameLength / 2);
          if (String.IsNullOrEmpty(name) || name.IndexOfAny(new char[] {'\\', '/', ':', '\0'}) >= 0) Fail("unsafe");
          if (name != "." && name != "..") { if (names.Count >= MaxEntries) Fail("busy"); names.Add(name); }
              if (next == 0) { offset = available; } else { offset += next; }
        }
      }
      return names.ToArray();
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  public static int EnumeratePresence() { lock (Gate) { if (Presence == IntPtr.Zero) Fail("unavailable"); return EnumeratePinned(Presence).Length; } }
      public static void Initialize(string agentHome, byte[] descriptor, string sid) {
    lock (Gate) {
      CloseAll();
      try {
        string[] components = Components(agentHome); IntPtr volume = RequireOpen(IntPtr.Zero, VolumePath(agentHome), false); Handles.Add(volume); IntPtr parent = volume;
        foreach (string component in components) { IntPtr child = RequireOpen(parent, component, false); Handles.Add(child); parent = child; }
        // gentle-agents is a shared routing parent created by the host lifecycle; never repair or create it here.
        IntPtr routing = RequireOpen(parent, "gentle-agents", false); Handles.Add(routing);
        IntPtr transport = CreateOrOpenOwned(routing, "transport", descriptor, sid); Handles.Add(transport);
        Presence = CreateOrOpenOwned(transport, "presence", descriptor, sid); Handles.Add(Presence);
      } catch { CloseAll(); throw; }
    }
  }
  public static void CloseAll() { lock (Gate) { for (int index = Handles.Count - 1; index >= 0; index--) Close(Handles[index]); Handles.Clear(); Presence = IntPtr.Zero; } }
}
'@
	$nativeReady = $true
} catch {
	$nativeReady = $false
	Write-BootstrapDiagnostic (@($addTypeErrors) + @($_))
}

function Write-Reply([string]$requestId, [bool]$ok, $result, [string]$error) {
	if ($ok) { [Console]::Out.WriteLine((@{ requestId = $requestId; ok = $true; result = $result } | ConvertTo-Json -Compress)) }
	else { [Console]::Out.WriteLine((@{ requestId = $requestId; ok = $false; error = $error } | ConvertTo-Json -Compress)) }
}
function Is-RequestId([object]$value) { return $value -is [string] -and $value -match '^[A-Za-z0-9-]{1,128}$' }
function Is-ExactRequest($request, [string[]]$names) {
	$actual = @($request.PSObject.Properties | ForEach-Object { $_.Name })
	return $actual.Count -eq $names.Count -and @($actual | Where-Object { $_ -notin $names }).Count -eq 0
}
function Read-ControlLine {
	$buffer = [Text.StringBuilder]::new()
	$bytes = 0
	$overflow = $false
	$next = -1
	while (($next = [Console]::In.Read()) -ne -1) {
		if ($next -eq 10) { break }
		if ($next -eq 13) { continue }
		$char = [char]$next
		$bytes += [Text.Encoding]::UTF8.GetByteCount([string]$char)
		if ($bytes -gt $maxControlBytes) { $overflow = $true; continue }
		[void]$buffer.Append($char)
	}
	if ($next -eq -1 -and $buffer.Length -eq 0 -and -not $overflow) { return $null }
	if ($overflow) { return '' }
	return $buffer.ToString()
}

try {
	:requests while (($line = Read-ControlLine) -ne $null) {
		if ([Text.Encoding]::UTF8.GetByteCount($line) -gt $maxControlBytes) { break }
		$request = $null
		try { $request = $line | ConvertFrom-Json -ErrorAction Stop } catch { break }
		if ($null -eq $request -or -not (Is-RequestId $request.requestId) -or $request.operation -isnot [string]) { break }
		$id = $request.requestId
		switch ($request.operation) {
			'start' {
				if (-not (Is-ExactRequest $request @('requestId', 'operation'))) { Write-Reply $id $false $null 'invalid'; break requests }
				if (-not $nativeReady) { Write-Reply $id $false $null 'unavailable'; break }
				Write-Reply $id $true @{ state = 'partial' } $null; break
			}
			'initialize' {
				if (-not (Is-ExactRequest $request @('requestId', 'operation', 'agentHome')) -or $request.agentHome -isnot [string]) { Write-Reply $id $false $null 'invalid'; break requests }
				if (-not $nativeReady) { Write-Reply $id $false $null 'unavailable'; break }
				try {
					$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
					$security = [Security.AccessControl.DirectorySecurity]::new(); $security.SetAccessRuleProtection($true, $false); $security.SetOwner($sid)
					$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
					[WindowsSessionBootstrap]::Initialize($request.agentHome, $security.GetSecurityDescriptorBinaryForm(), $sid.Value)
					Write-Reply $id $true @{ state = 'initialized'; bootstrap = 'complete' } $null
				} catch [BootstrapFailure] { Write-Reply $id $false $null $_.Exception.Code } catch { Write-Reply $id $false $null 'unavailable' }
				break
			}
			'enumerate' { if (-not (Is-ExactRequest $request @('requestId', 'operation'))) { Write-Reply $id $false $null 'invalid'; break requests }; if (-not $nativeReady) { Write-Reply $id $false $null 'unavailable'; break }; try { Write-Reply $id $true @{ state = 'initialized'; bootstrap = 'complete'; entries = [WindowsSessionBootstrap]::EnumeratePresence() } $null } catch [BootstrapFailure] { Write-Reply $id $false $null $_.Exception.Code } catch { Write-Reply $id $false $null 'unavailable' }; break }
			'shutdown' { if (-not (Is-ExactRequest $request @('requestId', 'operation'))) { Write-Reply $id $false $null 'invalid'; break requests }; if ($nativeReady) { [WindowsSessionBootstrap]::CloseAll() }; Write-Reply $id $true @{ state = 'partial' } $null; break }
			default { Write-Reply $id $false $null 'invalid'; break }
		}
	}
} finally { if ($nativeReady) { [WindowsSessionBootstrap]::CloseAll() } }
