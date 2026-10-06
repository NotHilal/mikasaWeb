// A Nocturnum-inspired Classic, our own model built from the side profile of the reference:
// a monster's jaw for a slide (grey bone shell, two rows of teeth, a glowing throat), a dark
// horn core with glowing cracks, a grey shell wrapping the grip down to a hooked pommel,
// a horned crest with a glowing eye at the back, gold claws and blades.
//
// Everything is drawn in "px" units traced off a 1920×1080 side view (x to the back of the
// gun, y down), then scaled into gun space. Four colour variants, like the original.
import * as THREE from 'three';

export const VARIANTS = {
  red: { glow: 0xff2a6d, smoke: 0x7a2bd6, eye: 0xff2040, shell: 0x8a8c96 },
  blue: { glow: 0x2aa8ff, smoke: 0x2a4bff, eye: 0x40c8ff, shell: 0x8a8c96 },
  black: { glow: 0xe6e6ff, smoke: 0x55556a, eye: 0xffffff, shell: 0x45464d },
  yellow: { glow: 0xffb21f, smoke: 0xff5a00, eye: 0xffd040, shell: 0x8a8c96 },
};

const S = 0.00019;                 // metres per px
const GRIP = [1230, 520];          // this px point sits in the hand
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

export function buildNocturnum(variantName = 'red') {
  const V = VARIANTS[variantName] ?? VARIANTS.red;
  const skin = new THREE.Group();   // px space
  const shellMat = new THREE.MeshStandardMaterial({ color: V.shell, map: paintedTexture('#b9bbc4', '#3b3d47', '#e4e6ee', 6), roughness: 0.78, vertexColors: true });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x6a5446, map: paintedTexture('#8a705f', '#2a1e18', '#b39a86', 10), roughness: 0.55, vertexColors: true });
  const grooveMat = new THREE.MeshStandardMaterial({ color: 0x23242c, roughness: 0.9 });
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x241812, roughness: 0.8 });
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xe6dcd5, roughness: 0.45 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9ae55, metalness: 0.55, roughness: 0.3, emissive: 0x2a1a00 });
  const glowMat = new THREE.MeshBasicMaterial({ color: hdr(V.glow, 2.6), toneMapped: true });
  const throatMat = throatMaterial(V.glow);
  const eyeMat = new THREE.MeshBasicMaterial({ color: hdr(V.eye, 3) });

  const W = 190; // shell width in px (chunky, like the reference)

  // upper jaw
  skin.add(slab([[292, 300], [350, 274], [600, 278], [900, 270], [1120, 260], [1238, 252], [1262, 300], [1248, 340],
    [1120, 345], [860, 336], [600, 322], [430, 316], [345, 312]], W, shellMat));
  // lower jaw
  skin.add(slab([[345, 400], [430, 408], { s: [[600, 412], [760, 414], [850, 414]] }, [866, 456], [700, 470], [520, 466], [405, 450]], W - 10, shellMat));
  // trigger guard sweeping back into a spike
  skin.add(slab([[740, 448], { s: [[748, 475], [795, 527], [880, 552], [1000, 558]] }, [1132, 553], [1000, 538],
    { s: [[900, 530], [842, 505], [812, 470]] }, [800, 450]], W - 40, shellMat, 7));
  // horn core: body and the front of the grip
  skin.add(slab([[820, 334], [1250, 318], [1320, 360], [1340, 520], { s: [[1330, 620], [1290, 700], [1240, 745]] }, [1190, 732],
    { s: [[1140, 650], [1090, 540], [1040, 440]] }, [830, 422]], W - 50, coreMat, 7));
  // grey shell down the back of the grip, ending in a hooked pommel
  skin.add(slab([[1040, 352], [1150, 338], [1280, 325], { s: [[1360, 380], [1402, 480], [1426, 600], [1442, 700]] }, [1412, 758],
    { s: [[1340, 768], [1290, 742]] }, [1255, 700], { s: [[1300, 712], [1338, 690], [1362, 600], [1342, 482], [1300, 392], [1200, 364]] }, [1062, 364]], W - 10, shellMat));
  // crest at the back of the slide
  skin.add(slab([[1255, 332], [1250, 240], [1268, 192], [1300, 160], [1332, 176], [1352, 250], [1346, 332]], W - 20, shellMat));
  // spur behind the crest
  skin.add(slab([[1400, 330], { s: [[1470, 310], [1512, 332], [1526, 372]] }, [1502, 348], { s: [[1462, 336]] }, [1406, 350]], 60, coreMat, 5));
  // claw trigger
  skin.add(slab([[1032, 430], { s: [[1022, 480], [990, 522]] }, [1002, 500], { s: [[1012, 468]] }, [1014, 430]], 26, goldMat, 4));

  // glowing throat between the jaws, set back inside the shell
  const throat = new THREE.Mesh(new THREE.BoxGeometry(480, 96, W * 0.5), throatMat);
  throat.position.set(645, -364, 0);
  skin.add(throat);
  // glowing channel along the top of the core
  const channel = new THREE.Mesh(new THREE.BoxGeometry(420, 10, W - 30), glowMat);
  channel.position.set(1040, -346, 0);
  skin.add(channel);

  // teeth, two rows (left and right of the mouth)
  const tooth = new THREE.ConeGeometry(1, 1, 10);
  tooth.translate(0, 0.5, 0); // base at the origin
  const addTooth = (x, y, len, r, up, side, lean) => {
    const m = new THREE.Mesh(tooth, boneMat);
    m.position.set(x, -y, side);
    m.scale.set(r * 1.25, len, r * 1.25); // chunky, like the reference
    m.rotation.z = up ? lean : Math.PI + lean;
    skin.add(m);
  };
  for (const side of [-W * 0.36, W * 0.36]) {
    [[440, 318, 60, 20], [505, 320, 68, 22], [575, 323, 78, 25], [652, 327, 86, 28], [738, 332, 90, 30], [818, 337, 78, 27]]
      .forEach(([x, y, len, r], i) => addTooth(x + (side > 0 ? 8 : -8), y, len, r, false, side, -0.12 + i * 0.01));
    [[470, 410, 62, 20], [545, 412, 72, 23], [622, 413, 74, 24], [702, 414, 58, 21]]
      .forEach(([x, y, len, r]) => addTooth(x + (side > 0 ? -10 : 10), y, len, r, true, side, 0.15));
  }

  // glowing cracks on both sides of the core and grip
  const cracks = [
    [[830, 396], [950, 386], [1060, 374], [1150, 352], [1232, 336]],
    [[1180, 470], [1232, 502], [1266, 562], [1272, 622]],
    [[1222, 600], [1252, 650], [1262, 692]],
    [[880, 412], [960, 405]],
  ];
  for (const side of [1, -1]) {
    for (const pts of cracks) {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, -y, side * ((W - 50) / 2 + 8))));
      skin.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 4, 6), glowMat));
    }
    // gold blades on the lower jaw, the grip shell and the crest
    for (const tri of [[[522, 444], [668, 420], [640, 440]], [[1212, 345], [1352, 333], [1290, 356]], [[1318, 300], [1346, 330], [1306, 322]]]) {
      const g = slab(tri, 6, goldMat, 2);
      g.position.z = side * (W / 2 + 6);
      skin.add(g);
    }
  }

  // dark cracks in the bone shell, and grooves between the ridges of the horn core
  const groove = (pts, z, r, mat) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, -y, z)));
    skin.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, r, 5), mat));
  };
  for (const side of [1, -1]) {
    const shellZ = side * (W / 2 + 10), coreZ = side * ((W - 50) / 2 + 7);
    [[[470, 292], [500, 302], [540, 300]], [[700, 296], [745, 310], [800, 304]], [[1000, 286], [1040, 300]],
      [[580, 440], [640, 452], [690, 444]], [[1380, 520], [1392, 580], [1386, 640]], [[1352, 712], [1388, 735]]]
      .forEach((pts) => groove(pts, shellZ, 2.6, grooveMat));
    [[[910, 344], [896, 414]], [[1010, 338], [1000, 424]], [[1110, 332], [1118, 446]], [[1160, 560], [1250, 566]], [[1180, 650], [1268, 660]]]
      .forEach((pts) => groove(pts, coreZ, 4.5, ribMat));
  }

  // purple wisps rising out of the mouth
  const wisps = [];

  // gold horn on the crest, curving forward
  const horn = new THREE.Mesh(new THREE.ConeGeometry(23, 150, 14), goldMat);
  horn.position.set(1290, -122, 0);
  horn.rotation.z = 0.25;
  skin.add(horn);
  // glowing eyes on both sides of the crest, with smoke curling off them
  const eyes = [];
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(28, 16, 12), eyeMat);
    eye.position.set(1302, -258, side * ((W - 20) / 2 + 4));
    eye.scale.set(1.2, 0.8, 0.5);
    skin.add(eye);
    eyes.push(eye);
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
    sp.userData.x = 470 + i * 80;
    skin.add(sp);
    wisps.push(sp);
  }

  // place px space into gun space
  skin.scale.setScalar(S);
  skin.rotation.y = -Math.PI / 2; // px x → gun +z (towards the back)
  skin.position.copy(GRIP_AT).add(new THREE.Vector3(0, GRIP[1] * S, -GRIP[0] * S));

  // a light inside the throat, so the teeth glow from within
  const inner = new THREE.PointLight(V.glow, 0.25, 0.12, 2);
  inner.position.copy(toGun(640, 360));

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
    muzzle: toGun(300, 358),   // the front of the jaws
    lens: toGun(360, 358),     // the flashlight shines out of the mouth
    color: V.glow,
    // breathing glow, smoke drifting off the eyes
    update(t) {
      const pulse = 0.85 + 0.15 * Math.sin(t * 3.1);
      throatMat.uniforms.uTime.value = t;
      inner.intensity = 0.25 * pulse;
      smoke.forEach((sp) => {
        const k = (t * 0.35 + sp.userData.phase) % 1;
        const side = sp.userData.phase > 0.5 ? 1 : -1;
        sp.position.set(1302 + k * 60, -250 + k * 140, side * (W / 2 + 10 + k * 40));
        sp.scale.setScalar(30 + k * 90);
        sp.material.opacity = Math.sin(k * Math.PI) * 0.55;
      });
      wisps.forEach((sp) => {
        const k = (t * 0.5 + sp.userData.phase) % 1;
        sp.position.set(sp.userData.x + Math.sin(t * 2 + sp.userData.phase * 6) * 20, -330 + k * 120, 0);
        sp.scale.setScalar(40 + k * 80);
        sp.material.opacity = Math.sin(k * Math.PI) * 0.4;
      });
    },
  };
}
