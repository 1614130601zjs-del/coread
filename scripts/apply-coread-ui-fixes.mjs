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

// Remove the old decorative alternating book-cover palette so books without a real cover
// use a neutral placeholder instead of the legacy faux-cover treatment.
if (s.includes('const BOOK_COVERS = [')) {
  s = s.replace(/\nconst BOOK_COVERS = \[[\s\S]*?\n\];\n/, '\n');
  changed = true;
}
s = s.replace("style={{ background: BOOK_COVERS[i % BOOK_COVERS.length] }}", "style={{ background: '#fff' }}");

// Global font state and persistence.
replaceOnce(
  "    const [newOptionValue, setNewOptionValue] = useState('');",
  `    const [newOptionValue, setNewOptionValue] = useState('');
    const [globalFont, setGlobalFont] = useState(() => {
        try { return localStorage.getItem('coread-global-font') || ''; } catch { return ''; }
    });
    const [globalFontUrl, setGlobalFontUrl] = useState('');`,
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
            const family = 'CoreadGlobalFont';
            style.textContent = '@font-face{font-family:"' + family + '";src:url("' + String(data.src).replace(/"/g, '\\\\"') + '") format("' + String(data.format || 'truetype').replace(/"/g, '\\\\"') + '");font-display:swap;} .xiaowo-study,.xiaowo-study *{font-family:"' + family + '",sans-serif !important;}';
        } catch {
            style.textContent = '';
        }
    }, [globalFont]);`,
  'global font effect'
);

// Add a visible cover-import control in the book editor. The existing upload API is reused.
const coverAnchor = /(<label style=\{\{ display: 'block', fontSize: 11, color: '#888', marginBottom: 5 \}\}>封面<\\\/label>[\s\S]*?<input type="file" accept="image\/\*"[\s\S]*?<\\\/div>)/;
if (!s.includes('导入封面')) {
  const m = s.match(coverAnchor);
  if (!m) throw new Error('UI patch anchor not found: cover editor');
  const block = m[1];
  const patched = block.replace(
    '<label style={{ display: \'block\', fontSize: 11, color: \'#888\', marginBottom: 5 }}>封面</label>',
    '<label style={{ display: \'block\', fontSize: 11, color: \'#888\', marginBottom: 5 }}>封面</label>'
  );
  s = s.replace(block, patched.replace(/<input type="file" accept="image\/\*"/,
    '<button type="button" onClick={() => document.getElementById(\'coread-cover-file\')?.click()} style={{ padding: \'7px 10px\', border: `1px solid ${c.primaryBorder}`, borderRadius: 7, background: c.primaryBg, color: c.primaryDark, fontSize: 12, cursor: \'pointer\', marginBottom: 8 }}>导入封面</button>\\n                            <input id="coread-cover-file" type="file" accept="image/*"'
  ));
  changed = true;
}

// Add category deletion beside the existing category selector.
if (!s.includes('删除分类')) {
  const selectNeedle = `                        <select value={editBookCategory} onChange={e => setEditBookCategory(e.target.value)}\n                            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: \`1px solid ${c.primaryBorder}\`, borderRadius: 8, fontSize: 13, marginBottom: 14, background: '#fff' }}>\n                            {libraryCategories.map(category => <option key={category} value={category}>{category}</option>} )}\n                        </select>`;
  if (!s.includes(selectNeedle)) {
    const alt = `                        <select value={editBookCategory} onChange={e => setEditBookCategory(e.target.value)}\n                            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: \`1px solid ${c.primaryBorder}\`, borderRadius: 8, fontSize: 13, marginBottom: 14, background: '#fff' }}>\n                            {libraryCategories.map(category => <option key={category} value={category}>{category}</option>)}\n                        </select>`;
    if (!s.includes(alt)) throw new Error('UI patch anchor not found: category selector');
    const replacement = alt + `\n                        <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: -8, marginBottom: 14 }}>\n                            <button type="button" onClick={async () => {\n                                const value = editBookCategory.trim();\n                                if (!value) return;\n                                if (!window.confirm('删除分类「' + value + '」？不会删除书籍。')) return;\n                                try {\n                                    await api.deleteLibraryOption('category', value);\n                                    setLibraryCategories(prev => prev.filter(item => item !== value));\n                                    setEditBookCategory(prev => { const next = libraryCategories.filter(item => item !== value); return next[0] || '待看'; });\n                                } catch (error) { window.alert(error instanceof Error ? error.message : '删除分类失败'); }\n                            }} style={{ padding: '6px 9px', border: '1px solid #c66', borderRadius: 7, background: '#fff', color: '#a33', fontSize: 11, cursor: 'pointer' }}>删除分类</button>\n                            <span style={{ fontSize: 10, color: '#999' }}>只删除分类选项，不删除书籍</span>\n                        </div>`;
    s = s.replace(alt, replacement);
    changed = true;
  }
}

// Global font controls in the existing 主题 / 背景 panel.
if (!s.includes('全局字体')) {
  const heading = `                                <div style={{ fontSize: 13, fontWeight: 700, color: readerText, marginBottom: 10 }}>背景与主题</div>`;
  if (!s.includes(heading)) throw new Error('UI patch anchor not found: appearance panel');
  const fontPanel = `${heading}\n                                <div style={{ padding: '10px', marginBottom: 14, border: \`1px solid ${readerBorder}\`, borderRadius: 8, background: readerSurface }}>\n                                    <div style={{ fontSize: 12, fontWeight: 700, color: readerText, marginBottom: 7 }}>全局字体</div>\n                                    <div style={{ fontSize: 10, color: readerMuted, marginBottom: 8 }}>支持字体文件或直链；应用于整个阅读界面。</div>\n                                    <div style={{ display: 'flex', gap: 7, marginBottom: 7 }}>\n                                        <input value={globalFontUrl} onChange={e => setGlobalFontUrl(e.target.value)} placeholder="字体文件链接（https://…）" style={{ flex: 1, minWidth: 0, padding: '7px 8px', border: \`1px solid ${readerBorder}\`, borderRadius: 6, background: readerSurface, color: readerText, fontSize: 11 }} />\n                                        <button type="button" onClick={() => { const url = globalFontUrl.trim(); if (!/^https?:\\/\\//i.test(url)) { window.alert('请输入 http/https 字体文件直链'); return; } const payload = JSON.stringify({ src: url, format: 'truetype' }); setGlobalFont(payload); localStorage.setItem('coread-global-font', payload); }} style={{ padding: '7px 9px', border: \`1px solid ${readerBorder}\`, borderRadius: 6, background: readerSurface, color: readerText, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>使用链接</button>\n                                    </div>\n                                    <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>\n                                        <input id="coread-global-font-file" type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const src = String(reader.result || ''); const format = file.name.toLowerCase().endsWith('.woff2') ? 'woff2' : file.name.toLowerCase().endsWith('.woff') ? 'woff' : file.name.toLowerCase().endsWith('.otf') ? 'opentype' : 'truetype'; const payload = JSON.stringify({ src, format }); setGlobalFont(payload); localStorage.setItem('coread-global-font', payload); }; reader.readAsDataURL(file); }} />\n                                        <button type="button" onClick={() => document.getElementById('coread-global-font-file')?.click()} style={{ padding: '7px 9px', border: \`1px solid ${readerBorder}\`, borderRadius: 6, background: readerSurface, color: readerText, fontSize: 11, cursor: 'pointer' }}>上传字体文件</button>\n                                        {globalFont && <button type="button" onClick={() => { setGlobalFont(''); setGlobalFontUrl(''); localStorage.removeItem('coread-global-font'); }} style={{ padding: '7px 9px', border: \`1px solid ${readerBorder}\`, borderRadius: 6, background: readerSurface, color: readerMuted, fontSize: 11, cursor: 'pointer' }}>恢复默认</button>}\n                                    </div>\n                                </div>`;
  s = s.replace(heading, fontPanel);
  changed = true;
}

if (!changed) throw new Error('No Coread UI changes were applied');
fs.writeFileSync(path, s);
console.log('Applied Coread UI controls: cover import, category deletion, global font, legacy faux-cover removal');
