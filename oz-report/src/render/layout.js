'use strict';

// 밴드 배치 엔진 (플랜 5장, 5.1 A-1/B-1).
//
// 파일의 밴드 TOP은 디자인 시점 값이므로 사용하지 않는다. 문서 순서대로 밴드를
// 위에서 아래로 흘리며 실측 높이를 누적해 각 밴드의 런타임 원점을 계산한다.
// 데이터가 주어지면 데이터밴드는 행 수만큼 템플릿을 반복하며 늘어난다(P3).
//
// 셀 좌표계 주의: OZTABLELABEL의 LEFT/TOP은 "밴드 기준" 좌표다. 테이블(OZTABLESTATIC)의
// 오프셋이 이미 포함되어 있다 — CCC의 FixedTable3(TOP=100.913) 내부 셀 TOP이 0이 아니라
// 100.913부터 시작하는 것으로 확인. 따라서 테이블은 그룹핑 용도로만 취급한다.
//
// VIRTUALX/Y 주의: COV(0.7)와 CCA/CCC(1.1) 모두 콘텐츠 폭(WIDTH=555pt)이 A4 콘텐츠 영역
// (595-20-20)과 정확히 일치한다. 좌표에 배율을 곱하면 오히려 용지를 벗어나므로,
// 이 값은 디자이너 화면 줌으로 판단하고 렌더링 좌표에는 적용하지 않는다(A-2 검증 항목).

const { placeBandOnce, mergeGroupCells, bandContentHeight } = require('./band');

// 위→아래 플로우에 참여하는 밴드 (문서 순서 = 시각 순서, 샘플 3종에서 확인)
const FLOW_BAND_TYPES = new Set(['Title', 'PageHeader', 'DataHeader', 'Data', 'DataFooter']);

/**
 * @param {object} model parseOzr() 결과
 * @param {object} [opts]
 * @param {Record<string, Array<object>>} [opts.data] 데이터셋 이름 → 행 배열 (JSON 주입 모드).
 *   데이터셋이 이 맵에 없으면 해당 밴드는 P2와 동일한 정적(템플릿 1회) 렌더로 폴백한다.
 * @returns {{page, width, height, contentHeight, bands: Array, elements: Array, warnings: string[]}}
 */
function buildLayout(model, opts = {}) {
  const data = opts.data || null;
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
    let bandHeight;

    const rows = band.tag === 'OZDATABAND' && data ? data[band.dataSourceName] : undefined;
    if (rows !== undefined) {
      bandHeight = placeDataBand(band, bandTop, rows, data, elements);
    } else {
      // 정적 모드: 템플릿 1회. 데이터맵이 있으면 룩업 셀(다른 데이터셋 참조)은 값 해석.
      placeBandOnce(band, bandTop, 0, null, data, elements);
      bandHeight = band.height || 0;
    }

    placedBands.push({ name: band.name, type: band.bandTypeName, top: bandTop, height: bandHeight });
    cursor = bandTop + bandHeight;
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

/**
 * 데이터밴드: 행마다 템플릿을 반복 배치하고, 그룹핑 셀(DATATYPE=6)을 병합한다.
 * @returns {number} 밴드 런타임 높이
 */
function placeDataBand(band, bandTop, rows, data, elements) {
  // 반복 간격 = 템플릿 콘텐츠 높이(밴드 디자인 높이가 아님 — 디자인 높이는 페이지 채움용).
  const stride = bandContentHeight(band);
  const bandElements = [];

  rows.forEach((row, rowIndex) => {
    placeBandOnce(band, bandTop + rowIndex * stride, rowIndex, row, data, bandElements);
  });

  mergeGroupCells(bandElements, stride);
  elements.push(...bandElements);

  // AUTOSIZE 여부와 무관하게 실측 높이 사용 — COV(비autoSize, 1행)도 동일 규칙으로 일치함을 확인.
  return rows.length * stride;
}

module.exports = { buildLayout, FLOW_BAND_TYPES };
