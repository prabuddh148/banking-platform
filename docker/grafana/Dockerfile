# Grafana with the Prometheus datasource and the banking dashboards
# pre-provisioned. UI: http://localhost:3000 (admin / admin by default).
FROM grafana/grafana:11.1.4

COPY provisioning/ /etc/grafana/provisioning/

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -q -O /dev/null http://localhost:3000/api/health || exit 1
