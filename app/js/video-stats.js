import { state } from "./store.js";

// Shows the live bitrate and resolution of the phone's screen stream in the debug panel.
export class VideoStats {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.streaming = null;
    this.interval = null;
  }

  // Remembers the Janus streaming plugin, which reports the bitrate.
  setStreamingPluginHandle(streaming) {
    this.streaming = streaming;
  }

  // Starts refreshing the numbers twice a second.
  start() {
    this.stop();
    this.interval = setInterval(() => this.refresh(), 500);
    console.debug("VideoStats: started");
  }

  // Reads the current bitrate and video size into the shared state.
  refresh() {
    state.bitrate = this.streaming.getBitrate();
    const { videoWidth, videoHeight } = this.videoEl;
    if (videoWidth > 0 && videoHeight > 0) state.resolution = `${videoWidth}x${videoHeight}`;
    state.statsVisible = true;
  }

  // Stops refreshing and hides the numbers.
  stop() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
    state.statsVisible = false;
    console.debug("VideoStats: stopped");
  }
}
