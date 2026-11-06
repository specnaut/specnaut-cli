**A fix for the scaffolded templates, and the marketplace channel now publishes itself.**

Three bundled files still directed agents at artefacts 2.0.0 removed. `tasks-template.md` listed
`spec.md`, `research.md`, `data-model.md` and `contracts/` as prerequisites; `developer.md` read the
domain model from `spec.md` and returned BLOCKED when it could not find it — a hard stop on a file
that no longer exists; and the brainstorming skill told agents to _write_ a greenfield design to
`spec.md`, producing a second design document beside the plan that nothing downstream reads. All
three now point into `plan.md`. `specnaut upgrade` picks them up.

The prose had been corrected in 2.0.0 and the instructions had not, which is the harder half to
notice: prose that contradicts an instruction reads as documentation drift right up until an agent
follows the instruction. A guard now greps the whole bundle for the removed names.

Separately, the marketplace catalog that serves Claude Code and Copilot CLI users had been one to
fifteen versions behind for months. Every step of the sync reported success; it opened a pull
request and left a human to merge it, and after the first two nobody did. The bump now lands
directly, and the script verifies the published catalog reports the new version rather than trusting
its own exit code.
