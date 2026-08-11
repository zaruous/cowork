'use strict';

// OZ 파일 컨테이너: [매직 3B "OZR"|"ODI"] [버전/플래그 바이트] [설명 문자열] [XML 본문]
// 헤더를 정밀 해석하지 않고 매직 검증 후 첫 `<?xml`부터 본문으로 취급한다(플랜 2.1).

const MAGIC_KINDS = { OZR: 'ozr', ODI: 'odi' };

/**
 * @param {Buffer|Uint8Array|string} input 파일 전체 바이트
 * @returns {{kind: 'ozr'|'odi', headerBytes: number, xml: string}}
 */
function parseContainer(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 8) throw new Error('OZ 컨테이너로 보기에 파일이 너무 짧습니다');

  const magic = buf.subarray(0, 3).toString('latin1');
  const kind = MAGIC_KINDS[magic];
  if (!kind) {
    throw new Error(`OZ 컨테이너가 아닙니다 (매직 바이트: ${JSON.stringify(magic)})`);
  }

  const xmlStart = buf.indexOf('<?xml');
  if (xmlStart < 0) throw new Error('컨테이너에서 XML 본문(<?xml)을 찾지 못했습니다');

  return {
    kind,
    headerBytes: xmlStart,
    xml: buf.subarray(xmlStart).toString('utf8'),
  };
}

module.exports = { parseContainer };
