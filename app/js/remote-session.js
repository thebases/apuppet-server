import { state, ui } from "./store.js";
import { reloadPage } from "./utils.js";
import { RemoteChat } from "./remote-chat.js";
import { RemoteVideo } from "./remote-video.js";
import { VideoStats } from "./video-stats.js";
import { Commands } from "./commands.js";
import { GestureBuilder } from "./gesture-builder.js";
import { SessionMonitoring } from "./session-monitoring.js";
import { CheatCodes } from "./cheat-codes.js";
import { DebugUtils } from "./debug-utils.js";
import { activeConfig } from "./janus-config.js";

// Logs ICE/WebRTC state changes and slow links of one Janus plugin, and warns the user about a slow link.
function connectionLogging(plugin, title) {
  return {
    iceState: (state) => (["failed", "disconnected", "closed"].includes(state) ? console.error : console.debug)(`${plugin}: ICE state`, state),
    webrtcState: (up, reason) => (up ? console.info : console.warn)(`${plugin}: WebRTC connection ${up ? "up" : "down"}`, reason ?? ""),
    slowLink: (uplink, lost, mid) => {
      console.warn(`${plugin}: slow link`, { uplink, lost, mid });
      ui.showWarning("Network problems", title, 2000);
    },
  };
}

// Ties the Janus server, the chat, the video and the controls together for one remote-control session.
// The Janus server and secret come from janus-config.js; the debug level and opaque ids from settings.js.
export class RemoteSession {
  constructor(videoEl) {
    this.chat = new RemoteChat();
    this.videoStats = new VideoStats(videoEl);
    this.video = new RemoteVideo(videoEl, ui.videoLoader, this.videoStats);
    this.chat.setCommands(new Commands(this.video));
    this.gestures = new GestureBuilder(this.chat);
    this.monitoring = new SessionMonitoring(this.chat);
    this.cheatCodes = new CheatCodes();
    this.debugUtils = new DebugUtils(this.chat);
    this.janus = null;
    this.textroom = null;
    this.streaming = null;

    window.debugUtils = this.debugUtils;
    ui.on("CheatCodes.onCheatEntered", this.onCheat, this);
    ui.on("Session.Disconnect", this.onDisconnect, this);
  }

  // Checks WebRTC support, then connects to the Janus server.
  start() {
    if (!Janus.isWebrtcSupported()) {
      ui.showErrorModal("There is no WebRTC support in this browser. Please, try the newest version of Google Chrome or Mozilla Firefox", "no_webrtc_support", reloadPage);
      console.error("No WebRTC support - no cartoons");
      return;
    }
    ui.initStart();
    const config = activeConfig();
    if (config.servers.length === 0) {
      ui.pageLoader.hide();
      ui.openJanusDialog("No Janus server is configured. Enter one to continue.");
      return;
    }
    console.debug("actual Janus servers:", config.servers);
    Janus.init({ debug: window.janusDebugLevel, callback: () => this.connectJanus(config) });
  }

  // Opens the Janus session and attaches both plugins once it is up.
  connectJanus(config) {
    this.janus = new Janus({
      server: config.servers,
      apisecret: config.apiSecret,
      success: () => {
        this.attachTextroom();
        this.attachStreaming();
      },
      error: (error) => {
        console.error("janus: session error", error);
        ui.pageLoader.hide();
        ui.openJanusDialog(`Could not connect to the Janus server: ${error}`);
      },
      destroyed: () => {
        console.error("janus: session destroyed");
        ui.sessionClosedRemotely("Session has been destroyed");
      },
    });
  }

  // Attaches the textroom plugin, which carries chat and commands.
  attachTextroom() {
    this.janus.attach({
      plugin: "janus.plugin.textroom",
      opaqueId: window.textroomOpaqueId,
      success: (handle) => this.onTextroomAttached(handle),
      error: (error) => {
        console.error("textroom: error attaching plugin: ", error);
        ui.alert(`Ошибка подключения к сессии: ${error}`);
      },
      ...connectionLogging("textroom", "Device management"),
      onmessage: (msg, jsep) => this.onTextroomMessage(msg, jsep),
      ondataopen: (data) => console.debug("textroom: DataChannel is available", data),
      ondata: (rawData) => this.onTextroomData(rawData),
      oncleanup: () => {
        console.info("textroom: got cleanup");
        this.chat.cleanup();
      },
    });
  }

  // Attaches the streaming plugin, which carries the phone's screen video.
  attachStreaming() {
    this.janus.attach({
      plugin: "janus.plugin.streaming",
      opaqueId: window.streamingOpaqueId,
      success: (handle) => this.onStreamingAttached(handle),
      error: (error) => {
        console.error("streaming: error attaching plugin", error);
        ui.showError(`Streaming error: ${error}`, "streaming_error");
      },
      ...connectionLogging("streaming", "Screen sharing"),
      onmessage: (msg, jsep) => this.onStreamingMessage(msg, jsep),
      onremotestream: (stream) => {
        console.info("streaming: got remote stream", stream);
        this.video.setStream(stream);
      },
      oncleanup: () => {
        console.info("streaming: got cleanup");
        this.video.cleanup();
      },
    });
  }

  // The textroom plugin is ready: prepare the chat.
  onTextroomAttached(handle) {
    this.textroom = handle;
    console.info(`textroom: plugin attached! (${handle.getPlugin()}, id=${handle.getId()})`);
    this.chat.setUp(handle);
    ui.initReady("textroom");
  }

  // The streaming plugin is ready: prepare the video.
  onStreamingAttached(handle) {
    this.streaming = handle;
    console.info(`streaming: plugin attached! (${handle.getPlugin()}, id=${handle.getId()})`);
    this.video.setStreamingPluginHandle(handle);
    this.videoStats.setStreamingPluginHandle(handle);
    ui.initReady("streaming");
  }

  // Shows textroom errors and answers the server's connection offer.
  onTextroomMessage(msg, jsep) {
    console.debug("textroom: got a message ", msg);
    if (msg.error) {
      console.error("textroom: onmessage got error", msg);
      ui.alert(msg.error);
    }
    if (!jsep) return;
    this.textroom.createAnswer({
      jsep,
      media: { audio: false, video: false, data: true },
      success: (answer) => this.textroom.send({ message: { request: "ack" }, jsep: answer }),
      error: (error) => this.onWebrtcError(error),
    });
  }

  // Routes data from the chat channel: answers to our requests first, then room events.
  onTextroomData(rawData) {
    console.debug("textroom: got data from DataChannel", rawData);
    const data = JSON.parse(rawData);
    if (this.chat.processTransactionAnswer(data.transaction, data)) return;

    switch (data.textroom) {
      case "message":
        this.chat.processIncomingMessage(data.text, data.from, data.date, data.whisper);
        break;
      case "announcement":
        this.chat.processAnnouncement(data.text, data.date);
        break;
      case "join":
        this.chat.processJoin(data.username, data.display);
        break;
      case "leave":
        this.chat.processLeave(data.username);
        break;
      case "kicked":
        this.chat.processKick(data.username);
        break;
      case "destroyed":
        this.chat.processRoomDestroy(data.room);
        break;
    }
  }

  // Tracks the video stream's status, reports its errors and answers the server's video offer.
  onStreamingMessage(msg, jsep) {
    console.debug("streaming: got a message", msg, jsep);
    if (msg.result) {
      this.onStreamingStatus(msg.result.status);
      ui.connReady("streaming");
    } else if (msg.error) {
      console.error("streaming: onmessage error", msg.error);
      ui.connAbort();
      if (msg.error_code === 455) {
        ui.showError(`Session ${this.video.mountpointId} does not exist`, "no_session");
      } else {
        ui.showError(msg.error, "streaming_message_error");
        this.video.stopStreaming();
      }
      return;
    }
    if (jsep) this.answerStreamingOffer(jsep);
  }

  // Shows the stream's status in the debug panel; a stopped stream is torn down.
  onStreamingStatus(status) {
    if (status === "starting") state.status = "Starting, please wait...";
    else if (status === "started") state.status = "Started";
    else if (status === "stopped") this.video.stopStreaming();
  }

  // Answers the server's video offer, asking for receive-only audio/video and the data channel.
  answerStreamingOffer(jsep) {
    const stereo = jsep.sdp.includes("stereo=1");
    this.streaming.createAnswer({
      jsep,
      media: { audioSend: false, videoSend: false, data: true },
      customizeSdp: (answer) => {
        if (stereo && !answer.sdp.includes("stereo=1")) answer.sdp = answer.sdp.replace("useinbandfec=1", "useinbandfec=1;stereo=1");
      },
      success: (answer) => this.streaming.send({ message: { request: "start" }, jsep: answer }),
      error: (error) => this.onWebrtcError(error),
    });
  }

  // Tells the user that setting up the WebRTC connection failed.
  onWebrtcError(error) {
    console.error("WebRTC error", error);
    ui.showError(`WebRTC error: ${JSON.stringify(error)}`, "webrtc_error");
  }

  // Connects to the phone with the session ID and password from the login form (the room and mountpoint ID are sent as an integer).
  login(sessionId, pin) {
    const id = Number.parseInt(sessionId, 10);
    if (Number.isNaN(id)) {
      ui.showError("Session ID must be a number", "invalid_session_id");
      return;
    }
    ui.connStart();
    this.video.startStreamMountpoint(id, pin);
    this.chat.startRoom(id, pin);
  }

  // Opens the debug panel when the secret word is typed.
  onCheat(cheat) {
    if (cheat === "needtodebug") this.debugUtils.enable();
  }

  // Stops the stream, leaves the chat room and shows the "Disconnected" dialog.
  onDisconnect() {
    this.video.stopStreaming();
    this.chat.leaveRoom();
    ui.disconnect();
  }
}
