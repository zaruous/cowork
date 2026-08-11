'use strict';

// 페이지 분할 엔진 (플랜 P6, 5.1 B-2/B-3/B-4).
//
// 인쇄 규칙 (샘플 + OZ 통례 기준):
// - Title 밴드는 첫 페이지에만, PageHeader는 모든 페이지 상단에 반복.
// - PageFooter는 모든 페이지 하단에 고정 배치.
// - 페이지 플로우 영역 = 용지 높이 − 상하 여백 − PageFooter 높이.
// - 데이터밴드는 행 단위로 흘리고, REPEATNUM이 있으면 페이지당 행수를 그 값으로 제한.
// - 페이지가 넘어가면 FIXEDTITLE=true인 데이터밴드의 헤더 밴드를 다시 그린다(B-4).
// - REPEATNUM 채움(B-3): 마지막 페이지의 남는 행을 빈 괘선 행으로 채워 양식을 완성한다.
// - 그룹핑 병합은 페이지 안에서만 — 페이지 경계를 넘는 병합은 하지 않는다.

const { placeBandOnce, mergeGroupCells, bandContentHeight } = require('./band');

const EPS = 0.01;

/**
 * @param {object} model parseOzr() 결과
 * @param {object} [opts]
 * @param {Record<string, Array<object>>} [opts.data] 데이터셋 이름 → 행 배열
 * @param {boolean} [opts.fillRepeat] REPEATNUM 기준 빈 괘선 행 채움 (기본 true)
 * @returns {{page, width, pageHeight, flowHeight, pageCount, pages: Array<{elements: Array}>, warnings: string[]}}
 */
function buildPagedLayout(model, opts = {}) {
  const data = opts.data || null;
  const fillRepeat = opts.fillRepeat !== false;
  const page = model.report.page;
  const warnings = [];

  const titleBands = model.bands.filter((b) => b.bandTypeName === 'Title');
  const pageHeaderBands = model.bands.filter((b) => b.bandTypeName === 'PageHeader');
  const pageFooterBands = model.bands.filter((b) => b.bandTypeName === 'PageFooter');
  const flowBands = model.bands.filter((b) =>
    ['DataHeader', 'Data', 'DataFooter'].includes(b.bandTypeName),
  );
  for (const b of model.bands) {
    if (
      !['Title', 'PageHeader', 'PageFooter', 'DataHeader', 'Data', 'DataFooter'].includes(b.bandTypeName) &&
      b.items.length > 0
    ) {
      warnings.push(`플로우 외 밴드의 항목은 아직 렌더링하지 않음: ${b.name} [${b.bandTypeName}]`);
    }
  }

  const footerHeight = pageFooterBands.reduce((s, b) => s + (b.height || 0), 0);
  const flowHeight =
    page.paperHeight - (page.margins.top || 0) - (page.margins.bottom || 0) - footerHeight;

  const pages = [];
  let cur = null;
  let cursorY = 0;

  function openPage(repeatHeaderBand) {
    cur = { elements: [] };
    pages.push(cur);
    cursorY = 0;
    if (pages.length === 1) {
      for (const b of titleBands) placeStatic(b);
    }
    for (const b of pageHeaderBands) placeStatic(b);
    if (repeatHeaderBand) placeStatic(repeatHeaderBand);
  }

  function placeStatic(band) {
    placeBandOnce(band, cursorY, 0, null, data, cur.elements);
    cursorY += band.height || 0;
  }

  openPage(null);

  for (const band of flowBands) {
    if (band.bandTypeName !== 'Data') {
      // DataHeader/DataFooter: 통짜 블록. 안 들어가면 다음 페이지로.
      if (cursorY + (band.height || 0) > flowHeight + EPS) openPage(null);
      placeStatic(band);
      continue;
    }

    const rows = band.tag === 'OZDATABAND' && data ? data[band.dataSourceName] : undefined;
    if (rows === undefined) {
      // 정적 폴백(P2): 템플릿 1회, 디자인 높이 블록
      if (cursorY + (band.height || 0) > flowHeight + EPS) openPage(null);
      placeBandOnce(band, cursorY, 0, null, data, cur.elements);
      cursorY += band.height || 0;
      continue;
    }

    const stride = bandContentHeight(band);
    const cap = band.repeatNum > 0 ? band.repeatNum : Infinity;
    const repeatHeader = band.fixedTitle ? findHeaderBand(model, band) : null;

    // B-3: REPEATNUM 채움 — 총 행수를 REPEATNUM 배수로 올림(0행이어도 한 페이지 분량은 그린다)
    let total = rows.length;
    if (fillRepeat && band.repeatNum > 0) {
      total = Math.ceil(Math.max(rows.length, 1) / band.repeatNum) * band.repeatNum;
    }

    let rowsOnPage = 0;
    let bandEls = [];
    const flush = () => {
      mergeGroupCells(bandEls, stride);
      cur.elements.push(...bandEls);
      bandEls = [];
    };

    for (let i = 0; i < total; i += 1) {
      if (rowsOnPage >= cap || cursorY + stride > flowHeight + EPS) {
        flush();
        openPage(repeatHeader);
        rowsOnPage = 0;
      }
      const row = i < rows.length ? rows[i] : {}; // 빈 괘선 행: 바인딩 셀은 null → 빈칸
      placeBandOnce(band, cursorY, i, row, data, bandEls);
      cursorY += stride;
      rowsOnPage += 1;
    }
    flush();
  }

  // PageFooter: 모든 페이지 하단 고정 (룩업 바인딩도 페이지마다 해석)
  for (const p of pages) {
    let fy = flowHeight;
    for (const b of pageFooterBands) {
      placeBandOnce(b, fy, 0, null, data, p.elements);
      fy += b.height || 0;
    }
  }

  return {
    page,
    width: page.paperWidth,
    pageHeight: page.paperHeight,
    flowHeight,
    pageCount: pages.length,
    pages,
    warnings,
  };
}

/** 페이지 넘김 시 반복할 헤더 밴드: HEADERBANDNAME 우선, 없으면 PARENT로 연결된 DataHeader */
function findHeaderBand(model, dataBand) {
  if (dataBand.headerBandName) {
    return model.bands.find((b) => b.name === dataBand.headerBandName) || null;
  }
  return (
    model.bands.find((b) => b.bandTypeName === 'DataHeader' && b.parent === dataBand.name) || null
  );
}

module.exports = { buildPagedLayout };
