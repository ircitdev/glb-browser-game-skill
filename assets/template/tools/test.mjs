// Реальный прогон игры в headless Chrome через CDP: настоящий ввод, ошибки консоли, скриншоты.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME || ({ win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe', darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }[process.platform] || 'google-chrome');
const PROFILE = resolve('dist/.chrome-test'), OUT = resolve('dist/shots');
const PORT = 9333, W = 1280, H = 720;
mkdirSync(OUT, { recursive: true });
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu-rasterization', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(), errors = [];
function cdp(method, params = {}) { return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
const ev = async expr => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr); return r.result.value; };
const shot = async n => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, 'base64')); };
const code2key = { KeyW: ['w', 87], ShiftLeft: ['Shift', 16], Space: [' ', 32], KeyE: ['e', 69], KeyA: ['a', 65], ArrowLeft: ['ArrowLeft', 37] };
const key = (type, code) => cdp('Input.dispatchKeyEvent', { type, code, key: code2key[code][0], windowsVirtualKeyCode: code2key[code][1] });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`); };

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await wait(250); try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === 'page'); } catch { /* ещё стартует */ } }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) errors.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' '));
  };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: process.env.GAME_URL || 'file:///' + resolve('dist/index.html').replace(/\\/g, '/') });
  let st;
  for (let i = 0; i < 120; i++) { await wait(250); st = await ev('window.__g && __g.G.state').catch(() => null); if (st === 'menu') break; }
  check('загрузка до меню', st === 'menu', `state=${st}`);
  console.log('renderer:', await ev(`(()=>{const g=document.getElementById('view').getContext('webgl2');const d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'?'})()`));
  await wait(900); await shot('1-menu');

  const box = await ev(`(()=>{const r=document.getElementById('go').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await wait(400);
  check('кнопка запускает раунд', await ev('__g.G.state') === 'play');

  await ev(`__g.bots.forEach(b=>{b.active=false;b.g.visible=false;b.wait=999})`); // чтобы проверка хода не зависела от ботов
  const p0 = await ev('[__g.player.pos.x,__g.player.pos.z]');
  await key('keyDown', 'KeyW'); await wait(1200); await shot('2-run');
  const p1 = await ev('[__g.player.pos.x,__g.player.pos.z]');
  const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  check('W двигает персонажа', moved > 3, `прошёл ${moved.toFixed(1)} м за 1,2 с`);
  check('W ведёт от камеры вперёд', (await ev('Math.abs(Math.atan2(Math.sin(__g.player.facing-__g.G.yaw),Math.cos(__g.player.facing-__g.G.yaw)))')) < .2);

  const s0 = await ev('__g.player.stamina');
  await key('keyDown', 'ShiftLeft'); await wait(700);
  const v = await ev('Math.hypot(__g.player.vel.x,__g.player.vel.z)'), s1 = await ev('__g.player.stamina');
  check('Shift ускоряет и тратит силы', v > 7 && s1 < s0, `v=${v.toFixed(1)} силы ${s0.toFixed(0)}→${s1.toFixed(0)}`);
  await key('keyUp', 'ShiftLeft');

  await key('keyDown', 'Space'); await key('keyUp', 'Space'); await wait(330);
  const y = await ev('__g.player.pos.y'); await shot('3-jump');
  check('пробел прыгает', y > .4, `y=${y.toFixed(2)}`);
  await key('keyUp', 'KeyW'); await wait(900);
  check('приземление', await ev('__g.player.grounded') === true && await ev('__g.player.pos.y') === 0);

  await ev(`(()=>{const p=__g.pickups.find(p=>p.g.visible);p.g.position.set(__g.player.pos.x+.3,0,__g.player.pos.z);})()`);
  await wait(200);
  check('предмет собирается', await ev('__g.G.score') >= 1, `счёт ${await ev('__g.G.score')}`);

  await ev(`__g.pickups.forEach(p=>{if(Math.hypot(p.g.position.x-__g.player.pos.x,p.g.position.z-__g.player.pos.z)<5)p.g.position.x+=20})`);
  const before = await ev('__g.G.score');
  await ev(`(()=>{const b=__g.bots[0];b.active=true;b.g.visible=true;b.stun=0;b.wait=0;b.pos.set(__g.player.pos.x+Math.sin(__g.player.facing)*1.9,0,__g.player.pos.z+Math.cos(__g.player.facing)*1.9);})()`);
  await key('keyDown', 'KeyE'); await key('keyUp', 'KeyE'); await wait(230); await shot('4-punch');
  check('удар уничтожает врага (+2)', await ev('__g.G.score') === before + 2 && await ev('__g.bots[0].active') === false, `счёт ${before}→${await ev('__g.G.score')}`);
  await wait(500);

  const beforeHit = await ev('__g.G.score');
  await ev(`(()=>{const b=__g.bots[1];b.active=true;b.g.visible=true;b.stun=0;b.wait=0;b.pos.set(__g.player.pos.x+.7,0,__g.player.pos.z);__g.player.inv=0;})()`);
  await wait(250); await shot('5-hit');
  check('враг отнимает очки', await ev('__g.G.score') < beforeHit || beforeHit === 0, `счёт ${beforeHit}→${await ev('__g.G.score')}`);
  await wait(2000);

  await key('keyDown', 'KeyA'); await wait(300); await key('keyUp', 'KeyA');
  await ev('__g.G.time=.25'); await wait(1600);
  check('раунд заканчивается', await ev('__g.G.state') === 'over'); await wait(1200); await shot('6-over');
  for (const type of ['mousePressed', 'mouseReleased']) { const b = await ev(`(()=>{const r=document.getElementById('go').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await cdp('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }); }
  await wait(400);
  check('«Ещё раз» запускает новый раунд', await ev('__g.G.state') === 'play' && await ev('__g.G.score') === 0 && await ev('__g.G.time') > 70);
  const f = await ev(`new Promise(r=>{let n=0,t0=performance.now();(function s(){if(++n>=90)r(n/((performance.now()-t0)/1000));else requestAnimationFrame(s)})()})`);
  console.log('FPS в прогоне (headless, 1280×720):', f.toFixed(0));
  check('нет ошибок в консоли', errors.length === 0, errors.slice(0, 8).join(' | '));
} catch (e) { check('прогон без исключений', false, e.stack); }
finally { proc.kill(); await wait(600); try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* занято */ } }
console.log(results.every(Boolean) ? 'ИТОГ: всё прошло' : `ИТОГ: провалов ${results.filter(r => !r).length}`);
process.exit(0);
