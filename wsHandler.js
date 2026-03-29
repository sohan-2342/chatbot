/**
 * api/wsHandler.js
 * ─────────────────────────────────────────────────────────────────
 * WebSocket Handler — Real-time bidirectional communication
 *
 * Every message from the frontend gets:
 *   1. Parsed for intent + entities
 *   2. An ackId assigned immediately
 *   3. ACK: ACCEPTED sent back right away
 *   4. Operation runs async
 *   5. ACK: RUNNING / SUCCESS / FAILED broadcast as it progresses
 *
 * Message protocol (client → server):
 *   { type: 'command', message: 'book ticket', requestId: 'optional-client-id' }
 *
 * Message protocol (server → client):
 *   { type: 'ack', ackId, status, message, result?, error?, progress? }
 *   { type: 'system', message }
 *   { type: 'broadcast', message }   ← sent to ALL clients
 * ─────────────────────────────────────────────────────────────────
 */

const WebSocket = require('ws');

const ack            = require('../utils/ackManager');
const logger         = require('../utils/logger');
const storage        = require('../utils/storage');
const config         = require('../config');
const { parseMessage, buildPreferences, getHelpText } = require('../chat/chatService');
const { runBooking }           = require('../automation/bookingEngine');
const { runWithFailover }      = require('../automation/parallelRunner');
const { startPolling, stopPolling } = require('../automation/availabilityPoller');
const schedulerService         = require('../scheduler/schedulerService');

// Connected client registry — maps ws → { id, connectedAt }
const clients = new Map();
let clientCounter = 0;

// ── Setup WebSocket server ──────────────────────────────────────────────────
function setupWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    const clientId = `client_${++clientCounter}`;
    clients.set(ws, { id: clientId, connectedAt: Date.now() });

    logger.info(`[WS] ${clientId} connected. Total: ${clients.size}`);

    // Send connection confirmation with client ID
    send(ws, {
      type:      'connected',
      clientId,
      message:   'Connected to Ticket Bot. Type a command to begin.',
      commands:  ['book ticket', 'book fast', 'watch for tickets', 'schedule at 10:00 AM', 'history', 'help'],
      timestamp: new Date().toISOString(),
    });

    // ── Incoming messages ─────────────────────────────────────────────────
    ws.on('message', async (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { message: String(raw) };
      }

      const userMessage = payload.message || payload.text || '';
      const requestId   = payload.requestId || null; // optional client-side correlation ID

      if (!userMessage.trim()) return;

      logger.info(`[WS] ${clientId}: "${userMessage}"`);

      // Send echo so frontend can show the message immediately
      send(ws, { type: 'echo', message: userMessage, requestId });

      // Parse and dispatch
      await dispatch(ws, userMessage.trim(), requestId, clientId);
    });

    ws.on('close', () => {
      clients.delete(ws);
      logger.info(`[WS] ${clientId} disconnected. Total: ${clients.size}`);
    });

    ws.on('error', (err) => {
      logger.error(`[WS] ${clientId} error: ${err.message}`);
      clients.delete(ws);
    });
  });
}

// ── Command dispatcher ──────────────────────────────────────────────────────
async function dispatch(ws, message, requestId, clientId) {
  const { intent, entities } = parseMessage(message);
  const prefs = buildPreferences(entities);

  logger.info(`[WS] Intent: ${intent} | Entities: ${JSON.stringify(entities)}`);

  switch (intent) {

    // ── BOOK NOW ────────────────────────────────────────────────────────────
    case 'book_now': {
      const ackId = ack.create('book', { prefs, clientId });

      // Immediate ACK
      send(ws, { type: 'ack', ackId, status: ack.STATUS.ACCEPTED, requestId,
        message: `Booking accepted for "${prefs.eventName}"` });

      // Async execution
      setImmediate(async () => {
        try {
          sendAck(ws, ackId, ack.STATUS.RUNNING, {
            message: 'Launching browser session...', progress: 10 });

          const result = await runBooking(prefs);

          if (result.success) {
            sendAck(ws, ackId, ack.STATUS.SUCCESS, {
              message:  `Booked! Confirmation: ${result.confirmationNumber}`,
              result,
              progress: 100,
            });
          } else {
            sendAck(ws, ackId, ack.STATUS.FAILED, {
              message:  `Failed: ${result.error}`,
              error:    result.error,
              result,
              progress: 100,
            });
          }
        } catch (err) {
          sendAck(ws, ackId, ack.STATUS.FAILED, {
            message: err.message, error: err.message, progress: 100 });
        }
      });
      break;
    }

    // ── PARALLEL BOOKING ────────────────────────────────────────────────────
    case 'book_parallel': {
      const sessionCount = entities.sessionCount || config.parallelSessions;
      const ackId = ack.create('parallel_book', { prefs, sessionCount, clientId });

      send(ws, { type: 'ack', ackId, status: ack.STATUS.ACCEPTED, requestId,
        message: `Parallel booking accepted — ${sessionCount} sessions` });

      setImmediate(async () => {
        try {
          sendAck(ws, ackId, ack.STATUS.RUNNING, {
            message:  `Racing ${sessionCount} sessions simultaneously...`,
            progress: 5,
          });

          const summary = await runWithFailover(prefs, sessionCount);

          if (summary.successful > 0) {
            sendAck(ws, ackId, ack.STATUS.SUCCESS, {
              message:  `${summary.successful}/${sessionCount} sessions succeeded!`,
              result:   summary,
              progress: 100,
            });
          } else {
            sendAck(ws, ackId, ack.STATUS.FAILED, {
              message:  `All ${sessionCount} sessions failed`,
              error:    'All sessions exhausted',
              result:   summary,
              progress: 100,
            });
          }
        } catch (err) {
          sendAck(ws, ackId, ack.STATUS.FAILED, {
            message: err.message, error: err.message, progress: 100 });
        }
      });
      break;
    }

    // ── SCHEDULE ────────────────────────────────────────────────────────────
    case 'schedule': {
      const ackId = ack.create('schedule', { prefs, clientId });

      try {
        let cronExpr = entities.cronExpression || timeToCron(entities.timeText);
        if (!cronExpr) {
          send(ws, { type: 'error', ackId, requestId,
            message: 'Please specify a time, e.g. "schedule at 10:30 AM"' });
          break;
        }

        const job = schedulerService.addJob(cronExpr, prefs);

        sendAck(ws, ackId, ack.STATUS.SUCCESS, {
          message: `Scheduled at ${cronExpr} — Job ID: ${job.id}`,
          result:  job,
        });
      } catch (err) {
        sendAck(ws, ackId, ack.STATUS.FAILED, {
          message: err.message, error: err.message });
      }
      break;
    }

    // ── WATCH / POLL ─────────────────────────────────────────────────────────
    case 'watch': {
      const ackId = ack.create('poll', { prefs, clientId });

      sendAck(ws, ackId, ack.STATUS.RUNNING, {
        message: `Monitoring ${config.site.url} every ${config.pollInterval}ms...`,
        progress: 0,
      });

      send(ws, { type: 'info', requestId,
        message: `Watching for ticket availability. Send "stop" to cancel.` });

      startPolling({
        url:        config.site.url,
        intervalMs: config.pollInterval,
        onAvailable: async ({ elapsed, checkCount }) => {
          sendAck(ws, ackId, ack.STATUS.SUCCESS, {
            message:  `Tickets LIVE after ${elapsed}s! Auto-booking now...`,
            progress: 100,
          });

          const bookAckId = ack.create('parallel_book', { prefs, trigger: 'auto-poll' });
          sendAck(ws, bookAckId, ack.STATUS.RUNNING, {
            message: 'Auto-booking triggered...', progress: 10 });

          const result = await runWithFailover(prefs);
          sendAck(ws, bookAckId,
            result.successful > 0 ? ack.STATUS.SUCCESS : ack.STATUS.FAILED, {
              message: result.successful > 0
                ? 'Auto-booking succeeded!'
                : 'Auto-booking failed — all sessions exhausted',
              result,
              progress: 100,
            });
        },
      });
      break;
    }

    // ── STOP ────────────────────────────────────────────────────────────────
    case 'stop': {
      stopPolling();
      schedulerService.stopAll();
      send(ws, { type: 'info', requestId, message: 'All operations stopped.' });
      break;
    }

    // ── PREFERENCES ─────────────────────────────────────────────────────────
    case 'set_preferences': {
      send(ws, { type: 'info', requestId,
        message: 'To set preferences, use the Preferences panel or send:\nset event=Coldplay date=2025-06-15 section=VIP quantity=2' });
      break;
    }

    case 'show_preferences': {
      const saved = storage.getAllPreferences();
      send(ws, { type: 'prefs', requestId, message: 'Current preferences:', data: saved });
      break;
    }

    // ── HISTORY ─────────────────────────────────────────────────────────────
    case 'history': {
      const history = storage.getBookingHistory(10);
      send(ws, { type: 'history', requestId,
        message: `Last ${history.length} bookings:`, data: { history } });
      break;
    }

    // ── HELP ────────────────────────────────────────────────────────────────
    case 'help': {
      send(ws, { type: 'help', requestId, message: getHelpText() });
      break;
    }

    // ── UNKNOWN ──────────────────────────────────────────────────────────────
    default: {
      send(ws, { type: 'warn', requestId,
        message: `Command not recognised. Try "book ticket", "watch for tickets", or "help".` });
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Send to a single client */
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ...data, timestamp: new Date().toISOString() }));
  }
}

/** Update ACK registry + send to specific client */
function sendAck(ws, ackId, status, payload = {}) {
  ack.update(ackId, status, payload, null); // update registry without broadcast
  send(ws, { type: 'ack', ackId, status, ...payload });
}

/** Broadcast to ALL connected clients */
function broadcast(data) {
  const payload = JSON.stringify({ ...data, timestamp: new Date().toISOString() });
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

/** Broadcast ACK update to all clients (used by REST routes) */
function broadcastAck(data) {
  broadcast(data);
}

/** Utility: convert "10:30 AM" → "0 30 10 * * *" */
function timeToCron(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let h = parseInt(match[1]);
  const m = parseInt(match[2] || 0);
  const p = match[3]?.toLowerCase();
  if (p === 'pm' && h < 12) h += 12;
  if (p === 'am' && h === 12) h = 0;
  return `0 ${m} ${h} * * *`;
}

module.exports = { setupWebSocket, broadcast, broadcastAck };
