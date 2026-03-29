let broadcastFn = null;

function setBroadcast(fn) {
  broadcastFn = fn;
}

function broadcast(msg) {
  if (broadcastFn) {
    broadcastFn(msg);
  }
}

module.exports = { setBroadcast, broadcast };