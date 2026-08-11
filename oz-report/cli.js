#!/usr/bin/env node
'use strict';

// 수동 검증용 CLI: 파싱 결과 요약, 전체 모델(JSON), 또는 HTML 렌더 출력.
//   node oz-report/cli.js <파일.ozr|파일.odi> [--json] [--render [출력.html]] [--bindings]

const fs = require('fs');
const path = require('path');
const { parseAny, renderOzrToHtml } = require('./index');

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const doRender = args.includes('--render');
  const showBindings = args.includes('--bindings');
  const positional = args.filter((a) => !a.startsWith('--'));
  const file = positional[0];
  if (!file) {
    console.error('사용법: node oz-report/cli.js <파일.ozr|파일.odi> [--json] [--render [출력.html]] [--bindings]');
    process.exit(1);
  }

  const { kind, model } = parseAny(fs.readFileSync(file));

  if (doRender) {
    if (kind !== 'ozr') {
      console.error('--render는 .ozr 파일만 지원합니다');
      process.exit(1);
    }
    const out = positional[1] || file.replace(/\.[^.]+$/, '') + '.html';
    const { html, layout } = renderOzrToHtml(model, {
      showBindings,
      title: path.basename(file),
    });
    fs.writeFileSync(out, html);
    console.log(`렌더 완료: ${out} (요소 ${layout.elements.length}개, ${Math.round(layout.height)}pt 높이)`);
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

main();
