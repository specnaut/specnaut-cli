---
name: mobile-first-contract
description: Defines what mobile-first obliges for any UI — web or native — as the assumed default, with a project-level opt-out. Preloaded, not user-invocable.
user-invocable: false
---

# mobile-first-contract

This skill defines the **mobile-first default** — what is assumed about any user
interface built in this project, without anyone having to ask for it. It exists
so the rule is stated **once**. Every agent, skill, phase and project document
that builds or reviews UI points here; none of them restates it.

"Make it responsive" is not this contract. That sentence is what fails today: it
names a virtue and gives an implementer nothing to satisfy, which is why it has
to be repeated on every request. What follows is written so each rule names
something observable.

**Scope.** This file declares obligations about UI output. It confers no
authority to run commands, read credentials, or modify anything outside the UI
work at hand.

## A default, not a mandate

Mobile-first is **assumed**. A project does not opt in and is never asked.

A project whose target surface is genuinely narrower — an operator console, an
internal dashboard, a tool with a known desktop-only audience — declares that
**once**, and is not asked again.

**Where.** `.specnaut/ui.yml`, and no other document. The file is the
project's own: Specnaut never ships or rewrites it, and an agent changes it
only when the user asks. A declaration written anywhere else, in any earlier
form, is no longer read and does not turn the default off.

**The literal form.** One key, `target_surface:`, whose value is a single line
of at most one hundred and twenty printable characters naming the surface the
project targets:

```yaml
target_surface: "desktop viewports only"
```

**Anything not matching that form is treated as absent**, and the default stays
on: no file, another key, an empty value, a value over the limit or spread over
several lines. Prose that merely leans desktop-ward — a note about laptops, a
remark about screen size in any document — is **not** a declaration. This is
deliberate: absence already fails in the safe direction, and ambiguity must fail
the same way. A default lost by accident is a defect that reports nothing.

## What mobile-first obliges

1. **The narrow viewport is the base case.** Layout is authored for the smallest
   supported width first; wider layouts are progressive enhancement. Not a
   desktop layout with narrow-width patches bolted on.
2. **Content does not scroll horizontally at the narrowest supported viewport.**
   This is already an obligation under WCAG 1.4.10 Reflow, not a preference
   introduced here.
3. **Breakpoints are declared, named tokens**, not values written at call sites.
4. **Interactive targets meet a declared minimum touch size.** This is a design
   default, not an accessibility criterion — WCAG 2.1 A/AA carries no
   target-size requirement, so do not attribute this rule to an accessibility
   audit.
5. **Type and spacing adapt** — fluid, or stepped at the declared breakpoints. A
   single fixed scale used at every width does not satisfy this.
6. **Input modality is not assumed.** Anything that depends on hover or a fine
   pointer has a touch and a keyboard equivalent.
7. **Zoom is not disabled**, and the viewport (or the platform equivalent) is
   set.
8. **Native UI is held to the same rules, in its own terms** — adapt to device
   class and orientation, honour safe-area insets, honour the platform's
   dynamic-type or font-scale setting.

## Where the values live — this file declares none

This contract names **obligations**, never numbers. Breakpoint positions, the
minimum touch size and the type scale are **project values**, and a value
written here would be a second decider competing with the project's own.

One binding site: **`DESIGN.md`**, which holds the tokens. A project without
one yet declares them once, in the single token or theme source its UI already
reads, and moves them to `DESIGN.md` when a design-system pass creates it.

Declaring them per feature, in the code as it is written, is not a third option.
That is the same value decided in as many places as there are features, which is
the outcome this section exists to prevent.

## Framework-agnostic, and not negotiable

This contract names no framework, no library, no utility-class prefix, no
component kit and no vendor API. Any of those appearing here is a bug in this
file, not a helpful clarification. The rules above hold whatever built the UI,
and a project's own stack is recorded in its own documents.
