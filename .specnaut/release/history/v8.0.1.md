**Upgrade now if you use the GitHub backlog.** A name set on a GitHub Project field could run a
command on the machine of whoever next ran `/task add` or `/task groom`, because the backlog scripts
evaluated it. Every value is now quoted. Update the binary, then run `specnaut upgrade` in each
project, since the scripts reach a project only through it.

The Cloud backlog scripts also drop format characters from what they print, keep one `->` per row in
`reconcile.sh`, and name a `jq` too old to run them instead of blaming the server. `cloud login` no
longer asks you to enter a code the page already holds.
