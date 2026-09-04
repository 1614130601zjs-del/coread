import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { initDb, getDb } from '../lib/db.mjs';
import { handleRequest } from '../lib/routes.mjs';
import { createBackupService } from '../lib/backups.mjs';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');
const studyAppSource = fs.readFileSync(new URL('../web/StudyApp.tsx', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../web/api.ts', import.meta.url), 'utf8');
const serverSource = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const authSessionSource = fs.readFileSync(new URL('../lib/auth-sessions.mjs', import.meta.url), 'utf8');
const commentTimelineSource = fs.readFileSync(new URL('../web/commentTimeline.ts', import.meta.url), 'utf8');
globalThis.window ||= { location: { origin: 'http://localhost' } };
const apiModule = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(apiSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
).toString('base64')}`);
const commentTimelineModule = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(commentTimelineSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
).toString('base64')}`);

let modelFetches = 0;
globalThis.fetch = async (url) => {
  modelFetches += 1;
  throw new Error(`unexpected network or model request: ${String(url)}`);
};

function expect(condition, message) {
  assert.equal(Boolean(condition), true, message);
}

async function invoke(method, url, body = null, backups) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {};
  let status = 0;
  const chunks = [];
  const res = {
    setHeader() {},
    writeHead(code) { status = code; },
    end(value = '') {
      if (value !== undefined && value !== null) chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
    },
  };
  const handled = handleRequest(req, res, { authenticated: true, port: 0, backups });
  if (body !== null) {
    queueMicrotask(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });
  }
  await handled;
  const buffer = Buffer.concat(chunks);
  let json = null;
  try {
    json = buffer.length ? JSON.parse(buffer.toString('utf8')) : null;
  } catch {}
  return { status, buffer, json };
}

function listArchiveEntries(buffer) {
  return new AdmZip(buffer).getEntries()
    .filter(entry => !entry.isDirectory)
    .map(entry => entry.entryName)
    .sort();
}

function staticLocalPreferenceGuard() {
  const cacheInvalidators = studyAppSource.match(/const invalidateBookContentCache =[\s\S]*?\n    const openBook/);
  expect(cacheInvalidators, 'reader cache invalidators were not found');
  expect(!/(coread-reader-theme|coread-brightness|coread-reader-layout|coread-reader-presets)/.test(cacheInvalidators[0]),
    'cache invalidation touched device-local reader preferences');
  expect(!studyAppSource.includes('readerNightMode') && !studyAppSource.includes('coread-night-mode'),
    'retired night-mode state is still present');
  for (const key of ['coread-reader-theme', 'coread-brightness', 'coread-reader-layout', 'coread-reader-presets']) {
    expect(studyAppSource.includes(key), `local reader preference key is missing: ${key}`);
  }
  for (const theme of ['eink', 'warm', 'paper', 'kraft', 'green', 'navy', 'dark', 'custom']) {
    expect(studyAppSource.includes(`${theme}: {`), `reader theme option is missing: ${theme}`);
  }
  expect(studyAppSource.includes('const isReaderTheme = (value: string | null): value is ReaderTheme'),
    'reader theme validation is missing');
  expect(studyAppSource.includes("readerTheme === 'eink'"),
    'eink-specific rendering constraints are missing');
  expect(studyAppSource.includes('coread-reader-custom-appearance')
    && studyAppSource.includes('coread-shelf-columns'),
  'custom appearance or shelf column settings are not device-local');
  expect(studyAppSource.includes('coread-reading-progress-v1-')
    && studyAppSource.includes('pending: true'),
  'local-first reading progress storage is missing');
  expect(studyAppSource.includes('coread-book-last-opened-v1-')
    && studyAppSource.includes('rememberBookLastOpened(book.id)')
    && studyAppSource.includes('bookLastReadTime(a)')
    && studyAppSource.includes('bookLastReadTime(b)'),
  'device-local recent-reading order is missing');
  const openBook = studyAppSource.match(/const openBook = async \(book: Book\) => \{[\s\S]*?\n    const lockedHeightRef/);
  expect(openBook
    && openBook[0].includes('rememberBookLastOpened(book.id)')
    && openBook[0].includes('setBooks(previous => previous.map')
    && !openBook[0].includes('api.updateBookProgress'),
  'opening a book does not update local recency independently from cloud progress');
  const permanentDeleteHandlers = studyAppSource.match(/const handlePermanentDeleteBook =[\s\S]*?\n    const loadBackups/);
  expect(permanentDeleteHandlers
    && permanentDeleteHandlers[0].match(/clearBookLastOpened\(bookId\)/g)?.length === 2,
  'permanent deletion does not clear device-local recent-reading records');
  expect(studyAppSource.includes('uploadLocalReadingProgress')
    && studyAppSource.includes('restoreReadingProgressFromCloud')
    && studyAppSource.includes('上传本机进度')
    && studyAppSource.includes('从云端恢复'),
  'manual reading progress controls are missing');
  expect(!studyAppSource.includes('flushReadingProgress')
    && !studyAppSource.includes('visibilitychange')
    && !studyAppSource.includes('pagehide')
    && !studyAppSource.includes('keepalive'),
  'automatic reading progress sync hooks are still present');
}

function staticShelfFontAndAuthGuard() {
  expect(studyAppSource.includes("type ShelfColumns = 'auto' | 2 | 3 | 4 | 5 | 6;")
    && studyAppSource.includes("(['auto', 2, 3, 4, 5, 6] as ShelfColumns[])")
    && studyAppSource.includes('data-columns={shelfColumns}')
    && studyAppSource.includes("'--shelf-columns': shelfColumns === 'auto' ? 2 : shelfColumns"),
  'shelf columns are not a unified automatic-or-2-through-6 setting');
  expect(!studyAppSource.includes('shelfColumns.mobile')
    && !studyAppSource.includes('shelfColumns.tablet')
    && !studyAppSource.includes('shelfColumns.desktop')
    && !studyAppSource.includes('--shelf-mobile-columns')
    && !studyAppSource.includes('--shelf-tablet-columns')
    && !studyAppSource.includes('--shelf-desktop-columns'),
  'legacy device-specific shelf column controls are still active');
  expect(studyAppSource.includes('value.mobile')
    && studyAppSource.includes('value.tablet')
    && studyAppSource.includes('value.desktop')
    && studyAppSource.includes("width < 760 ? value.mobile : width < 1180 ? value.tablet : value.desktop"),
  'legacy shelf column preferences are not migrated');

  expect(!/@font-face|document\.fonts/.test(studyAppSource)
    && studyAppSource.includes('"Songti SC", "SimSun", serif')
    && studyAppSource.includes('"KaiTi", cursive'),
  'public release still bundles or preloads private fonts instead of using system fallbacks');
  expect(!serverSource.includes("requestPath.startsWith('/fonts/')")
    && serverSource.includes("requestPath.startsWith('/assets/')")
    && serverSource.includes("'public, max-age=31536000, immutable'")
    && serverSource.includes("path.basename(filePath) === 'index.html'")
    && serverSource.includes("'no-cache'"),
  'static asset caching or index revalidation headers are missing');

  expect(serverSource.includes('createAuthSessionStore')
    && serverSource.includes('Max-Age=${maxAgeSeconds}')
    && serverSource.includes("'HttpOnly'")
    && serverSource.includes("'SameSite=Lax'")
    && serverSource.includes("'Secure'"),
  'persistent authentication or durable secure cookie attributes are missing');
  expect(authSessionSource.includes('30 * 24 * 60 * 60 * 1000')
    && authSessionSource.includes("createHmac('sha256', password)")
    && authSessionSource.includes("crypto.randomBytes(32).toString('base64url')")
    && !authSessionSource.includes('coread.db'),
  'authentication sessions are not isolated, hashed, and persistent for 30 days');
}

function staticStoryMaterialGuard() {
  for (const tab of ['chapters', 'blocks', 'impressions', 'facts', 'comment_summaries']) {
    expect(studyAppSource.includes(`'${tab}'`), `story material tab is missing: ${tab}`);
  }
  expect(studyAppSource.includes('generateStoryMaterial')
    && studyAppSource.includes('missingChapters')
    && studyAppSource.includes('openBatchReading'),
  'manual story material generation or missing-chapter batch entry is missing');
  expect(studyAppSource.includes('剧情摘要')
    && studyAppSource.includes('大总结')
    && studyAppSource.includes('共同读书印象')
    && studyAppSource.includes('事实锚定')
    && studyAppSource.includes('批注摘要'),
  'story material category labels are incomplete');
  expect(studyAppSource.includes('第 {currentChapterNo} 章前情')
    && studyAppSource.includes('仅注入本章阅读上下文，不改变正文排版、分页或其他章节。')
    && studyAppSource.includes("saveReadingContext('chapter_prelude')"),
  'chapter prelude editor or save path is missing from the read-chapter overlay');
  expect(apiModule.cloudProgressPage({ progress: 500 }) === 500
    && apiModule.cloudProgressPage({ progress: { page: 501 } }) === 501
    && apiModule.cloudProgressPage({ progress: { page: 0 } }) === 0,
  'cloud progress parser does not support numeric and legacy object payloads');
  expect(studyAppSource.includes('批量阅读'), 'more menu batch-reading entry is missing');
  expect(studyAppSource.includes('deleteStoryMaterial')
    && studyAppSource.includes('deleteReadingImpression')
    && studyAppSource.includes('删除这条波浪线'),
  'direct delete controls for story materials, impressions, or wave underlines are missing');
  expect(studyAppSource.includes('activeWaveAnnotation')
    && studyAppSource.includes('点击管理这条波浪线'),
  'inline wave underline delete control is missing');
  expect(studyAppSource.includes("setBatchTaskType(value)")
    && studyAppSource.includes("setBatchConcurrency(value === 'main' ? 1 : 2)")
    && studyAppSource.includes("batchTaskType === 'main' ? 5 : 8"),
  'batch concurrency defaults or limits are missing');
}

function staticReaderCacheSplitGuard() {
  expect(!studyAppSource.includes('invalidateReaderCache'),
    'the retired shared reader cache invalidator is still used');
  expect(studyAppSource.includes('api.fetchBookSlice(book.id, start, PARA_FETCH_CHUNK, false)'),
    'paragraph loading still requests comments with every text slice');
  expect(studyAppSource.includes('const commentsRequest = cachedCommentsPromise.then(hit =>')
    && studyAppSource.includes('hit ? null : api.fetchBookComments(book.id)'),
    'opening a book does not refresh comments independently');
  expect(studyAppSource.includes('comments-v2-${bookId}') && studyAppSource.includes('commentVersion: normalizedVersion'),
    'the independent comment cache payload is missing');
  expect(studyAppSource.includes("`${PAGEBREAK_CACHE_PREFIX}${activeBook.id}-${paginationLayoutSignature}`")
    && studyAppSource.includes("`${paginationCacheBaseKey}-full`")
    && studyAppSource.includes("`${paginationCacheBaseKey}-window`")
    && studyAppSource.includes("`${paginationCacheBaseKey}-checkpoint`")
    && studyAppSource.includes('const legacyPaginationCacheKeys = useMemo')
    && studyAppSource.includes("scope: 'window'"),
  'pagination cache does not split stable full, window, and checkpoint keys');
  const fullCacheRead = studyAppSource.indexOf('let fullCached = await readLocalCache(paginationFullCacheKey);');
  const windowCacheRead = studyAppSource.indexOf('readLocalCache(paginationWindowCacheKey)');
  const fullCacheReturn = studyAppSource.indexOf('setPaginateProgress(null);', fullCacheRead);
  expect(fullCacheRead >= 0 && fullCacheReturn > fullCacheRead && windowCacheRead > fullCacheReturn,
    'window pagination is read before a valid full cache can return');
  expect(!studyAppSource.includes('api.fetchBookCacheState(book.id)')
    && studyAppSource.includes('if (!paragraphsHit)')
    && studyAppSource.includes('local page table is paired with the'),
  'cached reader text or pagination still waits for remote cache validation');
  expect(studyAppSource.includes('paginateProgress != null && !readingLoading')
    && studyAppSource.includes('正在保存本机完整分页缓存'),
  'background full-pagination progress is not visible beside the page number');
  expect(!/PAGEBREAK_CACHE_PREFIX[^;\n]*commentCacheVersion/.test(studyAppSource),
    'comment version leaked into the pagination cache key');
  expect(studyAppSource.includes('const useProvisional = progressive && !suppressPageJumpRef.current;')
    && studyAppSource.includes('const wFrom = Math.max(0, anchorPi0 - PROVISIONAL_WIN);')
    && studyAppSource.includes('const PROVISIONAL_WIN = 480;')
    && studyAppSource.includes('const idbOk = await idbSet(paginationWindowCacheKey, payload);')
    && !studyAppSource.includes('anchorPi0 > PROVISIONAL_WIN'),
  'large books do not persist a lightweight first-page pagination window');
  expect(studyAppSource.includes('const MEASURE_CHUNK = 240;')
    && studyAppSource.includes("scope: 'checkpoint'")
    && studyAppSource.includes('resumeCheckpoint.breaks.slice()')
    && studyAppSource.includes('idbSet(paginationFullCacheKey, payload)')
    && studyAppSource.includes('idbDel(paginationCheckpointCacheKey)'),
  'background full pagination is not chunked, resumable, or persisted independently');
  expect(!studyAppSource.includes('idbSet(paginationCacheKey')
    && !studyAppSource.includes('localStorage.setItem(paginationCacheKey'),
  'the retired shared pagination cache key can still be overwritten');
  expect(studyAppSource.includes('const PARAGRAPH_CACHE_CHUNK_SIZE = 512;')
    && studyAppSource.includes('paras-v3-${bookId}-manifest')
    && studyAppSource.includes('paras-v3-${bookId}-chunk-${chunkIndex}')
    && studyAppSource.includes("cacheFormat: 'chunked-v3'")
    && studyAppSource.includes('complete: true'),
  'the persistent paragraph chunk manifest is incomplete');
  const chunkWrite = studyAppSource.indexOf('idbSetParas(paragraphChunkCacheKey(bookId, chunkIndex), payload)');
  const manifestWrite = studyAppSource.indexOf('idbSetParas(paragraphManifestCacheKey(bookId), manifest)');
  expect(chunkWrite >= 0 && manifestWrite > chunkWrite,
    'the paragraph manifest can be published before all chunks are written');
  expect(studyAppSource.includes('Array.from(new Set([center - 1, center, center + 1]')
    && studyAppSource.includes('paragraphChunksRef.current = next;')
    && studyAppSource.includes('const para = paragraphAt(i);')
    && studyAppSource.includes('const original = paragraphAt(frag.sourceIdx) || frag;'),
  'the reader does not use a persistent three-chunk paragraph window');
  const paragraphHydration = studyAppSource.indexOf('const hydrated = await hydrateAllParagraphs', fullCacheRead);
  expect(paragraphHydration > fullCacheReturn && paragraphHydration < windowCacheRead,
    'full paragraph hydration does not happen only after a full page-table miss');
  expect(studyAppSource.includes('await idbDelParas(legacyParaCacheKey);')
    && studyAppSource.includes('await idbDelParas(`paras-v1-${book.id}`);'),
  'legacy whole-book paragraph cache is not removed after chunk migration');
  const chapterRuleApply = studyAppSource.match(/const applyChapterRules = async \(\) => \{[\s\S]*?\n    const tocMatches/);
  expect(chapterRuleApply
    && chapterRuleApply[0].includes('idbSetParas(tocCacheKey(activeBook.id)')
    && chapterRuleApply[0].includes('invalidateBookPaginationCache')
    && !chapterRuleApply[0].includes('invalidateBookContentCache'),
  'rechaptering clears persistent paragraph chunks instead of only page tables');
  const backToShelf = studyAppSource.match(/const backToShelf = \(\) => \{[\s\S]*?\n    useEffect/);
  expect(backToShelf
    && backToShelf[0].includes('paragraphChunksRef.current = new Map();')
    && backToShelf[0].includes('setParagraphCacheManifest(null)')
    && !backToShelf[0].includes('idbDelParas'),
  'leaving the reader deletes persistent chunks or keeps the in-memory paragraph window');
  const commentMutations = studyAppSource.match(/const addWavyUnderline =[\s\S]*?\n    useEffect\(\(\) => \{\n        if \(mode !== 'reading'\)/);
  expect(commentMutations && !commentMutations[0].includes('invalidateBookContentCache'),
    'a comment, underline, favorite, or reply mutation clears the content cache');
  const readingTaskPollers = studyAppSource.match(/const pollReadingTask =[\s\S]*?\n    const openBatchReading/);
  expect(readingTaskPollers
    && readingTaskPollers[0].includes('api.fetchBookComments')
    && !readingTaskPollers[0].includes('api.fetchBookDetail'),
  'reading task completion still reloads book text instead of comments only');
}

function staticCommentOverlayAndNumberInputGuard() {
  expect(studyAppSource.includes('const closeCommentDetails = () =>')
    && studyAppSource.includes('const openCommentDetails = (thread: Comment[]) =>')
    && studyAppSource.includes('<button onClick={closeCommentDetails}'),
  'comment detail close does not clear its independent composer state');
  const prepareCallSites = studyAppSource.match(/\bprepareAdditionalComment\([^)]*\);?/g) || [];
  expect(prepareCallSites.length === 2
    && prepareCallSites.some(call => call.includes('composerSeed'))
    && prepareCallSites.some(call => call.includes('original')),
  'viewing an existing comment still primes the add-comment composer');
  expect(studyAppSource.includes('const lockedWidthRef = useRef<number>(0);')
    && studyAppSource.includes('Math.abs(width - lockedWidthRef.current) > 2')
    && !studyAppSource.includes('h >= lockedHeightRef.current * 0.95'),
  'reader pagination height is not stable across keyboard viewport changes');
  const paginationDependencies = studyAppSource.match(/\}, \[\n        mode,\n        allParas,[\s\S]*?paragraphsFullyLoaded,\n    \]\);/);
  expect(paginationDependencies
    && !/activeComments|commentingIdx|replyingTo|showStoryMaterials|editingStoryMaterial|showChapterChat|showSearch|showBatchReading|showFavorites|showAnnotationList|activeWaveAnnotation|showToc|showMoreMenu|showChapterMenu|showFontPanel/.test(paginationDependencies[0]),
  'a reader overlay or editor state participates in pagination');
  for (const overlayMarker of [
    "{mode === 'reading' && commentingIdx !== null",
    '{activeComments.length > 0 && (',
    "{mode === 'reading' && showStoryMaterials && (",
    "{mode === 'reading' && showChapterChat && (",
    "{mode === 'reading' && showSearch && (",
    "{mode === 'reading' && showAnnotationList && (",
    "{mode === 'reading' && activeWaveAnnotation && (",
    '{showFavorites && (',
    '{showBatchReading && (',
    '{showToc && (',
  ]) {
    const markerIndex = studyAppSource.indexOf(overlayMarker);
    expect(markerIndex >= 0, `reader overlay marker is missing: ${overlayMarker}`);
    const nearbySource = studyAppSource.slice(markerIndex, markerIndex + 700);
    expect(nearbySource.includes("position: 'absolute'") || nearbySource.includes("position: 'fixed'"),
      `reader overlay participates in document flow: ${overlayMarker}`);
  }
  expect(studyAppSource.includes('function BoundedNumberInput({')
    && studyAppSource.includes('inputMode="numeric"')
    && studyAppSource.includes("next === '' || /^\\d+$/.test(next)")
    && studyAppSource.includes('title="减少"')
    && studyAppSource.includes('title="增加"'),
  'bounded chapter and concurrency inputs cannot be cleared and stepped safely');
  expect(studyAppSource.includes("import { sortCommentTimeline } from './commentTimeline'")
    && studyAppSource.includes('setActiveComments(sortCommentTimeline(thread))')
    && studyAppSource.includes('comment.thread_key === seed.thread_key')
    && studyAppSource.includes('const ordered = sortCommentTimeline(activeComments)'),
  'annotation threads are not collected and rendered as one chronological timeline');
}

function commentTimelineRegression() {
  const ordered = commentTimelineModule.sortCommentTimeline([
    { id: 11, created_at: '2026-08-11 10:00:00', from_who: 'ai' },
    { id: 12, created_at: '2026-08-11T10:00:05.000Z', from_who: 'human' },
    { id: 13, created_at: '2026-08-11 10:00:10', from_who: 'ai' },
    { id: 14, created_at: '2026-08-11 10:00:10', from_who: 'human' },
  ]);
  expect(JSON.stringify(ordered.map(comment => comment.id)) === JSON.stringify([11, 12, 13, 14]),
    'mixed SQLite UTC and browser ISO timestamps grouped comments by source instead of chronology');
}

function staticMobileReaderGestureGuard() {
  const touchHandlers = studyAppSource.match(/onTouchStart=\{mode === 'reading'[\s\S]*?onTouchCancel=\{mode === 'reading'[\s\S]*?: undefined\}>/);
  expect(touchHandlers, 'mobile reader touch handlers were not found');
  expect(!touchHandlers[0].includes('if (startedOnText) reserveSelectionGesture(750)'),
    'a short text tap is still locked immediately on touchstart');
  expect(touchHandlers[0].includes('window.setTimeout') && touchHandlers[0].includes('}, 460)'),
    'text selection does not wait for a real long press');
  expect(touchHandlers[0].includes('start.selectionClaimed = true'),
    'long-press or drag selection does not claim the touch gesture');
  expect(touchHandlers[0].includes('if (start.startedOnText) return;'),
    'text taps are not delegated to the normal left-middle-right click zones');
  expect(touchHandlers[0].includes('if (start.startedAtEdge) return;'),
    'edge swipes are not reserved for the browser back gesture');
  expect(studyAppSource.includes("window.history.pushState({ coread: 'reading', bookId: book.id }"),
    'opening a book does not create an in-app browser history step');
}

function staticChapterNavigationGuard() {
  expect(studyAppSource.includes('const chapterBoundarySignature = useMemo'),
    'stored chapter boundaries are not included in the pagination cache signature');
  expect(studyAppSource.includes('const isChapterStartIndex = (sourceIdx: number)'),
    'reader pagination does not use stored chapter start indices');
  expect(!studyAppSource.includes('isChapterStart(para.content)'),
    'reader pagination still guesses chapter boundaries from paragraph text');
  expect(studyAppSource.includes('if (candidate > startPage)'),
    'chapter page ranges do not skip consecutive chapter entries on the same visual page');
  expect(studyAppSource.includes('const adjacentChapterPage = (direction: -1 | 1)'),
    'reader does not provide same-page-safe adjacent chapter navigation');
}

function verifyLegacyCommentVersionMigration(rootDir) {
  const legacyPath = path.join(rootDir, 'legacy-cache-version.db');
  initDb(legacyPath);
  let legacyDb = getDb();
  legacyDb.prepare(`INSERT INTO books
    (id, title, total_paragraphs, cache_version, chapter_rule_json)
    VALUES (?, ?, ?, ?, ?)`).run(901, 'Legacy cache fixture', 1, 7, '{"family_ids":["cn_chapter"]}');
  legacyDb.prepare('INSERT INTO book_paragraphs (book_id, idx, content) VALUES (?, ?, ?)')
    .run(901, 0, '第一章 旧正文');
  legacyDb.prepare(`INSERT INTO book_chapters
    (book_id, chapter_no, title, start_idx, end_idx) VALUES (?, ?, ?, ?, ?)`)
    .run(901, 1, '第一章', 0, 0);
  legacyDb.prepare(`INSERT INTO book_comments
    (book_id, paragraph_idx, selected_text, from_who, content, is_favorite, annotation_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(901, 0, '旧正文', 'human', '旧收藏批注', 1, 'comment');
  const before = {
    paragraphs: legacyDb.prepare('SELECT book_id, idx, content FROM book_paragraphs WHERE book_id=? ORDER BY idx').all(901),
    chapters: legacyDb.prepare(`SELECT book_id, chapter_no, title, start_idx, end_idx
      FROM book_chapters WHERE book_id=? ORDER BY chapter_no`).all(901),
    comments: legacyDb.prepare(`SELECT book_id, paragraph_idx, selected_text, from_who, content, is_favorite, annotation_kind
      FROM book_comments WHERE book_id=? ORDER BY id`).all(901),
  };
  legacyDb.close();

  legacyDb = new Database(legacyPath);
  legacyDb.exec(`
    CREATE TABLE books_legacy (
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
      chapter_rule_json TEXT DEFAULT '{}'
    );
    INSERT INTO books_legacy (
      id, title, total_paragraphs, created_at, cover_image, category, tags_json, note,
      source_format, source_encoding, source_path, deleted_at, cache_version, chapter_rule_json
    )
    SELECT
      id, title, total_paragraphs, created_at, cover_image, category, tags_json, note,
      source_format, source_encoding, source_path, deleted_at, cache_version, chapter_rule_json
    FROM books;
    DROP TABLE books;
    ALTER TABLE books_legacy RENAME TO books;
  `);
  expect(!legacyDb.prepare('PRAGMA table_info(books)').all().some(column => column.name === 'comment_version'),
    'legacy migration fixture still contained comment_version');
  legacyDb.close();

  initDb(legacyPath);
  const migratedDb = getDb(true);
  const migratedBook = migratedDb.prepare('SELECT cache_version, comment_version FROM books WHERE id=?').get(901);
  const after = {
    paragraphs: migratedDb.prepare('SELECT book_id, idx, content FROM book_paragraphs WHERE book_id=? ORDER BY idx').all(901),
    chapters: migratedDb.prepare(`SELECT book_id, chapter_no, title, start_idx, end_idx
      FROM book_chapters WHERE book_id=? ORDER BY chapter_no`).all(901),
    comments: migratedDb.prepare(`SELECT book_id, paragraph_idx, selected_text, from_who, content, is_favorite, annotation_kind
      FROM book_comments WHERE book_id=? ORDER BY id`).all(901),
  };
  migratedDb.close();
  expect(migratedBook.cache_version === 7 && migratedBook.comment_version === 7,
    'legacy comment_version did not inherit cache_version');
  expect(JSON.stringify(after) === JSON.stringify(before),
    'legacy comment_version migration changed paragraphs, chapters, comments, or favorites');
  return true;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coread-stage6-isolated-'));
const dataDir = path.join(root, 'data');
const dbPath = path.join(dataDir, 'coread.db');
let now = new Date('2026-08-09T20:00:00.000Z');
const backups = createBackupService({ dbPath, now: () => now });

try {
  const legacyMigrationVerified = verifyLegacyCommentVersionMigration(root);
  initDb(dbPath);
  const db = getDb();
  const bookId = 101;
  db.prepare(`INSERT INTO books
    (id, title, total_paragraphs, source_format, source_path, cache_version)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(bookId, '第六阶段临时验收书', 205, 'txt', `books/${bookId}/original.txt`, 1);
  const epubBookId = 102;
  db.prepare(`INSERT INTO books
    (id, title, total_paragraphs, source_format, source_path, cache_version)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(epubBookId, 'Stage 6 EPUB fixture', 0, 'epub', `books/${epubBookId}/original.epub`, 1);
  const addParagraph = db.prepare('INSERT INTO book_paragraphs (book_id, idx, content) VALUES (?, ?, ?)');
  const addChapter = db.prepare('INSERT INTO book_chapters (book_id, chapter_no, title, start_idx, end_idx) VALUES (?, ?, ?, ?, ?)');
  const addComment = db.prepare(`INSERT INTO book_comments
    (book_id, paragraph_idx, selected_text, from_who, content, is_favorite)
    VALUES (?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    const chapterRuleFixture = [
      '第一章 开始 needle',
      '正文内容。needle',
      '1. 第一条规则 needle',
      '2. 第二条规则 needle',
      '3. 第三条规则 needle',
      '第二章 继续 needle',
    ];
    for (let index = 0; index < 205; index += 1) {
      addParagraph.run(
        bookId,
        index,
        chapterRuleFixture[index] || `普通正文第 ${index} 段，needle 搜索命中。`,
      );
    }
    addChapter.run(bookId, 1, '第一章 开始', 0, 4);
    addChapter.run(bookId, 2, '第二章 继续', 5, 204);
    addComment.run(bookId, 0, 'needle', 'human', '临时批注', 1);
    db.prepare('INSERT INTO book_progress (book_id, page) VALUES (?, ?)').run(bookId, 2);
    db.prepare(`INSERT INTO book_summaries (book_id, chapter_no, kind, text, source)
      VALUES (?, ?, ?, ?, ?)`).run(bookId, 1, 'chapter', '临时章节摘要', 'manual');
    db.prepare(`INSERT INTO book_facts (book_id, chapter_no, fact_type, key_name, value, source)
      VALUES (?, ?, ?, ?, ?, ?)`).run(bookId, 1, '人物', '临时人物', '临时事实', 'manual');
    db.prepare(`INSERT INTO book_chats (book_id, chapter_no, from_who, content, source_label)
      VALUES (?, ?, ?, ?, ?)`).run(bookId, 1, 'human', '临时章内对话', 'human');
    db.prepare(`INSERT INTO book_reading_impressions (book_id, chapter_start, chapter_end, content, source_label)
      VALUES (?, ?, ?, ?, ?)`).run(bookId, 1, 1, '临时读书印象', 'human');
    addParagraph.run(epubBookId, 0, 'Stage 6 permanent deletion fixture');
    addChapter.run(epubBookId, 1, 'Permanent deletion chapter', 0, 0);
    addComment.run(epubBookId, 0, 'fixture', 'human', 'Permanent deletion comment', 1);
    db.prepare('INSERT INTO book_progress (book_id, page) VALUES (?, ?)').run(epubBookId, 1);
    db.prepare(`INSERT INTO book_summaries (book_id, chapter_no, kind, text, source)
      VALUES (?, ?, ?, ?, ?)`).run(epubBookId, 1, 'chapter', 'Permanent deletion summary', 'manual');
    db.prepare(`INSERT INTO book_facts (book_id, chapter_no, fact_type, key_name, value, source)
      VALUES (?, ?, ?, ?, ?, ?)`).run(epubBookId, 1, 'fixture', 'permanent-delete', 'verified', 'manual');
    db.prepare(`INSERT INTO book_reading_contexts
      (book_id, chapter_no, context_kind, content, source)
      VALUES (?, ?, ?, ?, ?)`).run(epubBookId, 0, 'book_prelude', 'Permanent deletion book prelude', 'human');
    db.prepare(`INSERT INTO chapter_comment_summaries
      (book_id, chapter_no, version, content, source, request_key)
      VALUES (?, ?, ?, ?, ?, ?)`).run(epubBookId, 1, 1, 'Permanent deletion comment summary', 'human', 'permanent-delete-summary');
    db.prepare(`INSERT INTO comment_summary_overviews
      (book_id, block_start, block_end, content, source_version)
      VALUES (?, ?, ?, ?, ?)`).run(epubBookId, 1, 30, 'Permanent deletion overview', '1:1');
    const task = db.prepare(`INSERT INTO reading_tasks
      (book_id, task_type, start_chapter, end_chapter, status)
      VALUES (?, ?, ?, ?, ?)`).run(epubBookId, 'chapter', 1, 1, 'completed');
    const event = db.prepare(`INSERT INTO reading_events
      (book_id, chapter_no, task_id, status)
      VALUES (?, ?, ?, ?)`).run(epubBookId, 1, task.lastInsertRowid, 'completed');
    const item = db.prepare(`INSERT INTO reading_task_items
      (task_id, chapter_no, event_id, status)
      VALUES (?, ?, ?, ?)`).run(task.lastInsertRowid, 1, event.lastInsertRowid, 'completed');
    db.prepare(`INSERT INTO reading_task_usage
      (task_id, item_id, chapter_no, attempt_no, model_role, status)
      VALUES (?, ?, ?, ?, ?, ?)`).run(task.lastInsertRowid, item.lastInsertRowid, 1, 1, 'main', 'completed');
    db.prepare(`INSERT INTO book_chats (book_id, chapter_no, event_id, from_who, content, source_label)
      VALUES (?, ?, ?, ?, ?, ?)`).run(epubBookId, 1, event.lastInsertRowid, 'human', 'Permanent deletion chat', 'human');
    db.prepare(`INSERT INTO book_reading_impressions
      (book_id, chapter_start, chapter_end, content, source_label)
      VALUES (?, ?, ?, ?, ?)`).run(epubBookId, 1, 1, 'Permanent deletion impression', 'human');
    db.prepare(`INSERT INTO config (key, value) VALUES (?, ?)`).run('test_api_key', 'must-never-export');
  })();
  db.close();

  const bookDir = path.join(dataDir, 'books', String(bookId));
  const imageDir = path.join(dataDir, 'book-images', String(bookId));
  fs.mkdirSync(bookDir, { recursive: true });
  fs.mkdirSync(imageDir, { recursive: true });
  fs.writeFileSync(path.join(bookDir, 'original.txt'), '原始 TXT 临时验收文本', 'utf8');
  fs.writeFileSync(path.join(imageDir, 'cover.png'), Buffer.from('fixture-image'));
  const epubDir = path.join(dataDir, 'books', String(epubBookId));
  const epubFixture = new AdmZip();
  epubFixture.addFile('mimetype', Buffer.from('application/epub+zip'));
  epubFixture.addFile('META-INF/container.xml', Buffer.from('<container/>'));
  fs.mkdirSync(epubDir, { recursive: true });
  fs.writeFileSync(path.join(epubDir, 'original.epub'), epubFixture.toBuffer());
  const epubImageDir = path.join(dataDir, 'book-images', String(epubBookId));
  fs.mkdirSync(epubImageDir, { recursive: true });
  fs.writeFileSync(path.join(epubImageDir, 'cover.png'), Buffer.from('epub-fixture-image'));

  staticLocalPreferenceGuard();
  staticShelfFontAndAuthGuard();
  staticStoryMaterialGuard();
  staticReaderCacheSplitGuard();
  staticCommentOverlayAndNumberInputGuard();
  commentTimelineRegression();
  staticMobileReaderGestureGuard();
  staticChapterNavigationGuard();

  initDb(dbPath);
  initDb(dbPath);
  const migratedFact = getDb(true);
  const migratedLegacyFact = migratedFact.prepare(`SELECT lineage_id, importance, operation, status
    FROM book_facts WHERE book_id=? AND key_name='临时人物'`).get(bookId);
  migratedFact.close();
  expect(Number(migratedLegacyFact.lineage_id) > 0
    && migratedLegacyFact.importance === 3
    && migratedLegacyFact.operation === 'create'
    && migratedLegacyFact.status === 'active',
  'repeated migration did not normalize the legacy fact into an initial 3-star lineage version');

  const bookPreludeFirst = await invoke('PATCH', `/v1/books/${bookId}/reading-contexts`, {
    kind: 'book_prelude',
    content: '全书前情第一版',
  }, backups);
  const bookPreludeSecond = await invoke('PATCH', `/v1/books/${bookId}/reading-contexts`, {
    kind: 'book_prelude',
    content: '全书前情第二版',
  }, backups);
  const chapterPrelude = await invoke('PATCH', `/v1/books/${bookId}/reading-contexts`, {
    kind: 'chapter_prelude',
    chapter_no: 2,
    content: '第二章前情',
  }, backups);
  const readingContexts = await invoke('GET', `/v1/books/${bookId}/reading-contexts`, null, backups);
  expect(bookPreludeFirst.status === 200
    && bookPreludeSecond.json.context.version === 2
    && chapterPrelude.status === 200
    && readingContexts.json.contexts.length === 2
    && readingContexts.json.contexts.some(row => row.context_kind === 'book_prelude' && row.content === '全书前情第二版')
    && readingContexts.json.contexts.some(row => row.context_kind === 'chapter_prelude' && row.chapter_no === 2),
  'reading context save, versioning, or retrieval failed');

  const commentSummaryFirst = await invoke('PATCH', `/v1/books/${bookId}/comment-summaries/1`, {
    content: '本章，我注意到{{user}}收藏了开篇线索。',
    request_key: 'stage6-manual-summary-1',
  }, backups);
  const commentSummaryDeduped = await invoke('PATCH', `/v1/books/${bookId}/comment-summaries/1`, {
    content: '不应覆盖既有版本',
    request_key: 'stage6-manual-summary-1',
  }, backups);
  const commentSummarySecond = await invoke('PATCH', `/v1/books/${bookId}/comment-summaries/1`, {
    content: '本章，我和{{user}}继续确认了开篇线索。',
    request_key: 'stage6-manual-summary-2',
  }, backups);
  const commentSummaries = await invoke('GET', `/v1/books/${bookId}/comment-summaries`, null, backups);
  expect(commentSummaryFirst.status === 200
    && commentSummaryDeduped.json.summary.id === commentSummaryFirst.json.summary.id
    && commentSummarySecond.json.summary.version === 2
    && commentSummaries.json.summaries.length === 1
    && commentSummaries.json.summaries[0].content.includes('继续确认'),
  'comment summary versioning or request-key deduplication failed');

  const createdFact = await invoke('POST', `/v1/books/${bookId}/facts`, {
    operation: 'create',
    fact_type: '人物',
    key_name: '主角身份',
    value: '主角是原住民',
    importance: 5,
    revision_chapter: 1,
    revision_reason: '第一章明确',
  }, backups);
  const factLineage = Number(createdFact.json.fact.lineage_id);
  const revisedFact = await invoke('POST', `/v1/books/${bookId}/facts`, {
    operation: 'revise',
    lineage_id: factLineage,
    value: '主角是玩家变成的原住民',
    importance: 4,
    revision_chapter: 100,
    revision_reason: '第一百章揭露',
  }, backups);
  const invalidatedFact = await invoke('POST', `/v1/books/${bookId}/facts`, {
    operation: 'invalidate',
    lineage_id: factLineage,
    importance: 1,
    revision_chapter: 101,
    revision_reason: '后续证实该判断无效',
  }, backups);
  const facts = await invoke('GET', `/v1/books/${bookId}/facts`, null, backups);
  const factHistory = facts.json.fact_history.find(row => Number(row.lineage_id) === factLineage);
  expect(createdFact.status === 201
    && revisedFact.status === 200
    && revisedFact.json.fact.supersedes_id === createdFact.json.fact.id
    && invalidatedFact.status === 200
    && invalidatedFact.json.fact.status === 'invalid'
    && !facts.json.facts.some(row => Number(row.lineage_id) === factLineage)
    && factHistory.history.length === 3,
  'fact create, revise, invalidate, or append-only history failed');

  const firstCacheState = await invoke('GET', `/v1/books/${bookId}/cache-state`, null, backups);
  expect(firstCacheState.status === 200
    && firstCacheState.json.cache_version === 1
    && firstCacheState.json.comment_version === 1,
  'initial cache state did not return both versions');

  const metadataChanged = await invoke('PATCH', `/v1/books/${bookId}`, { title: '第六阶段临时验收书（改名）' }, backups);
  expect(metadataChanged.status === 200
    && metadataChanged.json.cache_version === 1
    && metadataChanged.json.comment_version === 1,
  'metadata update invalidated a reader cache');

  const chaptersChanged = await invoke('PATCH', `/v1/books/${bookId}/chapters`, {
    chapters: [
      { title: '第一章', start_idx: 0, end_idx: 100 },
      { title: '第二章', start_idx: 101, end_idx: 204 },
    ],
  }, backups);
  expect(chaptersChanged.status === 200 && chaptersChanged.json.cache_version === 2,
    'chapter update did not invalidate the content cache');
  const chaptersChangedState = await invoke('GET', `/v1/books/${bookId}/cache-state`, null, backups);
  expect(chaptersChangedState.json.cache_version === 2 && chaptersChangedState.json.comment_version === 1,
    'chapter update changed the comment cache version');

  const commentAdded = await invoke('POST', `/v1/books/${bookId}/comment`, {
    paragraph_idx: 1,
    content: '新增临时批注',
    from_who: 'human',
  }, backups);
  expect(commentAdded.status === 200
    && commentAdded.json.cache_version === 2
    && commentAdded.json.comment_version === 2
    && commentAdded.json.comment?.id === commentAdded.json.id
    && commentAdded.json.comment?.created_at,
  'comment creation did not update only the comment cache');

  const favoriteChanged = await invoke('PATCH', `/v1/books/comment/${commentAdded.json.id}`, { is_favorite: true }, backups);
  expect(favoriteChanged.status === 200
    && favoriteChanged.json.cache_version === 2
    && favoriteChanged.json.comment_version === 3,
  'favorite update did not update only the comment cache');

  const wavyAdded = await invoke('POST', `/v1/books/${bookId}/comment`, {
    paragraph_idx: 1,
    selected_text: 'needle',
    sel_start_idx: 0,
    sel_end_idx: 6,
    from_who: 'human',
    content: '',
    annotation_kind: 'wavy_underline',
  }, backups);
  expect(wavyAdded.status === 200
    && wavyAdded.json.cache_version === 2
    && wavyAdded.json.comment_version === 4,
  'wavy underline creation did not update only the comment cache');

  const commentsAfterMutations = await invoke('GET', `/v1/books/${bookId}/comments`, null, backups);
  expect(commentsAfterMutations.status === 200
    && commentsAfterMutations.json.comment_version === 4
    && commentsAfterMutations.json.comments.some(comment => comment.id === commentAdded.json.id)
    && commentsAfterMutations.json.comments.some(comment => comment.id === wavyAdded.json.id),
  'lightweight comments endpoint omitted annotations or the current comment version');

  const commentDeleted = await invoke('DELETE', `/v1/books/comment/${commentAdded.json.id}`, null, backups);
  expect(commentDeleted.status === 200
    && commentDeleted.json.cache_version === 2
    && commentDeleted.json.comment_version === 5,
  'comment deletion did not update only the comment cache');
  const commentsAfterDelete = await invoke('GET', `/v1/books/${bookId}/comments`, null, backups);
  expect(commentsAfterDelete.status === 200
    && commentsAfterDelete.json.comment_version === 5
    && !commentsAfterDelete.json.comments.some(comment => comment.id === commentAdded.json.id),
  'lightweight comments endpoint retained a deleted annotation');

  const chapterRules = await invoke('GET', `/v1/books/${bookId}/chapter-rules`, null, backups);
  expect(chapterRules.status === 200, 'chapter rule candidates were not returned');
  expect(chapterRules.json.candidates.some(candidate => candidate.id === 'cn_chapter'),
    'Chinese chapter headings were not exposed as a candidate');
  expect(chapterRules.json.candidates.some(candidate => candidate.id === 'arabic_numbered'),
    'numbered rule-list headings were not exposed as an optional candidate');
  expect(JSON.stringify(chapterRules.json.recommended_family_ids) === JSON.stringify(['cn_chapter']),
    'numbered rule-list headings displaced the stronger Chinese chapter rule');

  const chapterPreview = await invoke('POST', `/v1/books/${bookId}/chapter-rules/preview`, {
    family_ids: ['cn_chapter'],
    custom_rules: [],
  }, backups);
  expect(chapterPreview.status === 200, 'chapter rule preview failed');
  expect(chapterPreview.json.ranges.length === 2, 'chapter preview did not keep the two real chapters');
  expect(chapterPreview.json.ranges[0].start_idx === 0 && chapterPreview.json.ranges[0].end_idx === 4,
    'first preview range did not end before the second real chapter');
  expect(chapterPreview.json.ranges[1].start_idx === 5 && chapterPreview.json.ranges[1].end_idx === 204,
    'second preview range did not cover the remainder of the book');
  expect(!chapterPreview.json.ranges.some(chapter => /^[1-3][.、]/.test(chapter.title)),
    'numbered rule-list items leaked into the recommended table of contents');

  const beforeResegmentationDb = new Database(dbPath, { readonly: true });
  const annotationsBeforeResegmentation = beforeResegmentationDb.prepare(`SELECT
      id, paragraph_idx, selected_text, content, is_favorite, annotation_kind
    FROM book_comments WHERE book_id = ? ORDER BY id`).all(bookId);
  beforeResegmentationDb.close();

  const resegmented = await invoke('PATCH', `/v1/books/${bookId}/chapters`, {
    chapters: chapterPreview.json.ranges,
    chapter_rule: chapterPreview.json.selection,
  }, backups);
  expect(resegmented.status === 200 && resegmented.json.cache_version === 3,
    'applying a chapter rule did not update the chapter table and cache version');
  const resegmentedState = await invoke('GET', `/v1/books/${bookId}/cache-state`, null, backups);
  expect(resegmentedState.json.cache_version === 3 && resegmentedState.json.comment_version === 5,
    'resegmentation changed the independent comment version');

  const afterResegmentationDb = new Database(dbPath, { readonly: true });
  const storedResegmentedChapters = afterResegmentationDb.prepare(`SELECT
      chapter_no, title, start_idx, end_idx
    FROM book_chapters WHERE book_id = ? ORDER BY chapter_no`).all(bookId);
  const annotationsAfterResegmentation = afterResegmentationDb.prepare(`SELECT
      id, paragraph_idx, selected_text, content, is_favorite, annotation_kind
    FROM book_comments WHERE book_id = ? ORDER BY id`).all(bookId);
  const storedChapterRule = JSON.parse(
    afterResegmentationDb.prepare('SELECT chapter_rule_json FROM books WHERE id = ?').get(bookId).chapter_rule_json,
  );
  afterResegmentationDb.close();
  expect(new Set(storedResegmentedChapters.map(chapter => chapter.start_idx)).size === storedResegmentedChapters.length,
    'resegmentation stored duplicate chapter starts');
  expect(!storedResegmentedChapters.some(chapter => /^[1-3][.、]/.test(chapter.title)),
    'numbered rule-list items were stored as chapters');
  expect(JSON.stringify(storedChapterRule.family_ids) === JSON.stringify(['cn_chapter']),
    'selected chapter rule was not stored on the book');
  expect(JSON.stringify(annotationsAfterResegmentation) === JSON.stringify(annotationsBeforeResegmentation),
    'resegmentation changed annotations, favorites, or wavy underlines');

  const searchChapter = await invoke('GET', `/v1/books/${bookId}/search?q=needle&scope=chapter&chapter_no=1`, null, backups);
  expect(searchChapter.status === 200 && searchChapter.json.results.length > 0, 'chapter search did not return matches');
  const searchBook = await invoke('GET', `/v1/books/${bookId}/search?q=needle&scope=book`, null, backups);
  expect(searchBook.status === 200 && searchBook.json.results.length === 200 && searchBook.json.limited === true, 'book search did not apply the documented 200 result limit');

  const archive = await invoke('GET', `/v1/books/${bookId}/export?format=archive`, null, backups);
  expect(archive.status === 200, 'portable archive export failed');
  const archiveEntries = listArchiveEntries(archive.buffer);
  expect(archiveEntries.includes('book.json'), 'portable archive omitted safe book manifest');
  expect(archiveEntries.includes('original/original.txt'), 'portable archive omitted original TXT');
  expect(archiveEntries.includes('images/cover.png'), 'portable archive omitted book image');
  const archiveJson = new AdmZip(archive.buffer).readAsText('book.json');
  const exported = JSON.parse(archiveJson);
  expect(exported.progress?.page === 2, 'safe export omitted progress');
  expect(exported.chapters.length === 2, 'safe export omitted table of contents');
  expect(exported.summaries.length === 1
    && exported.facts.length >= 4
    && exported.reading_contexts.length === 2
    && exported.comment_summaries.length === 2,
  'safe export omitted story material, fact history, preludes, or comment summary versions');
  expect(exported.comments.length >= 2 && exported.chapter_chats.length === 1 && exported.reading_impressions.length === 1, 'safe export omitted annotations, chats, or impressions');
  expect(exported.comments.some(comment => comment.annotation_kind === 'wavy_underline'), 'safe export omitted wavy underline kind');
  expect(!archiveJson.includes('source_path') && !archiveJson.includes('must-never-export') && !archiveJson.includes('test_api_key'), 'safe export exposed a sensitive field');
  const epubArchive = await invoke('GET', `/v1/books/${epubBookId}/export?format=archive`, null, backups);
  expect(epubArchive.status === 200, 'EPUB portable archive export failed');
  expect(listArchiveEntries(epubArchive.buffer).includes('original/original.epub'),
    'portable archive omitted original EPUB');

  const automatic = await backups.catchUpAutomaticBackup();
  expect(automatic?.kind === 'automatic' && automatic.shanghai_date === '2026-08-10', 'automatic backup did not use Asia/Shanghai date');
  const sameAutomatic = await backups.catchUpAutomaticBackup();
  expect(sameAutomatic?.id === automatic.id, 'automatic backup ran more than once on the same Shanghai date');

  const manual = await backups.createBackup({ kind: 'manual' });
  expect(manual.kind === 'manual' && manual.statistics.books === 2, 'manual backup did not create a readable snapshot');
  const beforeRestore = backups.listBackups();
  expect(beforeRestore.some(item => item.id === manual.id && item.status === 'ready'), 'backup list omitted the manual backup');

  const activePermanentDelete = await invoke('DELETE', `/v1/books/${epubBookId}/permanent`, null, backups);
  expect(activePermanentDelete.status === 409, 'active book was allowed to bypass the trash before permanent deletion');
  const epubSoftDeleted = await invoke('DELETE', `/v1/books/${epubBookId}`, null, backups);
  expect(epubSoftDeleted.status === 200, 'EPUB fixture soft delete failed before permanent deletion');
  const epubPermanentlyDeleted = await invoke('DELETE', `/v1/books/${epubBookId}/permanent`, null, backups);
  expect(epubPermanentlyDeleted.status === 200 && epubPermanentlyDeleted.json.permanently_deleted === epubBookId,
    'trashed EPUB fixture was not permanently deleted');
  const afterPermanentDeleteDb = new Database(dbPath, { readonly: true });
  const taskIdsAfterDelete = afterPermanentDeleteDb.prepare('SELECT id FROM reading_tasks WHERE book_id=?').all(epubBookId).map(row => row.id);
  for (const table of [
    'books',
    'book_comments',
    'book_progress',
    'book_chapters',
    'book_summaries',
    'book_facts',
    'book_reading_contexts',
    'chapter_comment_summaries',
    'comment_summary_overviews',
    'reading_events',
    'book_chats',
    'book_reading_impressions',
    'book_paragraphs',
    'reading_tasks',
  ]) {
    expect(afterPermanentDeleteDb.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'books' ? 'id' : 'book_id'}=?`).get(epubBookId).count === 0,
      `permanent deletion left rows in ${table}`);
  }
  expect(taskIdsAfterDelete.length === 0, 'permanent deletion left reading tasks');
  expect(afterPermanentDeleteDb.prepare('SELECT COUNT(*) AS count FROM reading_task_items').get().count === 0,
    'permanent deletion left reading task items');
  expect(afterPermanentDeleteDb.prepare('SELECT COUNT(*) AS count FROM reading_task_usage').get().count === 0,
    'permanent deletion left reading task usage');
  afterPermanentDeleteDb.close();
  expect(!fs.existsSync(epubDir) && !fs.existsSync(epubImageDir), 'permanent deletion left EPUB resource directories');
  const permanentlyDeletedRestore = await invoke('POST', `/v1/books/${epubBookId}/restore`, {}, backups);
  expect(permanentlyDeletedRestore.status === 404, 'permanently deleted book was still restorable from the trash');

  const deleted = await invoke('DELETE', `/v1/books/${bookId}`, null, backups);
  expect(deleted.status === 200
    && deleted.json.cache_version === 3
    && deleted.json.comment_version === 5,
  'soft delete changed an otherwise valid reader cache version');
  const deletedState = await invoke('GET', `/v1/books/${bookId}/cache-state`, null, backups);
  expect(deletedState.status === 404, 'soft-deleted book still exposed a cache state');

  const restored = await invoke('POST', `/v1/books/${bookId}/restore`, {}, backups);
  expect(restored.status === 200
    && restored.json.cache_version === 3
    && restored.json.comment_version === 5,
  'book restore changed an otherwise valid reader cache version');
  const restoredState = await invoke('GET', `/v1/books/${bookId}/cache-state`, null, backups);
  expect(restoredState.status === 200
    && restoredState.json.cache_version === 3
    && restoredState.json.comment_version === 5,
  'restored book did not expose the preserved reader cache versions');

  const changedDb = getDb();
  changedDb.prepare('UPDATE book_paragraphs SET content=? WHERE book_id=? AND idx=0').run('已修改，恢复后不应保留', bookId);
  changedDb.prepare('UPDATE books SET title=?, deleted_at=datetime(\'now\') WHERE id=?').run('已修改的标题', bookId);
  changedDb.close();
  fs.writeFileSync(path.join(bookDir, 'original.txt'), '已修改原始文件', 'utf8');
  fs.writeFileSync(path.join(imageDir, 'cover.png'), Buffer.from('changed-image'));

  const preflight = backups.preflightRestore(manual.id);
  expect(preflight.scope === 'full_library' && preflight.confirmation_token && preflight.warning.includes('Per-book'), 'restore preflight did not issue a full-library confirmation');
  const restoreResult = await backups.restore(manual.id, preflight.confirmation_token);
  expect(restoreResult.ok && restoreResult.pre_restore_backup.kind === 'pre_restore', 'restore did not create a pre-restore backup');
  expect(fs.readFileSync(path.join(bookDir, 'original.txt'), 'utf8') === '原始 TXT 临时验收文本', 'restore did not restore original file');
  expect(fs.readFileSync(path.join(imageDir, 'cover.png')).equals(Buffer.from('fixture-image')), 'restore did not restore image resource');
  const restoredDb = new Database(dbPath, { readonly: true });
  const restoredBook = restoredDb.prepare('SELECT title, deleted_at FROM books WHERE id=?').get(bookId);
  const restoredParagraph = restoredDb.prepare('SELECT content FROM book_paragraphs WHERE book_id=? AND idx=0').get(bookId);
  restoredDb.close();
  expect(restoredBook.title === '第六阶段临时验收书（改名）' && restoredBook.deleted_at === null, 'restore did not restore database state');
  expect(restoredParagraph.content === '第一章 开始 needle', 'restore did not restore paragraph content');
  expect(backups.listBackups().some(item => item.id === restoreResult.pre_restore_backup.id), 'pre-restore backup was not retained');

  const expired = backups.preflightRestore(manual.id);
  now = new Date(now.getTime() + (6 * 60 * 1000));
  await assert.rejects(() => backups.restore(manual.id, expired.confirmation_token), /invalid or expired/);
  expect(fs.readFileSync(path.join(bookDir, 'original.txt'), 'utf8') === '原始 TXT 临时验收文本',
    'expired restore token changed live data');
  now = new Date('2026-08-09T20:10:00.000Z');

  const invalidId = 'manual-20260809201000-deadbeef';
  const invalidArchive = path.join(dataDir, 'backups', `${invalidId}.zip`);
  const malicious = new AdmZip();
  malicious.addFile('../../outside.txt', Buffer.from('not allowed'));
  malicious.addFile('manifest.json', Buffer.from(JSON.stringify({
    format: 'coread-library-backup',
    version: 1,
    id: invalidId,
    kind: 'manual',
    created_at: now.toISOString(),
    files: [{ path: '../../outside.txt', bytes: 11, sha256: 'a'.repeat(64) }],
  })));
  malicious.writeZip(invalidArchive);
  assert.throws(() => backups.preflightRestore(invalidId), /invalid archive path|invalid backup/);
  expect(fs.readFileSync(path.join(bookDir, 'original.txt'), 'utf8') === '原始 TXT 临时验收文本', 'invalid restore archive changed live data');

  expect(modelFetches === 0, `stage 6 isolated paths triggered ${modelFetches} network/model request(s)`);
  console.log(JSON.stringify({
    isolated_temp_directory: true,
    book_id_is_temporary_only: bookId,
    temporary_book_ids: [bookId, epubBookId],
    content_cache_versions_verified: [1, 2, 3],
    comment_cache_versions_verified: [1, 2, 3, 4, 5],
    legacy_comment_version_migration_verified: legacyMigrationVerified,
    lightweight_comments_endpoint_verified: true,
    chronological_comment_timeline_verified: true,
    reader_cache_split_static_guard: true,
    chapter_rule_resegmentation_verified: true,
    chapter_rule_preserved_annotations: true,
    same_page_chapter_navigation_guard: true,
    search_chapter_matches: searchChapter.json.results.length,
    search_book_returned: searchBook.json.results.length,
    search_book_limited: searchBook.json.limited,
    portable_archive_entries: archiveEntries,
    automatic_backup_shanghai_date: automatic.shanghai_date,
    backup_restore_verified: true,
    pre_restore_backup_verified: true,
    expired_token_rejected: true,
    traversal_archive_rejected: true,
    portable_epub_original_verified: true,
    permanent_delete_verified: true,
    reading_contexts_verified: true,
    comment_summary_versions_verified: true,
    fact_lineage_verified: true,
    cloud_progress_shapes_verified: true,
    local_preferences_static_guard: true,
    mobile_reader_gesture_static_guard: true,
    model_fetches: modelFetches,
  }));
} finally {
  backups.stopScheduler();
  fs.rmSync(root, { recursive: true, force: true });
}
