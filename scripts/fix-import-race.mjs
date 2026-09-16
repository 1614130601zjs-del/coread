import fs from 'fs';

const file = 'web/StudyApp.tsx';
let source = fs.readFileSync(file, 'utf8');

// Every open operation gets its own generation token. A book id check alone is
// not sufficient when the same book is opened again while an older request is
// still in flight (or when an import/reload races with a reopen).
const refNeedle = `    const openingBookIdRef = useRef<number | null>(null);`;
const refReplacement = `    const openingBookIdRef = useRef<number | null>(null);\n    const openingBookSessionRef = useRef(0);`;
if (!source.includes('const openingBookSessionRef = useRef(0);')) {
  if (!source.includes(refNeedle)) throw new Error('opening book ref target not found');
  source = source.replace(refNeedle, refReplacement);
}

const openNeedle = `    const openBook = async (book: Book) => {\n        const openedAt = rememberBookLastOpened(book.id);`;
const openReplacement = `    const openBook = async (book: Book) => {\n        const bookSession = ++openingBookSessionRef.current;\n        const isCurrentBookOpen = () =>\n            openingBookSessionRef.current === bookSession && openingBookIdRef.current === book.id;\n        const openedAt = rememberBookLastOpened(book.id);`;
if (!source.includes('const bookSession = ++openingBookSessionRef.current;')) {
  if (!source.includes(openNeedle)) throw new Error('openBook start target not found');
  source = source.replace(openNeedle, openReplacement);
}

// The current open operation is established before any async cache/network read.
const sessionBookIdNeedle = `        openingBookIdRef.current = book.id;\n        paragraphCacheBookRef.current = book.id;`;
const sessionBookIdReplacement = `        openingBookIdRef.current = book.id;\n        paragraphCacheBookRef.current = book.id;`;
if (!source.includes(sessionBookIdNeedle)) throw new Error('openBook session setup target not found');
source = source.replace(sessionBookIdNeedle, sessionBookIdReplacement);

// Cached comments: do not let a previous open write comments into the new book.
source = source.replace(
`                if (openingBookIdRef.current !== book.id) return true;`,
`                if (!isCurrentBookOpen()) return true;`,
);

// TOC: guard after every await, not only at the final state write.
source = source.replace(
`            const cachedToc = await idbGetParas(tocCacheKey(book.id));\n            const parsedToc`,
`            const cachedToc = await idbGetParas(tocCacheKey(book.id));\n            if (!isCurrentBookOpen()) return;\n            const parsedToc`,
);
source = source.replace(
`                const remoteToc = await api.fetchBookToc(book.id);\n                normalizedToc`,
`                const remoteToc = await api.fetchBookToc(book.id);\n                if (!isCurrentBookOpen()) return;\n                normalizedToc`,
);
source = source.replace(
`            if (openingBookIdRef.current === book.id) setTocChapters(normalizedToc);`,
`            if (!isCurrentBookOpen()) return;\n            setTocChapters(normalizedToc);`,
);

// Paragraph manifest / migration: every asynchronous boundary must belong to
// the same open generation before it can affect the reader.
source = source.replace(
`            const cachedManifest = await idbGetParas(paragraphManifestCacheKey(book.id));\n            const parsedManifest`,
`            const cachedManifest = await idbGetParas(paragraphManifestCacheKey(book.id));\n            if (!isCurrentBookOpen()) return;\n            const parsedManifest`,
);
source = source.replace(
`                const legacyCached = await idbGetParas(legacyParaCacheKey);\n                const parsedLegacy`,
`                const legacyCached = await idbGetParas(legacyParaCacheKey);\n                if (!isCurrentBookOpen()) return;\n                const parsedLegacy`,
);
source = source.replace(
`                    manifest = await writeChunkedParagraphCache(\n                        book.id,`,
`                    manifest = await writeChunkedParagraphCache(\n                        book.id,`,
);
source = source.replace(
`                    );\n                    if (manifest) {\n                        await idbDelParas(legacyParaCacheKey);`,
`                    );\n                    if (!isCurrentBookOpen()) return;\n                    if (manifest) {\n                        await idbDelParas(legacyParaCacheKey);\n                        if (!isCurrentBookOpen()) return;`,
1,
);
source = source.replace(
`            if (openingBookIdRef.current !== book.id) return;`,
`            if (!isCurrentBookOpen()) return;`,
);
source = source.replace(
`                if (await loadParagraphWindow(book.id, manifest, sourceIndex)) {\n                    paragraphsHit`,
`                if (await loadParagraphWindow(book.id, manifest, sourceIndex)) {\n                    if (!isCurrentBookOpen()) return;\n                    paragraphsHit`,
);

// The uncached body fetch is the critical race. Check after each network
// chunk, before installing the body, and again after writing the local cache.
source = source.replace(
`                    const d = await api.fetchBookSlice(book.id, start, PARA_FETCH_CHUNK, false);\n                    const slice`,
`                    const d = await api.fetchBookSlice(book.id, start, PARA_FETCH_CHUNK, false);\n                    if (!isCurrentBookOpen()) return;\n                    const slice`,
);
source = source.replace(
`                setParagraphsFullyLoaded(true);\n                setAllParas(filtered);`,
`                if (!isCurrentBookOpen()) return;\n                setParagraphsFullyLoaded(true);\n                setAllParas(filtered);`,
);
source = source.replace(
`                const freshManifest = await writeChunkedParagraphCache(\n                    book.id,`,
`                const freshManifest = await writeChunkedParagraphCache(\n                    book.id,`,
);
source = source.replace(
`                );\n                if (freshManifest && openingBookIdRef.current === book.id) {\n                    setParagraphCacheManifest`,
`                );\n                if (!isCurrentBookOpen()) return;\n                if (freshManifest) {\n                    setParagraphCacheManifest`,
1,
);

// Comments can also finish after a newer book has opened.
source = source.replace(
`            const payload = await commentsRequest;\n            if (payload) {`,
`            const payload = await commentsRequest;\n            if (!isCurrentBookOpen()) return;\n            if (payload) {`,
);
source = source.replace(
`        } catch (e: any) { toast(\`加载失败: \${e.message}\`); setReadingLoading(false); }`,
`        } catch (e: any) {\n            if (!isCurrentBookOpen()) return;\n            toast(\`加载失败: \${e.message}\`);\n            setReadingLoading(false);\n        }`,
);

fs.writeFileSync(file, source);
console.log('Applied book-open session isolation guards.');
