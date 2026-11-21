# Prometheus - scrapes /actuator/prometheus from every service and evaluates
# the alert rules. UI: http://localhost:9090 (Alerts tab shows rule status).
FROM prom/prometheus:v2.53.1

COPY config/prometheus.yml  /etc/prometheus/prometheus.yml
COPY config/alert-rules.yml /etc/prometheus/alert-rules.yml
# Recording rules are mounted by docker-compose from
# infrastructure/observability/prometheus/recording-rules.yml (single source of truth).

EXPOSE 9090

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -O /dev/null http://localhost:9090/-/healthy || exit 1

CMD ["--config.file=/etc/prometheus/prometheus.yml", \
     "--storage.tsdb.path=/prometheus", \
     "--storage.tsdb.retention.time=15d", \
     "--web.enable-lifecycle", \
     "--web.console.libraries=/usr/share/prometheus/console_libraries", \
     "--web.console.templates=/usr/share/prometheus/consoles"]
