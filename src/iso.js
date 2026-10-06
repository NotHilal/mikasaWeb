// Iso (the seeker's character model): loaded once at start, then cloned for each match.
// The file is compressed (meshopt geometry, WebP textures at 1024 px: 0.7 MB instead of 15 MB).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

let template = null;

export async function loadIso(manager) {
  const gltf = await new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).loadAsync('models/iso.glb');
  template = gltf.scene;
  return template;
}

export const isoReady = () => !!template;
export const cloneIso = () => cloneSkinned(template);
