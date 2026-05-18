// api/polls.js
// Fetches live Senate polling averages
// Primary: Silver Bulletin / 538 community mirror on GitHub
// Fallback: Returns structured baseline data if upstream is unavailable
// Vercel calls this at /api/polls

const BASELINE = [
  { state: 'Arizona',      abbr: 'AZ', fips: '04', d: 48.0, r: 52.0, turn: 61, swing: -1.2, status: 'tossup'   },
  { state: 'Nevada',       abbr: 'NV', fips: '32', d: 51.0, r: 49.0, turn: 58, swing: +0.8, status: 'lean-d'   },
  { state: 'Michigan',     abbr: 'MI', fips: '26', d: 54.0, r: 46.0, turn: 67, swing: +2.1, status: 'likely-d' },
  { state: 'Wisconsin',    abbr: 'WI', fips: '55', d: 47.0, r: 53.0, turn: 64, swing: -0.6, status: 'lean-r'   },
  { state: 'Montana',      abbr: 'MT', fips: '30', d: 39.0, r: 61.0, turn: 55, swing: -3.1, status: 'safe-r'   },
  { state: 'Ohio',         abbr: 'OH', fips: '39', d: 44.0, r: 56.0, turn: 59, swing: -1.8, status: 'lean-r'   },
  { state: 'Pennsylvania', abbr: 'PA', fips: '42', d: 50.0, r: 50.0, turn: 66, swing: +0.2, status: 'tossup'   },
  { state: 'Georgia',      abbr: 'GA', fips: '13', d: 48.0, r: 52.0, turn: 63, swing: -0.4, status: 'lean-r'   },
  { state: 'New Hampshire',abbr: 'NH', fips: '33', d: 53.0, r: 47.0, turn: 69, swing: +1.1, status: 'likely-d' },
];

// Map state names to our abbreviations for matching poll data
const STATE_MAP = {
  'arizona': 'AZ', 'nevada': 'NV', 'michigan': 'MI', 'wisconsin': 'WI',
  'montana': 'MT', 'ohio': 'OH', 'pennsylvania': 'PA', 'georgia': 'GA',
  'new hampshire': 'NH',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120'); // cache 5 min

  // Try to fetch live poll data from the 538/Silver Bulletin community GitHub mirror
  // This CSV is updated regularly by the open-source polling community
  const POLL_CSV_URL =
    'https://raw.githubusercontent.com/fivethirtyeight/data/master/polls/senate_polls.csv';

  try {
    const response = await fetch(POLL_CSV_URL, {
      headers: { 'Accept': 'text/csv,text/plain' },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) throw new Error(`CSV fetch returned ${response.status}`);

    const csvText = await response.text();
    const races = parsePollCSV(csvText);

    if (races.length === 0) throw new Error('No races parsed from CSV');

    res.status(200).json({
      source: 'fivethirtyeight-github',
      fetchedAt: new Date().toISOString(),
      live: true,
      races,
    });

  } catch (err) {
    console.warn('Live poll fetch failed, using baseline:', err.message);

    // Return baseline data with a flag so the frontend knows
    res.status(200).json({
      source: 'baseline',
      fetchedAt: new Date().toISOString(),
      live: false,
      fallbackReason: err.message,
      races: BASELINE,
    });
  }
}

function parsePollCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());

  // Group polls by state, average the most recent ones
  const byState = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < headers.length) continue;

    const row = {};
    headers.forEach((h, idx) => { row[h] = (cols[idx] || '').replace(/"/g, '').trim(); });

    // Only look at 2026 Senate general election polls
    const cycle = row['cycle'] || row['year'] || '';
    const type = (row['type'] || row['race_type'] || '').toLowerCase();
    if (!cycle.includes('2026') || !type.includes('senate')) continue;

    const stateName = (row['state'] || '').toLowerCase();
    const abbr = STATE_MAP[stateName];
    if (!abbr) continue;

    const dPct = parseFloat(row['dem'] || row['pct1'] || row['candidate1_pct'] || 0);
    const rPct = parseFloat(row['rep'] || row['pct2'] || row['candidate2_pct'] || 0);
    if (isNaN(dPct) || isNaN(rPct) || dPct === 0) continue;

    if (!byState[abbr]) byState[abbr] = { polls: [], abbr, stateName };
    byState[abbr].polls.push({ d: dPct, r: rPct });
  }

  // Average polls and merge with baseline for non-polled fields
  return BASELINE.map(base => {
    const stateData = byState[base.abbr];
    if (!stateData || stateData.polls.length === 0) return base;

    const avgD = stateData.polls.reduce((s, p) => s + p.d, 0) / stateData.polls.length;
    const avgR = stateData.polls.reduce((s, p) => s + p.r, 0) / stateData.polls.length;
    const margin = avgD - avgR;

    return {
      ...base,
      d: +avgD.toFixed(1),
      r: +avgR.toFixed(1),
      status: deriveStatus(margin),
      pollCount: stateData.polls.length,
      live: true,
    };
  });
}

function deriveStatus(margin) {
  if (margin > 8)  return 'likely-d';
  if (margin > 3)  return 'lean-d';
  if (margin > -3) return 'tossup';
  if (margin > -8) return 'lean-r';
  return 'safe-r';
}

// Handles quoted CSV fields with commas inside them
function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; continue; }
    if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += line[i];
  }
  result.push(current);
  return result;
}
