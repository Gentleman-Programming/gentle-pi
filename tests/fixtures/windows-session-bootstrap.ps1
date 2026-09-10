# Test-only ACL/reparse inspector. It never emits SIDs or descriptor bytes.
param(
	[Parameter(Mandatory = $true)][ValidateSet('capture', 'equals', 'measure', 'add-extra-ace', 'junction', 'rename')][string]$Mode,
	[Parameter(Mandatory = $true)][string]$Path,
	[string]$BaselinePath,
	[string]$Target
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Write-Result([hashtable]$result) { [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress)) }
try {
	if ($Mode -eq 'capture') {
		if ([string]::IsNullOrEmpty($BaselinePath)) { throw 'baseline-required' }
		$acl = Get-Acl -LiteralPath $Path
		[IO.File]::WriteAllBytes($BaselinePath, $acl.GetSecurityDescriptorBinaryForm())
		Write-Result @{ ok = $true; equal = $true }
		exit 0
	}
	if ($Mode -eq 'equals') {
		if ([string]::IsNullOrEmpty($BaselinePath) -or -not [IO.File]::Exists($BaselinePath)) { throw 'baseline-required' }
		$actual = (Get-Acl -LiteralPath $Path).GetSecurityDescriptorBinaryForm()
		$expected = [IO.File]::ReadAllBytes($BaselinePath)
		Write-Result @{ ok = $true; equal = ([Convert]::ToBase64String($actual) -ceq [Convert]::ToBase64String($expected)) }
		exit 0
	}
	if ($Mode -eq 'add-extra-ace') {
		$acl = Get-Acl -LiteralPath $Path
		$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new('Authenticated Users', [Security.AccessControl.FileSystemRights]::ReadAndExecute, [Security.AccessControl.AccessControlType]::Allow))
		Set-Acl -LiteralPath $Path -AclObject $acl
		Write-Result @{ ok = $true; changed = $true }
		exit 0
	}
	if ($Mode -eq 'rename') {
		if ([string]::IsNullOrEmpty($Target)) { throw 'target-required' }
		[IO.Directory]::Move($Path, $Target)
		Write-Result @{ ok = $true; renamed = $true }
		exit 0
	}
	if ($Mode -eq 'junction') {
		if ([string]::IsNullOrEmpty($Target)) { throw 'target-required' }
		New-Item -ItemType Junction -Path $Path -Target $Target | Out-Null
		Write-Result @{ ok = $true; reparse = $true }
		exit 0
	}
	$item = Get-Item -LiteralPath $Path -Force
	$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
	$acl = Get-Acl -LiteralPath $Path
	$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
	$ownerCurrent = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid
	$private = $ownerCurrent -and $acl.AreAccessRulesProtected -and $rules.Count -eq 1 -and -not $rules[0].IsInherited -and $rules[0].IdentityReference.Value -eq $sid -and $rules[0].AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and [int64]$rules[0].FileSystemRights -eq [int64][Security.AccessControl.FileSystemRights]::FullControl
	Write-Result @{ ok = $true; directory = $item.PSIsContainer; reparse = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0); ownerCurrent = $ownerCurrent; privateBoundary = $private }
} catch { Write-Result @{ ok = $false }; exit 1 }
