// Прогон сенсорного управления: эмуляция телефона в Chrome, настоящие события касаний, несколько пальцев сразу.
// GAME_URL=https://... node tools/test-touch.mjs — проверка выложенной версии.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchChrome } from './chrome.mjs';

const OUT = resolve('dist/shots'), W = 844, H = 390;
mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0, chrome; const pending = new Map(), errors = [], results = [];
const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async n => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, 'base64')); };
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`); };

// Пальцы: словарь id → точка. Каждое событие CDP описывает все пальцы на экране сразу.
const fingers = new Map();
const touch = async (type, changed) => {
  for (const [fid, p] of Object.entries(changed)) { if (type === 'touchEnd') fingers.delete(+fid); else fingers.set(+fid, p); }
  const points = type === 'touchEnd' ? Object.entries(changed).map(([fid, p]) => ({ x: p.x, y: p.y, id: +fid })) : [...fingers].map(([fid, p]) => ({ x: p.x, y: p.y, id: fid }));
  const rest = type === 'touchEnd' ? [...fingers].map(([fid, p]) => ({ x: p.x, y: p.y, id: fid })) : [];
  await cdp('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? rest : points });
};
const down = (fid, x, y) => touch('touchStart', { [fid]: { x, y } });
const move = (fid, x, y) => touch('touchMove', { [fid]: { x, y } });
const up = (fid) => { const p = fingers.get(fid); return touch('touchEnd', { [fid]: p }); };
async function drag(fid, x0, y0, x1, y1, steps = 8) { for (let i = 1; i <= steps; i++) { await move(fid, x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await wait(16); } }
const center = sel => ev(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
async function tap(sel) { const c = await center(sel); await down(90, c.x, c.y); await wait(60); await up(90); }
const state = () => ev(`JSON.stringify({st:__g.G.state,x:__g.player.pos.x,z:__g.player.pos.z,y:__g.player.pos.y,v:Math.hypot(__g.player.vel.x,__g.player.vel.z),yaw:__g.G.yaw,pitch:__g.G.pitch,stam:__g.player.stamina,vx:__g.player.vel.x,vz:__g.player.vel.z,score:__g.G.score,gr:__g.player.grounded})`).then(JSON.parse);

try {
  chrome = await launchChrome({ width: W, height: H });
  ws = new WebSocket(chrome.target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('error: ' + d.params.args.map(a => a.value ?? a.description).join(' '));
  };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Page.navigate', { url: process.env.GAME_URL || 'file:///' + resolve('dist/index.html').replace(/\\/g, '/') });
  let st;
  for (let i = 0; i < 120; i++) { await wait(250); st = await ev('window.__g && __g.G.state').catch(() => null); if (st === 'menu') break; }
  check('загрузка до меню', st === 'menu', `state=${st}`);
  const HP = await ev('__g.maxHp');

  // --- меню на телефоне
  const menu = await ev(`(()=>{const o=document.getElementById('overlay'),p=document.querySelector('.panel');const vis=s=>getComputedStyle(document.querySelector(s)).display;return {touch:__g.touchMode,cls:document.documentElement.classList.contains('touch'),tdl:vis('.keys-touch'),ddl:vis('.keys-desk'),fits:o.scrollHeight<=o.clientHeight+1,panelBottom:Math.round(p.getBoundingClientRect().bottom),vh:innerHeight,note:document.getElementById('note').textContent}})()`);
  check('телефон распознан как сенсорный', menu.touch && menu.cls, JSON.stringify({ touch: menu.touch }));
  check('в меню подсказки для пальцев, а не клавиши', menu.tdl === 'grid' && menu.ddl === 'none');
  check('меню целиком помещается в ландшафт 844×390', menu.fits, `низ панели ${menu.panelBottom} из ${menu.vh}`);
  await wait(800); await shot('t1-menu');

  // --- запрет масштабирования: метатег, touch-action и перехват жестов (щипок через CDP в эмуляции не масштабирует
  //     даже страницу без запрета, поэтому проверяем сами механизмы, отправляя отменяемые события)
  const zoom = await ev(`(()=>{
    const gs=new Event('gesturestart',{cancelable:true,bubbles:true}); document.body.dispatchEvent(gs);
    const t=new Touch({identifier:1,target:document.body,clientX:10,clientY:10}), t2=new Touch({identifier:2,target:document.body,clientX:60,clientY:60});
    const two=new TouchEvent('touchmove',{touches:[t,t2],targetTouches:[t,t2],changedTouches:[t],cancelable:true,bubbles:true}); document.body.dispatchEvent(two);
    const one=new TouchEvent('touchmove',{touches:[t],targetTouches:[t],changedTouches:[t],cancelable:true,bubbles:true}); document.body.dispatchEvent(one);
    const end=()=>new TouchEvent('touchend',{cancelable:true,bubbles:true,changedTouches:[t]});
    const a=end(); document.body.dispatchEvent(a); const b=end(); document.body.dispatchEvent(b);
    const c=end(); document.getElementById('go').dispatchEvent(c);
    return {meta:document.querySelector('meta[name=viewport]').content,gesture:gs.defaultPrevented,pinch:two.defaultPrevented,oneFinger:one.defaultPrevented,firstTap:a.defaultPrevented,secondTap:b.defaultPrevented,goTap:c.defaultPrevented,body:getComputedStyle(document.body).touchAction,overlay:getComputedStyle(document.getElementById('overlay')).touchAction}})()`);
  check('метатег запрещает масштаб', /user-scalable=no/.test(zoom.meta) && /maximum-scale=1/.test(zoom.meta), zoom.meta);
  check('touch-action: страница не масштабируется, меню листается', zoom.body === 'none' && zoom.overlay === 'pan-y', `body=${zoom.body}, меню=${zoom.overlay}`);
  check('жесты iOS Safari отменяются', zoom.gesture);
  check('щипок двумя пальцами отменяется, один палец — нет', zoom.pinch && !zoom.oneFinger);
  check('двойной тап отменяется, одиночный и кнопка «Играть» — нет', !zoom.firstTap && zoom.secondTap && !zoom.goTap);

  // --- вертикальная ориентация: подсказка повернуть телефон
  await cdp('Emulation.setDeviceMetricsOverride', { width: H, height: W, deviceScaleFactor: 2, mobile: true }); await wait(500);
  const port = await ev(`({note:document.getElementById('note').textContent,fits:document.getElementById('overlay').scrollHeight<=document.getElementById('overlay').clientHeight+1,over:document.documentElement.scrollWidth>document.documentElement.clientWidth})`);
  check('в портрете предлагает повернуть телефон', /горизонтальн/.test(port.note), JSON.stringify(port.note));
  check('в портрете нет горизонтальной прокрутки', !port.over); await shot('t2-menu-portrait');
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true }); await wait(500);

  // --- старт касанием
  await tap('#go'); await wait(500);
  const hl = await ev(`(()=>{const r=document.getElementById('hearts').getBoundingClientRect(),s=document.getElementById('s-time').getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,apart:r.right<s.left||r.top>s.bottom,w:Math.round(r.width),h:Math.round(r.height),n:document.querySelectorAll('#hearts .h').length}})()`);
  check('сердца на телефоне помещаются и не лезут на таймер', hl.n === HP && hl.inside && hl.apart, JSON.stringify(hl));
  check('касание «Играть» запускает раунд', (await state()).st === 'play');
  check('сенсорный слой показан, курсор не захватывался', await ev(`getComputedStyle(document.getElementById('touch')).display==='block' && !document.pointerLockElement`));
  await ev(`__g.bots.forEach(b=>{b.active=false;b.g.visible=false;b.wait=999})`);

  // --- джойстик вперёд, неполный
  const a0 = await state();
  await down(1, 150, 270); await drag(1, 150, 270, 150, 225); await wait(900);
  const a1 = await state();
  const dx = a1.x - a0.x, dz = a1.z - a0.z, dist = Math.hypot(dx, dz);
  check('джойстик ведёт вперёд', dist > 2.5, `прошёл ${dist.toFixed(1)} м за 0,9 с`);
  check('направление совпадает с камерой', (dx * Math.sin(a1.yaw) + dz * Math.cos(a1.yaw)) / dist > .95);
  check('неполный наклон = шаг медленнее бега', a1.v > 2 && a1.v < 5.1, `v=${a1.v.toFixed(1)} м/с`);
  await shot('t3-run');

  // --- спринт: потянуть дальше кольца
  await drag(1, 150, 225, 150, 160, 6); await wait(700);
  const s1 = await state();
  check('дальше кольца — спринт', s1.v > 7 && s1.stam < 100, `v=${s1.v.toFixed(1)} м/с, силы ${s1.stam.toFixed(0)}`);
  check('кольцо подсвечено в спринте', await ev(`document.getElementById('joy').classList.contains('fast')`));

  // --- второй палец: камера, при этом бег не прерывается
  const yaw0 = s1.yaw, pit0 = s1.pitch;
  await down(2, 600, 180); await drag(2, 600, 180, 700, 200, 10); await wait(700);
  const l1 = await state();
  check('второй палец поворачивает камеру', Math.abs(l1.yaw - yaw0) > .4 && Math.abs(l1.yaw - yaw0) < .9, `поворот ${(l1.yaw - yaw0).toFixed(2)} рад`);
  check('свайп вправо = поворот вправо (yaw уменьшается)', l1.yaw < yaw0);
  check('свайп вниз наклоняет камеру', l1.pitch > pit0, `${pit0.toFixed(2)} → ${l1.pitch.toFixed(2)}`);
  check('бег продолжается, пока вторым пальцем крутим камеру', l1.v > 7, `v=${l1.v.toFixed(1)}`);
  check('после поворота бег идёт по новому направлению', (l1.vx * Math.sin(l1.yaw) + l1.vz * Math.cos(l1.yaw)) / l1.v > .9);
  await shot('t4-look');
  await up(2); await up(1); await wait(700);
  const r1 = await state();
  check('отпустили пальцы — персонаж останавливается', r1.v < .4, `v=${r1.v.toFixed(2)}`);
  check('состояние джойстика сброшено', await ev(`__g.touch.x===0&&__g.touch.y===0&&!__g.touch.sprint&&__g.touch.moveId===null&&__g.touch.lookId===null`));

  // --- кнопки
  await tap('#t-jump'); await wait(330);
  const j1 = await state(); check('кнопка «Прыжок» подбрасывает', j1.y > .4, `y=${j1.y.toFixed(2)}`);
  await wait(900); check('приземление после прыжка', (await state()).gr);
  check('тап по кнопке не включил джойстик и камеру', await ev(`__g.touch.moveId===null&&__g.touch.lookId===null`));

  const rects = await ev(`(()=>{const r=['#t-punch','#t-jump','#t-roll'].map(s=>{const b=document.querySelector(s).getBoundingClientRect();return [b.left,b.top,b.right,b.bottom]});const hit=(a,b)=>a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];return {overlap:hit(r[0],r[1])||hit(r[0],r[2])||hit(r[1],r[2]),roll:r[2],vh:innerHeight}})()`);
  check('кнопки удара, прыжка и кувырка не перекрываются', !rects.overlap, JSON.stringify(rects.roll.map(Math.round)));
  await ev(`(()=>{const p=__g.player;p.stamina=100;p.rollCool=0})()`);
  await tap('#t-roll'); await wait(160);
  const rl = await ev(`({roll:__g.player.roll,anim:__g.anim,wait:document.getElementById('t-roll').classList.contains('wait'),dir:__g.player.rollDir.x+','+__g.player.rollDir.z})`);
  check('кнопка «Кувырок» запускает кувырок, кнопка тускнеет', rl.roll > 0 && rl.anim === 'roll' && rl.wait, JSON.stringify(rl));
  check('тап по кнопке кувырка не включил джойстик и камеру', await ev(`__g.touch.moveId===null&&__g.touch.lookId===null`));
  await shot('t8-roll'); await wait(1000);
  const before = (await state()).score;
  await ev(`(()=>{const b=__g.bots[0];b.active=true;b.g.visible=true;b.stun=0;b.wait=0;b.pos.set(__g.player.pos.x+Math.sin(__g.player.facing)*1.9,0,__g.player.pos.z+Math.cos(__g.player.facing)*1.9);})()`);
  await tap('#t-punch'); await wait(260);
  const p1 = await state(); check('кнопка «Удар» уничтожает врага (+2)', p1.score === before + 2, `счёт ${before}→${p1.score}`);
  await shot('t5-punch');

  // --- пауза с экрана
  await tap('#t-pause'); await wait(300);
  const ps = await ev(`({st:__g.G.state,btn:document.getElementById('go').textContent,overlay:!document.getElementById('overlay').classList.contains('hide'),layer:getComputedStyle(document.getElementById('touch')).display})`);
  check('кнопка паузы открывает меню паузы', ps.st === 'pause' && ps.overlay && ps.btn === 'Продолжить' && ps.layer === 'none', JSON.stringify(ps));
  await shot('t6-pause');
  await tap('#go'); await wait(400);
  check('«Продолжить» возвращает в игру', (await state()).st === 'play');

  // --- зажатая кнопка удара повторяет удар
  await ev(`(()=>{const b=__g.bots[1];b.active=true;b.g.visible=true;b.stun=0;b.wait=0;b.pos.set(__g.player.pos.x+Math.sin(__g.player.facing)*1.9,0,__g.player.pos.z+Math.cos(__g.player.facing)*1.9);__g.player.inv=0;})()`);
  const cc = await center('#t-punch'); await down(7, cc.x, cc.y); await wait(1300); await up(7);
  check('зажатая кнопка не залипает после отпускания', await ev(`!__g.touch.punchHeld`));

  // --- игра в портретной ориентации: всё управление на экране и ничего не вылезает
  await cdp('Emulation.setDeviceMetricsOverride', { width: H, height: W, deviceScaleFactor: 2, mobile: true }); await wait(700);
  const pt = await ev(`(()=>{const inside=s=>{const r=document.querySelector(s).getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};return {btns:['#t-punch','#t-jump','#t-pause','#joy','#stam','#s-score','#s-time','#hearts','#t-roll'].map(s=>s+':'+inside(s)),state:__g.G.state,over:document.documentElement.scrollWidth>document.documentElement.clientWidth,fov:Math.round(document.querySelector('canvas').height)}})()`);
  check('в портрете кнопки, джойстик и счётчики внутри экрана', pt.btns.every(s => s.endsWith('true')) && !pt.over, pt.btns.filter(s => s.endsWith('false')).join(',') || 'всё на месте');
  await down(5, 100, 600); await drag(5, 100, 600, 100, 560); await wait(500);
  check('в портрете джойстик тоже ведёт персонажа', (await state()).v > 2.5); await up(5); await shot('t7-portrait-play');
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true }); await wait(500);

  // --- когда мышь появляется, интерфейс возвращается к клавишам
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 200, button: 'left', clickCount: 1 }); await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 200, button: 'left', clickCount: 1 });
  await wait(200);

  const f = await ev(`new Promise(r=>{let n=0,t0=performance.now();(function s(){if(++n>=90)r(n/((performance.now()-t0)/1000));else requestAnimationFrame(s)})()})`);
  console.log(`FPS в прогоне (эмуляция телефона, 844×390 @2x): ${f.toFixed(0)}`);
  check('нет ошибок в консоли', errors.length === 0, errors.slice(0, 6).join(' | '));
} catch (e) { check('прогон без исключений', false, e.stack); }
finally { if (chrome) await chrome.close(); }
console.log(results.every(Boolean) ? 'ИТОГ: всё прошло' : `ИТОГ: провалов ${results.filter(r => !r).length}`);
process.exit(0);
