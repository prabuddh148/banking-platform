# API Versioning Policy

This policy covers the public REST APIs exposed through the api-gateway. Event (Kafka) versioning is
covered separately in [schema-evolution-policy](../events/schema-evolution-policy.md).

## 1. Version in the URL path

All endpoints are versioned in the path: `/api/v{major}/...`. The current version is **v1**:

| Service | Base path |
|---------|-----------|
| api-gateway (auth, system) | `/api/v1/auth`, `/api/v1/system` |
| account-service | `/api/v1/accounts` |
| transaction-service | `/api/v1/transactions` |
| fraud-service | `/api/v1/fraud` |
| notification-service | `/api/v1/notifications` |
| audit-service | `/api/v1/audit` |

Only the **major** version is in the URL. Minor and patch versions are tracked in the `info.version`
field of each OpenAPI file in this folder.

## 2. What is a breaking change?

A change is **breaking** (needs a new major version, e.g. `/api/v2`) if an existing, correct client
could stop working:

- Removing or renaming an endpoint, field, query parameter or enum value.
- Changing a field's type or format (e.g. `amount` from number to string).
- Making an optional request field required, or adding a new required field.
- Changing the meaning of a status code or of an existing field.
- Changing the `ApiResponse` / `ErrorResponse` / `PagedResponse` envelope.
- Tightening validation (e.g. lowering the maximum transfer amount) in a way that rejects requests
  that were valid before.

## 3. Non-breaking (additive) changes

These are allowed inside v1 and bump the minor version in the OpenAPI file:

- Adding a new endpoint.
- Adding an **optional** request field or query parameter.
- Adding a new field to a response.
- Adding a new `ErrorCode` value.

Because of this, **clients must ignore unknown response fields** and must handle unknown error codes
by looking at the HTTP status.

> Adding an enum value to a *response* (e.g. a new transaction status) is technically additive but
> can break clients that `switch` on it. We announce such changes in the changelog before release.

## 4. Running two versions side by side

When a v2 is needed:

1. Add new controllers under `/api/v2/...` in the same service. v1 and v2 share the service layer.
2. Add the v2 route to the gateway; keep v1 routes unchanged.
3. Publish the v2 OpenAPI file next to the v1 file (e.g. `account-service-api.v2.yaml`).
4. Mark v1 as deprecated (see below).

## 5. Deprecation

- Deprecated endpoints keep working for at least **6 months** (or 2 releases, whichever is longer).
- Deprecated operations are marked `deprecated: true` in the OpenAPI file.
- Responses from deprecated endpoints include the headers
  `Deprecation: true` and `Sunset: <HTTP date>`, plus a `Link` header pointing to the replacement.
- The frontend is migrated before the sunset date.
- After the sunset date the route is removed from the gateway first, then the code.

## 6. Contract-first workflow

1. Change the OpenAPI file in `docs/api-contracts/` in the same pull request as the code.
2. Reviewers check the change against sections 2 and 3.
3. Controller tests (`@WebMvcTest`) assert the response shape for important endpoints.
