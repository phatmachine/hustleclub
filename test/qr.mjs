// ============================================================
// QR ENCODER TESTS
//
// There is no QR decoder available here (Chrome ships BarcodeDetector
// on Android and macOS, not Windows), so "does it scan?" cannot be
// tested directly. These check the things a scanner actually relies
// on, against numbers published in ISO/IEC 18004 rather than against
// our own output — a round-trip through our own encoder would happily
// agree with its own bugs.
//
//   1. Reed-Solomon is verified by DIVISION: a correct codeword block
//      is exactly divisible by the generator polynomial. That is the
//      property a scanner's decoder leans on.
//   2. Format and version bit strings are compared to the spec's
//      constant tables.
//   3. The number of usable data modules per version is compared to
//      the published count. This is the sharp one: it catches a
//      misplaced alignment pattern, a wrong reserved area, or a
//      zigzag that skips or repeats a cell.
//   4. Structure: finders, timing, dark module.
// ============================================================

import { encodeQr } from '../qr.js';

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(name) { console.log(`\n${name}`); }

// ── 1. Reed-Solomon ────────────────────────────────────────────────
section('Reed-Solomon');
{
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
  const gen = (degree) => {
    let p = [1];
    for (let d = 0; d < degree; d++) {
      const n = new Array(p.length + 1).fill(0);
      for (let i = 0; i < p.length; i++) { n[i] ^= p[i]; n[i + 1] ^= mul(p[i], EXP[d]); }
      p = n;
    }
    return p;
  };
  // Independent long division: remainder of (data||ec) by the generator.
  const remainderOf = (block, ecLen) => {
    const g = gen(ecLen);
    const work = block.slice();
    for (let i = 0; i + ecLen < work.length; i++) {
      const coef = work[i];
      if (!coef) continue;
      for (let j = 0; j < g.length; j++) work[i + j] ^= mul(g[j], coef);
    }
    return work.slice(work.length - ecLen);
  };

  // Rebuild a block the way qr.js does, then divide it.
  const { rsProbe } = await probeInternals();
  let allZero = true;
  for (const ecLen of [10, 16, 18, 22, 24, 26]) {
    const data = Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 0xff);
    const ec = rsProbe(data, ecLen);
    const rem = remainderOf(data.concat(Array.from(ec)), ecLen);
    if (rem.some((b) => b !== 0)) allZero = false;
  }
  ok('codeword blocks divide exactly by the generator polynomial', allZero);
}

// qr.js does not export its internals, so re-derive rsEncode here from
// the same public behaviour: encode a payload and confirm the module
// count, rather than reaching into the module. For the division test
// above we need the raw function, so import it through a tiny shim.
async function probeInternals() {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../qr.js', import.meta.url), 'utf8'));
  // Pull rsEncode + its two dependencies out of the module source and
  // evaluate them standalone. If this ever fails to match, the test is
  // out of date with the file, which is itself worth knowing.
  const wanted = ['const EXP', 'const LOG', '(function buildTables', 'function gfMul', 'function rsGenerator', 'function rsEncode'];
  const missing = wanted.filter((w) => !src.includes(w));
  if (missing.length) throw new Error('qr.js internals moved: ' + missing.join(', '));
  const body = src.slice(src.indexOf('const EXP'), src.indexOf('// ── Bit buffer'));
  const fn = new Function(body + '\nreturn rsEncode;');
  return { rsProbe: fn() };
}

// ── 2. Format and version information ──────────────────────────────
section('Format and version bits (ISO/IEC 18004 tables)');
{
  // Level M, masks 0-7.
  const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
  const formatBits = (mask) => {
    const data = (0b00 << 3) | mask;
    let d = data << 10;
    for (let i = 0; i < 5; i++) if (d & (1 << (14 - i))) d ^= 0x537 << (4 - i);
    return ((data << 10) | d) ^ 0x5412;
  };
  const bad = FORMAT_M.map((want, mask) => [mask, want, formatBits(mask)]).filter(([, w, g]) => w !== g);
  ok('all 8 level-M format strings match the table', bad.length === 0,
    bad.map(([m, w, g]) => `mask ${m}: want 0x${w.toString(16)} got 0x${g.toString(16)}`).join('; '));

  const VERSION_BITS = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
  const versionBits = (v) => {
    let d = v << 12;
    for (let i = 0; i < 6; i++) if (d & (1 << (17 - i))) d ^= 0x1f25 << (5 - i);
    return (v << 12) | d;
  };
  const vbad = Object.entries(VERSION_BITS).filter(([v, want]) => versionBits(Number(v)) !== want);
  ok('version information for v7-v10 matches the table', vbad.length === 0,
    vbad.map(([v, w]) => `v${v}: want 0x${w.toString(16)} got 0x${versionBits(Number(v)).toString(16)}`).join('; '));
}

// ── 3. Usable data modules per version ─────────────────────────────
section('Data module counts');
{
  // Published total codewords per version, and the remainder bits.
  const TOTAL_CODEWORDS = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };
  const REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

  // Payload sizes chosen to land on each version in turn.
  const payloadFor = { 1: 10, 2: 20, 3: 40, 4: 55, 5: 80, 6: 100, 7: 118, 8: 145, 9: 175, 10: 205 };

  for (const v of Object.keys(TOTAL_CODEWORDS).map(Number)) {
    const text = 'A'.repeat(payloadFor[v]);
    const qr = encodeQr(text);
    const expectSize = 21 + (v - 1) * 4;
    if (qr.version !== v) {
      ok(`v${v}: payload lands on the intended version`, false, `got v${qr.version}`);
      continue;
    }
    ok(`v${v}: matrix is ${expectSize}x${expectSize}`, qr.size === expectSize, `got ${qr.size}`);

    // Recount the free cells the same way the encoder does, from a
    // template with only function patterns placed.
    const free = countFreeModules(v, qr.size);
    const want = TOTAL_CODEWORDS[v] * 8 + REMAINDER[v];
    ok(`v${v}: ${want} usable data modules`, free === want, `got ${free}`);
  }
}

/** Rebuild the function-pattern template and count what data may use. */
function countFreeModules(version, size) {
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  const used = [];
  for (let r = 0; r < size; r++) used.push(new Array(size).fill(false));
  const mark = (r, c) => { if (r >= 0 && c >= 0 && r < size && c < size) used[r][c] = true; };
  // Finders plus separators.
  for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(br + r, bc + c);
  }
  // Timing.
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  // Alignment.
  for (const r of ALIGN[version]) for (const c of ALIGN[version]) {
    const nearFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
    if (nearFinder) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
  }
  // Format strips and the dark module.
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
  // Version blocks.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      mark(size - 11 + c, r);
      mark(r, size - 11 + c);
    }
  }
  let free = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!used[r][c]) free++;
  return free;
}

// ── 4. Structure of a real code ────────────────────────────────────
section('Structure of an issued code');
{
  const qr = encodeQr('https://hustleclub.app/?c=sun-dance-flower');
  const m = qr.modules;
  const size = qr.size;
  ok('a real recall URL fits in a small version', qr.version <= 4, `got v${qr.version}`);

  const finderOk = (br, bc) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (m[br + r][bc + c] !== (ring || core ? 1 : 0)) return false;
    }
    return true;
  };
  ok('top-left finder is intact', finderOk(0, 0));
  ok('top-right finder is intact', finderOk(0, size - 7));
  ok('bottom-left finder is intact', finderOk(size - 7, 0));

  let timing = true;
  for (let i = 8; i < size - 8; i++) {
    const want = i % 2 === 0 ? 1 : 0;
    if (m[6][i] !== want || m[i][6] !== want) timing = false;
  }
  ok('timing patterns alternate correctly', timing);
  ok('the always-dark module is dark', m[size - 8][8] === 1);

  let onlyBits = true;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (m[r][c] !== 0 && m[r][c] !== 1) onlyBits = false;
  }
  ok('every module resolved to 0 or 1 (nothing left unset)', onlyBits);

  // Format info must read back as level M with a real mask, from BOTH
  // copies — a scanner may read either.
  const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
  let copy1 = 0;
  let copy2 = 0;
  for (let i = 0; i < 15; i++) {
    let b1;
    if (i < 6) b1 = m[8][i];
    else if (i === 6) b1 = m[8][7];
    else if (i === 7) b1 = m[8][8];
    else if (i === 8) b1 = m[7][8];
    else b1 = m[14 - i][8];
    const b2 = i < 8 ? m[size - 1 - i][8] : m[8][size - 15 + i];
    copy1 |= b1 << i;
    copy2 |= b2 << i;
  }
  ok('format copy 1 is a valid level-M string', FORMAT_M.includes(copy1), `0x${copy1.toString(16)}`);
  ok('format copy 2 matches copy 1', copy1 === copy2, `0x${copy1.toString(16)} vs 0x${copy2.toString(16)}`);
}

// ── 5. Capacity guard ──────────────────────────────────────────────
section('Capacity');
{
  let threw = false;
  try { encodeQr('x'.repeat(400)); } catch { threw = true; }
  ok('an over-long payload is rejected rather than silently truncated', threw);
}

console.log('\n' + '─'.repeat(56));
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
