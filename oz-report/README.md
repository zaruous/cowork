# oz-report

FORCS OZ Report 파일(`.ozr` 레포트 양식, `.odi` 데이터 정의)을 임포트해 웹에서 렌더링하기 위한 모듈.
설계 배경과 단계별 계획은 [docs/plan/oz-report-import-render-plan.md](../docs/plan/oz-report-import-render-plan.md) 참고.

## 현재 상태

- **P1 파서** ✅ — 컨테이너 추출, ODI/OZR 파서, 유틸(색·JDBC 타입·플레이스홀더)
- P2 렌더러(정적) / P3 데이터 바인딩 / P4 임포트 파이프라인+UI — 미착수

## 사용법

```js
const { parseOzr, parseOdi, parseAny } = require('./oz-report');

const ozr = parseOzr(fs.readFileSync('MESDEV_CCA.ozr'));
// ozr.bands       — 문서 순서의 밴드 목록 (type, 좌표, 데이터소스, 셀…)
// ozr.odiRefs     — 참조 ODI와 파라미터 기본값
// ozr.warnings    — 미지원 요소/코드 경고 (파싱은 계속됨)

const odi = parseOdi(fs.readFileSync('MESDEV_CCA.odi'));
// odi.params      — 파라미터 정의 (이름, JDBC 타입, 기본값)
// odi.datasets    — 데이터셋별 SQL·플레이스홀더·필드 스키마
```

수동 확인용 CLI:

```bash
node oz-report/cli.js <파일.ozr|파일.odi> [--json]
```

테스트:

```bash
npm test
```

## 설계 메모

- **관대한 파서**: 모르는 요소/코드를 만나면 `warnings`에 남기고 계속 진행한다. 임포트 실패로 만들지 않는다.
- **자격증명 미적재**: ODI의 `USERNAME`/`PASSWORD`/`ENCYPW`는 의도적으로 모델에 싣지 않는다. DB 접속 정보는 실행 환경 설정에서만 온다.
- **플레이스홀더는 문자열 치환 문법**: `#OZParam.x#`를 그대로 치환해 실행하면 SQL 인젝션에 노출된다. 실행 계층(P5)에서 반드시 바인드 파라미터로 재작성한다.

## 테스트 픽스처 주의

`test/fixtures/`의 샘플은 실제 MES 레포트 사본에서 **사내 DB 서버 주소와 커넥션 풀 별칭을 마스킹한 것**이다
(서버 주소 → `192.0.2.10`(문서화용 예약 대역), 별칭 → `DBPOOL`).
마스킹하지 않은 원본 `.ozr`/`.odi`를 이 저장소에 커밋하지 말 것.
