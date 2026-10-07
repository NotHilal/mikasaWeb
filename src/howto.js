// "How to play": a few slides, one per thing to know (moving, each ability of each role, the
// hunter's immunity), each with a short looping animation (SVG, animated with SMIL so it restarts
// whenever its slide is shown) and the keys from the player's own bindings. The characters are
// drawn with their real pictures (rendered from the 3D models, see portraits.js): head shots on
// the maps seen from above, Slenderman whole in the side views.
import { label } from './keys.js';
import { characterImages } from './portraits.js';
import { GUN, DART, PAGE_HINT, FLASH, DASH, TELEPORT, EYE, GRAB, PAGES } from './config.js';
import { $ } from './ui.js';

const TEAL = '#3fe0c5', PURPLE = '#a87bff', RED = '#ff4655', INK = '#ece8e1', DIM = '#2a3440', KEY = '#1b2733', SHIELD = '#8ce6ff';
let IMG = {}; // the characters' pictures (characterImages), set when How to play opens

// --- little SVG helpers ---------------------------------------------------------------------
// animate `attr` through `values` at `times` (fractions of the loop)
const A = (attr, values, times, dur, mode = 'linear') =>
  `<animate attributeName="${attr}" values="${values}" keyTimes="${times}" dur="${dur}s" repeatCount="indefinite" calcMode="${mode}"/>`;
// visible from a to b (fractions of the loop)
const shown = (a, b, dur) => (a === 0 ? A('opacity', '1;0', `0;${b}`, dur, 'discrete') : A('opacity', '0;1;0', `0;${a};${b}`, dur, 'discrete'));
// move through `values` ("x y;x y;…")
const T = (values, times, dur, mode = 'linear') =>
  `<animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${times}" dur="${dur}s" repeatCount="indefinite" calcMode="${mode}"/>`;
const R = (values, times, dur) =>
  `<animateTransform attributeName="transform" type="rotate" values="${values}" keyTimes="${times}" dur="${dur}s" repeatCount="indefinite"/>`;
const text = (x, y, s, { size = 13, fill = INK, anchor = 'middle' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" class="ht-t">${s}</text>`;
const keycap = (x, y, s, { w = 28, extra = '' } = {}) =>
  `<g><rect x="${x - w / 2}" y="${y - 12}" width="${w}" height="24" rx="3" fill="${KEY}" stroke="rgba(236,232,225,.4)">${extra}</rect>${text(x, y + 5, s, { size: 12 })}</g>`;

// A character seen from above: their head shot in a ring of their colour, with a pointer for the
// way they face (`angle`, degrees clockwise from up; the picture itself stays upright). `extra`
// animates the ring's colour (an <animate attributeName="fill"> works: it's turned onto the ring).
function token(head, { ring, angle = 0, extra = '' }) {
  const anim = extra.replace(/attributeName="fill"/g, 'attributeName="stroke"');
  return `<g transform="rotate(${angle})"><path d="M0 -19 L5 -13 L-5 -13Z" fill="${ring}">${extra}</path></g>`
    + `<circle r="11.5" fill="#0b141d" stroke="${ring}" stroke-width="2.5">${anim}</circle>`
    + (head ? `<image href="${head}" x="-10" y="-10" width="20" height="20" clip-path="url(#ht-clip)"/>` : `<circle r="7" fill="${ring}">${extra}</circle>`);
}
const seeker = (o = {}) => token(IMG.seekerHead, { ring: TEAL, ...o });
const hunter = (o = {}) => token(IMG.hunterHead, { ring: PURPLE, ...o });

const TREES = [[30, 40], [95, 30], [150, 55], [280, 30], [300, 120], [120, 120], [175, 175], [260, 175], [20, 110], [220, 130]];
const trees = (skip = []) => TREES.filter((_, i) => !skip.includes(i)).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="#16212b" stroke="#22313d"/>`).join('');

// Slenderman from the side, standing on y = 170, centred on x. `red` ({ values, times, dur }, each
// value 0 or 1) is when he glows red (stunned). On the picture (480 × 720, whole figure framed as
// in portraits.js) his head is about 10% down and his chest about 35%: SIDE.head / SIDE.body.
const SIDE = { top: 10, h: 160, head: 10 + 160 * 0.1, body: 10 + 160 * 0.36 };
function slenderSide(x, red) {
  const tint = A('opacity', red.values.split(';').map((v) => +v * 0.8).join(';'), red.times, red.dur, 'discrete');
  if (IMG.hunter) {
    const w = SIDE.h * (480 / 720), at = `x="${x - w / 2}" y="${SIDE.top}" width="${w}" height="${SIDE.h}"`;
    return `<image href="${IMG.hunter}" ${at}/><image href="${IMG.hunter}" ${at} filter="url(#ht-red)" opacity="0">${tint}</image>`;
  }
  // (without the picture: a tall thin shape)
  const fill = A('fill', red.values.split(';').map((v) => (+v ? RED : DIM)).join(';'), red.times, red.dur, 'discrete');
  return `<g fill="${DIM}">${fill}<ellipse cx="${x}" cy="${SIDE.head}" rx="9" ry="13"/><path d="M${x - 13} ${SIDE.head + 16}h26l4 62-6 66h-7l-4-50-4 50h-7l-6-66z"/></g>`;
}

const wrap = (body) => `<svg viewBox="0 0 320 200" class="ht-svg" xmlns="http://www.w3.org/2000/svg">
  <defs><pattern id="ht-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(236,232,225,.05)"/></pattern>
  <radialGradient id="ht-beam" cx="0.5" cy="1" r="1"><stop offset="0" stop-color="#fff1dc" stop-opacity=".55"/><stop offset="1" stop-color="#fff1dc" stop-opacity="0"/></radialGradient>
  <radialGradient id="ht-halo"><stop offset="0" stop-color="${TEAL}" stop-opacity=".7"/><stop offset="1" stop-color="${TEAL}" stop-opacity="0"/></radialGradient>
  <clipPath id="ht-clip"><circle r="10"/></clipPath>
  <filter id="ht-red"><feFlood flood-color="${RED}"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs>
  <rect width="320" height="200" fill="#0b141d"/><rect width="320" height="200" fill="url(#ht-grid)"/>${body}</svg>`;

// --- the slides -------------------------------------------------------------------------------
function slides() {
  const k = label;
  const mins = PAGE_HINT.afterMs / 60000;
  return [
    {
      role: 'Both', name: 'Moving', keys: [k('forward'), k('left'), k('back'), k('right'), k('sprint'), k('jump')],
      text: `<b>${k('forward')} ${k('left')} ${k('back')} ${k('right')}</b> to move, the mouse to look. <b>${k('sprint')}</b> sprints (seeker only, until the stamina bar runs out). <b>${k('jump')}</b> jumps over rocks and logs. <b>Esc</b> pauses.`,
      art: (() => {
        const d = 4, red = (a, b) => A('fill', a === 0 ? `${RED};${KEY}` : `${KEY};${RED};${KEY}`, a === 0 ? `0;${b}` : `0;${a};${b}`, d, 'discrete');
        return wrap(`
          <rect x="55" y="55" width="60" height="70" fill="none" stroke="rgba(236,232,225,.12)" stroke-dasharray="4 4"/>
          <g>${T('115 125;115 55;55 55;55 125;115 125', '0;0.25;0.5;0.75;1', d)}${seeker()}</g>
          ${keycap(240, 70, k('forward'), { extra: red(0, 0.25) })}
          ${keycap(208, 102, k('left'), { extra: red(0.25, 0.5) })}
          ${keycap(240, 102, k('back'), { extra: red(0.5, 0.75) })}
          ${keycap(272, 102, k('right'), { extra: red(0.75, 1) })}
          ${keycap(240, 140, k('sprint'), { w: 72 })}${text(240, 168, 'sprint', { size: 11, fill: 'rgba(236,232,225,.55)' })}
          ${keycap(240, 182, k('jump'), { w: 96 })}`);
      })(),
    },
    {
      role: 'Seeker', name: 'Classic', keys: [k('shoot')],
      text: `<b>${k('shoot')}</b> fires. ${GUN.ammo} rounds, then it reloads by itself in ${GUN.reloadMs / 1000} s. A body hit stuns the hunter for ${GUN.bodyStunMs / 1000} s, a headshot for ${GUN.headStunMs / 1000} s: he can't move or use anything while he glows red.`,
      art: (() => {
        const d = 4.5;
        return wrap(`
          <line x1="0" y1="170" x2="320" y2="170" stroke="rgba(236,232,225,.15)"/>
          ${slenderSide(220, { values: '0;1;0;1;0', times: '0;0.12;0.36;0.55;0.98', dur: d })}
          <line x1="50" y1="160" x2="220" y2="${SIDE.body}" stroke="#ffd28a" stroke-width="2">${shown(0.12, 0.15, d)}</line>
          <line x1="50" y1="160" x2="220" y2="${SIDE.head}" stroke="#ffd28a" stroke-width="2">${shown(0.55, 0.58, d)}</line>
          ${IMG.seeker ? `<image href="${IMG.seeker}" x="6" y="62" width="76" height="114"/>` : '<path d="M28 160h34v9H44l-3 14h-9l3-14h-7z" fill="#ece8e1"/>'}
          ${[0, 1, 2].map((i) => `<rect x="${10 + i * 9}" y="184" width="5" height="9" fill="${INK}">${i === 2 ? shown(0, 0.12, d) : i === 1 ? shown(0, 0.55, d) : ''}</rect>`).join('')}
          <g>${shown(0.12, 0.36, d)}${text(220, 196, 'BODY · STUNNED 2S', { fill: RED })}</g>
          <g>${shown(0.55, 0.98, d)}${text(220, 196, 'HEADSHOT · STUNNED 4S', { fill: RED })}</g>`);
      })(),
    },
    {
      role: 'Seeker', name: 'Recon dart', keys: [k('dart')],
      text: `<b>${k('dart')}</b> fires a dart that sends out ${DART.pulses} scans. If the hunter is within ${DART.radius} m of it, you see him through the trees for a moment (he is told). ${DART.cooldown} s cooldown.`,
      art: (() => {
        const d = 5, pulse = (s) => `<circle cx="170" cy="100" fill="none" stroke="${TEAL}" stroke-width="2">${A('r', '0;0;75;75', `0;${s};${s + 0.14};1`, d)}${A('opacity', '0;0;0.9;0;0', `0;${s - 0.001};${s};${s + 0.14};1`, d)}</circle>`;
        return wrap(`${trees([2])}
          <g>${T('50 160;50 160;110 70;170 100;170 100', '0;0.05;0.15;0.25;1', d)}<path d="M0 -6L4 0L0 6L-4 0Z" fill="${TEAL}">${shown(0.05, 0.9, d)}</path></g>
          ${pulse(0.3)}${pulse(0.45)}${pulse(0.6)}
          <g transform="translate(240 70)">${A('opacity', '0.25;1;0.25', '0;0.32;0.9', d, 'discrete')}${hunter({ angle: -110, extra: A('fill', `${DIM};${RED};${DIM}`, '0;0.32;0.9', d, 'discrete') })}</g>
          <g>${shown(0.32, 0.9, d)}${text(240, 46, 'REVEALED', { fill: RED, size: 12 })}</g>
          <g transform="translate(50 160)">${seeker({ angle: 45 })}</g>`);
      })(),
    },
    {
      role: 'Seeker', name: 'Recon finds pages', keys: [k('dart')],
      text: `Stuck? After ${mins} minutes without taking a page, <b>Recon can now find pages</b> shows. From then on, a dart scan that reaches a page makes the closest one glow through the trees for ${PAGE_HINT.revealMs / 1000} s. Only you see where; the hunter is told a page was revealed. Taking a page starts the ${mins} minutes again.`,
      art: (() => {
        const d = 6;
        return wrap(`${trees([3, 4])}
          <g>${shown(0, 0.15, d)}${text(292, 22, `${mins - 1}:59`, { size: 16, fill: 'rgba(236,232,225,.6)' })}</g>
          <g>${shown(0.15, 1, d)}${text(292, 22, `${mins}:00`, { size: 16, fill: TEAL })}</g>
          <g>${shown(0.15, 0.42, d)}<rect x="62" y="34" width="196" height="24" fill="${TEAL}"/>${text(160, 51, 'RECON CAN NOW FIND PAGES', { size: 12, fill: '#0b141d' })}</g>
          <circle cx="245" cy="78" r="11" fill="#16212b" stroke="#22313d"/>
          <circle cx="232" cy="80" r="26" fill="url(#ht-halo)">${shown(0.64, 0.95, d)}</circle>
          <rect x="228" y="74" width="8" height="11" fill="#d9d4c5">${A('opacity', '0.15;1;0.15', '0;0.64;0.95', d, 'discrete')}</rect>
          <g>${shown(0.64, 0.95, d)}${text(232, 118, 'PAGE REVEALED', { fill: TEAL, size: 12 })}</g>
          <g>${T('60 165;60 165;130 70;175 100;175 100', '0;0.45;0.52;0.6;1', d)}<path d="M0 -6L4 0L0 6L-4 0Z" fill="${TEAL}">${shown(0.45, 0.95, d)}</path></g>
          <circle cx="175" cy="100" fill="none" stroke="${TEAL}" stroke-width="2">${A('r', '0;0;80;80', '0;0.62;0.76;1', d)}${A('opacity', '0;0;0.9;0;0', '0;0.619;0.62;0.76;1', d)}</circle>
          <g transform="translate(60 165)">${seeker({ angle: 35 })}</g>`);
      })(),
    },
    {
      role: 'Seeker', name: 'Flash', keys: [k('flash')],
      text: `<b>${k('flash')}</b> throws a flash that curves and pops. It blinds the hunter if he's facing it, or whichever way he looks if it pops within ${FLASH.closeRange} m of him. It goes off early right by his head. ${FLASH.cooldown} s cooldown.`,
      art: (() => {
        const d = 4;
        return wrap(`${trees([4, 6])}
          <g transform="translate(60 150)">${seeker({ angle: 45 })}</g>
          <g transform="translate(232 72)">${hunter({ angle: -130 })}</g>
          <circle r="5" fill="#fff6d8">${shown(0.08, 0.35, d)}<animateMotion path="M60 150 C120 60 180 150 205 95" keyPoints="0;0;1;1" keyTimes="0;0.08;0.35;1" calcMode="linear" dur="${d}s" repeatCount="indefinite"/></circle>
          <circle cx="205" cy="95" fill="#fffbe8">${A('r', '0;0;60;60', '0;0.35;0.5;1', d)}${A('opacity', '0;0;1;0;0', '0;0.349;0.35;0.5;1', d)}</circle>
          <rect width="320" height="200" fill="#fff">${A('opacity', '0;0;0.85;0;0', '0;0.36;0.37;0.75;1', d)}</rect>
          <g>${shown(0.37, 0.75, d)}${text(232, 46, 'BLINDED', { fill: '#0b141d', size: 14 })}</g>`);
      })(),
    },
    {
      role: 'Seeker', name: 'Dash', keys: [k('dash')],
      text: `<b>${k('dash')}</b> bursts ${DASH.distance} m the way you're moving (forward if you're standing still). ${DASH.cooldown} s cooldown.`,
      art: (() => {
        const d = 3;
        return wrap(`${trees([5, 9])}
          ${[0, 1, 2].map((i) => `<line x1="${90 + i * 10}" y1="${92 + i * 8}" x2="${200 + i * 10}" y2="${92 + i * 8}" stroke="#dcf5ff" stroke-width="2" stroke-linecap="round">${A('opacity', '0;0;0.8;0;0', '0;0.3;0.38;0.6;1', d)}</line>`).join('')}
          ${[0.25, 0.5, 0.75].map((f) => `<circle cx="${80 + 150 * f}" cy="100" r="11" fill="${TEAL}">${A('opacity', '0;0;0.35;0;0', `0;${0.3 + f * 0.08};${0.3 + f * 0.08 + 0.01};0.6;1`, d)}</circle>`).join('')}
          <g>${T('80 100;80 100;230 100;230 100', '0;0.3;0.38;1', d)}${seeker({ angle: 90 })}</g>
          <path d="M80 135h150" stroke="rgba(236,232,225,.3)" stroke-dasharray="3 4"/>${text(155, 152, `${DASH.distance} M`, { size: 12, fill: 'rgba(236,232,225,.6)' })}`);
      })(),
    },
    {
      role: 'Seeker', name: 'Pages and flashlight', keys: [k('take'), k('light')],
      text: `Find the ${PAGES} pages pinned around the forest. In the dark they're only a faint pale shape: the flashlight shows them. Look at one up close and press <b>${k('take')}</b> to take it. <b>${k('light')}</b> turns the flashlight on and off, but it also shows where you are.`,
      art: (() => {
        const d = 5;
        return wrap(`${trees([3])}
          <circle cx="215" cy="80" r="11" fill="#16212b" stroke="#22313d"/>
          <rect x="198" y="74" width="8" height="11" fill="#d9d4c5">${A('opacity', '0.2;1;0;0.2', '0;0.38;0.66;1', d, 'discrete')}</rect>
          <circle cx="202" cy="80" r="10" fill="#fff1dc">${A('opacity', '0;0;0.35;0;0', '0;0.37;0.4;0.66;1', d)}</circle>
          <g>${T('90 160;90 160;180 100;180 100', '0;0.42;0.6;1', d)}
            <g>${R('-70;55;55', '0;0.4;1', d)}<path d="M0 0 L-30 -115 L30 -115 Z" fill="url(#ht-beam)"/></g>
            ${seeker({ angle: 55 })}</g>
          <g>${shown(0.62, 0.7, d)}${keycap(150, 60, k('take'))}</g>
          <g>${shown(0.66, 1, d)}${text(200, 40, `+1 PAGE · 1 / ${PAGES}`, { fill: TEAL, size: 14 })}</g>`);
      })(),
    },
    {
      role: 'Seeker', name: 'Break free', keys: [k('escape')],
      text: `When the hunter grabs you, mash <b>${k('escape')}</b> to fill the bar before the time runs out. The first grab is easy (${GRAB.escape[0].presses} presses), the second is hard (${GRAB.escape[1].presses}, and the bar drains). The ${GRAB.kill === 3 ? 'third' : `${GRAB.kill}th`} grab can't be escaped.`,
      art: (() => {
        const d = 4, beats = [0.06, 0.14, 0.22, 0.3, 0.38, 0.46, 0.54, 0.62];
        return wrap(`
          ${IMG.hunter ? `<image href="${IMG.hunter}" x="232" y="20" width="100" height="150" opacity=".55"/>` : ''}
          ${IMG.seeker ? `<image href="${IMG.seeker}" x="-6" y="56" width="76" height="114" opacity=".7"/>` : ''}
          ${text(160, 52, 'GRABBED', { size: 34, fill: RED })}
          ${text(160, 76, 'MASH TO BREAK FREE', { size: 12, fill: 'rgba(236,232,225,.7)' })}
          <rect x="60" y="96" width="200" height="14" fill="#0f1923" stroke="rgba(236,232,225,.2)"/>
          <rect x="60" y="96" height="14" fill="${TEAL}">${A('width', `0;${beats.map((_, i) => 25 * (i + 1)).join(';')};200;0`, `0;${beats.join(';')};0.7;1`, d, 'discrete')}</rect>
          <rect x="60" y="114" height="3" fill="${RED}">${A('width', '200;60;60', '0;0.7;1', d)}</rect>
          ${keycap(160, 150, k('escape'), { w: 96, extra: A('fill', [KEY, ...beats.flatMap(() => [RED, KEY])].join(';'), `0;${beats.flatMap((b) => [b, b + 0.03]).join(';')}`, d, 'discrete') })}
          <g>${shown(0.7, 1, d)}<rect x="70" y="20" width="180" height="40" fill="#0b141d"/>${text(160, 50, 'BROKE FREE', { size: 30, fill: TEAL })}</g>`);
      })(),
    },
    {
      role: 'Hunter', name: 'Teleport', keys: [k('teleport'), k('cancelTp')],
      text: `Hold <b>${k('teleport')}</b> to aim, release to go there (up to ${TELEPORT.range} m), after a short wind-up the seeker can see. Not where the seeker is looking: the marker turns red there. <b>${k('cancelTp')}</b> cancels. ${TELEPORT.cooldown} s cooldown.`,
      art: (() => {
        const d = 5;
        return wrap(`${trees([5, 9, 6])}
          <g transform="translate(262 52)"><path d="M0 0 L-120 60 L-70 115 Z" fill="${TEAL}" opacity=".12"/>${seeker({ angle: -125 })}</g>
          <g>${T('80 145;180 120;180 120;140 70;140 70', '0;0.3;0.42;0.55;1', d)}
            <circle r="11" fill="none" stroke-width="3">${A('stroke', `${PURPLE};${RED};${PURPLE}`, '0;0.2;0.47', d, 'discrete')}${shown(0.04, 0.62, d)}</circle></g>
          <g>${shown(0.2, 0.47, d)}${text(180, 150, 'THE SEEKER CAN SEE THAT SPOT', { size: 11, fill: RED })}</g>
          ${[[60, 160], [140, 70]].map(([x, y]) => `<circle cx="${x}" cy="${y}" fill="#8a8f99">${A('r', '0;0;22;22', '0;0.6;0.75;1', d)}${A('opacity', '0;0;0.7;0;0', '0;0.599;0.6;0.8;1', d)}</circle>`).join('')}
          <g>${T('60 160;60 160;140 70;140 70', '0;0.68;0.681;1', d, 'discrete')}${hunter({ angle: 30 })}</g>
          <g>${shown(0, 0.6, d)}${text(60, 192, `HOLD ${k('teleport')}`, { size: 12 })}</g>
          <g>${shown(0.6, 0.8, d)}${text(60, 192, 'RELEASE', { size: 12, fill: PURPLE })}</g>`);
      })(),
    },
    {
      role: 'Hunter', name: 'Eye', keys: [k('eye')],
      text: `<b>${k('eye')}</b> throws an eye that flies up to about ${Math.round(EYE.speed * EYE.flight)} m (press <b>${k('eye')}</b> again to stop it early), then reveals the seeker if they're within ${EYE.radius} m, through the trees. ${EYE.cooldown} s cooldown.`,
      art: (() => {
        const d = 5;
        return wrap(`${trees([3, 8])}
          <g transform="translate(50 150)">${hunter({ angle: 66 })}</g>
          <g>${T('62 140;62 140;210 80;210 80', '0;0.05;0.45;1', d)}${shown(0.05, 0.75, d)}<ellipse rx="9" ry="6" fill="${INK}"/><circle r="4" fill="${PURPLE}"/></g>
          <circle cx="210" cy="80" fill="none" stroke="${PURPLE}" stroke-width="2">${A('r', '0;0;80;80', '0;0.5;0.66;1', d)}${A('opacity', '0;0;0.9;0;0', '0;0.499;0.5;0.66;1', d)}</circle>
          <g transform="translate(262 40)">${A('opacity', '0.25;1;0.25', '0;0.52;0.9', d, 'discrete')}${seeker({ angle: -90, extra: A('fill', `${DIM};${RED};${DIM}`, '0;0.52;0.9', d, 'discrete') })}</g>
          <g>${shown(0.52, 0.9, d)}${text(262, 72, 'REVEALED', { fill: RED, size: 12 })}</g>`);
      })(),
    },
    {
      role: 'Hunter', name: 'Grab', keys: [k('grab')],
      text: `Get close (${GRAB.range} m) and face the seeker, then <b>${k('grab')}</b>. They can break free from the first two grabs (you stagger for a moment); the ${GRAB.kill === 3 ? 'third' : `${GRAB.kill}th`} one catches them and wins. ${GRAB.cooldown} s between grabs.`,
      art: (() => {
        const d = 5;
        return wrap(`${trees([5, 9])}
          <g>${T('70 100;180 100;180 100', '0;0.28;1', d)}${hunter({ angle: 90, extra: A('fill', `${PURPLE};#5b4a80;${PURPLE}`, '0;0.56;0.8', d, 'discrete') })}</g>
          ${[-7, 0, 7].map((o) => `<path d="M191 ${100 + o} q12 ${o * 3 - 14} 22 ${-o}" stroke="${PURPLE}" stroke-width="2.5" fill="none" stroke-linecap="round">${shown(0.3, 0.55, d)}</path>`).join('')}
          <g>${T('206 100;206 100;252 100;252 100', '0;0.55;0.6;1', d)}${seeker({ angle: -90 })}
            <circle r="15" fill="none" stroke="${PURPLE}" stroke-width="2">${shown(0.3, 0.55, d)}</circle></g>
          <g>${shown(0.24, 0.32, d)}${keycap(150, 60, k('grab'))}</g>
          <g>${shown(0.3, 0.95, d)}${text(160, 34, `GRAB 1 / ${GRAB.kill}`, { size: 16, fill: PURPLE })}</g>
          <g>${shown(0.58, 0.95, d)}${text(160, 170, 'BROKE FREE · THE NEXT GRAB IS HARDER', { size: 11, fill: TEAL })}</g>`);
      })(),
    },
    {
      role: 'Both', name: 'Immunity', keys: [],
      text: `After a stun ends, the hunter can't be stunned again for ${GUN.immuneMs / 1000} s: a pale shield shimmers around him, flickering just before it runs out. Shots at him in that time are <b>Resisted</b>.`,
      art: (() => {
        const d = 6;
        return wrap(`
          <line x1="0" y1="170" x2="320" y2="170" stroke="rgba(236,232,225,.15)"/>
          ${slenderSide(150, { values: '0;1;0', times: '0;0.08;0.36', dur: d })}
          <rect x="112" y="6" width="76" height="166" rx="38" fill="rgba(140,230,255,.12)" stroke="${SHIELD}" stroke-width="2">
            ${A('opacity', '0;1;1;0.2;1;0.2;1;0', '0;0.36;0.8;0.82;0.84;0.86;0.88;0.9', d, 'discrete')}</rect>
          <line x1="20" y1="160" x2="150" y2="${SIDE.body}" stroke="#ffd28a" stroke-width="2">${shown(0.08, 0.11, d)}</line>
          <line x1="20" y1="160" x2="114" y2="${SIDE.body + 30}" stroke="#ffd28a" stroke-width="2">${shown(0.6, 0.63, d)}</line>
          <circle cx="114" cy="${SIDE.body + 30}" fill="#dff8ff">${A('r', '0;0;10;0;0', '0;0.6;0.62;0.66;1', d)}</circle>
          <g>${shown(0.08, 0.36, d)}${text(255, 60, 'STUNNED', { fill: RED, size: 16 })}</g>
          <g>${shown(0.6, 0.76, d)}${text(255, 100, 'RESISTED', { fill: INK, size: 14 })}</g>
          <g>${shown(0.9, 1, d)}${text(255, 60, 'STUNNABLE AGAIN', { fill: INK, size: 12 })}</g>`);
      })(),
    },
  ];
}

// --- the screen -----------------------------------------------------------------------------
let list = [], at = 0;

function render() {
  const s = list[at];
  $('#ht-role').textContent = s.role === 'Both' ? 'Seeker and hunter' : s.role;
  $('#ht-role').className = `ht-role ${s.role.toLowerCase()}`;
  $('#ht-name').textContent = s.name;
  $('#ht-keys').innerHTML = s.keys.map((k) => `<i>${k}</i>`).join('');
  $('#ht-text').innerHTML = s.text;
  $('#ht-art').innerHTML = s.art; // (a fresh SVG: its animation starts from the beginning)
  $('#ht-count').textContent = `${at + 1} / ${list.length}`;
  $('#ht-dots').innerHTML = list.map((_, i) => `<button class="${i === at ? 'on' : ''}" data-ht="${i}" aria-label="Slide ${i + 1}"></button>`).join('');
  $('#ht-back').disabled = at === 0;
  $('#ht-next').textContent = at === list.length - 1 ? 'Done' : 'Next';
}

// open it on the first slide (built now, so the keys match the current bindings)
export function openHowto() {
  IMG = characterImages();
  list = slides();
  at = 0;
  render();
}

// step through (returns false when stepping past the end, to close it)
export function stepHowto(by) {
  const next = at + by;
  if (next >= list.length) return false;
  at = Math.max(0, next);
  render();
  return true;
}

export function gotoHowto(i) { at = i; render(); }
