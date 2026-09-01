import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { initDb, getDb } from './lib/db.mjs';
import { handleRequest, recoverInterruptedReadingTasks } from './lib/routes.mjs';
import { createBackupService } from './lib/backups.mjs';
import { createAuthSessionStore } from './lib/auth-sessions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.COREAD_PORT || '3000');
const HOST = process.env.COREAD_HOST || '127.0.0.1';
const DB_PATH = process.env.COREAD_DB || path.join(process.cwd(), 'data', 'coread.db');

// Optional comment notifier: run an arbitrary command whenever someone comments.
// COREAD_NOTIFY_CMD  — shell command to execute (comment details passed via env vars)
// COREAD_NOTIFY_FROM — only fire for this author (default 'human'; '*' = everyone)
// Env vars available to the command:
//   COREAD_BOOK_ID, COREAD_BOOK_TITLE, COREAD_FROM, COREAD_COMMENT
const NOTIFY_CMD = process.env.COREAD_NOTIFY_CMD || '';
const NOTIFY_FROM = process.env.COREAD_NOTIFY_FROM || 'human';
const COREAD_PASSWORD = process.env.COREAD_PASSWORD || '';
const AUTH_SESSION_PATH = process.env.COREAD_AUTH_SESSIONS
  || path.join(path.dirname(DB_PATH), 'auth-sessions.json');
const authSessions = createAuthSessionStore({
  filePath: AUTH_SESSION_PATH,
  password: COREAD_PASSWORD,
});

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && value) out[key] = decodeURIComponent(value);
  }
  return out;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function authRequired(req) {
  if (!COREAD_PASSWORD) return false;
  // The login page and its static assets must load before a session exists.
  if (!req.url?.startsWith('/v1/')) return false;
  if (req.url === '/v1/auth/login' || req.url === '/v1/auth/me' || req.url === '/health' || req.url?.startsWith('/v1/book-images/')) return false;
  return !hasSession(req);
}

function hasSession(req) {
  return authSessions.has(parseCookies(req).coread_session);
}

function requestIsSecure(req) {
  if (req.socket?.encrypted) return true;
  return String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase() === 'https';
}

function sessionCookie(req, token, maxAgeSeconds) {
  const attributes = [
    `coread_session=${encodeURIComponent(token)}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
  ];
  if (requestIsSecure(req)) attributes.push('Secure');
  return attributes.join('; ');
}

function notifyComment({ book_id, from_who, content }) {
  if (!NOTIFY_CMD) return;
  if (NOTIFY_FROM !== '*' && from_who !== NOTIFY_FROM) return;
  let title = `book#${book_id}`;
  try {
    const db = getDb(true);
    title = db.prepare('SELECT title FROM books WHERE id = ?').get(book_id)?.title || title;
    db.close();
  } catch {}
  execFile('/bin/sh', ['-c', NOTIFY_CMD], {
    timeout: 15000,
    env: {
      ...process.env,
      COREAD_BOOK_ID: String(book_id),
      COREAD_BOOK_TITLE: title,
      COREAD_FROM: from_who,
      COREAD_COMMENT: content || '',
    },
  }, (err) => { if (err) console.error('notify cmd error:', err.message); });
}

initDb(DB_PATH);
const backups = createBackupService({ dbPath: DB_PATH });
backups.startScheduler();
const taskRecovery = recoverInterruptedReadingTasks();
if (taskRecovery.resumed_task_ids.length) {
  console.log(`resuming Coread reading tasks: ${taskRecovery.resumed_task_ids.join(', ')}`);
}

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'coread' }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/auth/login') {
    try {
      const body = await readJson(req);
      if (!COREAD_PASSWORD || String(body.password || '') === COREAD_PASSWORD) {
        const session = authSessions.create();
        const headers = { 'Content-Type': 'application/json' };
        if (session) {
          headers['Set-Cookie'] = sessionCookie(
            req,
            session.token,
            Math.floor(authSessions.ttlMs / 1000),
          );
        }
        res.writeHead(200, headers);
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid password' }));
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid json' }));
    }
    return;
  }
  if (req.method === 'GET' && req.url === '/v1/auth/me') {
    const authenticated = hasSession(req);
    res.writeHead(authenticated ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authenticated }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/auth/logout') {
    const token = parseCookies(req).coread_session;
    authSessions.delete(token);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(req, '', 0),
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (authRequired(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'login required' }));
    return;
  }
  const handled = await handleRequest(req, res, {
    port: PORT,
    onComment: notifyComment,
    authenticated: hasSession(req),
    backups,
  });
  if (handled) return;

  // Serve static files from public/
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath) && !path.extname(filePath)) {
    filePath = path.join(__dirname, 'public', 'index.html');
  }
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const requestPath = req.url.split('?')[0];
    const cacheControl = requestPath.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : path.basename(filePath) === 'index.html'
        ? 'no-cache'
        : 'public, max-age=3600';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl,
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  📚 coread server running at http://${HOST}:${PORT}`);
  console.log(`  📂 Database: ${DB_PATH}`);
  console.log(`  🌐 Open http://localhost:${PORT} in your browser\n`);
});
