# oz-report

FORCS OZ Report 파일(`.ozr` 레포트 양식, `.odi` 데이터 정의)을 임포트해 웹에서 렌더링하기 위한 모듈.
설계 배경과 단계별 계획은 [docs/plan/oz-report-import-render-plan.md](../docs/plan/oz-report-import-render-plan.md) 참고.

## 현재 상태

- **P1 파서** ✅ — 컨테이너 추출, ODI/OZR 파서, 유틸(색·JDBC 타입·플레이스홀더)
- **P2 정적 렌더러** ✅ — 밴드 배치 엔진(Y-오프셋 재계산) + 절대배치 HTML 출력. 샘플 3종 육안 검수용 렌더 확인
- P3 데이터 바인딩 / P4 임포트 파이프라인+UI — 미착수

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

const { html, layout } = renderOzrToHtml(ozr, { showBindings: true });
// html            — 독립 실행 HTML 문서 (절대배치, 인라인 CSS)
// layout          — 밴드별 런타임 top/height와 배치된 요소 목록
```

수동 확인용 CLI:

```bash
node oz-report/cli.js <파일.ozr|파일.odi> [--json]
node oz-report/cli.js <파일.ozr> --render [출력.html] [--bindings]  # --bindings: 바인딩 셀에 ⟨데이터셋.컬럼⟩ 표시
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
- **자격증명 미적재**: ODI의 `USERNAME`/`PASSWORD`/`ENCYPW`는 의도적으로 모델에 싣지 않는다. DB 접속 정보는 실행 환경 설정에서만 온다.
- **플레이스홀더는 문자열 치환 문법**: `#OZParam.x#`를 그대로 치환해 실행하면 SQL 인젝션에 노출된다. 실행 계층(P5)에서 반드시 바인드 파라미터로 재작성한다.

## 테스트 픽스처 주의

`test/fixtures/`의 샘플은 실제 MES 레포트 사본에서 **사내 DB 서버 주소와 커넥션 풀 별칭을 마스킹한 것**이다
(서버 주소 → `192.0.2.10`(문서화용 예약 대역), 별칭 → `DBPOOL`).
마스킹하지 않은 원본 `.ozr`/`.odi`를 이 저장소에 커밋하지 말 것.
