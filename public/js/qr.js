// A small QR Code generator, written for this site so no outside script is
// needed (rule 7). It follows the QR Code Model 2 standard (ISO/IEC 18004):
// byte mode (UTF-8 text), error correction level M, versions 1 to 20.
//
//   QR.matrix(text)              -> rows of true (dark) / false (light) modules
//   QR.svg(text, { size, label, color }) -> an <svg> element, ready to insert
//
// Works as a plain browser script (sets window.QR) and can be imported in
// tests (sets globalThis.QR). No dependencies.

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Tables for error correction level M, versions 1-20 (index 0 = version 1).
  // ---------------------------------------------------------------------

  // Error correction codewords in each block.
  const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
  // Number of blocks the codewords are split into.
  const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
  // Centre rows/columns of the small alignment squares.
  const ALIGN = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
    [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  ];
  const MAX_VERSION = 20;
  const EC_LEVEL_BITS = 0; // level M is "00" in the format information

  // Total codewords (data + error correction) a version can hold: every module
  // that isn't part of a fixed pattern, divided into bytes.
  function totalCodewords(ver) {
    const size = ver * 4 + 17;
    let modules = size * size;
    modules -= 3 * 64;                 // three finder squares with separators
    modules -= 2 * (size - 16);        // two timing lines
    modules -= 31;                     // format information (30) and the dark module (1)
    const n = ALIGN[ver - 1].length;
    if (n) modules -= (n * n - 3) * 25 - (n - 2) * 2 * 5; // alignment squares, minus overlap with timing lines
    if (ver >= 7) modules -= 36;       // version information
    return Math.floor(modules / 8);
  }
  function dataCodewords(ver) {
    return totalCodewords(ver) - EC_PER_BLOCK[ver - 1] * BLOCKS[ver - 1];
  }

  // ---------------------------------------------------------------------
  // Reed-Solomon error correction over GF(256), polynomial x^8+x^4+x^3+x^2+1.
  // ---------------------------------------------------------------------

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  // Generator polynomial (x - a^0)(x - a^1)...(x - a^(n-1)), highest power
  // first, leading 1 left out.
  function generator(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly.slice(1);
  }

  // Remainder of data * x^n divided by the generator: the n check bytes.
  function rsRemainder(data, gen) {
    const rem = new Array(gen.length).fill(0);
    for (const byte of data) {
      const factor = byte ^ rem.shift();
      rem.push(0);
      for (let i = 0; i < gen.length; i++) rem[i] ^= mul(gen[i], factor);
    }
    return rem;
  }

  // ---------------------------------------------------------------------
  // Step 1: turn the text into data codewords.
  // ---------------------------------------------------------------------

  function encodeData(bytes) {
    // Smallest version that fits. Byte mode uses an 8-bit length up to
    // version 9 and a 16-bit length from version 10.
    let ver = 1;
    for (; ver <= MAX_VERSION; ver++) {
      const lenBits = ver < 10 ? 8 : 16;
      if (4 + lenBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > MAX_VERSION) throw new RangeError('Text is too long for a QR code (version 20, level M).');

    const bits = [];
    const put = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    put(0b0100, 4);                       // mode: byte
    put(bytes.length, ver < 10 ? 8 : 16); // character count
    for (const b of bytes) put(b, 8);

    const capacity = dataCodewords(ver) * 8;
    put(0, Math.min(4, capacity - bits.length)); // terminator
    put(0, (8 - (bits.length % 8)) % 8);         // pad to a whole byte

    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      out.push(b);
    }
    for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11) out.push(pad); // alternate EC, 11
    return { ver, data: out };
  }

  // ---------------------------------------------------------------------
  // Step 2: split into blocks, add error correction, interleave.
  // ---------------------------------------------------------------------

  function addErrorCorrection(ver, data) {
    const numBlocks = BLOCKS[ver - 1];
    const ecLen = EC_PER_BLOCK[ver - 1];
    const total = totalCodewords(ver);
    const shortLen = Math.floor(total / numBlocks);  // codewords in a short block
    const numShort = numBlocks - (total % numBlocks); // the rest get one more data byte
    const gen = generator(ecLen);

    const blocks = [];
    let k = 0;
    for (let i = 0; i < numBlocks; i++) {
      const dataLen = shortLen - ecLen + (i < numShort ? 0 : 1);
      const d = data.slice(k, k + dataLen);
      k += dataLen;
      blocks.push({ d, ec: rsRemainder(d, gen) });
    }

    // Take the 1st byte of every block, then the 2nd, and so on; data first,
    // then error correction.
    const result = [];
    const maxData = shortLen - ecLen + 1;
    for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.d.length) result.push(b.d[i]);
    for (let i = 0; i < ecLen; i++) for (const b of blocks) result.push(b.ec[i]);
    return result;
  }

  // ---------------------------------------------------------------------
  // Step 3: draw the fixed patterns, place the codewords, pick a mask.
  // ---------------------------------------------------------------------

  // BCH remainder used by the format and version information.
  function bch(value, poly, polyBits) {
    let v = value << (polyBits - 1);
    for (let i = 31; i >= polyBits - 1; i--) if ((v >>> i) & 1) v ^= poly << (i - (polyBits - 1));
    return v;
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function buildGrid(ver, codewords) {
    const size = ver * 4 + 17;
    const grid = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { grid[y][x] = dark; fixed[y][x] = true; };

    // Timing lines: alternating modules along row 6 and column 6.
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

    // Finder squares in three corners, each with a light border (separator).
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const ring = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, ring !== 2 && ring !== 4);
        }
      }
    }

    // Alignment squares on every pair of centres, except where they would
    // land on a finder square.
    const pos = ALIGN[ver - 1];
    const last = pos.length - 1;
    for (let i = 0; i <= last; i++) {
      for (let j = 0; j <= last; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    // Reserve the format information areas now (filled in per mask below).
    drawFormat(grid, set, size, 0);

    // Version information (versions 7+): 6 bits of version + 12 check bits,
    // in two 6x3 blocks near the top-right and bottom-left finders.
    if (ver >= 7) {
      const bits = (ver << 12) | bch(ver, 0x1f25, 13);
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, dark);
        set(b, a, dark);
      }
    }

    // Place the codeword bits in two-module-wide columns, zigzagging up and
    // down from the bottom-right corner and skipping the fixed patterns.
    let bit = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // step over the vertical timing line
      const upward = ((right + 1) & 2) === 0;
      for (let v = 0; v < size; v++) {
        const y = upward ? size - 1 - v : v;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (fixed[y][x]) continue;
          if (bit < totalBits) grid[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
          bit++; // any leftover modules stay light
        }
      }
    }

    // Try all eight masks; keep the one with the lowest penalty.
    let best = null, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      const g = grid.map((row) => row.slice());
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) g[y][x] = !g[y][x];
      drawFormat(g, (x, y, d) => { g[y][x] = d; }, size, m);
      const score = penalty(g);
      if (score < bestScore) { best = g; bestScore = score; }
    }
    return best;
  }

  // Format information: error correction level and mask, 5 bits + 10 check
  // bits, XOR'd with a fixed pattern. Drawn twice for redundancy.
  function drawFormat(grid, set, size, mask) {
    const data = (EC_LEVEL_BITS << 3) | mask;
    const bits = ((data << 10) | bch(data, 0x537, 11)) ^ 0x5412;
    const bitAt = (i) => ((bits >>> i) & 1) === 1;
    // Around the top-left finder.
    for (let i = 0; i <= 5; i++) set(8, i, bitAt(i));
    set(8, 7, bitAt(6));
    set(8, 8, bitAt(7));
    set(7, 8, bitAt(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bitAt(i));
    // Split between the other two finders.
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bitAt(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bitAt(i));
    set(8, size - 8, true); // the "dark module", always dark
  }

  // Penalty score from the standard's four rules. Lower is easier to scan.
  function penalty(g) {
    const size = g.length;
    let score = 0;
    const lines = [];
    for (let i = 0; i < size; i++) {
      lines.push(g[i]);
      lines.push(g.map((row) => row[i]));
    }
    // Rule 1: runs of five or more same-colour modules in a row or column.
    // Rule 3: patterns that look like a finder (1:1:3:1:1 with 4 light
    // modules on one side). Off the edge counts as light.
    const FINDER_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const FINDER_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) { run++; continue; }
        if (run >= 5) score += run - 2;
        run = 1;
      }
      const at = (i) => (i >= 0 && i < size && line[i] ? 1 : 0);
      for (let i = -10; i < size; i++) {
        let a = true, b = true;
        for (let k = 0; k < 11 && (a || b); k++) {
          const v = at(i + k);
          if (v !== FINDER_A[k]) a = false;
          if (v !== FINDER_B[k]) b = false;
        }
        if (a) score += 40;
        if (b) score += 40;
      }
    }
    // Rule 2: 2x2 blocks of one colour.
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (g[y][x]) dark++;
        if (x < size - 1 && y < size - 1) {
          const c = g[y][x];
          if (g[y][x + 1] === c && g[y + 1][x] === c && g[y + 1][x + 1] === c) score += 3;
        }
      }
    }
    // Rule 4: overall balance of dark and light, 10 points per 5% away from half.
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  function matrix(text) {
    const bytes = new TextEncoder().encode(String(text));
    const { ver, data } = encodeData(bytes);
    return buildGrid(ver, addErrorCorrection(ver, data));
  }

  // An <svg> element: one path for the dark modules on a white square that
  // includes the 4-module quiet zone the standard asks for.
  //   size:  width and height (a number of pixels, or any CSS length string)
  //   label: what a screen reader says; pass '' to hide a repeated code
  //   color: dark module colour (default black, the safest for scanning)
  function svg(text, options = {}) {
    const m = matrix(text);
    const quiet = 4;
    const full = m.length + quiet * 2;
    const NS = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', `0 0 ${full} ${full}`);
    if (options.size != null) {
      el.setAttribute('width', String(options.size));
      el.setAttribute('height', String(options.size));
    }
    el.setAttribute('shape-rendering', 'crispEdges');
    el.setAttribute('class', 'qr');
    const label = options.label != null ? String(options.label) : `QR code for ${text}`;
    if (label) {
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', label);
    } else {
      el.setAttribute('aria-hidden', 'true');
    }
    el.setAttribute('focusable', 'false');

    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', String(full));
    bg.setAttribute('height', String(full));
    bg.setAttribute('fill', '#fff');
    el.appendChild(bg);

    // One rectangle per horizontal run of dark modules keeps the path short.
    let d = '';
    m.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (!row[x]) continue;
        let end = x;
        while (end + 1 < row.length && row[end + 1]) end++;
        d += `M${x + quiet} ${y + quiet}h${end - x + 1}v1h${x - end - 1}z`;
        x = end;
      }
    });
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', options.color || '#000');
    el.appendChild(path);
    return el;
  }

  const QR = { matrix, svg };
  (typeof window !== 'undefined' ? window : globalThis).QR = QR;
})();
