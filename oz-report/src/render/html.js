'use strict';

// HTML 렌더러 (플랜 5장): 배치 결과를 절대배치 div로 출력한다.
// 셀 겹침으로 표현된 2단 헤더(A-4) 때문에 <table> 매핑 대신 절대배치를 쓴다.

const { buildLayout } = require('./layout');
const { formatValue } = require('./format');
const { argbIntToCss } = require('../util/color');

const DEFAULT_FONT_STACK = "'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif";

// HALIGN/VALIGN: 0=시작, 1=중앙, 2=끝 (표준 매핑 가정 — P2 육안 검수 항목)
const H_ALIGN = { 0: 'flex-start', 1: 'center', 2: 'flex-end' };
const V_ALIGN = { 0: 'flex-start', 1: 'center', 2: 'flex-end' };
const H_TEXT_ALIGN = { 0: 'left', 1: 'center', 2: 'right' };

/**
 * @param {object} model parseOzr() 결과
 * @param {object} [opts]
 * @param {Record<string, Array<object>>} [opts.data] 데이터셋 이름 → 행 배열 (JSON 주입 모드)
 * @param {boolean} [opts.showBindings] 미해석 바인딩 셀에 ⟨데이터셋.컬럼⟩ 표시 (검수용)
 * @param {string} [opts.title] HTML 문서 제목
 * @returns {{html: string, layout: object}}
 */
function renderOzrToHtml(model, opts = {}) {
  const layout = buildLayout(model, { data: opts.data });
  const defaults = model.defaults?.label || {};
  const margins = layout.page.margins || {};

  const body = layout.elements
    .map((el) => renderElement(el, defaults, margins, opts))
    .join('\n');

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title || model.report.name || 'OZ Report')}</title>
<style>
  body { margin: 0; padding: 24px; background: #52565c; }
  .oz-page {
    position: relative;
    width: ${pt(layout.width)};
    height: ${pt(layout.height)};
    margin: 0 auto;
    background: #ffffff;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }
  .oz-el {
    position: absolute;
    display: flex;
    box-sizing: border-box;
    overflow: hidden;
    white-space: pre-line;
    line-height: 1.15;
  }
  .oz-binding { color: #7a8db0; font-style: italic; }
</style>
</head>
<body>
<div class="oz-page">
${body}
</div>
</body>
</html>
`;
  return { html, layout };
}

function renderElement(el, defaults, margins, opts) {
  const s = el.style || {};
  const css = [];

  // 위치: 페이지 여백 원점 + 밴드 기준 좌표(레이아웃 엔진 산출)
  css.push(`left: ${pt((margins.left || 0) + el.x)}`);
  css.push(`top: ${pt((margins.top || 0) + el.y)}`);
  css.push(`width: ${pt(el.w)}`);
  css.push(`height: ${pt(el.h)}`);

  // 배경
  const transparent = pick(s.transparent, defaults.transparent, false);
  const bgColor = pick(s.bgColor, defaults.bgColor);
  if (!transparent && bgColor !== undefined) {
    css.push(`background: ${argbIntToCss(bgColor)}`);
  }

  // 테두리 (A-3: 0.25pt 헤어라인 → max(w, 1px) 보정)
  if (!s.noFrame) {
    for (const side of ['left', 'top', 'right', 'bottom']) {
      const w = pick(s.borders?.[side], defaults.borders?.[side], 0);
      if (w > 0) {
        const color = argbIntToCss(pick(s.frameColors?.[side], defaults.frameColors?.[side], -16777216));
        css.push(`border-${side}: max(${w}pt, 1px) solid ${color}`);
      }
    }
  }

  // 폰트
  const font = s.font || {};
  const dFont = defaults.font || {};
  const fontName = pick(font.name, dFont.name);
  css.push(`font-family: ${fontName ? `'${fontName}', ` : ''}${DEFAULT_FONT_STACK}`);
  css.push(`font-size: ${pt(pick(font.size, dFont.size, 10))}`);
  const fontStyle = pick(font.style, dFont.style, 0);
  if (fontStyle & 1) css.push('font-weight: bold');
  if (fontStyle & 2) css.push('font-style: italic');
  const fgColor = pick(s.fgColor, defaults.fgColor);
  if (fgColor !== undefined) css.push(`color: ${argbIntToCss(fgColor)}`);

  // 정렬 + 안쪽 여백
  const h = pick(s.hAlign, defaults.hAlign, 0);
  const v = pick(s.vAlign, defaults.vAlign, 0);
  css.push(`justify-content: ${H_ALIGN[h] || 'flex-start'}`);
  css.push(`align-items: ${V_ALIGN[v] || 'flex-start'}`);
  css.push(`text-align: ${H_TEXT_ALIGN[h] || 'left'}`);
  const pad = ['top', 'right', 'bottom', 'left']
    .map((side) => pt(pick(s.padding?.[side], defaults.padding?.[side], 0)))
    .join(' ');
  css.push(`padding: ${pad}`);

  // 내용: 해석된 데이터 값 > 정적 텍스트 > (검수 모드일 때) 미해석 바인딩 표시
  let content = '';
  if (el.binding && 'value' in el && el.value !== undefined) {
    content = escapeHtml(formatValue(el.value, s));
  } else if (el.text) {
    content = escapeHtml(el.text);
  } else if (el.binding && opts.showBindings) {
    content = `<span class="oz-binding">⟨${escapeHtml(`${el.binding.datasetName}.${el.binding.colName}`)}⟩</span>`;
  }

  const title = `${el.band} / ${el.name}`;
  return `<div class="oz-el" style="${css.join('; ')}" title="${escapeHtml(title)}">${content}</div>`;
}

function pick(...values) {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

function pt(v) {
  return `${round3(v || 0)}pt`;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { renderOzrToHtml };
