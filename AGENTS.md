# AGENTS.md — Specflow

> Document de contexte pour toute session future (Claude Code, Codex, etc.). Lire en premier.

## Vision

Specflow est un **fork amélioré du CLI `specify`** de [GitHub Spec Kit](https://github.com/github/spec-kit), distribué comme **binaire natif** (plus de pré-requis Python côté utilisateur).

Le rôle de Specflow est **exactement** celui de `specify init` upstream : scaffolder, dans un projet existant, les fichiers consommés par le harnais IA de l'utilisateur (Claude Code, Cursor, Copilot, Codex, Gemini CLI, …) — commandes SpecKit, templates de spec/plan/tasks, constitution, scripts utilitaires. **Specflow ne parle à aucun LLM. Specflow n'orchestre aucun agent. C'est le harnais de l'utilisateur qui consomme les fichiers générés.**

### Les 3 seules différences avec l'amont

1. **Mode automatique par défaut** — le skill/command `specify` généré enchaîne `clarify → plan → tasks → analyze → implement → review → merge` dans la même session, en ne s'arrêtant que sur (a) des clarifications nécessaires, (b) la validation pré-merge. Upstream est 100 % manuel étape par étape.

2. **Étape `review` post-implement** — une phase dédiée qui exécute des contrôles structurels (architecture, silent catches, exposition d'IDs internes, cache, couverture de tests) puis les quality gates (format / lint / typecheck / tests). La boucle `implement → review → fix → re-review` est scriptée dans le skill généré. Upstream n'a pas cette phase.

3. **Commande `backlog` + agent Product Owner** — un système de backlog de tâches (index `tasks/backlog.md` + fichiers `tasks/backlog/NNN-slug.md` avec frontmatter typé) géré par un agent PO fourni dans les templates, avec un script de sync vers un backend distant (GitHub Issues + Project V2 en v1 ; GitLab, Bitbucket envisagés plus tard). Upstream n'a aucune notion de backlog produit.

## Ce que Specflow n'est pas

- Pas un harnais IA
- Pas un orchestrateur multi-LLM
- Pas un runtime d'agents
- Pas un moteur de spécifications exécutable
- Pas une réécriture de Claude Code

Si la question est "est-ce que Specflow peut tourner sans que l'utilisateur ait un harnais IA ?" → **non**. Specflow écrit des fichiers que Claude Code (ou Cursor, etc.) lit pour fonctionner. Le langage du binaire est une question d'installation et de distribution, pas d'exécution.

## Frustrations avec Spec Kit upstream

- Étapes manuelles imposées à chaque transition (pas d'auto-chain)
- Pas de phase `review` structurée après l'implémentation
- Pas de notion de **backlog produit** : une feature à la fois, sans vue d'ensemble
- Sync avec un tracker distant (GitHub Issues…) à faire à la main

## Choix techniques à trancher

- **Langage** : Rust | Go | Deno | Bun | Node — critère clé = binaire cross-platform facile à distribuer via Homebrew / `curl | sh` / GitHub Releases. Le binaire ne fait que copier des templates et piloter quelques scripts locaux (`git`, `gh`) — la charge CPU est nulle, donc le choix est un choix d'**ergonomie de distribution** et de **vélocité de développement**, pas de perf.
- **Backlog storage** : en v1, fichiers Markdown locaux (index + un fichier par tâche) + push one-way vers GitHub Issues/Project via `gh`. Formats distants additionnels (GitLab, Bitbucket) = v2+.
- **Harnais cibles pour le scaffolding** : upstream supporte Claude, Cursor, Copilot, Codex, Gemini, Windsurf, Qwen, etc. À décider lesquels on supporte en v0.1.

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
