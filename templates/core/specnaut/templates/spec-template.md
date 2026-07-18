# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`  
**Created**: [DATE]  
**Status**: Draft  
**Input**: User description: "$ARGUMENTS"

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently - e.g., "Can be fully tested by [specific action] and delivers [specific value]"]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 3 - [Brief Title] (Priority: P3)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- What happens when [boundary condition]?
- How does system handle [error scenario]?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST [specific capability, e.g., "allow users to create accounts"]
- **FR-002**: System MUST [specific capability, e.g., "validate email addresses"]  
- **FR-003**: Users MUST be able to [key interaction, e.g., "reset their password"]
- **FR-004**: System MUST [data requirement, e.g., "persist user preferences"]
- **FR-005**: System MUST [behavior, e.g., "log all security events"]

*Example of marking unclear requirements:*

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

### Key Entities *(see Domain Model section below for full structure)*

- **[Entity 1]**: [What it represents, business-level attributes only]
- **[Entity 2]**: [What it represents, relationships]

## Domain Model *(mandatory)*

<!--
  ACTION REQUIRED: Populated by the Product Owner during /specnaut clarify.
  The developer refuses to proceed without this section.
  Format mirrors the PO's /backlog brief output — same shape everywhere.
-->

**Bounded context:** <name of the business context, e.g. Checkout, Auth>

**Vocabulary (Ubiquitous language):**

- **<Term>** — <one-line definition in the project's words>

**Entities (have identity):**

- **<Name>** [aggregate root?] — <responsibility, key relationships>

**Value objects (no identity, immutable):**

- **<Name>(<fields>)** — <invariant rule it enforces>

**Invariants (rules the domain must never break):**

- <rule> — <why>

**Out of scope (other bounded contexts touched but not owned here):**

- **<other context>** — <how this feature interacts with it>

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: [Measurable metric, e.g., "Users can complete account creation in under 2 minutes"]
- **SC-002**: [Measurable metric, e.g., "System handles 1000 concurrent users without degradation"]
- **SC-003**: [User satisfaction metric, e.g., "90% of users successfully complete primary task on first attempt"]
- **SC-004**: [Business metric, e.g., "Reduce support tickets related to [X] by 50%"]

## Assumptions

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right assumptions based on reasonable defaults
  chosen when the feature description did not specify certain details.
-->

- [Assumption about target users, e.g., "Users have stable internet connectivity"]
- [Assumption about scope boundaries, e.g., "Mobile support is out of scope for v1"]
- [Assumption about data/environment, e.g., "Existing authentication system will be reused"]
- [Dependency on existing system/service, e.g., "Requires access to the existing user profile API"]

## Visual Prototyping with Claude Artifacts *(optional — front-end / UX-UI features only)*

<!--
  ACTION REQUIRED — CONDITIONAL SECTION.
  Keep this section ONLY when the project has a front-end / UX-UI surface.
  Detect that surface with the SAME signal list the accessibility gate uses
  (see the `a11y-auditor` agent — do NOT invent a new heuristic). Any of:
    - `.html` / `.htm` files
    - `.jsx` / `.tsx` files
    - `.vue` / `.svelte` / `.astro` files
    - a `public/`, `src/app/`, `src/pages/`, `src/routes/`, or `pages/`
      directory containing markup
    - a `package.json` listing a front-end framework dep (react, vue, svelte,
      solid-js, preact, lit, astro, @angular/core, qwik)
  If NONE of those signals are present, REMOVE this entire section — a
  back-end / CLI-only spec must not mention artifacts (mirror the
  "remove inapplicable sections entirely" rule for optional sections).
-->

For the user-facing flows above, you can use **Claude Artifacts** to make the
proposed UX tangible before any code is written — rendered mockups, interactive
prototypes, state/flow diagrams, and side-by-side layout comparisons a
stakeholder can react to directly.

- Turn a User Story's acceptance scenarios into an interactive artifact (a
  clickable mockup or a diagram of the flow) to validate the intended
  experience early, then fold the feedback back into this spec.
- What artifacts are and how to use them: <https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-to-use-them>
- Artifacts in Claude Code: <https://code.claude.com/docs/en/artifacts>
