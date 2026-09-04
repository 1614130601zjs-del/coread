import fs from 'node:fs';

const path = 'web/StudyApp.tsx';
let s = fs.readFileSync(path, 'utf8');
const before = s;

// fix-cover-category.mjs currently injects the existing-cover replace control as
// siblings inside a JSX conditional expression. That makes the generated TSX
// invalid. Keep the working no-cover import control, but remove only the broken
// existing-cover injection; the API still supports replacing a cover by upload.
s = s.replace(/^\s*<input id=\{`coread-cover-file-existing-\$\{book\.id\}`}[\s\S]*?\n\s*<button type="button" onClick=\{\(\) => document\.getElementById\(`coread-cover-file-existing-\$\{book\.id\}`\)\?\.click\(\)\}[\s\S]*?>更换封面<\/button>\s*$/gm, '');

if (s !== before) fs.writeFileSync(path, s);
console.log(s !== before ? 'Removed invalid existing-cover JSX injection' : 'No invalid existing-cover JSX injection found');
