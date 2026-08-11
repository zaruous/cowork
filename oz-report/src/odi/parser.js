'use strict';

// ODI(OZ Data Input) 파서 — 플랜 2.2의 관찰 스펙 기준.
// <OZDATAINFO><OZDATAMODULE> 아래에서 파라미터셋, DB 스토어, 데이터셋(쿼리+필드)을 추출한다.
// 미지 요소는 warnings에 수집하고 파싱은 계속한다(관대한 파서 방침).

const { parseContainer } = require('../container');
const xml = require('../xml');
const { jdbcTypeName } = require('../util/jdbc-types');
const { extractPlaceholders } = require('../util/placeholders');

// 샘플에서 관찰된, 파서가 의미를 아는 스토어 태그들
const KNOWN_MODULE_CHILDREN = new Set([
  'OZPARAMETERSTORE',
  'OZFILESTORE',
  'OZHTTPSTORE',
  'OZDBSTORE',
  'OZINCLUDESTORE',
  'OZQUERYDESIGNERINFO',
]);

/**
 * @param {Buffer|Uint8Array|string} input .odi 파일 바이트(컨테이너 포함) 또는 XML 문자열
 * @returns {import('./model').OdiModel}
 */
function parseOdi(input) {
  const xmlText = toXmlText(input, 'odi');
  const doc = xml.parseXml(xmlText);
  const warnings = [];

  const module_ = xml.findFirst(doc, 'OZDATAMODULE');
  if (!module_) throw new Error('ODI에서 OZDATAMODULE을 찾지 못했습니다');
  const modAttrs = xml.attrs(module_);
  const parameterFlag = xml.str(modAttrs, 'PARAMETERFLAG', '#');

  const model = {
    version: xml.str(modAttrs, 'VERSION'),
    parameterFlag,
    ignoreNullData: xml.bool(modAttrs, 'IGNORENULLDATA'),
    params: [],
    dbStores: [],
    datasets: [],
    warnings,
  };

  for (const child of xml.children(module_)) {
    const tag = xml.tagName(child);
    if (!tag) continue;
    if (!KNOWN_MODULE_CHILDREN.has(tag)) {
      warnings.push(`미지원 요소를 건너뜀: OZDATAMODULE > ${tag}`);
      continue;
    }
    if (tag === 'OZPARAMETERSTORE') parseParameterStore(child, model);
    else if (tag === 'OZDBSTORE') parseDbStore(child, model, parameterFlag, warnings);
    else if (tag === 'OZFILESTORE' || tag === 'OZHTTPSTORE') {
      // 샘플에서는 항상 비어 있음. 데이터셋이 들어 있으면 아직 지원하지 않는 기능이다.
      if (xml.children(child).some((c) => xml.tagName(c))) {
        warnings.push(`미지원 데이터 스토어에 정의가 있어 무시함: ${tag}[NAME=${xml.str(xml.attrs(child), 'NAME')}]`);
      }
    }
    // OZINCLUDESTORE / OZQUERYDESIGNERINFO: 디자이너 메타 — 렌더링에 불필요, 무시
  }

  return model;
}

function parseParameterStore(store, model) {
  for (const set of xml.childrenByTag(store, 'OZPARAMETERSET')) {
    const setName = xml.str(xml.attrs(set), 'NAME');
    for (const field of xml.childrenByTag(set, 'PARAMFIELD')) {
      const a = xml.attrs(field);
      const jdbcType = xml.num(a, 'TYPE');
      model.params.push({
        setName,
        name: xml.str(a, 'NAME'),
        jdbcType,
        typeName: jdbcTypeName(jdbcType),
        defaultValue: xml.str(a, 'VALUE', ''),
        description: xml.str(a, 'DESCRIPTION', ''),
      });
    }
  }
}

function parseDbStore(store, model, parameterFlag, warnings) {
  const a = xml.attrs(store);
  const storeName = xml.str(a, 'NAME');
  model.dbStores.push({
    name: storeName,
    vendor: xml.str(a, 'VENDOR'),
    useAlias: xml.bool(a, 'USEALIAS', false),
    poolAlias: xml.str(a, 'POOLALIAS', ''),
    aliasFileName: xml.str(a, 'ALIASFILENAME', ''),
    serverAddress: xml.str(a, 'serverAddress', ''),
    dbName: xml.str(a, 'dbName', ''),
    encodeCharset: xml.str(a, 'ENCODECHARSET', ''),
    decodeCharset: xml.str(a, 'DECODECHARSET', ''),
    // 주의: USERNAME/PASSWORD/ENCYPW는 의도적으로 모델에 싣지 않는다.
    // 자격증명은 실행 환경 설정에서만 오도록 한다(플랜 7장 보안 항목).
  });

  for (const child of xml.children(store)) {
    const tag = xml.tagName(child);
    if (!tag) continue;
    if (tag !== 'OZQUERY') {
      warnings.push(`미지원 요소를 건너뜀: OZDBSTORE[${storeName}] > ${tag}`);
      continue;
    }
    const qa = xml.attrs(child);
    const sql = xml.textOf(child);
    model.datasets.push({
      name: xml.str(qa, 'NAME'),
      storeName,
      sql,
      placeholders: extractPlaceholders(sql, parameterFlag),
      maxRow: xml.num(qa, 'MAXROW', 0),
      fields: xml.childrenByTag(child, 'DATAFIELD').map((f) => {
        const fa = xml.attrs(f);
        const jdbcType = xml.num(fa, 'TYPE');
        return {
          name: xml.str(fa, 'NAME'),
          jdbcType,
          typeName: jdbcTypeName(jdbcType),
        };
      }),
    });
  }
}

function toXmlText(input, expectedKind) {
  if (typeof input === 'string' && input.trimStart().startsWith('<?xml')) return input;
  const container = parseContainer(input);
  if (container.kind !== expectedKind) {
    throw new Error(`${expectedKind} 파일이 아닙니다 (컨테이너 종류: ${container.kind})`);
  }
  return container.xml;
}

module.exports = { parseOdi };
