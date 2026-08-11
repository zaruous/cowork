'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseOzr } = require('../src/ozr/parser');
const { buildLayout } = require('../src/render/layout');
const { renderOzrToHtml } = require('../src/render/html');
const { formatNumber, formatValue } = require('../src/render/format');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name));
const readData = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 0.01, `${msg}: ${actual} ≈ ${expected}`);
}

// ---- FORMAT (DecimalFormat 서브셋) ----

test('formatNumber: 샘플 패턴 #,##0.# / #,##0.00', () => {
  assert.equal(formatNumber(1234.56, '#,##0.#'), '1,234.6');
  assert.equal(formatNumber(1234, '#,##0.#'), '1,234');
  assert.equal(formatNumber(0, '#,##0.#'), '0');
  assert.equal(formatNumber(-3000, '#,##0.#'), '-3,000');
  assert.equal(formatNumber(5, '#,##0.00'), '5.00');
  assert.equal(formatNumber(17.334, '#,##0.00'), '17.33');
  assert.equal(formatNumber(1234.5, '0.###'), '1234.5'); // 그룹핑 없는 패턴
});

test('formatValue: NULLTYPE 빈칸 처리와 비숫자 통과', () => {
  assert.equal(formatValue(null, { format: '#,##0.#', nullType: 5 }), '');
  assert.equal(formatValue(undefined, {}), '');
  assert.equal(formatValue('■OK □NG', {}), '■OK □NG');
  assert.equal(formatValue('abc', { format: '#,##0.#' }), 'abc'); // 숫자 아님 → 원문
});

// ---- 행 반복 (CCA) ----

test('CCA: 데이터 6행 → 데이터밴드가 행수×템플릿 높이로 늘어난다', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  const data = readData('MESDEV_CCA.data.json');
  const layout = buildLayout(model, { data });

  const band = layout.bands.find((b) => b.name === 'DataBand1');
  near(band.height, 6 * 14.74, 'DataBand1 높이'); // 템플릿 행 높이 14.74

  // 행별 값 주입 확인
  const names = layout.elements
    .filter((e) => e.binding?.colName === 'INSP_NAME')
    .sort((a, b) => a.rowIndex - b.rowIndex)
    .map((e) => e.value);
  assert.deepEqual(names.slice(0, 2), ['표면 스크래치 확인', '도장 상태 확인']);
  assert.equal(names.length, 6);

  // 2행의 y = 밴드 top + 1×stride
  const row1 = layout.elements.find((e) => e.binding?.colName === 'INSP_NAME' && e.rowIndex === 1);
  near(row1.y - band.top, 14.74, '2행 y 오프셋');
});

test('CCA: 그룹핑 셀(DATATYPE=6)이 연속 동일값 구간으로 병합된다', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  const data = readData('MESDEV_CCA.data.json'); // 외관×3, 체결×2, 전장×1
  const layout = buildLayout(model, { data });

  const groupCells = layout.elements
    .filter((e) => e.binding?.colName === 'INSP_GROUP')
    .sort((a, b) => a.rowIndex - b.rowIndex);

  assert.equal(groupCells.length, 3); // 6행 → 3구간
  assert.deepEqual(groupCells.map((c) => c.value), ['외관', '체결', '전장']);
  near(groupCells[0].h, 3 * 14.74, '외관 구간 높이');
  near(groupCells[1].h, 2 * 14.74, '체결 구간 높이');
  near(groupCells[2].h, 1 * 14.74, '전장 구간 높이');
});

test('CCA: 룩업 셀(DATATYPE=7)이 헤더/푸터에서 첫 행 값을 얻는다', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  const layout = buildLayout(model, { data: readData('MESDEV_CCA.data.json') });

  const tracking = layout.elements.find((e) => e.binding?.colName === 'TRACKING_NO');
  assert.equal(tracking.value, 'T-0000-000');
  assert.equal(tracking.band, 'PageHeaderBand1');

  const worker = layout.elements.find((e) => e.binding?.colName === 'WORK_USER_DESC');
  assert.equal(worker.value, '홍길동');
  assert.equal(worker.band, 'PageFooterBand1');
});

// ---- 다중 데이터밴드 (CCC) ----

test('CCC: 데이터밴드가 실측 높이로 줄어 뒤 밴드들이 위로 당겨진다', () => {
  const model = parseOzr(read('MESDEV_CCC.ozr'));
  const layout = buildLayout(model, { data: readData('MESDEV_CCC.data.json') });

  const stride = 17.008; // 템플릿 행 높이
  const b = (name) => layout.bands.find((x) => x.name === name);

  near(b('DataBand1').height, 3 * stride, 'DataBand1: 3행');
  near(b('DataHeaderBand1').top, 134.929 + 3 * stride, 'DataHeaderBand1이 위로 당겨짐'); // 디자인 226.205보다 위
  near(b('DataBand4').height, 0, 'SQL_DATA_4 빈 배열 → 높이 0');
});

test('CCC: 숫자 FORMAT이 HTML 값에 적용된다', () => {
  const model = parseOzr(read('MESDEV_CCC.ozr'));
  const { html } = renderOzrToHtml(model, { data: readData('MESDEV_CCC.data.json') });
  assert.match(html, />3,000</); // CCA_CB_PT_MAX 3000 + '#,##0.#'
  assert.match(html, />1,500\.5</); // 1500.5
  assert.match(html, />17\.33</); // 17.334 + '#,##0.00'
  assert.match(html, />-0\.2</); // 음수 offset
});

// ---- 폴백/부분 데이터 ----

test('데이터 없이 호출하면 P2 정적 배치와 동일하다 (회귀)', () => {
  const model = parseOzr(read('MESDEV_CCC.ozr'));
  const stat = buildLayout(model);
  near(stat.bands.find((b) => b.name === 'DataBand2').top, 246.048, '정적 배치 유지');
});

test('데이터맵에 없는 데이터셋의 밴드는 정적 폴백, 있는 것만 바인딩된다', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  // SQL_HEADER만 제공 → 데이터밴드(SQL_DATA)는 템플릿 1회 + 미해석, 헤더 룩업은 해석
  const layout = buildLayout(model, { data: { SQL_HEADER: [{ TRACKING_NO: 'X-1' }] } });

  const band = layout.bands.find((b) => b.name === 'DataBand1');
  near(band.height, 600.378, '데이터밴드는 디자인 높이 유지');

  const tracking = layout.elements.find((e) => e.binding?.colName === 'TRACKING_NO');
  assert.equal(tracking.value, 'X-1');

  const inspName = layout.elements.find((e) => e.binding?.colName === 'INSP_NAME');
  assert.equal(inspName.value, undefined); // 미해석 → showBindings 대상
});

test('행에 없는 컬럼은 null(빈칸)으로 해석된다', () => {
  const model = parseOzr(read('MESDEV_CCA.ozr'));
  const layout = buildLayout(model, {
    data: { SQL_DATA: [{ INSP_GROUP: 'A' }], SQL_HEADER: [] },
  });
  const spec = layout.elements.find((e) => e.binding?.colName === 'INSP_SPEC');
  assert.equal(spec.value, null);
  const tracking = layout.elements.find((e) => e.binding?.colName === 'TRACKING_NO');
  assert.equal(tracking.value, null); // 빈 배열 → 첫 행 없음 → 빈칸
});
