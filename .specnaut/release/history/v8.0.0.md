**Upgrade now if you use Specnaut Cloud from Windows or from CI.** This release closes security gaps
in the Cloud client. On Windows, `specnaut cloud login` could run a command carried in the URL
returned by a Cloud server you had accepted. A `SPECNAUT_CLOUD_TOKEN` could be sent to a deployment
a repository chose through its `api_url`. The Cloud backlog scripts put the bearer token on `curl`'s
command line, read as success an answer that was only a redirect, and printed control characters
from task text. All of these are fixed; update the binary, then run `specnaut upgrade` in each
project on the Cloud backend, since the scripts reach a project only through it.

**Why this is a major: two inputs are now refused.** A headless token goes only to Specnaut Cloud or
to the deployment named by `SPECNAUT_CLOUD_API_URL`, so CI on another deployment sets both
variables. No Cloud request follows a redirect, so an `api_url` that redirects must be replaced by
the address it lands on. `UPGRADING.md` has the details.

**`/task resume` rebuilds where a chain stopped from git, then re-enters it.** Grooming and next
also audit Ready and In progress from git evidence.
