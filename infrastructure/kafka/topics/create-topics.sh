#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# create-topics.sh - creates every banking topic (+ .DLT) if it doesn't exist.
# Keep in sync with topics.yaml.
#
# Used by the `kafka-init` container in docker/docker-compose*.yml, but you can
# also run it by hand:
#   KAFKA_BOOTSTRAP_SERVERS=localhost:9092 ./create-topics.sh
# Needs the Kafka CLI on PATH (`kafka-topics` from Confluent images or
# `kafka-topics.sh` from the Apache distribution).
# -----------------------------------------------------------------------------
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP_SERVERS:-localhost:9092}"
PARTITIONS="${KAFKA_TOPIC_PARTITIONS:-3}"
REPLICATION="${KAFKA_TOPIC_REPLICATION:-1}"

if command -v kafka-topics >/dev/null 2>&1; then
  KT=kafka-topics
elif command -v kafka-topics.sh >/dev/null 2>&1; then
  KT=kafka-topics.sh
else
  echo "ERROR: kafka-topics CLI not found on PATH" >&2
  exit 1
fi

# name:retention.ms
TOPICS=(
  "banking.account.events:604800000"
  "banking.transaction.events:604800000"
  "banking.fraud.events:604800000"
  "banking.notification.events:259200000"
  "banking.account.events.DLT:2592000000"
  "banking.transaction.events.DLT:2592000000"
  "banking.fraud.events.DLT:2592000000"
  "banking.notification.events.DLT:2592000000"
)

echo "Waiting for Kafka at ${BOOTSTRAP} ..."
for i in $(seq 1 30); do
  if ${KT} --bootstrap-server "${BOOTSTRAP}" --list >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Kafka not reachable at ${BOOTSTRAP}" >&2
    exit 1
  fi
  sleep 2
done

for entry in "${TOPICS[@]}"; do
  topic="${entry%%:*}"
  retention="${entry##*:}"
  echo "Creating topic ${topic} (partitions=${PARTITIONS}, rf=${REPLICATION}, retention.ms=${retention})"
  ${KT} --bootstrap-server "${BOOTSTRAP}" --create --if-not-exists \
    --topic "${topic}" \
    --partitions "${PARTITIONS}" \
    --replication-factor "${REPLICATION}" \
    --config "retention.ms=${retention}" \
    --config cleanup.policy=delete
done

echo "Topics now on the broker:"
${KT} --bootstrap-server "${BOOTSTRAP}" --list | grep '^banking\.' || true
echo "Done."
