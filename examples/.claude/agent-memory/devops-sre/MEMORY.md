# Memory Index

- [project_cloud_sql_state.md](project_cloud_sql_state.md) — Cloud SQL is ZONAL (no HA), PG18, `db-custom-1-3840`; task 057 will harden before launch
- [feedback_gcp_logging_metric_filters.md](feedback_gcp_logging_metric_filters.md) — Never use resource.label.* in log-based metric filters; never set metricDescriptor on simple counters (@pulumi/gcp v8 bug)
- [project_spec202_infra_audit.md](project_spec202_infra_audit.md) — Spec 202 audit done 2026-04-22; accepted risks documented (SBFM skip, public buckets, no CORS); open items: objectAdmin scope, token scopes, cache-key query strings
