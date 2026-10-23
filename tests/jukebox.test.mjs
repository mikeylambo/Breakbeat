import test from 'node:test';
import assert from 'node:assert/strict';

import { Jukebox, PASSES } from '../build/src/audio/Jukebox.js';

const BAR = 16;
const track = (id, sections = 3) => ({ id, name: id, bpm: 120, sections: Array.from({ length: sections }, (_, i) => ({ name: 'ABC'[i], bars: 8 })) });

/** A fake transport: steps advance by hand, blends land where asked (or on the next downbeat). */
function rig(queue) {
  const log = [];
  const h = {
    s: 0,
    sec: 0,
    held: false,
    mix: [1, 1, 1, 1, 1],
    step: () => h.s,
    now: () => h.sec,
    blendTo: async (t, at) => {
      const step = at ?? (h.s === 0 ? 0 : Math.ceil((h.s + 8) / BAR) * BAR);
      log.push(['blend', t.id, step]);
      return step;
    },
    preload: t => log.push(['preload', t.id]),
    flowToSection: i => log.push(['flow', i, h.s]),
    jumpSection: (i, at) => log.push(['jump', i, at]),
    setMix: (l, r) => {
      h.mix = [...l];
      log.push(['mix', l.join(''), r]);
    },
    hold: on => {
      h.held = on;
      log.push(['hold', on]);
    }
  };
  const jb = new Jukebox(h, () => queue);
  const tick = async n => {
    for (let i = 0; i < n; i++) {
      h.s++;
      jb.update();
      await Promise.resolve();
    }
  };
  return { h, jb, log, tick };
}

test('play-through: A, B, C each play twice, then the next track blends in where C ends', async () => {
  const a = track('a');
  const b = track('b');
  const { jb, log, tick } = rig([a, b]);
  jb.play(a);
  await Promise.resolve();
  jb.update();
  assert.equal(jb.track, a);
  const len = 8 * BAR;
  await tick(len * PASSES - 1);
  assert.equal(jb.section, 0, 'still A before its second pass ends');
  assert.deepEqual(log.find(e => e[0] === 'flow'), ['flow', 1, len], 'flows to B at the start of the final pass of A');
  await tick(1);
  assert.equal(jb.section, 1, 'B begins exactly after two passes of A');
  await tick(len * PASSES);
  assert.equal(jb.section, 2);
  await tick(len * PASSES);
  const blend = log.find(e => e[0] === 'blend' && e[1] === 'b');
  assert.deepEqual(blend, ['blend', 'b', len * PASSES * 3], 'next track lands on the downbeat where C ends');
  assert.ok(log.some(e => e[0] === 'preload' && e[1] === 'b'), 'next track is preloaded');
  assert.equal(jb.track, b);
  assert.equal(jb.section, 0);
  assert.equal(jb.trackStartStep, len * PASSES * 3);
});

test('Repeat One holds the section: no flow, no blend', async () => {
  const a = track('a');
  const { jb, log, tick } = rig([a, track('b')]);
  jb.play(a);
  await Promise.resolve();
  jb.cycleRepeat();
  assert.equal(jb.repeat, 'one');
  await tick(8 * BAR * 10);
  assert.equal(jb.section, 0);
  assert.equal(log.filter(e => e[0] === 'flow' || e[0] === 'blend').length, 1, 'only the initial blend');
});

test('section jump lands on a bar at least half a bar away, back or forward', async () => {
  const a = track('a');
  const { jb, log, tick } = rig([a]);
  jb.play(a);
  await Promise.resolve();
  await tick(8 * BAR * 2 + 20); // into B
  assert.equal(jb.section, 1);
  jb.jump(0);
  const j = log.find(e => e[0] === 'jump');
  assert.equal(j[1], 0);
  assert.equal(j[2] % BAR, 0, 'on a downbeat');
  assert.ok(j[2] - (8 * BAR * 2 + 20) >= 8, 'at least half a bar ahead');
  await tick(j[2] - (8 * BAR * 2 + 20));
  assert.equal(jb.section, 0);
  assert.equal(jb.sectionStartStep, j[2]);
  assert.equal(jb.passInfo().pass, 1);
});

test('a single unlocked track restarts itself instead of stopping', async () => {
  const a = track('a', 1);
  const { jb, log, tick } = rig([a]);
  jb.play(a);
  await Promise.resolve();
  await tick(8 * BAR * PASSES + 1);
  assert.ok(log.some(e => e[0] === 'jump' && e[1] === 0 && e[2] === 8 * BAR * PASSES));
  assert.equal(jb.trackStartStep, 8 * BAR * PASSES);
});

test('mixer: mutes zero their stem; any solo wins', () => {
  const { jb, h } = rig([track('a')]);
  jb.toggleMute(1);
  assert.deepEqual(h.mix, [1, 0, 1, 1, 1]);
  jb.toggleSolo(3);
  assert.deepEqual(h.mix, [0, 0, 0, 1, 0]);
  jb.toggleSolo(1);
  assert.deepEqual(h.mix, [0, 1, 0, 1, 0], 'solo overrides mute');
  jb.stop();
  assert.deepEqual(h.mix, [1, 1, 1, 1, 1], 'leaving Listen restores unity');
});

test('sleep timer: fades over the last 8 s, then holds; play restores the mix', async () => {
  const a = track('a');
  const { jb, h } = rig([a]);
  jb.play(a);
  await Promise.resolve();
  jb.cycleSleep();
  assert.equal(jb.sleepMinutes, 15);
  h.sec = 15 * 60 - 7;
  jb.update();
  assert.deepEqual(h.mix, [0, 0, 0, 0, 0], 'fading');
  assert.equal(h.held, false);
  h.sec = 15 * 60;
  jb.update();
  assert.equal(h.held, true);
  assert.equal(jb.slept, true);
  assert.equal(jb.sleepMinutes, 0);
  jb.togglePause();
  assert.equal(h.held, false);
  assert.deepEqual(h.mix, [1, 1, 1, 1, 1]);
});

test('prev / next wrap around the unlocked queue', async () => {
  const a = track('a');
  const b = track('b');
  const c = track('c');
  const { jb, log } = rig([a, b, c]);
  jb.play(a);
  await Promise.resolve();
  jb.update();
  jb.prev();
  assert.equal(log.at(-1)[1], 'c');
  jb.next();
  assert.equal(log.at(-1)[1], 'a', 'next is relative to the queued track');
});
