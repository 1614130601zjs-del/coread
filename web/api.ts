const BASE_PATH = ((import.meta as any).env?.BASE_URL || '/').replace(/\/$/, '');
export const API_BASE = `${window.location.origin}${BASE_PATH}`;

// 共读室关门锁 owner key（与 app 端同 key，锁定期彤宝的 web 端照常放行）
const ROOM_OWNER_KEY = 'xk-room-owner-f47ac10b58d2e619a3c4';

async function request(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', 'x-owner-key': ROOM_OWNER_KEY },
    credentials: 'include',
    ...opts,
  });
  if (!res.ok) {
    let data: any = null;
    try { data = await res.json(); } catch {}
    const error = Object.assign(
      new Error(data?.error || data?.message || `${res.status} ${res.statusText}`),
      { status: res.status, data },
    );
    throw error;
  }
  return res.json();
}

export function cloudProgressPage(data: any) {
  const progress = data?.progress;
  const rawPage = typeof progress === 'number' ? progress : progress?.page;
  const page = Number(rawPage);
  return Number.isFinite(page) && page > 0 ? page : 0;
}

export const api = {
  authMe: () => request('/v1/auth/me'),
  login: (password: string) => request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/v1/auth/logout', { method: 'POST' }),
  fetchBooks: (includeDeleted = false) => request(`/v1/books${includeDeleted ? '?deleted=1' : ''}`),
  fetchBookDetail: (bookId: number, page = 1) =>
    request(`/v1/books/${bookId}?page=${page}`),
  fetchBookSlice: (bookId: number, start = 0, count = 30, includeComments = true) =>
    request(`/v1/books/${bookId}/slice?start=${start}&count=${count}&include_comments=${includeComments ? '1' : '0'}`),
  fetchBookCacheState: (bookId: number) =>
    request(`/v1/books/${bookId}/cache-state`),
  fetchBookComments: (bookId: number) =>
    request(`/v1/books/${bookId}/comments`),
  searchBookText: (bookId: number, query: string, scope: 'chapter' | 'book', chapterNo?: number) =>
    request(`/v1/books/${bookId}/search?q=${encodeURIComponent(query)}&scope=${scope}${scope === 'chapter' && chapterNo ? `&chapter_no=${chapterNo}` : ''}`),
  fetchFavoriteComments: () => request('/v1/favorites'),
  addBookComment: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}/comment`, { method: 'POST', body: JSON.stringify(data) }),
  deleteBookComment: (commentId: number) =>
    request(`/v1/books/comment/${commentId}`, { method: 'DELETE' }),
  updateBookComment: (commentId: number, data: any) =>
    request(`/v1/books/comment/${commentId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  updateBookProgress: (bookId: number, page: number) =>
    request(`/v1/books/${bookId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({ page }),
    }),
  createBook: (data: any) =>
    request('/v1/books', { method: 'POST', body: JSON.stringify(data) }),
  updateBook: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  restoreBook: (bookId: number) =>
    request(`/v1/books/${bookId}/restore`, { method: 'POST' }),
  fetchLibraryOptions: () => request('/v1/library/options'),
  addLibraryOption: (type: string, value: string) =>
    request('/v1/library/options', { method: 'POST', body: JSON.stringify({ type, value }) }),
  previewBook: (data: any) =>
    request('/v1/books/preview', { method: 'POST', body: JSON.stringify(data) }),
  fetchChapters: (bookId: number) => request(`/v1/books/${bookId}/chapters`),
  updateChapters: (bookId: number, chapters: any[], chapter_rule?: any) =>
    request(`/v1/books/${bookId}/chapters`, { method: 'PATCH', body: JSON.stringify({ chapters, chapter_rule }) }),
  fetchChapterRules: (bookId: number) =>
    request(`/v1/books/${bookId}/chapter-rules`),
  previewChapterRules: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}/chapter-rules/preview`, { method: 'POST', body: JSON.stringify(data) }),
  fetchSummaries: (bookId: number) => request(`/v1/books/${bookId}/summaries`),
  fetchReadingContexts: (bookId: number) =>
    request(`/v1/books/${bookId}/reading-contexts`),
  saveReadingContext: (bookId: number, data: {
    kind: 'book_prelude' | 'chapter_prelude';
    chapter_no?: number;
    content: string;
  }) => request(`/v1/books/${bookId}/reading-contexts`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  fetchCommentSummaries: (bookId: number) =>
    request(`/v1/books/${bookId}/comment-summaries`),
  updateCommentSummary: (bookId: number, chapterNo: number, data: { content: string; request_key?: string }) =>
    request(`/v1/books/${bookId}/comment-summaries/${chapterNo}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  fetchFacts: (bookId: number) =>
    request(`/v1/books/${bookId}/facts`),
  mutateFact: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}/facts`, { method: 'POST', body: JSON.stringify(data) }),
  updateSummary: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}/summaries`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSummary: (bookId: number, summaryId: number) =>
    request(`/v1/books/${bookId}/summaries/${summaryId}`, { method: 'DELETE' }),
  fetchReadingImpressions: (bookId: number) =>
    request(`/v1/books/${bookId}/reading-impressions`),
  generateStoryMaterial: (bookId: number, data: { kind: 'block' | 'reading_impression'; chapter_start: number; chapter_end: number }) =>
    request(`/v1/books/${bookId}/summaries/generate`, { method: 'POST', body: JSON.stringify(data) }),
  addReadingImpression: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}/reading-impressions`, { method: 'POST', body: JSON.stringify(data) }),
  deleteReadingImpression: (bookId: number, impressionId: number) =>
    request(`/v1/books/${bookId}/reading-impressions/${impressionId}`, { method: 'DELETE' }),
  fetchReviewContext: (bookId: number, mode: 'fine' | 'layered') =>
    request(`/v1/books/${bookId}/review-context?mode=${mode}`),
  previewReadingTask: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}/tasks/preview`, { method: 'POST', body: JSON.stringify(data) }),
  createReadingTask: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  fetchReadingTasks: (bookId: number) =>
    request(`/v1/books/${bookId}/tasks`),
  fetchTask: (taskId: number) => request(`/v1/tasks/${taskId}`),
  updateTask: (taskId: number, data: { action: 'pause' | 'cancel' | 'resume' | 'retry_current' | 'skip_current' }) =>
    request(`/v1/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  respondToComment: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}/comment/respond`, { method: 'POST', body: JSON.stringify(data) }),
  fetchChapterChat: (bookId: number, chapterNo: number) =>
    request(`/v1/books/${bookId}/chapter-chat?chapter_no=${chapterNo}`),
  sendChapterChat: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}/chapter-chat`, { method: 'POST', body: JSON.stringify(data) }),
  deleteBook: (bookId: number) =>
    request(`/v1/books/${bookId}`, { method: 'DELETE' }),
  permanentlyDeleteBook: (bookId: number) =>
    request(`/v1/books/${bookId}/permanent`, { method: 'DELETE' }),
  fetchBackups: () => request('/v1/backups'),
  createBackup: () => request('/v1/backups', { method: 'POST' }),
  preflightRestore: (backupId: string) =>
    request(`/v1/backups/${backupId}/preflight`, { method: 'POST' }),
  restoreBackup: (backupId: string, confirmationToken: string) =>
    request(`/v1/backups/${backupId}/restore`, { method: 'POST', body: JSON.stringify({ confirmation_token: confirmationToken }) }),
  fetchBookToc: (bookId: number) =>
    request(`/v1/books/${bookId}/toc`),
  exportBook: async (bookId: number, format = 'epub') => {
    const res = await fetch(`${API_BASE}/v1/books/${bookId}/export?format=${format}`, { credentials: 'include', headers: { 'x-owner-key': ROOM_OWNER_KEY } });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
  imageUrl: (bookId: number, filename: string) =>
    `${API_BASE}/v1/book-images/${bookId}/${filename}`,
  deleteLibraryOption: (type: 'category' | 'tag', value: string) =>
    request('/v1/library/options', { method: 'DELETE', body: JSON.stringify({ type, value }) }),
  wishlistUrl: () => `${API_BASE}/v1/reading-wishlist`,
};
