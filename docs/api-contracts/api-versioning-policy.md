# API Versioning Policy

**Applies to**: All Banking Platform services exposed through the API Gateway  
**Version**: 1.0  
**Last Updated**: 2024-01-22  
**Owner**: Platform Architecture Team

---

## Overview

This document defines the API versioning strategy for the Banking Platform. All public-facing APIs must follow this policy. The goals are:

1. Allow the platform to evolve without breaking existing API consumers.
2. Provide a clear, predictable process for introducing breaking changes.
3. Give consumers sufficient warning and migration time before old versions are removed.

---

## Versioning Strategy

The Banking Platform uses **URI-based versioning**. The API version is embedded in the URL path:

```
/api/v{major}/{resource}
```

Examples:
```
GET  /api/v1/accounts/{id}
POST /api/v1/transactions/transfer
GET  /api/v1/fraud/status/{transactionId}
GET  /api/v2/accounts/{id}          ← future breaking change
```

### Why URI Versioning (Not Header Versioning)

| Criterion | URI Versioning | Header Versioning (`Accept: application/vnd.bank.v2+json`) |
|---|---|---|
| Simplicity | High — visible in URL | Low — hidden in headers |
| Cacheability | High — URL is the cache key | Low — requires `Vary: Accept` header |
| Debuggability | High — visible in logs, browser, curl | Low — requires header inspection |
| REST purity | Lower — version in URL mixes concerns | Higher — content negotiation is semantic |
| Adoption | Widely understood by consumers | Requires consumer sophistication |

URI versioning was chosen for simplicity, cacheability, and debuggability. REST purity is a lower priority than operational simplicity for a team of this size.

---

## Current Version

**All services are currently at v1.**

| Service | Base Path | Current Version | Port |
|---|---|---|---|
| account-service | `/api/v1/accounts` | v1 | 8081 (internal) |
| transaction-service | `/api/v1/transactions` | v1 | 8082 (internal) |
| fraud-service | `/api/v1/fraud` | v1 | 8083 (internal) |
| notification-service | `/api/v1/notifications` | v1 | 8084 (internal) |
| audit-service | `/api/v1/audit` | v1 | 8085 (internal) |

All services are accessed externally through the API Gateway at port 8080. Internal ports are not publicly exposed.

---

## API Gateway Routing

The gateway routes requests based on the URI prefix:

| Incoming Request | Routed To | Notes |
|---|---|---|
| `/api/v1/accounts/**` | `account-service:8081` | Includes `/api/v1/accounts/me` |
| `/api/v1/transactions/**` | `transaction-service:8082` | Transfer, history, status |
| `/api/v1/fraud/**` | `fraud-service:8083` | Internal use; auth-gated |
| `/api/v1/notifications/**` | `notification-service:8084` | Preference management |
| `/api/v1/audit/**` | `audit-service:8085` | Admin role required |
| `/auth/**` | `account-service:8081` | Login, register, token refresh (no version prefix) |

The gateway strips the `/api/v1/` prefix before forwarding. Internal services receive the path without the version prefix.

---

## Backward Compatibility Rules

Within a major version (e.g., v1), **only additive, backward-compatible changes are allowed**. Consumers must be able to upgrade their client library without any code changes when only additive changes are made.

### Allowed Changes (Non-Breaking)

The following changes may be deployed to v1 without creating a new version:

- **Adding new optional request fields**: Existing consumers that do not send the new field continue to work. New fields must have documented default behavior when absent.
- **Adding new response fields**: Existing consumers that do not read the new field continue to work. JSON parsers must ignore unknown fields (use `@JsonIgnoreProperties(ignoreUnknown = true)` in Java clients).
- **Adding new endpoints**: New endpoints (new URL paths) do not affect existing consumers of other endpoints.
- **Adding new optional query parameters**: Existing consumers that do not pass the parameter receive the default behavior.
- **Relaxing validation rules**: Accepting previously rejected values is backward-compatible (e.g., increasing a maximum length).

### Prohibited Changes (Breaking — Require New Version)

The following changes are **never allowed within an existing version**:

- Removing or renaming an existing request field
- Removing or renaming an existing response field
- Changing the type of an existing field (e.g., `amount: number` → `amount: string`)
- Changing the meaning of an existing field
- Making a previously optional field required
- Removing an existing endpoint
- Changing an endpoint URL (without maintaining the old URL as an alias)
- Tightening validation rules (e.g., reducing maximum length, adding required format constraints)
- Changing HTTP method for an existing endpoint
- Changing success HTTP status codes (e.g., 200 → 201)

---

## Breaking Change Process

When a breaking change is necessary:

1. **Create a new version** (`/api/v2/`) for the affected service(s). Only the endpoints that changed need a v2; unchanged endpoints remain on v1.

2. **Announce deprecation of v1**: Add the `X-Deprecated` header to v1 responses (see Deprecation Notices below). Update the OpenAPI spec to mark deprecated endpoints. Publish to the team changelog.

3. **Maintain v1 for 6 months**: v1 and v2 both remain operational for a minimum deprecation period of 6 calendar months. This gives all consumers time to migrate.

4. **Monitor v1 usage**: Track v1 endpoint call volume via Prometheus metrics (`http_requests_total{path=~"/api/v1/.*"}`). Do not sunset v1 while there is measurable traffic.

5. **Sunset v1**: After the 6-month deprecation period and with confirmed zero traffic, remove v1 from the gateway routing configuration. Log the sunset in the changelog and in the ADR for this change.

---

## Deprecation Notices

When a version or specific endpoint is deprecated, the following signals are provided:

### Response Header

Every response from a deprecated endpoint includes:

```
X-Deprecated: true
X-Deprecated-Message: This endpoint is deprecated. Migrate to /api/v2/accounts/{id} by 2025-06-01.
X-Sunset: 2025-06-01
```

### OpenAPI Spec

Deprecated endpoints are marked with `deprecated: true` in the OpenAPI YAML:

```yaml
paths:
  /accounts/{id}:
    get:
      summary: Get account by ID
      deprecated: true
      description: "Deprecated. Use /api/v2/accounts/{id}. Sunset: 2025-06-01."
```

### Changelog

All deprecations are documented in `CHANGELOG.md` at the repository root with:
- Date of deprecation announcement
- Sunset date
- Migration guide link

---

## Version Lifecycle

| Version | Status | Services | Available Since | Sunset Date |
|---|---|---|---|---|
| v1 | Current (Active) | All services | 2024-01-22 | Not scheduled |
| v2 | Not yet created | N/A | — | — |

---

## Content Type

All Banking Platform API endpoints use `application/json` for both request bodies and responses.

```
Content-Type: application/json
Accept: application/json
```

File upload endpoints (e.g., future document upload) may use `multipart/form-data`. This will be documented per-endpoint in the OpenAPI spec.

Date-time values use **ISO 8601 format** with UTC timezone: `2024-01-15T10:30:00Z`.
Monetary amounts use **string representation** to avoid floating-point precision loss: `"amount": "150.00"` with a separate `"currency": "USD"` field.

---

## Standard Error Response Format

All services return a consistent error response format using the `ErrorResponse` class from `common-library`. There are no service-specific error formats.

```json
{
  "errorCode": "RESOURCE_NOT_FOUND",
  "message": "Account not found: acc_01HV3KZQM4XVYP0",
  "path": "/api/v1/accounts/acc_01HV3KZQM4XVYP0",
  "timestamp": "2024-01-15T10:30:00Z",
  "fieldErrors": null
}
```

For validation errors, `fieldErrors` is populated:

```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "Request validation failed",
  "path": "/api/v1/transactions/transfer",
  "timestamp": "2024-01-15T10:30:00Z",
  "fieldErrors": [
    {
      "field": "amount",
      "rejectedValue": "-50.00",
      "message": "Amount must be greater than zero"
    },
    {
      "field": "toAccountId",
      "rejectedValue": null,
      "message": "Destination account ID is required"
    }
  ]
}
```

### Standard Error Codes

| Error Code | HTTP Status | Description |
|---|---|---|
| `RESOURCE_NOT_FOUND` | 404 | The requested resource does not exist |
| `VALIDATION_FAILED` | 400 | Request body or parameters failed validation |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication token |
| `FORBIDDEN` | 403 | Authenticated user lacks permission for this action |
| `CONFLICT` | 409 | State conflict (e.g., duplicate transfer, account already closed) |
| `INSUFFICIENT_FUNDS` | 422 | Account balance is insufficient for the requested transfer |
| `FRAUD_REJECTED` | 422 | Transfer rejected by fraud detection |
| `FRAUD_CHECK_TIMEOUT` | 422 | Fraud check did not complete within the timeout window |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests from this client |
| `INTERNAL_ERROR` | 500 | Unexpected server error (details in server logs, not response) |

---

## OpenAPI Specifications

Full endpoint documentation is available as OpenAPI 3.0 YAML files in this directory:

| File | Service | Description |
|---|---|---|
| `account-service-api.yaml` | account-service | Account creation, balance, profile management |
| `transaction-service-api.yaml` | transaction-service | Transfers, transaction history, status |
| `fraud-service-api.yaml` | fraud-service | Rule management (admin only) |
| `notification-service-api.yaml` | notification-service | Notification preferences |
| `audit-service-api.yaml` | audit-service | Audit log queries (admin only) |

The OpenAPI specs are the authoritative contract. The Java code must conform to the spec, not the other way around. In cases of discrepancy, the spec takes precedence and the code must be fixed.

Specs are validated against the running services in CI using an OpenAPI diff tool to detect unintentional breaking changes before merge.
