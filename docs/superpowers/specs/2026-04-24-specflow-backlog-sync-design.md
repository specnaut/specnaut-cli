# Specflow `backlog sync` — Design

**Date** : 2026-04-24 **Statut** : draft, en attente de revue **Brique** : 4 de la v0.1 post-init
(reportée depuis le plan v0.1-init) **Prérequis** : v0.1-init mergé sur `main` (commit `d890a9b`)

---

## 1. Objectifs et non-objectifs

### Objectifs

1. Compléter le **delta #3** (backlog produit) en permettant de synchroniser les fichiers
   `tasks/backlog/NNN-*.md` vers un tracker distant (GitHub Issues + Project V2 en v1).
2. Ajouter deux sous-commandes CLI au binaire Specflow :
   - `specflow backlog sync [--id NNN] [--dry-run]`
   - `specflow backlog configure` (onboarding interactif)
3. Persister la configuration dans un fichier `.specflow/config.yml` versionné.
4. Zéro gestion de token côté utilisateur — on délègue l'auth à **`gh` CLI** (prérequis connu, déjà
   dans l'écosystème).
5. Respect strict de la DDD hexagonale déjà en place (domain / application / infrastructure / cli).

### Non-objectifs

- **Sync bidirectionnel** (reverse MD ← GitHub) — reporté en v0.2.
- **Adapters GitLab / Bitbucket** — reportés en v0.3 (le port `BacklogSyncTarget` sera conçu pour
  les accueillir).
- **Gestion de token GitHub sans `gh`** — si `gh` n'est pas authentifié, on émet une erreur
  explicite avec instruction.
- **Détection de drift** (issue éditée manuellement dans l'UI GitHub) — on overwrite, MD gagne.
- **Support multi-project** — un seul Project V2 par config.
- **Création automatique du Project V2** — on assume que l'utilisateur l'a déjà créé dans l'UI
  GitHub ou en crée un via `gh`.

---

## 2. Surface CLI

### `specflow backlog configure`

Flux interactif :

1. Lit `tasks/backlog/` pour confirmer qu'on est dans un projet Specflow. Si absent → erreur claire.
2. Détecte le repo GitHub via `git remote get-url origin`. Si pas un repo GitHub → erreur.
3. Vérifie `gh auth status`. Si pas authentifié → instruction `gh auth login`.
4. Liste les Projects V2 accessibles (personnels + du owner du repo) via `gh api graphql`.
5. Prompt : `Which project?` (multiple choice) OU `[N] No project — issues only`.
6. Pour le Project choisi, détecte les champs (SingleSelect `Status`, Number `Priority`, Number
   `Complexity`) et propose un mapping.
7. Écrit `.specflow/config.yml` + ajoute à `.gitignore` rien de plus (le fichier est public).

### `specflow backlog sync [--id NNN] [--dry-run]`

1. Lit `.specflow/config.yml`. Si absent → `run 'specflow backlog configure' first`.
2. Si `--id NNN` → sync une seule tâche. Sinon → sync toutes les tâches présentes dans
   `tasks/backlog/`.
3. Pour chaque tâche :
   - Parse frontmatter + corps.
   - Cherche l'issue existante via label `backlog/NNN`.
   - Si absente → crée. Si présente → update.
   - Attache au Project V2 configuré et renseigne les 3 champs mappés (Status, Priority,
     Complexity).
   - Si status = `done` → close l'issue ; si `deferred` → close avec `not_planned` reason ; sinon
     ouvrir.
4. `--dry-run` : affiche le plan (CREATE / UPDATE / CLOSE / SKIP) sans appeler `gh`.
5. Exit code 0 = tout OK (ou dry-run), 1 = une tâche au moins a échoué (les autres ont quand même
   été tentées, log cumulatif en fin d'exécution), 2 = précondition manquante (pas de config, pas de
   `gh`, etc.).

---

## 3. Architecture DDD

```
src/
├── domain/
│   ├── backlog/
│   │   ├── task.ts             # BacklogTask entity, BacklogTaskId, Priority, Complexity, Status
│   │   ├── frontmatter.ts      # pure parser MD frontmatter → BacklogTask
│   │   └── sync_plan.ts        # value object: liste d'actions (Create|Update|Close|Skip)
│   └── sync_config.ts          # SyncConfig value object + loader/validator
├── application/
│   ├── ports.ts                # ADD: BacklogReader, BacklogSyncTarget, ConfigStore, InteractivePrompt
│   ├── sync_backlog.ts         # SyncBacklogUseCase (read MD, diff, apply via target)
│   └── configure_sync.ts       # ConfigureSyncUseCase (interactive setup, writes config)
├── infrastructure/
│   ├── fs_backlog_reader.ts    # FsBacklogReader implementing BacklogReader via walk tasks/backlog/
│   ├── fs_config_store.ts      # FsConfigStore via @std/yaml sur .specflow/config.yml
│   ├── gh_cli.ts               # thin wrapper autour de `Deno.Command("gh", ...)`
│   ├── github_backlog_sync.ts  # GitHubBacklogSyncTarget (Issues REST + Project V2 GraphQL via gh)
│   └── terminal_prompt.ts      # InteractivePrompt via @std/cli/unstable_prompt_select
└── cli/
    ├── parser.ts               # ADD: `backlog` intent with subcommand (sync | configure)
    └── handlers/
        ├── backlog_sync_handler.ts
        └── backlog_configure_handler.ts
```

Tests mirrorés : `tests/domain/backlog/*_test.ts`, `tests/application/sync_backlog_test.ts`,
`tests/application/configure_sync_test.ts`, `tests/infrastructure/fs_backlog_reader_test.ts`,
`tests/infrastructure/fs_config_store_test.ts`, `tests/infrastructure/gh_cli_test.ts` (against
mock), `tests/cli/parser_test.ts` (étendu).

---

## 4. Modèle de données (domain)

### `BacklogTask`

```typescript
type Priority = "critical" | "high" | "medium" | "low";
type Status = "todo" | "in_progress" | "done" | "deferred" | "blocked";
type Complexity = 1 | 2 | 3 | 5 | 8 | 13 | 21; // Fibonacci

class BacklogTask {
  constructor(
    readonly id: string, // zero-padded 3-digit
    readonly title: string,
    readonly category: string,
    readonly priority: Priority,
    readonly complexity: Complexity,
    readonly status: Status,
    readonly dependsOn: ReadonlyArray<string>,
    readonly spec: string | null,
    readonly tags: ReadonlyArray<string>,
    readonly created: string, // YYYY-MM-DD
    readonly body: string, // markdown body minus frontmatter
  ) {}
}
```

### `SyncConfig` (persisté dans `.specflow/config.yml`)

```yaml
version: 1
sync:
  provider: github
  repo: owner/name # inferred, user-overridable
  project:
    number: 3
    owner: owner # user or org
    field_map:
      status: Status
      priority: Priority
      complexity: Complexity
  label_prefix: backlog/ # default, configurable
```

### `SyncPlan`

```typescript
type SyncAction =
  | { kind: "create"; task: BacklogTask }
  | { kind: "update"; task: BacklogTask; issueNumber: number }
  | { kind: "close"; task: BacklogTask; issueNumber: number; reason: "completed" | "not_planned" }
  | { kind: "skip"; task: BacklogTask; reason: string };

type SyncPlan = ReadonlyArray<SyncAction>;
```

---

## 5. Data flow — `specflow backlog sync`

```
┌─ CLI handler (backlog_sync_handler.ts)
│   └─ loads ConfigStore.read() → SyncConfig
│       └─ if missing → exit 2 with "run configure"
│
├─ SyncBacklogUseCase.execute(config)
│   ├─ BacklogReader.readAll(tasksDir) → BacklogTask[]
│   ├─ BacklogSyncTarget.listExisting(config) → Map<id, issue>
│   ├─ diff(tasks, existing) → SyncPlan
│   ├─ if dryRun: return plan (no side effects)
│   └─ for each action: BacklogSyncTarget.apply(action, config)
│
└─ Handler renders:
    ✓ NNN created → issue #42
    ✓ NNN updated → issue #17
    ↓ NNN closed (done) → issue #12
    ⚠ NNN skipped (invalid frontmatter)
```

### Diff rule (deciding `update` vs `skip`)

En v1, on reste simple : pour toute tâche existante (label `backlog/NNN` trouvé), on émet
**toujours** une action `update` — PAS de comparaison de contenu. Raisons : (a) GitHub ne renvoie
pas un hash qu'on pourrait comparer au body MD sans refaire la mise en forme, (b) les
`gh issue edit` sont idempotents côté serveur (pas de notification si rien ne change). Test
d'idempotence (§12.3) vérifiera que ces updates "vides" n'ont pas d'effet observable.

Exceptions qui émettent `skip` :

- Frontmatter invalide (on ne peut pas synchroniser une tâche qu'on ne peut pas parser).
- Détection de secret dans le body (voir §9).

Exception qui émet `close` :

- Status = `done` (raison `completed`).
- Status = `deferred` (raison `not_planned`).

### Interface `BacklogSyncTarget`

```typescript
export interface BacklogSyncTarget {
  listExisting(config: SyncConfig): Promise<Map<string, ExistingIssue>>;
  apply(action: SyncAction, config: SyncConfig): Promise<ApplyResult>;
}

type ExistingIssue = { id: string; number: number; state: "open" | "closed" };
type ApplyResult = { ok: true; issueNumber: number } | { ok: false; error: string };
```

L'implémentation `GitHubBacklogSyncTarget` shell-out à `gh`:

- `listExisting` → `gh issue list --label "backlog/*" --state all --json number,labels,state` puis
  filtre les labels `backlog/\d{3}`.
- `apply(create)` →
  `gh issue create --title ... --body ... --label backlog/NNN,priority/<x>,category/<y>` puis
  GraphQL pour Project V2.
- `apply(update)` → `gh issue edit <num> --title ... --body ... --add-label ...`
- `apply(close)` → `gh issue close <num> --reason completed|not_planned`
- Project V2 : toujours via `gh api graphql` (pas de REST équivalent), avec mutations
  `addProjectV2ItemById` et `updateProjectV2ItemFieldValue`.

---

## 6. Configure flow — `specflow backlog configure`

```
1. verify tasks/backlog/ exists           [else → exit 2]
2. read git remote origin                  [parse owner/repo from URL]
3. exec 'gh auth status'                   [else → exit 2 + instructions]
4. exec 'gh api graphql -f query=...'      [list accessible Projects V2]
5. prompt: choose project (or 'none')
6. if chosen, list fields of that project  [via GraphQL]
7. prompt: map 'Status', 'Priority', 'Complexity'  [3 choices; default = field with matching name]
8. write .specflow/config.yml              [@std/yaml]
9. echo: "config written. run 'specflow backlog sync' to sync your current backlog."
```

Non-interactive mode (for CI / scripts) : flags `--repo`, `--project-number`, `--project-owner`,
`--skip-prompts`. Si fournis, pas de prompt.

---

## 7. Gestion d'erreurs

| Situation                                                         | Comportement                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Pas de `gh` dans PATH                                             | exit 2 avec message `gh CLI required. Install from https://cli.github.com then 'gh auth login'`. |
| `gh auth status` fail                                             | exit 2 avec `Run 'gh auth login' first`.                                                         |
| Pas de config file                                                | `sync` exit 2 avec `Run 'specflow backlog configure' first`.                                     |
| Frontmatter invalide dans une tâche                               | Action `skip` avec reason, continue les autres, exit 1 en fin.                                   |
| GitHub API rate-limited                                           | `gh` gère le retry ; on relaie son exit code. Pas de retry custom en v1.                         |
| Project V2 inaccessible (token scope insuffisant)                 | Message explicite, exit 1 (les issues se créent quand même).                                     |
| Fichier `tasks/backlog/NNN-slug.md` dont `id` ne matche pas `NNN` | Warning log, sync avec l'id du frontmatter (source de vérité).                                   |

---

## 8. Tests par couche

### Domain (pure)

- `frontmatter_test.ts` : parse valid cases, reject missing fields, reject bad enum values,
  round-trip.
- `task_test.ts` : invariants (priority enum, Fibonacci complexity, date format).
- `sync_plan_test.ts` : diff algorithm (existing vs tasks → actions), status transitions.
- `sync_config_test.ts` : YAML parse + validation, version-mismatch error.

### Application (fake ports)

- `sync_backlog_test.ts` : happy path, dry-run, skip invalid, close→done, close→deferred, mixed
  outcomes.
- `configure_sync_test.ts` : interactive flow with fake InteractivePrompt returning canned answers.

### Infrastructure (real Deno APIs, mocked subprocess)

- `fs_backlog_reader_test.ts` : walks a tmp `tasks/backlog/` tree, returns parsed tasks.
- `fs_config_store_test.ts` : read/write round-trip to `.specflow/config.yml`.
- `gh_cli_test.ts` : wraps a fake `Deno.Command` (via a port) so we can assert commands and
  responses.
- `github_backlog_sync_test.ts` : depends on gh_cli fake, verifies the command shapes for
  create/update/close/list.

### Integration

- `backlog_sync_test.ts` : spawn real `specflow` binary in a tmp dir with a mock-gh shim on PATH (a
  bash script that records its args and prints canned JSON). Verifies exit codes, dry-run output,
  config gating.

Target count : ~30 new tests, bringing total from 50 to ~80.

---

## 9. Considérations de sécurité

- **Auth confinée à `gh`** : Specflow ne touche jamais un token GitHub directement, n'en lit aucun,
  n'en persiste aucun.
- **Network allowlist inchangée** — Specflow continue à n'avoir besoin que de
  `api.github.com,github.com,…` (pour self-update). Pour le sync, il ne fait PAS de `fetch` direct
  vers GitHub : tout passe par `gh` via subprocess, donc seul `--allow-run=gh` est nécessaire. Aucun
  ajout à la liste `--allow-net` embarquée au compile.
- **Injection** : titres/body sont passés à `gh` via `--title` / `--body-file` (fichier temp),
  jamais concaténés dans une shell string. `--body-file` évite les problèmes de quoting.
- **Secrets dans le MD** : on scanne les tâches pour des patterns évidents (`ghp_*`, `sk_*`, AWS
  keys) avant d'uploader et on refuse le sync si détecté, avec une option `--allow-secrets` pour
  override.

---

## 10. Contracts avec l'agent `product-owner`

Le template `templates/claude/agents/product-owner.md` mentionne déjà :

> ### `/backlog sync` and `/backlog sync <id>`
>
> Not yet available in this Specflow version. Tell the user: ...

À la livraison de cette brique, on met à jour ce template pour remplacer par :

> Runs `specflow backlog sync` (or `sync --id NNN`) as a shell command. After every mutation from
> `add`/`update`/`groom`, the PO must emit the directive "run `specflow backlog sync --id NNN`" so
> the orchestrator executes it.

Update cohérent dans la commande `templates/claude/commands/backlog.md` également.

Note : le **bundle embarqué change**, donc `TEMPLATES_VERSION` dans `deno.json` et
`src/domain/version.ts` passe de `0.1.0` à `0.2.0`. La version du binaire peut rester
`0.1.0-alpha.N` ou passer en `0.2.0` selon stratégie de release — à trancher au moment du tag.

---

## 11. Plan de livraison (à transformer en implementation plan)

Briques par ordre de dépendance :

1. **Domain** — task, frontmatter parser, sync_plan, sync_config (+ tous les tests domain)
2. **Application ports** — ajouter BacklogReader, BacklogSyncTarget, ConfigStore, InteractivePrompt
3. **FsBacklogReader + FsConfigStore** — infrastructure bas niveau
4. **SyncBacklogUseCase + tests application** avec fakes
5. **gh_cli + GitHubBacklogSyncTarget + tests** avec subprocess fake
6. **ConfigureSyncUseCase + TerminalPrompt + tests**
7. **CLI parser extension + handlers** (sync + configure)
8. **Main.ts routing**
9. **Integration test** avec gh shim
10. **Template updates** (product-owner agent + backlog command refs)
11. **Bump TEMPLATES_VERSION**

---

## 12. Risques et points ouverts

1. **Project V2 GraphQL complexity** : les mutations `updateProjectV2ItemFieldValue` varient selon
   le type de champ (`SingleSelect` nécessite `optionId`, `Number` nécessite `number`). L'adapter
   doit détecter le type de champ et formuler la mutation correspondante. → Couvert par les tests
   unitaires.
2. **Rate limiting** : sur un backlog de 100 tâches, on fait ~300 appels API (liste + create +
   project attach). `gh` a un rate-limit handling ; on ne fait rien de spécial en v1.
3. **Idempotence** : la deuxième run du sync sur un backlog déjà synchronisé doit être un no-op
   (aucune modification). Test dédié nécessaire.
4. **Config file path** : `.specflow/config.yml` créé automatiquement. Faut-il l'ajouter à
   `.gitignore` par défaut ? → Non, il doit être versionné (décidé §1).
5. **Interactive prompt dans `configure`** : `@std/cli/unstable_prompt_select` est encore tagged
   unstable. Alternative : prompter manuellement via `readLine`. → On part sur `@std/cli/unstable-*`
   et on note la dépendance à l'évolution stdlib.

---

## 13. Prochaine étape

Après validation de ce design, passer en `superpowers:writing-plans` pour produire le plan
d'implémentation découpé en ~14 tâches (estimée) suivant l'ordre de §11.
