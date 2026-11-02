**The landing hold stays where you left it.** Under `merge: manual`, the base branch and the merge
mode are pinned at each prompt, so neither can be switched mid-turn to let a landing through. On
Claude, a release now asks first, including behind `gh -R` or `sh -c`.

**Scripts behave the same on Windows.** Every value a script reads through `jq` drops a stray
carriage return, and a new `.specnaut/.gitattributes` checks the `.specnaut/` tree out with LF line
ends on every platform, so a CRLF checkout no longer breaks its scripts or makes `upgrade` read
every file as customised.

**Clearer failures.** An unreadable `.specnaut/backlog-config.yml` stops `gate` and `spec` with the
reason instead of a crash, and the local `add.sh` refuses labels it cannot record.

On Codex, trust the hooks again with `/hooks` after upgrading: until you do, none of Specnaut's
hooks run. See [UPGRADING.md](https://github.com/specnaut/specnaut-cli/blob/main/UPGRADING.md).
