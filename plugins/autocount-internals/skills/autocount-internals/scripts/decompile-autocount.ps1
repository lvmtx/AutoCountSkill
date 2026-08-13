<#
.SYNOPSIS
  Reproduces a local decompiled source tree for AutoCount products installed on THIS machine.

.DESCRIPTION
  Run this once per machine, against your own locally-installed, licensed copy of AutoCount.
  It never copies decompiled code between machines - every user regenerates their own copy
  from their own install. That's the point: the autocount-internals skill needs a decompiled
  tree to search, but nobody should be handed AutoCount's reverse-engineered source without
  having their own install to back it.

  For each AutoCount product folder found under "Program Files\AutoCount" and
  "Program Files (x86)\AutoCount", every top-level .exe/.dll whose name starts with
  "AutoCount" is decompiled with ilspycmd. That filter matters: a product folder like
  Accounting's typically has ~35 AutoCount-authored DLLs sitting next to ~135 third-party
  ones (DevExpress, CefSharp, gRPC, EF Core...) that together are hundreds of MB on disk -
  several times that once decompiled to C#. Nobody's going to read DevExpress's source to
  answer an AutoCount question, so skip it; use -IncludeVendor if you genuinely need it.

  Modern .NET apps are often published as a single-file bundle (a native launcher with the
  managed assembly appended) - ilspycmd can't read those directly, so this script detects
  that case and uses sfextract to pull the real managed DLL out first, then decompiles that.
  Genuinely native DLLs (vcruntime, WPF native shims, SNI, etc.) get skipped; there's no C#
  to recover from those.

.PARAMETER OutputRoot
  Where the decompiled tree gets written. Defaults to a per-user AppData folder so this works
  the same for every teammate without editing paths.

.PARAMETER ProductPaths
  Explicit list of install directories to decompile, if you don't want auto-detection
  (e.g. AutoCount installed somewhere non-standard).

.PARAMETER NamePattern
  Wildcard filter on assembly (file) name, applied before deciding what to decompile.
  Defaults to "AutoCount*" - AutoCount's own code only. Widen it (e.g. "*") to also pull in
  a specific vendor library or your own company's SDK if one is bundled alongside AutoCount.

.PARAMETER IncludeVendor
  Shorthand for -NamePattern "*" - decompile everything, including third-party dependencies.
  Expect this to take much longer and use much more disk space (low GB range, not tens of MB).

.PARAMETER Force
  Re-decompile products even if output already exists for them.

.EXAMPLE
  .\decompile-autocount.ps1
  Auto-detects installed AutoCount products and decompiles their AutoCount-authored DLLs.
#>

param(
    [string]$OutputRoot = "$env:LOCALAPPDATA\AutoCountInternals\decompiled",
    [string[]]$ProductPaths,
    [string]$NamePattern = "AutoCount*",
    [switch]$IncludeVendor,
    [switch]$Force
)

if ($IncludeVendor) { $NamePattern = "*" }

# "Continue" (not "Stop"): native tools (ilspycmd/sfextract) writing to stderr get wrapped by
# PowerShell into non-terminating ErrorRecords when merged via 2>&1 below - under "Stop" that
# aborts the whole script on the very first expected decompile failure. Tool-install failures
# still hard-stop via explicit `throw` in Ensure-DotnetTool.
$ErrorActionPreference = "Continue"

function Ensure-DotnetTool {
    param([string]$ToolName, [string]$PinnedVersion)
    $installed = dotnet tool list -g 2>$null | Select-String -Pattern "^\s*$ToolName\s"
    if ($installed) { return }
    Write-Host "Installing $ToolName $PinnedVersion (global dotnet tool)..."
    dotnet tool install -g $ToolName --version $PinnedVersion 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install $ToolName. Do you have the .NET SDK installed? (dotnet --version)"
    }
}

# Pinned versions: newer ilspycmd/sfextract releases have been seen to fail to install via
# `dotnet tool install` on some machines (bad DotnetToolSettings.xml in the nuget package at
# time of writing) - these versions are known-good.
Ensure-DotnetTool -ToolName "ilspycmd" -PinnedVersion "9.1.0.7988"
Ensure-DotnetTool -ToolName "sfextract" -PinnedVersion "2.3.0"

$autoDetected = -not $PSBoundParameters.ContainsKey('ProductPaths')

if (-not $ProductPaths) {
    $roots = @("$env:ProgramFiles\AutoCount", "${env:ProgramFiles(x86)}\AutoCount")
    $skipNames = @("InSetup", "AppBuilder*", "Development")
    $ProductPaths = foreach ($root in $roots) {
        if (Test-Path $root) {
            Get-ChildItem $root -Directory | Where-Object {
                $name = $_.Name
                -not ($skipNames | Where-Object { $name -like $_ }) -and
                (Get-ChildItem $_.FullName -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in ".exe", ".dll" } | Select-Object -First 1)
            } | Select-Object -ExpandProperty FullName
        }
    }
}

if (-not $ProductPaths) {
    Write-Warning "No AutoCount product folders found under Program Files. Pass -ProductPaths explicitly, e.g.:`n  .\decompile-autocount.ps1 -ProductPaths 'C:\Program Files\AutoCount\Accounting 2.2'"
    exit 1
}

Write-Host "Products to decompile:"
$ProductPaths | ForEach-Object { Write-Host "  $_" }
Write-Host "Output root: $OutputRoot`n"
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

# AutoCount ships new versions under a new install folder name (e.g. "Accounting 2.2" ->
# "Accounting 2.3"), so an upgrade doesn't corrupt the old decompile - it just orphans it.
# Flag those rather than silently letting them pile up across every future version bump.
# Only meaningful when $ProductPaths came from auto-detection - if the caller passed
# -ProductPaths explicitly (e.g. to redo just one product), it's a deliberate subset, not
# "everything installed", so anything else on disk isn't actually orphaned.
if ($autoDetected) {
    $currentNames = $ProductPaths | ForEach-Object { Split-Path $_ -Leaf }
    $orphaned = Get-ChildItem $OutputRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin $currentNames } |
        Select-Object -ExpandProperty Name
    if ($orphaned) {
        Write-Host "Note: found decompiled output for products no longer detected on this machine (likely an old AutoCount version): $($orphaned -join ', ')"
        Write-Host "      Safe to delete manually: Remove-Item -Recurse '$OutputRoot\<name>'`n"
    }
}

$manifest = @()

foreach ($productPath in $ProductPaths) {
    $productName = Split-Path $productPath -Leaf
    $productOut = Join-Path $OutputRoot $productName

    if ((Test-Path $productOut) -and -not $Force) {
        Write-Host "[$productName] already decompiled, skipping (use -Force to redo). "
        continue
    }

    Write-Host "=== $productName ==="
    $allBinaries = Get-ChildItem $productPath -File | Where-Object { $_.Extension -in ".exe", ".dll" }
    $binaries = $allBinaries | Where-Object { $_.BaseName -like $NamePattern }
    $skippedVendorCount = $allBinaries.Count - $binaries.Count
    if ($skippedVendorCount -gt 0) {
        Write-Host "  ($skippedVendorCount third-party DLLs not matching '$NamePattern' skipped - use -IncludeVendor to decompile them too)"
    }

    foreach ($bin in $binaries) {
        $base = $bin.BaseName
        $dest = Join-Path $productOut $base

        $ilspyOutput = & ilspycmd -p -o "$dest" "$($bin.FullName)" 2>&1
        $ilspyFailed = $LASTEXITCODE -ne 0

        if (-not $ilspyFailed) {
            Write-Host "  [ok]      $($bin.Name)"
            $manifest += [pscustomobject]@{ Product = $productName; Assembly = $bin.Name; Method = "ilspycmd"; Output = $dest }
            continue
        }

        if ($ilspyOutput -match "does not contain (any )?managed metadata") {
            # Likely a single-file bundle (native launcher + appended managed payload) - or truly native.
            Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
            $bundleProbe = & sfextract "$($bin.FullName)" 2>&1
            if ($bundleProbe -match "Is not a \.NET Core") {
                Write-Host "  [skip]    $($bin.Name) (native, no managed code)"
                continue
            }

            $bundleDir = Join-Path $env:TEMP "autocount-bundle-$base"
            Remove-Item $bundleDir -Recurse -Force -ErrorAction SilentlyContinue
            & sfextract "$($bin.FullName)" -o "$bundleDir" 2>&1 | Out-Null

            # Decompile the entry point plus every AutoCount-authored assembly found in the
            # bundle; skip the hundreds of third-party framework DLLs that ship alongside it.
            $entryLine = $bundleProbe | Select-String -Pattern "Entry point:\s*(\S+)"
            $ownAssemblies = Get-ChildItem $bundleDir -Filter "*.dll" -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -like $NamePattern }
            if ($entryLine) {
                $entryDll = Get-ChildItem $bundleDir -Filter $entryLine.Matches[0].Groups[1].Value -ErrorAction SilentlyContinue
                if ($entryDll) { $ownAssemblies = @($entryDll) + @($ownAssemblies | Where-Object { $_.Name -ne $entryDll.Name }) }
            }

            foreach ($asm in $ownAssemblies) {
                $asmDest = Join-Path $dest $asm.BaseName
                & ilspycmd -p -o "$asmDest" "$($asm.FullName)" 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "  [ok]      $($bin.Name) -> $($asm.Name) (extracted from bundle)"
                    $manifest += [pscustomobject]@{ Product = $productName; Assembly = "$($bin.Name) -> $($asm.Name)"; Method = "sfextract+ilspycmd"; Output = $asmDest }
                }
            }
            Remove-Item $bundleDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        else {
            Write-Host "  [failed]  $($bin.Name) - $($ilspyOutput | Select-Object -First 1)"
        }
    }
}

$manifestPath = Join-Path $OutputRoot "manifest.json"
$manifest | ConvertTo-Json -Depth 3 | Out-File $manifestPath -Encoding utf8

# Flat file index across ALL products: "<TypeName>.cs<TAB><path relative to OutputRoot>".
# The point isn't speed of any single grep - it's replacing "guess a module, grep it, get
# nothing, guess another module" with one lookup against a single small file spanning
# every product at once. ilspycmd names each file after its primary type, so a filename
# index gets you straight to the right file for the vast majority of class/interface/enum
# lookups without touching file contents at all.
Write-Host "`nBuilding file index..."
$indexPath = Join-Path $OutputRoot "file-index.txt"
Get-ChildItem $OutputRoot -Recurse -Filter "*.cs" -ErrorAction SilentlyContinue |
    ForEach-Object { "$($_.Name)`t$($_.FullName.Substring($OutputRoot.Length + 1))" } |
    Sort-Object | Set-Content $indexPath -Encoding utf8

Write-Host "Done. Decompiled source: $OutputRoot"
Write-Host "Manifest: $manifestPath"
Write-Host "File index: $indexPath"
