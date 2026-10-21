import { contextBridge, ipcRenderer, webUtils } from 'electron';

const eventListeners = new Map();

const readArgValue = (...names) => {
  for (const name of names) {
    const prefix = `${name}=`;
    const entry = process.argv.find((value) => typeof value === 'string' && value.startsWith(prefix));
    if (entry) {
      return entry.slice(prefix.length);
    }
  }
  return '';
};

// Each option accepts the current --alcode-* flag and its pre-rename
// --openchamber-* twin; the new name wins when both are present.
const localOrigin = readArgValue('--alcode-local-origin', '--openchamber-local-origin');
const apiBaseUrl = readArgValue('--alcode-api-base-url', '--openchamber-api-base-url');
const clientToken = readArgValue('--alcode-client-token', '--openchamber-client-token');
const runtimeHeadersRaw = readArgValue('--alcode-runtime-headers', '--openchamber-runtime-headers');
const homeDirectory = readArgValue('--alcode-home', '--openchamber-home');
const macosMajorRaw = readArgValue('--alcode-macos-major', '--openchamber-macos-major');
const macosMajor = Number.parseInt(macosMajorRaw, 10);
const trayEnabled = process.platform !== 'darwin' || readArgValue('--alcode-tray-enabled', '--openchamber-tray-enabled') !== '0';
// The window has the desktop environment's own title bar, so the page draws no window controls.
const nativeFrame = readArgValue('--alcode-native-frame', '--openchamber-native-frame') === '1';

// Preload re-executes on every cross-origin navigation (we run with
// sandbox:false, per-document). Two separate concerns to balance:
//  - __ALCODE_ELECTRON__ is a shell-identity flag (no capability).
//    Remote UIs still need it so isDesktopShell() returns true and the
//    window renders with desktop affordances (DesktopHostSwitcher,
//    title bar offsets, etc.). Expose unconditionally.
//  - __ALCODE_DESKTOP__ is the IPC channel to the main process. It is
//    exposed broadly, but privileged commands are gated in main.mjs.
//    Local-only globals below stay limited to packaged UI / exact localOrigin.
// Everything driven by localOrigin (home dir, macOS hints) also stays
// local-only since it leaks info about the Electron host machine.
const currentOrigin = (() => {
  try {
    return typeof location !== 'undefined' ? location.origin : '';
  } catch {
    return '';
  }
})();
const isLocalPage = currentOrigin !== 'null'
  && (currentOrigin === 'alcode-ui://app'
  || currentOrigin === 'openchamber-ui://app'
  || (localOrigin && currentOrigin === localOrigin));

// Remote pages need __ALCODE_LOCAL_ORIGIN__ so the HostSwitcher knows
// the URL of the Local entry (isDesktopLocalOriginActive() falls back to
// window.location.origin otherwise — wrong on remote). Low risk: the value
// is just "http://127.0.0.1:<port>" which is not exploitable without the
// IPC channel, and CORS on the local server prevents remote-origin fetches.
// Native hosts inject every runtime global under both the current __ALCODE_*
// name and its pre-rename __OPENCHAMBER_* twin, so UI bundles from either
// side of the rename resolve the same values.
const exposeMirroredGlobal = (alcodeName, openchamberName, value) => {
  contextBridge.exposeInMainWorld(alcodeName, value);
  contextBridge.exposeInMainWorld(openchamberName, value);
};

if (localOrigin) {
  exposeMirroredGlobal('__ALCODE_LOCAL_ORIGIN__', '__OPENCHAMBER_LOCAL_ORIGIN__', localOrigin);
}

if (apiBaseUrl) {
  exposeMirroredGlobal('__ALCODE_API_BASE_URL__', '__OPENCHAMBER_API_BASE_URL__', apiBaseUrl);
}

if (clientToken && isLocalPage) {
  exposeMirroredGlobal('__ALCODE_CLIENT_TOKEN__', '__OPENCHAMBER_CLIENT_TOKEN__', clientToken);
}

// Which saved host this window should connect to over the relay-capable path
// (direct probe first, E2EE tunnel fallback). Local pages only — the id is
// only useful together with the desktop IPC channel anyway.
const relayHostId = readArgValue('--alcode-relay-host-id', '--openchamber-relay-host-id');
if (relayHostId && isLocalPage) {
  exposeMirroredGlobal('__ALCODE_RELAY_HOST_ID__', '__OPENCHAMBER_RELAY_HOST_ID__', relayHostId);
}

// A window opened for a specific instance carries an explicit runtime, so the
// renderer keeps that endpoint instead of running the default-host relaunch
// restore. Exposed on any page (dev direct-host windows are remote-origin);
// the value is a hint that carries no secret.
if (readArgValue('--openchamber-explicit-runtime') === '1') {
  contextBridge.exposeInMainWorld('__OPENCHAMBER_EXPLICIT_RUNTIME__', true);
}

if (runtimeHeadersRaw && isLocalPage) {
  try {
    const runtimeHeaders = JSON.parse(runtimeHeadersRaw);
    if (runtimeHeaders && typeof runtimeHeaders === 'object') {
      exposeMirroredGlobal('__ALCODE_RUNTIME_HEADERS__', '__OPENCHAMBER_RUNTIME_HEADERS__', runtimeHeaders);
    }
  } catch {
  }
}

// Home directory leaks the OS username — keep local-only. Remote pages
// operate on the REMOTE server's filesystem, local home is irrelevant
// (and would be misleading if consumed as a workspace hint).
if (isLocalPage && homeDirectory) {
  exposeMirroredGlobal('__ALCODE_HOME__', '__OPENCHAMBER_HOME__', homeDirectory);
}

// macOS major version drives window chrome offsets (traffic lights) — UI
// presentation only, safe to expose.
if (Number.isFinite(macosMajor) && macosMajor > 0) {
  exposeMirroredGlobal('__ALCODE_MACOS_MAJOR__', '__OPENCHAMBER_MACOS_MAJOR__', macosMajor);
}

exposeMirroredGlobal('__ALCODE_ELECTRON__', '__OPENCHAMBER_ELECTRON__', {
  runtime: 'electron',
  arch: process.arch,
  trayEnabled,
  nativeFrame,
});

exposeMirroredGlobal('__ALCODE_PLATFORM__', '__OPENCHAMBER_PLATFORM__', process.platform);

// Main reloads a window that crashed several times in a row once without its
// saved layout (expanded folders, open panels), so a layout that crashes the
// window on load cannot loop forever. The startup splash (a data: page in
// development, /__splash in packaged UI) loads before main.mjs listens and is
// never the page that crashed, so it does not ask.
const isStartupSplash = (() => {
  try {
    return location.protocol === 'data:' || location.pathname === '/__splash';
  } catch {
    return false;
  }
})();
if (!isStartupSplash && ipcRenderer.sendSync('openchamber:take-safe-start') === true) {
  contextBridge.exposeInMainWorld('__OPENCHAMBER_SAFE_START__', true);
}

// Note: bootOutcome must stay writable from the main world's initScript so
// re-navigations (host switch via deep link) can refresh it. contextBridge-
// exposed globals are read-only, which blocks that update — rely solely on
// the main-process initScript injection (dispatched on did-finish-load).

const addListener = (event, handler) => {
  const listeners = eventListeners.get(event) || new Set();
  listeners.add(handler);
  eventListeners.set(event, listeners);

  return () => {
    const current = eventListeners.get(event);
    if (!current) {
      return;
    }
    current.delete(handler);
    if (current.size === 0) {
      eventListeners.delete(event);
    }
  };
};

const dispatchNativeEvent = (event, detail) => {
  const listeners = eventListeners.get(event);
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener({ payload: detail });
      } catch (error) {
        console.error(`[electron:preload] listener failed for ${event}:`, error);
      }
    }
  }

  try {
    const domEvent = detail === undefined
      ? new Event(event)
      : new CustomEvent(event, { detail });
    window.dispatchEvent(domEvent);
  } catch (error) {
    console.error(`[electron:preload] failed to dispatch DOM event ${event}:`, error);
  }
};

// Main-process events are read-only notifications (update progress,
// window focus, etc.) — safe to deliver to any page rendered in this
// webContents. The events themselves don't grant capability.
ipcRenderer.on('alcode:emit', (_evt, payload) => {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const event = typeof payload.event === 'string' ? payload.event : '';
  if (!event) {
    return;
  }

  dispatchNativeEvent(event, payload.detail);
});

const relayDevTunnelPorts = new Map();
let relayDevTunnelHandler = null;
// The tunnel connect arrives on the current channel; the pre-rename channel
// is accepted as an alias into the same handler (the main process emits
// once, on the current channel).
const handleRelayDevTunnelConnect = (event, payload) => {
  if (!isLocalPage || !payload || typeof payload.connectionId !== 'string' || !event.ports?.[0]) return;
  const port = event.ports[0];
  relayDevTunnelPorts.set(payload.connectionId, port);
  // Main's own payload: the id it opened the tunnel for, or null for the host.
  const spaceId = payload.spaceId ?? null;
  port.onmessage = (messageEvent) => relayDevTunnelHandler?.({
    connectionId: payload.connectionId,
    remotePort: payload.remotePort,
    spaceId,
    message: messageEvent.data,
  });
  port.start();
  relayDevTunnelHandler?.({ connectionId: payload.connectionId, remotePort: payload.remotePort, spaceId, message: { type: 'connect' } });
};
ipcRenderer.on('alcode:relay-dev-tunnel-connect', handleRelayDevTunnelConnect);
ipcRenderer.on('openchamber:relay-dev-tunnel-connect', handleRelayDevTunnelConnect);

// The desktop bridge is exposed on all pages; the main-process gate in
// ipcMain.handle('alcode:invoke') decides per-command what is safe
// for non-local callers (window/host-switcher ops yes, file/shell ops
// no). See COMMANDS_SAFE_FOR_REMOTE in main.mjs.
const desktopBridge = {
  invoke: (cmd, args) => ipcRenderer.invoke('alcode:invoke', cmd, args || {}),
  openDialog: (options) => ipcRenderer.invoke('alcode:dialog:open', options || {}),
  grantFileAccess: (filePath) => ipcRenderer.invoke('alcode:file:grant-existing', filePath),
  openExternal: (url) => ipcRenderer.invoke('alcode:invoke', 'desktop_open_external_url', { url }),
  listen: async (event, handler) => addListener(event, handler),
  // Resolves the on-disk path of a File dropped from Finder/Explorer. Only
  // the path string crosses the bridge; shared UI gates use on the local page.
  pathForFile: (file) => webUtils.getPathForFile(file),
};

if (isLocalPage) {
  desktopBridge.pickThemeFile = () => ipcRenderer.invoke('alcode:invoke', 'desktop_pick_theme_file', {});
  desktopBridge.relayDevTunnelListen = (handler) => {
    relayDevTunnelHandler = typeof handler === 'function' ? handler : null;
  };
  desktopBridge.relayDevTunnelPost = (connectionId, message) => {
    relayDevTunnelPorts.get(connectionId)?.postMessage(message);
    if (message?.type === 'close') relayDevTunnelPorts.delete(connectionId);
  };
}

exposeMirroredGlobal('__ALCODE_DESKTOP__', '__OPENCHAMBER_DESKTOP__', desktopBridge);
