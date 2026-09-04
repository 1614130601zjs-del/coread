import fs from 'node:fs';

// This is a build-time compatibility patch. Keep the canonical source intact and
// re-apply these small UI/API fixes on every clean Render build.

const studyPath = 'web/StudyApp.tsx';
let s = fs.readFileSync(studyPath, 'utf8');

// Restore the visible cover import control that was accidentally dropped from the
// latest UI-fix script. The underlying editor already persists cover_image.
if (!s.includes('导入封面')) {
  const coverAnchor = /(<label style=\{\{ display: 'block', fontSize: 11, color: '#888', marginBottom: 5 \}\}>封面<\/label>[\s\S]*?<input type="file" accept="image\/\*"[\s\S]*?<\/div>)/;
  const m = s.match(coverAnchor);
  if (!m) throw new Error('cover editor anchor not found');
  const block = m[1];
  const patched = block.replace(
    '<input type="file" accept="image/*"',
    '<button type="button" onClick={() => document.getElementById(\'coread-cover-file\')?.click()} style={{ padding: \'7px 10px\', border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: c.primaryBg, color: c.primaryDark, fontSize: 12, cursor: \'pointer\', marginBottom: 8 }}>导入封面</button>\n                            <input id="coread-cover-file" type="file" accept="image/*"'
  );
  s = s.replace(block, patched);
}

// Make the category delete button call a real API method. If a deleted category is
// still assigned to books, those books are moved to the normal default category.
const apiPath = 'web/api.ts';
let api = fs.readFileSync(apiPath, 'utf8');
if (!api.includes('deleteLibraryOption:')) {
  const anchor = "  addLibraryOption: (type: string, value: string) =>\n    request('/v1/library/options', { method: 'POST', body: JSON.stringify({ type, value }) }),";
  if (!api.includes(anchor)) throw new Error('api library option anchor not found');
  api = api.replace(anchor, anchor + "\n  deleteLibraryOption: (type: string, value: string) =>\n    request('/v1/library/options', { method: 'DELETE', body: JSON.stringify({ type, value }) }),");
  fs.writeFileSync(apiPath, api);
}

fs.writeFileSync(studyPath, s);

// Add a small server-side DELETE handler before the generic route dispatcher.
// Options are derived from books/config in this app, so deletion means removing
// the option from all book metadata rather than deleting any book rows.
const serverPath = 'server.mjs';
let server = fs.readFileSync(serverPath, 'utf8');
if (!server.includes("req.method === 'DELETE' && req.url === '/v1/library/options'")) {
  const anchor = "  if (authRequired(req)) {\n";
  if (!server.includes(anchor)) throw new Error('server auth anchor not found');
  const handler = `  if (req.method === 'DELETE' && req.url === '/v1/library/options') {\n    try {\n      const body = await readJson(req);\n      const type = String(body.type || '').trim();\n      const value = String(body.value || '').trim();\n      if (!value || !['category', 'tag'].includes(type)) {\n        res.writeHead(400, { 'Content-Type': 'application/json' });\n        res.end(JSON.stringify({ error: 'invalid library option' }));\n        return;\n      }\n      const db = getDb(true);\n      if (type === 'category') {\n        if (value === '待看') {\n          res.writeHead(400, { 'Content-Type': 'application/json' });\n          res.end(JSON.stringify({ error: '默认分类「待看」不能删除' }));\n          db.close();\n          return;\n        }\n        db.prepare("UPDATE books SET category='待看' WHERE category=?").run(value);\n      } else {\n        const rows = db.prepare('SELECT id, tags_json FROM books').all();\n        const update = db.prepare('UPDATE books SET tags_json=? WHERE id=?');\n        for (const row of rows) {\n          let tags = [];\n          try { tags = JSON.parse(row.tags_json || '[]'); } catch {}\n          if (!Array.isArray(tags)) tags = [];\n          const next = tags.filter(tag => String(tag) !== value);\n          if (next.length !== tags.length) update.run(JSON.stringify(next), row.id);\n        }\n      }\n      db.close();\n      res.writeHead(200, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({ ok: true }));\n    } catch (error) {\n      res.writeHead(500, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'delete library option failed' }));\n    }\n    return;\n  }\n`;
  server = server.replace(anchor, handler + anchor);
  fs.writeFileSync(serverPath, server);
}

console.log('Applied Coread cover import and real library-option deletion');
