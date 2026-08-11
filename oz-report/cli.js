#!/usr/bin/env node
'use strict';

// 수동 검증용 CLI: 파싱 결과 요약, 전체 모델(JSON), HTML 렌더, PDF 출력.
//   node oz-report/cli.js <파일.ozr|파일.odi> [--json] [--render [출력.html]] [--bindings] [--data 데이터.json]
//                         [--paged] [--pdf 출력.pdf]
// --data:  {"데이터셋이름": [행...]} 형태의 JSON을 주입해 데이터 바인딩 렌더
// --paged: 용지 크기 페이지 분할 + REPEATNUM 빈 괘선 채움 (인쇄 미리보기)
// --pdf:   Chromium으로 PDF 저장 (--paged 자동 적용, playwright-core 필요)

const fs = require('fs');
const path = require('path');
const { parseAny, renderOzrToHtml } = require('./index');

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const doRender = args.includes('--render');
  const showBindings = args.includes('--bindings');
  const dataIdx = args.indexOf('--data');
  const dataFile = dataIdx >= 0 ? args[dataIdx + 1] : null;
  const pdfIdx = args.indexOf('--pdf');
  const pdfFile = pdfIdx >= 0 ? args[pdfIdx + 1] : null;
  const paged = args.includes('--paged') || !!pdfFile;
  const consumed = new Set([dataIdx + 1, pdfIdx + 1].filter((i) => i > 0));
  const positional = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
  const file = positional[0];
  if (!file) {
    console.error('사용법: node oz-report/cli.js <파일.ozr|파일.odi> [--json] [--render [출력.html]] [--bindings]');
    process.exit(1);
  }

  const { kind, model } = parseAny(fs.readFileSync(file));

  if (doRender || pdfFile) {
    if (kind !== 'ozr') {
      console.error('--render/--pdf는 .ozr 파일만 지원합니다');
      process.exit(1);
    }
    const data = dataFile ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : undefined;
    const { html, layout } = renderOzrToHtml(model, {
      data,
      paged,
      showBindings,
      title: path.basename(file),
    });

    if (doRender) {
      const out = positional[1] || file.replace(/\.[^.]+$/, '') + '.html';
      fs.writeFileSync(out, html);
      const desc = paged
        ? `${layout.pageCount}페이지`
        : `요소 ${layout.elements.length}개, ${Math.round(layout.height)}pt 높이`;
      console.log(`렌더 완료: ${out} (${desc})`);
    }
    if (pdfFile) {
      exportPdf(html, layout, pdfFile).then(() => {
        console.log(`PDF 완료: ${pdfFile} (${layout.pageCount}페이지)`);
      });
    }
    for (const w of layout.warnings) console.log(`  ! ${w}`);
    return;
  }

  if (asJson) {
    console.log(JSON.stringify({ kind, model }, null, 2));
    return;
  }

  console.log(`종류: ${kind.toUpperCase()}`);
  if (kind === 'odi') {
    console.log(`파라미터 (${model.params.length}):`);
    for (const p of model.params) console.log(`  - ${p.name} ${p.typeName} 기본값=${JSON.stringify(p.defaultValue)}`);
    console.log(`데이터셋 (${model.datasets.length}):`);
    for (const d of model.datasets) {
      console.log(`  - ${d.name} [${d.storeName}] 필드 ${d.fields.length}개, 플레이스홀더: ${d.placeholders.join(', ') || '(없음)'}`);
    }
  } else {
    const pg = model.report.page;
    console.log(`레포트: ${model.report.name} (포맷 ${model.version?.version}), 용지 ${pg.paperWidth}x${pg.paperHeight}pt, 배율 ${pg.virtualX}x${pg.virtualY}`);
    console.log(`밴드 (${model.bands.length}):`);
    for (const b of model.bands) {
      const extra = b.tag === 'OZDATABAND' ? ` ← ${b.odiName}/${b.dataSourceName}${b.repeatNum ? ` repeat=${b.repeatNum}` : ''}` : '';
      const cellCount = b.items.reduce((n, it) => n + (it.cells ? it.cells.length : 1), 0);
      console.log(`  - ${b.name} [${b.bandTypeName}] 항목 ${b.items.length}개/셀 ${cellCount}개${extra}`);
    }
    console.log(`ODI 참조: ${model.odiRefs.map((r) => `${r.name}(${r.dataSets.join(',')})`).join(' / ') || '(없음)'}`);
  }
  if (model.warnings.length) {
    console.log(`경고 (${model.warnings.length}):`);
    for (const w of model.warnings) console.log(`  ! ${w}`);
  }
}

/** Chromium(playwright-core)으로 HTML을 용지 규격 PDF로 저장한다. */
async function exportPdf(html, layout, outPath) {
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch {
    console.error('--pdf에는 playwright-core가 필요합니다: npm install -D playwright-core');
    process.exit(1);
  }
  const executablePath = process.env.OZ_CHROMIUM || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    // page.pdf는 pt 단위를 받지 않는다 — 인치로 변환 (1pt = 1/72in)
    await page.pdf({
      path: outPath,
      width: `${(layout.width / 72).toFixed(4)}in`,
      height: `${(layout.pageHeight / 72).toFixed(4)}in`,
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
}

main();
