const { runBooking } = require('./bookingEngine');

let intervalId = null;

function startPolling() {
  console.log("[WATCHER] Watching tickets...");

  intervalId = setInterval(async () => {
    console.log("[CHECK] Checking...");

    const available = Math.random() > 0.8;

    if (available) {
      console.log("[DETECTED] Tickets released!");

      clearInterval(intervalId);

      await runBooking({ eventName: "RCB Match" });
    }

  }, 2000);
}

function stopPolling() {
  if (intervalId) {
    clearInterval(intervalId);
  }
}

module.exports = { startPolling, stopPolling };