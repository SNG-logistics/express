/**
 * quote-alert.js — shared "new quote-request" alert store.
 *
 * Used by both the partner quote-request queue page (its own inline alert
 * cards) and the header notification bell (present on every /partner/* page).
 * Both poll the same GET /partner/api/quote-requests/pending endpoint, and
 * both can be on screen at once — a staff member sitting on the queue page
 * sees the bell too. Without one shared "have I already alerted for this id"
 * store, each would track its own list and the same request could beep
 * twice. This module owns that one store so either caller can ask "which of
 * these ids are actually new" and get the same answer.
 *
 * Nothing here polls or renders — each caller still owns its own
 * setInterval and its own markup. This only answers two questions: which ids
 * are new, and how to make the sound.
 */
(function () {
  const SEEN_KEY = 'sng_quote_alert_seen_ids';
  const SOUND_KEY = 'sng_quote_alert_sound_enabled';
  const MAX_SEEN = 200; // bounded — nothing here needs unbounded history

  // Safari private-mode (and some locked-down browsers) throws on
  // localStorage access rather than just refusing writes, so every touch
  // goes through try/catch and degrades to "nothing remembered" instead of
  // breaking the page.
  function hasKey(key) {
    try { return localStorage.getItem(key) !== null; } catch { return false; }
  }
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw === null ? fallback : JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* can't persist; caller just re-checks next time */ }
  }
  function readBool(key) {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  }
  function writeBool(key, value) {
    try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* can't persist */ }
  }

  /**
   * Given the ids currently reported as pending, remembers all of them and
   * returns the subset that should alert right now.
   *
   * The first time this ever runs in a browser (no store yet at all) every
   * id passed in is backlog, not a new arrival — it gets remembered, but
   * none of it alerts, the same way the queue page has always silently
   * seeded its "known" set from the page's own initial server-rendered list
   * rather than dinging for everything already sitting in the table.
   */
  function claimBatch(ids) {
    const keys = ids.map(String);
    const isFirstRunEver = !hasKey(SEEN_KEY);
    const seenSet = new Set(readJSON(SEEN_KEY, []));
    const fresh = isFirstRunEver ? [] : keys.filter(id => !seenSet.has(id));
    keys.forEach(id => seenSet.add(id));
    writeJSON(SEEN_KEY, Array.from(seenSet).slice(-MAX_SEEN));
    return fresh;
  }

  let audioContext;
  function beep() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ||= new AudioContextClass();
    const now = audioContext.currentTime;
    [0, 0.22].forEach((delay, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = index ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.16, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.18);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + 0.19);
    });
  }

  window.quoteAlert = {
    claimBatch,
    isSoundEnabled: () => readBool(SOUND_KEY),
    // Browsers block audio until a user gesture grants it — call this from a
    // click handler. Persisted per-browser, so it's only ever needed once,
    // not once per page.
    enableSound() { writeBool(SOUND_KEY, true); beep(); },
    play() { if (readBool(SOUND_KEY)) beep(); },
  };
})();
