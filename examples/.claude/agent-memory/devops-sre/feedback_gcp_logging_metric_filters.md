---
name: GCP log-based metric filter constraints
description: The GCP Logging Metrics API rejects resource.label.* in filters; resource.type is the only resource field allowed. Also: metricDescriptor with any sub-field triggers a provider bug in @pulumi/gcp v8.
type: feedback
---

Two hard constraints discovered when creating `gcp.logging.Metric` resources (task 087):

**Rule 1: Never use `resource.label.*` in log-based metric filters.**
The GCP Logging Metrics API rejects filters containing `resource.label.<field>` fields (e.g., `resource.label.service_name="miximodel"`) with `Error 400: Field not found: 'label'`. Only `resource.type` is accepted. Scope to the right resource type and rely on `jsonPayload.msg` pattern specificity for narrowing.

**Why:** GCP Logging Metrics API treats the `MonitoredResource` differently from live log queries — `resource.label` fields are valid in `gcloud logging read` but not in metric filters.

**How to apply:** When writing `gcp.logging.Metric` filters, only use:
- `resource.type="<type>"` (e.g., `cloud_run_revision`)
- `jsonPayload.*`, `textPayload`, `severity`, `logName`, `timestamp`, `httpRequest.*`
Never add `resource.label.service_name` or similar.

**Rule 2: Never set `metricDescriptor` on a simple counter metric.**
Providing `metricDescriptor` (even with only `metricKind`, `valueType`, `unit`) causes `@pulumi/gcp` v8 (google-beta provider) to include a `label` proto field in the API request, which the REST API rejects with the same `Field not found: 'label'` error.

**Why:** google-beta provider bug in v8.41.1 — always serializes the `labels` sub-field even when empty.

**How to apply:** For DELTA/INT64/unit=1 counter metrics (the default), omit `metricDescriptor` entirely. Only include it when you actually need custom labels, distribution buckets, or a non-default unit.

**Rule 3: Alert policies referencing new log-based metrics must wait for propagation.**
GCP requires up to 10 minutes for a newly created log-based metric to become available for use in AlertPolicy conditions. If `pulumi up` creates metrics and alert policies in the same run, some alert policies will fail with `Cannot find metric(s)`. Workaround: run `pulumi up` twice (metrics first, then alert policies after propagation).
