'use strict';

// 데모 서버 E2E (플랜 P4 완료 기준: 업로드 → 목록 → 렌더)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ReportStore } = require('../src/store');
const { createServer } = require('../demo/server');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name));

async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oz-srv-'));
  const server = createServer(new ReportStore(dir));
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return base;
}

test('E2E: 업로드 → 목록 → 상세 → 렌더 → 삭제', async (t) => {
  const base = await startServer(t);

  // 업로드 (ozr + odi)
  for (const name of ['MESDEV_CCA.ozr', 'MESDEV_CCA.odi']) {
    const res = await fetch(`${base}/api/reports/import?filename=${name}`, {
      method: 'POST',
      body: read(name),
    });
    assert.equal(res.status, 200, name);
  }

  // 목록
  const list = await (await fetch(`${base}/api/reports`)).json();
  assert.equal(list.reports.length, 1);
  assert.equal(list.reports[0].status, 'ready');
  assert.deepEqual(list.reports[0].matchWarnings, []);

  // 상세 + 파라미터
  const detail = await (await fetch(`${base}/api/reports/MESDEV_CCA`)).json();
  assert.equal(detail.params.length, 3);
  assert.equal(detail.report.odi.datasets.length, 2);

  // 렌더 (데이터 주입)
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'MESDEV_CCA.data.json'), 'utf8'));
  const renderRes = await fetch(`${base}/api/reports/MESDEV_CCA/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  assert.equal(renderRes.status, 200);
  const html = await renderRes.text();
  assert.match(html, /Controller Case Assembly/);
  assert.match(html, /볼트 토크 확인/);

  // 삭제
  const del = await fetch(`${base}/api/reports/MESDEV_CCA`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const after = await (await fetch(`${base}/api/reports`)).json();
  assert.equal(after.reports.length, 0);
});

test('잘못된 업로드는 400과 오류 메시지를 준다', async (t) => {
  const base = await startServer(t);

  const noName = await fetch(`${base}/api/reports/import`, { method: 'POST', body: 'x' });
  assert.equal(noName.status, 400);

  const badFile = await fetch(`${base}/api/reports/import?filename=x.ozr`, {
    method: 'POST',
    body: 'PNG 이건 OZ 파일이 아님',
  });
  assert.equal(badFile.status, 400);
  assert.match((await badFile.json()).error, /매직 바이트/);
});

test('없는 레포트 접근은 404, 이상한 id는 400', async (t) => {
  const base = await startServer(t);
  assert.equal((await fetch(`${base}/api/reports/NOPE`)).status, 404);
  assert.equal((await fetch(`${base}/api/reports/${encodeURIComponent('../x')}`)).status, 400);
});

test('데모 첫 페이지가 열린다', async (t) => {
  const base = await startServer(t);
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /OZ Report 임포트 데모/);
});
