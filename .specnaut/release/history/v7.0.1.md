**The OpenCode plugin installs.** The documented `opencode.json` line never installed anything:
OpenCode installs plugins with npm's installer, which needs a `package.json` this repository did not
have. It has one now, and the line is pinned to the release tag, so an install gets a released
plugin rather than whatever `main` holds. Copy the line again from the README to pick it up.

**`specnaut upgrade` deletes only what Specnaut wrote.** A file that left the bundle is removed only
from the folders Specnaut writes, such as `.claude/skills/` or `.specnaut/scripts/`, and never
through a symbolic link that leads elsewhere. Anything else the lock names is reported as no longer
tracked and left on disk, `--force` included. A retired file you edited now stays tracked, so every
upgrade reports it until you delete it or pass `--force`, which backs it up first.
