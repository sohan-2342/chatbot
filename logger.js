function info(msg) {
  console.log("[INFO]", msg);
}

function warn(msg) {
  console.log("[WARN]", msg);
}

function error(msg) {
  console.log("[ERROR]", msg);
}

module.exports = { info, warn, error };