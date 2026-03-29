let preferences = {};
let history = [];

function setPreference(key, value) {
  preferences[key] = value;
}

function getAllPreferences() {
  return preferences;
}

function recordBooking(id, status, prefs, result, error) {
  history.push({
    id,
    status,
    prefs,
    result,
    error,
    time: new Date()
  });
}

function getBookingHistory(limit = 10) {
  return history.slice(-limit);
}

module.exports = {
  setPreference,
  getAllPreferences,
  recordBooking,
  getBookingHistory
};