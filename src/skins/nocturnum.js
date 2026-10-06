// The Nocturnum Classic. Normally the real model: a 3D-print STL of it, painted with the reference
// picture (see "the real model" below). If those files are missing, a stand-in traced from the
// side profile of the reference:
// a monster's jaw for a slide (grey bone shell, two rows of teeth, a glowing throat), a dark
// horn core with glowing cracks, a grey shell wrapping the grip down to a hooked pommel,
// a horned crest with a glowing eye at the back, gold claws and blades.
//
// Everything is drawn in "px" units traced off a 1920×1080 side view of the original (the
// NocturnumClassicHD reference: x to the back of the gun, y down), then scaled into gun space.
// Four colour variants, like the original.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const VARIANTS = {
  red: { glow: 0xff2a6d, smoke: 0x7a2bd6, eye: 0xff2040, shell: 0x96969c },
  blue: { glow: 0x2aa8ff, smoke: 0x2a4bff, eye: 0x40c8ff, shell: 0x96969c },
  black: { glow: 0xe6e6ff, smoke: 0x55556a, eye: 0xffffff, shell: 0x47474c },
  yellow: { glow: 0xffb21f, smoke: 0xff5a00, eye: 0xffd040, shell: 0x96969c },
};

const S = 0.000168;                // metres per px
const GRIP = [1335, 640];          // this px point sits in the hand
const GRIP_AT = new THREE.Vector3(0, -0.06, 0.045);

// px → gun space
export function toGun(x, y) {
  return new THREE.Vector3(0, GRIP_AT.y - (y - GRIP[1]) * S, GRIP_AT.z + (x - GRIP[0]) * S);
}

// A closed outline. Items: [x, y] = straight line to it; { s: [[x, y], ...] } = smooth curve through them.
function outline(items) {
  const shape = new THREE.Shape();
  items.forEach((it, i) => {
    if (Array.isArray(it)) {
      if (i === 0) shape.moveTo(it[0], -it[1]);
      else shape.lineTo(it[0], -it[1]);
    } else {
      shape.splineThru(it.s.map(([x, y]) => new THREE.Vector2(x, -y)));
    }
  });
  shape.closePath();
  return shape;
}

// An extruded, rounded piece. Vertex colours paint it lighter on top and darker underneath,
// the hand-painted shading Riot's weapon skins use.
function slab(items, depth, mat, bevel = 12) {
  const geo = new THREE.ExtrudeGeometry(outline(items), {
    depth, curveSegments: 18, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.85, bevelSegments: 4,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox, p = geo.attributes.position, n = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = (p.getY(i) - min.y) / Math.max(1, max.y - min.y);
    const edge = Math.abs(n.getZ(i)) < 0.6 ? 0.9 : 1; // rims a touch darker, faces lighter
    const v = (0.6 + 0.55 * k) * edge;
    col.set([v, v, v * 1.02], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(geo, mat);
}

// the glowing throat: magenta energy flowing towards the muzzle, darker purple in the folds
function throatMaterial(glow) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(glow).multiplyScalar(2.4) }, uB: { value: new THREE.Color(0x3a0a5a).multiplyScalar(1.2) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uA, uB; varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec2 p = vec2(vUv.x * 7.0 + uTime * 1.8, vUv.y * 3.0 + sin(vUv.x * 9.0 - uTime * 2.0) * 0.35);
        float f = n(p) * 0.6 + n(p * 2.3 + 4.0) * 0.4;
        vec3 col = mix(uB, uA, smoothstep(0.25, 0.75, f));
        gl_FragColor = vec4(col * (0.9 + f * 0.6), 1.0);
      }`,
  });
}

// hand-painted look: mottled base, lighter worn edges, a few dark cracks
function paintedTexture(base, dark, light, cracks) {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = Math.random() < 0.5 ? dark : light;
    g.globalAlpha = 0.05 + Math.random() * 0.08;
    g.beginPath();
    g.ellipse(Math.random() * s, Math.random() * s, 8 + Math.random() * 40, 6 + Math.random() * 25, Math.random() * 3, 0, 7);
    g.fill();
  }
  g.globalAlpha = 0.35;
  g.strokeStyle = dark;
  g.lineWidth = 1.5;
  for (let i = 0; i < cracks; i++) {
    let x = Math.random() * s, y = Math.random() * s;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 260, 1 / 260); // extrude UVs are in px
  return t;
}

function smokeTexture() {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k); // brighter than white, so it blooms

// --- the real model ------------------------------------------------------------------------
// A 3D-print STL of the Classic in two halves (public/models/nocturnum/top.stl and grip.stl),
// put back together and placed in the reference's px space, then painted by projecting the
// reference picture onto it from the side (paint.webp, the gun's part of the picture). The pink
// parts of the picture (throat, cracks, eye) glow. Other variants are recoloured from it.
const PAINT = { x: 260, y: 70, w: 1360, h: 880 };                   // paint.webp = this part of the reference
const FIT = { x0: 288, s: 4.93, front: 126.8, y0: 95, top: 60.5 }; // STL mm → reference px
let model = null; // { geometry, image }

export async function loadNocturnum(manager) {
  const stl = new STLLoader(manager);
  const [top, grip, image] = await Promise.all([
    stl.loadAsync('models/nocturnum/top.stl'), stl.loadAsync('models/nocturnum/grip.stl'),
    new THREE.ImageLoader(manager).loadAsync('models/nocturnum/paint.webp'),
  ]);
  // each half lies diagonally on the print bed, cut face down: turn its long side along x
  const align = (g) => {
    const p = g.attributes.position;
    let mx = 0, my = 0, sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < p.count; i++) { mx += p.getX(i); my += p.getY(i); }
    mx /= p.count; my /= p.count;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) - mx, y = p.getY(i) - my; sxx += x * x; sxy += x * y; syy += y * y; }
    g.translate(-mx, -my, 0);
    g.rotateZ(-0.5 * Math.atan2(2 * sxy, sxx - syy));
  };
  align(top); align(grip);
  grip.rotateX(Math.PI); // printed upside down
  // join them at the cut (both cut faces at z = 0, centred on each other)
  const cutCentre = (g) => {
    const p = g.attributes.position, c = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i)) < 0.3) { c.x += p.getX(i); c.y += p.getY(i); n++; }
    return c.divideScalar(n);
  };
  const ct = cutCentre(top), cg = cutCentre(grip);
  top.translate(-ct.x, -ct.y, 0);
  grip.translate(-cg.x, -cg.y, 0);
  const geometry = mergeVertices(mergeGeometries([top, grip]), 0.01);
  // into the reference's px space (x right, y up = -px y; mirrored, as the picture shows the
  // other side), with the picture's pixels as its paint
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const X = FIT.x0 + FIT.s * (FIT.front - p.getX(i)), Y = FIT.y0 + FIT.s * (FIT.top - p.getZ(i));
    p.setXYZ(i, X, -Y, -FIT.s * p.getY(i));
  }
  geometry.computeVertexNormals();
  // Paint coordinates: where the point is in the picture. Surfaces the picture can't see (top,
  // bottom, back) are sampled a little inside the outline, so they get the gun's own colour
  // rather than smears of its edge and the background.
  const n = geometry.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i), inPlane = Math.hypot(nx, ny), away = 14 * Math.min(1, inPlane * 1.4);
    const X = p.getX(i) - (inPlane > 1e-4 ? (nx / inPlane) * away : 0);
    const Y = -p.getY(i) + (inPlane > 1e-4 ? (ny / inPlane) * away : 0);
    uv[i * 2] = (X - PAINT.x) / PAINT.w;
    uv[i * 2 + 1] = 1 - (Y - PAINT.y) / PAINT.h;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // how much each point faces the picture (its sides): 1 = painted, 0 = plain shell grey
  const side = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) side[i] = THREE.MathUtils.smoothstep(Math.abs(n.getZ(i)), 0.2, 0.65);
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  model = { geometry, image };
}

// the paint for a variant: the picture (recoloured for the others), and what glows in it
const paints = new Map();
function paintFor(name, V) {
  if (paints.has(name)) return paints.get(name);
  const { image } = model, w = image.width, h = image.height;
  const base = document.createElement('canvas'), glow = document.createElement('canvas');
  base.width = glow.width = w; base.height = glow.height = h;
  const bg = base.getContext('2d'), gg = glow.getContext('2d');
  bg.drawImage(image, 0, 0);
  const img = bg.getImageData(0, 0, w, h), out = gg.createImageData(w, h), d = img.data, o = out.data;
  const tint = new THREE.Color(V.glow), sR = tint.r * 255, sG = tint.g * 255, sB = tint.b * 255;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], max = Math.max(r, g, b);
    // the hot pink and red parts: much more red than green (not gold, not the brown core)
    const k = Math.min(1, Math.max(0, (r - g - 60) / 100)) * Math.min(1, Math.max(0, (r - 110) / 60));
    if (name !== 'red' && k > 0) {
      const m = max / 255;
      d[i] = r + (sR * m - r) * k; d[i + 1] = g + (sG * m - g) * k; d[i + 2] = b + (sB * m - b) * k;
    }
    if (name === 'black' && k < 0.1 && max - Math.min(r, g, b) < 40 && max > 55 && max < 190) {
      d[i] *= 0.42; d[i + 1] *= 0.42; d[i + 2] *= 0.45; // grey shell → near black (teeth stay pale)
    }
    o[i] = d[i] * k; o[i + 1] = d[i + 1] * k; o[i + 2] = d[i + 2] * k; o[i + 3] = 255;
  }
  bg.putImageData(img, 0, 0);
  gg.putImageData(out, 0, 0);
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const p = { map: tex(base), glow: tex(glow) };
  paints.set(name, p);
  return p;
}

export const nocturnumReady = () => !!model;


export function buildNocturnum(variantName = 'red') {
  const V = VARIANTS[variantName] ?? VARIANTS.red;
  const skin = new THREE.Group();   // px space
  const shellMat = new THREE.MeshStandardMaterial({ color: V.shell, map: paintedTexture('#c4c4c9', '#56565c', '#e9e9ec', 6), roughness: 0.78, vertexColors: true });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x564238, map: paintedTexture('#7a6252', '#241a15', '#a08672', 10), roughness: 0.55, vertexColors: true });
  const grooveMat = new THREE.MeshStandardMaterial({ color: 0x23242c, roughness: 0.9 });
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x241812, roughness: 0.8 });
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xdcc8c6, roughness: 0.45 });
  // the upper teeth sit over the throat, so they take on its glow
  const molarMat = new THREE.MeshStandardMaterial({ color: 0xc89ea2, roughness: 0.5, emissive: new THREE.Color(V.glow).multiplyScalar(0.12) });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9ae55, metalness: 0.55, roughness: 0.3, emissive: 0x2a1a00 });
  const glowMat = new THREE.MeshBasicMaterial({ color: hdr(V.glow, 2.6), toneMapped: true });
  const throatMat = throatMaterial(V.glow);
  const eyeMat = new THREE.MeshBasicMaterial({ color: hdr(V.eye, 1.5) }); // (bright enough to glow, not so bright it washes out to white)

  const W = 190; // shell width in px (chunky, like the reference)

  if (model) {
    // the real model, painted; what glows in the paint glows
    const paint = paintFor(variantName, V);
    const mat = new THREE.MeshStandardMaterial({
      map: paint.map, emissiveMap: paint.glow, emissive: 0xffffff, emissiveIntensity: 1.8, roughness: 0.62, metalness: 0.05,
    });
    // where the picture can't see (top, bottom, back), plain shell grey instead of smeared paint
    const flat = new THREE.Color(V.shell).multiplyScalar(0.75);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFlat = { value: flat };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aSide; varying float vSide;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vSide = aSide;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uFlat; varying float vSide;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb = mix(uFlat, diffuseColor.rgb, vSide);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance *= vSide;`);
    };
    skin.add(new THREE.Mesh(model.geometry, mat));
  } else {

    // upper jaw: a long grey snout with a notch on top; the upper teeth hang from its underside
    skin.add(slab([[288, 165], [335, 140], [400, 124], [470, 110], [508, 103], [516, 96], [528, 105], [600, 108], [700, 112],
      [850, 115], [1000, 115], [1150, 116], [1238, 118], [1252, 165], [1245, 215], [1150, 222], [1000, 226], [890, 236],
      [840, 214], [760, 205], [640, 200], [520, 198], [420, 198], [360, 190], [320, 182]], W, shellMat));
    // lower jaw: pointed at the front, the fangs stand on it, it sweeps back into the trigger guard
    skin.add(slab([[350, 402], [395, 355], [430, 322], [470, 306], [620, 300], [780, 295], [860, 292], [885, 320], [870, 380],
      [830, 430], [790, 470], [700, 452], [600, 440], [500, 428], [420, 414]], W - 10, shellMat));
    // trigger guard: a loop under the core, ending in a spike pointing back
    skin.add(slab([[780, 445], { s: [[790, 505], [835, 545], [905, 568], [1000, 575], [1085, 570]] }, [1140, 560],
      { s: [[1060, 546], [990, 542], [910, 535], [860, 515], [825, 480]] }, [815, 445]], W - 40, shellMat, 7));
    // horn core: the dark body behind the jaws and the front of the grip
    skin.add(slab([[820, 232], [1000, 226], [1200, 220], [1290, 232], [1340, 300], [1370, 420], [1395, 560], [1405, 700],
      [1400, 820], [1350, 870], [1295, 880], { s: [[1288, 800], [1265, 690], [1225, 560], [1180, 480]] }, [1110, 440],
      [1020, 452], [950, 445], [880, 440], [830, 420], [812, 330]], W - 50, coreMat, 7));
    // grey shell over the top of the core and down the back of the grip, to a hooked pommel
    skin.add(slab([[1040, 332], [1110, 305], [1200, 292], [1300, 295], [1380, 320],
      { s: [[1430, 380], [1470, 470], [1510, 560], [1545, 660], [1575, 750]] }, [1592, 800], [1575, 850],
      { s: [[1480, 880], [1380, 905]] }, [1300, 925], [1268, 922], [1280, 885], { s: [[1330, 855], [1390, 825]] },
      { s: [[1395, 790], [1375, 700], [1345, 600], [1305, 500], [1250, 420], [1180, 375]] }, [1100, 360], [1048, 350]], W - 10, shellMat));
    // the dark opening through the grip
    const hole = new THREE.CircleGeometry(1, 24);
    for (const side of [1, -1]) {
      const h = new THREE.Mesh(hole, grooveMat);
      h.scale.set(24, 80, 1);
      h.position.set(1372, -740, side * ((W - 50) / 2 + 9));
      h.rotation.y = side > 0 ? 0 : Math.PI;
      skin.add(h);
    }
    // crest at the back of the slide: a grey helm with the eye under it
    skin.add(slab([[1255, 300], [1250, 220], [1262, 160], [1290, 115], [1330, 95], [1370, 120], [1400, 170], [1420, 230],
      [1445, 300], [1452, 345], [1420, 330], [1380, 320], [1300, 318]], W - 20, shellMat));
    // brown hook spur behind the crest
    skin.add(slab([[1450, 275], { s: [[1490, 255], [1515, 258], [1535, 290], [1542, 330]] }, [1535, 355],
      { s: [[1520, 320], [1495, 290]] }, [1460, 295]], 60, coreMat, 5));
    // claw trigger
    skin.add(slab([[1052, 452], { s: [[1045, 490], [1010, 515]] }, [985, 522], [1020, 500], { s: [[1035, 470]] }, [1035, 452]], 26, goldMat, 4));

    // the glowing throat between the jaws, and the glow running back along the core
    const throat = new THREE.Mesh(new THREE.BoxGeometry(360, 100, W * 0.5), throatMat);
    throat.position.set(660, -252, 0);
    skin.add(throat);
    const channel = new THREE.Mesh(new THREE.BoxGeometry(360, 22, W - 34), throatMat);
    channel.position.set(1000, -262, 0);
    skin.add(channel);

    // teeth: big pale fangs standing up from the lower jaw (tips leaning forward), and rounded
    // teeth hanging from the upper jaw; a row each side of the mouth
    const fang = new THREE.ConeGeometry(1, 1, 12);
    fang.translate(0, 0.5, 0); // base at the origin
    const molar = new THREE.SphereGeometry(1, 16, 12);
    for (const side of [-W * 0.34, W * 0.34]) {
      for (const [bx, by, tx, ty, hw] of [[455, 300, 462, 262, 18], [520, 300, 495, 225, 38], [645, 297, 605, 210, 45], [775, 292, 740, 200, 52]]) {
        const m = new THREE.Mesh(fang, boneMat);
        const dx = tx - bx, dy = -(ty - by);
        m.position.set(bx, -by, side);
        m.scale.set(hw, Math.hypot(dx, dy), hw * 0.8);
        m.rotation.z = Math.atan2(-dx, dy);
        skin.add(m);
      }
      for (const [cx, top, bottom, hw] of [[422, 205, 285, 22], [470, 207, 280, 24], [555, 200, 245, 40], [668, 200, 262, 48]]) {
        const m = new THREE.Mesh(molar, molarMat);
        m.position.set(cx, -(top + bottom) / 2, side * 0.9);
        m.scale.set(hw, (bottom - top) / 2, hw * 0.75);
        skin.add(m);
      }
    }

    // glowing cracks on both sides of the core and grip
    const cracks = [
      [[805, 405], [900, 385], [1040, 355]],
      [[1220, 440], [1238, 480], [1285, 520], [1365, 555]],
      [[1210, 520], [1280, 560], [1340, 610], [1380, 670]],
    ];
    for (const side of [1, -1]) {
      for (const pts of cracks) {
        const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, -y, side * ((W - 50) / 2 + 8))));
        skin.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 5, 6), glowMat));
      }
      // gold blades on the lower jaw, the grip shell and the crest
      for (const tri of [[[515, 370], [665, 345], [655, 405]], [[1210, 332], [1372, 330], [1340, 372]], [[1430, 305], [1455, 348], [1425, 325]]]) {
        const g = slab(tri, 6, goldMat, 2);
        g.position.z = side * (W / 2 + 6);
        skin.add(g);
      }
    }

    // dark cracks in the grey shell, and grooves between the ridges of the horn core
    const groove = (pts, z, r, mat) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, -y, z)));
      skin.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, r, 5), mat));
    };
    for (const side of [1, -1]) {
      const shellZ = side * (W / 2 + 10), coreZ = side * ((W - 50) / 2 + 7);
      [[[400, 140], [430, 160], [480, 158]], [[620, 130], [660, 150], [720, 146]], [[980, 128], [1020, 150]],
        [[560, 380], [620, 395], [690, 388]], [[1460, 560], [1480, 640], [1470, 700]], [[1430, 860], [1480, 880]]]
        .forEach((pts) => groove(pts, shellZ, 2.6, grooveMat));
      [[[930, 240], [915, 430]], [[1060, 236], [1050, 440]], [[1180, 232], [1200, 400]], [[1290, 600], [1385, 610]], [[1310, 740], [1395, 750]]]
        .forEach((pts) => groove(pts, coreZ, 4.5, ribMat));
    }
  }

  // purple wisps rising out of the mouth
  const wisps = [];

  // gold horn on the crest, curving forward
  if (!model) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(20, 110, 14), goldMat);
    horn.position.set(1282, -128, 0);
    horn.rotation.z = 0.35;
    skin.add(horn);
  }
  // glowing eyes on both sides of the crest, with smoke curling off them
  const eyes = [];
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(28, 16, 12), eyeMat);
    eye.position.set(1385, -240, side * ((W - 20) / 2 + 4));
    eye.scale.set(1.2, 0.8, 0.5);
    if (!model) skin.add(eye); // (the model's eye is in its paint)
    eyes.push(eye);
    // and a pair on the back of the crest, facing whoever holds it (what you see in first person)
    const back = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), eyeMat);
    back.position.set(1448, -248, side * 40);
    back.scale.set(12, 22, 32);
    skin.add(back);
  }
  const smokeTex = smokeTexture();
  const smoke = Array.from({ length: 7 }, (_, i) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: hdr(V.smoke, 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    sp.userData.phase = i / 7;
    skin.add(sp);
    return sp;
  });
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: hdr(V.smoke, 1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    sp.userData.phase = i / 6;
    sp.userData.x = 500 + i * 60;
    skin.add(sp);
    wisps.push(sp);
  }

  // place px space into gun space
  skin.scale.setScalar(S);
  skin.rotation.y = -Math.PI / 2; // px x → gun +z (towards the back)
  skin.position.copy(GRIP_AT).add(new THREE.Vector3(0, GRIP[1] * S, -GRIP[0] * S));

  // a light inside the throat, so the teeth glow from within
  // (only for the stand-in: on the solid real model it would just tint the outside pink)
  const inner = new THREE.PointLight(V.glow, model ? 0 : 0.25, 0.12, 2);
  inner.position.copy(toGun(640, 255));

  // floating sphere for the inspect animation (the original's telekinetic magazine)
  const orb = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.012, 20, 14), new THREE.MeshBasicMaterial({ color: hdr(V.glow, 2.2) }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: hdr(V.glow, 1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(0.06);
  const spikes = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.003, 0.012, 6), boneMat);
    const d = new THREE.Vector3().randomDirection();
    sp.position.copy(d).multiplyScalar(0.014);
    sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    spikes.add(sp);
  }
  orb.add(core, halo, spikes);
  orb.visible = false;

  const group = new THREE.Group();
  group.add(skin, inner);
  group.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  return {
    group,
    orb,
    spikes,
    muzzle: toGun(300, 250),   // the front of the jaws
    lens: toGun(380, 250),     // the flashlight shines out of the mouth
    color: V.glow,
    // breathing glow, smoke drifting off the eyes
    update(t) {
      const pulse = 0.85 + 0.15 * Math.sin(t * 3.1);
      throatMat.uniforms.uTime.value = t;
      if (!model) inner.intensity = 0.25 * pulse;
      smoke.forEach((sp) => {
        const k = (t * 0.35 + sp.userData.phase) % 1;
        const side = sp.userData.phase > 0.5 ? 1 : -1;
        sp.position.set(1385 - k * 40, -235 + k * 130, side * (W / 2 + 10 + k * 40));
        sp.scale.setScalar(30 + k * 90);
        sp.material.opacity = Math.sin(k * Math.PI) * 0.55;
      });
      wisps.forEach((sp) => {
        const k = (t * 0.5 + sp.userData.phase) % 1;
        sp.position.set(sp.userData.x + Math.sin(t * 2 + sp.userData.phase * 6) * 20, -230 + k * 120, 0);
        sp.scale.setScalar(40 + k * 80);
        sp.material.opacity = Math.sin(k * Math.PI) * 0.4;
      });
    },
  };
}
