import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import path from 'node:path';
import request from 'supertest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('../package-manager.js', () => ({
  checkForUpdates: vi.fn(),
  getUpdateCommand: vi.fn(),
  detectPackageManagerDetails: vi.fn(),
  isUnmanagedInstall: vi.fn(),
}));

const childProcess = await import('child_process');
const packageManager = await import('../package-manager.js');
const { registerAlcodeRoutes } = await import('./alcode-routes.js');

const createApp = ({
  environment = {},
  storedOptions = {},
  desktopUpdater,
  platform = 'linux',
  execPath = '/usr/bin/node',
  plistExists = false,
} = {}) => {
  const app = express();
  const dependencies = {
    fs: {
      existsSync: vi.fn((targetPath) => {
        // `plistExists` is either a boolean (both plists) or the label of the
        // single plist that exists, so tests can prove which one is consulted.
        if (typeof targetPath === 'string' && (targetPath.endsWith('dev.alcode.web.plist') || targetPath.endsWith('dev.openchamber.web.plist'))) {
          if (plistExists === true) return true;
          if (typeof plistExists === 'string') return targetPath.endsWith(`${plistExists}.plist`);
          return false;
        }
        return false;
      }),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      openSync: vi.fn(() => 7),
      closeSync: vi.fn(),
      promises: {
        readFile: vi.fn(async () => JSON.stringify({
          launchMode: 'foreground',
          port: 7897,
          ...storedOptions,
        })),
      },
    },
    os: {
      homedir: () => '/home/test',
    },
    path,
    process: {
      env: environment,
      platform,
      execPath,
      exit: vi.fn(),
    },
    server: {
      address: () => ({ port: 7897 }),
      close: vi.fn(),
    },
    __dirname: '/opt/alcode/server',
    alcodeDataDir: '/tmp/alcode',
    modelsDevApiUrl: 'https://models.example.test',
    modelsMetadataCacheTtl: 0,
    readSettingsFromDiskMigrated: vi.fn(),
    fetchFreeZenModels: vi.fn(),
    getCachedZenModels: vi.fn(),
    desktopUpdater,
  };

  registerAlcodeRoutes(app, dependencies);
  return { app, dependencies };
};

beforeEach(() => {
  packageManager.checkForUpdates.mockResolvedValue({
    available: true,
    version: '1.17.1',
  });
  packageManager.detectPackageManagerDetails.mockReturnValue({
    packageManager: 'npm',
  });
  packageManager.getUpdateCommand.mockReturnValue('npm install -g @alcode/web@latest');
  packageManager.isUnmanagedInstall.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Alcode desktop host update route', () => {
  it('reports a restart rejection until the user retries installation', async () => {
    const desktopUpdater = {
      check: vi.fn(async () => ({ available: true, currentVersion: '1.17.0', version: '1.17.1' })),
      install: vi.fn(async () => ({ available: true, version: '1.17.1' })),
      restart: vi.fn().mockRejectedValueOnce(new Error('Signature rejected')).mockResolvedValue(undefined),
    };
    const { app } = createApp({ environment: { ALCODE_RUNTIME: 'desktop' }, desktopUpdater });
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await request(app).post('/api/alcode/update-install').expect(200);
    await new Promise(resolve => setImmediate(resolve));
    await request(app).get('/api/alcode/update-check?appType=web&reportUsage=false&updateStatus=true').expect(503, {
      code: 'DESKTOP_UPDATE_RESTART_FAILED', error: 'Signature rejected',
    });
    expect(desktopUpdater.check).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledOnce();
    // Availability remains reachable after a browser reload, so users can retry.
    await request(app).get('/api/alcode/update-check?appType=web&reportUsage=false').expect(200);

    await request(app).post('/api/alcode/update-install').expect(200);
    await new Promise(resolve => setImmediate(resolve));
    const response = await request(app).get('/api/alcode/update-check?appType=web&reportUsage=false').expect(200);
    expect(response.body.currentVersion).toBe('1.17.0');
    expect(response.body.updateOwner).toBe('electron-updater');
    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
  });

  it('rejects native checks without a bridge and preserves explicit non-web checks', async () => {
    const { app } = createApp({ environment: { ALCODE_RUNTIME: 'desktop' } });
    await request(app).get('/api/alcode/update-check?appType=web').expect(503, {
      available: false, code: 'DESKTOP_UPDATER_UNAVAILABLE', error: 'The desktop updater is not available.',
    });
    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
    await request(app).get('/api/alcode/update-check?appType=desktop-electron').expect(200);
    expect(packageManager.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('uses electron-updater to check for Web client updates', async () => {
    const desktopUpdater = {
      check: vi.fn(async () => ({
        available: true,
        currentVersion: '1.17.0',
        version: '1.17.1',
      })),
      install: vi.fn(),
      restart: vi.fn(),
    };
    const { app } = createApp({
      environment: {
        ALCODE_RUNTIME: 'desktop',
      },
      desktopUpdater,
    });

    await request(app)
      .get('/api/alcode/update-check?appType=web&reportUsage=false')
      .expect(200, {
        available: true,
        currentVersion: '1.17.0',
        version: '1.17.1',
        packageManager: 'electron',
        updateOwner: 'electron-updater',
      });

    expect(desktopUpdater.check).toHaveBeenCalledOnce();
    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
  });

  it('installs through electron-updater and restarts after responding', async () => {
    const desktopUpdater = {
      check: vi.fn(),
      install: vi.fn(async () => ({
        available: true,
        version: '1.17.1',
      })),
      restart: vi.fn(),
    };
    const { app } = createApp({
      environment: {
        ALCODE_RUNTIME: 'desktop',
      },
      desktopUpdater,
    });

    await request(app)
      .post('/api/alcode/update-install')
      .expect(200, {
        success: true,
        message: 'Desktop update downloaded, host will restart shortly',
        version: '1.17.1',
        packageManager: 'electron',
        updateOwner: 'electron-updater',
        autoRestart: true,
        restartManager: 'electron-updater',
      });
    await new Promise((resolve) => setImmediate(resolve));

    expect(desktopUpdater.install).toHaveBeenCalledOnce();
    expect(desktopUpdater.restart).toHaveBeenCalledOnce();
    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
    expect(packageManager.detectPackageManagerDetails).not.toHaveBeenCalled();
    expect(packageManager.getUpdateCommand).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });

  it('refuses a remote install the desktop host must run on its own screen, without restarting', async () => {
    const desktopUpdater = {
      check: vi.fn(),
      install: vi.fn(async () => ({ available: true, version: '1.17.1', installBlocked: 'desktop-host' })),
      restart: vi.fn(),
    };
    const { app } = createApp({ environment: { ALCODE_RUNTIME: 'desktop' }, desktopUpdater });

    await request(app).post('/api/openchamber/update-install').expect(409, {
      code: 'DESKTOP_UPDATE_LOCAL_ONLY',
      error: 'Update OpenChamber on the computer it runs on.',
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(desktopUpdater.restart).not.toHaveBeenCalled();
  });

  it('fails safely when the Electron updater bridge is unavailable', async () => {
    const { app } = createApp({
      environment: {
        ALCODE_RUNTIME: 'desktop',
      },
    });

    await request(app)
      .post('/api/alcode/update-install')
      .expect(503, {
        code: 'DESKTOP_UPDATER_UNAVAILABLE',
        error: 'The desktop updater is not available.',
      });

    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
});

describe('Alcode foreground update route', () => {
  it('marks an available update as blocked when the foreground server has no service manager', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/alcode/update-check?appType=web').expect(200);

    expect(response.body).toMatchObject({ available: true, installBlocked: 'service-manager' });
  });

  it('leaves the update installable for a systemd-owned or daemon server', async () => {
    const systemd = createApp({ environment: { INVOCATION_ID: 'systemd-invocation' } });
    const daemon = createApp({ storedOptions: { launchMode: 'daemon' } });

    for (const { app } of [systemd, daemon]) {
      const response = await request(app).get('/api/alcode/update-check?appType=web').expect(200);
      expect(response.body.installBlocked).toBeUndefined();
    }
  });

  it('leaves the update installable for a macOS launchd foreground server', async () => {
    const launchd = createApp({
      platform: 'darwin',
      environment: { XPC_SERVICE_NAME: 'dev.alcode.web' },
      storedOptions: { launchMode: 'foreground' },
      plistExists: true,
    });
    const response = await request(launchd.app).get('/api/alcode/update-check?appType=web').expect(200);
    expect(response.body.installBlocked).toBeUndefined();
  });

  it('recognizes a pre-rename launchd agent by its legacy label and plist', async () => {
    const launchd = createApp({
      platform: 'darwin',
      environment: { XPC_SERVICE_NAME: 'dev.openchamber.web' },
      storedOptions: { launchMode: 'foreground' },
      plistExists: 'dev.openchamber.web',
    });
    const response = await request(launchd.app).get('/api/alcode/update-check?appType=web').expect(200);
    expect(response.body.installBlocked).toBeUndefined();
  });

  it('answers the pre-rename /api/openchamber/* prefix for every route', async () => {
    const { app } = createApp();
    const current = await request(app).get('/api/alcode/enterprise-policy').expect(200);
    const legacy = await request(app).get('/api/openchamber/enterprise-policy').expect(200);
    expect(legacy.body).toEqual(current.body);
  });

  it('rejects a foreground update when the server is not owned by systemd', async () => {
    const { app } = createApp();

    await request(app)
      .post('/api/alcode/update-install')
      .expect(409, {
        error: 'Foreground servers must be updated by their service manager. Set ALCODE_SYSTEMD_UNIT when running under systemd, or run alcode update and restart the service.',
      });

    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });

  it('rejects an unsafe systemd unit override before starting an update job', async () => {
    const { app } = createApp({
      environment: {
        INVOCATION_ID: 'systemd-invocation',
        ALCODE_SYSTEMD_UNIT: 'openchamber.service; rm -rf /',
      },
    });

    await request(app)
      .post('/api/alcode/update-install')
      .expect(409, {
        error: 'Foreground servers must be updated by their service manager. Set ALCODE_SYSTEMD_UNIT when running under systemd, or run alcode update and restart the service.',
      });

    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });

  it('queues the install in a transient systemd unit and returns its job identifier', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    const { app } = createApp({
      environment: {
        INVOCATION_ID: 'systemd-invocation',
        ALCODE_SYSTEMD_UNIT: 'alcode@wsl.service',
        PATH: '/home/syu/.npm-global/bin:/usr/bin:/bin',
      },
    });

    await request(app)
      .post('/api/alcode/update-install')
      .expect(200, {
        success: true,
        message: 'Update queued; Alcode will restart after installation completes',
        version: '1.17.1',
        packageManager: 'npm',
        autoRestart: true,
        restartManager: 'systemd',
        jobId: 'alcode-update-1700000000000',
        logPath: 'journalctl --user-unit alcode-update-1700000000000.service',
      });

    expect(childProcess.spawnSync).toHaveBeenCalledWith('systemd-run', [
      '--user',
      '--unit=alcode-update-1700000000000',
      '--collect',
      '--service-type=exec',
      '--setenv=PATH=/home/syu/.npm-global/bin:/usr/bin:/bin',
      '/bin/sh',
      '-c',
      "set -eu\nnpm install -g @alcode/web@latest\nsystemctl --user restart 'alcode@wsl.service'",
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
  });

  it('rejects foreground update on macOS when launchd plist does not exist', async () => {
    const { app } = createApp({
      platform: 'darwin',
      storedOptions: { launchMode: 'foreground' },
      plistExists: false,
    });

    await request(app)
      .post('/api/alcode/update-install')
      .expect(409, {
        error: 'Foreground servers must be updated by their service manager. Set ALCODE_SYSTEMD_UNIT when running under systemd, or run alcode update and restart the service.',
      });

    expect(childProcess.spawnSync).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('rejects foreground update on macOS when the plist exists but the server was not started by launchd', async () => {
    const { app } = createApp({
      platform: 'darwin',
      storedOptions: { launchMode: 'foreground' },
      plistExists: true,
    });

    await request(app)
      .post('/api/alcode/update-install')
      .expect(409);

    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('allows foreground update on macOS when launchd plist exists and invokes launchd restart command', async () => {
    const { app } = createApp({
      platform: 'darwin',
      environment: { XPC_SERVICE_NAME: 'dev.alcode.web' },
      storedOptions: { launchMode: 'foreground' },
      plistExists: true,
    });
    childProcess.spawn.mockReturnValue({ unref: vi.fn() });

    await request(app)
      .post('/api/alcode/update-install')
      .expect(200, {
        success: true,
        message: 'Update starting, server will restart shortly',
        version: '1.17.1',
        packageManager: 'npm',
        autoRestart: true,
        restartManager: 'service',
      });

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(childProcess.spawn).toHaveBeenCalledWith(
      'sh',
      [
        '-c',
        expect.stringContaining(
          "launchctl kickstart -k gui/$(id -u)/dev.alcode.web || launchctl bootstrap gui/$(id -u) '/home/test/Library/LaunchAgents/dev.alcode.web.plist'"
        ),
      ],
      expect.objectContaining({
        detached: true,
      })
    );
  });

  it('allows daemon update on macOS without launchd plist and invokes CLI restart command', async () => {
    const { app } = createApp({
      platform: 'darwin',
      storedOptions: { launchMode: 'daemon', port: 7897 },
      plistExists: false,
    });
    childProcess.spawn.mockReturnValue({ unref: vi.fn() });

    await request(app)
      .post('/api/alcode/update-install')
      .expect(200, {
        success: true,
        message: 'Update starting, server will restart shortly',
        version: '1.17.1',
        packageManager: 'npm',
        autoRestart: true,
        restartManager: 'cli',
      });

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(childProcess.spawn).toHaveBeenCalledWith(
      'sh',
      [
        '-c',
        expect.stringContaining(
          "('/usr/bin/node' '/opt/alcode/bin/cli.js' serve --port 7897) || (alcode serve --port 7897)"
        ),
      ],
      expect.objectContaining({
        detached: true,
      })
    );
  });

  it('allows daemon update on macOS with launchd plist present and still invokes CLI restart command', async () => {
    const { app } = createApp({
      platform: 'darwin',
      storedOptions: { launchMode: 'daemon', port: 7897 },
      plistExists: true,
    });
    childProcess.spawn.mockReturnValue({ unref: vi.fn() });

    await request(app)
      .post('/api/alcode/update-install')
      .expect(200, {
        success: true,
        message: 'Update starting, server will restart shortly',
        version: '1.17.1',
        packageManager: 'npm',
        autoRestart: true,
        restartManager: 'cli',
      });

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(childProcess.spawn).toHaveBeenCalledWith(
      'sh',
      [
        '-c',
        expect.stringContaining(
          "('/usr/bin/node' '/opt/alcode/bin/cli.js' serve --port 7897) || (alcode serve --port 7897)"
        ),
      ],
      expect.objectContaining({
        detached: true,
      })
    );
  });
});

describe('Alcode update route for a copy no package manager installed', () => {
  beforeEach(() => {
    packageManager.isUnmanagedInstall.mockReturnValue(true);
  });

  it('marks an available update as blocked so clients show no Update button', async () => {
    const { app } = createApp({ storedOptions: { launchMode: 'daemon' } });

    const response = await request(app).get('/api/alcode/update-check?appType=web').expect(200);

    expect(response.body).toMatchObject({ available: true, installBlocked: 'manual-install' });
  });

  it('refuses the install instead of adding a global copy next to this one', async () => {
    for (const environment of [{}, { CONTAINER: '1' }]) {
      const { app } = createApp({ environment, storedOptions: { launchMode: 'daemon' } });

      await request(app)
        .post('/api/alcode/update-install')
        .expect(409, {
          error: 'This copy can\'t update itself. Install the new version the way you installed it.',
        });
    }

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(packageManager.detectPackageManagerDetails).not.toHaveBeenCalled();
    expect(packageManager.getUpdateCommand).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });
});

describe('Alcode web update route on Windows', () => {
  it('runs the install-and-restart script from a batch file instead of a cmd.exe /c argument', async () => {
    const { app, dependencies } = createApp({
      platform: 'win32',
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      environment: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' },
      storedOptions: { launchMode: 'daemon', port: 7897 },
    });
    childProcess.spawn.mockReturnValue({ unref: vi.fn() });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await request(app).post('/api/alcode/update-install').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 1300));

    const scriptPath = path.join('/tmp/alcode', 'update-install.cmd');
    expect(dependencies.fs.writeFileSync).toHaveBeenCalledWith(scriptPath, expect.any(String), 'utf8');
    const script = dependencies.fs.writeFileSync.mock.calls[0][1];
    const lines = script.split('\r\n');
    expect(lines[0]).toBe('@echo off');
    // Every preamble line is an echo; none is left to run as a command.
    expect(lines.filter((line) => line.startsWith('currentVersion=') || line.startsWith('restartCommand='))).toEqual([]);
    expect(lines).toContain('echo packageManager=npm');
    expect(lines).toContain('echo restartCommand=^("C:\\Program Files\\nodejs\\node.exe" "/opt/alcode/bin/cli.js" serve --port 7897^) ^|^| ^(alcode serve --port 7897^)');
    // No secret is ever part of the script or its log.
    expect(script).not.toContain('pa%');
    // A .cmd shim (npm, pnpm, yarn) must be `call`ed or the script ends there.
    expect(lines).toContain('call npm install -g @alcode/web@latest');
    expect(lines).toContain('ping -n 3 127.0.0.1 >nul');
    expect(lines.some((line) => line.startsWith('timeout '))).toBe(false);
    expect(lines).toContain('if %ERRORLEVEL% EQU 0 (');
    expect(lines.at(-2)).toBe('del "%~f0"');
    expect(lines).toContain('  ("C:\\Program Files\\nodejs\\node.exe" "/opt/alcode/bin/cli.js" serve --port 7897) || (alcode serve --port 7897)');

    // The restarted server inherits its environment (Alcore secret included);
    // no credential is added for the update child.
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'C:\\Windows\\system32\\cmd.exe',
      ['/c', scriptPath],
      expect.objectContaining({
        detached: true,
        windowsHide: true,
        env: process.env,
      }),
    );
    // The listener is closed before the batch is spawned, so the detached
    // child cannot inherit the socket and hold the port against the restart.
    expect(dependencies.server.close).toHaveBeenCalledOnce();
    expect(dependencies.server.close.mock.invocationCallOrder[0]).toBeLessThan(childProcess.spawn.mock.invocationCallOrder[0]);
    expect(dependencies.process.exit).toHaveBeenCalledWith(0);
  });

  it('answers 500 and keeps the server up when the batch file cannot be written', async () => {
    const { app, dependencies } = createApp({ platform: 'win32', storedOptions: { launchMode: 'daemon', port: 7897 } });
    dependencies.fs.writeFileSync.mockImplementation(() => { throw new Error('EACCES'); });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app).post('/api/alcode/update-install').expect(500);
    await new Promise((resolve) => setTimeout(resolve, 1300));

    expect(response.body.error).toContain('update-install.cmd');
    expect(response.body.error).toContain('EACCES');
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(dependencies.process.exit).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledOnce();
  });
});
