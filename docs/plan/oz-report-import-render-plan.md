# OZ Report(ODI/OZR) 임포트 및 렌더링 구현 플랜

> 작성일: 2026-08-11
> 상태: 초안 (구현 착수 전 검토용)

## 1. 목표

FORCS OZ Report의 두 가지 파일을 시스템으로 **임포트**하고, 웹 화면의 레포트 영역에 **렌더링**한다.

- **`.ozr` (OZ Report form)**: OZ Designer로 제작한 레포트 양식 파일. FORCS 전용 바이너리 포맷.
- **`.odi` (OZ Data Input)**: 레포트에 바인딩할 데이터셋/파라미터 정의 파일. XML 기반이라 자체 파싱 가능.

## 2. 전제와 제약 (플랜의 핵심 판단 근거)

| 항목 | 내용 |
|---|---|
| OZR 포맷 | 사양 비공개 바이너리. 자체 파서로 완전한 렌더링을 구현하는 것은 **비현실적** |
| 공식 렌더링 경로 | OZ Server(레포지토리 서버) + **HTML5 Viewer(ozjs)** 조합이 표준. 뷰어는 `connection.servlet`, `connection.reportname` 파라미터로 서버의 ozr을 로드 |
| ODI 바인딩 | 뷰어 파라미터 `odi.odinames`, `odi.<name>.pcount`, `odi.<name>.args…` 로 데이터 입력값을 주입 |
| 라이선스 | OZ Server / HTML5 Viewer 는 FORCS 라이선스 필요. 사내 보유 라이선스·서버 주소 확인이 선행 과제 |

### 아키텍처 옵션 비교

| 옵션 | 방식 | 장점 | 단점 | 판단 |
|---|---|---|---|---|
| **A. OZ Server + HTML5 Viewer 연동** | 임포트한 ozr/odi를 OZ 레포지토리에 등록하고, 화면에는 HTML5 Viewer를 임베드 | 완전한 렌더링 충실도, 공식 지원, 인쇄/내보내기 무료 획득 | OZ Server 필요(라이선스), 서버 등록 API 연동 필요 | ✅ **권장 (기본안)** |
| B. 서버사이드 Export 임베드 | OZ Export/Scheduler API로 ozr+데이터를 PDF·HTML로 변환 후 iframe/뷰어에 표시 | 클라이언트 의존성 없음, 캐싱 용이 | 인터랙션(입력·검색·페이지 내 동작) 상실, 변환 지연 | 대량 배치·미리보기 용도의 **보조안** |
| C. 자체 파서 렌더링 | ODI(XML)만 파싱, OZR은 리버스 엔지니어링 | 외부 의존 없음 | OZR 완전 렌더링 불가능, 유지보수 리스크 극대 | ❌ 배제. 단, ODI 파서는 메타데이터 추출용으로 **부분 채택** |

**결론: A안을 기본으로 하되, ODI XML 파서는 자체 구현하여 임포트 시 메타데이터(데이터셋·파라미터 목록) 추출·검증에 사용한다.**

## 3. 전체 아키텍처

```
[사용자] ──(ozr/odi 업로드)──▶ [Import API]
                                  │ 1. 확장자/시그니처 검증
                                  │ 2. ODI XML 파싱 → 데이터셋/파라미터 메타 추출
                                  │ 3. 파일 저장 + 메타 DB 기록
                                  │ 4. OZ 레포지토리 등록(카테고리/경로 매핑)
                                  ▼
                          [Report Registry(DB)]
                                  │
[레포트 화면] ◀─(목록/메타 조회)──┘
      │
      └─ HTML5 Viewer(ozjs) 임베드
          • connection.servlet = OZ 서버 servlet URL
          • connection.reportname = 등록된 ozr 경로
          • odi.* 파라미터 = 임포트한 ODI 메타 + 사용자 입력값
```

## 4. 데이터 모델 (Report Registry)

```
reports
├─ id            PK
├─ name          표시명
├─ ozr_path      OZ 레포지토리 내 경로 (예: /imported/{id}/report.ozr)
├─ ozr_file      원본 보관 경로(또는 blob)
├─ odi_meta      JSON — ODI에서 추출한 데이터셋/파라미터 정의
│                예: [{ dataset: "sales", params: [{name, type, required}] }]
├─ version       재임포트 시 증가
├─ status        imported | registered | failed
└─ created_at / updated_at / created_by
```

## 5. API 설계

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/reports/import` | multipart 업로드(ozr 필수, odi 선택). 검증→파싱→저장→OZ 등록까지 수행, 실패 단계 포함한 결과 반환 |
| `GET` | `/api/reports` | 임포트된 레포트 목록 + 상태 |
| `GET` | `/api/reports/{id}` | 상세(odi_meta 포함) — 화면에서 파라미터 입력 폼 생성에 사용 |
| `GET` | `/api/reports/{id}/render-config` | 뷰어 임베드에 필요한 `connection.*`, `odi.*` 파라미터 세트 반환 |
| `DELETE` | `/api/reports/{id}` | 등록 해제 + 파일 정리 |

## 6. 단계별 구현 계획

### Phase 1 — 임포트 파이프라인 (백엔드)
1. **파일 수신·검증**
   - 확장자(.ozr/.odi) + 파일 시그니처 검사, 용량 제한, 파일명 정규화(경로 조작 방지)
   - ozr 단독 임포트 허용, odi는 선택(없으면 파라미터 없는 레포트로 취급)
2. **ODI 파서 구현**
   - XML 파싱으로 데이터셋 이름, 필드, 파라미터(이름/타입/필수 여부) 추출 → `odi_meta` JSON 생성
   - 스키마가 예상과 다른 버전 대비: 파싱 실패 시에도 임포트는 성공시키고 `odi_meta=null` + 경고 기록
3. **저장 및 레지스트리 기록**: 원본 보관 + `reports` 레코드 생성
4. **OZ 레포지토리 등록**
   - OZ Server의 레포지토리 업로드 방식(관리 API 또는 파일시스템 공유 경로) 확인 후 자동 등록
   - 등록 실패 시 `status=failed` + 재시도 액션 제공

**산출물**: import API, ODI 파서(+단위 테스트), 레지스트리 테이블

### Phase 2 — 렌더링 (프론트엔드)
1. **뷰어 임베드 컴포넌트**
   - `<div id="OZViewer">` 컨테이너 + ozjs 스크립트 로드, `SetOZParamters` 콜백에서 `connection.servlet` / `connection.reportname` 설정 후 `start_ozjs()` 호출
   - render-config API 응답을 그대로 파라미터로 변환하는 얇은 래퍼로 구현 (뷰어 API 버전 변화에 대비해 한 곳에 격리)
2. **파라미터 입력 폼**: `odi_meta` 기반으로 동적 생성 → `odi.<dataset>.args` 형식으로 뷰어에 전달
3. **로딩/에러 UX**: OZ 서버 미응답, 레포트 미등록, 파라미터 누락 각각 구분된 메시지

**산출물**: 뷰어 래퍼 컴포넌트, 레포트 목록/상세 화면

### Phase 3 — 데이터 바인딩 & 재임포트
1. ODI 파라미터 → 실제 데이터 소스 연결 검증(OZ 서버 측 DataModule 설정과 대조)
2. 동일 이름 재임포트 시 버전 증가 + 이전 버전 조회 유지
3. (보조안 B) 인쇄·공유용 PDF Export 엔드포인트 — 필요 시점에 착수

### Phase 4 — 테스트 & 마감
- ODI 파서 단위 테스트(정상/변형/손상 XML)
- 임포트 E2E: 업로드 → 등록 → 뷰어 렌더 확인 (샘플 ozr/odi 픽스처 확보 필요)
- 실패 주입 테스트: OZ 서버 다운, 중복 임포트, 대용량 파일

## 7. 선행 확인 사항 (착수 전 답이 필요한 질문)

1. **대상 애플리케이션**: 이 기능이 들어갈 실제 프로젝트/스택 확인 — 현재 coworks 레포에는 웹 앱이 없으므로, 대상 저장소가 별도로 존재한다면 이 플랜의 API/컴포넌트 명세를 해당 스택(Java/Spring, Node 등)에 맞춰 구체화해야 함
2. **OZ Server 접근 정보**: servlet URL, 레포지토리 등록 방법(관리 API vs 공유 디렉터리), 뷰어 라이선스 범위
3. **OZ 버전**: HTML5 Viewer(ozjs) 지원 버전인지, ODI 스키마 버전
4. **샘플 파일**: 실제 사용할 ozr/odi 샘플 각 1개 이상 (파서·E2E 테스트 픽스처)

## 8. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| OZ Server 레포지토리 자동 등록 API 부재 | Phase 1-4 지연 | 공유 디렉터리 배치 방식으로 대체, 수동 등록 절차 문서화 |
| ODI 스키마 버전 편차 | 파라미터 폼 오생성 | 파싱 실패를 임포트 실패로 만들지 않는 관대한 파서 + 경고 노출 |
| 뷰어 API 변경 | 렌더 컴포넌트 수정 | 뷰어 호출을 단일 래퍼에 격리 |
| 라이선스 미보유 시나리오 | 렌더링 자체 불가 | B안(Export 임베드) 또는 라이선스 확보로 전환 판단 |

## 참고 자료

- [FORCS HTML5 Viewer — Running Viewer (binding)](https://www.forcs.com/en/documentation-rv_dev/rv_install_run_html5js_download_binding.htm)
- [FORCS HTML5 Viewer — CreateReport 예제 (odi.* 파라미터)](https://www.forcs.com/en/documentation-rv_dev/rv_method_createreport_html5.htm)
- [OZ e-Form Developer — Viewer In HTML](https://edu.ozeform.io/e-form-developer/day-3/viewer-in-html)
