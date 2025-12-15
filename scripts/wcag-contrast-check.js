const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'src', 'app', 'globals.css');
if (!fs.existsSync(cssPath)) {
  console.error('globals.css not found at', cssPath);
  process.exit(2);
}
const css = fs.readFileSync(cssPath, 'utf8');

// Extract :root variables
const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
const vars = {};
if (rootMatch) {
  const body = rootMatch[1];
  const lines = body.split(/;\s*/);
  for (let l of lines) {
    const m = l.match(/--([a-z0-9\-]+)\s*:\s*([^;\n]+)/i);
    if (m) vars[`--${m[1].trim()}`] = m[2].trim();
  }
}

function resolveVar(v) {
  if (!v) return null;
  v = v.trim();
  if (v.startsWith('--')) return vars[v] || null;
  return v;
}

function hexToRgb(hex) {
  if (!hex) return null;
  hex = hex.replace(/"|'/g, '').trim();
  const rgbMatch = hex.match(/rgb\(([^)]+)\)/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map(s=>parseInt(s,10));
    return {r:parts[0], g:parts[1], b:parts[2]};
  }
  const h = hex.replace('#','');
  if (h.length === 3) {
    return {r:parseInt(h[0]+h[0],16), g:parseInt(h[1]+h[1],16), b:parseInt(h[2]+h[2],16)};
  }
  if (h.length === 6) {
    return {r:parseInt(h.slice(0,2),16), g:parseInt(h.slice(2,4),16), b:parseInt(h.slice(4,6),16)};
  }
  return null;
}

function sRGBtoLin(c) {
  c = c/255;
  return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
}

function luminance(rgb) {
  const r = sRGBtoLin(rgb.r);
  const g = sRGBtoLin(rgb.g);
  const b = sRGBtoLin(rgb.b);
  return 0.2126*r + 0.7152*g + 0.0722*b;
}

function contrastRatio(fgHex, bgHex) {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return null;
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const light = Math.max(L1,L2);
  const dark = Math.min(L1,L2);
  return (light + 0.05) / (dark + 0.05);
}

const checks = [
  {name: 'Title vs Page', fg: '--title-color', bg: '--page-background', min: 4.5},
  {name: 'Subtitle vs Card', fg: '--subtitle-color', bg: '--card-background', min: 4.5},
  {name: 'Helper vs Card', fg: '--helper-color', bg: '--card-background', min: 4.5},
  {name: 'Upload text vs Upload bg', fg: '--upload-text', bg: '--upload-bg', min: 4.5},
  {name: 'Primary button text vs Primary bg', fg: '--primary-text', bg: '--primary-bg', min: 3},
  {name: 'Disabled text vs Disabled bg', fg: '--disabled-text', bg: '--disabled-bg', min: 3},
  {name: 'File picker text vs File picker bg', fg: '--file-picker-text', bg: '--file-picker-bg', min: 4.5},
  {name: 'Table header text vs title bg', fg: '#FFFFFF', bg: '--title-color', min: 4.5},
  {name: 'Footer vs Card', fg: '--footer-text', bg: '--card-background', min: 4.5},
  {name: 'Body foreground vs Page bg', fg: '--foreground', bg: '--background', min: 4.5}
];

console.log('Loaded variables from globals.css:');
Object.keys(vars).forEach(k => console.log(`  ${k}: ${vars[k]}`));
console.log('\nRunning contrast checks...');

let allPass = true;
for (const c of checks) {
  const fgRaw = c.fg.startsWith('--') ? resolveVar(c.fg) : c.fg;
  const bgRaw = c.bg.startsWith('--') ? resolveVar(c.bg) : c.bg;
  const fg = fgRaw || c.fg;
  const bg = bgRaw || c.bg;
  const ratio = contrastRatio(fg, bg);
  const pass = ratio !== null && ratio >= c.min;
  if (!pass) allPass = false;
  console.log(`- ${c.name}: fg=${fg} bg=${bg} => ratio=${ratio?ratio.toFixed(2):'N/A'} (need ${c.min}) => ${pass? 'PASS' : 'FAIL'}`);
}

if (!allPass) {
  console.log('\nSome checks failed. Consider adjusting colors to meet WCAG thresholds.');
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
  process.exit(0);
}
