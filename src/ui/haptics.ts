/** Haptic vocabulary (navigator.vibrate where supported). */

import { BrowserHaptics } from '../platform/Haptics.js';

export const haptics = new BrowserHaptics({
  prime: { mobile: 12 },
  detonate: { mobile: 20 },
  overcharge: { mobile: [30, 30, 45] },
  allclear: { mobile: [20, 40, 20, 40, 60] },
  tick: { mobile: 8 },
  rank: { mobile: [15, 30, 25] }
});
