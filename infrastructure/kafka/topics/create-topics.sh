#!/usr/bin/env bash
# =============================================================================
# Banking Platform - Kafka Topic Creation Script
# =============================================================================
# Creates all required Kafka topics for the banking platform.
#
# Usage:
#   ./create-topics.sh
#
# Environment variables:
#   KAFKA_BOOTSTRAP_SERVERS  Kafka broker address (default: localhost:9092)
#   REPLICATION_FACTOR       Replication factor (default: 1 for dev, use 3 for prod)
#   RETENTION_MS             Default log retention in ms (default: 604800000 = 7 days)
#   DLT_RETENTION_MS         DLT retention in ms (default: 2592000000 = 30 days)
# =============================================================================

set -euo pipefail

BOOTSTRAP_SERVER="${KAFKA_BOOTSTRAP_SERVERS:-localhost:9092}"
REPLICATION_FACTOR="${REPLICATION_FACTOR:-1}"
RETENTION_MS="${RETENTION_MS:-604800000}"
DLT_RETENTION_MS="${DLT_RETENTION_MS:-2592000000}"
MAX_WAIT_SECONDS=120

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }

wait_for_kafka() {
    log_info "Waiting for Kafka at ${BOOTSTRAP_SERVER} to become available..."
    local elapsed=0
    local interval=5

    until kafka-broker-api-versions.sh --bootstrap-server "${BOOTSTRAP_SERVER}" &>/dev/null; do
        if [ ${elapsed} -ge ${MAX_WAIT_SECONDS} ]; then
            log_error "Kafka did not become available within ${MAX_WAIT_SECONDS} seconds."
            exit 1
        fi
        log_warn "Kafka not ready yet, retrying in ${interval}s... (${elapsed}/${MAX_WAIT_SECONDS}s elapsed)"
        sleep ${interval}
        elapsed=$((elapsed + interval))
    done

    log_success "Kafka is available at ${BOOTSTRAP_SERVER}"
}

create_topic() {
    local topic_name="$1"
    local partitions="$2"
    local replication="$3"
    local retention="$4"

    if kafka-topics.sh \
        --bootstrap-server "${BOOTSTRAP_SERVER}" \
        --describe \
        --topic "${topic_name}" &>/dev/null 2>&1; then
        log_warn "Topic '${topic_name}' already exists, skipping."
        return 0
    fi

    kafka-topics.sh \
        --bootstrap-server "${BOOTSTRAP_SERVER}" \
        --create \
        --topic "${topic_name}" \
        --partitions "${partitions}" \
        --replication-factor "${replication}" \
        --config retention.ms="${retention}" \
        --config min.insync.replicas=1 \
        --config cleanup.policy=delete

    log_success "Created topic: ${topic_name} (partitions=${partitions}, replication=${replication}, retention=${retention}ms)"
}

create_dlt_topic() {
    local topic_name="$1"
    local partitions="$2"
    local replication="$3"

    if kafka-topics.sh \
        --bootstrap-server "${BOOTSTRAP_SERVER}" \
        --describe \
        --topic "${topic_name}" &>/dev/null 2>&1; then
        log_warn "DLT topic '${topic_name}' already exists, skipping."
        return 0
    fi

    kafka-topics.sh \
        --bootstrap-server "${BOOTSTRAP_SERVER}" \
        --create \
        --topic "${topic_name}" \
        --partitions "${partitions}" \
        --replication-factor "${replication}" \
        --config retention.ms="${DLT_RETENTION_MS}" \
        --config min.insync.replicas=1 \
        --config cleanup.policy=delete

    log_success "Created DLT topic: ${topic_name} (partitions=${partitions}, replication=${replication}, retention=${DLT_RETENTION_MS}ms)"
}

main() {
    echo ""
    echo "============================================================"
    echo "  Banking Platform - Kafka Topic Setup"
    echo "============================================================"
    echo "  Bootstrap Server  : ${BOOTSTRAP_SERVER}"
    echo "  Replication Factor: ${REPLICATION_FACTOR}"
    echo "  Default Retention : ${RETENTION_MS}ms"
    echo "  DLT Retention     : ${DLT_RETENTION_MS}ms"
    echo "============================================================"
    echo ""

    wait_for_kafka

    echo ""
    log_info "Creating primary topics..."
    echo "------------------------------------------------------------"

    create_topic "account.created"         6  "${REPLICATION_FACTOR}" "${RETENTION_MS}"
    create_topic "account.status.changed"  6  "${REPLICATION_FACTOR}" "${RETENTION_MS}"
    create_topic "transaction.initiated"   12 "${REPLICATION_FACTOR}" "${RETENTION_MS}"
    create_topic "transaction.processing"  12 "${REPLICATION_FACTOR}" "${RETENTION_MS}"
    create_topic "transaction.completed"   12 "${REPLICATION_FACTOR}" "${RETENTION_MS}"
    create_topic "transaction.failed"      12 "${REPLICATION_FACTOR}" "${RETENTION_MS}"
    create_topic "fraud.decision"          12 "${REPLICATION_FACTOR}" "${RETENTION_MS}"
    create_topic "fraud.detected"          6  "${REPLICATION_FACTOR}" "${RETENTION_MS}"
    create_topic "notification.requested"  6  "${REPLICATION_FACTOR}" "${RETENTION_MS}"

    echo ""
    log_info "Creating Dead Letter Topics (DLT)..."
    echo "------------------------------------------------------------"

    create_dlt_topic "account.created.DLT"         6 "${REPLICATION_FACTOR}"
    create_dlt_topic "account.status.changed.DLT"  6 "${REPLICATION_FACTOR}"
    create_dlt_topic "transaction.initiated.DLT"   6 "${REPLICATION_FACTOR}"
    create_dlt_topic "transaction.processing.DLT"  6 "${REPLICATION_FACTOR}"
    create_dlt_topic "transaction.completed.DLT"   6 "${REPLICATION_FACTOR}"
    create_dlt_topic "transaction.failed.DLT"      6 "${REPLICATION_FACTOR}"
    create_dlt_topic "fraud.decision.DLT"          6 "${REPLICATION_FACTOR}"
    create_dlt_topic "fraud.detected.DLT"          6 "${REPLICATION_FACTOR}"
    create_dlt_topic "notification.requested.DLT"  6 "${REPLICATION_FACTOR}"

    echo ""
    log_info "Listing all topics:"
    echo "------------------------------------------------------------"
    kafka-topics.sh --bootstrap-server "${BOOTSTRAP_SERVER}" --list | sort

    echo ""
    log_success "All Kafka topics created successfully!"
    echo "============================================================"
}

main "$@"