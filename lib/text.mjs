const NUMBER_CHARS = '0-9０-９〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬';
const NUMBER_TOKEN = `[${NUMBER_CHARS}]+`;
const CHAPTER_UNIT = '(?:章|节(?!课)|卷|集(?![合和])|部(?![分赛游门])|篇(?!张)|回(?![合来事去])|话|幕|册)';
const SPECIAL_HEADING = '(?:扉页|序章|序言|引子|楔子|前言|(?:内容|文章|书籍)?简介|文案|卷首语|正文(?!完|结)|终章|后记|尾声|番外(?:.{0,8}篇)?|后日谈|作品相关|新书|上架|封推|三江|请假|分[章卷段节回]阅读|最?[上中下序终末][章卷篇]|完[本结])';
const HEADING_SUFFIX = '[ \t　:：、,.，;；_—\-~～]*.{0,50}';
const SPECIAL_HEADING_SUFFIX = '(?:[ \t　:：、,.，;；_—\-~～].{0,50})?';
const PARAGRAPH_END = /(?:[。！？!?；;…]|\.{3,})[”’」』）】》〉〕〗]*$/;
const PARAGRAPH_START = /^[“‘「『（【《〈]/;
const SEPARATOR_LINE = /^(?:[-—_=~～·•＊*]\s*){3,}$/;

const LEGACY_CHAPTER_PATTERNS = [
  new RegExp(`^${SPECIAL_HEADING}${SPECIAL_HEADING_SUFFIX}$`, 'i'),
  new RegExp(`^第?\s*${NUMBER_TOKEN}\s*${CHAPTER_UNIT}${HEADING_SUFFIX}$`, 'i'),
  new RegExp(`^(?:卷|章)\s*${NUMBER_TOKEN}${HEADING_SUFFIX}$`, 'i'),
  /^(?:chapter|chap\.|section|part|volume|book|episode|no\.|ＰＡＲＴ)\s*[0-9０-９ivx]+(?:[ \t:：、._-].{0,50})?$/i,
  new RegExp(`^[【〔〖「『〈［\[]\s*(?:第\s*${NUMBER_TOKEN}\s*${CHAPTER_UNIT}|(?:chapter|part)\s*[0-9０-９ivx]+)${HEADING_SUFFIX}$`, 'i'),
  /^[☆★✦✧◎☪●○◆◇■□]\s*[、:：._-].{1,50}$/,
  /^[ \t　]{0,4}[0-9０-９]{1,5}\s*[:：,.，、_—\-]\s*.{1,50}$/,
  new RegExp(`^[ \t　]{0,4}[${NUMBER_CHARS}]{1,8}章?\s*[、_—\-]\s*.{1,50}$`, 'i'),
  /^#{1,3}\s+\S.{0,80}$/,
];

const CHAPTER_RULE_FAMILIES = [
  { id: 'cn_chapter', label: '第N章 / 回 / 卷', strength: 100, patternIndexes: [0, 1, 2] },
  { id: 'english_chapter', label: 'Chapter / Part', strength: 90, patternIndexes: [3] },
  { id: 'bracketed_chapter', label: '括号章节标题', strength: 85, patternIndexes: [4] },
  { id: 'decorative', label: '装饰符号标题', strength: 55, patternIndexes: [5] },
  { id: 'arabic_numbered', label: '1. / 2、数字标题', strength: 25, listLike: true, patternIndexes: [6] },
  { id: 'chinese_numbered', label: '一、/ 二、中文序号', strength: 25, listLike: true, patternIndexes: [7] },
  { id: 'markdown', label: 'Markdown 标题', strength: 80, patternIndexes: [8] },
].map(family => ({ ...family, patterns: family.patternIndexes.map(index => LEGACY_CHAPTER_PATTERNS[index]) }));

const CHAPTER_PATTERNS = CHAPTER_RULE_FAMILIES.flatMap(family => family.patterns);
const TIME_OR_DATE_LINE = /^(?:[0-9０-９]{1,4}\s*[-/.：:]\s*){1,2}[0-9０-９]{1,4}(?:\s*(?:分|秒|时|点|日|月|年))?[。.]?$/;
const MAX_CUSTOM_RULE_LENGTH = 120;

function isValidUtf8(buffer) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return true; }
  catch { return false; }
}

function decodeWith(buffer, encoding) {
  try { return new TextDecoder(encoding, { fatal: false }).decode(buffer); }
  catch { return new TextDecoder('utf-8').decode(buffer); }
}

function scoreDecodedText(text) {
  const replacement = (text.match(/\ufffd/g) || []).length;
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const controls = (text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) || []).length;
  return cjk * 4 - replacement * 12 - controls * 3;
}

function detectUtf16WithoutBom(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.length < 8) return null;
  let evenZeros = 0, oddZeros = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] !== 0) continue;
    if (i % 2 === 0) evenZeros += 1; else oddZeros += 1;
  }
  const threshold = Math.max(3, Math.floor(sample.length * 0.12));
  if (oddZeros >= threshold && oddZeros > evenZeros * 2) return 'utf-16le';
  if (evenZeros >= threshold && evenZeros > oddZeros * 2) return 'utf-16be';
  return null;
}

export function detectEncoding(buffer, requested = 'auto') {
  if (requested && requested !== 'auto') return requested;
  const head = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8';
  const utf16 = detectUtf16WithoutBom(buffer);
  if (utf16) return utf16;
  if (isValidUtf8(buffer)) return 'utf-8';
  const candidates = ['gb18030', 'big5', 'shift_jis', 'windows-1252'];
  let best = candidates[0], bestScore = -1;
  for (const encoding of candidates) {
    const text = decodeWith(head, encoding);
    const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const replacement = (text.match(/\ufffd/g) || []).length;
    const score = cjk * 4 - replacement * 10;
    if (score > bestScore) { bestScore = score; best = encoding; }
  }
  return best;
}

export function encodingCandidates(buffer) {
  const names = ['utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'gbk', 'big5'];
  return names.map(encoding => {
    const text = decodeWith(buffer, encoding);
    return { encoding, score: scoreDecodedText(text), preview: text.replace(/^\ufeff/, '').replace(/\s+/g, ' ').trim().slice(0, 120) };
  }).sort((a, b) => b.score - a.score);
}

export function decodeTextBuffer(buffer, requested = 'auto') {
  const encoding = detectEncoding(buffer, requested);
  let text = decodeWith(buffer, encoding).replace(/^\ufeff/, '');
  text = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  return { text, encoding };
}

function cleanChapterLine(line) {
  return String(line || '').trim().replace(/\s+/g, ' ');
}

function familyMatches(family, line) {
  const clean = cleanChapterLine(line);
  if (!clean || clean.length > 100 || TIME_OR_DATE_LINE.test(clean)) return false;
  return family.patterns.some(re => re.test(clean));
}

function averageGap(indices) {
  if (indices.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < indices.length; i++) total += indices[i] - indices[i - 1];
  return total / (indices.length - 1);
}

function normalizeFullWidthDigits(value) {
  return value.replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xfee0));
}

function sequenceNumber(line, familyId) {
  const clean = normalizeFullWidthDigits(cleanChapterLine(line));
  let match = null;
  if (familyId === 'cn_chapter' || familyId === 'bracketed_chapter') {
    match = clean.match(/(?:第\s*)?(\d+)\s*(?:章|节|卷|集|部|篇|回|话|幕|册)/i);
  } else if (familyId === 'english_chapter') {
    match = clean.match(/(?:chapter|chap\.|section|part|volume|book|episode|no\.)\s*(\d+)/i);
  } else if (familyId === 'arabic_numbered') {
    match = clean.match(/^(\d+)\s*[:：,.，、_—-]/);
  }
  return match ? Number(match[1]) : null;
}

function sequenceContinuity(matches, familyId) {
  const numbers = matches.map(match => sequenceNumber(match.title, familyId)).filter(Number.isFinite);
  if (numbers.length < 2) return 0;
  let consecutive = 0;
  for (let i = 1; i < numbers.length; i++) { if (numbers[i] === numbers[i - 1] + 1) consecutive += 1; }
  return consecutive / (numbers.length - 1);
}

function validateCustomChapterRule(pattern) {
  const source = String(pattern || '').trim();
  if (!source || source.length > MAX_CUSTOM_RULE_LENGTH) throw new Error(`custom chapter rule must be 1-${MAX_CUSTOM_RULE_LENGTH} characters`);
  if (/\\[1-9]/.test(source) || /\(\?<|\\[pP]\{/.test(source)) throw new Error('custom chapter rule uses an unsupported advanced expression');
  if (/(?:\.\*|\.\+).*(?:\.\*|\.\+)/.test(source)) throw new Error('custom chapter rule is too broad');
  try { return new RegExp(source, 'iu'); } catch { throw new Error('invalid custom chapter rule'); }
}

function customFamilies(customRules = []) {
  return customRules.slice(0, 8).map((rule, index) => ({
    id: `custom:${String(rule?.id || index).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || index}`,
    label: String(rule?.label || `本书规则 ${index + 1}`).trim().slice(0, 40),
    strength: 70, custom: true, pattern: String(rule?.pattern || '').trim(),
    patterns: [validateCustomChapterRule(rule?.pattern)],
  }));
}

function rangesFromMatches(paragraphs, matches) {
  if (!matches.length) return [{ chapter_no: 1, title: '正文', start_idx: 0, end_idx: Math.max(0, paragraphs.length - 1) }];
  const starts = [...new Map(matches.map(match => [match.idx, match])).values()].sort((a, b) => a.idx - b.idx);
  const ranges = [];
  if (starts[0].idx > 0) ranges.push({ chapter_no: 1, title: '书前内容', start_idx: 0, end_idx: starts[0].idx - 1 });
  for (let i = 0; i < starts.length; i++) {
    const match = starts[i], next = starts[i + 1];
    ranges.push({ chapter_no: ranges.length + 1, title: match.title.slice(0, 120), start_idx: match.idx, end_idx: next ? next.idx - 1 : Math.max(match.idx, paragraphs.length - 1) });
  }
  return ranges;
}

export function chapterRuleCandidates(paragraphs, options = {}) {
  const families = [...CHAPTER_RULE_FAMILIES, ...customFamilies(options.custom_rules || [])];
  const candidates = families.map(family => {
    const matches = [];
    paragraphs.forEach((paragraph, idx) => { if (familyMatches(family, paragraph)) matches.push({ idx, title: cleanChapterLine(paragraph).replace(/^#+\s*/, '') }); });
    const gap = averageGap(matches.map(match => match.idx));
    const continuity = sequenceContinuity(matches, family.id);
    const density = paragraphs.length ? matches.length / paragraphs.length : 0;
    let score = family.strength + Math.min(matches.length, 30) * 2 + continuity * 24 + Math.min(gap, 20);
    if (family.listLike && (gap < 3 || density > 0.12)) score -= 55;
    if (matches.length < 2) score -= 45;
    return { id: family.id, label: family.label, custom: Boolean(family.custom), pattern: family.custom ? family.pattern : undefined, match_count: matches.length, average_gap: Number(gap.toFixed(1)), continuity: Number(continuity.toFixed(2)), score: Number(score.toFixed(1)), matches, preview: matches.slice(0, 5) };
  }).filter(candidate => candidate.match_count > 0);
  return candidates.sort((a, b) => b.score - a.score || b.match_count - a.match_count);
}

export function detectChapterStructure(paragraphs, options = {}) {
  const candidates = chapterRuleCandidates(paragraphs, options);
  const strong = candidates.filter(candidate => ['cn_chapter', 'english_chapter', 'bracketed_chapter', 'markdown'].includes(candidate.id) && candidate.match_count >= 2);
  const recommended = strong[0] || candidates.find(candidate => candidate.match_count >= 2 && candidate.score >= 20) || candidates[0] || null;
  const familyIds = options.family_ids?.length ? [...new Set(options.family_ids.map(String))] : recommended ? [recommended.id] : [];
  const selected = candidates.filter(candidate => familyIds.includes(candidate.id));
  return { candidates, recommended_family_ids: recommended ? [recommended.id] : [], selection: { mode: familyIds.length > 1 ? 'combined' : 'single', family_ids: familyIds, custom_rules: options.custom_rules || [] }, ranges: rangesFromMatches(paragraphs, selected.flatMap(candidate => candidate.matches)) };
}

export function isChapterTitle(line) {
  const clean = cleanChapterLine(line);
  if (!clean || clean.length > 100) return false;
  if (TIME_OR_DATE_LINE.test(clean)) return false;
  return CHAPTER_PATTERNS.some(re => re.test(clean));
}

function joinWrappedLine(left, right) {
  const separator = /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right) ? ' ' : '';
  return `${left}${separator}${right}`;
}

export function splitText(text, mode = 'auto') {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const titleCount = lines.filter(line => isChapterTitle(line)).length;
  const likelyChapters = titleCount >= 2 || (titleCount >= 1 && lines.length > 80);
  const paragraphs = []; let buffer = '';
  const flush = () => { const value = buffer.trim(); if (value.length > 1) paragraphs.push(value); buffer = ''; };
  for (const line of lines) {
    const clean = line.trim();
    const chapter = isChapterTitle(clean);
    if ((mode === 'chapter' || mode === 'auto') && likelyChapters && chapter) { flush(); paragraphs.push(clean.replace(/^#+\s*/, '')); continue; }
    if (!clean) { flush(); continue; }
    const hasSourceIndent = /^[ \t　]+/.test(line);
    const startsNewParagraph = buffer && (hasSourceIndent || PARAGRAPH_END.test(buffer) || PARAGRAPH_START.test(clean) || SEPARATOR_LINE.test(buffer) || SEPARATOR_LINE.test(clean));
    if (startsNewParagraph) flush();
    buffer = buffer ? joinWrappedLine(buffer, clean) : clean;
  }
  flush();
  if (paragraphs.length > 0) return paragraphs;
  return String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 1);
}

export function chapterRanges(paragraphs, options = {}) {
  return detectChapterStructure(paragraphs, options).ranges;
}
