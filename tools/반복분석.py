#!/usr/bin/env python3
"""녹화를 모아 세고, 사전등록한 판정 규칙을 **그대로** 적용한다.

    python tools/반복분석.py              # 표 전체
    python tools/반복분석.py --h1          # H1 판정만
    python tools/반복분석.py --지표 편중    # 다른 지표로 표를 본다

왜 스크립트인가 — 손으로 세면 셀 때마다 기준이 흔들린다. 실제로 한 번
`q1-반려`(사람이 목차를 반려해 다시 짠 실행)를 집계에 넣은 채 결론을 냈고,
빼고 다시 세니 q1-기본이 34.6이 아니라 61.8이었다. 그 규칙을 코드로 박아 둔다.

판정 규칙은 `docs/사전등록.md` 에 **녹화 전에** 적어 둔 것과 같아야 한다.
여기 숫자를 고치고 싶어지면, 그것은 결과를 보고 규칙을 바꾸는 것이다 — 하지 마라.
"""
import argparse
import json
import re
import statistics as st
import sys
from pathlib import Path

# Windows 기본 콘솔은 cp949 라 「—」 같은 글자에서 죽는다.
# 검사 도구가 검사 결과 대신 인코딩 오류를 뱉으면 안 되므로 출력만 UTF-8 로 돌린다.
for _스트림 in (sys.stdout, sys.stderr):
    if hasattr(_스트림, "reconfigure"):
        _스트림.reconfigure(encoding="utf-8", errors="replace")


ROOT = Path(__file__).resolve().parent.parent
REPLAY = ROOT / "web" / "replay"

# 사전등록한 것 (docs/사전등록.md — H1)
H1_질문 = ("q2", "q5")
H1_칸 = ("기본", "역할끔")
H1_지표 = "근거율"


def 녹화들():
    """(질문, 칸, 회차, 지표) 를 뽑는다. 반려된 실행은 뺀다 — 조건이 다르다."""
    out = []
    for f in sorted(REPLAY.glob("*.json")):
        if f.stem == "index":
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("rejected"):
            continue
        m = None
        for e in d["events"]:
            if e["type"] == "evaluate.done":
                m = e["metrics"]
        if not m:
            continue                         # 끝까지 못 간 녹화
        # q2-역할끔-3 → 질문 q2 · 칸 역할끔 · 회차 3
        # `q2-측면` 은 설정이 `q2-기본` 과 완전히 같다(축은 편집장이 고른 결과다).
        # 그래도 **따로 센다** — 사전등록 표가 「q2-기본 이미 1편」 으로 적혀 있고,
        # 잡음은 새로 뜨는 3회짜리 칸에서 구하기로 했기 때문이다. 합치면 규칙이 달라진다.
        조각 = f.stem.split("-")
        질문 = 조각[0]
        회차 = int(조각[-1]) if 조각[-1].isdigit() else 1
        칸 = "-".join(조각[1:-1] if 조각[-1].isdigit() else 조각[1:]) or "기본"
        # 세대 — 손으로 표시하지 않고 **설정 열쇠로** 가른다.
        # 「인용0곳점검」이 들어오기 전에 뜬 녹화는 ④ 점검이 자기신고만 보던 시절 것이라
        # 같은 칸에 섞으면 안 된다 (docs/사전등록.md 「고친 기록」).
        세대 = "새" if "인용0곳점검" in (d.get("settings") or {}) else "옛"
        out.append({"파일": f.stem, "질문": 질문, "칸": 칸, "회차": 회차, "세대": 세대,
                    "질문글": d.get("question", ""), "지표": m,
                    "사전등록": d.get("사전등록") or {}})
    return out


def 칸모음(rows, 지표):
    """{(질문, 칸): [값, …]}"""
    d = {}
    for r in rows:
        v = r["지표"].get(지표)
        if v is None:
            continue
        d.setdefault((r["질문"], r["칸"]), []).append(v)
    return d


def 표(rows, 지표):
    칸들 = sorted({r["칸"] for r in rows}, key=lambda c: (c != "기본", c))
    질문들 = sorted({r["질문"] for r in rows})
    모음 = 칸모음(rows, 지표)
    폭 = max(10, max((len(c) for c in 칸들), default=10) + 2)
    print(f"\n── {지표} ──  (n>1 이면 중앙값, 괄호는 최대−최소)")
    print("질문".ljust(6) + "".join(c.rjust(폭) for c in 칸들))
    for q in 질문들:
        줄 = q.ljust(6)
        for c in 칸들:
            vs = 모음.get((q, c))
            if not vs:
                줄 += "—".rjust(폭)
            elif len(vs) == 1:
                줄 += f"{vs[0]:.1f}".rjust(폭)
            else:
                줄 += f"{st.median(vs):.1f}({max(vs)-min(vs):.1f})".rjust(폭)
        print(줄)
    n = {(q, c): len(모음.get((q, c), [])) for q in 질문들 for c in 칸들}
    print("\n칸별 편수: " + " · ".join(f"{q}-{c}×{v}" for (q, c), v in sorted(n.items()) if v))


def h1(rows):
    """사전등록한 판정 규칙을 그대로 돌린다 (docs/사전등록.md)."""
    새것 = [r for r in rows if r["세대"] == "새"]
    옛것 = len(rows) - len(새것)
    모음 = 칸모음(새것, H1_지표)
    print(f"\n── H1 — 명찰(역할)을 끄면 {H1_지표}이 오른다 ──")
    print(f"   대상 {' · '.join(H1_질문)} × {' / '.join(H1_칸)} · 칸당 3회")
    if 옛것:
        print(f"   옛 코드 {옛것}편 제외 — 인용0곳점검이 없던 시절 실행이라 같은 칸이 아니다")

    # 반복분으로 뜬 녹화가 어느 사전등록 아래였나 — 해시가 녹화보다 앞서야 뜻이 있다
    도장 = {}
    for r in 새것:
        if r["회차"] > 1 and r["질문"] in H1_질문:
            for k, v in (r["사전등록"] or {}).items():
                도장.setdefault(k, set()).add(v)
    for k, v in sorted(도장.items()):
        상태 = next(iter(v)) if len(v) == 1 else f"⚠ 녹화마다 다르다 — {sorted(v)}"
        print(f"   사전등록 {k}  {상태 or '⚠ 도장이 비었다'}")

    부족 = [(q, c) for q in H1_질문 for c in H1_칸 if len(모음.get((q, c), [])) < 3]
    폭들, 차이들 = [], {}
    for q in H1_질문:
        기, 역 = 모음.get((q, H1_칸[0]), []), 모음.get((q, H1_칸[1]), [])
        if not 기 or not 역:
            continue
        for vs in (기, 역):
            if len(vs) > 1:
                폭들.append(max(vs) - min(vs))
        차이들[q] = st.median(역) - st.median(기)
        print(f"   {q}  기본 {st.median(기):5.1f} (n={len(기)})   "
              f"역할끔 {st.median(역):5.1f} (n={len(역)})   차이 {차이들[q]:+5.1f}")

    if 부족:
        print("\n   ⏳ 아직 판정하지 않는다 — 3회가 안 찬 칸: "
              + ", ".join(f"{q}-{c}" for q, c in 부족))
        print("      (사전등록에는 칸당 3회로 적혀 있다. 모자란 채로 판정하면 사전등록이 무의미하다)")
        return

    잡음 = st.mean(폭들) if 폭들 else 0.0
    print(f"\n   잡음 = 칸별 (최대−최소) 평균 = {잡음:.1f}%p")
    모두큼 = all(abs(d) > 잡음 for d in 차이들.values())
    부호같음 = len({d > 0 for d in 차이들.values()}) == 1
    if not 부호같음:
        판정, 할일 = "H1 기각", "기본값을 켠 채 둔다"
    elif 모두큼 and all(d > 0 for d in 차이들.values()):
        판정, 할일 = "H1 채택", '설정["역할"] 기본값을 끔으로 바꾼다 (명찰 UI 는 남긴다)'
    else:
        판정, 할일 = "판단 보류", "기본값을 켠 채 두고, 못 정했다고 적는다"
    print(f"   → **{판정}** — {할일}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--지표", default="근거율")
    ap.add_argument("--h1", action="store_true")
    a = ap.parse_args()

    rows = 녹화들()
    if not rows:
        sys.exit(f"녹화가 없습니다: {REPLAY}")
    print(f"녹화 {len(rows)}편 (반려 제외)")
    if not a.h1:
        표(rows, a.지표)
    h1(rows)


if __name__ == "__main__":
    main()
