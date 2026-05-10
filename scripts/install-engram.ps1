#Requires -Version 5.1
<#
.SYNOPSIS
	Installs the Engram CLI on Windows.

.DESCRIPTION
	Downloads the latest engram release from
	https://github.com/Gentleman-Programming/engram and installs it to
	%LOCALAPPDATA%\engram\bin. Skips installation if engram is already on PATH.
#>

$ErrorActionPreference = 'Stop'

function Install-Engram {
	$existing = Get-Command engram -ErrorAction SilentlyContinue
	if ($existing) {
		Write-Host "Engram already installed at $($existing.Source)"
		return
	}

	$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }

	Write-Host "Resolving latest engram release..."
	$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/Gentleman-Programming/engram/releases/latest' -UseBasicParsing
	$tag = $release.tag_name
	$version = $tag.TrimStart('v')
	$assetName = "engram_${version}_windows_${arch}.zip"
	$asset = $release.assets | Where-Object { $_.name -eq $assetName }
	if (-not $asset) {
		throw "Asset $assetName not found in release $tag. Check https://github.com/Gentleman-Programming/engram/releases/latest"
	}

	$installDir = Join-Path $env:LOCALAPPDATA 'engram\bin'
	New-Item -ItemType Directory -Force -Path $installDir | Out-Null

	$zipPath = Join-Path $env:TEMP "$assetName"
	$extractDir = Join-Path $env:TEMP "engram_extract_$([Guid]::NewGuid())"

	try {
		Write-Host "Downloading $assetName..."
		Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing
		Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
		$exe = Get-ChildItem -Path $extractDir -Filter 'engram.exe' -Recurse | Select-Object -First 1
		if (-not $exe) { throw "engram.exe not found in $assetName" }
		Copy-Item -Path $exe.FullName -Destination (Join-Path $installDir 'engram.exe') -Force
		Write-Host "Installed engram to $installDir\engram.exe"
	}
	finally {
		if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
		if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
	}

	$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
	if ($userPath -notlike "*$installDir*") {
		Write-Host ""
		Write-Host "Add the install dir to your user PATH so 'engram' is available in new shells:"
		Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$installDir;`$([Environment]::GetEnvironmentVariable('Path','User'))`", 'User')"
	}
}

Install-Engram
