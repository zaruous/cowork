'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { argbIntToCss } = require('../src/util/color');
const { extractPlaceholders } = require('../src/util/placeholders');
const { jdbcTypeName } = require('../src/util/jdbc-types');

test('ARGB 정수 → CSS 색 변환 (샘플 관찰값)', () => {
  assert.equal(argbIntToCss(-1), '#ffffff'); // 흰색
  assert.equal(argbIntToCss(-16777216), '#000000'); // 검정
  assert.equal(argbIntToCss(-4144960), '#c0c0c0'); // 회색 헤더칸
  assert.equal(argbIntToCss(-65536), '#ff0000'); // 빨강 (CCA FGCOLOR)
  assert.equal(argbIntToCss(undefined), null);
  assert.equal(argbIntToCss(0x80ff0000 | 0), 'rgba(255, 0, 0, 0.502)'); // 반투명
});

test('플레이스홀더 추출: 중복 제거·등장 순서 유지', () => {
  const sql = `SELECT * FROM T WHERE A='#OZParam.factoryCode#' AND B='#OZParam.fgSn#' AND C='#OZParam.fgSn#' + '-E'`;
  assert.deepEqual(extractPlaceholders(sql), ['factoryCode', 'fgSn']);
});

test('플레이스홀더 추출: PARAMETERFLAG가 #이 아닌 경우', () => {
  assert.deepEqual(extractPlaceholders(`WHERE A='$OZParam.code$'`, '$'), ['code']);
  assert.deepEqual(extractPlaceholders(`WHERE A='#OZParam.code#'`, '$'), []);
});

test('JDBC 타입 코드 이름 변환', () => {
  assert.equal(jdbcTypeName(12), 'VARCHAR');
  assert.equal(jdbcTypeName(-5), 'BIGINT');
  assert.equal(jdbcTypeName(9999), 'TYPE(9999)');
});
