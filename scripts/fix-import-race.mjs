import fs from 'fs';

const file = 'web/StudyApp.tsx';
let source = fs.readFileSync(file, 'utf8');

const old = `                setParagraphsFullyLoaded(true);\n                setAllParas(filtered);\n                savedParaIdxRef.current = recoveredParagraphIdx;\n                // 有内容时loading由分页effect跳页完成后关闭——这里提前关会先露出第1页再跳（闪烁）\n                if (filtered.length === 0) setReadingLoading(false);`;

const replacement = `                // 书籍切换期间旧请求可能晚于新请求返回。旧书的数据绝不能写入当前阅读器。\n                if (openingBookIdRef.current !== book.id) return;\n                setParagraphsFullyLoaded(true);\n                setAllParas(filtered);\n                savedParaIdxRef.current = recoveredParagraphIdx;\n                // 有内容时loading由分页effect跳页完成后关闭——这里提前关会先露出第1页再跳（闪烁）\n                if (filtered.length === 0) setReadingLoading(false);`;

if (!source.includes(old)) {
  throw new Error('import race patch target not found');
}
source = source.replace(old, replacement);

const oldCatch = `        } catch (e: any) { toast(\`加载失败: \${e.message}\`); setReadingLoading(false); }\n    };`;
const replacementCatch = `        } catch (e: any) {\n            if (openingBookIdRef.current !== book.id) return;\n            toast(\`加载失败: \${e.message}\`);\n            setReadingLoading(false);\n        }\n    };`;
if (!source.includes(oldCatch)) {
  throw new Error('import race catch target not found');
}
source = source.replace(oldCatch, replacementCatch);

fs.writeFileSync(file, source);
console.log('Applied stale book import response guard.');
