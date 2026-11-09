// Раскадровка: верхний ряд — поза покоя с десяти сторон (проверка, куда смотрит модель),
// ниже по ряду на клип, десять равных шагов от начала до конца. Клипы обрабатываются так же, как в игре.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import CFG from './config.js';
import { cleanClip } from './clips.js';
import modelUrl from '../assets/model.glb';
import idleUrl from '../assets/idle.glb';
import runUrl from '../assets/run.glb';
import jumpUrl from '../assets/jump.glb';
import punchUrl from '../assets/punch.glb';
import kickUrl from '../assets/kick.glb';
import rollUrl from '../assets/roll.glb';
import hitUrl from '../assets/hit.glb';
import winUrl from '../assets/win.glb';

const ROLES = ['idle', 'run', 'jump', 'punch', 'kick', 'roll', 'hit', 'win'];
const URLS = [idleUrl, runUrl, jumpUrl, punchUrl, kickUrl, rollUrl, hitUrl, winUrl];
const W = 1600, ROW = 220, COLS = 10, H = ROW * (URLS.length + 1);
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setSize(W, H); r.setScissorTest(true); document.body.appendChild(r.domElement);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
(async () => {
  const [gltf, ...clips] = await Promise.all([modelUrl, ...URLS].map(u => loader.loadAsync(u)));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8fa3b5);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.4));
  const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(2, 4, 3); scene.add(d);
  const m = gltf.scene; scene.add(m);
  m.traverse(o => { if (o.isMesh) { o.frustumCulled = false; const t = o.material; t.normalMap = null; t.metalnessMap = null; t.roughnessMap = null; t.metalness = 0; t.roughness = .62; } });
  m.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(m, true), h = b.max.y - b.min.y, cy = b.min.y + h * .5, vw = W / COLS;
  const cam = new THREE.PerspectiveCamera(30, vw / ROW, .01, 100);
  const shoot = (col, row, angle) => {
    const dist = h * 3.1; cam.position.set(Math.sin(angle) * dist, cy + h * .1, Math.cos(angle) * dist); cam.lookAt(0, cy, 0);
    const x = col * vw, y = H - (row + 1) * ROW;
    r.setViewport(x, y, vw - 2, ROW - 2); r.setScissor(x, y, vw - 2, ROW - 2); r.render(scene, cam);
  };
  // Первый кадр ряда 0 снят с +Z, дальше камера обходит модель с шагом 36°.
  for (let i = 0; i < COLS; i++) shoot(i, 0, i * Math.PI * 2 / COLS);
  const mixer = new THREE.AnimationMixer(m);
  clips.forEach((c, row) => {
    const cfg = CFG.anim[ROLES[row]] || {};
    const clip = cleanClip(c.animations[0], cfg.loop, cfg.inPlace, m);
    mixer.stopAllAction(); mixer.clipAction(clip).play();
    for (let i = 0; i < COLS; i++) { mixer.setTime(clip.duration * i / (COLS - 1) * .999); m.updateMatrixWorld(true); shoot(i, row + 1, .4); }
  });
  document.title = 'READY';
})().catch(e => { document.title = 'ERROR'; document.body.innerHTML = '<pre style="color:#fff">' + e.stack + '</pre>'; });
