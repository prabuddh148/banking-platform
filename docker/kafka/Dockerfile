# Kafka broker (Confluent Platform 7.6 = Apache Kafka 3.6, ZooKeeper mode).
#
# The cp-kafka image normally generates its config from KAFKA_* env vars.
# We bypass that and start the broker directly with OUR server.properties and
# log4j.properties, so the files in ./config are the real configuration.
#
# Listeners (see server.properties):
#   kafka:29092      -> containers on the docker network (the services)
#   localhost:9092   -> tools / services running on your host (IDE)
FROM confluentinc/cp-kafka:7.6.1

COPY --chown=appuser:appuser config/server.properties /etc/kafka/custom/server.properties
COPY --chown=appuser:appuser config/log4j.properties  /etc/kafka/custom/log4j.properties

ENV KAFKA_LOG4J_OPTS="-Dlog4j.configuration=file:/etc/kafka/custom/log4j.properties"

EXPOSE 9092 29092

HEALTHCHECK --interval=10s --timeout=10s --start-period=30s --retries=12 \
  CMD kafka-broker-api-versions --bootstrap-server localhost:29092 > /dev/null 2>&1 || exit 1

ENTRYPOINT ["kafka-server-start"]
CMD ["/etc/kafka/custom/server.properties"]
