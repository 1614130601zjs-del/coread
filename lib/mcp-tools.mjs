import { getDb, getImageDir } from './db.mjs';
import { parseEpub, extractImages, extractCover, smartSplit } from './epub.mjs';
import { computePageBreaks, BOOK_PER_PAGE, requestChapterReading } from './routes.mjs';
import fs from 'fs';
import path from 'path';

const CHAPTER_RE = /^第[\d一二三四五六七八九十百千万]+[章节回]|^#|^Chapter\s+\d/i;

export const tools = [
  {
    name: 'list_books',
    description: 'List all books in the co-reading library',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'read_book',
    description: 'Read a section of a book by page number',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
        page: { type: 'number', description: 'Page number (default 1)' },
        per_page: { type: 'number', description: 'Deprecated/ignored: pagination is unified server-side (BOOK_PER_PAGE)' },
      },
      required: ['book_id'],
    },
  },
  {
    name: 'request_chapter_reading',
    description: 'Explicitly ask the configured main model to co-read one chapter. This creates a reading event, saves a chapter summary and AI annotations, and never reads unprocessed later chapters.',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
        chapter_no: { type: 'number', description: 'Chapter number to co-read' },
        review_mode: { type: 'string', enum: ['fine', 'layered'], description: 'fine = all generated earlier chapter summaries; layered = recent 30 chapter summaries plus older block summaries and facts' },
        request_key: { type: 'string', description: 'Optional idempotency key. Reuse it only to retry the same explicit request.' },
      },
      required: ['book_id', 'chapter_no'],
    },
  },
  {
    name: 'get_chapter_exact',
    description: 'Read exact stored chapter text from the Coread server.',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
        chapter_no: { type: 'number', description: 'Chapter number' },
        max_chars: { type: 'number', description: 'Optional maximum returned characters; defaults to 50000 and can be raised to 120000.' },
      },
      required: ['book_id', 'chapter_no'],
    },
  },
  {
    name: 'get_reading_memory',
    description: 'Read the compressed Coread reading memory for one book: preferred chapter summaries, 30-chapter summaries, facts, and shared reading impressions. It does not return book full text.',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
      },
      required: ['book_id'],
    },
  },
  {
    name: 'get_annotation_thread',
    description: 'Read one exact stored annotation thread, including the original selection and its continuous replies. It does not return the whole chapter.',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
        comment_id: { type: 'number', description: 'Any comment ID in the target thread' },
      },
      required: ['book_id', 'comment_id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment/annotation to a paragraph in a book',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
        paragraph_idx: { type: 'number', description: 'Paragraph index to comment on' },
        content: { type: 'string', description: 'Comment text' },
        from_who: { type: 'string', description: 'Who is commenting (default: "ai")' },
        selected_text: { type: 'string', description: 'Optional: highlighted text from the paragraph' },
        reply_to: { type: 'number', description: 'Optional: comment ID to reply to' },
      },
      required: ['book_id', 'paragraph_idx', 'content'],
    },
  },
  {
    name: 'list_comments',
    description: 'List all comments for a book',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
      },
      required: ['book_id'],
    },
  },
  {
    name: 'get_toc',
    description: 'Get the table of contents for a book',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
      },
      required: ['book_id'],
    },
  },
  {
    name: 'import_book',
    description: 'Import a book from text content or epub (base64)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Book title' },
        content: { type: 'string', description: 'Plain text content (for text import)' },
        format: { type: 'string', description: '"epub" for epub import' },
        data: { type: 'string', description: 'Base64-encoded epub file data' },
      },
      required: ['title'],
    },
  },
  {
    name: 'delete_comment',
    description: 'Delete a comment by ID',
    inputSchema: {
      type: 'object',
      properties: { comment_id: { type: 'number', description: 'Comment ID to delete' } },
      required: ['comment_id'],
    },
  },
  {
    name: 'update_progress',
    description: 'Update reading progress for a book',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
        page: { type: 'number', description: 'Current page number' },
      },
      required: ['book_id', 'page'],
    },
  },
];

export async function handleTool(name, args) {
  switch (name) {
    case 'list_books': {
      const db = getDb(true);
      const books = db.prepare('SELECT b.id, b.title, b.total_paragraphs, b.created_at, b.cover_image, p.page as current_page FROM books b LEFT JOIN book_progress p ON b.id = p.book_id ORDER BY b.created_at DESC').all();
      const counts = db.prepare('SELECT book_id, COUNT(*) as count FROM book_comments GROUP BY book_id').all();
      db.close();
      const countMap = {};
      for (const c of counts) countMap[c.book_id] = c.count;
      return books.map(b => ({ ...b, comment_count: countMap[b.id] || 0 }));
    }
    case 'read_book': {
      const { book_id, page = 1 } = args;
      const db = getDb(true);
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(book_id);
      if (!book) { db.close(); return { error: 'Book not found' }; }
      // The server owns the shared page coordinate used by the reader and annotations.
      const pages = computePageBreaks(db, book_id, BOOK_PER_PAGE);
      const totalPages = pages.length || 1;
      const p = Math.max(1, Math.min(page, totalPages));
      const pageIndices = pages[p - 1] || [];
      let pageParas = [];
      if (pageIndices.length > 0) {
        const placeholders = pageIndices.map(() => '?').join(',');
        pageParas = db.prepare(`SELECT idx, content FROM book_paragraphs WHERE book_id = ? AND idx IN (${placeholders}) ORDER BY idx`).all(book_id, ...pageIndices);
      }
      const idxSet = new Set(pageParas.map(x => x.idx));
      const comments = db.prepare('SELECT * FROM book_comments WHERE book_id = ? ORDER BY paragraph_idx, created_at').all(book_id)
        .filter(c => idxSet.has(c.paragraph_idx));
      db.close();
      const text = pageParas.map(x => `[${x.idx}] ${x.content}`).join('\n\n');
      const commentText = comments.length ? '\n---\nComments on this page:\n' + comments.map(c => `  [${c.from_who}@${c.paragraph_idx}] ${c.selected_text ? `"${c.selected_text}" → ` : ''}${c.content}`).join('\n') : '';
      return { book: book.title, page: p, totalPages, text: text + commentText };
    }
    case 'request_chapter_reading': {
      const { book_id, chapter_no, review_mode = 'layered', request_key } = args;
      const key = String(request_key || `mcp-read:${book_id}:${chapter_no}:${Date.now()}:${Math.random()}`);
      return await requestChapterReading({
        bookId: book_id,
        chapterNo: chapter_no,
        reviewMode: review_mode,
        requestKey: key,
      });
    }
    case 'get_chapter_exact': {
      const { book_id, chapter_no, max_chars = 50000 } = args;
      const db = getDb(true);
      const book = db.prepare('SELECT id, title FROM books WHERE id=? AND deleted_at IS NULL').get(book_id);
      const chapter = db.prepare(`
        SELECT chapter_no, title, start_idx, end_idx
        FROM book_chapters WHERE book_id=? AND chapter_no=?
      `).get(book_id, chapter_no);
      if (!book || !chapter) { db.close(); return { error: 'book or chapter not found' }; }
      const paragraphs = db.prepare(`
        SELECT idx, content FROM book_paragraphs
        WHERE book_id=? AND idx BETWEEN ? AND ? ORDER BY idx
      `).all(book_id, chapter.start_idx, chapter.end_idx);
      db.close();
      const requested = Number.isFinite(Number(max_chars)) ? Number(max_chars) : 50000;
      const limit = Math.max(1000, Math.min(requested, 120000));
      const fullText = paragraphs.map(p => `[${p.idx}] ${p.content}`).join('\n\n');
      return {
        book_id: book.id,
        book_title: book.title,
        chapter,
        text: fullText.slice(0, limit),
        truncated: fullText.length > limit,
        total_chars: fullText.length,
      };
    }
    case 'get_reading_memory': {
      const { book_id } = args;
      const db = getDb(true);
      const book = db.prepare('SELECT id, title FROM books WHERE id=? AND deleted_at IS NULL').get(book_id);
      if (!book) { db.close(); return { error: 'book not found' }; }
      const rawSummaries = db.prepare(`
        SELECT * FROM book_summaries WHERE book_id=?
        ORDER BY chapter_no, kind, id
      `).all(book_id);
      const latest = new Map();
      for (const row of rawSummaries) {
        const key = `${row.kind}:${row.chapter_no ?? 'all'}`;
        if (!latest.has(key) || Number(latest.get(key).id) < Number(row.id)) latest.set(key, row);
      }
      const facts = db.prepare(`
        SELECT id, chapter_no, fact_type, key_name, value, source, updated_at
        FROM book_facts WHERE book_id=? ORDER BY chapter_no, id
      `).all(book_id);
      const impressions = db.prepare(`
        SELECT id, book_id, chapter_start, chapter_end, content, source_label, created_at
        FROM book_reading_impressions WHERE book_id=? ORDER BY id DESC
      `).all(book_id);
      db.close();
      return {
        book,
        summaries: [...latest.values()],
        facts,
        reading_impressions: impressions,
      };
    }
    case 'get_annotation_thread': {
      const { book_id, comment_id } = args;
      const db = getDb(true);
      const root = db.prepare('SELECT * FROM book_comments WHERE id=? AND book_id=?').get(comment_id, book_id);
      if (!root) { db.close(); return { error: 'comment not found' }; }
      const allComments = db.prepare('SELECT * FROM book_comments WHERE book_id=? ORDER BY created_at, id').all(book_id);
      db.close();
      const byId = new Map(allComments.map(comment => [comment.id, comment]));
      let earliest = root;
      while (earliest.reply_to && byId.has(earliest.reply_to)) earliest = byId.get(earliest.reply_to);
      const ids = new Set([root.id, earliest.id]);
      const sharedKey = root.thread_key || earliest.thread_key;
      if (sharedKey) {
        for (const comment of allComments) if (comment.thread_key === sharedKey) ids.add(comment.id);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const comment of allComments) {
          if (comment.reply_to && ids.has(comment.reply_to) && !ids.has(comment.id)) {
            ids.add(comment.id);
            changed = true;
          }
        }
      }
      const thread = allComments.filter(comment => ids.has(comment.id));
      return {
        book_id,
        comment_id,
        selected_text: earliest.selected_text || root.selected_text || null,
        paragraph_idx: earliest.paragraph_idx,
        thread,
      };
    }
    case 'add_comment': {
      const { book_id, paragraph_idx, content, from_who = 'ai', selected_text, reply_to } = args;
      const db = getDb();
      let startIdx = null, endIdx = null;
      if (selected_text) {
        const para = db.prepare('SELECT content FROM book_paragraphs WHERE book_id = ? AND idx = ?').get(book_id, paragraph_idx);
        if (para?.content) { const i = para.content.indexOf(selected_text); if (i >= 0) { startIdx = i; endIdx = i + selected_text.length; } }
      }
      const result = db.prepare('INSERT INTO book_comments (book_id, paragraph_idx, sel_start_idx, sel_end_idx, selected_text, from_who, content, reply_to) VALUES (?,?,?,?,?,?,?,?)').run(book_id, paragraph_idx, startIdx, endIdx, selected_text || null, from_who, content, reply_to || null);
      db.close();
      return { ok: true, id: Number(result.lastInsertRowid) };
    }
    case 'list_comments': {
      const { book_id } = args;
      const db = getDb(true);
      const comments = db.prepare('SELECT * FROM book_comments WHERE book_id = ? ORDER BY paragraph_idx, created_at').all(book_id);
      db.close();
      return comments;
    }
    case 'get_toc': {
      const { book_id } = args;
      const db = getDb(true);
      const paras = db.prepare('SELECT idx, substr(content, 1, 100) as content FROM book_paragraphs WHERE book_id = ? ORDER BY idx').all(book_id);
      db.close();
      const chapters = [];
      for (const p of paras) {
        if (CHAPTER_RE.test(p.content.trim())) {
          chapters.push({ idx: p.idx, title: p.content.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) });
        }
      }
      return chapters;
    }
    case 'import_book': {
      const { title, content, format, data } = args;
      let paragraphs = [];
      let epubResult = null;
      if (format === 'epub' && data) { epubResult = parseEpub(data); paragraphs = epubResult.paragraphs; }
      else if (content) { paragraphs = smartSplit(content); }
      else return { error: 'content or epub data required' };
      if (!paragraphs.length) return { error: 'no paragraphs extracted' };
      const db = getDb();
      const r = db.prepare('INSERT INTO books (title, total_paragraphs) VALUES (?, ?)').run(title, paragraphs.length);
      const bookId = Number(r.lastInsertRowid);
      const ins = db.prepare('INSERT INTO book_paragraphs (book_id, idx, content) VALUES (?, ?, ?)');
      db.transaction(() => { for (let i = 0; i < paragraphs.length; i++) ins.run(bookId, i, paragraphs[i]); })();
      db.close();
      if (epubResult) {
        const imgDir = getImageDir(bookId);
        const images = extractImages(epubResult.zip, epubResult.epubImageMap, paragraphs);
        for (const [fname, d] of images) fs.writeFileSync(path.join(imgDir, fname), d);
        const cover = extractCover(epubResult.zip, epubResult.epubCoverFile);
        if (cover) {
          fs.writeFileSync(path.join(imgDir, cover.name), cover.data);
          const db2 = getDb();
          db2.prepare('UPDATE books SET cover_image = ? WHERE id = ?').run(cover.name, bookId);
          db2.close();
        }
      }
      return { ok: true, book_id: bookId, paragraphs: paragraphs.length };
    }
    case 'delete_comment': {
      const db = getDb();
      db.prepare('DELETE FROM book_comments WHERE id = ?').run(args.comment_id);
      db.close();
      return { ok: true };
    }
    case 'update_progress': {
      const db = getDb();
      db.prepare("INSERT INTO book_progress (book_id, page, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(book_id) DO UPDATE SET page = ?, updated_at = datetime('now')").run(args.book_id, args.page, args.page);
      db.close();
      return { ok: true };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
