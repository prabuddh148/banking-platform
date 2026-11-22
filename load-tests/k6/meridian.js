// -----------------------------------------------------------------------------
// meridian.js - k6 load test for the Meridian banking platform (through the gateway).
//
// What it measures:
//   1. HTTP latency + throughput of the read APIs (accounts, balance, history, /me)
//   2. HTTP latency of the write API (POST /transactions/transfer -> 202 Accepted)
//   3. END-TO-END saga time: transfer accepted -> status COMPLETED/FAILED
//      (fraud check -> balance update -> outbox -> Kafka hops), via a custom metric
//   4. Login cost (BCrypt is deliberately slow)
//
// Run (stack must be up, gateway on :8080):
//   k6 run load-tests/k6/meridian.js                          # default "load" profile
//   k6 run -e PROFILE=smoke  load-tests/k6/meridian.js        # 1 min sanity check
//   k6 run -e PROFILE=stress load-tests/k6/meridian.js        # ramps until it hurts
//   k6 run -e BASE_URL=http://<vm-ip> load-tests/k6/meridian.js
//
// Env vars: BASE_URL (http://localhost:8080), PROFILE (smoke|load|stress),
//   ACCOUNTS (source/destination account pairs created in setup, default 20),
//   DRAIN_SECONDS (wait before the final status count, default 20),
//   SUMMARY_FILE (JSON summary path, default ./k6-summary-<profile>.json)
//
// Fraud rules are kept quiet on purpose: amounts 100-499 (no AmountThreshold / PatternAnomaly),
// no X-Client-Country (no GeographicRule). VelocityRule (+30) and the night rule (+10) can still
// fire, which stays below the REVIEW threshold (60), so every transfer should COMPLETE.
// -----------------------------------------------------------------------------
import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import exec from 'k6/execution';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const PROFILE = __ENV.PROFILE || 'load';
const ACCOUNTS = parseInt(__ENV.ACCOUNTS || '20', 10);
const DRAIN_SECONDS = parseInt(__ENV.DRAIN_SECONDS || '20', 10);
const SAGA_POLL_MS = 250;
const SAGA_MAX_WAIT_MS = 30000;

// ---- custom metrics ---------------------------------------------------------
const sagaE2E = new Trend('saga_e2e_ms', true);           // accepted -> terminal status
const sagaCompleted = new Rate('saga_completed');          // COMPLETED / all finished-or-timed-out
const sagaTimeouts = new Counter('saga_timeouts');         // still not terminal after 30 s
const transfersAccepted = new Counter('transfers_accepted');
const businessErrors = new Counter('business_errors');     // 4xx/5xx with an error code

// ---- load profiles ----------------------------------------------------------
const PROFILES = {
  smoke: {
    browse:    { executor: 'constant-arrival-rate', rate: 2, timeUnit: '1s', duration: '1m', preAllocatedVUs: 5 },
    transfers: { executor: 'constant-arrival-rate', rate: 1, timeUnit: '1s', duration: '1m', preAllocatedVUs: 5 },
    saga:      { executor: 'constant-vus', vus: 1, duration: '1m' },
    login:     { executor: 'constant-arrival-rate', rate: 1, timeUnit: '5s', duration: '1m', preAllocatedVUs: 2 },
  },
  load: {
    browse: {
      executor: 'ramping-arrival-rate', startRate: 5, timeUnit: '1s', preAllocatedVUs: 30, maxVUs: 100,
      stages: [{ target: 30, duration: '1m' }, { target: 30, duration: '3m' }, { target: 0, duration: '30s' }],
    },
    transfers: {
      executor: 'ramping-arrival-rate', startRate: 1, timeUnit: '1s', preAllocatedVUs: 20, maxVUs: 80,
      stages: [{ target: 10, duration: '1m' }, { target: 10, duration: '3m' }, { target: 0, duration: '30s' }],
    },
    saga:  { executor: 'constant-vus', vus: 3, duration: '4m30s' },
    login: { executor: 'constant-arrival-rate', rate: 1, timeUnit: '1s', duration: '4m30s', preAllocatedVUs: 5 },
  },
  stress: {
    browse: {
      executor: 'ramping-arrival-rate', startRate: 10, timeUnit: '1s', preAllocatedVUs: 100, maxVUs: 400,
      stages: [
        { target: 50, duration: '1m' }, { target: 100, duration: '2m' },
        { target: 200, duration: '2m' }, { target: 0, duration: '30s' },
      ],
    },
    transfers: {
      executor: 'ramping-arrival-rate', startRate: 5, timeUnit: '1s', preAllocatedVUs: 50, maxVUs: 300,
      stages: [
        { target: 20, duration: '1m' }, { target: 50, duration: '2m' },
        { target: 100, duration: '2m' }, { target: 0, duration: '30s' },
      ],
    },
    saga:  { executor: 'constant-vus', vus: 5, duration: '5m30s' },
    login: { executor: 'constant-arrival-rate', rate: 2, timeUnit: '1s', duration: '5m30s', preAllocatedVUs: 10 },
  },
};

if (!PROFILES[PROFILE]) {
  throw new Error(`Unknown PROFILE "${PROFILE}". Use smoke, load or stress.`);
}
const p = PROFILES[PROFILE];

// k6 only reports a tagged sub-metric (e.g. latency of one endpoint) when a threshold uses it,
// so every endpoint gets a "report only" threshold here; the real limits are below.
const ENDPOINTS = [
  'POST /auth/login', 'GET /auth/me', 'GET /accounts', 'GET /accounts/{id}/balance',
  'GET /transactions', 'POST /transactions/transfer', 'GET /transactions/{id}/status',
];
const reportOnly = Object.fromEntries(ENDPOINTS.flatMap((n) => [
  [`http_req_duration{name:${n}}`, ['max>=0']],
  [`http_reqs{name:${n}}`, ['count>=0']],
]));

export const options = {
  setupTimeout: '2m',
  teardownTimeout: `${DRAIN_SECONDS + 60}s`,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    browse:    { ...p.browse,    exec: 'browse' },
    transfers: { ...p.transfers, exec: 'transfer' },
    saga_e2e:  { ...p.saga,      exec: 'sagaEndToEnd' },
    login:     { ...p.login,     exec: 'login' },
  },
  thresholds: {
    ...reportOnly,
    http_req_failed:                        ['rate<0.01'],
    'http_req_duration{api:read}':           ['p(95)<300'],
    'http_req_duration{api:transfer}':       ['p(95)<500'],
    'http_req_duration{api:login}':          ['p(95)<1000'],
    saga_e2e_ms:                             ['p(95)<15000'],
    saga_completed:                          ['rate>0.99'],
    checks:                                  ['rate>0.99'],
  },
};

// ---- helpers ----------------------------------------------------------------
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function auth(token, extra = {}) {
  return { headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}`, ...extra } };
}

function withTags(params, tags) {
  return { ...params, tags: { ...(params.tags || {}), ...tags } };
}

function data(res) {
  try {
    return res.json('data');
  } catch (_) {
    return null;
  }
}

function trackError(res) {
  if (res.status >= 400) {
    let code = 'UNKNOWN';
    try { code = res.json('error.code') || code; } catch (_) { /* not JSON */ }
    businessErrors.add(1, { status: String(res.status), code });
  }
}

function doLogin(username, password) {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ username, password }),
    { headers: JSON_HEADERS, tags: { name: 'POST /auth/login', api: 'login' } },
  );
  trackError(res);
  check(res, { 'login 200': (r) => r.status === 200 });
  const d = data(res);
  return d && d.accessToken;
}

function openAccount(token, name, email, initialDeposit) {
  const res = http.post(
    `${BASE_URL}/api/v1/accounts`,
    JSON.stringify({ customerName: name, customerEmail: email, accountType: 'SAVINGS', currency: 'INR', initialDeposit }),
    withTags(auth(token), { name: 'POST /accounts', api: 'setup' }),
  );
  if (res.status !== 201) fail(`open account failed: ${res.status} ${res.body}`);
  return data(res).id;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function idempotencyKey() {
  return `k6-${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sendTransfer(ctx) {
  const i = Math.floor(Math.random() * ctx.sources.length);
  const amount = 100 + Math.floor(Math.random() * 400); // 100-499 INR
  const res = http.post(
    `${BASE_URL}/api/v1/transactions/transfer`,
    JSON.stringify({
      sourceAccountId: ctx.sources[i],
      destinationAccountId: ctx.destinations[i],
      amount,
      currency: 'INR',
      description: 'k6 load test',
    }),
    withTags(auth(ctx.rahul, { 'Idempotency-Key': idempotencyKey() }), { name: 'POST /transactions/transfer', api: 'transfer' }),
  );
  trackError(res);
  const ok = check(res, {
    'transfer 202': (r) => r.status === 202,
    'transfer PENDING': (r) => (data(r) || {}).status === 'PENDING',
  });
  if (ok) transfersAccepted.add(1);
  return ok ? data(res).id : null;
}

// ---- lifecycle --------------------------------------------------------------
export function setup() {
  const health = http.get(`${BASE_URL}/actuator/health`);
  if (health.status !== 200) fail(`gateway not healthy at ${BASE_URL}: ${health.status}`);

  const rahul = doLogin('rahul', 'password');
  const priya = doLogin('priya', 'password');
  const admin = doLogin('admin', 'admin123');
  if (!rahul || !priya || !admin) fail('login failed for a demo user');

  const sources = [];
  const destinations = [];
  for (let i = 0; i < ACCOUNTS; i++) {
    sources.push(openAccount(rahul, 'Rahul Sharma', 'rahul.sharma@example.com', 1000000));
    destinations.push(openAccount(priya, 'Priya Patel', 'priya.patel@example.com', 0));
  }
  console.log(`setup: ${ACCOUNTS} account pairs opened, profile=${PROFILE}, base=${BASE_URL}`);
  return { rahul, priya, admin, sources, destinations, startedAt: new Date().toISOString() };
}

// Scenario: customer browsing the app (read-only).
export function browse(ctx) {
  const params = auth(ctx.rahul);
  const accountId = pick(ctx.sources);
  const responses = http.batch([
    ['GET', `${BASE_URL}/api/v1/accounts?size=20`, null, withTags(params, { name: 'GET /accounts', api: 'read' })],
    ['GET', `${BASE_URL}/api/v1/accounts/${accountId}/balance`, null, withTags(params, { name: 'GET /accounts/{id}/balance', api: 'read' })],
    ['GET', `${BASE_URL}/api/v1/transactions?accountId=${accountId}&size=20`, null, withTags(params, { name: 'GET /transactions', api: 'read' })],
    ['GET', `${BASE_URL}/api/v1/auth/me`, null, withTags(params, { name: 'GET /auth/me', api: 'read' })],
  ]);
  responses.forEach(trackError);
  check(responses[0], { 'accounts 200': (r) => r.status === 200 });
  check(responses[1], { 'balance 200': (r) => r.status === 200 });
  check(responses[2], { 'history 200': (r) => r.status === 200 });
  check(responses[3], { 'me 200': (r) => r.status === 200 });
}

// Scenario: fire-and-forget transfers (measures the write API under load).
export function transfer(ctx) {
  sendTransfer(ctx);
}

// Scenario: one transfer at a time, polled until the saga finishes.
export function sagaEndToEnd(ctx) {
  const id = sendTransfer(ctx);
  if (!id) {
    sleep(1);
    return;
  }
  const start = Date.now();
  let status = 'PENDING';
  while (Date.now() - start < SAGA_MAX_WAIT_MS) {
    sleep(SAGA_POLL_MS / 1000);
    const res = http.get(
      `${BASE_URL}/api/v1/transactions/${id}/status`,
      withTags(auth(ctx.rahul), { name: 'GET /transactions/{id}/status', api: 'poll' }),
    );
    trackError(res);
    status = (data(res) || {}).status || status;
    if (status === 'COMPLETED' || status === 'FAILED') break;
  }
  const elapsed = Date.now() - start;
  if (status === 'COMPLETED' || status === 'FAILED') {
    sagaE2E.add(elapsed, { outcome: status });
    sagaCompleted.add(status === 'COMPLETED');
  } else {
    sagaTimeouts.add(1, { last_status: status });
    sagaCompleted.add(false);
  }
}

// Scenario: logins (BCrypt cost, JWT signing).
export function login() {
  doLogin(pick(['rahul', 'priya']), 'password');
}

// After the run: let the sagas drain, then count transactions by status (admin view).
export function teardown(ctx) {
  sleep(DRAIN_SECONDS);
  const counts = {};
  for (const s of ['COMPLETED', 'FAILED', 'PENDING', 'PROCESSING', 'UNDER_REVIEW']) {
    const res = http.get(
      `${BASE_URL}/api/v1/transactions?status=${s}&type=TRANSFER&size=1`,
      withTags(auth(ctx.admin), { name: 'GET /transactions (teardown)', api: 'teardown' }),
    );
    counts[s] = res.status === 200 ? (data(res) || {}).totalElements : `HTTP ${res.status}`;
  }
  console.log(`teardown (all-time TRANSFER counts, after ${DRAIN_SECONDS}s drain): ${JSON.stringify(counts)}`);
}

// ---- summary ----------------------------------------------------------------
function fmt(v, unit) {
  if (v === undefined || v === null) return '-';
  if (unit === 'ms') return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v.toFixed(1)}ms`;
  if (unit === '%') return `${(v * 100).toFixed(2)}%`;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function row(cols, widths) {
  return cols.map((c, i) => String(c).padEnd(widths[i])).join('  ');
}

export function handleSummary(summary) {
  const m = summary.metrics;
  const lines = [];
  const W = [44, 9, 9, 9, 9, 9, 9];
  lines.push('', `Meridian k6 results  (profile=${PROFILE}, base=${BASE_URL})`, '');
  lines.push(row(['latency', 'count', 'avg', 'p50', 'p95', 'p99', 'max'], W));
  lines.push('-'.repeat(110));

  const latencyKeys = Object.keys(m)
    .filter((k) => k.startsWith('http_req_duration{name:') || k === 'saga_e2e_ms')
    .sort();
  for (const k of latencyKeys) {
    const v = m[k].values;
    const name = k === 'saga_e2e_ms' ? 'SAGA end-to-end (accepted -> terminal)' : k.slice('http_req_duration{name:'.length, -1);
    const reqs = m[`http_reqs${k.slice('http_req_duration'.length)}`];
    const count = k === 'saga_e2e_ms'
      ? (m.saga_completed ? m.saga_completed.values.passes + m.saga_completed.values.fails : '-')
      : (reqs ? reqs.values.count : '');
    lines.push(row([name, count, fmt(v.avg, 'ms'), fmt(v.med, 'ms'), fmt(v['p(95)'], 'ms'), fmt(v['p(99)'], 'ms'), fmt(v.max, 'ms')], W));
  }

  const dur = summary.state.testRunDurationMs / 1000;
  lines.push('', 'totals');
  lines.push('-'.repeat(110));
  lines.push(`  run duration            ${dur.toFixed(0)}s`);
  lines.push(`  http requests           ${m.http_reqs.values.count}  (${m.http_reqs.values.rate.toFixed(1)} req/s)`);
  lines.push(`  http failure rate       ${fmt(m.http_req_failed.values.rate, '%')}`);
  lines.push(`  checks passed           ${fmt(m.checks.values.rate, '%')}`);
  if (m.transfers_accepted) {
    lines.push(`  transfers accepted      ${m.transfers_accepted.values.count}  (${m.transfers_accepted.values.rate.toFixed(1)} /s)`);
  }
  if (m.saga_completed) lines.push(`  saga completion rate    ${fmt(m.saga_completed.values.rate, '%')}`);
  lines.push(`  saga timeouts (>30s)    ${m.saga_timeouts ? m.saga_timeouts.values.count : 0}`);
  lines.push(`  error responses         ${m.business_errors ? m.business_errors.values.count : 0}`);
  lines.push(`  peak VUs                ${m.vus_max ? m.vus_max.values.max : '-'}`);

  lines.push('', 'thresholds');
  lines.push('-'.repeat(110));
  for (const [k, metric] of Object.entries(m)) {
    if (!metric.thresholds) continue;
    for (const [expr, t] of Object.entries(metric.thresholds)) {
      if (expr === 'max>=0' || expr === 'count>=0') continue; // report-only

      lines.push(`  ${t.ok ? 'PASS' : 'FAIL'}  ${k}  ${expr}`);
    }
  }
  lines.push('');

  const file = __ENV.SUMMARY_FILE || `k6-summary-${PROFILE}.json`;
  return {
    stdout: lines.join('\n'),
    [file]: JSON.stringify(summary, null, 2),
  };
}
