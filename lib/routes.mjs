import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { getDb, getDbPath, getImageDir, getBookFilesDir } from './db.mjs';
import { parseEpub, extractImages, extractCover, smartSplit } from './epub.mjs';
import {
  decodeTextBuffer,
  splitText,
  chapterRanges,
  chapterRuleCandidates,
  detectChapterStructure,
  isChapterTitle,
  encodingCandidates,
} from './text.mjs';
import { callModel, parseJsonObject, safeModelConfigSummary } from './models.mjs';
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const runningTasks = new Map();
const TASK_POLICY = {
  main: {
    label: '小 C 阅读',
    defaultConcurrency: 1,
    maxConcurrency: 5,
    softInput: 80_000,
    hardInput: 120_000,
    totalInputBudget: 500_000,
  },
  helper: {
    label: '小助手阅读',
    defaultConcurrency: 2,
    maxConcurrency: 8,
    softInput: 40_000,
    hardInput: 80_000,
    totalInputBudget: 1_000_000,
  },
};
const TASK_PROMPT_VERSION = 'stage6-v1';

const CHAPTER_RE = /^第[\d一二三四五六七八九十百千万]+[章节回]|^#|^Chapter\s+\d/i;

function saveReadingImpression(db, {
  bookId, chapterStart = null, chapterEnd = null, content, sourceLabel = 'human',
}) {
  const book = db.prepare('SELECT id FROM books WHERE id=? AND deleted_at IS NULL').get(bookId);
  if (!book) return null;
  const result = db.prepare(`
    INSERT INTO book_reading_impressions
      (book_id, chapter_start, chapter_end, content, source_label)
    VALUES (?, ?, ?, ?, ?)
  `).run(bookId, chapterStart || null, chapterEnd || null, String(content).trim(), sourceLabel);
  return db.prepare('SELECT * FROM book_reading_impressions WHERE id=?')
    .get(Number(result.lastInsertRowid));
}

// Unified server-side pagination shared by the reader, AI, and annotations.
// per_page 参数不再解析——前端/AI/批注页码共用同一坐标，不再各切各的页
export const BOOK_PER_PAGE = 28;

function isChapterHeading(text) {
  return isChapterTitle(String(text || '').trim());
}

export function computePageBreaks(db, bookId, perPage, charsPerLine = 22) {
  const paras = db.prepare('SELECT idx, content FROM book_paragraphs WHERE book_id = ? ORDER BY idx').all(bookId);
  const storedStarts = new Set(
    db.prepare('SELECT start_idx FROM book_chapters WHERE book_id = ? ORDER BY chapter_no')
      .all(bookId)
      .map(row => Number(row.start_idx))
      .filter(Number.isInteger),
  );
  const chapterStarts = storedStarts.size
    ? storedStarts
    : new Set(chapterRanges(paras.map(paragraph => paragraph.content)).map(range => range.start_idx));
  const pages = [];
  let cur = [];
  let curWeight = 0;
  const maxWeight = perPage;
  for (const p of paras) {
    if (chapterStarts.has(Number(p.idx)) && cur.length > 0) {
      pages.push(cur);
      cur = [];
      curWeight = 0;
    }
    const lines = Math.max(1, Math.ceil(p.content.length / charsPerLine));
    if (curWeight + lines > maxWeight && cur.length > 0) {
      pages.push(cur);
      cur = [];
      curWeight = 0;
    }
    cur.push(p.idx);
    curWeight += lines;
  }
  if (cur.length > 0) pages.push(cur);
  return pages;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function parseBookInput(body) {
  const format = body.format || 'txt';
  let paragraphs = [];
  let sourceEncoding = 'utf-8';
  let sourceBytes = null;
  let epubResult = null;

  if (format === 'epub' && body.data) {
    epubResult = parseEpub(body.data);
    paragraphs = epubResult.paragraphs;
    sourceBytes = Buffer.from(body.data, 'base64');
  } else if ((format === 'txt' || format === 'md') && body.data) {
    sourceBytes = Buffer.from(body.data, 'base64');
    const decoded = decodeTextBuffer(sourceBytes, body.encoding || 'auto');
    sourceEncoding = decoded.encoding;
    paragraphs = splitText(decoded.text, body.chapter_mode || 'auto');
  } else if (body.content) {
    paragraphs = format === 'txt' ? splitText(body.content, body.chapter_mode || 'auto') : smartSplit(body.content);
  } else {
    throw new Error('content or epub data required');
  }
  if (!paragraphs.length) throw new Error('no paragraphs extracted');
  return { format, paragraphs, sourceEncoding, sourceBytes, epubResult };
}

function normalizedChapterRanges(paragraphs, input) {
  if (!Array.isArray(input) || !input.length) return chapterRanges(paragraphs);
  const max = paragraphs.length - 1;
  const ranges = input.map((item, index) => ({
    chapter_no: index + 1,
    title: String(item?.title || `第 ${index + 1} 章`).trim().slice(0, 120),
    start_idx: Number(item?.start_idx),
    end_idx: Number(item?.end_idx),
  }));
  let cursor = 0;
  for (const range of ranges) {
    if (!Number.isInteger(range.start_idx) || !Number.isInteger(range.end_idx)
      || range.start_idx !== cursor || range.start_idx < 0
      || range.end_idx < range.start_idx || range.end_idx > max) {
      throw new Error('invalid chapter ranges');
    }
    cursor = range.end_idx + 1;
  }
  if (cursor !== paragraphs.length) throw new Error('chapter ranges must cover the whole book');
  return ranges;
}

function previewChapters(paragraphs, ranges) {
  return ranges.map(ch => ({
    chapter_no: ch.chapter_no,
    title: ch.title,
    start_idx: ch.start_idx,
    end_idx: ch.end_idx,
    paragraph_count: ch.end_idx - ch.start_idx + 1,
  }));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-owner-key');
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function getChapter(db, bookId, chapterNo) {
  return db.prepare(`
    SELECT c.chapter_no, c.title, c.start_idx, c.end_idx,
      GROUP_CONCAT(p.content, '\n\n') AS content
    FROM book_chapters c
    JOIN book_paragraphs p ON p.book_id = c.book_id AND p.idx BETWEEN c.start_idx AND c.end_idx
    WHERE c.book_id = ? AND c.chapter_no = ?
    GROUP BY c.id
  `).get(bookId, chapterNo);
}

function summaryRows(db, bookId) {
  return db.prepare(`SELECT id, chapter_no, kind, text, source, model, locked, event_id, source_composition, version, created_at, updated_at
    FROM book_summaries WHERE book_id = ? ORDER BY chapter_no IS NULL, chapter_no, created_at, kind`).all(bookId);
}

function preferredSummaryRows(rows, kind) {
  const preferred = new Map();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    const chapterNo = Number(row.chapter_no);
    const current = preferred.get(chapterNo);
    // A locked manual revision is deliberate. Later reading events remain in
    // history, but must not silently replace the version used for recall.
    if (!current || row.locked || !current.locked) preferred.set(chapterNo, row);
  }
  return [...preferred.values()].sort((a, b) => Number(a.chapter_no) - Number(b.chapter_no));
}

function summaryProvenance(row) {
  const composition = String(row?.source_composition || '').trim().toLowerCase();
  if (composition === 'mixed' || composition === 'main+helper' || composition === 'helper+main') return '混合来源大总结';
  if (composition === 'main') return '主模型亲读';
  if (composition === 'helper') return '小助手扫读';
  if (composition === 'manual') return '人工修订';
  if (row?.source_composition) return String(row.source_composition);
  if (row?.kind === 'chapter_helper') return '小助手扫读';
  if (row?.kind === 'chapter' && row.locked && row.source === 'manual') return '人工修订';
  if (row?.kind === 'chapter') return '主模型亲读';
  if (row?.kind === 'block') return '主模型亲读';
  return row?.source || '未知来源';
}

function preferredChapterSummaryRows(rows) {
  const preferred = new Map();
  for (const row of rows) {
    if (!['chapter', 'chapter_helper'].includes(row.kind)) continue;
    const chapterNo = Number(row.chapter_no);
    if (!Number.isInteger(chapterNo)) continue;
    const current = preferred.get(chapterNo);
    const rank = row.locked && row.source === 'manual' ? 3 : row.kind === 'chapter' ? 2 : 1;
    const currentRank = current
      ? (current.locked && current.source === 'manual' ? 3 : current.kind === 'chapter' ? 2 : 1)
      : 0;
    if (!current || rank > currentRank || (rank === currentRank && Number(row.id) > Number(current.id))) {
      preferred.set(chapterNo, { ...row, provenance: summaryProvenance(row) });
    }
  }
  return [...preferred.values()].sort((a, b) => Number(a.chapter_no) - Number(b.chapter_no));
}

function allFactRows(db, bookId) {
  return db.prepare(`SELECT id, book_id, chapter_no, event_id, lineage_id, supersedes_id, status,
      importance, operation, fact_type, key_name, value, source, revision_chapter,
      revision_reason, source_evidence, created_at, updated_at
    FROM book_facts WHERE book_id = ? ORDER BY lineage_id, id`).all(bookId);
}

function currentFactRows(db, bookId) {
  const current = new Map();
  for (const row of allFactRows(db, bookId)) current.set(Number(row.lineage_id || row.id), row);
  return [...current.values()]
    .filter(row => row.status === 'active' && row.operation !== 'invalidate')
    .sort((a, b) => Number(b.importance || 3) - Number(a.importance || 3)
      || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
      || Number(b.id) - Number(a.id));
}

function factHistoryRows(db, bookId) {
  const rows = allFactRows(db, bookId);
  const grouped = new Map();
  for (const row of rows) {
    const lineageId = Number(row.lineage_id || row.id);
    if (!grouped.has(lineageId)) grouped.set(lineageId, []);
    grouped.get(lineageId).push(row);
  }
  return [...grouped.entries()].map(([lineage_id, history]) => ({
    lineage_id,
    current: history[history.length - 1],
    history,
  })).sort((a, b) => Number(b.current.importance || 3) - Number(a.current.importance || 3)
    || Number(b.current.id) - Number(a.current.id));
}

function normalizeImportance(value, fallback = 3) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(5, Math.max(1, parsed)) : fallback;
}

function appendFactVersion(db, {
  bookId,
  operation = 'create',
  lineageId = null,
  factType = '事实',
  keyName,
  value = '',
  importance = 3,
  chapterNo = 0,
  eventId = null,
  source = 'manual',
  reason = '',
  evidence = '',
}) {
  const op = ['create', 'revise', 'invalidate'].includes(operation) ? operation : 'create';
  let previous = null;
  if (op !== 'create') {
    previous = db.prepare(`SELECT * FROM book_facts
      WHERE book_id=? AND lineage_id=? ORDER BY id DESC LIMIT 1`).get(bookId, Number(lineageId));
    if (!previous) throw new Error('fact lineage not found');
  }
  const key = String(keyName || previous?.key_name || '').trim().slice(0, 300);
  const text = String(value || previous?.value || '').trim().slice(0, 4000);
  if (!key || (op !== 'invalidate' && !text)) throw new Error('fact key and value required');
  const result = db.prepare(`INSERT INTO book_facts
    (book_id, chapter_no, event_id, lineage_id, supersedes_id, status, importance, operation,
     fact_type, key_name, value, source, revision_chapter, revision_reason, source_evidence)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      bookId,
      Math.max(0, Number(chapterNo) || 0),
      eventId || null,
      previous?.id || null,
      op === 'invalidate' ? 'invalid' : 'active',
      normalizeImportance(importance, Number(previous?.importance || 3)),
      op,
      String(factType || previous?.fact_type || '事实').trim().slice(0, 100),
      key || previous?.key_name,
      op === 'invalidate' ? (text || previous?.value || '') : text,
      String(source || 'manual').slice(0, 100),
      Math.max(0, Number(chapterNo) || 0),
      String(reason || '').trim().slice(0, 1000) || null,
      String(evidence || '').trim().slice(0, 2000) || null,
    );
  const id = Number(result.lastInsertRowid);
  const resolvedLineage = previous ? Number(previous.lineage_id || previous.id) : id;
  db.prepare('UPDATE book_facts SET lineage_id=? WHERE id=?').run(resolvedLineage, id);
  return db.prepare('SELECT * FROM book_facts WHERE id=?').get(id);
}

function applyFactOperations(db, {
  bookId,
  chapterNo,
  eventId = null,
  source = 'main',
  operations = [],
  legacyFacts = [],
}) {
  const normalized = Array.isArray(operations) ? [...operations] : [];
  for (const fact of Array.isArray(legacyFacts) ? legacyFacts : []) {
    normalized.push({
      operation: 'create',
      type: fact?.type,
      key: fact?.key,
      value: fact?.value,
      importance: fact?.importance,
      reason: fact?.reason,
      evidence: fact?.evidence,
    });
  }
  const saved = [];
  for (const item of normalized) {
    const operation = ['revise', 'invalidate'].includes(item?.operation) ? item.operation : 'create';
    const lineageId = Number(item?.lineage_id);
    if (operation !== 'create' && !Number.isInteger(lineageId)) continue;
    const previous = operation === 'create' ? null : db.prepare(`SELECT * FROM book_facts
      WHERE book_id=? AND lineage_id=? ORDER BY id DESC LIMIT 1`).get(bookId, lineageId);
    if (operation !== 'create' && !previous) continue;
    const key = String(item?.key || previous?.key_name || '').trim();
    const value = String(item?.value || previous?.value || '').trim();
    if (!key || (operation !== 'invalidate' && !value)) continue;
    saved.push(appendFactVersion(db, {
      bookId,
      operation,
      lineageId: operation === 'create' ? null : lineageId,
      factType: item?.type || previous?.fact_type || '事实',
      keyName: key,
      value,
      importance: item?.importance ?? previous?.importance ?? 3,
      chapterNo,
      eventId,
      source,
      reason: item?.reason || '',
      evidence: item?.evidence || '',
    }));
  }
  return saved;
}

function readingContextRows(db, bookId) {
  return db.prepare(`SELECT id, book_id, chapter_no, context_kind, content, source, version, created_at, updated_at
    FROM book_reading_contexts WHERE book_id=? ORDER BY chapter_no, context_kind`).all(bookId);
}

function saveReadingContext(db, { bookId, chapterNo = 0, kind, content, source = 'human' }) {
  const normalizedKind = kind === 'chapter_prelude' ? 'chapter_prelude' : 'book_prelude';
  const normalizedChapter = normalizedKind === 'book_prelude' ? 0 : Math.max(1, Number(chapterNo) || 1);
  db.prepare(`INSERT INTO book_reading_contexts
      (book_id, chapter_no, context_kind, content, source)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(book_id, chapter_no, context_kind) DO UPDATE SET
      content=excluded.content, source=excluded.source, version=book_reading_contexts.version+1,
      updated_at=datetime('now')`)
    .run(bookId, normalizedChapter, normalizedKind, String(content || '').trim().slice(0, 20_000), source);
  return db.prepare(`SELECT * FROM book_reading_contexts
    WHERE book_id=? AND chapter_no=? AND context_kind=?`).get(bookId, normalizedChapter, normalizedKind);
}

function latestCommentSummaryRows(db, bookId) {
  return db.prepare(`SELECT s.* FROM chapter_comment_summaries s
    JOIN (
      SELECT chapter_no, MAX(version) AS version
      FROM chapter_comment_summaries WHERE book_id=? GROUP BY chapter_no
    ) latest ON latest.chapter_no=s.chapter_no AND latest.version=s.version
    WHERE s.book_id=? ORDER BY s.chapter_no`).all(bookId, bookId);
}

function invalidateCommentSummaryOverview(db, bookId, chapterNo) {
  const blockStart = Math.floor((Math.max(1, Number(chapterNo) || 1) - 1) / 30) * 30 + 1;
  db.prepare('DELETE FROM comment_summary_overviews WHERE book_id=? AND block_start=?').run(bookId, blockStart);
}

function saveCommentSummary(db, {
  bookId,
  chapterNo,
  content,
  source = 'main',
  eventId = null,
  requestKey = null,
}) {
  const text = String(content || '').trim();
  if (!text) throw new Error('comment summary required');
  if (requestKey) {
    const existing = db.prepare('SELECT * FROM chapter_comment_summaries WHERE request_key=?').get(requestKey);
    if (existing) return existing;
  }
  const version = Number(db.prepare(`SELECT MAX(version) AS version
    FROM chapter_comment_summaries WHERE book_id=? AND chapter_no=?`).get(bookId, chapterNo)?.version || 0) + 1;
  const result = db.prepare(`INSERT INTO chapter_comment_summaries
    (book_id, chapter_no, version, content, source, event_id, request_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      bookId, chapterNo, version, text.slice(0, 12_000), source, eventId || null, requestKey || null,
    );
  invalidateCommentSummaryOverview(db, bookId, chapterNo);
  return db.prepare('SELECT * FROM chapter_comment_summaries WHERE id=?').get(Number(result.lastInsertRowid));
}

function commentSummaryMemory(db, bookId, targetChapter = null, { allowOverviewWrite = false } = {}) {
  const summaries = latestCommentSummaryRows(db, bookId);
  const blocks = [];
  for (let start = 1; start <= Math.max(0, ...summaries.map(row => Number(row.chapter_no))); start += 30) {
    const rows = summaries.filter(row => Number(row.chapter_no) >= start && Number(row.chapter_no) < start + 30);
    if (!rows.length) continue;
    if (targetChapter && rows.some(row => Number(row.chapter_no) === Number(targetChapter))) {
      blocks.push({ block_start: start, block_end: start + 29, kind: 'raw', summaries: rows });
      continue;
    }
    const signature = rows.map(row => `${row.chapter_no}:${row.version}`).join(',');
    let overview = db.prepare(`SELECT * FROM comment_summary_overviews
      WHERE book_id=? AND block_start=? AND source_version=?`).get(bookId, start, signature);
    if (!overview && allowOverviewWrite) {
      const content = rows.map(row => `第${row.chapter_no}章：${row.content}`).join('\n').slice(0, 18_000);
      db.prepare(`INSERT INTO comment_summary_overviews
          (book_id, block_start, block_end, content, source_version)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(book_id, block_start) DO UPDATE SET
          block_end=excluded.block_end, content=excluded.content, source_version=excluded.source_version,
          updated_at=datetime('now')`).run(bookId, start, start + 29, content, signature);
      overview = db.prepare('SELECT * FROM comment_summary_overviews WHERE book_id=? AND block_start=?').get(bookId, start);
    }
    if (overview) blocks.push({ ...overview, kind: 'overview' });
    else blocks.push({ block_start: start, block_end: start + 29, kind: 'raw', summaries: rows });
  }
  return {
    instruction: '这些是我们已共同经历过的重读记忆，可能包含当前章节之后的揭露。可据此理解信息差，但不得把未来信息写成人物此刻已经知道的事实。',
    blocks,
  };
}

function favoriteCommentRows(db, bookId) {
  return db.prepare(`SELECT c.id, c.paragraph_idx, c.selected_text, c.from_who, c.content,
      c.source_label, c.created_at, ch.chapter_no, ch.title AS chapter_title
    FROM book_comments c
    LEFT JOIN book_chapters ch ON ch.book_id=c.book_id
      AND c.paragraph_idx BETWEEN ch.start_idx AND ch.end_idx
    WHERE c.book_id=? AND c.is_favorite=1
    ORDER BY ch.chapter_no, c.paragraph_idx, c.created_at, c.id`).all(bookId);
}

function relevantFactRows(db, bookId, referenceText = '') {
  const needle = String(referenceText || '').toLocaleLowerCase();
  return currentFactRows(db, bookId).filter(row => {
    const importance = normalizeImportance(row.importance);
    if (importance === 5) return true;
    const candidates = importance <= 2 ? [row.key_name] : [row.key_name, row.value];
    const terms = candidates
      .flatMap(value => String(value || '').split(/[\s,，。；;、：:（）()“”"'《》]+/))
      .filter(term => term.length >= 2);
    const matches = terms.some(term => needle.includes(term.toLocaleLowerCase()));
    return importance >= 3 ? matches : matches;
  });
}

function makeReviewContext(db, bookId, mode = 'layered', beforeChapter = null, options = {}) {
  const limitChapter = Number.isInteger(Number(beforeChapter)) && Number(beforeChapter) > 0
    ? Number(beforeChapter)
    : null;
  const summaries = db.prepare(`SELECT id, chapter_no, kind, text, source, locked, source_composition, created_at
    FROM book_summaries
    WHERE book_id = ? AND kind IN ('chapter', 'chapter_helper', 'block')
      AND (chapter_no IS NULL OR ? IS NULL OR chapter_no < ?)
    ORDER BY chapter_no, id`).all(bookId, limitChapter, limitChapter);
  const referenceText = options.referenceText || '';
  const facts = options.includeFacts === false ? [] : relevantFactRows(db, bookId, referenceText);
  const chapters = preferredChapterSummaryRows(summaries);
  const blocks = preferredSummaryRows(summaries, 'block')
    .filter(row => limitChapter == null || Number(row.chapter_no) < limitChapter)
    .map(row => ({ ...row, provenance: summaryProvenance(row) }));
  const knownThrough = limitChapter == null
    ? Math.max(0, ...chapters.map(c => Number(c.chapter_no || 0)))
    : Math.max(0, limitChapter - 1);
  const recentCutoff = Math.max(0, knownThrough - 29);
  const selected = mode === 'fine'
    ? chapters
    : chapters.filter(row => Number(row.chapter_no) > recentCutoff);
  const older = mode === 'fine'
    ? []
    : blocks.filter(row => Number(row.chapter_no || 0) <= recentCutoff);
  const contexts = readingContextRows(db, bookId);
  return {
    mode,
    before_chapter: limitChapter,
    known_through: knownThrough,
    chapter_summaries: selected.map(row => ({
      ...row,
      provenance: row.provenance || summaryProvenance(row),
    })),
    block_summaries: older,
    facts,
    book_prelude: options.includeBookPrelude === false
      ? null
      : contexts.find(row => row.context_kind === 'book_prelude') || null,
    chapter_prelude: options.includeChapterPrelude === false
      ? null
      : contexts.find(row => row.context_kind === 'chapter_prelude'
        && Number(row.chapter_no) === Number(limitChapter)) || null,
    comment_summary_memory: options.includeCommentSummaries === false
      ? { instruction: '', blocks: [] }
      : commentSummaryMemory(db, bookId, limitChapter, {
        allowOverviewWrite: Boolean(options.allowCommentSummaryOverviewWrite),
      }),
    favorite_comments: options.includeFavorites ? favoriteCommentRows(db, bookId) : [],
  };
}

function contentHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function estimatedTokens(text) {
  // Chinese-heavy source material is commonly closer to one token per character
  // than English prose. This deliberately conservative fallback is disclosed.
  return Math.max(1, Math.ceil(String(text || '').length / 1.5));
}

function dynamicSummaryInstruction(chapterText) {
  const chars = String(chapterText || '').length;
  const target = Math.max(120, Math.round(chars / 10));
  return `摘要建议约 ${target} 字，但只是软目标。按信息密度动态调整：打斗、重复环境描写和空泛对白要降噪；剧情线、感情线、伏笔、转折、人物关系变化必须保留。与已有摘要重复且没有新增意义的信息合并，不要机械重复；可能是铺垫的重复意象、物件、线索仍要保留。`;
}

function locateQuote(db, bookId, chapter, quote) {
  const text = String(quote || '').trim();
  if (!text) return null;
  const paragraphs = db.prepare(`SELECT idx, content FROM book_paragraphs
    WHERE book_id = ? AND idx BETWEEN ? AND ? ORDER BY idx`).all(bookId, chapter.start_idx, chapter.end_idx);
  for (const para of paragraphs) {
    const offset = String(para.content || '').indexOf(text);
    if (offset >= 0) {
      return { paragraph_idx: para.idx, sel_start_idx: offset, sel_end_idx: offset + text.length, sel_end_para_idx: para.idx };
    }
  }
  return null;
}

function chapterForParagraph(db, bookId, paragraphIdx) {
  return db.prepare(`SELECT * FROM book_chapters
    WHERE book_id = ? AND start_idx <= ? AND end_idx >= ?`).get(bookId, paragraphIdx, paragraphIdx);
}

function threadKeyForRange(db, bookId, paragraphIdx, startIdx, endIdx) {
  if (startIdx == null || endIdx == null) return `chapter-note:${bookId}:${paragraphIdx}`;
  const overlaps = db.prepare(`SELECT thread_key FROM book_comments
    WHERE book_id = ? AND paragraph_idx = ? AND sel_start_idx IS NOT NULL
      AND sel_end_idx IS NOT NULL AND sel_start_idx < ? AND sel_end_idx > ?
      AND thread_key IS NOT NULL
    ORDER BY id`).all(bookId, paragraphIdx, endIdx, startIdx);
  const canonical = overlaps[0]?.thread_key;
  if (canonical) {
    const keys = [...new Set(overlaps.map(row => row.thread_key).filter(key => key && key !== canonical))];
    if (keys.length) {
      const placeholders = keys.map(() => '?').join(',');
      db.prepare(`UPDATE book_comments SET thread_key=? WHERE book_id=? AND thread_key IN (${placeholders})`)
        .run(canonical, bookId, ...keys);
    }
    return canonical;
  }
  return `range:${bookId}:${paragraphIdx}:${startIdx}-${endIdx}`;
}

function threadComments(db, bookId, root) {
  if (root.thread_key) {
    return db.prepare(`SELECT * FROM book_comments WHERE book_id = ? AND thread_key = ?
      ORDER BY created_at, id`).all(bookId, root.thread_key);
  }
  const seed = root.id;
  return db.prepare(`WITH RECURSIVE thread(id) AS (
      SELECT ?
      UNION ALL
      SELECT c.id FROM book_comments c JOIN thread t ON c.reply_to = t.id
    )
    SELECT * FROM book_comments WHERE id IN (SELECT id FROM thread) ORDER BY created_at, id`).all(seed);
}

function annotationExcerpt(db, bookId, chapter, endParagraph) {
  const rows = db.prepare(`SELECT idx, content FROM book_paragraphs
    WHERE book_id = ? AND idx BETWEEN ? AND ? ORDER BY idx`).all(bookId, chapter.start_idx, chapter.end_idx);
  let charsAfter = 0;
  let afterParagraphs = 0;
  const selected = [];
  for (const row of rows) {
    if (row.idx <= endParagraph) {
      selected.push(row);
      continue;
    }
    if (afterParagraphs >= 3 || charsAfter >= 800) break;
    selected.push(row);
    afterParagraphs += 1;
    charsAfter += String(row.content || '').length;
  }
  return selected.map(row => row.content).join('\n\n');
}

function touchBookCache(db, bookId) {
  db.prepare('UPDATE books SET cache_version = cache_version + 1 WHERE id = ?').run(bookId);
  return Number(db.prepare('SELECT cache_version FROM books WHERE id = ?').get(bookId)?.cache_version || 1);
}

function touchCommentCache(db, bookId) {
  db.prepare('UPDATE books SET comment_version = comment_version + 1 WHERE id = ?').run(bookId);
  return Number(db.prepare('SELECT comment_version FROM books WHERE id = ?').get(bookId)?.comment_version || 1);
}

function insertCommentOnce(db, data) {
  const annotationKind = data.annotation_kind === 'wavy_underline' ? 'wavy_underline' : 'comment';
  const content = String(data.content || '').trim();
  if (!content && annotationKind !== 'wavy_underline') return null;
  if (data.dedupe_key) {
    const existing = db.prepare('SELECT id FROM book_comments WHERE dedupe_key = ?').get(data.dedupe_key);
    if (existing) return existing.id;
  }
  const result = db.prepare(`INSERT INTO book_comments
    (book_id, paragraph_idx, sel_start_idx, sel_end_idx, sel_end_para_idx, selected_text, from_who, content, reply_to, event_id, thread_key, source_label, is_favorite, annotation_kind, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      data.book_id, data.paragraph_idx, data.sel_start_idx ?? null, data.sel_end_idx ?? null,
      data.sel_end_para_idx ?? null, data.selected_text || null, data.from_who || 'ai',
      content, data.reply_to ?? null, data.event_id ?? null, data.thread_key || null,
      data.source_label || data.from_who || 'human', data.is_favorite ? 1 : 0, annotationKind, data.dedupe_key || null,
    );
  touchCommentCache(db, data.book_id);
  return Number(result.lastInsertRowid);
}

function insertSummary(db, data) {
  const text = String(data.text || '').trim();
  if (!text) throw new Error('model returned an empty summary');
  if (data.event_id) {
    const existing = db.prepare(`SELECT id FROM book_summaries
      WHERE book_id = ? AND chapter_no = ? AND kind = ? AND event_id = ?`).get(data.book_id, data.chapter_no, data.kind, data.event_id);
    if (existing) return existing.id;
    const result = db.prepare(`INSERT INTO book_summaries
      (book_id, chapter_no, kind, text, source, model, locked, event_id, source_composition, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      data.book_id, data.chapter_no ?? null, data.kind, text, data.source || 'main',
      data.model || null, data.locked ? 1 : 0, data.event_id, data.source_composition || null, data.version || 1,
    );
    return Number(result.lastInsertRowid);
  }
  const existing = db.prepare(`SELECT id FROM book_summaries
    WHERE book_id = ? AND chapter_no IS ? AND kind = ? AND event_id IS NULL`).get(data.book_id, data.chapter_no ?? null, data.kind);
  if (existing) {
    db.prepare(`UPDATE book_summaries SET text=?, source=?, model=?, locked=?, source_composition=?, version=version+1, updated_at=datetime('now') WHERE id=?`)
      .run(text, data.source || 'manual', data.model || null, data.locked ? 1 : 0, data.source_composition || null, existing.id);
    return existing.id;
  }
  const result = db.prepare(`INSERT INTO book_summaries
    (book_id, chapter_no, kind, text, source, model, locked, event_id, source_composition, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 1)`).run(
    data.book_id, data.chapter_no ?? null, data.kind, text, data.source || 'manual', data.model || null, data.locked ? 1 : 0,
    data.source_composition || null,
  );
  return Number(result.lastInsertRowid);
}

function normalizeTaskType(value) {
  return value === 'helper' ? 'helper' : 'main';
}

function taskPolicy(taskType) {
  return TASK_POLICY[normalizeTaskType(taskType)];
}

function chapterBudgetEstimate(chars, taskType) {
  const sourceTokens = Math.max(1, Math.ceil(Math.max(0, Number(chars) || 0) / 1.5));
  const contextTokens = taskType === 'main' ? Math.min(16_000, Math.max(900, Math.ceil(sourceTokens * 0.12))) : 500;
  const outputTokens = taskType === 'main'
    ? Math.min(8_000, Math.max(1_200, Math.ceil(sourceTokens / 8)))
    : Math.min(3_000, Math.max(500, Math.ceil(sourceTokens / 14)));
  return { input_tokens: sourceTokens + contextTokens, output_tokens: outputTokens };
}

function requestedTaskBudget(value, policy) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return policy.totalInputBudget;
  return Math.min(policy.totalInputBudget, Math.max(1_000, Math.floor(requested)));
}

function previewReadingTask(db, {
  bookId,
  taskType = 'main',
  startChapter,
  endChapter,
  requestedConcurrency = null,
  budgetTokens = null,
}) {
  const id = Number(bookId);
  const role = normalizeTaskType(taskType);
  const policy = taskPolicy(role);
  if (!Number.isInteger(id)) throw new Error('book_id must be an integer');
  const book = db.prepare('SELECT id, title FROM books WHERE id=? AND deleted_at IS NULL').get(id);
  if (!book) throw new Error('book not found');
  const total = Number(db.prepare('SELECT MAX(chapter_no) AS total FROM book_chapters WHERE book_id=?').get(id)?.total || 0);
  if (!total) throw new Error('book has no chapters');
  const start = Math.min(total, Math.max(1, Number.parseInt(startChapter, 10) || 1));
  const end = Math.min(total, Math.max(start, Number.parseInt(endChapter, 10) || start));
  const requested = Number(requestedConcurrency);
  const concurrency = Math.min(policy.maxConcurrency, Math.max(1, Number.isInteger(requested) ? requested : policy.defaultConcurrency));
  const rows = db.prepare(`SELECT c.chapter_no, c.title, COALESCE(SUM(length(p.content)), 0) AS chars
    FROM book_chapters c
    LEFT JOIN book_paragraphs p ON p.book_id=c.book_id AND p.idx BETWEEN c.start_idx AND c.end_idx
    WHERE c.book_id=? AND c.chapter_no BETWEEN ? AND ?
    GROUP BY c.id ORDER BY c.chapter_no`).all(id, start, end);
  const chapters = rows.map(row => ({ ...row, ...chapterBudgetEstimate(row.chars, role) }));
  const estimatedInput = chapters.reduce((sum, row) => sum + row.input_tokens, 0);
  const estimatedOutput = chapters.reduce((sum, row) => sum + row.output_tokens, 0);
  const budget = requestedTaskBudget(budgetTokens, policy);
  const softChapters = chapters.filter(row => row.input_tokens > policy.softInput).map(row => row.chapter_no);
  const hardChapters = chapters.filter(row => row.input_tokens > policy.hardInput).map(row => row.chapter_no);
  return {
    book_id: id,
    book_title: book.title,
    task_type: role,
    model_role: role,
    source_label: role === 'main' ? '主模型精读' : '副 API 扫读',
    start_chapter: start,
    end_chapter: end,
    chapter_count: chapters.length,
    chapters,
    estimated_requests: chapters.length,
    estimated_input_tokens: estimatedInput,
    estimated_output_tokens: estimatedOutput,
    estimates_are_conservative: true,
    budget_tokens: budget,
    estimated_over_budget: estimatedInput > budget,
    concurrency,
    limits: {
      soft_input_tokens: policy.softInput,
      hard_input_tokens: policy.hardInput,
      total_input_budget: policy.totalInputBudget,
      default_concurrency: policy.defaultConcurrency,
      max_concurrency: policy.maxConcurrency,
    },
    soft_limit_chapters: softChapters,
    hard_limit_chapters: hardChapters,
    requires_confirmation: softChapters.length > 0 || estimatedInput > budget,
    blocked: hardChapters.length > 0,
  };
}

export function createReadingTask({
  bookId,
  taskType = 'main',
  startChapter,
  endChapter,
  reviewMode = 'layered',
  requestKey = null,
  budgetTokens = null,
  requestedConcurrency = null,
  confirmBudget = false,
}) {
  const id = Number(bookId);
  const role = normalizeTaskType(taskType);
  const mode = reviewMode === 'fine' ? 'fine' : 'layered';
  const key = String(requestKey || '').trim() || null;
  const policy = taskPolicy(role);
  const db = getDb();
  try {
    return db.transaction(() => {
      if (key) {
        const existing = db.prepare('SELECT * FROM reading_tasks WHERE request_key=?').get(key);
        if (existing) return { task: existing, preview: null, deduped: true };
      }
      const preview = previewReadingTask(db, {
        bookId: id,
        taskType: role,
        startChapter,
        endChapter,
        requestedConcurrency,
        budgetTokens,
      });
      if (preview.requires_confirmation && !confirmBudget) {
        const error = new Error('任务达到预算软提醒，请确认后再启动');
        error.code = 'budget_confirmation_required';
        error.preview = preview;
        throw error;
      }
      const budget = requestedTaskBudget(budgetTokens, policy);
      const initialStatus = preview.blocked ? 'waiting' : 'queued';
      const initialReason = preview.blocked
        ? `第 ${preview.hard_limit_chapters.join('、')} 章预计超过单次输入硬上限，请先拆分章节后再继续`
        : null;
      const task = db.prepare(`INSERT INTO reading_tasks
        (book_id, task_type, model_role, start_chapter, end_chapter, review_mode, request_key, status,
          budget_tokens, requested_concurrency, estimated_input_tokens, estimated_output_tokens,
          budget_confirmed, soft_limit_tokens, hard_limit_tokens, pause_reason, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, role, role, preview.start_chapter, preview.end_chapter, mode, key, initialStatus, budget, preview.concurrency,
          preview.estimated_input_tokens, preview.estimated_output_tokens, confirmBudget ? 1 : 0,
          policy.softInput, policy.hardInput, initialReason, initialReason,
        );
      const taskId = Number(task.lastInsertRowid);
      for (const chapterNo of preview.chapters ? preview.chapters.map(row => row.chapter_no) : []) {
        // preview rows are intentionally not exposed; resolve the chapter once so
        // each queued item has a stable source hash and reading event.
        const chapter = getChapter(db, id, chapterNo);
        if (!chapter) throw new Error(`chapter ${chapterNo} not found`);
        const hash = contentHash(chapter.content);
        const event = db.prepare(`INSERT INTO reading_events
          (book_id, chapter_no, task_id, review_mode, source, status, content_hash, prompt_version)
          VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`).run(id, chapterNo, taskId, mode, role, hash, TASK_PROMPT_VERSION);
        const eventId = Number(event.lastInsertRowid);
        const itemKey = `book:${id}:chapter:${chapterNo}:hash:${hash}:event:${eventId}:prompt:${TASK_PROMPT_VERSION}:role:${role}`;
        const isBlocked = preview.hard_limit_chapters.includes(chapterNo);
        db.prepare(`INSERT INTO reading_task_items
          (task_id, chapter_no, event_id, source_hash, idempotency_key, status, error)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          taskId, chapterNo, eventId, hash, itemKey,
          isBlocked ? 'blocked' : 'queued',
          isBlocked ? '预计超过单次输入硬上限' : null,
        );
        if (isBlocked) {
          db.prepare(`UPDATE reading_events SET status='blocked', error=? WHERE id=?`)
            .run('预计超过单次输入硬上限', eventId);
        }
      }
      return {
        task: db.prepare('SELECT * FROM reading_tasks WHERE id=?').get(taskId),
        preview,
        deduped: false,
      };
    })();
  } finally {
    db.close();
  }
}

export function createMainReadingTask({ bookId, chapterNo, reviewMode = 'layered', requestKey = null, budgetTokens = null }) {
  return createReadingTask({
    bookId,
    taskType: 'main',
    startChapter: chapterNo,
    endChapter: chapterNo,
    reviewMode,
    requestKey,
    budgetTokens,
    confirmBudget: true,
  });
}

function recordTaskUsage(db, data) {
  db.prepare(`INSERT INTO reading_task_usage
    (task_id, item_id, chapter_no, attempt_no, model_role, source, model, input_tokens, output_tokens, estimated, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      data.task_id, data.item_id ?? null, data.chapter_no, data.attempt_no, data.model_role,
      data.source || null, data.model || null, data.input_tokens || 0, data.output_tokens || 0,
      data.estimated ? 1 : 0, data.status, data.error || null,
    );
}

function pauseForReview(db, taskId, reason) {
  const changed = db.prepare(`UPDATE reading_tasks
    SET status='waiting', pause_reason=?, error=?, updated_at=datetime('now')
    WHERE id=? AND status IN ('queued', 'running')`).run(reason, reason, taskId);
  if (changed.changes) requeueUnsentTaskItems(db, taskId);
}

function releaseItemReservation(db, taskId, itemId) {
  const item = db.prepare('SELECT reserved_input_tokens FROM reading_task_items WHERE id=?').get(itemId);
  const amount = Number(item?.reserved_input_tokens || 0);
  if (!amount) return 0;
  db.prepare(`UPDATE reading_task_items SET reserved_input_tokens=0, updated_at=datetime('now') WHERE id=?`).run(itemId);
  db.prepare(`UPDATE reading_tasks
    SET reserved_input_tokens=MAX(0, reserved_input_tokens-?), updated_at=datetime('now')
    WHERE id=?`).run(amount, taskId);
  return amount;
}

function requeueUnsentTaskItems(db, taskId, { cancelled = false } = {}) {
  const rows = db.prepare(`SELECT id, event_id, reserved_input_tokens FROM reading_task_items
    WHERE task_id=? AND status='running' AND request_started_at IS NULL`).all(taskId);
  if (!rows.length) return;
  const reserved = rows.reduce((sum, row) => sum + Number(row.reserved_input_tokens || 0), 0);
  const ids = rows.map(row => row.id);
  const eventIds = rows.map(row => row.event_id).filter(Boolean);
  const marks = ids.map(() => '?').join(',');
  db.prepare(`UPDATE reading_task_items SET status=?, reserved_input_tokens=0,
    request_started_at=NULL, skip_reason=?, updated_at=datetime('now')
    WHERE id IN (${marks})`).run(
      cancelled ? 'cancelled' : 'queued',
      cancelled ? '任务已取消' : null,
      ...ids,
  );
  if (eventIds.length) {
    const eventMarks = eventIds.map(() => '?').join(',');
    db.prepare(`UPDATE reading_events SET status=?, error=?, completed_at=CASE WHEN ?='cancelled' THEN datetime('now') ELSE NULL END
      WHERE id IN (${eventMarks})`).run(
      cancelled ? 'cancelled' : 'queued',
      cancelled ? '任务已取消' : null,
      cancelled ? 'cancelled' : 'queued',
      ...eventIds,
    );
  }
  db.prepare(`UPDATE reading_tasks
    SET reserved_input_tokens=MAX(0, reserved_input_tokens-?), updated_at=datetime('now')
    WHERE id=?`).run(reserved, taskId);
}

function reserveTaskBudget(db, taskId, estimatedInput, { allowCompleted = false } = {}) {
  const amount = Math.max(1, Math.floor(Number(estimatedInput) || 0));
  const allowedStatuses = allowCompleted ? "('queued', 'running', 'completed')" : "('queued', 'running')";
  const reserved = db.prepare(`UPDATE reading_tasks
    SET reserved_input_tokens=reserved_input_tokens+?, updated_at=datetime('now')
    WHERE id=? AND status IN ${allowedStatuses}
      AND (budget_tokens IS NULL OR spent_tokens+reserved_input_tokens+?<=budget_tokens)`)
    .run(amount, taskId, amount);
  return reserved.changes === 1;
}

function claimNextTaskItem(db, taskId) {
  return db.transaction(() => {
    const task = db.prepare('SELECT * FROM reading_tasks WHERE id=?').get(taskId);
    if (!task || !['queued', 'running'].includes(task.status)) return null;
    const item = db.prepare(`SELECT * FROM reading_task_items
      WHERE task_id=? AND status='queued' ORDER BY chapter_no LIMIT 1`).get(taskId);
    if (!item) return null;
    const chapter = getChapter(db, task.book_id, item.chapter_no);
    const book = db.prepare('SELECT * FROM books WHERE id=? AND deleted_at IS NULL').get(task.book_id);
    if (!chapter || !book) {
      db.prepare(`UPDATE reading_task_items SET status='failed', error=?, updated_at=datetime('now')
        WHERE id=?`).run(chapter ? 'book not found' : 'chapter not found', item.id);
      if (item.event_id) db.prepare(`UPDATE reading_events SET status='failed', error=? WHERE id=?`)
        .run(chapter ? 'book not found' : 'chapter not found', item.event_id);
      pauseForReview(db, taskId, chapter ? '找不到书籍，等待人工处理' : `找不到第 ${item.chapter_no} 章，等待人工处理`);
      return null;
    }
    const estimatedInput = chapterBudgetEstimate(String(chapter.content || '').length, task.model_role).input_tokens;
    if (estimatedInput > Number(task.hard_limit_tokens || taskPolicy(task.model_role).hardInput)) {
      db.prepare(`UPDATE reading_task_items SET status='blocked', error=?, updated_at=datetime('now') WHERE id=?`)
        .run('预计超过单次输入硬上限', item.id);
      if (item.event_id) db.prepare(`UPDATE reading_events SET status='blocked', error=? WHERE id=?`)
        .run('预计超过单次输入硬上限', item.event_id);
      pauseForReview(db, taskId, `第 ${item.chapter_no} 章预计超过单次输入硬上限`);
      return null;
    }

    // The condition is evaluated by SQLite at write time. It prevents two
    // workers from both seeing the same remaining budget and oversubscribing it.
    const reserved = db.prepare(`UPDATE reading_tasks
      SET status='running', current_chapter=?, error=NULL, pause_reason=NULL,
        reserved_input_tokens=reserved_input_tokens+?, updated_at=datetime('now')
      WHERE id=? AND status IN ('queued', 'running')
        AND (budget_tokens IS NULL OR spent_tokens+reserved_input_tokens+?<=budget_tokens)`)
      .run(item.chapter_no, estimatedInput, taskId, estimatedInput);
    if (!reserved.changes) {
      const live = db.prepare('SELECT * FROM reading_tasks WHERE id=?').get(taskId);
      if (live && ['queued', 'running'].includes(live.status)) {
        pauseForReview(db, taskId, `继续第 ${item.chapter_no} 章将超过任务输入预算上限`);
      }
      return null;
    }
    const claimed = db.prepare(`UPDATE reading_task_items
      SET status='running', error=NULL, skip_reason=NULL, reserved_input_tokens=?,
        request_started_at=NULL, updated_at=datetime('now')
      WHERE id=? AND status='queued'`).run(estimatedInput, item.id);
    if (!claimed.changes) {
      db.prepare(`UPDATE reading_tasks
        SET reserved_input_tokens=MAX(0, reserved_input_tokens-?), updated_at=datetime('now')
        WHERE id=?`).run(estimatedInput, taskId);
      return null;
    }
    if (item.event_id) db.prepare(`UPDATE reading_events SET status='running', error=NULL WHERE id=?`).run(item.event_id);
    return {
      task: db.prepare('SELECT * FROM reading_tasks WHERE id=?').get(taskId),
      item: db.prepare('SELECT * FROM reading_task_items WHERE id=?').get(item.id),
      chapter,
      book,
    };
  })();
}

function beginTaskItemRequest(db, taskId, itemId) {
  return db.transaction(() => {
    const task = db.prepare('SELECT status FROM reading_tasks WHERE id=?').get(taskId);
    const item = db.prepare('SELECT * FROM reading_task_items WHERE id=?').get(itemId);
    if (!task || !item || item.status !== 'running' || item.request_started_at) return false;
    if (!['queued', 'running'].includes(task.status)) {
      releaseItemReservation(db, taskId, itemId);
      db.prepare(`UPDATE reading_task_items SET status='queued', request_started_at=NULL, updated_at=datetime('now')
        WHERE id=?`).run(itemId);
      if (item.event_id) db.prepare(`UPDATE reading_events SET status='queued', error=NULL WHERE id=?`).run(item.event_id);
      return false;
    }
    return db.prepare(`UPDATE reading_task_items SET request_started_at=datetime('now'), updated_at=datetime('now')
      WHERE id=? AND status='running' AND request_started_at IS NULL`).run(itemId).changes === 1;
  })();
}

function modelPrompt(task, book, chapter, review) {
  if (task.model_role === 'helper') {
    return `你是“辅助模型”，正在为 {{user}} 快速扫读第 ${chapter.chapter_no} 章。你可以参考共享前情，但只负责提供剧情摘要；不要生成批注、事实、评分或论文式分析，也不要假装是主模型亲自精读，更不要猜测未处理后文。

输出一个 JSON 对象：
{"summary":"降噪后的本章剧情摘要"}

${dynamicSummaryInstruction(chapter.content)}
这是一份“小助手扫读”资料：优先保留剧情线、感情线、人物关系变化、伏笔、反转、因果链和未解问题；战斗、反复描写和无新增意义对白可大幅压缩。共享前情中的主模型摘要与小助手摘要都可以参考，但不要把二手资料说成亲自读过原文。
书名：${book.title}
当前章标题：${chapter.title}
共享前情（摘要来源会明确标注）：${JSON.stringify(review)}
当前章完整正文：
${chapter.content}`;
  }
  const fineOutput = task.review_mode === 'fine'
    ? `,"comment_summary":"以 {{char}} 第一人称更新本章批注摘要，通常120-240字，复杂章节最多360字；区分我与 {{user}} 的关注，保留 {{user}} 已有观点，只记录真实发生的讨论和观点变化","fact_operations":[{"operation":"create|revise|invalidate","lineage_id":null,"type":"人物|关系|地点|物件|线索|未解问题","key":"稳定简短名称","value":"当前有效表述","importance":1,"reason":"本章依据或修订原因","evidence":"对应原文或讨论依据"}]`
    : '';
  return `你是 {{char}}，正在和 {{user}} 沿着这本书一路读下来。进入当前章节时，把前情、事实锚定和既往批注摘要当作我们已经共同经历过的阅读记忆，而不是需要逐条复述或核对的资料。先进入当前场景，理解人物此刻各自知道什么、在意什么，关系和情绪正在怎样变化，再只在真正让你产生反应、想立刻和 {{user}} 说一句话的原文旁留下批注。

批注应贴着眼前的人物、场景和阅读感受自然发生。已有前情应体现在你的理解和反应里，不要为了证明自己记得而复述资料。人物出现猜测、误会或信息差时，从我们目前已经读到的位置自然回应它；可以紧张、怀疑、心软、发笑、吐槽或猜测后续，但不要把阅读体验写成事实检查报告。语气像刚读到这里时开口和 {{user}} 说话，而不是完成一篇章节分析。

输出一个 JSON 对象：
{"summary":"本章动态剧情/论证摘要","notes":[{"quote":"必须逐字来自当前章的短原文","note":"简短主动批注","kind":"annotation|quote","source_label":"main|model"}]${fineOutput}}

${dynamicSummaryInstruction(chapter.content)}
批注宁少勿滥，只在真正让你产生情绪变化或想和 {{user}} 停下来聊两句的地方批注：可能是一句优美的话、一个让人生气或心软的行为、惊人的反转、荒谬处、细节伏笔或突然的联想；不要为了覆盖“所有转折”而凑数量。每条引用必须来自本章。对文本之外的联想必须写 source_label:"model"，不能伪装成确证书目事实。事实只记录本章新增或改变的内容。
前情中标注“主模型亲读”的是你亲自处理过的资料；标注“小助手扫读”的是二手资料，你可以据此理解剧情并继续讨论，但不得声称自己亲自读过对应原文。若后来亲读原文或人工修订与二手摘要冲突，以亲读原文和人工修订为准。
书名：${book.title}
已生成的前情、事实锚定与共同重读记忆：${JSON.stringify(review)}
当前章标题：${chapter.title}
当前章完整正文：
${chapter.content}`;
}

function maxOutputTokens(task, chapter) {
  const input = estimatedTokens(chapter.content);
  return task.model_role === 'helper'
    ? Math.min(3_000, Math.max(500, Math.ceil(input / 14)))
    : Math.min(8_000, Math.max(1_200, Math.ceil(input / 8)));
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function processTaskItem(taskId) {
  const db = getDb();
  let claimed;
  try {
    claimed = claimNextTaskItem(db, taskId);
  } finally {
    db.close();
  }
  if (!claimed) return false;
  const { task, item, chapter, book } = claimed;

  const contextDb = task.model_role === 'main' ? getDb() : getDb(true);
  let review = { chapter_summaries: [], block_summaries: [], facts: [] };
  try {
    const fineReview = task.model_role === 'main' && task.review_mode === 'fine';
    const batchReading = String(task.request_key || '').startsWith('batch:');
    review = makeReviewContext(
      contextDb,
      task.book_id,
      task.review_mode === 'fine' ? 'fine' : 'layered',
      item.chapter_no,
      {
        referenceText: chapter.content,
        includeFavorites: fineReview,
        includeFacts: fineReview || batchReading,
        includeBookPrelude: fineReview || batchReading,
        includeChapterPrelude: fineReview || batchReading,
        allowCommentSummaryOverviewWrite: task.model_role === 'main',
      },
    );
  } finally {
    contextDb.close();
  }
  const prompt = modelPrompt(task, book, chapter, review);
  let lastError = null;
  for (let retry = 1; retry <= 3; retry += 1) {
    const attemptDb = getDb();
    const canSend = beginTaskItemRequest(attemptDb, taskId, item.id);
    if (!canSend) {
      attemptDb.close();
      return false;
    }
    const attemptNo = Number(attemptDb.prepare('SELECT attempts FROM reading_task_items WHERE id=?').get(item.id)?.attempts || 0) + 1;
    attemptDb.prepare(`UPDATE reading_task_items SET attempts=?, updated_at=datetime('now') WHERE id=?`).run(attemptNo, item.id);
    attemptDb.close();
    try {
      const result = await callModel(task.model_role, [
        { role: 'system', content: task.model_role === 'helper'
          ? '严格输出有效 JSON，不要使用 Markdown 代码块。你是副 API 扫读助手。'
          : '严格输出有效 JSON，不要使用 Markdown 代码块。原文引用必须逐字来自当前章节。' },
        { role: 'user', content: prompt },
      ], { maxTokens: maxOutputTokens(task, chapter) });
      const object = parseJsonObject(result.text);
      const parsed = object && typeof object === 'object' ? object : { summary: result.text, notes: [] };
      const summaryText = String(parsed.summary || '').trim();
      if (!summaryText) throw new Error('model returned an empty summary');
      const writeDb = getDb();
      try {
        const committed = writeDb.transaction(() => {
          const latest = writeDb.prepare('SELECT status FROM reading_task_items WHERE id=?').get(item.id);
          if (latest?.status === 'completed') return false;
          insertSummary(writeDb, {
            book_id: task.book_id,
            chapter_no: item.chapter_no,
            kind: task.model_role === 'helper' ? 'chapter_helper' : 'chapter',
            text: summaryText.slice(0, 12_000),
            source: result.source,
            model: result.model,
            event_id: item.event_id,
          });
          let commentSummary = null;
          if (task.model_role === 'main' && task.review_mode === 'fine') {
            applyFactOperations(writeDb, {
              bookId: task.book_id,
              chapterNo: item.chapter_no,
              eventId: item.event_id,
              source: result.source,
              operations: parsed.fact_operations,
              legacyFacts: parsed.facts,
            });
            const summaryContent = String(parsed.comment_summary || '').trim();
            if (!summaryContent) throw new Error('fine review returned no comment summary');
            commentSummary = saveCommentSummary(writeDb, {
              bookId: task.book_id,
              chapterNo: item.chapter_no,
              content: summaryContent,
              source: result.source,
              eventId: item.event_id,
              requestKey: `${item.idempotency_key}:comment-summary`,
            });
          }
          for (const [index, note] of (task.model_role === 'main' && Array.isArray(parsed.notes) ? parsed.notes : []).entries()) {
            const noteText = String(note?.note || '').trim();
            const quote = String(note?.quote || '').trim().slice(0, 500);
            if (!noteText || !quote) continue;
            const location = locateQuote(writeDb, task.book_id, chapter, quote);
            if (!location) continue;
            const threadKey = threadKeyForRange(writeDb, task.book_id, location.paragraph_idx, location.sel_start_idx, location.sel_end_idx);
            insertCommentOnce(writeDb, {
              book_id: task.book_id,
              ...location,
              selected_text: quote,
              from_who: 'ai',
              content: noteText.slice(0, 3000),
              event_id: item.event_id,
              thread_key: threadKey,
              source_label: note.source_label === 'model' ? 'model' : result.source,
              dedupe_key: `${item.idempotency_key}:note:${index}`,
            });
          }
          const usage = result.usage || { input_tokens: estimatedTokens(prompt), output_tokens: estimatedTokens(result.text), estimated: true };
          recordTaskUsage(writeDb, {
            task_id: taskId, item_id: item.id, chapter_no: item.chapter_no, attempt_no: attemptNo,
            model_role: task.model_role, source: result.source, model: result.model,
            input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
            estimated: usage.estimated, status: 'completed',
          });
          const resultJson = task.model_role === 'helper'
             ? {
                 summary: summaryText,
                source: result.source,
                model: result.model,
                usage,
              }
             : {
                 ...parsed,
                 summary: summaryText,
                 comment_summary: commentSummary,
                 source: result.source,
                model: result.model,
                usage,
              };
          writeDb.prepare(`UPDATE reading_task_items
            SET status='completed', result_json=?, input_tokens=input_tokens+?, output_tokens=output_tokens+?,
              usage_estimated=?, source=?, model=?, error=NULL, completed_at=datetime('now'), updated_at=datetime('now')
            WHERE id=?`).run(
              JSON.stringify(resultJson),
              usage.input_tokens || 0, usage.output_tokens || 0, usage.estimated ? 1 : 0, result.source, result.model, item.id,
            );
          const reservedInput = Number(writeDb.prepare('SELECT reserved_input_tokens FROM reading_task_items WHERE id=?').get(item.id)?.reserved_input_tokens || 0);
          writeDb.prepare(`UPDATE reading_task_items SET reserved_input_tokens=0, request_started_at=NULL WHERE id=?`).run(item.id);
          writeDb.prepare(`UPDATE reading_tasks SET spent_tokens=spent_tokens+?, spent_output_tokens=spent_output_tokens+?,
            reserved_input_tokens=MAX(0, reserved_input_tokens-?), consecutive_failures=0, updated_at=datetime('now') WHERE id=?`)
            .run(usage.input_tokens || 0, usage.output_tokens || 0, reservedInput, taskId);
          if (item.event_id) writeDb.prepare(`UPDATE reading_events
            SET status='completed', completed_at=datetime('now'), error=NULL WHERE id=?`).run(item.event_id);
          return true;
        })();
        return committed || true;
      } finally {
        writeDb.close();
      }
    } catch (error) {
      lastError = error;
      const errorDb = getDb();
      try {
        const current = errorDb.prepare('SELECT attempts FROM reading_task_items WHERE id=?').get(item.id);
        recordTaskUsage(errorDb, {
          task_id: taskId, item_id: item.id, chapter_no: item.chapter_no, attempt_no: Number(current?.attempts || retry),
          model_role: task.model_role, input_tokens: estimatedTokens(prompt), output_tokens: 0,
          estimated: true, status: 'failed', error: error.message,
        });
        errorDb.prepare(`UPDATE reading_task_items
          SET error=?, request_started_at=NULL, updated_at=datetime('now') WHERE id=?`).run(error.message, item.id);
      } finally {
        errorDb.close();
      }
      if (retry < 3) await sleep(retry * 700);
    }
  }
  const failedDb = getDb();
  try {
    failedDb.transaction(() => {
      releaseItemReservation(failedDb, taskId, item.id);
      failedDb.prepare(`UPDATE reading_task_items
        SET status='failed', error=?, request_started_at=NULL, updated_at=datetime('now') WHERE id=?`)
        .run(lastError?.message || 'model request failed', item.id);
    })();
    if (item.event_id) failedDb.prepare(`UPDATE reading_events SET status='failed', error=? WHERE id=?`)
      .run(lastError?.message || 'model request failed', item.event_id);
    const failures = Number(failedDb.prepare('SELECT consecutive_failures FROM reading_tasks WHERE id=?').get(taskId)?.consecutive_failures || 0) + 1;
    if (failures >= 3) {
      pauseForReview(failedDb, taskId, '连续三个章节失败，等待人工继续');
    } else {
      pauseForReview(failedDb, taskId, `第 ${item.chapter_no} 章连续三次请求失败，等待人工继续`);
    }
    failedDb.prepare(`UPDATE reading_tasks SET consecutive_failures=?, updated_at=datetime('now') WHERE id=?`).run(failures, taskId);
  } finally {
    failedDb.close();
  }
  return false;
}

async function ensureTaskBlockSummaries(taskId) {
  const db = getDb(true);
  let task;
  try {
    task = db.prepare('SELECT * FROM reading_tasks WHERE id=?').get(taskId);
  } finally {
    db.close();
  }
  if (!task || ['cancelled', 'paused', 'waiting'].includes(task.status)) return;
  const firstEnd = Math.ceil(task.start_chapter / 30) * 30;
  for (let end = Math.max(30, firstEnd); end <= task.end_chapter; end += 30) {
    const start = end - 29;
    if (task.start_chapter > start || task.end_chapter < end) continue;
    const result = await generateBlockSummary(
      task.book_id,
      end,
      'shared',
      taskId,
    );
    if (result?.status === 'waiting') return;
  }
}

async function runReadingTask(taskId) {
  if (runningTasks.has(taskId)) return;
  runningTasks.set(taskId, true);
  try {
    const db = getDb(true);
    const task = db.prepare('SELECT * FROM reading_tasks WHERE id=?').get(taskId);
    db.close();
    if (!task || ['cancelled', 'completed'].includes(task.status)) return;
    const workers = Math.min(taskPolicy(task.model_role).maxConcurrency, Math.max(1, Number(task.requested_concurrency || 1)));
    await Promise.all(Array.from({ length: workers }, async () => {
      while (await processTaskItem(taskId)) { /* keep claiming the next queued chapter */ }
    }));
    await ensureTaskBlockSummaries(taskId);
    const finalDb = getDb();
    let final;
    try {
      final = finalDb.prepare('SELECT * FROM reading_tasks WHERE id=?').get(taskId);
      const outstanding = finalDb.prepare(`SELECT COUNT(*) AS count FROM reading_task_items
        WHERE task_id=? AND status IN ('queued', 'running')`).get(taskId)?.count || 0;
      const blocked = finalDb.prepare(`SELECT COUNT(*) AS count FROM reading_task_items
        WHERE task_id=? AND status IN ('failed', 'blocked')`).get(taskId)?.count || 0;
      if (final?.status === 'running' || final?.status === 'queued') {
        finalDb.prepare(`UPDATE reading_tasks SET status=?, completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END,
          updated_at=datetime('now') WHERE id=?`).run(outstanding ? 'waiting' : (blocked ? 'waiting' : 'completed'), outstanding ? 'waiting' : (blocked ? 'waiting' : 'completed'), taskId);
      }
    } finally {
      finalDb.close();
    }
  } finally {
    runningTasks.delete(taskId);
  }
}

export function scheduleReadingTask(taskId) {
  setImmediate(() => { runReadingTask(taskId).catch(error => console.error('reading task error:', error)); });
}

export function recoverInterruptedReadingTasks() {
  const db = getDb();
  let resumable = [];
  try {
    resumable = db.transaction(() => {
      const unsent = db.prepare(`SELECT id, task_id, event_id FROM reading_task_items
        WHERE status='running' AND request_started_at IS NULL`).all();
      for (const item of unsent) {
        db.prepare(`UPDATE reading_task_items
          SET status='queued', reserved_input_tokens=0, request_started_at=NULL, updated_at=datetime('now')
          WHERE id=?`).run(item.id);
        if (item.event_id) {
          db.prepare(`UPDATE reading_events SET status='queued', error=NULL, completed_at=NULL WHERE id=?`)
            .run(item.event_id);
        }
      }

      // A process restart cannot prove whether the provider received an in-flight
      // request. Hold those chapters for an explicit retry instead of risking a
      // second model call and duplicate annotations.
      const inFlight = db.prepare(`SELECT id, task_id, chapter_no, event_id FROM reading_task_items
        WHERE status='running' AND request_started_at IS NOT NULL`).all();
      for (const item of inFlight) {
        const reason = `服务重启时第 ${item.chapter_no} 章请求结果未知，请手动重试当前章`;
        db.prepare(`UPDATE reading_task_items
          SET status='failed', error=?, reserved_input_tokens=0, request_started_at=NULL, updated_at=datetime('now')
          WHERE id=?`).run(reason, item.id);
        if (item.event_id) {
          db.prepare(`UPDATE reading_events SET status='failed', error=? WHERE id=?`).run(reason, item.event_id);
        }
        db.prepare(`UPDATE reading_tasks
          SET status='waiting', pause_reason=?, error=?, updated_at=datetime('now')
          WHERE id=? AND status NOT IN ('cancelled', 'completed')`).run(reason, reason, item.task_id);
      }

      const taskIds = db.prepare(`SELECT id FROM reading_tasks
        WHERE status IN ('queued', 'running', 'paused', 'waiting', 'cancelled', 'completed')`).all().map(row => row.id);
      for (const taskId of taskIds) {
        const reserved = Number(db.prepare(`SELECT COALESCE(SUM(reserved_input_tokens), 0) AS total
          FROM reading_task_items WHERE task_id=?`).get(taskId)?.total || 0);
        db.prepare(`UPDATE reading_tasks SET reserved_input_tokens=?, updated_at=datetime('now') WHERE id=?`)
          .run(reserved, taskId);
      }

      const ready = db.prepare(`SELECT t.id FROM reading_tasks t
        WHERE t.status IN ('queued', 'running')
          AND EXISTS (SELECT 1 FROM reading_task_items i WHERE i.task_id=t.id AND i.status='queued')
          AND NOT EXISTS (SELECT 1 FROM reading_task_items i WHERE i.task_id=t.id AND i.status='running' AND i.request_started_at IS NOT NULL)
        ORDER BY t.id`).all().map(row => row.id);
      if (ready.length) {
        const marks = ready.map(() => '?').join(',');
        db.prepare(`UPDATE reading_tasks SET status='queued', updated_at=datetime('now') WHERE id IN (${marks})`).run(...ready);
      }
      return ready;
    })();
  } finally {
    db.close();
  }
  for (const taskId of resumable) scheduleReadingTask(taskId);
  return { resumed_task_ids: resumable };
}

export async function requestChapterReading(input) {
  const created = createMainReadingTask(input);
  if (!created.deduped || created.task.status === 'queued') await runReadingTask(created.task.id);
  const db = getDb(true);
  try {
    const task = db.prepare('SELECT * FROM reading_tasks WHERE id=?').get(created.task.id);
    const item = db.prepare('SELECT * FROM reading_task_items WHERE task_id=? AND chapter_no=?').get(created.task.id, task.start_chapter);
    const event = item?.event_id ? db.prepare('SELECT * FROM reading_events WHERE id=?').get(item.event_id) : null;
    const summary = item?.event_id ? db.prepare(`SELECT * FROM book_summaries
      WHERE event_id=? AND kind='chapter' ORDER BY id DESC LIMIT 1`).get(item.event_id) : null;
    const annotations = item?.event_id ? db.prepare(`SELECT * FROM book_comments
      WHERE event_id=? ORDER BY paragraph_idx, id`).all(item.event_id) : [];
    return { ok: true, task, item, event, summary, annotations, deduped: created.deduped };
  } finally {
    db.close();
  }
}

async function generateBlockSummary(bookId, startChapterOrEndChapter, endChapterOrSource = 'shared', sourceKindOrTaskId = null, taskIdMaybe = null) {
  const rangeMode = Number.isInteger(Number(endChapterOrSource));
  const startChapter = rangeMode
    ? Math.max(1, Number(startChapterOrEndChapter))
    : Math.max(1, Number(startChapterOrEndChapter) - 29);
  const endChapter = rangeMode
    ? Math.max(startChapter, Number(endChapterOrSource))
    : Number(startChapterOrEndChapter);
  const sourceKind = rangeMode ? String(sourceKindOrTaskId || 'shared') : String(endChapterOrSource || 'shared');
  const taskId = rangeMode ? taskIdMaybe : sourceKindOrTaskId;
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM book_summaries
    WHERE book_id=? AND kind='block' AND chapter_no=?`).get(bookId, endChapter);
  if (existing) { db.close(); return { status: 'existing' }; }

  let rows;
  if (taskId) {
    const items = db.prepare(`SELECT chapter_no, event_id, status FROM reading_task_items
      WHERE task_id=? AND chapter_no BETWEEN ? AND ? ORDER BY chapter_no`).all(taskId, startChapter, endChapter);
    const requiredChapterCount = endChapter - startChapter + 1;
    if (items.length !== requiredChapterCount || items.some(item => item.status !== 'completed' || !item.event_id)) {
      db.close();
      return { status: 'incomplete' };
    }
    rows = preferredChapterSummaryRows(db.prepare(`SELECT id, chapter_no, kind, text, source, locked, source_composition, event_id
      FROM book_summaries
      WHERE book_id=? AND kind IN ('chapter', 'chapter_helper')
        AND chapter_no BETWEEN ? AND ?
      ORDER BY chapter_no, id`).all(bookId, startChapter, endChapter));
  } else {
    rows = preferredChapterSummaryRows(db.prepare(`SELECT id, chapter_no, kind, text, source, locked, source_composition
      FROM book_summaries
      WHERE book_id=? AND kind IN ('chapter', 'chapter_helper') AND chapter_no BETWEEN ? AND ?
      ORDER BY chapter_no, id`).all(bookId, startChapter, endChapter));
  }
  db.close();
  const requiredChapterCount = endChapter - startChapter + 1;
  if (rows.length !== requiredChapterCount) {
    return { status: 'incomplete', missing_chapters: Array.from(
      { length: requiredChapterCount },
      (_, index) => startChapter + index,
    ).filter(chapterNo => !rows.some(row => Number(row.chapter_no) === chapterNo)) };
  }
  // Block summaries target roughly one sixth of the source chapter-summary text.
  // This remains a soft target; the model prompt may expand or compress for meaning.
  const target = Math.max(180, Math.round(rows.reduce((sum, row) => sum + String(row.text || '').length, 0) / 6));
  const sourceKinds = [...new Set(rows.map(row => (
    row.locked && row.source === 'manual' ? 'manual' : row.kind === 'chapter' ? 'main' : 'helper'
  )))].sort();
  const sourceComposition = sourceKinds.length > 1 ? 'mixed' : (sourceKinds[0] || 'main');
  const messages = [
    { role: 'system', content: '严格输出一个简洁的中文总结，不使用 Markdown 标题。不要假装亲自读过未提供的原文。' },
    { role: 'user', content: `请把第 ${startChapter} 至 ${endChapter} 章的已有逐章摘要整理为共享大总结。建议约 ${target} 字但不是硬限制；合并没有新增意义的重复信息，保留剧情线、感情线、人物关系变化、伏笔、反转、因果链和未解问题。逐章资料中会标注来源：主模型亲读、小助手扫读或人工修订；输出可以综合这些资料，但不要抹掉来源边界。\n${JSON.stringify(rows)}` },
  ];
  const estimatedInput = estimatedTokens(messages.map(message => message.content).join('\n'));
  const outputLimit = Math.min(5000, Math.max(900, Math.ceil(target * 1.8)));
  if (taskId) {
    const reserveDb = getDb();
    try {
      const policy = taskPolicy('main');
      if (estimatedInput > policy.hardInput) {
        pauseForReview(reserveDb, taskId, `第 ${startChapter}-${endChapter} 章大总结预计超过主模型单次输入硬上限`);
        return { status: 'waiting', reason: 'block_hard_limit' };
      }
      if (!reserveTaskBudget(reserveDb, taskId, estimatedInput, { allowCompleted: true })) {
        pauseForReview(reserveDb, taskId, `生成第 ${startChapter}-${endChapter} 章大总结将超过任务输入预算上限`);
        return { status: 'waiting', reason: 'block_budget_limit' };
      }
    } finally {
      reserveDb.close();
    }
  }

  let result;
  try {
    result = await callModel('main', messages, { maxTokens: outputLimit });
    if (!String(result.text || '').trim()) throw new Error('model returned an empty block summary');
  } catch (error) {
    if (taskId) {
      const failedDb = getDb();
      try {
        failedDb.transaction(() => {
          const task = failedDb.prepare('SELECT reserved_input_tokens FROM reading_tasks WHERE id=?').get(taskId);
          failedDb.prepare(`UPDATE reading_tasks
            SET reserved_input_tokens=MAX(0, reserved_input_tokens-?), status='waiting',
              pause_reason=?, error=?, updated_at=datetime('now')
            WHERE id=?`).run(
              estimatedInput,
              `第 ${startChapter}-${endChapter} 章大总结请求失败，等待人工继续`,
              error.message,
              taskId,
            );
          recordTaskUsage(failedDb, {
            task_id: taskId,
            chapter_no: endChapter,
            attempt_no: 1,
            model_role: 'main',
            input_tokens: estimatedInput,
            output_tokens: 0,
            estimated: true,
            status: 'failed',
            error: error.message,
          });
          if (Number(task?.reserved_input_tokens || 0) < estimatedInput) {
            failedDb.prepare(`UPDATE reading_tasks SET reserved_input_tokens=0 WHERE id=?`).run(taskId);
          }
        })();
      } finally {
        failedDb.close();
      }
    }
    throw error;
  }
  const text = String(result.text || '').trim();
  const writeDb = getDb();
  try {
    writeDb.transaction(() => {
      insertSummary(writeDb, {
        book_id: bookId,
        chapter_no: endChapter,
        kind: 'block',
        text: text.slice(0, 16000),
        source: result.source,
        model: result.model,
        source_composition: sourceComposition,
      });
      if (taskId) {
        const usage = result.usage || { input_tokens: estimatedInput, output_tokens: estimatedTokens(text), estimated: true };
        recordTaskUsage(writeDb, {
          task_id: taskId,
          chapter_no: endChapter,
          attempt_no: 1,
          model_role: 'main',
          source: result.source,
          model: result.model,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          estimated: usage.estimated,
          status: 'completed',
        });
        writeDb.prepare(`UPDATE reading_tasks
          SET spent_tokens=spent_tokens+?, spent_output_tokens=spent_output_tokens+?, updated_at=datetime('now')
          WHERE id=?`).run(usage.input_tokens || 0, usage.output_tokens || 0, taskId);
        writeDb.prepare(`UPDATE reading_tasks
          SET reserved_input_tokens=MAX(0, reserved_input_tokens-?), updated_at=datetime('now')
          WHERE id=?`).run(estimatedInput, taskId);
      }
    })();
  } finally {
    writeDb.close();
  }
  return { status: 'completed' };
}

async function generateReadingImpression(bookId, startChapterInput, endChapterInput) {
  const startChapter = Math.max(1, Number(startChapterInput) || 1);
  const endChapter = Math.max(startChapter, Number(endChapterInput) || startChapter);
  const db = getDb(true);
  let rows;
  try {
    rows = preferredChapterSummaryRows(db.prepare(`SELECT id, chapter_no, kind, text, source, locked, source_composition
      FROM book_summaries
      WHERE book_id=? AND kind IN ('chapter', 'chapter_helper')
        AND chapter_no BETWEEN ? AND ?
      ORDER BY chapter_no, id`).all(bookId, startChapter, endChapter));
  } finally {
    db.close();
  }
  const requiredChapterCount = endChapter - startChapter + 1;
  const missingChapters = Array.from({ length: requiredChapterCount }, (_, index) => startChapter + index)
    .filter(chapterNo => !rows.some(row => Number(row.chapter_no) === chapterNo));
  if (missingChapters.length) return { status: 'incomplete', missing_chapters: missingChapters };

  const sourceKinds = [...new Set(rows.map(row => (
    row.locked && row.source === 'manual' ? 'manual' : row.kind === 'chapter' ? 'main' : 'helper'
  )))].sort();
  const sourceComposition = sourceKinds.length > 1 ? 'mixed' : (sourceKinds[0] || 'main');
  const sourceLabel = sourceComposition === 'mixed'
    ? '混合来源'
    : sourceComposition === 'helper' ? '小助手扫读' : sourceComposition === 'manual' ? '人工修订' : '主模型亲读';
  const messages = [
    { role: 'system', content: '严格输出一段有温度的中文共同读书印象，不使用 Markdown 标题。你是沉浸式共同阅读者，不是编辑、老师或论文评审。可以谈情绪、人物、关系、伏笔和读书时的联想，但不要假装亲自读过未提供的原文。' },
    { role: 'user', content: `请根据第 ${startChapter} 至 ${endChapter} 章的共享逐章摘要，写一段适合保存为“共同读书印象”的文字。允许自然表达喜欢、无语、紧张、惊讶、吐槽、猜测和玩梗；不要机械罗列剧情，也不要把摘要来源抹掉。资料来源为：${sourceLabel}。\n${JSON.stringify(rows.map(row => ({
      chapter_no: row.chapter_no,
      provenance: summaryProvenance(row),
      summary: row.text,
    })))}`
    },
  ];
  const estimatedInput = estimatedTokens(messages.map(message => message.content).join('\n'));
  const result = await callModel('main', messages, { maxTokens: Math.min(4000, Math.max(700, Math.ceil(estimatedInput / 3))) });
  const content = String(result.text || '').trim();
  if (!content) throw new Error('model returned an empty reading impression');
  const writeDb = getDb();
  try {
    const impression = writeDb.transaction(() => saveReadingImpression(writeDb, {
      bookId,
      chapterStart: startChapter,
      chapterEnd: endChapter,
      content: content.slice(0, 12000),
      sourceLabel,
    }))();
    return {
      status: 'completed',
      impression,
      source_composition: sourceComposition,
      usage: result.usage || { input_tokens: estimatedInput, output_tokens: estimatedTokens(content), estimated: true },
    };
  } finally {
    writeDb.close();
  }
}

export async function handleRequest(req, res, opts = {}) {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return true;
  }

  cors(res);
  const port = opts.port || 3000;
  if (opts.backups?.isMaintenance() && req.url?.startsWith('/v1/')) {
    json(res, 503, { error: 'library maintenance in progress' });
    return true;
  }

  // GET /v1/backups
  if (req.method === 'GET' && req.url === '/v1/backups') {
    if (!opts.backups) { json(res, 503, { error: 'backup service unavailable' }); return true; }
    try {
      json(res, 200, { backups: opts.backups.listBackups(), restore_scope: 'full_library' });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /v1/backups
  if (req.method === 'POST' && req.url === '/v1/backups') {
    if (!opts.backups) { json(res, 503, { error: 'backup service unavailable' }); return true; }
    try {
      const backup = await opts.backups.createBackup({ kind: 'manual' });
      json(res, 201, { backup });
    } catch (e) { json(res, 409, { error: e.message }); }
    return true;
  }

  // POST /v1/backups/:id/preflight
  if (req.method === 'POST' && req.url.match(/^\/v1\/backups\/[a-z_]+-\d{14}-[a-f0-9]{8}\/preflight$/)) {
    if (!opts.backups) { json(res, 503, { error: 'backup service unavailable' }); return true; }
    try {
      const id = req.url.split('/')[3];
      json(res, 200, opts.backups.preflightRestore(id));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // POST /v1/backups/:id/restore
  if (req.method === 'POST' && req.url.match(/^\/v1\/backups\/[a-z_]+-\d{14}-[a-f0-9]{8}\/restore$/)) {
    if (!opts.backups) { json(res, 503, { error: 'backup service unavailable' }); return true; }
    try {
      const id = req.url.split('/')[3];
      const body = await readBody(req);
      const result = await opts.backups.restore(id, body.confirmation_token);
      json(res, 200, result);
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // GET /v1/books
  if (req.method === 'GET' && (req.url === '/v1/books' || req.url.startsWith('/v1/books?'))) {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== '/v1/books') return false;
      const db = getDb(true);
      const includeDeleted = url.searchParams.get('deleted') === '1';
      const category = url.searchParams.get('category');
      const tag = url.searchParams.get('tag');
      const query = url.searchParams.get('q');
      const where = [includeDeleted ? 'b.deleted_at IS NOT NULL' : 'b.deleted_at IS NULL'];
      const params = [];
      if (category) { where.push('b.category = ?'); params.push(category); }
      if (query) { where.push('(b.title LIKE ? OR b.note LIKE ? OR b.tags_json LIKE ?)'); params.push(`%${query}%`, `%${query}%`, `%${query}%`); }
      const books = db.prepare(`SELECT b.id, b.title, b.total_paragraphs, b.created_at, b.cover_image,
        b.category, b.tags_json, b.note, b.source_format, b.source_encoding, b.deleted_at,
        p.page as current_page, p.updated_at as last_read_at
        FROM books b LEFT JOIN book_progress p ON b.id = p.book_id
        WHERE ${where.join(' AND ')}
        ${tag ? 'AND b.tags_json LIKE ?' : ''}
        ORDER BY b.created_at DESC`).all(...params, ...(tag ? [`%"${tag}"%`] : []));
      const commentCounts = db.prepare('SELECT book_id, COUNT(*) as count FROM book_comments GROUP BY book_id').all();
      const categories = db.prepare('SELECT value FROM config WHERE key = ?').get('categories');
      const tags = db.prepare('SELECT value FROM config WHERE key = ?').get('tags');
      db.close();
      const countMap = {};
      for (const c of commentCounts) countMap[c.book_id] = c.count;
      json(res, 200, {
        books: books.map(b => ({ ...b, tags: safeJson(b.tags_json, []), comment_count: countMap[b.id] || 0 })),
        categories: safeJson(categories?.value, ['待看', '纯爱', '言情', '百合', '文学', '散文', '论文']),
        tags: safeJson(tags?.value, ['没看完']),
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/favorites -- bookshelf-wide favorite annotations, grouped by the client.
  if (req.method === 'GET' && (req.url === '/v1/favorites' || req.url.startsWith('/v1/favorites?'))) {
    try {
      const db = getDb(true);
      const favorites = db.prepare(`
        SELECT
          c.id, c.book_id, c.paragraph_idx, c.sel_start_idx, c.sel_end_idx, c.sel_end_para_idx,
          c.selected_text, c.from_who, c.content, c.created_at, c.reply_to, c.thread_key,
          c.source_label, c.is_favorite, c.annotation_kind, c.event_id,
          b.title AS book_title,
          (
            SELECT ch.chapter_no
            FROM book_chapters ch
            WHERE ch.book_id = c.book_id
              AND c.paragraph_idx BETWEEN ch.start_idx AND ch.end_idx
            ORDER BY ch.chapter_no
            LIMIT 1
          ) AS chapter_no,
          (
            SELECT ch.title
            FROM book_chapters ch
            WHERE ch.book_id = c.book_id
              AND c.paragraph_idx BETWEEN ch.start_idx AND ch.end_idx
            ORDER BY ch.chapter_no
            LIMIT 1
          ) AS chapter_title
        FROM book_comments c
        JOIN books b ON b.id = c.book_id
        WHERE c.is_favorite = 1 AND b.deleted_at IS NULL
        ORDER BY b.title COLLATE NOCASE, c.paragraph_idx, c.created_at, c.id
      `).all();
      db.close();
      json(res, 200, { favorites });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /v1/books/:id/cover -- 上传封面图片
  const coverMatch = req.url?.match(/^\/v1\/books\/(\d+)\/cover$/);
  if (req.method === 'POST' && coverMatch) {
    try {
      const bookId = parseInt(coverMatch[1]);
      const db = getDb();
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId);
      if (!book) { db.close(); json(res, 404, { error: 'book not found' }); return true; }

      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        db.close(); json(res, 400, { error: 'expected multipart/form-data' }); return true;
      }

      const boundary = contentType.split('boundary=')[1];
      if (!boundary) { db.close(); json(res, 400, { error: 'missing boundary' }); return true; }

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const boundaryBuffer = Buffer.from(`--${boundary}`);
      const parts = [];
      let start = 0;
      while (true) {
        const idx = buffer.indexOf(boundaryBuffer, start);
        if (idx === -1) break;
        const end = buffer.indexOf(boundaryBuffer, idx + boundaryBuffer.length);
        if (end === -1) break;
        parts.push(buffer.slice(idx + boundaryBuffer.length, end));
        start = end;
      }

      let coverFileName = null;
      for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const header = part.slice(0, headerEnd).toString('utf8');
        const data = part.slice(headerEnd + 4, part.length - 2);

        if (header.includes('filename="') && header.includes('name="cover"')) {
          const extMatch = header.match(/filename="[^"]*\.([a-zA-Z0-9]+)"/);
          const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
          const allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
          if (!allowed.includes(ext)) { db.close(); json(res, 400, { error: 'invalid image format' }); return true; }

          coverFileName = `cover.${ext}`;
          const imgDir = getImageDir(bookId);
          fs.writeFileSync(path.join(imgDir, coverFileName), data);
          db.prepare('UPDATE books SET cover_image = ? WHERE id = ?').run(coverFileName, bookId);
        }
      }

      db.close();
      json(res, 200, { ok: true, cover_image: coverFileName });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

// PATCH /v1/books/:id metadata
  if (req.method === 'PATCH' && req.url.match(/^\/v1\/books\/\d+$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const allowed = ['title', 'category', 'note'];
      const db = getDb();
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(id);
      if (!book) { db.close(); json(res, 404, { error: 'book not found' }); return true; }
      if (body.title !== undefined || body.category !== undefined || body.note !== undefined || body.tags !== undefined) {
        db.prepare(`UPDATE books SET title = COALESCE(?, title), category = COALESCE(?, category),
          note = COALESCE(?, note), tags_json = COALESCE(?, tags_json) WHERE id = ?`)
          .run(body.title ?? null, body.category ?? null, body.note ?? null, body.tags ? JSON.stringify(body.tags) : null, id);
      }
      const versions = db.prepare('SELECT cache_version, comment_version FROM books WHERE id = ?').get(id);
      db.close();
      json(res, 200, {
        ok: true,
        cache_version: Number(versions?.cache_version || 1),
        comment_version: Number(versions?.comment_version || 1),
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/library/options
  if (req.method === 'GET' && req.url === '/v1/library/options') {
    const db = getDb(true);
    const categories = db.prepare('SELECT value FROM config WHERE key = ?').get('categories');
    const tags = db.prepare('SELECT value FROM config WHERE key = ?').get('tags');
    db.close();
    json(res, 200, {
      categories: safeJson(categories?.value, ['待看', '纯爱', '言情', '百合', '文学', '散文', '论文']),
      tags: safeJson(tags?.value, ['没看完']),
    });
    return true;
  }

  // POST /v1/library/options
  if (req.method === 'POST' && req.url === '/v1/library/options') {
    try {
      const body = await readBody(req);
      const key = body.type === 'category' ? 'categories' : body.type === 'tag' ? 'tags' : '';
      const value = String(body.value || '').trim();
      if (!key || !value) { json(res, 400, { error: 'type and value required' }); return true; }
      const defaults = key === 'categories' ? ['待看', '纯爱', '言情', '百合', '文学', '散文', '论文'] : ['没看完'];
      const db = getDb();
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
      const list = [...new Set([...safeJson(row?.value, defaults), value])];
      db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(list));
      db.close();
      json(res, 200, { ok: true, values: list });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // DELETE /v1/library/options
  if (req.method === 'DELETE' && req.url === '/v1/library/options') {
    try {
      const body = await readBody(req);
      const key = body.type === 'category' ? 'categories' : body.type === 'tag' ? 'tags' : '';
      const value = String(body.value || '').trim();
      if (!key || !value) { json(res, 400, { error: 'type and value required' }); return true; }
      const defaults = key === 'categories' ? ['待看', '纯爱', '言情', '百合', '文学', '散文', '论文'] : ['没看完'];
      const db = getDb();
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
      const list = safeJson(row?.value, defaults).filter(item => item !== value);
      db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(list));
      db.close();
      json(res, 200, { ok: true, values: list });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/models
  if (req.method === 'GET' && req.url === '/v1/models') {
    json(res, 200, { models: safeModelConfigSummary() });
    return true;
  }

  // POST /v1/books/preview — parse without creating a book
  if (req.method === 'POST' && req.url === '/v1/books/preview') {
    try {
      const body = await readBody(req);
      const parsed = parseBookInput(body);
      const candidates = parsed.sourceBytes && parsed.format !== 'epub'
        ? encodingCandidates(parsed.sourceBytes)
        : [{ encoding: parsed.sourceEncoding, score: 0, preview: parsed.paragraphs.slice(0, 2).join(' ').slice(0, 120) }];
      const structure = detectChapterStructure(parsed.paragraphs);
      const ranges = structure.ranges;
      json(res, 200, {
        ok: true,
        format: parsed.format,
        encoding: parsed.sourceEncoding,
        encoding_candidates: candidates,
        paragraph_count: parsed.paragraphs.length,
        chapters: previewChapters(parsed.paragraphs, ranges),
        chapter_rule: structure.selection,
        chapter_rule_candidates: structure.candidates.map(({ matches, ...candidate }) => ({ ...candidate, preview: matches.slice(0, 5) })),
      });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/chapters
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/chapter-rules(?:\?|$)/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const book = db.prepare('SELECT chapter_rule_json FROM books WHERE id = ? AND deleted_at IS NULL').get(id);
      const paragraphs = db.prepare('SELECT idx, content FROM book_paragraphs WHERE book_id = ? ORDER BY idx').all(id);
      db.close();
      if (!book || !paragraphs.length) { json(res, 404, { error: 'book not found' }); return true; }
      const saved = safeJson(book.chapter_rule_json, {});
      const structure = detectChapterStructure(paragraphs.map(row => row.content), saved);
      json(res, 200, {
        current: saved,
        recommended_family_ids: structure.recommended_family_ids,
        candidates: structure.candidates.map(({ matches, ...candidate }) => ({ ...candidate, preview: matches.slice(0, 5) })),
        preview: previewChapters(paragraphs, structure.ranges),
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /v1/books/:id/chapter-rules/preview
  if (req.method === 'POST' && req.url.match(/^\/v1\/books\/\d+\/chapter-rules\/preview$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const db = getDb(true);
      const paragraphs = db.prepare('SELECT idx, content FROM book_paragraphs WHERE book_id = ? ORDER BY idx').all(id);
      db.close();
      if (!paragraphs.length) { json(res, 404, { error: 'book not found' }); return true; }
      const structure = detectChapterStructure(paragraphs.map(row => row.content), {
        family_ids: Array.isArray(body.family_ids) ? body.family_ids : [],
        custom_rules: Array.isArray(body.custom_rules) ? body.custom_rules : [],
      });
      json(res, 200, {
        selection: structure.selection,
        recommended_family_ids: structure.recommended_family_ids,
        ranges: previewChapters(paragraphs, structure.ranges),
        candidates: structure.candidates.map(({ matches, ...candidate }) => ({ ...candidate, preview: matches.slice(0, 5) })),
      });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/chapters
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/chapters(?:\?|$)/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const chapters = db.prepare('SELECT chapter_no, title, start_idx, end_idx FROM book_chapters WHERE book_id = ? ORDER BY chapter_no').all(id);
      db.close();
      json(res, 200, { chapters });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // PATCH /v1/books/:id/chapters — save manually adjusted chapter ranges
  if (req.method === 'PATCH' && req.url.match(/^\/v1\/books\/\d+\/chapters$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const db = getDb();
      const paragraphs = db.prepare('SELECT idx, content FROM book_paragraphs WHERE book_id = ? ORDER BY idx').all(id);
      if (!paragraphs.length) { db.close(); json(res, 404, { error: 'book not found' }); return true; }
      const ranges = normalizedChapterRanges(paragraphs, body.chapters);
      const chapterRule = body.chapter_rule && typeof body.chapter_rule === 'object'
        ? JSON.stringify({
          mode: body.chapter_rule.mode === 'combined' ? 'combined' : 'single',
          family_ids: Array.isArray(body.chapter_rule.family_ids) ? body.chapter_rule.family_ids.map(String).slice(0, 16) : [],
          custom_rules: Array.isArray(body.chapter_rule.custom_rules)
            ? body.chapter_rule.custom_rules.slice(0, 8).map(rule => ({
              id: String(rule?.id || '').slice(0, 40),
              label: String(rule?.label || '').slice(0, 40),
              pattern: String(rule?.pattern || '').slice(0, 120),
            }))
            : [],
        })
        : null;
      const insert = db.prepare('INSERT INTO book_chapters (book_id, chapter_no, title, start_idx, end_idx) VALUES (?, ?, ?, ?, ?)');
      const cacheVersion = db.transaction(() => {
        db.prepare('DELETE FROM book_chapters WHERE book_id = ?').run(id);
        for (const range of ranges) insert.run(id, range.chapter_no, range.title, range.start_idx, range.end_idx);
        if (chapterRule) db.prepare('UPDATE books SET chapter_rule_json = ? WHERE id = ?').run(chapterRule, id);
        return touchBookCache(db, id);
      })();
      db.close();
      json(res, 200, {
        ok: true,
        chapters: previewChapters(paragraphs, ranges),
        chapter_rule: chapterRule ? safeJson(chapterRule, {}) : null,
        cache_version: cacheVersion,
      });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/summaries
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/summaries(?:\?|$)/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const summaries = summaryRows(db, id);
      const facts = currentFactRows(db, id);
      const factHistory = factHistoryRows(db, id);
      const readingContexts = readingContextRows(db, id);
      const commentSummaries = latestCommentSummaryRows(db, id);
      db.close();
      json(res, 200, {
        summaries,
        facts,
        fact_history: factHistory,
        reading_contexts: readingContexts,
        comment_summaries: commentSummaries,
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET/PATCH /v1/books/:id/reading-contexts -- manual book/chapter preludes.
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/reading-contexts(?:\?|$)/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const contexts = readingContextRows(db, id);
      db.close();
      json(res, 200, { contexts });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  if (req.method === 'PATCH' && req.url.match(/^\/v1\/books\/\d+\/reading-contexts$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const kind = body.kind === 'chapter_prelude' ? 'chapter_prelude' : 'book_prelude';
      const chapterNo = kind === 'chapter_prelude' ? Number(body.chapter_no) : 0;
      if (kind === 'chapter_prelude' && (!Number.isInteger(chapterNo) || chapterNo < 1)) {
        json(res, 400, { error: 'valid chapter_no required for chapter prelude' });
        return true;
      }
      const db = getDb();
      let context;
      try {
        context = saveReadingContext(db, {
          bookId: id,
          chapterNo,
          kind,
          content: body.content,
          source: 'human',
        });
      } finally {
        db.close();
      }
      json(res, 200, { ok: true, context });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // GET/PATCH /v1/books/:id/comment-summaries -- latest chapter versions and manual edits.
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/comment-summaries(?:\?|$)/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const summaries = latestCommentSummaryRows(db, id);
      db.close();
      json(res, 200, { summaries });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  if (req.method === 'PATCH' && req.url.match(/^\/v1\/books\/\d+\/comment-summaries\/\d+$/)) {
    try {
      const parts = req.url.split('/');
      const bookId = Number(parts[3]);
      const chapterNo = Number(parts[5]);
      const body = await readBody(req);
      const content = String(body.content || '').trim();
      if (!Number.isInteger(chapterNo) || chapterNo < 1 || !content) {
        json(res, 400, { error: 'chapter_no and content required' });
        return true;
      }
      const db = getDb();
      let summary;
      try {
        summary = saveCommentSummary(db, {
          bookId,
          chapterNo,
          content,
          source: 'human',
          requestKey: String(body.request_key || '').trim() || null,
        });
      } finally {
        db.close();
      }
      json(res, 200, { ok: true, summary });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // GET/POST /v1/books/:id/facts -- current facts plus complete append-only history.
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/facts(?:\?|$)/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const facts = currentFactRows(db, id);
      const factHistory = factHistoryRows(db, id);
      db.close();
      json(res, 200, { facts, fact_history: factHistory });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  if (req.method === 'POST' && req.url.match(/^\/v1\/books\/\d+\/facts$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const operation = ['revise', 'invalidate'].includes(body.operation) ? body.operation : 'create';
      const db = getDb();
      let fact;
      try {
        fact = db.transaction(() => appendFactVersion(db, {
          bookId: id,
          operation,
          lineageId: body.lineage_id,
          factType: body.fact_type || body.type,
          keyName: body.key_name || body.key,
          value: body.value,
          importance: body.importance,
          chapterNo: body.revision_chapter || body.chapter_no || 0,
          source: 'human',
          reason: body.revision_reason || body.reason,
          evidence: body.source_evidence || body.evidence,
        }))();
      } finally {
        db.close();
      }
      json(res, operation === 'create' ? 201 : 200, { ok: true, fact });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // DELETE /v1/books/:id/summaries/:summaryId -- explicit removal of one visible story item.
  if (req.method === 'DELETE' && req.url.match(/^\/v1\/books\/\d+\/summaries\/\d+$/)) {
    try {
      const parts = req.url.split('/');
      const bookId = Number(parts[3]);
      const summaryId = Number(parts[5]);
      const db = getDb();
      let deleted = 0;
      try {
        deleted = db.prepare('DELETE FROM book_summaries WHERE id=? AND book_id=?').run(summaryId, bookId).changes;
      } finally {
        db.close();
      }
      if (!deleted) { json(res, 404, { error: 'story material not found' }); return true; }
      json(res, 200, { ok: true, deleted: summaryId });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/reading-impressions
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/reading-impressions(?:\?|$)/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const impressions = db.prepare(`
        SELECT id, book_id, chapter_start, chapter_end, content, source_label, created_at, updated_at
        FROM book_reading_impressions WHERE book_id=? ORDER BY id DESC
      `).all(id);
      db.close();
      json(res, 200, { impressions });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // DELETE /v1/books/:id/reading-impressions/:impressionId -- explicit removal from Coread only.
  if (req.method === 'DELETE' && req.url.match(/^\/v1\/books\/\d+\/reading-impressions\/\d+$/)) {
    try {
      const parts = req.url.split('/');
      const bookId = Number(parts[3]);
      const impressionId = Number(parts[5]);
      const db = getDb();
      let deleted = 0;
      try {
        deleted = db.prepare('DELETE FROM book_reading_impressions WHERE id=? AND book_id=?').run(impressionId, bookId).changes;
      } finally {
        db.close();
      }
      if (!deleted) { json(res, 404, { error: 'reading impression not found' }); return true; }
      json(res, 200, { ok: true, deleted: impressionId });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /v1/books/:id/summaries/generate -- generate a shared block summary from chapter summaries only.
  if (req.method === 'POST' && req.url.match(/^\/v1\/books\/\d+\/summaries\/generate$/)) {
    try {
      const id = Number(req.url.split('/')[3]);
      const body = await readBody(req);
      const kind = body.kind === 'reading_impression' ? 'reading_impression' : 'block';
      const startChapter = Math.max(1, Number(body.chapter_start) || 1);
      const endChapter = Math.max(startChapter, Number(body.chapter_end) || startChapter);
      const result = kind === 'block'
        ? await generateBlockSummary(id, startChapter, endChapter, 'shared', null)
        : await generateReadingImpression(id, startChapter, endChapter);
      if (result.status === 'incomplete') {
        json(res, 409, { ok: false, ...result });
        return true;
      }
      if (result.status === 'existing') {
        json(res, 200, { ok: true, ...result });
        return true;
      }
      json(res, 201, { ok: true, kind, ...result });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }

  // POST /v1/books/:id/reading-impressions
  if (req.method === 'POST' && req.url.match(/^\/v1\/books\/\d+\/reading-impressions$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const content = String(body.content || '').trim();
      if (!content) { json(res, 400, { error: 'content required' }); return true; }
      const db = getDb();
      let result;
      try {
        result = db.transaction(() => saveReadingImpression(db, {
          bookId: id,
          chapterStart: body.chapter_start,
          chapterEnd: body.chapter_end,
          content,
          sourceLabel: body.source_label || 'human',
        }))();
      } finally {
        db.close();
      }
      if (!result) { json(res, 404, { error: 'book not found' }); return true; }
      json(res, 201, { ok: true, impression: result });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // PATCH /v1/books/:id/summaries
  if (req.method === 'PATCH' && req.url.match(/^\/v1\/books\/\d+\/summaries$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const kind = body.kind || 'chapter';
      const chapterNo = body.chapter_no ?? null;
      if (!body.text) { json(res, 400, { error: 'text required' }); return true; }
      const db = getDb();
      insertSummary(db, {
        book_id: id,
        chapter_no: chapterNo,
        kind,
        text: String(body.text),
        source: 'manual',
        locked: body.locked,
      });
      db.close();
      json(res, 200, { ok: true });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/review-context
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/review-context/)) {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      const id = parseInt(url.pathname.split('/')[3]);
      const mode = url.searchParams.get('mode') === 'fine' ? 'fine' : 'layered';
      const beforeChapter = Number(url.searchParams.get('before_chapter')) || null;
      const db = getDb(true);
      const context = makeReviewContext(db, id, mode, beforeChapter);
      db.close();
      json(res, 200, context);
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /v1/books/:id/tasks/preview
  if (req.method === 'POST' && req.url.match(/^\/v1\/books\/\d+\/tasks\/preview$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const db = getDb(true);
      const preview = previewReadingTask(db, {
        bookId: id,
        taskType: body.task_type,
        startChapter: body.start_chapter,
        endChapter: body.end_chapter,
        requestedConcurrency: body.requested_concurrency,
        budgetTokens: body.budget_tokens,
      });
      db.close();
      json(res, 200, { ok: true, preview, models: safeModelConfigSummary() });
    } catch (e) {
      json(res, 400, { error: e.message, code: e.code || null, preview: e.preview || null });
    }
    return true;
  }

  // POST /v1/books/:id/tasks
  if (req.method === 'POST' && req.url.match(/^\/v1\/books\/\d+\/tasks$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const taskType = normalizeTaskType(body.task_type);
      const startChapter = Math.max(1, parseInt(body.start_chapter || 1));
      const endChapter = Math.max(startChapter, parseInt(body.end_chapter || startChapter));
      const reviewMode = body.review_mode === 'fine' ? 'fine' : 'layered';
      const requestKey = String(body.request_key || '').trim() || null;
      const created = createReadingTask({
        bookId: id,
        taskType,
        startChapter,
        endChapter,
        reviewMode,
        requestKey,
        budgetTokens: body.budget_tokens,
        requestedConcurrency: body.requested_concurrency,
        confirmBudget: Boolean(body.confirm_budget),
      });
      if (!created.deduped && created.task.status === 'queued') scheduleReadingTask(created.task.id);
      json(res, 202, {
        ok: true,
        task_id: created.task.id,
        task_type: created.task.task_type,
        start_chapter: created.task.start_chapter,
        end_chapter: created.task.end_chapter,
        deduped: created.deduped,
        status: created.task.status,
        preview: created.preview,
      });
    } catch (e) {
      json(res, e.code === 'budget_confirmation_required' ? 409 : 400, {
        error: e.message,
        code: e.code || null,
        preview: e.preview || null,
      });
    }
    return true;
  }

  // GET /v1/books/:id/tasks -- the latest server-side jobs are available after switching devices.
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/tasks(?:\?.*)?$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const book = db.prepare('SELECT id FROM books WHERE id=? AND deleted_at IS NULL').get(id);
      if (!book) { db.close(); json(res, 404, { error: 'book not found' }); return true; }
      const tasks = db.prepare(`SELECT t.*,
        (SELECT COUNT(*) FROM reading_task_items i WHERE i.task_id=t.id AND i.status='completed') AS completed_items,
        (SELECT COUNT(*) FROM reading_task_items i WHERE i.task_id=t.id AND i.status='queued') AS queued_items,
        (SELECT COUNT(*) FROM reading_task_items i WHERE i.task_id=t.id AND i.status='running') AS running_items,
        (SELECT COUNT(*) FROM reading_task_items i WHERE i.task_id=t.id AND i.status IN ('failed', 'blocked')) AS attention_items
        FROM reading_tasks t WHERE t.book_id=? ORDER BY t.id DESC LIMIT 20`).all(id);
      db.close();
      json(res, 200, { ok: true, tasks });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/tasks/:id
  if (req.method === 'GET' && req.url.match(/^\/v1\/tasks\/\d+$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const task = db.prepare('SELECT * FROM reading_tasks WHERE id = ?').get(id);
      const items = db.prepare('SELECT * FROM reading_task_items WHERE task_id = ? ORDER BY chapter_no').all(id);
      const usage = db.prepare('SELECT * FROM reading_task_usage WHERE task_id = ? ORDER BY created_at, id').all(id);
      const counts = task ? db.prepare(`SELECT status, COUNT(*) AS count FROM reading_task_items
        WHERE task_id=? GROUP BY status`).all(id) : [];
      db.close();
      json(res, task ? 200 : 404, task ? { task, items, usage, counts, running: runningTasks.has(id) } : { error: 'task not found' });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // PATCH /v1/tasks/:id
  if (req.method === 'PATCH' && req.url.match(/^\/v1\/tasks\/\d+$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const action = String(body.action || body.status || '').trim();
      if (!['pause', 'cancel', 'resume', 'retry_current', 'skip_current'].includes(action)) {
        json(res, 400, { error: 'action must be pause, cancel, resume, retry_current or skip_current' }); return true;
      }
      const db = getDb();
      const task = db.prepare('SELECT * FROM reading_tasks WHERE id = ?').get(id);
      if (!task) { db.close(); json(res, 404, { error: 'task not found' }); return true; }
      let status = task.status;
      if (action === 'pause') {
        if (['completed', 'cancelled'].includes(task.status)) throw new Error('completed or cancelled tasks cannot be paused');
        status = 'paused';
        db.transaction(() => {
          db.prepare(`UPDATE reading_tasks SET status='paused', pause_reason='用户手动暂停', error=NULL,
            updated_at=datetime('now') WHERE id=?`).run(id);
          requeueUnsentTaskItems(db, id);
        })();
      } else if (action === 'cancel') {
        if (task.status === 'completed') throw new Error('completed tasks cannot be cancelled');
        status = 'cancelled';
        db.transaction(() => {
          db.prepare(`UPDATE reading_tasks SET status='cancelled', pause_reason='用户取消任务', error=NULL,
            completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(id);
          requeueUnsentTaskItems(db, id, { cancelled: true });
          db.prepare(`UPDATE reading_task_items SET status='cancelled', skip_reason='任务已取消', updated_at=datetime('now')
            WHERE task_id=? AND status='queued'`).run(id);
          db.prepare(`UPDATE reading_events SET status='cancelled', error='任务已取消'
            WHERE task_id=? AND status='queued'`).run(id);
        })();
      } else if (action === 'resume') {
        if (task.status === 'cancelled' || task.status === 'completed') throw new Error('completed or cancelled tasks cannot be resumed');
        status = 'queued';
        db.transaction(() => {
          db.prepare(`UPDATE reading_tasks SET status='queued', pause_reason=NULL, error=NULL, updated_at=datetime('now') WHERE id=?`).run(id);
          db.prepare(`UPDATE reading_task_items SET status='queued', error=NULL, skip_reason=NULL,
            request_started_at=NULL, updated_at=datetime('now')
            WHERE task_id=? AND status='queued'`).run(id);
        })();
      } else {
        const current = db.prepare(`SELECT * FROM reading_task_items
          WHERE task_id=? AND status IN ('failed', 'blocked') ORDER BY chapter_no LIMIT 1`).get(id);
        if (!current) throw new Error('no failed or blocked chapter is waiting for manual action');
        if (action === 'retry_current') {
          if (current.status !== 'failed') throw new Error('blocked chapters must be split or skipped before continuing');
          status = 'queued';
          db.transaction(() => {
            releaseItemReservation(db, id, current.id);
            db.prepare(`UPDATE reading_task_items SET status='queued', error=NULL, skip_reason=NULL, updated_at=datetime('now')
              , attempts=0, request_started_at=NULL WHERE id=?`).run(current.id);
            if (current.event_id) db.prepare(`UPDATE reading_events SET status='queued', error=NULL WHERE id=?`).run(current.event_id);
            db.prepare(`UPDATE reading_tasks SET status='queued', pause_reason=NULL, error=NULL,
              consecutive_failures=0, updated_at=datetime('now') WHERE id=?`).run(id);
          })();
        } else {
          status = 'queued';
          db.transaction(() => {
            releaseItemReservation(db, id, current.id);
            db.prepare(`UPDATE reading_task_items SET status='skipped', skip_reason='用户手动跳过', error=NULL,
              updated_at=datetime('now'), completed_at=datetime('now') WHERE id=?`).run(current.id);
            if (current.event_id) db.prepare(`UPDATE reading_events SET status='skipped', error='用户手动跳过',
              completed_at=datetime('now') WHERE id=?`).run(current.event_id);
            db.prepare(`UPDATE reading_tasks SET status='queued', pause_reason=NULL, error=NULL,
              consecutive_failures=0, updated_at=datetime('now') WHERE id=?`).run(id);
          })();
        }
      }
      db.close();
      if (status === 'queued') scheduleReadingTask(id);
      json(res, 200, { ok: true, action, status });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/slice
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/search/)) {
    try {
      const urlObj = new URL(req.url, `http://localhost:${port}`);
      const id = parseInt(urlObj.pathname.split('/')[3]);
      const query = String(urlObj.searchParams.get('q') || '').trim();
      const scope = urlObj.searchParams.get('scope') === 'chapter' ? 'chapter' : 'book';
      const requestedLimit = Number(urlObj.searchParams.get('limit') || 200);
      const limit = Math.max(1, Math.min(200, Number.isFinite(requestedLimit) ? requestedLimit : 200));
      const chapterNo = Number(urlObj.searchParams.get('chapter_no') || 0);
      if (!query) { json(res, 400, { error: 'q is required' }); return true; }
      if (query.length > 120) { json(res, 400, { error: 'q is too long' }); return true; }
      if (scope === 'chapter' && (!Number.isInteger(chapterNo) || chapterNo < 1)) {
        json(res, 400, { error: 'chapter_no is required for chapter scope' }); return true;
      }

      const db = getDb(true);
      const book = db.prepare('SELECT id, title FROM books WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!book) { db.close(); json(res, 404, { error: 'book not found' }); return true; }
      const chapters = db.prepare(
        'SELECT chapter_no, title, start_idx, end_idx FROM book_chapters WHERE book_id = ? ORDER BY chapter_no'
      ).all(id);
      const chapter = scope === 'chapter'
        ? chapters.find(item => Number(item.chapter_no) === chapterNo)
        : null;
      if (scope === 'chapter' && !chapter) {
        db.close();
        json(res, 404, { error: 'chapter not found' });
        return true;
      }

      const params = scope === 'chapter'
        ? [id, chapter.start_idx, chapter.end_idx, query]
        : [id, query];
      const sql = scope === 'chapter'
        ? `SELECT idx, content FROM book_paragraphs
             WHERE book_id = ? AND idx >= ? AND idx <= ? AND instr(lower(content), lower(?)) > 0
             ORDER BY idx`
        : `SELECT idx, content FROM book_paragraphs
             WHERE book_id = ? AND instr(lower(content), lower(?)) > 0
             ORDER BY idx`;
      const candidates = db.prepare(sql).all(...params);
      const commentParams = scope === 'chapter'
        ? [id, chapter.start_idx, chapter.end_idx, query, query]
        : [id, query, query];
      const commentSql = scope === 'chapter'
        ? `SELECT id, paragraph_idx, sel_start_idx, sel_end_idx, sel_end_para_idx, selected_text,
             from_who, content, created_at, reply_to, thread_key, source_label, is_favorite, annotation_kind
             FROM book_comments
             WHERE book_id = ? AND paragraph_idx >= ? AND paragraph_idx <= ?
               AND (instr(lower(content), lower(?)) > 0 OR instr(lower(COALESCE(selected_text, '')), lower(?)) > 0)
             ORDER BY paragraph_idx, created_at, id`
        : `SELECT id, paragraph_idx, sel_start_idx, sel_end_idx, sel_end_para_idx, selected_text,
             from_who, content, created_at, reply_to, thread_key, source_label, is_favorite, annotation_kind
             FROM book_comments
             WHERE book_id = ?
               AND (instr(lower(content), lower(?)) > 0 OR instr(lower(COALESCE(selected_text, '')), lower(?)) > 0)
             ORDER BY paragraph_idx, created_at, id`;
      const commentCandidates = db.prepare(commentSql).all(...commentParams);

      const needle = query.toLocaleLowerCase();
      const resultLimit = limit + 1;
      const results = [];
      let chapterCursor = 0;
      for (const paragraph of candidates) {
        const text = String(paragraph.content || '');
        const normalized = text.toLocaleLowerCase();
        let from = 0;
        while (results.length < resultLimit) {
          const start = normalized.indexOf(needle, from);
          if (start < 0) break;
          const end = start + query.length;
          while (chapterCursor + 1 < chapters.length && Number(paragraph.idx) > Number(chapters[chapterCursor].end_idx)) {
            chapterCursor += 1;
          }
          const matchedChapter = chapters.find(item =>
            Number(paragraph.idx) >= Number(item.start_idx) && Number(paragraph.idx) <= Number(item.end_idx)
          ) || null;
          const excerptStart = Math.max(0, start - 42);
          const excerptEnd = Math.min(text.length, end + 58);
          results.push({
            chapter_no: matchedChapter?.chapter_no || 1,
            chapter_title: matchedChapter?.title || book.title,
            paragraph_idx: paragraph.idx,
            start,
            end,
            excerpt: text.slice(excerptStart, excerptEnd),
            excerpt_start: excerptStart,
          });
          from = Math.max(end, start + 1);
        }
        if (results.length >= resultLimit) break;
      }
      const limited = results.length > limit;
      if (limited) results.length = limit;
      const commentResults = [];
      for (const comment of commentCandidates) {
        if (commentResults.length >= resultLimit) break;
        const selectedText = String(comment.selected_text || '');
        const content = String(comment.content || '');
        const selectedAt = selectedText.toLocaleLowerCase().indexOf(needle);
        const contentAt = content.toLocaleLowerCase().indexOf(needle);
        const sourceText = contentAt >= 0 ? content : selectedText;
        const start = contentAt >= 0 ? contentAt : Math.max(0, selectedAt);
        const end = start + query.length;
        const matchedChapter = chapters.find(item =>
          Number(comment.paragraph_idx) >= Number(item.start_idx) && Number(comment.paragraph_idx) <= Number(item.end_idx)
        ) || null;
        const excerptStart = Math.max(0, start - 42);
        const excerptEnd = Math.min(sourceText.length, end + 58);
        commentResults.push({
          kind: 'comment',
          comment_id: comment.id,
          chapter_no: matchedChapter?.chapter_no || 1,
          chapter_title: matchedChapter?.title || book.title,
          paragraph_idx: comment.paragraph_idx,
          start,
          end,
          excerpt: sourceText.slice(excerptStart, excerptEnd),
          excerpt_start: excerptStart,
          matched_field: contentAt >= 0 ? 'content' : 'selected_text',
          selected_text: comment.selected_text,
          content: comment.content,
          from_who: comment.from_who,
          source_label: comment.source_label,
        });
      }
      const commentsLimited = commentResults.length > limit;
      if (commentsLimited) commentResults.length = limit;
      db.close();
      json(res, 200, {
        query,
        scope,
        chapter_no: scope === 'chapter' ? chapterNo : null,
        results,
        limited,
        comment_results: commentResults,
        comments_limited: commentsLimited,
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/slice
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/cache-state(?:\?|$)/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const book = db.prepare(`SELECT id, total_paragraphs, cache_version, comment_version, deleted_at
        FROM books WHERE id = ? AND deleted_at IS NULL`).get(id);
      db.close();
      if (!book) { json(res, 404, { error: 'book not found' }); return true; }
      json(res, 200, {
        book_id: book.id,
        total_paragraphs: Number(book.total_paragraphs || 0),
        cache_version: Number(book.cache_version || 1),
        comment_version: Number(book.comment_version || 1),
        deleted_at: null,
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/comments
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/comments(?:\?|$)/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb(true);
      const book = db.prepare(`SELECT id, comment_version
        FROM books WHERE id = ? AND deleted_at IS NULL`).get(id);
      if (!book) { db.close(); json(res, 404, { error: 'book not found' }); return true; }
      const comments = db.prepare(`SELECT * FROM book_comments
        WHERE book_id = ? ORDER BY paragraph_idx, created_at, id`).all(id);
      db.close();
      json(res, 200, {
        book_id: book.id,
        comment_version: Number(book.comment_version || 1),
        comments,
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/slice
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/slice/)) {
    try {
      const urlObj = new URL(req.url, `http://localhost:${port}`);
      const id = parseInt(req.url.split('/')[3]);
      const start = parseInt(urlObj.searchParams.get('start') || '0');
      const count = parseInt(urlObj.searchParams.get('count') || '30');
      const includeComments = urlObj.searchParams.get('include_comments') !== '0';
      const db = getDb(true);
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
      if (!book) { db.close(); json(res, 404, { error: 'not found' }); return true; }
      const paragraphs = db.prepare('SELECT idx, content FROM book_paragraphs WHERE book_id = ? AND idx >= ? ORDER BY idx LIMIT ?').all(id, start, count);
      const minIdx = paragraphs.length ? paragraphs[0].idx : start;
      const maxIdx = paragraphs.length ? paragraphs[paragraphs.length - 1].idx : start;
      const comments = includeComments && paragraphs.length
        ? db.prepare('SELECT * FROM book_comments WHERE book_id = ? AND paragraph_idx BETWEEN ? AND ? ORDER BY paragraph_idx, created_at').all(id, minIdx, maxIdx)
        : [];
      db.close();
      json(res, 200, {
        book: { ...book, tags: safeJson(book.tags_json, []) },
        paragraphs,
        comments,
        total: book.total_paragraphs,
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+(\?|$)/)) {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      const id = parseInt(url.pathname.split('/')[3]);
      const page = parseInt(url.searchParams.get('page') || '1');
      const perPage = BOOK_PER_PAGE; // Keep every page endpoint on one fixed coordinate system.
      const db = getDb(true);
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
      if (!book) { db.close(); json(res, 404, { error: 'book not found' }); return true; }
      const pages = computePageBreaks(db, id, perPage);
      const totalPages = pages.length || 1;
      const clampedPage = Math.max(1, Math.min(page, totalPages));
      const pageIndices = pages[clampedPage - 1] || [];
      let paragraphs = [];
      if (pageIndices.length > 0) {
        const placeholders = pageIndices.map(() => '?').join(',');
        paragraphs = db.prepare(`SELECT idx, content FROM book_paragraphs WHERE book_id = ? AND idx IN (${placeholders}) ORDER BY idx`).all(id, ...pageIndices);
      }
      const comments = db.prepare('SELECT * FROM book_comments WHERE book_id = ? ORDER BY paragraph_idx, created_at').all(id);
      const progress = db.prepare('SELECT page FROM book_progress WHERE book_id = ?').get(id);
      db.close();
      json(res, 200, {
        book: { ...book, tags: safeJson(book.tags_json, []) },
        paragraphs,
        comments,
        pagination: { page: clampedPage, perPage, totalPages, total: book.total_paragraphs },
        progress: progress?.page || 1,
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /v1/books/:id/comment
  if (req.method === 'POST' && req.url.match(/^\/v1\/books\/\d+\/comment$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const { paragraph_idx, selected_text, content, from_who, sel_start_idx, sel_end_idx, sel_end_para_idx, reply_to, source_label, event_id, is_favorite, annotation_kind, dedupe_key } = body;
      const annotationKind = annotation_kind === 'wavy_underline' ? 'wavy_underline' : 'comment';
      if (paragraph_idx === undefined || (annotationKind !== 'wavy_underline' && !String(content || '').trim())) {
        json(res, 400, { error: 'paragraph_idx and content required for comments' });
        return true;
      }
      const db = getDb();
      db.pragma('foreign_keys = OFF');
      const author = from_who || 'human';
      let startIdx = sel_start_idx ?? null, endIdx = sel_end_idx ?? null;
      if (selected_text && startIdx == null) {
        const para = db.prepare('SELECT content FROM book_paragraphs WHERE book_id = ? AND idx = ?').get(id, paragraph_idx);
        if (para?.content) {
          const i = para.content.indexOf(selected_text);
          if (i >= 0) { startIdx = i; endIdx = i + selected_text.length; }
        }
      }
      let threadKey = body.thread_key || null;
      if (!threadKey && reply_to != null) threadKey = db.prepare('SELECT thread_key FROM book_comments WHERE id=? AND book_id=?').get(reply_to, id)?.thread_key || null;
      if (!threadKey) threadKey = threadKeyForRange(db, id, paragraph_idx, startIdx, endIdx);
      const commentId = insertCommentOnce(db, {
        book_id: id,
        paragraph_idx,
        sel_start_idx: startIdx,
        sel_end_idx: endIdx,
        sel_end_para_idx: sel_end_para_idx ?? null,
        selected_text: selected_text || null,
        from_who: author,
        content: String(content || ''),
        reply_to: reply_to ?? null,
        event_id: event_id ?? null,
        thread_key: threadKey,
        source_label: source_label || 'human',
        is_favorite: Boolean(is_favorite),
        annotation_kind: annotationKind,
        dedupe_key: dedupe_key || null,
      });
      const comment = db.prepare('SELECT * FROM book_comments WHERE id=? AND book_id=?').get(commentId, id);
      const versions = db.prepare('SELECT cache_version, comment_version FROM books WHERE id=?').get(id);
      db.close();
      json(res, 200, {
        ok: true,
        id: commentId,
        thread_key: threadKey,
        comment,
        cache_version: Number(versions?.cache_version || 1),
        comment_version: Number(versions?.comment_version || 1),
        sync: null,
      });
      if (opts.onComment && annotationKind !== 'wavy_underline') opts.onComment({ book_id: id, from_who: author, content });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // DELETE /v1/books/comment/:id
  if (req.method === 'DELETE' && req.url.match(/^\/v1\/books\/comment\/\d+$/)) {
    try {
      const commentId = parseInt(req.url.split('/').pop());
      const db = getDb();
      const comment = db.prepare('SELECT book_id FROM book_comments WHERE id = ?').get(commentId);
      const result = db.prepare('DELETE FROM book_comments WHERE id = ?').run(commentId);
      const commentVersion = result.changes && comment ? touchCommentCache(db, comment.book_id) : null;
      const cacheVersion = result.changes && comment
        ? Number(db.prepare('SELECT cache_version FROM books WHERE id = ?').get(comment.book_id)?.cache_version || 1)
        : null;
      db.close();
      json(res, result.changes ? 200 : 404, result.changes
        ? { ok: true, cache_version: cacheVersion, comment_version: commentVersion }
        : { error: 'comment not found' });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/new-replies
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/new-replies/)) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const id = parseInt(req.url.split('/')[3]);
      const lastSeen = parseInt(urlObj.searchParams.get('since') || '0');
      const db = getDb(true);
      const replies = db.prepare(
        `SELECT c.id, c.paragraph_idx, c.content, c.created_at, c.reply_to,
                c.from_who, c.sel_start_idx, c.sel_end_idx, c.selected_text,
                p.content as parent_content, p.from_who as parent_from, p.id as parent_id
         FROM book_comments c
         LEFT JOIN book_comments p ON c.reply_to = p.id
         WHERE c.book_id = ? AND c.id > ?
         ORDER BY c.id DESC LIMIT 20`
      ).all(id, lastSeen);
      db.close();
      json(res, 200, { replies });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/reader-state
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/reader-state/)) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const id = parseInt(req.url.split('/')[3]);
      const lastCommentId = parseInt(urlObj.searchParams.get('since') || '0');
      const db = getDb(true);
      const progress = db.prepare('SELECT page FROM book_progress WHERE book_id = ?').get(id);
      const position = progress?.page || 0;
      const around = 3;
      const paras = db.prepare('SELECT idx, content FROM book_paragraphs WHERE book_id = ? AND idx >= ? AND idx < ? ORDER BY idx').all(id, Math.max(0, position - around), position + 10 + around);
      const newComments = db.prepare('SELECT id, paragraph_idx, from_who, content, reply_to, created_at FROM book_comments WHERE book_id = ? AND id > ? ORDER BY id').all(id, lastCommentId);
      const visibleComments = db.prepare('SELECT id, paragraph_idx, sel_start_idx, sel_end_idx, selected_text, from_who, content, reply_to, created_at FROM book_comments WHERE book_id = ? AND paragraph_idx >= ? AND paragraph_idx < ? ORDER BY paragraph_idx, created_at').all(id, Math.max(0, position), position + 10);
      db.close();
      json(res, 200, { position, paragraphs: paras, newComments, visibleComments });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // PATCH /v1/books/:id/progress
  if (req.method === 'PATCH' && req.url.match(/^\/v1\/books\/\d+\/progress$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const { page } = body;
      if (!page) { json(res, 400, { error: 'page required' }); return true; }
      const db = getDb();
      db.prepare("INSERT INTO book_progress (book_id, page, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(book_id) DO UPDATE SET page = ?, updated_at = datetime('now')").run(id, page, page);
      db.close();
      json(res, 200, { ok: true });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /v1/books — create book
  if (req.method === 'POST' && req.url === '/v1/books') {
    try {
      const body = await readBody(req);
      const { title, content, format, data, encoding = 'auto', category = '待看', tags = [], note = '' } = body;
      if (!title) { json(res, 400, { error: 'title required' }); return true; }

      const parsedInput = parseBookInput(body);
      const { paragraphs, sourceEncoding, sourceBytes, epubResult } = parsedInput;
      const structure = detectChapterStructure(paragraphs);
      const ranges = normalizedChapterRanges(paragraphs, body.chapters || structure.ranges);

      const db = getDb();
      const bookResult = db.prepare(`INSERT INTO books
        (title, total_paragraphs, category, tags_json, note, source_format, source_encoding, chapter_rule_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(title, paragraphs.length, category || '待看', JSON.stringify(Array.isArray(tags) ? tags : []), note || '', format || 'text', sourceEncoding, JSON.stringify(structure.selection));
      const bookId = Number(bookResult.lastInsertRowid);
      const ins = db.prepare('INSERT INTO book_paragraphs (book_id, idx, content) VALUES (?, ?, ?)');
      db.transaction(() => { for (let i = 0; i < paragraphs.length; i++) ins.run(bookId, i, paragraphs[i]); })();
      const chapterIns = db.prepare('INSERT INTO book_chapters (book_id, chapter_no, title, start_idx, end_idx) VALUES (?, ?, ?, ?, ?)');
      db.transaction(() => { for (const ch of ranges) chapterIns.run(bookId, ch.chapter_no, ch.title, ch.start_idx, ch.end_idx); })();
      db.close();

      if (sourceBytes) {
        const ext = format === 'epub' ? 'epub' : format === 'md' ? 'md' : 'txt';
        fs.writeFileSync(path.join(getBookFilesDir(bookId), `original.${ext}`), sourceBytes);
        const db2 = getDb();
        db2.prepare('UPDATE books SET source_path = ? WHERE id = ?').run(`books/${bookId}/original.${ext}`, bookId);
        db2.close();
      }

      if (epubResult) {
        const imgDir = getImageDir(bookId);
        const images = extractImages(epubResult.zip, epubResult.epubImageMap, paragraphs);
        for (const [fname, data] of images) {
          fs.writeFileSync(path.join(imgDir, fname), data);
        }
        const cover = extractCover(epubResult.zip, epubResult.epubCoverFile);
        if (cover) {
          fs.writeFileSync(path.join(imgDir, cover.name), cover.data);
          const db2 = getDb();
          db2.prepare('UPDATE books SET cover_image = ? WHERE id = ?').run(cover.name, bookId);
          db2.close();
        }
      }

      json(res, 201, { ok: true, book_id: bookId, title, paragraphs: paragraphs.length, encoding: sourceEncoding, chapters: previewChapters(paragraphs, ranges), chapter_rule: structure.selection });
    } catch (e) {
      console.error('Book create error:', e);
      json(res, 500, { error: e.message });
    }
    return true;
  }

  // GET /v1/books/:id/toc
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/toc/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const urlObj = new URL(req.url, 'http://localhost');
      const perPage = BOOK_PER_PAGE; // 统一坐标制：目录页码与正文同一坐标
      const db = getDb(true);
      const book = db.prepare('SELECT chapter_rule_json FROM books WHERE id = ?').get(id);
      const storedChapters = db.prepare('SELECT chapter_no, title, start_idx, end_idx FROM book_chapters WHERE book_id = ? ORDER BY chapter_no').all(id);
      const pages = computePageBreaks(db, id, perPage);
      const idxToPage = {};
      for (let i = 0; i < pages.length; i++) {
        for (const idx of pages[i]) idxToPage[idx] = i + 1;
      }
      const paras = db.prepare('SELECT idx, substr(content, 1, 100) as content FROM book_paragraphs WHERE book_id = ? ORDER BY idx').all(id);
      db.close();
      const chapters = (storedChapters.length ? storedChapters : paras.filter(p => isChapterHeading(p.content)).map((p, i) => ({
        chapter_no: i + 1, start_idx: p.idx, title: p.content.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 60),
      }))).map(ch => ({ ...ch, idx: ch.start_idx, page: idxToPage[ch.start_idx] || 1, title: ch.title }));
      json(res, 200, { chapters, totalPages: pages.length, chapter_rule: safeJson(book?.chapter_rule_json, {}) });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/export
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/export/)) {
    try {
      const urlObj = new URL(req.url, `http://localhost:${port}`);
      const id = parseInt(urlObj.pathname.split('/')[3]);
      const format = urlObj.searchParams.get('format') || 'epub';
      const db = getDb(true);
      const book = db.prepare('SELECT * FROM books WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!book) { db.close(); json(res, 404, { error: 'book not found' }); return true; }
      const paras = db.prepare('SELECT idx, content FROM book_paragraphs WHERE book_id = ? ORDER BY idx').all(id);
      const comments = db.prepare('SELECT * FROM book_comments WHERE book_id = ? ORDER BY paragraph_idx, sel_start_idx, created_at').all(id);
      const progress = db.prepare('SELECT page, updated_at FROM book_progress WHERE book_id = ?').get(id) || null;
      const chaptersForJson = db.prepare('SELECT chapter_no, title, start_idx, end_idx FROM book_chapters WHERE book_id = ? ORDER BY chapter_no').all(id);
      const summariesForJson = db.prepare(`SELECT chapter_no, kind, text, source, model, locked, event_id, version, created_at, updated_at
        FROM book_summaries WHERE book_id = ? ORDER BY chapter_no, kind, version, created_at`).all(id);
      const factsForJson = allFactRows(db, id);
      const readingContextsForJson = readingContextRows(db, id);
      const commentSummariesForJson = db.prepare(`SELECT id, book_id, chapter_no, version, content, source,
          event_id, request_key, created_at, updated_at
        FROM chapter_comment_summaries WHERE book_id = ? ORDER BY chapter_no, version`).all(id);
      const commentSummaryOverviewsForJson = db.prepare(`SELECT id, book_id, block_start, block_end, content,
          source_version, created_at, updated_at
        FROM comment_summary_overviews WHERE book_id = ? ORDER BY block_start`).all(id);
      const chatsForJson = db.prepare(`SELECT chapter_no, event_id, from_who, content, source_label, reply_to, created_at
        FROM book_chats WHERE book_id = ? ORDER BY chapter_no, created_at, id`).all(id);
      const impressionsForJson = db.prepare(`SELECT chapter_start, chapter_end, content, source_label, created_at, updated_at
        FROM book_reading_impressions WHERE book_id = ? ORDER BY created_at, id`).all(id);
      db.close();

      const commentsByPara = {};
      for (const c of comments) {
        if (!commentsByPara[c.paragraph_idx]) commentsByPara[c.paragraph_idx] = [];
        commentsByPara[c.paragraph_idx].push(c);
      }
      const safeBook = {
        id: book.id,
        title: book.title,
        total_paragraphs: book.total_paragraphs,
        created_at: book.created_at,
        cover_image: book.cover_image,
        category: book.category,
        tags_json: book.tags_json,
        note: book.note,
        source_format: book.source_format,
        source_encoding: book.source_encoding,
      };
      const safeComments = comments.map(comment => ({
        paragraph_idx: comment.paragraph_idx,
        sel_start_idx: comment.sel_start_idx,
        sel_end_idx: comment.sel_end_idx,
        sel_end_para_idx: comment.sel_end_para_idx,
        selected_text: comment.selected_text,
        from_who: comment.from_who,
        content: comment.content,
        created_at: comment.created_at,
        reply_to: comment.reply_to,
        event_id: comment.event_id,
        thread_key: comment.thread_key,
        source_label: comment.source_label,
        is_favorite: comment.is_favorite,
        annotation_kind: comment.annotation_kind,
      }));
      const exportPayload = {
        format: 'coread-book-export',
        version: 1,
        exported_at: new Date().toISOString(),
        book: safeBook,
        progress,
        paragraphs: paras,
        chapters: chaptersForJson,
        summaries: summariesForJson,
        facts: factsForJson,
        reading_contexts: readingContextsForJson,
        comment_summaries: commentSummariesForJson,
        comment_summary_overviews: commentSummaryOverviewsForJson,
        comments: safeComments,
        chapter_chats: chatsForJson,
        reading_impressions: impressionsForJson,
      };

      if (format === 'md') {
        let md = `# ${book.title}\n\n`;
        for (const para of paras) {
          md += para.content + '\n\n';
          const pComments = commentsByPara[para.idx];
          if (pComments?.length) {
            for (const c of pComments) {
              if (c.selected_text) md += `> **${c.from_who}** highlighted "${c.selected_text}": ${c.content}\n>\n`;
              else md += `> **${c.from_who}**: ${c.content}\n>\n`;
            }
            md += '\n';
          }
        }
        cors(res);
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${encodeURIComponent(book.title)}.md"` });
        res.end(md);
        return true;
      }

      if (format === 'json') {
        cors(res);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(book.title)}.coread.json"`,
        });
        res.end(JSON.stringify(exportPayload, null, 2));
        return true;
      }

      if (format === 'archive') {
        const zip = new AdmZip();
        zip.addFile('book.json', Buffer.from(JSON.stringify(exportPayload, null, 2), 'utf8'));
        const sourcePath = String(book.source_path || '').replace(/\\/g, '/');
        const expectedPrefix = `books/${id}/`;
        const sourceName = sourcePath.startsWith(expectedPrefix) ? path.posix.basename(sourcePath) : '';
        if (/^original\.(txt|epub|md)$/i.test(sourceName)) {
          const originalPath = path.join(path.dirname(getDbPath()), 'books', String(id), sourceName);
          if (fs.existsSync(originalPath) && fs.statSync(originalPath).isFile()) {
            zip.addFile(`original/${sourceName}`, fs.readFileSync(originalPath));
          }
        }
        const imageDir = getImageDir(id);
        if (fs.existsSync(imageDir)) {
          for (const filename of fs.readdirSync(imageDir)) {
            if (filename.includes('/') || filename.includes('\\')) continue;
            const imagePath = path.join(imageDir, filename);
            if (fs.statSync(imagePath).isFile()) zip.addFile(`images/${filename}`, fs.readFileSync(imagePath));
          }
        }
        cors(res);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(book.title)}.coread.zip"`,
        });
        res.end(zip.toBuffer());
        return true;
      }

      // EPUB export
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const epubId = `book-${id}-${Date.now()}`;
      const chapterRe = /^第[\d一二三四五六七八九十百千万]+[章节回]|^#|^Chapter\s+\d/i;
      const chapters = [];
      let curChapter = { title: book.title, paras: [] };
      for (const p of paras) {
        const t = p.content.trim();
        if (chapterRe.test(t) && curChapter.paras.length > 0) {
          chapters.push(curChapter);
          curChapter = { title: t.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80), paras: [] };
        }
        curChapter.paras.push(p);
      }
      if (curChapter.paras.length > 0) chapters.push(curChapter);

      const style = `body{font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",serif;line-height:1.85;color:#333;margin:1em}h1{text-align:center;font-size:1.4em;margin:2em 0 1em;color:#222}p{text-indent:1.5em;margin:.6em 0}.ann{background:#f8f0f0;border-left:3px solid #d4a0a0;border-radius:8px;padding:8px 12px;margin:8px 0;font-size:.9em}.ann-author{font-weight:bold;color:#8b6b6b}.ann-quote{font-style:italic;color:#888;margin-bottom:4px}`;

      const imgDir = getImageDir(id);
      const exportImages = new Map();
      try {
        for (const f of fs.readdirSync(imgDir)) exportImages.set(f, fs.readFileSync(path.join(imgDir, f)));
      } catch {}

      const buildChapterXhtml = (ch, idx) => {
        let body = '';
        if (idx > 0 || chapterRe.test(ch.paras[0]?.content?.trim() || '')) body += `<h1>${esc(ch.title)}</h1>\n`;
        for (const p of ch.paras) {
          const t = p.content.trim();
          const imgMatch = t.match(/^\[IMG:([^\]]+)\]$/);
          if (imgMatch) { body += `<div style="text-align:center;margin:1em 0"><img src="images/${esc(imgMatch[1])}" style="max-width:100%"/></div>\n`; continue; }
          if (chapterRe.test(t) && body.includes('</h1>')) {} else {
            const isH = t.startsWith('#');
            const display = t.replace(/^#+\s*/, '');
            if (isH) body += `<h1>${esc(display)}</h1>\n`;
            else body += `<p>${display.replace(/\[IMG:([^\]]+)\]/g, (_, f) => `</p><div style="text-align:center;margin:1em 0"><img src="images/${esc(f)}" style="max-width:100%"/></div><p>`)}</p>\n`;
          }
          const pComments = commentsByPara[p.idx];
          if (pComments?.length) {
            for (const c of pComments) {
              body += `<div class="ann">`;
              if (c.selected_text) body += `<div class="ann-quote">"${esc(c.selected_text.slice(0, 200))}"</div>`;
              body += `<span class="ann-author">${esc(c.from_who)}</span>: ${esc(c.content)}</div>\n`;
            }
          }
        }
        return `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"><head><meta charset="utf-8"/><title>${esc(ch.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
      };

      let manifest = '', spine = '', navPoints = '';
      for (let i = 0; i < chapters.length; i++) {
        manifest += `<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>\n`;
        spine += `<itemref idref="ch${i}"/>\n`;
        navPoints += `<navPoint id="nav${i}" playOrder="${i+1}"><navLabel><text>${esc(chapters[i].title)}</text></navLabel><content src="ch${i}.xhtml"/></navPoint>\n`;
      }

      const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
      let imgManifest = '', coverMeta = '';
      let imgIdx = 0;
      for (const [fname] of exportImages) {
        const ext = fname.split('.').pop().toLowerCase();
        const mime = mimeTypes[ext] || 'image/jpeg';
        const imgId = `img${imgIdx++}`;
        imgManifest += `<item id="${imgId}" href="images/${esc(fname)}" media-type="${mime}"${fname.startsWith('cover.') ? ' properties="cover-image"' : ''}/>\n`;
        if (fname.startsWith('cover.')) coverMeta = `<meta name="cover" content="${imgId}"/>`;
      }

      cors(res);
      res.writeHead(200, { 'Content-Type': 'application/epub+zip', 'Content-Disposition': `attachment; filename="${encodeURIComponent(book.title)}.epub"` });
      const archive = require('archiver')('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      archive.append('application/epub+zip', { name: 'mimetype', store: true });
      archive.append(`<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`, { name: 'META-INF/container.xml' });
      archive.append(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(book.title)}</dc:title><dc:language>zh</dc:language><dc:identifier id="bookid">${epubId}</dc:identifier><dc:creator>coread</dc:creator>${coverMeta}</metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${manifest}${imgManifest}</manifest><spine toc="ncx">${spine}</spine></package>`, { name: 'OEBPS/content.opf' });
      archive.append(`<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${epubId}"/></head><docTitle><text>${esc(book.title)}</text></docTitle><navMap>${navPoints}</navMap></ncx>`, { name: 'OEBPS/toc.ncx' });
      archive.append(style, { name: 'OEBPS/style.css' });
      for (let i = 0; i < chapters.length; i++) archive.append(buildChapterXhtml(chapters[i], i), { name: `OEBPS/ch${i}.xhtml` });
      for (const [fname, data] of exportImages) archive.append(data, { name: `OEBPS/images/${fname}` });
      archive.finalize();
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // DELETE /v1/books/:id
  if (req.method === 'DELETE' && req.url.match(/^\/v1\/books\/\d+$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb();
      const book = db.prepare('SELECT id FROM books WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!book) { db.close(); json(res, 404, { error: 'book not found' }); return true; }
      const versions = db.prepare('SELECT cache_version, comment_version FROM books WHERE id = ?').get(id);
      db.prepare("UPDATE books SET deleted_at = datetime('now') WHERE id = ?").run(id);
      db.close();
      json(res, 200, {
        ok: true,
        deleted: id,
        recoverable: true,
        cache_version: Number(versions?.cache_version || 1),
        comment_version: Number(versions?.comment_version || 1),
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // DELETE /v1/books/:id/permanent
  if (req.method === 'DELETE' && req.url.match(/^\/v1\/books\/\d+\/permanent$/)) {
    let db;
    try {
      const id = parseInt(req.url.split('/')[3]);
      db = getDb();
      const book = db.prepare('SELECT id FROM books WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      if (!book) {
        db.close();
        json(res, 409, { error: 'book must be in trash before permanent deletion' });
        return true;
      }

      const taskIds = db.prepare('SELECT id FROM reading_tasks WHERE book_id = ?').all(id).map(row => Number(row.id));
      db.transaction(() => {
        if (taskIds.length) {
          const placeholders = taskIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM reading_task_usage WHERE task_id IN (${placeholders})`).run(...taskIds);
          db.prepare(`DELETE FROM reading_task_items WHERE task_id IN (${placeholders})`).run(...taskIds);
        }
        for (const table of [
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
          db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(id);
        }
        db.prepare('DELETE FROM books WHERE id = ? AND deleted_at IS NOT NULL').run(id);
      })();
      db.close();
      db = null;

      const dataRoot = path.dirname(getDbPath());
      for (const resourcePath of [
        path.join(dataRoot, 'books', String(id)),
        path.join(dataRoot, 'book-images', String(id)),
      ]) {
        fs.rmSync(resourcePath, { recursive: true, force: true });
      }
      json(res, 200, { ok: true, permanently_deleted: id });
    } catch (e) {
      try { db?.close(); } catch {}
      json(res, 500, { error: e.message });
    }
    return true;
  }

  // PATCH /v1/books/comment/:id -- 收藏状态不触发模型
  if (req.method === 'PATCH' && req.url.match(/^\/v1\/books\/comment\/\d+$/)) {
    try {
      const commentId = parseInt(req.url.split('/').pop());
      const body = await readBody(req);
      const db = getDb();
      const wanted = body.is_favorite ? 1 : 0;
      const comment = db.prepare('SELECT book_id, is_favorite FROM book_comments WHERE id=?').get(commentId);
      const changed = Boolean(comment && Number(comment.is_favorite) !== wanted);
      const result = db.prepare('UPDATE book_comments SET is_favorite=? WHERE id=?').run(wanted, commentId);
      const commentVersion = changed
        ? touchCommentCache(db, comment.book_id)
        : Number(db.prepare('SELECT comment_version FROM books WHERE id=?').get(comment?.book_id)?.comment_version || 1);
      const cacheVersion = Number(db.prepare('SELECT cache_version FROM books WHERE id=?').get(comment?.book_id)?.cache_version || 1);
      db.close();
      json(res, result.changes ? 200 : 404, result.changes
        ? {
          ok: true,
          is_favorite: Boolean(body.is_favorite),
          cache_version: cacheVersion,
          comment_version: commentVersion,
          sync: null,
        }
        : { error: 'comment not found' });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /v1/books/:id/comment/respond -- 对保存过的页边批注明确唤醒主模型
  if (req.method === 'POST' && req.url.match(/^\/v1\/books\/\d+\/comment\/respond$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const commentId = Number(body.comment_id);
      const reviewMode = body.review_mode === 'fine' ? 'fine' : 'layered';
      const requestKey = String(body.request_key || '').trim();
      if (!commentId || !requestKey) { json(res, 400, { error: 'comment_id and request_key required' }); return true; }
      const db = getDb();
      const root = db.prepare('SELECT * FROM book_comments WHERE id=? AND book_id=?').get(commentId, id);
      if (!root) { db.close(); json(res, 404, { error: 'comment not found' }); return true; }
      const existing = db.prepare('SELECT * FROM book_comments WHERE dedupe_key=?').get(`comment-response:${requestKey}`);
      if (existing) {
        const commentSummary = db.prepare('SELECT * FROM chapter_comment_summaries WHERE request_key=?')
          .get(`comment-response:${requestKey}:summary`) || null;
        db.close();
        json(res, 200, { ok: true, comment: existing, comment_summary: commentSummary, deduped: true });
        return true;
      }
      const chapter = chapterForParagraph(db, id, root.paragraph_idx);
      if (!chapter) { db.close(); json(res, 400, { error: 'chapter not found for comment' }); return true; }
      const book = db.prepare('SELECT title FROM books WHERE id=?').get(id);
      const thread = threadComments(db, id, root);
      const review = makeReviewContext(db, id, reviewMode, chapter.chapter_no, {
        referenceText: `${root.selected_text || ''}\n${root.content || ''}\n${thread.map(item => item.content || '').join('\n')}`,
        includeFavorites: false,
        includeFacts: false,
        includeBookPrelude: false,
        includeChapterPrelude: false,
        allowCommentSummaryOverviewWrite: true,
      });
      const previousCommentSummary = latestCommentSummaryRows(db, id)
        .find(row => Number(row.chapter_no) === Number(chapter.chapter_no)) || null;
      const excerpt = annotationExcerpt(db, id, chapter, root.sel_end_para_idx ?? root.paragraph_idx);
      db.close();
      const result = await callModel('main', [
        { role: 'system', content: '严格输出有效 JSON，不要使用 Markdown 代码块。你是 {{char}}，正在自然、具体地回应 {{user}}。' },
        { role: 'user', content: `请回应一条页边批注，并同步更新本章批注摘要。
书名：${book?.title || ''}
当前章：${chapter.title}
本章从开头到批注及其后少量正文：
${excerpt}
讨论线程：${JSON.stringify(thread)}
共同重读记忆：${JSON.stringify(review)}
本章旧批注摘要：${JSON.stringify(previousCommentSummary)}

输出 JSON：
{"reply":"对 {{user}} 这条批注的自然回复","comment_summary":"以 {{char}} 第一人称更新后的本章批注摘要"}

批注摘要通常 120-240 字，复杂章节最多 360 字。明确区分“我”和“{{user}}”的关注，记录真实发生的讨论和观点变化，不写成逐条目录，不虚构互动；保留 {{user}} 旧摘要中明确写入的观点。` },
      ], { maxTokens: 1800 });
      const parsed = parseJsonObject(result.text);
      const replyText = String(parsed?.reply || '').trim();
      const commentSummaryText = String(parsed?.comment_summary || '').trim();
      if (!replyText || !commentSummaryText) throw new Error('model returned an incomplete annotation response');
      const writeDb = getDb();
      let reply;
      let commentSummary;
      try {
        const saved = writeDb.transaction(() => {
          const alreadySaved = writeDb.prepare('SELECT id FROM book_comments WHERE dedupe_key=?').get(`comment-response:${requestKey}`);
          if (alreadySaved) {
            return {
              replyId: alreadySaved.id,
              commentSummary: writeDb.prepare('SELECT * FROM chapter_comment_summaries WHERE request_key=?')
                .get(`comment-response:${requestKey}:summary`) || null,
            };
          }
          const replyId = insertCommentOnce(writeDb, {
            book_id: id,
            paragraph_idx: root.paragraph_idx,
            selected_text: null,
            from_who: 'ai',
            content: replyText.slice(0, 6000),
            reply_to: root.id,
            thread_key: root.thread_key || threadKeyForRange(writeDb, id, root.paragraph_idx, root.sel_start_idx, root.sel_end_idx),
            source_label: result.source,
            dedupe_key: `comment-response:${requestKey}`,
          });
          const savedSummary = saveCommentSummary(writeDb, {
            bookId: id,
            chapterNo: chapter.chapter_no,
            content: commentSummaryText,
            source: result.source,
            requestKey: `comment-response:${requestKey}:summary`,
          });
          return { replyId, commentSummary: savedSummary };
        })();
        reply = writeDb.prepare('SELECT * FROM book_comments WHERE id=?').get(saved.replyId);
        commentSummary = saved.commentSummary;
      } finally {
        writeDb.close();
      }
      const versionDb = getDb(true);
      const versions = versionDb.prepare('SELECT cache_version, comment_version FROM books WHERE id=?').get(id);
      versionDb.close();
      json(res, 200, {
        ok: true,
        comment: reply,
        comment_summary: commentSummary,
        source: result.source,
        model: result.model,
        cache_version: Number(versions?.cache_version || 1),
        comment_version: Number(versions?.comment_version || 1),
      });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/books/:id/chapter-chat?chapter_no=N
  if (req.method === 'GET' && req.url.match(/^\/v1\/books\/\d+\/chapter-chat/)) {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      const id = parseInt(url.pathname.split('/')[3]);
      const chapterNo = Number(url.searchParams.get('chapter_no'));
      const db = getDb(true);
      const messages = db.prepare('SELECT * FROM book_chats WHERE book_id=? AND chapter_no=? ORDER BY created_at, id').all(id, chapterNo);
      db.close();
      json(res, 200, { messages });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /v1/books/:id/chapter-chat -- 纸飞机保存，wake=true 时才唤醒模型
  if (req.method === 'POST' && req.url.match(/^\/v1\/books\/\d+\/chapter-chat$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const body = await readBody(req);
      const chapterNo = Number(body.chapter_no);
      const content = String(body.content || '').trim();
      const wake = Boolean(body.wake);
      const requestKey = String(body.request_key || '').trim();
      const reviewMode = body.review_mode === 'fine' ? 'fine' : 'layered';
      if (!chapterNo || !requestKey) { json(res, 400, { error: 'chapter_no and request_key required' }); return true; }
      const db = getDb();
      const chapter = getChapter(db, id, chapterNo);
      const book = db.prepare('SELECT title FROM books WHERE id=?').get(id);
      if (!chapter || !book) { db.close(); json(res, 404, { error: 'book or chapter not found' }); return true; }
      if (content) {
        db.prepare(`INSERT OR IGNORE INTO book_chats
          (book_id, chapter_no, from_who, content, source_label, dedupe_key)
          VALUES (?, ?, 'human', ?, 'human', ?)`).run(id, chapterNo, content, `chapter-chat-human:${requestKey}`);
      }
      if (!wake) {
        const messages = db.prepare('SELECT * FROM book_chats WHERE book_id=? AND chapter_no=? ORDER BY created_at, id').all(id, chapterNo);
        db.close();
        json(res, 200, { ok: true, messages });
        return true;
      }
      const prior = db.prepare('SELECT * FROM book_chats WHERE book_id=? AND chapter_no=? ORDER BY created_at, id').all(id, chapterNo);
      const existing = db.prepare('SELECT * FROM book_chats WHERE dedupe_key=?').get(`chapter-chat-ai:${requestKey}`);
      if (existing) { db.close(); json(res, 200, { ok: true, message: existing, deduped: true }); return true; }
      const comments = db.prepare('SELECT * FROM book_comments WHERE book_id=? AND paragraph_idx BETWEEN ? AND ? ORDER BY paragraph_idx, created_at').all(id, chapter.start_idx, chapter.end_idx);
      const review = makeReviewContext(db, id, reviewMode, chapterNo, {
        includeFavorites: false,
        includeFacts: false,
        includeBookPrelude: false,
        includeChapterPrelude: false,
        allowCommentSummaryOverviewWrite: true,
      });
      db.close();
      const result = await callModel('main', [
        { role: 'system', content: '你是 {{char}}。自然回应 {{user}} 对整章的讨论，只根据当前章和已经生成的前情资料，不猜测未读后文。' },
        { role: 'user', content: `书名：${book.title}\n当前章完整正文：${chapter.content}\n本章已有批注：${JSON.stringify(comments)}\n章内对话历史：${JSON.stringify(prior)}\n已生成前情：${JSON.stringify(review)}\n请直接回复 {{user}}。` },
      ], { maxTokens: 2200 });
      const replyText = String(result.text || '').trim();
      if (!replyText) throw new Error('model returned an empty chapter-chat reply');
      const writeDb = getDb();
      let message;
      try {
        writeDb.transaction(() => {
          writeDb.prepare(`INSERT OR IGNORE INTO book_chats
            (book_id, chapter_no, from_who, content, source_label, dedupe_key)
            VALUES (?, ?, 'ai', ?, ?, ?)`).run(id, chapterNo, replyText.slice(0, 8000), result.source, `chapter-chat-ai:${requestKey}`);
        })();
        message = writeDb.prepare('SELECT * FROM book_chats WHERE dedupe_key=?').get(`chapter-chat-ai:${requestKey}`);
      } finally {
        writeDb.close();
      }
      json(res, 200, { ok: true, message, source: result.source, model: result.model });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /v1/books/:id/restore
  if (req.method === 'POST' && req.url.match(/^\/v1\/books\/\d+\/restore$/)) {
    try {
      const id = parseInt(req.url.split('/')[3]);
      const db = getDb();
      const result = db.prepare('UPDATE books SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(id);
      const versions = result.changes
        ? db.prepare('SELECT cache_version, comment_version FROM books WHERE id = ?').get(id)
        : null;
      db.close();
      json(res, result.changes ? 200 : 404, result.changes
        ? {
          ok: true,
          restored: id,
          cache_version: Number(versions?.cache_version || 1),
          comment_version: Number(versions?.comment_version || 1),
        }
        : { error: 'book not found' });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /v1/book-images/:bookId/:filename
  const imgMatch = req.url?.match(/^\/v1\/book-images\/(\d+)\/(.+)$/);
  if (req.method === 'GET' && imgMatch) {
    const imgPath = path.join(getImageDir(parseInt(imgMatch[1])), decodeURIComponent(imgMatch[2]));
    try {
      const data = fs.readFileSync(imgPath);
      const ext = path.extname(imgPath).toLowerCase();
      const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      cors(res);
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
    } catch { res.writeHead(404); res.end('not found'); }
    return true;
  }

  return false;
}
