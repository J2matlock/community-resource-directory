// Rules the browser keeps its own copy of must match the server's. If one
// changes without the other, DV listing links made in the browser (share,
// handout QR codes) would stop working.

import { describe, it, expect } from 'vitest';
import directorySource from '../public/js/directory.js?raw';
import { neutralId } from '../src/lib/neutral-id.js';

describe('Browser and server copies of shared rules', () => {
  it('the directory page makes the same neutral DV addresses as the server', () => {
    const m = directorySource.match(/function neutralId\(id\) \{[\s\S]*?return 'h-' \+ h\.toString\(36\);\s*\}/);
    expect(m).toBeTruthy();
    const browserNeutralId = new Function(`${m[0]}; return neutralId;`)();
    for (const id of ['catholic-charities-domestic-violence-program', 'wellspring', 'a', 'sample-dv-program-2']) {
      expect(browserNeutralId(id)).toBe(neutralId(id));
    }
  });
});
