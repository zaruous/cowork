'use strict';

// 밴드 배치 엔진 (플랜 5장, 5.1 A-1).
//
// 파일의 밴드 TOP은 디자인 시점 값이므로 사용하지 않는다. 문서 순서대로 밴드를
// 위에서 아래로 흘리며 실측 높이를 누적해 각 밴드의 런타임 원점을 계산한다.
// (P2 정적 렌더에서는 밴드 높이 = 디자인 높이. P3에서 데이터 행 수만큼 늘어난다.)
//
// 셀 좌표계 주의: OZTABLELABEL의 LEFT/TOP은 "밴드 기준" 좌표다. 테이블(OZTABLESTATIC)의
// 오프셋이 이미 포함되어 있다 — CCC의 FixedTable3(TOP=100.913) 내부 셀 TOP이 0이 아니라
// 100.913부터 시작하는 것으로 확인. 따라서 테이블은 그룹핑 용도로만 취급한다.
//
// VIRTUALX/Y 주의: COV(0.7)와 CCA/CCC(1.1) 모두 콘텐츠 폭(WIDTH=555pt)이 A4 콘텐츠 영역
// (595-20-20)과 정확히 일치한다. 좌표에 배율을 곱하면 오히려 용지를 벗어나므로,
// 이 값은 디자이너 화면 줌으로 판단하고 렌더링 좌표에는 적용하지 않는다(A-2 검증 항목).

// 위→아래 플로우에 참여하는 밴드 (문서 순서 = 시각 순서, 샘플 3종에서 확인)
const FLOW_BAND_TYPES = new Set(['Title', 'PageHeader', 'DataHeader', 'Data', 'DataFooter']);

/**
 * @param {object} model parseOzr() 결과
 * @returns {{page, width, height, contentHeight, bands: Array, elements: Array, warnings: string[]}}
 */
function buildLayout(model) {
  const page = model.report.page;
  const warnings = [];
  const elements = [];
  const placedBands = [];

  const flow = model.bands.filter((b) => FLOW_BAND_TYPES.has(b.bandTypeName));
  const pageFooters = model.bands.filter((b) => b.bandTypeName === 'PageFooter');

  // Background/Foreground 등 플로우 외 밴드: 샘플에서는 전부 비어 있음. 내용이 있으면 경고.
  for (const b of model.bands) {
    if (!FLOW_BAND_TYPES.has(b.bandTypeName) && b.bandTypeName !== 'PageFooter' && b.items.length > 0) {
      warnings.push(`플로우 외 밴드의 항목은 아직 렌더링하지 않음: ${b.name} [${b.bandTypeName}]`);
    }
  }

  let cursor = 0;
  // 연속(웹) 뷰: PageFooter는 콘텐츠 끝에 한 번 배치. 페이지 분할은 P6에서 다룬다.
  for (const band of [...flow, ...pageFooters]) {
    const bandTop = cursor;
    placedBands.push({ name: band.name, type: band.bandTypeName, top: bandTop, height: band.height || 0 });

    for (const item of band.items) {
      if (item.type === 'table') {
        for (const cell of item.cells) elements.push(placeElement(cell, band, bandTop, 'cell'));
      } else if (item.type === 'label') {
        elements.push(placeElement(item, band, bandTop, 'label'));
      }
    }
    cursor = bandTop + (band.height || 0);
  }

  return {
    page,
    width: page.paperWidth,
    contentHeight: cursor,
    height: (page.margins.top || 0) + cursor + (page.margins.bottom || 0),
    bands: placedBands,
    elements,
    warnings,
  };
}

function placeElement(node, band, bandTop, kind) {
  return {
    kind,
    band: band.name,
    name: node.name,
    x: (band.left || 0) + (node.left || 0),
    y: bandTop + (node.top || 0),
    w: node.width || 0,
    h: node.height || 0,
    text: node.text,
    binding: node.binding || null,
    style: node.style,
  };
}

module.exports = { buildLayout, FLOW_BAND_TYPES };
