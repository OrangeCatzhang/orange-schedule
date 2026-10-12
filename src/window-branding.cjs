const path = require('node:path');

const APP_ID = 'local.weeklight.planner';
const APP_NAME = '橙子日程';

function resolveAppId(app) {
  // Electron development shortcuts must never claim the installed app's
  // taskbar identity or replace its icon in the Windows Shell app registry.
  return app.isPackaged ? APP_ID : APP_ID + '.development';
}

// A relaunch command is parsed as a Windows command line, including spaces and
// trailing backslashes in a development checkout path.
function quoteWindowsArgument(value) {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

function createWindowBranding({
  app,
  platform = process.platform,
  resourcesPath = process.resourcesPath,
  execPath = process.execPath,
  sourceDir = __dirname
}) {
  const windows = platform === 'win32';
  const appId = resolveAppId(app);
  const paths = windows ? path.win32 : path;
  // Windows Shell cannot read an icon inside app.asar. Keep a physical ICO in
  // extraResources for taskbar grouping, pinned entries and relaunch metadata.
  const iconPath = windows
    ? paths.join(app.isPackaged ? resourcesPath : sourceDir, 'assets', 'icon.ico')
    : paths.join(sourceDir, 'assets', 'icon.png');
  const details = windows ? {
    appIconPath: iconPath,
    appIconIndex: 0,
    relaunchCommand: [execPath, ...(app.isPackaged ? [] : [app.getAppPath()])].map(quoteWindowsArgument).join(' '),
    relaunchDisplayName: APP_NAME
  } : null;

  return {
    iconPath,
    apply(window) {
      if (!windows) return;
      // Write relaunch properties first, then the AppUserModelID that tells
      // Windows Shell to refresh the window's taskbar identity. Electron writes
      // appId first when both are supplied in one call, so keep these separate.
      // Call apply() before showing the window for the first time.
      window.setAppDetails({ ...details });
      window.setAppDetails({ appId });
      window.setIcon(iconPath);
    }
  };
}

module.exports = { APP_ID, resolveAppId, createWindowBranding };
