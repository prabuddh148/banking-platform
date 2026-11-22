{{/* Release-scoped name prefix, e.g. "meridian". */}}
{{- define "meridian.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "meridian.labels" -}}
app.kubernetes.io/part-of: meridian
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "meridian.secretName" -}}
{{- default (printf "%s-secrets" (include "meridian.fullname" .)) .Values.secrets.existingSecret -}}
{{- end -}}

{{- define "meridian.postgresHost" -}}
{{- if .Values.postgresql.enabled -}}
{{- printf "%s-postgresql" (include "meridian.fullname" .) -}}
{{- else -}}
{{- required "postgresql.external.host is required when postgresql.enabled=false" .Values.postgresql.external.host -}}
{{- end -}}
{{- end -}}

{{- define "meridian.postgresPort" -}}
{{- if .Values.postgresql.enabled -}}5432{{- else -}}{{ .Values.postgresql.external.port }}{{- end -}}
{{- end -}}

{{- define "meridian.kafkaBootstrap" -}}
{{- if .Values.kafka.enabled -}}
{{- printf "%s-kafka:9092" (include "meridian.fullname" .) -}}
{{- else -}}
{{- required "kafka.externalBootstrapServers is required when kafka.enabled=false" .Values.kafka.externalBootstrapServers -}}
{{- end -}}
{{- end -}}

{{/* In-cluster DNS name of one service, e.g. "meridian-account-service". */}}
{{- define "meridian.serviceHost" -}}
{{- printf "%s-%s" (include "meridian.fullname" .root) .name -}}
{{- end -}}
