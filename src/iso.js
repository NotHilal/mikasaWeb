// Iso (the seeker's character model): loaded once at start, then cloned for each match.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

let template = null;

export async function loadIso(manager) {
  const gltf = await new GLTFLoader(manager).loadAsync('models/iso.glb');
  template = gltf.scene;
  return template;
}

export const isoReady = () => !!template;
export const cloneIso = () => cloneSkinned(template);
