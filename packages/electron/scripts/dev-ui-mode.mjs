// Which UI a dev launch should serve, and from which origin.
//
// "Bundled" means the freshly built shell in packages/electron/resources/web-dist, not the packaged application
// origin: alcode-ui://app is a different origin from the API on 127.0.0.1:<port>, so a bundled dev window loaded
// from that scheme sends every /api request without the session cookie and the UI sits at "Loading sessions…" on a
// 401. The Alcode server already serves that same directory, so the window loads it from the server's own origin.
export const resolveDevUiEnv = ({ useBundledUi }) => (
  useBundledUi
    ? { ALCODE_ELECTRON_USE_BUNDLED_UI: '1', ALCODE_ELECTRON_LOAD_SERVER_UI: '1' }
    : {}
)
