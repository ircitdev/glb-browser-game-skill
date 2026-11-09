// Реальный прогон игры в headless Chrome через CDP: настоящий ввод, ошибки консоли, скриншоты.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchChrome } from './chrome.mjs';

const OUT = resolve('dist/shots'), W = 1280, H = 720;
mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(), errors = [];
function cdp(method, params = {}) { return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
const ev = async expr => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr); return r.result.value; };
const shot = async n => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, 'base64')); };
const code2key = { KeyW: ['w', 87], ShiftLeft: ['Shift', 16], Space: [' ', 32], KeyE: ['e', 69], KeyA: ['a', 65], ArrowLeft: ['ArrowLeft', 37], KeyC: ['c', 67] };
const key = (type, code) => cdp('Input.dispatchKeyEvent', { type, code, key: code2key[code][0], windowsVirtualKeyCode: code2key[code][1] });
const results = []; let chrome;
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`); };

try {
  chrome = await launchChrome({ width: W, height: H });
  const target = chrome.target;
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
  const HP = await ev('__g.maxHp'); // число сердец берём из игры, а не из головы
  console.log('renderer:', await ev(`(()=>{const g=document.getElementById('view').getContext('webgl2');const d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'?'})()`));
  await wait(900); await shot('1-menu');

  const box = await ev(`(()=>{const r=document.getElementById('go').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await wait(400);
  check('кнопка запускает раунд', await ev('__g.G.state') === 'play');

  await ev(`__g.bots.forEach(b=>{b.active=false;b.g.visible=false;b.wait=999})`); // чтобы проверка хода не зависела от врагов
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

  const beforeHit = await ev('__g.G.score'), hp0 = await ev('__g.player.hp');
  check('в начале раунда полное здоровье', hp0 === HP && await ev(`document.querySelectorAll('#hearts .h').length===${HP}&&document.querySelectorAll('#hearts .h.off').length===0`), `hp=${hp0}`);
  await ev(`(()=>{const b=__g.bots[1];b.active=true;b.g.visible=true;b.stun=0;b.wait=0;b.pos.set(__g.player.pos.x+.7,0,__g.player.pos.z);__g.player.inv=0;})()`);
  await wait(250); await shot('5-hit');
  const hit = await ev(`({hp:__g.player.hp,score:__g.G.score,combo:__g.G.combo,off:document.querySelectorAll('#hearts .h.off').length,label:document.getElementById('hearts').getAttribute('aria-label')})`);
  check('враг отнимает одно сердце, очки не трогает', hit.hp === hp0 - 1 && hit.score === beforeHit, `сердец ${hp0}→${hit.hp}, счёт ${beforeHit}→${hit.score}`);
  check('сердце гаснет на панели и в подписи', hit.off === 1 && new RegExp(`${HP - 1} из ${HP}`).test(hit.label), hit.label);
  check('после удара серия обнуляется', hit.combo === 0);
  await ev(`(()=>{const b=__g.bots[2];b.active=true;b.g.visible=true;b.stun=0;b.wait=0;b.pos.set(__g.player.pos.x+.5,0,__g.player.pos.z);})()`); await wait(300);
  check('сразу после удара герой неуязвим, второй враг не отнимает сердце', await ev('__g.player.hp') === hp0 - 1);
  await ev(`__g.bots.forEach(b=>{b.active=false;b.g.visible=false;b.wait=999})`);
  await wait(1800);

  await ev(`document.dispatchEvent(new Event('noop'))`);
  await key('keyDown', 'KeyA'); await wait(300); await key('keyUp', 'KeyA');
  await ev('__g.G.time=.25'); await wait(1600);
  check('раунд заканчивается', await ev('__g.G.state') === 'over'); await wait(1200); await shot('6-over');
  for (const type of ['mousePressed', 'mouseReleased']) { const b = await ev(`(()=>{const r=document.getElementById('go').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await cdp('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }); }
  await wait(400);
  check('«Ещё раз» запускает новый раунд', await ev('__g.G.state') === 'play' && await ev('__g.G.score') === 0 && await ev('__g.G.time') > 70);
  // восстановление: десятый предмет возвращает сердце и добавляет время
  await ev(`__g.bots.forEach(b=>{b.active=false;b.g.visible=false;b.wait=999});__g.player.hp=${Math.max(1, HP - 4)};__g.G.picks=9;__g.G.time=40`);
  await wait(200);
  await ev(`(()=>{const p=__g.pickups.find(p=>p.g.visible);p.g.position.set(__g.player.pos.x+.3,0,__g.player.pos.z);})()`); await wait(250);
  const heal = await ev(`({hp:__g.player.hp,picks:__g.G.picks,time:__g.G.time,off:document.querySelectorAll('#hearts .h.off').length})`);
  check('каждый десятый предмет возвращает сердце и +3 секунды', heal.hp === Math.max(1, HP - 4) + 1 && heal.picks === 10 && heal.time > 42 && heal.off === HP - Math.max(1, HP - 4) - 1, JSON.stringify(heal));
  await ev(`__g.player.hp=${HP};__g.G.picks=9`); await wait(100);
  await ev(`(()=>{const p=__g.pickups.find(p=>p.g.visible);p.g.position.set(__g.player.pos.x+.3,0,__g.player.pos.z);})()`); await wait(250);
  check('при полном здоровье сердец не больше максимума', await ev('__g.player.hp') === HP);
  // гибель: последнее сердце ведёт к экрану итогов
  await ev(`__g.player.hp=1;__g.player.inv=0;__g.G.score=5`); await wait(150);
  await ev(`(()=>{const b=__g.bots[3];b.active=true;b.g.visible=true;b.stun=0;b.wait=0;b.pos.set(__g.player.pos.x+.6,0,__g.player.pos.z);})()`);
  await wait(350);
  const dying = await ev(`({hp:__g.player.hp,st:__g.G.state,dying:__g.G.dying>0})`);
  check('на последнем ударе герой ещё в игре: короткая пауза на анимацию', dying.hp === 0 && dying.st === 'play' && dying.dying, JSON.stringify(dying));
  await shot('7-dying'); await wait(1200);
  const dead = await ev(`({st:__g.G.state,title:document.getElementById('title').textContent,score:document.getElementById('r-score').textContent,off:document.querySelectorAll('#hearts .h.off').length})`);
  check('нулевое здоровье заканчивает раунд досрочно', dead.st === 'over' && dead.title === 'Здоровье закончилось' && dead.score === '5' && dead.off === HP, JSON.stringify(dead));
  await shot('8-dead');
  for (const type of ['mousePressed', 'mouseReleased']) { const b = await ev(`(()=>{const r=document.getElementById('go').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await cdp('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }); }
  await wait(400);
  check('новый раунд после гибели: полное здоровье и чистый счёт', await ev(`__g.G.state==='play'&&__g.player.hp===${HP}&&__g.G.score===0&&__g.G.dying===0&&document.querySelectorAll('#hearts .h.off').length===0`));
  // случайный выбор атаки: рука или нога, и анимация соответствует выбору
  await ev(`__g.bots.forEach(b=>{b.active=false;b.g.visible=false;b.wait=999})`);
  const seq = [];
  for (let i = 0; i < 40; i++) seq.push(await ev(`(()=>{const p=__g.player;p.cool=0;p.hit=0;p.punch=0;__g.punch();return p.attack})()`));
  const kicks = seq.filter(x => x === 'kick').length, fists = seq.filter(x => x === 'punch').length;
  check('удар выбирается случайно: за 40 ударов выпали и рука, и нога', kicks >= 6 && fists >= 6 && kicks + fists === 40, `рука ${fists}, нога ${kicks}`);
  for (const want of ['kick', 'punch']) {
    let tries = 0, got = null;
    while (got !== want && tries++ < 60) { await wait(620); got = await ev(`(()=>{const p=__g.player;p.cool=0;p.hit=0;p.punch=0;__g.punch();return p.attack})()`); }
    await wait(170);
    const anim = await ev('__g.anim');
    check(`при ударе «${want === 'kick' ? 'ногой' : 'рукой'}» играет своя анимация`, got === want && anim === want, `выбрано ${got}, анимация ${anim}`);
    await shot(want === 'kick' ? '9-kick' : '9-punch'); await wait(700);
  }
  // кувырок (клавиша C)
  const rst = `(()=>{__g.bots.forEach(b=>{b.active=false;b.g.visible=false;b.wait=999});const p=__g.player;p.stamina=100;p.hp=${HP};p.rollCool=0;p.roll=0;p.safe=0;p.hit=0;p.inv=0;p.pos.set(0,0,6);p.vel.set(0,0,0)})()`;
  await ev(rst); await wait(400);
  await key('keyDown', 'KeyW'); await wait(200);
  const zA = await ev('__g.player.pos.z');
  await key('keyDown', 'KeyC'); await key('keyUp', 'KeyC'); await key('keyUp', 'KeyW'); await wait(120);
  const r1 = await ev(`({roll:__g.player.roll,anim:__g.anim,v:Math.hypot(__g.player.vel.x,__g.player.vel.z),st:__g.player.stamina,safe:__g.player.safe,dirz:__g.player.rollDir.z})`);
  check('клавиша C: рывок, своя анимация и неуязвимость', r1.roll > 0 && r1.anim === 'roll' && r1.v > 8 && r1.safe > 0, `v=${r1.v.toFixed(1)} м/с, анимация ${r1.anim}`);
  check('кувырок идёт по направлению движения (вперёд от камеры)', r1.dirz < -.9, `dir.z=${r1.dirz.toFixed(2)}`);
  check('кувырок стоит выносливости', r1.st < 85, `силы ${r1.st.toFixed(0)}`);
  await shot('10-roll');
  await ev(`(()=>{const b=__g.bots[4];b.active=true;b.g.visible=true;b.stun=0;b.wait=0;b.pos.set(__g.player.pos.x,0,__g.player.pos.z-.4);})()`); await wait(100);
  check('во время кувырка враг вплотную не отнимает сердце', await ev('__g.player.hp') === HP);
  const rollA = await ev('__g.player.roll'); await key('keyDown', 'KeyC'); await key('keyUp', 'KeyC'); await wait(40);
  check('повторное нажатие во время кувырка игнорируется', await ev('__g.player.roll') < rollA);
  await ev(`__g.bots.forEach(b=>{b.active=false;b.g.visible=false;b.wait=999})`); await wait(450);
  const zB = await ev('__g.player.pos.z'), dist = Math.abs(zB - zA);
  check('кувырок переносит героя на 3–5,5 м', dist > 3 && dist < 5.5, `прошёл ${dist.toFixed(1)} м`);
  check('кувырок закончился', await ev('__g.player.roll') === 0 && await ev('__g.anim') !== 'roll');
  await ev('(()=>{const p=__g.player;p.roll=0;p.stamina=100;p.rollCool=.7})()'); await wait(40);
  await key('keyDown', 'KeyC'); await key('keyUp', 'KeyC'); await wait(40);
  check('пока идёт перезарядка, кувырок не начнётся, кнопка тусклая', await ev('__g.player.roll') === 0 && await ev(`document.getElementById('t-roll').classList.contains('wait')`));
  await ev('__g.player.rollCool=0'); await wait(40);
  await key('keyDown', 'KeyC'); await key('keyUp', 'KeyC'); await wait(60);
  check('после перезарядки кувырок снова доступен', await ev('__g.player.roll') > 0);
  await wait(800); await ev(rst); await wait(300);
  await ev('__g.player.stamina=10'); await key('keyDown', 'KeyC'); await key('keyUp', 'KeyC'); await wait(60);
  check('без выносливости кувырок недоступен', await ev('__g.player.roll') === 0);
  await ev(rst); await wait(200);
  await ev('__g.jump()'); await wait(80); await key('keyDown', 'KeyC'); await key('keyUp', 'KeyC'); await wait(50);
  check('в прыжке кувырок не запускается', await ev('__g.player.roll') === 0);
  await wait(900); await ev(rst); await wait(300);
  const zS = await ev('__g.player.pos.z'); await key('keyDown', 'KeyC'); await key('keyUp', 'KeyC'); await wait(750);
  check('стоя на месте кувырок идёт по взгляду героя', Math.abs(await ev('__g.player.pos.z') - zS) > 3);
  await ev(rst);
  const f = await ev(`new Promise(r=>{let n=0,t0=performance.now();(function s(){if(++n>=90)r(n/((performance.now()-t0)/1000));else requestAnimationFrame(s)})()})`);
  console.log('FPS в прогоне (headless, 1280×720):', f.toFixed(0));
  check('нет ошибок в консоли', errors.length === 0, errors.slice(0, 8).join(' | '));
} catch (e) { check('прогон без исключений', false, e.stack); }
finally { if (chrome) await chrome.close(); }
console.log(results.every(Boolean) ? 'ИТОГ: всё прошло' : `ИТОГ: провалов ${results.filter(r => !r).length}`);
process.exit(0);
