import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';

import { MIXTAPE_BARS, tapeKey, tapeSeconds } from '../build/src/meta/Mixtape.js';

const M = JSON.parse(fs.readFileSync('content/tracks.json', 'utf8')).tracks.filter(t => t.id !== 'overture');

test('a tape is keyed by its tracks in play order', () => {
  assert.equal(tapeKey([0, 1], M), 'tape-ignition+glasswork');
  assert.notEqual(tapeKey([0, 1], M), tapeKey([1, 0], M));
});

test('running time: 24 bars a track at each movement\'s tempo', () => {
  // Ignition 116 BPM, Glasswork 108 BPM
  const want = (MIXTAPE_BARS * 240) / 116 + (MIXTAPE_BARS * 240) / 108;
  assert.ok(Math.abs(tapeSeconds([0, 1], M) - want) < 1e-9);
  assert.ok(Math.abs(tapeSeconds([0], M, 0.85) - (MIXTAPE_BARS * 240) / (116 * 0.85)) < 1e-9);
});
