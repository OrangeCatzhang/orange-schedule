const path = require('node:path');

// Electron supplies the platform's per-user app directory via app.getPath('userData').
// See https://www.electronjs.org/docs/latest/api/app#appgetpathname
function resolveDataPath(defaultUserData, override) {
  const chosen = typeof override === 'string' && override.trim() ? override : defaultUserData;
  return path.resolve(chosen);
}

module.exports = { resolveDataPath };
