# shellcheck shell=bash
# Sourced by run-gate.sh and _gate_sandbox.sh: the one home of how a list of
# `.specnaut/gates.yml` is read. run-gate.sh is still the only way in from outside
# (`--parse-gates`, `--parse-toolchain`): a second parser is a second definition of
# what a gate is, and the two drift.
#
# The format is narrow on purpose (see gates.yml): a top-level key (`<tier>_gate:`,
# `toolchain:`), then `  - ` items until the next top-level key. Quotes around an item
# are optional and are stripped as a matched pair only, so a command containing a
# quote is not silently mangled. src/domain/gates_toolchain.ts reads `toolchain:` the
# same way; a test runs both.

# parse_list <key> <file> - the items under the top-level <key>, one a line.
parse_list() {
  awk -v key="$1" '
    # A file saved with Windows line ends is read as if it had none: every
    # carriage return goes first, or a blank line would read as a key.
    { gsub(/\r/, "") }
    # A top-level key is a line starting in column 1 with a non-space,
    # non-comment character. Reaching one ends the section we are in.
    /^[^ \t#]/ {
      if (index($0, key) == 1) { inside = 1; next }
      inside = 0
    }
    !inside { next }
    /^[ \t]*#/ { next }
    /^[ \t]*$/ { next }
    /^[ \t]*-[ \t]*/ {
      line = $0
      sub(/^[ \t]*-[ \t]*/, "", line)
      sub(/[ \t]+$/, "", line)
      if (line == "") next
      first = substr(line, 1, 1); last = substr(line, length(line), 1)
      if ((first == "\"" && last == "\"") || (first == "'\''" && last == "'\''")) {
        if (length(line) >= 2) line = substr(line, 2, length(line) - 2)
      }
      print line
    }
  ' < "$2"
}
