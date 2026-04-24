---
description: >
   Structured brainstorming session for a new idea or problem. Validates business
   value, technical feasibility, and user impact before committing to a spec.
   Ends with an optional backlog task. Trigger: /brainstorm <idea>
---

## User Input

```text
$ARGUMENTS
```

## Purpose

This command runs a **structured brainstorming dialogue** between you, the
Product Owner agent, and the codebase — to evaluate an idea _before_ deciding
whether it deserves a SpecKit spec, a quick backlog task, or nothing at all.

Use it when:

- You have an intuition but no concrete scope yet
- You want to challenge an idea before investing in it
- You're not sure whether something already exists in the app
- You want a business value / effort sanity check

---

## Phase 0 — Seed the Session

1. **Read** `tasks/backlog.md` to understand current priorities and avoid
   duplicates.
2. **Spawn the product-owner agent** to load business context:

   ```
   @product-owner

   A brainstorming session is starting for this idea:
   "[paste user input]"

   Before we start, please:
   1. Check if anything similar exists in the backlog (tasks/backlog.md)
   2. Identify which business domain(s) this idea touches (booking, content,
      monetization, trust-safety, etc.)
   3. State any known business constraints that would immediately affect this idea
   4. Share your gut reaction: does this align with Miximodel's core vision?

   Keep it short — 3-5 bullet points. This seeds the brainstorm, it's not the
   final brief.
   ```

3. **Search the codebase** for relevant existing patterns. Ask yourself:
   - Does this feature already exist in some form?
   - Which services, models, or routes would be affected?
   - Is there an obvious hook point or would it require a new architecture?

   Use `Grep` and `Glob` to quickly scan the relevant areas. Keep it focused —
   3-5 minute search, not a deep audit.

---

## Phase 1 — Dialogue (interactive, 4–6 rounds)

Present yourself to the user and start the conversation:

```
💡 Session de brainstorming — [short idea title]

[Paste PO context from Phase 0 — 3-5 bullets]
[Paste codebase scan findings — 2-3 bullets]

Voici ma première question pour creuser l'idée :
```

Then **ask one focused question at a time**, waiting for the user's answer
before continuing. Progress through these dimensions in order — skip any that
were already answered in Phase 0:

### Dimension 1 — Problem / Need

- Who specifically has this problem? (which role: model, photographer, agency?)
- How often do they encounter it? (daily friction vs rare edge case)
- What's the cost of NOT solving it? (user churn, lost revenue, trust issue?)

### Dimension 2 — Solution Fit

- Is there already a workaround users use today?
- Does this idea fit naturally in the app's existing flows, or would it require
  users to learn something new?
- What's the simplest version that delivers value (MVP slice)?

### Dimension 3 — Business Value

- Does this directly impact revenue, retention, or acquisition?
- Does it strengthen a differentiator (vs Instagram, Casting.fr, etc.)?
- Is it table stakes (must-have) or a nice-to-have?

### Dimension 4 — Technical Feasibility

- Does existing architecture support this, or does it require new entities?
- Are there security/privacy implications (user data, consent, RGPD)?
- What's the rough complexity: 1-3 pts (quick) / 5-8 pts (medium) / 13+ pts
  (big)?

---

## Phase 2 — RICE Scoring

After the dialogue, compute a **RICE score** collaboratively with the user:

| Dimension                                                      | Score (1–10) | Notes |
| -------------------------------------------------------------- | ------------ | ----- |
| **Reach** — how many users affected?                           |              |       |
| **Impact** — how much does it improve their experience?        |              |       |
| **Confidence** — how sure are we it will work?                 |              |       |
| **Effort** — inverse of complexity (10 = trivial, 1 = massive) |              |       |

**RICE = (Reach × Impact × Confidence) / Effort**

| RICE Range | Recommendation                                          |
| ---------- | ------------------------------------------------------- |
| > 50       | Strong candidate — add to backlog as High priority      |
| 20–50      | Valid idea — add as Medium priority                     |
| 5–20       | Low confidence or effort too high — add as Low or defer |
| < 5        | Not worth it now — document the decision, don't add     |

---

## Phase 3 — Decision & Recommendation

Present a clear recommendation in this format:

```
## Résultat du brainstorming — [Idea Title]

**Verdict:** [Go ✅ / Go with reduced scope ⚡ / Defer 🔜 / No-go ❌]

**Pourquoi:**
[2-3 sentences on the key reasoning]

**RICE score:** [X] — [priority level]

**Si Go:**
- Complexité estimée: [N] story points
- Workflow recommandé: [SpecKit spec `/speckit specify ...` OU implémentation directe]
- Dépendances: [list if any]
- Scope MVP: [one sentence]

**Risques / questions ouvertes:**
- [list any unresolved concerns]
```

---

## Phase 4 — Backlog Integration (optional)

Ask the user:

> "Tu veux qu'on l'ajoute au backlog maintenant ? (oui / non / modifier le scope
> d'abord)"

If **yes**: spawn the product-owner agent to create the task:

```
@product-owner

Add a new backlog task based on this brainstorm session:

Title: [derived from the idea]
Business context: [paste RICE scores, verdict, key insights]
Complexity: [N] pts
Priority: [critical|high|medium|low]
Category: [commerce|professional|trust-safety|content|communication|devex|devops]

Create the task file and update tasks/backlog.md.
```

After the task is created, **auto-commit and auto-sync** per the backlog command
rules (step 4 and 4b of `.claude/commands/backlog.md`).

If **no**: summarize the session and offer to revisit later.

---

## Behavior Rules

- **One question at a time** — never dump a list of 5 questions at once
- **Build on answers** — each question should reflect what the user just said
- **Challenge gently** — if the idea seems weak, say so with reasoning
- **Stay grounded in the codebase** — reference actual patterns and services
- **Respect the PO's domain knowledge** — if the PO flagged a constraint, honor
  it
- **Default language: French** for the conversation, English for any artifacts

---

## Quick Reference

```text
/brainstorm                     — Start with an idea (you'll describe it)
/brainstorm <idea description>  — Start immediately with a seed
```
