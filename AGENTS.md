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

## Méthodologie observée dans `examples/` (de référence, pas à recopier)

Le dossier `examples/` contient un projet réel où Kevin a déjà branché Spec Kit + agents + backlog à la main sur Claude Code. Les éléments **agnostiques** à retenir :

### 1. Pipeline Spec Kit auto-chaîné

```
specify → clarify → plan → tasks → analyze → implement → review → merge
           ▲                                                        ▲
           STOP #1                                                  STOP #2
       (si questions)                                        (validation avant merge)
```

- Mode **auto par défaut** ; `--manual` restaure le one-shot legacy.
- `--copilot` : variante "cloud handoff" (push + draft PR + passe la main à un agent distant).
- Seulement 2 interruptions utilisateur : clarifications nécessaires, et validation pre-merge.

### 2. Backlog comme source de vérité produit

- Index `tasks/backlog.md` (checklist groupée par priorité).
- Un fichier par tâche `tasks/backlog/NNN-slug.md` avec frontmatter structuré : `id`, `title`, `category`, `priority`, `complexity` (Fibonacci 1/2/3/5/8/13/21), `status`, `depends_on`, `spec`, `tags`, `created`.
- Statuts : `todo | in_progress | done | deferred | blocked`.
- **Toute mutation = sync obligatoire** vers le backend distant (GitHub Issues + Project V2 dans l'exemple ; à généraliser GitLab/Bitbucket/local).
- Un **agent Product Owner** possède le monopole des mutations — le commande `/backlog` le délègue systématiquement, même pour un ajout trivial.
- Le PO sait trancher **SpecKit-spec vs implémentation directe** selon complexité (≥ 8 pts / nouvelle entité / multi-couche → spec ; sinon direct).

### 3. Équipe d'agents spécialisés avec contrat d'interaction

Agents type observés : `product-owner`, `developer` (alias `implementer`), `workflow-manager`, `review-coordinator`, `qa-tester`, `security-auditor`, `devops-sre`, `accessibility-auditor`, `performance-analyst`, `api-contract-reviewer`, `design-system-enforcer`, `code-reviewer`, `test-reviewer`, experts domaine (typographie, paiement…).

Chaque agent déclare : `model`, `tools`, `skills`, `memory`, `maxTurns`, `permissionMode`, `color`, `description`. Les agents s'échangent le travail via des **"workflow status block"** + **"handoff block"** structurés (pas de prose libre).

### 4. Constitution + templates de spec

Un fichier `.specify/memory/constitution.md` codifie les invariants projet (architecture non négociable, conventions, politiques). Spec Kit charge `.specify/templates/{spec,plan,tasks,checklist,constitution,agent-file}-template.md` pour générer les artefacts. Le template d'agent-file est repeuplé à chaque feature pour donner le contexte aux agents IA.

### 5. Skills transversales

- Contrats inter-agents : `workflow-contract`, `handoff-protocol`, `review-findings-contract`, `qa-report-contract`, `status-audit`.
- Intégrations : `github-pr`, `github-issue`, `github-release`, `git-tag`.
- Un skill `speckit` fait office de dispatcher unique (résout une spec par numéro/nom, charge la bonne commande).

### 6. Ce qui est **projet-spécifique** (à extraire et rendre configurable)

- Les tech-stack hardcodés dans les agents `developer` / `implementer`.
- Les skills métier (`adonisjs-v7`, `react`, `tailwind-v4-expert`, `configcat`, `ccbill`, `segpay`, etc.).
- Les hooks shell (`protect-files.sh`, `auto-format.sh`…).
- Les scripts Python/Bash du sync GitHub.
- La cible d'intégration unique (Claude Code `.claude/`).

## Principes de conception pour Specflow

- **Agnostique du langage** du projet utilisateur (Python / TS / Go / PHP / Rust…).
- **Agnostique du LLM** (Claude / OpenAI / Gemini / local).
- **Agnostique du harnais IA** côté utilisateur : Claude Code, Cursor, Codex, Aider, ou mode standalone sans harnais.
- **Agnostique de la source backlog** : Markdown local, GitHub, GitLab, Bitbucket, etc.
- Pas de "mega-spec" : livrer par **roadmap incrémentale**, chaque brique a sa propre spec → plan → implémentation.

## À apporter par Kevin

- Éventuelles précisions futures au fil des brainstorms. Les exemples sont déjà dans `examples/`.

## État du dépôt

Initialisé vide (premier commit `b430fb4`). Pas encore de code. La phase de **brainstorming / design** est en cours — aucun langage ni architecture n'est figé.

## Convention pour les agents IA travaillant sur ce repo

- Tant que le langage n'est pas choisi, **ne pas scaffolder** de projet.
- Le brainstorming vit dans `docs/superpowers/specs/` (skill superpowers standard).
- Passer par des questions ciblées (une à la fois) avant toute proposition technique large.
