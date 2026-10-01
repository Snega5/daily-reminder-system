import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRemote, toKey, addDays, emptyState, ensureDay, toggle, rename, streak, doneCount } from './lib.js';

test('date key uses local date and rolls over at midnight', () => {
  assert.equal(toKey(new Date(2026, 8, 30, 23, 59, 59)), '2026-09-30');
  assert.equal(toKey(new Date(2026, 8, 30, 24, 0, 0)), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
test('new day is fresh, old day is kept', () => {
  let s = ensureDay(emptyState(), '2026-09-30');
  s = toggle(s, '2026-09-30', 0);
  s = ensureDay(s, '2026-10-01');
  assert.equal(doneCount(s.days['2026-09-30']), 1);
  assert.equal(doneCount(s.days['2026-10-01']), 0);
});
test('rename carries to next day but not past days', () => {
  let s = ensureDay(emptyState(), '2026-09-30');
  s = rename(s, '2026-09-30', 1, 'Gym');
  s = ensureDay(s, '2026-10-01');
  assert.equal(s.days['2026-10-01'][1].name, 'Gym');
  s = rename(s, '2026-10-01', 1, 'Read');
  assert.equal(s.days['2026-09-30'][1].name, 'Gym');
});
test('streak logic', () => {
  const full = [{ done: true }, { done: true }, { done: true }];
  const part = [{ done: true }, { done: false }, { done: true }];
  assert.equal(streak({ '2026-09-28': full, '2026-09-29': full, '2026-09-30': part }, '2026-09-30'), 2); // today unfinished: keep yesterday's streak
  assert.equal(streak({ '2026-09-28': full, '2026-09-29': full, '2026-09-30': full }, '2026-09-30'), 3);
  assert.equal(streak({ '2026-09-27': full, '2026-09-29': full }, '2026-09-29'), 1); // missing day breaks it
  assert.equal(streak({ '2026-09-29': part }, '2026-09-30'), 0);
});

test('mergeRemote: server wins per date, local-only dates kept, profile applied', () => {
  const full = [{ name: 'A', done: true }, { name: 'B', done: true }, { name: 'C', done: true }];
  const part = [{ name: 'A', done: true }, { name: 'B', done: false }, { name: 'C', done: false }];
  let s = { ...emptyState(), days: { '2026-09-29': part, '2026-09-28': full } };
  const m = mergeRemote(s, { days: { '2026-09-29': full }, profile: { defaults: ['X', 'Y', 'Z'], remind_time: '21:30', ntfy_topic: 'daily3-abc', ntfy_enabled: true } });
  assert.equal(doneCount(m.days['2026-09-29']), 3);
  assert.equal(doneCount(m.days['2026-09-28']), 3);
  assert.deepEqual(m.defaults, ['X', 'Y', 'Z']);
  assert.equal(m.settings.time, '21:30');
  assert.equal(m.settings.topic, 'daily3-abc');
  const m2 = mergeRemote(s, { days: {}, profile: null });
  assert.equal(m2.settings.time, s.settings.time);
});