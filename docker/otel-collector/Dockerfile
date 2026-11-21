# OpenTelemetry Collector (contrib distribution).
# Receives OTLP traces/metrics from the services (when TRACING_ENABLED=true),
# batches them, logs traces and re-exposes metrics for Prometheus on :8889.
FROM otel/opentelemetry-collector-contrib:0.105.0

COPY config/otel-collector.yml /etc/otelcol-contrib/config.yaml

# 4317 OTLP gRPC, 4318 OTLP HTTP, 8888 collector self-metrics,
# 8889 Prometheus exporter, 13133 health_check extension
EXPOSE 4317 4318 8888 8889 13133

CMD ["--config=/etc/otelcol-contrib/config.yaml"]
