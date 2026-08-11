'use strict';

const { parseContainer } = require('./src/container');
const { parseOdi } = require('./src/odi/parser');
const { parseOzr } = require('./src/ozr/parser');
const { argbIntToCss } = require('./src/util/color');
const { extractPlaceholders } = require('./src/util/placeholders');
const { jdbcTypeName } = require('./src/util/jdbc-types');

/**
 * 확장자를 모를 때: 컨테이너 종류를 보고 알맞은 파서로 위임한다.
 * @param {Buffer|Uint8Array} input
 * @returns {{kind: 'ozr'|'odi', model: object}}
 */
function parseAny(input) {
  const { kind } = parseContainer(input);
  return { kind, model: kind === 'ozr' ? parseOzr(input) : parseOdi(input) };
}

module.exports = {
  parseContainer,
  parseOdi,
  parseOzr,
  parseAny,
  argbIntToCss,
  extractPlaceholders,
  jdbcTypeName,
};
