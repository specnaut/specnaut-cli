# Quickstart — Parent-managed detection

How to verify #371 by hand and where the automated coverage lives.

## Manual smoke (parent-managed case → C1)

```bash
# 1. Build a providing workspace fixture
mkdir -p /tmp/ws/child
printf '{ "workspace": ["./child"] }\n' > /tmp/ws/deno.json
mkdir -p /tmp/ws/.specnaut            # makes /tmp/ws a *providing* workspace

# 2. Init inside the member
cd /tmp/ws/child
specflow init --harness claude --yes

# Expect:
#  • notice: "parent-managed workspace detected — skills/agents inherited from parent"
#  • /tmp/ws/child/.specnaut/        present (toolkit provisioned)
#  • /tmp/ws/child/.claude/skills/   ABSENT
#  • /tmp/ws/child/.claude/agents/   ABSENT
find /tmp/ws/child/.claude -type d 2>/dev/null   # → no skills/ or agents/
```

## Standalone case (→ C2)

```bash
mkdir -p /tmp/solo && cd /tmp/solo
specflow init --harness claude --yes
# Expect: .claude/skills/ and .claude/agents/ provisioned as today; no notice.
```

## Override case (→ C4)

```bash
mkdir -p /tmp/ws/child2 && mkdir -p /tmp/ws/child2/.specnaut
: > /tmp/ws/child2/.specnaut/standalone.yml      # force full provisioning
# (add ./child2 to /tmp/ws/deno.json workspace list)
cd /tmp/ws/child2 && specflow init --harness claude --yes
# Expect: full provisioning despite the enclosing workspace.
```

## Upgrade case (→ C3, C5)

```bash
cd /tmp/ws/child                 # parent-managed, already inited, no .claude/skills
specflow upgrade --yes
# Expect:
#  • .specnaut/ toolkit refreshed
#  • .claude/skills/ and .claude/agents/ still ABSENT (not resurrected)
grep -c 'claude/skills\|claude/agents' .specnaut/installed.lock   # → 0
grep -c 'parent_managed: true' .specnaut/installed.lock           # → 1
```

## Automated coverage

```bash
cd apps/specflow
deno task test                                   # full suite
deno test tests/domain/parent_managed_test.ts    # predicates
deno test tests/integration/init_parent_managed_test.ts
deno test tests/integration/upgrade_parent_managed_test.ts
```

| Contract                            | Where                                              |
| ----------------------------------- | -------------------------------------------------- |
| C1 / C2 / C4                        | `tests/integration/init_parent_managed_test.ts`    |
| C3 / C5                             | `tests/integration/upgrade_parent_managed_test.ts` |
| `isParentManaged` / `isAgenticPath` | `tests/domain/parent_managed_test.ts`              |
| lock `parent_managed` round-trip    | `tests/domain/installed_lock_test.ts`              |
| use-case filtering                  | `tests/application/{init,upgrade}_project_test.ts` |
