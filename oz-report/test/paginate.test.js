'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseOzr } = require('../src/ozr/parser');
const { buildPagedLayout } = require('../src/render/paginate');
const { renderOzrToHtml } = require('../src/render/html');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name));
const readData = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 0.01, `${msg}: ${actual} ≈ ${expected}`);
}

function makeCcaRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    INSP_GROUP: `그룹${Math.floor(i / 10) + 1}`,
    INSP_NAME: `항목 ${i + 1}`,
    INSP_SPEC: '기준',
    INSP_RESULT: '■OK □NG',
  }));
}

const CCA_STRIDE = 14.74;

test('CCA 6행: REPEATNUM=38 채움으로 한 페이지가 빈 괘선 행까지 38행', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  const layout = buildPagedLayout(model, { data: readData('MESDEV_CCA.data.json') });

  assert.equal(layout.pageCount, 1);
  const nameCells = layout.pages[0].elements.filter((e) => e.binding?.colName === 'INSP_NAME');
  assert.equal(nameCells.length, 38); // 6 데이터 + 32 빈 채움
  assert.equal(nameCells.filter((e) => e.value !== null).length, 6);
  assert.equal(nameCells.filter((e) => e.value === null).length, 32);
});

test('CCA 80행: 페이지 3장, 페이지당 REPEATNUM 상한', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  const data = { SQL_HEADER: readData('MESDEV_CCA.data.json').SQL_HEADER, SQL_DATA: makeCcaRows(80) };
  const layout = buildPagedLayout(model, { data });

  assert.equal(layout.pageCount, 3); // ceil(80/38) = 3, 마지막 페이지 38행 채움
  for (const [i, page] of layout.pages.entries()) {
    const rows = page.elements.filter((e) => e.binding?.colName === 'INSP_NAME');
    assert.equal(rows.length, 38, `페이지 ${i + 1} 행수`);
  }
  const filled = layout.pages.flatMap((p) => p.elements).filter((e) => e.binding?.colName === 'INSP_NAME' && e.value !== null);
  assert.equal(filled.length, 80);
});

test('페이지 넘김 시 PageHeader와 FIXEDTITLE 데이터헤더가 반복된다', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  const data = { SQL_HEADER: readData('MESDEV_CCA.data.json').SQL_HEADER, SQL_DATA: makeCcaRows(80) };
  const layout = buildPagedLayout(model, { data });

  for (const [i, page] of layout.pages.entries()) {
    // PageHeader: 수주번호 룩업 셀이 페이지마다 존재
    const tracking = page.elements.find((e) => e.binding?.colName === 'TRACKING_NO' && e.band === 'PageHeaderBand1');
    assert.ok(tracking, `페이지 ${i + 1}: PageHeader`);
    assert.equal(tracking.value, 'T-0000-000');
    // FIXEDTITLE=true → DataHeaderBand1 반복
    const header = page.elements.find((e) => e.band === 'DataHeaderBand1');
    assert.ok(header, `페이지 ${i + 1}: DataHeader 반복`);
    // 첫 데이터 행은 PageHeader(87.307) + DataHeader(17.008) 아래에서 시작
    const firstRow = page.elements
      .filter((e) => e.binding?.colName === 'INSP_NAME')
      .sort((a, b) => a.y - b.y)[0];
    near(firstRow.y, 87.307 + 17.008, `페이지 ${i + 1}: 첫 행 y`);
  }
});

test('PageFooter가 모든 페이지 하단에 고정되고 룩업이 해석된다', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  const data = { SQL_HEADER: readData('MESDEV_CCA.data.json').SQL_HEADER, SQL_DATA: makeCcaRows(80) };
  const layout = buildPagedLayout(model, { data });

  // 플로우 영역 = 842 - 29 - 20 - 86.74(푸터)
  near(layout.flowHeight, 842 - 29 - 20 - 86.74, 'flowHeight');
  for (const [i, page] of layout.pages.entries()) {
    const worker = page.elements.find((e) => e.binding?.colName === 'WORK_USER_DESC');
    assert.ok(worker, `페이지 ${i + 1}: 푸터 존재`);
    assert.equal(worker.value, '홍길동');
    assert.ok(worker.y >= layout.flowHeight - 0.01, `페이지 ${i + 1}: 푸터가 하단(${worker.y} >= ${layout.flowHeight})`);
  }
});

test('그룹핑 병합은 페이지 경계를 넘지 않고, 빈 채움 행은 병합하지 않는다', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  // 50행 전부 같은 그룹 → 페이지1에 38행 병합 1개, 페이지2에 12행 병합 1개
  const rows = makeCcaRows(50).map((r) => ({ ...r, INSP_GROUP: '단일그룹' }));
  const layout = buildPagedLayout(model, { data: { SQL_HEADER: [], SQL_DATA: rows } });

  assert.equal(layout.pageCount, 2);
  const g1 = layout.pages[0].elements.filter((e) => e.binding?.colName === 'INSP_GROUP' && e.value !== null);
  assert.equal(g1.length, 1, '페이지1 병합 구간 1개');
  near(g1[0].h, 38 * CCA_STRIDE, '페이지1 병합 높이');

  const g2 = layout.pages[1].elements.filter((e) => e.binding?.colName === 'INSP_GROUP' && e.value !== null);
  assert.equal(g2.length, 1, '페이지2 병합 구간 1개');
  near(g2[0].h, 12 * CCA_STRIDE, '페이지2 병합 높이');

  // 빈 채움 행(26개)의 그룹 셀은 병합되지 않고 행마다 존재
  const blanks = layout.pages[1].elements.filter((e) => e.binding?.colName === 'INSP_GROUP' && e.value === null);
  assert.equal(blanks.length, 26);
});

test('COV: Title은 첫 페이지에만, 1행 데이터로 1페이지', () => {
  const model = parseOzr(read('MESDEV_COV.ozr'));
  const layout = buildPagedLayout(model, { data: { SQL_: [{ PROD_GUBUN: '양산' }] } });
  assert.equal(layout.pageCount, 1);
  const title = layout.pages[0].elements.find((e) => e.text === '제작 이력표');
  assert.ok(title);
  near(title.y, 0, 'Title 위치');
});

test('CCC 목데이터: 1페이지, DataFooter가 마지막 데이터밴드 뒤에 흐른다', () => {
  const model = parseOzr(read('MESDEV_CCC.ozr'));
  const layout = buildPagedLayout(model, { data: readData('MESDEV_CCC.data.json') });
  assert.equal(layout.pageCount, 1);
  const els = layout.pages[0].elements;
  const footerCell = els.find((e) => e.band === 'DataFooterBand2' && e.binding?.colName === 'WORK_USER_ID');
  assert.ok(footerCell);
  assert.equal(footerCell.value, 'worker01');
  // 푸터는 마지막 데이터 행보다 아래
  const lastRow = els.filter((e) => e.binding?.colName === 'CCA_CB_OPTION_TAG' && e.value !== null).sort((a, b) => b.y - a.y)[0];
  assert.ok(footerCell.y > lastRow.y, 'DataFooter가 데이터 아래');
});

test('fillRepeat=false면 빈 채움 없이 데이터 행만 그린다', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  const layout = buildPagedLayout(model, {
    data: readData('MESDEV_CCA.data.json'),
    fillRepeat: false,
  });
  const nameCells = layout.pages[0].elements.filter((e) => e.binding?.colName === 'INSP_NAME');
  assert.equal(nameCells.length, 6);
});

test('paged HTML: 페이지 div 개수와 print CSS', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  const data = { SQL_HEADER: readData('MESDEV_CCA.data.json').SQL_HEADER, SQL_DATA: makeCcaRows(80) };
  const { html, layout } = renderOzrToHtml(model, { data, paged: true });

  assert.equal(layout.pageCount, 3);
  assert.equal((html.match(/class="oz-page"/g) || []).length, 3);
  assert.match(html, /@page \{ size: 595pt 842pt; margin: 0; \}/);
  assert.match(html, /break-after: page/);
});

test('paged + 데이터 없음: 정적 폴백으로도 페이지가 생성된다', () => {
  const model = parseOzr(read('MESDEV_CCC.ozr'));
  const layout = buildPagedLayout(model, {});
  assert.ok(layout.pageCount >= 1);
  assert.deepEqual(layout.warnings, []);
});
