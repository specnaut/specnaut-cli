# shellcheck shell=bash
# _scope_globs.sh - the one home of which paths count as front-end, test,
# dependency-manifest and infrastructure files. Sourced by _git_untrusted.sh,
# so collect-audit-scope.sh's CATEGORY SIGNALS (scope_classify) and git-read.sh's
# `manifests` form read the same lists. The globs are heuristic: good enough to pick which
# expert seats run.

SCOPE_FRONTEND_GLOBS=('*.tsx' '*.jsx' '*.vue' '*.svelte' '*.css' '*.scss' '*inertia*' '*frontend*'
  '*components*')
SCOPE_TEST_GLOBS=('*_test.*' '*.test.*' '*.spec.*' 'tests/*' '*/tests/*' 'test/*' '*/test/*'
  '*__tests__*')
SCOPE_DEP_GLOBS=('package.json' '*/package.json' 'deno.json' '*/deno.json' 'deno.jsonc' '*.lock'
  'Cargo.toml' 'pyproject.toml' 'go.mod' 'composer.json' 'Gemfile' 'requirements.txt')
SCOPE_INFRA_GLOBS=('Dockerfile' '*/Dockerfile' '*.tf' '*.pulumi.*' 'k8s/*' '*/k8s/*'
  '.github/workflows/*' '*.yaml' '*.yml')

# matches_any <file> <glob...> - 0 if the file matches any of the globs.
matches_any() {
  local f="$1" pat
  shift
  for pat in "$@"; do
    # shellcheck disable=SC2254
    case "$f" in
      $pat) return 0 ;;
    esac
  done
  return 1
}

# scope_classify <newline-separated files> - sets FRONTEND_COUNT, TEST_COUNT,
# DEP_COUNT and INFRA_COUNT in one pass. Each file is tested against every
# category on its own, so one file can count toward several (a front-end test).
# `matches_any ... && COUNT=...` relies on `set -e` not aborting on a failed `&&`
# list: bash semantics, which a switch to /bin/sh would need to rewrite.
scope_classify() {
  local f
  FRONTEND_COUNT=0 TEST_COUNT=0 DEP_COUNT=0 INFRA_COUNT=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    matches_any "$f" "${SCOPE_FRONTEND_GLOBS[@]}" && FRONTEND_COUNT=$((FRONTEND_COUNT + 1))
    matches_any "$f" "${SCOPE_TEST_GLOBS[@]}" && TEST_COUNT=$((TEST_COUNT + 1))
    matches_any "$f" "${SCOPE_DEP_GLOBS[@]}" && DEP_COUNT=$((DEP_COUNT + 1))
    matches_any "$f" "${SCOPE_INFRA_GLOBS[@]}" && INFRA_COUNT=$((INFRA_COUNT + 1))
  done <<EOF
$1
EOF
  # A trailing non-match leaves $? non-zero; the job is the counters, not a status.
  return 0
}
