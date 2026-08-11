# OZ Report(ODI/OZR) 임포트 및 렌더링 구현 플랜

> 작성일: 2026-08-11 (v2 — 실제 샘플 파일 분석 반영)
> 상태: 초안 (구현 착수 전 검토용)

## 0. v1 → v2 변경 요지

v1은 "OZR은 사양 비공개 바이너리라 자체 렌더링 불가, OZ Server + HTML5 Viewer 연동이 유일한 현실적 경로"를 전제로 했다.
**실제 샘플(MESDEV_COV.ozr, MESDEV_CCA.ozr/odi, MESDEV_CCC.ozr/odi, 포맷 버전 5.1)을 분석한 결과 이 전제가 틀렸다.**
두 파일 모두 짧은 바이너리 헤더 뒤에 **순수 XML**이 이어지는 텍스트 포맷이며, 레이아웃·데이터 바인딩·쿼리 정의가 전부 XML로 노출된다.
따라서 **자체 파서 + HTML 렌더러를 기본안으로 승격**하고, OZ Server 연동은 대안으로 강등한다.

## 1. 목표

1. `.ozr`(레포트 양식)과 `.odi`(데이터 정의) 파일을 **임포트**(업로드 → 파싱 → 레지스트리 등록)한다.
2. 임포트된 레포트를 웹 화면의 레포트 영역에 **HTML로 렌더링**한다. (파라미터 입력 → 데이터 바인딩 → 밴드 레이아웃 출력)

## 2. 샘플 분석 결과 — 파일 포맷 스펙 (관찰 기반)

### 2.1 공통 컨테이너

```
[매직 3B: "OZR" | "ODI"] [버전/플래그 7B: 05 01 00 01 0E|10 00 00]
[설명 문자열: "OZ Report File" | "OZ Document File"]
[XML 본문: <?xml version="1.0" encoding="UTF-8"?> ...]
```

파서는 헤더를 정밀 해석할 필요 없이 **첫 `<?xml` 위치부터 잘라 XML 파싱**하면 된다(관대한 접근, 헤더는 매직 3바이트만 검증).

### 2.2 ODI (`<OZDATAINFO>`) — 데이터 정의

| 요소 | 내용 |
|---|---|
| `OZPARAMETERSTORE > OZPARAMETERSET[NAME=OZParam] > PARAMFIELD` | 파라미터 정의: `NAME`, `TYPE`(JDBC 타입코드: 12=VARCHAR, 1=CHAR, 2=NUMERIC, -5=BIGINT, -1=LONGVARCHAR), 기본 `VALUE` |
| `OZDBSTORE` | DB 접속 정의: `VENDOR`(예: mssql2008), 별칭 사용 시 `POOLALIAS` + `ALIASFILENAME`(db.properties), 인코딩 등 |
| `OZDBSTORE > OZQUERY` | 데이터셋 1개 = 쿼리 1개. 요소 텍스트가 SQL 원문이며 `#OZParam.이름#` 형태의 치환 플레이스홀더 포함. `NAME`이 데이터셋 이름(SQL_DATA, SQL_HEADER 등) |
| `OZQUERY > DATAFIELD` | 결과 컬럼 스키마: `NAME`, `TYPE` |

### 2.3 OZR (`<OZREPORT>`) — 레이아웃 정의

| 요소 | 내용 |
|---|---|
| `OZREPORT` 루트 | 용지(`PAPERWIDTH/HEIGHT`, pt 단위 — 595×842=A4), 여백, `VIRTUALX/Y` 스케일, 언어 |
| `REPORTINFO > OZBAND` | 밴드. `BANDTYPE`: 1=PageHeader, 2=Title, 4=Data(`OZDATABAND`), 5=DataHeader, 7=DataFooter, 9=PageFooter, 101=Background, 103=Foreground |
| `OZDATABAND` | 반복 밴드: `ODINAME`(연결 ODI), `DATASOURCENAME`(데이터셋), `REPEATNUM`(페이지당 행수), `HEADERBANDNAME`/`FOOTERBANDNAME`, `AUTOSIZE`, `MASTER`/`SUBDATALIST` |
| `OZTABLESTATIC > OZTABLELABEL` | 절대좌표 셀: `LEFT/TOP/WIDTH/HEIGHT`(pt), 면별 테두리 `DRAWLEFT/TOP/RIGHT/BOTTOM`(선폭), `BGCOLOR/FGCOLOR`(부호 있는 32bit ARGB — -1=흰색, -16777216=검정, -4144960=회색), 폰트/정렬/`AUTOSIZE`/`WORDWRAP`, 숫자 `FORMAT`(#,##0.# 패턴) |
| 데이터 바인딩 | 셀에 `DATATYPE` + `ODINAME` + `DATASETNAME` + `COLNAME`. 관찰값 — 2: 현재 행 필드, 6: 그룹핑 필드(`GROUPINGRULE`, 병합), 7: 단건 조회 필드(헤더/푸터에서 다른 데이터셋 참조). `DATATYPE` 없음 + 요소 텍스트 = 정적 라벨 |
| `OZODILIST > OZODIITEM` | 이 레포트가 참조하는 ODI 이름·경로와 사용 데이터셋 목록, 파라미터 기본값 — **OZR↔ODI 매칭 검증과 파라미터 폼의 근거** |

### 2.4 샘플 3종 요약

| 레포트 | 내용 | 데이터셋 | 비고 |
|---|---|---|---|
| MESDEV_COV | 제작 이력표 | SQL_ 1개 | odi 미제공(OZR의 OZODILIST로 파라미터 유추 가능) |
| MESDEV_CCA | Controller Case Assembly 검사 시트 | SQL_DATA + SQL_HEADER | 그룹핑(DATATYPE=6), 헤더 단건 바인딩(DATATYPE=7) |
| MESDEV_CCC | Calibration Test | SQL_HEADER + SQL_DATA_1~5 | 다중 데이터밴드 + DataHeader/Footer, 숫자 FORMAT |

공통 파라미터: `factoryCode`, `fgSn`, `operCode`. 데이터 소스는 사내 MES MSSQL(풀 별칭 경유).

> ⚠️ **민감정보**: 샘플의 SQL에는 사내 DB 서버 주소·테이블 구조가 포함된다. **원본 샘플을 공개 레포에 커밋하지 말 것.** 테스트 픽스처는 서버 주소·별칭을 마스킹한 사본으로 만든다.

## 3. 아키텍처 결정

| 옵션 | 방식 | 판단 |
|---|---|---|
| **A. 자체 파서 + HTML 렌더러** | ODI/OZR XML을 파싱해 웹에서 직접 렌더링 | ✅ **기본안**. 포맷이 XML로 확인됐고, 샘플이 쓰는 기능(정적 테이블, 데이터밴드, 그룹핑, 숫자 포맷)은 렌더링 엔진으로 충분히 재현 가능. OZ 라이선스·서버 불필요 |
| B. OZ Server + HTML5 Viewer(ozjs) | ozr을 OZ 레포지토리에 등록하고 공식 뷰어 임베드 | 대안. 완전한 충실도가 필요하거나 A가 지원하지 않는 기능(차트·스크립트·전자서명 등)을 쓰는 레포트가 나오면 전환/병행 |
| C. 서버사이드 Export(PDF) 임베드 | OZ Export API로 변환 후 표시 | 배제(라이선스 필요 + 인터랙션 상실) |

**A안의 스코프 원칙**: 샘플에서 관찰된 요소 집합을 1차 지원 범위로 정의하고, 파서가 모르는 요소를 만나면 **경고를 남기고 건너뛰되 임포트는 성공**시킨다. 지원 범위 밖 레포트가 실무에 등장하면 그때 B안 병행을 판단한다.

## 4. 모듈 설계 (Node.js / TypeScript 기준)

```
oz-report/
├─ src/
│  ├─ container.ts      # 매직 검증 + XML 본문 추출
│  ├─ odi/parser.ts     # ODI → OdiModel {params[], datasets[{name, sql, fields[]}], dbStore}
│  ├─ ozr/parser.ts     # OZR → OzrModel {page, bands[], odiRefs[]}  (미지 요소는 warnings[]에 수집)
│  ├─ data/
│  │  ├─ provider.ts    # DataProvider 인터페이스: (datasetName, params) → rows[]
│  │  ├─ json.ts        # JSON 주입 모드 (외부에서 rows 공급 — 기본)
│  │  └─ mssql.ts       # DB 실행 모드 (선택): #OZParam.x# → 파라미터 바인딩으로 변환 후 실행
│  ├─ render/
│  │  ├─ layout.ts      # 밴드 배치 엔진 (아래 5장)
│  │  ├─ html.ts        # 레이아웃 결과 → HTML/CSS (절대배치)
│  │  └─ format.ts      # #,##0.# 숫자 패턴, NULLTYPE 처리
│  └─ index.ts
├─ demo/                 # 임포트 UI + 렌더 확인용 최소 웹앱 (Express 정적 서버)
└─ test/fixtures/        # 마스킹된 샘플 사본 + 스냅샷
```

- **임포트 파이프라인**: 업로드 → 매직/확장자 검증 → 파싱 → `OZODILIST` 기준 OZR↔ODI 매칭 검증(짝 없는 ODI 참조는 경고) → 레지스트리(JSON 또는 DB) 기록.
- **레지스트리 레코드**: `{id, name, ozrModel, odiModel?, params[], warnings[], version, importedAt}` — v1의 DB 스키마와 동일 취지, 저장소는 대상 앱 스택 확정 시 결정.
- **DB 실행 모드의 필수 안전장치**: `#OZParam.x#`는 SQL 문자열 치환 문법이므로 그대로 치환하면 SQL 인젝션에 노출된다. 반드시 플레이스홀더를 `@p1` 식 바인드 파라미터로 재작성해 실행한다. 1차 릴리스는 JSON 주입 모드만으로도 성립(데이터는 호출 측 책임).

## 5. 렌더링 엔진 설계 (핵심 로직)

1. **좌표계**: pt(1/72in) 그대로 CSS `pt` 단위 절대배치. `VIRTUALX/Y` 스케일 반영. 페이지 폭 = PAPERWIDTH − 좌우 여백.
2. **밴드 흐름**: Title/PageHeader → (DataHeader → DataBand 반복 → DataFooter) × 데이터밴드 순서 → PageFooter. 웹 뷰는 연속 스크롤을 기본으로 하고, 인쇄/PDF 시에만 `REPEATNUM`·페이지 높이 기준으로 페이지 분할 + PageHeader/Footer 반복.
3. **DataBand 반복**: `DATASOURCENAME`의 rows를 순회하며 밴드 내부 셀을 행마다 복제, `DATATYPE=2` 셀에 `COLNAME` 값 주입.
4. **그룹핑(DATATYPE=6)**: `GROUPINGRULE`에 따라 연속 동일값 셀 병합(rowspan 방식) — CCA 샘플의 '구분' 열.
5. **단건 바인딩(DATATYPE=7)**: 해당 데이터셋 첫 행의 값을 헤더/푸터 셀에 주입 — CCA/CCC의 수주번호·작업자·검사자.
6. **셀 스타일**: 면별 테두리 선폭, ARGB 정수 → CSS 색상 변환, 폰트(맑은 고딕 폴백 체인), HALIGN/VALIGN, AUTOSIZE는 1차에서 `overflow` + 폰트 축소 근사(`AUTOFONTSIZE=smallerOnly`).
7. **포맷**: `FORMAT="#,##0.#"` 등 Java DecimalFormat 서브셋 구현, `NULLTYPE=5`는 빈칸 처리(관찰 기준).

## 6. 단계별 구현 계획

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **P1. 파서** | 컨테이너 추출 + ODI/OZR 파서 + 모델 타입 | 샘플 5파일 전부 파싱 성공, 파라미터·데이터셋·밴드 구조가 모델에 정확히 적재(단위 테스트) |
| **P2. 렌더러 1차** | 정적 요소 렌더링(밴드 배치, 셀, 테두리, 폰트, 색) | COV 샘플이 데이터 없이 양식 그대로 HTML 출력, 원본 대비 육안 검수 |
| **P3. 데이터 바인딩** | JSON 주입 모드 + DATATYPE 2/6/7 + FORMAT | CCA·CCC에 목데이터 주입 시 그룹핑·헤더 바인딩·숫자 포맷 정상 |
| **P4. 임포트 파이프라인 + 데모 UI** | 업로드 API, 레지스트리, 파라미터 입력 폼(ODI 기반 자동 생성), 레포트 목록/뷰 화면 | 파일 업로드→목록→렌더까지 E2E 동작 |
| **P5. (선택) DB 실행 모드** | mssql provider, 바인드 파라미터 변환, db.properties 별칭 매핑 | 사내망에서 실데이터 렌더 확인 — **대상 시스템·접속 정보 확정 후 착수** |
| **P6. 인쇄/내보내기** | 페이지 분할, print CSS, (선택) headless Chromium PDF | A4 인쇄 미리보기가 용지 규격과 일치 |

테스트 전략: 파서 단위 테스트(정상/헤더 손상/미지 요소 XML) + 렌더 스냅샷 테스트(샘플 3종 HTML 스냅샷 고정) + 실패 주입(odi 누락 임포트 → 경고 후 성공, 파라미터 누락 렌더 → 명시적 에러).

## 7. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| 미관찰 OZR 요소(이미지, 차트, 바코드, 스크립트, 서브리포트, 크로스탭) | 해당 레포트 렌더 불완전 | 파서 warnings로 가시화, 요소별 점진 지원. 커버리지 한계가 크면 B안(OZ Server) 병행 |
| 구버전/신버전 OZR 스키마 편차 (샘플은 5.1) | 파싱 실패 | 관대한 파서(미지 속성 무시) + 버전 로깅 |
| AUTOSIZE/자동 폰트 축소의 픽셀 단위 재현 | 원본과 미세한 레이아웃 차이 | 1차는 근사 구현으로 합의, 인쇄물 검수 기준을 "정보 동일 + 배치 유사"로 설정 |
| DB 실행 모드의 인젝션·자격증명 | 보안 사고 | 바인드 파라미터 강제, 자격증명은 서버 측 설정만(파일 내 ENCYPW 등은 무시) |
| 샘플 내 사내 정보 | 정보 유출 | 원본 커밋 금지, 마스킹 픽스처만 저장 |

## 8. 선행 확인 사항

1. **대상 애플리케이션**: 렌더링이 들어갈 실제 화면/스택(현 레포는 Node CLI 도구 모음 — 데모는 여기에 두되, 실적용 대상 확정 필요)
2. **지원 범위 합의**: 실무에서 쓰는 OZR들이 샘플 수준의 기능만 쓰는지(이미지/차트/스크립트 유무) 대표 파일 몇 개 추가 확인
3. **데이터 공급 방식**: JSON 주입(호출 측이 조회)로 충분한지, DB 직결(P5)이 필요한지
4. **인쇄/PDF 요구 수준**: 화면 렌더만인지, 실제 출력물 대체인지

## 참고 자료

- 업로드 샘플: MESDEV_COV.ozr, MESDEV_CCA.ozr/.odi, MESDEV_CCC.ozr/.odi (포맷 버전 5.1)
- [FORCS HTML5 Viewer — Running Viewer (binding)](https://www.forcs.com/en/documentation-rv_dev/rv_install_run_html5js_download_binding.htm) — B안 채택 시
- [FORCS HTML5 Viewer — CreateReport 예제 (odi.* 파라미터)](https://www.forcs.com/en/documentation-rv_dev/rv_method_createreport_html5.htm) — B안 채택 시
