const { checkForUpdate } = require('./update-checker.cjs');

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function createUpdateController({ currentVersion, fetchImpl, onChange = () => {}, now = Date.now } = {}) {
  let state = {
    phase: 'idle',
    currentVersion,
    release: null,
    checkedAt: null,
    error: '',
    dismissed: false
  };
  let lastAttemptAt = null;
  let inFlight = null;

  function snapshot() {
    return { ...state, release: state.release ? { ...state.release } : null };
  }

  function publish() {
    try {
      onChange(snapshot());
    } catch {
      // A closed window or failed observer must not break update state or retries.
    }
  }

  function check({ manual = true } = {}) {
    if (inFlight) {
      // A manual check can join an automatic request and restore its update prompt.
      if (manual) inFlight.manual = true;
      return inFlight.promise;
    }
    const attemptAt = now();
    if (!manual && lastAttemptAt !== null && attemptAt - lastAttemptAt < AUTO_CHECK_INTERVAL_MS) {
      return Promise.resolve(snapshot());
    }
    lastAttemptAt = attemptAt;
    state = { ...state, phase: 'checking', error: '' };
    const flight = { manual: Boolean(manual), promise: null };
    inFlight = flight;
    // Defer the fetch until the shared promise exists, including for reentrant observers.
    flight.promise = Promise.resolve()
      .then(() => checkForUpdate({ currentVersion, fetchImpl }))
      .then(release => {
        const keepDismissed = release && state.release?.version === release.version && state.dismissed && !flight.manual;
        state = {
          ...state,
          phase: release ? 'available' : 'current',
          release,
          checkedAt: now(),
          error: '',
          dismissed: Boolean(keepDismissed)
        };
      }, error => {
        state = {
          ...state,
          phase: 'error',
          checkedAt: now(),
          error: error?.name === 'UpdateCheckError' && typeof error.message === 'string'
            ? error.message
            : '检查更新失败，请稍后重试。'
        };
      })
      .then(() => {
        publish();
        return snapshot();
      })
      .finally(() => {
        if (inFlight === flight) inFlight = null;
      });
    publish();
    return flight.promise;
  }

  function dismiss() {
    if (state.release && !state.dismissed) {
      state = { ...state, dismissed: true };
      publish();
    }
    return snapshot();
  }

  return { snapshot, check, dismiss };
}

module.exports = { AUTO_CHECK_INTERVAL_MS, createUpdateController };
