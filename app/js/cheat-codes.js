import { ui } from "./store.js";

const MIN_LENGTH = 4;
const TIMEOUT_DELAY = 500;

// Watches the keyboard for a typed secret word (e.g. "needtodebug") and announces it.
export class CheatCodes {
  constructor() {
    this.keys = [];
    this.timer = null;
    document.addEventListener("keydown", (ev) => this.onKeyDown(ev));
  }

  // Collects letters typed in quick succession.
  onKeyDown(ev) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), TIMEOUT_DELAY);
    if (/^[a-z]$/i.test(ev.key)) this.keys.push(ev.key.toLowerCase());
  }

  // Announces the typed word once the typing pause is long enough.
  flush() {
    const cheat = this.keys.join("");
    this.keys = [];
    if (cheat.length >= MIN_LENGTH) ui.emit("CheatCodes.onCheatEntered", cheat);
  }
}
