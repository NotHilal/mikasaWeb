// Splits a big set of instances into square chunks, one InstancedMesh per chunk, so the
// camera only draws the chunks in view. Chunks can also be hidden past a distance.
import * as THREE from 'three';


export class Chunked {
  constructor(geometry, material, matrices, { shadow = true, receive = true, maxDist = 60, chunk = 32, colors = null } = {}) {
    this.group = new THREE.Group();
    this.maxDist = maxDist;
    this.chunks = [];
    const buckets = new Map();
    const p = new THREE.Vector3();
    matrices.forEach((m, i) => {
      p.setFromMatrixPosition(m);
      const key = `${Math.floor(p.x / chunk)},${Math.floor(p.z / chunk)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    });
    for (const ids of buckets.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, ids.length);
      ids.forEach((id, j) => {
        mesh.setMatrixAt(j, matrices[id]);
        if (colors) mesh.setColorAt(j, colors[id]);
      });
      mesh.castShadow = shadow;
      mesh.receiveShadow = receive;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.chunks.push(mesh);
    }
  }

  // hide chunks that are beyond maxDist from the camera (fog hides them anyway)
  update(camPos) {
    if (this.maxDist === Infinity) return;
    for (const m of this.chunks) {
      const s = m.boundingSphere;
      m.visible = s.center.distanceTo(camPos) - s.radius < this.maxDist;
    }
  }
}

export function makeMatrix(x, y, z, rotY, scale, tiltX = 0, tiltZ = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, rotY, tiltZ, 'YXZ'));
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale;
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, s);
}
