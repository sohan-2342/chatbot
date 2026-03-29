const express = require('express');
const router = express.Router();

const runBots = require('../automation/parallelRunner');

router.post('/book', (req, res) => {
  console.log("📩 API HIT: /api/book");

  runBots(); // start bot system

  res.send("🚀 Bots started");
});

module.exports = router;