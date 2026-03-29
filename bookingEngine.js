const { chromium } = require('playwright');
const { broadcast } = require('../utils/broadcast');

async function runBooking() {

  broadcast("🚀 Bot started");

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // ✅ REAL RCB WEBSITE
  await page.goto("https://shop.royalchallengers.com/ticket");

  broadcast("🌐 Opened RCB ticket page");

  // 🔥 WAIT FOR BUY BUTTON (ULTRA FAST)
  try {
    broadcast("⏳ Waiting for tickets...");

    await page.waitForSelector('text=Buy Tickets', { timeout: 0 });

    broadcast("🎟️ Tickets LIVE!");

    await page.click('text=Buy Tickets');

  } catch (err) {
    broadcast("❌ Buy button not found");
    return;
  }

  // 🟡 QUEUE HANDLING
  if (await page.$('text=Queue')) {
    broadcast("⏳ Queue detected... waiting");

    await page.waitForSelector('text=Buy Tickets', { timeout: 0 });
  }

  // 💺 SEAT SELECTION (SMART)
  try {
    const options = await page.$$('select option');

    let best = 0;

    for (let i = 0; i < options.length; i++) {
      const text = await options[i].innerText();

      if (text.includes("Premium") || text.includes("₹")) {
        best = i;
      }
    }

    await page.selectOption('select', { index: best });

    broadcast("🎯 Best seat selected");

  } catch (err) {
    broadcast("⚠️ Seat selection failed");
  }

  // 💳 FINAL STEP
  broadcast("💳 Reach payment page manually");

}

module.exports = runBooking;