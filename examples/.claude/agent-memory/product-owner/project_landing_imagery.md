---
name: Landing imagery pre-provisioned
description: Task 054 no longer blocks on imagery — final JPEGs are already deployed to public/landing/ (2026-04-18)
type: project
---

Final landing imagery for spec-192 / task-054 was generated via Gemini 3 Pro
Image (nano-banana skill) on 2026-04-18 and validated by Kevin. Files live at
`public/landing/`: `hero_portrait.jpg` (9:16 2K), `collage_1.jpg`,
`collage_2.jpg`, `collage_3.jpg` (1:1), `travel_portrait.jpg` (4:5).
Aesthetic contract (locked): burgundy/bordeaux-dominant, editorial motion
blur, film grain, painterly fashion-magazine. Task 070 closed as done —
imagery was its whole scope. The SVG placeholders still sit beside the JPEGs
and must be deleted by task 054's SpecKit implementation.

**Why:** Kevin pre-provisioned the imagery out-of-band to unblock the
polish pass; the Clarify phase no longer needs to ask him for assets, only
for implementation-level details (scrim tuning, alt text, responsive sizes).

**How to apply:** When task 054 goes to SpecKit, tell the implementer the
imagery is on disk and the aesthetic is locked — do not renegotiate burgundy
or request new generations. Just wire the JPEG refs and delete the SVG
placeholders + `PLACEHOLDER_README.md`.
