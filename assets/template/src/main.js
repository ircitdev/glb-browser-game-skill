import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import CFG from './config.js';
import modelUrl from '../assets/model.glb';
import idleUrl from '../assets/idle.glb';
import runUrl from '../assets/run.glb';
import jumpUrl from '../assets/jump.glb';
import punchUrl from '../assets/punch.glb';
import hitUrl from '../assets/hit.glb';
import winUrl from '../assets/win.glb';

const ROUND = CFG.round, HEIGHT = CFG.height, BOUND = 60, RUN = 5.4, SPRINT = 8.2, CAM_DIST = 5.6;
const ACCENT = new THREE.Color(CFG.accent).getHex();
document.documentElement.style.setProperty('--accent', CFG.accent);
const $ = id => document.getElementById(id);
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- Рендер ----------
const canvas = $('view');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e) { fatal('Браузер не смог включить WebGL. Включите аппаратное ускорение и обновите страницу.'); throw e; }
let dpr = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b2036, 34, 125);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
function fatal(msg) { const g = $('go'); g.textContent = 'Не запустилось'; $('note').textContent = msg; document.title = 'ERROR'; }

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
}

// Небо и свет
const skyTex = canvasTex(16, 512, (x, w, h) => {
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#030a14'); g.addColorStop(.42, '#0a2340'); g.addColorStop(.5, '#1d5478'); g.addColorStop(.53, '#0b2036'); g.addColorStop(1, '#0b2036');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, toneMapped: false }));
scene.add(sky);
scene.add(new THREE.HemisphereLight(0x9cc6e6, 0x223044, 1.5));
const key = new THREE.DirectionalLight(0xfff1dd, 2.6);
key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 110 });
key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(ACCENT, 1.3); rim.position.set(-20, 12, -24); scene.add(rim);

// ---------- Город ----------
const colliders = [];
const addBox = (x, z, w, d, h, cam = true) => colliders.push({ a: x - w / 2, b: x + w / 2, c: z - d / 2, d: z + d / 2, h, cam });
const R = rng(20261108);

const groundTex = canvasTex(512, 512, (x, w, h) => {
  x.fillStyle = '#16222f'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 2200; i++) { x.fillStyle = `rgba(255,255,255,${R() * .025})`; x.fillRect(R() * w, R() * h, 2, 2); }
  x.strokeStyle = 'rgba(120,175,215,.24)'; x.lineWidth = 3; x.strokeRect(0, 0, w, h);
});
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(100, 100);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: groundTex, roughness: .78 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

function facade(seed) {
  const r = rng(seed), mk = lit => canvasTex(256, 256, (x, w, h) => {
    const r2 = rng(seed * 7);
    x.fillStyle = lit ? '#000' : ['#22344a', '#2b3a4e', '#1c3044'][seed % 3]; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const on = r2() > .46, warm = r2() > .3, px = 12 + j * 41, py = 12 + i * 41;
      x.fillStyle = lit ? (on ? (warm ? '#ffc477' : '#7fd2f5') : '#000') : '#0d1826';
      x.fillRect(px, py, 28, 28);
    }
  });
  const map = mk(false), em = mk(true);
  map.wrapS = map.wrapT = em.wrapS = em.wrapT = THREE.RepeatWrapping;
  r();
  return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: .95, roughness: .7 });
}
const facades = [facade(1), facade(2), facade(3)];
function building(x, z, w, d, h) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, S = 12;
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v, top = f === 2 || f === 3;
    uv.setXY(i, top ? 0 : uv.getX(i) * Math.round((f < 2 ? d : w) / S * 2), top ? 0 : uv.getY(i) * Math.round(h / S * 2));
  }
  const m = new THREE.Mesh(g, facades[Math.floor(R() * 3)]);
  m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; scene.add(m);
  addBox(x, z, w, d, h);
}
const cells = [-50, -30, -10, 10, 30, 50];
for (const x of cells) for (const z of cells) {
  if (Math.abs(x) === 10 && Math.abs(z) === 10) continue;
  building(x + (R() - .5) * 1.5, z + (R() - .5) * 1.5, 11 + R() * 3.5, 11 + R() * 3.5, 9 + R() * R() * 34);
}
// Дальняя застройка за границей уровня
for (let i = 0; i < 46; i++) {
  const a = i / 46 * Math.PI * 2, r = 96 + R() * 40, h = 20 + R() * 60, w = 14 + R() * 12;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), facades[i % 3]);
  m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); scene.add(m);
}

// Граница уровня
const edgeMat = new THREE.MeshBasicMaterial({ color: ACCENT });
[[0, -BOUND, BOUND * 2, .12], [0, BOUND, BOUND * 2, .12], [-BOUND, 0, .12, BOUND * 2], [BOUND, 0, .12, BOUND * 2]].forEach(([x, z, w, d]) => {
  const e = new THREE.Mesh(new THREE.BoxGeometry(w, .35, d), edgeMat); e.position.set(x, .18, z); scene.add(e);
});

// Площадь: кольцо, вывеска, деревья, фонари
const ring = new THREE.Mesh(new THREE.RingGeometry(9.6, 10, 72), new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.DoubleSide, transparent: true, opacity: .75 }));
ring.rotation.x = -Math.PI / 2; ring.position.y = .02; scene.add(ring);

const signTex = canvasTex(1024, 384, (x, w, h) => {
  x.fillStyle = '#071729'; x.fillRect(0, 0, w, h);
  x.strokeStyle = CFG.accent; x.lineWidth = 8; x.strokeRect(14, 14, w - 28, h - 28);
  x.fillStyle = '#eaf4fb'; x.textAlign = 'center'; x.font = '800 118px "Segoe UI",Arial,sans-serif'; x.fillText(CFG.sign, w / 2, 190);
  x.fillStyle = CFG.accent; x.font = '600 58px "Segoe UI",Arial,sans-serif'; x.fillText(CFG.brand, w / 2, 290);
});
const sign = new THREE.Mesh(new THREE.BoxGeometry(16, 6, .4), [0, 0, 0, 0, 1, 0].map(i => i ? new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }) : new THREE.MeshStandardMaterial({ color: 0x0b1b2c })));
sign.position.set(0, 8.2, -19); sign.castShadow = true; scene.add(sign);
for (const px of [-6.5, 6.5]) {
  const p = new THREE.Mesh(new THREE.BoxGeometry(.6, 6, .6), new THREE.MeshStandardMaterial({ color: 0x22344a }));
  p.position.set(px, 2.6, -19); p.castShadow = true; scene.add(p); addBox(px, -19, .7, .7, 6, false);
}

const trunks = [], crowns = [], lamps = [];
for (const [x, z] of [[-15, -15], [15, -15], [-15, 15], [15, 15], [-17, 4], [17, -4], [4, 17], [-5, 17.5]]) { trunks.push([x, z]); crowns.push([x, z]); addBox(x, z, .8, .8, 4, false); }
for (const c of [-40, -20, 0, 20, 40]) for (const s of [-20, 20]) {
  if (Math.abs(c) === 0) continue;
  lamps.push([c, s], [s, c]);
}
const dummy = new THREE.Object3D();
function inst(geo, mat, list, y, sx = 1) {
  const m = new THREE.InstancedMesh(geo, mat, list.length); m.castShadow = true;
  list.forEach(([x, z], i) => { dummy.position.set(x, y, z); dummy.scale.set(sx, sx, sx); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
  scene.add(m); return m;
}
inst(new THREE.CylinderGeometry(.16, .24, 3, 6), new THREE.MeshStandardMaterial({ color: 0x4a3a2c }), trunks, 1.5);
inst(new THREE.IcosahedronGeometry(1.7, 1), new THREE.MeshStandardMaterial({ color: 0x2f7a5a, flatShading: true, roughness: .9 }), crowns, 4.1);
inst(new THREE.CylinderGeometry(.07, .1, 5, 6), new THREE.MeshStandardMaterial({ color: 0x31465c }), lamps, 2.5);
inst(new THREE.SphereGeometry(.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xcdeeff, toneMapped: false }), lamps, 5.1);
lamps.forEach(([x, z]) => addBox(x, z, .3, .3, 5, false));

function pushOut(p, r) {
  for (const b of colliders) {
    if (p.x < b.a - r || p.x > b.b + r || p.z < b.c - r || p.z > b.d + r) continue;
    const l = p.x - (b.a - r), rr = (b.b + r) - p.x, t = p.z - (b.c - r), bb = (b.d + r) - p.z, m = Math.min(l, rr, t, bb);
    if (m === l) p.x = b.a - r; else if (m === rr) p.x = b.b + r; else if (m === t) p.z = b.c - r; else p.z = b.d + r;
  }
  p.x = clamp(p.x, -BOUND + r, BOUND - r); p.z = clamp(p.z, -BOUND + r, BOUND - r);
}
function freeSpot(minFromPlayer = 0) {
  for (let i = 0; i < 80; i++) {
    const x = (Math.random() * 2 - 1) * (BOUND - 3), z = (Math.random() * 2 - 1) * (BOUND - 3);
    if (colliders.some(b => x > b.a - 1.6 && x < b.b + 1.6 && z > b.c - 1.6 && z < b.d + 1.6)) continue;
    if (Math.hypot(x - player.pos.x, z - player.pos.z) < minFromPlayer) continue;
    return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, 8);
}
function camHit(o, dir, len) {
  let best = len;
  for (const b of colliders) {
    if (!b.cam) continue;
    let t0 = 0, t1 = best, ok = true;
    for (const [oo, dd, lo, hi] of [[o.x, dir.x, b.a, b.b], [o.y, dir.y, 0, b.h], [o.z, dir.z, b.c, b.d]]) {
      if (Math.abs(dd) < 1e-6) { if (oo < lo || oo > hi) { ok = false; break; } continue; }
      let a = (lo - oo) / dd, c = (hi - oo) / dd; if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < best) best = t0;
  }
  return best;
}

// ---------- Состояние ----------
const player = { pos: new THREE.Vector3(0, 0, 4), vel: new THREE.Vector3(), vy: 0, facing: 0, grounded: true, stamina: 100, winded: false, hit: 0, punch: 0, cool: 0, inv: 0 };
const G = { state: 'loading', score: 0, time: ROUND, picks: 0, combo: 0, comboT: 0, yaw: Math.PI, pitch: .32, dist: CAM_DIST, shake: 0, elapsed: 0, muted: store.get(CFG.id + '-mute', '0') === '1', best: +store.get(CFG.id + '-best', '0') || 0 };
const keys = new Set();

// ---------- Предметы ----------
const envTex = canvasTex(256, 170, (x, w, h) => {
  x.fillStyle = '#e8f5fd'; x.fillRect(0, 0, w, h);
  x.strokeStyle = CFG.accent; x.lineWidth = 12; x.strokeRect(6, 6, w - 12, h - 12);
  x.lineWidth = 9; x.beginPath(); x.moveTo(8, 10); x.lineTo(w / 2, h * .62); x.lineTo(w - 8, 10); x.stroke();
});
const envGeo = new THREE.BoxGeometry(.95, .63, .06);
const envMat = new THREE.MeshBasicMaterial({ map: envTex, toneMapped: false });
const beamGeo = new THREE.CylinderGeometry(.34, .34, 26, 10, 1, true);
const beamMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const haloGeo = new THREE.RingGeometry(.6, .78, 28);
const haloMat = new THREE.MeshBasicMaterial({ color: 0x7fd2f5, transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false });
const pickups = [];
for (let i = 0; i < 26; i++) {
  const g = new THREE.Group(), e = new THREE.Mesh(envGeo, envMat), b = new THREE.Mesh(beamGeo, beamMat), h = new THREE.Mesh(haloGeo, haloMat);
  e.position.y = 1.15; b.position.y = 13; h.rotation.x = -Math.PI / 2; h.position.y = .04;
  g.add(e, b, h); scene.add(g);
  pickups.push({ g, e, off: Math.random() * 6, wait: 0 });
}

// ---------- Враги ----------
const botGeo = new THREE.IcosahedronGeometry(.56, 0);
const botMat = new THREE.MeshStandardMaterial({ color: 0xc72b24, emissive: 0xff3a2c, emissiveIntensity: 1.1, flatShading: true, roughness: .4 });
const eyeGeo = new THREE.SphereGeometry(.17, 10, 8);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe3a6, toneMapped: false });
const shadowGeo = new THREE.CircleGeometry(.6, 18);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0xff3a2c, transparent: true, opacity: .32, depthWrite: false });
const bots = [];
for (let i = 0; i < 11; i++) {
  const g = new THREE.Group(), m = new THREE.Mesh(botGeo, botMat), eye = new THREE.Mesh(eyeGeo, eyeMat), s = new THREE.Mesh(shadowGeo, shadowMat);
  m.castShadow = true; m.position.y = 1.15; eye.position.set(0, 1.2, .47); s.rotation.x = -Math.PI / 2; s.position.y = .03;
  g.add(m, eye, s); scene.add(g);
  bots.push({ g, m, pos: g.position, active: false, wait: 0, stun: 0, phase: Math.random() * 6 });
}

// ---------- Частицы ----------
const PN = 240, sparks = new THREE.InstancedMesh(new THREE.BoxGeometry(.09, .09, .09), new THREE.MeshBasicMaterial({ toneMapped: false }), PN);
sparks.frustumCulled = false; scene.add(sparks);
const parts = Array.from({ length: PN }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 }));
let pIdx = 0; const col = new THREE.Color();
function burst(p, color, n = 18, power = 5) {
  col.set(color);
  for (let i = 0; i < n; i++) {
    const s = parts[pIdx]; sparks.setColorAt(pIdx, col); pIdx = (pIdx + 1) % PN;
    s.p.copy(p); s.v.set((Math.random() - .5) * power, Math.random() * power, (Math.random() - .5) * power); s.life = .45 + Math.random() * .35;
  }
  sparks.instanceColor.needsUpdate = true;
}

// ---------- Звук ----------
let ac;
function initAudio() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch { ac = null; } }
function tone(f0, f1, dur, type = 'sine', vol = .16, delay = 0) {
  if (!ac || G.muted) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .02);
}
const sfx = {
  pick: c => { const f = 620 * Math.pow(1.06, Math.min(c, 14)); tone(f, f * 1.5, .13, 'triangle', .17); },
  punch: () => tone(180, 70, .14, 'square', .1),
  kill: () => { tone(520, 90, .2, 'sawtooth', .12); tone(880, 1400, .1, 'triangle', .1, .05); },
  hit: () => { tone(260, 55, .38, 'sawtooth', .18); },
  bonus: () => { tone(660, 990, .12, 'triangle', .14); tone(990, 1320, .16, 'triangle', .14, .1); },
  end: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, .3, 'triangle', .15, i * .13)),
};

// ---------- HUD ----------
const ui = { score: $('score'), time: $('time'), timeBox: $('s-time'), combo: $('combo'), comboBox: $('s-combo'), stam: $('stam'), stamBar: $('stam').firstElementChild, toast: $('toast'), flash: $('flash'), hud: $('hud'), overlay: $('overlay'), go: $('go'), title: $('title'), lead: $('lead'), result: $('result') };
function toast(text, color = '#eaf4fb') { const t = ui.toast; t.textContent = text; t.style.color = color; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
let lastT = -1;
function drawHud() {
  ui.score.textContent = G.score;
  const s = Math.ceil(G.time);
  if (s !== lastT) { lastT = s; ui.time.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); ui.timeBox.classList.toggle('low', s <= 10); }
  const m = mult(); ui.comboBox.style.opacity = m > 1 ? 1 : 0; ui.combo.textContent = '×' + m;
  ui.stamBar.style.width = player.stamina + '%'; ui.stam.classList.toggle('out', player.winded);
}
const mult = () => G.combo >= 10 ? 3 : G.combo >= 5 ? 2 : 1;

// ---------- Персонаж ----------
const character = new THREE.Group(); scene.add(character);
let mixer, actions = {}, cur = null, model;
const ANIM = CFG.anim;
function play(name, fade = .14) {
  if (cur === name) return;
  const next = actions[name], cfg = ANIM[name];
  next.reset(); next.time = cfg.start || 0; next.setEffectiveTimeScale(cfg.speed || 1); next.setEffectiveWeight(1); next.fadeIn(fade); next.play();
  if (cur) actions[cur].fadeOut(fade);
  cur = name;
}
function cleanClip(clip, loop) {
  clip.tracks = clip.tracks.filter(t => !t.name.endsWith('.scale'));
  if (!loop) return clip;
  for (const t of clip.tracks) { // Убираем накопленный сдвиг таза, чтобы цикл не «уезжал»
    if (!t.name.endsWith('.position')) continue;
    const v = t.values, n = v.length / 3, dur = t.times[n - 1] || 1;
    for (let a = 0; a < 3; a++) { const d = v[(n - 1) * 3 + a] - v[a]; for (let i = 0; i < n; i++) v[i * 3 + a] -= d * (t.times[i] / dur); }
      // Клипы с движением по миру начинаются со сдвига таза: возвращаем ось к позе покоя.
      // Вертикальный наклон меньше порога и остаётся как есть.
      const bone = model.getObjectByName(t.name.split('.')[0]), rest = bone ? bone.position.toArray() : null, limit = bone ? bone.position.length() * .3 : Infinity;
      for (let a = 0; rest && a < 3; a++) { let mean = 0; for (let i = 0; i < n; i++) mean += v[i * 3 + a] / n; if (Math.abs(mean - rest[a]) > limit) for (let i = 0; i < n; i++) v[i * 3 + a] += rest[a] - mean; }
  }
  return clip;
}
async function loadAll() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const urls = { idle: idleUrl, run: runUrl, jump: jumpUrl, punch: punchUrl, hit: hitUrl, win: winUrl };
  const [gltf, ...clips] = await Promise.all([loader.loadAsync(modelUrl), ...Object.values(urls).map(u => loader.loadAsync(u))]);
  model = gltf.scene;
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.frustumCulled = false;
    const m = o.material; // Карты нормалей и металла у моделей Tripo дают чёрные пятна при свете
    m.normalMap = null; m.metalnessMap = null; m.roughnessMap = null; m.metalness = 0; m.roughness = .62; m.needsUpdate = true;
    if (m.map) m.map.anisotropy = 8;
  });
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true), k = HEIGHT / (box.max.y - box.min.y);
  model.scale.setScalar(k); model.position.y = -box.min.y * k; model.rotation.y = CFG.modelRotationY;
  character.add(model);
  mixer = new THREE.AnimationMixer(model);
  Object.keys(urls).forEach((name, i) => {
    const cfg = ANIM[name], a = mixer.clipAction(cleanClip(clips[i].animations[0], cfg.loop));
    a.setLoop(cfg.loop ? THREE.LoopRepeat : THREE.LoopOnce); a.clampWhenFinished = !cfg.loop; actions[name] = a;
  });
  play('idle', 0);
}

// ---------- Ход игры ----------
function resetRound() {
  Object.assign(G, { score: 0, time: ROUND, picks: 0, combo: 0, comboT: 0, shake: 0, elapsed: 0, yaw: Math.PI, pitch: .32 });
  Object.assign(player, { vy: 0, facing: Math.PI, grounded: true, stamina: 100, winded: false, hit: 0, punch: 0, cool: 0, inv: 0 });
  player.pos.set(0, 0, 4); player.vel.set(0, 0, 0);
  pickups.forEach(p => { p.g.position.copy(freeSpot(4)); p.g.visible = true; p.wait = 0; });
  bots.forEach((b, i) => { b.active = i < 5; b.wait = 0; b.stun = 0; b.g.visible = b.active; if (b.active) b.pos.copy(freeSpot(24)); });
}
function setState(s) {
  G.state = s;
  const showOverlay = s !== 'play';
  ui.overlay.classList.toggle('hide', !showOverlay); ui.hud.classList.toggle('on', s === 'play' || s === 'pause');
  if (showOverlay && document.pointerLockElement) document.exitPointerLock();
}
function menu(title, lead, btn, result = false) {
  ui.title.textContent = title; ui.lead.textContent = lead; ui.go.textContent = btn; ui.go.disabled = false;
  ui.result.style.display = result ? 'block' : 'none'; ui.lead.style.display = result ? 'none' : 'block';
}
function lockMouse() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* режим перетаскивания */ } }
function start() {
  initAudio();
  if (G.state === 'pause') { setState('play'); lockMouse(); return; }
  resetRound(); setState('play'); lockMouse(); play('idle');
}
function finish() {
  G.best = Math.max(G.best, G.score); store.set(CFG.id + '-best', G.best);
  $('r-score').textContent = G.score; $('r-best').textContent = G.best;
  menu('Время вышло', '', 'Ещё раз', true); setState('over'); play('win', .3); sfx.end();
}
function pause() { if (G.state !== 'play') return; keys.clear(); menu('Пауза', CFG.pauseLead, 'Продолжить'); setState('pause'); }

function collect(p) {
  G.picks++; G.combo++; G.comboT = 3.2;
  const m = mult(); G.score += m;
  burst(p.e.getWorldPosition(new THREE.Vector3()), '#7fd2f5', 16, 5);
  p.g.visible = false; p.wait = .7; sfx.pick(G.combo);
  if (G.picks % 10 === 0) { G.time = Math.min(G.time + 3, 99); toast('+3 секунды', '#7fd2f5'); sfx.bonus(); }
}
function punch() {
  if (G.state !== 'play' || player.cool > 0 || player.hit > 0) return;
  player.punch = .44; player.cool = .55; sfx.punch();
  const f = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
  let got = 0;
  for (const b of bots) {
    if (!b.active) continue;
    const to = new THREE.Vector3().subVectors(b.pos, player.pos); to.y = 0; const d = to.length();
    if (d < 2.7 && (d < 1 || to.normalize().dot(f) > .15)) {
      burst(new THREE.Vector3(b.pos.x, 1.2, b.pos.z), '#ff6a5c', 26, 8);
      b.active = false; b.g.visible = false; b.wait = 3.5; got++;
    }
  }
  if (got) { G.score += 2 * got; toast('+' + 2 * got, '#7fd2f5'); sfx.kill(); G.shake = Math.max(G.shake, .12); }
}
function damage(b) {
  player.hit = .55; player.inv = 1.7; player.punch = 0; G.combo = 0; G.comboT = 0;
  const lost = Math.min(3, G.score); G.score -= lost; toast(lost ? `−${lost}` : 'Осторожно!', '#ff8a80');
  sfx.hit(); G.shake = .4; ui.flash.style.opacity = 1;
  const away = new THREE.Vector3().subVectors(player.pos, b.pos).setY(0).normalize();
  player.vel.copy(away.multiplyScalar(9));
  burst(new THREE.Vector3(player.pos.x, 1.1, player.pos.z), '#ff6a5c', 18, 6);
  b.stun = 1.4; b.pos.addScaledVector(away, -2.2);
}

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
function updatePlayer(dt) {
  const p = player;
  p.hit = Math.max(0, p.hit - dt); p.punch = Math.max(0, p.punch - dt); p.cool = Math.max(0, p.cool - dt); p.inv = Math.max(0, p.inv - dt);
  if (keys.has('ArrowLeft')) G.yaw += 2.4 * dt; if (keys.has('ArrowRight')) G.yaw -= 2.4 * dt;
  fwd.set(Math.sin(G.yaw), 0, Math.cos(G.yaw)); right.set(-Math.cos(G.yaw), 0, Math.sin(G.yaw));
  const fz = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0), sx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  wish.set(0, 0, 0).addScaledVector(fwd, fz).addScaledVector(right, sx);
  const moving = wish.lengthSq() > 0;
  if (moving) wish.normalize();
  const wantSprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const sprint = wantSprint && moving && !p.winded && p.stamina > 0;
  p.stamina = clamp(p.stamina + (sprint ? -34 : 17) * dt, 0, 100);
  if (p.stamina <= 0) p.winded = true; if (p.stamina > 22) p.winded = false;
  const control = p.hit > 0 ? 0 : p.punch > 0 ? .45 : 1, speed = (sprint ? SPRINT : RUN) * control;
  const accel = p.hit > 0 ? 7 : p.grounded ? 16 : 6;
  wish.multiplyScalar(speed);
  p.vel.x += (wish.x - p.vel.x) * Math.min(1, accel * dt); p.vel.z += (wish.z - p.vel.z) * Math.min(1, accel * dt);
  p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
  pushOut(p.pos, .42);
  if (!p.grounded) { p.vy -= 19 * dt; p.pos.y += p.vy * dt; if (p.pos.y <= 0) { p.pos.y = 0; p.vy = 0; p.grounded = true; } }
  const flat = Math.hypot(p.vel.x, p.vel.z);
  if (moving && p.hit <= 0) {
    const target = Math.atan2(wish.x, wish.z); let d = target - p.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
    p.facing += d * Math.min(1, 13 * dt);
  }
  character.position.copy(p.pos); character.rotation.y = p.facing;
  character.visible = p.inv <= 0 || p.hit > 0 || Math.floor(p.inv * 12) % 2 === 0;

  if (p.hit > 0) play('hit');
  else if (p.punch > 0) play('punch');
  else if (!p.grounded) play('jump');
  else if (flat > .6) { play('run', .12); actions.run.setEffectiveTimeScale(flat / RUN * 1.05); }
  else play('idle', .2);
}
function updateWorld(dt) {
  G.elapsed += dt; G.time -= dt;
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; }
  const want = Math.min(10, 5 + Math.floor(G.elapsed / 14));
  bots.forEach((b, i) => {
    if (!b.active) { b.wait -= dt; if (i < want && b.wait <= 0) { b.active = true; b.g.visible = true; b.stun = 0; b.pos.copy(freeSpot(22)); } return; }
    b.phase += dt * 3; b.m.position.y = 1.15 + Math.sin(b.phase) * .14; b.m.rotation.y += dt * 2;
    if (b.stun > 0) { b.stun -= dt; return; }
    const dx = player.pos.x - b.pos.x, dz = player.pos.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
    const sp = 3.5 + Math.min(1.8, G.elapsed * .03);
    b.pos.x += dx / d * sp * dt; b.pos.z += dz / d * sp * dt; b.g.rotation.y = Math.atan2(dx, dz);
    for (const o of bots) if (o !== b && o.active) { const ox = b.pos.x - o.pos.x, oz = b.pos.z - o.pos.z, od = Math.hypot(ox, oz); if (od > .01 && od < 1.8) { b.pos.x += ox / od * dt * 2.2; b.pos.z += oz / od * dt * 2.2; } }
    pushOut(b.pos, .6);
    if (d < 1.15 && player.pos.y < 1.05 && player.inv <= 0) damage(b);
  });
  pickups.forEach(p => {
    if (p.wait > 0) { p.wait -= dt; if (p.wait <= 0) { p.g.position.copy(freeSpot(13)); p.g.visible = true; } return; }
    if (Math.hypot(p.g.position.x - player.pos.x, p.g.position.z - player.pos.z) < 1.45 && player.pos.y < 1.9) collect(p);
  });
  if (G.time <= 0) { G.time = 0; finish(); }
}
function animateProps(dt, t) {
  pickups.forEach(p => { if (!p.g.visible) return; p.e.rotation.y = t * 2 + p.off; p.e.position.y = 1.15 + Math.sin(t * 2.4 + p.off) * .12; });
  ring.material.opacity = .55 + Math.sin(t * 1.6) * .2;
  for (let i = 0; i < PN; i++) {
    const s = parts[i];
    if (s.life > 0) { s.life -= dt; s.v.y -= 11 * dt; s.p.addScaledVector(s.v, dt); dummy.position.copy(s.p); dummy.scale.setScalar(Math.max(s.life * 2, 0)); }
    else { dummy.position.set(0, -50, 0); dummy.scale.setScalar(0); }
    dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); sparks.setMatrixAt(i, dummy.matrix);
  }
  sparks.instanceMatrix.needsUpdate = true;
  if (+ui.flash.style.opacity > 0) ui.flash.style.opacity = Math.max(0, ui.flash.style.opacity - dt * 2.4);
}

const aim = new THREE.Vector3(), camTo = new THREE.Vector3(), camDir = new THREE.Vector3();
function updateCamera(dt) {
  const hero = G.state === 'menu' || G.state === 'over';
  if (hero) { // Камера спереди, персонаж справа от текста
    const want = player.facing + Math.PI + Math.sin(t * .25) * .3; let d = want - G.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    G.yaw += d * Math.min(1, 2.5 * dt); G.pitch += (.06 - G.pitch) * Math.min(1, 2.5 * dt);
  }
  aim.set(player.pos.x, player.pos.y * .6 + 1.42, player.pos.z);
  const cp = Math.cos(G.pitch);
  camDir.set(-Math.sin(G.yaw) * cp, Math.sin(G.pitch), -Math.cos(G.yaw) * cp);
  const hit = camHit(aim, camDir, CAM_DIST + .4) - .4, target = clamp(hit, 1.2, hero ? 3.6 : CAM_DIST);
  G.dist += (target - G.dist) * Math.min(1, (target < G.dist ? 22 : 5) * dt);
  camTo.copy(aim).addScaledVector(camDir, G.dist); camTo.y = Math.max(camTo.y, .35);
  if (hero && innerWidth > 640) aim.addScaledVector(new THREE.Vector3(Math.cos(G.yaw), 0, -Math.sin(G.yaw)), 1.25);
  camera.position.copy(camTo);
  if (G.shake > 0 && !reduced) { G.shake = Math.max(0, G.shake - dt * 1.3); camera.position.x += (Math.random() - .5) * G.shake; camera.position.y += (Math.random() - .5) * G.shake; }
  camera.lookAt(aim);
  const sprintFov = G.state === 'play' && !reduced && Math.hypot(player.vel.x, player.vel.z) > RUN + .6 ? 69 : 60;
  if (Math.abs(camera.fov - sprintFov) > .05) { camera.fov += (sprintFov - camera.fov) * Math.min(1, 7 * dt); camera.updateProjectionMatrix(); }
}

// ---------- Ввод ----------
addEventListener('keydown', e => {
  if (e.code === 'KeyM' && !e.repeat) { G.muted = !G.muted; store.set(CFG.id + '-mute', G.muted ? '1' : '0'); toast(G.muted ? 'Звук выключен' : 'Звук включён'); return; }
  if (e.code === 'Escape' && !document.pointerLockElement) { if (G.state === 'play') pause(); return; }
  if (G.state !== 'play') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'Space' && player.grounded && player.hit <= 0) { player.vy = 7.2; player.grounded = false; tone(240, 420, .1, 'triangle', .07); }
  if (e.code === 'KeyE' || e.code === 'KeyF') punch();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); pause(); });
let dragging = false;
canvas.addEventListener('mousedown', e => {
  if (G.state !== 'play') return;
  if (!document.pointerLockElement) { lockMouse(); dragging = true; }
  if (e.button === 0) punch();
});
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', e => {
  if (G.state !== 'play' || !(document.pointerLockElement === canvas || dragging)) return;
  G.yaw -= e.movementX * .0027; G.pitch = clamp(G.pitch + e.movementY * .0022, -.12, 1.15);
});
let wasLocked = false;
document.addEventListener('pointerlockchange', () => { const now = !!document.pointerLockElement; if (wasLocked && !now) pause(); wasLocked = now; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
ui.go.addEventListener('click', start);

// ---------- Цикл ----------
const clock = new THREE.Clock(); let t = 0, fpsSum = 0, fpsN = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), .05); t += dt;
  if (G.state === 'play') {
    updatePlayer(dt); updateWorld(dt);
    fpsSum += dt; fpsN++;
    if (fpsN === 150) { if (fpsSum / fpsN > 1 / 38 && dpr > 1) { dpr = 1; renderer.setPixelRatio(1); resize(); } fpsSum = 0; fpsN = 0; }
  } else if (G.state === 'menu' || G.state === 'over') {
    character.position.copy(player.pos); character.rotation.y = player.facing; character.visible = true;
  }
  if (mixer && G.state !== 'pause') mixer.update(dt);
  if (G.state !== 'pause') animateProps(dt, t);
  updateCamera(G.state === 'pause' ? 0 : dt);
  key.position.set(player.pos.x + 20, 34, player.pos.z + 14); key.target.position.copy(player.pos);
  sky.position.copy(camera.position);
  drawHud();
  renderer.render(scene, camera);
}

$('brand').textContent = CFG.brand; $('pickup-label').textContent = CFG.pickupLabel;
window.__g = { // нужен tools/test.mjs
  G, player, pickups, bots, keys, punch, finish };
loadAll().then(() => {
  player.facing = Math.PI; resetRound();
  pickups.forEach(p => { p.g.visible = true; });
  menu(CFG.title, CFG.lead, 'Играть');
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('note').textContent = 'Игра рассчитана на клавиатуру и мышь.';
  setState('menu'); document.title = CFG.title;
}).catch(e => { console.error(e); fatal('Не удалось загрузить персонажа: ' + e.message); });
frame();
