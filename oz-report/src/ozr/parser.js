'use strict';

// OZR(OZ Report form) 파서 — 플랜 2.3의 관찰 스펙 기준(포맷 버전 5.1 샘플).
// 밴드/셀의 문서 순서를 보존하고, 미지 요소·미지 코드는 warnings에 수집한 뒤 계속 진행한다.

const { parseContainer } = require('../container');
const xml = require('../xml');

const BAND_TYPE_NAMES = {
  1: 'PageHeader',
  2: 'Title',
  4: 'Data',
  5: 'DataHeader',
  7: 'DataFooter',
  9: 'PageFooter',
  101: 'Background',
  103: 'Foreground',
};

const BAND_TAGS = new Set(['OZBAND', 'OZDATABAND', 'OZBACKBAND', 'OZFOREBAND']);

// OZDATABAND@SUBDATALIST 등 목록 속성의 커스텀 구분자 (플랜 5.1 D항)
const LIST_SEPARATOR = '#%$oz*&^';

// 셀 바인딩 DATATYPE 관찰값 (플랜 2.3)
const DATA_TYPE_NAMES = {
  2: 'field', // 현재 행 필드
  6: 'groupField', // 그룹핑 필드 (GROUPINGRULE로 병합)
  7: 'lookupField', // 다른 데이터셋 단건 조회 (헤더/푸터)
};

/**
 * @param {Buffer|Uint8Array|string} input .ozr 파일 바이트(컨테이너 포함) 또는 XML 문자열
 * @returns {object} OzrModel
 */
function parseOzr(input) {
  const xmlText = toXmlText(input, 'ozr');
  const doc = xml.parseXml(xmlText);
  const warnings = [];

  const root = xml.findFirst(doc, 'OZREPORT');
  if (!root) throw new Error('OZR에서 OZREPORT 루트를 찾지 못했습니다');
  const ra = xml.attrs(root);

  const versionEl = xml.firstChild(root, 'VERSION');
  const basicLabel = xml.firstChild(root, 'BASICLABEL');
  const reportInfo = xml.firstChild(root, 'REPORTINFO');
  if (!reportInfo) throw new Error('OZR에서 REPORTINFO를 찾지 못했습니다');
  const ria = xml.attrs(reportInfo);

  const model = {
    version: versionEl
      ? { version: xml.str(xml.attrs(versionEl), 'VERSION'), date: xml.str(xml.attrs(versionEl), 'DATE') }
      : null,
    report: {
      name: xml.str(ria, 'NAME'),
      page: {
        paperWidth: xml.num(ra, 'PAPERWIDTH'),
        paperHeight: xml.num(ra, 'PAPERHEIGHT'),
        width: xml.num(ra, 'WIDTH'),
        height: xml.num(ra, 'HEIGHT'),
        margins: {
          left: xml.num(ra, 'LEFTMARGIN'),
          top: xml.num(ra, 'TOPMARGIN'),
          right: xml.num(ra, 'RIGHTMARGIN'),
          bottom: xml.num(ra, 'BOTTOMMARGIN'),
        },
        // A-2: 배율 편차(COV 0.7 vs CCA/CCC 1.1) — 렌더러가 좌표 변환에 사용
        virtualX: xml.num(ra, 'VIRTUALX', 1),
        virtualY: xml.num(ra, 'VIRTUALY', 1),
        mapMode: xml.num(ra, 'MAPMODE'),
      },
      language: xml.str(ra, 'Language'),
      subDataList: splitList(xml.str(ria, 'SUBDATALIST', '')),
    },
    // BASICLABEL: 셀이 속성을 생략했을 때 적용되는 기본 스타일(테두리 0.25pt, 폰트 등)
    defaults: {
      label: basicLabel ? parseCellStyle(xml.attrs(basicLabel)) : null,
    },
    bands: [],
    odiRefs: [],
    warnings,
  };

  // 밴드는 REPORTINFO 안(대부분)과 OZREPORT 직속(PageFooter 등) 양쪽에 나타난다 — 문서 순서 유지
  for (const child of xml.children(reportInfo)) {
    collectBand(child, 'reportinfo', model, warnings);
  }
  for (const child of xml.children(root)) {
    const tag = xml.tagName(child);
    if (BAND_TAGS.has(tag)) collectBand(child, 'root', model, warnings);
  }

  const odiList = xml.firstChild(root, 'OZODILIST');
  if (odiList) parseOdiList(odiList, model);

  return model;
}

function collectBand(node, scope, model, warnings) {
  const tag = xml.tagName(node);
  if (!tag) return;
  if (!BAND_TAGS.has(tag)) {
    warnings.push(`미지원 요소를 건너뜀: REPORTINFO > ${tag}`);
    return;
  }
  const a = xml.attrs(node);
  const bandType = xml.num(a, 'BANDTYPE');
  const bandTypeName = BAND_TYPE_NAMES[bandType];
  if (!bandTypeName) warnings.push(`알 수 없는 BANDTYPE=${bandType} (밴드 ${xml.str(a, 'NAME')})`);

  const band = {
    tag,
    scope, // 'reportinfo' | 'root'
    name: xml.str(a, 'NAME'),
    bandType,
    bandTypeName: bandTypeName || `Unknown(${bandType})`,
    left: xml.num(a, 'LEFT', 0),
    top: xml.num(a, 'TOP', 0), // A-1: 디자인 시점 값 — 렌더러가 재계산해야 함
    width: xml.num(a, 'WIDTH'),
    height: xml.num(a, 'HEIGHT'),
    count: xml.num(a, 'COUNT'),
    parent: xml.str(a, 'PARENT'),
    items: [],
  };

  if (tag === 'OZDATABAND') {
    Object.assign(band, {
      odiName: xml.str(a, 'ODINAME'),
      dataSourceName: xml.str(a, 'DATASOURCENAME'),
      repeatNum: xml.num(a, 'REPEATNUM'), // B-3: 페이지당 고정 행수
      autoSize: xml.bool(a, 'AUTOSIZE', false),
      fixedTitle: xml.bool(a, 'FIXEDTITLE', false), // B-4: 페이지 넘김 시 헤더 재출력
      master: xml.str(a, 'MASTER'),
      headerBandName: xml.str(a, 'HEADERBANDNAME'),
      footerBandName: xml.str(a, 'FOOTERBANDNAME'),
      subDataList: splitList(xml.str(a, 'SUBDATALIST', '')),
    });
  }

  for (const child of xml.children(node)) {
    const childTag = xml.tagName(child);
    if (!childTag) continue;
    if (childTag === 'OZTABLESTATIC') band.items.push(parseTable(child, model, warnings));
    else if (childTag === 'ONESHAPE') band.items.push(parseShape(child));
    else warnings.push(`미지원 요소를 건너뜀: ${band.name} > ${childTag}`);
  }

  model.bands.push(band);
}

function parseTable(node, model, warnings) {
  const a = xml.attrs(node);
  const table = {
    type: 'table',
    name: xml.str(a, 'NAME'),
    left: xml.num(a, 'LEFT', 0),
    top: xml.num(a, 'TOP', 0),
    width: xml.num(a, 'WIDTH'),
    height: xml.num(a, 'HEIGHT'),
    cells: [],
  };
  for (const child of xml.children(node)) {
    const tag = xml.tagName(child);
    if (!tag) continue;
    if (tag === 'OZTABLELABEL') table.cells.push(parseCell(child, model, warnings));
    else warnings.push(`미지원 요소를 건너뜀: ${table.name} > ${tag}`);
  }
  return table;
}

function parseCell(node, model, warnings) {
  const a = xml.attrs(node);
  const dataType = xml.num(a, 'DATATYPE');

  let binding = null;
  if (dataType !== undefined) {
    const dataTypeName = DATA_TYPE_NAMES[dataType];
    if (!dataTypeName) warnings.push(`알 수 없는 DATATYPE=${dataType} (셀 ${xml.str(a, 'NAME')})`);
    binding = {
      dataType,
      dataTypeName: dataTypeName || `unknown(${dataType})`,
      odiName: xml.str(a, 'ODINAME'),
      datasetName: xml.str(a, 'DATASETNAME'),
      colName: xml.str(a, 'COLNAME'),
      nullType: xml.num(a, 'NULLTYPE'),
      groupingRule: xml.num(a, 'GROUPINGRULE'), // B-1: 연속 동일값 병합
      fixedNewPage: xml.bool(a, 'FIXEDNEWPAGE', false), // B-2: 그룹 변경 시 개페이지
    };
  }

  return {
    name: xml.str(a, 'NAME'),
    left: xml.num(a, 'LEFT', 0),
    top: xml.num(a, 'TOP', 0),
    width: xml.num(a, 'WIDTH'),
    height: xml.num(a, 'HEIGHT'),
    tableIndex: parseTableIndex(xml.str(a, 'TABLEINDEX')),
    text: xml.textOf(node) || null,
    binding,
    style: parseCellStyle(a),
  };
}

function parseShape(node) {
  const a = xml.attrs(node);
  return {
    type: 'label',
    name: xml.str(a, 'NAME'),
    left: xml.num(a, 'LEFT', 0),
    top: xml.num(a, 'TOP', 0),
    width: xml.num(a, 'WIDTH'),
    height: xml.num(a, 'HEIGHT'),
    text: xml.textOf(node) || null,
    style: parseCellStyle(a),
  };
}

function parseCellStyle(a) {
  return {
    bgColor: xml.num(a, 'BGCOLOR'),
    fgColor: xml.num(a, 'FGCOLOR'),
    transparent: xml.bool(a, 'TRANSPARENT'),
    font: {
      name: xml.str(a, 'FONTNAME'),
      size: xml.num(a, 'FONTSIZE'),
      style: xml.num(a, 'FONTSTYLE'), // 0=일반, 1=굵게 (관찰 기준)
    },
    hAlign: xml.num(a, 'HALIGN'),
    vAlign: xml.num(a, 'VALIGN'),
    borders: {
      // 면별 선폭(pt). 0.25 헤어라인 주의 — A-3
      left: xml.num(a, 'DRAWLEFT'),
      top: xml.num(a, 'DRAWTOP'),
      right: xml.num(a, 'DRAWRIGHT'),
      bottom: xml.num(a, 'DRAWBOTTOM'),
    },
    frameColors: {
      left: xml.num(a, 'FRAMECOLORLEFT'),
      top: xml.num(a, 'FRAMECOLORTOP'),
      right: xml.num(a, 'FRAMECOLORRIGHT'),
      bottom: xml.num(a, 'FRAMECOLORBOTTOM'),
    },
    padding: {
      // 셀 안쪽 텍스트 여백(pt)
      left: xml.num(a, 'LEFTMARGIN'),
      top: xml.num(a, 'TOPMARGIN'),
      right: xml.num(a, 'RIGHTMARGIN'),
      bottom: xml.num(a, 'BOTTOMMARGIN'),
    },
    autoSize: xml.bool(a, 'AUTOSIZE', false),
    autoFontSize: xml.str(a, 'AUTOFONTSIZE'), // 'smallerOnly' 관찰 — C-1
    wordWrap: xml.bool(a, 'WORDWRAP', false),
    wordWrapType: xml.num(a, 'WORDWRAPTYPE'),
    format: xml.str(a, 'FORMAT'), // DecimalFormat 패턴 — C-3
    noFrame: xml.bool(a, 'NOFRAME', false),
    // 시맨틱 미확정 속성(플랜 5.1 D) — 원시값 그대로 보존해 렌더러/검수에서 대조
    paintType: xml.num(a, 'PAINTTYPE'),
    frameCheck: xml.num(a, 'FrameCheck'),
  };
}

function parseOdiList(node, model) {
  for (const item of xml.childrenByTag(node, 'OZODIITEM')) {
    const a = xml.attrs(item);
    const ref = {
      name: xml.str(a, 'NAME'),
      category: xml.str(a, 'CATEGORY'),
      odiFileName: xml.str(a, 'ODINAME'),
      dataSets: [],
      params: [],
    };
    for (const set of xml.childrenByTag(item, 'OZFORMSET')) {
      const setName = xml.str(xml.attrs(set), 'NAME');
      if (setName === 'OZParam') {
        for (const p of xml.childrenByTag(set, 'PARAMFIELD')) {
          const pa = xml.attrs(p);
          ref.params.push({ name: xml.str(pa, 'FIELDNAME'), value: xml.str(pa, 'VALUE', '') });
        }
      } else {
        ref.dataSets.push(setName);
      }
    }
    model.odiRefs.push(ref);
  }
}

function parseTableIndex(s) {
  if (!s) return null;
  const parts = s.split(',').map((v) => Number(v.trim()));
  return parts.length === 2 && parts.every((v) => !Number.isNaN(v)) ? { col: parts[0], row: parts[1] } : null;
}

function splitList(s) {
  if (!s) return [];
  return s.split(LIST_SEPARATOR).filter(Boolean);
}

function toXmlText(input, expectedKind) {
  if (typeof input === 'string' && input.trimStart().startsWith('<?xml')) return input;
  const container = parseContainer(input);
  if (container.kind !== expectedKind) {
    throw new Error(`${expectedKind} 파일이 아닙니다 (컨테이너 종류: ${container.kind})`);
  }
  return container.xml;
}

module.exports = { parseOzr, BAND_TYPE_NAMES, DATA_TYPE_NAMES, LIST_SEPARATOR };
