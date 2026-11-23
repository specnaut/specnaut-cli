# Shows that the oracle's path resolution (writes.ps1, Test-EnvironmentPath) takes only an unknown
# drive or provider as naming no item, and stops on any other failure: a stand-in resolver throws
# each, and the result of each is printed as JSON. Runs nothing a corpus holds.
Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot writes.ps1)

function Get-Outcome($exception) {
    $script:PathIntrinsics = [pscustomobject]@{ Exception = $exception }
    $script:PathIntrinsics | Add-Member ScriptMethod GetUnresolvedProviderPathFromPSPath { throw $this.Exception }
    try { return [string](Test-EnvironmentPath 'x:y') }
    catch { return 'stopped' }
}

$outcome = [ordered]@{
    drive = Get-Outcome ([System.Management.Automation.DriveNotFoundException]::new('probe'))
    provider = Get-Outcome ([System.Management.Automation.ProviderNotFoundException]::new('probe'))
    other = Get-Outcome ([InvalidOperationException]::new('probe'))
}
ConvertTo-Json -InputObject $outcome -Compress
