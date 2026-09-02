
import React, { useState, useEffect, useCallback, useRef, startTransition, useLayoutEffect, useMemo } from 'react';
import { api, API_BASE, cloudProgressPage } from './api';
import { LucideIcon } from './LucideIcon';
import { sortCommentTimeline } from './commentTimeline';

function themeColors(h: number, s: number, l: number) {
    const primary = `hsl(${h}, ${s}%, ${l}%)`;
    const primaryLight = `hsl(${h}, ${s}%, 92%)`;
    const primaryBg = `hsl(${h}, ${Math.max(s - 5, 0)}%, 96%)`;
    const primaryBorder = `hsla(${h}, ${s}%, ${l}%, 0.18)`;
    const primaryDark = `hsl(${h}, ${s}%, ${Math.max(l - 18, 20)}%)`;
    const warmAccent = `hsl(${(h + 30) % 360}, ${Math.min(s + 10, 80)}%, 72%)`;
    const warmBg = `hsl(${(h + 30) % 360}, ${Math.min(s + 10, 80)}%, 94%)`;
    const grad1 = `hsl(${h}, ${Math.max(s - 5, 0)}%, 94%)`;
    const grad2 = `hsl(${(h + 20) % 360}, ${Math.max(s - 8, 0)}%, 92%)`;
    const grad3 = `hsl(${(h + 40) % 360}, ${Math.max(s - 12, 0)}%, 95%)`;
    const shenColor = `hsl(${h}, ${Math.min(s + 5, 60)}%, ${Math.max(l - 5, 35)}%)`;
    const shenBg = `hsl(${h}, ${Math.min(s + 5, 60)}%, 93%)`;
    const tongColor = `hsl(${(h + 150) % 360}, 45%, 55%)`;
    const tongBg = `hsl(${(h + 150) % 360}, 35%, 93%)`;
    const shenHL = `hsla(${h}, ${Math.min(s + 10, 55)}%, 82%, 0.5)`;
    const tongHL = `hsla(340, 50%, 82%, 0.5)`;
    return { primary, primaryLight, primaryBg, primaryBorder, primaryDark, warmAccent, warmBg, grad1, grad2, grad3, shenColor, shenBg, tongColor, tongBg, shenHL, tongHL };
}

interface Book {
    id: number;
    title: string;
    total_paragraphs: number;
    created_at: string;
    current_page: number | null;
    comment_count: number;
    category?: string;
    tags?: string[];
    note?: string;
    source_format?: string;
    source_encoding?: string;
    last_read_at?: string | null;
    cover_image?: string | null;
    deleted_at?: string | null;
}
interface Paragraph { idx: number; content: string; }
interface ParagraphCacheManifest {
    cacheFormat: 'chunked-v3';
    complete: true;
    totalParas: number;
    sourceTotalParas: number;
    chunkSize: number;
    chunkCount: number;
    paragraphIndices: number[];
    cacheVersion: number | null;
}
interface ParagraphCacheChunk {
    cacheFormat: 'chunk-v3';
    chunkIndex: number;
    start: number;
    paragraphs: Paragraph[];
}
interface Comment { id: number; book_id: number; paragraph_idx: number; sel_end_para_idx: number | null; sel_start_idx: number | null; sel_end_idx: number | null; selected_text: string | null; from_who: string; content: string; created_at: string; reply_to: number | null; thread_key?: string | null; source_label?: string; is_favorite?: number; annotation_kind?: 'comment' | 'wavy_underline'; event_id?: number | null; }
interface FavoriteComment extends Comment {
    book_title: string;
    chapter_no?: number | null;
    chapter_title?: string | null;
}
interface ChapterChatMessage { id: number; chapter_no: number; from_who: string; content: string; source_label?: string; created_at: string; }
interface PageBreak { paraIndex: number; offset: number; }
interface PageFragment extends Paragraph { sourceIdx: number; startOffset: number; endOffset: number; isPartialStart: boolean; isPartialEnd: boolean; }
interface ReplyNotice {
    id: number;
    paragraph_idx: number;
    content: string;
    from_who?: string;
    created_at?: string;
    reply_to?: number | null;
    parent_id?: number | null;
    parent_from?: string;
    parent_content?: string;
    sel_start_idx?: number | null;
    sel_end_idx?: number | null;
    selected_text?: string | null;
    parent_paragraph_idx?: number | null;
    parent_sel_start_idx?: number | null;
    parent_sel_end_idx?: number | null;
    parent_selected_text?: string | null;
}
interface BackupSummary {
    id: string;
    kind: 'manual' | 'automatic' | 'pre_restore';
    status: string;
    created_at: string;
    shanghai_date?: string;
    bytes?: number;
    statistics?: { books?: number; paragraphs?: number; comments?: number };
}
interface TocChapter {
    chapter_no?: number;
    title: string;
    start_idx?: number;
    end_idx?: number;
    paragraph_count?: number;
    idx: number;
    page: number;
}
interface ChapterRuleCandidate {
    id: string;
    label: string;
    custom?: boolean;
    pattern?: string;
    match_count: number;
    average_gap: number;
    continuity?: number;
    score?: number;
    preview?: { idx: number; title: string }[];
}
interface ChapterRuleSelection {
    mode: 'single' | 'combined';
    family_ids: string[];
    custom_rules: { id: string; label: string; pattern: string }[];
}
interface ChapterRulePreview {
    ranges: TocChapter[];
    selection: ChapterRuleSelection;
}

const BOOK_COVERS = [
    '#111111',
    '#f3f3ef',
    '#2b2b2b',
    '#ffffff',
    '#5d5d5d',
    '#d8d8d2',
];

const STUDY_THEME_CSS = `
.xiaowo-study {
    color: #41394f;
}
.xiaowo-study *,
.xiaowo-study *::before,
.xiaowo-study *::after {
    animation: none !important;
    transition: none !important;
}
.xiaowo-study.eink-theme,
.xiaowo-study.eink-theme *,
.xiaowo-study.eink-theme *::before,
.xiaowo-study.eink-theme *::after {
    animation: none !important;
    transition: none !important;
    box-shadow: none !important;
    filter: none !important;
    backdrop-filter: none !important;
    background-image: none !important;
}
.xiaowo-study .coread-reader-body {
    font-family: "Songti SC", "SimSun", serif;
}
.xiaowo-study .coread-reader-note {
    font-family: "KaiTi", cursive;
}
.xiaowo-study .coread-shelf-header {
    flex-shrink: 0;
    padding: calc(44px + env(safe-area-inset-top)) 18px 12px;
    border-bottom: 3px solid #111;
    background: #fff;
    color: #111;
}
.xiaowo-study .coread-shelf-header-main {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px 12px;
    align-items: center;
}
.xiaowo-study .coread-shelf-masthead {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 2px 12px 3px;
    background: #111;
    color: #fff;
    font-size: 28px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: 0;
    border-bottom: 5px solid #777;
}
.xiaowo-study .coread-shelf-tagline {
    grid-column: 1 / -1;
    font-size: 11px;
    font-weight: 700;
    color: #444;
}
.xiaowo-study .coread-shelf-actions,
.xiaowo-study .coread-shelf-manage-actions {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    min-width: 0;
}
.xiaowo-study .coread-shelf-manage-actions {
    border: 2px solid #111;
    padding: 4px;
    background: #f2f2ef;
}
.xiaowo-study .coread-selection-count {
    padding: 0 6px;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
}
.xiaowo-study .coread-icon-button {
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #111;
    border-radius: 2px;
    background: #fff;
    color: #111;
    padding: 0;
    cursor: pointer;
}
.xiaowo-study .coread-icon-button.is-primary {
    background: #111;
    color: #fff;
}
.xiaowo-study .coread-icon-button.is-danger {
    background: #fff;
    color: #8f2525;
    border-width: 2px;
}
.xiaowo-study .coread-text-button {
    min-height: 34px;
    padding: 0 10px;
    border: 1px solid #111;
    border-radius: 2px;
    background: #fff;
    color: #111;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
    white-space: nowrap;
}
.xiaowo-study .coread-shelf-grid {
    display: grid;
    grid-template-columns: repeat(var(--shelf-columns, 2), minmax(0, 1fr));
    column-gap: 14px;
    row-gap: 22px;
    padding: 16px 12px 8px;
    border-top: 4px solid #111;
    border-left: 2px solid #111;
    border-right: 2px solid #111;
    background: #fff;
}
.xiaowo-study .coread-shelf-grid[data-columns="auto"] {
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
}
.xiaowo-study .coread-shelf-card {
    position: relative;
    padding-bottom: 12px;
    min-width: 0;
}
.xiaowo-study .coread-shelf-card::after {
    content: "";
    position: absolute;
    left: -10px;
    right: -10px;
    bottom: 0;
    height: 4px;
    background: #111;
    pointer-events: none;
}
.xiaowo-study .coread-shelf-cover {
    width: 100%;
    aspect-ratio: 2 / 3;
    overflow: hidden;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #111;
    border-left-width: 8px;
    box-sizing: border-box;
    background: #fff;
}
.xiaowo-study .coread-shelf-card.is-selected .coread-shelf-cover {
    outline: 4px solid #111;
    outline-offset: 2px;
}
.xiaowo-study .coread-shelf-select-mark {
    position: absolute;
    top: 7px;
    left: 10px;
    z-index: 3;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #111;
    background: #fff;
    color: #111;
}
.xiaowo-study .coread-shelf-select-mark.is-selected {
    background: #111;
    color: #fff;
}
.xiaowo-study .coread-shelf-book-title {
    min-height: 2.7em;
    padding: 8px 2px 0;
    overflow: hidden;
    color: #111;
    font-size: 11px;
    font-weight: 800;
    line-height: 1.35;
    word-break: break-all;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
.xiaowo-study .coread-bookmark-button {
    position: absolute;
    top: 0;
    right: 8px;
    z-index: 4;
    width: 30px;
    height: 38px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 7px;
    border: 2px solid #111;
    background: #fff;
    color: #111;
    cursor: pointer;
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 82%, 0 100%);
}
.xiaowo-study .coread-spine-delete {
    position: absolute;
    left: 0;
    bottom: 38px;
    z-index: 4;
    width: 22px;
    min-height: 42px;
    padding: 4px 2px;
    border: 1px solid #111;
    background: #fff;
    color: #555;
    font-size: 9px;
    font-weight: 800;
    line-height: 1.1;
    cursor: pointer;
    writing-mode: vertical-rl;
}
.xiaowo-study .coread-shelf-tools {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    margin-bottom: 16px;
}
.xiaowo-study .coread-shelf-search {
    width: 100%;
    max-width: 320px;
    min-width: 0;
    box-sizing: border-box;
    padding: 9px 11px;
    border: 1px solid #111;
    border-radius: 2px;
    background: #fff;
    color: #111;
    outline: none;
    font-size: 12px;
}
.xiaowo-study .coread-shelf-desktop-filters {
    display: none;
}
.xiaowo-study .coread-shelf-filter-panel {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 10px;
    border: 2px solid #111;
    background: #fff;
}
.xiaowo-study .coread-shelf-select {
    min-width: 0;
    padding: 8px 7px;
    border: 1px solid #111;
    border-radius: 2px;
    background: #fff;
    color: #111;
    font-size: 11px;
}
.xiaowo-study .coread-layout-anchor {
    position: relative;
}
.xiaowo-study .coread-layout-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    width: 252px;
    padding: 10px;
    border: 2px solid #111;
    background: #fff;
    color: #111;
}
.xiaowo-study .coread-layout-options {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 4px;
    padding-top: 9px;
}
.xiaowo-study .coread-layout-option {
    min-width: 0;
    height: 32px;
    padding: 0;
    border: 1px solid #111;
    border-radius: 2px;
    background: #fff;
    color: #111;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
}
.xiaowo-study .coread-layout-option.is-selected {
    background: #111;
    color: #fff;
}
.xiaowo-study .coread-tool-button {
    min-width: 0;
    min-height: 48px;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    padding: 6px 9px;
    border: 1px solid var(--tool-border);
    border-left: 4px solid var(--tool-accent);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
}
.xiaowo-study .coread-tool-button:focus-visible,
.xiaowo-study .coread-icon-button:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
}
.xiaowo-study .coread-tool-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid currentColor;
    color: var(--tool-accent);
    background: var(--tool-icon-bg);
}
@media (min-width: 760px) {
    .xiaowo-study .coread-shelf-grid[data-columns="auto"] {
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    }
    .xiaowo-study .coread-shelf-tools {
        grid-template-columns: minmax(210px, 320px) minmax(230px, 1fr) auto;
    }
    .xiaowo-study .coread-shelf-desktop-filters {
        display: flex;
        gap: 8px;
    }
    .xiaowo-study .coread-shelf-mobile-filter {
        display: none !important;
    }
    .xiaowo-study .coread-shelf-filter-panel {
        display: none;
    }
    .xiaowo-study .coread-shelf-header {
        padding-left: 24px;
        padding-right: 24px;
    }
    .xiaowo-study .coread-shelf-header-main {
        grid-template-columns: auto minmax(0, 1fr) auto;
    }
    .xiaowo-study .coread-shelf-actions,
    .xiaowo-study .coread-shelf-manage-actions {
        grid-column: 3;
    }
    .xiaowo-study .coread-shelf-tagline {
        grid-column: 2;
        grid-row: 1;
    }
}
@media (min-width: 1180px) {
    .xiaowo-study .coread-shelf-grid[data-columns="auto"] {
        grid-template-columns: repeat(auto-fill, minmax(156px, 184px));
        justify-content: start;
    }
}
@keyframes coread-reader-page-slide-forward {
    from { transform: translate3d(8%, 0, 0); opacity: 0.88; }
    to { transform: translate3d(0, 0, 0); opacity: 1; }
}
@keyframes coread-reader-page-slide-backward {
    from { transform: translate3d(-8%, 0, 0); opacity: 0.88; }
    to { transform: translate3d(0, 0, 0); opacity: 1; }
}
@keyframes coread-reader-page-fade {
    from { opacity: 0.45; }
    to { opacity: 1; }
}
.xiaowo-study .coread-reader-page-transition.is-slide-forward {
    animation: coread-reader-page-slide-forward var(--coread-page-turn-duration) cubic-bezier(0.22, 0.72, 0.2, 1) both !important;
}
.xiaowo-study .coread-reader-page-transition.is-slide-backward {
    animation: coread-reader-page-slide-backward var(--coread-page-turn-duration) cubic-bezier(0.22, 0.72, 0.2, 1) both !important;
}
.xiaowo-study .coread-reader-page-transition.is-fade {
    animation: coread-reader-page-fade var(--coread-page-turn-duration) ease-out both !important;
}
.xiaowo-study .coread-reader-page-transition {
    will-change: transform, opacity;
}
/* Page Curl: 真实纸张卷曲翻页 */
.xiaowo-study .coread-reader-page-curl-live {
    position: absolute; inset: 0; width: 100%; height: 100%;
    z-index: 4; pointer-events: none; overflow: hidden;
    box-sizing: border-box; background: var(--reader-surface, #faf8f5);
    opacity: 1; display: block; transform: translate3d(0,0,0);
    transform-style: preserve-3d; backface-visibility: hidden;
    will-change: clip-path, transform, filter; contain: paint;
}
.xiaowo-study .coread-reader-page-curl-live .coread-reader-body {
    background: var(--reader-surface, #faf8f5) !important;
}
.xiaowo-study .coread-page-curl-backface {
    position: absolute; inset: 0; width: 100%; height: 100%;
    pointer-events: none;
    background: linear-gradient(90deg, rgba(0,0,0,0.06) 0%, rgba(255,255,255,0.35) 50%, rgba(0,0,0,0.04) 100%);
    mix-blend-mode: multiply; opacity: 0; transition: opacity 0.15s ease; z-index: 5;
}
.xiaowo-study .coread-reader-page-curl-live[data-curl-active="true"] .coread-page-curl-backface {
    opacity: 1;
}
.xiaowo-study .coread-page-crease {
    position: absolute; top: 0; bottom: 0; width: 3px;
    pointer-events: none; z-index: 6; opacity: 0;
    background: linear-gradient(180deg, transparent, rgba(0,0,0,0.18) 40%, rgba(0,0,0,0.28) 50%, rgba(0,0,0,0.18) 60%, transparent);
    box-shadow: 0 0 20px rgba(0,0,0,0.12); transform: translateZ(6px);
    transition: opacity 0.1s ease;
}
.xiaowo-study .coread-reader-page-curl-live[data-curl-active="true"] .coread-page-crease {
    opacity: 1;
}
`;

// Menus are transient overlays, so collapsed controls do not reserve reader height.
const READER_VERTICAL_PADDING_STATIC = 0;
function getSafeAreaBottom(): number {
    if (typeof document === 'undefined') return 0;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;bottom:0;left:0;width:0;padding-bottom:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    const h = probe.offsetHeight;
    document.body.removeChild(probe);
    return h;
}
function decodeEntities(s: string): string {
    return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
const CHAPTER_GAP_TOP = 40;
const CHAPTER_GAP_BOTTOM = 28;
const PAGEBREAK_CACHE_PREFIX = 'pagebreaks-v3-';
const READER_LAYOUT_DEFAULTS_VERSION = '3';
type ReaderTheme = 'eink' | 'warm' | 'paper' | 'kraft' | 'green' | 'navy' | 'dark' | 'custom';
type ReaderPageTurnEffect = 'curl' | 'slide' | 'fade' | 'none';
const DEFAULT_READER_PAGE_TURN_EFFECT: ReaderPageTurnEffect = 'curl';
const DEFAULT_READER_PAGE_TURN_DURATION = 650;
const READER_PAGE_TURN_EFFECT_OPTIONS: { value: ReaderPageTurnEffect; label: string; description: string }[] = [
    { value: 'curl', label: '真实翻页', description: 'Page Curl 纸张卷曲翻页，像真实实体书' },
    { value: 'slide', label: '滑动', description: '页面平滑滑入' },
    { value: 'fade', label: '淡入', description: '轻柔淡入，不产生位移' },
    { value: 'none', label: '无动画', description: '立即切换页面' },
];
const loadReaderPageTurnEffect = (): ReaderPageTurnEffect => {
    const saved = localStorage.getItem('coread-reader-page-turn-effect');
    return saved === 'curl' || saved === 'slide' || saved === 'fade' || saved === 'none' ? saved : DEFAULT_READER_PAGE_TURN_EFFECT;
};
const loadReaderPageTurnDuration = (): number => {
    const saved = Number(localStorage.getItem('coread-reader-page-turn-duration'));
    return Number.isFinite(saved) ? clampNumber(saved, 280, 1400) : DEFAULT_READER_PAGE_TURN_DURATION;
};
type ReaderTexture = 'none' | 'paper' | 'kraft';
type ShelfColumns = 'auto' | 2 | 3 | 4 | 5 | 6;
type LocalReadingProgress = { bookId: number; paragraphIdx: number; updatedAt: number; pending: boolean; };
type StoryMaterialTab = 'chapters' | 'blocks' | 'impressions' | 'facts' | 'comment_summaries';
type StoryMaterialsState = {
    summaries: any[];
    facts: any[];
    factHistory: any[];
    readingContexts: any[];
    commentSummaries: any[];
};
type StoryMaterialGenerator = {
    kind: 'block' | 'reading_impression';
    start: number;
    end: number;
    busy: boolean;
    missingChapters: number[];
} | null;
type ReaderLayout = {
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    paragraphGap: number;
    textIndent: number;
    sidePadding: number;
    maxWidth: number;
    topInset: number;
    bottomInset: number;
    noteFontSize: number;
    noteLineHeight: number;
    noteLetterSpacing: number;
};
type GlobalReaderFont = {
    source: 'system' | 'upload' | 'url' | 'css';
    name: string;
    family: string;
    format?: string;
    url?: string;
    version: number;
};
const DEFAULT_GLOBAL_READER_FONT: GlobalReaderFont = {
    source: 'system',
    name: '系统宋体',
    family: '"Songti SC", "SimSun", serif',
    version: 0,
};
const GLOBAL_READER_FONT_META_KEY = 'coread-global-reader-font';
const GLOBAL_READER_FONT_DATA_KEY = 'coread-global-reader-font-data';
const GLOBAL_READER_FONT_CSS_LINK_ID = 'coread-global-reader-font-css';
const DEFAULT_READER_LAYOUT: ReaderLayout = {
    fontSize: 17,
    lineHeight: 1.85,
    letterSpacing: 0.3,
    paragraphGap: 18,
    textIndent: 1.5,
    sidePadding: 28,
    maxWidth: 760,
    topInset: 96,
    bottomInset: 0,
    noteFontSize: 15,
    noteLineHeight: 1.7,
    noteLetterSpacing: 0,
};
const READER_THEME_OPTIONS: Record<ReaderTheme, {
    label: string;
    surface: string;
    panel: string;
    text: string;
    muted: string;
    border: string;
    highlight: string;
    hue: number;
    saturation: number;
    lightness: number;
    texture: ReaderTexture;
}> = {
    eink: { label: 'eink 墨水屏', surface: '#ffffff', panel: '#ffffff', text: '#000000', muted: '#000000', border: '#000000', highlight: '#ffffff', hue: 0, saturation: 0, lightness: 0, texture: 'none' },
    warm: { label: 'warm 暖色', surface: '#f7f0e4', panel: '#fffaf1', text: '#3d3329', muted: '#8c7259', border: '#dfc9ae', highlight: 'rgba(210,131,70,0.18)', hue: 28, saturation: 56, lightness: 48, texture: 'none' },
    paper: { label: '米色纸纹', surface: '#f5ecd8', panel: '#fff9ed', text: '#3e3428', muted: '#8b7257', border: '#d9c5a7', highlight: 'rgba(166,120,67,0.16)', hue: 34, saturation: 48, lightness: 44, texture: 'paper' },
    kraft: { label: '牛皮纸纹', surface: '#d9bd8e', panel: '#ead4aa', text: '#332619', muted: '#755936', border: '#ac8654', highlight: 'rgba(82,54,23,0.15)', hue: 30, saturation: 42, lightness: 40, texture: 'kraft' },
    green: { label: '护眼绿', surface: '#e7f0df', panel: '#f4faef', text: '#304333', muted: '#69806a', border: '#b6cbb5', highlight: 'rgba(94,132,91,0.16)', hue: 138, saturation: 32, lightness: 42, texture: 'none' },
    navy: { label: '深蓝夜读', surface: '#162131', panel: '#1d2b3d', text: '#e7edf6', muted: '#a6b7ca', border: '#40546b', highlight: 'rgba(148,183,221,0.18)', hue: 206, saturation: 46, lightness: 60, texture: 'none' },
    dark: { label: '黑底白字', surface: '#000000', panel: '#111111', text: '#ffffff', muted: '#c8c8c8', border: '#5f5f5f', highlight: 'rgba(255,255,255,0.16)', hue: 0, saturation: 0, lightness: 76, texture: 'none' },
    custom: { label: '自由配色', surface: '#f7f0e4', panel: '#fffaf1', text: '#3d3329', muted: '#8c7259', border: '#dfc9ae', highlight: 'rgba(210,131,70,0.18)', hue: 28, saturation: 56, lightness: 48, texture: 'paper' },
};
const DEFAULT_CUSTOM_APPEARANCE = { background: '#f7f0e4', text: '#3d3329', texture: 'paper' as ReaderTexture };
const DEFAULT_SHELF_COLUMNS: ShelfColumns = 'auto';
const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isReaderTheme = (value: string | null): value is ReaderTheme =>
    Boolean(value && Object.prototype.hasOwnProperty.call(READER_THEME_OPTIONS, value));
const loadCustomAppearance = () => {
    try {
        const value = JSON.parse(localStorage.getItem('coread-reader-custom-appearance') || '{}');
        return {
            background: /^#[0-9a-f]{6}$/i.test(value.background) ? value.background : DEFAULT_CUSTOM_APPEARANCE.background,
            text: /^#[0-9a-f]{6}$/i.test(value.text) ? value.text : DEFAULT_CUSTOM_APPEARANCE.text,
            texture: ['none', 'paper', 'kraft'].includes(value.texture) ? value.texture as ReaderTexture : DEFAULT_CUSTOM_APPEARANCE.texture,
        };
    } catch { return { ...DEFAULT_CUSTOM_APPEARANCE }; }
};
const loadShelfColumns = (): ShelfColumns => {
    try {
        const value = JSON.parse(localStorage.getItem('coread-shelf-columns') || '{}');
        if (['auto', 2, 3, 4, 5, 6].includes(value)) return value as ShelfColumns;
        if (value && typeof value === 'object') {
            const width = typeof window === 'undefined' ? 1180 : window.innerWidth;
            const legacyValue = width < 760 ? value.mobile : width < 1180 ? value.tablet : value.desktop;
            if (['auto', 2, 3, 4, 5, 6].includes(legacyValue)) return legacyValue as ShelfColumns;
        }
        return DEFAULT_SHELF_COLUMNS;
    } catch { return DEFAULT_SHELF_COLUMNS; }
};
const readingProgressStorageKey = (bookId: number) => `coread-reading-progress-v1-${bookId}`;
const bookLastOpenedStorageKey = (bookId: number) => `coread-book-last-opened-v1-${bookId}`;
const loadBookLastOpenedAt = (bookId: number) => {
    try {
        const value = Number(localStorage.getItem(bookLastOpenedStorageKey(bookId)) || 0);
        return Number.isFinite(value) && value > 0 ? value : 0;
    } catch { return 0; }
};
const rememberBookLastOpened = (bookId: number) => {
    const openedAt = Date.now();
    try { localStorage.setItem(bookLastOpenedStorageKey(bookId), String(openedAt)); } catch {}
    return openedAt;
};
const clearBookLastOpened = (bookId: number) => {
    try { localStorage.removeItem(bookLastOpenedStorageKey(bookId)); } catch {}
};
const bookLastReadTime = (book: Book) => Math.max(
    loadBookLastOpenedAt(book.id),
    book.last_read_at ? new Date(book.last_read_at).getTime() || 0 : 0,
);
const loadLocalReadingProgress = (bookId: number): LocalReadingProgress | null => {
    try {
        const value = JSON.parse(localStorage.getItem(readingProgressStorageKey(bookId)) || 'null');
        if (Number(value?.bookId) !== bookId || !Number.isFinite(Number(value?.paragraphIdx))) return null;
        return {
            bookId,
            paragraphIdx: Number(value.paragraphIdx),
            updatedAt: Number(value.updatedAt) || 0,
            pending: Boolean(value.pending),
        };
    } catch { return null; }
};
const loadReaderLayout = (): ReaderLayout => {
    try {
        const saved = JSON.parse(localStorage.getItem('coread-reader-layout') || '{}');
        const layout = { ...DEFAULT_READER_LAYOUT, ...saved };
        const defaultsVersion = localStorage.getItem('coread-reader-layout-defaults-version');
        if (
            defaultsVersion !== READER_LAYOUT_DEFAULTS_VERSION
            && (
                (saved.topInset === 36 && saved.bottomInset === 20)
                || (saved.topInset === 64 && saved.bottomInset === 20)
            )
        ) {
            layout.topInset = DEFAULT_READER_LAYOUT.topInset;
            layout.bottomInset = DEFAULT_READER_LAYOUT.bottomInset;
        }
        localStorage.setItem('coread-reader-layout', JSON.stringify(layout));
        localStorage.setItem('coread-reader-layout-defaults-version', READER_LAYOUT_DEFAULTS_VERSION);
        return layout;
    } catch { return { ...DEFAULT_READER_LAYOUT }; }
};

function WakeGlyph({ busy = false, size = 16 }: { busy?: boolean; size?: number }) {
    return (
        <span aria-hidden style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
        }}>
            <span style={busy ? {
                width: size * 0.42, height: size * 0.42, background: 'currentColor', borderRadius: 2,
            } : {
                width: 0, height: 0, borderTop: `${size * 0.28}px solid transparent`,
                borderBottom: `${size * 0.28}px solid transparent`, borderLeft: `${size * 0.42}px solid currentColor`,
                marginLeft: size * 0.08,
            }} />
        </span>
    );
}

function BoundedNumberInput({
    value,
    min,
    max,
    step = 1,
    onCommit,
    borderColor,
    background,
    color,
    fontSize = 12,
}: {
    value: number;
    min: number;
    max: number;
    step?: number;
    onCommit: (value: number) => void;
    borderColor: string;
    background: string;
    color: string;
    fontSize?: number;
}) {
    const [draft, setDraft] = useState(String(value));

    useEffect(() => {
        setDraft(String(value));
    }, [value]);

    const clamp = (next: number) => Math.max(min, Math.min(max, next));
    const commit = (raw = draft) => {
        const parsed = Number(raw);
        const next = Number.isFinite(parsed) && raw.trim() !== '' ? clamp(Math.round(parsed)) : value;
        setDraft(String(next));
        if (next !== value) onCommit(next);
    };
    const bump = (direction: -1 | 1) => {
        const parsed = Number(draft);
        const base = Number.isFinite(parsed) && draft.trim() !== '' ? parsed : value;
        const next = clamp(Math.round(base + direction * step));
        setDraft(String(next));
        if (next !== value) onCommit(next);
    };

    const buttonStyle: React.CSSProperties = {
        flex: '0 0 32px',
        minHeight: 34,
        border: `1px solid ${borderColor}`,
        background,
        color,
        cursor: 'pointer',
        fontSize: 17,
        lineHeight: 1,
    };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr) 32px', marginTop: 5 }}>
            <button type="button" onClick={() => bump(-1)} disabled={value <= min} title="减少" aria-label="减少"
                style={{ ...buttonStyle, borderRadius: '7px 0 0 7px', opacity: value <= min ? 0.4 : 1 }}>-</button>
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={draft}
                onChange={event => {
                    const next = event.target.value;
                    if (next === '' || /^\d+$/.test(next)) setDraft(next);
                }}
                onBlur={() => commit()}
                onKeyDown={event => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') {
                        setDraft(String(value));
                        event.currentTarget.blur();
                    }
                }}
                style={{
                    minWidth: 0,
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 6px',
                    border: `1px solid ${borderColor}`,
                    borderLeft: 'none',
                    borderRight: 'none',
                    borderRadius: 0,
                    background,
                    color,
                    fontSize,
                    textAlign: 'center',
                    outline: 'none',
                }} />
            <button type="button" onClick={() => bump(1)} disabled={value >= max} title="增加" aria-label="增加"
                style={{ ...buttonStyle, borderRadius: '0 7px 7px 0', opacity: value >= max ? 0.4 : 1 }}>+</button>
        </div>
    );
}

// 大书不做窗口化，采用全局连续视觉分页。
// 超阈值的书首开走渐进分页：分块测量（块间让出主线程不卡UI）+ 完成后写分页缓存，之后秒开。
const PROGRESSIVE_MEASURE_THRESHOLD = 15000;
const PARA_FETCH_CHUNK = 10000;
const PARAGRAPH_CACHE_CHUNK_SIZE = 512;
const MEASURE_CHUNK = 240;
const PAGINATION_CHECKPOINT_STRIDE = MEASURE_CHUNK * 4;
// 目录行高（窗口化渲染用，固定行高才能按滚动位置直接换算可视窗口）
const TOC_ROW_H = 44;
// 缓存 miss 时先分当前位置附近的一小段立即可读、先落本机缓存，再让全书分页后台补全。
// 这里刻意比测量块小：首开不能为了“局部页表”又等半本书。
const PROVISIONAL_WIN = 480;

// 分页/段落缓存主存 IndexedDB：大书分页结果几百KB起，localStorage(5-10MB)写不下
// 或被清理→每次重开都重分页。localStorage 只作 IDB 不可用时的后手兜底。
const idbOpen = (): Promise<IDBDatabase | null> => new Promise((resolve) => {
    try {
        const req = indexedDB.open('study-reader-cache', 2);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('pagebreaks')) db.createObjectStore('pagebreaks');
            if (!db.objectStoreNames.contains('paragraphs')) db.createObjectStore('paragraphs');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    } catch { resolve(null); }
});
const idbGet = (key: string): Promise<string | null> =>
    idbOpen().then(db => new Promise<string | null>((resolve) => {
        if (!db) return resolve(null);
        try {
            const req = db.transaction('pagebreaks', 'readonly').objectStore('pagebreaks').get(key);
            req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
            req.onerror = () => resolve(null);
        } catch { resolve(null); }
    }));
const idbSet = (key: string, value: string): Promise<boolean> =>
    idbOpen().then(db => new Promise<boolean>((resolve) => {
        if (!db) return resolve(false);
        try {
            const tx = db.transaction('pagebreaks', 'readwrite');
            tx.objectStore('pagebreaks').put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
            tx.onabort = () => resolve(false);
        } catch { resolve(false); }
    }));
const idbDel = (key: string): Promise<void> =>
    idbOpen().then(db => new Promise<void>((resolve) => {
        if (!db) return resolve();
        try {
            const tx = db.transaction('pagebreaks', 'readwrite');
            tx.objectStore('pagebreaks').delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch { resolve(); }
    }));
const saveGlobalReaderFontMeta = (font: GlobalReaderFont) => {
    try { localStorage.setItem(GLOBAL_READER_FONT_META_KEY, JSON.stringify(font)); } catch {}
};
const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('字体文件读取失败'));
    reader.onerror = () => reject(reader.error || new Error('字体文件读取失败'));
    reader.readAsDataURL(file);
});
const removeGlobalReaderFontCssLink = () => {
    try { document.getElementById(GLOBAL_READER_FONT_CSS_LINK_ID)?.remove(); } catch {}
};
const waitForStylesheet = (link: HTMLLinkElement): Promise<boolean> => new Promise(resolve => {
    let settled = false;
    const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
    };
    link.onload = () => finish(true);
    link.onerror = () => finish(false);
    window.setTimeout(() => finish(true), 12000);
});
const loadGlobalReaderCssFont = async (font: GlobalReaderFont): Promise<boolean> => {
    if (typeof window === 'undefined' || !document.fonts || !font.url || !font.family) return false;
    try {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = font.url;
        link.setAttribute('data-coread-global-font', '1');
        document.head.appendChild(link);
        const loaded = await waitForStylesheet(link);
        if (!loaded) { link.remove(); return false; }
        const family = font.family.includes(',') ? font.family.split(',')[0].trim() : font.family.trim();
        await document.fonts.load(`${Math.max(12, readerFontProbeSize)}px ${family}`, '汉字天地玄黄ABCDEFGHIJKLMNOPQRSTUVWXYZ');
        await document.fonts.ready;
        const previous = document.getElementById(GLOBAL_READER_FONT_CSS_LINK_ID);
        if (previous && previous !== link) previous.remove();
        link.id = GLOBAL_READER_FONT_CSS_LINK_ID;
        return true;
    } catch {
        return false;
    }
};
const readerFontProbeSize = 17;
const loadGlobalReaderFontFace = async (font: GlobalReaderFont, sourceOverride?: string): Promise<boolean> => {
    if (typeof window === 'undefined' || !document.fonts) return font.source === 'system';
    if (font.source === 'system') {
        removeGlobalReaderFontCssLink();
        return true;
    }
    if (font.source === 'css') return loadGlobalReaderCssFont(font);
    if (!('FontFace' in window)) return false;
    removeGlobalReaderFontCssLink();
    const source = sourceOverride || (font.source === 'url' ? font.url : await idbGet(GLOBAL_READER_FONT_DATA_KEY));
    if (!source) return false;
    try {
        const face = new FontFace(font.family, `url("${source}")`);
        await face.load();
        document.fonts.add(face);
        await document.fonts.ready;
        return true;
    } catch {
        return false;
    }
};
const extractFontFamilyFromCss = (css: string): string | null => {
    const matches = [...css.matchAll(/@font-face\s*\{[\s\S]*?font-family\s*:\s*["']?([^;"'}]+)["']?\s*;/gi)];
    for (const match of matches) {
        const family = match[1]?.trim();
        if (family) return family;
    }
    return null;
};
const inferFontFamilyFromCssUrl = (url: string): string | null => {
    if (/HuiwenMinchoGBK/i.test(url)) return 'Huiwen-MinchoGBK';
    return null;
};
const resolveCssFontFamily = async (url: string): Promise<string | null> => {
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (response.ok) {
            const css = await response.text();
            const family = extractFontFamilyFromCss(css);
            if (family) return family;
        }
    } catch {}
    return inferFontFamilyFromCssUrl(url);
};
const idbDelPrefix = (prefix: string): Promise<void> =>
    idbOpen().then(db => new Promise<void>((resolve) => {
        if (!db) return resolve();
        try {
            const tx = db.transaction('pagebreaks', 'readwrite');
            const store = tx.objectStore('pagebreaks');
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
                const current = cursor.result;
                if (!current) return;
                if (String(current.key).startsWith(prefix)) current.delete();
                current.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        } catch { resolve(); }
    }));
const idbGetParas = (key: string): Promise<unknown | null> =>
    idbOpen().then(db => new Promise<unknown | null>((resolve) => {
        if (!db) return resolve(null);
        try {
            const req = db.transaction('paragraphs', 'readonly').objectStore('paragraphs').get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        } catch { resolve(null); }
    }));
const idbSetParas = (key: string, value: unknown): Promise<boolean> =>
    idbOpen().then(db => new Promise<boolean>((resolve) => {
        if (!db) return resolve(false);
        try {
            const tx = db.transaction('paragraphs', 'readwrite');
            tx.objectStore('paragraphs').put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
            tx.onabort = () => resolve(false);
        } catch { resolve(false); }
    }));
const idbDelParas = (key: string): Promise<void> =>
    idbOpen().then(db => new Promise<void>((resolve) => {
        if (!db) return resolve();
        try {
            const tx = db.transaction('paragraphs', 'readwrite');
            tx.objectStore('paragraphs').delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch { resolve(); }
    }));
const idbDelParasPrefix = (prefix: string): Promise<void> =>
    idbOpen().then(db => new Promise<void>((resolve) => {
        if (!db) return resolve();
        try {
            const tx = db.transaction('paragraphs', 'readwrite');
            const store = tx.objectStore('paragraphs');
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
                const current = cursor.result;
                if (!current) return;
                if (String(current.key).startsWith(prefix)) current.delete();
                current.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        } catch { resolve(); }
    }));

const paragraphManifestCacheKey = (bookId: number) => `paras-v3-${bookId}-manifest`;
const paragraphChunkCacheKey = (bookId: number, chunkIndex: number) => `paras-v3-${bookId}-chunk-${chunkIndex}`;
const tocCacheKey = (bookId: number) => `toc-v1-${bookId}`;
const isParagraphCacheManifest = (value: any): value is ParagraphCacheManifest =>
    value?.cacheFormat === 'chunked-v3'
    && value?.complete === true
    && Number.isInteger(value?.totalParas)
    && value.totalParas > 0
    && Number.isInteger(value?.chunkSize)
    && value.chunkSize > 0
    && Number.isInteger(value?.chunkCount)
    && value.chunkCount === Math.ceil(value.totalParas / value.chunkSize)
    && Array.isArray(value?.paragraphIndices)
    && value.paragraphIndices.length === value.totalParas;
const parseParagraphChunk = (
    value: unknown,
    expectedChunkIndex: number,
    manifest: ParagraphCacheManifest,
): Paragraph[] | null => {
    const parsed = value as Partial<ParagraphCacheChunk> | null;
    if (parsed?.cacheFormat !== 'chunk-v3'
        || parsed.chunkIndex !== expectedChunkIndex
        || parsed.start !== expectedChunkIndex * manifest.chunkSize
        || !Array.isArray(parsed.paragraphs)) return null;
    const expectedLength = Math.min(
        manifest.chunkSize,
        manifest.totalParas - expectedChunkIndex * manifest.chunkSize,
    );
    return parsed.paragraphs.length === expectedLength ? parsed.paragraphs : null;
};
const writeChunkedParagraphCache = async (
    bookId: number,
    paragraphs: Paragraph[],
    sourceTotalParas: number,
    cacheVersion: number | null,
): Promise<ParagraphCacheManifest | null> => {
    if (!paragraphs.length) return null;
    const chunkCount = Math.ceil(paragraphs.length / PARAGRAPH_CACHE_CHUNK_SIZE);
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        const start = chunkIndex * PARAGRAPH_CACHE_CHUNK_SIZE;
        const payload: ParagraphCacheChunk = {
            cacheFormat: 'chunk-v3',
            chunkIndex,
            start,
            paragraphs: paragraphs.slice(start, start + PARAGRAPH_CACHE_CHUNK_SIZE),
        };
        if (!(await idbSetParas(paragraphChunkCacheKey(bookId, chunkIndex), payload))) return null;
    }
    const manifest: ParagraphCacheManifest = {
        cacheFormat: 'chunked-v3',
        complete: true,
        totalParas: paragraphs.length,
        sourceTotalParas: Math.max(paragraphs.length, Number(sourceTotalParas) || 0),
        chunkSize: PARAGRAPH_CACHE_CHUNK_SIZE,
        chunkCount,
        paragraphIndices: paragraphs.map(paragraph => Number(paragraph.idx)),
        cacheVersion: Number.isFinite(Number(cacheVersion)) ? Number(cacheVersion) : null,
    };
    return await idbSetParas(paragraphManifestCacheKey(bookId), manifest) ? manifest : null;
};

function toast(msg: string) {
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, { position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', background: '#111', color: '#fff', padding: '8px 20px', borderRadius: '4px', fontSize: '13px', zIndex: '9999', pointerEvents: 'none' });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

const StudyApp: React.FC = () => {
    const [mode, setMode] = useState<'shelf' | 'reading'>('shelf');
    const [authenticated, setAuthenticated] = useState<boolean | null>(null);
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [activeBook, setActiveBook] = useState<Book | null>(null);
    const [bookCacheVersion, setBookCacheVersion] = useState<number | null>(null);
    const [commentCacheVersion, setCommentCacheVersion] = useState<number | null>(null);
    const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
    const [comments, setComments] = useState<Comment[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [pageBreaks, setPageBreaks] = useState<PageBreak[]>([{ paraIndex: 0, offset: 0 }]);
    // 大书完整分页进度（0~1）。首开 loading 和进入正文后的后台补全共用它。
    const [paginateProgress, setPaginateProgress] = useState<number | null>(null);
    const [pageFragments, setPageFragments] = useState<PageFragment[]>([]);
    const [readingLoading, setReadingLoading] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const [allParas, setAllParas] = useState<Paragraph[]>([]);
    const [paragraphCacheManifest, setParagraphCacheManifest] = useState<ParagraphCacheManifest | null>(null);
    const [paragraphsFullyLoaded, setParagraphsFullyLoaded] = useState(true);
    const [paragraphChunkRevision, setParagraphChunkRevision] = useState(0);
    const paragraphChunksRef = useRef<Map<number, Paragraph[]>>(new Map());
    const paragraphCacheBookRef = useRef<number | null>(null);
    const paragraphHydrationPromiseRef = useRef<Promise<Paragraph[] | null> | null>(null);
    const paragraphWindowTokenRef = useRef(0);
    const [allComments, setAllComments] = useState<Comment[]>([]);
    const [pageHeight, setPageHeight] = useState(0);
    const [readerSize, setReaderSize] = useState({ width: 0, height: 0 });
    const savedParaIdxRef = useRef<number | null>(null);
    const currentParaIdxRef = useRef<number | null>(null);
    const readingProgressRef = useRef<LocalReadingProgress | null>(null);
    const lastSyncedProgressRef = useRef<{ bookId: number; paragraphIdx: number } | null>(null);
    const [readingProgressSyncing, setReadingProgressSyncing] = useState(false);
    // 后手优化：临时页表覆盖的段落区间（非null=全书分页仍在后台补全，窗外跳转先拦住）
    const provisionalRangeRef = useRef<{ from: number; to: number } | null>(null);

    const [commentingIdx, setCommentingIdx] = useState<number | null>(null);
    const [commentText, setCommentText] = useState('');
    const [selectedText, setSelectedText] = useState('');
    const [selRange, setSelRange] = useState<{ startPara: number; endPara: number; start: number; end: number } | null>(null);
    const [newCommentThreadKey, setNewCommentThreadKey] = useState<string | null>(null);
    const [activeComments, setActiveComments] = useState<Comment[]>([]);
    const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
    const [newReplies, setNewReplies] = useState<ReplyNotice[]>([]);
    const [showReplies, setShowReplies] = useState(false);
    const [returnPoint, setReturnPoint] = useState<{ page: number; paraIdx: number | null } | null>(null);
    const [floatingBar, setFloatingBar] = useState<{
        startPara: number; endPara: number; text: string; start: number; end: number;
        left: number; top: number; placement: 'above' | 'below';
    } | null>(null);
    const [reviewMode, setReviewMode] = useState<'fine' | 'layered'>('fine');
    const [readingTask, setReadingTask] = useState<any | null>(null);
    const [showBatchReading, setShowBatchReading] = useState(false);
    const [batchTaskType, setBatchTaskType] = useState<'main' | 'helper'>('main');
    const [batchStartChapter, setBatchStartChapter] = useState(1);
    const [batchEndChapter, setBatchEndChapter] = useState(1);
    const [batchConcurrency, setBatchConcurrency] = useState(1);
    const [batchBudgetTokens, setBatchBudgetTokens] = useState(500000);
    const [batchPreview, setBatchPreview] = useState<any | null>(null);
    const [batchPreviewKey, setBatchPreviewKey] = useState('');
    const [batchPreviewing, setBatchPreviewing] = useState(false);
    const [batchBudgetConfirmed, setBatchBudgetConfirmed] = useState(false);
    const [batchTask, setBatchTask] = useState<any | null>(null);
    const [recentBatchTasks, setRecentBatchTasks] = useState<any[]>([]);
    const [batchTaskActionBusy, setBatchTaskActionBusy] = useState(false);
    const batchPollTimerRef = useRef<number | null>(null);
    const [showChapterChat, setShowChapterChat] = useState(false);
    const [chapterChat, setChapterChat] = useState<ChapterChatMessage[]>([]);
    const [chapterChatText, setChapterChatText] = useState('');
    const [chapterChatBusy, setChapterChatBusy] = useState(false);
    const [commentReplyBusy, setCommentReplyBusy] = useState(false);
    const [showStoryMaterials, setShowStoryMaterials] = useState(false);
    const [storyMaterials, setStoryMaterials] = useState<StoryMaterialsState>({
        summaries: [],
        facts: [],
        factHistory: [],
        readingContexts: [],
        commentSummaries: [],
    });
    const [storyMaterialsLoading, setStoryMaterialsLoading] = useState(false);
    const [storyMaterialTab, setStoryMaterialTab] = useState<StoryMaterialTab>('chapters');
    const [storyMaterialGenerator, setStoryMaterialGenerator] = useState<StoryMaterialGenerator>(null);
    const [readingImpressions, setReadingImpressions] = useState<any[]>([]);
    const [readingImpressionText, setReadingImpressionText] = useState('');
    const [readingImpressionSaving, setReadingImpressionSaving] = useState(false);
    const [editingStoryMaterial, setEditingStoryMaterial] = useState<any | null>(null);
    const [storyMaterialSaving, setStoryMaterialSaving] = useState(false);
    const [bookPreludeText, setBookPreludeText] = useState('');
    const [chapterPreludeText, setChapterPreludeText] = useState('');
    const [readingContextSaving, setReadingContextSaving] = useState<'book' | 'chapter' | null>(null);
    const [editingCommentSummary, setEditingCommentSummary] = useState<{ chapterNo: number; content: string } | null>(null);
    const [commentSummarySaving, setCommentSummarySaving] = useState(false);
    const [factEditor, setFactEditor] = useState<{
        lineageId: number;
        factType: string;
        keyName: string;
        value: string;
        importance: number;
        reason: string;
    } | null>(null);
    const [factSaving, setFactSaving] = useState(false);
    const [expandedFactLineages, setExpandedFactLineages] = useState<number[]>([]);
    const [showToc, setShowToc] = useState(false);
    const [tocChapters, setTocChapters] = useState<TocChapter[]>([]);
    const [tocQuery, setTocQuery] = useState('');
    const [showRechapter, setShowRechapter] = useState(false);
    const [chapterRuleCandidates, setChapterRuleCandidates] = useState<ChapterRuleCandidate[]>([]);
    const [selectedChapterFamilies, setSelectedChapterFamilies] = useState<string[]>([]);
    const [chapterRulePreview, setChapterRulePreview] = useState<ChapterRulePreview | null>(null);
    const [chapterRuleBusy, setChapterRuleBusy] = useState(false);
    const [advancedChapterRules, setAdvancedChapterRules] = useState(false);
    const [customRuleLabel, setCustomRuleLabel] = useState('本书自定义规则');
    const [customRulePattern, setCustomRulePattern] = useState('');
    const [currentChapterRule, setCurrentChapterRule] = useState<ChapterRuleSelection | null>(null);
    const [recommendedChapterFamilies, setRecommendedChapterFamilies] = useState<string[]>([]);
    const [chapterRuleError, setChapterRuleError] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [showAnnotationList, setShowAnnotationList] = useState<'chapter' | 'page' | null>(null);
    const [activeWaveAnnotation, setActiveWaveAnnotation] = useState<Comment | null>(null);
    const [showChapterMenu, setShowChapterMenu] = useState(false);
    const [showReadingConfirm, setShowReadingConfirm] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchScope, setSearchScope] = useState<'chapter' | 'book'>('chapter');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchBusy, setSearchBusy] = useState(false);
    const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
    const [activeSearchMatch, setActiveSearchMatch] = useState<{ paragraph_idx: number; start: number; end: number } | null>(null);
    const [searchError, setSearchError] = useState('');
    const [searchLimited, setSearchLimited] = useState(false);
    const [showFavorites, setShowFavorites] = useState(false);
    const [favoriteComments, setFavoriteComments] = useState<FavoriteComment[]>([]);
    const [favoritesLoading, setFavoritesLoading] = useState(false);
    const [expandedFavoriteBooks, setExpandedFavoriteBooks] = useState<Set<number>>(new Set());
    const [favoriteDetailId, setFavoriteDetailId] = useState<number | null>(null);
    const [pendingFavoriteJump, setPendingFavoriteJump] = useState<{ bookId: number; commentId: number; paragraphIdx: number; startOffset: number } | null>(null);
    const tocListRef = useRef<HTMLDivElement>(null);
    const openingBookIdRef = useRef<number | null>(null);
    const readerHistoryRef = useRef(false);
    const READER_EDGE_GESTURE_PX = 24;
    // 目录窗口化：滚动位置与视口高（只渲染可视区±缓冲，几千章不全量挂DOM）
    const [tocScrollTop, setTocScrollTop] = useState(0);
    const [tocViewH, setTocViewH] = useState(0);
    const commentsRef = useRef<Comment[]>([]);
    const allCommentsRef = useRef<Comment[]>([]);
    const suppressPageJumpRef = useRef(false);
    const replyPageRef = useRef<number | null>(null);
    const searchHighlightTimerRef = useRef<number | null>(null);

    useEffect(() => () => {
        if (searchHighlightTimerRef.current != null) window.clearTimeout(searchHighlightTimerRef.current);
    }, []);

    const [showUpload, setShowUpload] = useState(false);
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploadText, setUploadText] = useState('');
    const [uploadBase64, setUploadBase64] = useState('');
    const [uploadFormat, setUploadFormat] = useState<'txt' | 'md' | 'epub'>('txt');
    const [uploadEncoding, setUploadEncoding] = useState('auto');
    const [uploadFileName, setUploadFileName] = useState('');
    const [uploadPreview, setUploadPreview] = useState<any | null>(null);
    const [uploadChapters, setUploadChapters] = useState<any[]>([]);
    const [previewingUpload, setPreviewingUpload] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
    const [confirmPermanentDelete, setConfirmPermanentDelete] = useState<number | null>(null);
    const [confirmBatchDelete, setConfirmBatchDelete] = useState<'soft' | 'permanent' | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [selectedBooks, setSelectedBooks] = useState<Set<number>>(new Set());
    const batchFileRef = useRef<HTMLInputElement>(null);
    const [libraryCategories, setLibraryCategories] = useState<string[]>(['待看', '纯爱', '言情', '百合', '文学', '散文', '论文']);
    const [libraryTags, setLibraryTags] = useState<string[]>(['没看完']);
    const [shelfCategory, setShelfCategory] = useState('全部');
    const [shelfTag, setShelfTag] = useState('全部');
    const [shelfQuery, setShelfQuery] = useState('');
    const [showShelfFilters, setShowShelfFilters] = useState(false);
    const [showShelfLayout, setShowShelfLayout] = useState(false);
    const [showTrash, setShowTrash] = useState(false);
    const [editingBook, setEditingBook] = useState<Book | null>(null);
    const [editBookTitle, setEditBookTitle] = useState('');
    const [editBookCategory, setEditBookCategory] = useState('待看');
    const [editBookTags, setEditBookTags] = useState<string[]>([]);
    const [editBookNote, setEditBookNote] = useState('');
    const [editBookCover, setEditBookCover] = useState('');
    const [deleteOptionValue, setDeleteOptionValue] = useState('');
    const [newOptionType, setNewOptionType] = useState<'category' | 'tag'>('tag');
    const [newOptionValue, setNewOptionValue] = useState('');
    const [showBar, setShowBar] = useState(false);
    const [humanName, setHumanName] = useState(() => localStorage.getItem('coread-human-name') || 'human');
    const [aiName, setAiName] = useState(() => localStorage.getItem('coread-ai-name') || 'AI');
    const [showSettings, setShowSettings] = useState(false);
    const [showBackups, setShowBackups] = useState(false);
    const [backups, setBackups] = useState<BackupSummary[]>([]);
    const [backupsLoading, setBackupsLoading] = useState(false);
    const [backupCreating, setBackupCreating] = useState(false);
    const [restorePreflight, setRestorePreflight] = useState<any | null>(null);
    const [restoreConfirmed, setRestoreConfirmed] = useState(false);
    const [restoreBusy, setRestoreBusy] = useState(false);
    const [readerTheme, setReaderTheme] = useState<ReaderTheme>(() => {
        const saved = localStorage.getItem('coread-reader-theme');
        return isReaderTheme(saved) ? saved : 'eink';
    });
    const [customAppearance, setCustomAppearance] = useState(loadCustomAppearance);
    const [shelfColumns, setShelfColumns] = useState<ShelfColumns>(loadShelfColumns);
    const [readerLayout, setReaderLayout] = useState<ReaderLayout>(loadReaderLayout);
    const [globalReaderFont, setGlobalReaderFont] = useState<GlobalReaderFont>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(GLOBAL_READER_FONT_META_KEY) || 'null');
            if (!saved || !['system', 'upload', 'url', 'css'].includes(saved.source)) return { ...DEFAULT_GLOBAL_READER_FONT };
            return {
                ...DEFAULT_GLOBAL_READER_FONT,
                source: saved.source,
                name: typeof saved.name === 'string' ? saved.name.slice(0, 120) : DEFAULT_GLOBAL_READER_FONT.name,
                family: typeof saved.family === 'string' ? saved.family.slice(0, 180) : DEFAULT_GLOBAL_READER_FONT.family,
                format: typeof saved.format === 'string' ? saved.format : undefined,
                url: typeof saved.url === 'string' ? saved.url : undefined,
                version: Number.isFinite(Number(saved.version)) ? Number(saved.version) : 0,
            };
        } catch {
            return { ...DEFAULT_GLOBAL_READER_FONT };
        }
    });
    const [globalReaderFontLoading, setGlobalReaderFontLoading] = useState(false);
    const [globalReaderFontUrl, setGlobalReaderFontUrl] = useState('');
    const [globalReaderFontError, setGlobalReaderFontError] = useState('');

    const [readerPresets, setReaderPresets] = useState<Record<string, { theme: ReaderTheme; layout: ReaderLayout }>>(() => {
        try { return JSON.parse(localStorage.getItem('coread-reader-presets') || '{}'); } catch { return {}; }
    });
    const [showFontPanel, setShowFontPanel] = useState(false);
    const [readerPanelFocus, setReaderPanelFocus] = useState<'typography' | 'appearance'>('typography');
    const [readerBrightness, setReaderBrightness] = useState(() => parseInt(localStorage.getItem('coread-brightness') || '100', 10));
    const [readerPageTurnEffect, setReaderPageTurnEffect] = useState<ReaderPageTurnEffect>(loadReaderPageTurnEffect);
    const [readerPageTurnDuration, setReaderPageTurnDuration] = useState<number>(loadReaderPageTurnDuration);
    const [pageTurnDirection, setPageTurnDirection] = useState<'forward' | 'backward'>('forward');
    const [pageTurnNonce, setPageTurnNonce] = useState(0);
    const skipNextPageTurnAnimationRef = useRef(false);
    useEffect(() => {
        if (skipNextPageTurnAnimationRef.current) skipNextPageTurnAnimationRef.current = false;
    }, [page]);
    const readerAppearance = readerTheme === 'custom'
        ? {
            ...READER_THEME_OPTIONS.custom,
            surface: customAppearance.background,
            panel: customAppearance.background,
            text: customAppearance.text,
            texture: customAppearance.texture,
        }
        : READER_THEME_OPTIONS[readerTheme];
    const c = themeColors(readerAppearance.hue, readerAppearance.saturation, readerAppearance.lightness);
    const readerSurface = readerAppearance.surface;
    const readerPanel = readerAppearance.panel;
    const readerText = readerAppearance.text;
    const readerMuted = readerAppearance.muted;
    const readerBorder = readerAppearance.border;
    const readerHighlight = readerAppearance.highlight;
    const readerTexture = readerTheme === 'eink' || readerAppearance.texture === 'none'
        ? undefined
        : readerAppearance.texture === 'kraft'
            ? 'repeating-linear-gradient(0deg, rgba(78,52,20,0.035) 0 1px, transparent 1px 5px), repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 7px)'
            : 'repeating-linear-gradient(0deg, rgba(114,89,52,0.025) 0 1px, transparent 1px 5px), repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 1px, transparent 1px 8px)';
    const chapterStartIndices = useMemo(
        () => new Set(tocChapters.map(chapter => Number(chapter.idx ?? chapter.start_idx)).filter(Number.isFinite)),
        [tocChapters],
    );
    const chapterBoundarySignature = useMemo(() => {
        let hash = 2166136261;
        for (const chapter of tocChapters) {
            const value = Number(chapter.idx ?? chapter.start_idx) || 0;
            hash ^= value;
            hash = Math.imul(hash, 16777619);
        }
        return `${tocChapters.length}-${hash >>> 0}`;
    }, [tocChapters]);
    const isChapterStartIndex = (sourceIdx: number) =>
        chapterStartIndices.has(Number(allParas[sourceIdx]?.idx));
    const normalizeTocChapters = (chapters: any[]): TocChapter[] => (chapters || []).map((chapter, index) => ({
        ...chapter,
        chapter_no: Number(chapter.chapter_no ?? index + 1),
        start_idx: Number(chapter.start_idx ?? chapter.idx ?? chapter.page ?? 0),
        end_idx: chapter.end_idx == null ? undefined : Number(chapter.end_idx),
        idx: Number(chapter.idx ?? chapter.start_idx ?? chapter.page ?? 0),
        page: Number(chapter.page ?? 1),
        title: String(chapter.title || `第 ${index + 1} 章`),
    }));

    const paragraphAt = (sourceIdx: number): Paragraph | null => {
        const direct = allParas[sourceIdx];
        if (!paragraphCacheManifest || paragraphsFullyLoaded || direct?.content) return direct || null;
        const chunkIndex = Math.floor(sourceIdx / paragraphCacheManifest.chunkSize);
        const chunk = paragraphChunksRef.current.get(chunkIndex);
        return chunk?.[sourceIdx - chunkIndex * paragraphCacheManifest.chunkSize] || null;
    };

    const sourceIndexForParagraphIdx = (paragraphIdx: number) => {
        const indices = paragraphCacheManifest?.paragraphIndices;
        if (indices?.length) {
            const target = Number(paragraphIdx);
            let lo = 0;
            let hi = indices.length - 1;
            let answer = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (indices[mid] < target) lo = mid + 1;
                else { answer = mid; hi = mid - 1; }
            }
            return answer;
        }
        let index = allParas.findIndex(paragraph => Number(paragraph.idx) === Number(paragraphIdx));
        if (index < 0) index = allParas.findIndex(paragraph => Number(paragraph.idx) >= Number(paragraphIdx));
        return index;
    };

    const loadParagraphWindow = async (
        bookId: number,
        manifest: ParagraphCacheManifest,
        sourceIdx: number,
    ) => {
        if (paragraphCacheBookRef.current !== bookId) return false;
        const center = Math.max(0, Math.min(manifest.chunkCount - 1, Math.floor(sourceIdx / manifest.chunkSize)));
        const wanted = Array.from(new Set([center - 1, center, center + 1]
            .filter(index => index >= 0 && index < manifest.chunkCount)));
        const token = ++paragraphWindowTokenRef.current;
        const loaded = await Promise.all(wanted.map(async chunkIndex => {
            const cached = paragraphChunksRef.current.get(chunkIndex);
            if (cached) return [chunkIndex, cached] as const;
            const value = await idbGetParas(paragraphChunkCacheKey(bookId, chunkIndex));
            const paragraphs = parseParagraphChunk(value, chunkIndex, manifest);
            return paragraphs ? [chunkIndex, paragraphs] as const : null;
        }));
        if (token !== paragraphWindowTokenRef.current || paragraphCacheBookRef.current !== bookId) return false;
        if (loaded.some(item => !item)) return false;
        const next = new Map<number, Paragraph[]>();
        for (const item of loaded) if (item) next.set(item[0], item[1]);
        paragraphChunksRef.current = next;
        setParagraphChunkRevision(previous => previous + 1);
        return true;
    };

    const hydrateAllParagraphs = (bookId: number, manifest: ParagraphCacheManifest) => {
        if (paragraphHydrationPromiseRef.current) return paragraphHydrationPromiseRef.current;
        const promise = (async () => {
            const all: Paragraph[] = [];
            for (let chunkIndex = 0; chunkIndex < manifest.chunkCount; chunkIndex++) {
                const cached = paragraphChunksRef.current.get(chunkIndex)
                    || parseParagraphChunk(
                        await idbGetParas(paragraphChunkCacheKey(bookId, chunkIndex)),
                        chunkIndex,
                        manifest,
                    );
                if (!cached) return null;
                paragraphChunksRef.current.set(chunkIndex, cached);
                all.push(...cached);
                if (chunkIndex % 4 === 3) await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            return all.length === manifest.totalParas ? all : null;
        })();
        paragraphHydrationPromiseRef.current = promise;
        promise.finally(() => {
            if (paragraphHydrationPromiseRef.current === promise) paragraphHydrationPromiseRef.current = null;
        });
        return promise;
    };

    const reviewModeStorageKey = (bookId: number) => `coread-review-mode-${bookId}`;
    const changeReviewMode = (value: 'fine' | 'layered') => {
        setReviewMode(value);
        if (activeBook) localStorage.setItem(reviewModeStorageKey(activeBook.id), value);
    };

    useEffect(() => {
        if (!activeBook) {
            setReviewMode('fine');
            return;
        }
        const stored = localStorage.getItem(reviewModeStorageKey(activeBook.id));
        setReviewMode(stored === 'layered' ? 'layered' : 'fine');
    }, [activeBook?.id]);

    // A visible sub-panel is an explicit request to keep the reading menu open.
    useEffect(() => {
        if (mode === 'reading' && (showFontPanel || showMoreMenu || showChapterMenu)) {
            setShowBar(true);
        }
    }, [mode, showFontPanel, showMoreMenu, showChapterMenu]);

    useEffect(() => {
        if (globalReaderFont.source === 'system') return;
        let cancelled = false;
        setGlobalReaderFontLoading(true);
        void loadGlobalReaderFontFace(globalReaderFont).then(ok => {
            if (cancelled) return;
            if (!ok) {
                setGlobalReaderFontError('字帖加载失败，已自动回退系统字体');
                setGlobalReaderFont({ ...DEFAULT_GLOBAL_READER_FONT, version: Date.now() });
            }
            setGlobalReaderFontLoading(false);
        });
        return () => { cancelled = true; };
    }, [globalReaderFont.source, globalReaderFont.version]);

    const updateReaderLayout = (patch: Partial<ReaderLayout>) => {
        setReaderLayout(previous => {
            const next = { ...previous, ...patch };
            localStorage.setItem('coread-reader-layout', JSON.stringify(next));
            return next;
        });
    };
    const applyGlobalReaderFont = async (font: GlobalReaderFont, dataUrl?: string) => {
        setGlobalReaderFontLoading(true);
        setGlobalReaderFontError('');
        try {
            const ok = await loadGlobalReaderFontFace(font, dataUrl);
            if (!ok) throw new Error('字帖加载失败，请检查字体文件或链接');
            if (dataUrl) {
                const saved = await idbSet(GLOBAL_READER_FONT_DATA_KEY, dataUrl);
                if (!saved) throw new Error('本机字体存储失败');
            } else if (font.source === 'url' || font.source === 'css') {
                await idbDel(GLOBAL_READER_FONT_DATA_KEY);
            }
            saveGlobalReaderFontMeta(font);
            setGlobalReaderFont(font);
            toast(`已应用全局字帖「${font.name}」`);
        } catch (error) {
            setGlobalReaderFontError(error instanceof Error ? error.message : '字体加载失败');
            toast('字帖加载失败，已保留原字体');
        } finally {
            setGlobalReaderFontLoading(false);
        }
    };
    const handleGlobalReaderFontFile = async (file: File | undefined) => {
        if (!file) return;
        const lower = file.name.toLowerCase();
        if (!/\.(ttf|otf|woff|woff2)$/.test(lower)) {
            setGlobalReaderFontError('只支持 TTF / OTF / WOFF / WOFF2 字体文件');
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            setGlobalReaderFontError('字体文件不能超过 20 MB');
            return;
        }
        try {
            const dataUrl = await readFileAsDataUrl(file);
            await applyGlobalReaderFont({
                source: 'upload',
                name: file.name,
                family: `CoreadFont_${Date.now()}`,
                format: lower.split('.').pop() || '',
                version: Date.now(),
            }, dataUrl);
        } catch {
            setGlobalReaderFontError('字体文件读取失败');
        }
    };
    const applyGlobalReaderFontUrl = async () => {
        const url = globalReaderFontUrl.trim();
        if (!/^https?:\/\//i.test(url)) {
            setGlobalReaderFontError('请输入 http:// 或 https:// 开头的字体链接');
            return;
        }
        setGlobalReaderFontLoading(true);
        setGlobalReaderFontError('');
        try {
            const looksLikeCss = /\.css(?:[?#].*)?$/i.test(url) || /fontsapi\.zeoseven\.com|cdn\.jsdelivr\.net\/gh\/[^/]+\/ReiFonts/i.test(url);
            if (looksLikeCss) {
                const family = await resolveCssFontFamily(url);
                if (!family) throw new Error('没找到 CSS 里的字体名称，请确认这是可访问的 WebFont CSS 链接');
                const name = family.replace(/^['"]|['"]$/g, '').slice(0, 120);
                await applyGlobalReaderFont({
                    source: 'css',
                    name,
                    family: `'${name}'`,
                    version: Date.now(),
                    url,
                });
            } else {
                const name = url.split('/').pop()?.split('?')[0] || '远程字帖';
                await applyGlobalReaderFont({
                    source: 'url',
                    name: name.slice(0, 120),
                    family: `CoreadRemoteFont_${Date.now()}`,
                    version: Date.now(),
                    url,
                });
            }
        } finally {
            setGlobalReaderFontLoading(false);
        }
    };
    const resetGlobalReaderFont = async () => {
        removeGlobalReaderFontCssLink();
        await idbDel(GLOBAL_READER_FONT_DATA_KEY);
        try { localStorage.removeItem(GLOBAL_READER_FONT_META_KEY); } catch {}
        setGlobalReaderFont({ ...DEFAULT_GLOBAL_READER_FONT, version: Date.now() });
        setGlobalReaderFontUrl('');
        setGlobalReaderFontError('');
        toast('已恢复系统字体');
    };

    const chooseReaderTheme = (theme: ReaderTheme) => {
        setReaderTheme(theme);
        localStorage.setItem('coread-reader-theme', theme);
    };
    const updateCustomAppearance = (patch: Partial<typeof DEFAULT_CUSTOM_APPEARANCE>) => {
        setCustomAppearance(previous => {
            const next = { ...previous, ...patch };
            localStorage.setItem('coread-reader-custom-appearance', JSON.stringify(next));
            return next;
        });
    };
    const updateShelfColumns = (next: ShelfColumns) => {
        setShelfColumns(next);
        localStorage.setItem('coread-shelf-columns', JSON.stringify(next));
    };
    const saveReaderPreset = () => {
        const name = window.prompt('预设名称');
        if (!name?.trim()) return;
        const next = { ...readerPresets, [name.trim()]: { theme: readerTheme, layout: readerLayout } };
        setReaderPresets(next);
        localStorage.setItem('coread-reader-presets', JSON.stringify(next));
        toast(`已保存本机预设「${name.trim()}」`);
    };
    const applyReaderPreset = (name: string) => {
        const preset = readerPresets[name];
        if (!preset) return;
        const layout = { ...DEFAULT_READER_LAYOUT, ...preset.layout };
        chooseReaderTheme(preset.theme);
        setReaderLayout(layout);
        localStorage.setItem('coread-reader-layout', JSON.stringify(layout));
    };
    const deleteReaderPreset = (name: string) => {
        const next = { ...readerPresets };
        delete next[name];
        setReaderPresets(next);
        localStorage.setItem('coread-reader-presets', JSON.stringify(next));
    };
    const displayName = (from: string) => {
        const lower = from.toLowerCase();
        if (lower === 'human' || lower === humanName.toLowerCase()) return humanName;
        if (lower === 'ai' || lower === aiName.toLowerCase()) return aiName;
        return from;
    };
    const touchStart = useRef<{
        x: number;
        y: number;
        t: number;
        startedOnText: boolean;
        startedAtEdge: boolean;
        selectionClaimed: boolean;
        dragging: boolean;
        direction: 'forward' | 'backward' | null;
    } | null>(null);
    const touchLongPressTimer = useRef<number | null>(null);
    const selectionGestureLockUntil = useRef(0);
    const pageDragAnimationRef = useRef<Animation | null>(null);
    // v11: 自适应抓页：中间=整页掀起，上/下边=对应角落揪起。
    // 页面元素直接缓存，避免每一帧 querySelector。
    const pagePointerRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        pageEl: HTMLElement | null;
        bodyEl: HTMLElement | null;
        curlEl: HTMLElement | null;
        direction: 'forward' | 'backward' | null;
        // 根据按下位置选择翻页模型：
        // center = 整页掀起；top/bottom = 从对应角落揪起。
        grabMode: 'center' | 'top' | 'bottom';
        moved: boolean;
    } | null>(null);
    const pagePointerRafRef = useRef<number | null>(null);
    const pagePointerXRef = useRef<number | null>(null);


    const reserveSelectionGesture = (duration = 900) => {
        selectionGestureLockUntil.current = Math.max(selectionGestureLockUntil.current, Date.now() + duration);
    };

    const clearTouchLongPressTimer = () => {
        if (touchLongPressTimer.current !== null) {
            window.clearTimeout(touchLongPressTimer.current);
            touchLongPressTimer.current = null;
        }
    };

    const clearCommentComposer = () => {
        replyPageRef.current = null;
        setReplyingTo(null);
        setCommentingIdx(null);
        setCommentText('');
        setSelectedText('');
        setSelRange(null);
        setNewCommentThreadKey(null);
    };

    const closeCommentDetails = () => {
        setActiveComments([]);
        clearCommentComposer();
    };

    const openCommentDetails = (thread: Comment[]) => {
        clearCommentComposer();
        setActiveComments(sortCommentTimeline(thread));
    };

    const toggleBar = () => {
        if (activeComments.length > 0) { closeCommentDetails(); return; }
        if (floatingBar) return;
        setShowBar(prev => {
            const next = !prev;
            if (!next) {
                setShowMoreMenu(false);
                setShowChapterMenu(false);
                setShowFontPanel(false);
            }
            return next;
        });
    };

    const closeReadingMenu = () => {
        setShowBar(false);
        setShowMoreMenu(false);
        setShowChapterMenu(false);
        setShowFontPanel(false);
    };

    const openReaderPanel = (focus: 'typography' | 'appearance') => {
        if (showFontPanel && readerPanelFocus === focus) {
            setShowFontPanel(false);
            return;
        }
        setReaderPanelFocus(focus);
        setShowFontPanel(true);
        setShowBar(true);
        setShowMoreMenu(false);
        setShowChapterMenu(false);
    };

    useEffect(() => {
        api.authMe().then(() => setAuthenticated(true)).catch(() => setAuthenticated(false));
    }, []);
    useEffect(() => { if (authenticated) loadBooks(); }, [authenticated]);
    // Real-time comment sync — low-priority update, no flash
    useEffect(() => { commentsRef.current = comments; }, [comments]);
    useEffect(() => { allCommentsRef.current = allComments; }, [allComments]);

    const lastCommentIds = useRef('');
    const lastCommentVersion = useRef<number | null>(null);
    useEffect(() => {
        if (mode !== 'reading' || !activeBook) return;
        const interval = setInterval(async () => {
            try {
                const d = await api.fetchBookComments(activeBook.id);
                const nextVersion = Number(d.comment_version || 1);
                const nextComments = Array.from(
                    new Map<number, Comment>(
                        ((d.comments || []) as Comment[]).map(item => [item.id, item]),
                    ).values(),
                );
                const newIds = nextComments.map(item => item.id).join(',');
                if (nextVersion !== lastCommentVersion.current || newIds !== lastCommentIds.current) {
                    startTransition(() => {
                        persistCommentCache(activeBook.id, nextComments, nextVersion);
                    });
                }
            } catch {}
        }, 5000);
        return () => clearInterval(interval);
    }, [mode, activeBook?.id]);

    // Poll for new replies from 沉
    useEffect(() => {
        if (mode !== 'reading' || !activeBook) return;
        const check = async () => {
            try {
                const lastSeen = parseInt(localStorage.getItem(`book-${activeBook.id}-last-seen`) || '0');
                const r = await fetch(`${API_BASE}/v1/books/${activeBook.id}/new-replies?since=${lastSeen}`);
                if (r.ok) {
                    const d = await r.json();
                    const aiOnly = (d.replies || []).filter((r: any) => r.from_who.toLowerCase() !== humanName.toLowerCase());
                    setNewReplies(aiOnly.length ? aiOnly : []);
                }
            } catch {}
        };
        check();
        const interval = setInterval(check, 5000);
        return () => clearInterval(interval);
    }, [mode, activeBook?.id]);

    const dismissReplies = () => {
        if (activeBook && newReplies.length) {
            const maxId = Math.max(...newReplies.map(r => r.id));
            localStorage.setItem(`book-${activeBook.id}-last-seen`, String(maxId));
        }
        setNewReplies([]);
        setShowReplies(false);
    };

    const findPageForParaIdx = (paraIdx: number, maxPages = totalPages, charOffset = 0) => {
        const targetOffset = Number(charOffset) || 0;
        const paraIndex = sourceIndexForParagraphIdx(Number(paraIdx));
        if (paraIndex < 0) return -1;

        const lastPage = Math.min(maxPages, pageBreaks.length) - 1;
        // 二分：breaks 按 (paraIndex, offset) 单调递增；大书目录几千章逐个换算页码，线性扫会卡
        let lo = 0, hi = lastPage, ans = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const br = pageBreaks[mid];
            if (br.paraIndex < paraIndex || (br.paraIndex === paraIndex && br.offset <= targetOffset)) { ans = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        return ans;
    };

    const jumpToSearchResult = (result: any, index = activeSearchIndex) => {
        if (!result || !canJumpToPara(Number(result.paragraph_idx))) return;
        const targetPage = findPageForParaIdx(Number(result.paragraph_idx), totalPages, Number(result.start) || 0);
        if (targetPage < 0) return;
        setActiveSearchIndex(index);
        if (result.kind === 'comment') {
            const comment = allComments.find(item => item.id === Number(result.comment_id));
            setActiveSearchMatch(null);
            setPage(targetPage + 1);
            if (comment) openCommentDetails(commentThread(comment));
            return;
        }
        setActiveSearchMatch({
            paragraph_idx: Number(result.paragraph_idx),
            start: Number(result.start) || 0,
            end: Number(result.end) || 0,
        });
        setPage(targetPage + 1);
    };

    const runBookSearch = async () => {
        if (!activeBook || !searchQuery.trim() || searchBusy) return;
        setSearchBusy(true);
        setSearchError('');
        try {
            const data = await api.searchBookText(
                activeBook.id,
                searchQuery.trim(),
                searchScope,
                searchScope === 'chapter' ? currentChapterNo : undefined,
            );
            const textResults = Array.isArray(data.results) ? data.results.map((result: any) => ({ ...result, kind: 'text' })) : [];
            const commentResults = Array.isArray(data.comment_results) ? data.comment_results : [];
            const results = [...textResults, ...commentResults];
            setSearchResults(results);
            setActiveSearchIndex(results.length ? 0 : -1);
            setActiveSearchMatch(null);
            setSearchLimited(Boolean(data.limited || data.comments_limited));
            if (results.length) jumpToSearchResult(results[0], 0);
        } catch (error: any) {
            setSearchResults([]);
            setActiveSearchIndex(-1);
            setActiveSearchMatch(null);
            setSearchLimited(false);
            setSearchError(error?.message || '搜索失败');
        } finally {
            setSearchBusy(false);
        }
    };

    const moveSearchResult = (delta: number) => {
        if (!searchResults.length) return;
        const next = (activeSearchIndex + delta + searchResults.length) % searchResults.length;
        jumpToSearchResult(searchResults[next], next);
    };

    // 后台补全分页中：临时页表只覆盖当前位置附近，窗外目标等全书分页完成再跳
    const canJumpToPara = (idx: number) => {
        const pr = provisionalRangeRef.current;
        if (!pr) return true;
        const tpi = sourceIndexForParagraphIdx(Number(idx));
        if (tpi >= pr.from && tpi < pr.to) return true;
        toast('全书分页后台补全中，完成后再跳');
        return false;
    };

    const resolveNoticeTarget = (notice: ReplyNotice, pool: Comment[]) => {
        const existing = pool.find(c => c.id === notice.id);
        const replyTo = notice.reply_to ?? notice.parent_id ?? existing?.reply_to ?? null;
        const parent = replyTo ? pool.find(c => c.id === replyTo) : null;
        const target = parent || existing;
        const fallbackPara = Number(notice.parent_paragraph_idx ?? notice.paragraph_idx);
        const fallbackOffset = Number(notice.parent_sel_start_idx ?? notice.sel_start_idx);
        return {
            existing,
            replyTo,
            parent,
            paraIdx: Number(target?.paragraph_idx ?? fallbackPara),
            offset: Number.isFinite(Number(target?.sel_start_idx)) ? Number(target?.sel_start_idx) : (Number.isFinite(fallbackOffset) ? fallbackOffset : 0),
        };
    };

    const rememberReturnPoint = () => {
        setReturnPoint(prev => prev || { page, paraIdx: currentParaIdxRef.current ?? paragraphs[0]?.idx ?? null });
    };

    const returnToReadingPosition = () => {
        if (!returnPoint) return;
        closeCommentDetails();
        setShowReplies(false);
        setShowBar(false);
        const targetPage = returnPoint.paraIdx != null ? findPageForParaIdx(returnPoint.paraIdx) : -1;
        setPage(targetPage >= 0 ? targetPage + 1 : Math.max(1, Math.min(totalPages, returnPoint.page)));
        setReturnPoint(null);
    };

    const openReplyNotice = (notice: ReplyNotice) => {
        rememberReturnPoint();
        setShowReplies(false);
        setShowBar(false);
        const pool = Array.from(new Map([...allCommentsRef.current, ...commentsRef.current].map(c => [c.id, c])).values());
        const { existing, replyTo, parent, paraIdx: targetParaIdx, offset: targetOffset } = resolveNoticeTarget(notice, pool);
        const targetPage = findPageForParaIdx(targetParaIdx, totalPages, targetOffset);
        if (targetPage >= 0) setPage(targetPage + 1);
        const noticeComment: Comment = existing || {
            id: notice.id,
            book_id: activeBook?.id ?? 0,
            paragraph_idx: targetParaIdx,
            sel_end_para_idx: null,
            sel_start_idx: targetOffset,
            sel_end_idx: notice.parent_sel_end_idx ?? notice.sel_end_idx ?? null,
            selected_text: notice.parent_selected_text ?? notice.selected_text ?? null,
            from_who: notice.from_who || 'ai',
            content: notice.content,
            created_at: notice.created_at || new Date().toISOString(),
            reply_to: replyTo,
        };
        const thread = parent
            ? [parent, ...pool.filter(c => c.reply_to === parent.id || c.id === noticeComment.id)]
            : [noticeComment];
        openCommentDetails(thread.some(c => c.id === noticeComment.id) ? thread : [...thread, noticeComment]);
        if (!existing) {
            setComments(prev => prev.some(c => c.id === noticeComment.id) ? prev : [...prev, noticeComment]);
            setAllComments(prev => prev.some(c => c.id === noticeComment.id) ? prev : [...prev, noticeComment]);
        }
    };

    // Selection change listener for floating annotation bar
    useEffect(() => {
        if (mode !== 'reading') return;
        const findPara = (n: Node): HTMLElement | null => {
            let el: HTMLElement | null = (n.nodeType === Node.TEXT_NODE ? n.parentElement : n) as HTMLElement;
            while (el && !(el as any).dataset?.paraIdx) el = el.parentElement;
            return el;
        };
        const handler = () => {
            const sel = window.getSelection();
            if (!sel || !sel.toString().trim() || sel.rangeCount === 0) { setFloatingBar(null); return; }
            reserveSelectionGesture();
            const range = sel.getRangeAt(0);
            const startEl = findPara(range.startContainer);
            const endEl = findPara(range.endContainer);
            if (!startEl || !endEl) { setFloatingBar(null); return; }

            const startPara = parseInt((startEl as any).dataset.paraIdx);
            const endPara = parseInt((endEl as any).dataset.paraIdx);
            const text = sel.toString().trim();
            try {
                const pre1 = document.createRange();
                pre1.selectNodeContents(startEl);
                pre1.setEnd(range.startContainer, range.startOffset);
                const startBase = parseInt((startEl as any).dataset.fragStart || '0');
                const endBase = parseInt((endEl as any).dataset.fragStart || '0');
                const startOff = startBase + pre1.toString().length;

                let endOff: number;
                if (startPara === endPara) {
                    endOff = startOff + text.length;
                } else {
                    const pre2 = document.createRange();
                    pre2.selectNodeContents(endEl);
                    pre2.setEnd(range.endContainer, range.endOffset);
                    endOff = endBase + pre2.toString().length;
                }
                const rects = Array.from(range.getClientRects());
                const firstRect = rects[0];
                const lastRect = rects[rects.length - 1] || firstRect;
                if (!firstRect || !lastRect) { setFloatingBar(null); return; }
                const safeTop = showBar ? 82 : 8;
                const placement = firstRect.top - safeTop >= 48 ? 'above' : 'below';
                const rawLeft = lastRect.left + (lastRect.width / 2);
                const left = Math.max(104, Math.min(window.innerWidth - 104, rawLeft));
                setFloatingBar({
                    startPara, endPara, text, start: startOff, end: endOff, left,
                    top: placement === 'above' ? firstRect.top - 8 : lastRect.bottom + 8,
                    placement,
                });
            } catch { setFloatingBar(null); }
        };
        document.addEventListener('selectionchange', handler);
        return () => document.removeEventListener('selectionchange', handler);
    }, [mode, showBar]);

    const loadBooks = async (includeDeleted = showTrash) => {
        setLoading(true); setError('');
        try {
            const d = await api.fetchBooks(includeDeleted);
            setBooks(d.books || []);
            if (Array.isArray(d.categories)) setLibraryCategories(d.categories);
            if (Array.isArray(d.tags)) setLibraryTags(d.tags);
        }
        catch (e: any) { setError(e.message); }
        setLoading(false);
    };

    const visibleBooks = useMemo(() => {
        const q = shelfQuery.trim().toLowerCase();
        return books.filter(book => {
            if (shelfCategory !== '全部' && (book.category || '待看') !== shelfCategory) return false;
            if (shelfTag !== '全部' && !(book.tags || []).includes(shelfTag)) return false;
            if (!q) return true;
            return [book.title, book.note, book.category, ...(book.tags || [])]
                .filter(Boolean).some(value => String(value).toLowerCase().includes(q));
        });
    }, [books, shelfCategory, shelfTag, shelfQuery]);

    const resetUploadState = () => {
        setUploadTitle('');
        setUploadText('');
        setUploadBase64('');
        setUploadFormat('txt');
        setUploadEncoding('auto');
        setUploadFileName('');
        setUploadPreview(null);
        setUploadChapters([]);
    };

    const readFileBase64 = (file: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
        reader.readAsDataURL(file);
    });

    const refreshUploadPreview = async (encoding = uploadEncoding, format = uploadFormat) => {
        if (!uploadBase64 && !uploadText.trim()) {
            toast('请先选择文件或粘贴文本');
            return;
        }
        setPreviewingUpload(true);
        try {
            const data: any = {
                format,
                encoding,
                chapter_mode: 'auto',
            };
            if (uploadBase64) data.data = uploadBase64;
            else data.content = uploadText;
            const preview = await api.previewBook(data);
            setUploadPreview(preview);
            setUploadEncoding(preview.encoding || encoding);
            setUploadChapters((preview.chapters || []).map((chapter: any) => ({ ...chapter })));
        } catch (e: any) {
            toast(`解析预览失败: ${e.message}`);
        } finally {
            setPreviewingUpload(false);
        }
    };

    const renumberChapters = (chapters: any[]) => chapters.map((chapter, index) => ({ ...chapter, chapter_no: index + 1 }));

    const mergeUploadChapter = (index: number) => {
        if (index >= uploadChapters.length - 1) return;
        const current = uploadChapters[index];
        const next = uploadChapters[index + 1];
        const merged = {
            ...current,
            title: current.title || next.title,
            end_idx: next.end_idx,
            paragraph_count: next.end_idx - current.start_idx + 1,
        };
        setUploadChapters(renumberChapters([...uploadChapters.slice(0, index), merged, ...uploadChapters.slice(index + 2)]));
    };

    const splitUploadChapter = (index: number) => {
        const current = uploadChapters[index];
        const count = Number(current.paragraph_count || current.end_idx - current.start_idx + 1);
        if (count < 2) {
            toast('这一章只有一个段落，不能拆分');
            return;
        }
        const raw = window.prompt(`在本章第几个段落后拆分？（1-${count - 1}）`, String(Math.max(1, Math.floor(count / 2))));
        if (raw == null) return;
        const offset = Number(raw);
        if (!Number.isInteger(offset) || offset < 1 || offset >= count) {
            toast('拆分位置无效');
            return;
        }
        const firstEnd = current.start_idx + offset - 1;
        const first = { ...current, end_idx: firstEnd, paragraph_count: offset };
        const second = {
            ...current,
            title: `${current.title}（续）`,
            start_idx: firstEnd + 1,
            end_idx: current.end_idx,
            paragraph_count: count - offset,
        };
        setUploadChapters(renumberChapters([...uploadChapters.slice(0, index), first, second, ...uploadChapters.slice(index + 1)]));
    };

    const openBookEditor = (book: Book) => {
        setEditingBook(book);
        setEditBookTitle(book.title);
        setEditBookCategory(book.category || '待看');
        setEditBookTags(book.tags || []);
        setEditBookNote(book.note || '');
        setEditBookCover(book.cover_image || '');
    };

    const saveBookEditor = async () => {
        if (!editingBook || !editBookTitle.trim()) {
            toast('书名不能为空');
            return;
        }
        try {
            await api.updateBook(editingBook.id, {
                title: editBookTitle.trim(),
                category: editBookCategory || '待看',
                tags: editBookTags,
                note: editBookNote,
                cover_image: editBookCover,
            });
            setEditingBook(null);
            await loadBooks();
            toast('书籍信息已保存');
        } catch (e: any) {
            toast(`保存失败: ${e.message}`);
        }
    };

    const addLibraryOption = async () => {
        const value = newOptionValue.trim();
        if (!value) return;
        try {
            const result = await api.addLibraryOption(newOptionType, value);
            if (newOptionType === 'category') setLibraryCategories(result.values || [...libraryCategories, value]);
            else setLibraryTags(result.values || [...libraryTags, value]);
            setNewOptionValue('');
            toast(`已新增${newOptionType === 'category' ? '分类' : '标签'}`);
        } catch (e: any) {
            toast(`新增失败: ${e.message}`);
        }
    };

    const deleteLibraryOption = async () => {
        const value = deleteOptionValue;
        if (!value) return;
        try {
            const result = await api.deleteLibraryOption(newOptionType, value);
            if (newOptionType === 'category') setLibraryCategories(result.values || libraryCategories.filter(c => c !== value));
            else setLibraryTags(result.values || libraryTags.filter(t => t !== value));
            setDeleteOptionValue('');
            toast(`已删除${newOptionType === 'category' ? '分类' : '标签'}`);
        } catch (e: any) {
            toast(`删除失败: ${e.message}`);
        }
    };

    const invalidateBookPaginationCache = (bookId: number, cacheVersion?: number | null) => {
        if (activeBook?.id === bookId && Number.isFinite(cacheVersion)) {
            setBookCacheVersion(Number(cacheVersion));
        }
        idbDelPrefix(`${PAGEBREAK_CACHE_PREFIX}${bookId}-`);
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key && (
                    key.startsWith(`pagebreaks-v1-${bookId}`)
                    || key.startsWith(`pagebreaks-v2-${bookId}`)
                    || key.startsWith(`${PAGEBREAK_CACHE_PREFIX}${bookId}-`)
                )) localStorage.removeItem(key);
            }
        } catch {}
    };

    const invalidateBookContentCache = (bookId: number, cacheVersion?: number | null) => {
        invalidateBookPaginationCache(bookId, cacheVersion);
        idbDelParas(`paras-v1-${bookId}`);
        idbDelParas(`paras-v2-${bookId}`);
        idbDelParasPrefix(`paras-v3-${bookId}-`);
        idbDelParas(tocCacheKey(bookId));
    };

    const invalidateCommentCache = (bookId: number, commentVersion?: number | null) => {
        if (activeBook?.id === bookId && Number.isFinite(commentVersion)) {
            setCommentCacheVersion(Number(commentVersion));
        }
        idbDelParas(`comments-v1-${bookId}`);
        idbDelParas(`comments-v2-${bookId}`);
    };

    const clearReaderCache = (bookId: number) => {
        invalidateBookContentCache(bookId);
        invalidateCommentCache(bookId);
    };

    const persistCommentCache = (bookId: number, nextComments: Comment[], commentVersion?: number | null) => {
        const version = Number(commentVersion ?? commentCacheVersion ?? 1);
        const normalized = Array.from(new Map(nextComments.map(item => [item.id, item])).values());
        const normalizedVersion = Number.isFinite(version) ? version : null;
        lastCommentVersion.current = normalizedVersion;
        lastCommentIds.current = normalized.map(item => item.id).join(',');
        if (activeBook?.id === bookId || openingBookIdRef.current === bookId) {
            commentsRef.current = normalized;
            allCommentsRef.current = normalized;
            setCommentCacheVersion(normalizedVersion);
            setAllComments(normalized);
            setComments(normalized);
        }
        idbSetParas(`comments-v2-${bookId}`, JSON.stringify({
            comments: normalized,
            commentVersion: normalizedVersion,
        })).catch(() => {});
    };

    const rememberReadingProgress = (bookId: number, paragraphIdx: number) => {
        const next: LocalReadingProgress = {
            bookId,
            paragraphIdx,
            updatedAt: Date.now(),
            pending: true,
        };
        readingProgressRef.current = next;
        try { localStorage.setItem(readingProgressStorageKey(bookId), JSON.stringify(next)); } catch {}
    };

    const uploadLocalReadingProgress = async () => {
        if (!activeBook || readingProgressSyncing) return;
        const progress = readingProgressRef.current || loadLocalReadingProgress(activeBook.id);
        if (!progress || progress.bookId !== activeBook.id) {
            toast('这台设备还没有可上传的阅读位置');
            return;
        }
        setReadingProgressSyncing(true);
        try {
            await api.updateBookProgress(progress.bookId, progress.paragraphIdx);
            const saved = { ...progress, pending: false };
            readingProgressRef.current = saved;
            lastSyncedProgressRef.current = { bookId: saved.bookId, paragraphIdx: saved.paragraphIdx };
            try { localStorage.setItem(readingProgressStorageKey(saved.bookId), JSON.stringify(saved)); } catch {}
            const now = new Date().toISOString();
            setBooks(previous => previous.map(item => item.id === saved.bookId
                ? { ...item, current_page: saved.paragraphIdx, last_read_at: now }
                : item));
            setActiveBook(previous => previous?.id === saved.bookId
                ? { ...previous, current_page: saved.paragraphIdx, last_read_at: now }
                : previous);
            toast('已上传这台设备的阅读位置');
        } catch (error: any) {
            const pending = { ...progress, pending: true };
            readingProgressRef.current = pending;
            try { localStorage.setItem(readingProgressStorageKey(pending.bookId), JSON.stringify(pending)); } catch {}
            toast(`上传阅读位置失败: ${error?.message || '未知错误'}`);
        } finally {
            setReadingProgressSyncing(false);
        }
    };

    const restoreReadingProgressFromCloud = async () => {
        if (!activeBook || readingProgressSyncing) return;
        setReadingProgressSyncing(true);
        try {
            const data = await api.fetchBookDetail(activeBook.id);
            const paragraphIdx = cloudProgressPage(data);
            if (!Number.isFinite(paragraphIdx) || paragraphIdx <= 0) {
                toast('云端还没有可恢复的阅读位置');
                return;
            }
            const restored: LocalReadingProgress = {
                bookId: activeBook.id,
                paragraphIdx,
                updatedAt: Date.now(),
                pending: false,
            };
            readingProgressRef.current = restored;
            lastSyncedProgressRef.current = { bookId: restored.bookId, paragraphIdx: restored.paragraphIdx };
            savedParaIdxRef.current = paragraphIdx;
            try { localStorage.setItem(readingProgressStorageKey(restored.bookId), JSON.stringify(restored)); } catch {}
            const targetPage = findPageForParaIdx(paragraphIdx, totalPages);
            if (targetPage >= 0) setPage(targetPage + 1);
            setBooks(previous => previous.map(item => item.id === restored.bookId
                ? { ...item, current_page: restored.paragraphIdx }
                : item));
            setActiveBook(previous => previous?.id === restored.bookId
                ? { ...previous, current_page: restored.paragraphIdx }
                : previous);
            toast('已从云端恢复阅读位置到这台设备');
        } catch (error: any) {
            toast(`恢复云端位置失败: ${error?.message || '未知错误'}`);
        } finally {
            setReadingProgressSyncing(false);
        }
    };

    const openBook = async (book: Book) => {
        const openedAt = rememberBookLastOpened(book.id);
        const openedBook = { ...book, last_read_at: new Date(openedAt).toISOString() };
        setBooks(previous => previous.map(item => item.id === book.id ? openedBook : item));
        const localProgress = loadLocalReadingProgress(book.id);
        const recoveredParagraphIdx = localProgress?.paragraphIdx || 0;
        readingProgressRef.current = localProgress || null;
        lastSyncedProgressRef.current = localProgress && !localProgress.pending
            ? { bookId: book.id, paragraphIdx: localProgress.paragraphIdx }
            : null;
        savedParaIdxRef.current = recoveredParagraphIdx;
        if (!readerHistoryRef.current) {
            window.history.pushState({ coread: 'reading', bookId: book.id }, '', window.location.href);
            readerHistoryRef.current = true;
        }
        openingBookIdRef.current = book.id;
        paragraphCacheBookRef.current = book.id;
        paragraphChunksRef.current = new Map();
        paragraphHydrationPromiseRef.current = null;
        paragraphWindowTokenRef.current += 1;
        setTocChapters([]);
        setShowRechapter(false);
        setChapterRulePreview(null);
        const legacyParaCacheKey = `paras-v2-${book.id}`;
        const commentCacheKey = `comments-v2-${book.id}`;
        let paragraphsHit = false;
        setActiveBook(openedBook); setMode('reading');
        setReadingLoading(true);
        setPage(1); setTotalPages(1); setPageBreaks([{ paraIndex: 0, offset: 0 }]); setPageFragments([]); setPaginateProgress(null);
        setParagraphs([]); setComments([]); setAllParas([]); setAllComments([]);
        setParagraphCacheManifest(null);
        setParagraphsFullyLoaded(true);
        setParagraphChunkRevision(previous => previous + 1);
        setBookCacheVersion(null); setCommentCacheVersion(null);
        lastCommentVersion.current = null;
        lastCommentIds.current = '';
        currentParaIdxRef.current = null;
        provisionalRangeRef.current = null;
        const cachedCommentsPromise = idbGetParas(commentCacheKey)
            .then(cachedComments => {
                if (openingBookIdRef.current !== book.id) return true;
                if (!cachedComments) return false;
                const parsed = typeof cachedComments === 'string'
                    ? JSON.parse(cachedComments)
                    : cachedComments as any;
                const cachedCommentList = Array.isArray(parsed) ? parsed : parsed?.comments;
                if (!Array.isArray(cachedCommentList)) return false;
                const cachedVersion = Number(parsed?.commentVersion || parsed?.cacheVersion || 1);
                setCommentCacheVersion(cachedVersion);
                setAllComments(cachedCommentList);
                setComments(cachedCommentList);
                lastCommentVersion.current = cachedVersion;
                lastCommentIds.current = cachedCommentList.map((item: Comment) => item.id).join(',');
                return true;
            })
            .catch(() => false);
        try {
            const cachedToc = await idbGetParas(tocCacheKey(book.id));
            const parsedToc = typeof cachedToc === 'string' ? JSON.parse(cachedToc) : cachedToc as any;
            let normalizedToc = Array.isArray(parsedToc?.chapters)
                ? normalizeTocChapters(parsedToc.chapters)
                : Array.isArray(parsedToc) ? normalizeTocChapters(parsedToc) : [];
            if (!normalizedToc.length) {
                const remoteToc = await api.fetchBookToc(book.id);
                normalizedToc = normalizeTocChapters(remoteToc.chapters || []);
                if (normalizedToc.length) {
                    void idbSetParas(tocCacheKey(book.id), { cacheFormat: 'toc-v1', chapters: normalizedToc });
                }
            }
            if (openingBookIdRef.current === book.id) setTocChapters(normalizedToc);
        } catch {}
        try {
            let manifest: ParagraphCacheManifest | null = null;
            const cachedManifest = await idbGetParas(paragraphManifestCacheKey(book.id));
            const parsedManifest = typeof cachedManifest === 'string' ? JSON.parse(cachedManifest) : cachedManifest;
            if (isParagraphCacheManifest(parsedManifest)) {
                manifest = parsedManifest;
            } else {
                const legacyCached = await idbGetParas(legacyParaCacheKey);
                const parsedLegacy = typeof legacyCached === 'string' ? JSON.parse(legacyCached) : legacyCached as any;
                const legacyParagraphs = Array.isArray(parsedLegacy?.paragraphs)
                    ? parsedLegacy.paragraphs as Paragraph[]
                    : null;
                if (legacyParagraphs?.length) {
                    manifest = await writeChunkedParagraphCache(
                        book.id,
                        legacyParagraphs,
                        Number(parsedLegacy.totalParas || legacyParagraphs.length),
                        Number.isFinite(Number(parsedLegacy.cacheVersion)) ? Number(parsedLegacy.cacheVersion) : null,
                    );
                    if (manifest) {
                        await idbDelParas(legacyParaCacheKey);
                        await idbDelParas(`paras-v1-${book.id}`);
                    }
                }
            }
            if (openingBookIdRef.current !== book.id) return;
            if (manifest) {
                setParagraphCacheManifest(manifest);
                setBookCacheVersion(manifest.cacheVersion);
                const target = Number(recoveredParagraphIdx);
                let lo = 0;
                let hi = manifest.paragraphIndices.length - 1;
                let sourceIndex = 0;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (manifest.paragraphIndices[mid] < target) lo = mid + 1;
                    else { sourceIndex = mid; hi = mid - 1; }
                }
                sourceIndex = Math.max(0, Math.min(manifest.totalParas - 1, sourceIndex));
                if (await loadParagraphWindow(book.id, manifest, sourceIndex)) {
                    paragraphsHit = true;
                    setParagraphsFullyLoaded(false);
                    setAllParas(manifest.paragraphIndices.map(idx => ({ idx, content: '' })));
                    savedParaIdxRef.current = recoveredParagraphIdx;
                }
            }
        } catch {}
        {
            const bookTitle = book.title?.replace(/\s*\(.*?\)\s*/g, '').trim();
            fetch(`${API_BASE}/v1/reading-wishlist`).then(r => r.json()).then(res => {
                const match = (res.items || []).find((w: any) => w.status === 'want' && w.title?.trim() === bookTitle);
                if (match) {
                    fetch(`${API_BASE}/v1/reading-wishlist`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: match.id, title: match.title, author: match.author, reason: match.reason, status: 'reading' }),
                    }).catch(() => {});
                }
            }).catch(() => {});
        }
        try {
            const commentsRequest = cachedCommentsPromise.then(hit =>
                hit ? null : api.fetchBookComments(book.id));
            if (!paragraphsHit) {
                // 只有本机没有正文时才拉取。首次拉取可从 slice 响应得到总段数；
                // 已缓存的正文不再等待或比对远端 cache-state。
                const rawParas: Paragraph[] = [];
                let totalParas = Math.max(0, Number(book.total_paragraphs || 0));
                for (let start = 0; ; start += PARA_FETCH_CHUNK) {
                    const d = await api.fetchBookSlice(book.id, start, PARA_FETCH_CHUNK, false);
                    const slice = (d.paragraphs || []) as Paragraph[];
                    rawParas.push(...slice);
                    const reportedTotal = Number(d.total || 0);
                    if (Number.isFinite(reportedTotal) && reportedTotal > 0) totalParas = reportedTotal;
                    if (slice.length < PARA_FETCH_CHUNK || (totalParas > 0 && start + slice.length >= totalParas)) break;
                }
                const isEpubJunk = (s: string) => /^(1UR057|Cover|封面|插图|导航|书名页|制作信息|Contents|[A-Z0-9]{3,10}(-\d+)?)$/.test(s.trim());
                const allP: Paragraph[] = rawParas.filter((p: Paragraph) => !isEpubJunk(p.content));
                // Hide TOC sections (目录 heading + consecutive chapter titles)
                const tocRe = /^(#\s*)?目录$/;
                const chRe = /^(第[\d一二三四五六七八九十百千万]+[章节回部篇]|序章|序$|终章|后记|尾声|附录|解说)/;
                let tocZone = false;
                const filtered = allP.filter(p => {
                    const t = p.content.trim();
                    if (tocRe.test(t)) { tocZone = true; return false; }
                    if (tocZone) { if (chRe.test(t) || t === '') return false; tocZone = false; }
                    return true;
                });
                setParagraphsFullyLoaded(true);
                setAllParas(filtered);
                savedParaIdxRef.current = recoveredParagraphIdx;
                // 有内容时loading由分页effect跳页完成后关闭——这里提前关会先露出第1页再跳（闪烁）
                if (filtered.length === 0) setReadingLoading(false);
                const freshManifest = await writeChunkedParagraphCache(
                    book.id,
                    filtered,
                    totalParas || rawParas.length,
                    null,
                );
                if (freshManifest && openingBookIdRef.current === book.id) {
                    setParagraphCacheManifest(freshManifest);
                    setBookCacheVersion(freshManifest.cacheVersion);
                    await idbDelParas(legacyParaCacheKey);
                    await idbDelParas(`paras-v1-${book.id}`);
                }
            }
            const payload = await commentsRequest;
            if (payload) {
                const nextComments = (payload.comments || []) as Comment[];
                const nextVersion = Number(payload.comment_version || 1);
                persistCommentCache(book.id, nextComments, nextVersion);
            }
        } catch (e: any) { toast(`加载失败: ${e.message}`); setReadingLoading(false); }
    };

    const lockedHeightRef = useRef<number>(0);
    const lockedWidthRef = useRef<number>(0);
    useLayoutEffect(() => {
        if (mode !== 'reading' || !contentRef.current) return;
        const el = contentRef.current;
        let frame = 0;
        const update = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const width = Math.round(el.clientWidth);
                const rawH = Math.min(el.clientHeight, window.innerHeight);
                const height = Math.max(0, Math.round(
                    rawH - READER_VERTICAL_PADDING_STATIC - getSafeAreaBottom()
                    - readerLayout.topInset - readerLayout.bottomInset,
                ));
                if (lockedHeightRef.current === 0 || Math.abs(width - lockedWidthRef.current) > 2) {
                    lockedWidthRef.current = width;
                    lockedHeightRef.current = height;
                }
                setReaderSize(prev => {
                    if (prev.width === width && prev.height === lockedHeightRef.current) return prev;
                    return { width, height: lockedHeightRef.current };
                });
            });
        };
        update();
        const onResize = () => update();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => onResize()) : null;
        ro?.observe(el);
        window.addEventListener('resize', onResize);
        return () => {
            cancelAnimationFrame(frame);
            ro?.disconnect();
            window.removeEventListener('resize', onResize);
            lockedHeightRef.current = 0;
            lockedWidthRef.current = 0;
        };
    }, [mode, readerLayout.topInset, readerLayout.bottomInset]);

    const readerContentWidth = Math.max(
        1,
        Math.min(readerLayout.maxWidth, readerSize.width - readerLayout.sidePadding * 2),
    );
    const paginationLayoutSignature = [
        globalReaderFont.version,
        globalReaderFont.family,
        readerLayout.fontSize,
        readerLayout.lineHeight,
        readerLayout.letterSpacing,
        readerLayout.paragraphGap,
        readerLayout.textIndent,
        readerLayout.sidePadding,
        readerLayout.maxWidth,
        readerLayout.topInset,
        readerLayout.bottomInset,
        chapterBoundarySignature,
    ].join('-');

    // 同一版式分别保存完整页表、当前窗口和后台检查点。
    // 不能把精确像素拼进key：手机WebView每次打开视口差±几px，key永远miss，导致每次进书全书重新measure。
    // Page tables belong to this device. A local page table is paired with the
    // local text cache and is never blocked by a remote cache-state check.
    const paginationCacheBaseKey = activeBook
        ? `${PAGEBREAK_CACHE_PREFIX}${activeBook.id}-${paginationLayoutSignature}`
        : '';
    const paginationFullCacheKey = paginationCacheBaseKey ? `${paginationCacheBaseKey}-full` : '';
    const paginationWindowCacheKey = paginationCacheBaseKey ? `${paginationCacheBaseKey}-window` : '';
    const paginationCheckpointCacheKey = paginationCacheBaseKey ? `${paginationCacheBaseKey}-checkpoint` : '';
    const legacyPaginationCacheKeys = useMemo(() => activeBook
        ? Array.from(new Set([
            paginationCacheBaseKey,
            `${PAGEBREAK_CACHE_PREFIX}${activeBook.id}-${bookCacheVersion ?? 'offline'}-${paginationLayoutSignature}`,
            `${PAGEBREAK_CACHE_PREFIX}${activeBook.id}-offline-${paginationLayoutSignature}`,
        ].filter(Boolean)))
        : [], [activeBook?.id, bookCacheVersion, paginationCacheBaseKey, paginationLayoutSignature]);
    const imgHeightCache = useRef<Map<string, number>>(new Map());

    const buildMeasureBlock = (para: Paragraph, sourceIdx: number, start: number, end: number) => {
        const heading = isHeading(para.content);
        const chapterTitle = isChapterStartIndex(sourceIdx);
        const outer = document.createElement('div');
        outer.style.marginTop = `${chapterTitle && start === 0 && sourceIdx > 0 ? CHAPTER_GAP_TOP : 0}px`;
        outer.style.marginBottom = `${chapterTitle ? CHAPTER_GAP_BOTTOM : readerLayout.paragraphGap}px`;

        const imgMatch = para.content.match(/^\[IMG:([^\]]+)\]$/);
        if (imgMatch && start === 0) {
            const imgMaxH = Math.floor(readerSize.height * 0.6);
            const cachedH = imgHeightCache.current.get(imgMatch[1]);
            const h = cachedH ? Math.min(cachedH, imgMaxH) : imgMaxH;
            const imgEl = document.createElement('div');
            imgEl.style.height = `${h}px`;
            imgEl.style.width = '100%';
            outer.appendChild(imgEl);
        } else {
            const displayText = stripHeading(para.content).slice(start, end);
            const inner = document.createElement('div');
            inner.textContent = displayText || ' ';
            inner.style.fontFamily = globalReaderFont.family;
            inner.style.fontSize = `${chapterTitle ? readerLayout.fontSize + 4 : para.content.trim().startsWith('# ') ? readerLayout.fontSize + 3 : para.content.trim().startsWith('## ') ? readerLayout.fontSize + 2 : readerLayout.fontSize}px`;
            inner.style.lineHeight = String(chapterTitle ? 2.2 : readerLayout.lineHeight);
            inner.style.letterSpacing = `${chapterTitle ? readerLayout.letterSpacing + 0.7 : readerLayout.letterSpacing}px`;
            inner.style.textIndent = heading || chapterTitle || start > 0 ? '0' : `${readerLayout.textIndent}em`;
            inner.style.fontWeight = String(chapterTitle ? 800 : heading ? 700 : 400);
            inner.style.textAlign = chapterTitle ? 'center' : '';
            inner.style.whiteSpace = 'pre-wrap';
            outer.appendChild(inner);
        }


        return outer;
    };

    useEffect(() => {
        if (mode !== 'reading' || !measureRef.current || allParas.length === 0 || readerContentWidth <= 1 || readerSize.height <= 0) return;
        let cancelled = false;
        const run = async () => {
            await new Promise<void>(r => requestAnimationFrame(() => r()));
            if (cancelled || !measureRef.current) return;

            const measurer = measureRef.current;
            measurer.innerHTML = '';
            measurer.style.width = `${readerContentWidth}px`;
            const maxHeight = Math.max(100, readerSize.height - 8);
            setPageHeight(readerSize.height);
            const paragraphTotal = paragraphCacheManifest?.totalParas ?? allParas.length;
            const progressive = paragraphTotal > PROGRESSIVE_MEASURE_THRESHOLD;
            provisionalRangeRef.current = null;

            // 缓存 miss 时先快速分当前位置附近的临时页；首页也要立即落盘，
            // 这样首次打开后即使后台全书分页被退出动作取消，重开仍能直接进入正文。
            // 立即可读，全书分页随后照常从0跑完后替换
            const anchorIdx0 = savedParaIdxRef.current ?? currentParaIdxRef.current ?? allParas[0]?.idx ?? 0;
            const anchorPi0 = Math.max(0, allParas.findIndex(p => p.idx >= anchorIdx0));
            const useProvisional = progressive && !suppressPageJumpRef.current;

            // Try cache first（IndexedDB 主存；localStorage 里的旧缓存读出后迁移进IDB）
            // Window caches are saved immediately for a far-away reading
            // position. They make a quick close/reopen feel instant while the
            // full-book page table keeps filling in the background.
            let restoredWindowCache = false;
            let resumeCheckpoint: {
                breaks: PageBreak[];
                pi: number;
                off: number;
                cursorY: number;
                anchorLogicalBottom: number;
            } | null = null;
            if (paginationFullCacheKey) {
                try {
                    const readLocalCache = async (key: string) => {
                        let cached = await idbGet(key);
                        if (!cached) {
                            cached = localStorage.getItem(key);
                            if (cached) void idbSet(key, cached);
                        }
                        return cached;
                    };
                    const persistLocalCache = async (key: string, payload: string) => {
                        const idbOk = await idbSet(key, payload);
                        if (!idbOk) {
                            try { localStorage.setItem(key, payload); } catch {}
                        }
                    };
                    const parseCache = (cached: string | null) => {
                        if (!cached) return null;
                        try { return JSON.parse(cached); } catch { return null; }
                    };
                    const sizeMatches = (payload: any) =>
                        typeof payload?.width === 'number'
                        && typeof payload?.height === 'number'
                        && Math.abs(payload.width - readerContentWidth) <= 2
                        && Math.abs(payload.height - readerSize.height) <= 80;

                    // Full is authoritative. Do not even read a window/checkpoint
                    // unless no valid full page table is available.
                    let fullCached = await readLocalCache(paginationFullCacheKey);
                    let legacyWindowCached: string | null = null;
                    let legacyCheckpointCached: string | null = null;
                    if (!fullCached) {
                        for (const legacyKey of legacyPaginationCacheKeys) {
                            const legacyCached = await readLocalCache(legacyKey);
                            if (!legacyCached) continue;
                            const legacyPayload = parseCache(legacyCached);
                            if (legacyPayload?.scope === 'window') {
                                legacyWindowCached ||= legacyCached;
                            } else if (legacyPayload?.scope === 'checkpoint') {
                                legacyCheckpointCached ||= legacyCached;
                            } else if (!fullCached) {
                                fullCached = legacyCached;
                                await persistLocalCache(paginationFullCacheKey, legacyCached);
                            }
                            if (cancelled) return;
                        }
                    }
                    const restoreCachedBreaks = (cachedBreaks: PageBreak[], windowRange: { from: number; to: number } | null) => {
                        const anchorIdx = savedParaIdxRef.current ?? currentParaIdxRef.current ?? allParas[0]?.idx ?? 0;
                        const anchorPi = allParas.findIndex(p => p.idx >= anchorIdx);
                        const windowContainsAnchor = !!windowRange
                            && anchorPi >= windowRange.from
                            && anchorPi < windowRange.to;
                        if (windowRange && !windowContainsAnchor) return false;
                        setPageBreaks(cachedBreaks);
                        setTotalPages(Math.max(1, cachedBreaks.length));
                        if (!suppressPageJumpRef.current) {
                            const pi = windowRange ? anchorPi : allParas.findIndex(p => p.idx >= anchorIdx);
                            let targetPage = 0;
                            if (pi >= 0) {
                                for (let i = cachedBreaks.length - 1; i >= 0; i--) {
                                    if (cachedBreaks[i].paraIndex <= pi) { targetPage = i; break; }
                                }
                            }
                            setPage(Math.max(1, Math.min(cachedBreaks.length, targetPage + 1)));
                        }
                        savedParaIdxRef.current = null;
                        setReadingLoading(false);
                        return true;
                    };

                    const fullPayload = parseCache(fullCached);
                    if (fullPayload?.scope !== 'window'
                        && fullPayload?.scope !== 'checkpoint'
                        && sizeMatches(fullPayload)
                        && fullPayload.paraCount === paragraphTotal
                        && Array.isArray(fullPayload.breaks)
                        && fullPayload.breaks.length > 0) {
                        provisionalRangeRef.current = null;
                        restoreCachedBreaks(fullPayload.breaks, null);
                        setPaginateProgress(null);
                        return;
                    }

                    // A complete paragraph cache is the manifest plus every
                    // persisted chunk. Only hydrate it when the full page table
                    // is genuinely absent; the normal reopen path stays on the
                    // three-chunk reading window.
                    if (activeBook && paragraphCacheManifest && !paragraphsFullyLoaded) {
                        const hydrated = await hydrateAllParagraphs(activeBook.id, paragraphCacheManifest);
                        if (cancelled) return;
                        if (!hydrated) {
                            toast('本机正文分片不完整，请清除本机书籍缓存后重新打开');
                            setReadingLoading(false);
                            setPaginateProgress(null);
                            return;
                        }
                        setAllParas(hydrated);
                        setParagraphsFullyLoaded(true);
                        return;
                    }

                    let [windowCached, checkpointCached] = await Promise.all([
                        readLocalCache(paginationWindowCacheKey),
                        readLocalCache(paginationCheckpointCacheKey),
                    ]);
                    if (cancelled) return;
                    if (!windowCached && legacyWindowCached) {
                        windowCached = legacyWindowCached;
                        await persistLocalCache(paginationWindowCacheKey, legacyWindowCached);
                    }
                    if (!checkpointCached && legacyCheckpointCached) {
                        checkpointCached = legacyCheckpointCached;
                        await persistLocalCache(paginationCheckpointCacheKey, legacyCheckpointCached);
                    }

                    const checkpointPayload = parseCache(checkpointCached);
                    if (checkpointPayload?.scope === 'checkpoint'
                        && sizeMatches(checkpointPayload)
                        && checkpointPayload.paraCount === paragraphTotal
                        && Array.isArray(checkpointPayload.breaks)
                        && checkpointPayload.breaks.length > 0
                        && Number.isInteger(checkpointPayload.pi)
                        && checkpointPayload.pi > 0
                        && checkpointPayload.pi < paragraphTotal
                        && checkpointPayload.off === 0
                        && Number.isFinite(checkpointPayload.cursorY)
                        && Number.isFinite(checkpointPayload.anchorLogicalBottom)) {
                        resumeCheckpoint = {
                            breaks: checkpointPayload.breaks,
                            pi: checkpointPayload.pi,
                            off: 0,
                            cursorY: checkpointPayload.cursorY,
                            anchorLogicalBottom: checkpointPayload.anchorLogicalBottom,
                        };
                    }

                    const windowPayload = parseCache(windowCached);
                    const windowRange = windowPayload?.scope === 'window'
                        && Number.isInteger(windowPayload.range?.from)
                        && Number.isInteger(windowPayload.range?.to)
                        ? { from: Number(windowPayload.range.from), to: Number(windowPayload.range.to) }
                        : null;
                    if (windowRange
                        && sizeMatches(windowPayload)
                        && windowPayload.paraCount === paragraphTotal
                        && Array.isArray(windowPayload.breaks)
                        && windowPayload.breaks.length > 0
                        && restoreCachedBreaks(windowPayload.breaks, windowRange)) {
                        restoredWindowCache = true;
                        provisionalRangeRef.current = windowRange;
                    }
                    if (!restoredWindowCache && progressive) {
                        toast(useProvisional
                            ? '首次建立本机分页缓存，先打开当前位置，后台继续补全'
                            : '首次建立本机完整分页缓存');
                    }
                    if (resumeCheckpoint) {
                        setPaginateProgress(Math.min(0.99, resumeCheckpoint.pi / paragraphTotal));
                    }
                } catch {}
            }

            if (activeBook && allParas.length <= PROGRESSIVE_MEASURE_THRESHOLD) {
                const imgParas = allParas.filter(p => /^\[IMG:([^\]]+)\]$/.test(p.content));
                const loadPromises = imgParas.map(p => {
                    const m = p.content.match(/^\[IMG:([^\]]+)\]$/);
                    if (!m || imgHeightCache.current.has(m[1])) return Promise.resolve();
                    return new Promise<void>(resolve => {
                        const img = new Image();
                        img.onload = () => {
                            const maxW = readerContentWidth;
                            const maxH = Math.floor(readerSize.height * 0.6);
                            const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
                            imgHeightCache.current.set(m![1], img.naturalHeight * scale);
                            resolve();
                        };
                        img.onerror = () => resolve();
                        img.src = api.imageUrl(activeBook!.id, m[1]);
                    });
                });
                await Promise.all(loadPromises);
            }
            if (cancelled || !measureRef.current) return;

            const breaks: PageBreak[] = resumeCheckpoint
                ? resumeCheckpoint.breaks.slice()
                : [{ paraIndex: 0, offset: 0 }];

            // 连续排版 → 每块一次 layout，之后几何读取走缓存（layout 干净时读 rect 零 reflow）。
            // 旧算法逐段试塞，每段一次同步reflow，几千段=首开十几秒。
            // 切点全部落在行边界，所以续段在下一页重排时断行不变，几何坐标保持连续。
            // 大书（>PROGRESSIVE_MEASURE_THRESHOLD 段）分块挂载测量：块间让出主线程并更新进度，
            // 避免十几万段一次性 append 的内存峰值与长时间卡死；跨块用锚点段对齐逻辑纵坐标。
            const chapterTopGap = (i: number) =>
                isChapterStartIndex(i) && i > 0 ? CHAPTER_GAP_TOP : 0;

            const measureRange = document.createRange();

            let blocks: HTMLElement[] = [];
            let blockRects: DOMRect[] = [];
            let chunkBase = 0;    // 当前块首段的数组下标
            let blockOffset = 0;  // 锚点段占位（1）或无（0）
            let rectShift = 0;    // 逻辑纵坐标 = DOM rect 读数 + rectShift
            let chunkEnd = 0;     // 当前块末段下标（不含）

            const blockIdx = (i: number) => i - chunkBase + blockOffset;
            const rectBottom = (i: number) => blockRects[blockIdx(i)].bottom + rectShift;
            const rectTop = (i: number) => blockRects[blockIdx(i)].top + rectShift;

            // 挂载 [from, from+MEASURE_CHUNK) 的测量块；anchorIdx=上一块末段（保留在容器顶做新旧坐标系对齐）
            const mountChunk = (from: number, anchorIdx: number | null, anchorLogicalBottom: number | null) => {
                measurer.innerHTML = '';
                blocks = [];
                if (anchorIdx != null && anchorIdx >= 0 && anchorIdx < from) {
                    const t0 = stripHeading(allParas[anchorIdx].content);
                    blocks.push(buildMeasureBlock(allParas[anchorIdx], anchorIdx, 0, t0.length));
                }
                blockOffset = blocks.length;
                const to = Math.min(allParas.length, from + MEASURE_CHUNK);
                for (let i = from; i < to; i++) {
                    const t = stripHeading(allParas[i].content);
                    blocks.push(buildMeasureBlock(allParas[i], i, 0, t.length));
                }
                for (const b of blocks) measurer.appendChild(b);
                blockRects = blocks.map(b => b.getBoundingClientRect());
                chunkBase = from;
                if (anchorIdx != null && anchorLogicalBottom != null && blockRects.length > 0) {
                    rectShift = anchorLogicalBottom - blockRects[0].bottom;
                }
            };

            const innerTextNode = (i: number): Text | null => {
                const inner = blocks[blockIdx(i)]?.firstElementChild;
                const node = inner?.firstChild;
                return node && node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
            };

            // 前o个字符的包络底（逻辑纵坐标，单调递增），layout干净时读rect零reflow
            const bottomAt = (textNode: Text, o: number) => {
                measureRange.setStart(textNode, 0);
                measureRange.setEnd(textNode, Math.min(o, textNode.length));
                return measureRange.getBoundingClientRect().bottom + rectShift;
            };
            // 排满到limitY的最大行尾offset；一行都放不下返回0
            const lineCut = (i: number, limitY: number): number => {
                const textNode = innerTextNode(i);
                if (!textNode || textNode.length === 0) return 0;
                const len = textNode.length;
                if (bottomAt(textNode, len) <= limitY) return len;
                let lo = 1, hi = len, best = 0;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (bottomAt(textNode, mid) <= limitY) { best = mid; lo = mid + 1; }
                    else hi = mid - 1;
                }
                return best;
            };

            let pi = resumeCheckpoint?.pi ?? 0;
            let off = resumeCheckpoint?.off ?? 0;
            let cursorY = resumeCheckpoint?.cursorY ?? 0;
            let lastCheckpointPi = resumeCheckpoint?.pi ?? 0;

            // 段 i 不在已挂载块内时换块：保留 i-1 段做锚点，逻辑纵坐标无缝接续；大书块间让出主线程
            const ensureChunk = async (i: number): Promise<boolean> => {
                if (i >= allParas.length || i < chunkEnd) return true;
                const anchorLogicalBottom = i > 0 ? rectBottom(i - 1) : 0;
                if (progressive) {
                    setPaginateProgress(Math.min(0.99, i / allParas.length));
                    if (paginationCheckpointCacheKey
                        && off === 0
                        && i - lastCheckpointPi >= PAGINATION_CHECKPOINT_STRIDE) {
                        const payload = JSON.stringify({
                            scope: 'checkpoint',
                            breaks,
                            pi: i,
                            off: 0,
                            cursorY,
                            anchorLogicalBottom,
                            paraCount: paragraphTotal,
                            width: readerContentWidth,
                            height: readerSize.height,
                            cacheVersion: bookCacheVersion,
                        });
                        const idbOk = await idbSet(paginationCheckpointCacheKey, payload);
                        if (!idbOk) {
                            try { localStorage.setItem(paginationCheckpointCacheKey, payload); } catch {}
                        }
                        lastCheckpointPi = i;
                    }
                    await new Promise<void>(r => setTimeout(r, 0));
                    if (cancelled || !measureRef.current) return false;
                }
                mountChunk(i, i > 0 ? i - 1 : null, anchorLogicalBottom);
                chunkEnd = i + blocks.length - blockOffset;
                return true;
            };

            // 后手优化：临时页只按段界切（不做段中切分），与最终页表允许有出入，很快会被全书分页替换
            let provisionalShown = restoredWindowCache;
            if (useProvisional && !restoredWindowCache) {
                const wFrom = Math.max(0, anchorPi0 - PROVISIONAL_WIN);
                const wTo = Math.min(allParas.length, anchorPi0 + PROVISIONAL_WIN);
                const wb: PageBreak[] = [{ paraIndex: wFrom, offset: 0 }];
                let i = wFrom;
                let wCursor = 0;
                let wGuard = 0;
                while (i < wTo && wGuard++ < 10000) {
                    if (i >= chunkEnd) {
                        mountChunk(i, i > wFrom ? i - 1 : null, i > wFrom ? rectBottom(i - 1) : 0);
                        chunkEnd = i + blocks.length - blockOffset;
                        if (i === wFrom) wCursor = rectTop(wFrom) - chapterTopGap(wFrom);
                        await new Promise<void>(r => setTimeout(r, 0)); // 块间让出主线程
                        if (cancelled || !measureRef.current) return;
                        continue;
                    }
                    const limitY = wCursor + maxHeight + 1;
                    let pageHasContent = false;
                    while (i < chunkEnd && i < wTo) {
                        if (i > wFrom && isChapterStartIndex(i) && pageHasContent) break;
                        if (rectBottom(i) <= limitY) { i++; pageHasContent = true; continue; }
                        // 整段/图片放不下：空页硬放（防死循环），否则推下一页
                        if (!pageHasContent) { i++; }
                        break;
                    }
                    if (i >= wTo || i >= chunkEnd) continue;
                    if (wb[wb.length - 1].paraIndex === i) break; // 没推进，防死循环
                    wb.push({ paraIndex: i, offset: 0 });
                    wCursor = rectTop(i) - chapterTopGap(i);
                }
                if (wb.length > 1) {
                    provisionalShown = true;
                    provisionalRangeRef.current = { from: wFrom, to: wTo };
                    setPageBreaks(wb);
                    setTotalPages(Math.max(1, wb.length));
                    let tp = 0;
                    for (let k = wb.length - 1; k >= 0; k--) { if (wb[k].paraIndex <= anchorPi0) { tp = k; break; } }
                    setPage(tp + 1);
                    savedParaIdxRef.current = null; // 锚点已用掉，全书分页完成时按实时阅读位置重映射
                    if (paginationWindowCacheKey) {
                        const payload = JSON.stringify({
                            breaks: wb,
                            paraCount: paragraphTotal,
                            width: readerContentWidth,
                            height: readerSize.height,
                            cacheVersion: bookCacheVersion,
                            scope: 'window',
                            range: { from: wFrom, to: wTo },
                        });
                        const idbOk = await idbSet(paginationWindowCacheKey, payload);
                        if (!idbOk) {
                            try { localStorage.setItem(paginationWindowCacheKey, payload); } catch {}
                        }
                        if (cancelled) return;
                    }
                    setReadingLoading(false); // 局部页表已持久化后立即可读；全书分页下面照常跑
                }
            }

            if (resumeCheckpoint) {
                mountChunk(pi, pi > 0 ? pi - 1 : null, resumeCheckpoint.anchorLogicalBottom);
                chunkEnd = pi + blocks.length - blockOffset;
            } else {
                mountChunk(0, null, null);
                chunkEnd = blocks.length;
                cursorY = blocks.length ? rectTop(0) - chapterTopGap(0) : 0;
            }
            if (progressive) setPaginateProgress(Math.min(0.99, pi / allParas.length));
            let guard = 0;
            while (pi < allParas.length && guard++ < 100000) {
                if (!(await ensureChunk(pi))) return;
                const limitY = cursorY + maxHeight + 1; // +1对齐旧算法的subpixel容差
                let pageHasContent = false;
                while (pi < chunkEnd && pi < allParas.length) {
                    const isImg = /^\[IMG:[^\]]+\]$/.test(allParas[pi].content);
                    if (off === 0 && pi > 0 && isChapterStartIndex(pi) && pageHasContent) break;
                    if (rectBottom(pi) <= limitY) {
                        pi++; off = 0; pageHasContent = true; continue;
                    }
                    if (isImg) {
                        // 图片不可拆；单独成页也放不下就硬放（imgMaxH≤0.6页高，实际必放得下）
                        if (!pageHasContent) { pi++; off = 0; pageHasContent = true; }
                        break;
                    }
                    const cut = lineCut(pi, limitY);
                    if (cut <= off) break; // 一行都进不来，整段推下页
                    if (cut >= (innerTextNode(pi)?.length ?? 0)) { // 文本全放下了（块底差subpixel）
                        pi++; off = 0; pageHasContent = true; continue;
                    }
                    // widow control: 段从头开始且只塞得下<4字且页内已有内容 → 整段推下页
                    if (off === 0 && cut < 4 && pageHasContent) break;
                    off = cut;
                    pageHasContent = true;
                    break;
                }
                if (pi >= allParas.length) break;
                if (pi >= chunkEnd) continue; // 块用完但页未填满：换块（ensureChunk）后继续填当前页
                const last = breaks[breaks.length - 1];
                if (last.paraIndex === pi && last.offset === off) break; // 没推进，防死循环
                breaks.push({ paraIndex: pi, offset: off });
                if (off > 0) {
                    // 段中切点：下一页顶=切点字符所在行的top
                    const textNode = innerTextNode(pi)!;
                    measureRange.setStart(textNode, Math.min(off, textNode.length));
                    measureRange.setEnd(textNode, Math.min(off + 1, textNode.length));
                    cursorY = measureRange.getBoundingClientRect().top + rectShift;
                } else {
                    cursorY = rectTop(pi) - chapterTopGap(pi);
                }
            }
            measurer.innerHTML = ''; // 测量节点用完即清

            if (cancelled) return;
            provisionalRangeRef.current = null; // 最终页表替换临时页表，解除窗外跳转拦截
            setPageBreaks(breaks);
            setTotalPages(Math.max(1, breaks.length));
            if (paginationFullCacheKey) {
                const payload = JSON.stringify({
                    breaks, paraCount: paragraphTotal,
                    width: readerContentWidth, height: readerSize.height,
                    cacheVersion: bookCacheVersion,
                });
                // 清掉旧版精确像素key（pagebreaks-id-w-h），防localStorage堆积
                try {
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                        const k = localStorage.key(i);
                        if (k && (k.startsWith('pagebreaks-v1-') || k.startsWith('pagebreaks-v2-'))) localStorage.removeItem(k);
                    }
                } catch {}
                // 主存 IndexedDB（配额足够，大书几百KB没问题）；写成功后清掉 localStorage 旧副本释放配额
                const idbOk = await idbSet(paginationFullCacheKey, payload);
                if (cancelled) return;
                let fullPersisted = idbOk;
                if (idbOk) {
                    try { localStorage.removeItem(paginationFullCacheKey); } catch {}
                } else {
                    // 后手：IDB 不可用（隐私模式/老WebView）退回 localStorage；
                    // 配额满（大书缓存约几百KB，多本累计可能超限）则清掉其它书的分页缓存重试一次
                    try {
                        localStorage.setItem(paginationFullCacheKey, payload);
                        fullPersisted = true;
                    } catch {
                        try {
                            for (let i = localStorage.length - 1; i >= 0; i--) {
                                const k = localStorage.key(i);
                                if (k && (k.startsWith('pagebreaks-v1-') || k.startsWith('pagebreaks-v2-'))) localStorage.removeItem(k);
                            }
                            localStorage.setItem(paginationFullCacheKey, payload);
                            fullPersisted = true;
                        } catch {}
                    }
                }
                if (fullPersisted) {
                    await Promise.all([
                        idbDel(paginationWindowCacheKey),
                        idbDel(paginationCheckpointCacheKey),
                    ]);
                    try {
                        localStorage.removeItem(paginationWindowCacheKey);
                        localStorage.removeItem(paginationCheckpointCacheKey);
                    } catch {}
                } else {
                    toast('完整分页已算完，但本机缓存写入失败；已保留续算检查点');
                }
            }
            if (!suppressPageJumpRef.current) {
                const anchorIdx = savedParaIdxRef.current ?? currentParaIdxRef.current ?? allParas[0]?.idx ?? 0;
                const targetPage = (() => {
                    const pi = allParas.findIndex(p => p.idx >= anchorIdx);
                    if (pi < 0) return 0;
                    for (let i = breaks.length - 1; i >= 0; i--) if (breaks[i].paraIndex <= pi) return i;
                    return 0;
                })();
                setPage(Math.max(1, Math.min(breaks.length, targetPage + 1)));
            }
            savedParaIdxRef.current = null;
            setPaginateProgress(null);
            setReadingLoading(false);
            if (provisionalShown) toast('全书分页已完成');
            if (activeBook && paragraphCacheManifest && paragraphsFullyLoaded) {
                const currentIdx = currentParaIdxRef.current ?? allParas[0]?.idx ?? 0;
                const sourceIdx = Math.max(0, sourceIndexForParagraphIdx(currentIdx));
                if (await loadParagraphWindow(activeBook.id, paragraphCacheManifest, sourceIdx)) {
                    setAllParas(paragraphCacheManifest.paragraphIndices.map(idx => ({ idx, content: '' })));
                    setParagraphsFullyLoaded(false);
                }
            }
        };
        run();
        return () => { cancelled = true; };
    }, [
        mode,
        allParas,
        readerContentWidth,
        readerSize.height,
        paginationFullCacheKey,
        paginationWindowCacheKey,
        paginationCheckpointCacheKey,
        paginationLayoutSignature,
        paragraphCacheManifest,
        paragraphsFullyLoaded,
    ]);

    useEffect(() => {
        if (readingLoading) return;
        if (allParas.length === 0 || pageBreaks.length === 0) {
            setPageFragments([]);
            setParagraphs([]);
            setComments([]);
            currentParaIdxRef.current = null;
            return;
        }
        if (page > pageBreaks.length && !suppressPageJumpRef.current) {
            setPage(pageBreaks.length);
            return;
        }
        const start = pageBreaks[page - 1] || { paraIndex: 0, offset: 0 };
        const end = page < pageBreaks.length ? pageBreaks[page] : { paraIndex: allParas.length, offset: 0 };
        if (activeBook && paragraphCacheManifest && !paragraphsFullyLoaded) {
            const firstMissing = (() => {
                for (let i = start.paraIndex; i < end.paraIndex || (i === end.paraIndex && end.offset > 0); i++) {
                    if (!paragraphAt(i)) return i;
                }
                return -1;
            })();
            if (firstMissing >= 0) {
                void loadParagraphWindow(activeBook.id, paragraphCacheManifest, firstMissing);
                return;
            }
        }
        const fragments: PageFragment[] = [];
        for (let i = start.paraIndex; i < end.paraIndex || (i === end.paraIndex && end.offset > 0); i++) {
            const para = paragraphAt(i);
            if (!para) continue;
            const text = stripHeading(para.content);
            const from = i === start.paraIndex ? start.offset : 0;
            const to = i === end.paraIndex ? end.offset : text.length;
            if (to <= from) continue;
            fragments.push({ ...para, content: text.slice(from, to), sourceIdx: i, startOffset: from, endOffset: to, isPartialStart: from > 0, isPartialEnd: to < text.length });
        }
        setPageFragments(fragments);
        const visibleParas = fragments.map(f => paragraphAt(f.sourceIdx)).filter(Boolean) as Paragraph[];
        setParagraphs(visibleParas);
        setComments(allComments);
        currentParaIdxRef.current = visibleParas[0]?.idx ?? null;
        if (activeBook && visibleParas.length > 0) {
            const paragraphIdx = visibleParas[0].idx;
            rememberReadingProgress(activeBook.id, paragraphIdx);
        }
    }, [
        page,
        pageBreaks,
        allParas,
        allComments,
        activeBook?.id,
        tocChapters,
        paragraphCacheManifest,
        paragraphsFullyLoaded,
        paragraphChunkRevision,
        readingLoading,
    ]);

    const getChapterPageRange = (chapterIdx: number) => {
        if (chapterIdx < 0 || !tocChapters.length) return { start: 1, end: totalPages };
        const chapter = tocChapters[chapterIdx];
        const chapterPage = findPageForParaIdx(chapter.idx ?? chapter.start_idx ?? chapter.page);
        const startPage = Math.max(1, chapterPage >= 0 ? chapterPage + 1 : chapter.page);
        let nextStartPage = totalPages + 1;
        for (let index = chapterIdx + 1; index < tocChapters.length; index++) {
            const nextChapter = tocChapters[index];
            const visualPage = findPageForParaIdx(nextChapter.idx ?? nextChapter.start_idx ?? nextChapter.page);
            const candidate = visualPage >= 0 ? visualPage + 1 : nextChapter.page;
            if (candidate > startPage) {
                nextStartPage = candidate;
                break;
            }
        }
        return { start: startPage, end: Math.max(startPage, Math.min(totalPages, nextStartPage - 1)) };
    };

    const adjacentChapterPage = (direction: -1 | 1) => {
        if (!tocChapters.length) return Math.max(1, Math.min(totalPages, page + direction));
        if (direction < 0) {
            for (let index = Math.min(currentChapterIdx - 1, tocChapters.length - 1); index >= 0; index--) {
                const range = getChapterPageRange(index);
                if (range.start < page) return Math.max(range.start, Math.min(page - 1, range.end));
            }
            return Math.max(1, page - 1);
        }
        for (let index = Math.max(0, currentChapterIdx + 1); index < tocChapters.length; index++) {
            const range = getChapterPageRange(index);
            if (range.start > page) return range.start;
        }
        return Math.min(totalPages, page + 1);
    };

    const goPage = (delta: number) => {
        if (!activeBook) return;
        closeReadingMenu();
        const range = getChapterPageRange(currentChapterIdx);
        let next = page + delta;
        if (delta < 0 && page <= range.start && currentChapterIdx > 0) {
            next = adjacentChapterPage(-1);
        } else if (delta > 0 && page >= range.end && currentChapterIdx >= 0 && currentChapterIdx < tocChapters.length - 1) {
            next = adjacentChapterPage(1);
        }
        next = Math.max(1, Math.min(totalPages, next));
        if (next !== page) {
            setPageTurnDirection(next > page ? 'forward' : 'backward');
            setPageTurnNonce(value => value + 1);
            setActiveComments([]); setCommentingIdx(null); setSelRange(null); setFloatingBar(null);
            setPage(next);
            if (next === totalPages && totalPages > 1) {
                const bookTitle = activeBook.title?.replace(/\s*\(.*?\)\s*/g, '').trim();
                fetch(`${API_BASE}/v1/reading-wishlist`).then(r => r.json()).then(res => {
                    const match = (res.items || []).find((w: any) => w.status === 'reading' && w.title?.trim() === bookTitle);
                    if (match) {
                        fetch(`${API_BASE}/v1/reading-wishlist`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: match.id, title: match.title, author: match.author, reason: match.reason, status: 'done' }),
                        }).catch(() => {});
                    }
                }).catch(() => {});
            }
        }
    };

    const openCurrentPageAnnotations = () => {
        const visibleParagraphs = new Set(pageFragments.map(fragment => Number(fragment.idx)));
        const pageComments = allComments.filter(comment =>
            comment.annotation_kind !== 'wavy_underline' && visibleParagraphs.has(Number(comment.paragraph_idx))
        );
        setShowMoreMenu(false);
        if (allComments.some(comment =>
            comment.annotation_kind === 'wavy_underline' && visibleParagraphs.has(Number(comment.paragraph_idx))
        )) {
            setShowAnnotationList('page');
            return;
        }
        if (pageComments.length) {
            openCommentDetails(pageComments);
        }
        else toast('当前页还没有批注');
    };

    const commentChapterIndex = (comment: Comment) => {
        let chapterIndex = -1;
        for (let index = 0; index < tocChapters.length; index++) {
            const chapter = tocChapters[index];
            const nextChapter = tocChapters[index + 1];
            const start = Number(chapter.idx ?? chapter.page);
            const end = nextChapter ? Number(nextChapter.idx ?? nextChapter.page) - 1 : Number.MAX_SAFE_INTEGER;
            const paragraphIdx = Number(comment.paragraph_idx);
            if (paragraphIdx >= start && paragraphIdx <= end) chapterIndex = index;
            else if (paragraphIdx < start) break;
        }
        return chapterIndex;
    };

    const commentThread = (seed: Comment, pool = allComments) => {
        if (seed.thread_key) {
            return sortCommentTimeline(pool.filter(comment =>
                comment.annotation_kind !== 'wavy_underline' && comment.thread_key === seed.thread_key
            ));
        }
        const thread = new Map<number, Comment>([[seed.id, seed]]);
        const pending = [seed.id];
        while (pending.length) {
            const parentId = pending.pop()!;
            for (const comment of pool) {
                if (comment.reply_to === parentId && !thread.has(comment.id)) {
                    thread.set(comment.id, comment);
                    pending.push(comment.id);
                }
            }
        }
        if (seed.reply_to != null) {
            const parent = pool.find(comment => comment.id === seed.reply_to);
            if (parent && !thread.has(parent.id)) {
                thread.set(parent.id, parent);
                for (const comment of commentThread(parent, pool)) thread.set(comment.id, comment);
            }
        }
        return sortCommentTimeline(Array.from(thread.values()));
    };

    const prepareAdditionalComment = (seed?: Comment | null) => {
        if (!seed || seed.annotation_kind === 'wavy_underline') return;
        replyPageRef.current = page;
        setReplyingTo(null);
        setNewCommentThreadKey(seed.thread_key || null);
        setCommentingIdx(Number(seed.paragraph_idx));
        setSelectedText(seed.selected_text || '');
        setSelRange(seed.sel_start_idx != null && seed.sel_end_idx != null
            ? {
                startPara: Number(seed.paragraph_idx),
                endPara: seed.sel_end_para_idx != null ? Number(seed.sel_end_para_idx) : Number(seed.paragraph_idx),
                start: Number(seed.sel_start_idx),
                end: Number(seed.sel_end_idx),
            }
            : null);
        setCommentText('');
    };

    const openAnnotationList = () => {
        setShowMoreMenu(false);
        setShowBar(false);
        closeCommentDetails();
        setShowAnnotationList('chapter');
    };

    const jumpToComment = (comment: Comment) => {
        if (!canJumpToPara(Number(comment.paragraph_idx))) return;
        const targetPage = findPageForParaIdx(Number(comment.paragraph_idx), totalPages, Number(comment.sel_start_idx) || 0);
        if (targetPage < 0) return;
        setShowAnnotationList(null);
        setPage(targetPage + 1);
        if (comment.annotation_kind === 'wavy_underline') {
            closeCommentDetails();
        } else {
            openCommentDetails(commentThread(comment));
        }
    };

    const favoriteGroups = useMemo(() => {
        const groups = new Map<number, { bookId: number; bookTitle: string; comments: FavoriteComment[] }>();
        for (const comment of favoriteComments) {
            const existing = groups.get(comment.book_id);
            if (existing) existing.comments.push(comment);
            else groups.set(comment.book_id, { bookId: comment.book_id, bookTitle: comment.book_title, comments: [comment] });
        }
        return Array.from(groups.values());
    }, [favoriteComments]);

    const openFavorites = async () => {
        setShowFavorites(true);
        setFavoritesLoading(true);
        setFavoriteDetailId(null);
        try {
            const data = await api.fetchFavoriteComments();
            setFavoriteComments(Array.isArray(data.favorites) ? data.favorites : []);
            setExpandedFavoriteBooks(new Set(Array.isArray(data.favorites) && data.favorites.length === 1 ? [data.favorites[0].book_id] : []));
        } catch (error: any) {
            toast(`读取收藏失败: ${error?.message || '未知错误'}`);
        } finally {
            setFavoritesLoading(false);
        }
    };

    const openFavoriteComment = (comment: FavoriteComment) => {
        const book = books.find(item => item.id === comment.book_id);
        if (!book) {
            toast('这本书不在当前书架中，刷新书架后再试');
            return;
        }
        setShowFavorites(false);
        setPendingFavoriteJump({
            bookId: comment.book_id,
            commentId: comment.id,
            paragraphIdx: Number(comment.paragraph_idx),
            startOffset: Number(comment.sel_start_idx) || 0,
        });
        openBook(book);
    };

    useEffect(() => {
        if (!pendingFavoriteJump || !activeBook || activeBook.id !== pendingFavoriteJump.bookId || readingLoading || !allParas.length || !pageBreaks.length) return;
        if (!canJumpToPara(pendingFavoriteJump.paragraphIdx)) return;
        const targetPage = findPageForParaIdx(pendingFavoriteJump.paragraphIdx, totalPages, pendingFavoriteJump.startOffset);
        if (targetPage < 0) return;
        const comment = allComments.find(item => item.id === pendingFavoriteJump.commentId);
        setPage(targetPage + 1);
        if (comment) {
            openCommentDetails(commentThread(comment));
        }
        setPendingFavoriteJump(null);
    }, [pendingFavoriteJump, activeBook?.id, readingLoading, allParas, allComments, pageBreaks, totalPages]);

    const readerTapTimerRef = useRef<number | null>(null);
    const readerTapPendingRef = useRef<{ x: number; y: number; time: number } | null>(null);
    const readerTapHandledByPointerRef = useRef(false);

    const queueReaderTap = (x: number, y: number, width: number) => {
        const now = Date.now();
        const pending = readerTapPendingRef.current;

        if (readerTapTimerRef.current !== null && pending && now - pending.time <= 360) {
            window.clearTimeout(readerTapTimerRef.current);
            readerTapTimerRef.current = null;
            readerTapPendingRef.current = null;
            openReaderPanel('typography');
            setShowBar(true);
            return;
        }

        readerTapPendingRef.current = { x, y, time: now };
        readerTapTimerRef.current = window.setTimeout(() => {
            readerTapTimerRef.current = null;
            const tap = readerTapPendingRef.current;
            readerTapPendingRef.current = null;
            if (!tap) return;
            goPage(tap.x < width * 0.5 ? -1 : 1);
        }, 280);
    };

    const handleReaderSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (mode !== 'reading') {
            if (activeComments.length) closeCommentDetails();
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, textarea, select, a, [contenteditable="true"], [data-reader-control], [data-reader-panel]')) return;
        if (Date.now() < selectionGestureLockUntil.current) return;
        if (window.getSelection()?.toString().trim()) return;
        if (activeComments.length > 0 || commentingIdx !== null) {
            closeCommentDetails();
            setFloatingBar(null);
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        if (!rect.width) return;
        // 某些 Android WebView 在 pointer capture + touch-action:none 下不会稳定派发 click。
        // click 仍作为兜底，但真正的单/双击判定也会在 pointerup 中执行。
        if (readerTapHandledByPointerRef.current) {
            readerTapHandledByPointerRef.current = false;
            return;
        }
        queueReaderTap(event.clientX - rect.left, event.clientY - rect.top, rect.width);
    };

    useEffect(() => () => {
        if (readerTapTimerRef.current !== null) window.clearTimeout(readerTapTimerRef.current);
    }, []);

    useEffect(() => {
        if (!readerTapHandledByPointerRef.current) return;
        const id = window.setTimeout(() => { readerTapHandledByPointerRef.current = false; }, 500);
        return () => window.clearTimeout(id);
    });

    const startAnnotation = () => {
        replyPageRef.current = page;
        if (!floatingBar) return;
        setSelRange({ startPara: floatingBar.startPara, endPara: floatingBar.endPara, start: floatingBar.start, end: floatingBar.end });
        setSelectedText(floatingBar.text);
        setNewCommentThreadKey(null);
        setCommentingIdx(floatingBar.startPara);
        setFloatingBar(null);
        window.getSelection()?.removeAllRanges();
    };

    const copySelection = async () => {
        if (!floatingBar?.text) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(floatingBar.text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = floatingBar.text;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                const copied = document.execCommand('copy');
                textarea.remove();
                if (!copied) throw new Error('clipboard unavailable');
            }
            toast('已复制选中文字');
        } catch {
            toast('复制失败，请检查浏览器剪贴板权限');
        } finally {
            setFloatingBar(null);
            window.getSelection()?.removeAllRanges();
        }
    };

    const addWavyUnderline = async () => {
        if (!activeBook || !floatingBar) return;
        const selection = floatingBar;
        try {
            const result = await api.addBookComment(activeBook.id, {
                paragraph_idx: selection.startPara,
                selected_text: selection.text,
                sel_start_idx: selection.start,
                sel_end_idx: selection.end,
                sel_end_para_idx: selection.endPara !== selection.startPara ? selection.endPara : undefined,
                from_who: humanName,
                content: '',
                annotation_kind: 'wavy_underline',
            });
            const underline: Comment = {
                id: result?.id ?? Date.now(),
                book_id: activeBook.id,
                paragraph_idx: selection.startPara,
                sel_start_idx: selection.start,
                sel_end_idx: selection.end,
                sel_end_para_idx: selection.endPara !== selection.startPara ? selection.endPara : null,
                selected_text: selection.text,
                from_who: humanName,
                content: '',
                annotation_kind: 'wavy_underline',
                created_at: new Date().toISOString(),
                reply_to: null,
            };
            persistCommentCache(activeBook.id, [...allCommentsRef.current, underline], result?.comment_version);
            toast('已添加波浪线');
        } catch (error: any) {
            toast(`波浪线添加失败: ${error?.message || '未知错误'}`);
        } finally {
            setFloatingBar(null);
            window.getSelection()?.removeAllRanges();
        }
    };

    const handleAddComment = async (wakeModel = false) => {
        if (!activeBook || commentingIdx === null || !commentText.trim()) return;
        try {
            const pendingText = commentText.trim();
            const composerSeed = activeComments.find(comment => comment.selected_text) || activeComments[0] || null;
            const wasReply = Boolean(replyingTo);
            const result = await api.addBookComment(activeBook.id, {
                paragraph_idx: commentingIdx, content: pendingText, from_who: humanName,
                selected_text: selectedText || undefined,
                sel_start_idx: selRange ? selRange.start : undefined,
                sel_end_idx: selRange ? selRange.end : undefined,
                sel_end_para_idx: selRange && selRange.endPara !== selRange.startPara ? selRange.endPara : undefined,
                reply_to: replyingTo?.id || undefined,
                thread_key: !replyingTo ? newCommentThreadKey || undefined : undefined,
            } as any);
            const newComment: Comment = result?.comment || {
                id: result?.id ?? Date.now(), book_id: activeBook.id, paragraph_idx: commentingIdx,
                sel_start_idx: selRange?.start ?? null, sel_end_idx: selRange?.end ?? null,
                sel_end_para_idx: selRange && selRange.endPara !== selRange.startPara ? selRange.endPara : null,
                selected_text: selectedText || null, from_who: humanName,
                content: pendingText, created_at: new Date().toISOString(), reply_to: replyingTo?.id ?? null,
                thread_key: result?.thread_key ?? newCommentThreadKey,
            };
            let nextAllComments = Array.from(new Map(
                [...allCommentsRef.current, newComment].map(item => [item.id, item]),
            ).values());
            const pageToRestore = replyPageRef.current ?? page;
            replyPageRef.current = null;
            suppressPageJumpRef.current = true;
            setCommentText(''); setSelectedText(''); setSelRange(null); setReplyingTo(null); setNewCommentThreadKey(null);
            setCommentingIdx(null);
            persistCommentCache(activeBook.id, nextAllComments, result?.comment_version);
            setActiveComments(prev => {
                const merged = [...prev, newComment];
                return Array.from(new Map(merged.map(item => [item.id, item])).values());
            });
            setPage(pageToRestore);
            if (!wasReply && composerSeed) {
                prepareAdditionalComment(composerSeed);
            }
            setTimeout(() => { suppressPageJumpRef.current = false; }, 500);
            if (wakeModel) {
                setCommentReplyBusy(true);
                try {
                    const response = await api.respondToComment(activeBook.id, {
                        comment_id: result?.id,
                        review_mode: reviewMode,
                        request_key: `comment:${activeBook.id}:${result?.id}:${Date.now()}`,
                    });
                    if (response.comment) {
                        nextAllComments = Array.from(new Map(
                            [...nextAllComments, response.comment].map(item => [item.id, item]),
                        ).values());
                        persistCommentCache(activeBook.id, nextAllComments, response?.comment_version);
                        setActiveComments(prev => Array.from(new Map(
                            [...prev, response.comment].map(item => [item.id, item]),
                        ).values()));
                    }
                    if (response.comment_summary) mergeCommentSummary(response.comment_summary);
                } finally {
                    setCommentReplyBusy(false);
                }
            }
        } catch (e: any) { toast(`批注失败: ${e.message}`); }
    };

    const toggleFavorite = async (comment: Comment) => {
        try {
            const next = !comment.is_favorite;
            const result = await api.updateBookComment(comment.id, { is_favorite: next });
            const patch = (item: Comment) => item.id === comment.id ? { ...item, is_favorite: next ? 1 : 0 } : item;
            const bookId = activeBook?.id ?? comment.book_id;
            if (bookId) persistCommentCache(bookId, allCommentsRef.current.map(patch), result?.comment_version);
            setActiveComments(prev => prev.map(patch));
        } catch (e: any) { toast(`收藏失败: ${e.message}`); }
    };

    const wakeExistingComment = async (comment: Comment) => {
        if (!activeBook || commentReplyBusy) return;
        setCommentReplyBusy(true);
        try {
            const response = await api.respondToComment(activeBook.id, {
                comment_id: comment.id,
                review_mode: reviewMode,
                request_key: `comment:${activeBook.id}:${comment.id}:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`,
            });
            if (response.comment) {
                persistCommentCache(
                    activeBook.id,
                    [...allCommentsRef.current, response.comment],
                    response?.comment_version,
                );
                setActiveComments(prev => Array.from(new Map(
                    [...prev, response.comment].map(item => [item.id, item]),
                ).values()));
            }
            if (response.comment_summary) mergeCommentSummary(response.comment_summary);
        } catch (e: any) {
            toast(`小 C 回复失败: ${e.message}`);
        } finally {
            setCommentReplyBusy(false);
        }
    };

    useEffect(() => {
        if (mode !== 'reading') return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (!['AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown'].includes(event.key)) return;
            const target = event.target as HTMLElement | null;
            const tag = target?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
            event.preventDefault();
            goPage(event.key === 'AudioVolumeUp' || event.key === 'VolumeUp' ? -1 : 1);
        };
        window.addEventListener('keydown', onKeyDown, { passive: false });
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [mode, goPage]);

    const sendChapterChat = async (wakeModel = false) => {
        if (!activeBook || chapterChatBusy || (!chapterChatText.trim() && !wakeModel)) return;
        const content = chapterChatText.trim();
        setChapterChatBusy(wakeModel);
        try {
            const data = await api.sendChapterChat(activeBook.id, {
                chapter_no: currentChapterNo,
                content,
                wake: wakeModel,
                review_mode: reviewMode,
                request_key: `chat:${activeBook.id}:${currentChapterNo}:${Date.now()}`,
            });
            if (data.messages) setChapterChat(data.messages);
            else if (data.message) setChapterChat(prev => [...prev, data.message]);
            setChapterChatText('');
        } catch (e: any) { toast(`章内对话失败: ${e.message}`); }
        finally { setChapterChatBusy(false); }
    };

    const openReadingConfirm = async () => {
        if (!activeBook || currentChapterIdx < 0) return;
        setShowReadingConfirm(true);
        setShowBar(false);
        setShowMoreMenu(false);
        try {
            const data = await api.fetchReadingContexts(activeBook.id);
            const contexts = data.contexts || [];
            setStoryMaterials(previous => ({ ...previous, readingContexts: contexts }));
            setChapterPreludeText(contexts.find((item: any) => item.context_kind === 'chapter_prelude'
                && Number(item.chapter_no) === currentChapterNo)?.content || '');
        } catch (error: any) {
            toast(`读取第 ${currentChapterNo} 章前情失败: ${error?.message || '未知错误'}`);
        }
    };

    const storyMaterialsFromPayload = (data: any, previous?: StoryMaterialsState): StoryMaterialsState => ({
        summaries: data?.summaries || previous?.summaries || [],
        facts: data?.facts || previous?.facts || [],
        factHistory: data?.fact_history || previous?.factHistory || [],
        readingContexts: data?.reading_contexts || previous?.readingContexts || [],
        commentSummaries: data?.comment_summaries || previous?.commentSummaries || [],
    });

    const mergeCommentSummary = (summary: any) => {
        if (!summary) return;
        setStoryMaterials(previous => ({
            ...previous,
            commentSummaries: [
                ...previous.commentSummaries.filter(item => Number(item.chapter_no) !== Number(summary.chapter_no)),
                summary,
            ].sort((a, b) => Number(a.chapter_no) - Number(b.chapter_no)),
        }));
    };

    const openStoryMaterials = async () => {
        if (!activeBook) return;
        setShowStoryMaterials(true);
        setEditingStoryMaterial(null);
        setStoryMaterialsLoading(true);
        try {
            const [data, impressions] = await Promise.all([
                api.fetchSummaries(activeBook.id),
                api.fetchReadingImpressions(activeBook.id),
            ]);
            const nextMaterials = storyMaterialsFromPayload(data);
            setStoryMaterials(nextMaterials);
            setBookPreludeText(nextMaterials.readingContexts.find(item => item.context_kind === 'book_prelude')?.content || '');
            setChapterPreludeText(nextMaterials.readingContexts.find(item => item.context_kind === 'chapter_prelude'
                && Number(item.chapter_no) === currentChapterNo)?.content || '');
            setReadingImpressions(impressions.impressions || []);
        } catch (e: any) {
            toast(`读取剧情资料失败: ${e.message}`);
        } finally {
            setStoryMaterialsLoading(false);
        }
    };

    const saveStoryMaterial = async () => {
        if (!activeBook || !editingStoryMaterial?.text?.trim() || storyMaterialSaving) return;
        setStoryMaterialSaving(true);
        try {
            await api.updateSummary(activeBook.id, {
                kind: editingStoryMaterial.kind,
                chapter_no: editingStoryMaterial.chapter_no,
                text: editingStoryMaterial.text.trim(),
                locked: Boolean(editingStoryMaterial.locked),
            });
            const data = await api.fetchSummaries(activeBook.id);
            setStoryMaterials(previous => storyMaterialsFromPayload(data, previous));
            setEditingStoryMaterial(null);
            toast('已保存为人工编辑版本');
        } catch (e: any) {
            toast(`保存剧情资料失败: ${e.message}`);
        } finally {
            setStoryMaterialSaving(false);
        }
    };

    const generateStoryMaterial = async (kind: 'block' | 'reading_impression') => {
        if (!activeBook || !storyMaterialGenerator || storyMaterialGenerator.kind !== kind || storyMaterialGenerator.busy) return;
        const start = Math.max(1, Math.min(tocChapters.length || 1, Number(storyMaterialGenerator.start) || 1));
        const end = Math.max(start, Math.min(tocChapters.length || start, Number(storyMaterialGenerator.end) || start));
        setStoryMaterialGenerator(current => current ? { ...current, start, end, busy: true, missingChapters: [] } : current);
        try {
            const result = await api.generateStoryMaterial(activeBook.id, {
                kind,
                chapter_start: start,
                chapter_end: end,
            });
            const [materials, impressions] = await Promise.all([
                api.fetchSummaries(activeBook.id),
                api.fetchReadingImpressions(activeBook.id),
            ]);
            setStoryMaterials(previous => storyMaterialsFromPayload(materials, previous));
            setReadingImpressions(impressions.impressions || []);
            setStoryMaterialGenerator(null);
            toast(result.status === 'existing' ? '该范围的资料已存在' : kind === 'block' ? '大总结已生成' : '共同读书印象已生成');
        } catch (error: any) {
            const missingChapters = error?.status === 409 && Array.isArray(error?.data?.missing_chapters)
                ? error.data.missing_chapters.map(Number).filter(Number.isFinite)
                : [];
            setStoryMaterialGenerator(current => current ? { ...current, busy: false, missingChapters } : current);
            if (missingChapters.length) {
                toast(`第 ${missingChapters.join('、')} 章还没有逐章摘要`);
            } else {
                toast(`生成资料失败: ${error?.message || '未知错误'}`);
            }
        }
    };

    const saveReadingImpression = async () => {
        if (!activeBook || !readingImpressionText.trim() || readingImpressionSaving) return;
        setReadingImpressionSaving(true);
        try {
            const data = await api.addReadingImpression(activeBook.id, {
                chapter_start: currentChapterNo || undefined,
                chapter_end: currentChapterNo || undefined,
                content: readingImpressionText.trim(),
                source_label: humanName,
            });
            setReadingImpressions(prev => [data.impression, ...prev]);
            setReadingImpressionText('');
            toast('共同读书印象已保存到 Coread');
        } catch (e: any) {
            toast(`保存读书印象失败: ${e.message}`);
        } finally {
            setReadingImpressionSaving(false);
        }
    };

    const saveReadingContext = async (kind: 'book_prelude' | 'chapter_prelude') => {
        if (!activeBook || readingContextSaving) return false;
        const chapterNo = kind === 'chapter_prelude' ? currentChapterNo : 0;
        const content = kind === 'chapter_prelude' ? chapterPreludeText : bookPreludeText;
        setReadingContextSaving(kind === 'chapter_prelude' ? 'chapter' : 'book');
        try {
            const data = await api.saveReadingContext(activeBook.id, {
                kind,
                chapter_no: chapterNo || undefined,
                content,
            });
            setStoryMaterials(previous => ({
                ...previous,
                readingContexts: [
                    ...previous.readingContexts.filter(item => !(item.context_kind === kind
                        && Number(item.chapter_no) === Number(chapterNo))),
                    data.context,
                ],
            }));
            toast(kind === 'chapter_prelude' ? `第 ${chapterNo} 章前情已保存` : '全书前情已保存');
            return true;
        } catch (error: any) {
            toast(`保存前情失败: ${error?.message || '未知错误'}`);
            return false;
        } finally {
            setReadingContextSaving(null);
        }
    };

    const saveEditedCommentSummary = async () => {
        if (!activeBook || !editingCommentSummary?.content.trim() || commentSummarySaving) return;
        setCommentSummarySaving(true);
        try {
            const data = await api.updateCommentSummary(activeBook.id, editingCommentSummary.chapterNo, {
                content: editingCommentSummary.content.trim(),
                request_key: `manual-comment-summary:${activeBook.id}:${editingCommentSummary.chapterNo}:${Date.now()}`,
            });
            mergeCommentSummary(data.summary);
            setEditingCommentSummary(null);
            toast(`第 ${data.summary.chapter_no} 章批注摘要已保存为人工版本`);
        } catch (error: any) {
            toast(`保存批注摘要失败: ${error?.message || '未知错误'}`);
        } finally {
            setCommentSummarySaving(false);
        }
    };

    const refreshFacts = async () => {
        if (!activeBook) return;
        const data = await api.fetchFacts(activeBook.id);
        setStoryMaterials(previous => ({
            ...previous,
            facts: data.facts || [],
            factHistory: data.fact_history || [],
        }));
    };

    const mutateFact = async (fact: any, operation: 'revise' | 'invalidate', patch: any = {}) => {
        if (!activeBook || factSaving) return;
        setFactSaving(true);
        try {
            await api.mutateFact(activeBook.id, {
                operation,
                lineage_id: Number(fact.lineage_id || fact.id),
                fact_type: patch.factType ?? fact.fact_type,
                key_name: patch.keyName ?? fact.key_name,
                value: patch.value ?? fact.value,
                importance: patch.importance ?? fact.importance,
                revision_chapter: currentChapterNo,
                revision_reason: patch.reason || (operation === 'invalidate' ? `第 ${currentChapterNo} 章手动作废` : `第 ${currentChapterNo} 章手动修订`),
            });
            await refreshFacts();
            setFactEditor(null);
            toast(operation === 'invalidate' ? '事实已作废，历史版本仍保留' : '事实已追加修订版本');
        } catch (error: any) {
            toast(`更新事实失败: ${error?.message || '未知错误'}`);
        } finally {
            setFactSaving(false);
        }
    };

    const deleteStoryMaterial = async (item: any) => {
        if (!activeBook || !window.confirm(`删除「${item.kind === 'block' ? '大总结' : '剧情摘要'}」？`)) return;
        try {
            await api.deleteSummary(activeBook.id, Number(item.id));
            setStoryMaterials(previous => ({
                ...previous,
                summaries: previous.summaries.filter(summary => Number(summary.id) !== Number(item.id)),
            }));
            if (editingStoryMaterial?.id === item.id) setEditingStoryMaterial(null);
            toast('已删除剧情资料');
        } catch (error: any) {
            toast(`删除剧情资料失败: ${error?.message || '未知错误'}`);
        }
    };

    const deleteReadingImpression = async (item: any) => {
        if (!activeBook || !window.confirm('删除这条共同读书印象？')) return;
        try {
            await api.deleteReadingImpression(activeBook.id, Number(item.id));
            setReadingImpressions(previous => previous.filter(impression => Number(impression.id) !== Number(item.id)));
            toast('已删除共同读书印象');
        } catch (error: any) {
            toast(`删除共同读书印象失败: ${error?.message || '未知错误'}`);
        }
    };

    const storyMaterialSummaryItems = useMemo(() => {
        const latest = new Map<string, any>();
        for (const item of storyMaterials.summaries) {
            const key = `${item.kind}:${item.chapter_no ?? 'all'}`;
            const previous = latest.get(key);
            if (!previous || Number(item.id) > Number(previous.id)) latest.set(key, item);
        }
        const kind = storyMaterialTab === 'chapters' ? 'chapter' : 'block';
        return [...latest.values()]
            .filter(item => item.kind === kind)
            .sort((a, b) =>
                Number(a.chapter_no ?? 0) - Number(b.chapter_no ?? 0)
                || String(a.kind).localeCompare(String(b.kind))
            );
    }, [storyMaterials.summaries, storyMaterialTab]);

    const openStoryMaterialGenerator = (kind: 'block' | 'reading_impression') => {
        const maxChapter = Math.max(1, tocChapters.length);
        const start = Math.max(1, Math.min(maxChapter, currentChapterNo || 1));
        setStoryMaterialTab(kind === 'block' ? 'blocks' : 'impressions');
        setStoryMaterialGenerator({
            kind,
            start,
            end: Math.min(maxChapter, start + 29),
            busy: false,
            missingChapters: [],
        });
    };

    const handleDeleteComment = async (cmt: Comment) => {
        try {
            const result = await api.deleteBookComment(cmt.id);
            const bookId = activeBook?.id ?? cmt.book_id;
            if (bookId) {
                persistCommentCache(
                    bookId,
                    allCommentsRef.current.filter(item => item.id !== cmt.id),
                    result?.comment_version,
                );
            }
            setActiveComments(prev => prev.filter(x => x.id !== cmt.id));
        } catch (e: any) { toast(`删除失败: ${e.message}`); }
    };

    const handleExport = (format: 'epub' | 'md' | 'json' | 'archive') => {
        if (!activeBook) return;
        setShowExportMenu(false);
        window.open(`${API_BASE}/v1/books/${activeBook.id}/export?format=${format}`, '_blank');
    };

    const handleDeleteBook = async (bookId: number) => {
        try {
            await api.deleteBook(bookId);
            setConfirmDelete(null); loadBooks();
            toast('已删除');
        } catch (e: any) { toast(`删除失败: ${e.message}`); }
    };

    const handleRestoreBook = async (bookId: number) => {
        try {
            await api.restoreBook(bookId);
            await loadBooks(true);
            toast('已恢复到书架');
        } catch (e: any) { toast(`恢复失败: ${e.message}`); }
    };

    const handlePermanentDeleteBook = async (bookId: number) => {
        try {
            await api.permanentlyDeleteBook(bookId);
            clearReaderCache(bookId);
            clearBookLastOpened(bookId);
            setConfirmPermanentDelete(null);
            await loadBooks(true);
            toast('已永久删除');
        } catch (e: any) { toast(`永久删除失败: ${e.message}`); }
    };

    const handleBatchDeleteBooks = async () => {
        if (!confirmBatchDelete || selectedBooks.size === 0) {
            setConfirmBatchDelete(null);
            return;
        }
        const ids = [...selectedBooks];
        const failed = new Set<number>();
        let succeeded = 0;
        for (const bookId of ids) {
            try {
                if (confirmBatchDelete === 'permanent') {
                    await api.permanentlyDeleteBook(bookId);
                    clearReaderCache(bookId);
                    clearBookLastOpened(bookId);
                } else {
                    await api.deleteBook(bookId);
                }
                succeeded += 1;
            } catch {
                failed.add(bookId);
            }
        }
        setConfirmBatchDelete(null);
        setSelectedBooks(failed);
        if (failed.size === 0) setEditMode(false);
        await loadBooks(confirmBatchDelete === 'permanent');
        if (failed.size === 0) {
            toast(confirmBatchDelete === 'permanent'
                ? `已永久删除 ${succeeded} 本书`
                : `已移入回收站 ${succeeded} 本书`);
        } else {
            toast(`已处理 ${succeeded} 本，失败 ${failed.size} 本；失败项仍保持选中`);
        }
    };

    const loadBackups = async () => {
        setBackupsLoading(true);
        try {
            const result = await api.fetchBackups();
            setBackups(Array.isArray(result?.backups) ? result.backups : []);
        } catch (e: any) {
            toast(`读取备份失败: ${e.message}`);
        } finally {
            setBackupsLoading(false);
        }
    };

    const openBackups = async () => {
        setShowSettings(false);
        setShowBackups(true);
        await loadBackups();
    };

    const handleCreateBackup = async () => {
        setBackupCreating(true);
        try {
            const result = await api.createBackup();
            setBackups(previous => [result.backup, ...previous.filter(item => item.id !== result.backup?.id)]);
            toast('已创建手动备份');
        } catch (e: any) {
            toast(`创建备份失败: ${e.message}`);
        } finally {
            setBackupCreating(false);
        }
    };

    const beginRestorePreflight = async (backup: BackupSummary) => {
        try {
            const result = await api.preflightRestore(backup.id);
            setRestoreConfirmed(false);
            setRestorePreflight(result);
        } catch (e: any) {
            toast(`恢复预检失败: ${e.message}`);
        }
    };

    const handleRestoreBackup = async () => {
        if (!restorePreflight?.backup?.id || !restorePreflight?.confirmation_token || !restoreConfirmed) return;
        setRestoreBusy(true);
        try {
            await api.restoreBackup(restorePreflight.backup.id, restorePreflight.confirmation_token);
            setRestorePreflight(null);
            setShowBackups(false);
            await loadBooks(showTrash);
            toast('完整书库已恢复，恢复前备份已自动创建');
        } catch (e: any) {
            toast(`恢复失败: ${e.message}`);
        } finally {
            setRestoreBusy(false);
        }
    };

    const jumpToChapter = (chapter: TocChapter) => {
        if (!activeBook) return;
        const targetIdx = chapter.idx ?? chapter.start_idx ?? chapter.page;
        if (!canJumpToPara(targetIdx)) return;
        setShowToc(false); setActiveComments([]); setCommentingIdx(null); setSelRange(null); setFloatingBar(null);
        const targetPage = findPageForParaIdx(targetIdx);
        if (targetPage >= 0) setPage(targetPage + 1);
    };

    const currentCustomRules = () => customRulePattern.trim()
        ? [{
            id: 'book',
            label: customRuleLabel.trim() || '本书自定义规则',
            pattern: customRulePattern.trim(),
        }]
        : [];

    const openRechapterPanel = async () => {
        if (!activeBook || chapterRuleBusy) return;
        setShowRechapter(true);
        setChapterRuleBusy(true);
        setChapterRuleError('');
        try {
            const data = await api.fetchChapterRules(activeBook.id);
            const candidates = (data.candidates || []) as ChapterRuleCandidate[];
            const current = data.current && typeof data.current === 'object'
                ? data.current as ChapterRuleSelection
                : null;
            const recommended = (data.recommended_family_ids || []).map(String);
            const selected = current?.family_ids?.length
                ? current.family_ids.map(String)
                : recommended.length ? recommended : candidates.slice(0, 1).map(candidate => candidate.id);
            const savedCustom = current?.custom_rules?.[0];
            setChapterRuleCandidates(candidates);
            setRecommendedChapterFamilies(recommended);
            setCurrentChapterRule(current);
            setSelectedChapterFamilies(selected);
            setAdvancedChapterRules(current?.mode === 'combined' || selected.length > 1);
            setCustomRuleLabel(savedCustom?.label || '本书自定义规则');
            setCustomRulePattern(savedCustom?.pattern || '');
            setChapterRulePreview({
                ranges: normalizeTocChapters(data.preview || []),
                selection: current?.family_ids?.length
                    ? current
                    : {
                        mode: selected.length > 1 ? 'combined' : 'single',
                        family_ids: selected,
                        custom_rules: current?.custom_rules || [],
                    },
            });
        } catch (error: any) {
            setChapterRuleError(`读取分章规则失败：${error.message}`);
        } finally {
            setChapterRuleBusy(false);
        }
    };

    const chooseChapterFamily = (familyId: string) => {
        setChapterRulePreview(null);
        setChapterRuleError('');
        setSelectedChapterFamilies(previous => {
            if (!advancedChapterRules) return [familyId];
            return previous.includes(familyId)
                ? previous.filter(id => id !== familyId)
                : [...previous, familyId];
        });
    };

    const previewChapterRules = async () => {
        if (!activeBook || chapterRuleBusy) return;
        if (!selectedChapterFamilies.length) {
            setChapterRuleError('请至少选择一种分章规则。');
            return;
        }
        if (selectedChapterFamilies.includes('custom:book') && !customRulePattern.trim()) {
            setChapterRuleError('请填写本书自定义正则。');
            return;
        }
        setChapterRuleBusy(true);
        setChapterRuleError('');
        try {
            const data = await api.previewChapterRules(activeBook.id, {
                family_ids: selectedChapterFamilies,
                custom_rules: currentCustomRules(),
            });
            setChapterRuleCandidates(data.candidates || chapterRuleCandidates);
            setRecommendedChapterFamilies((data.recommended_family_ids || recommendedChapterFamilies).map(String));
            setChapterRulePreview({
                ranges: normalizeTocChapters(data.ranges || []),
                selection: data.selection,
            });
        } catch (error: any) {
            setChapterRuleError(`预览失败：${error.message}`);
        } finally {
            setChapterRuleBusy(false);
        }
    };

    const applyChapterRules = async () => {
        if (!activeBook || !chapterRulePreview || chapterRuleBusy) return;
        const anchor = currentParaIdxRef.current;
        setChapterRuleBusy(true);
        setChapterRuleError('');
        try {
            const result = await api.updateChapters(
                activeBook.id,
                chapterRulePreview.ranges,
                chapterRulePreview.selection,
            );
            savedParaIdxRef.current = anchor;
            setReadingLoading(true);
            setPageBreaks([{ paraIndex: 0, offset: 0 }]);
            setTotalPages(1);
            const nextChapters = normalizeTocChapters(result.chapters || []);
            setTocChapters(nextChapters);
            setCurrentChapterRule(result.chapter_rule || chapterRulePreview.selection);
            void idbSetParas(tocCacheKey(activeBook.id), { cacheFormat: 'toc-v1', chapters: nextChapters });
            if (paragraphCacheManifest) {
                const nextManifest = {
                    ...paragraphCacheManifest,
                    cacheVersion: Number.isFinite(Number(result.cache_version))
                        ? Number(result.cache_version)
                        : paragraphCacheManifest.cacheVersion,
                };
                setParagraphCacheManifest(nextManifest);
                void idbSetParas(paragraphManifestCacheKey(activeBook.id), nextManifest);
            }
            invalidateBookPaginationCache(activeBook.id, result.cache_version);
            setShowRechapter(false);
            setTocQuery('');
            toast(`已按新规则重分为 ${result.chapters?.length || 1} 章`);
        } catch (error: any) {
            setChapterRuleError(`应用失败：${error.message}`);
        } finally {
            setChapterRuleBusy(false);
        }
    };

    const tocMatches = useMemo(() => {
        const query = tocQuery.trim().toLocaleLowerCase();
        if (!query) return tocChapters.map((chapter, index) => ({ chapter, index }));
        return tocChapters
            .map((chapter, index) => ({ chapter, index }))
            .filter(({ chapter, index }) => {
                const chapterNo = String(index + 1);
                return chapterNo.includes(query) || String(chapter.title || '').toLocaleLowerCase().includes(query);
            });
    }, [tocChapters, tocQuery]);

    // 章节归属按真实段落坐标判断，避免多个目录项落在同一视觉页时误判成最后一个假章节。
    const currentChapterIdx = useMemo(() => {
        const start = pageBreaks[Math.max(0, page - 1)];
        const currentParagraphIdx = Number(allParas[start?.paraIndex ?? 0]?.idx ?? 0);
        let cur = -1;
        for (let i = 0; i < tocChapters.length; i++) {
            const ch = tocChapters[i];
            const chapterStart = Number(ch.idx ?? ch.start_idx ?? ch.page);
            if (chapterStart <= currentParagraphIdx) cur = i;
            else break;
        }
        return cur;
    }, [tocChapters, page, pageBreaks, allParas]);
    const currentChapterNo = Math.max(1, currentChapterIdx + 1);
    const annotationList = useMemo(() => {
        if (showAnnotationList === 'chapter') {
            return allComments.filter(comment => commentChapterIndex(comment) === currentChapterIdx);
        }
        if (showAnnotationList === 'page') {
            const visibleParagraphs = new Set(pageFragments.map(fragment => Number(fragment.idx)));
            return allComments.filter(comment => visibleParagraphs.has(Number(comment.paragraph_idx)));
        }
        return [];
    }, [allComments, showAnnotationList, currentChapterIdx, tocChapters, pageFragments]);

    useEffect(() => {
        if (!activeBook || currentChapterIdx < 0) return;
        api.fetchChapterChat(activeBook.id, currentChapterNo)
            .then(data => setChapterChat(data.messages || []))
            .catch(() => {});
    }, [activeBook?.id, currentChapterNo, currentChapterIdx]);

    const pollReadingTask = async (taskId: number) => {
        try {
            const data = await api.fetchTask(taskId);
            setReadingTask(data.task);
            if (data.task?.status === 'completed' || data.task?.status === 'failed' || data.task?.status === 'paused' || data.task?.status === 'cancelled') {
                const refreshed = await api.fetchBookComments(activeBook!.id);
                const fresh = (refreshed.comments || []) as Comment[];
                persistCommentCache(activeBook!.id, fresh, refreshed.comment_version);
                if (data.task?.status === 'completed') toast('本章共读完成，摘要和批注已保存');
                return;
            }
            window.setTimeout(() => pollReadingTask(taskId), 1200);
        } catch (error: any) {
            setReadingTask((prev: any) => prev ? { ...prev, status: 'failed', error: error.message } : prev);
        }
    };

    const startChapterReading = async () => {
        if (!activeBook || currentChapterIdx < 0 || readingTask?.status === 'running' || readingTask?.status === 'queued') return;
        try {
            const saved = await saveReadingContext('chapter_prelude');
            if (!saved) return;
            const requestKey = `read:${activeBook.id}:${currentChapterNo}:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
            const data = await api.createReadingTask(activeBook.id, {
                task_type: 'main',
                start_chapter: currentChapterNo,
                end_chapter: currentChapterNo,
                review_mode: reviewMode,
                request_key: requestKey,
            });
            setReadingTask({ id: data.task_id, status: 'queued', current_chapter: currentChapterNo, review_mode: reviewMode });
            setShowReadingConfirm(false);
            pollReadingTask(data.task_id);
        } catch (error: any) {
            toast(`阅读任务创建失败: ${error.message}`);
        }
    };

    const batchRequestKey = () => [
        batchTaskType,
        batchStartChapter,
        batchEndChapter,
        reviewMode,
        batchConcurrency,
        batchBudgetTokens,
    ].join(':');

    const formatTokens = (value: number | null | undefined) =>
        new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.max(0, Number(value) || 0));

    const loadRecentBatchTasks = async (bookId = activeBook?.id) => {
        if (!bookId) return;
        try {
            const data = await api.fetchReadingTasks(bookId);
            setRecentBatchTasks(data.tasks || []);
        } catch (error: any) {
            toast(`读取任务列表失败: ${error.message}`);
        }
    };

    const previewBatchReading = async () => {
        if (!activeBook || !tocChapters.length) return;
        setBatchPreviewing(true);
        try {
            const data = await api.previewReadingTask(activeBook.id, {
                task_type: batchTaskType,
                start_chapter: batchStartChapter,
                end_chapter: batchEndChapter,
                review_mode: reviewMode,
                requested_concurrency: batchConcurrency,
                budget_tokens: batchBudgetTokens,
            });
            setBatchPreview(data);
            setBatchPreviewKey(batchRequestKey());
            setBatchBudgetConfirmed(false);
        } catch (error: any) {
            toast(`预算预览失败: ${error.message}`);
        } finally {
            setBatchPreviewing(false);
        }
    };

    const pollBatchTask = async (taskId: number) => {
        if (batchPollTimerRef.current !== null) {
            window.clearTimeout(batchPollTimerRef.current);
            batchPollTimerRef.current = null;
        }
        try {
            const data = await api.fetchTask(taskId);
            setBatchTask(data);
            if (data.task?.status === 'queued' || data.task?.status === 'running') {
                batchPollTimerRef.current = window.setTimeout(() => {
                    batchPollTimerRef.current = null;
                    pollBatchTask(taskId);
                }, 1200);
                return;
            }
            if (activeBook) loadRecentBatchTasks(activeBook.id);
            if (data.task?.status === 'completed' && activeBook) {
                const refreshed = await api.fetchBookComments(activeBook.id);
                const fresh = (refreshed.comments || []) as Comment[];
                persistCommentCache(activeBook.id, fresh, refreshed.comment_version);
                toast('批量阅读完成，摘要、批注和任务用量已保存');
            }
        } catch (error: any) {
            setBatchTask((prev: any) => prev ? { ...prev, task: { ...prev.task, status: 'failed', error: error.message } } : prev);
        }
    };

    const openBatchReading = () => {
        if (!activeBook || !tocChapters.length) return;
        const maxChapter = tocChapters.length;
        const start = Math.max(1, Math.min(maxChapter, currentChapterNo || 1));
        setBatchStartChapter(start);
        setBatchEndChapter(Math.min(maxChapter, start + 29));
        setBatchTaskType('main');
        setBatchConcurrency(1);
        setBatchBudgetTokens(500000);
        setBatchPreview(null);
        setBatchPreviewKey('');
        setBatchBudgetConfirmed(false);
        setShowBatchReading(true);
        loadRecentBatchTasks(activeBook.id);
    };

    const startBatchReading = async () => {
        if (!activeBook) return;
        const requestKey = batchRequestKey();
        if (!batchPreview || batchPreviewKey !== requestKey) {
            toast('请先刷新预算预览，再确认启动范围');
            await previewBatchReading();
            return;
        }
        if (batchPreview.preview?.blocked) {
            toast('有章节超过单次输入硬上限，请先缩小范围或在目录中拆分该章节');
            return;
        }
        if (batchPreview.preview?.requires_confirmation && !batchBudgetConfirmed) {
            toast('请确认预算提醒后再启动');
            return;
        }
        try {
            const data = await api.createReadingTask(activeBook.id, {
                task_type: batchTaskType,
                start_chapter: batchStartChapter,
                end_chapter: batchEndChapter,
                review_mode: reviewMode,
                requested_concurrency: batchConcurrency,
                budget_tokens: batchBudgetTokens,
                confirm_budget: Boolean(batchPreview.preview?.requires_confirmation ? batchBudgetConfirmed : true),
                request_key: `batch:${activeBook.id}:${requestKey}:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`,
            });
            setShowBatchReading(true);
            toast(data.deduped ? '已打开同一批量任务' : '批量阅读已进入服务器队列');
            await pollBatchTask(data.task_id);
        } catch (error: any) {
            toast(`批量任务创建失败: ${error.message}`);
        }
    };

    const controlBatchTask = async (action: 'pause' | 'cancel' | 'resume' | 'retry_current' | 'skip_current') => {
        const task = batchTask?.task;
        if (!task || batchTaskActionBusy) return;
        setBatchTaskActionBusy(true);
        try {
            await api.updateTask(task.id, { action });
            await pollBatchTask(task.id);
        } catch (error: any) {
            toast(`任务操作失败: ${error.message}`);
        } finally {
            setBatchTaskActionBusy(false);
        }
    };

    useEffect(() => {
        if (activeBook?.id) loadRecentBatchTasks(activeBook.id);
    }, [activeBook?.id]);

    useEffect(() => () => {
        if (batchPollTimerRef.current !== null) {
            window.clearTimeout(batchPollTimerRef.current);
        }
    }, []);

    // 打开目录时把当前章滚动到列表中央（窗口化后按钮按需渲染，不能scrollIntoView，直接算scrollTop）
    useEffect(() => {
        if (!showToc) return;
        const el = tocListRef.current;
        if (!el) return;
        setTocViewH(el.clientHeight);
        setTocScrollTop(el.scrollTop);
        if (currentChapterIdx >= 0) {
            const headerH = (el.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
            el.scrollTop = Math.max(0, headerH + currentChapterIdx * TOC_ROW_H - el.clientHeight / 2);
        }
    }, [showToc, currentChapterIdx]);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const name = file.name.replace(/\.(txt|md|epub)$/i, '');
        if (!uploadTitle) setUploadTitle(name);
        setUploadFileName(file.name);
        const ext = file.name.toLowerCase().split('.').pop();
        if (ext !== 'txt' && ext !== 'md' && ext !== 'epub') {
            toast('第一版支持 TXT、MD 和 EPUB');
            return;
        }
        const format = ext === 'epub' ? 'epub' : ext === 'md' ? 'md' : 'txt';
        try {
            const base64 = await readFileBase64(file);
            setUploadFormat(format);
            setUploadBase64(base64);
            setUploadText('');
            setUploadEncoding('auto');
            setUploadPreview(null);
            setUploadChapters([]);
            if (format !== 'epub') await refreshUploadPreview('auto', format);
        } catch (error: any) {
            toast(`读取文件失败: ${error.message}`);
        }
    };

    const handleBatchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setUploading(true);
        let ok = 0, fail = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const ext = file.name.toLowerCase().split('.').pop();
            if (!['epub', 'txt', 'md'].includes(ext || '')) { fail++; continue; }
            try {
                const title = file.name.replace(/\.(txt|md|epub)$/i, '');
                const b64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.readAsDataURL(file);
                });
                const payload: any = { title };
                if (ext === 'epub') { payload.format = 'epub'; payload.data = b64; }
                else { payload.format = ext === 'md' ? 'md' : 'txt'; payload.data = b64; }
                await api.createBook(payload);
                ok++;
                toast(`已上传 ${ok}/${files.length}: ${title}`);
            } catch { fail++; }
        }
        toast(fail ? `完成：${ok}成功，${fail}失败` : `全部${ok}本上传成功`);
        setUploading(false);
        setShowUpload(false);
        loadBooks();
        e.target.value = '';
    };

    const handleUpload = async () => {
        if (!uploadTitle.trim()) { toast('请输入书名'); return; }
        if (!uploadText.trim() && !uploadBase64) { toast('请选择文件或粘贴文本'); return; }
        setUploading(true);
        try {
            const payload: any = {
                title: uploadTitle.trim(),
                format: uploadFormat,
                encoding: uploadEncoding,
                category: '待看',
                chapters: uploadChapters.length ? uploadChapters : undefined,
            };
            if (uploadBase64) payload.data = uploadBase64;
            else payload.content = uploadText;
            await api.createBook(payload);
            setShowUpload(false);
            resetUploadState();
            toast('上传成功');
            loadBooks();
        } catch (e: any) { toast(`上传失败: ${e.message}`); }
        setUploading(false);
    };

    const backToShelf = () => {
        if (readerHistoryRef.current) {
            readerHistoryRef.current = false;
            window.history.back();
        }
        openingBookIdRef.current = null;
        paragraphCacheBookRef.current = null;
        paragraphChunksRef.current = new Map();
        paragraphHydrationPromiseRef.current = null;
        paragraphWindowTokenRef.current += 1;
        setMode('shelf'); setActiveBook(null); setParagraphs([]); setComments([]);
        setAllParas([]); setPageFragments([]); setPageBreaks([{ paraIndex: 0, offset: 0 }]);
        setParagraphCacheManifest(null); setParagraphsFullyLoaded(true);
        setParagraphChunkRevision(previous => previous + 1);
        setBookCacheVersion(null); setCommentCacheVersion(null);
        lastCommentVersion.current = null; lastCommentIds.current = '';
        setActiveComments([]); setSelRange(null); setFloatingBar(null); setShowToc(false); setTocChapters([]);
        setShowRechapter(false); setChapterRulePreview(null);
        setShowSearch(false); setShowExportMenu(false); setSearchResults([]); setActiveSearchIndex(-1); setActiveSearchMatch(null);
        setReturnPoint(null);
        loadBooks();
    };

    useEffect(() => {
        const handleReaderBack = () => {
            if (mode !== 'reading' || !readerHistoryRef.current) return;
            readerHistoryRef.current = false;
            backToShelf();
        };
        window.addEventListener('popstate', handleReaderBack);
        return () => window.removeEventListener('popstate', handleReaderBack);
    }, [mode, backToShelf]);

    const commentsForPara = (idx: number) => comments.filter(x => {
        if (x.sel_start_idx == null) return x.paragraph_idx === idx;
        const endPara = x.sel_end_para_idx ?? x.paragraph_idx;
        return x.paragraph_idx <= idx && idx <= endPara;
    });
    const stripHeading = (s: string) => s.replace(/^#+\s*/, '');
    const isHeading = (s: string) => s.trim().startsWith('#');

    // v5：为抓页时的“底层纸张”准备相邻页面。
    // 这里只计算上一页/下一页，不改变现有分页算法。
    const buildPageFragmentsForLayer = useCallback((targetPage: number): PageFragment[] => {
        if (targetPage < 1 || targetPage > pageBreaks.length || allParas.length === 0) return [];
        const start = pageBreaks[targetPage - 1] || { paraIndex: 0, offset: 0 };
        const end = targetPage < pageBreaks.length
            ? pageBreaks[targetPage]
            : { paraIndex: allParas.length, offset: 0 };
        const fragments: PageFragment[] = [];

        for (
            let i = start.paraIndex;
            i < end.paraIndex || (i === end.paraIndex && end.offset > 0);
            i++
        ) {
            const para = paragraphAt(i);
            if (!para || !para.content) continue;
            const raw = stripHeading(para.content);
            const from = i === start.paraIndex ? start.offset : 0;
            const to = i === end.paraIndex ? end.offset : raw.length;
            if (to <= from) continue;
            fragments.push({
                ...para,
                content: raw.slice(from, to),
                sourceIdx: i,
                startOffset: from,
                endOffset: to,
                isPartialStart: from > 0,
                isPartialEnd: to < raw.length,
            });
        }
        return fragments;
    }, [allParas, pageBreaks]);

    const adjacentPageFragments = useMemo(() => ({
        previous: buildPageFragmentsForLayer(page - 1),
        next: buildPageFragmentsForLayer(page + 1),
    }), [buildPageFragmentsForLayer, page, paragraphChunkRevision]);

    const renderLayeredPreview = useCallback((
        fragments: PageFragment[],
        layerPage: number,
    ) => (
        <div
            aria-hidden="true"
            data-reader-layer-page={layerPage}
            style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                pointerEvents: 'none',
                boxSizing: 'border-box',
                background: readerSurface,
                zIndex: 1,
                transform: 'translate3d(0, 0, 0)',
                backfaceVisibility: 'hidden',
            }}
        >
            <div
                className="coread-reader-body"
                style={{
                    width: readerContentWidth,
                    maxWidth: '100%',
                    height: '100%',
                    minHeight: pageHeight
                        ? pageHeight + readerLayout.topInset + readerLayout.bottomInset
                        : undefined,
                    margin: '0 auto',
                    paddingTop: readerLayout.topInset,
                    paddingBottom: readerLayout.bottomInset,
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    fontFamily: globalReaderFont.family,
                    color: readerText,
                }}
            >
                {fragments.map((frag, visibleIndex) => {
                    const original = paragraphAt(frag.sourceIdx) || frag;
                    const chapterTitle = isChapterStartIndex(frag.sourceIdx) && !frag.isPartialStart;
                    const heading = isHeading(original.content) && !frag.isPartialStart;

                    return (
                        <div
                            key={`layer-${layerPage}-${frag.idx}-${frag.startOffset}-${frag.endOffset}`}
                            style={{
                                marginBottom: chapterTitle ? CHAPTER_GAP_BOTTOM : readerLayout.paragraphGap,
                                marginTop: chapterTitle && visibleIndex > 0 ? CHAPTER_GAP_TOP : 0,
                            }}
                        >
                            <div
                                style={{
                                    fontSize: chapterTitle
                                        ? readerLayout.fontSize + 4
                                        : original.content.trim().startsWith('# ')
                                            ? readerLayout.fontSize + 3
                                            : original.content.trim().startsWith('## ')
                                                ? readerLayout.fontSize + 2
                                                : readerLayout.fontSize,
                                    fontFamily: globalReaderFont.family,
                                    lineHeight: chapterTitle ? 2.2 : readerLayout.lineHeight,
                                    color: readerText,
                                    letterSpacing: chapterTitle
                                        ? readerLayout.letterSpacing + 0.7
                                        : readerLayout.letterSpacing,
                                    textIndent: (heading || chapterTitle || frag.isPartialStart)
                                        ? 0
                                        : `${readerLayout.textIndent}em`,
                                    fontWeight: chapterTitle ? 800 : heading ? 700 : 400,
                                    marginBottom: heading ? 4 : 0,
                                    textAlign: chapterTitle ? 'center' : undefined,
                                    whiteSpace: 'pre-wrap',
                                } as React.CSSProperties}
                            >
                                {decodeEntities(frag.content)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    ), [
        readerSurface,
        readerContentWidth,
        pageHeight,
        readerLayout,
        globalReaderFont.family,
        readerText,
        paragraphAt,
        isChapterStartIndex,
        isHeading,
        decodeEntities,
    ]);

    const renderHighlighted = (text: string, paraIdx: number, highlights: Comment[], searchMatch?: { start: number; end: number } | null) => {
        const positioned = highlights
            .filter(h => h.sel_start_idx != null && h.sel_end_idx != null && h.sel_start_idx! < text.length)
            .sort((a, b) => a.sel_start_idx! - b.sel_start_idx!);
        const activeSearch = searchMatch && searchMatch.end > 0 && searchMatch.start < text.length
            ? { start: Math.max(0, searchMatch.start), end: Math.min(text.length, searchMatch.end) }
            : null;
        if (positioned.length === 0 && !activeSearch) return text;

        const boundaries = Array.from(new Set([
            0, text.length,
            ...positioned.flatMap(h => [Math.max(0, h.sel_start_idx!), Math.min(text.length, h.sel_end_idx!)]),
            ...(activeSearch ? [activeSearch.start, activeSearch.end] : []),
        ])).sort((a, b) => a - b);
        const parts: React.ReactNode[] = [];
        const isAI = (comment: Comment) =>
            comment.from_who.toLowerCase() === 'ai'
            || comment.from_who.toLowerCase() === aiName.toLowerCase()
            || comment.source_label === 'main'
            || comment.source_label === 'main:fallback'
            || comment.source_label === 'model';
        const openThread = (segmentComments: Comment[]) => {
            const ids = new Set(segmentComments.map(comment => comment.id));
            const keys = new Set(segmentComments.map(comment => comment.thread_key).filter(Boolean));
            let thread = comments.filter(comment =>
                (comment.thread_key && keys.has(comment.thread_key))
                || ids.has(comment.id)
            );
            const pending = [...thread];
            while (pending.length) {
                const parent = pending.pop()!;
                for (const reply of comments.filter(comment => comment.reply_to === parent.id)) {
                    if (!thread.some(comment => comment.id === reply.id)) {
                        thread = [...thread, reply];
                        pending.push(reply);
                    }
                }
            }
            return sortCommentTimeline(thread.filter(comment => comment.annotation_kind !== 'wavy_underline'));
        };
        for (let i = 0; i < boundaries.length - 1; i++) {
            const start = boundaries[i];
            const end = boundaries[i + 1];
            if (start >= end) continue;
            const covering = positioned.filter(h => h.sel_start_idx! < end && h.sel_end_idx! > start);
            const isSearchHit = Boolean(activeSearch && activeSearch.start < end && activeSearch.end > start);
            if (covering.length === 0 && !isSearchHit) {
                parts.push(<React.Fragment key={`t${paraIdx}-${start}`}>{text.slice(start, end)}</React.Fragment>);
                continue;
            }
            if (covering.length === 0) {
                parts.push(
                    <span key={`s${paraIdx}-${start}-${end}`} style={{
                        background: readerHighlight,
                        boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
                    } as React.CSSProperties}>
                        {text.slice(start, end)}
                    </span>
                );
                continue;
            }
            const threaded = covering.filter(comment => comment.annotation_kind !== 'wavy_underline');
            const wavy = covering.filter(comment => comment.annotation_kind === 'wavy_underline');
            if (threaded.length === 0) {
                parts.push(
                    <span key={`w${paraIdx}-${start}-${end}`}
                        onClick={(event) => {
                            if (window.getSelection()?.toString().trim()) return;
                            event.stopPropagation();
                            setActiveWaveAnnotation(wavy[0]);
                        }}
                        title="点击管理这条波浪线"
                        style={{
                            background: isSearchHit ? readerHighlight : 'transparent',
                            textDecorationLine: 'underline',
                            textDecorationStyle: 'wavy',
                            textDecorationThickness: '1.5px',
                            textDecorationColor: c.tongColor,
                            textUnderlineOffset: '3px',
                            cursor: 'pointer',
                            boxDecorationBreak: 'clone',
                            WebkitBoxDecorationBreak: 'clone',
                        } as React.CSSProperties}>
                        {text.slice(start, end)}
                    </span>
                );
                continue;
            }
            const hasAI = threaded.some(isAI);
            const hasHuman = threaded.some(comment => !isAI(comment));
            const favorite = threaded.some(comment => Boolean(comment.is_favorite));
            const borderStyle = hasAI && hasHuman ? `3px double ${c.primaryDark}` : hasAI ? `1.5px dashed ${c.shenColor}` : `1.5px solid ${c.tongColor}`;
            const background = favorite
                ? readerHighlight
                : isSearchHit ? readerHighlight
                : 'transparent';
            const seed = threaded[0];
            parts.push(
                <span key={`h${paraIdx}-${start}-${end}`}
                    onClick={(e) => {
                        if (window.getSelection()?.toString().trim()) return;
                        e.stopPropagation();
                        if (activeComments.length > 0 && activeComments[0]?.id === seed.id) {
                            closeCommentDetails();
                        } else {
                            openCommentDetails(openThread(threaded));
                        }
                    }}
                    style={{
                        background, borderBottom: borderStyle, position: 'relative', cursor: 'pointer',
                        padding: 0, lineHeight: 'inherit', boxDecorationBreak: 'clone',
                        WebkitBoxDecorationBreak: 'clone',
                    } as React.CSSProperties}>
                    {threaded.some(h => h.paragraph_idx === paraIdx && h.sel_start_idx === start)
                        && <span style={{ position: 'absolute', top: -2, left: -2, width: 7, height: 7, borderRadius: '50%', background: hasAI ? c.shenColor : c.tongColor, boxShadow: `0 0 3px ${hasAI ? c.shenColor : c.tongColor}60`, pointerEvents: 'none' }} />}
                    {text.slice(start, end)}
                </span>
            );
        }
        return <>{parts}</>;
    };

    const btnBase: React.CSSProperties = {
        background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(18px) saturate(1.05)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.05)',
        border: `1px solid ${c.primaryBorder}`, borderRadius: 14,
        width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    };

    if (authenticated === null) {
        return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#777', background: '#fafaf8' }}>正在连接书架...</div>;
    }
    if (!authenticated) {
        return (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f7f1e8' }}>
                <form onSubmit={async (event) => {
                    event.preventDefault();
                    setLoginError('');
                    try { await api.login(loginPassword); setAuthenticated(true); setLoginPassword(''); }
                    catch { setLoginError('密码不对，再试一次'); }
                }} style={{ width: '100%', maxWidth: 320, padding: 24, background: '#fffdf9', border: '1px solid #ddd2c4', borderRadius: 8 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#3c3732', marginBottom: 8 }}>Coread</div>
                    <div style={{ fontSize: 13, color: '#8b8176', marginBottom: 18 }}>登录后继续阅读</div>
                    <input autoFocus type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="密码"
                        style={{ boxSizing: 'border-box', width: '100%', padding: '11px 12px', border: '1px solid #d8cfc4', borderRadius: 6, background: '#fff', marginBottom: 10 }} />
                    {loginError && <div style={{ color: '#b85c4a', fontSize: 12, marginBottom: 10 }}>{loginError}</div>}
                    <button type="submit" style={{ width: '100%', padding: '11px 12px', border: 0, borderRadius: 6, background: '#3c3732', color: '#fff', cursor: 'pointer' }}>进入</button>
                </form>
            </div>
        );
    }
    return (
        <div className={`xiaowo-study ${readerTheme === 'eink' ? 'eink-theme' : `reader-theme-${readerTheme}`}`} style={{
            height: '100%', width: '100%', display: 'flex', flexDirection: 'column',
            backgroundColor: mode === 'reading' ? readerSurface : '#f5f5f2',
            backgroundImage: mode === 'reading' ? readerTexture : undefined,
            position: 'relative', overflow: 'hidden',
            filter: mode === 'reading' && readerTheme !== 'eink' && readerBrightness < 100 ? `brightness(${readerBrightness / 100})` : undefined,
        }}>
            <style>{STUDY_THEME_CSS}</style>
            {/* Header — shelf stays visible; reading navigation appears when the reader menu is open */}
            {mode === 'shelf' ? (
                <div className="coread-shelf-header">
                    <div className="coread-shelf-header-main">
                        <div className="coread-shelf-masthead">Coread</div>
                        {editMode ? (
                            <div className="coread-shelf-manage-actions">
                                <span className="coread-selection-count">已选 {selectedBooks.size}</span>
                                <button
                                    className="coread-icon-button is-danger"
                                    onClick={() => {
                                        if (selectedBooks.size > 0) setConfirmBatchDelete(showTrash ? 'permanent' : 'soft');
                                    }}
                                    disabled={selectedBooks.size === 0}
                                    title={showTrash ? '永久删除选中书籍' : '删除选中书籍'}
                                    aria-label={showTrash ? '永久删除选中书籍' : '删除选中书籍'}
                                    style={{ opacity: selectedBooks.size === 0 ? 0.4 : 1 }}
                                >
                                    <LucideIcon name="trash2" size={17} />
                                </button>
                                <button
                                    className="coread-text-button"
                                    onClick={() => { setEditMode(false); setSelectedBooks(new Set()); }}
                                >
                                    完成
                                </button>
                            </div>
                        ) : (
                            <div className="coread-shelf-actions">
                                <button className="coread-text-button" onClick={() => { setEditMode(true); setSelectedBooks(new Set()); }}>管理</button>
                                <button className="coread-icon-button" onClick={openFavorites} title="收藏批注" aria-label="收藏批注">
                                    <LucideIcon name="star" size={17} />
                                </button>
                                <button className="coread-icon-button" onClick={() => setShowSettings(true)} title="设置" aria-label="设置">
                                    <LucideIcon name="settings" size={17} />
                                </button>
                                <button
                                    className="coread-icon-button"
                                    onClick={async () => {
                                        const next = !showTrash;
                                        setShowTrash(next);
                                        setEditMode(false);
                                        setSelectedBooks(new Set());
                                        setShelfCategory('全部');
                                        setShelfTag('全部');
                                        setShelfQuery('');
                                        await loadBooks(next);
                                    }}
                                    title={showTrash ? '返回书架' : '打开回收站'}
                                    aria-label={showTrash ? '返回书架' : '打开回收站'}
                                >
                                    <LucideIcon name={showTrash ? 'chevronLeft' : 'trash2'} size={17} />
                                </button>
                                {!showTrash && (
                                    <button className="coread-icon-button is-primary" onClick={() => setShowUpload(true)} title="上传书籍" aria-label="上传书籍">
                                        <LucideIcon name="plus" size={19} />
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="coread-shelf-tagline">{showTrash ? '回收站 · 可恢复或永久删除' : '与书相坐，慢慢读完'}</div>
                    </div>
                </div>
            ) : (
                <>
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 15,
                        display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', gap: 8,
                        padding: 'calc(30px + env(safe-area-inset-top)) 12px 10px',
                        background: readerPanel, borderBottom: `1px solid ${readerBorder}`,
                        opacity: showBar ? 1 : 0, transform: showBar ? 'translateY(0)' : 'translateY(-20px)',
                        pointerEvents: showBar ? 'auto' : 'none',
                    }}>
                        <button onClick={backToShelf} title="返回书架" aria-label="返回书架" style={{ ...btnBase, width: 36, height: 36, padding: 0 }}>
                            <LucideIcon name="chevronLeft" size={19} />
                        </button>
                        <div style={{ minWidth: 0, textAlign: 'center' }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700, color: readerText }}>
                                {activeBook?.title || ''}
                            </div>
                            <div style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: readerMuted }}>
                                第 {currentChapterNo} 章 · {tocChapters[currentChapterIdx]?.title || '当前章节'}
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button onClick={() => { setShowSearch(true); setShowBar(false); setShowFontPanel(false); setShowMoreMenu(false); }} title="搜索本书原文" aria-label="搜索本书原文" style={{ ...btnBase, width: 36, height: 36, padding: 0 }}>
                                <LucideIcon name="search" size={18} />
                            </button>
                            <button onClick={() => void openReadingConfirm()} disabled={currentChapterIdx < 0 || readingTask?.status === 'queued' || readingTask?.status === 'running'} title="阅读本章" aria-label="阅读本章" style={{ ...btnBase, width: 36, height: 36, padding: 0, opacity: currentChapterIdx < 0 ? 0.45 : 1 }}>
                                <LucideIcon name="circlePlay" size={18} />
                            </button>
                            <button onClick={() => { setShowMoreMenu(v => !v); setShowChapterMenu(false); setShowFontPanel(false); }} title="更多阅读工具" aria-label="更多阅读工具" style={{ ...btnBase, width: 36, height: 36, padding: 0 }}>
                                <LucideIcon name="ellipsis" size={19} />
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Content */}
            <div ref={contentRef} style={{
                flex: 1, overflow: mode === 'reading' ? 'hidden' : 'auto', position: 'relative',
                padding: mode === 'reading' ? '0' : '8px 20px 32px',
                background: mode === 'reading' ? readerSurface : 'transparent',
                touchAction: mode === 'reading' ? 'none' : undefined,
                userSelect: mode === 'reading' ? 'none' : undefined,
                WebkitUserSelect: mode === 'reading' ? 'none' : undefined,
                overscrollBehavior: mode === 'reading' ? 'none' : undefined,
            }} className="no-scrollbar study-scroll-container"
                onClick={handleReaderSurfaceClick}
                onPointerDown={mode === 'reading' ? (e) => {
                    if (e.isPrimary === false) return;
                    pageDragAnimationRef.current?.cancel();

                    const target = e.target as HTMLElement | null;
                    const startedOnControl = Boolean(
                        target?.closest('button, input, textarea, select, a, [role="button"], [data-reader-control], [data-reader-panel]')
                    );
                    if (startedOnControl) {
                        pagePointerRef.current = null;
                        return;
                    }

                    if (readerPageTurnEffect !== 'curl') {
                        pagePointerRef.current = null;
                        return;
                    }

                    const pageEl = document.querySelector('.coread-reader-page-transition') as HTMLElement | null;
                    const bodyEl = pageEl?.querySelector('[data-page-content]') as HTMLElement | null;
                    if (!pageEl || !bodyEl) return;

                    // 拖动纸张必须是“独立的一张纸”：把当前页复制成一个真正的同级图层。
                    // 这样父页面的 clip-path 不会把被掀起的纸一起裁掉，也能保留原页文字/图片。
                    const curlEl = pageEl.cloneNode(true) as HTMLElement;
                    curlEl.className = 'coread-reader-page-curl-live';
                    curlEl.removeAttribute('data-page-main-content');
                    curlEl.querySelectorAll('[data-page-curl-sheet]').forEach((node) => node.remove());
                    curlEl.setAttribute('data-page-curl-sheet', 'true');
                    curlEl.setAttribute('data-curl-active', 'true');
                    Object.assign(curlEl.style, {
                        position: 'absolute', inset: '0', width: '100%', height: '100%',
                        zIndex: '4', pointerEvents: 'none', overflow: 'hidden',
                        background: readerSurface, opacity: '1', display: 'block',
                        transform: 'translate3d(0,0,0)', transformStyle: 'preserve-3d',
                        backfaceVisibility: 'hidden', willChange: 'clip-path, transform, filter',
                    });
                    const backface = document.createElement('div');
                    backface.className = 'coread-page-curl-backface';
                    curlEl.appendChild(backface);
                    const crease = document.createElement('div');
                    crease.className = 'coread-page-crease';
                    curlEl.appendChild(crease);
                    pageEl.parentElement?.appendChild(curlEl);

                    const pageRect = pageEl.getBoundingClientRect();
                    const startY = Math.max(0, Math.min(pageRect.height, e.clientY - pageRect.top));
                    const startRatio = startY / Math.max(pageRect.height, 1);
                    const grabMode: 'center' | 'top' | 'bottom' =
                        startRatio < 0.28 ? 'top' :
                        startRatio > 0.72 ? 'bottom' :
                        'center';

                    pageEl.style.transition = 'none';
                    pageEl.style.transform = 'translate3d(0,0,0)';

                    bodyEl.style.transition = 'none';
                    bodyEl.style.willChange = 'clip-path';
                    pageEl.style.clipPath = 'inset(0 0 0 0)';

                    curlEl.style.transition = 'none';
                    curlEl.style.transformOrigin = '50% 50%';
                    curlEl.style.clipPath = 'inset(0 0 0 0)';

                    pagePointerRef.current = {
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        startY: e.clientY,
                        pageEl,
                        bodyEl,
                        curlEl,
                        direction: null,
                        grabMode,
                        moved: false,
                    };
                    pagePointerXRef.current = e.clientX;

                    try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {}
                    if (e.cancelable) e.preventDefault();
                } : undefined}
                onPointerMove={mode === 'reading' ? (e) => {
                    const gesture = pagePointerRef.current;
                    if (!gesture || e.pointerId !== gesture.pointerId) return;

                    const dx = e.clientX - gesture.startX;
                    const dy = e.clientY - gesture.startY;

                    if (!gesture.direction) {
                        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
                        if (Math.abs(dx) < Math.abs(dy) * 0.55) return;
                        gesture.direction = dx < 0 ? 'forward' : 'backward';
                        setPageTurnDirection(gesture.direction);
                        reserveSelectionGesture(1400);
                    }

                    if (gesture.direction === 'forward' && dx >= 0) return;
                    if (gesture.direction === 'backward' && dx <= 0) return;

                    gesture.moved = Math.abs(dx) > 3;
                            const current = pagePointerRef.current;
                            if (!current || !current.curlEl || !current.bodyEl) return;

                            const rect = current.pageEl?.getBoundingClientRect();
                            const width = Math.max(rect?.width || window.innerWidth, 1);
                            const height = Math.max(rect?.height || window.innerHeight, 1);
                            const localX = Math.max(0, Math.min(width, e.clientX - (rect?.left || 0)));
                            const localY = Math.max(0, Math.min(height, e.clientY - (rect?.top || 0)));

                            const progress = Math.min(1, Math.max(0, Math.abs(dx) / width));
                            const px = Math.max(0, Math.min(width, localX));
                            const py = Math.max(0, Math.min(height, localY));
                            const pct = (v: number, total: number) =>
                                `${Math.max(0, Math.min(100, (v / Math.max(total, 1)) * 100))}%`;

                            if (current.grabMode === 'center') {
                                // 中间按下：整页模型。
                                // 手指所在位置成为折痕，纸张主体仍在原位，
                                // 被掀起的一侧是一整张不透明纸。
                                const bow = Math.min(width * 0.15, 22 + progress * width * 0.10);
                                const center = py / Math.max(height, 1);
                                const curveAt = (ratio: number) => {
                                    const d = (ratio - center) * 2;
                                    return Math.sin(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d))) * bow;
                                };
                                const samples = [0, 0.14, 0.30, 0.50, 0.70, 0.86, 1];
                                const foldPoints = samples.map((ratio) => ({
                                    x: Math.max(0, Math.min(width,
                                        current.direction === 'forward'
                                            ? px + curveAt(ratio)
                                            : px - curveAt(ratio)
                                    )),
                                    y: ratio * height,
                                }));

                                const fold = foldPoints.map(p => `${pct(p.x,width)} ${pct(p.y,height)}`).join(', ');

                                // forward: 当前纸留在左侧，右侧才是被掀起的纸；
                                // backward: 当前纸留在右侧，左侧才是被掀起的纸。
                                const bodyPoly = current.direction === 'forward'
                                    ? `0% 0%, ${fold}, 0% 100%`
                                    : `100% 0%, 100% 100%, ${fold}`;

                                const curlPoly = current.direction === 'forward'
                                    ? `${fold}, 100% 100%, 100% 0%`
                                    : `${fold}, 0% 0%, 0% 100%`;

                                current.pageEl.style.clipPath = `polygon(${bodyPoly})`;
                                current.curlEl.style.opacity = '1';
                                current.curlEl.style.inset = '0';
                                current.curlEl.style.width = '100%';
                                current.curlEl.style.height = '100%';
                                current.curlEl.style.clipPath = `polygon(${curlPoly})`;
                                current.curlEl.style.transformOrigin =
                                    `${pct(px,width)} ${pct(py,height)}`;
                                const bend = Math.min(52, 6 + progress * 46);
                                const lift = Math.min(16, 2 + progress * 14);
                                current.curlEl.style.transform =
                                    `perspective(1500px) translate3d(0,0,${lift}px) rotateY(${current.direction === 'forward' ? -bend : bend}deg)`;
                                current.curlEl.style.filter =
                                    `drop-shadow(${current.direction === 'forward' ? '-8px' : '8px'} 5px 13px rgba(50,40,30,${0.16 + progress * 0.12}))`;
                                const creaseEl = current.curlEl.querySelector('.coread-page-crease') as HTMLElement | null;
                                if (creaseEl) {
                                    creaseEl.style.left = `${(px / width) * 100}%`;
                                    creaseEl.style.opacity = String(Math.min(1, progress * 2.5));
                                }
                            } else {
                                // 靠近上/下边按下：角落模型。
                                // 上半区抓上角，下半区抓下角；左右方向只决定是哪一侧的角。
                                const cornerX = current.direction === 'forward' ? width : 0;
                                const cornerY = current.grabMode === 'top' ? 0 : height;
                                const dxCorner = px - cornerX;
                                const dyCorner = py - cornerY;
                                const cornerProgress = Math.min(
                                    1,
                                    Math.max(0, Math.abs(dxCorner) / width)
                                );

                                // 角落向手指移动，但留一点“纸张弧度”，避免变成硬三角。
                                const bow = Math.min(100, 18 + cornerProgress * 110);
                                const foldX = current.direction === 'forward'
                                    ? Math.max(0, px - bow * (1 - cornerProgress * 0.22))
                                    : Math.min(width, px + bow * (1 - cornerProgress * 0.22));
                                const foldY = current.grabMode === 'top'
                                    ? Math.min(height, Math.max(0, py + Math.abs(dyCorner) * 0.12))
                                    : Math.max(0, Math.min(height, py - Math.abs(dyCorner) * 0.12));

                                const fx = pct(foldX,width);
                                const fy = pct(foldY,height);
                                const pxPct = pct(px,width);
                                const pyPct = pct(py,height);

                                const bodyPoly = current.direction === 'forward'
                                    ? current.grabMode === 'top'
                                        ? `0% 100%, 100% 100%, 100% 0%, ${fx} ${fy}, 0% 0%`
                                        : `0% 0%, 100% 0%, 100% 100%, ${fx} ${fy}, 0% 100%`
                                    : current.grabMode === 'top'
                                        ? `0% 100%, 100% 100%, 100% 0%, 0% 0%, ${fx} ${fy}`
                                        : `0% 0%, 100% 0%, 0% 100%, ${fx} ${fy}, 100% 100%`;

                                current.pageEl.style.clipPath = `polygon(${bodyPoly})`;

                                const curlPoly = current.direction === 'forward'
                                    ? current.grabMode === 'top'
                                        ? `${pxPct} ${pyPct}, 100% 0%, 100% 100%, 0% 100%, ${fx} ${fy}`
                                        : `${pxPct} ${pyPct}, 100% 100%, 0% 100%, 0% 0%, ${fx} ${fy}`
                                    : current.grabMode === 'top'
                                        ? `${pxPct} ${pyPct}, 0% 0%, 0% 100%, 100% 100%, ${fx} ${fy}`
                                        : `${pxPct} ${pyPct}, 0% 100%, 0% 0%, 100% 0%, ${fx} ${fy}`;

                                current.curlEl.style.opacity = String(Math.min(1, 0.94 + cornerProgress * 0.06));
                                current.curlEl.style.inset = '0';
                                current.curlEl.style.width = '100%';
                                current.curlEl.style.height = '100%';
                                current.curlEl.style.clipPath = `polygon(${curlPoly})`;
                                current.curlEl.style.transformOrigin =
                                    `${current.direction === 'forward' ? 100 : 0}% ${current.grabMode === 'top' ? 0 : 100}%`;

                                const rotate = Math.min(46, 6 + cornerProgress * 40);
                                const lift = Math.min(34, 7 + cornerProgress * 27);
                                const rotateY = current.direction === 'forward' ? -rotate : rotate;
                                const rotateX = current.grabMode === 'top' ? rotate * 0.18 : -rotate * 0.18;
                                current.curlEl.style.transform =
                                    `perspective(1600px) translate3d(0,0,${lift}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
                                current.curlEl.style.filter =
                                    `drop-shadow(${current.direction === 'forward' ? '-9px' : '9px'} ${current.grabMode === 'top' ? '7px' : '-7px'} 14px rgba(40,30,20,${0.13 + cornerProgress * 0.16}))`;
                                const cornerCrease = current.curlEl.querySelector('.coread-page-crease') as HTMLElement | null;
                                if (cornerCrease) {
                                    const creaseX = current.direction === 'forward' ? Math.max(0, px - 16) : Math.min(width, px + 16);
                                    cornerCrease.style.left = `${(creaseX / width) * 100}%`;
                                    cornerCrease.style.opacity = String(Math.min(1, cornerProgress * 2.5));
                                }
                            }                    if (e.cancelable) e.preventDefault();
                } : undefined}
                onPointerUp={mode === 'reading' ? (e) => {
                    const gesture = pagePointerRef.current;
                    if (!gesture || e.pointerId !== gesture.pointerId) return;

                    if (pagePointerRafRef.current !== null) {
                        window.cancelAnimationFrame(pagePointerRafRef.current);
                        pagePointerRafRef.current = null;
                    }

                    const dx = e.clientX - gesture.startX;
                    const dy = e.clientY - gesture.startY;

                    // 没有实际拖动：交给 click 事件处理。这样单击可以延迟到确认不是双击，
                    // 双击则只呼出原来的控制栏，不会连续翻两页。
                    if (!gesture.direction && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const target = e.target as HTMLElement | null;
                        const isControl = Boolean(target?.closest('button, input, textarea, select, a, [role="button"], [data-reader-control], [data-reader-panel]'));
                        if (!isControl && Date.now() >= selectionGestureLockUntil.current && !window.getSelection()?.toString().trim()) {
                            readerTapHandledByPointerRef.current = true;
                            queueReaderTap(e.clientX - rect.left, e.clientY - rect.top, rect.width);
                        }
                        pagePointerRef.current = null;
                        pagePointerXRef.current = null;
                        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
                        return;
                    }

                    const direction =
                        gesture.direction ??
                        (dx < 0 ? 'forward' : 'backward');

                    const canTurn =
                        direction === 'forward' ? page < totalPages : page > 1;

                    const bodyEl = gesture.bodyEl;
                    const curlEl = gesture.curlEl;
                    const pageEl = gesture.pageEl;
                    const width = Math.max(pageEl?.getBoundingClientRect().width || window.innerWidth, 1);
                    const height = Math.max(pageEl?.getBoundingClientRect().height || window.innerHeight, 1);

                    pagePointerRef.current = null;
                    pagePointerXRef.current = null;

                    if (!pageEl || !bodyEl || !curlEl || !canTurn) {
                        bodyEl && (pageEl.style.clipPath = 'inset(0 0 0 0)');
                        if (curlEl) {
                            curlEl.remove();
                        }
                        return;
                    }

                    // 松手判断：超过阈值完成翻页，不足回弹
                    const progress = Math.min(1, Math.max(0, Math.abs(dx) / width));
                    const THRESHOLD = 0.32;
                    const shouldTurn = canTurn && progress > THRESHOLD;
                    const settleMs = Math.max(220, Math.min(readerPageTurnDuration, shouldTurn ? 420 : 320));
                    bodyEl.style.transition = `clip-path ${settleMs}ms cubic-bezier(0.18,0.82,0.18,1)`;
                    curlEl.style.transition =
                        `clip-path ${settleMs}ms cubic-bezier(0.18,0.82,0.18,1), transform ${settleMs}ms cubic-bezier(0.18,0.82,0.18,1), filter ${settleMs}ms cubic-bezier(0.18,0.82,0.18,1)`;

                    if (gesture.grabMode === 'center') {
                        if (shouldTurn) {
                        const finalFold = direction === 'forward'
                            ? '18% 0%, 18% 100%'
                            : '82% 0%, 82% 100%';
                        pageEl.style.clipPath =
                            direction === 'forward'
                                ? `polygon(0% 0%, ${finalFold}, 0% 100%)`
                                : `polygon(100% 0%, 100% 100%, ${finalFold})`;
                        curlEl.style.opacity = '1';
                        curlEl.style.inset = '0';
                        curlEl.style.width = '100%';
                        curlEl.style.height = '100%';
                        curlEl.style.clipPath =
                            direction === 'forward'
                                ? `polygon(${finalFold}, 100% 100%, 100% 0%)`
                                : `polygon(${finalFold}, 0% 0%, 0% 100%)`;
                        curlEl.style.transformOrigin =
                            direction === 'forward' ? '18% 50%' : '82% 50%';
                        curlEl.style.transform =
                            `perspective(1500px) translate3d(0,0,12px) rotateY(${direction === 'forward' ? -48 : 48}deg)`;
                        curlEl.style.filter =
                            `drop-shadow(${direction === 'forward' ? '-10px' : '10px'} 6px 14px rgba(50,40,30,.22))`;
                        } else {
                            // 回弹：纸张恢复原位
                            pageEl.style.clipPath = 'inset(0 0 0 0)';
                            curlEl.style.opacity = '0';
                            curlEl.style.clipPath = 'inset(0 0 0 0)';
                            curlEl.style.transform = 'perspective(1500px) translate3d(0,0,0) rotateY(0deg)';
                            curlEl.style.filter = 'none';
                        }
                    } else {
                        // 角落模型：继续把“被揪起的角”送过整页，而不是把整张纸瞬间旋成卡片。
                        pageEl.style.clipPath =
                            direction === 'forward'
                                ? 'polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%)'
                                : 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
                        curlEl.style.opacity = '1';
                        curlEl.style.inset = '0';
                        curlEl.style.width = '100%';
                        curlEl.style.height = '100%';
                        curlEl.style.clipPath = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
                        curlEl.style.transformOrigin =
                            direction === 'forward'
                                ? `100% ${gesture.grabMode === 'top' ? 0 : 100}%`
                                : `0% ${gesture.grabMode === 'top' ? 0 : 100}%`;
                        curlEl.style.transform =
                            `perspective(1600px) translate3d(${direction === 'forward' ? 12 : -12}px,0,28px) rotateX(${gesture.grabMode === 'top' ? 8 : -8}deg) rotateY(${direction === 'forward' ? -62 : 62}deg)`;
                        curlEl.style.filter =
                            `drop-shadow(${direction === 'forward' ? '-11px' : '11px'} ${gesture.grabMode === 'top' ? '8px' : '-8px'} 15px rgba(40,30,20,.22))`;
                        } else {
                            // 回弹：角落纸张恢复原位
                            pageEl.style.clipPath = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
                            curlEl.style.opacity = '0';
                            curlEl.style.clipPath = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
                            curlEl.style.transform = 'perspective(1600px) translate3d(0,0,0) rotateX(0deg) rotateY(0deg)';
                            curlEl.style.filter = 'none';
                        }
                    }

                    skipNextPageTurnAnimationRef.current = true;
                    reserveSelectionGesture(1200);

                    window.setTimeout(() => {
                        bodyEl.style.transition = '';
                        pageEl.style.clipPath = '';
                        bodyEl.style.willChange = '';

                        curlEl.remove();

                        if (shouldTurn) {
                            goPage(direction === 'forward' ? 1 : -1);
                        }
                    }, settleMs);

                    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                        reserveSelectionGesture(900);
                    }

                    try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                    } catch {}
                } : undefined}
                onPointerCancel={mode === 'reading' ? (e) => {
                    const gesture = pagePointerRef.current;
                    if (!gesture || e.pointerId !== gesture.pointerId) return;

                    if (pagePointerRafRef.current !== null) {
                        window.cancelAnimationFrame(pagePointerRafRef.current);
                        pagePointerRafRef.current = null;
                    }

                    const bodyEl = gesture.bodyEl;
                    const curlEl = gesture.curlEl;
                    const pageEl = gesture.pageEl;
                    pagePointerRef.current = null;
                    pagePointerXRef.current = null;

                    if (bodyEl && pageEl) {
                        bodyEl.style.transition = '';
                        pageEl.style.clipPath = 'inset(0 0 0 0)';
                    }
                    if (curlEl) {
                        curlEl.remove();
                    }
                } : undefined}>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: '#bbb', fontSize: 14 }}>加载中...</div>
                ) : error ? (
                    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                        <div style={{ fontSize: 13, color: '#e88', marginBottom: 12 }}>{error}</div>
                        <button onClick={() => loadBooks()} style={{ background: 'none', border: `1px solid ${c.primaryBorder}`, borderRadius: 12, padding: '8px 20px', fontSize: 12, color: c.primary, cursor: 'pointer' }}>重试</button>
                    </div>
                ) : mode === 'shelf' ? (
                    <>
                        <div className="coread-shelf-tools">
                            <input
                                className="coread-shelf-search"
                                value={shelfQuery}
                                onChange={e => setShelfQuery(e.target.value)}
                                placeholder="搜索书名、标签、备注"
                            />
                            <div className="coread-shelf-desktop-filters">
                                <select className="coread-shelf-select" value={shelfCategory} onChange={e => setShelfCategory(e.target.value)}>
                                    <option value="全部">全部分类</option>
                                    {libraryCategories.map(category => <option key={category} value={category}>{category}</option>)}
                                </select>
                                <select className="coread-shelf-select" value={shelfTag} onChange={e => setShelfTag(e.target.value)}>
                                    <option value="全部">全部标签</option>
                                    {libraryTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
                                </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                <button
                                    className="coread-icon-button coread-shelf-mobile-filter"
                                    onClick={() => setShowShelfFilters(value => !value)}
                                    title="筛选书架"
                                    aria-label="筛选书架"
                                >
                                    <LucideIcon name="slidersHorizontal" size={17} />
                                </button>
                                <div className="coread-layout-anchor">
                                    <button
                                        className="coread-icon-button"
                                        onClick={() => setShowShelfLayout(value => !value)}
                                        title="设置书架列数"
                                        aria-label="设置书架列数"
                                    >
                                        <LucideIcon name="layoutGrid" size={17} />
                                    </button>
                                    {showShelfLayout && (
                                        <div className="coread-layout-popover">
                                            <div style={{ fontSize: 12, fontWeight: 900, paddingBottom: 7, borderBottom: '2px solid #111' }}>书架列数</div>
                                            <div className="coread-layout-options">
                                                {(['auto', 2, 3, 4, 5, 6] as ShelfColumns[]).map(option => (
                                                    <button
                                                        key={option}
                                                        className={`coread-layout-option${shelfColumns === option ? ' is-selected' : ''}`}
                                                        onClick={() => {
                                                            updateShelfColumns(option);
                                                            setShowShelfLayout(false);
                                                        }}
                                                        aria-pressed={shelfColumns === option}
                                                    >
                                                        {option === 'auto' ? '自动' : option}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            {showShelfFilters && (
                                <div className="coread-shelf-filter-panel">
                                    <select className="coread-shelf-select" value={shelfCategory} onChange={e => setShelfCategory(e.target.value)}>
                                        <option value="全部">全部分类</option>
                                        {libraryCategories.map(category => <option key={category} value={category}>{category}</option>)}
                                    </select>
                                    <select className="coread-shelf-select" value={shelfTag} onChange={e => setShelfTag(e.target.value)}>
                                        <option value="全部">全部标签</option>
                                        {libraryTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                        {books.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#555' }}>
                                <div style={{ width: 56, height: 56, border: '2px solid #111', background: '#fff', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111' }}>
                                    <LucideIcon name="bookOpen" size={30} strokeWidth={1.7} />
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{showTrash ? '回收站是空的' : '书架空空的'}</div>
                                {!showTrash && <div style={{ fontSize: 12, color: '#888' }}>点右上角上传一本书</div>}
                            </div>
                        ) : visibleBooks.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '52px 20px', color: '#aaa', fontSize: 13 }}>没有符合条件的书</div>
                        ) : (
                            <div
                                className="coread-shelf-grid"
                                data-columns={shelfColumns}
                                style={{
                                    '--shelf-columns': shelfColumns === 'auto' ? 2 : shelfColumns,
                                } as React.CSSProperties}
                            >
                                {[...visibleBooks].sort((a, b) => {
                                    const aTime = bookLastReadTime(a);
                                    const bTime = bookLastReadTime(b);
                                    if (aTime || bTime) { if (aTime !== bTime) return bTime - aTime; }
                                    return b.id - a.id;
                                }).map((book, i) => {
                                    const progress = book.current_page && book.total_paragraphs > 0
                                        ? Math.round(((book.current_page * 10) / book.total_paragraphs) * 100) : 0;
                                    const selected = selectedBooks.has(book.id);
                                    return (
                                        <div key={book.id} className={`coread-shelf-card${selected ? ' is-selected' : ''}`}>
                                            <button onClick={() => {
                                                if (editMode) {
                                                    setSelectedBooks(prev => { const s = new Set(prev); s.has(book.id) ? s.delete(book.id) : s.add(book.id); return s; });
                                                } else if (!showTrash) openBook(book);
                                            }} style={{
                                                background: 'none', padding: 0, border: 'none', cursor: editMode || !showTrash ? 'pointer' : 'default',
                                                textAlign: 'left', display: 'flex', flexDirection: 'column', width: '100%',
                                            }}>
                                                <div className="coread-shelf-cover" style={{ background: BOOK_COVERS[i % BOOK_COVERS.length] }}>
                                                    {editMode && (
                                                        <div className={`coread-shelf-select-mark${selected ? ' is-selected' : ''}`}>
                                                            {selected && <LucideIcon name="check" size={15} strokeWidth={3} />}
                                                        </div>
                                                    )}
                                                    {book.cover_image ? (
                                                        <img src={api.imageUrl(book.id, book.cover_image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(1) contrast(1.12)' }} />
                                                    ) : (
                                                        <span style={{
                                                            maxWidth: '78%', padding: '8px 7px', border: `2px solid ${i % 2 === 0 ? '#fff' : '#111'}`,
                                                            background: i % 2 === 0 ? '#111' : '#fff', color: i % 2 === 0 ? '#fff' : '#111',
                                                            fontSize: 17, fontWeight: 900, textAlign: 'center', lineHeight: 1.35,
                                                            wordBreak: 'break-all', whiteSpace: 'pre-wrap',
                                                        }}>{book.title.slice(0, 10)}</span>
                                                    )}
                                                    {book.comment_count > 0 && (
                                                        <div style={{ position: 'absolute', top: 7, right: showTrash ? 7 : 44, background: '#fff', border: '1px solid #111', padding: '1px 6px', fontSize: 9, fontWeight: 800, color: '#111' }}>
                                                            {book.comment_count}
                                                        </div>
                                                    )}
                                                    {progress > 0 && (
                                                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(0,0,0,0.1)' }}>
                                                            <div style={{ height: '100%', width: `${Math.min(progress, 100)}%`, background: '#111' }} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="coread-shelf-book-title">{book.title.slice(0, 10)}</div>
                                            </button>
                                            {!editMode && (
                                                showTrash ? (
                                                    <>
                                                        <button onClick={(e) => { e.stopPropagation(); handleRestoreBook(book.id); }}
                                                            title="恢复书籍" aria-label="恢复书籍"
                                                            className="coread-bookmark-button">
                                                            <LucideIcon name="archiveRestore" size={15} />
                                                        </button>
                                                        <button onClick={(e) => { e.stopPropagation(); setConfirmPermanentDelete(book.id); }}
                                                            title="永久删除书籍" aria-label="永久删除书籍"
                                                            className="coread-spine-delete">
                                                            永久删除
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button onClick={(e) => { e.stopPropagation(); openBookEditor(book); }}
                                                            title="编辑书籍" aria-label="编辑书籍"
                                                            className="coread-bookmark-button">
                                                            <LucideIcon name="pencil" size={15} />
                                                        </button>
                                                        <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(book.id); }}
                                                            title="删除书籍" aria-label="删除书籍"
                                                            className="coread-spine-delete">
                                                            删除
                                                        </button>
                                                    </>
                                                )
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                ) : (
                    /* Reading Mode — immersive, no card border */
                    <>
                        {readingLoading ? (
                            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#bbb', fontSize: 14 }}>
                                {paginateProgress != null ? (
                                    <>
                                        <div style={{ marginBottom: 12 }}>大书首次打开需要分页一次，之后秒开</div>
                                        <div style={{ width: 180, height: 4, borderRadius: 2, background: `${c.primary}18`, margin: '0 auto 8px', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', borderRadius: 2, width: `${Math.round(paginateProgress * 100)}%`, background: c.primary }} />
                                        </div>
                                        <div style={{ fontSize: 12, color: '#ccc' }}>{Math.round(paginateProgress * 100)}%</div>
                                    </>
                                ) : '加载中...'}
                            </div>
                        ) : allParas.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb', fontSize: 14 }}>这一页没有内容</div>
                        ) : (
                            <div
                                style={{
                                    position: 'relative',
                                    width: '100%',
                                    height: '100%',
                                    minHeight: 0,
                                    overflow: 'hidden',
                                    isolation: 'isolate',
                                }}
                            >
                                {/* Layer 0: 下一页（完整、不透明，始终存在但被遮挡） */}
                                {readerPageTurnEffect === 'curl' ? (
                                    <>
                                        {adjacentPageFragments.previous.length > 0 && renderLayeredPreview(adjacentPageFragments.previous, page - 1)}
                                        {adjacentPageFragments.next.length > 0 && renderLayeredPreview(adjacentPageFragments.next, page + 1)}
                                    </>
                                ) : (
                                    pageTurnDirection === 'backward'
                                        ? (adjacentPageFragments.previous.length > 0 && renderLayeredPreview(adjacentPageFragments.previous, page - 1))
                                        : (adjacentPageFragments.next.length > 0 && renderLayeredPreview(adjacentPageFragments.next, page + 1))
                                )}

                                {/* Layer 1: 翻起页（由 pointer 事件动态创建） */}
                                <div
                                    aria-hidden="true"
                                    data-page-curl-sheet
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        width: '100%',
                                        height: '100%',
                                        opacity: 0,
                                        display: 'none',
                                        zIndex: 4,
                                        pointerEvents: 'none',
                                        overflow: 'hidden',
                                        boxSizing: 'border-box',
                                        background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,.16) 48%, rgba(255,255,255,.22) 52%, transparent 100%)',
                                        boxShadow: '0 12px 30px rgba(50,40,30,.16)',
                                        transformStyle: 'preserve-3d',
                                        backfaceVisibility: 'hidden',
                                        isolation: 'isolate',
                                        contain: 'paint',
                                    } as React.CSSProperties}
                                />

                                {/* Layer 2: 当前页（主内容层） */}
                            <div
                                key={`reader-page-${page}-${pageTurnNonce}`}
                                className={`coread-reader-page-transition ${!skipNextPageTurnAnimationRef.current && readerPageTurnEffect !== 'curl' && readerPageTurnEffect === 'slide' ? `is-slide-${pageTurnDirection}` : !skipNextPageTurnAnimationRef.current && readerPageTurnEffect === 'fade' ? 'is-fade' : ''}`}
                                style={{
                                    '--coread-page-turn-duration': `${readerPageTurnDuration}ms`,
                                    '--reader-surface': readerSurface,
                                    position: 'absolute',
                                    inset: 0,
                                    width: '100%',
                                    height: '100%',
                                    zIndex: 2,
                                    background: readerSurface,
                                    transform: 'translate3d(0, 0, 0)',
                                    transformOrigin: 'center center',
                                    backfaceVisibility: 'hidden',
                                    transformStyle: 'preserve-3d',
                                    overflow: 'visible',
                                    perspective: 1200,
                                } as React.CSSProperties}
                            >

<div
                                    data-page-content
                                    className="coread-reader-body"
                                    style={{
                                        width: readerContentWidth,
                                        fontFamily: globalReaderFont.family,
                                        background: readerSurface,
                                        maxWidth: '100%',
                                        margin: '0 auto',
                                        minHeight: pageHeight
                                            ? pageHeight + readerLayout.topInset + readerLayout.bottomInset
                                            : undefined,
                                        paddingTop: readerLayout.topInset,
                                        paddingBottom: readerLayout.bottomInset,
                                        boxSizing: 'border-box',
                                        overflow: 'hidden',
                                    }}>
                                {pageFragments.map((frag, visibleIndex) => {
                                    const original = paragraphAt(frag.sourceIdx) || frag;
                                    const heading = isHeading(original.content) && !frag.isPartialStart;
                                    const chapterTitle = isChapterStartIndex(frag.sourceIdx) && !frag.isPartialStart;
                                    const rawInline = commentsForPara(frag.idx).filter(x => x.sel_start_idx != null && x.sel_end_idx != null);
                                    const inlineComments = rawInline.map(h => {
                                        const endPara = h.sel_end_para_idx ?? h.paragraph_idx;
                                        let s = h.sel_start_idx!, e = h.sel_end_idx!;
                                        if (h.paragraph_idx === frag.idx && endPara === frag.idx) { /* single para */ }
                                        else if (h.paragraph_idx === frag.idx) { e = frag.endOffset; }
                                        else if (endPara === frag.idx) { s = frag.startOffset; }
                                        else { s = frag.startOffset; e = frag.endOffset; }
                                        return { ...h, sel_start_idx: s - frag.startOffset, sel_end_idx: e - frag.startOffset };
                                    }).filter(h => h.sel_end_idx! > 0 && h.sel_start_idx! < frag.content.length);

                                    const blockComments = commentsForPara(frag.idx).filter(x => (x.sel_start_idx == null || x.sel_end_idx == null) && x.paragraph_idx === frag.idx && !frag.isPartialStart);

                                    const imgMatch = frag.content.match(/^\[IMG:([^\]]+)\]$/);
                                    if (imgMatch && activeBook) {
                                        const imgUrl = api.imageUrl(activeBook.id, imgMatch[1]);
                                        return (
                                            <div key={`${frag.idx}-${frag.startOffset}-${frag.endOffset}`} style={{ marginBottom: readerLayout.paragraphGap, textAlign: 'center' }}>
                                                <img src={imgUrl} alt="" style={{ maxWidth: '100%', maxHeight: `${Math.floor(readerSize.height * 0.6)}px`, objectFit: 'contain', display: 'block', margin: '0 auto', borderRadius: 8 }} />
                                            </div>
                                        );
                                    }
                                    return (
                                        <div key={`${frag.idx}-${frag.startOffset}-${frag.endOffset}`} style={{ marginBottom: chapterTitle ? CHAPTER_GAP_BOTTOM : readerLayout.paragraphGap, marginTop: chapterTitle && visibleIndex > 0 ? CHAPTER_GAP_TOP : 0 }}>
                                            <div data-reader-text="true" data-para-idx={frag.idx} data-frag-start={frag.startOffset} data-frag-end={frag.endOffset} style={{
                                                fontSize: chapterTitle ? readerLayout.fontSize + 4 : original.content.trim().startsWith('# ') ? readerLayout.fontSize + 3 : original.content.trim().startsWith('## ') ? readerLayout.fontSize + 2 : readerLayout.fontSize,
                                                fontFamily: globalReaderFont.family,
                                                lineHeight: chapterTitle ? 2.2 : readerLayout.lineHeight, color: readerText,
                                                letterSpacing: chapterTitle ? readerLayout.letterSpacing + 0.7 : readerLayout.letterSpacing, textIndent: (heading || chapterTitle || frag.isPartialStart) ? 0 : `${readerLayout.textIndent}em`,
                                                fontWeight: chapterTitle ? 800 : heading ? 700 : 400, marginBottom: heading ? 4 : 0,
                                                textAlign: chapterTitle ? 'center' : undefined,
                                                userSelect: 'text', WebkitUserSelect: 'text', whiteSpace: 'pre-wrap',
                                            } as any}>
                                                {renderHighlighted(
                                                    decodeEntities(frag.content),
                                                    frag.idx,
                                                    inlineComments,
                                                    activeSearchMatch && Number(activeSearchMatch.paragraph_idx) === Number(frag.idx)
                                                        ? {
                                                            start: Math.max(0, activeSearchMatch.start - frag.startOffset),
                                                            end: Math.max(0, activeSearchMatch.end - frag.startOffset),
                                                        }
                                                        : null,
                                                )}
                                            </div>

                                            {blockComments.length > 0 && (
                                                <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    {blockComments.filter(x => !x.reply_to).map(cmt => {
                                                        const isShen = cmt.from_who.toLowerCase() === 'ai' || cmt.from_who.toLowerCase() === aiName.toLowerCase();
                                                        const color = isShen ? c.shenColor : c.tongColor;
                                                        return (
                                                            <span key={cmt.id} onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (activeComments.length > 0 && activeComments[0]?.id === cmt.id) {
                                                                    closeCommentDetails();
                                                                    return;
                                                                }
                                                                const allR: Comment[] = [];
                                                                const findR = (ids: number[]) => {
                                                                    const found = comments.filter(reply => reply.reply_to && ids.includes(reply.reply_to));
                                                                    if (found.length) {
                                                                        allR.push(...found);
                                                                        findR(found.map(reply => reply.id));
                                                                    }
                                                                };
                                                                findR([cmt.id]);
                                                                openCommentDetails([cmt, ...allR]);
                                                            }}
                                                                style={{ width: 8, height: 8, borderRadius: '50%', background: color, cursor: 'pointer', display: 'inline-block', opacity: 0.7 }} />
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                </div>

                                <div
                                    aria-hidden="true"
                                    className="coread-page-curl-overlay"
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        bottom: 0,
                                        left: 0,
                                        width: '18%',
                                        pointerEvents: 'none',
                                        zIndex: 4,
                                        opacity: 'var(--coread-curl-shadow, 0)' as any,
                                        background: 'linear-gradient(90deg, rgba(0,0,0,.22), rgba(0,0,0,.08) 38%, rgba(255,255,255,.22) 70%, transparent)',
                                        filter: 'blur(1.2px)',
                                        mixBlendMode: 'multiply',
                                        transform: 'translateZ(2px)',
                                    } as React.CSSProperties}
                                />
                                <div
                                    aria-hidden="true"
                                    className="coread-page-curl-crease"
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        bottom: 0,
                                        left: 'calc(18% - 1px)',
                                        width: 2,
                                        pointerEvents: 'none',
                                        zIndex: 5,
                                        opacity: 'var(--coread-curl-shadow, 0)' as any,
                                        background: 'linear-gradient(180deg, transparent, rgba(0,0,0,.24) 45%, transparent)',
                                        boxShadow: '0 0 14px rgba(0,0,0,.18)',
                                        transform: 'translateZ(4px)',
                                    } as React.CSSProperties}
                                />
                            </div>
                            </div>
                        )}
                    </>
                )}
                {mode === 'reading' && (
                    <div ref={measureRef} aria-hidden style={{
                        position: 'absolute',
                        top: -99999,
                        left: 0,
                        width: readerContentWidth,
                        visibility: 'hidden',
                        pointerEvents: 'none',
                        zIndex: -1,
                        boxSizing: 'border-box',
                        whiteSpace: 'normal',
                    }} />
                )}
            </div>

            {/* Floating annotation bar — appears when text is selected */}
            {floatingBar && mode === 'reading' && commentingIdx === null && (
                <div style={{
                    position: 'fixed',
                    top: floatingBar.top,
                    left: floatingBar.left,
                    transform: floatingBar.placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    maxWidth: 'calc(100vw - 16px)',
                    background: readerPanel,
                    border: `1px solid ${readerBorder}`,
                    borderRadius: 8,
                    padding: 4,
                    boxShadow: '0 5px 18px rgba(0,0,0,0.18)',
                    zIndex: 40,
                }}>
                    <button onPointerDown={(e) => { e.preventDefault(); startAnnotation(); }}
                        style={{ border: 'none', borderRadius: 6, background: c.primary, color: '#fff', minHeight: 32, padding: '0 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        添加批注
                    </button>
                    <button onPointerDown={(e) => { e.preventDefault(); copySelection(); }}
                        style={{ border: `1px solid ${readerBorder}`, borderRadius: 6, background: 'transparent', color: readerText, minHeight: 32, padding: '0 9px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        复制
                    </button>
                    <button onPointerDown={(e) => { e.preventDefault(); addWavyUnderline(); }}
                        style={{ border: `1px solid ${readerBorder}`, borderRadius: 6, background: 'transparent', color: readerText, minHeight: 32, padding: '0 9px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        波浪线
                    </button>
                </div>
            )}

            {mode === 'reading' && commentingIdx !== null && !replyingTo && activeComments.length === 0 && (
                <div onClick={(e) => e.stopPropagation()} style={{
                    position: 'absolute', left: 16, right: 16, bottom: 20, zIndex: 32,
                    background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(24px)',
                    borderRadius: 20, padding: 16, border: `1px solid ${c.primaryBorder}`,
                    boxShadow: '0 -4px 32px rgba(0,0,0,0.12)',
                }}>
                    {selectedText && (
                        <div style={{ fontSize: 12, color: '#777', fontStyle: 'italic', marginBottom: 10, padding: '8px 10px', background: c.tongHL, borderRadius: 12, lineHeight: 1.5, borderLeft: `3px solid ${c.tongColor}60`, maxHeight: 96, overflow: 'auto' }} className="no-scrollbar">
                            {selectedText.length > 160 ? selectedText.slice(0, 160) + '...' : selectedText}
                        </div>
                    )}
                    <textarea className="coread-reader-note" value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="写下你的想法..."
                        style={{ width: '100%', minHeight: 72, border: 'none', background: 'transparent', fontSize: readerLayout.noteFontSize, color: '#444', resize: 'none', outline: 'none', lineHeight: readerLayout.noteLineHeight, letterSpacing: readerLayout.noteLetterSpacing }} autoFocus />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                        <button onClick={() => { setCommentingIdx(null); setCommentText(''); setSelectedText(''); setSelRange(null); setNewCommentThreadKey(null); }}
                            style={{ background: 'none', border: `1px solid ${c.primaryBorder}`, borderRadius: 12, padding: '7px 16px', fontSize: 12, color: '#999', cursor: 'pointer' }}>取消</button>
                        <button onClick={() => handleAddComment(false)} disabled={!commentText.trim() || commentReplyBusy}
                            title="只保存批注" aria-label="只保存批注"
                            style={{ background: c.primaryBg, border: `1px solid ${c.primaryBorder}`, borderRadius: 12, padding: '7px 12px', fontSize: 16, color: c.primary, cursor: 'pointer', opacity: commentText.trim() ? 1 : 0.5 }}>✈</button>
                        <button onClick={() => handleAddComment(true)} disabled={!commentText.trim() || commentReplyBusy}
                            title="保存并请小 C 回复" aria-label="保存并请小 C 回复"
                            style={{ width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: c.primary, border: 'none', borderRadius: '50%', padding: 0, color: 'white', cursor: 'pointer', opacity: commentText.trim() ? 1 : 0.5 }}><WakeGlyph busy={commentReplyBusy} /></button>
                    </div>
                </div>
            )}

            {/* Note popup — shows all overlapping annotations */}
            {activeComments.length > 0 && (
                <div onClick={(e) => e.stopPropagation()} style={{
                    position: 'absolute', bottom: 20, left: 16, right: 16,
                    background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(24px)',
                    borderRadius: 20, padding: '16px 20px', border: `1px solid ${c.primaryBorder}`,
                    boxShadow: '0 -4px 32px rgba(0,0,0,0.08)', zIndex: 20, maxHeight: '50vh', overflow: 'auto',
                }} className="no-scrollbar">
                    <button onClick={closeCommentDetails} style={{ position: 'absolute', top: 10, right: 14, background: 'none', border: 'none', fontSize: 18, color: '#ccc', cursor: 'pointer', lineHeight: 1, zIndex: 1 }}>×</button>
                    {(() => {
                        const ordered = sortCommentTimeline(activeComments);
                        const quote = (text: string) => text.length > 14 ? `${text.slice(0, 12)}……${text.slice(-2)}` : text;
                        const renderComment = (ac: Comment) => {
                            const isShen = ac.from_who.toLowerCase() === 'ai' || ac.from_who.toLowerCase() === aiName.toLowerCase();
                            const color = isShen ? c.shenColor : c.tongColor;
                            const bg = isShen ? c.shenBg : c.tongBg;
                            const parent = ac.reply_to ? ordered.find(item => item.id === ac.reply_to) : null;
                            return (
                                <div key={ac.id} style={{ display: 'flex', justifyContent: isShen ? 'flex-start' : 'flex-end', marginBottom: 12 }}>
                                    <div style={{ width: 'min(88%, 520px)', padding: '10px 12px', border: `1px solid ${color}55`, borderRadius: isShen ? '8px 8px 8px 2px' : '8px 8px 2px 8px', background: bg }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                        <span style={{ width: 24, height: 24, borderRadius: '50%', background: bg, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color }}>{displayName(ac.from_who).charAt(0)}</span>
                                        <span style={{ fontSize: 12, fontWeight: 600, color }}>{displayName(ac.from_who)}</span>
                                        <span style={{ fontSize: 10, color: '#ccc' }}>{ac.created_at?.slice(0, 16).replace('T', ' ')}</span>
                                    </div>
                                    {parent && (
                                        <div style={{ display: 'inline-flex', maxWidth: '100%', alignItems: 'center', marginBottom: 8, padding: '3px 7px', borderRadius: 999, background: readerPanel, border: `1px solid ${color}45`, color, fontSize: Math.max(10, readerLayout.noteFontSize - 2), lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            引用：{quote(parent.content || parent.selected_text || '原批注')}
                                        </div>
                                    )}
                                    <div className="coread-reader-note" style={{ fontSize: readerLayout.noteFontSize, color: '#333', lineHeight: readerLayout.noteLineHeight, letterSpacing: readerLayout.noteLetterSpacing, marginBottom: 8 }}>{ac.content}</div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                        <button onClick={() => toggleFavorite(ac)} title={ac.is_favorite ? '取消收藏' : '收藏这条批注'} aria-label={ac.is_favorite ? '取消收藏' : '收藏这条批注'}
                                            style={{ background: 'none', border: 'none', padding: '4px 6px', fontSize: 14, color: ac.is_favorite ? '#c98b42' : '#bbb', cursor: 'pointer' }}>{ac.is_favorite ? '★' : '☆'}</button>
                                        <button onClick={() => { replyPageRef.current = page; setReplyingTo(ac); setCommentingIdx(ac.paragraph_idx); setCommentText(''); }} style={{ background: 'none', border: `1px solid ${c.primaryBorder}`, borderRadius: 10, padding: '4px 14px', fontSize: 11, color: c.primary, cursor: 'pointer' }}>回复</button>
                                        <button onClick={() => wakeExistingComment(ac)} disabled={commentReplyBusy}
                                            title={commentReplyBusy ? '小 C 正在回复' : '请小 C 继续回应'}
                                            aria-label={commentReplyBusy ? '小 C 正在回复' : '请小 C 继续回应'}
                                            style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: c.primary, color: '#fff', border: 'none', borderRadius: '50%', padding: 0, cursor: 'pointer', opacity: commentReplyBusy ? 0.55 : 1 }}>
                                            <WakeGlyph busy={commentReplyBusy} size={13} />
                                        </button>
                                        {!isShen && (
                                            <button onClick={() => handleDeleteComment(ac)} style={{ background: 'none', border: '1px solid #f0d0d0', borderRadius: 10, padding: '4px 14px', fontSize: 11, color: '#d88', cursor: 'pointer' }}>删除</button>
                                        )}
                                    </div>
                                    </div>
                                </div>
                            );
                        };
                        return ordered.map(renderComment);
                    })()}
                    {(() => {
                        const original = activeComments.find(comment => comment.selected_text) || activeComments[0];
                        if (!original) return null;
                        if (replyingTo || commentingIdx === null) {
                            return (
                                <button onClick={() => prepareAdditionalComment(original)}
                                    style={{ width: '100%', marginTop: 2, minHeight: 38, border: `1px dashed ${c.primaryBorder}`, borderRadius: 8, background: 'transparent', color: c.primary, fontSize: 12, cursor: 'pointer' }}>
                                    继续为这段原文添加一条批注
                                </button>
                            );
                        }
                        return (
                            <div style={{ marginTop: 8, padding: '10px 12px', background: c.primaryBg, borderRadius: 14, border: `1px solid ${c.primaryBorder}` }}>
                                <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>继续为这段原文添加批注</div>
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                                    <textarea className="coread-reader-note" value={commentText} onChange={e => setCommentText(e.target.value)}
                                        placeholder="写下你的想法…" rows={2}
                                        style={{ flex: 1, minHeight: 46, maxHeight: 110, resize: 'vertical', border: `1px solid ${c.primaryBorder}`, borderRadius: 10, padding: '7px 10px', fontSize: readerLayout.noteFontSize, lineHeight: readerLayout.noteLineHeight, letterSpacing: readerLayout.noteLetterSpacing, outline: 'none', background: readerSurface, color: readerText }}
                                        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleAddComment(false); }} />
                                    <button onClick={() => handleAddComment(false)} disabled={!commentText.trim() || commentReplyBusy} title="只保存批注" aria-label="只保存批注"
                                        style={{ width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: c.primary, color: '#fff', border: 'none', borderRadius: '50%', padding: 0, fontSize: 16, cursor: 'pointer', opacity: commentText.trim() && !commentReplyBusy ? 1 : 0.45 }}>✈</button>
                                </div>
                            </div>
                        );
                    })()}
                    {replyingTo && (
                        <div style={{ marginTop: 8, padding: '10px 12px', background: c.primaryBg, borderRadius: 14, border: `1px solid ${c.primaryBorder}` }}>
                            <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>回复 {displayName(replyingTo.from_who)}：{replyingTo.content.slice(0, 30)}{replyingTo.content.length > 30 ? '…' : ''}</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input className="coread-reader-note" value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="写回复…" style={{ flex: 1, border: `1px solid ${c.primaryBorder}`, borderRadius: 10, padding: '6px 12px', fontSize: readerLayout.noteFontSize, letterSpacing: readerLayout.noteLetterSpacing, outline: 'none' }} onKeyDown={e => e.key === 'Enter' && handleAddComment()} />
                                <button onClick={() => handleAddComment(false)} disabled={commentReplyBusy} title="只保存回复" aria-label="只保存回复" style={{ background: c.primaryBg, color: c.primary, border: `1px solid ${c.primaryBorder}`, borderRadius: 10, padding: '6px 10px', fontSize: 16, cursor: 'pointer' }}>✈</button>
                                <button onClick={() => handleAddComment(true)} disabled={commentReplyBusy} title="保存并请小 C 回复" aria-label="保存并请小 C 回复" style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: c.primary, color: '#fff', border: 'none', borderRadius: '50%', padding: 0, cursor: 'pointer' }}><WakeGlyph busy={commentReplyBusy} /></button>
                                <button onClick={() => setReplyingTo(null)} style={{ background: 'none', border: `1px solid ${c.primaryBorder}`, borderRadius: 10, padding: '6px 10px', fontSize: 12, color: '#999', cursor: 'pointer' }}>×</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {mode === 'reading' && showStoryMaterials && (
                <div
                    onClick={() => { setShowStoryMaterials(false); setEditingStoryMaterial(null); }}
                    style={{
                        position: 'absolute', inset: 0, zIndex: 28, background: 'rgba(0,0,0,0.18)',
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                    }}>
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            width: '100%', maxWidth: 680, maxHeight: '78vh', display: 'flex', flexDirection: 'column',
                            background: readerPanel,
                            border: `1px solid ${c.primaryBorder}`, borderRadius: '20px 20px 0 0',
                            boxShadow: '0 -8px 36px rgba(0,0,0,0.16)', overflow: 'hidden',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `1px solid ${c.primaryBorder}` }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 15, fontWeight: 700, color: c.primaryDark }}>剧情资料</div>
                                <div style={{ fontSize: 11, color: readerMuted, marginTop: 3 }}>前情、摘要、共同印象与事实版本；手动编辑不会调用模型</div>
                            </div>
                            <button onClick={() => { setShowStoryMaterials(false); setEditingStoryMaterial(null); }} title="关闭剧情资料" aria-label="关闭剧情资料"
                                style={{ border: 'none', background: 'none', color: '#aaa', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '2px 4px' }}>×</button>
                        </div>
                        <div className="no-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '14px 18px', minHeight: 140 }}>
                            {storyMaterialsLoading ? (
                                <div style={{ textAlign: 'center', color: readerMuted, fontSize: 13, padding: '28px 12px' }}>正在读取服务器剧情资料…</div>
                            ) : (
                                <>
                                    <div role="tablist" aria-label="剧情资料分类" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 6, marginBottom: 12 }}>
                                        {([
                                            ['chapters', '剧情摘要'],
                                            ['blocks', '大总结'],
                                            ['impressions', '共同读书印象'],
                                            ['facts', '事实锚定'],
                                            ['comment_summaries', '批注摘要'],
                                        ] as const).map(([value, label]) => (
                                            <button key={value} role="tab" aria-selected={storyMaterialTab === value}
                                                onClick={() => setStoryMaterialTab(value)}
                                                style={{
                                                    minHeight: 36, padding: '6px 7px', borderRadius: 7,
                                                    border: `1px solid ${storyMaterialTab === value ? c.primary : readerBorder}`,
                                                    background: storyMaterialTab === value ? c.primaryBg : 'transparent',
                                                    color: storyMaterialTab === value ? c.primary : readerMuted,
                                                    cursor: 'pointer', fontSize: 11, fontWeight: storyMaterialTab === value ? 700 : 500,
                                                }}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>

                                    {(storyMaterialTab === 'blocks' || storyMaterialTab === 'impressions') && (
                                        <div style={{ marginBottom: 14, padding: 11, border: `1px solid ${c.primaryBorder}`, borderRadius: 8, background: c.primaryBg }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                                <strong style={{ flex: 1, color: c.primaryDark, fontSize: 12 }}>
                                                    {storyMaterialTab === 'blocks' ? '手动生成大总结' : '手动生成共同读书印象'}
                                                </strong>
                                                <span style={{ color: readerMuted, fontSize: 10 }}>只使用已保存的逐章摘要</span>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                                <label style={{ color: readerMuted, fontSize: 10 }}>
                                                    起始章节
                                                    <input type="number" min={1} max={Math.max(1, tocChapters.length)}
                                                        value={storyMaterialGenerator?.kind === (storyMaterialTab === 'blocks' ? 'block' : 'reading_impression') ? storyMaterialGenerator.start : ''}
                                                        onChange={event => {
                                                            const kind = storyMaterialTab === 'blocks' ? 'block' : 'reading_impression';
                                                            const max = Math.max(1, tocChapters.length);
                                                            const start = Math.max(1, Math.min(max, Number(event.target.value) || 1));
                                                            setStoryMaterialGenerator(previous => ({
                                                                kind, start, end: Math.max(start, Math.min(max, previous?.end || start)), busy: false, missingChapters: [],
                                                            }));
                                                        }}
                                                        style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '7px 8px', border: `1px solid ${readerBorder}`, borderRadius: 7, background: readerSurface, color: readerText, fontSize: 12 }} />
                                                </label>
                                                <label style={{ color: readerMuted, fontSize: 10 }}>
                                                    结束章节
                                                    <input type="number" min={1} max={Math.max(1, tocChapters.length)}
                                                        value={storyMaterialGenerator?.kind === (storyMaterialTab === 'blocks' ? 'block' : 'reading_impression') ? storyMaterialGenerator.end : ''}
                                                        onChange={event => {
                                                            const kind = storyMaterialTab === 'blocks' ? 'block' : 'reading_impression';
                                                            const max = Math.max(1, tocChapters.length);
                                                            const start = storyMaterialGenerator?.kind === kind ? storyMaterialGenerator.start : 1;
                                                            const end = Math.max(start, Math.min(max, Number(event.target.value) || start));
                                                            setStoryMaterialGenerator(() => ({ kind, start, end, busy: false, missingChapters: [] }));
                                                        }}
                                                        style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '7px 8px', border: `1px solid ${readerBorder}`, borderRadius: 7, background: readerSurface, color: readerText, fontSize: 12 }} />
                                                </label>
                                            </div>
                                            <button onClick={() => {
                                                const kind = storyMaterialTab === 'blocks' ? 'block' : 'reading_impression';
                                                if (!storyMaterialGenerator || storyMaterialGenerator.kind !== kind) openStoryMaterialGenerator(kind);
                                                else void generateStoryMaterial(kind);
                                            }}
                                                disabled={!tocChapters.length || storyMaterialGenerator?.busy}
                                                style={{ width: '100%', marginTop: 9, minHeight: 36, border: 'none', borderRadius: 7, background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700, opacity: !tocChapters.length || storyMaterialGenerator?.busy ? 0.5 : 1 }}>
                                                {storyMaterialGenerator?.busy ? '生成中…' : '生成资料'}
                                            </button>
                                            {storyMaterialGenerator?.missingChapters?.length ? (
                                                <div style={{ marginTop: 8, padding: 8, borderRadius: 7, background: '#fff7ec', color: '#9a6d35', fontSize: 10, lineHeight: 1.55 }}>
                                                    <div>第 {storyMaterialGenerator.missingChapters.join('、')} 章没有逐章摘要，不能直接补读全文。</div>
                                                    <button onClick={() => {
                                                        const missing = storyMaterialGenerator.missingChapters;
                                                        setShowStoryMaterials(false);
                                                        setBatchStartChapter(Math.min(...missing));
                                                        setBatchEndChapter(Math.max(...missing));
                                                        setBatchTaskType('helper');
                                                        setBatchConcurrency(2);
                                                        setBatchPreview(null);
                                                        setBatchPreviewKey('');
                                                        setShowBatchReading(true);
                                                        if (activeBook) loadRecentBatchTasks(activeBook.id);
                                                    }}
                                                        style={{ marginTop: 6, border: `1px solid ${c.primaryBorder}`, borderRadius: 6, padding: '4px 7px', background: 'transparent', color: c.primary, cursor: 'pointer', fontSize: 10 }}>
                                                        打开批量阅读补齐逐章摘要
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>
                                    )}

                                    {(storyMaterialTab === 'chapters' || storyMaterialTab === 'blocks') && !storyMaterialSummaryItems.length && (
                                        <div style={{ textAlign: 'center', color: readerMuted, fontSize: 13, padding: '20px 12px 30px' }}>
                                            {storyMaterialTab === 'chapters' ? '这本书还没有逐章摘要。打开批量阅读后可生成剧情摘要。' : '这本书还没有大总结，可以在上方选择连续章节手动生成。'}
                                        </div>
                                    )}
                                    {(storyMaterialTab === 'chapters' || storyMaterialTab === 'blocks') && storyMaterialSummaryItems.map((item: any) => {
                                            const isEditing = editingStoryMaterial
                                                && editingStoryMaterial.kind === item.kind
                                                && editingStoryMaterial.chapter_no === item.chapter_no;
                                            const title = item.kind === 'block'
                                                ? `第 ${Math.max(1, Number(item.chapter_no) - 29)}-${item.chapter_no} 章大总结`
                                                : item.kind === 'chapter'
                                                    ? `第 ${item.chapter_no} 章摘要`
                                                    : '剧情资料';
                                            return (
                                                <div key={`${item.kind}-${item.chapter_no ?? 'all'}`} style={{ padding: '12px 0', borderBottom: `1px solid ${c.primaryBorder}` }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                                                        <strong style={{ flex: 1, color: readerText, fontSize: 13 }}>{title}</strong>
                                                        <span style={{ color: item.source === 'manual' ? c.tongColor : c.shenColor, fontSize: 10 }}>
                                                            {item.source === 'manual' ? '人工编辑' : `来源 ${item.source || 'main'}`}
                                                        </span>
                                                        <button
                                                            onClick={() => setEditingStoryMaterial({ ...item })}
                                                            title="编辑这份剧情资料"
                                                            aria-label="编辑这份剧情资料"
                                                            style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 7, padding: '3px 7px', background: 'transparent', color: c.primary, cursor: 'pointer', fontSize: 11 }}>
                                                            编辑
                                                        </button>
                                                        <button
                                                            onClick={() => void deleteStoryMaterial(item)}
                                                            title="删除这份剧情资料"
                                                            aria-label="删除这份剧情资料"
                                                            style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 7, padding: '3px 7px', background: 'transparent', color: '#9a3a3a', cursor: 'pointer', fontSize: 11 }}>
                                                            删除
                                                        </button>
                                                    </div>
                                                    {isEditing ? (
                                                        <>
                                                            <textarea
                                                                value={editingStoryMaterial.text}
                                                                onChange={e => setEditingStoryMaterial((prev: any) => ({ ...prev, text: e.target.value }))}
                                                                style={{ boxSizing: 'border-box', width: '100%', minHeight: 146, resize: 'vertical', padding: '9px 10px', border: `1px solid ${readerBorder}`, borderRadius: 8, background: readerSurface, color: readerText, fontSize: 13, lineHeight: 1.65, outline: 'none' }}
                                                            />
                                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                                                            <label style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 5, color: readerMuted, fontSize: 11 }}>
                                                                    <input type="checkbox" checked={Boolean(editingStoryMaterial.locked)} onChange={e => setEditingStoryMaterial((prev: any) => ({ ...prev, locked: e.target.checked ? 1 : 0 }))} />
                                                                    锁定此人工版本
                                                                </label>
                                                                <button onClick={() => setEditingStoryMaterial(null)} disabled={storyMaterialSaving}
                                                                    style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 7, padding: '5px 10px', background: 'transparent', color: '#999', cursor: 'pointer', fontSize: 11 }}>取消</button>
                                                                <button onClick={saveStoryMaterial} disabled={!editingStoryMaterial.text.trim() || storyMaterialSaving}
                                                                    style={{ border: 'none', borderRadius: 7, padding: '5px 10px', background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 11, opacity: editingStoryMaterial.text.trim() && !storyMaterialSaving ? 1 : 0.45 }}>{storyMaterialSaving ? '保存中…' : '保存'}</button>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div style={{ color: readerText, fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{item.text}</div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    {storyMaterialTab === 'impressions' && (
                                        <div style={{ paddingTop: 16 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                            <div style={{ color: c.primaryDark, fontSize: 13, fontWeight: 700, flex: 1 }}>共同读书印象</div>
                                        </div>
                                        <textarea
                                            value={readingImpressionText}
                                            onChange={e => setReadingImpressionText(e.target.value)}
                                            placeholder="把值得长期留下的共同感受写在这里…"
                                            style={{ boxSizing: 'border-box', width: '100%', minHeight: 80, resize: 'vertical', padding: '9px 10px', border: `1px solid ${readerBorder}`, borderRadius: 8, background: readerSurface, color: readerText, fontSize: 13, lineHeight: 1.65, outline: 'none' }}
                                        />
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 7 }}>
                                            <span style={{ color: readerMuted, fontSize: 10 }}>
                                                {currentChapterNo ? `默认关联第 ${currentChapterNo} 章` : '可在未定位章节时保存'}
                                            </span>
                                            <button onClick={saveReadingImpression} disabled={!readingImpressionText.trim() || readingImpressionSaving}
                                                style={{ border: 'none', borderRadius: 7, padding: '5px 10px', background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 11, opacity: readingImpressionText.trim() && !readingImpressionSaving ? 1 : 0.45 }}>
                                                {readingImpressionSaving ? '保存中…' : '保存印象'}
                                            </button>
                                        </div>
                                        {readingImpressions.length > 0 && (
                                            <div style={{ marginTop: 10 }}>
                                                {readingImpressions.map(item => (
                                                    <div key={item.id} style={{ padding: '9px 0', borderBottom: `1px solid ${c.primaryBorder}88`, color: readerText, fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: item.source_label === 'ai' ? c.shenColor : c.tongColor, fontSize: 10, marginBottom: 3 }}>
                                                            <span style={{ flex: 1 }}>{item.chapter_start ? `第 ${item.chapter_start}${item.chapter_end && item.chapter_end !== item.chapter_start ? `-${item.chapter_end}` : ''} 章` : '未指定章节'} · {item.source_label || humanName}</span>
                                                            <button onClick={() => void deleteReadingImpression(item)}
                                                                title="删除这条共同读书印象" aria-label="删除这条共同读书印象"
                                                                style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 6, padding: '2px 6px', background: 'transparent', color: '#9a3a3a', cursor: 'pointer', fontSize: 10 }}>
                                                                删除
                                                            </button>
                                                        </div>
                                                        {item.content}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        </div>
                                    )}
                                    {storyMaterialTab === 'facts' && (
                                        <div>
                                            <div style={{ padding: 12, border: `1px solid ${readerBorder}`, borderRadius: 8, background: readerSurface }}>
                                                <div style={{ color: c.primaryDark, fontSize: 13, fontWeight: 700 }}>全书前情</div>
                                                <div style={{ marginTop: 4, color: readerMuted, fontSize: 10, lineHeight: 1.5 }}>由 {{user}} 确认的全书理解基础。保存一次后，批量阅读与精细回顾会直接使用。</div>
                                                <textarea value={bookPreludeText} onChange={event => setBookPreludeText(event.target.value)}
                                                    placeholder="例如：女主是恐怖世界的原住民，玩家来自地球。"
                                                    style={{ boxSizing: 'border-box', width: '100%', minHeight: 112, marginTop: 9, resize: 'vertical', padding: '9px 10px', border: `1px solid ${readerBorder}`, borderRadius: 7, background: readerPanel, color: readerText, fontSize: 12, lineHeight: 1.65 }} />
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                                                    <button onClick={() => void saveReadingContext('book_prelude')} disabled={readingContextSaving !== null}
                                                        style={{ minHeight: 34, border: 'none', borderRadius: 7, padding: '6px 12px', background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 11, opacity: readingContextSaving !== null ? 0.5 : 1 }}>
                                                        {readingContextSaving === 'book' ? '保存中…' : '保存全书前情'}
                                                    </button>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 16, marginBottom: 6 }}>
                                                <strong style={{ flex: 1, color: c.primaryDark, fontSize: 13 }}>当前有效事实</strong>
                                                <span style={{ color: readerMuted, fontSize: 10 }}>按重要性与更新时间排序</span>
                                            </div>
                                            {!storyMaterials.facts.length ? (
                                                <div style={{ padding: '18px 8px', color: readerMuted, textAlign: 'center', fontSize: 12 }}>还没有持续事实。精细回顾会按剧情需要建立。</div>
                                            ) : storyMaterials.facts.map((fact: any) => {
                                                const lineageId = Number(fact.lineage_id || fact.id);
                                                const historyGroup = storyMaterials.factHistory.find(item => Number(item.lineage_id) === lineageId);
                                                const history = Array.isArray(historyGroup?.history) ? historyGroup.history : [];
                                                const expanded = expandedFactLineages.includes(lineageId);
                                                const editing = factEditor?.lineageId === lineageId;
                                                return (
                                                    <div key={lineageId} style={{ padding: '12px 0', borderBottom: `1px solid ${readerBorder}` }}>
                                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                                                                    <span style={{ color: c.primary, fontSize: 11, fontWeight: 700 }}>{fact.fact_type}</span>
                                                                    <strong style={{ color: readerText, fontSize: 12 }}>{fact.key_name}</strong>
                                                                    <span aria-label={`${fact.importance || 3} 星重要性`} style={{ color: c.primaryDark, fontSize: 12 }}>{'★'.repeat(Number(fact.importance || 3))}{'☆'.repeat(5 - Number(fact.importance || 3))}</span>
                                                                </div>
                                                                <div style={{ marginTop: 5, color: readerText, fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{fact.value}</div>
                                                            </div>
                                                            <button onClick={() => setFactEditor(editing ? null : {
                                                                lineageId,
                                                                factType: fact.fact_type,
                                                                keyName: fact.key_name,
                                                                value: fact.value,
                                                                importance: Number(fact.importance || 3),
                                                                reason: '',
                                                            })}
                                                                style={{ flexShrink: 0, border: `1px solid ${readerBorder}`, borderRadius: 6, padding: '4px 7px', background: editing ? c.primaryBg : 'transparent', color: c.primary, cursor: 'pointer', fontSize: 10 }}>
                                                                {editing ? '收起' : '修订'}
                                                            </button>
                                                        </div>
                                                        {editing && factEditor && (
                                                            <div style={{ marginTop: 10, padding: 10, border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: c.primaryBg }}>
                                                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(84px, 0.35fr) minmax(0, 1fr)', gap: 7 }}>
                                                                    <input value={factEditor.factType} onChange={event => setFactEditor(previous => previous ? { ...previous, factType: event.target.value } : previous)}
                                                                        aria-label="事实类型" placeholder="类型"
                                                                        style={{ minWidth: 0, padding: '7px 8px', border: `1px solid ${readerBorder}`, borderRadius: 6, background: readerPanel, color: readerText, fontSize: 11 }} />
                                                                    <input value={factEditor.keyName} onChange={event => setFactEditor(previous => previous ? { ...previous, keyName: event.target.value } : previous)}
                                                                        aria-label="事实名称" placeholder="事实名称"
                                                                        style={{ minWidth: 0, padding: '7px 8px', border: `1px solid ${readerBorder}`, borderRadius: 6, background: readerPanel, color: readerText, fontSize: 11 }} />
                                                                </div>
                                                                <textarea value={factEditor.value} onChange={event => setFactEditor(previous => previous ? { ...previous, value: event.target.value } : previous)}
                                                                    aria-label="事实内容" placeholder="修订后的当前事实"
                                                                    style={{ boxSizing: 'border-box', width: '100%', minHeight: 76, marginTop: 7, resize: 'vertical', padding: '8px 9px', border: `1px solid ${readerBorder}`, borderRadius: 6, background: readerPanel, color: readerText, fontSize: 11, lineHeight: 1.6 }} />
                                                                <label style={{ display: 'block', marginTop: 7, color: readerMuted, fontSize: 10 }}>
                                                                    重要性 {factEditor.importance} 星
                                                                    <input type="range" min={1} max={5} value={factEditor.importance}
                                                                        onChange={event => setFactEditor(previous => previous ? { ...previous, importance: Number(event.target.value) } : previous)}
                                                                        style={{ width: '100%', marginTop: 4, accentColor: c.primary }} />
                                                                </label>
                                                                <input value={factEditor.reason} onChange={event => setFactEditor(previous => previous ? { ...previous, reason: event.target.value } : previous)}
                                                                    placeholder="修订依据或原因"
                                                                    style={{ boxSizing: 'border-box', width: '100%', marginTop: 7, padding: '7px 8px', border: `1px solid ${readerBorder}`, borderRadius: 6, background: readerPanel, color: readerText, fontSize: 11 }} />
                                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 8 }}>
                                                                    <button onClick={() => void mutateFact(fact, 'invalidate', { reason: factEditor.reason })} disabled={factSaving}
                                                                        style={{ minHeight: 32, border: `1px solid #9a3a3a`, borderRadius: 6, padding: '5px 9px', background: 'transparent', color: '#9a3a3a', cursor: 'pointer', fontSize: 10 }}>
                                                                        作废
                                                                    </button>
                                                                    <button onClick={() => void mutateFact(fact, 'revise', factEditor)} disabled={factSaving || !factEditor.keyName.trim() || !factEditor.value.trim()}
                                                                        style={{ minHeight: 32, border: 'none', borderRadius: 6, padding: '5px 10px', background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 10, opacity: factSaving ? 0.5 : 1 }}>
                                                                        {factSaving ? '保存中…' : '保存新版本'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {history.length > 1 && (
                                                            <>
                                                                <button onClick={() => setExpandedFactLineages(previous => expanded
                                                                    ? previous.filter(id => id !== lineageId)
                                                                    : [...previous, lineageId])}
                                                                    style={{ marginTop: 7, border: 'none', padding: 0, background: 'transparent', color: readerMuted, cursor: 'pointer', fontSize: 10 }}>
                                                                    {expanded ? '收起历史' : `展开 ${history.length - 1} 个旧版本`}
                                                                </button>
                                                                {expanded && (
                                                                    <div style={{ marginTop: 7, paddingLeft: 10, borderLeft: `2px solid ${readerBorder}` }}>
                                                                        {history.slice(0, -1).reverse().map((old: any) => (
                                                                            <div key={old.id} style={{ padding: '6px 0', color: readerMuted, fontSize: 10, lineHeight: 1.55 }}>
                                                                                <div style={{ textDecoration: 'line-through' }}>{old.key_name}：{old.value}</div>
                                                                                <div>第 {old.revision_chapter || old.chapter_no || 0} 章 · {old.revision_reason || old.operation || '初始版本'} · {old.importance || 3} 星</div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {storyMaterialTab === 'comment_summaries' && (
                                        <div>
                                            <div style={{ padding: '2px 0 10px', color: readerMuted, fontSize: 10, lineHeight: 1.55 }}>每章保留一份当前批注摘要。精细回顾和回复批注会自动更新；人工编辑会新增版本，不覆盖历史。</div>
                                            {!storyMaterials.commentSummaries.length ? (
                                                <div style={{ padding: '22px 8px', color: readerMuted, textAlign: 'center', fontSize: 12 }}>还没有批注摘要。完成一次精细回顾后会在这里出现。</div>
                                            ) : storyMaterials.commentSummaries.map((summary: any) => {
                                                const editing = editingCommentSummary?.chapterNo === Number(summary.chapter_no);
                                                return (
                                                    <div key={summary.id || summary.chapter_no} style={{ padding: '12px 0', borderBottom: `1px solid ${readerBorder}` }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <strong style={{ flex: 1, color: readerText, fontSize: 12 }}>第 {summary.chapter_no} 章批注摘要</strong>
                                                            <span style={{ color: readerMuted, fontSize: 9 }}>{summary.source === 'human' ? '{{user}} 编辑' : '{{char}} 更新'} · v{summary.version}</span>
                                                            <button onClick={() => setEditingCommentSummary(editing ? null : { chapterNo: Number(summary.chapter_no), content: summary.content })}
                                                                style={{ border: `1px solid ${readerBorder}`, borderRadius: 6, padding: '3px 7px', background: editing ? c.primaryBg : 'transparent', color: c.primary, cursor: 'pointer', fontSize: 10 }}>
                                                                {editing ? '取消' : '编辑'}
                                                            </button>
                                                        </div>
                                                        {editing && editingCommentSummary ? (
                                                            <>
                                                                <textarea value={editingCommentSummary.content}
                                                                    onChange={event => setEditingCommentSummary(previous => previous ? { ...previous, content: event.target.value } : previous)}
                                                                    style={{ boxSizing: 'border-box', width: '100%', minHeight: 112, marginTop: 8, resize: 'vertical', padding: '8px 9px', border: `1px solid ${readerBorder}`, borderRadius: 7, background: readerSurface, color: readerText, fontSize: 12, lineHeight: 1.65 }} />
                                                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 7 }}>
                                                                    <button onClick={saveEditedCommentSummary} disabled={commentSummarySaving || !editingCommentSummary.content.trim()}
                                                                        style={{ minHeight: 32, border: 'none', borderRadius: 6, padding: '5px 10px', background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 10, opacity: commentSummarySaving ? 0.5 : 1 }}>
                                                                        {commentSummarySaving ? '保存中…' : '保存人工版本'}
                                                                    </button>
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div style={{ marginTop: 7, color: readerText, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{summary.content}</div>
                                                        )}
                                                        <div style={{ marginTop: 5, color: readerMuted, fontSize: 9 }}>更新于 {summary.updated_at || summary.created_at || '未知时间'}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {mode === 'reading' && showChapterChat && (
                <div
                    onClick={() => setShowChapterChat(false)}
                    style={{
                        position: 'absolute', inset: 0, zIndex: 27, background: 'rgba(0,0,0,0.18)',
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                    }}>
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            width: '100%', maxWidth: 620, maxHeight: '72vh', display: 'flex', flexDirection: 'column',
                            background: readerPanel,
                            border: `1px solid ${c.primaryBorder}`, borderRadius: '20px 20px 0 0',
                            boxShadow: '0 -8px 36px rgba(0,0,0,0.16)', overflow: 'hidden',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `1px solid ${c.primaryBorder}` }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 15, fontWeight: 700, color: c.primaryDark }}>章内对话</div>
                                <div style={{ fontSize: 11, color: readerMuted, marginTop: 3 }}>第 {currentChapterNo} 章 · 聊整章，不绑定某一句话</div>
                            </div>
                            <select value={reviewMode} onChange={e => changeReviewMode(e.target.value === 'fine' ? 'fine' : 'layered')}
                                title="选择剧情回顾范围"
                                style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 8, padding: '5px 6px', background: 'transparent', color: c.primary, fontSize: 11 }}>
                                <option value="fine">精细回顾</option>
                                <option value="layered">分层回顾</option>
                            </select>
                            <button onClick={() => setShowChapterChat(false)} title="关闭章内对话" aria-label="关闭章内对话"
                                style={{ border: 'none', background: 'none', color: '#aaa', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '2px 4px' }}>×</button>
                        </div>
                        <div className="no-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '14px 18px', minHeight: 120 }}>
                            {chapterChat.length === 0 && (
                                <div style={{ textAlign: 'center', color: readerMuted, fontSize: 13, padding: '28px 12px' }}>
                                    这里可以聊整章的剧情、人物、前后呼应和你的即时感受。
                                </div>
                            )}
                            {chapterChat.map(message => {
                                const isAI = message.from_who.toLowerCase() === 'ai' || message.from_who.toLowerCase() === aiName.toLowerCase() || message.source_label === 'main' || message.source_label === 'model';
                                return (
                                    <div key={message.id} style={{ display: 'flex', justifyContent: isAI ? 'flex-start' : 'flex-end', marginBottom: 12 }}>
                                        <div className="coread-reader-note" style={{
                                            maxWidth: '86%', padding: '10px 12px', borderRadius: isAI ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
                                            background: isAI ? c.shenBg : c.tongBg,
                                            border: `1px ${isAI ? 'dashed' : 'solid'} ${isAI ? c.shenColor : c.tongColor}80`,
                                            color: readerText, fontSize: readerLayout.noteFontSize, lineHeight: readerLayout.noteLineHeight, letterSpacing: readerLayout.noteLetterSpacing, whiteSpace: 'pre-wrap',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11, color: isAI ? c.shenColor : c.tongColor }}>
                                                <strong>{displayName(message.from_who)}</strong>
                                                {isAI && message.source_label && <span style={{ opacity: 0.72 }}>· 来源 {message.source_label}</span>}
                                            </div>
                                            {message.content}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ padding: '10px 14px 14px', borderTop: `1px solid ${c.primaryBorder}` }}>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                                <textarea
                                    className="coread-reader-note"
                                    value={chapterChatText}
                                    onChange={e => setChapterChatText(e.target.value)}
                                    placeholder="写下你对这一章的想法…"
                                    disabled={chapterChatBusy}
                                    style={{
                                        flex: 1, minHeight: 48, maxHeight: 120, resize: 'vertical', border: `1px solid ${c.primaryBorder}`,
                                        borderRadius: 12, padding: '9px 11px', outline: 'none', background: readerSurface,
                                        color: readerText, fontSize: readerLayout.noteFontSize, lineHeight: readerLayout.noteLineHeight, letterSpacing: readerLayout.noteLetterSpacing,
                                    }}
                                />
                                <button
                                    onClick={() => sendChapterChat(false)}
                                    disabled={!chapterChatText.trim() || chapterChatBusy}
                                    title="只保存章内对话"
                                    aria-label="只保存章内对话"
                                    style={{ height: 42, padding: '0 12px', border: `1px solid ${c.primaryBorder}`, borderRadius: 12, background: c.primaryBg, color: c.primary, cursor: 'pointer', opacity: chapterChatText.trim() && !chapterChatBusy ? 1 : 0.45, fontSize: 18 }}>
                                    ✈
                                </button>
                                <button
                                    onClick={() => sendChapterChat(true)}
                                    disabled={chapterChatBusy}
                                    title={chapterChatBusy ? '小 C 正在回复' : '保存输入或直接请小 C 回复'}
                                    aria-label={chapterChatBusy ? '小 C 正在回复' : '保存输入或直接请小 C 回复'}
                                    style={{ width: 42, height: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', borderRadius: '50%', background: c.primary, color: '#fff', cursor: 'pointer', opacity: chapterChatBusy ? 0.45 : 1 }}>
                                    <WakeGlyph busy={chapterChatBusy} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {mode === 'reading' && showSearch && (
                <div
                    onClick={() => setShowSearch(false)}
                    style={{
                        position: 'absolute', inset: 0, zIndex: 29, background: 'rgba(0,0,0,0.16)',
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '54px 12px 12px',
                    }}>
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            width: '100%', maxWidth: 620, maxHeight: '78vh', display: 'flex', flexDirection: 'column',
                            background: readerPanel,
                            border: `1px solid ${c.primaryBorder}`, borderRadius: 16,
                            boxShadow: '0 10px 34px rgba(0,0,0,0.18)', overflow: 'hidden',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `1px solid ${c.primaryBorder}` }}>
                            <input
                                value={searchQuery}
                                onChange={e => { setSearchQuery(e.target.value); setSearchError(''); }}
                                onKeyDown={e => { if (e.key === 'Enter') runBookSearch(); }}
                                autoFocus
                                placeholder="搜索原文与批注…"
                                style={{
                                    flex: 1, minWidth: 0, padding: '9px 10px', border: `1px solid ${c.primaryBorder}`,
                                    borderRadius: 9, outline: 'none', background: readerSurface,
                                    color: readerText, fontSize: 13,
                                }}
                            />
                            <select
                                value={searchScope}
                                onChange={e => { setSearchScope(e.target.value === 'book' ? 'book' : 'chapter'); setSearchResults([]); setActiveSearchMatch(null); }}
                                title="搜索范围"
                                style={{ padding: '8px 6px', border: `1px solid ${c.primaryBorder}`, borderRadius: 8, background: 'transparent', color: c.primary, fontSize: 11 }}>
                                <option value="chapter">本章</option>
                                <option value="book">整本</option>
                            </select>
                            <button
                                onClick={runBookSearch}
                                disabled={!searchQuery.trim() || searchBusy}
                                title="搜索原文与批注"
                                aria-label="搜索原文与批注"
                                style={{ width: 36, height: 36, border: 'none', borderRadius: 9, background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 17, opacity: searchQuery.trim() && !searchBusy ? 1 : 0.45 }}>
                                {searchBusy ? '…' : '⌕'}
                            </button>
                            <button onClick={() => setShowSearch(false)} title="关闭搜索" aria-label="关闭搜索"
                                style={{ border: 'none', background: 'none', color: '#aaa', fontSize: 21, lineHeight: 1, cursor: 'pointer', padding: '2px 3px' }}>×</button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: `1px solid ${c.primaryBorder}88`, color: readerMuted, fontSize: 11 }}>
                            <span style={{ flex: 1 }}>
                                {searchError || (searchResults.length ? `原文和批注共 ${searchResults.length}${searchLimited ? '+' : ''} 处命中${searchLimited ? '（每类最多显示前 200 处）' : ''}` : '搜索不会调用模型，也不会消耗 Token')}
                            </span>
                            <button onClick={() => moveSearchResult(-1)} disabled={!searchResults.length} title="上一处" aria-label="上一处"
                                style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: 'transparent', color: c.primary, cursor: searchResults.length ? 'pointer' : 'not-allowed', padding: '4px 7px', opacity: searchResults.length ? 1 : 0.45 }}>↑</button>
                            <span style={{ minWidth: 42, textAlign: 'center' }}>{searchResults.length ? `${activeSearchIndex + 1}/${searchResults.length}` : '—'}</span>
                            <button onClick={() => moveSearchResult(1)} disabled={!searchResults.length} title="下一处" aria-label="下一处"
                                style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: 'transparent', color: c.primary, cursor: searchResults.length ? 'pointer' : 'not-allowed', padding: '4px 7px', opacity: searchResults.length ? 1 : 0.45 }}>↓</button>
                        </div>
                        <div className="no-scrollbar" style={{ overflow: 'auto', padding: '4px 14px 14px' }}>
                            {searchResults.length === 0 && !searchBusy && !searchError && (
                                <div style={{ padding: '28px 8px', textAlign: 'center', color: readerMuted, fontSize: 12 }}>
                                    输入关键词后按回车，原文和批注会一起按章节分组。
                                </div>
                            )}
                            {searchResults.length > 0 && (() => {
                                const grouped = new Map<string, { result: any; index: number }[]>();
                                searchResults.forEach((result, index) => {
                                    const key = `${result.chapter_no} · ${result.chapter_title || ''}`;
                                    if (!grouped.has(key)) grouped.set(key, []);
                                    grouped.get(key)!.push({ result, index });
                                });
                                return [...grouped.entries()].map(([title, results]) => (
                                    <section key={title} style={{ paddingTop: 9 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: c.primaryDark, padding: '3px 0 6px' }}>{title}</div>
                                        {results.map(({ result, index }) => {
                                            const active = index === activeSearchIndex;
                                            const excerpt = String(result.excerpt || '');
                                            const query = searchQuery.trim();
                                            const qIndex = excerpt.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
                                            const before = qIndex >= 0 ? excerpt.slice(0, qIndex) : excerpt;
                                            const hit = qIndex >= 0 ? excerpt.slice(qIndex, qIndex + query.length) : '';
                                            const after = qIndex >= 0 ? excerpt.slice(qIndex + query.length) : '';
                                            return (
                                                <button key={`${result.kind}-${result.comment_id || result.paragraph_idx}-${result.start}-${index}`} onClick={() => jumpToSearchResult(result, index)}
                                                    style={{
                                                        width: '100%', display: 'block', textAlign: 'left', padding: '8px 9px', marginBottom: 5,
                                                        border: `1px solid ${active ? c.primary : c.primaryBorder}88`, borderRadius: 8,
                                                        background: active ? c.primaryBg : 'transparent', color: readerText, cursor: 'pointer',
                                                        lineHeight: 1.55, fontSize: 12,
                                                    }}>
                                                    <span>{before}</span><mark style={{ background: readerTheme === 'eink' ? '#d9d9d9' : '#f5d39a', color: 'inherit', padding: '0 1px' }}>{hit || query}</mark><span>{after}</span>
                                                    <span style={{ display: 'block', marginTop: 4, color: readerMuted, fontSize: 10 }}>
                                                        {result.kind === 'comment'
                                                            ? `批注 · ${result.matched_field === 'selected_text' ? '划线原文' : (result.from_who || '批注内容')} · 段落 ${result.paragraph_idx}`
                                                            : `原文 · 段落 ${result.paragraph_idx}`}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </section>
                                ));
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {mode === 'reading' && showExportMenu && (
                <div onClick={() => setShowExportMenu(false)} style={{
                    position: 'absolute', inset: 0, zIndex: 29, background: 'rgba(0,0,0,0.16)',
                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 14,
                }}>
                    <div onClick={e => e.stopPropagation()} style={{
                        width: '100%', maxWidth: 380, background: readerPanel,
                        border: `1px solid ${readerBorder}`, borderRadius: 12, padding: 12, boxShadow: '0 10px 34px rgba(0,0,0,0.18)',
                    }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                            <button onClick={() => handleExport('epub')} style={{ border: `1px solid ${readerBorder}`, borderRadius: 8, background: 'transparent', color: readerText, cursor: 'pointer', padding: '10px 6px', fontSize: 12 }}>EPUB</button>
                            <button onClick={() => handleExport('md')} style={{ border: `1px solid ${readerBorder}`, borderRadius: 8, background: 'transparent', color: readerText, cursor: 'pointer', padding: '10px 6px', fontSize: 12 }}>Markdown</button>
                            <button onClick={() => handleExport('json')} style={{ border: `1px solid ${readerBorder}`, borderRadius: 8, background: 'transparent', color: readerText, cursor: 'pointer', padding: '10px 6px', fontSize: 12 }}>JSON</button>
                            <button onClick={() => handleExport('archive')} style={{ border: 'none', borderRadius: 8, background: c.primary, color: '#fff', cursor: 'pointer', padding: '10px 6px', fontSize: 12 }}>便携包 ZIP</button>
                        </div>
                    </div>
                </div>
            )}

            {mode === 'reading' && returnPoint && (
                <button onClick={(e) => { e.stopPropagation(); returnToReadingPosition(); }} style={{
                    position: 'absolute', top: 44, left: 12, zIndex: 28,
                    background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(16px)',
                    border: `1px solid ${c.primaryBorder}`, borderRadius: 16,
                    padding: '7px 12px', color: c.primary, fontSize: 12, fontWeight: 700,
                    boxShadow: '0 4px 18px rgba(0,0,0,0.08)', cursor: 'pointer',
                }}>
                    返回阅读位置
                </button>
            )}

            {/* New replies notification bubble */}
            {mode === 'reading' && newReplies.length > 0 && !showReplies && (
                <div onClick={(e) => { e.stopPropagation(); setShowReplies(true); }} style={{
                    position: 'absolute', bottom: showBar ? 72 : 22, right: 16, zIndex: 30,
                    background: c.shenColor, borderRadius: 20, padding: '8px 14px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.15)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                }}>
                    <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>CC · {newReplies.length} 条新互动</span>
                </div>
            )}

            {/* New replies panel */}
            {showReplies && newReplies.length > 0 && (
                <div onClick={(e) => e.stopPropagation()} style={{
                    position: 'absolute', bottom: 20, right: 16, left: 16, zIndex: 30,
                    background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(24px)',
                    borderRadius: 20, padding: '16px 18px', border: `1px solid ${c.primaryBorder}`,
                    boxShadow: '0 -4px 32px rgba(0,0,0,0.1)', maxHeight: '55vh', overflow: 'auto',
                }} className="no-scrollbar">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: c.shenColor }}>最新批注回复</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={dismissReplies} style={{ background: c.primaryBg, border: `1px solid ${c.primaryBorder}`, borderRadius: 12, padding: '5px 14px', fontSize: 11, color: '#999', cursor: 'pointer' }}>已读</button>
                            <button onClick={() => setShowReplies(false)} style={{ background: c.primaryBg, border: `1px solid ${c.primaryBorder}`, borderRadius: 12, padding: '5px 14px', fontSize: 11, color: '#999', cursor: 'pointer' }}>收起</button>
                        </div>
                    </div>
                    {newReplies.map(r => (
                        <div key={r.id} onClick={() => openReplyNotice(r)} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${c.primaryBorder}`, cursor: 'pointer' }}>
                            {r.parent_content && (
                                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6, padding: '4px 10px', background: c.tongBg, borderRadius: 8, borderLeft: `3px solid ${c.tongColor}` }}>
                                    {r.parent_from}: {r.parent_content.length > 40 ? r.parent_content.slice(0, 40) + '...' : r.parent_content}
                                </div>
                            )}
                            <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>{r.content}</div>
                            <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>{(() => { const pg = findPageForParaIdx(r.paragraph_idx, totalPages, r.sel_start_idx ?? 0); return pg >= 0 ? `p${pg + 1}` : `p${r.paragraph_idx}`; })()} · 点开定位到原文</div>
                        </div>
                    ))}
                </div>
            )}

            {mode === 'reading' && showBar && showMoreMenu && (
                <div onClick={() => setShowMoreMenu(false)} style={{
                    position: 'absolute', top: 'calc(84px + env(safe-area-inset-top))', right: 12, zIndex: 24,
                    width: 'min(326px, calc(100% - 24px))', maxHeight: 'calc(100% - 118px)', overflow: 'auto', padding: 10,
                    background: readerPanel, border: `1px solid ${readerBorder}`, borderRadius: 6,
                }}>
                    <div onClick={e => e.stopPropagation()} style={{ display: 'grid', gap: 12 }}>
                        <section>
                            <div style={{ marginBottom: 6, paddingBottom: 4, borderBottom: '2px solid #8f3d3d', color: readerMuted, fontSize: 10, fontWeight: 800 }}>批注与资料</div>
                            <div style={{ display: 'grid', gap: 6 }}>
                                <button className="coread-tool-button" onClick={openCurrentPageAnnotations} title="查看当前页批注" aria-label="查看当前页批注"
                                    style={{ '--tool-border': readerBorder, '--tool-accent': '#8f3d3d', '--tool-icon-bg': readerPanel } as React.CSSProperties}>
                                    <span className="coread-tool-icon"><LucideIcon name="notebookPen" size={17} /></span>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>当前页批注</span>
                                </button>
                                <button className="coread-tool-button" onClick={openAnnotationList} title="查看本章批注" aria-label="查看本章批注"
                                    style={{ '--tool-border': readerBorder, '--tool-accent': '#8f3d3d', '--tool-icon-bg': readerPanel } as React.CSSProperties}>
                                    <span className="coread-tool-icon"><LucideIcon name="list" size={17} /></span>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>本章批注</span>
                                </button>
                                <button className="coread-tool-button" onClick={() => { openStoryMaterials(); setShowMoreMenu(false); setShowBar(false); }} title="打开剧情资料" aria-label="打开剧情资料"
                                    style={{ '--tool-border': readerBorder, '--tool-accent': '#8f3d3d', '--tool-icon-bg': readerPanel } as React.CSSProperties}>
                                    <span className="coread-tool-icon"><LucideIcon name="bookOpenText" size={17} /></span>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>剧情资料</span>
                                </button>
                            </div>
                        </section>
                        <section>
                            <div style={{ marginBottom: 6, paddingBottom: 4, borderBottom: '2px solid #35634b', color: readerMuted, fontSize: 10, fontWeight: 800 }}>共读</div>
                            <div style={{ display: 'grid', gap: 6 }}>
                                <button className="coread-tool-button" onClick={() => { setShowChapterChat(true); setShowMoreMenu(false); setShowBar(false); }} title="打开章内对话" aria-label="打开章内对话"
                                    style={{ '--tool-border': readerBorder, '--tool-accent': '#35634b', '--tool-icon-bg': readerPanel } as React.CSSProperties}>
                                    <span className="coread-tool-icon"><LucideIcon name="messageSquareText" size={17} /></span>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>章内对话</span>
                                </button>
                                <button className="coread-tool-button" onClick={() => { openBatchReading(); setShowMoreMenu(false); setShowBar(false); }} title="打开批量阅读" aria-label="打开批量阅读"
                                    style={{ '--tool-border': readerBorder, '--tool-accent': '#35634b', '--tool-icon-bg': readerPanel } as React.CSSProperties}>
                                    <span className="coread-tool-icon"><LucideIcon name="circlePlay" size={17} /></span>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>批量阅读</span>
                                </button>
                            </div>
                        </section>
                        <section>
                            <div style={{ marginBottom: 6, paddingBottom: 4, borderBottom: '2px solid #405779', color: readerMuted, fontSize: 10, fontWeight: 800 }}>本机与文件</div>
                            <div style={{ display: 'grid', gap: 6 }}>
                                <button className="coread-tool-button" onClick={() => void uploadLocalReadingProgress()} disabled={readingProgressSyncing} title="上传这台设备的阅读进度" aria-label="上传本机进度"
                                    style={{ '--tool-border': readerBorder, '--tool-accent': '#405779', '--tool-icon-bg': readerPanel, opacity: readingProgressSyncing ? 0.55 : 1 } as React.CSSProperties}>
                                    <span className="coread-tool-icon"><LucideIcon name="cloudUpload" size={17} /></span>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>{readingProgressSyncing ? '同步中…' : '上传本机进度'}</span>
                                </button>
                                <button className="coread-tool-button" onClick={() => void restoreReadingProgressFromCloud()} disabled={readingProgressSyncing} title="用云端阅读进度覆盖本机位置" aria-label="从云端恢复"
                                    style={{ '--tool-border': readerBorder, '--tool-accent': '#405779', '--tool-icon-bg': readerPanel, opacity: readingProgressSyncing ? 0.55 : 1 } as React.CSSProperties}>
                                    <span className="coread-tool-icon"><LucideIcon name="cloudDownload" size={17} /></span>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>{readingProgressSyncing ? '同步中…' : '从云端恢复'}</span>
                                </button>
                                <button className="coread-tool-button" onClick={() => { setShowExportMenu(true); setShowMoreMenu(false); setShowBar(false); }} title="导出本书" aria-label="导出本书"
                                    style={{ '--tool-border': readerBorder, '--tool-accent': '#405779', '--tool-icon-bg': readerPanel } as React.CSSProperties}>
                                    <span className="coread-tool-icon"><LucideIcon name="download" size={17} /></span>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>导出</span>
                                </button>
                            </div>
                        </section>
                    </div>
                </div>
            )}

            {mode === 'reading' && showBar && showChapterMenu && (
                <div onClick={() => setShowChapterMenu(false)} style={{
                    position: 'absolute', bottom: 124, left: 12, right: 12, zIndex: 24,
                    padding: 10, background: readerPanel, border: `1px solid ${readerBorder}`, borderRadius: 10,
                    boxShadow: '0 -10px 28px rgba(0,0,0,0.14)',
                }}>
                    <div onClick={e => e.stopPropagation()} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'stretch' }}>
                        <button onClick={() => {
                            const target = adjacentChapterPage(-1);
                            if (target === page) { toast('已经是第一章'); return; }
                            setPage(target);
                            setShowChapterMenu(false);
                        }} style={{ minHeight: 40, border: `1px solid ${readerBorder}`, borderRadius: 8, background: 'transparent', color: readerText, cursor: 'pointer', fontSize: 12 }}>
                            ‹ 上一章
                        </button>
                        <button onClick={() => {
                            const target = adjacentChapterPage(1);
                            if (target === page) { toast('已经是最后一章'); return; }
                            setPage(target);
                            setShowChapterMenu(false);
                        }} style={{ minHeight: 40, border: `1px solid ${readerBorder}`, borderRadius: 8, background: 'transparent', color: readerText, cursor: 'pointer', fontSize: 12 }}>
                            下一章 ›
                        </button>
                        <button onClick={() => { setShowChapterMenu(false); setShowToc(true); }} title="打开目录跳转" aria-label="打开目录跳转"
                            style={{ minWidth: 42, border: `1px solid ${readerBorder}`, borderRadius: 8, background: c.primaryBg, color: c.primary, cursor: 'pointer', fontSize: 12 }}>
                            目录
                        </button>
                    </div>
                </div>
            )}

            {mode === 'reading' && showReadingConfirm && (
                <div onClick={() => setShowReadingConfirm(false)} style={{
                    position: 'absolute', inset: 0, zIndex: 33, background: 'rgba(0,0,0,0.2)',
                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12,
                }}>
                    <div onClick={e => e.stopPropagation()} style={{
                        width: '100%', maxWidth: 420, background: readerPanel, border: `1px solid ${readerBorder}`,
                        borderRadius: '12px 12px 8px 8px', padding: 16, boxShadow: '0 -10px 34px rgba(0,0,0,0.18)',
                    }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: readerText }}>阅读本章</div>
                        <div style={{ marginTop: 5, color: readerMuted, fontSize: 11, lineHeight: 1.5 }}>第 {currentChapterNo} 章 · 选择本次回顾范围后开始</div>
                        <select value={reviewMode} onChange={e => changeReviewMode(e.target.value === 'fine' ? 'fine' : 'layered')} title="选择剧情回顾范围"
                            style={{ width: '100%', marginTop: 12, padding: '9px 10px', border: `1px solid ${readerBorder}`, borderRadius: 8, background: readerSurface, color: readerText, fontSize: 12 }}>
                            <option value="fine">精细回顾</option>
                            <option value="layered">分层回顾</option>
                        </select>
                        <label style={{ display: 'block', marginTop: 12 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: readerText, fontSize: 12, fontWeight: 700 }}>
                                <span style={{ flex: 1 }}>第 {currentChapterNo} 章前情</span>
                                <span style={{ color: readingContextSaving === 'chapter' ? c.primary : readerMuted, fontSize: 10, fontWeight: 500 }}>
                                    {readingContextSaving === 'chapter' ? '保存中…' : '开始阅读时保存'}
                                </span>
                            </span>
                            <textarea
                                value={chapterPreludeText}
                                onChange={event => setChapterPreludeText(event.target.value)}
                                placeholder="只写这一章需要优先带入的前情、身份或信息差。"
                                rows={4}
                                style={{
                                    boxSizing: 'border-box', width: '100%', minHeight: 86, maxHeight: '22vh',
                                    marginTop: 7, resize: 'vertical', padding: '8px 10px',
                                    border: `1px solid ${readerBorder}`, borderRadius: 8,
                                    background: readerSurface, color: readerText, fontSize: 12, lineHeight: 1.6,
                                }}
                            />
                            <span style={{ display: 'block', marginTop: 5, color: readerMuted, fontSize: 10, lineHeight: 1.45 }}>
                                仅注入本章阅读上下文，不改变正文排版、分页或其他章节。
                            </span>
                        </label>
                        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <button onClick={() => setShowReadingConfirm(false)} style={{ flex: 1, minHeight: 40, border: `1px solid ${readerBorder}`, borderRadius: 8, background: 'transparent', color: readerMuted, cursor: 'pointer', fontSize: 12 }}>取消</button>
                            <button onClick={startChapterReading} disabled={currentChapterIdx < 0 || readingContextSaving === 'chapter' || readingTask?.status === 'queued' || readingTask?.status === 'running'}
                                style={{ flex: 1, minHeight: 40, border: 'none', borderRadius: 8, background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                                开始阅读
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom toolbar — progress plus four stable reading controls */}
            {mode === 'reading' && (
                <>
                    <div style={{
                        position: 'absolute', bottom: showBar ? 112 : 12, left: 0, right: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                        fontSize: 11, color: readerMuted, zIndex: 5,
                        pointerEvents: 'none',
                    }}>
                        <span>{page}</span>
                        {paginateProgress != null && !readingLoading && (
                            <span title="正在保存本机完整分页缓存" aria-label={`正在保存本机完整分页缓存 ${Math.round(paginateProgress * 100)}%`}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: readerMuted }}>
                                <span style={{ width: 34, height: 2, overflow: 'hidden', background: readerBorder }}>
                                    <span style={{ display: 'block', width: `${Math.max(2, Math.round(paginateProgress * 100))}%`, height: '100%', background: c.primary }} />
                                </span>
                                <span style={{ fontSize: 9 }}>{Math.round(paginateProgress * 100)}%</span>
                            </span>
                        )}
                    </div>

                    <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 15,
                        background: readerPanel, backdropFilter: 'blur(16px)',
                        borderTop: `1px solid ${readerBorder}`,
                        padding: '10px 12px calc(14px + env(safe-area-inset-bottom))',
                        transform: showBar ? 'translateY(0)' : 'translateY(100%)',
                    }}>
                        {(() => {
                            const range = getChapterPageRange(currentChapterIdx);
                            const chapterPage = Math.max(1, page - range.start + 1);
                            const chapterPages = Math.max(1, range.end - range.start + 1);
                            const bookPercent = totalPages > 1 ? Math.round(((page - 1) / (totalPages - 1)) * 100) : 100;
                            return (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 7, color: readerMuted, fontSize: 10, lineHeight: 1.4 }}>
                                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>第 {currentChapterNo} 章 · 本章 {chapterPage} / {chapterPages} 页</span>
                                        <span style={{ flexShrink: 0 }}>全书进度 {bookPercent}% · 第 {Math.max(1, currentChapterNo)} / {Math.max(1, tocChapters.length)} 章</span>
                                    </div>
                                    <input type="range" min={range.start} max={Math.max(range.start, range.end)} value={Math.max(range.start, Math.min(range.end, page))}
                                        onChange={e => setPage(parseInt(e.target.value, 10))}
                                        aria-label="本章阅读进度"
                                        style={{ display: 'block', width: '100%', margin: '0 0 12px', accentColor: c.primary }} />
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
                                        <button onClick={() => openReaderPanel('typography')} title="正文与批注排版设置" aria-label="正文与批注排版设置"
                                            style={{ minWidth: 0, minHeight: 46, border: `1px solid ${showFontPanel && readerPanelFocus === 'typography' ? c.primary : readerBorder}`, borderRadius: 8, background: showFontPanel && readerPanelFocus === 'typography' ? c.primaryBg : 'transparent', color: readerText, cursor: 'pointer', fontSize: 11 }}>
                                            <LucideIcon name="type" size={17} />
                                            <span style={{ display: 'block' }}>排版</span>
                                        </button>
                                        <button onClick={() => openReaderPanel('appearance')} title="亮度与阅读主题" aria-label="亮度与阅读主题"
                                            style={{ minWidth: 0, minHeight: 46, border: `1px solid ${showFontPanel && readerPanelFocus === 'appearance' ? c.primary : readerBorder}`, borderRadius: 8, background: showFontPanel && readerPanelFocus === 'appearance' ? c.primaryBg : 'transparent', color: readerText, cursor: 'pointer', fontSize: 11 }}>
                                            <LucideIcon name="sunMoon" size={17} />
                                            <span style={{ display: 'block' }}>背景 / 主题</span>
                                        </button>
                                        <button onClick={() => { setShowChapterMenu(v => !v); setShowFontPanel(false); setShowMoreMenu(false); }} title="上一章、下一章和章节跳转" aria-label="切换章节"
                                            style={{ minWidth: 0, minHeight: 46, border: `1px solid ${showChapterMenu ? c.primary : readerBorder}`, borderRadius: 8, background: showChapterMenu ? c.primaryBg : 'transparent', color: readerText, cursor: 'pointer', fontSize: 11 }}>
                                            <LucideIcon name="listTree" size={17} />
                                            <span style={{ display: 'block' }}>切换章节</span>
                                        </button>
                                        <button onClick={() => { setShowToc(true); setShowChapterMenu(false); setShowFontPanel(false); }} title="查看目录并精确跳转" aria-label="目录"
                                            style={{ minWidth: 0, minHeight: 46, border: `1px solid ${readerBorder}`, borderRadius: 8, background: 'transparent', color: readerText, cursor: 'pointer', fontSize: 11 }}>
                                            <LucideIcon name="list" size={17} />
                                            <span style={{ display: 'block' }}>目录</span>
                                        </button>
                                    </div>
                                </>
                            );
                        })()}
                    </div>

                    {/* Reading settings panel — appearance and independent typography */}
                    <div data-reader-panel onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{
                        position: 'absolute', bottom: showBar ? 156 : -300, left: 12, right: 12, zIndex: 20,
                        background: readerPanel, backdropFilter: 'blur(20px)',
                        borderRadius: 10, padding: '16px 16px', maxHeight: 'calc(100vh - 190px)', overflowY: 'auto',
                        boxShadow: '0 -4px 24px rgba(0,0,0,0.1)', border: `1px solid ${readerBorder}`,
                        opacity: showFontPanel && showBar ? 1 : 0,
                        isolation: 'isolate',
                        transform: showFontPanel && showBar ? 'translateY(0)' : 'translateY(20px)',
                        pointerEvents: showFontPanel && showBar ? 'auto' : 'none',
                    }}>
                        {readerPanelFocus === 'appearance' && (
                            <>
                                <div style={{ fontSize: 13, fontWeight: 700, color: readerText, marginBottom: 10 }}>背景与主题</div>
                                {readerTheme !== 'eink' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                                        <span style={{ fontSize: 13, color: readerMuted, lineHeight: 1 }}>☀</span>
                                        <input type="range" min={30} max={100} step={1} value={readerBrightness}
                                            onChange={e => { const v = parseInt(e.target.value, 10); setReaderBrightness(v); localStorage.setItem('coread-brightness', String(v)); }}
                                            style={{ flex: 1, accentColor: c.primary, height: 4 }} />
                                        <span style={{ fontSize: 16, color: readerMuted, lineHeight: 1 }}>☀</span>
                                    </div>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginBottom: 14 }}>
                                    {(Object.keys(READER_THEME_OPTIONS) as ReaderTheme[]).map(theme => {
                                        const option = READER_THEME_OPTIONS[theme];
                                        const selected = readerTheme === theme;
                                        return <button key={theme} onClick={() => chooseReaderTheme(theme)}
                                            style={{
                                                minHeight: 40, padding: '7px 8px', borderRadius: 8,
                                                border: `1.5px solid ${selected ? c.primary : readerBorder}`,
                                                background: selected ? c.primaryBg : option.surface,
                                                color: option.text, cursor: 'pointer', fontSize: 11, fontWeight: selected ? 700 : 500,
                                            }}>
                                            {option.label}
                                        </button>;
                                    })}
                                </div>
                                <div style={{ marginTop: 4, paddingTop: 12, borderTop: `1px solid ${readerBorder}` }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: readerText, marginBottom: 8 }}>翻页效果</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7, marginBottom: 10 }}>
                                        {READER_PAGE_TURN_EFFECT_OPTIONS.map(option => {
                                            const selected = readerPageTurnEffect === option.value;
                                            return (
                                                <button key={option.value} onClick={() => {
                                                    setReaderPageTurnEffect(option.value);
                                                    localStorage.setItem('coread-reader-page-turn-effect', option.value);
                                                }}
                                                    title={option.description}
                                                    style={{
                                                        minHeight: 38, padding: '6px 5px', borderRadius: 8,
                                                        border: `1.5px solid ${selected ? c.primary : readerBorder}`,
                                                        background: selected ? c.primaryBg : 'transparent',
                                                        color: readerText, cursor: 'pointer', fontSize: 11, fontWeight: selected ? 700 : 500,
                                                    }}>
                                                    {option.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {readerPageTurnEffect !== 'none' && (
                                        <label style={{ display: 'block', color: readerMuted, fontSize: 11 }}>
                                            翻页速度
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                                                <span style={{ flexShrink: 0 }}>慢</span>
                                                <input type="range" min={280} max={1400} step={20} value={readerPageTurnDuration}
                                                    onChange={event => {
                                                        const value = parseInt(event.target.value, 10);
                                                        setReaderPageTurnDuration(value);
                                                        localStorage.setItem('coread-reader-page-turn-duration', String(value));
                                                    }}
                                                    style={{ flex: 1, accentColor: c.primary, height: 4 }}
                                                    aria-label="翻页速度" />
                                                <span style={{ flexShrink: 0 }}>快</span>
                                            </div>
                                            <div style={{ marginTop: 4, textAlign: 'center', color: readerMuted, fontSize: 10, opacity: 0.82 }}>
                                                {readerPageTurnDuration >= 1050 ? '慢速' : readerPageTurnDuration >= 700 ? '舒缓' : readerPageTurnDuration >= 480 ? '标准' : '快速'} · {readerPageTurnDuration}ms
                                            </div>
                                        </label>
                                    )}
                                </div>
                                {readerTheme === 'custom' && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingTop: 2 }}>
                                        <label style={{ color: readerMuted, fontSize: 11 }}>
                                            背景颜色
                                            <input type="color" value={customAppearance.background}
                                                onChange={event => updateCustomAppearance({ background: event.target.value })}
                                                style={{ display: 'block', width: '100%', height: 32, marginTop: 5, border: `1px solid ${readerBorder}`, borderRadius: 6, background: readerSurface, cursor: 'pointer' }} />
                                        </label>
                                        <label style={{ color: readerMuted, fontSize: 11 }}>
                                            文字颜色
                                            <input type="color" value={customAppearance.text}
                                                onChange={event => updateCustomAppearance({ text: event.target.value })}
                                                style={{ display: 'block', width: '100%', height: 32, marginTop: 5, border: `1px solid ${readerBorder}`, borderRadius: 6, background: readerSurface, cursor: 'pointer' }} />
                                        </label>
                                        <label style={{ gridColumn: '1 / -1', color: readerMuted, fontSize: 11 }}>
                                            轻纹理
                                            <select value={customAppearance.texture} onChange={event => updateCustomAppearance({ texture: event.target.value as ReaderTexture })}
                                                style={{ display: 'block', width: '100%', marginTop: 5, padding: '7px 8px', border: `1px solid ${readerBorder}`, borderRadius: 6, background: readerSurface, color: readerText, fontSize: 11 }}>
                                                <option value="none">无</option>
                                                <option value="paper">米色纸纹</option>
                                                <option value="kraft">牛皮纸纹</option>
                                            </select>
                                        </label>
                                    </div>
                                )}
                                {readerTheme === 'eink' && (
                                    <div style={{ padding: '8px 9px', border: `1px solid ${readerBorder}`, borderRadius: 7, color: '#000', background: '#fff', fontSize: 11, lineHeight: 1.5 }}>
                                        墨水屏使用纯黑白表面，不使用亮度、纸纹、阴影、模糊、动画或过渡。
                                    </div>
                                )}
                        {readerPanelFocus === 'appearance' && (
                            <div style={{ marginBottom: 14, padding: 10, border: `1px solid ${readerBorder}`, borderRadius: 8, background: readerSurface }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: readerText }}>全局字帖</div>
                                        <div style={{ marginTop: 3, fontSize: 10, color: readerMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {globalReaderFont.source === 'system' ? '系统宋体' : globalReaderFont.name}
                                        </div>
                                    </div>
                                    {globalReaderFontLoading && <span style={{ fontSize: 10, color: readerMuted }}>加载中…</span>}
                                    {globalReaderFont.source !== 'system' && (
                                        <button type="button" onClick={() => { void resetGlobalReaderFont(); }} style={{ border: `1px solid ${readerBorder}`, borderRadius: 6, background: 'transparent', color: readerMuted, padding: '5px 7px', cursor: 'pointer', fontSize: 10 }}>恢复默认</button>
                                    )}
                                </div>
                                <label style={{ display: 'block', marginBottom: 8, padding: '8px 9px', border: `1px dashed ${readerBorder}`, borderRadius: 7, color: readerText, cursor: 'pointer', fontSize: 11, textAlign: 'center' }}>
                                    上传 TTF / OTF / WOFF / WOFF2
                                    <input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={e => { void handleGlobalReaderFontFile(e.target.files?.[0]); e.currentTarget.value = ''; }} style={{ display: 'none' }} />
                                </label>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <input value={globalReaderFontUrl} onChange={e => setGlobalReaderFontUrl(e.target.value)} placeholder="或输入字体文件 URL / CSS WebFont URL / CSS" style={{ flex: 1, minWidth: 0, padding: '7px 8px', border: `1px solid ${readerBorder}`, borderRadius: 6, background: readerSurface, color: readerText, fontSize: 10, outline: 'none' }} />
                                    <button type="button" onClick={() => { void applyGlobalReaderFontUrl(); }} disabled={globalReaderFontLoading || !globalReaderFontUrl.trim()} style={{ padding: '0 9px', border: 'none', borderRadius: 6, background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 10, opacity: globalReaderFontLoading || !globalReaderFontUrl.trim() ? 0.5 : 1 }}>应用</button>
                                </div>
                                {globalReaderFontError && <div style={{ marginTop: 7, color: '#a33', fontSize: 10, lineHeight: 1.45 }}>{globalReaderFontError}</div>}
                                <div style={{ marginTop: 7, color: readerMuted, fontSize: 9, lineHeight: 1.45 }}>应用后作用于正文、章节标题和分页测量；刷新与换书后仍保留。CSS WebFont 也支持分片字体。</div>
                            </div>
                        )}
                                <div style={{ height: 2 }} />
                            </>
                        )}
                        {readerPanelFocus === 'typography' && (
                            <div style={{ fontSize: 13, fontWeight: 700, color: readerText, marginBottom: 10 }}>正文与批注排版</div>
                        )}
                        {readerPanelFocus === 'typography' && (
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14, borderRadius: 8, overflow: 'hidden', border: `1px solid ${readerBorder}` }}>
                            <button onClick={() => updateReaderLayout({ fontSize: Math.max(12, readerLayout.fontSize - 1) })}
                                style={{ flex: 1, padding: '8px 0', background: 'none', border: 'none', borderRight: `1px solid ${readerBorder}`, cursor: 'pointer', fontSize: 13, fontFamily: 'serif', color: readerMuted }}>
                                A<span style={{ fontSize: 9, verticalAlign: 'super' }}>−</span>
                            </button>
                            <span style={{ padding: '8px 14px', fontSize: 12, color: c.primary, fontWeight: 600, textAlign: 'center', minWidth: 36, borderRight: `1px solid ${readerBorder}` }}>
                                {readerLayout.fontSize}
                            </span>
                            <button onClick={() => updateReaderLayout({ fontSize: Math.min(28, readerLayout.fontSize + 1) })}
                                style={{ flex: 1, padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, fontFamily: 'serif', color: readerMuted }}>
                                A<span style={{ fontSize: 9, verticalAlign: 'super' }}>+</span>
                            </button>
                        </div>
                        )}
                        {readerPanelFocus === 'typography' && <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '9px 12px', alignItems: 'center', marginBottom: 14 }}>
                            <label style={{ fontSize: 12, color: readerMuted }}>正文行距</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.lineHeight.toFixed(2)}</span>
                            <input type="range" min={1.3} max={2.5} step={0.05} value={readerLayout.lineHeight} onChange={e => updateReaderLayout({ lineHeight: parseFloat(e.target.value) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                            <label style={{ fontSize: 12, color: readerMuted }}>正文间距</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.letterSpacing.toFixed(1)}px</span>
                            <input type="range" min={-0.5} max={3} step={0.1} value={readerLayout.letterSpacing} onChange={e => updateReaderLayout({ letterSpacing: parseFloat(e.target.value) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                            <label style={{ fontSize: 12, color: readerMuted }}>段间距</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.paragraphGap}px</span>
                            <input type="range" min={0} max={40} step={1} value={readerLayout.paragraphGap} onChange={e => updateReaderLayout({ paragraphGap: parseInt(e.target.value, 10) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                            <label style={{ fontSize: 12, color: readerMuted }}>首行缩进</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.textIndent.toFixed(2)}em</span>
                            <input type="range" min={0} max={4} step={0.25} value={readerLayout.textIndent} onChange={e => updateReaderLayout({ textIndent: parseFloat(e.target.value) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                            <label style={{ fontSize: 12, color: readerMuted }}>顶高</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.topInset}px</span>
                            <input type="range" min={0} max={360} step={4} value={readerLayout.topInset} onChange={e => updateReaderLayout({ topInset: parseInt(e.target.value, 10) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                            <label style={{ fontSize: 12, color: readerMuted }}>底高</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.bottomInset}px</span>
                            <input type="range" min={0} max={360} step={4} value={readerLayout.bottomInset} onChange={e => updateReaderLayout({ bottomInset: parseInt(e.target.value, 10) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                            <label style={{ fontSize: 12, color: readerMuted }}>页面边距</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.sidePadding}px</span>
                            <input type="range" min={12} max={96} step={2} value={readerLayout.sidePadding} onChange={e => updateReaderLayout({ sidePadding: parseInt(e.target.value, 10) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                            <label style={{ fontSize: 12, color: readerMuted }}>正文最大宽度</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.maxWidth}px</span>
                            <input type="range" min={420} max={960} step={10} value={readerLayout.maxWidth} onChange={e => updateReaderLayout({ maxWidth: parseInt(e.target.value, 10) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                        </div>}
                        {readerPanelFocus === 'typography' && <div style={{ borderTop: `1px solid ${readerBorder}`, paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr auto', gap: '9px 12px', alignItems: 'center', marginBottom: 14 }}>
                            <label style={{ fontSize: 12, color: readerMuted }}>批注字号</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.noteFontSize}px</span>
                            <input type="range" min={12} max={28} step={1} value={readerLayout.noteFontSize} onChange={e => updateReaderLayout({ noteFontSize: parseInt(e.target.value, 10) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                            <label style={{ fontSize: 12, color: readerMuted }}>批注行距</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.noteLineHeight.toFixed(2)}</span>
                            <input type="range" min={1.2} max={2.5} step={0.05} value={readerLayout.noteLineHeight} onChange={e => updateReaderLayout({ noteLineHeight: parseFloat(e.target.value) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                            <label style={{ fontSize: 12, color: readerMuted }}>批注字距</label>
                            <span style={{ minWidth: 42, textAlign: 'right', fontSize: 11, color: c.primary }}>{readerLayout.noteLetterSpacing.toFixed(1)}px</span>
                            <input type="range" min={-0.5} max={3} step={0.1} value={readerLayout.noteLetterSpacing} onChange={e => updateReaderLayout({ noteLetterSpacing: parseFloat(e.target.value) })} style={{ gridColumn: '1 / -1', accentColor: c.primary }} />
                        </div>}
                        {readerPanelFocus === 'typography' && <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => updateReaderLayout(DEFAULT_READER_LAYOUT)}
                                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${readerBorder}`, background: 'transparent', cursor: 'pointer', fontSize: 12, color: readerMuted }}>
                                恢复默认
                            </button>
                            <button onClick={saveReaderPreset}
                                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: c.primary, cursor: 'pointer', fontSize: 12, color: '#fff', fontWeight: 600 }}>
                                存为本机预设
                            </button>
                        </div>}
                        {readerPanelFocus === 'typography' && Object.keys(readerPresets).length > 0 && (
                            <div style={{ marginTop: 10, borderTop: `1px solid ${readerBorder}`, paddingTop: 9 }}>
                                <div style={{ fontSize: 11, color: readerMuted, marginBottom: 6 }}>本机预设，不会自动同步到其他设备</div>
                                {Object.keys(readerPresets).map(name => (
                                    <div key={name} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                                        <button onClick={() => applyReaderPreset(name)} style={{ flex: 1, border: `1px solid ${readerBorder}`, borderRadius: 7, background: 'transparent', color: readerText, cursor: 'pointer', padding: '6px 8px', textAlign: 'left', fontSize: 12 }}>{name}</button>
                                        <button onClick={() => deleteReaderPreset(name)} title={`删除预设 ${name}`} aria-label={`删除预设 ${name}`} style={{ width: 30, border: `1px solid ${readerBorder}`, borderRadius: 7, background: 'transparent', color: readerMuted, cursor: 'pointer' }}>×</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Settings overlay */}
            {showSettings && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                    onClick={() => setShowSettings(false)}>
                    <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 20, padding: '24px 22px', width: '100%', maxWidth: 340, boxShadow: '0 8px 40px rgba(0,0,0,0.15)' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: c.primaryDark, marginBottom: 18 }}>设置 Settings</div>
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 6 }}>我的名字 My Name</label>
                        <input value={humanName} onChange={e => { setHumanName(e.target.value); localStorage.setItem('coread-human-name', e.target.value); }}
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: `1px solid ${c.primaryBorder}`, fontSize: 14, marginBottom: 16, outline: 'none' }} />
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 6 }}>AI的名字 AI Name</label>
                        <input value={aiName} onChange={e => { setAiName(e.target.value); localStorage.setItem('coread-ai-name', e.target.value); }}
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: `1px solid ${c.primaryBorder}`, fontSize: 14, marginBottom: 16, outline: 'none' }} />
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 6 }}>字体大小 Font Size</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                            <span style={{ fontSize: 12, color: '#aaa' }}>小</span>
                            <input type="range" min={12} max={28} step={1} value={readerLayout.fontSize}
                                onChange={e => updateReaderLayout({ fontSize: parseInt(e.target.value, 10) })}
                                style={{ flex: 1, accentColor: c.primary }} />
                            <span style={{ fontSize: 12, color: '#aaa' }}>大</span>
                            <span style={{ fontSize: 12, color: c.primary, fontWeight: 600, minWidth: 28, textAlign: 'center' }}>{readerLayout.fontSize}px</span>
                        </div>
                        <button onClick={openBackups}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', textAlign: 'left', gap: 10, padding: '10px 12px', marginBottom: 16, borderRadius: 10, border: `1px solid ${c.primaryBorder}`, background: c.primaryBg, color: c.primaryDark, cursor: 'pointer' }}>
                            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>书库备份与恢复</span>
                            <span style={{ fontSize: 11, color: c.primary }}>管理</span>
                        </button>
                        <button onClick={() => setShowSettings(false)} style={{ width: '100%', padding: '10px 0', borderRadius: 14, background: c.primary, border: 'none', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>完成</button>
                    </div>
                </div>
            )}

            {showBackups && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.34)', backdropFilter: 'blur(4px)', zIndex: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                    onClick={() => { if (!backupCreating && !restoreBusy) setShowBackups(false); }}>
                    <div onClick={e => e.stopPropagation()} className="no-scrollbar" style={{ width: '100%', maxWidth: 560, maxHeight: 'calc(100% - 28px)', overflow: 'auto', background: readerPanel, color: readerText, border: `1px solid ${readerBorder}`, borderRadius: 12, boxShadow: '0 14px 44px rgba(0,0,0,0.2)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${readerBorder}`, position: 'sticky', top: 0, background: readerPanel, zIndex: 1 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 15, fontWeight: 700, color: c.primaryDark }}>书库备份</div>
                                <div style={{ marginTop: 3, fontSize: 11, color: readerMuted }}>仅支持完整书库恢复；恢复前会自动创建一份保护备份。</div>
                            </div>
                            <button onClick={() => loadBackups()} title="刷新备份列表" aria-label="刷新备份列表" style={{ border: 'none', background: 'transparent', color: c.primary, cursor: 'pointer', padding: 5 }}>↻</button>
                            <button onClick={() => setShowBackups(false)} title="关闭备份管理" aria-label="关闭备份管理" style={{ border: 'none', background: 'transparent', color: readerMuted, cursor: 'pointer', fontSize: 21, lineHeight: 1, padding: 3 }}>×</button>
                        </div>
                        <div style={{ padding: 16 }}>
                            <button onClick={handleCreateBackup} disabled={backupCreating}
                                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: 'none', background: c.primary, color: '#fff', cursor: backupCreating ? 'wait' : 'pointer', fontWeight: 600, opacity: backupCreating ? 0.6 : 1 }}>
                                {backupCreating ? '正在创建备份…' : '创建手动备份'}
                            </button>
                            <div style={{ margin: '10px 0 12px', fontSize: 11, color: readerMuted, lineHeight: 1.55 }}>
                                自动备份每天在 Asia/Shanghai 03:30 后补做一次并保留最近 7 份。手动备份不会被自动清理。
                            </div>
                            {backupsLoading ? (
                                <div style={{ padding: '26px 0', textAlign: 'center', color: readerMuted, fontSize: 12 }}>正在读取备份…</div>
                            ) : backups.length === 0 ? (
                                <div style={{ padding: '26px 0', textAlign: 'center', color: readerMuted, fontSize: 12 }}>还没有可用备份。</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {backups.map(backup => (
                                        <div key={backup.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 11px', border: `1px solid ${readerBorder}`, borderRadius: 8 }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ color: readerText, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{backup.id}</div>
                                                <div style={{ marginTop: 4, color: readerMuted, fontSize: 10 }}>
                                                    {backup.kind === 'manual' ? '手动' : backup.kind === 'automatic' ? '自动' : '恢复前'} · {backup.statistics?.books ?? 0} 本书 · {backup.status === 'ready' ? '可用' : backup.status}
                                                </div>
                                            </div>
                                            <button onClick={() => beginRestorePreflight(backup)} disabled={backup.status !== 'ready' || restoreBusy}
                                                style={{ flexShrink: 0, padding: '6px 8px', borderRadius: 7, border: `1px solid ${c.primaryBorder}`, background: 'transparent', color: c.primary, cursor: backup.status === 'ready' ? 'pointer' : 'not-allowed', fontSize: 11, opacity: backup.status === 'ready' ? 1 : 0.45 }}>
                                                预检恢复
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {restorePreflight && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.46)', backdropFilter: 'blur(4px)', zIndex: 33, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                    onClick={() => { if (!restoreBusy) setRestorePreflight(null); }}>
                    <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: readerPanel, color: readerText, border: `1px solid ${readerBorder}`, borderRadius: 12, padding: 18, boxShadow: '0 16px 48px rgba(0,0,0,0.24)' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: c.primaryDark }}>确认完整书库恢复</div>
                        <div style={{ marginTop: 9, fontSize: 12, lineHeight: 1.65, color: readerMuted }}>
                            预检已验证备份内容。恢复将替换当前书库、章节、批注、进度和原始文件；不支持按书恢复。
                        </div>
                        <div style={{ marginTop: 10, padding: '9px 10px', borderRadius: 8, background: c.primaryBg, color: c.primaryDark, fontSize: 11, lineHeight: 1.55 }}>
                            备份：{restorePreflight.backup?.id}<br />
                            {restorePreflight.warning || '恢复前会自动创建保护备份。'}
                        </div>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 13, color: readerText, fontSize: 12, lineHeight: 1.5, cursor: 'pointer' }}>
                            <input type="checkbox" checked={restoreConfirmed} onChange={e => setRestoreConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
                            我确认要恢复完整书库，并理解当前书库将被此备份替换。
                        </label>
                        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                            <button onClick={() => setRestorePreflight(null)} disabled={restoreBusy} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1px solid ${readerBorder}`, background: 'transparent', color: readerMuted, cursor: 'pointer' }}>取消</button>
                            <button onClick={handleRestoreBackup} disabled={!restoreConfirmed || restoreBusy} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#b55', color: '#fff', cursor: restoreConfirmed && !restoreBusy ? 'pointer' : 'not-allowed', opacity: restoreConfirmed && !restoreBusy ? 1 : 0.45 }}>{restoreBusy ? '正在恢复…' : '确认恢复'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Upload overlay */}
            {showUpload && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                    onClick={() => { if (!uploading) setShowUpload(false); }}>
                    <div onClick={(e) => e.stopPropagation()} style={{
                        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderRadius: 24,
                        padding: 24, width: '100%', maxWidth: 420, maxHeight: 'calc(100% - 32px)', overflow: 'auto',
                        border: `1px solid ${c.primaryBorder}`, boxShadow: '0 12px 40px rgba(0,0,0,0.1)',
                    }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: c.primaryDark, marginBottom: 16 }}>上传书籍</div>

                        <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="书名"
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: `1px solid ${c.primaryBorder}`, fontSize: 14, outline: 'none', marginBottom: 12, background: c.primaryBg, color: '#333' }} />

                        <input ref={fileInputRef} type="file" accept=".txt,.md,.epub" onChange={handleFileSelect} style={{ display: 'none' }} />
                        <button onClick={() => fileInputRef.current?.click()} style={{
                            width: '100%', padding: '10px 14px', borderRadius: 12, border: `1px dashed ${c.primaryBorder}`,
                            background: c.primaryBg, fontSize: 13, color: c.primary, cursor: 'pointer', marginBottom: 8, textAlign: 'center',
                        }}>
                            {uploadFileName ? `已选: ${uploadFileName}` : '选择文件（TXT / MD / EPUB）'}
                        </button>

                        <div style={{ textAlign: 'center', fontSize: 11, color: '#ccc', margin: '4px 0 8px' }}>— 或者 —</div>

                        <textarea value={uploadText} onChange={e => { setUploadText(e.target.value); setUploadBase64(''); setUploadFormat('txt'); setUploadEncoding('auto'); setUploadFileName(''); setUploadPreview(null); setUploadChapters([]); }}
                            placeholder="粘贴文本内容...（段落之间用空行分隔）"
                            style={{ width: '100%', minHeight: 100, padding: '10px 14px', borderRadius: 12, border: `1px solid ${c.primaryBorder}`, fontSize: 13, outline: 'none', resize: 'vertical', background: c.primaryBg, color: '#333', lineHeight: 1.5 }} />

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                            <span style={{ fontSize: 12, color: '#777', flex: 1 }}>解析格式：{uploadFormat.toUpperCase()}</span>
                            <select value={uploadEncoding} onChange={e => { setUploadEncoding(e.target.value); if (uploadBase64 || uploadText.trim()) refreshUploadPreview(e.target.value); }}
                                disabled={uploadFormat === 'epub' || previewingUpload}
                                style={{ padding: '7px 8px', border: `1px solid ${c.primaryBorder}`, borderRadius: 8, background: '#fff', color: '#555', fontSize: 12 }}>
                                <option value="auto">自动识别编码</option>
                                <option value="utf-8">UTF-8</option>
                                <option value="utf-16le">UTF-16 LE</option>
                                <option value="utf-16be">UTF-16 BE</option>
                                <option value="gb18030">GB18030</option>
                                <option value="gbk">GBK</option>
                                <option value="big5">Big5</option>
                            </select>
                        </div>

                        {uploadPreview?.encoding_candidates?.length > 0 && (
                            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: `${c.primary}08`, color: '#777', fontSize: 11, lineHeight: 1.5 }}>
                                <div style={{ fontWeight: 600, color: c.primaryDark, marginBottom: 3 }}>编码候选（当前：{uploadPreview.encoding}）</div>
                                {uploadPreview.encoding_candidates.slice(0, 3).map((candidate: any) => (
                                    <div key={candidate.encoding}>{candidate.encoding} · {candidate.score} · {candidate.preview || '无预览'}</div>
                                ))}
                            </div>
                        )}

                        {uploadFormat === 'epub' && uploadBase64 && !uploadPreview && (
                            <button onClick={() => refreshUploadPreview('auto', 'epub')} disabled={previewingUpload}
                                style={{ width: '100%', padding: '8px 0', marginTop: 10, borderRadius: 10, border: `1px solid ${c.primaryBorder}`, background: '#fff', color: c.primary, cursor: 'pointer', fontSize: 12 }}>
                                {previewingUpload ? '正在解析...' : '预览 EPUB 目录'}
                            </button>
                        )}

                        {uploadText.trim() && !uploadPreview && (
                            <button onClick={() => refreshUploadPreview('auto', 'txt')} disabled={previewingUpload}
                                style={{ width: '100%', padding: '8px 0', marginTop: 10, borderRadius: 10, border: `1px solid ${c.primaryBorder}`, background: '#fff', color: c.primary, cursor: 'pointer', fontSize: 12 }}>
                                {previewingUpload ? '正在识别编码并切分...' : '识别编码并预览目录'}
                            </button>
                        )}

                        {uploadChapters.length > 0 && (
                            <div style={{ marginTop: 12, borderTop: `1px solid ${c.primaryBorder}`, paddingTop: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: c.primaryDark, flex: 1 }}>章节目录（{uploadChapters.length}）</span>
                                    {uploadPreview?.paragraph_count != null && <span style={{ fontSize: 11, color: '#aaa' }}>{uploadPreview.paragraph_count} 段</span>}
                                </div>
                                <div style={{ maxHeight: 210, overflow: 'auto', border: `1px solid ${c.primaryBorder}`, borderRadius: 8 }}>
                                    {uploadChapters.map((chapter: any, index: number) => (
                                        <div key={`${chapter.chapter_no}-${chapter.start_idx}`} style={{ padding: '8px 9px', borderBottom: index === uploadChapters.length - 1 ? 'none' : `1px solid ${c.primaryBorder}55` }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ width: 30, color: '#aaa', fontSize: 11 }}>#{chapter.chapter_no}</span>
                                                <input value={chapter.title} onChange={e => setUploadChapters(prev => prev.map((item, i) => i === index ? { ...item, title: e.target.value } : item))}
                                                    style={{ flex: 1, minWidth: 0, padding: '5px 6px', border: `1px solid ${c.primaryBorder}`, borderRadius: 5, fontSize: 12, color: '#444' }} />
                                                <button onClick={() => mergeUploadChapter(index)} disabled={index === uploadChapters.length - 1}
                                                    title="与下一章合并" aria-label="与下一章合并"
                                                    style={{ border: 'none', background: 'none', color: index === uploadChapters.length - 1 ? '#ccc' : c.primary, cursor: index === uploadChapters.length - 1 ? 'default' : 'pointer', fontSize: 16 }}>↘</button>
                                                <button onClick={() => splitUploadChapter(index)} title="拆分本章" aria-label="拆分本章"
                                                    style={{ border: 'none', background: 'none', color: c.primary, cursor: 'pointer', fontSize: 15 }}>⌁</button>
                                            </div>
                                            <div style={{ marginLeft: 36, marginTop: 3, color: '#aaa', fontSize: 10 }}>第 {chapter.start_idx + 1} - {chapter.end_idx + 1} 段 · {chapter.paragraph_count} 段</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <input ref={batchFileRef} type="file" accept=".txt,.md,.epub" multiple onChange={handleBatchUpload} style={{ display: 'none' }} />
                        <button onClick={() => batchFileRef.current?.click()} disabled={uploading} style={{
                            width: '100%', padding: '10px 0', borderRadius: 14, border: `1px dashed ${c.primary}`,
                            background: `${c.primary}10`, fontSize: 13, color: c.primary, cursor: 'pointer', marginTop: 12, fontWeight: 600,
                        }}>
                            {uploading ? '批量上传中...' : '批量上传 TXT / EPUB'}
                        </button>

                        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                            <button onClick={() => setShowUpload(false)} disabled={uploading}
                                style={{ flex: 1, padding: '10px 0', borderRadius: 14, border: `1px solid ${c.primaryBorder}`, background: 'white', fontSize: 13, color: '#999', cursor: 'pointer' }}>取消</button>
                            <button onClick={handleUpload} disabled={uploading}
                                style={{ flex: 1, padding: '10px 0', borderRadius: 14, border: 'none', background: c.primary, fontSize: 13, color: 'white', cursor: 'pointer', fontWeight: 600, opacity: uploading ? 0.6 : 1 }}>
                                {uploading ? '上传中...' : '添加到书架'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Book metadata editor */}
            {editingBook && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', zIndex: 31, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                    onClick={() => setEditingBook(null)}>
                    <div onClick={e => e.stopPropagation()} style={{ background: 'rgba(255,255,255,0.98)', borderRadius: 20, padding: 22, width: '100%', maxWidth: 380, maxHeight: 'calc(100% - 32px)', overflow: 'auto', border: `1px solid ${c.primaryBorder}`, boxShadow: '0 12px 40px rgba(0,0,0,0.12)' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: c.primaryDark, marginBottom: 14 }}>编辑书籍</div>
                        <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 5 }}>书名</label>
                        <input value={editBookTitle} onChange={e => setEditBookTitle(e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: `1px solid ${c.primaryBorder}`, borderRadius: 8, fontSize: 13, marginBottom: 14 }} />
                        <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 5, marginTop: 8 }}>封面</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                            {editBookCover ? (
                                <img src={api.imageUrl(editingBook!.id, editBookCover)} alt="" style={{ width: 60, height: 80, objectFit: 'cover', borderRadius: 6, border: `1px solid ${c.primaryBorder}` }} />
                            ) : (
                                <div style={{ width: 60, height: 80, borderRadius: 6, border: `1px dashed ${c.primaryBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 11 }}>无封面</div>
                            )}
                            <input type="file" accept="image/*" onChange={async e => {
                                const file = e.target.files?.[0];
                                if (!file || !editingBook) return;
                                try {
                                    const result = await api.uploadCover(editingBook.id, file);
                                    if (result.cover_image) {
                                        setEditBookCover(result.cover_image);
                                        toast('封面上传成功');
                                    }
                                } catch (err: any) {
                                    toast(`上传失败: ${err.message}`);
                                }
                            }} style={{ fontSize: 11 }} />
                        </div>

                        <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 5 }}>主分类（只能选一个）</label>
                        <select value={editBookCategory} onChange={e => setEditBookCategory(e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: `1px solid ${c.primaryBorder}`, borderRadius: 8, fontSize: 13, marginBottom: 14, background: '#fff' }}>
                            {libraryCategories.map(category => <option key={category} value={category}>{category}</option>)}
                        </select>

                        <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 6 }}>标签（可多选）</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                            {libraryTags.map(tag => {
                                const selected = editBookTags.includes(tag);
                                return <button key={tag} onClick={() => setEditBookTags(prev => selected ? prev.filter(item => item !== tag) : [...prev, tag])}
                                    style={{ padding: '5px 8px', borderRadius: 6, border: `1px solid ${selected ? c.primary : c.primaryBorder}`, background: selected ? `${c.primary}14` : '#fff', color: selected ? c.primaryDark : '#777', cursor: 'pointer', fontSize: 11 }}>
                                    {selected ? '✓ ' : ''}{tag}
                                </button>;
                            })}
                        </div>

                        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                            <select value={newOptionType} onChange={e => setNewOptionType(e.target.value as 'category' | 'tag')}
                                style={{ width: 88, padding: '7px 6px', border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: '#fff', color: '#777', fontSize: 11 }}>
                                <option value="tag">新标签</option>
                                <option value="category">新分类</option>
                            </select>
                            <input value={newOptionValue} onChange={e => setNewOptionValue(e.target.value)} placeholder={newOptionType === 'tag' ? '输入标签' : '输入分类'}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLibraryOption(); } }}
                                style={{ flex: 1, minWidth: 0, padding: '7px 8px', border: `1px solid ${c.primaryBorder}`, borderRadius: 7, fontSize: 11 }} />
                            <button onClick={addLibraryOption} style={{ padding: '7px 10px', border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: '#fff', color: c.primary, cursor: 'pointer', fontSize: 11 }}>新增</button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                            <select value={deleteOptionValue} onChange={e => setDeleteOptionValue(e.target.value)}
                                style={{ flex: 1, minWidth: 0, padding: '7px 6px', border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: '#fff', color: '#777', fontSize: 11 }}>
                                <option value="">选择要删除的{newOptionType === 'category' ? '分类' : '标签'}</option>
                                {(newOptionType === 'category' ? libraryCategories : libraryTags).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                            <button onClick={deleteLibraryOption} style={{ padding: '7px 10px', border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: '#fff', color: '#c44', cursor: 'pointer', fontSize: 11 }}>删除</button>
                        </div>

                        <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 5 }}>备注</label>
                        <textarea value={editBookNote} onChange={e => setEditBookNote(e.target.value)} placeholder="给这本书写点备注"
                            style={{ width: '100%', boxSizing: 'border-box', minHeight: 90, resize: 'vertical', padding: '9px 10px', border: `1px solid ${c.primaryBorder}`, borderRadius: 8, fontSize: 13, lineHeight: 1.5, marginBottom: 16 }} />

                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setEditingBook(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: `1px solid ${c.primaryBorder}`, background: '#fff', color: '#888', cursor: 'pointer', fontSize: 12 }}>取消</button>
                            <button onClick={saveBookEditor} style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>保存</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirmation */}
            {confirmDelete !== null && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                    onClick={() => setConfirmDelete(null)}>
                    <div onClick={(e) => e.stopPropagation()} style={{
                        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderRadius: 20,
                        padding: 24, width: '100%', maxWidth: 300, textAlign: 'center', border: `1px solid ${c.primaryBorder}`,
                    }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 6 }}>确认删除？</div>
                        <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>书籍和所有批注都会被删除</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 14, border: `1px solid ${c.primaryBorder}`, background: 'white', fontSize: 13, color: '#999', cursor: 'pointer' }}>取消</button>
                            <button onClick={() => handleDeleteBook(confirmDelete)} style={{ flex: 1, padding: '10px 0', borderRadius: 14, border: 'none', background: '#e66', fontSize: 13, color: 'white', cursor: 'pointer', fontWeight: 600 }}>删除</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Permanent delete confirmation */}
            {confirmPermanentDelete !== null && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.34)', backdropFilter: 'blur(4px)', zIndex: 31, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                    onClick={() => setConfirmPermanentDelete(null)}>
                    <div onClick={(e) => e.stopPropagation()} style={{
                        background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(20px)', borderRadius: 14,
                        padding: 22, width: '100%', maxWidth: 320, textAlign: 'center', border: '1px solid rgba(170,82,82,0.22)',
                        boxShadow: '0 18px 48px rgba(42,30,36,0.2)',
                    }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#493a40', marginBottom: 7 }}>永久删除这本书？</div>
                        <div style={{ fontSize: 12, color: '#8d747c', lineHeight: 1.65, marginBottom: 17 }}>
                            原文、阅读进度、批注、收藏和剧情资料都会一并删除，且无法恢复。
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => setConfirmPermanentDelete(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: `1px solid ${c.primaryBorder}`, background: 'white', fontSize: 13, color: '#777', cursor: 'pointer' }}>取消</button>
                            <button onClick={() => handlePermanentDeleteBook(confirmPermanentDelete)} style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: 'none', background: '#b85c68', fontSize: 13, color: 'white', cursor: 'pointer', fontWeight: 700 }}>永久删除</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Batch delete confirmation */}
            {confirmBatchDelete !== null && (
                <div
                    style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 33, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                    onClick={() => setConfirmBatchDelete(null)}
                >
                    <div
                        onClick={event => event.stopPropagation()}
                        style={{ width: '100%', maxWidth: 340, padding: 20, border: '3px solid #111', borderRadius: 2, background: '#fff', color: '#111' }}
                    >
                        <div style={{ fontSize: 16, fontWeight: 900, paddingBottom: 8, borderBottom: '3px solid #111' }}>
                            {confirmBatchDelete === 'permanent'
                                ? `永久删除 ${selectedBooks.size} 本书？`
                                : `删除 ${selectedBooks.size} 本书？`}
                        </div>
                        <div style={{ padding: '12px 0 16px', fontSize: 12, lineHeight: 1.7, color: '#444' }}>
                            {confirmBatchDelete === 'permanent'
                                ? '原文、批注、阅读进度、收藏和剧情资料都会一并删除，且无法恢复。成功删除的书也会清除这台设备上的阅读缓存。'
                                : '选中的书会移入回收站，之后仍可恢复。'}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <button className="coread-text-button" onClick={() => setConfirmBatchDelete(null)}>取消</button>
                            <button
                                className="coread-text-button"
                                onClick={() => void handleBatchDeleteBooks()}
                                style={{ background: '#111', color: '#fff' }}
                            >
                                {confirmBatchDelete === 'permanent' ? '永久删除' : '移入回收站'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Server-backed bulk reading jobs */}
            {showBatchReading && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.34)', backdropFilter: 'blur(4px)', zIndex: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                    onClick={() => setShowBatchReading(false)}>
                    <div onClick={e => e.stopPropagation()} className="no-scrollbar" style={{ width: '100%', maxWidth: 540, maxHeight: 'calc(100% - 28px)', overflow: 'auto', background: readerPanel, border: `1px solid ${c.primaryBorder}`, borderRadius: 16, boxShadow: '0 14px 44px rgba(0,0,0,0.2)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${c.primaryBorder}`, position: 'sticky', top: 0, background: readerPanel, zIndex: 2 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 15, fontWeight: 700, color: c.primaryDark }}>批量阅读</div>
                                <div style={{ fontSize: 11, marginTop: 3, color: readerMuted }}>任务、进度与用量都保存在服务器，换设备也能继续查看。</div>
                            </div>
                            <button onClick={() => setShowBatchReading(false)} title="关闭批量阅读" aria-label="关闭批量阅读"
                                style={{ border: 'none', background: 'none', color: '#aaa', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '2px 4px' }}>×</button>
                        </div>

                        <div style={{ padding: '14px 16px 18px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                                {([
                                    ['main', '小 C 阅读', '主模型逐章精读，写正式摘要与批注'],
                                    ['helper', '小助手阅读', '副 API 逐章扫读，结果明确标注来源'],
                                ] as const).map(([value, title, note]) => {
                                    const selected = batchTaskType === value;
                                    return <button key={value} onClick={() => {
                                        setBatchTaskType(value);
                                        setBatchConcurrency(value === 'main' ? 1 : 2);
                                        setBatchBudgetTokens(value === 'main' ? 500000 : 1000000);
                                        setBatchPreview(null);
                                        setBatchPreviewKey('');
                                        setBatchBudgetConfirmed(false);
                                    }} style={{
                                        textAlign: 'left', padding: '10px 11px', borderRadius: 8, cursor: 'pointer',
                                        border: `1px solid ${selected ? c.primary : c.primaryBorder}`,
                                        background: selected ? c.primaryBg : 'transparent', color: readerText,
                                    }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: selected ? c.primary : readerText }}>{title}</div>
                                        <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.45, color: readerMuted }}>{note}</div>
                                    </button>;
                                })}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                                <label style={{ display: 'block', fontSize: 11, color: readerMuted }}>
                                    开始章节
                                    <BoundedNumberInput value={batchStartChapter} min={1} max={Math.max(1, tocChapters.length)}
                                        onCommit={next => {
                                            setBatchStartChapter(next);
                                            setBatchEndChapter(previous => Math.max(next, previous));
                                            setBatchPreview(null);
                                            setBatchPreviewKey('');
                                        }}
                                        borderColor={readerBorder} background={readerSurface} color={readerText} fontSize={13} />
                                </label>
                                <label style={{ display: 'block', fontSize: 11, color: readerMuted }}>
                                    结束章节
                                    <BoundedNumberInput value={batchEndChapter} min={batchStartChapter} max={Math.max(1, tocChapters.length)}
                                        onCommit={next => {
                                            setBatchEndChapter(next);
                                            setBatchPreview(null);
                                            setBatchPreviewKey('');
                                        }}
                                        borderColor={readerBorder} background={readerSurface} color={readerText} fontSize={13} />
                                </label>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                                <label style={{ display: 'block', fontSize: 11, color: readerMuted }}>
                                    回顾
                                    <select value={reviewMode} onChange={e => { changeReviewMode(e.target.value === 'fine' ? 'fine' : 'layered'); setBatchPreview(null); setBatchPreviewKey(''); }}
                                        style={{ display: 'block', width: '100%', marginTop: 5, padding: '8px 7px', border: `1px solid ${readerBorder}`, borderRadius: 7, background: readerSurface, color: readerText, fontSize: 12 }}>
                                        <option value="fine">精细</option>
                                        <option value="layered">分层</option>
                                    </select>
                                </label>
                                <label style={{ display: 'block', fontSize: 11, color: readerMuted }}>
                                    并发
                                    <BoundedNumberInput value={batchConcurrency} min={1} max={batchTaskType === 'main' ? 5 : 8}
                                        onCommit={next => {
                                            setBatchConcurrency(next);
                                            setBatchPreview(null);
                                            setBatchPreviewKey('');
                                        }}
                                        borderColor={readerBorder} background={readerSurface} color={readerText} />
                                </label>
                                <label style={{ display: 'block', fontSize: 11, color: readerMuted }}>
                                    输入预算
                                    <BoundedNumberInput value={batchBudgetTokens} min={1000} max={batchTaskType === 'main' ? 500000 : 1000000} step={1000}
                                        onCommit={next => {
                                            setBatchBudgetTokens(next);
                                            setBatchPreview(null);
                                            setBatchPreviewKey('');
                                        }}
                                        borderColor={readerBorder} background={readerSurface} color={readerText} />
                                </label>
                            </div>
                            <div style={{ marginTop: -5, marginBottom: 12, color: '#a76c2b', fontSize: 11, lineHeight: 1.5 }}>
                                并发越高，费用与触发限流的风险越高。主模型默认 1、最多 5；小助手默认 2、最多 8。
                            </div>

                            <button onClick={previewBatchReading} disabled={batchPreviewing || !activeBook || !tocChapters.length}
                                style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: `1px solid ${c.primaryBorder}`, background: c.primaryBg, color: c.primary, cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: batchPreviewing ? 0.6 : 1 }}>
                                {batchPreviewing ? '正在计算预算…' : '查看预算'}
                            </button>

                            {batchPreview?.preview && (() => {
                                const preview = batchPreview.preview;
                                const configured = (batchPreview.models || []).find((model: any) => model.kind === batchTaskType);
                                return <div style={{ marginTop: 11, padding: '10px 11px', border: `1px solid ${preview.blocked ? '#d99' : c.primaryBorder}`, borderRadius: 8, background: preview.blocked ? '#fff5f5' : readerSurface }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <strong style={{ flex: 1, fontSize: 12, color: preview.blocked ? '#b66' : readerText }}>
                                            第 {preview.start_chapter}-{preview.end_chapter} 章 · {preview.chapter_count} 章 · 约 {preview.estimated_requests} 次请求
                                        </strong>
                                        <span style={{ fontSize: 10, color: readerMuted }}>{preview.source_label}</span>
                                    </div>
                                    <div style={{ fontSize: 11, lineHeight: 1.7, color: readerMuted }}>
                                        预计输入 {formatTokens(preview.estimated_input_tokens)} Token，输出 {formatTokens(preview.estimated_output_tokens)} Token；本次上限 {formatTokens(preview.budget_tokens)} Token；并发 {preview.concurrency}。
                                        <br />
                                        {configured?.configured ? `模型：${configured.model}${configured.fallback?.length ? `；备用 ${configured.fallback.join('、')}` : ''}` : '该模型连接器尚未配置。'}
                                    </div>
                                    {preview.estimated_over_budget && <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: '#b66' }}>按当前预算，任务可能在后续章节前转为等待人工继续。</div>}
                                    {preview.soft_limit_chapters?.length > 0 && <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: '#a76c2b' }}>第 {preview.soft_limit_chapters.join('、')} 章超过单次提醒线。</div>}
                                    {preview.hard_limit_chapters?.length > 0 && <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: '#b66' }}>第 {preview.hard_limit_chapters.join('、')} 章超过硬上限，不能启动。</div>}
                                    <div style={{ marginTop: 7, fontSize: 10, color: readerMuted }}>这里只记录 Token 预算；实际费用由模型服务商按实际账单计算。</div>
                                </div>;
                            })()}

                            {batchPreview?.preview?.requires_confirmation && !batchPreview?.preview?.blocked && (
                                <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 10, fontSize: 11, lineHeight: 1.5, color: readerText, cursor: 'pointer' }}>
                                    <input type="checkbox" checked={batchBudgetConfirmed} onChange={e => setBatchBudgetConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
                                    我知道这个范围触及提醒线或可能超过本次预算，仍要创建任务。超出预算时服务器会停止继续发送请求并等待我手动处理。
                                </label>
                            )}

                            <button onClick={startBatchReading}
                                disabled={batchPreviewing || Boolean(batchPreview?.preview?.blocked)}
                                style={{ width: '100%', marginTop: 11, padding: '10px', borderRadius: 8, border: 'none', background: c.primary, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: batchPreviewing || batchPreview?.preview?.blocked ? 0.55 : 1 }}>
                                启动 {batchTaskType === 'main' ? '小 C 阅读' : '小助手阅读'}
                            </button>

                            {batchTask?.task && (() => {
                                const task = batchTask.task;
                                const counts = Object.fromEntries((batchTask.counts || []).map((row: any) => [row.status, row.count])) as Record<string, number>;
                                const statusName: Record<string, string> = { queued: '排队中', running: '进行中', waiting: '等待处理', paused: '已暂停', completed: '已完成', cancelled: '已取消' };
                                const usage = batchTask.usage || [];
                                const lastUsage = usage[usage.length - 1];
                                const hasAttention = Number(counts.failed || 0) + Number(counts.blocked || 0) > 0;
                                return <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${c.primaryBorder}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <strong style={{ flex: 1, fontSize: 13, color: c.primaryDark }}>当前任务 #{task.id}</strong>
                                        <span style={{ fontSize: 11, color: task.status === 'completed' ? '#5d8d66' : task.status === 'waiting' ? '#b66' : c.primary }}>{statusName[task.status] || task.status}</span>
                                    </div>
                                    <div style={{ marginTop: 7, fontSize: 11, lineHeight: 1.65, color: readerMuted }}>
                                        {task.model_role === 'helper' ? '副 API 扫读' : '主模型精读'} · 第 {task.start_chapter}-{task.end_chapter} 章 · 完成 {counts.completed || 0}，排队 {counts.queued || 0}，运行 {counts.running || 0}，失败/阻塞 {(counts.failed || 0) + (counts.blocked || 0)}。
                                        <br />
                                        已用输入 {formatTokens(task.spent_tokens)}，预留 {formatTokens(task.reserved_input_tokens)}，本次预算 {formatTokens(task.budget_tokens)} Token。
                                        {lastUsage?.model && <><br />最近来源：{lastUsage.source || lastUsage.model_role} · {lastUsage.model}{lastUsage.estimated ? '（估算用量）' : ''}</>}
                                        {task.pause_reason && <><br />{task.pause_reason}</>}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                                        {['queued', 'running'].includes(task.status) && <button onClick={() => controlBatchTask('pause')} disabled={batchTaskActionBusy} style={{ padding: '6px 9px', borderRadius: 7, border: `1px solid ${c.primaryBorder}`, background: 'transparent', color: c.primary, cursor: 'pointer', fontSize: 11 }}>暂停</button>}
                                        {!['completed', 'cancelled'].includes(task.status) && <button onClick={() => controlBatchTask('cancel')} disabled={batchTaskActionBusy} style={{ padding: '6px 9px', borderRadius: 7, border: '1px solid #e8c7c7', background: 'transparent', color: '#ba6767', cursor: 'pointer', fontSize: 11 }}>取消</button>}
                                        {['paused', 'waiting'].includes(task.status) && <button onClick={() => controlBatchTask('resume')} disabled={batchTaskActionBusy} style={{ padding: '6px 9px', borderRadius: 7, border: `1px solid ${c.primaryBorder}`, background: c.primaryBg, color: c.primary, cursor: 'pointer', fontSize: 11 }}>继续</button>}
                                        {hasAttention && <button onClick={() => controlBatchTask('retry_current')} disabled={batchTaskActionBusy} style={{ padding: '6px 9px', borderRadius: 7, border: `1px solid ${c.primaryBorder}`, background: 'transparent', color: c.primary, cursor: 'pointer', fontSize: 11 }}>重试失败章</button>}
                                        {hasAttention && <button onClick={() => controlBatchTask('skip_current')} disabled={batchTaskActionBusy} style={{ padding: '6px 9px', borderRadius: 7, border: `1px solid ${c.primaryBorder}`, background: 'transparent', color: '#777', cursor: 'pointer', fontSize: 11 }}>跳过当前章</button>}
                                    </div>
                                </div>;
                            })()}

                            <div style={{ marginTop: 18, paddingTop: 13, borderTop: `1px solid ${c.primaryBorder}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                                    <strong style={{ flex: 1, fontSize: 12, color: c.primaryDark }}>服务器上的最近任务</strong>
                                    <button onClick={() => loadRecentBatchTasks()} title="刷新任务列表" aria-label="刷新任务列表" style={{ border: 'none', background: 'transparent', color: c.primary, cursor: 'pointer', fontSize: 11 }}>刷新</button>
                                </div>
                                {recentBatchTasks.length ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {recentBatchTasks.map(task => <button key={task.id} onClick={async () => {
                                            try { await pollBatchTask(task.id); } catch (error: any) { toast(`读取任务失败: ${error.message}`); }
                                        }} style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', padding: '8px 9px', borderRadius: 7, border: `1px solid ${batchTask?.task?.id === task.id ? c.primary : c.primaryBorder}`, background: batchTask?.task?.id === task.id ? c.primaryBg : 'transparent', color: readerText, cursor: 'pointer', fontSize: 11 }}>
                                            <span style={{ flex: 1 }}>#{task.id} · {task.model_role === 'helper' ? '小助手' : '小 C'} · {task.start_chapter}-{task.end_chapter} 章</span>
                                            <span style={{ color: task.status === 'completed' ? '#5d8d66' : task.status === 'waiting' ? '#b66' : c.primary }}>{task.status === 'completed' ? '完成' : task.status === 'waiting' ? '等待' : task.status === 'paused' ? '暂停' : task.status === 'cancelled' ? '取消' : task.status === 'running' ? '进行中' : '排队'}</span>
                                        </button>)}
                                    </div>
                                ) : <div style={{ fontSize: 11, color: readerMuted, padding: '8px 0' }}>这本书还没有服务器任务。</div>}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showFavorites && (
                <div onClick={() => setShowFavorites(false)} style={{
                    position: 'absolute', inset: 0, zIndex: 34, background: 'rgba(0,0,0,0.22)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
                }}>
                    <div onClick={event => event.stopPropagation()} style={{
                        width: '100%', maxWidth: 720, maxHeight: '78vh', display: 'flex', flexDirection: 'column',
                        background: readerPanel, border: `1px solid ${readerBorder}`, borderRadius: 10,
                        boxShadow: '0 18px 48px rgba(0,0,0,0.18)', overflow: 'hidden',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${readerBorder}` }}>
                            <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: readerText }}>收藏批注</div>
                            <button onClick={() => setShowFavorites(false)} title="关闭收藏" aria-label="关闭收藏" style={{ border: 'none', background: 'none', color: readerMuted, fontSize: 22, cursor: 'pointer' }}>×</button>
                        </div>
                        <div className="no-scrollbar" style={{ overflow: 'auto', padding: 14 }}>
                            {favoritesLoading ? <div style={{ padding: 28, textAlign: 'center', color: readerMuted, fontSize: 12 }}>正在读取收藏…</div>
                                : favoriteGroups.length === 0 ? <div style={{ padding: 28, textAlign: 'center', color: readerMuted, fontSize: 12 }}>还没有收藏的批注。</div>
                                : favoriteGroups.map(group => {
                                    const expanded = expandedFavoriteBooks.has(group.bookId);
                                    return <section key={group.bookId} style={{ marginBottom: 10, border: `1px solid ${readerBorder}`, borderRadius: 8, overflow: 'hidden' }}>
                                        <button onClick={() => setExpandedFavoriteBooks(previous => {
                                            const next = new Set(previous);
                                            next.has(group.bookId) ? next.delete(group.bookId) : next.add(group.bookId);
                                            return next;
                                        })} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: 'none', background: readerSurface, color: readerText, cursor: 'pointer', textAlign: 'left' }}>
                                            <span style={{ color: c.primary }}>{expanded ? '⌄' : '›'}</span>
                                            <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{group.bookTitle}</strong>
                                            <span style={{ color: readerMuted, fontSize: 11 }}>{group.comments.length} 条</span>
                                        </button>
                                        {expanded && <div style={{ padding: '6px 10px 10px', background: readerPanel }}>
                                            {group.comments.map(comment => {
                                                const detail = favoriteDetailId === comment.id;
                                                const label = comment.annotation_kind === 'wavy_underline' ? `波浪线 · ${comment.selected_text || '原文'}` : (comment.content || comment.selected_text || '批注');
                                                return <div key={comment.id} style={{ borderTop: `1px solid ${readerBorder}88`, padding: '9px 2px' }}>
                                                    <button onClick={() => setFavoriteDetailId(detail ? null : comment.id)} style={{ width: '100%', border: 'none', background: 'transparent', color: readerText, cursor: 'pointer', textAlign: 'left', fontSize: 12, lineHeight: 1.55 }}>
                                                        {label.length > 72 && !detail ? `${label.slice(0, 72)}…` : label}
                                                    </button>
                                                    {detail && <div style={{ marginTop: 7, padding: 9, background: readerSurface, borderRadius: 7 }}>
                                                        {comment.selected_text && <div style={{ marginBottom: 6, color: readerMuted, fontSize: 11, lineHeight: 1.45 }}>“{comment.selected_text}”</div>}
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <button onClick={() => openFavoriteComment(comment)} style={{ border: `1px solid ${readerBorder}`, borderRadius: 7, background: 'transparent', color: c.primary, padding: '5px 8px', cursor: 'pointer', fontSize: 11 }}>跳转查看</button>
                                                        </div>
                                                    </div>}
                                                </div>;
                                            })}
                                        </div>}
                                    </section>;
                                })}
                        </div>
                    </div>
                </div>
            )}

            {mode === 'reading' && showAnnotationList && (
                <div onClick={() => setShowAnnotationList(null)} style={{
                    position: 'absolute', inset: 0, zIndex: 32, background: 'rgba(0,0,0,0.2)',
                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                }}>
                    <div onClick={event => event.stopPropagation()} style={{
                        width: '100%', maxWidth: 680, maxHeight: '76vh', display: 'flex', flexDirection: 'column',
                        background: readerPanel, border: `1px solid ${readerBorder}`, borderRadius: '12px 12px 0 0', overflow: 'hidden',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 16px', borderBottom: `1px solid ${readerBorder}` }}>
                            <div style={{ flex: 1, fontWeight: 700, color: readerText, fontSize: 14 }}>{showAnnotationList === 'page' ? '当前页批注' : '本章批注'}</div>
                            <span style={{ color: readerMuted, fontSize: 11 }}>{annotationList.length} 条</span>
                            <button onClick={() => setShowAnnotationList(null)} title="关闭本章批注" aria-label="关闭本章批注" style={{ border: 'none', background: 'none', color: readerMuted, fontSize: 21, cursor: 'pointer' }}>×</button>
                        </div>
                        <div className="no-scrollbar" style={{ overflow: 'auto', padding: 12 }}>
                            {annotationList.length === 0 ? <div style={{ padding: 28, textAlign: 'center', color: readerMuted, fontSize: 12 }}>这一章还没有批注或波浪线。</div>
                                : annotationList.map(comment => {
                                    const isWave = comment.annotation_kind === 'wavy_underline';
                                    return <div key={comment.id} style={{ display: 'flex', gap: 7, marginBottom: 7 }}>
                                        <button onClick={() => jumpToComment(comment)} style={{
                                            flex: 1, minWidth: 0, padding: '9px 10px', border: `1px solid ${readerBorder}`, borderRadius: 8,
                                            background: 'transparent', color: readerText, textAlign: 'left', cursor: 'pointer',
                                        }}>
                                            <div style={{ display: 'flex', gap: 8, marginBottom: 4, color: isWave ? c.tongColor : c.primary, fontSize: 10 }}>
                                                <span>{isWave ? '波浪线' : displayName(comment.from_who)}</span>
                                                <span>段落 {comment.paragraph_idx}</span>
                                            </div>
                                            <div style={{ fontSize: 12, lineHeight: 1.5 }}>{isWave ? (comment.selected_text || '已划波浪线') : (comment.content || comment.selected_text || '批注')}</div>
                                        </button>
                                        {isWave && (
                                            <button onClick={() => {
                                                if (window.confirm('删除这条波浪线？')) void handleDeleteComment(comment);
                                            }} title="删除这条波浪线" aria-label="删除这条波浪线" style={{
                                                flex: '0 0 44px', border: `1px solid ${readerBorder}`, borderRadius: 8,
                                                background: 'transparent', color: '#9a3a3a', cursor: 'pointer', fontSize: 11,
                                            }}>
                                                删除
                                            </button>
                                        )}
                                    </div>;
                                })}
                        </div>
                    </div>
                </div>
            )}

            {mode === 'reading' && activeWaveAnnotation && (
                <div onClick={() => setActiveWaveAnnotation(null)} style={{
                    position: 'absolute', inset: 0, zIndex: 31, pointerEvents: 'none',
                }}>
                    <div onClick={event => event.stopPropagation()} style={{
                        position: 'absolute', left: '50%', bottom: 'calc(88px + env(safe-area-inset-bottom))',
                        transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8,
                        maxWidth: 'calc(100% - 28px)', padding: '8px 10px',
                        background: readerPanel, border: `1px solid ${readerBorder}`, borderRadius: 8,
                        boxShadow: '0 4px 14px rgba(0,0,0,0.16)', pointerEvents: 'auto',
                    }}>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: readerMuted, fontSize: 11 }}>
                            波浪线
                        </span>
                        <button onClick={() => {
                            if (!window.confirm('删除这条波浪线？')) return;
                            void handleDeleteComment(activeWaveAnnotation);
                            setActiveWaveAnnotation(null);
                        }} title="删除这条波浪线" aria-label="删除这条波浪线" style={{
                            flexShrink: 0, border: `1px solid ${readerBorder}`, borderRadius: 6,
                            padding: '5px 8px', background: 'transparent', color: '#9a3a3a',
                            cursor: 'pointer', fontSize: 11,
                        }}>
                            删除波浪线
                        </button>
                        <button onClick={() => setActiveWaveAnnotation(null)} title="关闭" aria-label="关闭" style={{
                            flex: '0 0 26px', height: 26, border: 'none', background: 'transparent',
                            color: readerMuted, cursor: 'pointer', fontSize: 18, lineHeight: 1,
                        }}>
                            ×
                        </button>
                    </div>
                </div>
            )}

            {/* TOC overlay */}
            {showToc && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', zIndex: 30, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80 }}
                    onClick={() => setShowToc(false)}>
                    <div ref={tocListRef} onClick={(e) => e.stopPropagation()} onScroll={(e) => setTocScrollTop((e.target as HTMLDivElement).scrollTop)} style={{
                        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderRadius: 20,
                        padding: '0', width: 'calc(100% - 40px)', maxWidth: 360, maxHeight: '60vh', overflow: 'auto',
                        border: `1px solid ${c.primaryBorder}`, boxShadow: '0 12px 40px rgba(0,0,0,0.1)',
                    }} className="no-scrollbar">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 10px', borderBottom: `1px solid ${c.primaryBorder}`, position: 'sticky', top: 0, background: 'rgba(255,255,255,0.97)', zIndex: 1 }}>
                            <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: c.primaryDark, paddingLeft: 6 }}>
                                {showRechapter ? '重新分章' : '目录'}
                            </div>
                            {showRechapter ? (
                                <button onClick={() => { setShowRechapter(false); setChapterRuleError(''); }} title="返回目录" aria-label="返回目录"
                                    style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: '#fff', color: c.primary, padding: '5px 8px', cursor: 'pointer', fontSize: 11 }}>返回</button>
                            ) : (
                                <>
                                    <button onClick={openRechapterPanel} title="重新识别并选择分章规则" aria-label="重新分章"
                                        style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: '#fff', color: c.primary, padding: '5px 8px', cursor: 'pointer', fontSize: 11 }}>重分章</button>
                                    <button onClick={openBatchReading} title="批量阅读" aria-label="批量阅读"
                                        style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: '#fff', color: c.primary, padding: '5px 8px', cursor: 'pointer', fontSize: 11 }}>批量</button>
                                    <button onClick={() => { setShowBatchReading(true); loadRecentBatchTasks(); }} title="查看服务器任务" aria-label="查看服务器任务"
                                        style={{ border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: '#fff', color: c.primary, padding: '5px 8px', cursor: 'pointer', fontSize: 11 }}>任务</button>
                                </>
                            )}
                        </div>
                        {showRechapter ? (
                            <div style={{ padding: '12px 14px 16px' }}>
                                {chapterRuleBusy && !chapterRuleCandidates.length ? (
                                    <div style={{ padding: 28, textAlign: 'center', color: readerMuted, fontSize: 12 }}>正在扫描分章规则...</div>
                                ) : (
                                    <>
                                        <div style={{ padding: '9px 10px', borderRadius: 8, background: c.primaryBg, color: readerMuted, fontSize: 11, lineHeight: 1.55 }}>
                                            当前规则：
                                            <strong style={{ color: c.primaryDark, marginLeft: 4 }}>
                                                {(currentChapterRule?.family_ids || []).map(id => chapterRuleCandidates.find(candidate => candidate.id === id)?.label || id).join(' + ') || '自动推荐'}
                                            </strong>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 7 }}>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: readerText }}>检测到的规则</span>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: readerMuted, fontSize: 11, cursor: 'pointer' }}>
                                                <input type="checkbox" checked={advancedChapterRules} onChange={event => {
                                                    const advanced = event.target.checked;
                                                    setAdvancedChapterRules(advanced);
                                                    setChapterRulePreview(null);
                                                    if (!advanced) setSelectedChapterFamilies(previous => previous.slice(0, 1));
                                                }} />
                                                组合规则
                                            </label>
                                        </div>
                                        <div style={{ display: 'grid', gap: 7 }}>
                                            {chapterRuleCandidates.map(candidate => {
                                                const selected = selectedChapterFamilies.includes(candidate.id);
                                                const recommended = recommendedChapterFamilies.includes(candidate.id);
                                                return (
                                                    <button key={candidate.id} onClick={() => chooseChapterFamily(candidate.id)} style={{
                                                        width: '100%', border: `1px solid ${selected ? c.primary : readerBorder}`, borderRadius: 8,
                                                        background: selected ? c.primaryBg : '#fff', color: readerText, padding: '9px 10px',
                                                        cursor: 'pointer', textAlign: 'left',
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                                            <span style={{ width: 16, color: selected ? c.primary : '#bbb', fontWeight: 700 }}>{selected ? '✓' : '○'}</span>
                                                            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700 }}>{candidate.label}</span>
                                                            {recommended && <span style={{ fontSize: 9, color: c.primary, border: `1px solid ${c.primaryBorder}`, borderRadius: 5, padding: '1px 4px' }}>推荐</span>}
                                                        </div>
                                                        <div style={{ paddingLeft: 23, marginTop: 4, color: readerMuted, fontSize: 10, lineHeight: 1.5 }}>
                                                            命中 {candidate.match_count} 处 · 平均间距 {candidate.average_gap} 段
                                                            {candidate.preview?.length ? ` · ${candidate.preview.slice(0, 2).map(item => item.title).join(' / ')}` : ''}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div style={{ marginTop: 10, padding: 10, border: `1px solid ${readerBorder}`, borderRadius: 8, background: '#fff' }}>
                                            <button onClick={() => chooseChapterFamily('custom:book')} style={{
                                                width: '100%', display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent',
                                                color: readerText, padding: 0, cursor: 'pointer', textAlign: 'left', fontSize: 12, fontWeight: 700,
                                            }}>
                                                <span style={{ width: 16, color: selectedChapterFamilies.includes('custom:book') ? c.primary : '#bbb' }}>
                                                    {selectedChapterFamilies.includes('custom:book') ? '✓' : '○'}
                                                </span>
                                                本书自定义正则
                                            </button>
                                            <input value={customRuleLabel} onChange={event => { setCustomRuleLabel(event.target.value); setChapterRulePreview(null); }}
                                                placeholder="规则名称" aria-label="本书分章规则名称"
                                                style={{ boxSizing: 'border-box', width: '100%', marginTop: 8, padding: '7px 8px', border: `1px solid ${readerBorder}`, borderRadius: 7, color: readerText, fontSize: 11 }} />
                                            <input value={customRulePattern} onChange={event => { setCustomRulePattern(event.target.value); setChapterRulePreview(null); }}
                                                placeholder="例如 ^第\\s*[0-9一二三]+\\s*章" aria-label="本书分章正则"
                                                style={{ boxSizing: 'border-box', width: '100%', marginTop: 6, padding: '7px 8px', border: `1px solid ${readerBorder}`, borderRadius: 7, color: readerText, fontSize: 11, fontFamily: 'monospace' }} />
                                        </div>
                                        {chapterRuleError && <div style={{ marginTop: 9, color: '#a04f5b', fontSize: 11, lineHeight: 1.5 }}>{chapterRuleError}</div>}
                                        {chapterRulePreview && (
                                            <div style={{ marginTop: 11, borderTop: `1px solid ${readerBorder}`, paddingTop: 10 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                                                    <span style={{ flex: 1, color: readerText, fontSize: 12, fontWeight: 700 }}>预览：{chapterRulePreview.ranges.length} 章</span>
                                                    <span style={{ color: readerMuted, fontSize: 10 }}>应用前不会修改目录</span>
                                                </div>
                                                <div style={{ maxHeight: 150, overflow: 'auto', border: `1px solid ${readerBorder}`, borderRadius: 7 }}>
                                                    {chapterRulePreview.ranges.slice(0, 12).map((chapter, index) => (
                                                        <div key={`${chapter.start_idx}-${index}`} style={{ display: 'flex', gap: 7, padding: '6px 8px', borderBottom: index < Math.min(12, chapterRulePreview.ranges.length) - 1 ? `1px solid ${readerBorder}66` : 'none', fontSize: 10 }}>
                                                            <span style={{ color: readerMuted, flexShrink: 0 }}>{index + 1}.</span>
                                                            <span style={{ color: readerText, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chapter.title}</span>
                                                            <span style={{ color: readerMuted, flexShrink: 0 }}>{chapter.paragraph_count || ((chapter.end_idx ?? chapter.idx) - chapter.idx + 1)} 段</span>
                                                        </div>
                                                    ))}
                                                    {chapterRulePreview.ranges.length > 12 && <div style={{ padding: 7, textAlign: 'center', color: readerMuted, fontSize: 10 }}>另有 {chapterRulePreview.ranges.length - 12} 章</div>}
                                                </div>
                                            </div>
                                        )}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                                            <button onClick={previewChapterRules} disabled={chapterRuleBusy} style={{ minHeight: 38, border: `1px solid ${readerBorder}`, borderRadius: 8, background: '#fff', color: c.primary, cursor: chapterRuleBusy ? 'wait' : 'pointer', fontSize: 12 }}>
                                                {chapterRuleBusy ? '处理中...' : '预览分章'}
                                            </button>
                                            <button onClick={applyChapterRules} disabled={chapterRuleBusy || !chapterRulePreview} style={{ minHeight: 38, border: 'none', borderRadius: 8, background: chapterRulePreview ? c.primary : '#ccc', color: '#fff', cursor: chapterRuleBusy || !chapterRulePreview ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700 }}>
                                                应用分章
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <>
                                <div style={{ position: 'sticky', top: 49, zIndex: 1, padding: '9px 14px', background: 'rgba(255,255,255,0.97)', borderBottom: `1px solid ${c.primaryBorder}88` }}>
                                    <input
                                        value={tocQuery}
                                        onChange={event => {
                                            setTocQuery(event.target.value);
                                            setTocScrollTop(0);
                                            if (tocListRef.current) tocListRef.current.scrollTop = 0;
                                        }}
                                        placeholder="搜索章节号或标题，例如 200"
                                        aria-label="搜索目录章节号或标题"
                                        style={{ boxSizing: 'border-box', width: '100%', padding: '8px 10px', border: `1px solid ${c.primaryBorder}`, borderRadius: 8, background: '#fff', color: readerText, fontSize: 12, outline: 'none' }}
                                    />
                                </div>
                                {(() => {
                                    // 窗口化渲染：几千章全量挂DOM滑动会卡/出空白，只渲染可视区±8行缓冲；
                                    // 固定行高 TOC_ROW_H，用 spacer 撑出总高，行绝对定位
                                    const viewH = tocViewH || 400;
                                    const winStart = Math.max(0, Math.floor(tocScrollTop / TOC_ROW_H) - 8);
                                    const winEnd = Math.min(tocMatches.length, Math.ceil((tocScrollTop + viewH) / TOC_ROW_H) + 8);
                                    const rows = [];
                                    for (let i = winStart; i < winEnd; i++) {
                                        const { chapter: ch, index: chapterIndex } = tocMatches[i];
                                        // 目录页码与底部页码同源：按全书视觉分页表换算（后端章节分页坐标不同义）
                                        const pg = findPageForParaIdx(ch.idx ?? ch.start_idx ?? ch.page);
                                        const chPage = pg >= 0 ? pg + 1 : ch.page;
                                        const isCurrent = chapterIndex === currentChapterIdx;
                                        rows.push(
                                            <button key={chapterIndex} onClick={() => jumpToChapter(ch)} style={{
                                                position: 'absolute', top: i * TOC_ROW_H, left: 0, right: 0, height: TOC_ROW_H,
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                padding: '0 20px', background: isCurrent ? c.primaryBg : 'transparent',
                                                border: 'none', borderBottom: `1px solid ${c.primaryBorder}22`, cursor: 'pointer', textAlign: 'left',
                                            }}>
                                                <span style={{ fontSize: 13, color: isCurrent ? c.primary : '#444', fontWeight: isCurrent ? 600 : 400, flex: 1, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>第 {chapterIndex + 1} 章 · {ch.title}</span>
                                                <span style={{ fontSize: 11, color: '#bbb', marginLeft: 8, flexShrink: 0 }}>p.{chPage}</span>
                                            </button>
                                        );
                                    }
                                    return tocMatches.length
                                        ? <div style={{ position: 'relative', height: tocMatches.length * TOC_ROW_H }}>{rows}</div>
                                        : <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 12, color: readerMuted }}>没有匹配的章节</div>;
                                })()}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudyApp;
