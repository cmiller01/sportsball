importScripts('parser.js');

// Extract the game UUID from GC URLs, e.g.:
//   /schedule/2339efef-0199-41db-b1fb-98581c19f726/plays
function gameKeyFromUrl(url) {
  const m = url.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i);
  return m ? m[1] : url;
}

// Format a UTC timestamp into a readable local string for a given IANA timezone.
// e.g. "2026-03-14T19:00:00.000Z" + "America/Los_Angeles" → "Sat Mar 14, 12:00 PM"
function formatGameDate(startTs, timezone) {
  try {
    const d = new Date(startTs);
    const str = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'America/Los_Angeles',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
    // Intl gives "Sat, Mar 14, 12:00 PM" — drop the extra comma
    return str.replace(',', '');
  } catch {
    return startTs;
  }
}

// In-memory slots keyed by game UUID, accumulate data until we can process.
const pending = {};

function processGame(gameKey, timestamp) {
  const slot = pending[gameKey];
  if (!slot?.plays) return;

  let result;
  try {
    result = parseGameData(slot.plays, slot.boxscore ?? null);
  } catch (err) {
    console.error('GC Extractor: parse error', err);
    return;
  }

  // Determine home/away team IDs.
  // slot.urlTeamId is the team whose page we navigated to.
  // slot.homeAway ('home'/'away') tells us their role.
  const urlTeamId = slot.urlTeamId;
  const homeAway  = slot.homeAway;   // may be undefined if details not yet captured
  const otherTeamId = result.teamIds.find(id => id !== urlTeamId);

  let homeTeamId, awayTeamId;
  if (homeAway === 'home') {
    homeTeamId = urlTeamId;
    awayTeamId = otherTeamId;
  } else if (homeAway === 'away') {
    homeTeamId = otherTeamId;
    awayTeamId = urlTeamId;
  } else {
    // Details not captured yet — leave ordering undefined, will re-process later
    homeTeamId = result.teamIds[0];
    awayTeamId = result.teamIds[1];
  }

  const homeTeamName = (homeTeamId === urlTeamId ? slot.teamName : slot.opponentName)
    ?? "Home Team";
  const awayTeamName = (awayTeamId === urlTeamId ? slot.teamName : slot.opponentName)
    ?? "Away Team";

  const dateLabel = slot.startTs
    ? formatGameDate(slot.startTs, slot.timezone)
    : null;

  const label = dateLabel
    ? `${homeTeamName} vs ${awayTeamName} — ${dateLabel}`
    : `${homeTeamName} vs ${awayTeamName}`;

  const entry = {
    id: gameKey,
    gameKey,
    timestamp,
    label,
    homeTeamId,
    awayTeamId,
    homeTeamName,
    awayTeamName,
    hasBoxscore: !!slot.boxscore,
    result,
  };

  chrome.storage.local.get(['gcGames'], (stored) => {
    const games = stored.gcGames || [];
    const filtered = games.filter(g => g.gameKey !== gameKey);
    const updated = [entry, ...filtered].slice(0, 20);
    chrome.storage.local.set({ gcGames: updated, gcLatest: entry });
  });
}

chrome.runtime.onMessage.addListener((message) => {
  const { type, payload, url, teamId, timestamp } = message;
  const KNOWN = ['GC_PLAYS_DATA', 'GC_BOXSCORE_DATA', 'GC_TEAM_DATA', 'GC_GAME_DETAILS'];
  if (!KNOWN.includes(type)) return;

  const gameKey = gameKeyFromUrl(url);
  if (!pending[gameKey]) pending[gameKey] = {};
  const slot = pending[gameKey];

  // Always record the URL team ID when we have it
  if (teamId) slot.urlTeamId = teamId;

  switch (type) {
    case 'GC_PLAYS_DATA':
      slot.plays = payload;
      break;
    case 'GC_BOXSCORE_DATA':
      slot.boxscore = payload;
      break;
    case 'GC_TEAM_DATA':
      slot.teamName = payload.name;
      break;
    case 'GC_GAME_DETAILS':
      slot.homeAway     = payload.home_away;
      slot.opponentName = payload.opponent_team?.name;
      slot.startTs      = payload.start_ts;
      slot.timezone     = payload.timezone;
      break;
  }

  processGame(gameKey, timestamp);
});
