import fs from 'fs';

const p = 'lib/text.mjs';
let s = fs.readFileSync(p, 'utf8');

// Bare numeric chapter headings: 01 / 02 / 03, 001 / 002 / 003,
// full-width digits, and optional punctuation such as 01、 or 02.
if (!s.includes("id: 'bare_numeric'")) {
  const familyAnchor = "  {\n    id: 'arabic_numbered',";
  const familyInsert = `  {\n    id: 'bare_numeric',\n    label: '纯数字章节（01 / 02 / 03）',\n    strength: 68,\n    sequenceRequired: true,\n    patternIndexes: [9],\n  },\n`;
  if (s.includes(familyAnchor)) s = s.replace(familyAnchor, familyInsert + familyAnchor);
}

if (!s.includes('bareNumericChapterIndices')) {
  const patternAnchor = "  /^#{1,3}\\s+\\S.{0,80}$/,";
  const patternReplacement = "  /^#{1,3}\\s+\\S.{0,80}$/\n  , /^(?:[0-9０-９]{1,5})(?:[\\s　]*[、,.，.:：_-])?$/,";
  if (!s.includes(patternAnchor)) throw new Error('numeric chapter patch: pattern marker not found');
  s = s.replace(patternAnchor, patternReplacement);

  const helperAnchor = `function sequenceNumber(line, familyId) {`;
  const helper = `function normalizeBareNumeric(line) {\n  const clean = normalizeFullWidthDigits(cleanChapterLine(line));\n  const match = clean.match(/^(\\d{1,5})(?:[\\s　]*[、,.，.:：_-])?$/);\n  if (!match) return null;\n  const raw = match[1];\n  const value = Number(raw);\n  // Unpadded 4/5 digit numbers are usually years or IDs, not chapter numbers.\n  if (value >= 1000 && !/^0/.test(raw)) return null;\n  return value;\n}\n\nfunction bareNumericChapterIndices(paragraphs) {\n  const candidates = paragraphs.map((paragraph, idx) => ({\n    idx,\n    number: normalizeBareNumeric(paragraph),\n  })).filter(item => Number.isFinite(item.number));\n  const accepted = new Set();\n  for (let i = 0; i < candidates.length; i += 1) {\n    const run = [candidates[i]];\n    for (let j = i + 1; j < candidates.length; j += 1) {\n      const last = run[run.length - 1];\n      if (candidates[j].number === last.number + 1) {\n        run.push(candidates[j]);\n        if (run.length >= 3) {\n          for (const item of run) accepted.add(item.idx);\n        }\n      } else if (candidates[j].number <= last.number) {\n        break;\n      }\n    }\n  }\n  return accepted;\n}\n\n`;
  if (!s.includes(helperAnchor)) throw new Error('numeric chapter patch: sequenceNumber marker not found');
  s = s.replace(helperAnchor, helper + helperAnchor);

  const sequenceAnchor = `  } else if (familyId === 'arabic_numbered') {\n    match = clean.match(/^(\\d+)\\s*[:：,.，、_—-]/);\n  }`;
  const sequenceReplacement = `  } else if (familyId === 'arabic_numbered') {\n    match = clean.match(/^(\\d+)\\s*[:：,.，、_—-]/);\n  } else if (familyId === 'bare_numeric') {\n    match = clean.match(/^(\\d{1,5})(?:[\\s　]*[、,.，.:：_-])?$/);\n  }`;
  if (!s.includes("familyId === 'bare_numeric'")) {
    if (!s.includes(sequenceAnchor)) throw new Error('numeric chapter patch: arabic sequence marker not found');
    s = s.replace(sequenceAnchor, sequenceReplacement);
  }

  const candidateAnchor = `export function chapterRuleCandidates(paragraphs, options = {}) {\n  const families = [...CHAPTER_RULE_FAMILIES, ...customFamilies(options.custom_rules || [])];`;
  const candidateReplacement = `export function chapterRuleCandidates(paragraphs, options = {}) {\n  const families = [...CHAPTER_RULE_FAMILIES, ...customFamilies(options.custom_rules || [])];\n  const bareNumericIndices = bareNumericChapterIndices(paragraphs);`;
  if (!s.includes('const bareNumericIndices = bareNumericChapterIndices(paragraphs);')) {
    if (!s.includes(candidateAnchor)) throw new Error('numeric chapter patch: candidates marker not found');
    s = s.replace(candidateAnchor, candidateReplacement);
  }

  const matchAnchor = `      if (familyMatches(family, paragraph)) {\n        matches.push({ idx, title: cleanChapterLine(paragraph).replace(/^#+\\s*/, '') });\n      }`;
  const matchReplacement = `      const matched = family.id === 'bare_numeric'\n        ? bareNumericIndices.has(idx)\n        : familyMatches(family, paragraph);\n      if (matched) {\n        matches.push({ idx, title: cleanChapterLine(paragraph).replace(/^#+\\s*/, '') });\n      }`;
  if (!s.includes("family.id === 'bare_numeric'")) {
    if (!s.includes(matchAnchor)) throw new Error('numeric chapter patch: family match marker not found');
    s = s.replace(matchAnchor, matchReplacement);
  }

  const splitAnchor = `export function splitText(text, mode = 'auto') {\n  const lines = String(text || '').replace(/\\r\\n?/g, '\\n').split('\\n');\n  const titleCount = lines.filter(line => isChapterTitle(line)).length;`;
  const splitReplacement = `export function splitText(text, mode = 'auto') {\n  const lines = String(text || '').replace(/\\r\\n?/g, '\\n').split('\\n');\n  const numericChapterIndices = bareNumericChapterIndices(lines.map(line => line.trim()));\n  const titleCount = lines.filter(line => isChapterTitle(line)).length + numericChapterIndices.size;`;
  if (!s.includes('const numericChapterIndices = bareNumericChapterIndices(lines.map(line => line.trim()));')) {
    if (!s.includes(splitAnchor)) throw new Error('numeric chapter patch: splitText marker not found');
    s = s.replace(splitAnchor, splitReplacement);
  }

  const loopAnchor = `  for (const line of lines) {\n    const clean = line.trim();\n    const chapter = isChapterTitle(clean);`;
  const loopReplacement = `  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {\n    const line = lines[lineIndex];\n    const clean = line.trim();\n    const chapter = isChapterTitle(clean) || numericChapterIndices.has(lineIndex);`;
  if (!s.includes('for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1)')) {
    if (!s.includes(loopAnchor)) throw new Error('numeric chapter patch: split loop marker not found');
    s = s.replace(loopAnchor, loopReplacement);
  }

  const strongAnchor = `  const strong = candidates.filter(candidate =>\n    ['cn_chapter', 'english_chapter', 'bracketed_chapter', 'markdown'].includes(candidate.id)\n    && candidate.match_count >= 2\n  );`;
  const strongReplacement = `  const strong = candidates.filter(candidate =>\n    (['cn_chapter', 'english_chapter', 'bracketed_chapter', 'markdown'].includes(candidate.id)\n      && candidate.match_count >= 2)\n    || (candidate.id === 'bare_numeric' && candidate.match_count >= 3 && candidate.continuity >= 0.67)\n  );`;
  if (!s.includes("candidate.id === 'bare_numeric' && candidate.match_count >= 3")) {
    if (!s.includes(strongAnchor)) throw new Error('numeric chapter patch: strong candidate marker not found');
    s = s.replace(strongAnchor, strongReplacement);
  }
}

fs.writeFileSync(p, s);
console.log('enabled robust sequential numeric chapter splitting');
