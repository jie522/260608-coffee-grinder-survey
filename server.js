const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// ─── 設定 ───────────────────────────────────────────────
// DATA_DIR 環境變數：雲端部署時設為持久化磁碟路徑（如 /data）
// ADMIN_PASSWORD 環境變數：雲端部署時透過環境變數設定密碼
// PORT 環境變數：Railway / Render 等平台會自動注入
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');

const CONFIG = {
  port: parseInt(process.env.PORT) || 3000,
  adminPassword: process.env.ADMIN_PASSWORD || 'maxclaw',
  dataFile: path.join(dataDir, 'responses.json'),
  questionsFile: path.join(__dirname, 'questions.json'),
};

// ─── 初始化資料目錄 ──────────────────────────────────────
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(CONFIG.dataFile)) fs.writeFileSync(CONFIG.dataFile, '[]', 'utf8');

// ─── 工具函式 ─────────────────────────────────────────────
function readResponses() {
  try { return JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8')); }
  catch { return []; }
}

function saveResponse(data) {
  const responses = readResponses();
  responses.push({ id: crypto.randomUUID(), submittedAt: new Date().toISOString(), ...data });
  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(responses, null, 2), 'utf8');
}

function serveFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ─── CSV 產生器 ───────────────────────────────────────────
function generateCSV(responses) {
  if (responses.length === 0) return 'id,submittedAt\n';

  // 收集所有欄位
  const allKeys = new Set(['id', 'submittedAt']);
  responses.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  const headers = [...allKeys];

  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = [headers.join(',')];
  responses.forEach(r => {
    rows.push(headers.map(h => {
      const v = r[h];
      return escape(Array.isArray(v) ? v.join('|') : typeof v === 'object' && v ? JSON.stringify(v) : v);
    }).join(','));
  });
  return rows.join('\r\n');
}

// ─── 統計計算 ─────────────────────────────────────────────
function computeStats(responses) {
  const questions = JSON.parse(fs.readFileSync(CONFIG.questionsFile, 'utf8'));
  const stats = { total: responses.length, questions: {} };

  questions.sections.forEach(section => {
    section.questions.forEach(q => {
      if (['single', 'multiple'].includes(q.type)) {
        const counts = {};
        q.options.forEach(o => counts[o.text] = 0);
        responses.forEach(r => {
          const ans = r[q.id];
          if (!ans) return;
          const selected = Array.isArray(ans) ? ans : [ans];
          selected.forEach(a => {
            const opt = q.options.find(o => o.id === a);
            if (opt) counts[opt.text] = (counts[opt.text] || 0) + 1;
          });
        });
        stats.questions[q.id] = { type: q.type, text: q.text, counts };
      } else if (q.type === 'likert') {
        const itemStats = {};
        q.items.forEach(item => {
          const vals = responses.map(r => r[item.id]).filter(v => v != null).map(Number);
          itemStats[item.id] = {
            text: item.text,
            avg: vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : null,
            n: vals.length,
          };
        });
        stats.questions[q.id] = { type: 'likert', text: q.text, items: itemStats };
      }
    });
  });
  return stats;
}

// ─── HTTP 路由 ────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ── 靜態頁面 ──
  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(__dirname, 'index.html'), 'text/html');
  }
  if (pathname === '/admin' || pathname === '/admin.html') {
    return serveFile(res, path.join(__dirname, 'admin.html'), 'text/html');
  }
  if (pathname === '/style.css') {
    return serveFile(res, path.join(__dirname, 'style.css'), 'text/css');
  }
  if (pathname === '/admin.css') {
    return serveFile(res, path.join(__dirname, 'admin.css'), 'text/css');
  }

  // ── API：取得題目 ──
  if (pathname === '/api/questions' && req.method === 'GET') {
    return serveFile(res, CONFIG.questionsFile, 'application/json');
  }

  // ── API：提交答案 ──
  if (pathname === '/api/submit' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body || Object.keys(body).length === 0) {
      return jsonResponse(res, { error: '資料為空' }, 400);
    }
    saveResponse(body);
    return jsonResponse(res, { success: true, message: '感謝您的填寫！' });
  }

  // ── API：後台驗證密碼 ──
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const body = await parseBody(req);
    if (body.password === CONFIG.adminPassword) {
      const token = Buffer.from(CONFIG.adminPassword).toString('base64');
      return jsonResponse(res, { success: true, token });
    }
    return jsonResponse(res, { success: false, message: '密碼錯誤' }, 401);
  }

  // ── API：後台統計（需驗證）──
  if (pathname === '/api/admin/stats' && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    const expected = 'Bearer ' + Buffer.from(CONFIG.adminPassword).toString('base64');
    if (auth !== expected) return jsonResponse(res, { error: '未授權' }, 401);
    const responses = readResponses();
    return jsonResponse(res, computeStats(responses));
  }

  // ── API：下載 CSV（需驗證）──
  if (pathname === '/api/admin/export' && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    const expected = 'Bearer ' + Buffer.from(CONFIG.adminPassword).toString('base64');
    if (auth !== expected) return jsonResponse(res, { error: '未授權' }, 401);
    const responses = readResponses();
    const csv = generateCSV(responses);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="survey_${new Date().toISOString().slice(0,10)}.csv"`,
    });
    return res.end('﻿' + csv); // BOM for Excel 中文相容
  }

  // ── API：回覆筆數 ──
  if (pathname === '/api/admin/count' && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    const expected = 'Bearer ' + Buffer.from(CONFIG.adminPassword).toString('base64');
    if (auth !== expected) return jsonResponse(res, { error: '未授權' }, 401);
    const responses = readResponses();
    return jsonResponse(res, { count: responses.length });
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(CONFIG.port, () => {
  console.log(`✅ 問卷伺服器已啟動！`);
  console.log(`📋 問卷填寫：http://localhost:${CONFIG.port}`);
  console.log(`🔐 後台管理：http://localhost:${CONFIG.port}/admin`);
  console.log(`   後台密碼：${CONFIG.adminPassword}`);
});
