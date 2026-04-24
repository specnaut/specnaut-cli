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

## Development setup

```bash
git clone https://github.com/kevinraimbaud/specflow.git
cd specflow
deno task setup          # installs the pre-commit hook
deno task test           # sanity check — all green
```

The pre-commit hook runs `deno fmt --check`, `deno lint`, and `deno check` on every commit. To skip
it in an emergency, use `git commit --no-verify` (avoid in normal workflow — CI will fail anyway).
