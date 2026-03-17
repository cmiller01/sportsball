// Content script — runs in the extension's isolated world but can inject
// scripts into the page context and listen for postMessage results.

// Inject the interceptor into the actual page context
const script = document.createElement('script');
script.src = chrome.runtime.getURL('gc-interceptor.js');
(document.head || document.documentElement).appendChild(script);
script.remove();

const HANDLED_TYPES = new Set([
  'GC_PLAYS_DATA', 'GC_BOXSCORE_DATA', 'GC_TEAM_DATA', 'GC_GAME_DETAILS',
]);

// Extract the team ID from URLs like /teams/{id}/...
function urlTeamId() {
  const m = window.location.pathname.match(/\/teams\/([^\/]+)\//);
  return m ? m[1] : null;
}

// Extract game UUID from URLs like /schedule/{uuid}/plays
function urlGameKey() {
  const m = window.location.pathname.match(
    /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i
  );
  return m ? m[1] : null;
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const type = event.data?.type;
  if (!HANDLED_TYPES.has(type)) return;

  try {
    chrome.runtime.sendMessage({
      type,
      payload: event.data.payload,
      url: window.location.href,
      teamId: urlTeamId(),
      timestamp: Date.now(),
    });
  } catch {}
});

// Proactively fetch team name and game details — the page doesn't always
// request these endpoints when navigating directly to a game sub-page.
// Content scripts share the page's cookies so auth is automatic.
async function proactiveFetch(teamId, gameKey) {
  const send = (type, payload) => {
    try {
      chrome.runtime.sendMessage({
        type,
        payload,
        url: window.location.href,
        teamId,
        timestamp: Date.now(),
      });
    } catch {}
  };

  if (teamId) {
    try {
      const resp = await fetch(`https://api.team-manager.gc.com/public/teams/${teamId}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data?.name) send('GC_TEAM_DATA', data);
      }
    } catch {}
  }

  if (gameKey) {
    try {
      const resp = await fetch(
        `https://api.team-manager.gc.com/public/game-stream-processing/${gameKey}/details?include=line_scores`
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data?.opponent_team) send('GC_GAME_DETAILS', data);
      }
    } catch {}
  }
}

const _teamId  = urlTeamId();
const _gameKey = urlGameKey();
if (_teamId || _gameKey) proactiveFetch(_teamId, _gameKey);
