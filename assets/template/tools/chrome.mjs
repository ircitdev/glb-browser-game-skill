// Запуск headless Chrome для автотестов на СВОЁМ порту и в одноразовом профиле.
// Порт 0 просит систему выдать свободный, его номер Chrome пишет в DevToolsActivePort внутри нашего профиля:
// так тест не может случайно подключиться к чужому окну с открытым отладочным портом.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.CHROME || ({
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] || 'google-chrome');
const wait = ms => new Promise(r => setTimeout(r, ms));

export async function launchChrome({ width, height, args = [] }) {
  const profile = mkdtempSync(join(tmpdir(), 'game-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),
    '--enable-gpu-rasterization', '--ignore-gpu-blocklist',
    // Если окно перекрыто, Chrome считает страницу скрытой и останавливает requestAnimationFrame — игра замирает.
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    `--window-size=${width},${height}`, ...args, 'about:blank',
  ], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    await wait(250);
    try {
      const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
    } catch { /* ещё стартует */ }
  }
  const close = async () => { proc.kill(); await wait(600); try { rmSync(profile, { recursive: true, force: true }); } catch { /* занято */ } };
  if (!target) { await close(); throw new Error('Chrome не запустился'); }
  return { target, close };
}
