'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ReportStore, sanitizeFileName } = require('../src/store');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name));

function tmpStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oz-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new ReportStore(dir);
}

test('OZR 단독 임포트: ready + 참조 ODI 미임포트 경고', (t) => {
  const store = tmpStore(t);
  const s = store.importFile('MESDEV_CCA.ozr', read('MESDEV_CCA.ozr'));
  assert.equal(s.id, 'MESDEV_CCA');
  assert.equal(s.status, 'ready');
  assert.equal(s.version, 1);
  assert.equal(s.hasOzr, true);
  assert.equal(s.hasOdi, false);
  assert.equal(s.matchWarnings.length, 1);
  assert.match(s.matchWarnings[0], /MESDEV_CCA\.odi/);
});

test('ODI 추가 임포트: 같은 엔트리로 매칭되고 경고 해소', (t) => {
  const store = tmpStore(t);
  store.importFile('MESDEV_CCA.ozr', read('MESDEV_CCA.ozr'));
  const s = store.importFile('MESDEV_CCA.odi', read('MESDEV_CCA.odi'));
  assert.equal(s.id, 'MESDEV_CCA');
  assert.equal(s.hasOzr, true);
  assert.equal(s.hasOdi, true);
  assert.equal(s.version, 2);
  assert.deepEqual(s.matchWarnings, []);
  assert.equal(store.list().length, 1);
});

test('재임포트 시 버전 증가', (t) => {
  const store = tmpStore(t);
  store.importFile('MESDEV_COV.ozr', read('MESDEV_COV.ozr'));
  const s = store.importFile('MESDEV_COV.ozr', read('MESDEV_COV.ozr'));
  assert.equal(s.version, 2);
  assert.equal(store.list().length, 1);
});

test('ODI 단독 임포트는 odi-only 상태', (t) => {
  const store = tmpStore(t);
  const s = store.importFile('MESDEV_CCC.odi', read('MESDEV_CCC.odi'));
  assert.equal(s.status, 'odi-only');
  assert.equal(s.hasOzr, false);
});

test('파라미터: ODI 있으면 타입 포함, 없으면 OZR 기본값으로 유추', (t) => {
  const store = tmpStore(t);
  store.importFile('MESDEV_CCA.ozr', read('MESDEV_CCA.ozr'));
  const fromOzr = store.params('MESDEV_CCA');
  assert.deepEqual(fromOzr.map((p) => [p.name, p.defaultValue]), [
    ['factoryCode', 'PL01'],
    ['fgSn', 'WIH252480'],
    ['operCode', 'CCA'],
  ]);
  assert.equal(fromOzr[0].typeName, null);

  store.importFile('MESDEV_CCA.odi', read('MESDEV_CCA.odi'));
  const fromOdi = store.params('MESDEV_CCA');
  assert.equal(fromOdi[0].typeName, 'VARCHAR');
});

test('비 OZ 파일은 임포트 거부', (t) => {
  const store = tmpStore(t);
  assert.throws(() => store.importFile('junk.ozr', Buffer.from('PK\x03\x04 not an oz file at all')), /매직 바이트/);
  assert.equal(store.list().length, 0);
});

test('렌더: 저장된 OZR + 주입 데이터로 HTML 생성', (t) => {
  const store = tmpStore(t);
  store.importFile('MESDEV_CCA.ozr', read('MESDEV_CCA.ozr'));
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'MESDEV_CCA.data.json'), 'utf8'));
  const { html } = store.render('MESDEV_CCA', { data });
  assert.match(html, /Controller Case Assembly/);
  assert.match(html, /표면 스크래치 확인/);
});

test('삭제: 레지스트리와 저장 파일 정리', (t) => {
  const store = tmpStore(t);
  store.importFile('MESDEV_COV.ozr', read('MESDEV_COV.ozr'));
  assert.equal(store.delete('MESDEV_COV'), true);
  assert.equal(store.list().length, 0);
  assert.equal(store.get('MESDEV_COV'), null);
  assert.equal(store.delete('MESDEV_COV'), false);
});

test('레지스트리는 재기동 후에도 유지된다', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oz-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  new ReportStore(dir).importFile('MESDEV_COV.ozr', read('MESDEV_COV.ozr'));
  const reopened = new ReportStore(dir);
  assert.equal(reopened.list().length, 1);
  const { html } = reopened.render('MESDEV_COV', { data: { SQL_: [{ PROD_GUBUN: '양산' }] } });
  assert.match(html, /양산/);
});

test('파일명 정리: 경로 성분 제거, 이상 문자 치환', () => {
  assert.equal(sanitizeFileName('../../etc/passwd.ozr'), 'passwd.ozr');
  assert.equal(sanitizeFileName('한글 리포트!.ozr'), '한글_리포트_.ozr');
  assert.throws(() => sanitizeFileName('.hidden'), /유효하지 않은 파일명/);
});
