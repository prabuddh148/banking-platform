// Screenshots the provisioned Grafana dashboards with headless Chrome over the DevTools protocol.
// No npm dependencies (Node 22+ has fetch and WebSocket built in).
//
//   node load-tests/e2e/grafana-screenshots.mjs <outDir>
//
// Env: CHROME (browser binary, default google-chrome), GRAFANA_URL (http://localhost:3000),
//      RANGE (Grafana time range "from", default now-15m), WAIT_MS (render wait per dashboard, 12000)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUT = process.argv[2] || 'grafana-screenshots';
const CHROME = process.env.CHROME || 'google-chrome';
const GRAFANA = (process.env.GRAFANA_URL || 'http://localhost:3000').replace(/\/$/, '');
const RANGE = process.env.RANGE || 'now-15m';
const WAIT_MS = parseInt(process.env.WAIT_MS || '12000', 10);
const PORT = 9333;

const DASHBOARDS = [
  { uid: 'banking-service-health', file: 'grafana-service-health.png', height: 2000 },
  { uid: 'banking-transaction-overview', file: 'grafana-transaction-overview.png', height: 1500 },
  { uid: 'banking-kafka-metrics', file: 'grafana-kafka-metrics.png', height: 1500 },
  { uid: 'banking-fraud-monitoring', file: 'grafana-fraud-monitoring.png', height: 1500 },
];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'chrome-'))}`,
  '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' });

async function pageSocket() {
  for (let i = 0; i < 100; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('browser did not start');
}

const ws = new WebSocket(await pageSocket());
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});

try {
  await send('Page.enable');
  for (const d of DASHBOARDS) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: d.height, deviceScaleFactor: 1, mobile: false });
    const url = `${GRAFANA}/d/${d.uid}/x?orgId=1&from=${RANGE}&to=now&kiosk&theme=dark`;
    await send('Page.navigate', { url });
    await sleep(WAIT_MS); // panels query Prometheus asynchronously
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, d.file), Buffer.from(data, 'base64'));
    console.log(`saved ${d.file}  (${url})`);
  }
} finally {
  ws.close();
  browser.kill();
}
