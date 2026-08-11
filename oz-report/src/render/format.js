'use strict';

// 값 포맷팅 (플랜 5장 7항, C-3).
// FORMAT은 Java DecimalFormat 패턴 — 샘플 관찰: '#,##0.#', '#,##0.00'.
// 필요한 서브셋(그룹핑, 최소/최대 소수 자릿수, 최소 정수 자릿수)만 구현한다.

/**
 * @param {*} value 데이터 값
 * @param {object} [style] 셀 스타일 ({format, nullType})
 * @returns {string}
 */
function formatValue(value, style = {}) {
  if (value === null || value === undefined) {
    // NULLTYPE=5: 빈칸 (관찰 기준). 다른 코드의 의미는 미확정 — 우선 전부 빈칸 처리.
    return '';
  }
  if (style.format && value !== '' && !Number.isNaN(Number(value))) {
    return formatNumber(Number(value), style.format);
  }
  return String(value);
}

/**
 * DecimalFormat 패턴 서브셋.
 * @param {number} n
 * @param {string} pattern 예: '#,##0.#', '#,##0.00', '0.###'
 * @returns {string}
 */
function formatNumber(n, pattern) {
  const dot = pattern.indexOf('.');
  const intPat = dot < 0 ? pattern : pattern.slice(0, dot);
  const fracPat = dot < 0 ? '' : pattern.slice(dot + 1);

  const grouping = intPat.includes(',');
  const minInt = count(intPat, '0');
  const minFrac = count(fracPat, '0');
  const maxFrac = fracPat.length;

  const fixed = Math.abs(n).toFixed(maxFrac);
  let [intPart, fracPart = ''] = fixed.split('.');

  while (fracPart.length > minFrac && fracPart.endsWith('0')) {
    fracPart = fracPart.slice(0, -1);
  }
  if (intPart.length < minInt) intPart = intPart.padStart(minInt, '0');
  if (grouping) intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return (n < 0 ? '-' : '') + intPart + (fracPart ? `.${fracPart}` : '');
}

function count(s, ch) {
  let c = 0;
  for (const x of s) if (x === ch) c += 1;
  return c;
}

module.exports = { formatValue, formatNumber };
