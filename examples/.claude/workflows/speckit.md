---
description: Run any speckit command on a feature spec by number or name
---

# Speckit Dispatch Workflow

When this workflow is triggered, follow these steps:

1. Read the Speckit Runner skill at `.claude/skills/speckit/SKILL.md`
2. Parse the user input to extract the **command** and **spec identifier**
3. Follow the skill instructions to resolve the spec directory and execute the
   command
