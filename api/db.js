// api/db.js
// Handles all database operations: sessions, saved scenarios, and notes
// Talks to Supabase (free tier) via their REST API — no extra libraries needed

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Helper: make an authenticated request to Supabase
async function supabase(method, table, body = null, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${table} failed: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured. Add SUPABASE_URL and SUPABASE_SERVICE_KEY to Vercel environment variables.' });
  }

  const { action } = req.query;
  const userEmail = req.headers['x-user-email'];

  try {
    // ── SCENARIOS ─────────────────────────────────────
    if (action === 'get-scenarios') {
      const data = await supabase('GET', 'scenarios', null,
        `?user_email=eq.${encodeURIComponent(userEmail)}&order=created_at.desc`);
      return res.json(data || []);
    }

    if (action === 'save-scenario') {
      const { name, sliders } = req.body;
      const data = await supabase('POST', 'scenarios', {
        user_email: userEmail,
        name,
        sliders,           // JSON object of slider values
        created_at: new Date().toISOString(),
      });
      return res.json(data?.[0] || {});
    }

    if (action === 'delete-scenario') {
      const { id } = req.body;
      await supabase('DELETE', 'scenarios', null,
        `?id=eq.${id}&user_email=eq.${encodeURIComponent(userEmail)}`);
      return res.json({ deleted: true });
    }

    // ── NOTES ─────────────────────────────────────────
    if (action === 'get-notes') {
      const data = await supabase('GET', 'notes', null,
        `?user_email=eq.${encodeURIComponent(userEmail)}&order=updated_at.desc`);
      return res.json(data || []);
    }

    if (action === 'save-note') {
      const { id, title, content } = req.body;
      if (id) {
        // Update existing note
        const data = await supabase('PATCH', 'notes',
          { title, content, updated_at: new Date().toISOString() },
          `?id=eq.${id}&user_email=eq.${encodeURIComponent(userEmail)}`);
        return res.json(data?.[0] || {});
      } else {
        // Create new note
        const data = await supabase('POST', 'notes', {
          user_email: userEmail,
          title,
          content,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return res.json(data?.[0] || {});
      }
    }

    if (action === 'delete-note') {
      const { id } = req.body;
      await supabase('DELETE', 'notes', null,
        `?id=eq.${id}&user_email=eq.${encodeURIComponent(userEmail)}`);
      return res.json({ deleted: true });
    }

    // ── CHAT HISTORY ──────────────────────────────────
    if (action === 'get-chat') {
      const data = await supabase('GET', 'chat_sessions', null,
        `?user_email=eq.${encodeURIComponent(userEmail)}&order=created_at.desc&limit=1`);
      return res.json(data?.[0] || { messages: [] });
    }

    if (action === 'save-chat') {
      const { messages } = req.body;
      // Upsert: replace the user's single saved chat session
      const existing = await supabase('GET', 'chat_sessions', null,
        `?user_email=eq.${encodeURIComponent(userEmail)}`);
      if (existing && existing.length > 0) {
        await supabase('PATCH', 'chat_sessions',
          { messages, updated_at: new Date().toISOString() },
          `?user_email=eq.${encodeURIComponent(userEmail)}`);
      } else {
        await supabase('POST', 'chat_sessions', {
          user_email: userEmail,
          messages,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return res.json({ saved: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('DB error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
