import { reactive } from "@base/owl";
import { reloadPage } from "./utils.js";
import { activeConfig, clearConfig, defaultConfig, parseServers, saveConfig } from "./janus-config.js";

// Everything the screen shows; components read it, the session code writes it.
export const state = reactive({
  view: "login",
  pageLoader: { active: true, text: "Loading .." },
  videoLoader: { active: false, text: undefined },
  sessionId: "",
  pin: "",
  deviceName: "...",
  chatEnabled: false,
  chatSized: false,
  chatInput: "",
  messages: [],
  debug: false,
  status: "Status",
  statsVisible: true,
  resolution: "Resolution",
  bitrate: "Bitrate",
  videoWidth: 540,
  videoHeight: 1064,
  dialog: { open: false, message: "", okLabel: "OK" },
  janusDialog: { open: false, message: "", servers: "", apiSecret: "", defaults: "" },
  notices: [],
});

// A full-area "please wait" overlay whose on/off state and caption live in the shared state.
export class Loader {
  constructor(target) {
    this.target = target;
  }

  // Turns the overlay on, with an optional caption.
  show(text) {
    this.target.text = text;
    this.target.active = true;
  }

  // Turns the overlay off.
  hide() {
    this.target.active = false;
  }
}

// Waits until both the chat and the video channel report ready, then runs one action.
class ReadyGate {
  constructor(onReady) {
    this.onReady = onReady;
    this.parts = new Set();
  }

  // Forgets earlier reports so the gate can be used again.
  reset() {
    this.parts.clear();
  }

  // Records that one channel is ready and fires the action once both are.
  mark(part) {
    this.parts.add(part);
    if (this.parts.size === 2) this.onReady();
  }
}

// Screen-level behaviour shared by all session code: stages, error dialogs, notices, events.
class UI {
  constructor() {
    this.pageLoader = new Loader(state.pageLoader);
    this.videoLoader = new Loader(state.videoLoader);
    this.initGate = new ReadyGate(() => this.pageLoader.hide());
    this.connGate = new ReadyGate(() => this.showMainWindow());
    this.listeners = new Map();
    this.errors = new Map();
    this.dialogQueue = [];
    this.dialogCallback = null;
    this.dialogTimer = null;
    this.dialogRemaining = 0;
    this.noticeId = 0;
    this.deviceId = null;
  }

  // Registers a handler for a named event, optionally bound to an object.
  on(name, listener, context) {
    const handlers = this.listeners.get(name) ?? [];
    handlers.push(listener.bind(context));
    this.listeners.set(name, handlers);
  }

  // Calls every handler registered for a named event.
  emit(name, data) {
    (this.listeners.get(name) ?? []).forEach((handler) => handler(data));
  }

  // Pre-fills the login form from ?session=...&pin=... in the page address.
  fillForm() {
    const query = new URLSearchParams(window.location.search);
    state.sessionId = query.get("session") ?? "";
    state.pin = query.get("pin") ?? "";
  }

  // Stage 1: starts preparing the Janus connection behind a loading overlay.
  initStart() {
    this.fillForm();
    this.initGate.reset();
    this.pageLoader.show("Setup ..");
  }

  // Stage 1: one channel (textroom or streaming) finished preparing.
  initReady(part) {
    console.debug(`UI.Initialization: ${part} ready`);
    this.initGate.mark(part);
  }

  // Stage 2: starts connecting to the device behind a loading overlay.
  connStart() {
    this.connGate.reset();
    this.pageLoader.show("Connecting to device ..");
  }

  // Stage 2: gives up connecting and removes the overlay.
  connAbort() {
    this.pageLoader.hide();
  }

  // Stage 2: one channel (textroom or streaming) is connected.
  connReady(part) {
    console.debug(`UI.Connection: ${part} ready`);
    this.connGate.mark(part);
  }

  // Swaps the login form for the device window once everything is connected.
  showMainWindow() {
    this.pageLoader.hide();
    state.view = "main";
  }

  // Shows an error dialog, unless the same error was already shown in the last 5 seconds.
  showErrorModal(message, alias = message, callback, timeout) {
    const now = Date.now();
    const previous = this.errors.get(alias);
    this.errors.set(alias, now);
    if (previous && now - previous < 5000) {
      console.info("Error (repeat)", message, alias);
      return;
    }
    console.error("Error", message, alias);
    this.dialogQueue.push({ message, callback, timeout });
    if (!state.dialog.open) this.nextDialog();
  }

  // Shows a plain error dialog with no follow-up action.
  alert(message) {
    this.showErrorModal(message);
  }

  // Opens the next waiting error dialog, with a countdown when it ends in an automatic action.
  nextDialog() {
    const next = this.dialogQueue.shift();
    if (!next) return;
    this.dialogCallback = next.callback;
    Object.assign(state.dialog, { open: true, message: next.message, okLabel: "OK" });
    if (next.callback && Number.isInteger(next.timeout)) {
      this.dialogRemaining = next.timeout;
      this.dialogTimer = setInterval(() => this.tickCountdown(), 1000);
    }
  }

  // Updates the OK button's countdown and closes the dialog when time is up.
  tickCountdown() {
    state.dialog.okLabel = `OK (${this.dialogRemaining})`;
    if (this.dialogRemaining-- <= 0) this.closeDialog();
  }

  // Closes the open error dialog, runs its follow-up action once, then shows the next dialog.
  closeDialog() {
    if (!state.dialog.open) return;
    clearInterval(this.dialogTimer);
    state.dialog.open = false;
    const callback = this.dialogCallback;
    this.dialogCallback = null;
    callback?.();
    this.nextDialog();
  }

  // Opens the Janus server popup, filled with the server in use and showing the default one.
  openJanusDialog(message = "") {
    const { servers, apiSecret } = activeConfig();
    Object.assign(state.janusDialog, {
      open: true,
      message,
      servers: servers.join(", "),
      apiSecret,
      defaults: defaultConfig().servers.join(", ") || "none",
    });
  }

  // Closes the Janus server popup without changing anything.
  closeJanusDialog() {
    state.janusDialog.open = false;
  }

  // Saves the typed Janus server and reconnects by reloading the page.
  saveJanusDialog() {
    const servers = parseServers(state.janusDialog.servers);
    if (servers.length === 0) {
      state.janusDialog.message = "Enter at least one Janus server address.";
      return;
    }
    saveConfig({ servers, apiSecret: state.janusDialog.apiSecret });
    reloadPage();
  }

  // Drops the saved Janus server so the default is used, and reconnects by reloading the page.
  resetJanusDialog() {
    clearConfig();
    reloadPage();
  }

  // Adds a short-lived corner message, skipping one that is already on screen.
  notify(type, message, title, timeout = 5000) {
    if (state.notices.some((notice) => notice.message === message)) return;
    state.notices.push({ id: ++this.noticeId, type, message, title, timeout });
  }

  // Shows a yellow corner message.
  showWarning(message, title, timeout) {
    this.notify("warning", message, title, timeout);
  }

  // Shows a red corner message.
  showError(message, title, timeout) {
    this.notify("danger", message, title, timeout);
  }

  // Removes a corner message once it has faded out.
  dismissNotice(id) {
    const index = state.notices.findIndex((notice) => notice.id === id);
    if (index >= 0) state.notices.splice(index, 1);
  }

  // Remembers which chat participant is the phone and shows its name.
  setDevice(deviceId, deviceName) {
    this.deviceId = deviceId;
    state.deviceName = deviceName;
  }

  // Tells the user the phone ended the session, then restarts the page after 5 seconds.
  sessionClosedRemotely(message = "Session has been terminated by remote device") {
    this.showErrorModal(message, "session_closed", reloadPage, 5);
  }

  // Tells the user we disconnected, then restarts the page after 5 seconds.
  disconnect(message = "Disconnected") {
    this.showErrorModal(message, "session_closed", reloadPage, 5);
  }
}

export const ui = new UI();
