// ============================================================
// main.js — boot, scene, loop.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { CONFIG, randomName } from './config.js';
import { AssetRegistry } from './AssetRegistry.js';
import { World } from './World.js';
import { CameraRig } from './CameraRig.js';
import { Player } from './Player.js';
import { RemotePlayers } from './RemotePlayers.js';
import { createNetwork } from './net/NetworkManager.js';
import { Editor } from './Editor.js';
import { Interactions } from './Interactions.js';
import { Inventory } from './Inventory.js';
import { Containers } from './Containers.js';
import { Roles } from './Roles.js';
import { Tasks } from './Tasks.js';
import { NpcBrain } from './NpcBrain.js';
import { Skills } from './Skills.js';
import { Mirage } from './Mirage.js';
import { MapView } from './MapView.js';
import { PlayerCard } from './PlayerCard.js';
import { Bibliofolio } from './Bibliofolio.js';

const canvas = document.getElementById('game');
const netDot = document.getElementById('netDot');
const netLabel = document.getElementById('netLabel');

// ---------- compass rose (self-injected: no index.html dependency) ----------
// Deliberately NO backdrop-filter here: filtered elements over an animating
// canvas repaint every frame, and rotating a transform inside one causes
// visible jank during camera drags (especially on Linux). Solid background
// + transform-only updates keep this on the compositor, effectively free.
function createCompass() {
  const style = document.createElement('style');
  style.textContent = `
    #compass {
      position: fixed; top: max(10px, env(safe-area-inset-top)); right: 12px;
      width: 56px; height: 56px;
      background: rgba(20, 16, 12, 0.8);
      border: 1px solid rgba(201,162,75,0.35);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; z-index: 5;
    }
    #compass svg { width: 46px; height: 46px; will-change: transform; }
  `;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'compass';
  el.innerHTML = `
    <svg viewBox="0 0 100 100">
      <g fill="#e9ddc2" font-family="Cinzel, serif" font-size="16" text-anchor="middle" font-weight="700">
        <polygon points="50,8 45,50 55,50" fill="#c9503c"/>
        <polygon points="50,92 45,50 55,50" fill="#e9ddc2" opacity="0.5"/>
        <text x="50" y="24" fill="#c9a24b">N</text>
        <text x="82" y="56">E</text>
        <text x="50" y="90">S</text>
        <text x="18" y="56">W</text>
        <circle cx="50" cy="50" r="4" fill="#c9a24b"/>
      </g>
    </svg>`;
  document.body.appendChild(el);
  return el.querySelector('svg');
}
const compassRose = createCompass();
let lastCompassYaw = Infinity;

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // re-rendered on demand (see loop)
renderer.outputEncoding = THREE.sRGBEncoding;

// ---------- scene & light ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9db8d6);
scene.fog = new THREE.Fog(0x9db8d6, 45, 95);

const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5a6b4a, 0.75);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2d9, 1.0);
sun.position.set(18, 30, 12);
sun.castShadow = true;
// Static shadow strategy: the map barely changes, so the shadow map renders
// ON DEMAND (world.staticChanged → needsUpdate below), not every frame.
// Characters don't cast — they carry blob shadows from the registry.
const isCoarse = matchMedia('(pointer: coarse)').matches;
sun.shadow.mapSize.set(isCoarse ? 1024 : 2048, isCoarse ? 1024 : 2048);
// covers the town core; widen if you build far into the west plot
sun.shadow.camera.left = -48;
sun.shadow.camera.right = 48;
sun.shadow.camera.top = 48;
sun.shadow.camera.bottom = -48;
sun.shadow.camera.far = 110;
sun.shadow.bias = -0.0006;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(
  CONFIG.CAMERA.fov, window.innerWidth / window.innerHeight, 0.5, 250
);

// ---------- boot ----------
const registry = new AssetRegistry();
const world = new World(scene, registry);
const rig = new CameraRig(camera, canvas, CONFIG.CAMERA);

let player, remotes, net, editor, interactions, inventory, containers, roles, tasks, brain, skills, mirage, mapView, biblio;

async function boot() {
  // Optional model assignments — swap placeholders for your GLBs without
  // touching code. Created by the editor's Models section.
  try {
    const res = await fetch('data/models.json');
    if (res.ok) registry.applyOverrides(await res.json());
  } catch { /* no models.json yet — placeholders it is */ }

  await world.load(CONFIG.WORLD_URL);

  editor = new Editor({ world, registry, camera, rig, canvas });

  const identity = { id: crypto.randomUUID(), name: randomName() };

  roles = new Roles();
  await roles.init();
  skills = new Skills();
  await skills.init();
  brain = new NpcBrain(CONFIG, identity);
  interactions = new Interactions({ world, camera, scene, roles, brain, skills });

  inventory = new Inventory();
  await inventory.init();

  containers = new Containers({ world, registry, camera, inventory, cfg: CONFIG, identity, skills });
  await containers.init();

  tasks = new Tasks({ world, inventory, roles, skills });
  await tasks.init();

  // ---- cooking: Use a raw fish near a fire to cook it ----
  // Burn chance falls as Cooking rises: 32% at level 1 → 5% floor by ~10.
  const COOK_SPOTS = new Set(['campfire', 'tavern']);
  const nearFire = () => world.placed.some(rec =>
    COOK_SPOTS.has(rec.data.asset) && (rec.obj ? rec.obj.visible : true) &&
    Math.hypot(rec.data.x - player.pos.x, rec.data.z - player.pos.z) < 3.5);

  inventory.onUse = (id, def) => {
    if (!def.cooksInto) return false;           // not cookable — nothing happens
    if (!nearFire()) {
      skills._toast('You need a fire to cook. The tavern hearth or a campfire will do.');
      return false;
    }
    const burnChance = Math.max(0.05, 0.32 - (skills.level('cooking') - 1) * 0.03);
    if (Math.random() < burnChance) {
      skills.addXp('cooking', 3); // burnt lessons still count
      skills._toast('🔥 Burnt to a crisp. The gulls won\u2019t even take it.');
      return true; // consume the fish — it is very gone
    }
    inventory.add(def.cooksInto, 1);
    skills.addXp('cooking', 9);
    const cookedName = inventory.itemDefs[def.cooksInto]?.name ?? 'a meal';
    skills._toast(`🍳 ${cookedName} — cooked to perfection.`);
    return true; // consume the raw fish
  };

  mirage = new Mirage({ world, registry, skills, inventory, identity });
  await mirage.init();
  mirage.setCamera(camera);

  biblio = new Bibliofolio({ world, registry, skills });
  await biblio.init();
  biblio.setCamera(camera);
  editor.setBibliofolio(biblio);

  roles.onChange = (def) => {
    player?.setRole(roles.current, def?.name);
    tasks.setRole(roles.current);
    brain.playerRole = def?.name ?? '';
  };

  // Example of wiring NPC actions into real systems: trading with the
  // baker actually costs a coin and hands you a honey bun.
  interactions.onAction = (actionId, npc) => {
    if (actionId === 'trade' && npc.role === 'Baker') {
      if (inventory.remove('coin', 1)) {
        inventory.add('bread', 1);
        interactions._say('One honey bun, one coin. Fair as the morning is long.');
      } else {
        interactions._say('No coin, no bun, friend. Them\u2019s the rules.');
      }
      return;
    }
    interactions._say(`(${actionId} isn't wired up yet — hook it in Interactions.onAction.)`);
  };

  const playerMesh = await registry.instance('char_player');
  player = new Player(playerMesh, world, CONFIG.PLAYER, identity.name);
  scene.add(playerMesh, player.marker);
  rig.follow(player.pos);
  rig.target.copy(player.pos);

  remotes = new RemotePlayers(scene, registry, CONFIG.NET, roles);

  mapView = new MapView({ world, registry, player, remotes, mirage, tasks });
  new PlayerCard({
    identity, roles, skills, tasks, inventory,
    skillsPanel: skills, inventoryPanel: inventory,
  });

  // restore a persisted profession onto the nametag + broadcast state
  if (roles.current) player.setRole(roles.current, roles.currentDef?.name);

  net = createNetwork(CONFIG, identity);
  net.onPeerState = (id, name, s, t) => remotes.onState(id, name, s, t);
  net.onPeerLeave = (id) => remotes.onLeave(id);
  net.onStatus = (label, mode) => {
    netLabel.textContent = label;
    netDot.className = `dot ${mode}`;
  };

  try {
    await net.connect();
  } catch (err) {
    console.error('[net] connect failed:', err);
    netLabel.textContent = 'connection failed — playing offline';
    netDot.className = 'dot';
  }

  document.getElementById('loading').classList.add('done');
  setTimeout(() => document.getElementById('hint').classList.add('faded'), 6000);

  requestAnimationFrame(loop);
}

// ---------- tap / click to move ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function groundPointAt(clientX, clientY) {
  pointer.set(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(world.groundMesh, false)[0];
  return hit ? hit.point : null;
}

function handleTap(clientX, clientY) {
  if (!player) return;
  if (editor?.handleTap(clientX, clientY)) return;

  // townsperson first — they're standing on the ground, after all
  const npc = interactions?.pick(clientX, clientY);
  if (npc) {
    interactions.open(npc);
    // stroll over to them
    const p = npc.mesh.position, d = player.pos;
    const dir = new THREE.Vector3(p.x - d.x, 0, p.z - d.z);
    const dist = dir.length();
    if (dist > 1.6) {
      dir.setLength(dist - 1.2);
      player.setMoveTarget(new THREE.Vector3(d.x + dir.x, 0, d.z + dir.z));
    }
    return;
  }

  interactions?.close(); // tapping elsewhere dismisses the panel

  // chests: walk over if far, open if close
  const chest = containers?.pick(clientX, clientY);
  if (chest) {
    const dx = chest.data.x - player.pos.x, dz = chest.data.z - player.pos.z;
    if (Math.hypot(dx, dz) > 2.5) {
      const dir = new THREE.Vector3(dx, 0, dz);
      dir.setLength(dir.length() - 1.0);
      player.setMoveTarget(new THREE.Vector3(player.pos.x + dir.x, 0, player.pos.z + dir.z));
    } else {
      containers.open(chest);
    }
    return;
  }
  containers?.close();

  // the mirage: tap to approach, enter when close
  if (mirage?.isVisible && mirage.pick(clientX, clientY)) {
    const mp = mirage.position;
    const dist = Math.hypot(mp.x - player.pos.x, mp.z - player.pos.z);
    if (dist > 3) {
      const dir = new THREE.Vector3(mp.x - player.pos.x, 0, mp.z - player.pos.z);
      dir.setLength(dir.length() - 2.0);
      player.setMoveTarget(new THREE.Vector3(player.pos.x + dir.x, 0, player.pos.z + dir.z));
    } else {
      mirage.enter();
    }
    return;
  }

  // lore books: walk over, then collect
  const book = biblio?.pick(clientX, clientY);
  if (book) {
    const bp = biblio.positionOf(book);
    if (bp) {
      const dist = Math.hypot(bp.x - player.pos.x, bp.z - player.pos.z);
      if (dist > 2.2) {
        player.setMoveTarget(new THREE.Vector3(bp.x, 0, bp.z));
      } else {
        biblio.collect(book);
      }
    }
    return;
  }

  const p = groundPointAt(clientX, clientY);
  if (p) player.setMoveTarget(p);
}

canvas.addEventListener('click', e => {
  if (rig.consumeWasDrag()) return;
  handleTap(e.clientX, e.clientY);
});

canvas.addEventListener('touchend', e => {
  if (e.touches.length > 0) return;
  e.preventDefault(); // suppress the synthetic click that follows touchend
  if (rig.consumeWasDrag()) return;
  const t = e.changedTouches[0];
  handleTap(t.clientX, t.clientY);
}, { passive: false });

// ---------- resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- loop ----------
let lastT = performance.now();
let netAccum = 0;
let lastSentKey = '';
let walkAccum = 0;
let lastSentAt = 0;
const sendInterval = 1 / CONFIG.NET.sendHz;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;

  player.update(dt);
  rig.follow(player.pos);
  rig.update(dt);

  // every 60m walked trains Endurance a little
  walkAccum += player.isMoving ? (player._speedNow ?? 0) * dt : 0;
  if (walkAccum >= 60) { walkAccum -= 60; skills.addXp('endurance', 3); }

  world.updateNPCs(Date.now());   // deterministic: same on every client
  world.updateWater(Date.now());
  interactions.update(performance.now());
  tasks.trackPlayer(player.pos);
  tasks.update(Date.now(), player.pos);
  containers.update(Date.now());
  mirage.update(Date.now());
  biblio.update(Date.now());
  mapView.draw(Date.now());
  remotes.update(Date.now());

  // compass tracks camera yaw (north = -z); only touches the DOM on change
  if (compassRose && Math.abs(rig.yaw - lastCompassYaw) > 0.01) {
    lastCompassYaw = rig.yaw;
    compassRose.style.transform = `rotate(${rig.yaw}rad)`;
  }

  netAccum += dt;
  if (netAccum >= sendInterval) {
    netAccum = 0;
    // Perf/quota: only broadcast when state actually changed; an idle player
    // costs 0.5 msg/s (heartbeat) instead of 10 msg/s.
    const s = player.state();
    const key = `${s.x},${s.z},${s.h},${s.m},${s.r}`;
    if (key !== lastSentKey || now - lastSentAt > 2000) {
      net.sendState(s);
      lastSentKey = key;
      lastSentAt = now;
    }
  }

  // static world changed (editor, chest de/respawn, model swap) → one
  // shadow-map render, instead of one every frame
  if (world.consumeStaticDirty()) renderer.shadowMap.needsUpdate = true;

  renderer.render(scene, camera);
}

boot().catch(err => {
  console.error(err);
  document.querySelector('#loading h1').textContent = 'FAILED TO LOAD';
  const bar = document.querySelector('#loading .bar');
  bar.outerHTML = `<div style="font-size:12px;opacity:0.7;max-width:80%;text-align:center">${err.message}<br><br>Serve this folder over HTTP (e.g. <code>python3 -m http.server</code>) — ES modules and fetch don't work from file://</div>`;
});
