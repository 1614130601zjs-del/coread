import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const DEFAULT_AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createAuthSessionStore({
  filePath,
  password,
  ttlMs = DEFAULT_AUTH_SESSION_TTL_MS,
  now = () => Date.now(),
}) {
  const sessions = new Map();

  const tokenDigest = token => crypto
    .createHmac('sha256', password)
    .update(String(token || ''))
    .digest('hex');

  const pruneExpired = () => {
    const currentTime = now();
    let changed = false;
    for (const [digest, expiresAt] of sessions) {
      if (expiresAt <= currentTime) {
        sessions.delete(digest);
        changed = true;
      }
    }
    return changed;
  };

  const persist = () => {
    if (!password || !filePath) return;
    pruneExpired();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const payload = {
      version: 1,
      sessions: [...sessions].map(([digest, expiresAt]) => ({ digest, expiresAt })),
    };
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, filePath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  };

  if (password && filePath && fs.existsSync(filePath)) {
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const item of Array.isArray(payload?.sessions) ? payload.sessions : []) {
        const digest = String(item?.digest || '');
        const expiresAt = Number(item?.expiresAt);
        if (/^[a-f0-9]{64}$/i.test(digest) && Number.isFinite(expiresAt) && expiresAt > now()) {
          sessions.set(digest, expiresAt);
        }
      }
    } catch {
      // A damaged session file should log everyone out, not prevent Coread from starting.
    }
  }

  return {
    ttlMs,
    create() {
      if (!password) return null;
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = now() + ttlMs;
      sessions.set(tokenDigest(token), expiresAt);
      persist();
      return { token, expiresAt };
    },
    has(token) {
      if (!password) return true;
      if (!token) return false;
      const digest = tokenDigest(token);
      const expiresAt = sessions.get(digest);
      if (!expiresAt) return false;
      if (expiresAt <= now()) {
        sessions.delete(digest);
        persist();
        return false;
      }
      return true;
    },
    delete(token) {
      if (!password || !token) return false;
      const deleted = sessions.delete(tokenDigest(token));
      if (deleted) persist();
      return deleted;
    },
    size() {
      if (pruneExpired()) persist();
      return sessions.size;
    },
  };
}
