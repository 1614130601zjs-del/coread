import fs from 'node:fs';

const path = 'web/StudyApp.tsx';
let s = fs.readFileSync(path, 'utf8');
const before = s;

// The original font UI used a generated <style>@import rule and required the
// user to know the CSS font-family. Use a real stylesheet link for CSS URLs,
// and infer the known Huiwen Mincho family names when the family field is blank.
const effectRe = /    useEffect\(\(\) => \{\n        const id = 'coread-global-font-style';[\s\S]*?    \}, \[globalFont\]\);/;
const effect = `    useEffect(() => {
        const styleId = 'coread-global-font-style';
        const linkId = 'coread-global-font-css';
        document.getElementById(linkId)?.remove();
        let style = document.getElementById(styleId) as HTMLStyleElement | null;
        if (!style) { style = document.createElement('style'); style.id = styleId; document.head.appendChild(style); }
        style.textContent = '';
        if (!globalFont) return;
        try {
            const data = JSON.parse(globalFont);
            const family = String(data.family || 'CoreadGlobalFont');
            const source = String(data.src || '');
            if (!source) return;
            if (data.kind === 'css') {
                const link = document.createElement('link');
                link.id = linkId;
                link.rel = 'stylesheet';
                link.href = source;
                document.head.appendChild(link);
                style.textContent = '.xiaowo-study,.xiaowo-study *{font-family:"' + family.replace(/["\\\\]/g, '') + '",sans-serif !important;}';
            } else {
                const format = String(data.format || 'truetype');
                style.textContent = '@font-face{font-family:"' + family.replace(/["\\\\]/g, '') + '";src:url("' + source + '") format("' + format + '");font-display:swap;} .xiaowo-study,.xiaowo-study *{font-family:"' + family.replace(/["\\\\]/g, '') + '",sans-serif !important;}';
            }
        } catch { style.textContent = ''; }
        return () => document.getElementById(linkId)?.remove();
    }, [globalFont]);`;
if (effectRe.test(s)) s = s.replace(effectRe, effect);

// Infer font-family for official ZeoSeven Huiwen Mincho CSS URLs when the user
// leaves the family field blank. Also recognize the jsDelivr GBK stylesheet.
s = s.replace(
  "const family = globalFontFamily.trim() || 'CoreadGlobalFont';",
  "const family = globalFontFamily.trim() || (/\\/256\\//.test(url) ? 'Huiwen-mincho' : /\\/437\\//.test(url) || /HuiwenMinchoGBK/i.test(url) ? 'Huiwen-MinchoGBK' : 'CoreadGlobalFont');"
);

if (s !== before) fs.writeFileSync(path, s);
console.log(s !== before ? 'Applied robust remote font CSS loading and Huiwen family detection' : 'Remote font patch already present');
