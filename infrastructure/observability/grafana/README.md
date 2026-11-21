# Grafana dashboards

Grafana is provisioned automatically by the docker stack — no clicking needed.

| What | Where |
|---|---|
| Image | `docker/grafana/Dockerfile` (`grafana/grafana:11.1.4` + provisioning files) |
| Datasource | `docker/grafana/provisioning/datasources/prometheus.yml` — Prometheus at `http://prometheus:9090`, fixed uid `prometheus` |
| Dashboard provider | `docker/grafana/provisioning/dashboards/dashboard.yml` — loads every `*.json` in that folder into the **Banking Platform** folder |
| Dashboards | `docker/grafana/provisioning/dashboards/*.json` |
| Login | http://localhost:3000 — `admin` / `admin` (override with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` in `docker/.env`). Anonymous users get read-only access. |

## Dashboards

| File | uid | Shows |
|---|---|---|
| `service-health.json` | `banking-service-health` | UP/DOWN per service, request rate, status codes, avg/max/p95 latency, heap, CPU, threads, GC, HikariCP pool. Has a **Service** variable. Home dashboard. |
| `transaction-overview.json` | `banking-transaction-overview` | Deposit / withdraw / transfer submissions per minute, response codes (202 = accepted into the saga), latency, saga events consumed, events published, outbox backlog, gateway traffic per route. |
| `kafka-metrics.json` | `banking-kafka-metrics` | Consumer lag per service/topic, records consumed/sent, `@KafkaListener` success/failure and timing, `KafkaTemplate` sends, producer errors, rebalances. Has a **Service** variable. |
| `fraud-monitoring.json` | `banking-fraud-monitoring` | Transactions screened, screening failures and time, fraud consumer lag, decisions by outcome/risk level, alert review activity, fraud API traffic, fraud-service resources. |

## Metrics used

All panels use the standard metric names produced by Spring Boot Actuator +
Micrometer (`micrometer-registry-prometheus`), scraped from
`/actuator/prometheus`. Prometheus sets the `job` label to the service name.

| Metric | Source |
|---|---|
| `up` | Prometheus scrape status |
| `http_server_requests_seconds_count/_sum/_max` | Spring MVC / WebFlux server metrics (tags `uri`, `method`, `status`, `outcome`) |
| `http_server_requests_seconds_bucket` | Only when `management.metrics.distribution.percentiles-histogram.http.server.requests=true` (p95 panels) |
| `jvm_memory_*`, `jvm_threads_*`, `jvm_gc_pause_seconds_*`, `process_cpu_usage`, `process_uptime_seconds` | JVM / process binders |
| `hikaricp_connections_*` | HikariCP pool |
| `spring_kafka_listener_seconds_*`, `spring_kafka_template_seconds_*` | Spring Kafka observation timers (tags `name`, `result`) |
| `kafka_consumer_fetch_manager_records_lag_max`, `kafka_consumer_fetch_manager_records_consumed_total`, `kafka_producer_*` | Kafka client metrics bound by Spring Boot's Kafka auto-configuration |

Two panels use **custom** metrics. They show "No data" until a service registers them:

| Metric | Expected registration |
|---|---|
| `outbox_events_pending` | `Gauge.builder("outbox.events.pending", repo, r -> r.countByStatus(PENDING))` in account-service and transaction-service (also used by the `Outbox*` alerts) |
| `fraud_decisions_total` | `Counter.builder("fraud.decisions").tag("decision", ...).tag("riskLevel", ...)` in fraud-service |

## Editing a dashboard

1. Change it in the UI (provisioned dashboards allow UI edits, but they are **not** written back to disk).
2. *Share → Export → Save to file*, keep "Export for sharing externally" **off** (so the datasource stays `uid: prometheus`).
3. Replace the JSON file in `docker/grafana/provisioning/dashboards/` and rebuild: `docker compose up -d --build grafana`.

Validate JSON before committing:

```bash
node -e "JSON.parse(require('fs').readFileSync('docker/grafana/provisioning/dashboards/service-health.json'))"
```

Related: alert rules live in `docker/prometheus/config/alert-rules.yml`, recording rules in `infrastructure/observability/prometheus/recording-rules.yml`.
