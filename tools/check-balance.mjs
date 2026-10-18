import assert from 'node:assert/strict';
import {
  TUNING,
  computeComboMultiplier,
  computeResonanceMultiplier
} from '../public/src/tuning.js';
import { GemRules } from '../public/src/content/gems/GemRules.js';

const rules = new GemRules('brick');

// GDD Page 3: "size exponent SIZE_EXP = 1.35, so one 9-group pays about 1.5x what three 3-groups pay"
const score3 = rules.scoreGroup([], {
  size: 3,
  resonance: 1,
  combo: 1,
  airPrimed: false,
  overcharged: false
});
const score9 = rules.scoreGroup([], {
  size: 9,
  resonance: 1,
  combo: 1,
  airPrimed: false,
  overcharged: false
});
const ratio = score9 / (3 * score3);
assert.ok(ratio > 1.4 && ratio < 1.55, `Expected 9-group vs 3x 3-group ratio ~1.47, got ${ratio}`);

// Stepped resonance curve: 1, 1.25, 1.5, 2, 2.5, 3, then +0.5 per group, cap 5 at 10 groups
assert.equal(computeResonanceMultiplier(1), 1.0);
assert.equal(computeResonanceMultiplier(2), 1.25);
assert.equal(computeResonanceMultiplier(3), 1.5);
assert.equal(computeResonanceMultiplier(4), 2.0);
assert.equal(computeResonanceMultiplier(5), 2.5);
assert.equal(computeResonanceMultiplier(6), 3.0);
assert.equal(computeResonanceMultiplier(10), 5.0);
assert.equal(computeResonanceMultiplier(14), 5.0);

// Combo cap at 3.0
assert.equal(computeComboMultiplier(0), 1.0);
assert.equal(computeComboMultiplier(5), 1.5);
assert.equal(computeComboMultiplier(25), TUNING.COMBO_CAP);

console.log(`PASS [BALANCE]: 9-group/3x3-group ratio = ${ratio.toFixed(2)}x; Resonance & Combo curves match GDD.`);
