// Whole-pixel position of an event inside the video, kept within the video edges.
function videoPoint(ev) {
  const x = Math.min(Math.max(Math.round(ev.offsetX), 0), ev.target.clientWidth);
  const y = Math.min(Math.max(Math.round(ev.offsetY), 0), ev.target.clientHeight);
  return [x, y];
}

// One finger or the mouse over the video becomes tap/swipe commands for the phone; two fingers scroll this web page instead.
export class GestureBuilder {
  constructor(remoteChat) {
    this.remoteChat = remoteChat;
    this.start = [0, 0];
    this.startMillis = 0;
    this.inProcess = false;
    this.fingers = new Map();
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
    const end = [offsetX, offsetY];
    console.debug("gesture: ends on ", end);

    const [startX, startY] = this.start;
    const duration = Date.now() - this.startMillis;
    const isTap = Math.abs(startX - end[0]) < 2 && Math.abs(startY - end[1]) < 2;
    this.remoteChat.sendData(isTap ? `tap,${startX},${startY},${duration}` : `swipe,${startX},${startY},${end[0]},${end[1]},${duration}`);
    this.inProcess = false;
  }

  // A finger or the mouse touches the video; a second finger cancels the phone gesture so the page can scroll.
  onDown(ev) {
    this.fingers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (this.fingers.size > 1) {
      this.inProcess = false;
      return;
    }
    if (ev.button !== 0) return;
    ev.target.setPointerCapture(ev.pointerId);
    this.begin(...videoPoint(ev));
  }

  // While two fingers are down, moves this web page by how far the fingers travelled together.
  onMove(ev) {
    const last = this.fingers.get(ev.pointerId);
    if (!last) return;
    this.fingers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (this.fingers.size < 2) return;
    window.scrollBy((last[0] - ev.clientX) / this.fingers.size, (last[1] - ev.clientY) / this.fingers.size);
  }

  // A finger or the mouse leaves the video (or the touch was cancelled); only a lone finger sends a gesture.
  onUp(ev) {
    const wasAlone = this.fingers.size === 1;
    this.fingers.delete(ev.pointerId);
    if (wasAlone) this.finish(...videoPoint(ev));
  }
}
