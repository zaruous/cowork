'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseOdi } = require('../src/odi/parser');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name));

test('MESDEV_CCA.odi: 파라미터 3개와 기본값', () => {
  const m = parseOdi(read('MESDEV_CCA.odi'));
  assert.equal(m.parameterFlag, '#');
  assert.deepEqual(
    m.params.map((p) => [p.name, p.typeName, p.defaultValue]),
    [
      ['factoryCode', 'VARCHAR', 'PL01'],
      ['fgSn', 'VARCHAR', 'WIH252480'],
      ['operCode', 'VARCHAR', 'CCA'],
    ],
  );
});

test('MESDEV_CCA.odi: 데이터셋 2개(SQL_DATA, SQL_HEADER)와 필드 스키마', () => {
  const m = parseOdi(read('MESDEV_CCA.odi'));
  assert.deepEqual(m.datasets.map((d) => d.name), ['SQL_DATA', 'SQL_HEADER']);

  const data = m.datasets[0];
  assert.equal(data.storeName, 'DB_');
  assert.equal(data.fields.length, 7);
  assert.deepEqual(data.fields.map((f) => f.name).slice(0, 3), ['INSP_GROUP', 'MAT_GRP_2', 'FG_SN_OPTION']);

  const header = m.datasets[1];
  assert.equal(header.fields.length, 9);
  assert.equal(header.fields.find((f) => f.name === 'CONTROL_NO').typeName, 'LONGVARCHAR'); // TYPE=-1
});

test('MESDEV_CCA.odi: SQL 원문과 플레이스홀더 추출', () => {
  const m = parseOdi(read('MESDEV_CCA.odi'));
  const data = m.datasets.find((d) => d.name === 'SQL_DATA');
  assert.match(data.sql, /^SELECT/);
  assert.match(data.sql, /#OZParam\.fgSn#/);
  assert.deepEqual(data.placeholders, ['factoryCode', 'fgSn', 'operCode']);

  const header = m.datasets.find((d) => d.name === 'SQL_HEADER');
  // SQL_HEADER는 factoryCode, fgSn만 참조 (operCode는 리터럴 'CCA'로 박혀 있음)
  assert.deepEqual(header.placeholders, ['factoryCode', 'fgSn']);
});

test('MESDEV_CCA.odi: DB 스토어 정보(자격증명은 모델에서 제외)', () => {
  const m = parseOdi(read('MESDEV_CCA.odi'));
  assert.equal(m.dbStores.length, 1);
  const db = m.dbStores[0];
  assert.equal(db.vendor, 'mssql2008');
  assert.equal(db.useAlias, true);
  assert.equal(db.poolAlias, 'DBPOOL'); // 마스킹된 픽스처 기준
  assert.ok(!('USERNAME' in db) && !('PASSWORD' in db) && !('username' in db) && !('password' in db));
});

test('MESDEV_CCC.odi: 데이터셋 6개(SQL_HEADER + SQL_DATA_1~5)', () => {
  const m = parseOdi(read('MESDEV_CCC.odi'));
  assert.deepEqual(
    m.datasets.map((d) => d.name).sort(),
    ['SQL_DATA_1', 'SQL_DATA_2', 'SQL_DATA_3', 'SQL_DATA_4', 'SQL_DATA_5', 'SQL_HEADER'],
  );
  const d1 = m.datasets.find((d) => d.name === 'SQL_DATA_1');
  assert.equal(d1.fields.find((f) => f.name === 'CCA_CB_RUN_SEQ').typeName, 'BIGINT'); // TYPE=-5
  assert.equal(d1.fields.find((f) => f.name === 'CCA_CB_PT_MAX').typeName, 'NUMERIC'); // TYPE=2
});

test('샘플 파싱에서 경고가 발생하지 않는다', () => {
  for (const name of ['MESDEV_CCA.odi', 'MESDEV_CCC.odi']) {
    const m = parseOdi(read(name));
    assert.deepEqual(m.warnings, [], name);
  }
});

test('미지 요소는 경고로 수집하고 파싱은 성공한다', () => {
  const xml = `<?xml version="1.0"?>
<OZDATAINFO><OZDATAMODULE NAME="[OZ DATA Tree]" VERSION="1.0" PARAMETERFLAG="#">
  <OZFUTURESTORE NAME="new"/>
  <OZDBSTORE NAME="DB_" VENDOR="mssql2008"><OZWEIRD/><OZQUERY NAME="Q1">SELECT 1</OZQUERY></OZDBSTORE>
</OZDATAMODULE></OZDATAINFO>`;
  const m = parseOdi(xml);
  assert.equal(m.datasets.length, 1);
  assert.equal(m.warnings.length, 2);
  assert.match(m.warnings[0], /OZFUTURESTORE/);
  assert.match(m.warnings[1], /OZWEIRD/);
});
