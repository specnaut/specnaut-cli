# Specflow

Fork repensé de [GitHub Spec Kit](https://github.com/github/spec-kit), distribué comme **binaire natif** (pas de runtime Python/Node à installer côté utilisateur).

L'objectif : amener une approche *spec-driven* plus agentique, automatique et orientée backlog dans n'importe quel projet, via une seule commande `specflow init`.

## Statut

Projet en phase de réflexion. Langage cible à choisir parmi : **Rust, Deno, Bun, Node**. Voir [`AGENTS.md`](./AGENTS.md) pour la vision complète.

## Installation

À définir une fois le langage retenu (probablement via `curl | sh`, Homebrew, ou binaire GitHub Releases selon le langage choisi).

## Pourquoi un fork ?

Spec Kit actuel force l'utilisateur à lancer manuellement chaque étape (clarify, plan, tasks, implement, checklist…). Specflow vise :

- un **mode automatique** où l'IA enchaîne les étapes sans interrompre à chaque fois
- un vrai **système multi-agents** (PO, QA, Dev, DevOps, Security…) adapté au LLM choisi (Claude, OpenAI, Gemini, …)
- une **gestion de backlog** native (absente de Spec Kit)
- des **sources de spécifications pluggables** (Markdown local, GitHub Issues, GitLab, Bitbucket, …) au lieu du seul Markdown
