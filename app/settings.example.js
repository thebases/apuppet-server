// Copy to settings.js and fill in. The deploy (deploy/templates/web-admin/settings.js.j2) generates the real one.
var opaqueId = Janus.randomString(12);
var streamingOpaqueId = "streaming-" + opaqueId;
var textroomOpaqueId = "textroom-" + opaqueId;

var apiSecret = "change-me";
var janusDebugLevel = "all"; // or ["warn", "error"]
var janusServers = ["https://webrtc.thebase.vn/janus"];
