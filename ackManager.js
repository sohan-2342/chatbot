/**
 * utils/ackManager.js
 * ─────────────────────────────────────────────────────────────────
 * ACK (Acknowledgment) Manager
 *
 * Every operation that the frontend triggers gets a unique ackId.
 * The backend sends back a structured ACK at each stage:
 *
 *   ACCEPTED  → operation received and queued
 *   RUNNING   → actively executing
 *   SUCCESS   → completed successfully
 *   FAILED    → completed with error
 *   CANCELLED → stopped by user
 *
 * The frontend uses ackId to match responses to the original request,
 * update UI state, and show real-time progress per operation.
 * ─────────────────────────────────────────────────────────────────
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

// In-memory ACK registry (could be moved to Redis for multi-process)
const registry = new Map();

/**
 * ACK status constants
 */
const STATUS = {
  ACCEPTED:  'ACCEPTED',
  RUNNING:   'RUNNING',
  SUCCESS:   'SUCCESS',
  FAILED:    'FAILED',
  CANCELLED: 'CANCELLED',
};

/**
 * Create a new ACK entry and return the ackId.
 * Call this immediately when a request arrives.
 *
 * @param {string} operation  - e.g. 'book', 'parallel_book', 'schedule', 'poll'
 * @param {object} meta       - any extra data to track (preferences, sessionCount, etc.)
 * @returns {string} ackId
 */
function create(operation, meta = {}) {
  const ackId = uuidv4();
  const entry = {
    ackId,
    operation,
    status: STATUS.ACCEPTED,
    meta,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [{ status: STATUS.ACCEPTED, ts: Date.now() }],
  };
  registry.set(ackId, entry);
  logger.info(`[ACK] Created ${ackId} for "${operation}"`);
  return ackId;
}

/**
 * Update the status of an existing ACK and optionally attach a result/error.
 * Broadcasts to all connected WS clients automatically.
 *
 * @param {string} ackId
 * @param {string} status   - one of STATUS.*
 * @param {object} payload  - { message, result, error, progress }
 * @param {Function} broadcast - the broadcastWs function from server.js
 */
function update(ackId, status, payload = {}, broadcast = null) {
  const entry = registry.get(ackId);
  if (!entry) {
    logger.warn(`[ACK] update called for unknown ackId: ${ackId}`);
    return null;
  }

  entry.status    = status;
  entry.updatedAt = Date.now();
  entry.history.push({ status, ts: Date.now(), ...payload });

  if (payload.result)   entry.result = payload.result;
  if (payload.error)    entry.error  = payload.error;
  if (payload.progress) entry.progress = payload.progress;

  registry.set(ackId, entry);

  const wsPayload = {
    type:      'ack',
    ackId,
    operation: entry.operation,
    status,
    message:   payload.message || defaultMessage(entry.operation, status),
    result:    payload.result  || null,
    error:     payload.error   || null,
    progress:  payload.progress || null,
    timestamp: new Date().toISOString(),
  };

  // Broadcast to all WebSocket clients
  if (broadcast) broadcast(wsPayload);

  logger.info(`[ACK] ${ackId} → ${status}${payload.message ? ' | ' + payload.message : ''}`);
  return wsPayload;
}

/**
 * Get current state of an ACK.
 */
function get(ackId) {
  return registry.get(ackId) || null;
}

/**
 * Clean up old ACKs (older than 2 hours) to prevent memory leaks.
 * Call this periodically.
 */
function cleanup() {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  let cleaned = 0;
  for (const [id, entry] of registry.entries()) {
    if (entry.updatedAt < twoHoursAgo) {
      registry.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) logger.info(`[ACK] Cleaned up ${cleaned} old entries`);
}

// Auto-cleanup every 30 minutes
setInterval(cleanup, 30 * 60 * 1000);

/**
 * Default human-readable messages for each operation + status combo.
 */
function defaultMessage(operation, status) {
  const messages = {
    book: {
      ACCEPTED:  'Booking request received',
      RUNNING:   'Opening browser and navigating to site...',
      SUCCESS:   'Ticket booked successfully!',
      FAILED:    'Booking failed',
      CANCELLED: 'Booking cancelled',
    },
    parallel_book: {
      ACCEPTED:  'Parallel booking request received',
      RUNNING:   'Launching parallel browser sessions...',
      SUCCESS:   'Parallel booking completed',
      FAILED:    'All parallel sessions failed',
      CANCELLED: 'Parallel booking cancelled',
    },
    schedule: {
      ACCEPTED:  'Schedule request received',
      RUNNING:   'Setting up scheduled job...',
      SUCCESS:   'Job scheduled successfully',
      FAILED:    'Failed to create schedule',
      CANCELLED: 'Schedule cancelled',
    },
    poll: {
      ACCEPTED:  'Availability monitor started',
      RUNNING:   'Watching for tickets...',
      SUCCESS:   'Tickets detected — booking triggered!',
      FAILED:    'Polling failed',
      CANCELLED: 'Monitoring stopped',
    },
  };

  return messages[operation]?.[status] || `${operation} ${status}`;
}

module.exports = { create, update, get, cleanup, STATUS };
