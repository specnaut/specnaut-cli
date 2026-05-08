import type { BacklogBackendStrategy } from "../backlog_backend_strategy.ts";

export class LocalBacklogStrategy implements BacklogBackendStrategy {
  readonly key = "local" as const;
  readonly displayName = "Local Markdown files (.specflow/backlog/)";

  initConfigStub(): string | null {
    return null;
  }

  initConfigMessages(): readonly string[] {
    return [];
  }
}
