# /specnaut doc

## User Input

```text
$ARGUMENTS
```

Answers a question about Specnaut itself — how it works, its commands, harnesses, backlog backends,
agents, and what changed between releases. One-shot; it changes nothing.

## Steps

1. **Dispatch the `specnaut-guide` agent** with the user's question (or "give an overview of
   Specnaut" when `$ARGUMENTS` is empty). It answers from the live docs at `https://specnaut.com`
   and falls back to the vendored `specnaut-facts` skill when they cannot be fetched.
2. **Relay its answer.** Name the commands it cites at their current addresses — `/task` for work,
   `/specnaut` for the framework, `/ship` for production.
3. **A question about this project's own work** (an item, a plan, a branch) is not a `doc`
   question: name the `/task` verb that answers it and stop.
