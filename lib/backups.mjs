import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const ARCHIVE_VERSION = 1;
const TOKEN_TTL_MS = 5 * 60 * 1000;
const RETAINED_MANAGED_BACKUPS = 7;
const MANAGED_KINDS = new Set(['automatic', 'pre_restore']);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead = 0;
    let position = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead) {
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
    } while (bytesRead);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function toArchivePath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error('invalid archive path');
  }
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('invalid archive path');
  }
  return normalized;
}

function resolveInside(root, relativePath) {
  const safePath = toArchivePath(relativePath);
  const resolved = path.resolve(root, ...safePath.split('/'));
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error('archive path escapes target directory');
  }
  return resolved;
}

function walkFiles(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, relative));
    } else if (entry.isFile()) {
      files.push({ relative: toArchivePath(relative), fullPath });
    } else {
      throw new Error(`unsupported backup entry: ${relative}`);
    }
  }
  return files;
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) {
    ensureDir(destination);
    return;
  }
  ensureDir(destination);
  for (const item of walkFiles(source)) {
    const target = resolveInside(destination, item.relative);
    ensureDir(path.dirname(target));
    fs.copyFileSync(item.fullPath, target);
  }
}

function compactError(error) {
  return String(error?.message || error || 'backup failed').slice(0, 300);
}

function backupId(kind, now) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${kind}-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function shanghaiParts(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const values = Object.fromEntries(formatter.formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function safeManifestSummary(manifest, archivePath) {
  const stat = fs.statSync(archivePath);
  return {
    id: manifest.id,
    kind: manifest.kind,
    created_at: manifest.created_at,
    shanghai_date: manifest.shanghai_date || null,
    status: 'ready',
    archive_bytes: stat.size,
    archive_sha256: sha256File(archivePath),
    statistics: manifest.statistics || {},
  };
}

function readManifest(zip) {
  const entry = zip.getEntry('manifest.json');
  if (!entry) throw new Error('backup manifest missing');
  let manifest;
  try {
    manifest = JSON.parse(entry.getData().toString('utf8'));
  } catch {
    throw new Error('backup manifest is invalid');
  }
  if (manifest?.format !== 'coread-library-backup' || manifest.version !== ARCHIVE_VERSION) {
    throw new Error('unsupported backup format');
  }
  if (!Array.isArray(manifest.files) || !manifest.id || !manifest.kind) {
    throw new Error('backup manifest is incomplete');
  }
  return manifest;
}

function removePath(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
  else fs.unlinkSync(target);
}

function validateManifestFiles(manifest) {
  const expected = new Map();
  for (const item of manifest.files) {
    if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/i.test(String(item.sha256 || ''))) {
      throw new Error('backup manifest file entry is invalid');
    }
    const archivePath = toArchivePath(item.path);
    if (archivePath === 'manifest.json' || expected.has(archivePath)) {
      throw new Error('backup manifest contains duplicate paths');
    }
    expected.set(archivePath, { sha256: String(item.sha256), bytes: Number(item.bytes) });
  }
  if (!expected.has('database/coread.db')) throw new Error('backup database snapshot is missing');
  return expected;
}

export class BackupService {
  constructor({ dbPath, now = () => new Date() }) {
    if (!dbPath) throw new Error('dbPath is required');
    this.dbPath = path.resolve(dbPath);
    this.dataDir = path.dirname(this.dbPath);
    this.backupsDir = path.join(this.dataDir, 'backups');
    this.now = now;
    this.tokens = new Map();
    this.maintenance = false;
    this.creating = false;
    this.scheduler = null;
    ensureDir(this.backupsDir);
  }

  isMaintenance() {
    return this.maintenance;
  }

  archivePathFor(id) {
    if (!/^[a-z_]+-\d{14}-[a-f0-9]{8}$/.test(String(id || ''))) {
      throw new Error('invalid backup id');
    }
    return path.join(this.backupsDir, `${id}.zip`);
  }

  listBackups() {
    ensureDir(this.backupsDir);
    const entries = [];
    for (const name of fs.readdirSync(this.backupsDir)) {
      if (!name.endsWith('.zip')) continue;
      const archivePath = path.join(this.backupsDir, name);
      try {
        const manifest = readManifest(new AdmZip(archivePath));
        entries.push(safeManifestSummary(manifest, archivePath));
      } catch (error) {
        entries.push({
          id: path.basename(name, '.zip'),
          kind: 'unknown',
          created_at: null,
          status: 'invalid',
          archive_bytes: fs.statSync(archivePath).size,
          error: compactError(error),
        });
      }
    }
    return entries.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }

  async createBackup({ kind = 'manual' } = {}) {
    if (!['manual', 'automatic', 'pre_restore'].includes(kind)) {
      throw new Error('invalid backup kind');
    }
    if (this.creating) throw new Error('backup already in progress');
    if (!fs.existsSync(this.dbPath)) throw new Error('database not found');

    this.creating = true;
    const now = this.now();
    const id = backupId(kind, now);
    const staging = fs.mkdtempSync(path.join(this.backupsDir, '.create-'));
    const archivePath = this.archivePathFor(id);
    const temporaryArchivePath = `${archivePath}.tmp`;
    try {
      const databaseDir = path.join(staging, 'database');
      const booksDir = path.join(staging, 'books');
      const imagesDir = path.join(staging, 'book-images');
      ensureDir(databaseDir);
      ensureDir(booksDir);
      ensureDir(imagesDir);

      const sourceDb = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      try {
        await sourceDb.backup(path.join(databaseDir, 'coread.db'));
      } finally {
        sourceDb.close();
      }

      copyDirectory(path.join(this.dataDir, 'books'), booksDir);
      copyDirectory(path.join(this.dataDir, 'book-images'), imagesDir);

      const files = walkFiles(staging).map(item => ({
        path: toArchivePath(item.relative),
        bytes: fs.statSync(item.fullPath).size,
        sha256: sha256File(item.fullPath),
      })).sort((a, b) => a.path.localeCompare(b.path));

      const snapshotDb = new Database(path.join(databaseDir, 'coread.db'), { readonly: true, fileMustExist: true });
      let statistics;
      try {
        statistics = {
          books: Number(snapshotDb.prepare('SELECT COUNT(*) AS count FROM books').get().count || 0),
          soft_deleted_books: Number(snapshotDb.prepare('SELECT COUNT(*) AS count FROM books WHERE deleted_at IS NOT NULL').get().count || 0),
          paragraphs: Number(snapshotDb.prepare('SELECT COUNT(*) AS count FROM book_paragraphs').get().count || 0),
          comments: Number(snapshotDb.prepare('SELECT COUNT(*) AS count FROM book_comments').get().count || 0),
        };
      } finally {
        snapshotDb.close();
      }

      const manifest = {
        format: 'coread-library-backup',
        version: ARCHIVE_VERSION,
        id,
        kind,
        created_at: now.toISOString(),
        shanghai_date: shanghaiParts(now).date,
        statistics,
        files,
      };
      const zip = new AdmZip();
      for (const file of files) {
        zip.addFile(file.path, fs.readFileSync(resolveInside(staging, file.path)));
      }
      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
      zip.writeZip(temporaryArchivePath);
      fs.renameSync(temporaryArchivePath, archivePath);
      this.pruneManagedBackups();
      return safeManifestSummary(manifest, archivePath);
    } finally {
      removePath(temporaryArchivePath);
      removePath(staging);
      this.creating = false;
    }
  }

  pruneManagedBackups() {
    const backups = this.listBackups();
    for (const kind of MANAGED_KINDS) {
      const stale = backups.filter(item => item.kind === kind && item.status === 'ready').slice(RETAINED_MANAGED_BACKUPS);
      for (const backup of stale) {
        removePath(this.archivePathFor(backup.id));
      }
    }
  }

  readArchive(id) {
    const archivePath = this.archivePathFor(id);
    if (!fs.existsSync(archivePath)) throw new Error('backup not found');
    const zip = new AdmZip(archivePath);
    const manifest = readManifest(zip);
    if (manifest.id !== id) throw new Error('backup id does not match manifest');
    return { archivePath, archiveSha256: sha256File(archivePath), zip, manifest };
  }

  extractAndValidate(id) {
    const { archivePath, archiveSha256, zip, manifest } = this.readArchive(id);
    const expected = validateManifestFiles(manifest);
    const entryNames = new Set();
    for (const entry of zip.getEntries()) {
      const entryName = toArchivePath(entry.entryName.replace(/\/+$/, ''));
      if (entryNames.has(entryName)) throw new Error('backup archive contains duplicate paths');
      entryNames.add(entryName);
      if (entryName !== 'manifest.json' && !expected.has(entryName) && !entry.isDirectory) {
        throw new Error('backup archive contains unlisted files');
      }
    }
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'coread-restore-'));
    try {
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || entry.entryName === 'manifest.json') continue;
        const target = resolveInside(staging, entry.entryName);
        ensureDir(path.dirname(target));
        fs.writeFileSync(target, entry.getData());
      }
      for (const [relativePath, expectedFile] of expected) {
        const target = resolveInside(staging, relativePath);
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
          throw new Error(`backup file missing: ${relativePath}`);
        }
        const stat = fs.statSync(target);
        if (stat.size !== expectedFile.bytes || sha256File(target) !== expectedFile.sha256) {
          throw new Error(`backup file checksum mismatch: ${relativePath}`);
        }
      }
      const snapshotPath = resolveInside(staging, 'database/coread.db');
      const snapshotDb = new Database(snapshotPath, { readonly: true, fileMustExist: true });
      try {
        const integrity = snapshotDb.pragma('integrity_check', { simple: true });
        if (integrity !== 'ok') throw new Error('backup database integrity check failed');
      } finally {
        snapshotDb.close();
      }
      return {
        archivePath,
        archiveSha256,
        manifest,
        staging,
      };
    } catch (error) {
      removePath(staging);
      throw error;
    }
  }

  preflightRestore(id) {
    const validated = this.extractAndValidate(id);
    try {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(this.now().getTime() + TOKEN_TTL_MS);
      this.tokens.set(token, {
        id,
        archiveSha256: validated.archiveSha256,
        expiresAt: expiresAt.getTime(),
        used: false,
      });
      this.clearExpiredTokens();
      return {
        backup: safeManifestSummary(validated.manifest, validated.archivePath),
        confirmation_token: token,
        expires_at: expiresAt.toISOString(),
        scope: 'full_library',
        warning: 'This restores the complete library. Per-book restore is not available in stage 6.',
      };
    } finally {
      removePath(validated.staging);
    }
  }

  async restore(id, confirmationToken) {
    const token = this.tokens.get(String(confirmationToken || ''));
    if (!token || token.id !== id || token.used || token.expiresAt < this.now().getTime()) {
      throw new Error('restore confirmation token is invalid or expired');
    }
    const currentArchive = this.readArchive(id);
    if (currentArchive.archiveSha256 !== token.archiveSha256) {
      throw new Error('backup changed after preflight');
    }
    if (this.maintenance) throw new Error('restore already in progress');

    this.maintenance = true;
    token.used = true;
    let validated = null;
    try {
      const preRestore = await this.createBackup({ kind: 'pre_restore' });
      validated = this.extractAndValidate(id);
      this.replaceLibraryFrom(validated.staging);
      return {
        ok: true,
        restored_backup: safeManifestSummary(validated.manifest, validated.archivePath),
        pre_restore_backup: preRestore,
        scope: 'full_library',
      };
    } finally {
      if (validated) removePath(validated.staging);
      this.maintenance = false;
      this.clearExpiredTokens();
    }
  }

  replaceLibraryFrom(staging) {
    const databaseSidecars = [`${this.dbPath}-wal`, `${this.dbPath}-shm`];
    const replacements = [
      {
        target: this.dbPath,
        source: resolveInside(staging, 'database/coread.db'),
        directory: false,
      },
      {
        target: path.join(this.dataDir, 'books'),
        source: resolveInside(staging, 'books'),
        directory: true,
      },
      {
        target: path.join(this.dataDir, 'book-images'),
        source: resolveInside(staging, 'book-images'),
        directory: true,
      },
    ];
    for (const item of replacements) {
      if (!fs.existsSync(item.source)) {
        if (item.directory) ensureDir(item.source);
        else throw new Error('backup database snapshot is missing');
      }
    }

    const rollbackDir = fs.mkdtempSync(path.join(this.dataDir, '.restore-rollback-'));
    const moved = [];
    const installed = [];
    try {
      for (let index = 0; index < replacements.length; index += 1) {
        const item = replacements[index];
        const oldTarget = path.join(rollbackDir, String(index));
        if (fs.existsSync(item.target)) {
          fs.renameSync(item.target, oldTarget);
          moved.push({ target: item.target, oldTarget });
        }
      }
      for (const sidecar of databaseSidecars) {
        const oldTarget = path.join(rollbackDir, `sidecar-${path.basename(sidecar)}`);
        if (fs.existsSync(sidecar)) {
          fs.renameSync(sidecar, oldTarget);
          moved.push({ target: sidecar, oldTarget });
        }
      }
      for (const item of replacements) {
        ensureDir(path.dirname(item.target));
        fs.renameSync(item.source, item.target);
        installed.push(item.target);
      }
    } catch (error) {
      for (const target of installed.reverse()) removePath(target);
      for (const item of moved.reverse()) {
        ensureDir(path.dirname(item.target));
        if (fs.existsSync(item.oldTarget)) fs.renameSync(item.oldTarget, item.target);
      }
      throw error;
    } finally {
      removePath(rollbackDir);
    }
  }

  clearExpiredTokens() {
    const now = this.now().getTime();
    for (const [token, value] of this.tokens) {
      if (value.used || value.expiresAt < now) this.tokens.delete(token);
    }
  }

  async catchUpAutomaticBackup() {
    const local = shanghaiParts(this.now());
    if (local.hour < 3 || (local.hour === 3 && local.minute < 30)) return null;
    const todayBackup = this.listBackups().find(item =>
      item.kind === 'automatic' && item.shanghai_date === local.date);
    if (todayBackup) return todayBackup;
    return this.createBackup({ kind: 'automatic' });
  }

  startScheduler() {
    if (this.scheduler) return;
    this.catchUpAutomaticBackup().catch(error => {
      console.error(`Coread automatic backup failed: ${compactError(error)}`);
    });
    this.scheduler = setInterval(() => {
      this.catchUpAutomaticBackup().catch(error => {
        console.error(`Coread automatic backup failed: ${compactError(error)}`);
      });
    }, 60 * 1000);
    this.scheduler.unref?.();
  }

  stopScheduler() {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
  }
}

export function createBackupService(options) {
  return new BackupService(options);
}
