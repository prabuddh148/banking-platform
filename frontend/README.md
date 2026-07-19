# Meridian — Banking Platform Frontend

A unified **customer + admin** web UI for the banking platform, built with
**React + Vite + Tailwind CSS** (JavaScript). It runs entirely on **mock data** —
no backend is required. When the microservices are ready, swap the mock module
for real API calls.

## Requirements

- Node.js 18+ and npm

## Run it

```bash
cd frontend
npm install
npm run dev
```

Vite serves the app at **http://localhost:5173** (it opens automatically).

Other scripts:

```bash
npm run build     # production build → dist/
npm run preview   # serve the production build locally
```

## Using the app

The top-right **Customer / Admin** toggle switches between the two shells; the
sidebar and routes change to match.

**Customer**
- `/` — Overview: net worth, balance trend, spending, recent activity
- `/accounts` — Account cards with balances & credit utilization
- `/transfer` — Move money between accounts (validated form)
- `/transactions` — Searchable, filterable transaction history
- `/notifications` — Alerts feed (unread badge syncs with the topbar)

**Admin**
- `/admin` — Ops dashboard: platform metrics, txn volume, service health, Kafka lag
- `/admin/accounts` — Customer account directory
- `/admin/transactions` — Transaction monitor with fraud flags
- `/admin/fraud` — Fraud case queue (clear / block cases)
- `/admin/audit` — Immutable audit event trail
- `/admin/services` — Per-service health, latency, and instances

## Project structure

```
frontend/
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── vite.config.js
└── src/
    ├── main.jsx                # entry + providers/router
    ├── App.jsx                 # routes
    ├── index.css               # Tailwind + component classes
    ├── context/AppContext.jsx  # role switch, notifications, toasts
    ├── data/mockData.js        # ALL data — replace with API calls later
    ├── lib/format.js           # currency/date helpers
    ├── components/
    │   ├── layout/             # Sidebar, Topbar, Layout
    │   └── ui/Primitives.jsx   # Card, StatCard, Badge, charts…
    └── pages/
        ├── customer/           # 5 customer pages
        └── admin/              # 6 admin pages
```

## Connecting a real backend

All data is imported from [`src/data/mockData.js`](src/data/mockData.js). To go
live, replace those exports with `fetch` calls to the API gateway (e.g.
`http://localhost:8080`) — the components consume plain arrays/objects, so their
shape is the only contract to preserve. Charts and tables are hand-rolled SVG/CSS,
so there are no extra chart libraries to configure.

> All figures, customers, and cases shown are fictional sample data.
