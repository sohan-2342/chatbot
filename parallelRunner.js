const runBooking = require('./bookingEngine');

async function runBots() {
  console.log("🤖 Starting multiple bots...");

  await Promise.all([
    runBooking(),
    runBooking(),
    runBooking()
  ]);
}

module.exports = runBots;