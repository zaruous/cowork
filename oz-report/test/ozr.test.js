'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseOzr } = require('../src/ozr/parser');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name));

test('MESDEV_COV.ozr: 용지/배율/여백', () => {
  const m = parseOzr(read('MESDEV_COV.ozr'));
  assert.equal(m.version.version, '5.1');
  const pg = m.report.page;
  assert.equal(pg.paperWidth, 595); // A4
  assert.equal(pg.paperHeight, 842);
  assert.equal(pg.virtualX, 0.7); // A-2: COV는 0.7 배율
  assert.deepEqual(pg.margins, { left: 20, top: 30, right: 20, bottom: 20 });
});

test('MESDEV_COV.ozr: 밴드 구성 (Title + Data + Back/Fore)', () => {
  const m = parseOzr(read('MESDEV_COV.ozr'));
  assert.deepEqual(
    m.bands.map((b) => [b.name, b.bandTypeName]),
    [
      ['TitleBand1', 'Title'],
      ['DataBand1', 'Data'],
      ['BackgroundBand1', 'Background'],
      ['ForegroundBand1', 'Foreground'],
    ],
  );
  const dataBand = m.bands[1];
  assert.equal(dataBand.odiName, 'MESDEV_COV');
  assert.equal(dataBand.dataSourceName, 'SQL_');
  assert.equal(dataBand.items[0].type, 'table');
  assert.ok(dataBand.items[0].cells.length > 50, '고정 테이블 셀 다수');
});

test('MESDEV_COV.ozr: 셀 바인딩과 정적 라벨 구분', () => {
  const m = parseOzr(read('MESDEV_COV.ozr'));
  const cells = m.bands[1].items[0].cells;

  const bound = cells.find((c) => c.name === 'FixedTableLabel11');
  assert.equal(bound.binding.dataTypeName, 'field'); // DATATYPE=2
  assert.equal(bound.binding.colName, 'PROD_GUBUN');
  assert.equal(bound.binding.datasetName, 'SQL_');
  assert.equal(bound.binding.nullType, 5);
  assert.equal(bound.text, null);

  const label = cells.find((c) => c.name === 'FixedTableLabel6');
  assert.equal(label.binding, null);
  assert.equal(label.text, '제작구분');
  assert.equal(label.style.bgColor, -4144960); // 회색 헤더칸
  assert.deepEqual(label.tableIndex, { col: 0, row: 1 });
});

test('MESDEV_CCA.ozr: 루트 레벨 PageFooter까지 문서 순서로 수집', () => {
  const m = parseOzr(read('MESDEV_CCA.ozr'));
  assert.deepEqual(
    m.bands.map((b) => [b.name, b.bandTypeName, b.scope]),
    [
      ['PageHeaderBand1', 'PageHeader', 'reportinfo'],
      ['DataHeaderBand1', 'DataHeader', 'reportinfo'],
      ['DataBand1', 'Data', 'reportinfo'],
      ['BackgroundBand1', 'Background', 'reportinfo'],
      ['ForegroundBand1', 'Foreground', 'reportinfo'],
      ['PageFooterBand1', 'PageFooter', 'root'],
    ],
  );
});

test('MESDEV_CCA.ozr: 데이터밴드 속성(REPEATNUM, FIXEDTITLE, AUTOSIZE)', () => {
  const m = parseOzr(read('MESDEV_CCA.ozr'));
  const band = m.bands.find((b) => b.name === 'DataBand1');
  assert.equal(band.repeatNum, 38); // B-3
  assert.equal(band.fixedTitle, true); // B-4
  assert.equal(band.autoSize, true); // A-1
  assert.equal(band.dataSourceName, 'SQL_DATA');
});

test('MESDEV_CCA.ozr: 그룹핑 필드(DATATYPE=6)와 단건 조회 필드(DATATYPE=7)', () => {
  const m = parseOzr(read('MESDEV_CCA.ozr'));

  const dataBand = m.bands.find((b) => b.name === 'DataBand1');
  const groupCell = dataBand.items[0].cells.find((c) => c.name === 'FixedTableLabel1');
  assert.equal(groupCell.binding.dataTypeName, 'groupField');
  assert.equal(groupCell.binding.groupingRule, 4); // B-1
  assert.equal(groupCell.binding.fixedNewPage, true); // B-2
  assert.equal(groupCell.binding.colName, 'INSP_GROUP');

  const header = m.bands.find((b) => b.name === 'PageHeaderBand1');
  const lookupCell = header.items[0].cells.find((c) => c.name === 'FixedTableLabel13');
  assert.equal(lookupCell.binding.dataTypeName, 'lookupField');
  assert.equal(lookupCell.binding.datasetName, 'SQL_HEADER'); // 밴드 데이터셋과 다른 데이터셋 참조
  assert.equal(lookupCell.binding.colName, 'TRACKING_NO');
});

test('MESDEV_CCC.ozr: 데이터밴드 5개와 SUBDATALIST 커스텀 구분자 분해', () => {
  const m = parseOzr(read('MESDEV_CCC.ozr'));
  assert.deepEqual(m.report.subDataList, ['DataBand1', 'DataBand2', 'DataBand3', 'DataBand4', 'DataBand5']);

  const dataBands = m.bands.filter((b) => b.bandTypeName === 'Data');
  assert.equal(dataBands.length, 5);
  assert.deepEqual(
    dataBands.map((b) => b.dataSourceName),
    ['SQL_DATA_1', 'SQL_DATA_2', 'SQL_DATA_3', 'SQL_DATA_4', 'SQL_DATA_5'],
  );
});

test('MESDEV_CCC.ozr: DataHeader/DataFooter의 PARENT 연결', () => {
  const m = parseOzr(read('MESDEV_CCC.ozr'));
  const header1 = m.bands.find((b) => b.name === 'DataHeaderBand1');
  assert.equal(header1.bandTypeName, 'DataHeader');
  assert.equal(header1.parent, 'DataBand2');

  const footer = m.bands.find((b) => b.name === 'DataFooterBand2');
  assert.equal(footer.bandTypeName, 'DataFooter');
  assert.equal(footer.parent, 'DataBand5');

  const band5 = m.bands.find((b) => b.name === 'DataBand5');
  assert.equal(band5.headerBandName, 'DataHeaderBand2');
  assert.equal(band5.footerBandName, 'DataFooterBand2');
});

test('MESDEV_CCC.ozr: 숫자 FORMAT과 ONESHAPE 라벨', () => {
  const m = parseOzr(read('MESDEV_CCC.ozr'));
  const band1 = m.bands.find((b) => b.name === 'DataBand1');
  const fmtCell = band1.items[0].cells.find((c) => c.name === 'FixedTableLabel97');
  assert.equal(fmtCell.style.format, '#,##0.#');
  assert.equal(fmtCell.binding.colName, 'CCA_CB_PT_MAX');

  const headerBand = m.bands.find((b) => b.name === 'DataHeaderBand1');
  const shape = headerBand.items[0];
  assert.equal(shape.type, 'label');
  assert.match(shape.text, /이중배관/);
});

test('OZODILIST: ODI 참조·데이터셋·파라미터 기본값', () => {
  const cov = parseOzr(read('MESDEV_COV.ozr'));
  assert.equal(cov.odiRefs.length, 1);
  assert.equal(cov.odiRefs[0].name, 'MESDEV_COV');
  assert.equal(cov.odiRefs[0].odiFileName, 'MESDEV_COV.odi');
  assert.deepEqual(cov.odiRefs[0].dataSets, ['SQL_']);
  assert.deepEqual(cov.odiRefs[0].params, [
    { name: 'factoryCode', value: 'PL01' },
    { name: 'fgSn', value: 'WIH252480' },
  ]);

  const ccc = parseOzr(read('MESDEV_CCC.ozr'));
  assert.deepEqual(ccc.odiRefs[0].dataSets, ['SQL_HEADER', 'SQL_DATA_1', 'SQL_DATA_2', 'SQL_DATA_3', 'SQL_DATA_4', 'SQL_DATA_5']);
  assert.equal(ccc.odiRefs[0].params.find((p) => p.name === 'operCode').value, 'CCA');
});

test('샘플 3종 모두 경고 없이 파싱된다', () => {
  for (const name of ['MESDEV_COV.ozr', 'MESDEV_CCA.ozr', 'MESDEV_CCC.ozr']) {
    const m = parseOzr(read(name));
    assert.deepEqual(m.warnings, [], name);
  }
});

test('미지 밴드타입/요소는 경고로 수집하고 파싱은 성공한다', () => {
  const xml = `<?xml version="1.0"?>
<OZREPORT PAPERWIDTH="595" PAPERHEIGHT="842">
<VERSION VERSION="5.1"/>
<REPORTINFO NAME="R1">
  <OZBAND NAME="B1" BANDTYPE="42"><OZCHART NAME="Chart1"/></OZBAND>
</REPORTINFO>
</OZREPORT>`;
  const m = parseOzr(xml);
  assert.equal(m.bands.length, 1);
  assert.equal(m.bands[0].bandTypeName, 'Unknown(42)');
  assert.equal(m.warnings.length, 2);
  assert.match(m.warnings[0], /BANDTYPE=42/);
  assert.match(m.warnings[1], /OZCHART/);
});
