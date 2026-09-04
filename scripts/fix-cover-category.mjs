import fs from 'node:fs';

const studyPath = 'web/StudyApp.tsx';
let s = fs.readFileSync(studyPath, 'utf8');
const apiPath = 'web/api.ts';
let api = fs.readFileSync(apiPath, 'utf8');
const routesPath = 'lib/routes.mjs';
let routes = fs.readFileSync(routesPath, 'utf8');
let changed = false;

// Remove the synthetic default tags from the UI and API fallback. Match any
// legacy generated variant so a later UI patch cannot resurrect them.
const tagStateRe = /const \[libraryTags, setLibraryTags\] = useState<string\[\]>\(\[[^\]]*\]\);/;
if (tagStateRe.test(s)) {
  s = s.replace(tagStateRe, "const [libraryTags, setLibraryTags] = useState<string[]>([]);");
  changed = true;
}
s = s.replace("safeJson(tags?.value, ['没看完'])", 'safeJson(tags?.value, [])');
s = s.replace("safeJson(tags?.value, ['森', '林', '木', '没看完'])", 'safeJson(tags?.value, [])');
routes = routes.replace("safeJson(tags?.value, ['没看完'])", 'safeJson(tags?.value, [])');
routes = routes.replace("safeJson(tags?.value, ['森', '林', '木', '没看完'])", 'safeJson(tags?.value, [])');
routes = routes.replace(" : ['没看完'];", ' : [];');
routes = routes.replace(" : ['森', '林', '木', '没看完'];", ' : [];');

// Remove the four legacy tags from the library-options GET response and from
// the persisted config. IMPORTANT: target this route specifically; an earlier
// patch accidentally matched the unrelated /v1/books GET and returned
// `tagList` from the wrong scope, causing `tagList is not defined` at runtime.
if (!routes.includes("const legacyDefaultTags = new Set(['森', '林', '木', '没看完']);")) {
  const routeStart = "  // GET /v1/library/options\n  if (req.method === 'GET' && req.url === '/v1/library/options') {";
  const routeEnd = "  // POST /v1/library/options\n";
  const start = routes.indexOf(routeStart);
  const end = routes.indexOf(routeEnd, start);
  if (start === -1 || end === -1) throw new Error('library options GET route anchors not found');

  const route = routes.slice(start, end);
  const nextRoute = route
    .replace(
      "  if (req.method === 'GET' && req.url === '/v1/library/options') {",
      "  if (req.method === 'GET' && req.url === '/v1/library/options') {\n    const legacyDefaultTags = new Set(['森', '林', '木', '没看完']);",
    )
    .replace(
      "    const tags = db.prepare('SELECT value FROM config WHERE key = ?').get('tags');\n    db.close();",
      "    const tags = db.prepare('SELECT value FROM config WHERE key = ?').get('tags');\n    let tagList = safeJson(tags?.value, []);\n    if (Array.isArray(tagList)) tagList = tagList.filter(tag => !legacyDefaultTags.has(String(tag)));\n    if (Array.isArray(tagList) && tags?.value !== JSON.stringify(tagList)) {\n      db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('tags', JSON.stringify(tagList));\n    }\n    db.close();",
    )
    .replace("      tags: safeJson(tags?.value, []),", "      tags: tagList,")
    .replace("      tags: safeJson(tags?.value, ['没看完']),", "      tags: tagList,")
    .replace("      tags: safeJson(tags?.value, ['森', '林', '木', '没看完']),", "      tags: tagList,");

  routes = routes.slice(0, start) + nextRoute + routes.slice(end);
  changed = true;
}

// Real API helpers.
if (!api.includes('deleteLibraryOption:')) {
  const marker = "  addLibraryOption: (type: string, value: string) =>\n    request('/v1/library/options', { method: 'POST', body: JSON.stringify({ type, value }) }),";
  if (!api.includes(marker)) throw new Error('library option API anchor not found');
  api = api.replace(marker, marker + "\n  deleteLibraryOption: (type: string, value: string) =>\n    request('/v1/library/options', { method: 'DELETE', body: JSON.stringify({ type, value }) }),");
  changed = true;
}
if (!api.includes('uploadCover:')) {
  const marker = "  deleteLibraryOption: (type: string, value: string) =>\n    request('/v1/library/options', { method: 'DELETE', body: JSON.stringify({ type, value }) }),";
  if (!api.includes(marker)) throw new Error('delete library API anchor not found');
  api = api.replace(marker, marker + "\n  uploadCover: (bookId: number, data: string, mime: string) =>\n    request(`/v1/books/${bookId}/cover`, { method: 'POST', body: JSON.stringify({ data, mime }) }),");
  changed = true;
}

// Real cover upload endpoint. The database stores only the filename; binary data stays in the existing image directory.
if (!routes.includes("const coverMatch = req.url?.match(/^\\/v1\\/books\\/(\\d+)\\/cover$/);")) {
  const marker = "  // GET /v1/book-images/:bookId/:filename\n";
  if (!routes.includes(marker)) throw new Error('book image route anchor not found');
  const handler = `  // POST /v1/books/:id/cover\n  const coverMatch = req.url?.match(/^\\/v1\\/books\\/(\\d+)\\/cover$/);\n  if (req.method === 'POST' && coverMatch) {\n    try {\n      const bookId = Number(coverMatch[1]);\n      const body = await readBody(req);\n      const mime = String(body.mime || 'image/jpeg').toLowerCase();\n      if (!/^image\\/(jpeg|jpg|png|webp|gif)$/.test(mime)) { json(res, 400, { error: 'unsupported cover image type' }); return true; }\n      const raw = String(body.data || '');\n      const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;\n      const data = Buffer.from(base64, 'base64');\n      if (!data.length || data.length > 12 * 1024 * 1024) { json(res, 400, { error: 'cover image must be between 1 byte and 12MB' }); return true; }\n      const db = getDb();\n      const book = db.prepare('SELECT id FROM books WHERE id=? AND deleted_at IS NULL').get(bookId);\n      if (!book) { db.close(); json(res, 404, { error: 'book not found' }); return true; }\n      const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : '.jpg';\n      const filename = 'cover-' + crypto.randomBytes(8).toString('hex') + ext;\n      const dir = getImageDir(bookId);\n      fs.mkdirSync(dir, { recursive: true });\n      fs.writeFileSync(path.join(dir, filename), data);\n      db.prepare('UPDATE books SET cover_image=? WHERE id=?').run(filename, bookId);\n      db.close();\n      json(res, 200, { ok: true, filename });\n    } catch (e) { json(res, 500, { error: e.message }); }\n    return true;\n  }\n\n`;
  routes = routes.replace(marker, handler + marker);
  changed = true;
}

// Real category/tag DELETE endpoint.
if (!routes.includes("req.method === 'DELETE' && req.url === '/v1/library/options'")) {
  const marker = "  // POST /v1/library/options\n";
  if (!routes.includes(marker)) throw new Error('library option POST anchor not found');
  const handler = `  // DELETE /v1/library/options
  if (req.method === 'DELETE' && req.url === '/v1/library/options') {
    try {
      const body = await readBody(req);
      const type = String(body.type || '').trim();
      const value = String(body.value || '').trim();
      const key = type === 'category' ? 'categories' : type === 'tag' ? 'tags' : '';
      if (!key || !value) { json(res, 400, { error: 'type and value required' }); return true; }
      const db = getDb();
      const row = db.prepare('SELECT value FROM config WHERE key=?').get(key);
      const defaults = key === 'categories' ? ['待看'] : [];
      let list = safeJson(row?.value, defaults);
      if (!Array.isArray(list)) list = [...defaults];
      if (key === 'categories' && value === '待看') { db.close(); json(res, 400, { error: '默认分类「待看」不能删除' }); return true; }
      list = [...new Set(list.map(String))].filter(item => item !== value);
      db.prepare('INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(list));
      if (type === 'category') db.prepare("UPDATE books SET category='待看' WHERE category=?").run(value);
      if (type === 'tag') {
        const rows = db.prepare('SELECT id,tags_json FROM books').all();
        const update = db.prepare('UPDATE books SET tags_json=? WHERE id=?');
        for (const row of rows) {
          const tags = safeJson(row.tags_json, []);
          const next = Array.isArray(tags) ? tags.filter(tag => String(tag) !== value) : [];
          if (next.length !== tags.length) update.run(JSON.stringify(next), row.id);
        }
      }
      db.close();
      json(res, 200, { ok: true });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

`;
  routes = routes.replace(marker, handler + marker);
  changed = true;
}

// Replace the old synthetic title-as-cover block with a real import control.
const oldCover = `                                                    {book.cover_image ? (\n                                                        <img src={api.imageUrl(book.id, book.cover_image)} alt=\"\" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(1) contrast(1.12)' }} />\n                                                    ) : (\n                                                        <span style={{\n                                                            maxWidth: '78%', padding: '8px 7px', border: \`2px solid \${i % 2 === 0 ? '#fff' : '#111'}\`,\n                                                            background: i % 2 === 0 ? '#111' : '#fff', color: i % 2 === 0 ? '#fff' : '#111',\n                                                            fontSize: 17, fontWeight: 900, textAlign: 'center', lineHeight: 1.35,\n                                                            wordBreak: 'break-all', whiteSpace: 'pre-wrap',\n                                                        }}>{book.title.slice(0, 10)}</span>\n                                                    )}`;
if (s.includes(oldCover)) {
  const newCover = `                                                    {book.cover_image ? (\n                                                        <img src={api.imageUrl(book.id, book.cover_image)} alt=\"\" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />\n                                                    ) : (\n                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: '100%', background: '#fff' }}>\n                                                            <div style={{ fontSize: 11, color: '#888' }}>暂无封面</div>\n                                                            <input id={\`coread-cover-file-\${book.id}\`} type=\"file\" accept=\"image/jpeg,image/png,image/webp,image/gif\" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = async () => { try { await api.uploadCover(book.id, String(reader.result || ''), file.type); await loadBooks(showTrash); } catch (error) { window.alert(error instanceof Error ? error.message : '封面导入失败'); } }; reader.readAsDataURL(file); }} />\n                                                            <button type=\"button\" onClick={() => document.getElementById(\`coread-cover-file-\${book.id}\`)?.click()} style={{ padding: '6px 9px', border: '1px solid #111', background: '#fff', color: '#111', fontSize: 10, cursor: 'pointer' }}>导入封面</button>\n                                                        </div>\n                                                    )}`;
  s = s.replace(oldCover, newCover);
  changed = true;
}

fs.writeFileSync(studyPath, s);
fs.writeFileSync(apiPath, api);
fs.writeFileSync(routesPath, routes);
console.log(changed ? 'Applied Coread real cover import, legacy tag cleanup, and real library option deletion' : 'Coread cover/library patch already present');