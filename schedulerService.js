let jobs = [];

// Add a job using cron expression
function addJob(cronExpr, prefs) {
  const job = {
    id: Date.now(),
    cron: cronExpr,
    prefs
  };
  console.log("[SCHEDULER] Job added:", job);
  jobs.push(job);
  return job;
}

// Schedule at specific time
function scheduleAt(time, prefs) {
  const job = {
    id: Date.now(),
    time,
    prefs
  };
  console.log("[SCHEDULER] Scheduled at:", time);
  jobs.push(job);
  return job;
}

// List all jobs
function listJobs() {
  return jobs;
}

// Remove job
function removeJob(id) {
  jobs = jobs.filter(j => j.id != id);
  return true;
}

// Stop all jobs
function stopAll() {
  console.log("[SCHEDULER] Stopped all jobs");
  jobs = [];
}

// Restore jobs (dummy for now)
function restoreJobsFromDb() {
  console.log("[SCHEDULER] Initialized");
}

module.exports = {
  addJob,
  scheduleAt,
  listJobs,
  removeJob,
  stopAll,
  restoreJobsFromDb
};