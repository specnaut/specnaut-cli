#!/usr/bin/env pwsh
# The base branch of this repository. PowerShell twin of base-branch.sh, which states
# the rule: what origin/HEAD points at, else the configured init.defaultBranch, and
# neither is exit 3, unknown. A name git would read as an option, or one with `..`
# (a range), is exit 3 too, because every caller hands it to git as an argument.

function Write-BaseBranch([string]$Name) {
    if ($Name -cmatch '\A[A-Za-z0-9][A-Za-z0-9._/-]*\z' -and -not $Name.Contains('..')) {
        Write-Output $Name
        exit 0
    }
    [Console]::Error.WriteLine("base-branch: '$Name' is not a branch name this script hands to git - set origin/HEAD to the real base: git remote set-head origin --auto")
    exit 3
}

$ref = & git --no-pager -c core.fsmonitor=false symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null
if ($LASTEXITCODE -eq 0 -and $ref) {
    Write-BaseBranch ($ref -replace '\Aorigin/', '')
}
$name = & git --no-pager -c core.fsmonitor=false config --get init.defaultBranch 2>$null
if ($LASTEXITCODE -eq 0 -and $name) {
    Write-BaseBranch $name
}
[Console]::Error.WriteLine('base-branch: unknown - no origin/HEAD and no init.defaultBranch. Pass the base explicitly, or run: git remote set-head origin --auto')
exit 3
