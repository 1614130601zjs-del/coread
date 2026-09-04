import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chapterRuleCandidates,
  chapterRanges,
  detectEncoding,
  isChapterTitle,
  splitText,
} from '../lib/text.mjs';

test('detects UTF-8 when a multibyte character crosses the old 4096-byte sample boundary', () => {
  const buffer = Buffer.from(`${'a'.repeat(4094)}中`, 'utf8');
  assert.equal(detectEncoding(buffer), 'utf-8');
});

test('keeps explicit encoding overrides', () => {
  const buffer = Buffer.from('plain text', 'utf8');
  assert.equal(detectEncoding(buffer, 'gb18030'), 'gb18030');
});

test('recognizes supported chapter heading forms', () => {
  const headings = [
    '第一章 初见',
    '第 12 回',
    'Chapter 3: Arrival',
    '卷二',
    '序章',
    '# 终章',
    '1、这个就是标题',
    '一、只有前面的数字有差别',
    '【第一章 后面的符号可以没有',
    '☆、特殊符号标题',
  ];

  for (const heading of headings) {
    assert.equal(isChapterTitle(heading), true, heading);
  }

  assert.equal(isChapterTitle('正文一'), false);
  assert.equal(isChapterTitle('这是一句普通正文'), false);
});

test('splits chapter headings only when the text has a chapter pattern', () => {
  const paragraphs = splitText([
    '第一章 初见',
    '',
    '正文一',
    '',
    '第二章 重逢',
    '',
    '正文二',
  ].join('\n'), 'auto');

  assert.deepEqual(paragraphs, ['第一章 初见', '正文一', '第二章 重逢', '正文二']);
  assert.deepEqual(chapterRanges(paragraphs), [
    { chapter_no: 1, title: '第一章 初见', start_idx: 0, end_idx: 1 },
    { chapter_no: 2, title: '第二章 重逢', start_idx: 2, end_idx: 3 },
  ]);
});

test('treats single-line novel paragraphs as separate paragraphs', () => {
  const paragraphs = splitText([
    '在确认规则后，几个玩家开始熟悉自己的工作环境。',
    '洛倾顺手从货架上拿了一包糖。',
    '晏可一脸受教地点点头，脑子里念不住胡思乱想。',
    '',
    '“还有三分钟就开始了。”光头提醒一声。',
    '同事们如此认真，洛倾只好也跟着严肃起来。',
  ].join('\n'), 'auto');

  assert.deepEqual(paragraphs, [
    '在确认规则后，几个玩家开始熟悉自己的工作环境。',
    '洛倾顺手从货架上拿了一包糖。',
    '晏可一脸受教地点点头，脑子里念不住胡思乱想。',
    '“还有三分钟就开始了。”光头提醒一声。',
    '同事们如此认真，洛倾只好也跟着严肃起来。',
  ]);
});

test('joins fixed-width hard wraps back into one paragraph', () => {
  const paragraphs = splitText([
    '这是一段很长但没有在固定列宽处',
    '结束的正文，因此换行不应该被当作',
    '新的自然段。',
    '下一段才应该拥有自己的首行缩进。',
  ].join('\n'), 'auto');

  assert.deepEqual(paragraphs, [
    '这是一段很长但没有在固定列宽处结束的正文，因此换行不应该被当作新的自然段。',
    '下一段才应该拥有自己的首行缩进。',
  ]);
});

test('uses source indentation as an explicit paragraph boundary', () => {
  const paragraphs = splitText([
    '上一段没有句号',
    '　　但这一行带有原始段首缩进',
    '下一行接在同一段后面。',
  ].join('\n'), 'auto');

  assert.deepEqual(paragraphs, [
    '上一段没有句号',
    '但这一行带有原始段首缩进下一行接在同一段后面。',
  ]);
});

test('prefers continuous chapter headings over numbered rule lists', () => {
  const paragraphs = [
    '第一章 开始',
    '正文内容。',
    '1. 第一条规则',
    '2. 第二条规则',
    '3. 第三条规则',
    '第二章 继续',
    '后续内容。',
  ];

  assert.deepEqual(chapterRanges(paragraphs), [
    { chapter_no: 1, title: '第一章 开始', start_idx: 0, end_idx: 4 },
    { chapter_no: 2, title: '第二章 继续', start_idx: 5, end_idx: 6 },
  ]);
});

test('supports numbered chapters when no stronger family is present', () => {
  const paragraphs = [
    '1. 第一节',
    '正文一。',
    '2. 第二节',
    '正文二。',
    '3. 第三节',
  ];

  assert.deepEqual(chapterRanges(paragraphs), [
    { chapter_no: 1, title: '1. 第一节', start_idx: 0, end_idx: 1 },
    { chapter_no: 2, title: '2. 第二节', start_idx: 2, end_idx: 3 },
    { chapter_no: 3, title: '3. 第三节', start_idx: 4, end_idx: 4 },
  ]);
});

test('does not treat time or date lines as chapter headings', () => {
  assert.equal(isChapterTitle('20：57分。'), false);
  assert.equal(isChapterTitle('2026-08-10'), false);
  assert.equal(isChapterTitle('20:57'), false);
});

test('exposes candidate families and validates book-specific rules', () => {
  const candidates = chapterRuleCandidates([
    '第一章 开始',
    '正文。',
    '第二章 继续',
  ]);
  assert.equal(candidates.some(candidate => candidate.id === 'cn_chapter' && candidate.match_count === 2), true);

  assert.throws(
    () => chapterRanges(['标题', '正文'], { custom_rules: [{ pattern: '.*.*' }] }),
    /too broad|invalid/i,
  );
});
