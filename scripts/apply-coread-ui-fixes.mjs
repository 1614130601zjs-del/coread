import fs from 'node:fs';

const path = 'web/StudyApp.tsx';
let s = fs.readFileSync(path, 'utf8');
let changed = false;
const replaceOnce = (needle, replacement, label) => {
  if (s.includes(replacement)) return;
  if (!s.includes(needle)) throw new Error(`UI patch anchor not found: ${label}`);
  s = s.replace(needle, replacement);
  changed = true;
};

if (s.includes('const BOOK_COVERS = [')) {
  s = s.replace(/\nconst BOOK_COVERS = \[[\s\S]*?\n\];\n/, '\n');
  changed = true;
}
s = s.replace("style={{ background: BOOK_COVERS[i % BOOK_COVERS.length] }}", "style={{ background: '#fff' }}");

replaceOnce(
  "    const [newOptionValue, setNewOptionValue] = useState('');",
  `    const [newOptionValue, setNewOptionValue] = useState('');
    const [globalFont, setGlobalFont] = useState(() => {
        try { return localStorage.getItem('coread-global-font') || ''; } catch { return ''; }
    });
    const [globalFontUrl, setGlobalFontUrl] = useState('');
    const [globalFontFamily, setGlobalFontFamily] = useState('');`,
  'global font state'
);

replaceOnce(
  "    const [showBar, setShowBar] = useState(false);",
  `    const [showBar, setShowBar] = useState(false);

    useEffect(() => {
        const id = 'coread-global-font-style';
        let style = document.getElementById(id);
        if (!style) { style = document.createElement('style'); style.id = id; document.head.appendChild(style); }
        if (!globalFont) { style.textContent = ''; return; }
        try {
            const data = JSON.parse(globalFont);
            const family = String(data.family || 'CoreadGlobalFont').replace(/["\\]/g, '');
            const source = String(data.src || '').replace(/["\\]/g, '');
            if (data.kind === 'css') {
                style.textContent = '@import url("' + source + '"); .xiaowo-study,.xiaowo-study *{font-family:"' + family + '",sans-serif !important;}';
            } else {
                style.textContent = '@font-face{font-family:"' + family + '";src:url("' + source + '") format("' + String(data.format || 'truetype').replace(/["\\]/g, '') + '");font-display:swap;} .xiaowo-study,.xiaowo-study *{font-family:"' + family + '",sans-serif !important;}';
            }
        } catch { style.textContent = ''; }
    }, [globalFont]);`,
  'global font effect'
);

// The canonical editor already has working cover upload state/API. No duplicate JSX is injected.

if (!s.includes('删除分类')) {
  const alt = `                        <select value={editBookCategory} onChange={e => setEditBookCategory(e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: \`1px solid \${c.primaryBorder}\`, borderRadius: 8, fontSize: 13, marginBottom: 14, background: '#fff' }}>
                            {libraryCategories.map(category => <option key={category} value={category}>{category}</option>)}
                        </select>`;
  if (!s.includes(alt)) throw new Error('UI patch anchor not found: category selector');
  const replacement = alt + `
                        <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: -8, marginBottom: 14 }}>
                            <button type="button" onClick={async () => {
                                const value = editBookCategory.trim();
                                if (!value) return;
                                if (!window.confirm('删除分类「' + value + '」？不会删除书籍。')) return;
                                try {
                                    await api.deleteLibraryOption('category', value);
                                    setLibraryCategories(prev => prev.filter(item => item !== value));
                                    setEditBookCategory(prev => { const next = libraryCategories.filter(item => item !== value); return next[0] || '待看'; });
                                } catch (error) { window.alert(error instanceof Error ? error.message : '删除分类失败'); }
                            }} style={{ padding: '6px 9px', border: '1px solid #c66', borderRadius: 7, background: '#fff', color: '#a33', fontSize: 11, cursor: 'pointer' }}>删除分类</button>
                            <span style={{ fontSize: 10, color: '#999' }}>只删除分类选项，不删除书籍</span>
                        </div>`;
  s = s.replace(alt, replacement);
  changed = true;
}

if (!s.includes('全局字体')) {
  const heading = `                                <div style={{ fontSize: 13, fontWeight: 700, color: readerText, marginBottom: 10 }}>背景与主题</div>`;
  if (!s.includes(heading)) throw new Error('UI patch anchor not found: appearance panel');
  const fontPanel = `${heading}
                                <div style={{ padding: '10px', marginBottom: 14, border: \`1px solid \${readerBorder}\`, borderRadius: 8, background: readerSurface }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: readerText, marginBottom: 7 }}>全局字体</div>
                                    <div style={{ fontSize: 10, color: readerMuted, marginBottom: 8 }}>支持字体文件、字体文件直链或 CSS 字体 URL。CSS URL 需要填写 CSS 中的 font-family。</div>
                                    <div style={{ display: 'flex', gap: 7, marginBottom: 7 }}>
                                        <input value={globalFontUrl} onChange={e => setGlobalFontUrl(e.target.value)} placeholder="字体文件 / CSS 链接（https://…）" style={{ flex: 1, minWidth: 0, padding: '7px 8px', border: \`1px solid \${readerBorder}\`, borderRadius: 6, background: readerSurface, color: readerText, fontSize: 11 }} />
                                        <button type="button" onClick={() => { const url = globalFontUrl.trim(); if (!/^https?:\\/\\//i.test(url)) { window.alert('请输入 http/https 字体或 CSS 直链'); return; } const isCss = /\\.css(?:[?#].*)?$/i.test(url); const family = globalFontFamily.trim() || 'CoreadGlobalFont'; const payload = JSON.stringify({ src: url, kind: isCss ? 'css' : 'font', family, format: 'truetype' }); setGlobalFont(payload); localStorage.setItem('coread-global-font', payload); }} style={{ padding: '7px 9px', border: \`1px solid \${readerBorder}\`, borderRadius: 6, background: readerSurface, color: readerText, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>使用链接</button>
                                    </div>
                                    <input value={globalFontFamily} onChange={e => setGlobalFontFamily(e.target.value)} placeholder="CSS 字体名（例如 Huiwen-mincho；字体文件可留空）" style={{ width: '100%', boxSizing: 'border-box', padding: '7px 8px', border: \`1px solid \${readerBorder}\`, borderRadius: 6, background: readerSurface, color: readerText, fontSize: 11, marginBottom: 7 }} />
                                    <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                                        <input id="coread-global-font-file" type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const src = String(reader.result || ''); const format = file.name.toLowerCase().endsWith('.woff2') ? 'woff2' : file.name.toLowerCase().endsWith('.woff') ? 'woff' : file.name.toLowerCase().endsWith('.otf') ? 'opentype' : 'truetype'; const payload = JSON.stringify({ src, kind: 'font', family: globalFontFamily.trim() || 'CoreadGlobalFont', format }); setGlobalFont(payload); localStorage.setItem('coread-global-font', payload); }; reader.readAsDataURL(file); }} />
                                        <button type="button" onClick={() => document.getElementById('coread-global-font-file')?.click()} style={{ padding: '7px 9px', border: \`1px solid \${readerBorder}\`, borderRadius: 6, background: readerSurface, color: readerText, fontSize: 11, cursor: 'pointer' }}>上传字体文件</button>
                                        {globalFont && <button type="button" onClick={() => { setGlobalFont(''); setGlobalFontUrl(''); setGlobalFontFamily(''); localStorage.removeItem('coread-global-font'); }} style={{ padding: '7px 9px', border: \`1px solid \${readerBorder}\`, borderRadius: 6, background: readerSurface, color: readerMuted, fontSize: 11, cursor: 'pointer' }}>恢复默认</button>}
                                    </div>
                                </div>`;
  s = s.replace(heading, fontPanel);
  changed = true;
}

if (!changed) throw new Error('No Coread UI changes were applied');
fs.writeFileSync(path, s);
console.log('Applied Coread UI controls: category deletion, global font with font/CSS URL support, legacy faux-cover removal');
