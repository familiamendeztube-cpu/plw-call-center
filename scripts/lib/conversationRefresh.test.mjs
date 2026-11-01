import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceReadyData } from '../../src/app/useAsync.ts';

test('a reply arriving while the agent types updates the conversation without leaving the ready state', () => {
  const before = { status: 'ready', data: { messages: ['Hola'] } };

  const after = replaceReadyData(before, { messages: ['Hola', 'Necesito ayuda'] });

  assert.equal(after.status, 'ready');
  assert.deepEqual(after.data.messages, ['Hola', 'Necesito ayuda']);
});

test('repeated background refreshes keep the conversation ready', () => {
  let state = { status: 'ready', data: { messages: [] } };
  const snapshots = [['a'], ['a', 'b'], ['a', 'b', 'c']];
  for (const messages of snapshots) {
    state = replaceReadyData(state, { messages });
    assert.equal(state.status, 'ready');
  }
  assert.deepEqual(state.data.messages, ['a', 'b', 'c']);
});

test('a refresh cannot fill in a conversation that has not loaded yet', () => {
  const loading = { status: 'loading' };
  assert.deepEqual(replaceReadyData(loading, { messages: ['x'] }), { status: 'loading' });
});

test('an error state is not replaced by a quiet refresh', () => {
  const failed = { status: 'error', message: 'No se encontró la conversación.' };
  assert.deepEqual(replaceReadyData(failed, { messages: ['x'] }), failed);
});
