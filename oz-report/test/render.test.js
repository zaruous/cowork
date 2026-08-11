'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseOzr } = require('../src/ozr/parser');
const { buildLayout } = require('../src/render/layout');
const { renderOzrToHtml } = require('../src/render/html');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name));

function bandTop(layout, name) {
  return layout.bands.find((b) => b.name === name).top;
}

function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 0.01, `${msg}: ${actual} ≈ ${expected}`);
}

// A-1 검증의 핵심 회귀 테스트: 정적(행 1회) 배치에서는 누적 Y 오프셋이
// 디자인 시점 TOP과 일치해야 한다 — 디자이너가 같은 규칙으로 배치해 두었기 때문.
test('CCC: 밴드 누적 오프셋이 디자인 TOP과 일치한다', () => {
  const layout = buildLayout(parseOzr(read('MESDEV_CCC.ozr')));
  near(bandTop(layout, 'DataBand1'), 134.929, 'DataBand1');
  near(bandTop(layout, 'DataHeaderBand1'), 226.205, 'DataHeaderBand1');
  near(bandTop(layout, 'DataBand2'), 246.048, 'DataBand2');
  near(bandTop(layout, 'DataBand5'), 579.405, 'DataBand5');
  near(bandTop(layout, 'DataFooterBand2'), 670.681, 'DataFooterBand2');
});

test('COV: Title 다음에 DataBand가 온다', () => {
  const layout = buildLayout(parseOzr(read('MESDEV_COV.ozr')));
  near(bandTop(layout, 'TitleBand1'), 0, 'TitleBand1');
  near(bandTop(layout, 'DataBand1'), 83.338, 'DataBand1');
});

test('CCA: PageFooter는 콘텐츠 플로우 마지막에 배치된다', () => {
  const layout = buildLayout(parseOzr(read('MESDEV_CCA.ozr')));
  const flowEnd = 87.307 + 17.008 + 600.378; // PageHeader + DataHeader + DataBand
  near(bandTop(layout, 'PageFooterBand1'), flowEnd, 'PageFooterBand1');
  near(layout.contentHeight, flowEnd + 86.74, 'contentHeight');
});

test('셀 좌표는 밴드 기준: 페이지 y = 밴드 top + 셀 top', () => {
  const layout = buildLayout(parseOzr(read('MESDEV_CCC.ozr')));
  // PageHeaderBand1(top=0) 안의 FixedTable3 셀들은 TOP≈100.913을 이미 포함
  const el = layout.elements.find((e) => e.name === 'FixedTableLabel36');
  near(el.y, 100.913, 'FixedTableLabel36.y');
  // DataBand1(top=134.929) 안의 첫 행 셀
  const cell = layout.elements.find((e) => e.name === 'FixedTableLabel1' && e.band === 'DataBand1');
  near(cell.y, 134.929, 'DataBand1 첫 셀 y');
});

test('빈 Background/Foreground 밴드는 경고 없이 제외된다', () => {
  for (const name of ['MESDEV_COV.ozr', 'MESDEV_CCA.ozr', 'MESDEV_CCC.ozr']) {
    const layout = buildLayout(parseOzr(read(name)));
    assert.deepEqual(layout.warnings, [], name);
  }
});

test('COV HTML: 정적 텍스트·스타일이 출력된다', () => {
  const { html } = renderOzrToHtml(parseOzr(read('MESDEV_COV.ozr')));
  assert.match(html, /제작 이력표/); // Title 라벨
  assert.match(html, /기준 정보/);
  assert.match(html, /background: #c0c0c0/); // 회색 헤더칸 (-4144960)
  assert.match(html, /font-weight: bold/); // FONTSTYLE=1
  assert.match(html, /'맑은 고딕'/);
  assert.match(html, /font-size: 36pt/); // 타이틀 폰트
});

test('BASICLABEL 기본 테두리(0.25pt)가 생략된 면에 적용된다', () => {
  const m = parseOzr(read('MESDEV_COV.ozr'));
  assert.equal(m.defaults.label.borders.left, 0.25);
  const { html } = renderOzrToHtml(m);
  assert.match(html, /border-left: max\(0\.25pt, 1px\) solid #000000/);
});

test('명시적 테두리 0은 렌더링하지 않는다', () => {
  const { html } = renderOzrToHtml(parseOzr(read('MESDEV_CCA.ozr')));
  // DataHeader 셀들은 DRAWBOTTOM="0" — bottom 테두리가 0인 요소가 존재해야 함
  const headerCell = html.split('\n').find((l) => l.includes('FixedTableLabel18') && l.includes('DataHeaderBand1'));
  assert.ok(headerCell, 'DataHeader 셀 존재');
  assert.doesNotMatch(headerCell, /border-bottom/);
  assert.match(headerCell, /border-top: max\(0\.25pt, 1px\)/);
});

test('바인딩 셀: 기본은 빈칸, showBindings면 ⟨데이터셋.컬럼⟩ 표시', () => {
  const m = parseOzr(read('MESDEV_CCA.ozr'));
  const plain = renderOzrToHtml(m).html;
  assert.doesNotMatch(plain, /SQL_HEADER\.TRACKING_NO/);

  const debug = renderOzrToHtml(m, { showBindings: true }).html;
  assert.match(debug, /⟨SQL_HEADER\.TRACKING_NO⟩/);
  assert.match(debug, /⟨SQL_DATA\.INSP_GROUP⟩/);
});

test('FGCOLOR가 CSS 색으로 출력된다 (CCA 빨간 강조)', () => {
  const { html } = renderOzrToHtml(parseOzr(read('MESDEV_CCA.ozr')));
  assert.match(html, /color: #ff0000/); // -65536
});

test('멀티라인 정적 텍스트가 보존된다 (CCC 2단 헤더)', () => {
  const { html } = renderOzrToHtml(parseOzr(read('MESDEV_CCC.ozr')));
  assert.match(html, /PT최대값\n\(psig\)/);
});
