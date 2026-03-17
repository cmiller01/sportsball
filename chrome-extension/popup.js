let currentGame = null;
let allGames = [];

// --- Pitch count limits and league age ---
const PITCH_LIMITS = {
  '7-8':   { label: '7-8',            max: 50, warnAt: 21, dangerAt: 36,
              rest: [[1,20,0],[21,35,1],[36,50,2]] },
  '9-10':  { label: '9-10 (Mustang)', max: 60, warnAt: 36, dangerAt: 51,
              rest: [[1,20,0],[21,35,1],[36,50,2],[51,60,3]] },
  '11-12': { label: '11-12 (Bronco)', max: 80, warnAt: 51, dangerAt: 66,
              rest: [[1,20,0],[21,35,1],[36,50,2],[51,65,3],[66,80,4]] },
};

// In-memory per-player league age overrides, keyed by `${gameKey}_${playerId}`
const leagueAgeState = {};

function defaultLeagueAge(game) {
  const text = `${game.homeTeamName ?? ''} ${game.awayTeamName ?? ''} ${game.label ?? ''}`.toLowerCase();
  if (text.includes('mustang')) return '9-10';
  return '11-12';
}

function getLeagueAge(game, playerId) {
  return leagueAgeState[`${game.gameKey}_${playerId}`] ?? defaultLeagueAge(game);
}

function setLeagueAge(game, playerId, age) {
  leagueAgeState[`${game.gameKey}_${playerId}`] = age;
}

function getRestDays(count, leagueAge) {
  if (count <= 0) return 0;
  const limits = PITCH_LIMITS[leagueAge];
  if (!limits) return 0;
  for (const [min, max, days] of limits.rest) {
    if (count >= min && count <= max) return days;
  }
  return null; // over daily max
}

// Returns a conflict warning string (or null) for a player who both pitched and caught.
function catcherPitcherConflict(pitches, caught) {
  if (pitches >= 41 && caught > 0)
    return `Threw ${pitches} pitches (≥41) — ineligible to catch (rule 9.5.2)`;
  if (caught > 3 && pitches > 0)
    return `Caught ${caught} inn (>3) — ineligible to pitch (rule 9.5.3)`;
  return null;
}

// --- Team helpers ---
function teamName(teamId, game) {
  if (teamId === game.homeTeamId) return game.homeTeamName ?? 'Home';
  if (teamId === game.awayTeamId) return game.awayTeamName ?? 'Away';
  return teamId?.slice(0, 8) ?? '?';
}

function teamBadge(teamId, game) {
  const isHome = teamId === game.homeTeamId;
  const cls   = isHome ? 'team-a' : 'team-b';
  const label = isHome ? (game.homeTeamName ?? 'Home') : (game.awayTeamName ?? 'Away');
  return `<span class="team-badge ${cls}">${label}</span>`;
}

// Sort home team first, then by pitch count / innings within each team
function sortHomeFirst(arr, game) {
  return [...arr].sort((a, b) => {
    const aHome = a.teamId === game.homeTeamId ? 0 : 1;
    const bHome = b.teamId === game.homeTeamId ? 0 : 1;
    return aHome - bHome;
  });
}

// --- Pitch count colour coding (thresholds depend on league age) ---
function pitchClass(count, leagueAge) {
  const limits = PITCH_LIMITS[leagueAge] ?? PITCH_LIMITS['11-12'];
  if (count >= limits.dangerAt) return 'danger';
  if (count >= limits.warnAt)   return 'warn';
  return '';
}

// --- Render ---
function render(game) {
  if (!game) {
    document.getElementById('no-data').style.display = '';
    document.getElementById('content').style.display = 'none';
    return;
  }

  document.getElementById('no-data').style.display = 'none';
  document.getElementById('content').style.display = '';

  const { pitchers, catchers } = game.result;

  document.getElementById('pitcher-subtitle').textContent =
    `(${pitchers.length} pitcher${pitchers.length !== 1 ? 's' : ''})`;

  const missingBoxscore = pitchers.some(p => !p.hasBoxscoreData);
  document.getElementById('boxscore-note').style.display = missingBoxscore ? '' : 'none';

  // Pitchers — home team first, then away
  const pitcherMapById  = Object.fromEntries(pitchers.map(p => [p.id, p]));
  const catcherMapById  = Object.fromEntries(catchers.map(c => [c.id, c]));
  const sortedPitchers  = sortHomeFirst(pitchers, game);
  const pitcherBody = document.getElementById('pitcher-rows');
  pitcherBody.innerHTML = sortedPitchers.map(p => {
    const age  = getLeagueAge(game, p.id);
    const cls  = pitchClass(p.pitchCount, age);
    const pitchDisplay = p.hasBoxscoreData ? p.pitchCount : `${p.pitchCount}*`;
    const restDays  = getRestDays(p.lastAtBatStartPitchCount, age);
    const restLabel = restDays === null ? 'MAX' : restDays === 0 ? '—' : `${restDays}d`;
    const catcher   = catcherMapById[p.id];
    const conflict  = catcher ? catcherPitcherConflict(p.pitchCount, catcher.inningsCaught) : null;
    return `<tr>
      <td>
        <span class="player-name">${p.name}</span>
        <span class="player-num">#${p.number}</span>
        ${teamBadge(p.teamId, game)}
        <select class="age-select" data-player-id="${p.id}" title="League age">
          <option value="7-8"${age === '7-8' ? ' selected' : ''}>7-8</option>
          <option value="9-10"${age === '9-10' ? ' selected' : ''}>9-10</option>
          <option value="11-12"${age === '11-12' ? ' selected' : ''}>11-12</option>
        </select>
        ${conflict ? `<span class="conflict-warn" title="${conflict}">⚠</span>` : ''}
      </td>
      <td>${p.inningsPitched}</td>
      <td class="pitch-count ${cls}">${pitchDisplay}</td>
      <td class="${cls}">${restLabel}</td>
      <td>${p.lastAtBatStartPitchCount}</td>
    </tr>`;
  }).join('');

  pitcherBody.querySelectorAll('.age-select').forEach(sel => {
    sel.addEventListener('change', e => {
      setLeagueAge(currentGame, e.target.dataset.playerId, e.target.value);
      render(currentGame);
    });
  });

  document.getElementById('catcher-subtitle').textContent =
    catchers.length > 0
      ? `(${catchers.length} catcher${catchers.length !== 1 ? 's' : ''} identified)`
      : '(none identified)';

  // Catchers — home team first
  const sortedCatchers = sortHomeFirst(catchers, game);
  const catcherBody = document.getElementById('catcher-rows');
  if (catchers.length === 0) {
    catcherBody.innerHTML = '<tr><td colspan="3" style="color:#888;text-align:center;padding:10px">No catcher data — navigate to the boxscore tab to capture position data</td></tr>';
  } else {
    catcherBody.innerHTML = sortedCatchers.map(c => {
      const innings = c.isEstimate ? `${c.inningsCaught}*` : String(c.inningsCaught);
      const posDisplay = c.positions.length
        ? c.positions.map(p => p === 'C' ? `<strong>${p}</strong>` : p).join(', ')
        : '—';
      const pitcher  = pitcherMapById[c.id];
      const conflict = pitcher ? catcherPitcherConflict(pitcher.pitchCount, c.inningsCaught) : null;
      return `<tr>
        <td>
          <span class="player-name">${c.name}</span>
          <span class="player-num">#${c.number}</span>
          ${teamBadge(c.teamId, game)}
          ${conflict ? `<span class="conflict-warn" title="${conflict}">⚠</span>` : ''}
        </td>
        <td style="font-size:11px;color:#555">${posDisplay}</td>
        <td>${innings}</td>
      </tr>`;
    }).join('');
  }
}

// --- Exports ---
function buildText(game) {
  const { pitchers, catchers } = game.result;
  const lines = [game.label ?? '', 'PITCHERS', '---'];
  lines.push(`${'Name'.padEnd(28)} ${'Age'.padStart(5)} ${'IP'.padStart(4)} ${'Pitches'.padStart(7)} ${'Rest'.padStart(5)} ${'Last AB'.padStart(7)}`);

  for (const p of sortHomeFirst(pitchers, game)) {
    const age = getLeagueAge(game, p.id);
    const restDays = getRestDays(p.lastAtBatStartPitchCount, age);
    const restLabel = restDays === null ? 'MAX' : `${restDays}d`;
    lines.push(
      `${(p.name + ' #' + p.number).padEnd(28)} ${age.padStart(5)} ${String(p.inningsPitched).padStart(4)} ${String(p.pitchCount).padStart(7)} ${restLabel.padStart(5)} ${String(p.lastAtBatStartPitchCount).padStart(7)}  ${teamName(p.teamId, game)}`
    );
  }

  if (catchers.length > 0) {
    lines.push('', 'CATCHERS', '---');
    lines.push(`${'Name'.padEnd(28)} ${'Positions'.padEnd(22)} ${'Inn.'.padStart(4)}`);
    for (const c of sortHomeFirst(catchers, game)) {
      const innings = c.isEstimate ? `${c.inningsCaught}*` : String(c.inningsCaught);
      lines.push(
        `${(c.name + ' #' + c.number).padEnd(28)} ${c.positions.join(', ').padEnd(22)} ${innings.padStart(4)}  ${teamName(c.teamId, game)}`
      );
    }
  }
  return lines.join('\n');
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

// --- Game selector ---
function populateSelector(games) {
  const sel = document.getElementById('game-select');
  sel.innerHTML = '';
  if (games.length === 0) {
    sel.appendChild(Object.assign(document.createElement('option'), { textContent: 'No games' }));
    return;
  }
  for (const game of games) {
    const opt = document.createElement('option');
    opt.value = game.gameKey ?? game.id;
    opt.textContent = game.label ?? game.gameKey;
    sel.appendChild(opt);
  }
}

// --- Init ---
chrome.storage.local.get(['gcGames'], (stored) => {
  allGames = stored.gcGames || [];
  populateSelector(allGames);
  if (allGames.length > 0) {
    currentGame = allGames[0];
    render(currentGame);
  } else {
    render(null);
  }
});

document.getElementById('game-select').addEventListener('change', (e) => {
  const game = allGames.find(g => (g.gameKey ?? g.id) === e.target.value);
  if (game) { currentGame = game; render(game); }
});

document.getElementById('btn-copy-text').addEventListener('click', () => {
  if (!currentGame) return;
  copyText(buildText(currentGame)).then(() => {
    const btn = document.getElementById('btn-copy-text');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Text'; }, 1500);
  });
});

document.getElementById('btn-popout').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});

document.getElementById('btn-clear').addEventListener('click', () => {
  chrome.storage.local.remove(['gcGames', 'gcLatest'], () => {
    allGames = [];
    currentGame = null;
    populateSelector([]);
    render(null);
  });
});
