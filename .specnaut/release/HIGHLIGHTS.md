**`specnaut cloud login` works on Windows.** The Windows credential store was handed a malformed
record, so every attempt to save the Cloud token failed, and reading an existing entry could crash
the CLI. The record now has the layout Windows expects, and the suite tests a real save, read and
removal on Windows in CI.

**A board too large for one read is no longer reported clean.** The backlog sweep read a fixed
number of cards and judged the board on those alone, so a large board could report no drift over
items it never saw. A read that stops at its limit is now refused instead, and the GitLab scripts
read every page rather than the first hundred issues.
