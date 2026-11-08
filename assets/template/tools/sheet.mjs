// Снимает dist/sheet.html в dist/sheet.png через headless Chrome.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || ({ win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe', darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }[process.platform] || 'google-chrome');
const profile = mkdtempSync(join(tmpdir(), 'glb-sheet-'));
const url = 'file:///' + resolve('dist/sheet.html').replace(/\\/g, '/');
const r = spawnSync(CHROME, ['--headless=new', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), `--user-data-dir=${profile}`, '--window-size=1600,1540', '--virtual-time-budget=30000', `--screenshot=${resolve('dist/sheet.png')}`, url], { stdio: 'ignore', timeout: 90000 });
try { rmSync(profile, { recursive: true, force: true }); } catch { /* профиль занят */ }
console.log(r.status === 0 ? 'dist/sheet.png' : `Chrome завершился с кодом ${r.status}`);
process.exit(r.status ?? 1);
