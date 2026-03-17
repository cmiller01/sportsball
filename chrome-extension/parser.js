// Parses GameChanger plays JSON (and optionally boxscore JSON) into pitcher and
// catcher stats for youth baseball league reporting.
// Compatible with both the Chrome extension and Node.js for testing.

const PITCH_EVENT_RE = /^(Ball \d+|Strike \d+ (looking|swinging)|Foul|In play)$/;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function countPitches(atPlateDetails) {
  return atPlateDetails.filter(d => PITCH_EVENT_RE.test(d.template)).length;
}

function buildPlayerMap(teamPlayers) {
  const players = {};
  for (const [teamId, roster] of Object.entries(teamPlayers)) {
    for (const player of roster) {
      players[player.id] = { ...player, teamId };
    }
  }
  return players;
}

// Numeric sort key for a half-inning string like "3-top" or "2-bottom".
function inningHalfOrder(ih) {
  const [inning, half] = ih.split('-');
  return parseInt(inning) * 2 + (half === 'top' ? 0 : 1);
}

// "(C, SS, P)" → ['C', 'SS', 'P']
function parsePositions(playerText) {
  return (playerText || '')
    .replace(/[()]/g, '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Pitcher detection from plays
// ---------------------------------------------------------------------------

function detectPitcher(play) {
  // final_details "X pitching" is the most reliable signal — check it first.
  for (const detail of play.final_details) {
    const m = detail.template.match(/\$\{([^}]+)\} pitching/);
    if (m) return m[1];
  }
  // Fall back to at_plate_details for mid-at-bat substitution events.
  // "Lineup changed: X in at pitcher" is unambiguous.
  // "X in for pitcher Y" means X entered the game replacing Y who was the pitcher,
  // but X may be taking a different position — only use this when final_details
  // gave no answer (i.e. the at-bat has no explicit "pitching" call, as happens
  // when a pitcher change occurs mid-at-bat and the play result omits the name).
  for (const detail of play.at_plate_details) {
    let m = detail.template.match(/Lineup changed: \$\{([^}]+)\} in at pitcher/);
    if (m) return m[1];
    m = detail.template.match(/\$\{([^}]+)\} in for pitcher/);
    if (m) return m[1];
  }
  return null;
}

function detectCatcherFromPlay(play) {
  for (const detail of [...play.at_plate_details, ...play.final_details]) {
    const m = detail.template.match(/catcher \$\{([^}]+)\}/);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Boxscore helpers
// ---------------------------------------------------------------------------

function parseBoxscoreData(data) {
  const pitchCounts = {};
  for (const teamData of Object.values(data)) {
    if (!teamData?.groups) continue;
    const pitchingGroup = teamData.groups.find(g => g.category === 'pitching');
    if (!pitchingGroup?.extra) continue;
    const pitchStat = pitchingGroup.extra.find(e => e.stat_name === '#P');
    if (!pitchStat?.stats) continue;
    for (const { player_id, value } of pitchStat.stats) {
      pitchCounts[player_id] = value;
    }
  }
  return pitchCounts;
}

function looksLikeBoxscore(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const firstTeam = Object.values(obj)[0];
  return Array.isArray(firstTeam?.groups) &&
    firstTeam.groups.some(g => g.category === 'pitching' || g.category === 'lineup');
}

// ---------------------------------------------------------------------------
// Catcher innings from boxscore position sequences
//
// Each player_text entry is an ORDERED list of position STINTS (consecutive
// innings at the same spot). The length of each stint (in innings) is unknown,
// but we can use pitcher inning data as an anchor when available.
//
// For pitcher-catchers: we know exactly which half-innings they pitched, so we
// can count the fielding innings before/after their pitching period and
// distribute the pre/post stints proportionally.
//
// For catch-only players: distribute C stints proportionally across all
// fielding innings. Ceiling is used to err on the over-reporting side (safer
// for catcher-eligibility rules).
// ---------------------------------------------------------------------------

function computeCatcherInnings(
  positions,        // ['C', '3B', 'P', ...]
  fieldingHalves,   // sorted array of half-inning strings for this team
  pitcherHalves     // Set of half-inning strings this player pitched (or null)
) {
  const cCount = positions.filter(p => p === 'C').length;
  if (cCount === 0) return null;

  const totalStints = positions.length;
  const totalFielding = fieldingHalves.length;

  if (!pitcherHalves || pitcherHalves.size === 0 || !positions.includes('P')) {
    // No pitcher anchor: distribute C stints evenly, ceiling for safety.
    return {
      innings: Math.ceil(totalFielding * cCount / totalStints),
      isEstimate: true,
    };
  }

  // Pitcher anchor: split analysis into before-P and after-P segments.
  const pitchSorted = [...pitcherHalves].sort((a, b) => inningHalfOrder(a) - inningHalfOrder(b));
  const firstPitch = pitchSorted[0];
  const lastPitch  = pitchSorted[pitchSorted.length - 1];
  const firstPOrder = inningHalfOrder(firstPitch);
  const lastPOrder  = inningHalfOrder(lastPitch);

  const pIdx = positions.indexOf('P');
  const beforeP = positions.slice(0, pIdx);
  const afterP  = positions.slice(pIdx + 1);

  const fieldingBeforeP = fieldingHalves.filter(h => inningHalfOrder(h) < firstPOrder);
  const fieldingAfterP  = fieldingHalves.filter(h => inningHalfOrder(h) > lastPOrder);

  let caught = 0;

  // C stints before pitching period
  const cBefore = beforeP.filter(p => p === 'C').length;
  if (cBefore > 0) {
    if (fieldingBeforeP.length === 0) {
      // Game started with this player already pitching — catching was pre-game
      // or data gap; give minimum 1 per C stint.
      caught += cBefore;
    } else {
      caught += beforeP.length === 1 && cBefore === 1
        ? fieldingBeforeP.length  // sole position before pitching → all those innings
        : Math.ceil(fieldingBeforeP.length * cBefore / beforeP.length);
    }
  }

  // C stints after pitching period
  const cAfter = afterP.filter(p => p === 'C').length;
  if (cAfter > 0) {
    if (fieldingAfterP.length === 0) {
      // Game ended during/after the catching stint — give minimum 1 per C stint.
      caught += cAfter;
    } else {
      caught += afterP.length === 1 && cAfter === 1
        ? fieldingAfterP.length
        : Math.ceil(fieldingAfterP.length * cAfter / afterP.length);
    }
  }

  // isEstimate = true when C is mixed with other positions in the same period,
  // or when we had to fall back to the minimum-1 rule.
  const isEstimate = (cBefore > 0 && (beforeP.length > cBefore || fieldingBeforeP.length === 0)) ||
                     (cAfter  > 0 && (afterP.length  > cAfter  || fieldingAfterP.length  === 0));

  return { innings: caught, isEstimate };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function parseGameData(playsData, boxscoreData = null) {
  const players = buildPlayerMap(playsData.team_players);
  const boxscorePitchCounts = boxscoreData ? parseBoxscoreData(boxscoreData) : {};

  // ---- Pass 1: pitcher stats from plays --------------------------------
  const pitcherStats = {};   // playerId -> { pitchesFromPlays, lastAbPitches, inningHalves }
  const catcherHalvesFromPlays = {}; // playerId -> Set (half-innings with explicit ref)

  const halfPitcher = { top: null, bottom: null };
  let prevInningHalf = null;
  let prevOuts = 0;

  // Determine which half each team fields in (needed for catcher calc later)
  // top fielding team = the team whose pitchers throw in the top half
  const halfFieldingTeam = { top: null, bottom: null };

  for (const play of playsData.plays) {
    if (play.final_details.length === 0 && play.at_plate_details.length === 0) continue;

    const inningHalf = `${play.inning}-${play.half}`;
    if (inningHalf !== prevInningHalf) {
      prevOuts = 0;
      prevInningHalf = inningHalf;
    }

    const detectedPitcher = detectPitcher(play);
    if (detectedPitcher) {
      halfPitcher[play.half] = detectedPitcher;
      if (!halfFieldingTeam[play.half] && players[detectedPitcher]) {
        halfFieldingTeam[play.half] = players[detectedPitcher].teamId;
      }
    }
    const currentPitcher = halfPitcher[play.half];

    if (currentPitcher) {
      if (!pitcherStats[currentPitcher]) {
        pitcherStats[currentPitcher] = {
          pitchesFromPlays: 0,
          lastAbPitches: 0,
          inningHalves: new Set(),
        };
      }
      const stats = pitcherStats[currentPitcher];
      const abPitches = countPitches(play.at_plate_details);
      stats.lastAbPitches = abPitches;
      stats.pitchesFromPlays += abPitches;
      stats.inningHalves.add(inningHalf);
    }

    // Explicit catcher references in play events (caught stealing, etc.)
    const catcherId = detectCatcherFromPlay(play);
    if (catcherId) {
      if (!catcherHalvesFromPlays[catcherId]) catcherHalvesFromPlays[catcherId] = new Set();
      catcherHalvesFromPlays[catcherId].add(inningHalf);
    }

    prevOuts = play.outs;
  }

  // ---- Pitchers output array -------------------------------------------
  const pitchers = Object.entries(pitcherStats)
    .map(([id, stats]) => {
      const player = players[id];
      const totalPitches = boxscorePitchCounts[id] ?? stats.pitchesFromPlays;
      return {
        id,
        name: player ? `${player.first_name} ${player.last_name}` : id,
        number: player?.number ?? '?',
        teamId: player?.teamId ?? 'unknown',
        pitchCount: totalPitches,
        lastAtBatStartPitchCount: totalPitches - stats.lastAbPitches,
        inningsPitched: stats.inningHalves.size,
        hasBoxscoreData: id in boxscorePitchCounts,
      };
    })
    .sort((a, b) => b.pitchCount - a.pitchCount);

  // ---- Catchers output array -------------------------------------------
  // Build sorted fielding half-innings per team
  const allHalves = [...new Set(
    playsData.plays
      .filter(p => p.final_details.length > 0 || p.at_plate_details.length > 0)
      .map(p => `${p.inning}-${p.half}`)
  )].sort((a, b) => inningHalfOrder(a) - inningHalfOrder(b));

  // teamId (from plays) -> sorted list of half-innings THEY FIELD in
  const teamFieldingHalves = {};
  for (const [half, teamId] of Object.entries(halfFieldingTeam)) {
    if (!teamId) continue;
    if (!teamFieldingHalves[teamId]) teamFieldingHalves[teamId] = [];
    const halvesForThisHalf = allHalves.filter(h => h.endsWith(half));
    teamFieldingHalves[teamId].push(...halvesForThisHalf);
  }
  for (const arr of Object.values(teamFieldingHalves)) {
    arr.sort((a, b) => inningHalfOrder(a) - inningHalfOrder(b));
  }

  let catchers = [];

  if (boxscoreData) {
    // Build a map from player ID → plays teamId for cross-referencing
    const playerToPlaysTeam = {};
    for (const [teamId, roster] of Object.entries(playsData.team_players)) {
      for (const p of roster) playerToPlaysTeam[p.id] = teamId;
    }

    for (const [, teamData] of Object.entries(boxscoreData)) {
      if (!teamData?.groups) continue;
      const lineup = teamData.groups.find(g => g.category === 'lineup');
      if (!lineup) continue;

      for (const entry of lineup.stats) {
        const positions = parsePositions(entry.player_text);
        if (!positions.includes('C')) continue;

        const playerId = entry.player_id;
        const player = players[playerId] ||
          teamData.players?.find(p => p.id === playerId);
        const playsTeamId = playerToPlaysTeam[playerId];
        const fieldingHalves = (playsTeamId && teamFieldingHalves[playsTeamId]) || [];

        const pitcherHalves = pitcherStats[playerId]?.inningHalves ?? null;
        const result = computeCatcherInnings(positions, fieldingHalves, pitcherHalves);

        // Use the play-event count as a floor (it's exact for the innings detected)
        const playsFloor = catcherHalvesFromPlays[playerId]?.size ?? 0;
        const innings = result
          ? Math.max(result.innings, playsFloor)
          : playsFloor;

        catchers.push({
          id: playerId,
          name: player ? `${player.first_name} ${player.last_name}` : playerId,
          number: player?.number ?? '?',
          teamId: playsTeamId ?? 'unknown',
          positions,
          inningsCaught: innings,
          isEstimate: result?.isEstimate ?? (playsFloor === 0),
        });
      }
    }
  } else {
    // Fallback: play-event catcher detection only
    for (const [id, halvesSet] of Object.entries(catcherHalvesFromPlays)) {
      const player = players[id];
      catchers.push({
        id,
        name: player ? `${player.first_name} ${player.last_name}` : id,
        number: player?.number ?? '?',
        teamId: player?.teamId ?? 'unknown',
        positions: [],
        inningsCaught: halvesSet.size,
        isEstimate: false,
      });
    }
  }

  catchers.sort((a, b) => b.inningsCaught - a.inningsCaught);

  const teamIds = [...new Set(Object.values(players).map(p => p.teamId))];
  return { pitchers, catchers, players, teamIds };
}

// Export for Node.js testing
if (typeof module !== 'undefined') {
  module.exports = { parseGameData, parseBoxscoreData, looksLikeBoxscore };
}
