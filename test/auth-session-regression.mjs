import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthSessionStore } from '../lib/auth-sessions.mjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coread-auth-session-'));
const sessionPath = path.join(tempDir, 'auth-sessions.json');
const fixturePassword = 'local-regression-password';
let now = 1_800_000_000_000;

try {
  const firstStore = createAuthSessionStore({
    filePath: sessionPath,
    password: fixturePassword,
    ttlMs: 60_000,
    now: () => now,
  });
  const firstSession = firstStore.create();
  assert.ok(firstSession?.token);
  assert.equal(firstStore.has(firstSession.token), true);

  const storedText = fs.readFileSync(sessionPath, 'utf8');
  assert.equal(storedText.includes(firstSession.token), false);
  assert.equal(storedText.includes(fixturePassword), false);

  const restartedStore = createAuthSessionStore({
    filePath: sessionPath,
    password: fixturePassword,
    ttlMs: 60_000,
    now: () => now,
  });
  assert.equal(restartedStore.has(firstSession.token), true);

  const changedPasswordStore = createAuthSessionStore({
    filePath: sessionPath,
    password: `${fixturePassword}-changed`,
    ttlMs: 60_000,
    now: () => now,
  });
  assert.equal(changedPasswordStore.has(firstSession.token), false);

  assert.equal(restartedStore.delete(firstSession.token), true);
  assert.equal(restartedStore.has(firstSession.token), false);

  const expiringSession = restartedStore.create();
  assert.ok(expiringSession?.token);
  now += 60_001;
  assert.equal(restartedStore.has(expiringSession.token), false);

  const passwordlessStore = createAuthSessionStore({
    filePath: path.join(tempDir, 'unused.json'),
    password: '',
    now: () => now,
  });
  assert.equal(passwordlessStore.has('anything'), true);
  assert.equal(passwordlessStore.create(), null);

  console.log('auth session regression passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
