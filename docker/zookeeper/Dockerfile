# ZooKeeper - coordination service used by the Kafka broker (ZooKeeper mode).
# The official image uses /conf/zoo.cfg as-is when the file exists, so the
# config in ./config/zoo.cfg is the real, authoritative configuration.
FROM zookeeper:3.8.4

COPY config/zoo.cfg /conf/zoo.cfg

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=10 \
  CMD zkServer.sh status || exit 1
