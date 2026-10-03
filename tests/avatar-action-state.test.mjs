import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionActionState } from '../src/avatar/action-state.mjs';
import { createCompanionGestures } from '../src/pet/interaction.mjs';

test('one action intent remains asleep across both renderer handoffs and repeated scene rebuilds', () => {
  for (const source of ['native', 'fallback']) {
    const state = createCompanionActionState();
    state.transition('sleep');
    for (const target of ['fallback', 'native', 'compact rebuild', 'interactive rebuild']) {
      assert.equal(state.snapshot().action, 'sleep', `${source} to ${target}`);
      assert.equal(state.transition('pet'), null, 'ordinary reactions cannot overwrite the resting intent');
      assert.equal(state.snapshot().action, 'sleep');
    }
    assert.equal(state.transition('wake').action, 'idle');
  }
});

test('a real tap wakes the shared resting intent and an already consumed sleep command cannot put it back to sleep', () => {
  const state = createCompanionActionState();
  assert.equal(state.consumeCommand(11), true); state.transition('sleep');
  const gestures = createCompanionGestures({
    getAction: () => state.snapshot().action,
    emit: action => state.transition(action),
    schedule: () => 1, unschedule: () => {}, now: () => 0,
  });
  const point = {id:1,x:40,y:40,pointerType:'touch',button:0,isPrimary:true,hit:true};
  gestures.down(point); gestures.up(point);
  assert.equal(state.snapshot().action, 'idle');
  for (let renderer = 0; renderer < 5; renderer++) {
    assert.equal(state.consumeCommand(11), false);
    assert.equal(state.snapshot().action, 'idle');
  }
  assert.equal(state.consumeCommand(12), true); state.transition('sleep');
  assert.equal(state.snapshot().action, 'sleep', 'a genuinely new command still works');
  gestures.cancel();
});

test('incoming commands have one owner and reading a snapshot cannot reset a running action', () => {
  const state = createCompanionActionState();
  assert.equal(state.consumeCommand(1), true); state.transition('sleep');
  const snapshot = state.snapshot();
  assert.equal(state.consumeCommand(1), false, 'the second renderer cannot execute the same command');
  assert.deepEqual(state.snapshot(), snapshot);
  assert.equal(state.consumeCommand(2), true); assert.equal(state.transition('jump'), null);
  assert.equal(state.consumeCommand(2), false, 'blocked commands are consumed rather than deferred until wake');
  state.transition('wake');
  assert.equal(state.snapshot().action, 'idle');
  assert.equal(state.consumeCommand(3), true); state.transition('jump');
  assert.equal(state.snapshot().action, 'jump');
});

test('shared actions do not leak to another companion instance', () => {
  const shared = createCompanionActionState(), other = createCompanionActionState();
  shared.transition('sleep'); assert.equal(shared.snapshot().action, 'sleep');
  assert.equal(other.snapshot().action, 'idle');
  shared.transition('wake'); assert.equal(shared.snapshot().action, 'idle');
});
