# 🔗 LinkMap — 나의 소개 연결망 관리 앱

한화손해보험 FP(보험 설계사)를 위한 소개 네트워크 영업 관리 PWA입니다.

## 핵심 기능

| 기능 | 설명 |
|---|---|
| 🕸 소개 연결망 시각화 | Canvas 포스 시뮬레이션으로 소개 관계를 화살표 네트워크로 표시 |
| ⭐ 허브 고객 자동 감지 | 소개 2명 이상 시 자동 강조 표시 |
| 🔔 연락 타이밍 알림 | 기준일(10·15·30일·직접입력) 설정 후 자동 알림 |
| 📅 일정 관리 | 달력 기반 미팅 일정 등록·관리 |
| 💬 오프닝 스크립트 | 관계 유형별 소개 요청 멘트 자동 제공 |
| 🔍 커뮤니티 검색 | 활동 지역 기반 맘카페·동호회 등 6종 즉시 검색 |
| 📊 3종 백업 | Excel · PDF · JSON 형식 내보내기 및 복원 |

## 보안

- **AES-GCM 256bit 암호화** — localStorage 데이터 전체 암호화
- **민감정보 입력 차단** — 주민번호·전화번호·이메일 실시간 감지 및 차단
- **개발자도구 억제** — F12·우클릭·단축키 차단, DevTools 감지 시 화면 블러
- **내보내기 보안** — 메모 마스킹 옵션, 보안 경고 확인 절차

## 파일 구조

```
├── index.html      # 시작(로그인) 화면
├── app.html        # 메인 앱 화면
├── app.js          # 앱 로직 전체
├── style.css       # 공통 스타일
├── sw.js           # Service Worker (웹 푸시 알림 + 오프라인 캐시)
├── manifest.json   # PWA 설정
├── icon-192.png    # 앱 아이콘 (192×192)
└── icon-512.png    # 앱 아이콘 (512×512)
```

## 기술 스택

- **언어**: Vanilla JS (ES2022+) · HTML5 · CSS3
- **그래프**: Canvas 2D API — Force-directed Graph 직접 구현 (외부 라이브러리 Zero)
- **저장**: Web localStorage + AES-GCM Web Crypto API
- **배포**: GitHub Pages (서버 비용 Zero)
- **PWA**: Web App Manifest · Service Worker

## 배포 방법

1. 이 레포를 fork 또는 clone
2. GitHub 레포 → Settings → Pages → Branch: main / (root) 저장
3. `https://{username}.github.io/{repo-name}/` 으로 접속

---

> ⚠ 본 앱은 내부 영업관리 전용 도구입니다. 개인정보 보호를 위해 실명 대신 별칭 사용을 권장합니다.
