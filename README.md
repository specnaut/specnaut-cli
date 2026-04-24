# Specflow

Fork amélioré du CLI `specify` de [GitHub Spec Kit](https://github.com/github/spec-kit), distribué
comme **binaire natif** (plus de pré-requis Python).

Specflow scaffolde dans ton projet les fichiers que ton harnais IA (Claude Code, Cursor, Copilot,
Codex, Gemini CLI…) utilise pour piloter un workflow spec-driven. Il ajoute trois choses que l'amont
n'a pas :

- **Mode automatique** — enchaîne
  `specify → clarify → plan → tasks → analyze → implement → review → merge` sans interruption, sauf
  clarifications nécessaires et validation pré-merge
- **Phase `review` structurée** — contrôles d'architecture + quality gates
  (format/lint/typecheck/tests) avec boucle `implement → review → fix → re-review`
- **Backlog produit** — index Markdown + fichier par tâche avec frontmatter, agent Product Owner
  pour la gestion, sync one-way vers GitHub Issues/Project

## Statut

Phase de brainstorming — langage et architecture pas encore figés. Voir [`AGENTS.md`](./AGENTS.md)
pour la vision complète.

## Ce que Specflow n'est pas

Specflow ne parle à aucun LLM. Specflow n'orchestre aucun agent. Il faut un harnais IA compatible
(comme avec l'amont).

## Installation

### curl | bash

```bash
curl -fsSL https://raw.githubusercontent.com/mkrlabs/specflow/main/install.sh | bash
```

Pin a version: `VERSION=v0.1.0-alpha.1`. Change install dir: `PREFIX=$HOME/.local/bin`.

### Homebrew

```bash
brew tap kevinraimbaud/tap
brew install specflow
```

(The tap is updated manually at release time for v0.1.)

### Manual

Download the binary for your OS/arch from
[GitHub Releases](https://github.com/mkrlabs/specflow/releases), run `chmod +x` and place it in your
`$PATH`.

On macOS, you may need to clear the quarantine attribute after download:

```bash
xattr -d com.apple.quarantine /path/to/specflow
```

## Upgrading an existing project

When you update the `specflow` binary (via `specflow self-update` or Homebrew), the bundled
templates may have changed. To pull those changes into a project you previously `init`'d:

```bash
specflow upgrade --dry-run    # see what would change
specflow upgrade              # apply safely — files you customized are preserved
specflow upgrade --force      # overwrite customized files (backed up to .specflow.bak)
```

Specflow tracks the SHA256 of each template in `.specflow/installed.lock` so it can detect your
local edits and avoid overwriting them. Commit this lock file with your project.

## Development setup

```bash
git clone https://github.com/mkrlabs/specflow.git
cd specflow
deno task setup          # installs the pre-commit hook
deno task test           # sanity check — all green
```

The pre-commit hook runs `deno fmt --check`, `deno lint`, and `deno check` on every commit. To skip
it in an emergency, use `git commit --no-verify` (avoid in normal workflow — CI will fail anyway).
