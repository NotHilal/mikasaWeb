// Downloads the scanned CC0 assets from Poly Haven (https://polyhaven.com, public domain)
// into public/assets/. Safe to re-run: files that are already there are skipped.
//   npm run assets
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const OUT = 'public/assets';
const API = 'https://api.polyhaven.com/files/';

// textures: [polyhaven id, resolution, maps]
const TEXTURES = [
  ['forest_leaves_02', '2k', ['Diffuse', 'nor_gl', 'arm']],  // ground
  ['brown_mud_leaves_01', '2k', ['Diffuse', 'nor_gl', 'arm']], // ground, second layer
  ['pine_bark', '1k', ['Diffuse', 'nor_gl', 'arm']],         // tree trunks
];
// models (glTF + their textures), plus maps the glTF doesn't reference (the fern's alpha is separate)
const MODELS = [['fern_02', '1k', ['Alpha']], ['rock_moss_set_01', '1k'], ['tree_stump_01', '1k']];

const exists = (p) => access(p).then(() => true, () => false);

async function download(url, path) {
  if (await exists(path)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  console.log('  +', path);
}

for (const [id, res, maps] of TEXTURES) {
  const files = await (await fetch(API + id)).json();
  for (const map of maps) {
    const name = map === 'Diffuse' ? 'diff' : map;
    await download(files[map][res].jpg.url, join(OUT, 'tex', id, `${name}.jpg`));
  }
}
for (const [id, res, extra = []] of MODELS) {
  const files = await (await fetch(API + id)).json();
  const { gltf } = files.gltf[res];
  const dir = join(OUT, 'models', id);
  await download(gltf.url, join(dir, `${id}.gltf`));
  for (const [rel, f] of Object.entries(gltf.include)) await download(f.url, join(dir, rel));
  for (const map of extra) await download(files[map][res].jpg.url, join(dir, 'textures', `${id}_${map.toLowerCase()}_${res}.jpg`));
}
console.log('assets ready');
