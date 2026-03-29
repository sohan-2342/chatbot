const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { chromium } = require("playwright");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static("public"));

// 🔥 Broadcast logs to frontend
function broadcast(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// 🔥 START BOT (REAL SCRAPER)
app.post("/api/start", async (req, res) => {
  try {
    broadcast("🚀 Starting bot...");

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

   await page.goto("https://shop.royalchallengers.com/ticket", {
  waitUntil: "domcontentloaded"
});
    broadcast("🌐 Opened BookMyShow");

    await page.waitForTimeout(3000);

    // open search
    await page.keyboard.press("Slash");
    await page.waitForTimeout(1000);

    await page.keyboard.type("RCB");
    await page.waitForTimeout(2000);

    broadcast("🔍 Searching RCB matches...");

    // extract RCB-related text
    const results = await page.$$eval("a", els =>
      els
        .map(el => el.innerText)
        .filter(t => t && t.toLowerCase().includes("rcb"))
        .slice(0, 5)
    );

    if (results.length === 0) {
      broadcast("❌ No RCB matches found");
    } else {
      results.forEach(r => broadcast("🏏 " + r));
    }

    broadcast("⏳ Checking ticket availability...");
    await page.waitForTimeout(3000);

    const html = await page.content();

    if (html.includes("Book")) {
      broadcast("🔥 Tickets might be LIVE!");
    } else if (html.includes("Sold Out")) {
      broadcast("❌ Tickets Sold Out");
    } else {
      broadcast("⌛ Tickets not released yet");
    }

    res.send("Bot started");

  } catch (err) {
    console.error(err);
    broadcast("❌ Error: " + err.message);
    res.status(500).send("Error");
  }
});

// 🔥 STOP BOT
app.post("/api/stop", (req, res) => {
  broadcast("🛑 Bot stopped");
  res.send("Stopped");
});

// 🔥 WebSocket connection
wss.on("connection", () => {
  console.log("Frontend connected");
});

// 🔥 Serve frontend
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// 🔥 Start server
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});