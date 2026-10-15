import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const AUTOSTART_FILE_NAME = 'alcode.desktop';
// Pre-rename autostart entry. Installing the new entry removes this legacy
// file so upgraded machines do not launch twice; disabling removes both.
export const LEGACY_AUTOSTART_FILE_NAME = 'openchamber.desktop';

const resolveLinuxAutostartDirectory = ({
  env = process.env,
  homeDir = os.homedir(),
} = {}) => {
  const configHome = typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim()
    ? env.XDG_CONFIG_HOME.trim()
    : path.join(homeDir || os.homedir(), '.config');
  return path.join(configHome, 'autostart');
};

export const resolveLinuxAutostartFilePath = (options = {}) =>
  path.join(resolveLinuxAutostartDirectory(options), AUTOSTART_FILE_NAME);

export const resolveLinuxLaunchExecutable = ({
  env = process.env,
  execPath = process.execPath,
} = {}) => {
  const appImage = typeof env.APPIMAGE === 'string' ? env.APPIMAGE.trim() : '';
  if (appImage && path.isAbsolute(appImage)) {
    return appImage;
  }
  return execPath;
};

const quoteDesktopExecArg = (value) => {
  const text = String(value ?? '');
  if (!/[ \t\n"$\\]/.test(text)) {
    return text;
  }
  return `"${text.replace(/(["\\$`])/g, '\\$1')}"`;
};

export const buildLinuxAutostartDesktopEntry = ({
  appName = 'Alcode',
  executable,
  backgroundArg,
  env = process.env,
  execPath = process.execPath,
} = {}) => {
  const launchPath = executable || resolveLinuxLaunchExecutable({ env, execPath });
  const args = [quoteDesktopExecArg(launchPath)];
  if (typeof backgroundArg === 'string' && backgroundArg.trim()) {
    args.push(backgroundArg.trim());
  }
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${appName}`,
    `Exec=${args.join(' ')}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'StartupWMClass=alcode',
    '',
  ].join('\n');
};

export const readLinuxAutostartEnabled = async (options = {}) => {
  // Either entry counts: a pre-rename install still has the legacy file until
  // the new build reconciles it, and that install does launch at login.
  for (const fileName of [AUTOSTART_FILE_NAME, LEGACY_AUTOSTART_FILE_NAME]) {
    const filePath = path.join(resolveLinuxAutostartDirectory(options), fileName);
    try {
      await fsp.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
    }
  }
  return false;
};

export const setLinuxAutostartEnabled = async ({
  enabled,
  appName = 'Alcode',
  backgroundArg,
  env = process.env,
  execPath = process.execPath,
  homeDir = os.homedir(),
} = {}) => {
  const directory = resolveLinuxAutostartDirectory({ env, homeDir });
  const filePath = path.join(directory, AUTOSTART_FILE_NAME);
  const legacyFilePath = path.join(directory, LEGACY_AUTOSTART_FILE_NAME);

  if (!enabled) {
    await fsp.rm(filePath, { force: true });
    await fsp.rm(legacyFilePath, { force: true });
    return { supported: true, enabled: false, filePath };
  }

  await fsp.mkdir(directory, { recursive: true });
  const contents = buildLinuxAutostartDesktopEntry({
    appName,
    backgroundArg,
    env,
    execPath,
  });
  await fsp.writeFile(filePath, contents, 'utf8');
  // Drop the pre-rename entry so an upgraded machine launches once, not twice.
  let legacyRemoved = false;
  try {
    await fsp.access(legacyFilePath, fs.constants.F_OK);
    await fsp.rm(legacyFilePath, { force: true });
    legacyRemoved = true;
  } catch {
    legacyRemoved = false;
  }
  return { supported: true, enabled: true, filePath, legacyRemoved };
};
