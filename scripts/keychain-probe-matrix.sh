#!/usr/bin/env bash
# The keychain probe matrix (cli#662, US5): both probes, both directions, one
# per-run canary that is never printed. Run by go-dry-run.yml on Linux (under
# dbus-run-session with gnome-keyring) and Windows, and by the maintainer on
# macOS (see .specnaut/specs/035-go-parity-spike/macos-session.md — the
# cross-direction reads there raise Keychain dialogs, which an agent never
# answers).
#
# Usage: scripts/keychain-probe-matrix.sh <go-probe> <ts-probe>
# Prints only verdicts: match/mismatch + lengths, ok/miss/unavailable.
set -uo pipefail

go_probe=${1:?usage: keychain-probe-matrix.sh <go-probe> <ts-probe>}
ts_probe=${2:?usage: keychain-probe-matrix.sh <go-probe> <ts-probe>}
svc=$("$go_probe" service) || exit 1 # the Go driver owns the name
canary=$(openssl rand -hex 24) || exit 1

# Every account either probe writes, removed on every exit path: a normal end,
# a failed step, and a roundtrip killed between its write and its own remove.
# bash runs the EXIT trap when SIGTERM ends it too (keychain_probe_test.ts
# kills it mid-roundtrip). Removing an item that was never written is a miss,
# which both probes treat as success.
cleanup() {
  for account in go-rt go-wrote; do
    "$go_probe" remove --account "$account" >/dev/null ||
      echo "warning: probe item $account not removed" >&2
  done
  for account in ts-rt ts-wrote; do
    "$ts_probe" remove --service "$svc" --account "$account" >/dev/null ||
      echo "warning: probe item $account not removed" >&2
  done
}
trap cleanup EXIT

step() { # step <label> <canary-or-empty> <command…>
  local label=$1 feed=$2
  shift 2
  echo "## $label"
  if [ -n "$feed" ]; then printf '%s' "$canary" | "$@"; else "$@" </dev/null; fi
  echo "exit: $?"
}

"$go_probe" version
step "go: reachable" "" "$go_probe" reachable
step "ts: reachable" "" "$ts_probe" reachable --service "$svc"
step "go: set/get/remove" y "$go_probe" roundtrip --account go-rt
step "ts: set/get/remove" y "$ts_probe" roundtrip --service "$svc" --account ts-rt
step "go writes" y "$go_probe" write --account go-wrote
step "ts reads the go-written item" y "$ts_probe" read --service "$svc" --account go-wrote
step "ts writes" y "$ts_probe" write --service "$svc" --account ts-wrote
step "go reads the ts-written item" y "$go_probe" read --account ts-wrote
