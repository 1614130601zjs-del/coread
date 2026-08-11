import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const BUCKET_NAME = 'data';
const DB_FILE = 'data/coread.db';  // 匹配 server.mjs 中的路径
const LOCAL_DB_PATH = path.join(process.cwd(), DB_FILE);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn(' 缺少 Supabase 环境变量，将跳过云端同步（仅本地运行）');
}

const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

export async function downloadDB() {
  if (!supabase) return false;
  try {
    // 确保 data 目录存在
    const dir = path.dirname(LOCAL_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(DB_FILE);

    if (error) {
      if (error.statusCode === '404') {
        console.log(' 云端无数据库，将创建新库');
        return false;
      }
      throw error;
    }

    const buffer = await data.arrayBuffer();
    fs.writeFileSync(LOCAL_DB_PATH, Buffer.from(buffer));
    console.log(' 数据库已从 Supabase 下载 (大小: ' + (Buffer.from(buffer).length / 1024).toFixed(2) + ' KB)');
    return true;
  } catch (err) {
    console.error(' 下载失败:', err.message);
    return false;
  }
}

export async function uploadDB() {
  if (!supabase) return;
  try {
    if (!fs.existsSync(LOCAL_DB_PATH)) {
      console.log(' 本地数据库不存在，跳过上传');
      return;
    }

    const fileBuffer = fs.readFileSync(LOCAL_DB_PATH);
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(DB_FILE, fileBuffer, {
        upsert: true,
        contentType: 'application/x-sqlite3',
      });

    if (error) throw error;
    console.log(' 数据库已同步到 Supabase (' + (fileBuffer.length / 1024).toFixed(2) + ' KB)');
  } catch (err) {
    console.error(' 上传失败:', err.message);
  }
}

export async function initDB() {
  const exists = await downloadDB();
  if (!exists) {
    // 如果本地也没有，创建一个空文件让服务初始化
    if (!fs.existsSync(LOCAL_DB_PATH)) {
      const dir = path.dirname(LOCAL_DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(LOCAL_DB_PATH, '');
      console.log(' 创建空数据库文件');
    }
    await uploadDB();
  }
}
