# oz-report

FORCS OZ Report 파일(`.ozr` 레포트 양식, `.odi` 데이터 정의)을 임포트해 웹에서 렌더링하기 위한 모듈.
설계 배경과 단계별 계획은 [docs/plan/oz-report-import-render-plan.md](../docs/plan/oz-report-import-render-plan.md) 참고.

## 현재 상태

- **P1 파서** ✅ — 컨테이너 추출, ODI/OZR 파서, 유틸(색·JDBC 타입·플레이스홀더)
- **P2 정적 렌더러** ✅ — 밴드 배치 엔진(Y-오프셋 재계산) + 절대배치 HTML 출력. 샘플 3종 육안 검수용 렌더 확인
- **P3 데이터 바인딩** ✅ — JSON 주입 모드, 행 반복(밴드 실측 높이), 그룹핑 병합(DATATYPE=6), 룩업(DATATYPE=7), 숫자 FORMAT(DecimalFormat 서브셋), NULLTYPE 빈칸
- **P4 임포트 파이프라인 + 데모 UI** ✅ — 파일 기반 레지스트리(`ReportStore`), OZR↔ODI 자동 매칭·버저닝, HTTP API + 웹 데모(업로드/목록/파라미터/렌더)
- **P6 인쇄/PDF** ✅ — 페이지 분할 엔진(REPEATNUM 상한·빈 괘선 채움, PageHeader/FIXEDTITLE 헤더 반복, PageFooter 하단 고정, 페이지 내 그룹핑 병합), print CSS(@page), CLI `--pdf`
- P5(선택) DB 직결 — 미착수 (대상 시스템·접속 정보 확정 후)

## PDF/인쇄 출력

```bash
# 페이지 분할 HTML (인쇄 미리보기 — @media print 포함)
node oz-report/cli.js 파일.ozr --render out.html --paged --data 데이터.json

# PDF 저장 (Chromium 필요: devDependency playwright-core, 실행 파일은 OZ_CHROMIUM로 지정 가능)
node oz-report/cli.js 파일.ozr --pdf out.pdf --data 데이터.json
```

인쇄 규칙: Title은 첫 페이지에만, PageHeader는 매 페이지 반복, PageFooter는 매 페이지 하단 고정.
데이터밴드는 REPEATNUM(예: CCA 38행/페이지)을 상한으로 흘리고, 페이지가 넘어가면
`FIXEDTITLE=true`인 밴드의 헤더를 다시 그린다. 마지막 페이지의 남는 행은 빈 괘선으로
채워 양식을 완성한다(`fillRepeat: false`로 끌 수 있음). 그룹핑 병합은 페이지 안에서만 한다.

## 데모 실행

```bash
npm run demo            # http://localhost:3465 (저장소: oz-report/demo/data/)
node oz-report/demo/server.js 8080 /path/to/data   # 포트/저장소 지정
```

브라우저에서 `.ozr`/`.odi`를 업로드하면 파일명 베이스 기준으로 짝을 맞춰 등록된다
(예: `MESDEV_CCA.ozr` + `MESDEV_CCA.odi` → 한 엔트리). OZR의 `OZODILIST`가 참조하는
ODI가 없으면 경고가 표시된다. 데이터는 JSON 주입 모드로 렌더한다(DB 직결은 P5).

HTTP API:

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/reports` | 목록 (상태·버전·경고 수) |
| `POST` | `/api/reports/import?filename=x.ozr` | raw 바이트 업로드 (파일당 1건) |
| `GET` | `/api/reports/:id` | 상세 + 파라미터 정의 |
| `POST` | `/api/reports/:id/render` | `{data, showBindings}` → HTML |
| `DELETE` | `/api/reports/:id` | 삭제 |

## 사용법

```js
const { parseOzr, parseOdi, parseAny, renderOzrToHtml, buildLayout } = require('./oz-report');

const ozr = parseOzr(fs.readFileSync('MESDEV_CCA.ozr'));
// ozr.bands       — 문서 순서의 밴드 목록 (type, 좌표, 데이터소스, 셀…)
// ozr.odiRefs     — 참조 ODI와 파라미터 기본값
// ozr.warnings    — 미지원 요소/코드 경고 (파싱은 계속됨)

const odi = parseOdi(fs.readFileSync('MESDEV_CCA.odi'));
// odi.params      — 파라미터 정의 (이름, JDBC 타입, 기본값)
// odi.datasets    — 데이터셋별 SQL·플레이스홀더·필드 스키마

// 데이터 바인딩 렌더 (JSON 주입 모드): 데이터셋 이름 → 행 배열
const data = {
  SQL_HEADER: [{ TRACKING_NO: 'T-0000-000', FG_SN: 'WIH000000' }],
  SQL_DATA: [{ INSP_GROUP: '외관', INSP_NAME: '표면 스크래치 확인', INSP_RESULT: '■OK □NG' }],
};
const { html, layout } = renderOzrToHtml(ozr, { data, showBindings: true });
// html            — 독립 실행 HTML 문서 (절대배치, 인라인 CSS)
// layout          — 밴드별 런타임 top/height와 배치된 요소 목록
// data 미제공 데이터셋의 밴드는 정적(템플릿 1회) 폴백, showBindings면 ⟨데이터셋.컬럼⟩ 표시
```

수동 확인용 CLI:

```bash
node oz-report/cli.js <파일.ozr|파일.odi> [--json]
node oz-report/cli.js <파일.ozr> --render [출력.html] [--bindings] [--data 데이터.json]
# --bindings: 미해석 바인딩 셀에 ⟨데이터셋.컬럼⟩ 표시
# --data: {"데이터셋": [행...]} JSON 주입 (예시: test/fixtures/MESDEV_CCA.data.json)
```

테스트:

```bash
npm test
```

## 설계 메모

- **관대한 파서**: 모르는 요소/코드를 만나면 `warnings`에 남기고 계속 진행한다. 임포트 실패로 만들지 않는다.
- **밴드 배치**: 파일의 밴드 TOP은 디자인 시점 값이라 쓰지 않고, 문서 순서대로 높이를 누적해 재계산한다(플랜 5.1 A-1). 정적 배치에서 누적값이 디자인 TOP과 일치하는 것을 회귀 테스트로 고정했다.
- **셀 좌표는 밴드 기준**: OZTABLELABEL의 LEFT/TOP에는 소속 테이블의 오프셋이 이미 포함돼 있다(CCC FixedTable3에서 확인). 테이블은 그룹핑 용도로만 취급한다.
- **VIRTUALX/Y는 좌표에 미적용**: 샘플 3종 모두 콘텐츠 폭 555pt가 A4 콘텐츠 영역과 정확히 일치 — 배율을 곱하면 오히려 어긋난다. 디자이너 화면 줌으로 판단(A-2), 추가 샘플로 검증 유지.
- **0.25pt 헤어라인**: CSS `max(w pt, 1px)`로 최소 1px 보정(A-3).
- **행 반복 간격 = 템플릿 콘텐츠 높이**: 밴드 디자인 높이(페이지 채움용)가 아니라 항목 최하단으로 계산한다. AUTOSIZE 여부와 무관하게 실측 높이를 밴드 높이로 쓴다(1행짜리 COV에서도 디자인 높이와 일치 확인).
- **빈 데이터셋 = 0행**: 밴드 높이 0으로 접힌다. REPEATNUM 기준 빈 괘선 채움(B-3)은 인쇄(P6)에서 다룬다.
- **그룹핑 병합 기준**: 연속(rowIndex 인접) + 동일 값. GROUPINGRULE 코드별 세부 의미는 원본 출력물 대조로 확정 예정(D항).
- **자격증명 미적재**: ODI의 `USERNAME`/`PASSWORD`/`ENCYPW`는 의도적으로 모델에 싣지 않는다. DB 접속 정보는 실행 환경 설정에서만 온다.
- **플레이스홀더는 문자열 치환 문법**: `#OZParam.x#`를 그대로 치환해 실행하면 SQL 인젝션에 노출된다. 실행 계층(P5)에서 반드시 바인드 파라미터로 재작성한다.

## 테스트 픽스처 주의

`test/fixtures/`의 샘플은 실제 MES 레포트 사본에서 **사내 DB 서버 주소와 커넥션 풀 별칭을 마스킹한 것**이다
(서버 주소 → `192.0.2.10`(문서화용 예약 대역), 별칭 → `DBPOOL`).
마스킹하지 않은 원본 `.ozr`/`.odi`를 이 저장소에 커밋하지 말 것.
