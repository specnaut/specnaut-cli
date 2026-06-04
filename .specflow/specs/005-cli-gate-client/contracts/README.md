# Contracts

This feature defines **no new contract**. It is the CLI's agent-side implementation of the frozen,
versioned public wire format:

- **`docs/api/gates.md`** (mkrlabs/specflow#356) — the single source of truth for the gate object,
  the five gate types, the `open → answered → applied` / `open → cancelled` state machine, the five
  endpoints (`POST /gates`, `GET /gates`, `POST /gates/{id}/{resolve,apply,cancel}`), the error
  statuses, and the gate lifecycle events on `GET /api/v1/activity`.

The client consumes that contract verbatim. Per constitution § I/§ II it is the **only** coupling
between this OSS CLI and the proprietary Cloud backend (#17). The CLI implements the **agent** role
(open / await / apply / cancel); it never calls `resolve` (the human action).
