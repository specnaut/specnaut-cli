# AGENTS.md — Specflow

> Document de contexte pour toute session future (Claude Code, Codex, etc.). Lire en premier.

## Vision

Specflow est un **fork repensé de [GitHub Spec Kit](https://github.com/github/spec-kit)**. Kevin a beaucoup utilisé et modifié Spec Kit ; ce projet consolide ces modifications en un outil autonome.

Différences fondamentales avec l'amont :

1. **Binaire natif, pas Python** — installable sur n'importe quelle plateforme sans runtime préinstallé.
2. **Mode automatique** — l'IA enchaîne clarify → plan → tasks → implement → checklist sans interrompre l'utilisateur à chaque étape.
3. **Multi-agents** — rôles spécialisés (Product Owner, QA, Dev, DevOps, Security, …) qui s'appuient sur le LLM choisi (Claude, OpenAI, Gemini…) et leurs capacités respectives.
4. **Gestion de backlog** — commande dédiée pour que le PO gère un vrai backlog, fonctionnalité absente de Spec Kit et que Kevin a déjà dû surcharger manuellement.
5. **Sources pluggables** — l'utilisateur choisit où vivent les specs/backlog : Markdown local, GitHub Issues, GitLab, Bitbucket, etc. Pas uniquement du Markdown local.

## Frustrations avec Spec Kit actuel

- Étapes manuelles imposées à l'utilisateur à chaque transition
- Pas de backlog : Spec Kit code une tâche à la fois, sans vision produit à plus long terme
- Verrouillé sur Markdown local
- Peu orienté "agents" : un seul modèle fait tout

## Choix techniques à trancher

- **Langage** : Rust | Deno | Bun | Node — critère clé = binaire cross-platform facile à distribuer
- **Format du backlog** : à définir (SQLite local ? JSON ? miroir d'issues distantes ?)
- **Abstraction LLM** : à définir (couche provider unifiée ? adapters par modèle ?)
- **Intégration harnais IA** : standalone CLI uniquement, ou aussi plugin Claude Code / Cursor / etc. ?

## À apporter par Kevin

- Les modifications qu'il a déjà faites sur son Spec Kit perso (servira de "spec de référence" pour cette réécriture)

## État du dépôt

Initialisé vide (premier commit `b430fb4`). Pas encore de code. La phase de **brainstorming / design** est en cours — aucun langage ni architecture n'est figé.

## Convention pour les agents IA travaillant sur ce repo

- Tant que le langage n'est pas choisi, **ne pas scaffolder** de projet.
- Le brainstorming vit dans `docs/superpowers/specs/` (skill superpowers standard).
- Passer par des questions ciblées (une à la fois) avant toute proposition technique large.
