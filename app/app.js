import { Component, mount, onMounted, useEffect, useRef, useState } from "@base/owl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Input,
  Label,
  Toast,
} from "@base/component";
import { state, ui } from "./js/store.js";
import { RemoteSession } from "./js/remote-session.js";

// Registers the offline service worker so the app keeps working without a network connection.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.error("Service worker registration failed", error));
  });
}

// One corner message (error, warning); it opens itself on arrival and removes itself when it fades out.
class Notice extends Component {
  static template = "app.Notice";
  static components = { Toast };
  static props = ["notice"];

  setup() {
    this.state = useState({ open: false });
    onMounted(() => {
      this.state.open = true;
    });
  }

  // Follows the toast opening or closing; a closed toast is dropped from the screen.
  onOpenChange(open) {
    this.state.open = open;
    if (!open) ui.dismissNotice(this.props.notice.id);
  }
}

// The whole screen: login form, device window with controls, hidden debug panel, dialogs and messages.
class Root extends Component {
  static template = "app.Root";
  static components = { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Badge, Button, Card, CardFooter, CardHeader, Input, Label, Notice };

  setup() {
    this.ui = ui;
    this.state = useState(state);
    this.videoRef = useRef("video");
    this.chatRef = useRef("chat");
    useEffect(
      () => this.scrollChatToEnd(),
      () => [state.messages.length]
    );
    onMounted(() => {
      this.session = new RemoteSession(this.videoRef.el);
      this.session.start();
    });
  }

  // Keeps the newest chat line in view; returns nothing because useEffect would treat a result as cleanup code.
  scrollChatToEnd() {
    const el = this.chatRef.el;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // Stores a login field, cutting it to the allowed length.
  onLimitedInput(key, max, value, ev) {
    ev.target.value = value.slice(0, max);
    state[key] = ev.target.value;
  }

  // Connects to the phone when the login form is submitted.
  onLogin() {
    this.session.login(state.sessionId, state.pin);
  }

  // Sends the typed chat message to the phone.
  onChatSubmit() {
    this.session.chat.sendData(state.chatInput);
  }

  // Sends a remote-control command (back, home, recents, notifications) to the phone.
  sendCommand(command) {
    this.session.chat.sendData(command);
  }

  // Disconnects from the phone.
  disconnect() {
    ui.emit("Session.Disconnect");
  }

  // The video started playing.
  onPlaying() {
    this.session.video.onPlaying();
  }

  // Finger or mouse pressed on the video overlay.
  onGestureDown(ev) {
    this.session.gestures.onDown(ev);
  }

  // Finger or mouse released (or the touch was cancelled) on the video overlay.
  onGestureUp(ev) {
    this.session.gestures.onUp(ev);
  }

  // Finger or mouse moved over the video overlay (two fingers scroll the page).
  onGestureMove(ev) {
    this.session.gestures.onMove(ev);
  }

  // Closes the debug panel.
  closeDebug() {
    this.session.debugUtils.disable();
  }

  // Follows the error dialog being dismissed.
  onDialogOpenChange(open) {
    if (!open) ui.closeDialog();
  }
}

// Removes the outer <templates> tag so two template files can be merged under a single root.
const stripTemplatesWrapper = (xml) => xml.replace(/^\s*<templates[^>]*>/, "").replace(/<\/templates>\s*$/, "");

const [baseuiTemplates, appTemplates] = await Promise.all([
  fetch(import.meta.resolve("@base/templates")).then((r) => r.text()),
  fetch(new URL("./app.xml", import.meta.url)).then((r) => r.text()),
]);
const templates = `<templates>${stripTemplatesWrapper(baseuiTemplates)}${stripTemplatesWrapper(appTemplates)}</templates>`;
await mount(Root, document.getElementById("app"), { templates });
