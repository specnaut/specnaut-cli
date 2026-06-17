import type { BacklogBackendStrategy } from "../backlog_backend_strategy.ts";
import { renderCloudConfig } from "../cloud/cloud_config.ts";

export class CloudBacklogStrategy implements BacklogBackendStrategy {
  readonly key = "cloud" as const;
  readonly displayName = "Specnaut Cloud (real-time API — browser login)";

  // The config holds only non-secret coordinates (backend / api_url /
  // project_key). Credentials are obtained by `specnaut cloud login` (device
  // flow) and stored in the OS keychain — never written here. api_url +
  // project_key start empty and are filled in by `cloud login`.
  initConfigStub(): string {
    return renderCloudConfig();
  }

  initConfigMessages(): readonly string[] {
    return [
      "↳ wrote .specnaut/backlog-config.yml (backend: cloud)",
      "  next: run `specnaut cloud login` to authenticate and link a Cloud project",
    ];
  }
}
