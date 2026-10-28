import os from 'node:os';
import path from 'node:path';

/** The per-user folder of the app, which survives updates and reinstalls (unlike a folder next to its code). */
export function userAppDir() {
  const home = os.homedir();
  const base =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : (process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'));
  return path.join(base, 'system-design');
}
