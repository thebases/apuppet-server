// Turns mouse drags over the video into tap and swipe commands for the phone.
export class GestureBuilder {
  constructor(remoteChat) {
    this.remoteChat = remoteChat;
    this.start = [0, 0];
    this.startMillis = 0;
    this.inProcess = false;
  }

  // Remembers where and when a press began.
  begin(offsetX, offsetY) {
    console.debug("gesture: starts on ", [offsetX, offsetY]);
    this.inProcess = true;
    this.startMillis = Date.now();
    this.start = [offsetX, offsetY];
  }

  // Sends a tap (little movement) or a swipe (long movement) to the phone when a press ends.
  finish(offsetX, offsetY) {
    if (!this.inProcess) return;
    const end = [Math.max(offsetX, 0), Math.max(offsetY, 0)];
    console.debug("gesture: ends on ", end);

    const [startX, startY] = this.start;
    const duration = Date.now() - this.startMillis;
    const isTap = Math.abs(startX - end[0]) < 2 && Math.abs(startY - end[1]) < 2;
    this.remoteChat.sendData(isTap ? `tap,${startX},${startY},${duration}` : `swipe,${startX},${startY},${end[0]},${end[1]},${duration}`);
    this.inProcess = false;
  }

  // Mouse pressed over the video.
  onDown(ev) {
    ev.target.style.cursor = "pointer";
    this.begin(ev.offsetX, ev.offsetY);
  }

  // Mouse released or left the video.
  onUp(ev) {
    ev.target.style.cursor = "auto";
    this.finish(ev.offsetX, ev.offsetY);
  }
}
