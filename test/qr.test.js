// The site's own QR code maker (public/js/qr.js) makes codes a standard
// reader can scan. jsQR (a test-only tool, never sent to the browser) reads
// each code back, and it must match the text exactly.

import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import '../public/js/qr.js';

const { QR } = globalThis;

// Turn a module grid into an RGBA picture: white quiet zone, `scale` pixels
// per module, black dark modules.
function toPixels(matrix, { scale = 4, quiet = 4 } = {}) {
  const side = (matrix.length + quiet * 2) * scale;
  const px = new Uint8ClampedArray(side * side * 4).fill(255);
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = (((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
    }
  }));
  return { px, side };
}

function decode(text, opts) {
  const { px, side } = toPixels(QR.matrix(text), opts);
  return jsQR(px, side, side, { inversionAttempts: 'dontInvert' });
}

const sizeOf = (text) => QR.matrix(text).length;
const versionOf = (text) => (sizeOf(text) - 17) / 4;

describe('QR code maker', () => {
  const samples = {
    short: 'https://southernadkhelp.org',
    'long listing link': 'https://southernadkhelp.org/listing/single-point-of-access-spoa-for-warren-and-washington-counti',
    'about 150 characters': 'Southern ADK Help lists food pantries, rent and utility help, dentists that take Medicaid, mental health, housing, rides, legal help and senior services.',
    'UTF-8 with an en dash': 'Warren – Washington – Saratoga: café hours 9–5',
  };

  for (const [name, text] of Object.entries(samples)) {
    it(`decodes back to the exact text: ${name}`, () => {
      const result = decode(text);
      expect(result, 'jsQR could not find a code').not.toBeNull();
      expect(result.data).toBe(text);
    });
  }

  it('also decodes at a larger scale', () => {
    expect(decode('https://southernadkhelp.org', { scale: 8 })?.data).toBe('https://southernadkhelp.org');
  });

  it('decodes codes that need the version information block (version 7 and up)', () => {
    const text = 'x'.repeat(200) + ' – end';
    expect(versionOf(text)).toBeGreaterThanOrEqual(7);
    expect(decode(text)?.data).toBe(text);
  });

  it('decodes the largest code it makes (version 20)', () => {
    const text = 'a'.repeat(666);
    expect(versionOf(text)).toBe(20);
    expect(decode(text)?.data).toBe(text);
  });

  it('picks the smallest version that fits', () => {
    expect(versionOf('a')).toBe(1);
    expect(versionOf('a'.repeat(14))).toBe(1); // version 1-M holds 14 bytes
    expect(versionOf('a'.repeat(15))).toBe(2);
    expect(versionOf('https://southernadkhelp.org')).toBe(3);
  });

  it('refuses text too long for version 20', () => {
    expect(() => QR.matrix('a'.repeat(667))).toThrow(RangeError);
  });

  it('returns a square grid of true/false values', () => {
    const m = QR.matrix('hello');
    expect(m).toHaveLength(21);
    for (const row of m) {
      expect(row).toHaveLength(21);
      for (const v of row) expect(typeof v).toBe('boolean');
    }
  });
});
