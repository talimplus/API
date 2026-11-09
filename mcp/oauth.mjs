// Minimal OAuth 2.1 avtorizatsiya serveri (MCP spetsifikatsiyasi bo'yicha) —
// Claude.ai custom connector shuni kutadi: 401 → metadata → dynamic client
// registration → /authorize (parol) → /token (PKCE).
//
// Holatsiz: client_id, code, access/refresh token — hammasi MCP_SECRET bilan
// HMAC-imzolangan. MCP_SECRET almashtirilsa barcha tokenlar o'ladi (revoke).
// Kirish paroli — MCP_LOGIN_PASSWORD (faqat siz bilasiz).

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ACCESS_TTL = 60 * 60; // 1 soat
const REFRESH_TTL = 30 * 24 * 60 * 60; // 30 kun
const CODE_TTL = 5 * 60;
const CLIENT_TTL = 365 * 24 * 60 * 60;

// Faqat shu manzillarga qaytariladi (begona sayt kodni o'g'irlay olmasin).
function redirectAllowed(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:' && ['claude.ai', 'claude.com'].includes(u.hostname)) return true;
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return true; // Claude Code / Desktop
    return false;
  } catch {
    return false;
  }
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

export function createOAuth({ secret, loginPassword, publicUrl }) {
  const key = createHmac('sha256', secret).update('talimplus-mcp-oauth-v1').digest();

  function sign(payload) {
    const body = b64(JSON.stringify(payload));
    const mac = b64(createHmac('sha256', key).update(body).digest());
    return `${body}.${mac}`;
  }

  function verify(token, typ) {
    if (typeof token !== 'string') return null;
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = createHmac('sha256', key).update(body).digest();
    const got = Buffer.from(mac, 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (p.typ !== typ || !(p.exp > now())) return null;
      return p;
    } catch {
      return null;
    }
  }

  // Kod bir martalik bo'lishi uchun (5 daqiqa ichida qayta ishlatib bo'lmaydi)
  const usedCodes = new Map();
  // Parolni terib topishdan himoya: IP bo'yicha 15 daqiqada 5 ta xato
  const failures = new Map();

  function gc() {
    const t = now();
    for (const [k, exp] of usedCodes) if (exp < t) usedCodes.delete(k);
    for (const [k, v] of failures) if (v.until < t) failures.delete(k);
  }

  function baseUrl(req) {
    if (publicUrl) return publicUrl.replace(/\/+$/, '');
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}/mcp`;
  }

  function resourceMetadataUrl(req) {
    const base = new URL(baseUrl(req));
    return `${base.origin}/.well-known/oauth-protected-resource${base.pathname}`;
  }

  function asMetadata(req) {
    const base = baseUrl(req);
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read'],
    };
  }

  function prMetadata(req) {
    const base = baseUrl(req);
    return {
      resource: base,
      authorization_servers: [base],
      scopes_supported: ['read'],
      bearer_methods_supported: ['header'],
      resource_name: 'Talimplus DB (read-only)',
    };
  }

  function issueTokens(clientId) {
    const t = now();
    return {
      access_token: sign({ typ: 'access', cid: clientId, exp: t + ACCESS_TTL, n: b64(randomBytes(6)) }),
      token_type: 'Bearer',
      expires_in: ACCESS_TTL,
      refresh_token: sign({ typ: 'refresh', cid: clientId, exp: t + REFRESH_TTL, n: b64(randomBytes(6)) }),
      scope: 'read',
    };
  }

  function loginPage(params, error) {
    const esc = (s) =>
      String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const hidden = Object.entries(params)
      .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
      .join('');
    return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Talimplus DB — kirish</title>
<style>
body{font-family:system-ui,sans-serif;background:#f4f5f7;margin:0;display:grid;place-items:center;min-height:100vh;color:#1d2433}
form{background:#fff;padding:28px;border-radius:12px;box-shadow:0 2px 12px #0001;width:min(360px,calc(100vw - 32px));box-sizing:border-box}
h1{font-size:19px;margin:0 0 6px}p{color:#5b6475;font-size:14px;margin:0 0 18px;line-height:1.4}
input[type=password]{width:100%;padding:11px;border:1px solid #cfd4dc;border-radius:8px;font-size:15px;box-sizing:border-box}
button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:8px;background:#4b5bdc;color:#fff;font-size:15px;cursor:pointer}
.err{color:#c62828;font-size:14px;margin-bottom:12px}
</style></head><body><form method="post">
<h1>Talimplus DB</h1><p>Claude bazani <b>faqat o'qish</b> uchun ulanmoqda. Ruxsat berish uchun MCP parolini kiriting.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
${hidden}<input type="password" name="password" placeholder="Parol" autofocus required>
<button type="submit">Ruxsat berish</button></form></body></html>`;
  }

  function sendJson(res, status, obj, extra = {}) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
    res.end(JSON.stringify(obj));
  }

  function oauthError(res, status, error, description) {
    sendJson(res, status, { error, error_description: description });
  }

  async function parseForm(req, readBody) {
    const raw = await readBody(req, 64_000);
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) return raw ? JSON.parse(raw) : {};
    return Object.fromEntries(new URLSearchParams(raw));
  }

  /** OAuth yo'llarini ushlaydi. true — javob berildi. */
  async function handle(req, res, url, readBody) {
    const p = url.pathname.replace(/\/+$/, '');

    if (p.startsWith('/.well-known/oauth-protected-resource') || p === '/mcp/.well-known/oauth-protected-resource') {
      sendJson(res, 200, prMetadata(req), { 'access-control-allow-origin': '*' });
      return true;
    }
    if (
      p.startsWith('/.well-known/oauth-authorization-server') ||
      p.startsWith('/.well-known/openid-configuration') ||
      p === '/mcp/.well-known/oauth-authorization-server' ||
      p === '/mcp/.well-known/openid-configuration'
    ) {
      sendJson(res, 200, asMetadata(req), { 'access-control-allow-origin': '*' });
      return true;
    }

    if (p === '/mcp/oauth/register' && req.method === 'POST') {
      const body = await parseForm(req, readBody).catch(() => null);
      const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
      if (!uris.length || !uris.every(redirectAllowed)) {
        oauthError(res, 400, 'invalid_redirect_uri', 'redirect_uri is not allowed');
        return true;
      }
      const issued = now();
      const clientId = sign({ typ: 'client', r: uris, exp: issued + CLIENT_TTL });
      console.log(`[oauth] client registered: ${body.client_name || '?'} -> ${uris.join(', ')}`);
      sendJson(res, 201, {
        client_id: clientId,
        client_id_issued_at: issued,
        client_name: body.client_name,
        redirect_uris: uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
      return true;
    }

    if (p === '/mcp/oauth/authorize' && (req.method === 'GET' || req.method === 'POST')) {
      const q = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await parseForm(req, readBody);
      const client = verify(q.client_id, 'client');
      const redirectUri = q.redirect_uri;
      // redirect_uri ishonchsiz bo'lsa unga qaytarmaymiz — xatoni shu yerda ko'rsatamiz
      if (!client || !redirectUri || !client.r.includes(redirectUri) || !redirectAllowed(redirectUri)) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid client_id or redirect_uri');
        return true;
      }
      const back = (params) => {
        const u = new URL(redirectUri);
        for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
        res.writeHead(302, { location: u.toString(), 'cache-control': 'no-store' }).end();
      };
      if (q.response_type !== 'code') {
        back({ error: 'unsupported_response_type', state: q.state });
        return true;
      }
      if (!q.code_challenge || (q.code_challenge_method || 'plain') !== 'S256') {
        back({ error: 'invalid_request', error_description: 'PKCE S256 required', state: q.state });
        return true;
      }
      const params = {
        response_type: 'code',
        client_id: q.client_id,
        redirect_uri: redirectUri,
        code_challenge: q.code_challenge,
        code_challenge_method: 'S256',
        state: q.state ?? '',
        scope: q.scope ?? '',
        resource: q.resource ?? '',
      };
      const html = (status, err) =>
        res
          .writeHead(status, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-frame-options': 'DENY',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai https://claude.com http://localhost:* http://127.0.0.1:*",
          })
          .end(loginPage(params, err));

      if (req.method === 'GET') {
        html(200);
        return true;
      }

      gc();
      const ip = (req.headers['x-real-ip'] || req.socket.remoteAddress || '?').toString();
      const f = failures.get(ip);
      if (f && f.count >= 5 && f.until > now()) {
        html(429, "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring.");
        return true;
      }
      const a = Buffer.from(String(q.password ?? ''));
      const b = Buffer.from(loginPassword);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        failures.set(ip, { count: (f?.count ?? 0) + 1, until: now() + 15 * 60 });
        console.log(`[oauth] wrong password from ${ip}`);
        html(401, "Parol noto'g'ri.");
        return true;
      }
      failures.delete(ip);
      const code = sign({
        typ: 'code',
        cid: q.client_id,
        r: redirectUri,
        cc: q.code_challenge,
        exp: now() + CODE_TTL,
        n: b64(randomBytes(9)),
      });
      console.log(`[oauth] authorized from ${ip}`);
      back({ code, state: q.state || undefined });
      return true;
    }

    if (p === '/mcp/oauth/token' && req.method === 'POST') {
      const body = await parseForm(req, readBody).catch(() => ({}));
      if (body.grant_type === 'authorization_code') {
        const code = verify(body.code, 'code');
        if (!code || usedCodes.has(code.n)) return oauthError(res, 400, 'invalid_grant', 'code invalid or expired'), true;
        if (body.client_id && body.client_id !== code.cid) return oauthError(res, 400, 'invalid_grant', 'client mismatch'), true;
        if (body.redirect_uri && body.redirect_uri !== code.r) return oauthError(res, 400, 'invalid_grant', 'redirect_uri mismatch'), true;
        const challenge = createHash('sha256').update(String(body.code_verifier ?? '')).digest('base64url');
        if (challenge !== code.cc) return oauthError(res, 400, 'invalid_grant', 'PKCE verification failed'), true;
        gc();
        usedCodes.set(code.n, code.exp);
        sendJson(res, 200, issueTokens(code.cid));
        return true;
      }
      if (body.grant_type === 'refresh_token') {
        const rt = verify(body.refresh_token, 'refresh');
        if (!rt || !verify(rt.cid, 'client')) return oauthError(res, 400, 'invalid_grant', 'refresh token invalid'), true;
        sendJson(res, 200, issueTokens(rt.cid));
        return true;
      }
      oauthError(res, 400, 'unsupported_grant_type', 'unsupported grant_type');
      return true;
    }

    return false;
  }

  function checkBearer(req) {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return false;
    return Boolean(verify(h.slice(7).trim(), 'access'));
  }

  function challenge(req) {
    return `Bearer resource_metadata="${resourceMetadataUrl(req)}", scope="read"`;
  }

  return { handle, checkBearer, challenge };
}
