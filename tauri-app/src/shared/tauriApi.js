// Thin wrapper around the globally-injected Tauri API (tauri.conf.json has
// `withGlobalTauri: true`, so window.__TAURI__ exists with no bundler/npm package needed -
// this file is the one place that assumption lives, so swapping to the @tauri-apps/api
// package later only means changing this file).

const tauri = window.__TAURI__;

export const invoke = tauri.core.invoke;
export const listen = tauri.event.listen;
