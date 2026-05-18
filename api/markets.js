// api/markets.js
// Fetches live election prediction market data from Polymarket
// Vercel calls this at /api/markets

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60'); // cache 2 min

  try {
    // Fetch politics markets from Polymarket's public gamma API
    const response = await fetch(
      'https://gamma-api.polymarket.com/markets?tag=politics&limit=50&active=true',
      { headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error(`Polymarket API returned ${response.status}`);
    }

    const markets = await response.json();

    // Filter to US Senate / election markets only
    const electionKeywords = ['senate', 'house', 'congress', 'election', 'win', 'control', 'seat'];
    const filtered = markets.filter(m => {
      const title = (m.question || m.title || '').toLowerCase();
      return electionKeywords.some(kw => title.includes(kw));
    });

    // Normalize into a clean format for the frontend
    const normalized = filtered.map(m => ({
      id: m.id,
      title: m.question || m.title || 'Unknown',
      // outcomePrices is a JSON string like "[0.62, 0.38]"
      // First price = YES probability (0-1), multiply by 100 for percentage
      demProb: parseOutcomePrice(m.outcomePrices, 0),
      repProb: parseOutcomePrice(m.outcomePrices, 1),
      volume: m.volume ? Math.round(parseFloat(m.volume)) : 0,
      liquidity: m.liquidity ? Math.round(parseFloat(m.liquidity)) : 0,
      endDate: m.endDate || null,
      url: m.marketUrl || `https://polymarket.com/event/${m.slug || m.id}`,
    }));

    res.status(200).json({
      source: 'polymarket',
      fetchedAt: new Date().toISOString(),
      count: normalized.length,
      markets: normalized,
    });

  } catch (err) {
    console.error('Polymarket fetch error:', err.message);
    res.status(500).json({
      error: 'Failed to fetch Polymarket data',
      message: err.message,
      fallback: true,
    });
  }
}

function parseOutcomePrice(outcomePrices, index) {
  try {
    if (!outcomePrices) return null;
    const parsed = typeof outcomePrices === 'string'
      ? JSON.parse(outcomePrices)
      : outcomePrices;
    const val = parseFloat(parsed[index]);
    return isNaN(val) ? null : Math.round(val * 100);
  } catch {
    return null;
  }
}
