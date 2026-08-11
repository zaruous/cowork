'use strict';

// 밴드 배치 공통 로직 — 연속 뷰(layout.js)와 페이지 분할(paginate.js)이 공유한다.

/** 밴드 템플릿을 한 번 배치. row가 null이면 정적 모드(바인딩 셀은 룩업만 해석). */
function placeBandOnce(band, top, rowIndex, row, data, elements) {
  for (const item of band.items) {
    if (item.type === 'table') {
      for (const cell of item.cells) {
        elements.push(placeElement(cell, band, top, 'cell', rowIndex, row, data));
      }
    } else if (item.type === 'label') {
      elements.push(placeElement(item, band, top, 'label', rowIndex, row, data));
    }
  }
}

function placeElement(node, band, top, kind, rowIndex, row, data) {
  const el = {
    kind,
    band: band.name,
    name: node.name,
    rowIndex,
    x: (band.left || 0) + (node.left || 0),
    y: top + (node.top || 0),
    w: node.width || 0,
    h: node.height || 0,
    text: node.text,
    binding: node.binding || null,
    style: node.style,
  };

  if (node.binding && data) {
    el.value = resolveBinding(node.binding, band, row, data);
  }
  return el;
}

/**
 * 바인딩 값 해석 (플랜 2.3 DATATYPE 관찰):
 * - 밴드의 데이터셋과 같은 데이터셋 → 현재 행(row)의 값 (DATATYPE 2/6)
 * - 다른 데이터셋 → 해당 데이터셋 첫 행의 값 (DATATYPE 7 룩업 — 헤더/푸터의 단건 표시)
 * 데이터맵에 해당 데이터셋이 없으면 undefined(미해석) 유지 → 렌더러가 바인딩 표시 모드로 처리.
 */
function resolveBinding(binding, band, row, data) {
  const { datasetName, colName } = binding;
  if (row && band.tag === 'OZDATABAND' && datasetName === band.dataSourceName) {
    return colName in row ? row[colName] : null;
  }
  const rows = data[datasetName];
  if (rows === undefined) return undefined;
  const first = rows[0];
  return first && colName in first ? first[colName] : null;
}

/**
 * 그룹핑 병합 (B-1): DATATYPE=6 셀은 연속된 동일 값 구간을 하나로 합친다.
 * 절대배치에는 rowspan이 없으므로 구간 첫 셀의 높이를 늘리고 나머지는 제거한다.
 * null 값(빈 채움 행 포함)은 병합하지 않는다 — 빈 괘선 행은 행마다 그대로 그린다.
 */
function mergeGroupCells(bandElements, stride) {
  const groups = new Map(); // 템플릿 셀 이름 → 행 순서 요소 목록
  for (const el of bandElements) {
    if (el.binding?.dataType === 6) {
      if (!groups.has(el.name)) groups.set(el.name, []);
      groups.get(el.name).push(el);
    }
  }

  const dropped = new Set();
  for (const els of groups.values()) {
    els.sort((a, b) => a.rowIndex - b.rowIndex);
    let head = null;
    for (const el of els) {
      if (
        head &&
        el.value != null &&
        el.value === head.value &&
        el.rowIndex === head._lastRow + 1
      ) {
        head.h += stride;
        head._lastRow = el.rowIndex;
        dropped.add(el);
      } else {
        head = el;
        head._lastRow = el.rowIndex;
      }
    }
  }

  if (dropped.size > 0) {
    for (let i = bandElements.length - 1; i >= 0; i -= 1) {
      if (dropped.has(bandElements[i])) bandElements.splice(i, 1);
    }
  }
  for (const el of bandElements) delete el._lastRow;
}

/** 밴드 템플릿의 콘텐츠 높이 = 항목들의 최하단(밴드 기준 좌표) */
function bandContentHeight(band) {
  let bottom = 0;
  for (const item of band.items) {
    bottom = Math.max(bottom, (item.top || 0) + (item.height || 0));
    if (item.cells) {
      for (const cell of item.cells) {
        bottom = Math.max(bottom, (cell.top || 0) + (cell.height || 0));
      }
    }
  }
  return bottom || band.height || 0;
}

module.exports = { placeBandOnce, placeElement, resolveBinding, mergeGroupCells, bandContentHeight };
