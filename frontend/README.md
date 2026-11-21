# Meridian — Banking Platform Frontend

A unified **customer + admin** web UI for the banking platform, built with
**React 18 + Vite 5 + Tailwind CSS** (JavaScript, react-router). It talks to the
microservices through the **API gateway** (`/api/v1/...`). A **mock mode** keeps it
runnable without any backend.

## Requirements

- Node.js 18+ and npm
- For real data: the backend running (API gateway on `http://localhost:8080`,
  e.g. via the repo's docker compose)

## Run it

```bash
cd frontend
npm install
npm run dev            # real API (default), proxied to http://localhost:8080
```

Vite serves the app at **http://localhost:5173** (it opens automatically).

No backend? Run in mock mode:

```bash
# one-off (Git Bash / macOS / Linux)
VITE_USE_MOCK=true npm run dev
# or permanently: copy .env.example to .env.local and set VITE_USE_MOCK=true
```

Other scripts:

```bash
npm run build     # production build → dist/
npm run preview   # serve the production build locally
```

## Configuration (`.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `VITE_USE_MOCK` | `false` | `true` = services return the bundled mock data, nothing is sent over the network |
| `VITE_API_BASE_URL` | *(empty)* | Gateway origin. Empty = same origin (`/api/...`), which the dev server proxies. Set e.g. `http://localhost:8080` for a build served elsewhere (gateway CORS must allow it) |
| `VITE_PROXY_TARGET` | `http://localhost:8080` | Dev-server proxy target for `/api` |

## Logging in

The gateway issues a JWT from `POST /api/v1/auth/login`. Demo users (also shown
on the login page — click one to fill the form):

| Username | Password | Role |
|---|---|---|
| `rahul` | `password` | Customer (Rahul Sharma) |
| `priya` | `password` | Customer (Priya Patel) |
| `admin` | `admin123` | Admin + customer (Devon Ellis) |

The token and user are kept in `sessionStorage` (closing the tab logs you out) and
sent as `Authorization: Bearer …` on every call. Any **401** logs you out and
returns you to the login page. Admin pages require `ROLE_ADMIN`; admins get a
**Customer / Admin** switch in the top bar.

## Pages → API endpoints

**Customer**
- `/` — Overview: balance, money in/out, spending, recent activity
  (`GET /accounts`, `GET /accounts/{id}`, `GET /transactions`)
- `/accounts` — Account cards + **Open account** form (`POST /accounts`)
- `/transfer` — Transfer form (`POST /transactions/transfer` with an `Idempotency-Key`),
  then polls `GET /transactions/{id}/status` until `COMPLETED`, `FAILED` or
  `UNDER_REVIEW` and shows the saga history
- `/transactions` — Searchable history, CSV export (`GET /transactions[?accountId=]`)
- `/notifications` — Notification feed (`GET /notifications`, `PATCH /notifications/{id}/read`)

**Admin**
- `/admin` — Ops dashboard built from accounts, transactions, open fraud alerts and health
- `/admin/accounts` — All accounts, **freeze / unfreeze** (`POST /accounts/{id}/freeze|unfreeze`)
- `/admin/transactions` — Transaction monitor with fraud flags
- `/admin/fraud` — Fraud alerts, **approve / reject** (`GET /fraud/alerts`, `POST /fraud/alerts/{id}/review`)
- `/admin/audit` — Audit trail (`GET /audit/logs`)
- `/admin/services` — Service health (`GET /system/health` on the gateway)

(all paths above are under `/api/v1`)

## How the code is organised

```
frontend/
├── .env.example
├── vite.config.js              # dev proxy /api → gateway
└── src/
    ├── main.jsx                # Router + AuthProvider + AppProvider
    ├── App.jsx                 # routes, RequireAuth / RequireAdmin guards
    ├── lib/
    │   ├── config.js           # env flags (USE_MOCK, API_BASE_URL)
    │   ├── api.js              # fetch wrapper: token, ApiResponse unwrap, ApiError, 401 → logout
    │   ├── session.js          # token + user in sessionStorage (try/catch safe)
    │   ├── useAsync.js         # { data, loading, error, reload } hook for pages
    │   ├── format.js           # currency (INR default, per-record currency) / dates
    │   └── accountTypes.js
    ├── services/               # one file per backend service
    │   ├── authService.js  accountService.js  transactionService.js
    │   ├── fraudService.js notificationService.js auditService.js
    │   ├── systemService.js dashboardService.js
    │   ├── mappers.js          # DTO → UI helpers (SAVINGS → "Savings", masking…)
    │   └── mock/mockStore.js   # in-memory fake backend used when VITE_USE_MOCK=true
    ├── context/                # AuthContext (user/token), AppContext (notifications, toasts)
    ├── data/mockData.js        # sample data for mock mode
    ├── components/
    │   ├── auth/RouteGuards.jsx
    │   ├── layout/             # Sidebar, Topbar (logout), Layout
    │   └── ui/Primitives.jsx   # Card, StatCard, Badge, charts, Loading/Error/Empty states
    └── pages/                  # Login + customer/ + admin/
```

**Data flow:** page → `services/*.js` → `lib/api.js` → gateway. Every service
function first checks `USE_MOCK`; if set it answers from `mock/mockStore.js`,
otherwise it calls the API and maps the backend DTO to the shape the components
render (e.g. `accountType: "FIXED_DEPOSIT"` → `"Fixed Deposit"`,
`accountNumber` → `"**** 1234"`, `status: "UNDER_REVIEW"` → `"Under Review"`).
Components never see raw DTOs, so mock and real mode render identically.

**Errors:** the backend wraps responses as `{ data }` or
`{ error: { code, message, status, details } }`. `api.js` returns `data` or throws
an `ApiError` with `code`, `status` and `details` (field-level validation errors are
listed under forms). Every page has loading, empty and error (with retry) states.

> Mock-mode figures, customers and cases are fictional sample data.
