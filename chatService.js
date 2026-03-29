function parseMessage(message) {
  message = message.toLowerCase();

  if (message.includes("book fast")) {
    return { intent: "book_parallel", entities: {} };
  }

  if (message.includes("book")) {
    return { intent: "book_now", entities: {} };
  }

  if (message.includes("watch")) {
    return { intent: "watch", entities: {} };
  }

  if (message.includes("schedule")) {
    return { intent: "schedule", entities: {} };
  }

  if (message.includes("stop")) {
    return { intent: "stop", entities: {} };
  }

  return { intent: "unknown", entities: {} };
}

function buildPreferences(entities) {
  return {
    eventName: "RCB Match",
    tickets: 2
  };
}

function getHelpText() {
  return "Commands: book ticket, book fast, watch tickets, schedule at time";
}

module.exports = {
  parseMessage,
  buildPreferences,
  getHelpText
};