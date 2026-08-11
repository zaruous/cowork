'use strict';

// OZR의 색 속성(BGCOLOR/FGCOLOR/FRAMECOLOR*)은 Java Color의 부호 있는 32bit ARGB 정수.
// 관찰값: -1 = 흰색(0xFFFFFFFF), -16777216 = 검정(0xFF000000), -4144960 = 회색(0xFFC0C0C0)

/**
 * @param {number|undefined|null} n 부호 있는 32bit ARGB
 * @returns {string|null} CSS 색상 ('#rrggbb' 또는 알파가 있으면 'rgba(...)')
 */
function argbIntToCss(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return null;
  const v = (n & 0xffffffff) >>> 0;
  const a = (v >>> 24) & 0xff;
  const r = (v >>> 16) & 0xff;
  const g = (v >>> 8) & 0xff;
  const b = v & 0xff;
  if (a === 0xff) {
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}

function hex2(x) {
  return x.toString(16).padStart(2, '0');
}

module.exports = { argbIntToCss };
