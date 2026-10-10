import { state, ui } from "./store.js";
import { getDateString } from "./utils.js";

// The text channel to the phone: joins the session's chat room and sends/receives commands and messages.
export class RemoteChat {
  constructor() {
    this.textroom = null;
    this.commands = null;
    this.transactions = {};
    this.participants = new Map();
    this.sessionId = "";
    this.pin = "";
    this.userId = "";
  }

  // Remembers the helper that understands the phone's commands.
  setCommands(commands) {
    this.commands = commands;
  }

  // Sends a request through the textroom data channel and remembers who to call with the answer.
  startTransaction(data, callback, errorCallback) {
    const transactionId = Janus.randomString(12);
    console.debug("chat: transaction start", transactionId, data);

    data.transaction = transactionId;
    this.transactions[transactionId] = callback;

    this.textroom.data({
      text: JSON.stringify(data),
      error: (reason) => {
        console.error("chat: transaction send data error", reason);
        ui.alert(reason);
        errorCallback?.(reason);
      },
    });
    return transactionId;
  }

  // Hands a server answer to the request it belongs to; returns false for unrelated data.
  processTransactionAnswer(transactionId, data) {
    const callback = this.transactions[transactionId];
    if (!callback) return false;
    console.debug("chat: transaction answered", transactionId, data);
    delete this.transactions[transactionId];
    return callback(data) ?? true;
  }

  // Locks the message box and Send button while a request is in flight.
  disableAllChatControls() {
    state.chatEnabled = false;
  }

  // Unlocks the message box and Send button.
  enableAllChatControls() {
    state.chatEnabled = true;
    state.chatSized = true;
  }

  // Tells the textroom plugin to prepare its data channel.
  setUp(textroom) {
    this.textroom = textroom;
    console.info("chat: set up ..");
    this.textroom.send({ message: { request: "setup" } });
  }

  // Joins the chat room that belongs to the session ID.
  startRoom(sessionId, pin) {
    this.sessionId = sessionId;
    this.pin = pin;
    this.userId = `admin:${sessionId}`;
    this.registerUserAndJoinRoom();
  }

  // Leaves the room and closes the data channel.
  leaveRoom() {
    this.disableAllChatControls();
    const leaveData = { textroom: "leave", room: this.sessionId };
    console.debug("chat: leaving room", leaveData);
    this.startTransaction(leaveData, () => this.textroom.hangup());
  }

  // Joins the session's chat room with the session ID and password.
  registerUserAndJoinRoom() {
    this.disableAllChatControls();
    const registerData = {
      textroom: "join",
      room: this.sessionId,
      pin: this.pin,
      username: this.userId,
      display: this.userId,
    };
    console.debug("chat: join room & register user", { ...registerData, pin: "***" });
    this.startTransaction(
      registerData,
      (response) => this.onJoinAnswer(response),
      (reason) => this.onJoinFailed(reason)
    );
  }

  // Handles the server's reply to joining: shows the error, or finds the phone and finishes connecting.
  onJoinAnswer(response) {
    if (response.textroom === "error") {
      ui.connAbort();
      if (response.error_code === 417) ui.showError(`Session ${this.sessionId} does not exist`, "no_session");
      else ui.showError(response.error, "transaction_error");
      return;
    }
    console.debug("chat: we are in the room!");

    const device = this.findDevice(response.participants);
    if (device) ui.setDevice(...device);
    else console.error("chat: can not determine device from participants");

    this.enableAllChatControls();
    ui.connReady("textroom");
    ui.emit("RemoteChat.onManagementStart");
  }

  // Handles a failed join request.
  onJoinFailed(reason) {
    ui.connAbort();
    this.disableAllChatControls();
    console.error("chat: joining room error", reason);
    ui.showError(reason, "join_error");
  }

  // Records who is already in the room and picks out the phone ("device:..." or the only other member).
  findDevice(participants = []) {
    let device = null;
    for (const participant of participants) {
      const name = participant.display || participant.username;
      this.participants.set(participant.username, name);
      if (name !== this.userId) this.addMessage(`${name} already in room`, { italic: true });

      if (participant.username.substring(0, 7).toLowerCase() !== "device:") continue;
      if (device) console.warn("chat: it seems the room has more than one device!");
      else device = [participant.username, name];
    }
    return device ?? (this.participants.size === 1 ? [...this.participants][0] : null);
  }

  // Sends a chat message or command to the phone; the box is locked until the server confirms.
  sendData(data) {
    if (!data) return;
    const messageData = { textroom: "message", room: this.sessionId, text: data };
    console.debug("textroom: sending chat message", messageData);

    this.disableAllChatControls();
    this.startTransaction(
      messageData,
      () => {
        state.chatInput = "";
        this.enableAllChatControls();
      },
      (reason) => {
        console.error("textroom: sending chat message error", reason);
        ui.showError(reason, "textroom_send_error");
      }
    );
  }

  // Locks the chat and announces that phone management stopped.
  cleanup() {
    console.debug("chat: cleanup");
    this.disableAllChatControls();
    ui.emit("RemoteChat.onManagementStop");
  }

  // Handles a message from the phone: runs it if it is a command, then shows it in the chat log.
  processIncomingMessage(message, from, date, isWhisper) {
    console.debug("chat: incoming message", message, from, date, isWhisper);
    this.commands?.process(message);
    this.addMessage(message, {
      color: isWhisper ? "gray" : "black",
      lead: isWhisper ? `[hidden message from ${from}]:` : `${from}:`,
      date,
    });
  }

  // Shows a room announcement in the chat log.
  processAnnouncement(message, date) {
    console.debug("chat: announcement", message, date);
    this.addMessage(message, { color: "purple", italic: true, date });
  }

  // Notes that somebody joined the room.
  processJoin(userId, userName) {
    console.debug("chat: user joined", userId, userName);
    this.participants.set(userId, userName || userId);
    this.addMessage(`${this.participants.get(userId)} joined`, { color: "green", italic: true });
  }

  // Notes that somebody left; if it was the phone, the session is over.
  processLeave(userId) {
    console.debug("chat: user leaved", userId);
    this.addMessage(`${this.participants.get(userId)} leaved`, { color: "green", italic: true });
    this.participants.delete(userId);
    if (userId === ui.deviceId) ui.sessionClosedRemotely("Device left the session");
  }

  // Notes that somebody was kicked out; if it was us, the session is over.
  processKick(userId) {
    console.debug("chat: user kicked", userId);
    this.addMessage(`${this.participants.get(userId)} kicked`, { color: "red", italic: true });
    this.participants.delete(userId);
    if (userId === this.userId) ui.sessionClosedRemotely("You has been kicked from session");
  }

  // Ends the session when the server closes this chat room.
  processRoomDestroy(roomId) {
    if (roomId !== this.sessionId) return;
    console.debug("chat: current room has been destroyed", roomId);
    this.addMessage(`Session ${this.sessionId} has been closed`, { bold: true });
    ui.sessionClosedRemotely("Session has been closed");
  }

  // Adds one timestamped line to the chat log.
  addMessage(text, { color, lead, italic, bold, date } = {}) {
    state.messages.push({ time: getDateString(date), color, lead, text, italic, bold });
  }
}
