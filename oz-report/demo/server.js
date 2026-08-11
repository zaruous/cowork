#!/usr/bin/env node
'use strict';

// 데모 웹앱 (플랜 P4): 업로드 → 레지스트리 → 파라미터 폼 → 렌더.
// 외부 프레임워크 없이 node:http만 사용한다. multipart 대신 파일당 1건의
// raw 업로드(POST /api/reports/import?filename=...)를 받는다.
//
//   node oz-report/demo/server.js [포트] [데이터디렉터리]
//
// API:
//   GET    /api/reports              목록
//   POST   /api/reports/import?filename=x.ozr   (body: 파일 바이트)
//   GET    /api/reports/:id          상세 (파라미터/데이터셋/경고)
//   POST   /api/reports/:id/render   (body: {data, showBindings}) → HTML
//   DELETE /api/reports/:id

const http = require('http');
const fs = require('fs');
const path = require('path');
const { ReportStore, MAX_FILE_BYTES } = require('../src/store');

const ID_RE = /^[\w.\-가-힣]+$/;

function createServer(store) {
  return http.createServer(async (req, res) => {
    try {
      await route(store, req, res);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });
}

async function route(store, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  if (parts[0] !== 'api' || parts[1] !== 'reports') {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  // GET /api/reports
  if (req.method === 'GET' && parts.length === 2) {
    sendJson(res, 200, { reports: store.list() });
    return;
  }

  // POST /api/reports/import?filename=...
  if (req.method === 'POST' && parts[2] === 'import' && parts.length === 3) {
    const fileName = url.searchParams.get('filename');
    if (!fileName) {
      sendJson(res, 400, { error: 'filename 쿼리 파라미터가 필요합니다' });
      return;
    }
    const body = await readBody(req, MAX_FILE_BYTES);
    const summary = store.importFile(fileName, body);
    sendJson(res, 200, { report: summary });
    return;
  }

  // 이하 :id 라우트
  const id = decodeURIComponent(parts[2] || '');
  if (!ID_RE.test(id)) {
    sendJson(res, 400, { error: '유효하지 않은 레포트 id' });
    return;
  }

  if (req.method === 'GET' && parts.length === 3) {
    const entry = store.get(id);
    if (!entry) return sendJson(res, 404, { error: '레포트를 찾을 수 없습니다' });
    sendJson(res, 200, { report: entry, params: store.params(id) });
    return;
  }

  if (req.method === 'POST' && parts[3] === 'render' && parts.length === 4) {
    const body = await readBody(req, MAX_FILE_BYTES);
    const opts = body.length > 0 ? JSON.parse(body.toString('utf8')) : {};
    const { html, layout } = store.render(id, {
      data: opts.data,
      showBindings: opts.showBindings !== false, // 데모 기본: 미해석 바인딩 표시
    });
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'x-oz-warnings': encodeURIComponent(JSON.stringify(layout.warnings)),
    });
    res.end(html);
    return;
  }

  if (req.method === 'DELETE' && parts.length === 3) {
    const ok = store.delete(id);
    sendJson(res, ok ? 200 : 404, ok ? { deleted: id } : { error: '레포트를 찾을 수 없습니다' });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`본문이 너무 큽니다 (> ${limit} 바이트)`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 3465;
  const dataDir = process.argv[3] || path.join(__dirname, 'data');
  const store = new ReportStore(dataDir);
  createServer(store).listen(port, () => {
    console.log(`oz-report 데모: http://localhost:${port} (저장소: ${dataDir})`);
  });
}

module.exports = { createServer };
