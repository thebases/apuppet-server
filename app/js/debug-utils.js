import { state } from "./store.js";

// Hidden developer tools: the debug panel and an automatic swipe test (reachable as window.debugUtils).
export class DebugUtils {
  constructor(remoteChat) {
    this.remoteChat = remoteChat;
    this.testSwipesInterval = null;
  }

  // Tells whether the debug panel is on.
  isDebugEnabled() {
    return state.debug;
  }

  // Shows the debug panel.
  enable() {
    state.debug = true;
  }

  // Hides the debug panel.
  disable() {
    state.debug = false;
  }

  // Starts or stops sending a swipe to the phone repeatedly; returns the new On/Off state.
  toggleTestSwipes(w = 500, h = 200, delay = 1000) {
    if (this.testSwipesInterval) {
      clearInterval(this.testSwipesInterval);
      this.testSwipesInterval = null;
      return "Off";
    }
    this.testSwipesInterval = setInterval(() => this.remoteChat.sendData(`swipe,${w},${h},0,${h},500`), delay);
    return "On";
  }
}
