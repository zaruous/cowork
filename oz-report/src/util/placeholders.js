'use strict';

// ODI 쿼리의 파라미터 플레이스홀더: `#OZParam.이름#` (구분 문자는 OZDATAMODULE@PARAMETERFLAG, 기본 '#').
// 문자열 치환 문법이므로 실행 시에는 반드시 바인드 파라미터로 재작성해야 한다(플랜 4장).

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * SQL에서 참조하는 OZParam 파라미터 이름 목록(중복 제거, 등장 순서 유지)을 추출한다.
 * @param {string} sql
 * @param {string} flag 파라미터 구분 문자 (기본 '#')
 * @returns {string[]}
 */
function extractPlaceholders(sql, flag = '#') {
  const f = escapeRegExp(flag);
  const re = new RegExp(`${f}OZParam\\.(\\w+)${f}`, 'g');
  const seen = new Set();
  const names = [];
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      names.push(m[1]);
    }
  }
  return names;
}

module.exports = { extractPlaceholders };
