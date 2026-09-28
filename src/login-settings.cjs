const { win32: path } = require('node:path');

const LOGIN_ARGS = ['--hidden'];
const samePath = (left, right) => typeof left === 'string' && typeof right === 'string' && path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();

function createLoginSettings({ app, execPath = process.execPath, platform = process.platform, legacyExecutableName = '周光.exe', loginItemName = 'local.weeklight.planner' }) {
  let migrationChecked = false;
  const supported = () => platform === 'win32' && app.isPackaged === true;
  const read = target => app.getLoginItemSettings({ path: target, args: [...LOGIN_ARGS] });
  const matchingItem = (settings, target) => Array.isArray(settings.launchItems) ? settings.launchItems.find(item => item.name === loginItemName && item.scope === 'user' && samePath(item.path, target)) : undefined;

  function getOpenAtLogin() {
    return supported() && read(execPath).openAtLogin === true;
  }

  function setOpenAtLogin(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('开机自动启动设置必须为布尔值');
    if (!supported()) throw new Error('开机自动启动仅支持打包后的 Windows 应用');
    app.setLoginItemSettings({ openAtLogin: enabled, path: execPath, args: [...LOGIN_ARGS], name: loginItemName });
    const saved = getOpenAtLogin();
    if (saved !== enabled) {
      throw new Error('Windows 未保存开机自动启动设置。请检查当前账户权限或安全软件是否拦截后重试。');
    }
    return saved;
  }
  function migrateLegacyOnce() {
    if (!supported()) return { migrated: false, reason: 'unsupported' };
    if (migrationChecked) return { migrated: false, reason: 'already-checked' };
    migrationChecked = true;
    if (!path.isAbsolute(execPath)) throw new Error('Current executable path must be absolute');
    if (typeof legacyExecutableName !== 'string' || path.basename(legacyExecutableName) !== legacyExecutableName || /[:\\/]/.test(legacyExecutableName) || !/\.exe$/i.test(legacyExecutableName)) {
      throw new Error('Legacy executable name must be a filename in the same installation directory');
    }
    const legacyPath = path.join(path.dirname(execPath), legacyExecutableName);
    if (samePath(execPath, legacyPath)) return { migrated: false, reason: 'unchanged-executable' };
    // Preserve a configured current entry even when Task Manager has disabled it.
    if (read(execPath).openAtLogin === true) return { migrated: false, reason: 'current-configured' };
    let legacy = read(legacyPath);
    if (legacy.openAtLogin !== true) return { migrated: false, reason: 'legacy-not-configured' };
    let item = matchingItem(legacy, legacyPath);
    // Electron compares commands rather than checking that the old executable exists.
    // Its Windows launchItems parser accepts quoted paths for installations containing spaces.
    // https://github.com/electron/electron/blob/v44.4.5/shell/browser/browser_win.cc
    if (!item && /\s/.test(legacyPath)) {
      legacy = read('"' + legacyPath + '"');
      item = matchingItem(legacy, legacyPath);
    }
    // openAtLogin proves the exact --hidden command; enabled preserves StartupApproved.
    // Inspect the app's own current-user entry, not another launch item for the same EXE.
    if (legacy.openAtLogin !== true || !item || item.enabled !== true) return { migrated: false, reason: 'legacy-not-enabled' };
    app.setLoginItemSettings({ openAtLogin: true, path: execPath, args: [...LOGIN_ARGS], name: loginItemName });
    return { migrated: true, from: legacyPath, to: execPath };
  }

  return { getOpenAtLogin, setOpenAtLogin, migrateLegacyOnce };
}

module.exports = { createLoginSettings };
