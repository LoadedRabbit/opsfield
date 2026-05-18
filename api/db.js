// api/db.js — Clerk-authenticated version
// Verifies Clerk session JWT (RS256, JWKS) before touching Supabase.
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLERK_SECRET_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── CLERK JWT VERIFICATION (pure Web Crypto — no npm needed) ──────────────
// JWKS and email are cached for the lifetime of the warm function instance.
let _jwksKeys = null;
let _jwksTs   = 0;
const _emailCache = new Map(); // clerk user_id → email

async function verifyClerkToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header  = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;

    // Refresh JWKS at most once per hour
    if (!_jwksKeys || Date.now() - _jwksTs > 3_600_000) {
      const r = await fetch(`${payload.iss}/.well-known/jwks.json`);
      if (!r.ok) return null;
      _jwksKeys = (await r.json()).keys;
      _jwksTs   = Date.now();
    }
    const jwk = _jwksKeys.find(k => k.kid === header.kid);
    if (!jwk) return null;

    const key    = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig    = Buffer.from(parts[2], 'base64url');
    const valid  = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
    return valid ? payload : null;
  } catch { return null; }
}

async function resolveEmail(userId) {
  if (_emailCache.has(userId)) return _emailCache.get(userId);
  const r = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` }
  });
  if (!r.ok) return null;
  const user = await r.json();
  const primary = user.email_addresses?.find(e => e.id === user.primary_email_address_id);
  const email   = primary?.email_address ?? user.email_addresses?.[0]?.email_address ?? null;
  if (email) _emailCache.set(userId, email);
  return email;
}

// ── SUPABASE HELPER ───────────────────────────────────────────────────────
async function supabase(method, table, body = null, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${table}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── HANDLER ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY)
    return res.status(500).json({ error: 'Supabase not configured.' });
  if (!process.env.CLERK_SECRET_KEY)
    return res.status(500).json({ error: 'CLERK_SECRET_KEY not configured.' });

  // Every request must carry a valid Clerk session token
  const payload = await verifyClerkToken(req.headers.authorization);
  if (!payload) return res.status(401).json({ error: 'Unauthorized — valid Clerk session required.' });

  const userEmail = await resolveEmail(payload.sub);
  if (!userEmail) return res.status(401).json({ error: 'Could not resolve user identity.' });

  const { action } = req.query;

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
        user_email: userEmail, name, sliders, created_at: new Date().toISOString(),
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
        const data = await supabase('PATCH', 'notes',
          { title, content, updated_at: new Date().toISOString() },
          `?id=eq.${id}&user_email=eq.${encodeURIComponent(userEmail)}`);
        return res.json(data?.[0] || {});
      }
      const data = await supabase('POST', 'notes', {
        user_email: userEmail, title, content,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      return res.json(data?.[0] || {});
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
      const existing = await supabase('GET', 'chat_sessions', null,
        `?user_email=eq.${encodeURIComponent(userEmail)}`);
      if (existing?.length > 0) {
        await supabase('PATCH', 'chat_sessions',
          { messages, updated_at: new Date().toISOString() },
          `?user_email=eq.${encodeURIComponent(userEmail)}`);
      } else {
        await supabase('POST', 'chat_sessions', {
          user_email: userEmail, messages,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
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
