// Injected directly into the page context (not the extension context) so it
// can intercept fetch and XMLHttpRequest before the page's own code runs.
// Communicates results back via window.postMessage.

(function () {
  function classify(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.team_players && Array.isArray(obj.plays)) return 'GC_PLAYS_DATA';
    // Boxscore: object whose values have a `groups` array with pitching/lineup
    const firstTeam = Object.values(obj)[0];
    if (Array.isArray(firstTeam?.groups) &&
        firstTeam.groups.some(g => g.category === 'pitching' || g.category === 'lineup')) {
      return 'GC_BOXSCORE_DATA';
    }
    // Team info: {id, name, sport: "baseball", ...}
    // Use !obj.opponent_team to distinguish from GC_GAME_DETAILS (which has that field).
    // age_group is omitted from the check because it can be absent or null.
    if (obj.id && obj.name && obj.sport === 'baseball' && !obj.opponent_team) {
      return 'GC_TEAM_DATA';
    }
    // Game details: {id, opponent_team: {name}, home_away, start_ts, timezone}
    if (obj.id && obj.opponent_team?.name && obj.home_away !== undefined && obj.start_ts) {
      return 'GC_GAME_DETAILS';
    }
    return null;
  }

  function maybeDispatch(body) {
    let parsed;
    try {
      parsed = typeof body === 'string' ? JSON.parse(body) : body;
    } catch {
      return;
    }
    const type = classify(parsed);
    if (type) {
      window.postMessage({ type, payload: parsed }, '*');
    }
  }

  // --- Wrap fetch ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const clone = response.clone();
    clone.text().then(maybeDispatch).catch(() => {});
    return response;
  };

  // --- Wrap XMLHttpRequest ---
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args) {
    this._gcUrl = args[1];
    return originalOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      if (this.responseType === '' || this.responseType === 'text') {
        maybeDispatch(this.responseText);
      } else if (this.responseType === 'json') {
        maybeDispatch(this.response);
      }
    });
    return originalSend.apply(this, args);
  };
})();
