import fs from 'fs';

const p = 'lib/text.mjs';
let s = fs.readFileSync(p, 'utf8');

const old = "  /^[0-9０-９]{1,5}$/;";
const replacement = "  /^(?:[0-9０-９]{1,5})(?:[\\s　]*[、,.，.:：_-])?$/;";
if (s.includes(old)) s = s.replace(old, replacement);

const oldNormalize = `function normalizeChapterNumber(line) {
  const clean = normalizeFullWidthDigits(cleanChapterLine(line));
  return /^\\d{1,5}$/.test(clean) ? Number(clean) : null;
}`;
const newNormalize = `function normalizeChapterNumber(line) {
  const clean = normalizeFullWidthDigits(cleanChapterLine(line));
  const match = clean.match(/^(\\d{1,5})(?:[\\s　]*[、,.，.:：_-])?$/);
  return match ? Number(match[1]) : null;
}`;
if (s.includes(oldNormalize)) s = s.replace(oldNormalize, newNormalize);

fs.writeFileSync(p, s);
console.log('improved numeric chapter variants');
