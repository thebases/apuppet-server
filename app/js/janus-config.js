const STORAGE_KEY = "apuppet.janus";
const DEFAULT_SERVER = "https://webrtc.thebase.vn/janus";

// Splits the server addresses typed by the user (comma or space separated) into a clean list.
export function parseServers(text) {
  return text.split(/[\s,]+/).filter(Boolean);
}

// The Janus server list and API secret from settings.js, falling back to the Base WebRTC server.
export function defaultConfig() {
  const servers = [].concat(window.janusServers ?? []);
  return { servers: servers.length ? servers : [DEFAULT_SERVER], apiSecret: window.apiSecret ?? "" };
}

// The server chosen by the user in this browser, or the deployment default when none was saved.
export function activeConfig() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : defaultConfig();
}

// Remembers the user's Janus server choice in this browser.
export function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// Forgets the user's choice so the deployment default is used again.
export function clearConfig() {
  localStorage.removeItem(STORAGE_KEY);
}
