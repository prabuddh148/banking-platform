# syntax=docker/dockerfile:1.7
# -----------------------------------------------------------------------------
# api-gateway image (multi-stage).
#
# The BUILD CONTEXT MUST BE THE REPO ROOT, because this is a multi-module Maven
# project and the service needs the parent pom + common-library to compile:
#
#   docker build -f api-gateway/Dockerfile -t banking/api-gateway .
#
# (docker-compose does this for you with `context: ..` and
#  `dockerfile: api-gateway/Dockerfile`).
# -----------------------------------------------------------------------------

ARG SERVICE=api-gateway

# ---------- Stage 1: build the jar with Maven ----------
FROM maven:3.9-eclipse-temurin-21 AS build
ARG SERVICE
WORKDIR /workspace

# 1) Copy only the pom files first. Maven needs EVERY module pom listed in the
#    root pom to build the reactor, even the modules we don't build.
COPY pom.xml ./
COPY common-library/pom.xml common-library/
COPY account-service/pom.xml account-service/
COPY transaction-service/pom.xml transaction-service/
COPY fraud-service/pom.xml fraud-service/
COPY audit-service/pom.xml audit-service/
COPY notification-service/pom.xml notification-service/
COPY api-gateway/pom.xml api-gateway/

# 2) Copy the sources we actually need: the shared library + this service.
COPY common-library/src common-library/src
COPY ${SERVICE}/src ${SERVICE}/src

# 3) Build only this service and what it depends on (-am = "also make").
#    The cache mount keeps ~/.m2 between builds so dependencies download once.
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -q -pl ${SERVICE} -am -DskipTests package \
 && cp ${SERVICE}/target/${SERVICE}-*.jar /workspace/app.jar

# ---------- Stage 2: small runtime image (JRE only) ----------
FROM eclipse-temurin:21-jre
ARG SERVICE
ENV SERVICE_NAME=${SERVICE} \
    SERVER_PORT=8080 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+UseG1GC -XX:+ExitOnOutOfMemoryError -Djava.security.egd=file:/dev/./urandom"

# curl is used by the HEALTHCHECK below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app --home-dir /app --shell /usr/sbin/nologin app

WORKDIR /app
COPY --from=build --chown=app:app /workspace/app.jar /app/app.jar

# Never run the JVM as root.
USER app

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fsS "http://localhost:${SERVER_PORT}/actuator/health" || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
