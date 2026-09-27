# 에셋 출처 · 라이선스

**지금 이 폴더에는 그림 파일이 없다.** 무대의 모든 것 — 캐릭터 7명 · 서고 랙 · 책상 · 회의 탁자 ·
최계량 책상 · 원고 — 은 `web/js/sprites.js` 와 `renderer.js` 가 **코드로 그린다.**
그래서 배포판이 외부 파일에 의존하지 않는다 ([CLAUDE.md](../../CLAUDE.md) 절대 규칙 6).

이 문서를 남겨 두는 이유는, 외부 에셋을 **검토했고 쓰지 않기로 했다**는 기록이 필요해서다.

---

## 검토한 것 — styloo, 2D School Classroom Asset Pack

| | |
|---|---|
| 만든 이 | styloo ([styloo.itch.io](https://styloo.itch.io/2dclassroom)) |
| 라이선스 | **CC0 1.0 Universal** (퍼블릭 도메인 헌정 — 출처 표기 의무 없음) |
| 확인 방법 | 배포 페이지 `More information` → `Asset license` 필드 |
| 받은 날 | 2026-09-23 · `2dClassroomAssetPackByStyloo.zip` (108 MB, 139개 스프라이트시트) |

책장 한 컷(`Classroom First Spritesheet 2.png` 의 8방향 중 2번)을 잘라 팔레트를 바꿔 붙여 봤다가,
**서고를 벽에 붙여 한 줄로 세우고 건수만큼 높이가 자라게 바꾸면서 코드 그림으로 되돌렸다.**
높이가 데이터(문서 건수)에 따라 변해야 하는데 고정 크기 그림으로는 그게 안 된다.

원본 zip 108MB는 저장소에 담지 않는다 (`.gitignore`). 다시 필요하면 위 페이지에서 받는다.

## 조사한 팩 6개 중 캐릭터가 든 팩은 없었다

그래서 사람은 처음부터 도형이다. 자세한 조사 기록은
[docs/에셋-라이선스-조사.md](../../docs/에셋-라이선스-조사.md) 에 있다.

## 글꼴

시스템 글꼴만 쓴다 — `Pretendard` → `Malgun Gothic` → `Apple SD Gothic Neo` → `system-ui` 순으로
찾아 쓰고, 웹폰트를 내려받지 않는다 (`config.js` 의 `FONT` · `style.css` 의 `--font`).
