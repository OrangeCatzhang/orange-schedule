const test = require('node:test');
const assert = require('node:assert/strict');
const { messages, normalizeRotation, getCurrentMessage, advanceMessage } = require('../src/reminder-copy.cjs');
const { validateState } = require('../src/core.cjs');

const catalogueIds = messages.map(message => message.id);
const sorted = values => [...values].sort();
const emptyRotation = { seen: [], currentId: null };
const clone = value => JSON.parse(JSON.stringify(value));
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

// These checks validate the catalogue and rotation contract, not the literary attribution.
test('reminder catalogue has at least 100 distinct messages with usable display fields', () => {
  assert.ok(messages.length >= 100, `Only ${messages.length} reminder messages are available`);
  assert.equal(new Set(catalogueIds).size, messages.length, 'Message IDs must be unique');
  assert.equal(new Set(messages.map(message => message.text.trim())).size, messages.length, 'Message text must be unique');
  for (const message of messages) {
    for (const key of ['id', 'text', 'source']) {
      assert.equal(typeof message[key], 'string', `${message.id}: ${key} must be text`);
      assert.ok(message[key].trim().length > 0, `${message.id}: ${key} cannot be empty`);
      assert.equal(message[key], message[key].trim(), `${message.id}: ${key} has outer whitespace`);
    }
    if (message.url !== undefined) {
      const url = new URL(message.url);
      assert.ok(['http:', 'https:'].includes(url.protocol), `${message.id}: invalid source link`);
    }
  }
});

test('missing and malformed legacy rotation values receive an empty rotation', () => {
  for (const raw of [undefined, null, false, true, 0, 12, 'old quote', [], {}, { seen: 'old quote' }, { seen: null, currentId: 'removed-message' }]) {
    assert.deepEqual(normalizeRotation(raw), emptyRotation);
  }
});

test('normalization removes unknown and duplicate IDs while preserving valid progress', () => {
  const a = catalogueIds[4], b = catalogueIds[1];
  const raw = { seen: [a, 'removed-message', b, a, null, 1, { id: a }, b], currentId: b, oldIndex: 42 };
  const before = clone(raw);
  assert.deepEqual(normalizeRotation(raw), { seen: [a, b], currentId: b });
  assert.deepEqual(raw, before);
  assert.deepEqual(normalizeRotation({ seen: [a], currentId: 'removed-message' }), { seen: [a], currentId: null });
  assert.deepEqual(normalizeRotation({ seen: [a], currentId: b }), { seen: [a, b], currentId: b });
  assert.deepEqual(normalizeRotation({ currentId: a }), { seen: [a], currentId: a });
});

test('current message survives a saved rotation and invalid current IDs use the first message', () => {
  assert.deepEqual(getCurrentMessage(), messages[0]);
  assert.deepEqual(getCurrentMessage(null), messages[0]);
  assert.deepEqual(getCurrentMessage({ currentId: 'removed-message' }), messages[0]);
  const current = messages.at(-1);
  const raw = freezeDeep({ seen: [current.id], currentId: current.id });
  assert.deepEqual(getCurrentMessage(raw), current);
});

test('one complete rotation visits every message exactly once', () => {
  let rotation;
  const visited = new Set();
  for (let i = 0; i < messages.length; i++) {
    const next = advanceMessage(rotation, limit => {
      assert.equal(limit, messages.length - i);
      return Math.floor(limit / 2);
    });
    assert.ok(!visited.has(next.message.id), `Repeated before the round completed: ${next.message.id}`);
    visited.add(next.message.id);
    assert.equal(next.rotation.currentId, next.message.id);
    assert.equal(next.rotation.seen.length, visited.size);
    assert.deepEqual(sorted(next.rotation.seen), sorted(visited));
    rotation = next.rotation;
  }
  assert.deepEqual(sorted(visited), sorted(catalogueIds));
});

test('consecutive rounds cover the whole catalogue without repeating at their boundary', () => {
  let rotation;
  let previousId;
  for (let round = 0; round < 2; round++) {
    const visited = new Set();
    for (let i = 0; i < messages.length; i++) {
      // The second round deliberately selects the opposite end of the remaining list.
      const next = advanceMessage(rotation, limit => round === 0 ? 0 : limit - 1);
      assert.notEqual(next.message.id, previousId, 'Adjacent reminders must differ, including a new round');
      assert.ok(!visited.has(next.message.id), `Round ${round + 1} repeated ${next.message.id}`);
      visited.add(next.message.id);
      assert.equal(next.rotation.seen.length, i + 1);
      rotation = next.rotation;
      previousId = next.message.id;
    }
    assert.deepEqual(sorted(visited), sorted(catalogueIds));
  }
});

test('a completed round cannot immediately repeat any possible last message', () => {
  for (const currentId of catalogueIds) {
    const previous = freezeDeep({ seen: [...catalogueIds], currentId });
    for (const chooseIndex of [() => 0, limit => limit - 1]) {
      const next = advanceMessage(previous, chooseIndex);
      assert.notEqual(next.message.id, currentId, `New round repeated ${currentId}`);
      assert.deepEqual(next.rotation, { seen: [next.message.id], currentId: next.message.id });
    }
  }
});

test('JSON persistence resumes the unused messages instead of starting the round again', () => {
  const chooseIndex = limit => Math.floor(limit * 0.6);
  const visited = new Set();
  let uninterrupted;
  const beforeRestart = Math.min(37, messages.length - 1);
  for (let i = 0; i < beforeRestart; i++) {
    const next = advanceMessage(uninterrupted, chooseIndex);
    uninterrupted = next.rotation;
    visited.add(next.message.id);
  }
  let restored = normalizeRotation(clone(uninterrupted));
  assert.deepEqual(getCurrentMessage(restored), getCurrentMessage(uninterrupted));
  for (let i = beforeRestart; i < messages.length; i++) {
    const directNext = advanceMessage(uninterrupted, chooseIndex);
    const restoredNext = advanceMessage(restored, chooseIndex);
    assert.deepEqual(restoredNext, directNext, 'Restoring changed the available messages');
    assert.ok(!visited.has(restoredNext.message.id), 'Restart repeated an already used message');
    visited.add(restoredNext.message.id);
    uninterrupted = directNext.rotation;
    restored = clone(restoredNext.rotation);
  }
  assert.deepEqual(sorted(visited), sorted(catalogueIds));
});

test('rotation functions do not mutate caller state or catalogue content', () => {
  const raw = freezeDeep({ seen: [catalogueIds[0], catalogueIds[2]], currentId: catalogueIds[2] });
  const before = clone(raw), catalogueBefore = clone(messages);
  normalizeRotation(raw);
  getCurrentMessage(raw);
  const next = advanceMessage(raw, () => 0);
  assert.notEqual(next.rotation, raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(messages, catalogueBefore);
});

test('core validation preserves reminder progress through a saved backup', () => {
  const rotation = { seen: [catalogueIds[2], catalogueIds[7], catalogueIds[1]], currentId: catalogueIds[1] };
  const backup = freezeDeep({ version: 1, tasks: [], settings: { sound: false, popup: false, reminderRotation: rotation }, history: [] });
  const before = clone(backup);
  const restored = validateState(clone(backup));
  assert.deepEqual(restored.settings.reminderRotation, rotation);
  assert.equal(restored.settings.sound, false);
  assert.equal(restored.settings.popup, false);
  assert.deepEqual(validateState(clone(restored)).settings.reminderRotation, rotation);
  assert.deepEqual(backup, before);
  assert.deepEqual(advanceMessage(restored.settings.reminderRotation, () => 0), advanceMessage(rotation, () => 0));
});

test('core validation accepts old backups and cleans broken rotation fields without losing valid IDs', () => {
  const legacy = validateState({ version: 1, tasks: [] });
  assert.deepEqual(legacy.settings.reminderRotation, emptyRotation);
  for (const reminderRotation of [null, false, 'previous version', { seen: {}, currentId: 9 }]) {
    const restored = validateState({ version: 1, tasks: [], settings: { reminderRotation } });
    assert.deepEqual(restored.settings.reminderRotation, emptyRotation);
  }
  const currentId = catalogueIds[3];
  const reminderRotation = { seen: [currentId, 'deleted', currentId, catalogueIds[5]], currentId };
  const restored = validateState({ version: 1, tasks: [], settings: { sound: false, reminderRotation } });
  assert.deepEqual(restored.settings.reminderRotation, { seen: [currentId, catalogueIds[5]], currentId });
  assert.equal(restored.settings.sound, false);
});
