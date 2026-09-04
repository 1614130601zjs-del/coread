import fs from 'node:fs';

const dbPath = 'lib/db.mjs';
let db = fs.readFileSync(dbPath, 'utf8');

const migration = `  // Permanently remove the legacy synthetic tags from both config and existing books.\n  const legacyDefaultTags = new Set(['森', '林', '木', '没看完']);\n  const tagConfig = db.prepare('SELECT value FROM config WHERE key = ?').get('tags');\n  if (tagConfig?.value) {\n    let configuredTags = [];\n    try { configuredTags = JSON.parse(tagConfig.value); } catch {}\n    if (Array.isArray(configuredTags)) {\n      const cleanedTags = [...new Set(configuredTags.map(String))].filter(tag => !legacyDefaultTags.has(tag));\n      if (JSON.stringify(cleanedTags) !== JSON.stringify(configuredTags)) {\n        db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')\n          .run('tags', JSON.stringify(cleanedTags));\n      }\n    }\n  }\n  const taggedBooks = db.prepare('SELECT id, tags_json FROM books').all();\n  const updateBookTags = db.prepare('UPDATE books SET tags_json=? WHERE id=?');\n  for (const book of taggedBooks) {\n    let currentTags = [];\n    try { currentTags = JSON.parse(book.tags_json || '[]'); } catch {}\n    if (Array.isArray(currentTags)) {\n      const cleanedTags = [...new Set(currentTags.map(String))].filter(tag => !legacyDefaultTags.has(tag));\n      if (JSON.stringify(cleanedTags) !== JSON.stringify(currentTags)) {\n        updateBookTags.run(JSON.stringify(cleanedTags), book.id);\n      }\n    }\n  }\n`;

if (!db.includes('Permanently remove the legacy synthetic tags')) {
  const marker = '  db.close();\n}\n\nexport function getDb';
  if (!db.includes(marker)) throw new Error('db init close anchor not found');
  db = db.replace(marker, migration + marker);
  fs.writeFileSync(dbPath, db);
  console.log('Applied permanent legacy tag cleanup to db init');
} else {
  console.log('Permanent legacy tag cleanup already present');
}
