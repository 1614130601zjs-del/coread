interface TimelineComment {
    id: number;
    created_at?: string | null;
}

function timelineTimestamp(value?: string | null) {
    const raw = String(value || '').trim();
    if (!raw) return Number.NaN;
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const normalized = hasZone ? raw : `${raw.replace(' ', 'T')}Z`;
    return Date.parse(normalized);
}

export function compareCommentsChronologically(a: TimelineComment, b: TimelineComment) {
    const aTime = timelineTimestamp(a.created_at);
    const bTime = timelineTimestamp(b.created_at);
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1;
    const rawOrder = String(a.created_at || '').localeCompare(String(b.created_at || ''));
    return rawOrder || a.id - b.id;
}

export function sortCommentTimeline<T extends TimelineComment>(comments: readonly T[]) {
    return [...comments].sort(compareCommentsChronologically);
}
