import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let dbPath = null;

export function initDb(customPath) {
  dbPath = customPath || path.join(process.cwd(), 'data', 'coread.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      total_paragraphs INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      cover_image TEXT,
      category TEXT DEFAULT '待看',
      tags_json TEXT DEFAULT '[]',
      note TEXT DEFAULT '',
      source_format TEXT DEFAULT 'text',
      source_encoding TEXT DEFAULT 'utf-8',
      source_path TEXT,
      deleted_at DATETIME,
      cache_version INTEGER NOT NULL DEFAULT 1,
      comment_version INTEGER NOT NULL DEFAULT 1,
      chapter_rule_json TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS book_paragraphs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS book_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      paragraph_idx INTEGER NOT NULL,
      sel_start_idx INTEGER,
      sel_end_idx INTEGER,
      sel_end_para_idx INTEGER,
      selected_text TEXT,
      from_who TEXT DEFAULT 'human',
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      reply_to INTEGER,
      event_id INTEGER,
      thread_key TEXT,
      source_label TEXT DEFAULT 'human',
      is_favorite INTEGER DEFAULT 0,
      annotation_kind TEXT DEFAULT 'comment',
      dedupe_key TEXT
    );
    CREATE TABLE IF NOT EXISTS book_progress (
      book_id INTEGER PRIMARY KEY,
      page INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS book_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      start_idx INTEGER NOT NULL,
      end_idx INTEGER NOT NULL,
      UNIQUE(book_id, chapter_no)
    );
    CREATE TABLE IF NOT EXISTS book_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_no INTEGER,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      model TEXT,
      locked INTEGER DEFAULT 0,
      event_id INTEGER,
      source_composition TEXT,
      version INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS book_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_no INTEGER NOT NULL DEFAULT 0,
      event_id INTEGER,
      lineage_id INTEGER,
      supersedes_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      importance INTEGER NOT NULL DEFAULT 3,
      operation TEXT NOT NULL DEFAULT 'create',
      fact_type TEXT NOT NULL,
      key_name TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      revision_chapter INTEGER,
      revision_reason TEXT,
      source_evidence TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS book_reading_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_no INTEGER NOT NULL DEFAULT 0,
      context_kind TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'human',
      version INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(book_id, chapter_no, context_kind)
    );
    CREATE TABLE IF NOT EXISTS chapter_comment_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_no INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'main',
      event_id INTEGER,
      request_key TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(book_id, chapter_no, version)
    );
    CREATE TABLE IF NOT EXISTS comment_summary_overviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      block_start INTEGER NOT NULL,
      block_end INTEGER NOT NULL,
      content TEXT NOT NULL,
      source_version TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(book_id, block_start)
    );
    CREATE TABLE IF NOT EXISTS reading_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      start_chapter INTEGER NOT NULL,
      end_chapter INTEGER NOT NULL,
      review_mode TEXT DEFAULT 'layered',
      request_key TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      current_chapter INTEGER,
      budget_tokens INTEGER,
      spent_tokens INTEGER DEFAULT 0,
      spent_output_tokens INTEGER DEFAULT 0,
      reserved_input_tokens INTEGER DEFAULT 0,
      model_role TEXT NOT NULL DEFAULT 'main',
      requested_concurrency INTEGER NOT NULL DEFAULT 1,
      estimated_input_tokens INTEGER DEFAULT 0,
      estimated_output_tokens INTEGER DEFAULT 0,
      budget_confirmed INTEGER DEFAULT 0,
      soft_limit_tokens INTEGER,
      hard_limit_tokens INTEGER,
      consecutive_failures INTEGER DEFAULT 0,
      pause_reason TEXT,
      completed_at DATETIME,
      error TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reading_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_no INTEGER NOT NULL,
      task_id INTEGER,
      review_mode TEXT NOT NULL DEFAULT 'layered',
      source TEXT NOT NULL DEFAULT 'main',
      status TEXT NOT NULL DEFAULT 'running',
      content_hash TEXT,
      prompt_version TEXT NOT NULL DEFAULT 'stage3-v1',
      created_at DATETIME DEFAULT (datetime('now')),
      completed_at DATETIME,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS book_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_no INTEGER NOT NULL,
      event_id INTEGER,
      from_who TEXT NOT NULL,
      content TEXT NOT NULL,
      source_label TEXT DEFAULT 'human',
      reply_to INTEGER,
      dedupe_key TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reading_task_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      chapter_no INTEGER NOT NULL,
      event_id INTEGER,
      status TEXT NOT NULL DEFAULT 'queued',
      result_json TEXT,
      error TEXT,
      source_hash TEXT,
      idempotency_key TEXT,
      attempts INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      reserved_input_tokens INTEGER DEFAULT 0,
      usage_estimated INTEGER DEFAULT 0,
      source TEXT,
      model TEXT,
      skip_reason TEXT,
      next_retry_at DATETIME,
      request_started_at DATETIME,
      completed_at DATETIME,
      updated_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(task_id, chapter_no)
    );
    CREATE TABLE IF NOT EXISTS reading_task_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      item_id INTEGER,
      chapter_no INTEGER NOT NULL,
      attempt_no INTEGER NOT NULL,
      model_role TEXT NOT NULL,
      source TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      estimated INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      error TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS book_reading_impressions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_start INTEGER,
      chapter_end INTEGER,
      content TEXT NOT NULL,
      source_label TEXT NOT NULL DEFAULT 'human',
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );
  `);
  // 第三阶段需要保留同章多次阅读的摘要历史。旧版的唯一约束会覆盖重读，
  // 因此只在旧表仍带有该约束时做一次兼容迁移。
  const summaryColumns = db.prepare('PRAGMA table_info(book_summaries)').all().map(c => c.name);
  const summaryIndexes = db.prepare('PRAGMA index_list(book_summaries)').all();
  if (!summaryColumns.includes('event_id') || summaryIndexes.some(index => index.unique && String(index.name).includes('sqlite_autoindex_book_summaries'))) {
    db.exec(`
      ALTER TABLE book_summaries RENAME TO book_summaries_legacy_stage3;
      CREATE TABLE book_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        chapter_no INTEGER,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        model TEXT,
        locked INTEGER DEFAULT 0,
        event_id INTEGER,
        version INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT (datetime('now')),
        updated_at DATETIME DEFAULT (datetime('now'))
      );
      INSERT INTO book_summaries
        (id, book_id, chapter_no, kind, text, source, model, locked, version, created_at, updated_at)
      SELECT id, book_id, chapter_no, kind, text, source, model, locked, 1, created_at, updated_at
      FROM book_summaries_legacy_stage3;
      DROP TABLE book_summaries_legacy_stage3;
    `);
  }
  const factColumns = db.prepare('PRAGMA table_info(book_facts)').all().map(c => c.name);
  if (!factColumns.includes('chapter_no') || !factColumns.includes('event_id') || !factColumns.includes('lineage_id')) {
    const legacyFactChapter = factColumns.includes('chapter_no')
      ? 'CASE WHEN chapter_no IS NULL THEN 0 ELSE chapter_no END'
      : '0';
    const legacyFactEvent = factColumns.includes('event_id') ? 'event_id' : 'NULL';
    const legacyFactSource = factColumns.includes('source') ? 'source' : "'manual'";
    const legacyFactCreatedAt = factColumns.includes('created_at') ? 'created_at' : "datetime('now')";
    const legacyFactUpdatedAt = factColumns.includes('updated_at') ? 'updated_at' : legacyFactCreatedAt;
    db.exec(`
      ALTER TABLE book_facts RENAME TO book_facts_legacy_stage3;
      CREATE TABLE book_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        chapter_no INTEGER NOT NULL DEFAULT 0,
        event_id INTEGER,
        lineage_id INTEGER,
        supersedes_id INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        importance INTEGER NOT NULL DEFAULT 3,
        operation TEXT NOT NULL DEFAULT 'create',
        fact_type TEXT NOT NULL,
        key_name TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        revision_chapter INTEGER,
        revision_reason TEXT,
        source_evidence TEXT,
        created_at DATETIME DEFAULT (datetime('now')),
        updated_at DATETIME DEFAULT (datetime('now'))
      );
      INSERT INTO book_facts
        (id, book_id, chapter_no, event_id, lineage_id, supersedes_id, status, importance, operation,
         fact_type, key_name, value, source, revision_chapter, revision_reason, source_evidence, created_at, updated_at)
      SELECT id, book_id,
        ${legacyFactChapter},
        ${legacyFactEvent}, id, NULL, 'active', 3, 'create',
        fact_type, key_name, value, ${legacyFactSource},
        ${legacyFactChapter},
        '旧事实迁移为版本链初版', NULL, ${legacyFactCreatedAt}, ${legacyFactUpdatedAt}
      FROM book_facts_legacy_stage3;
      DROP TABLE book_facts_legacy_stage3;
    `);
  }
  db.prepare('UPDATE book_facts SET lineage_id=id WHERE lineage_id IS NULL').run();
  db.prepare("UPDATE book_facts SET status='active' WHERE status IS NULL OR status=''").run();
  db.prepare('UPDATE book_facts SET importance=3 WHERE importance IS NULL OR importance < 1 OR importance > 5').run();
  db.prepare("UPDATE book_facts SET operation='create' WHERE operation IS NULL OR operation=''").run();
  const summaryColumnsAfterMigration = db.prepare('PRAGMA table_info(book_summaries)').all().map(c => c.name);
  if (!summaryColumnsAfterMigration.includes('source_composition')) {
    db.exec('ALTER TABLE book_summaries ADD COLUMN source_composition TEXT');
  }
  const commentColumns = db.prepare('PRAGMA table_info(book_comments)').all().map(c => c.name);
  const commentAdditions = [
    ['event_id', 'INTEGER'],
    ['thread_key', 'TEXT'],
    ['source_label', "TEXT DEFAULT 'human'"],
    ['is_favorite', 'INTEGER DEFAULT 0'],
    ['annotation_kind', "TEXT DEFAULT 'comment'"],
    ['dedupe_key', 'TEXT'],
  ];
  for (const [name, definition] of commentAdditions) {
    if (!commentColumns.includes(name)) db.exec(`ALTER TABLE book_comments ADD COLUMN ${name} ${definition}`);
  }
  const taskColumns = db.prepare('PRAGMA table_info(reading_tasks)').all().map(c => c.name);
  const taskAdditions = [
    ['review_mode', "TEXT DEFAULT 'layered'"],
    ['request_key', 'TEXT'],
    ['model_role', "TEXT NOT NULL DEFAULT 'main'"],
    ['requested_concurrency', 'INTEGER NOT NULL DEFAULT 1'],
    ['estimated_input_tokens', 'INTEGER DEFAULT 0'],
    ['estimated_output_tokens', 'INTEGER DEFAULT 0'],
    ['spent_output_tokens', 'INTEGER DEFAULT 0'],
    ['reserved_input_tokens', 'INTEGER DEFAULT 0'],
    ['budget_confirmed', 'INTEGER DEFAULT 0'],
    ['soft_limit_tokens', 'INTEGER'],
    ['hard_limit_tokens', 'INTEGER'],
    ['consecutive_failures', 'INTEGER DEFAULT 0'],
    ['pause_reason', 'TEXT'],
    ['completed_at', 'DATETIME'],
  ];
  for (const [name, definition] of taskAdditions) {
    if (!taskColumns.includes(name)) db.exec(`ALTER TABLE reading_tasks ADD COLUMN ${name} ${definition}`);
  }
  const itemColumns = db.prepare('PRAGMA table_info(reading_task_items)').all().map(c => c.name);
  const itemAdditions = [
    ['event_id', 'INTEGER'],
    ['source_hash', 'TEXT'],
    ['idempotency_key', 'TEXT'],
    ['attempts', 'INTEGER DEFAULT 0'],
    ['input_tokens', 'INTEGER DEFAULT 0'],
    ['output_tokens', 'INTEGER DEFAULT 0'],
    ['reserved_input_tokens', 'INTEGER DEFAULT 0'],
    ['usage_estimated', 'INTEGER DEFAULT 0'],
    ['source', 'TEXT'],
    ['model', 'TEXT'],
    ['skip_reason', 'TEXT'],
    ['next_retry_at', 'DATETIME'],
    ['request_started_at', 'DATETIME'],
    ['completed_at', 'DATETIME'],
  ];
  for (const [name, definition] of itemAdditions) {
    if (!itemColumns.includes(name)) db.exec(`ALTER TABLE reading_task_items ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_book_comments_dedupe ON book_comments(dedupe_key) WHERE dedupe_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_book_chats_dedupe ON book_chats(dedupe_key) WHERE dedupe_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_tasks_request_key ON reading_tasks(request_key) WHERE request_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_reading_task_items_status ON reading_task_items(task_id, status, chapter_no);
    CREATE INDEX IF NOT EXISTS idx_reading_task_usage_task ON reading_task_usage(task_id, chapter_no, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_task_item_idempotency ON reading_task_items(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_reading_events_book_chapter ON reading_events(book_id, chapter_no, created_at);
    CREATE INDEX IF NOT EXISTS idx_book_summaries_book_chapter ON book_summaries(book_id, chapter_no, kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_book_facts_book_chapter ON book_facts(book_id, chapter_no, created_at);
    CREATE INDEX IF NOT EXISTS idx_book_facts_lineage ON book_facts(book_id, lineage_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_book_reading_context_unique ON book_reading_contexts(book_id, chapter_no, context_kind);
    CREATE INDEX IF NOT EXISTS idx_chapter_comment_summaries_book ON chapter_comment_summaries(book_id, chapter_no, version);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_comment_summary_request ON chapter_comment_summaries(request_key) WHERE request_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_comment_summary_overviews_book ON comment_summary_overviews(book_id, block_start);
    CREATE INDEX IF NOT EXISTS idx_book_paragraphs_book_idx ON book_paragraphs(book_id, idx);
    CREATE INDEX IF NOT EXISTS idx_book_reading_impressions_book ON book_reading_impressions(book_id, created_at);
  `);
  db.prepare("UPDATE book_comments SET source_label = CASE WHEN lower(from_who)='ai' THEN 'main' ELSE 'human' END WHERE source_label IS NULL OR source_label=''").run();
  const columns = db.prepare('PRAGMA table_info(books)').all().map(c => c.name);
  const hadCommentVersion = columns.includes('comment_version');
  const additions = [
    ['category', "TEXT DEFAULT '待看'"],
    ['tags_json', "TEXT DEFAULT '[]'"],
    ['note', "TEXT DEFAULT ''"],
    ['source_format', "TEXT DEFAULT 'text'"],
    ['source_encoding', "TEXT DEFAULT 'utf-8'"],
    ['source_path', 'TEXT'],
    ['deleted_at', 'DATETIME'],
    ['cache_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['comment_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['chapter_rule_json', "TEXT DEFAULT '{}'"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE books ADD COLUMN ${name} ${definition}`);
  }
  if (!hadCommentVersion) {
    db.prepare(`UPDATE books
      SET comment_version = CASE
        WHEN cache_version IS NULL OR cache_version < 1 THEN 1
        ELSE cache_version
      END`).run();
  }
  db.prepare("UPDATE books SET category = '待看' WHERE category IS NULL OR category = ''").run();
  db.prepare("UPDATE books SET tags_json = '[]' WHERE tags_json IS NULL OR tags_json = ''").run();
  db.prepare("UPDATE books SET note = '' WHERE note IS NULL").run();
  db.prepare('UPDATE books SET cache_version = 1 WHERE cache_version IS NULL OR cache_version < 1').run();
  db.prepare('UPDATE books SET comment_version = 1 WHERE comment_version IS NULL OR comment_version < 1').run();
  db.prepare("UPDATE books SET chapter_rule_json = '{}' WHERE chapter_rule_json IS NULL OR chapter_rule_json = ''").run();
  db.close();
}

export function getDb(readonly = false) {
  return new Database(dbPath, { readonly });
}

export function getDbPath() { return dbPath; }

export function getImageDir(bookId) {
  const dir = path.join(path.dirname(dbPath), 'book-images', String(bookId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getBooksDir() {
  const dir = path.join(path.dirname(dbPath), 'books');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getBookFilesDir(bookId) {
  const dir = path.join(getBooksDir(), String(bookId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
