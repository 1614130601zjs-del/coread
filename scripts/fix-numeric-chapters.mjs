import fs from 'fs';

const p = 'lib/text.mjs';
let s = fs.readFileSync(p, 'utf8');

// Bare numeric chapter headings are only accepted as chapters when they form
// a real sequential run (01/02/03, 001/002/003, etc.). This avoids treating
// ordinary numeric paragraphs, dates, prices, and IDs as chapter titles.
if (!s.includes("id: 'bare_numeric'")) {
  const familyAnchor = "  {\n    id: 'arabic_numbered',";
  const familyInsert = `  {\n    id: 'bare_numeric',\n    label: '纯数字章节（01 / 02 / 03）',\n    strength: 68,\n    sequenceRequired: true,\n    patternIndexes: [9],\n  },\n`;
  if (s.includes(familyAnchor)) s = s.replace(familyAnchor, familyInsert + familyAnchor);
}

if (!s.includes('bareNumericChapterIndices')) {
  const patternAnchor = "  /^#{1,3}\\s+\\S.{0,80}$/\n];";
  const patternReplacement = "  /^#{1,3}\\s+\\S.{0,80}$/\n  , /^(?:[0-9０-９]{1,5})(?:[\\s　]*[、,.，.:：_-])?$/\n];";
  if (s.includes(patternAnchor)) s = s.replace(patternAnchor, patternReplacement);

  const normalizeAnchor = `function sequenceNumber(line, familyId) {`;
  const helper = `function normalizeBareNumeric(line) {\n  const clean = normalizeFullWidthDigits(cleanChapterLine(line));\n  const match = clean.match(/^(\\d{1,5})(?:[\\s　]*[、,.，.:：_-])?$/);\n  return match ? Number(match[1]) : null;\n}\n\nfunction bareNumericChapterIndices(paragraphs) {\n  const candidates = paragraphs.map((paragraph, idx) => ({\n    idx,\n    number: normalizeBareNumeric(paragraph),\n  })).filter(item => Number.isFinite(item.number));\n  const accepted = new Set();\n  for (let i = 0; i < candidates.length;) {\n    let j = i + 1;\n    while (j < candidates.length && candidates[j].number === candidates[j - 1].number + 1) j += 1;\n    if (j - i >= 3) {\n      for (let k = i; k < j; k += 1) accepted.add(candidates[k].idx);\n    }\n    i = j;\n  }\n  return accepted;\n}\n\n`;
  if (s.includes(normalizeAnchor)) s = s.replace(normalizeAnchor, helper + normalizeAnchor);

  // Make family matching context-aware for the bare numeric family.
  const matchAnchor = `export function chapterRuleCandidates(paragraphs, options = {}) {\n  const families = [...CHAPTER_RULE_FAMILIES, ...customFamilies(options.custom_rules || [])];`;
  const matchReplacement = `export function chapterRuleCandidates(paragraphs, options = {}) {\n  const families = [...CHAPTER_RULE_FAMILIES, ...customFamilies(options.custom_rules || [])];\n  const bareNumericIndices = bareNumericChapterIndices(paragraphs);`;
  if (s.includes(matchAnchor)) s = s.replace(matchAnchor, matchReplacement);

  const paragraphAnchor = `      if (familyMatches(family, paragraph)) {\n        matches.push({ idx, title: cleanChapterLine(paragraph).replace(/^#+\\s*/, '') });\n      }`;
  const paragraphReplacement = `      const matched = family.id === 'bare_numeric'\n        ? bareNumericIndices.has(idx)\n        : familyMatches(family, paragraph);\n      if (matched) {\n        matches.push({ idx, title: cleanChapterLine(paragraph).replace(/^#+\\s*/, '') });\n      }`;
  if (s.includes(paragraphAnchor)) s = s.replace(paragraphAnchor, paragraphReplacement);

  // Keep bare numeric out of generic isChapterTitle(); splitText handles it
  // using sequential context so ordinary numbers remain ordinary paragraphs.
  const splitAnchor = `export function splitText(text, mode = 'auto') {\n  const lines = String(text || '').replace(/\\r\\n?/g, '\\n').split('\\n');\n  const titleCount = lines.filter(line => isChapterTitle(line)).length;`;
  const splitReplacement = `export function splitText(text, mode = 'auto') {\n  const lines = String(text || '').replace(/\\r\\n?/g, '\\n').split('\\n');\n  const numericChapterIndices = bareNumericChapterIndices(lines.map(line => line.trim()));\n  const titleCount = lines.filter(line => isChapterTitle(line)).length + numericChapterIndices.size;`;
  if (s.includes(splitAnchor)) s = s.replace(splitAnchor, splitReplacement);

  const loopAnchor = `  for (const line of lines) {\n    const clean = line.trim();\n    const chapter = isChapterTitle(clean);`;
  const loopReplacement = `  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {\n    const line = lines[lineIndex];\n    const clean = line.trim();\n    const chapter = isChapterTitle(clean) || numericChapterIndices.has(lineIndex);`;
  if (s.includes(loopAnchor)) s = s.replace(loopAnchor, loopReplacement);
}

fs.writeFileSync(p, s);
console.log('enabled sequential numeric chapter splitting');
