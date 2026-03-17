let currentGame = null;
let allGames = [];

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

// --- Pitch count colour coding (Little League thresholds) ---
function pitchClass(count) {
  if (count >= 66) return 'danger';
  if (count >= 51) return 'warn';
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
  const sortedPitchers = sortHomeFirst(pitchers, game);
  const pitcherBody = document.getElementById('pitcher-rows');
  pitcherBody.innerHTML = sortedPitchers.map(p => {
    const cls = pitchClass(p.pitchCount);
    const pitchDisplay = p.hasBoxscoreData ? p.pitchCount : `${p.pitchCount}*`;
    return `<tr>
      <td>
        <span class="player-name">${p.name}</span>
        <span class="player-num">#${p.number}</span>
        ${teamBadge(p.teamId, game)}
      </td>
      <td>${p.inningsPitched}</td>
      <td class="pitch-count ${cls}">${pitchDisplay}</td>
      <td>${p.lastAtBatStartPitchCount}</td>
    </tr>`;
  }).join('');

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
      return `<tr>
        <td>
          <span class="player-name">${c.name}</span>
          <span class="player-num">#${c.number}</span>
          ${teamBadge(c.teamId, game)}
        </td>
        <td style="font-size:11px;color:#555">${posDisplay}</td>
        <td>${innings}</td>
      </tr>`;
    }).join('');
  }
}

// --- Exports ---
function buildCsv(game) {
  const { pitchers, catchers } = game.result;
  const lines = ['Type,Name,Number,Team,IP,Pitches,Start of Last AB,Positions,Innings Caught'];

  for (const p of sortHomeFirst(pitchers, game)) {
    lines.push(`Pitcher,${p.name},${p.number},${teamName(p.teamId, game)},${p.inningsPitched},${p.pitchCount},${p.lastAtBatStartPitchCount},,`);
  }
  for (const c of sortHomeFirst(catchers, game)) {
    const innings = c.isEstimate ? `${c.inningsCaught}*` : String(c.inningsCaught);
    lines.push(`Catcher,${c.name},${c.number},${teamName(c.teamId, game)},,,,"${c.positions.join(', ')}",${innings}`);
  }
  return lines.join('\n');
}

function buildText(game) {
  const { pitchers, catchers } = game.result;
  const lines = [game.label ?? '', 'PITCHERS', '---'];
  lines.push(`${'Name'.padEnd(28)} ${'IP'.padStart(4)} ${'Pitches'.padStart(7)} ${'Last AB'.padStart(7)}`);

  for (const p of sortHomeFirst(pitchers, game)) {
    lines.push(
      `${(p.name + ' #' + p.number).padEnd(28)} ${String(p.inningsPitched).padStart(4)} ${String(p.pitchCount).padStart(7)} ${String(p.lastAtBatStartPitchCount).padStart(7)}  ${teamName(p.teamId, game)}`
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

document.getElementById('btn-copy-csv').addEventListener('click', () => {
  if (!currentGame) return;
  copyText(buildCsv(currentGame)).then(() => {
    const btn = document.getElementById('btn-copy-csv');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy CSV'; }, 1500);
  });
});

document.getElementById('btn-copy-text').addEventListener('click', () => {
  if (!currentGame) return;
  copyText(buildText(currentGame)).then(() => {
    const btn = document.getElementById('btn-copy-text');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Text'; }, 1500);
  });
});

document.getElementById('btn-clear').addEventListener('click', () => {
  chrome.storage.local.remove(['gcGames', 'gcLatest'], () => {
    allGames = [];
    currentGame = null;
    populateSelector([]);
    render(null);
  });
});
