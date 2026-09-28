const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resolveDataPath } = require('../src/data-path.cjs');

const userDirectory = name => path.join(os.tmpdir(), 'weeklight-path-tests', name, 'weeklight');

test('default data belongs to the current user directory provided by Electron', () => {
  const firstUser = userDirectory('first-user');
  const secondUser = userDirectory('second-user');
  assert.equal(resolveDataPath(firstUser), firstUser);
  assert.equal(resolveDataPath(secondUser), secondUser);
  assert.notEqual(resolveDataPath(firstUser), resolveDataPath(secondUser));
});

test('an explicit absolute data override takes precedence and preserves spaces and Unicode', () => {
  const custom = path.join(os.tmpdir(), '周光自选目录', 'My Plans');
  assert.equal(resolveDataPath(userDirectory('first-user'), custom), custom);
  assert.equal(resolveDataPath(userDirectory('second-user'), custom), custom);
});

test('an empty environment override falls back to the per-user default', () => {
  const defaultPath = userDirectory('current-user');
  for (const override of [undefined, '', ' ', '\t']) {
    assert.equal(resolveDataPath(defaultPath, override), defaultPath);
  }
});

test('an explicit relative override resolves to an absolute directory for Electron setPath', () => {
  const override = path.join('_work', 'custom-weeklight-data');
  const actual = resolveDataPath(userDirectory('current-user'), override);
  assert.equal(actual, path.resolve(override));
  assert.equal(path.isAbsolute(actual), true);
});
