import { ui } from "./store.js";

const QUOTE_CHARS = "\"'";

// Splits a comma-separated command into parts, keeping commas that sit inside quotes.
export function splitCSV(string) {
  const parts = [];
  let block = "";
  let blockEnded = false;
  let quoted = false;
  let quote = "";

  for (const char of string) {
    if (char === ",") {
      if (quoted && !blockEnded) {
        block += char;
        continue;
      }
      parts.push(block);
      block = "";
      blockEnded = false;
      quoted = false;
    } else if (QUOTE_CHARS.includes(char)) {
      if (!quoted) {
        if (block.trim() === "") block = "";
        quoted = true;
        quote = char;
      } else if (char === quote) {
        blockEnded = true;
      } else {
        block += char;
      }
    } else if (!blockEnded) {
      block += char;
    }
  }
  parts.push(block);
  return parts;
}

// Understands the few commands the phone sends back through the chat (resolution, pong).
export class Commands {
  constructor(remoteVideo) {
    this.handlers = new Map([
      ["streamingVideoResolution", (w, h) => remoteVideo.setResolution(w, h)],
      ["pong", (timestamp) => ui.emit("SessionMonitoring.onPong", timestamp)],
    ]);
  }

  // Runs the command in a chat message if it is one; ordinary messages are ignored.
  process(message) {
    const [command, ...args] = splitCSV(message);
    const handler = this.handlers.get(command);
    if (!handler) {
      console.debug(`Commands: skip regular message "${message}"`);
      return;
    }
    console.info(`Commands: get command "${command}" with args ${args}`);
    handler(...args);
  }
}
