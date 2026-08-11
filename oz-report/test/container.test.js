'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseContainer } = require('../src/container');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name));

test('모든 픽스처의 컨테이너 종류를 식별한다', () => {
  const expected = {
    'MESDEV_COV.ozr': 'ozr',
    'MESDEV_CCA.ozr': 'ozr',
    'MESDEV_CCC.ozr': 'ozr',
    'MESDEV_CCA.odi': 'odi',
    'MESDEV_CCC.odi': 'odi',
  };
  for (const [name, kind] of Object.entries(expected)) {
    const c = parseContainer(read(name));
    assert.equal(c.kind, kind, name);
    assert.ok(c.headerBytes > 0, `${name}: 헤더가 있어야 함`);
    assert.ok(c.xml.startsWith('<?xml'), `${name}: XML 본문 시작`);
  }
});

test('OZR 헤더 뒤 XML이 온전히 추출된다', () => {
  const c = parseContainer(read('MESDEV_COV.ozr'));
  assert.match(c.xml, /<OZREPORT /);
  assert.match(c.xml, /<\/OZREPORT>\s*$/);
});

test('매직 바이트가 다르면 거부한다', () => {
  assert.throws(() => parseContainer(Buffer.from('PNG\x05\x01<?xml version="1.0"?><a/>')), /매직 바이트/);
});

test('XML 본문이 없으면 거부한다', () => {
  assert.throws(() => parseContainer(Buffer.from('OZR\x05\x01\x00\x01\x0e\x00\x00OZ Report File....')), /XML 본문/);
});
