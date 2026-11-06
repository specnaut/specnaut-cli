# shellcheck shell=bash
# _scope_globs.sh - the one home of which paths count as front-end, test,
# dependency-manifest and infrastructure files. Sourced by _git_untrusted.sh,
# so collect-audit-scope.sh's CATEGORY SIGNALS and git-read.sh's `manifests`
# form read the same lists. The globs are heuristic (research.md Decision 1):
# good enough to pick which expert seats run.

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
