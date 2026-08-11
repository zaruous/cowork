'use strict';

// 임포트 파이프라인 + 레지스트리 (플랜 4장, P4).
//
// 임포트 단위는 "레포트 이름"(파일명 베이스)이다. 같은 이름의 ozr/odi가 한 엔트리로
// 묶이고(OZR↔ODI 매칭), 어느 쪽이든 재임포트하면 version이 올라간다.
// 저장소는 디렉터리 하나: files/에 원본 사본, registry.json에 메타.
// 검증 실패(비 OZ 파일)만 임포트를 거부하고, 매칭 불일치 등은 경고로 남긴다(관대한 방침).

const fs = require('fs');
const path = require('path');
const { parseContainer } = require('./container');
const { parseOdi } = require('./odi/parser');
const { parseOzr } = require('./ozr/parser');
const { renderOzrToHtml } = require('./render/html');

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 업로드 상한 20MB

class ReportStore {
  /** @param {string} dir 레지스트리 디렉터리 (없으면 생성) */
  constructor(dir) {
    this.dir = dir;
    this.filesDir = path.join(dir, 'files');
    this.registryPath = path.join(dir, 'registry.json');
    fs.mkdirSync(this.filesDir, { recursive: true });
    this.registry = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
    } catch {
      return [];
    }
  }

  _save() {
    fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
  }

  /**
   * 파일 하나(ozr 또는 odi)를 임포트한다.
   * @param {string} fileName 원본 파일명 (경로 무시)
   * @param {Buffer} buffer 파일 바이트
   * @returns {object} 갱신된 엔트리 요약
   */
  importFile(fileName, buffer) {
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error(`파일이 너무 큽니다 (${buffer.length} > ${MAX_FILE_BYTES} 바이트)`);
    }
    const safeName = sanitizeFileName(fileName);
    const { kind } = parseContainer(buffer); // 비 OZ 파일이면 여기서 거부
    const model = kind === 'ozr' ? parseOzr(buffer) : parseOdi(buffer);

    const base = safeName.replace(/\.(ozr|odi)$/i, '');
    let entry = this.registry.find((e) => e.name.toLowerCase() === base.toLowerCase());
    if (!entry) {
      entry = {
        id: uniqueId(base, this.registry),
        name: base,
        version: 0,
        ozr: null,
        odi: null,
        createdAt: new Date().toISOString(),
      };
      this.registry.push(entry);
    }

    fs.writeFileSync(this._filePath(entry.id, kind), buffer);

    if (kind === 'ozr') {
      entry.ozr = {
        fileName: safeName,
        reportName: model.report.name,
        formatVersion: model.version?.version || null,
        bands: model.bands.length,
        odiRefs: model.odiRefs.map((r) => ({
          name: r.name,
          odiFileName: r.odiFileName,
          dataSets: r.dataSets,
          params: r.params,
        })),
        warnings: model.warnings,
        importedAt: new Date().toISOString(),
      };
    } else {
      entry.odi = {
        fileName: safeName,
        params: model.params.map((p) => ({
          name: p.name,
          typeName: p.typeName,
          defaultValue: p.defaultValue,
        })),
        datasets: model.datasets.map((d) => ({
          name: d.name,
          placeholders: d.placeholders,
          fieldCount: d.fields.length,
          fields: d.fields.map((f) => f.name),
        })),
        warnings: model.warnings,
        importedAt: new Date().toISOString(),
      };
    }

    entry.version += 1;
    this._refresh(entry);
    this._save();
    return this._summary(entry);
  }

  /** 매칭 검증(OZODILIST 기준)과 상태 갱신 */
  _refresh(entry) {
    const warnings = [];
    if (entry.ozr) {
      const expected = entry.ozr.odiRefs.map((r) => r.odiFileName).filter(Boolean);
      if (expected.length > 0 && !entry.odi) {
        warnings.push(`참조 ODI 미임포트: ${expected.join(', ')} — 파라미터 정의 없이 데이터 주입 렌더만 가능`);
      }
      if (entry.odi && expected.length > 0) {
        const got = entry.odi.fileName.toLowerCase();
        if (!expected.some((e) => e.toLowerCase() === got)) {
          warnings.push(`ODI 파일명 불일치: OZR은 ${expected.join(', ')}을(를) 참조하는데 ${entry.odi.fileName}이(가) 임포트됨`);
        }
      }
    }
    entry.status = entry.ozr ? 'ready' : 'odi-only';
    entry.matchWarnings = warnings;
  }

  list() {
    return this.registry.map((e) => this._summary(e));
  }

  get(id) {
    const entry = this._find(id);
    return entry ? JSON.parse(JSON.stringify(entry)) : null;
  }

  delete(id) {
    const idx = this.registry.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    for (const kind of ['ozr', 'odi']) {
      try {
        fs.unlinkSync(this._filePath(id, kind));
      } catch {
        /* 없으면 무시 */
      }
    }
    this.registry.splice(idx, 1);
    this._save();
    return true;
  }

  /**
   * 렌더에 쓸 파라미터 정의: ODI가 있으면 ODI 기준, 없으면 OZR의 OZODILIST 기본값으로 유추.
   */
  params(id) {
    const entry = this._find(id);
    if (!entry) return null;
    if (entry.odi) return entry.odi.params;
    if (entry.ozr) {
      return entry.ozr.odiRefs.flatMap((r) =>
        r.params.map((p) => ({ name: p.name, typeName: null, defaultValue: p.value })),
      );
    }
    return [];
  }

  /** 저장된 OZR을 파싱해 돌려준다 (렌더/검사용) */
  loadOzrModel(id) {
    const entry = this._find(id);
    if (!entry || !entry.ozr) throw new Error(`OZR이 없는 레포트입니다: ${id}`);
    return parseOzr(fs.readFileSync(this._filePath(id, 'ozr')));
  }

  /**
   * @param {string} id
   * @param {object} [opts] renderOzrToHtml 옵션 ({data, showBindings, title})
   * @returns {{html: string, layout: object}}
   */
  render(id, opts = {}) {
    const entry = this._find(id);
    if (!entry) throw new Error(`레포트를 찾을 수 없습니다: ${id}`);
    const model = this.loadOzrModel(id);
    return renderOzrToHtml(model, { title: entry.name, ...opts });
  }

  _find(id) {
    return this.registry.find((e) => e.id === id) || null;
  }

  _filePath(id, kind) {
    return path.join(this.filesDir, `${id}.${kind}`);
  }

  _summary(entry) {
    return {
      id: entry.id,
      name: entry.name,
      status: entry.status,
      version: entry.version,
      hasOzr: !!entry.ozr,
      hasOdi: !!entry.odi,
      reportName: entry.ozr?.reportName || null,
      paramCount: (entry.odi?.params || entry.ozr?.odiRefs.flatMap((r) => r.params) || []).length,
      warningCount:
        (entry.matchWarnings?.length || 0) +
        (entry.ozr?.warnings.length || 0) +
        (entry.odi?.warnings.length || 0),
      matchWarnings: entry.matchWarnings || [],
      createdAt: entry.createdAt,
    };
  }
}

/** 경로 조작 방지: 디렉터리 성분 제거 + 허용 문자만 남김 */
function sanitizeFileName(name) {
  const base = path.basename(String(name));
  const safe = base.replace(/[^\w.\-가-힣]/g, '_');
  if (!safe || safe.startsWith('.')) throw new Error(`유효하지 않은 파일명: ${name}`);
  return safe;
}

function uniqueId(base, registry) {
  let id = base.replace(/[^\w.\-가-힣]/g, '_');
  let n = 1;
  while (registry.some((e) => e.id === id)) {
    n += 1;
    id = `${base}-${n}`;
  }
  return id;
}

module.exports = { ReportStore, sanitizeFileName, MAX_FILE_BYTES };
