'use strict';

// fast-xml-parser preserveOrder 모드 래퍼.
// preserveOrder 노드 형태: { <태그명>: [자식...], ':@': {속성} } 또는 { '#text': '...' }
// 밴드/셀의 문서 순서가 레이아웃 의미를 가지므로 순서 보존이 필수다.

const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
});

function parseXml(xml) {
  return parser.parse(xml);
}

function tagName(node) {
  for (const k of Object.keys(node)) {
    if (k !== ':@' && k !== '#text') return k;
  }
  return null;
}

function attrs(node) {
  return node[':@'] || {};
}

function children(node) {
  const t = tagName(node);
  return t ? node[t] : [];
}

function childrenByTag(node, tag) {
  return children(node).filter((c) => tagName(c) === tag);
}

function firstChild(node, tag) {
  return children(node).find((c) => tagName(c) === tag) || null;
}

/** 요소 직속 텍스트 노드들을 이어붙인다 (OZQUERY의 SQL 본문 등 혼합 콘텐츠용) */
function textOf(node) {
  return children(node)
    .filter((c) => '#text' in c)
    .map((c) => String(c['#text']))
    .join('');
}

/** 문서 트리에서 태그명이 일치하는 첫 요소를 깊이 우선으로 찾는다 */
function findFirst(nodes, tag) {
  for (const n of nodes) {
    if ('#text' in n) continue;
    if (tagName(n) === tag) return n;
    const found = findFirst(children(n), tag);
    if (found) return found;
  }
  return null;
}

// ---- 속성 값 변환 헬퍼 ----

function str(a, name, def = undefined) {
  return name in a ? String(a[name]) : def;
}

function num(a, name, def = undefined) {
  if (!(name in a) || a[name] === '') return def;
  const v = Number(a[name]);
  return Number.isNaN(v) ? def : v;
}

function bool(a, name, def = undefined) {
  if (!(name in a)) return def;
  return String(a[name]).toLowerCase() === 'true';
}

module.exports = {
  parseXml,
  tagName,
  attrs,
  children,
  childrenByTag,
  firstChild,
  textOf,
  findFirst,
  str,
  num,
  bool,
};
