import { state } from "./store.js";

// Plays the phone's screen stream in the <video> element and controls the streaming plugin.
export class RemoteVideo {
  constructor(videoEl, videoLoader, videoStats) {
    this.videoEl = videoEl;
    this.videoLoader = videoLoader;
    this.videoStats = videoStats;
    this.streaming = null;
    this.stream = null;
    this.mountpointId = null;
    this.isVideoAlreadyPlayed = false;
  }

  // Lists the video tracks of the current stream (none before the stream arrives).
  videoTracks() {
    return this.stream ? this.stream.getVideoTracks() : [];
  }

  // Shows the "waiting for video" animation, except when a stream already played and debug is off.
  noRemoteVideo() {
    if (!this.isVideoAlreadyPlayed || state.debug) this.videoLoader.show();
    console.debug("video: no remote");
  }

  // Hides the "waiting for video" animation.
  hasRemoteVideo() {
    this.videoLoader.hide();
    console.debug("video: has remote");
  }

  // Remembers the Janus streaming plugin used to watch and stop the stream.
  setStreamingPluginHandle(streaming) {
    this.streaming = streaming;
  }

  // Resizes the video box to the phone's screen size.
  setResolution(width, height) {
    state.videoWidth = width;
    state.videoHeight = height;
  }

  // Attaches a new remote stream to the video element and starts the stats, or waits if it has no video.
  setStream(stream) {
    const streamChanged = this.stream !== stream;
    this.stream = stream;

    if (this.videoTracks().length === 0) {
      this.noRemoteVideo();
      this.videoStats.stop();
      return;
    }
    if (streamChanged) Janus.attachMediaStream(this.videoEl, this.stream);
    this.hasRemoteVideo();
    if (["chrome", "firefox", "safari"].includes(Janus.webRTCAdapter.browserDetails.browser)) this.videoStats.start();
  }

  // Asks the server to send the screen stream of this session.
  startStreamMountpoint(mountpointId, pin) {
    this.mountpointId = mountpointId;
    console.info(`streaming: starting mountpoint id ${mountpointId}`);
    this.streaming.send({ message: { request: "watch", id: mountpointId, pin } });
    this.noRemoteVideo();
  }

  // Reacts to the video starting to play: syncs the box size and starts the stats.
  onPlaying() {
    if (this.videoTracks().length === 0) {
      this.videoStats.stop();
      return;
    }
    this.videoStats.start();
    this.setResolution(this.videoEl.videoWidth, this.videoEl.videoHeight);
    this.isVideoAlreadyPlayed = true;
  }

  // Tells the server to stop sending video and cleans up locally.
  stopStreaming() {
    console.info("video: stopping streaming");
    this.streaming.send({ message: { request: "stop" } });
    this.streaming.hangup();
    this.cleanup();
  }

  // Stops the stats display when the stream goes away.
  cleanup() {
    console.info("video: cleanup ..");
    this.videoStats.stop();
  }
}
