const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readInstallerLanguage, resolveInitialLanguage } = require('../src/installation-language.cjs');

test('saved interface language wins over installer choices on later upgrades', () => {
  for (const [savedLanguage, installerLanguage] of [['en', 'zh-CN'], ['zh-CN', 'en']]) {
    assert.equal(resolveInitialLanguage({ savedLanguage, installerLanguage, systemLocale: 'de-DE', hasExistingData: true }), savedLanguage);
  }
});

test('installation language initializes new and Chinese-only legacy profiles', () => {
  for (const hasExistingData of [false, true]) {
    assert.equal(resolveInitialLanguage({ installerLanguage: 'en', systemLocale: 'zh-CN', hasExistingData }), 'en');
    assert.equal(resolveInitialLanguage({ installerLanguage: 'zh-CN', systemLocale: 'en-GB', hasExistingData }), 'zh-CN');
  }
});

test('legacy data without a valid preference or installer metadata stays Chinese', () => {
  assert.equal(resolveInitialLanguage({ savedLanguage: 'fr', installerLanguage: 'invalid', systemLocale: 'en-US', hasExistingData: true }), 'zh-CN');
});

test('unpacked fresh installations select Chinese locales and otherwise default to English', () => {
  for (const systemLocale of ['zh', 'zh-CN', 'zh-TW', 'zh-Hant-TW', 'zh_HK', 'ZH-cn']) {
    assert.equal(resolveInitialLanguage({ systemLocale }), 'zh-CN', systemLocale);
  }
  for (const systemLocale of ['en-US', 'en-GB', 'fr-FR', 'zhnotalocale', undefined, null, 1033, '']) {
    assert.equal(resolveInitialLanguage({ systemLocale }), 'en');
  }
  assert.equal(resolveInitialLanguage(), 'en');
});

test('only supported preference values are accepted without coercion', () => {
  for (const savedLanguage of [null, '', 'EN', 'en-US', 1033, ['en'], {}]) {
    assert.equal(resolveInitialLanguage({ savedLanguage, installerLanguage: 'zh-CN' }), 'zh-CN');
  }
});

test('installer resource is read without modifying files; missing or malformed resources are ignored', () => {
  const scratchRoot = path.join(__dirname, '..', '_work');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratchRoot, '_verify_installer-language-'));
  const file = path.join(directory, 'installer-language.json');
  try {
    assert.equal(readInstallerLanguage(directory), undefined);
    assert.equal(readInstallerLanguage(undefined), undefined);
    for (const [source, expected] of [
      ['{"language":"en"}\r\n', 'en'],
      ['\uFEFF{"language":"zh-CN"}', 'zh-CN'],
      ['{"language":"fr"}', undefined],
      ['{"language":1033}', undefined],
      ['null', undefined],
      ['[]', undefined],
      ['{broken', undefined]
    ]) {
      fs.writeFileSync(file, source, 'utf8');
      assert.equal(readInstallerLanguage(directory), expected);
      assert.equal(fs.readFileSync(file, 'utf8'), source);
    }
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmdirSync(directory);
  }
});
