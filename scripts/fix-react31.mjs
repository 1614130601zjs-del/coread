import { readFileSync, writeFileSync } from 'node:fs';

const path = 'web/StudyApp.tsx';
const source = readFileSync(path, 'utf8');
const oldText = '由 {{user}} 确认的全书理解基础。';
const newText = '由用户确认的全书理解基础。';

if (source.includes(oldText)) {
  writeFileSync(path, source.replace(oldText, newText), 'utf8');
  console.log('Applied exact React #31 fix to web/StudyApp.tsx');
} else {
  console.log('React #31 target already fixed; no change needed.');
}
