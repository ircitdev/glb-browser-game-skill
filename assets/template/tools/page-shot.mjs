// node tools/page-shot.mjs <имя-страницы-в-dist> <ширина> <высота> — снимок страницы после title=READY.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from './chrome.mjs';
const [name, w, h] = [process.argv[2], +process.argv[3], +process.argv[4]];
const wait = ms => new Promise(r => setTimeout(r, ms));
const chrome = await launchChrome({ width: w, height: h });
const ws = new WebSocket(chrome.target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
const cdp = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: pathToFileURL(resolve(`dist/${name}.html`)).href });
  let t = '';
  for (let i = 0; i < 80 && t !== 'READY' && t !== 'ERROR'; i++) { await wait(250); t = (await cdp('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result.value; }
  await wait(500);
  const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(`dist/${name}.png`), Buffer.from(r.data, 'base64'));
  console.log(t, `dist/${name}.png`);
} finally { await chrome.close(); }
process.exit(0);
