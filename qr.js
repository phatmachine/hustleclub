// ============================================================
// HUSTLE CLUB — QR ENCODER
//
// ⚠️ WHY THIS IS HAND-WRITTEN INSTEAD OF A LIBRARY
// The page is inert markup plus one inline script: no build step, no
// npm at the browser, and a CSP with no CDN. A QR library would mean
// giving up one of those. So this is the encoder, in full — byte
// mode, error-correction level M, versions 1 to 10, which is far more
// than a "https://host/?c=sun-dance-flower" URL will ever need.
//
// It is loaded with a dynamic import (like sanitize-plan.js and
// guardrails.js) so a teen who never reaches the trial screen never
// downloads it.
//
// Output is a plain square matrix of 0/1. Drawing it is the caller's
// problem — see drawQr() in index.html. That split is deliberate: the
// encoder is pure and testable, and nothing here touches the DOM.
//
// Spec references are ISO/IEC 18004. The tables below are the parts
// worth checking first if a code ever fails to scan; every one of
// them is cross-checked against the total-codeword count for its
// version in the test at the bottom of test/qr.mjs.
// ============================================================

/** Data codewords per version at EC level M, and how they block up.
 *  [ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data] */
const EC_M = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

/** Centres of the alignment patterns, per version. */
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Leftover bits after the last codeword, per version. */
const REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

const MAX_VERSION = 10;

// ── Galois field GF(256), primitive polynomial 0x11D ────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree) {
  let poly = [1];
  for (let d = 0; d < degree; d++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];
      next[i + 1] ^= gfMul(poly[i], EXP[d]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon remainder for one block. */
function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const rem = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return rem;
}

// ── Bit buffer ──────────────────────────────────────────────────────
function bits() {
  const out = [];
  return {
    push(value, length) {
      for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
    },
    get length() { return out.length; },
    bytes() {
      const n = Math.ceil(out.length / 8);
      const buf = new Uint8Array(n);
      for (let i = 0; i < out.length; i++) {
        if (out[i]) buf[i >>> 3] |= 0x80 >>> (i & 7);
      }
      return buf;
    },
  };
}

/** UTF-8, because a code is ASCII but the caller may pass anything. */
function toBytes(text) {
  return typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(text)
    : Uint8Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0));
}

function dataCapacity(version) {
  const [, g1, d1, g2, d2] = EC_M[version];
  return g1 * d1 + g2 * d2;
}

function chooseVersion(byteLength) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const countBits = v < 10 ? 8 : 16;
    // 4 mode bits + count + payload must fit the data codewords.
    if (4 + countBits + byteLength * 8 <= dataCapacity(v) * 8) return v;
  }
  return null;
}

// ── Codeword assembly ───────────────────────────────────────────────
function buildCodewords(text, version) {
  const payload = toBytes(text);
  const capacity = dataCapacity(version);
  const buf = bits();
  buf.push(0b0100, 4);                       // byte mode
  buf.push(payload.length, version < 10 ? 8 : 16);
  for (const b of payload) buf.push(b, 8);

  // Terminator, up to four zero bits, then pad to a byte boundary.
  const room = capacity * 8 - buf.length;
  buf.push(0, Math.min(4, room));
  while (buf.length % 8 !== 0) buf.push(0, 1);

  const data = Array.from(buf.bytes());
  // The spec's alternating pad bytes, until the block is full.
  const PADS = [0xec, 0x11];
  for (let i = 0; data.length < capacity; i++) data.push(PADS[i % 2]);

  // Split into blocks, error-correct each, then interleave.
  const [ecLen, g1, d1, g2, d2] = EC_M[version];
  const blocks = [];
  let at = 0;
  for (let i = 0; i < g1; i++) { blocks.push(data.slice(at, at + d1)); at += d1; }
  for (let i = 0; i < g2; i++) { blocks.push(data.slice(at, at + d2)); at += d2; }
  const ecBlocks = blocks.map((b) => rsEncode(b, ecLen));

  const out = [];
  const widest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < widest; i++) {
    for (const b of blocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const b of ecBlocks) out.push(b[i]);
  }
  return out;
}

// ── Matrix ──────────────────────────────────────────────────────────
function newMatrix(size) {
  const m = [];
  for (let r = 0; r < size; r++) m.push(new Int8Array(size).fill(-1));
  return m;
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6))
        || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m[rr][cc] = inRing || inCore ? 1 : 0;
    }
  }
}

function placeFunctionPatterns(m, version) {
  const size = m.length;
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    if (m[6][i] === -1) m[6][i] = bit;
    if (m[i][6] === -1) m[i][6] = bit;
  }

  // Alignment patterns, skipping the three finder corners.
  const centres = ALIGN[version];
  for (const r of centres) {
    for (const c of centres) {
      const nearFinder = (r <= 8 && c <= 8)
        || (r <= 8 && c >= size - 9)
        || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const edge = Math.max(Math.abs(dr), Math.abs(dc));
          m[r + dr][c + dc] = edge === 1 ? 0 : 1;
        }
      }
    }
  }

  // The always-dark module, and the reserved format strips.
  m[size - 8][8] = 1;
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === -1) m[8][i] = 0;
    if (m[i][8] === -1) m[i][8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === -1) m[8][size - 1 - i] = 0;
    if (m[size - 1 - i][8] === -1) m[size - 1 - i][8] = 0;
  }

  // Version information blocks (7 and up).
  if (version >= 7) {
    const info = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (info >>> i) & 1;
      const r = Math.floor(i / 3);
      const c = i % 3;
      m[size - 11 + c][r] = bit;
      m[r][size - 11 + c] = bit;
    }
  }
}

/** BCH(18,6) version information.
 *  Six data bits means SIX reduction steps, not twelve: the generator
 *  is degree 12, so clearing bit (17-i) shifts it by (5-i), and once i
 *  passes 5 that shift goes negative. JavaScript reads a negative
 *  shift as `<< 31`, which silently corrupts the word rather than
 *  throwing — the version blocks came out garbage until the module
 *  count test in test/qr.mjs pinned it. */
function versionBits(version) {
  let d = version << 12;
  for (let i = 0; i < 6; i++) {
    if (d & (1 << (17 - i))) d ^= 0x1f25 << (5 - i);
  }
  return (version << 12) | d;
}

/** BCH(15,5) format information for EC level M and a mask. */
function formatBits(mask) {
  const data = (0b00 << 3) | mask; // level M is 00
  let d = data << 10;
  for (let i = 0; i < 5; i++) {
    if (d & (1 << (14 - i))) d ^= 0x537 << (4 - i);
  }
  return ((data << 10) | d) ^ 0x5412;
}

function placeFormat(m, mask) {
  const size = m.length;
  const info = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const bit = (info >>> i) & 1;
    // Copy one: around the top-left finder.
    if (i < 6) m[8][i] = bit;
    else if (i === 6) m[8][7] = bit;
    else if (i === 7) m[8][8] = bit;
    else if (i === 8) m[7][8] = bit;
    else m[14 - i][8] = bit;
    // Copy two: split between the other two finders.
    if (i < 8) m[size - 1 - i][8] = bit;
    else m[8][size - 15 + i] = bit;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Walk the zigzag and drop the data bits in, masking as we go. */
function placeData(m, codewords, mask, reserved) {
  const size = m.length;
  let bitIndex = 0;
  const total = codewords.length * 8;
  let col = size - 1;
  let upward = true;
  while (col > 0) {
    if (col === 6) col--; // the vertical timing column is never data
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let x = 0; x < 2; x++) {
        const c = col - x;
        if (reserved[row][c]) continue;
        let bit = 0;
        if (bitIndex < total) {
          bit = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
        }
        bitIndex++;
        m[row][c] = MASKS[mask](row, c) ? bit ^ 1 : bit;
      }
    }
    upward = !upward;
    col -= 2;
  }
}

/** The four penalty rules, used to pick the least-ugly mask. */
function penalty(m) {
  const size = m.length;
  let score = 0;

  // Rule 1: runs of five or more of the same colour.
  for (let i = 0; i < size; i++) {
    let runRow = 1;
    let runCol = 1;
    for (let j = 1; j < size; j++) {
      runRow = m[i][j] === m[i][j - 1] ? runRow + 1 : 1;
      if (runRow === 5) score += 3; else if (runRow > 5) score += 1;
      runCol = m[j][i] === m[j - 1][i] ? runCol + 1 : 1;
      if (runCol === 5) score += 3; else if (runCol > 5) score += 1;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 sequence with four light modules.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const runsMatch = (get) => {
    let hits = 0;
    for (let i = 0; i + 11 <= size; i++) {
      let a = true;
      let b = true;
      for (let k = 0; k < 11; k++) {
        const v = get(i + k);
        if (v !== A[k]) a = false;
        if (v !== B[k]) b = false;
      }
      if (a || b) hits++;
    }
    return hits;
  };
  for (let i = 0; i < size; i++) {
    score += 40 * runsMatch((j) => m[i][j]);
    score += 40 * runsMatch((j) => m[j][i]);
  }

  // Rule 4: drift away from a 50/50 light/dark split.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/**
 * Encode `text` as a QR matrix.
 *
 * @returns {{size:number, modules:Int8Array[]}} 1 is dark, 0 is light.
 *          Throws if the text is too long for version 10 — the caller
 *          should keep payloads to a short URL.
 */
export function encodeQr(text) {
  const payloadLength = toBytes(text).length;
  const version = chooseVersion(payloadLength);
  if (!version) throw new Error('qr: payload too long (max version 10)');

  const size = 21 + (version - 1) * 4;
  const codewords = buildCodewords(text, version);
  // Pad out the version's remainder bits so placeData always has bits
  // to lay down in the last few modules.
  const withRemainder = codewords.slice();
  if (REMAINDER[version]) withRemainder.push(0);

  // Which cells are function patterns, and therefore off-limits to data.
  const template = newMatrix(size);
  placeFunctionPatterns(template, version);
  const reserved = template.map((row) => Array.from(row, (v) => v !== -1));

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = template.map((row) => Int8Array.from(row));
    placeData(m, withRemainder, mask, reserved);
    placeFormat(m, mask);
    const score = penalty(m);
    if (!best || score < best.score) best = { score, modules: m };
  }
  return { size, modules: best.modules, version };
}
