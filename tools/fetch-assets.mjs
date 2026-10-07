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
  // Split (level 2)
  ...[
    'concrete_pavers_02',        // streets
    'asphalt_02',                // roads
    'concrete_floor_worn_001',   // indoor floors
    'worn_tile_floor',           // mail room floor
    'white_stucco',              // plaster walls
    'plastered_wall',            // older plaster
    'concrete_wall_008',         // concrete walls and bases
    'rectangular_facade_tiles',  // tiled facades
    'japanese_cedar_planks',     // beams, frames, wooden walls
    'hinoki_planks',             // wooden floors (the heavens)
    'grey_roof_tiles',           // roofs
    'painted_metal_shutter',     // shutters
    'corrugated_iron_02',        // sheds, awnings
    'metal_plate',               // floor plates, doors
    'dark_wood',                 // dark trim
  ].map((id) => [id, '1k', ['Diffuse', 'nor_gl', 'arm']]),
];
// models (glTF + their textures), plus maps the glTF doesn't reference (the fern's alpha is separate)
const MODELS = [['fern_02', '1k', ['Alpha']], ['rock_moss_set_01', '1k'], ['tree_stump_01', '1k'],
  // Split (level 2): street clutter
  ...['exterior_aircon_unit', 'rollershutter_door', 'metal_trash_can', 'trashbag', 'utility_box_01',
    'wooden_crate_02', 'plastic_crate_01', 'cardboard_box_01', 'Barrel_01', 'planter_box_01',
    'korean_public_payphone_01', 'security_camera_01'].map((id) => [id, '1k'])];

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
