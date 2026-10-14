const fs = require('node:fs');
const path = require('node:path');

function supportedLanguage(value) {
  return value === 'en' || value === 'zh-CN' ? value : undefined;
}

// The installer owns this small resource file; user preferences stay in app data.
function readInstallerLanguage(resourcesPath) {
  if (typeof resourcesPath !== 'string' || !resourcesPath) return undefined;
  try {
    const text = fs.readFileSync(path.join(resourcesPath, 'installer-language.json'), 'utf8');
    return supportedLanguage(JSON.parse(text.replace(/^\uFEFF/, ''))?.language);
  } catch {
    return undefined;
  }
}

function resolveInitialLanguage({ savedLanguage, installerLanguage, systemLocale, hasExistingData = false } = {}) {
  const selected = supportedLanguage(savedLanguage) || supportedLanguage(installerLanguage);
  if (selected) return selected;
  // Existing releases were Chinese-only. An upgrade without installer metadata
  // must not unexpectedly change an established user's interface language.
  if (hasExistingData) return 'zh-CN';
  return typeof systemLocale === 'string' && /^zh(?:[-_]|$)/i.test(systemLocale) ? 'zh-CN' : 'en';
}

module.exports = { readInstallerLanguage, resolveInitialLanguage };
