# Kafka UI - web console to browse topics, messages and consumer groups.
# Open http://localhost:8090 once the stack is up.
# Configuration comes from kafka-ui.env (env_file in docker-compose).
FROM provectuslabs/kafka-ui:v0.7.2

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=10 \
  CMD wget -q -O /dev/null http://localhost:8080/actuator/health || exit 1
