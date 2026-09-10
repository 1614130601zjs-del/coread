import fs from 'fs';

const p = 'lib/text.mjs';
let s = fs.readFileSync(p, 'utf8');

if (s.includes("id: 'bare_numeric'")) {
  console.log('numeric chapter patch already present');
  process.exit(0);
}

const oldPatterns = `  /^#{1,3}\\s+\\S.{0,80}$/,
];`;
const newPatterns = `  /^#{1,3}\\s+\\S.{0,80}$/,
  /^[0-9０-９]{1,5}$/,
];`;
if (!s.includes(oldPatterns)) throw new Error('chapter pattern anchor not found');
s = s.replace(oldPatterns, newPatterns);

const oldFamilies = `  {
    id: 'markdown',
    label: 'Markdown 标题',
    strength: 80,
    patternIndexes: [8],
  },
].map(family => ({`;
const newFamilies = `  {
    id: 'markdown',
    label: 'Markdown 标题',
    strength: 80,
    patternIndexes: [8],
  },
  {
    id: 'bare_numeric',
    label: '纯数字章节（01 / 02 / 03）',
    strength: 68,
    sequenceRequired: true,
    patternIndexes: [9],
  },
].map(family => ({`;
if (!s.includes(oldFamilies)) throw new Error('family anchor not found');
s = s.replace(oldFamilies, newFamilies);

const oldClean = `function familyMatches(family, line) {
  const clean = cleanChapterLine(line);
  if (!clean || clean.length > 100 || TIME_OR_DATE_LINE.test(clean)) return false;
  return family.patterns.some(re => re.test(clean));
}
`;
const newClean = `function familyMatches(family, line) {
  const clean = cleanChapterLine(line);
  if (!clean || clean.length > 100 || TIME_OR_DATE_LINE.test(clean)) return false;
  return family.patterns.some(re => re.test(clean));
}

function normalizeChapterNumber(line) {
  const clean = normalizeFullWidthDigits(cleanChapterLine(line));
  return /^\\d{1,5}$/.test(clean) ? Number(clean) : null;
}

function bareNumericChapterIndices(paragraphs) {
  const candidates = paragraphs.map((paragraph, idx) => ({
    idx,
    number: normalizeChapterNumber(paragraph),
  })).filter(item => Number.isFinite(item.number));
  const selected = new Set();
  let run = [];
  const flushRun = () => {
    if (run.length >= 3) run.forEach(item => selected.add(item.idx));
    run = [];
  };
  for (const item of candidates) {
    if (!run.length || item.number === run[run.length - 1].number + 1) {
      run.push(item);
    } else if (item.number === run[run.length - 1].number) {
      continue;
    } else {
      flushRun();
      run = [item];
    }
  }
  flushRun();
  return selected;
}
`;
if (!s.includes(oldClean)) throw new Error('chapter helper anchor not found');
s = s.replace(oldClean, newClean);

const oldSeq = `  } else if (familyId === 'arabic_numbered') {
    match = clean.match(/^(\\d+)\\s*[:：,.，、_—-]/);
  }
`;
const newSeq = `  } else if (familyId === 'arabic_numbered') {
    match = clean.match(/^(\\d+)\\s*[:：,.，、_—-]/);
  } else if (familyId === 'bare_numeric') {
    const number = normalizeChapterNumber(clean);
    return Number.isFinite(number) ? number : null;
  }
`;
if (!s.includes(oldSeq)) throw new Error('sequence anchor not found');
s = s.replace(oldSeq, newSeq);

const oldCandidates = `    const matches = [];
    paragraphs.forEach((paragraph, idx) => {
      if (familyMatches(family, paragraph)) {
        matches.push({ idx, title: cleanChapterLine(paragraph).replace(/^#+\\s*/, '') });
      }
    });`;
const newCandidates = `    const matches = [];
    const bareNumericIndices = family.id === 'bare_numeric' ? bareNumericChapterIndices(paragraphs) : null;
    paragraphs.forEach((paragraph, idx) => {
      if (family.id === 'bare_numeric'
        ? bareNumericIndices.has(idx)
        : familyMatches(family, paragraph)) {
        matches.push({ idx, title: cleanChapterLine(paragraph).replace(/^#+\\s*/, '') });
      }
    });`;
if (!s.includes(oldCandidates)) throw new Error('candidate anchor not found');
s = s.replace(oldCandidates, newCandidates);

const oldScore = `    if (family.listLike && (gap < 3 || density > 0.12)) score -= 55;
    if (matches.length < 2) score -= 45;`;
const newScore = `    if (family.listLike && (gap < 3 || density > 0.12)) score -= 55;
    if (family.sequenceRequired && (matches.length < 3 || continuity < 0.5)) score -= 70;
    if (matches.length < 2) score -= 45;`;
if (!s.includes(oldScore)) throw new Error('score anchor not found');
s = s.replace(oldScore, newScore);

const oldSplit = `  const lines = String(text || '').replace(/\\r\\n?/g, '\\n').split('\\n');
  const titleCount = lines.filter(line => isChapterTitle(line)).length;
  const likelyChapters = titleCount >= 2 || (titleCount >= 1 && lines.length > 80);`;
const newSplit = `  const lines = String(text || '').replace(/\\r\\n?/g, '\\n').split('\\n');
  const bareNumericChapterLines = new Set();
  const numericLines = lines.map((line, idx) => ({
    idx,
    number: normalizeChapterNumber(line),
  })).filter(item => Number.isFinite(item.number));
  let numericRun = [];
  const flushNumericRun = () => {
    if (numericRun.length >= 3) numericRun.forEach(item => bareNumericChapterLines.add(item.idx));
    numericRun = [];
  };
  for (const item of numericLines) {
    if (!numericRun.length || item.number === numericRun[numericRun.length - 1].number + 1) {
      numericRun.push(item);
    } else if (item.number !== numericRun[numericRun.length - 1].number) {
      flushNumericRun();
      numericRun = [item];
    }
  }
  flushNumericRun();
  const titleCount = lines.filter((line, idx) => isChapterTitle(line) || bareNumericChapterLines.has(idx)).length;
  const likelyChapters = titleCount >= 2 || (titleCount >= 1 && lines.length > 80);`;
if (!s.includes(oldSplit)) throw new Error('split anchor not found');
s = s.replace(oldSplit, newSplit);

const oldLoop = `  for (const line of lines) {
    const clean = line.trim();
    const chapter = isChapterTitle(clean);`;
const newLoop = `  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const clean = line.trim();
    const chapter = isChapterTitle(clean) || bareNumericChapterLines.has(lineIndex);`;
if (!s.includes(oldLoop)) throw new Error('loop anchor not found');
s = s.replace(oldLoop, newLoop);

fs.writeFileSync(p, s);
console.log('patched numeric chapter detection');
