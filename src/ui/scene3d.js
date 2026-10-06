// The 3D stadium. A real 3D scene (Three.js) with a field, pitcher, batter, the strike zone and the
// ball, drawn from the camera behind home plate. You can drag to orbit, scroll or pinch to zoom,
// and jump between camera views.
//
// Units are FEET, and the layout matches the MLB data:
//   x = right (as seen from behind the plate), y = up, z = toward the camera. Home plate is at the
//   origin and the outfield is toward -z. The mound is at z = -60.5; the bases are 90 feet apart.
//
// Everything that moves comes from the real feed:
//   - pitches fly along MLB's own Hawk-Eye trajectory (release point, speed and break)
//   - a batted ball leaves at its real launch angle, in its real direction, and travels its real distance
//   - handedness: a right-handed batter stands on the viewer's left of the plate, a lefty on the
//     right; a right-handed pitcher holds the ball on the viewer's left, a lefty on the right.
// This module is only loaded when the browser supports WebGL; stage.js falls back to the 2D scene.

import * as THREE from "../../public/vendor/three.module.min.js";
import { themeVar } from "../theme.js";
import { countMood, headshotUrl, TAGS, RING } from "./scene.js";
import { typeColor, callKind } from "../pitchdata.js";

const PLATE_W = 17 / 12;             // home plate is 17 inches wide
const MOUND_Z = -60.5;
const BASE_DIST = 90;
const BASE = BASE_DIST / Math.SQRT2; // distance along each axis to first/third base
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const rad = (deg) => (deg * Math.PI) / 180;

// ---------------------------------------------------------------- camera views
// pos = where the camera is, target = what it looks at. "fov" is how wide it sees (degrees).
export const VIEWS = {
  catcher: { label: "Broadcast", pos: [0, 9, 27], target: [0, 4.2, -45], fov: 38, ghost: true },
  side: { label: "Side", pos: [62, 9, -32], target: [0, 4.5, -30], fov: 34 },
  pitcher: { label: "Pitcher", pos: [5, 8, -69], target: [0, 3.5, 0], fov: 26 },
  center: { label: "Center field", pos: [0, 17, -215], target: [0, 4, 0], fov: 20 },
  top: { label: "Overhead", pos: [0, 270, -48], target: [0, 0, -62], fov: 44 },
  // Point-of-view cameras: the camera sits where that person's eyes are and you look around from
  // there (drag to turn your head, scroll to zoom). `hide` is the person you are looking out of.
  umpPov: { label: "Ump", pov: true, hide: "ump", pos: [1.9, 7.2, 7.2], target: [0, 3.2, -60], fov: 36 },
  catcherPov: { label: "Catcher", pov: true, hide: "catcher", pos: [0, 3.3, 2.6], target: [0, 4.2, -60], fov: 52 },
  batterPov: { label: "Batter", pov: true, hide: "batter", pos: [0, 6.6, -0.7], target: [0, 5, -60], fov: 55 }, // x set from the batter's side
  firstPov: { label: "1st base", pov: true, pos: [58, 6, -56], target: [-4, 4, -12], fov: 62 },
  secondPov: { label: "2nd base", pov: true, pos: [16, 6, -112], target: [0, 4, 0], fov: 44 },
  thirdPov: { label: "3rd base", pov: true, pos: [-58, 6, -56], target: [4, 4, -12], fov: 62 },
  shortPov: { label: "Shortstop", pov: true, pos: [-26, 6, -98], target: [0, 4, 0], fov: 42 },
  outfieldPov: { label: "Outfield", pov: true, pos: [0, 6.5, -300], target: [0, 4, 0], fov: 20 },  // depth set from the park
};

// ---------------------------------------------------------------- the pose of each mood
// legs = how wide the batter's feet are, crouch = how low he sits, tilt = how far the bat leans back
const BATTER_POSE = {
  aggressive: { legs: 1.0, crouch: 0.15, tilt: 38, lean: 0.1 },
  ready: { legs: 0.75, crouch: 0.1, tilt: 24, lean: 0.04 },
  defensive: { legs: 0.6, crouch: 0.45, tilt: 14, lean: -0.05 },
  patient: { legs: 0.7, crouch: 0.05, tilt: 10, lean: 0 },
  tense: { legs: 0.65, crouch: 0.35, tilt: 16, lean: 0 },
};
// armUp = how raised the throwing arm is (degrees, 180 = straight up), slump = how low the shoulders sit
const PITCHER_POSE = {
  confident: { armUp: 215, slump: -0.12 },
  neutral: { armUp: 195, slump: 0 },
  worried: { armUp: 160, slump: 0.28 },
  tense: { armUp: 185, slump: 0.15 },
};
const TONE = { aggressive: "#4bd37b", patient: "#4bd37b", confident: "#4bd37b", ready: "#ffffff", neutral: "#ffffff", defensive: "#7fb8ff", worried: "#ffb14a", tense: "#ffb14a" };

// ================================================================= small canvas textures
const photoCache = new Map(); // player id -> loaded <img> (or null if it failed)

// A round head photo on a canvas. If the photo isn't there (yet), a plain cartoon face shows.
function makeHeadTexture(id) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const draw = (img) => {
    ctx.clearRect(0, 0, 256, 256);
    ctx.save();
    ctx.beginPath(); ctx.arc(128, 128, 118, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#e0ac80"; ctx.fillRect(0, 0, 256, 256);
    if (img) {
      // fill the circle, keeping the top (the face) in view
      const s = Math.max(256 / img.width, 256 / img.height);
      ctx.drawImage(img, (256 - img.width * s) / 2, 0, img.width * s, img.height * s);
    } else {
      ctx.fillStyle = "#1a1405";
      ctx.beginPath(); ctx.arc(95, 112, 9, 0, 7); ctx.arc(161, 112, 9, 0, 7); ctx.fill();
      ctx.lineWidth = 8; ctx.strokeStyle = "#1a1405"; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(98, 165); ctx.quadraticCurveTo(128, 190, 158, 165); ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 10; ctx.strokeStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(128, 128, 118, 0, Math.PI * 2); ctx.stroke();
    texture.needsUpdate = true;
  };
  draw(null);

  if (photoCache.has(id)) {
    if (photoCache.get(id)) draw(photoCache.get(id));
  } else {
    const img = new Image();
    img.crossOrigin = "anonymous"; // MLB's image server allows this, which WebGL needs
    img.onload = () => { photoCache.set(id, img); draw(img); };
    img.onerror = () => photoCache.set(id, null); // keep the cartoon face
    img.src = headshotUrl(id);
  }
  return texture;
}

// A little white label ("Aggressive") as a texture.
function makeLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 384; canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const set = (t) => {
    ctx.clearRect(0, 0, 384, 96);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath(); ctx.roundRect(8, 8, 368, 80, 40); ctx.fill();
    ctx.fillStyle = "#151a24"; ctx.font = "700 46px -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(t, 192, 50);
    texture.needsUpdate = true;
  };
  set(text);
  return { texture, set };
}

// ================================================================= building the stadium
function skyDome(top, bottom) {
  const geo = new THREE.SphereGeometry(1800, 32, 16);
  const colors = [];
  const t = new THREE.Color(top), b = new THREE.Color(bottom), c = new THREE.Color();
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    c.copy(b).lerp(t, clamp(pos.getY(i) / 1800 * 1.6, 0, 1));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
}

function stripeTexture(c1, c2) {
  const canvas = document.createElement("canvas");
  canvas.width = 8; canvas.height = 128;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? c1 : c2; ctx.fillRect(0, i * 16, 8, 16); }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function crowdTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1c2233"; ctx.fillRect(0, 0, 128, 128);
  const palette = ["#e8e0d0", "#d65a5a", "#4f86d6", "#f2c14e", "#7fcf9a", "#c9c9d6"];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) { ctx.fillStyle = palette[Math.floor(rnd() * palette.length)]; ctx.fillRect(rnd() * 128, rnd() * 128, 3, 4); }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(30, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- one park's shape
// A venue is { id, name, lf, lcf, cf, rcf, rf (fence distances in feet), turf, roof, capacity,
// wallColor }. The default is a plain 330-385-330 park, used until the real one is known.
export const DEFAULT_VENUE = { id: "none", name: "", lf: 330, lcf: 385, cf: 385, rcf: 385, rf: 330, turf: "Grass", roof: "Open", capacity: 40000, wallColor: "#174a31" };

// Known wall heights in feet: [first angle, last angle, height] (angle 0 = center, negative = left
// field). MLB doesn't publish these, so only the famous ones are listed; every other wall is 8 ft.
const WALLS = {
  "3": [[-45, -12, 37]],                 // Fenway Park: the Green Monster
  "2395": [[8, 45, 24]],                 // Oracle Park: the right field arcade
  "2": [[10, 45, 21]],                   // Camden Yards: right field
  "31": [[10, 45, 21]],                  // PNC Park: right field
  "2392": [[-45, -8, 19]],               // Daikin Park: the short left field wall
  "17": [[-45, 45, 11]],                 // Wrigley Field: the ivy
  "3313": [[-45, 45, 8]],                // Yankee Stadium
};
export const wallHeightAt = (venue, psi) => {
  for (const [a, b, h] of WALLS[venue.id] || []) if (psi >= a && psi <= b) return h;
  return 8;
};

// Distance to the fence at angle psi (degrees from center field, -45..45). The five measured
// points are joined with smooth curves.
export function wallRadiusAt(venue, psi) {
  const pts = [venue.lf, venue.lcf, venue.cf, venue.rcf, venue.rf];
  const t = (clamp(psi, -45, 45) + 45) / 22.5;          // 0..4
  const i = Math.min(3, Math.floor(t));
  return lerp(pts[i], pts[i + 1], ease(t - i));
}

// Is this wall visibly taller than the standard 8 feet at this angle? (used for tests/labels)
export const venueSummary = (v) => `${v.lf}-${v.cf}-${v.rf} ft`;

function buildField(group, venue) {
  const wallRadius = (psi) => wallRadiusAt(venue, psi);
  const isTurf = /turf/i.test(venue.turf);
  const grass = new THREE.Color(themeVar("--grass") || "#1f5a35");
  if (isTurf) grass.offsetHSL(-0.01, 0.04, 0.025); // artificial turf: a brighter, flatter green
  const dirt = new THREE.Color(themeVar("--dirt") || "#8a6238");
  const mats = {};

  // grass with mowing stripes
  // real grass is mowed in stripes; turf has hardly any
  const stripes = stripeTexture("#" + grass.clone().offsetHSL(0, 0, isTurf ? 0.012 : 0.035).getHexString(), "#" + grass.getHexString());
  stripes.repeat.set(1, 28);
  mats.grass = new THREE.MeshStandardMaterial({ map: stripes, roughness: 1 });
  const field = new THREE.Mesh(new THREE.CircleGeometry(900, 64), mats.grass);
  field.rotation.x = -Math.PI / 2;
  group.add(field);

  // infield dirt, with the grass diamond inside it
  mats.dirt = new THREE.MeshStandardMaterial({ color: dirt, roughness: 1 });
  const skin = new THREE.Mesh(new THREE.CircleGeometry(96, 48), mats.dirt);
  skin.rotation.x = -Math.PI / 2; skin.position.set(0, 0.04, -62);
  group.add(skin);
  const diamond = new THREE.Mesh(new THREE.PlaneGeometry(66, 66), new THREE.MeshStandardMaterial({ color: grass.clone().offsetHSL(0, 0, 0.02), roughness: 1 }));
  diamond.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  diamond.position.set(0, 0.06, -BASE);
  group.add(diamond);
  // the dirt circle around home plate, and a patch of grass behind the dirt skin edge is left as is
  const homeDirt = new THREE.Mesh(new THREE.CircleGeometry(13, 40), mats.dirt);
  homeDirt.rotation.x = -Math.PI / 2; homeDirt.position.set(0, 0.07, 0);
  group.add(homeDirt);

  // mound and rubber
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 0.9, 40), mats.dirt);
  mound.position.set(0, 0.45, MOUND_Z);
  group.add(mound);
  const white = new THREE.MeshStandardMaterial({ color: "#f4f4f0", roughness: 0.8 });
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 0.5), white);
  rubber.position.set(0, 0.97, MOUND_Z);
  group.add(rubber);

  // bases and home plate
  for (const [x, z] of [[BASE, -BASE], [0, -2 * BASE], [-BASE, -BASE]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 1.5), white);
    b.position.set(x, 0.18, z); b.rotation.y = Math.PI / 4;
    group.add(b);
  }
  const shape = new THREE.Shape();
  shape.moveTo(-PLATE_W / 2, PLATE_W); shape.lineTo(PLATE_W / 2, PLATE_W); shape.lineTo(PLATE_W / 2, PLATE_W / 2);
  shape.lineTo(0, 0); shape.lineTo(-PLATE_W / 2, PLATE_W / 2); shape.closePath();
  const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }), white);
  plate.rotation.x = -Math.PI / 2; plate.position.set(0, 0.1, 0);
  group.add(plate);

  // chalk: batter's boxes and foul lines
  const chalk = (w, d, x, z, y = 0.1) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), white);
    m.position.set(x, y, z);
    group.add(m);
  };
  for (const side of [-1, 1]) {
    const cx = side * 3.2, cz = -0.7;
    chalk(0.18, 6, cx + 2, cz); chalk(0.18, 6, cx - 2, cz);   // the two long sides
    chalk(4, 0.18, cx, cz - 3); chalk(4, 0.18, cx, cz + 3);   // the two short ends
  }
  for (const s of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 340), white);
    line.rotation.y = s * -Math.PI / 4;
    line.position.set(s * 120, 0.07, -120);
    group.add(line);
  }

  // outfield wall (green with a yellow top), then the stands behind it
  const wallPos = [], wallIdx = [];
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const psi = -46 + (92 * i) / steps, r = wallRadius(clamp(psi, -45, 45));
    const x = r * Math.sin(rad(psi)), z = -r * Math.cos(rad(psi));
    wallPos.push(x, 0, z, x, wallHeightAt(venue, psi), z);
    if (i < steps) { const k = i * 2; wallIdx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute("position", new THREE.Float32BufferAttribute(wallPos, 3));
  wallGeo.setIndex(wallIdx); wallGeo.computeVertexNormals();
  group.add(new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ color: venue.wallColor, side: THREE.DoubleSide, roughness: 1 })));

  // bigger parks get taller, deeper stands
  const big = clamp(((venue.capacity || 40000) - 25000) / 31000, 0, 1);
  const standDepth = 55 + 45 * big, standTop = 40 + 28 * big;
  const standPos = [], standUv = [], standIdx = [];
  for (let i = 0; i <= steps; i++) {
    const psi = -46 + (92 * i) / steps, r = wallRadius(clamp(psi, -45, 45));
    const s = Math.sin(rad(psi)), c = Math.cos(rad(psi));
    standPos.push(r * s, wallHeightAt(venue, clamp(psi, -45, 45)), -r * c, (r + standDepth) * s, standTop, -(r + standDepth) * c);
    standUv.push(i / steps, 0, i / steps, 1);
    if (i < steps) { const k = i * 2; standIdx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const standGeo = new THREE.BufferGeometry();
  standGeo.setAttribute("position", new THREE.Float32BufferAttribute(standPos, 3));
  standGeo.setAttribute("uv", new THREE.Float32BufferAttribute(standUv, 2));
  standGeo.setIndex(standIdx); standGeo.computeVertexNormals();
  group.add(new THREE.Mesh(standGeo, new THREE.MeshBasicMaterial({ map: crowdTexture(), side: THREE.DoubleSide, color: "#b9b9c8" })));

  // yellow line along the top of the wall
  const trim = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: "#ffd23f", side: THREE.DoubleSide }));
  const tp = [], ti = [];
  for (let i = 0; i <= steps; i++) {
    const psi = -46 + (92 * i) / steps, r = wallRadius(clamp(psi, -45, 45));
    const x = r * Math.sin(rad(psi)), z = -r * Math.cos(rad(psi));
    const h = wallHeightAt(venue, clamp(psi, -45, 45));
    tp.push(x, h - 0.6, z, x, h + 0.3, z);
    if (i < steps) { const k = i * 2; ti.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  trim.geometry.setAttribute("position", new THREE.Float32BufferAttribute(tp, 3));
  trim.geometry.setIndex(ti);
  group.add(trim);

  // light towers, set back with the size of the park
  const k = venue.cf / 385;
  for (const [x, z] of [[-230, -120], [230, -120], [-150, -340], [150, -340]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 150, 8), new THREE.MeshStandardMaterial({ color: "#8d96a6" }));
    pole.position.set(x * k, 75, z * k); group.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(34, 18, 3), new THREE.MeshBasicMaterial({ color: "#fff7d6" }));
    panel.position.set(x * k, 155, z * k); panel.lookAt(0, 100, 0); group.add(panel);
  }

  // distance signs above the wall: left line, center and right line
  for (const [psi, feet] of [[-45, venue.lf], [0, venue.cf], [45, venue.rf]]) {
    const r = wallRadius(psi) + 2;
    const label = makeLabel(`${feet} ft`);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: label.texture, fog: false, depthWrite: false }));
    sign.scale.set(46, 11.5, 1);
    sign.position.set(r * Math.sin(rad(psi)), wallHeightAt(venue, psi) + 9, -r * Math.cos(rad(psi)));
    group.add(sign);
  }
  return mats;
}

// ================================================================= building a player
// Local axes: +z is the way he faces, +y up, and his right hand is at local -x.
function buildPlayer({ jersey, scale, isBatter }) {
  const root = new THREE.Group();
  const body = new THREE.Group();        // everything that crouches and leans
  root.add(body);
  const mat = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const m = { jersey: mat(jersey), pants: mat("#d9dde3"), skin: mat("#e0ac80"), wood: mat("#c8a46a", 0.6), glove: mat("#8a5a2b"), shoe: mat("#20242c") };

  const legs = [-1, 1].map((s) => {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.45, 2.7, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 2.6, 10), m.pants); leg.position.y = -1.3;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.95), m.shoe); shoe.position.set(0, -2.6, 0.2);
    pivot.add(leg, shoe); body.add(pivot);
    return pivot;
  });

  const torsoGroup = new THREE.Group(); torsoGroup.position.y = 2.7; body.add(torsoGroup);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.7, 2.1, 14), m.jersey); torso.position.y = 1.05;
  torsoGroup.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.4, 8), m.skin); neck.position.y = 2.25;
  torsoGroup.add(neck);

  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.98, 1.95, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 1.75, 8), m.jersey); arm.position.y = -0.87;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), m.skin); hand.position.y = -1.8;
    pivot.add(arm, hand); torsoGroup.add(pivot);
    return pivot;
  });

  // the head: a round photo that always faces the camera (a "bobblehead"), plus a label above it
  const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, transparent: true, fog: false, depthWrite: false }));
  head.scale.set(2.3, 2.3, 1); head.position.set(0, 2.95, 0);
  torsoGroup.add(head);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, transparent: true, fog: false, depthWrite: false }));
  label.scale.set(3.4, 0.85, 1); label.position.set(0, 4.55, 0);
  torsoGroup.add(label);
  const labelTex = makeLabel("");
  label.material.map = labelTex.texture;

  // under his feet: a soft shadow and a ring that shows who has the edge
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.1, 24), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.14;
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.75, 40), new THREE.MeshBasicMaterial({ color: "#fff", transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.16;
  root.add(shadow, ring);

  // sweat drops (shown when he is under pressure)
  const drops = [0, 1, 2].map((i) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: "#7fc4ff" }));
    d.visible = false; d.userData.phase = i / 3; torsoGroup.add(d);
    return d;
  });

  const player = { root, body, legs, torsoGroup, arms, head, label, labelTex, ring, drops, mats: m, scale, headTexId: null };

  if (isBatter) {
    // The bat swings around the body: swingGroup turns about the vertical axis, batPivot sets the lean.
    const swingGroup = new THREE.Group(); swingGroup.position.y = 1.6; torsoGroup.add(swingGroup);
    const batPivot = new THREE.Group(); swingGroup.add(batPivot);
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 3.1, 10), m.wood); bat.position.y = 1.35;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), m.wood); knob.position.y = -0.2;
    batPivot.add(bat, knob);
    player.swingGroup = swingGroup; player.batPivot = batPivot; player.bat = bat;
    // His real arms are replaced by two stretchy ones that always reach from his shoulders to his
    // grip on the bat, so his hands follow the bat through the whole swing.
    for (const a of arms) a.visible = false;
    player.links = [0, 1].map(() => {
      const geo = new THREE.CylinderGeometry(0.19, 0.17, 1, 8); geo.rotateX(Math.PI / 2); // axis along +z, length 1
      const link = new THREE.Mesh(geo, m.jersey);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), m.skin);
      return { link, hand };
    });
  } else {
    // glove (on the arm that doesn't throw) and the ball in the throwing hand
    player.glove = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), m.glove);
    player.heldBall = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: "#fff", roughness: 0.5 }));
  }
  root.scale.setScalar(scale);
  return player;
}

// Stretch the batter's two arms from his shoulders to his hands on the bat.
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function updateArmLinks(player) {
  if (!player.links) return;
  player.links.forEach(({ link, hand }, i) => {
    const s = i === 0 ? -1 : 1;
    player.torsoGroup.localToWorld(_a.set(s * 0.98, 1.95, 0));                       // the shoulder
    player.batPivot.localToWorld(_b.set(0, i === 0 ? 0.05 : 0.5, 0));               // a hand low on the bat, and one a bit higher
    link.position.copy(_a).lerp(_b, 0.5);
    link.scale.set(1, 1, Math.max(_a.distanceTo(_b), 0.01));
    link.lookAt(_b);
    hand.position.copy(_b);
  });
}

function setHead(player, id) {
  if (player.headTexId === id) return;
  player.headTexId = id;
  player.head.material.map = makeHeadTexture(id);
  player.head.material.needsUpdate = true;
}

// ================================================================= the stage
/**
 * @param container  the element to put the canvas in
 * @param hooks      { onBanner(title, detail), onBannerHide() }
 */
export function createStage3d(container, hooks = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = "stage-canvas";
  canvas.style.touchAction = "pan-y"; // vertical swipes still scroll the page on a phone
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1.6, 0.5, 4000);
  const world = new THREE.Group(); scene.add(world);
  const stadium = new THREE.Group(); world.add(stadium);

  // ---------------------------------------------------------------- theme (sky, light, grass)
  let sky = null, hemi, sun, fieldMats;
  let venue = DEFAULT_VENUE, venueKey = null;
  function applyTheme() {
    // a closed dome (Tropicana Field) has a roof instead of a sky
    const closed = venue.roof === "Dome";
    const top = closed ? "#4a5263" : themeVar("--sky-top") || "#0b1020";
    const bottom = closed ? "#8d96a8" : themeVar("--sky-bottom") || "#22345c";
    const day = closed ? 0.8 : parseFloat(themeVar("--daylight")) || 0.55;
    if (sky) world.remove(sky);
    sky = skyDome(top, bottom); world.add(sky);
    scene.fog = new THREE.Fog(bottom, 260, 1500);
    if (!hemi) { hemi = new THREE.HemisphereLight("#ffffff", "#406040", 1); scene.add(hemi); }
    if (!sun) { sun = new THREE.DirectionalLight("#fff4dd", 1); sun.position.set(-60, 140, 90); scene.add(sun); }
    hemi.color.set(top).lerp(new THREE.Color("#ffffff"), 0.5);
    hemi.groundColor.set(themeVar("--grass") || "#1f5a35");
    hemi.intensity = 0.55 + 0.7 * day;
    sun.intensity = 0.55 + 0.55 * day;
    // rebuild the field so its colors follow the theme
    stadium.clear();
    fieldMats = buildField(stadium, venue);
  }
  applyTheme();

  // ---------------------------------------------------------------- players
  let batter = null, pitcher = null;

  // The plate umpire and the catcher, crouched behind home plate. They face the pitcher.
  const ump = buildPlayer({ jersey: "#232a38", scale: 1.3, isBatter: false });
  const catcher = buildPlayer({ jersey: "#4a5266", scale: 1.2, isBatter: false });
  for (const [who, x, z, tint] of [[ump, 1.9, 5.6, "#c9ced8"], [catcher, 0, 2.7, "#d9dde3"]]) {
    who.root.position.set(x, 0, z);
    who.root.rotation.y = Math.PI;
    who.ring.visible = false; who.label.visible = false;
    who.heldBall.visible = false; who.glove.visible = false;
    who.mats.pants.color.set(tint);
    setHead(who, 0); // MLB's generic head photo
    world.add(who.root);
  }
  ump.body.position.y = -0.9; ump.torsoGroup.rotation.x = 0.3;      // leaning in over the catcher
  catcher.body.position.y = -1.9; catcher.torsoGroup.rotation.x = 0.1; // in a deep crouch
  catcher.arms[1].rotation.set(-1.35, 0, 0.1);                       // mitt held out toward the pitcher
  const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshStandardMaterial({ color: "#8a5a2b", roughness: 0.9 }));
  mitt.position.set(0, -1.9, 0.2); catcher.arms[1].add(mitt);
  ump.arms[0].rotation.set(-0.25, 0, 0); ump.arms[1].rotation.set(-0.25, 0, 0);
  let cfg = null; // current players/colors
  function rebuildPlayers(next) {
    if (batter) { world.remove(batter.root); batter.links.forEach(({ link, hand }) => world.remove(link, hand)); }
    if (pitcher) world.remove(pitcher.root);
    batter = buildPlayer({ jersey: next.batColor, scale: 1.3, isBatter: true });
    pitcher = buildPlayer({ jersey: next.pitchColor, scale: 2.1, isBatter: false });
    world.add(batter.root, pitcher.root);
    batter.links.forEach(({ link, hand }) => world.add(link, hand));

    // Where each stands. Batter: a righty is on the viewer's LEFT (x < 0) and faces the plate.
    // Pitcher: on the mound, facing the plate.
    const m = next.batSide === "R" ? 1 : -1;   // +1 righty
    batter.m = -m;                              // x of his back shoulder (the bat side) in his own frame
    batter.root.position.set(-m * 3.6, 0, -0.7);
    batter.root.rotation.y = m * Math.PI / 2;   // righty faces +x (toward the plate), lefty faces -x
    pitcher.root.position.set(0, 0.9, MOUND_Z);
    pitcher.ballSide = next.pitchHand === "R" ? -1 : 1; // right hand = local -x = the viewer's left
    // attach the glove and the ball to the correct hands
    const gloveArm = pitcher.arms[pitcher.ballSide === -1 ? 1 : 0];
    const ballArm = pitcher.arms[pitcher.ballSide === -1 ? 0 : 1];
    gloveArm.add(pitcher.glove); pitcher.glove.position.set(0, -2.0, 0.15);
    ballArm.add(pitcher.heldBall); pitcher.heldBall.position.set(0, -2.0, 0.1);
    pitcher.ballArm = ballArm; pitcher.gloveArm = gloveArm;
    // the bat hangs from the back-shoulder side
    batter.swingGroup.position.set(0, 1.6, 0);
    batter.batPivot.position.set(batter.m * 0.95, 0.1, 0.25);
    setHead(batter, next.batterId);
    setHead(pitcher, next.pitcherId);
    // The batter's head is a flat-faced 3D head instead of a camera-facing photo, so it can turn
    // to follow the pitch. The photo is the same one the sprite would show.
    batter.head.visible = false;
    const headRig = new THREE.Group(); headRig.position.copy(batter.head.position);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14), new THREE.MeshStandardMaterial({ color: next.batColor, roughness: 0.8 }));
    skull.scale.set(1, 1, 0.55);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.98, 32), new THREE.MeshBasicMaterial({ map: batter.head.material.map, transparent: true }));
    face.position.z = 0.6;
    headRig.add(skull, face);
    batter.torsoGroup.add(headRig);
    batter.headRig = headRig; batter.faceMat = face.material;
    batter.look = { yaw: 0, pitch: 0 };
    cfg = { ...next };
    pose = null;
    catcher.mats.jersey.color.set(next.pitchColor); // the catcher wears the fielding team's color
    if (VIEWS[viewName]?.pov) setView(viewName, true); // the batter may have changed sides
    else applyVisibility();
  }

  // ---------------------------------------------------------------- mood poses (eased each frame)
  let pose = null;            // the pose we are easing toward
  const cur = { legs: 0.75, crouch: 0.1, tilt: 24, lean: 0, armUp: 195, slump: 0 };
  function setMood({ balls, strikes, spike }) {
    const mood = countMood(balls, strikes);
    const bp = BATTER_POSE[mood.batter], pp = PITCHER_POSE[mood.pitcher];
    pose = { ...bp, ...pp, batterMood: mood.batter, pitcherMood: mood.pitcher, spike: !!spike };
    batter.labelTex.set(TAGS.batter[mood.batter]);
    pitcher.labelTex.set(TAGS.pitcher[mood.pitcher]);
    batter.ring.material.color.set(TONE[mood.batter]);
    pitcher.ring.material.color.set(TONE[mood.pitcher]);
    const glow = !!spike;
    batter.mats.wood.emissive.set(glow ? "#ff7a1a" : "#000000");
    batter.mats.wood.emissiveIntensity = glow ? 1.2 : 0;
    for (const d of batter.drops) d.visible = mood.batter === "tense";
    for (const d of pitcher.drops) d.visible = mood.pitcher === "worried" || mood.pitcher === "tense";
    pitcherShake = mood.pitcher === "tense";
    return mood;
  }
  let pitcherShake = false;

  // ---------------------------------------------------------------- strike zone and pitch markers
  const zoneGroup = new THREE.Group(); world.add(zoneGroup);
  let markers = [];
  function setZone(pitches, top, bottom) {
    zoneGroup.clear(); markers = [];
    const h = Math.max(top - bottom, 0.5);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(PLATE_W, h, 0.01)), new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9 }));
    frame.position.set(0, bottom + h / 2, -PLATE_W);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(PLATE_W, h), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    face.position.set(0, bottom + h / 2, -PLATE_W);
    zoneGroup.add(frame, face);
    // 3x3 grid inside the zone
    const pts = [];
    for (const i of [1, 2]) {
      const x = -PLATE_W / 2 + (PLATE_W * i) / 3, y = bottom + (h * i) / 3;
      pts.push(x, bottom, -PLATE_W, x, top, -PLATE_W, -PLATE_W / 2, y, -PLATE_W, PLATE_W / 2, y, -PLATE_W);
    }
    const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.3 }));
    zoneGroup.add(grid);
    // one marker per pitch of the at-bat, colored by what happened
    const colors = { C: "#ff5b6e", S: "#ff9d4d", W: "#ff9d4d", T: "#ff9d4d", M: "#ff9d4d", F: "#ffcf4a", L: "#ffcf4a", B: "#6cb4ff", "*B": "#6cb4ff", P: "#6cb4ff", I: "#6cb4ff", H: "#6cb4ff" };
    pitches.forEach((p, i) => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
      const last = i === pitches.length - 1;
      const mk = new THREE.Mesh(new THREE.SphereGeometry(last ? 0.26 : 0.2, 12, 10), new THREE.MeshBasicMaterial({ color: p.inPlay ? "#ffffff" : colors[p.code] || "#a3acbd" }));
      mk.position.set(p.x, p.z, -PLATE_W);
      mk.userData = { pitch: p };
      zoneGroup.add(mk); markers.push(mk);
    });
  }

  // ---------------------------------------------------------------- the ball and its trail
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.45, roughness: 0.4 }));
  ball.visible = false; world.add(ball);
  const TRAIL = 16;
  const trail = Array.from({ length: TRAIL }, () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.3 }));
    m.visible = false; world.add(m); return m;
  });
  const trailPts = [];
  function pushTrail(p) {
    trailPts.unshift(p.clone()); if (trailPts.length > TRAIL) trailPts.pop();
    trail.forEach((m, i) => {
      const t = trailPts[i + 1];
      m.visible = !!t && ball.visible;
      if (t) { m.position.copy(t); m.scale.setScalar(1 - i / TRAIL); m.material.opacity = 0.35 * (1 - i / TRAIL); }
    });
  }
  const clearTrail = () => { trailPts.length = 0; trail.forEach((m) => { m.visible = false; }); };

  // ---------------------------------------------------------------- the flight path
  // A glowing tube that draws itself along the ball's route as it flies and stays for a few seconds,
  // so you can see the whole path (a pitch's break, or a batted ball's arc), not just the ball.
  const pathGroup = new THREE.Group(); world.add(pathGroup);
  let pathObj = null; // { mesh, total (index count), life (seconds left once the flight is over) }
  function clearPath() {
    if (!pathObj) return;
    pathGroup.remove(pathObj.mesh);
    pathObj.mesh.geometry.dispose(); pathObj.mesh.material.dispose();
    pathObj = null;
  }
  function buildPath(points, radius, color) {
    clearPath();
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, Math.max(40, points.length * 2), radius, 8, false);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, fog: false }));
    const total = geo.index.count;
    geo.setDrawRange(0, 0);
    pathGroup.add(mesh);
    pathObj = { mesh, total, life: Infinity };
  }
  function setPathProgress(fraction) {
    if (!pathObj) return;
    pathObj.mesh.geometry.setDrawRange(0, Math.floor((clamp(fraction, 0, 1) * pathObj.total) / 3) * 3);
  }
  // Once the flight is over, keep the path on screen for `seconds`, then fade it away.
  const holdPath = (seconds) => { if (pathObj) pathObj.life = seconds; };

  // ---------------------------------------------------------------- the pitch
  // MLB's tracking gives position(t) = p0 + v0*t + a*t^2/2 in feet, with the "y" axis measured
  // from the plate toward the pitcher. We map it to our axes: world x = x, world y = z (height),
  // world z = -y (distance from the plate).
  function pitchPosition(c, t) {
    return new THREE.Vector3(
      c.x0 + c.vX0 * t + 0.5 * c.aX * t * t,
      c.z0 + c.vZ0 * t + 0.5 * c.aZ * t * t,
      -(c.y0 + c.vY0 * t + 0.5 * c.aY * t * t),
    );
  }
  let anim = null; // the thing currently animating: a pitch, or a whole hit
  const events = []; // timed callbacks inside an animation

  function releasePoint() {
    return new THREE.Vector3(pitcher.ballSide * 2.0, 11, MOUND_Z + 2); // out of the pitcher's ball hand
  }

  /** Throw one pitch. `pitch` carries MLB's tracking data (pitch.path) when it has it. */
  function throwPitch(pitch, { stopAtBat = false, showPath = false } = {}) {
    const c = pitch?.path;
    const hand = releasePoint();
    let plateTime = c?.plateTime || 0.42;   // (when the ball reaches the catcher's mitt)
    if (c && stopAtBat) {
      // In a hit the ball meets the bat over the plate instead: stop where it is 1 ft from the tip
      let lo = 0, hi = plateTime;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (c.y0 + c.vY0 * mid + 0.5 * c.aY * mid * mid > 1) lo = mid; else hi = mid; }
      plateTime = lo;
    }
    const arrive = c ? pitchPosition(c, plateTime) : new THREE.Vector3(pitch?.x ?? 0, pitch?.z ?? 2.5, -1.4);
    const dur = clamp(plateTime * 3.4, 1.0, 1.7);   // slow motion so you can follow it
    const windup = 0.5;
    anim = { kind: "pitch", t: 0, windup, dur, hand, arrive, c, plateTime, released: false, showPath, pitch, stopAtBat };
    clearTrail();
    if (showPath && !stopAtBat) {
      // the route the ball will take: from the pitcher's hand, then MLB's tracked path to the catcher
      const points = [];
      if (c) {
        const start = pitchPosition(c, 0);
        for (let i = 0; i <= 3; i++) points.push(hand.clone().lerp(start, ease(i / 3)));
        for (let i = 1; i <= 30; i++) points.push(pitchPosition(c, (i / 30) * plateTime));
      } else {
        for (let i = 0; i <= 12; i++) { const q = hand.clone().lerp(arrive, i / 12); q.y += Math.sin((i / 12) * Math.PI) * 0.5; points.push(q); }
      }
      buildPath(points, 0.14, typeColor(pitch?.typeCode));
    } else if (!stopAtBat) {
      clearPath();
    }
    return windup + dur + 0.5; // how long until the ball has landed (seconds)
  }

  // ---------------------------------------------------------------- the umpire's call
  // When the ball reaches the plate the umpire signals it: a raised fist for a strike (called or
  // swinging), a flat "ball", arms out for a foul. If MLB's robot umpire (ABS) was asked to check
  // the pitch, the original call is followed by the challenge and its result.
  let callRun = null; // { steps, t, i }
  const CALL_TEXT = { strike: "STRIKE", ball: "BALL", foul: "FOUL" };
  function callPitch(pitch) {
    if (!pitch) return;
    const kind = pitch.umpCall || callKind({ code: pitch.code, isInPlay: pitch.inPlay });
    if (!kind) return; // in play: no call
    const steps = [{ at: 0, len: 1.5, kind, text: CALL_TEXT[kind], sub: pitch.challenge ? "umpire's call" : "" }];
    const c = pitch.challenge;
    if (c) {
      steps.push({ at: 1.6, len: 1.5, kind: "abs", text: "ABS CHALLENGE", sub: c.player ? `${c.player} taps his helmet` : "" });
      steps.push(c.inProgress
        ? { at: 3.2, len: 1.5, kind: "abs", text: "UNDER REVIEW", sub: "" }
        : { at: 3.2, len: 2.2, kind: c.to, text: c.overturned ? `OVERTURNED: ${CALL_TEXT[c.to] || ""}` : `CALL STANDS: ${CALL_TEXT[c.to] || ""}`, sub: c.overturned ? "the robot umpire says so" : "", result: true });
    }
    callRun = { steps, t: 0, shown: -1 };
  }
  function stepCall(dt) {
    // arms at rest unless a call is on
    let step = null;
    if (callRun) {
      callRun.t += dt;
      step = [...callRun.steps].reverse().find((st) => callRun.t >= st.at) || null;
      const end = callRun.steps[callRun.steps.length - 1];
      if (callRun.t > end.at + end.len) { callRun = null; step = null; hooks.onCallEnd?.(); }
    }
    const [right, left] = ump.arms;
    right.rotation.set(-0.25, 0, 0); left.rotation.set(-0.25, 0, 0);
    if (!step) return;
    const idx = callRun.steps.indexOf(step);
    if (callRun.shown !== idx) { callRun.shown = idx; hooks.onCall?.(step, { hold: step.len }); }
    const u = callRun.t - step.at;
    const pump = Math.sin(u * 16) * 0.12 * Math.max(0, 1 - u);
    if (step.kind === "strike") right.rotation.set(-rad(165) + pump, 0, 0);                  // the fist goes up
    else if (step.kind === "ball") left.rotation.set(-0.5, 0, -0.9 + Math.sin(u * 5) * 0.08); // a flat hand out to the side
    else if (step.kind === "foul") { right.rotation.set(-0.3, 0, -1.35); left.rotation.set(-0.3, 0, 1.35); } // arms out
    else if (step.kind === "abs") { right.rotation.set(-0.2, 0, -1.5); left.rotation.set(-0.2, 0, 1.5); }   // a "T"
  }

  function pitchBallAt(frac) {
    const { c, hand, arrive, plateTime } = anim;
    const lead = 0.12; // the first bit flies from the hand to where the tracking data starts
    if (c) {
      const start = pitchPosition(c, 0);
      if (frac < lead) return hand.clone().lerp(start, ease(frac / lead));
      return pitchPosition(c, ((frac - lead) / (1 - lead)) * plateTime);
    }
    const p = hand.clone().lerp(arrive, frac);
    p.y += Math.sin(frac * Math.PI) * 0.5;
    return p;
  }

  // ---------------------------------------------------------------- the hit
  /**
   * Where a batted ball goes, in 3D, from MLB's real data: launch angle, distance and spray angle.
   * Returns a function of u in [0,1] -> position, plus how long it hangs in the air (seconds).
   */
  function hitTrajectory(hit, event, batSide, origin) {
    const defaults = { single: 150, double: 290, triple: 360, home_run: 400 };
    const dist = clamp(hit.dist ?? defaults[event] ?? 150, 40, 520);
    const angle = clamp(hit.angle ?? { single: 12, double: 22, triple: 24, home_run: 28 }[event] ?? 15, -10, 60);
    let spray = (batSide === "R" ? -1 : 1) * 14; // no data: assume he pulled it
    if (hit.x != null && hit.y != null) spray = (Math.atan2(hit.x - 125.42, 198.27 - hit.y) * 180) / Math.PI;
    spray = clamp(spray, -48, 48);
    const dx = Math.sin(rad(spray)), dz = -Math.cos(rad(spray));
    const ground = angle < 8;
    const peak = (dist * Math.tan(rad(Math.max(angle, 1)))) / 4;                          // highest point of the arc
    const hang = ground ? 1.6 + dist / 260 : 2 * Math.sqrt((2 * peak) / 32.2);            // seconds in the air
    return {
      dist, angle, spray, hang,
      at(u) {
        const r = dist * u;
        // a parabola: its slope at the bat is the launch angle, and it lands at the real distance
        let y = origin.y + dist * Math.tan(rad(angle)) * u * (1 - u);
        // a ground ball skips along the grass instead
        if (ground) y = 0.45 + Math.abs(Math.sin(u * Math.PI * (3 + dist / 90))) * 1.8 * (1 - u);
        y = Math.max(0.45, y);
        return new THREE.Vector3(origin.x + r * dx, y, origin.z + r * dz);
      },
    };
  }

  // The full replay of a hit: pitch, swing, contact, the ball flying out, and a banner.
  // `info` = { hit, event, batterName, batSide, pitchHand, batterId, pitcherId, batColor, pitchColor, pitch }
  const EVENT_LABEL = { single: "SINGLE", double: "DOUBLE", triple: "TRIPLE", home_run: "HOME RUN" };
  function playHit(info) {
    follow = null; // (a new replay starts with the normal camera)
    rebuildPlayers({ batSide: info.batSide, pitchHand: info.pitchHand, batterId: info.batterId, pitcherId: info.pitcherId, batColor: info.batColor, pitchColor: info.pitchColor });
    setMood({ balls: 0, strikes: 0, spike: info.event === "home_run" });
    setZone([], 3.4, 1.6);
    const pitchDur = 1.5;
    throwPitch(info.pitch || { x: 0, z: 2.6 }, { stopAtBat: true });
    // the ball leaves from wherever the pitch met the bat (kept at a believable height)
    const origin = anim.arrive.clone(); origin.y = clamp(origin.y, 1.8, 4.6); origin.z = clamp(origin.z, -1.6, -0.4);
    const traj = hitTrajectory(info.hit, info.event, info.batSide, origin);
    const flightSecs = clamp(traj.hang * 0.75, 1.3, 3.4);
    anim.kind = "hit"; anim.dur = pitchDur; anim.traj = traj; anim.flightSecs = flightSecs; anim.origin = origin;
    anim.info = info; anim.phase = "pitch"; anim.contactAt = anim.windup + pitchDur;
    anim.total = anim.contactAt + flightSecs + 1.6;
    anim.swingStart = anim.contactAt - 0.2;
    anim.followFrom = null;
    // the batted ball's route, drawn as it flies
    const arc = Array.from({ length: 41 }, (_, i) => traj.at(i / 40));
    buildPath(arc, 0.45, "#ffd23f");
    return Math.round(anim.total * 1000);
  }

  // ---------------------------------------------------------------- camera rig (orbit + presets + follow)
  const rig = { az: 0, el: 0, dist: 50, tx: 0, ty: 0, tz: 0, fov: 38 };
  const goal = { ...rig };
  let viewName = "catcher";
  let pov = false, povDefault = null;   // true while a point-of-view camera is on
  const fromView = (v) => {
    const [px, py, pz] = v.pos, [tx, ty, tz] = v.target;
    const dx = px - tx, dy = py - ty, dz = pz - tz, d = Math.hypot(dx, dy, dz);
    return { az: Math.atan2(dx, dz), el: Math.asin(dy / d), dist: d, tx, ty, tz, fov: v.fov };
  };
  // POV cameras: the camera stays at the eye; yaw/pitch (radians) are where he is looking.
  const povRig = { x: 0, y: 6, z: 0, yaw: 0, pitch: 0, fov: 40 };
  const povGoal = { ...povRig };
  const lookAngles = (from, to) => {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    return { yaw: Math.atan2(dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  };
  // where a POV camera really goes (the batter's and the outfielder's depend on the game)
  function povSpot(name) {
    const v = { ...VIEWS[name] };
    if (name === "batterPov" && cfg) {
      const m = cfg.batSide === "R" ? 1 : -1;            // his x: a righty stands on the viewer's left
      v.pos = [-m * 3.1, 6.6, -0.7];
    }
    if (name === "outfieldPov") v.pos = [0, 6.5, -Math.max(220, venue.cf - 70)];
    return v;
  }
  // hide the person whose eyes we are looking out of; ghost the crew in the broadcast view
  function applyVisibility() {
    const v = VIEWS[viewName];
    const hide = v?.hide;
    if (batter) { batter.root.visible = hide !== "batter"; batter.links.forEach(({ link, hand }) => { link.visible = hand.visible = hide !== "batter"; }); }
    ump.root.visible = hide !== "ump";
    catcher.root.visible = hide !== "catcher";
    const a = v?.ghost ? 0.22 : 1;                         // in the broadcast view they would block the strike zone
    for (const who of [ump, catcher]) who.root.traverse((o) => {
      for (const mat of [].concat(o.material || [])) {
        if (mat.userData.base === undefined) { mat.userData.base = mat.opacity; mat.userData.wasT = mat.transparent; }
        mat.transparent = a < 1 || mat.userData.wasT;
        mat.opacity = mat.userData.base * a;
      }
    });
  }
  function setView(name, instant = false) {
    if (!VIEWS[name]) return;
    viewName = name;
    if (VIEWS[name].pov) {
      const v = povSpot(name);
      Object.assign(povGoal, { x: v.pos[0], y: v.pos[1], z: v.pos[2], fov: v.fov, ...lookAngles(v.pos, v.target) });
      povDefault = { ...povGoal };
      if (instant || !pov) Object.assign(povRig, povGoal);
      pov = true;
    } else {
      pov = false;
      Object.assign(goal, fromView(VIEWS[name]));
      if (instant) Object.assign(rig, goal);
    }
    applyVisibility();
    hooks.onView?.(name);
  }
  setView("catcher", true);
  let follow = null;     // while a hit is flying: { lockPos, look }

  function applyCamera(dt) {
    const k = 1 - Math.exp(-dt * 6);
    let daz = goal.az - rig.az; while (daz > Math.PI) daz -= 2 * Math.PI; while (daz < -Math.PI) daz += 2 * Math.PI;
    rig.az += daz * k;
    for (const key of ["el", "dist", "tx", "ty", "tz", "fov"]) rig[key] += (goal[key] - rig[key]) * k;
    if (follow) {
      camera.position.copy(follow.lockPos);
      follow.look.lerp(follow.target, 1 - Math.exp(-dt * 4));
      camera.lookAt(follow.look);
      camera.fov += (follow.fov - camera.fov) * (1 - Math.exp(-dt * 3));
    } else if (pov) {
      for (const key of ["x", "y", "z", "yaw", "pitch", "fov"]) povRig[key] += (povGoal[key] - povRig[key]) * k;
      camera.position.set(povRig.x, povRig.y, povRig.z);
      const cp = Math.cos(povRig.pitch);
      camera.lookAt(povRig.x + Math.sin(povRig.yaw) * cp, povRig.y + Math.sin(povRig.pitch), povRig.z - Math.cos(povRig.yaw) * cp);
      camera.fov = povRig.fov;
    } else {
      const ce = Math.cos(rig.el);
      camera.position.set(rig.tx + rig.dist * ce * Math.sin(rig.az), rig.ty + rig.dist * Math.sin(rig.el), rig.tz + rig.dist * ce * Math.cos(rig.az));
      camera.lookAt(rig.tx, rig.ty, rig.tz);
      camera.fov = rig.fov;
    }
    camera.updateProjectionMatrix();
  }

  // drag to orbit, wheel / pinch to zoom, double-click to reset
  const pointers = new Map();
  let pinchStart = 0, pinchDist0 = 0;
  const onDown = (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStart = Math.hypot(a.x - b.x, a.y - b.y); pinchDist0 = goal.dist; }
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      goal.dist = clamp(pinchDist0 * (pinchStart / Math.max(d, 1)), 10, 400);
    } else if (!follow && pov) {
      // turn your head: dragging right looks left, like grabbing the picture
      povGoal.yaw = clamp(povGoal.yaw - dx * 0.004 * (povGoal.fov / 40), povDefault.yaw - 2.4, povDefault.yaw + 2.4);
      povGoal.pitch = clamp(povGoal.pitch + dy * 0.003 * (povGoal.fov / 40), -1.0, 0.9);
    } else if (!follow) {
      goal.az -= dx * 0.008;
      if (e.pointerType === "mouse" || Math.abs(dy) > Math.abs(dx) * 2) goal.el = clamp(goal.el + dy * 0.006, 0.03, 1.52);
      viewName = "custom"; hooks.onView?.("custom");
    }
  };
  const onUp = (e) => { pointers.delete(e.pointerId); };
  const onWheel = (e) => {
    e.preventDefault();
    if (pov) { povGoal.fov = clamp(povGoal.fov * Math.exp(e.deltaY * 0.001), 8, 90); return; }
    goal.dist = clamp(goal.dist * Math.exp(e.deltaY * 0.0012), 10, 400); viewName = "custom"; hooks.onView?.("custom"); };
  const onDbl = () => setView("catcher");
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDbl);

  // ---------------------------------------------------------------- per-frame animation
  let time = 0;
  function animate(dt) {
    time += dt;
    // ease the mood pose
    if (pose && batter) {
      const e = 1 - Math.exp(-dt * 5);
      for (const key of ["legs", "crouch", "tilt", "lean", "armUp", "slump"]) cur[key] += (pose[key] - cur[key]) * e;
    }
    if (batter && pitcher) {
      // idle breathing and the batter's stance
      const breathe = Math.sin(time * 2.2) * 0.04;
      batter.body.position.y = -cur.crouch * 1.3 + breathe;
      batter.legs[0].position.x = -0.45 - cur.legs * 0.55; batter.legs[1].position.x = 0.45 + cur.legs * 0.55;
      batter.torsoGroup.rotation.x = cur.lean;
      if (!(anim && anim.swinging)) {
        batter.swingGroup.rotation.y = 0;
        batter.torsoGroup.rotation.y = 0;
        batter.batPivot.rotation.set(-0.5 - cur.tilt * 0.006, 0, -batter.m * rad(cur.tilt) * 0.55 + Math.sin(time * 3) * 0.02); // leans out and back, clear of his face
      }
      batter.root.updateMatrixWorld(true);
      updateBatterHead(dt);
      updateArmLinks(batter);

      pitcher.body.position.y = cur.slump * -0.6 + breathe + (pitcherShake ? Math.sin(time * 60) * 0.03 : 0);
      pitcher.torsoGroup.rotation.x = cur.slump * 0.6;
      if (!(anim && anim.t < anim.windup + 0.35)) {
        pitcher.ballArm.rotation.set(-rad(cur.armUp), 0, pitcher.ballSide * 0.2);
      }
      pitcher.gloveArm.rotation.set(-1.15, 0, -pitcher.ballSide * 0.25);
      for (const d of [...batter.drops, ...pitcher.drops]) {
        if (!d.visible) continue;
        const ph = (time * 0.9 + d.userData.phase) % 1;
        d.position.set((d.userData.phase - 0.5) * 2.4 + (d === batter.drops[0] ? 0.8 : 0), 3.9 - ph * 1.1, 0.4);
        d.material.opacity = 1 - ph;
      }
    }
    if (anim) stepAnim(dt);
    stepCall(dt);
    if (pathObj && Number.isFinite(pathObj.life)) {
      pathObj.life -= dt;
      pathObj.mesh.material.opacity = clamp(pathObj.life / 1.2, 0, 0.95);
      if (pathObj.life <= 0) clearPath();
    }
    applyCamera(dt);
    // keep the ball and its trail a readable size even when it is far from the camera
    const bigger = clamp(camera.position.distanceTo(ball.position) / 38, 1, 9);
    ball.scale.setScalar(bigger);
    trail.forEach((m, i) => { if (m.visible) m.scale.setScalar(bigger * (1 - i / TRAIL)); });
  }

  // The batter's head turns to follow the ball from the pitcher's hand to the plate (and out after
  // contact); between pitches it looks at the pitcher.
  const _look = new THREE.Vector3();
  function updateBatterHead(dt) {
    if (!batter.headRig) return;
    if (batter.faceMat.map !== batter.head.material.map) { batter.faceMat.map = batter.head.material.map; batter.faceMat.needsUpdate = true; }
    if (ball.visible && anim) _look.copy(ball.position); else _look.set(0, 6, MOUND_Z);
    batter.torsoGroup.updateWorldMatrix(true, false);
    const local = batter.torsoGroup.worldToLocal(_look).sub(batter.headRig.position);
    const yaw = clamp(Math.atan2(local.x, local.z), -1.75, 1.75);
    const pitch = clamp(Math.atan2(-local.y, Math.hypot(local.x, local.z)), -0.5, 0.5);
    const k = 1 - Math.exp(-dt * (anim ? 14 : 5));
    batter.look.yaw += (yaw - batter.look.yaw) * k;
    batter.look.pitch += (pitch - batter.look.pitch) * k;
    batter.headRig.rotation.set(batter.look.pitch * 0.6, batter.look.yaw, 0, "YXZ");
  }

  function stepAnim(dt) {
    anim.t += dt;
    const t = anim.t;
    // pitcher's wind-up: the throwing arm goes back, over the top, and forward
    if (anim.kind === "pitch" || anim.kind === "hit") {
      if (t < anim.windup + 0.35) {
        const u = clamp(t / (anim.windup), 0, 1);
        const a = u < 0.45 ? lerp(215, 255, ease(u / 0.45)) : lerp(255, 70, ease((u - 0.45) / 0.55)); // degrees: back, then through
        pitcher.ballArm.rotation.set(-rad(a), 0, pitcher.ballSide * 0.15);
        pitcher.torsoGroup.rotation.x = lerp(cur.slump * 0.6, 0.35, ease(u));
      }
      // the ball sits in the hand until the release
      const releaseT = anim.windup * 0.8;
      pitcher.heldBall.visible = t < releaseT;
      const flightT = t - releaseT;
      if (flightT >= 0 && flightT <= anim.dur) {
        ball.visible = true;
        const p = pitchBallAt(flightT / anim.dur);
        ball.position.copy(p); pushTrail(p);
        anim.ballPos = p;
        if (anim.kind === "pitch" && anim.showPath) setPathProgress(flightT / anim.dur);
      }
      if (anim.kind === "pitch" && !anim.stopAtBat && !anim.called && flightT >= anim.dur) { anim.called = true; callPitch(anim.pitch); }
      if (anim.kind === "pitch" && flightT > anim.dur + 0.5) {
        ball.visible = false; clearTrail(); pitcher.heldBall.visible = true;
        if (anim.showPath) { setPathProgress(1); holdPath(6); }
        anim = null; return;
      }
    }
    if (anim.kind === "hit") stepHit(t);
  }

  function stepHit(t) {
    const a = anim;
    const m = batter.m;
    // the swing: the bat whips around the body, timed to meet the ball
    if (t >= a.swingStart) {
      a.swinging = true;
      const u = clamp((t - a.swingStart) / 0.26, 0, 1);
      batter.swingGroup.rotation.y = -m * rad(lerp(0, 215, ease(u)));
      batter.torsoGroup.rotation.y = -m * rad(lerp(0, 70, ease(u)));
      batter.batPivot.rotation.z = -m * rad(lerp(cur.tilt, 82, ease(Math.min(1, u * 1.6))));
      batter.batPivot.rotation.x = lerp(-0.25, 0, u);
    }
    // contact
    const flightStart = a.contactAt;
    if (t >= flightStart && !a.hitLaunched) {
      a.hitLaunched = true;
      hooks.onContact?.(a.info);
      ball.visible = true; pitcher.heldBall.visible = true;
      a.flash = 0.25;
      follow = { lockPos: camera.position.clone(), look: new THREE.Vector3(rig.tx, rig.ty, rig.tz), target: a.origin.clone(), fov: camera.fov };
    }
    if (t >= flightStart && t <= flightStart + a.flightSecs) {
      const u = clamp((t - flightStart) / a.flightSecs, 0, 1);
      const p = a.traj.at(u);
      ball.position.copy(p); pushTrail(p);
      a.ballPos = p;
      setPathProgress(u);
      follow.target.copy(p);
      follow.fov = clamp(38 + (a.traj.dist / 450) * 22, 38, 62);
      if (!a.bannerShown && u > 0.55) {
        a.bannerShown = true;
        const info = a.info;
        const detail = [info.hit.dist ? `${Math.round(info.hit.dist)} ft` : null, info.hit.speed ? `${Math.round(info.hit.speed)} mph` : null].filter(Boolean).join("  ·  ");
        hooks.onBanner?.(EVENT_LABEL[info.event] || "HIT", detail, info.event === "home_run");
      }
    }
    if (t > flightStart + a.flightSecs) { ball.visible = a.info.event !== "home_run" && t < flightStart + a.flightSecs + 0.7; if (!ball.visible) clearTrail(); }
    if (t >= a.total) {
      follow = null; ball.visible = false; clearTrail(); hooks.onBannerHide?.();
      setPathProgress(1); holdPath(3);
      anim = null;
      hooks.onHitDone?.();
    }
  }

  // ---------------------------------------------------------------- sizing and the render loop
  function resize() {
    const w = Math.max(container.clientWidth, 1), h = Math.max(container.clientHeight, 1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the same framing on tall (phone) and wide (desktop) boxes
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  let raf = 0, last = performance.now(), visible = true, disposed = false;
  const io = new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }, { threshold: 0 });
  io.observe(container);
  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (!visible || document.hidden) return;
    animate(dt);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  // ---------------------------------------------------------------- the public controller
  return {
    canvas,
    VIEWS,
    get view() { return viewName; },
    /** Put these players on the field (rebuilds them only if something changed). */
    setPlayers(next) {
      const key = [next.batSide, next.pitchHand, next.batterId, next.pitcherId, next.batColor, next.pitchColor].join("|");
      if (cfg && cfg.key === key) return;
      rebuildPlayers(next); cfg.key = key;
    },
    setMood,
    setZone,
    throwPitch,
    playHit,
    get busy() { return !!anim; },
    setView,
    clearPath,
    refreshTheme() { applyTheme(); },
    /** Draw this ballpark: its fences, turf, roof and size. Cheap to call on every update. */
    setVenue(next) {
      next = { ...DEFAULT_VENUE, ...next };
      const key = [next.id, next.lf, next.lcf, next.cf, next.rcf, next.rf, next.turf, next.roof, next.wallColor].join("|");
      if (key === venueKey) return;
      venueKey = key; venue = next;
      applyTheme();
    },
    get venue() { return venue; },
    /** Advance time by hand (used by tests; the real loop calls this every frame). */
    advance(seconds, step = 1 / 30) { for (let t = 0; t < seconds; t += step) animate(step); renderer.render(scene, camera); },
    /** A PNG of what is on screen right now. */
    snapshot() {
      renderer.render(scene, camera);
      return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
    },
    /** Project a 3D point to screen pixels (for HTML overlays). */
    project(v) { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * canvas.clientWidth, y: (-p.y * 0.5 + 0.5) * canvas.clientHeight }; },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel); canvas.removeEventListener("dblclick", onDbl);
      renderer.dispose(); canvas.remove();
    },
    // for tests
    _debug: { scene, camera, get batter() { return batter; }, get pitcher() { return pitcher; }, get anim() { return anim; }, ball },
  };
}
