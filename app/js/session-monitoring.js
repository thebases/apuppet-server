import { ui } from "./store.js";

const PING_INTERVAL = 2000;
const CRITICAL_DELAY = 30000;

// Pings the phone every 2 seconds; warns on a slow link and disconnects if it stays silent for 30 seconds.
export class SessionMonitoring {
  constructor(remoteChat) {
    this.remoteChat = remoteChat;
    this.timer = null;
    this.lastPingSentFrom = 0;
    this.lastPongReceivedFrom = 0;

    ui.on("RemoteChat.onManagementStart", this.start, this);
    ui.on("RemoteChat.onManagementStop", this.stop, this);
    ui.on("SessionMonitoring.onPong", this.getPong, this);
  }

  // Starts the ping loop.
  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), PING_INTERVAL);
  }

  // Checks how long the phone has been silent, then sends the next ping.
  tick() {
    const now = Date.now();
    if (this.lastPingSentFrom) {
      if (this.lastPongReceivedFrom + PING_INTERVAL * 1.5 < now) ui.showWarning("Network problems", "Device management", PING_INTERVAL);
      if (this.lastPongReceivedFrom + CRITICAL_DELAY < now) ui.emit("Session.Disconnect");
    }
    this.remoteChat.sendData(`ping,${now}`);
    this.lastPingSentFrom = now;
  }

  // Stops the ping loop and forgets earlier pings.
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.lastPingSentFrom = 0;
    this.lastPongReceivedFrom = 0;
  }

  // Records the time of the newest ping the phone answered.
  getPong(pongTimestamp) {
    this.lastPongReceivedFrom = Math.max(this.lastPongReceivedFrom, parseInt(pongTimestamp) || 0);
  }
}
