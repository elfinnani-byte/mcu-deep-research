#!/usr/bin/env python3
"""팀과 혼자를 나란히 놓는다 (과제 필수 ④ · 15강).

    python tools/팀대혼자.py

**못 재는 것을 0으로 적지 않는다.** 혼자 하는 쪽은 절이 하나뿐이라 「인용 0곳인 절」·
「겹쳐 읽음」이 성립하지 않고, 「편집장이 본 글」은 정의상 100%다. 그 셋은 표에서 빼고
왜 뺐는지 적는다 — 0으로 적어 두면 혼자가 이긴 것처럼 보인다.

이 표는 **숫자로 거른 것**일 뿐이다. 어느 쪽이 나은지는 읽고 정한다 (16강).
"""
import json
import statistics as st
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
견줄것 = ("근거율", "편중", "허위인용", "출처불일치", "읽은문서수", "인용수", "보고서자수")


def 팀(qid: str):
    """같은 세대(인용0곳점검 이후)의 기본 녹화들 — 여럿이면 중앙값."""
    뽑 = []
    for p in sorted((ROOT / "web" / "replay").glob(f"{qid}-기본*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        if "인용0곳점검" not in (d.get("settings") or {}):
            continue
        m = next((e["metrics"] for e in d["events"] if e["type"] == "evaluate.done"), None)
        if m:
            뽑.append((p.stem, m))
    if not 뽑:                                        # 새 세대가 없으면 옛 것을 쓰되 밝힌다
        for p in sorted((ROOT / "web" / "replay").glob(f"{qid}-기본*.json")):
            d = json.loads(p.read_text(encoding="utf-8"))
            m = next((e["metrics"] for e in d["events"] if e["type"] == "evaluate.done"), None)
            if m:
                뽑.append((p.stem + " (옛 코드)", m))
    return 뽑


def main() -> int:
    대조 = sorted((ROOT / "runs").glob("대조군-*.json"))
    if not 대조:
        sys.exit("runs/대조군-*.json 이 없다 — 먼저 python -u server/baseline.py --전부")

    print(f"{'질문':6s}{'지표':10s}{'팀':>9s}{'혼자':>9s}{'이긴 쪽':>9s}   팀 녹화")
    이김 = {"팀": 0, "혼자": 0, "무": 0}
    for f in 대조:
        solo = json.loads(f.read_text(encoding="utf-8"))
        qid = solo["질문id"]
        뽑 = 팀(qid)
        if not 뽑:
            print(f"{qid:6s}  팀 녹화 없음")
            continue
        이름 = ", ".join(n for n, _ in 뽑)
        for k in 견줄것:
            값들 = [m[k] for _, m in 뽑 if k in m] or [0]
            t = st.median(값들)
            s = solo["metrics"].get(k, 0)
            클수록 = k not in ("편중", "허위인용", "출처불일치")
            승 = "무" if t == s else ("팀" if (t > s) == 클수록 else "혼자")
            # **차이만 보면 또 속는다.** 팀 칸이 여러 편이면 그 안의 흔들림 폭을 같이 보인다.
            # 차이가 그 폭보다 작으면 이긴 것이 아니라 못 가른 것이다.
            폭 = max(값들) - min(값들) if len(값들) > 1 else None
            판 = 승
            if 폭 is not None and abs(t - s) <= 폭:
                판 = f"{승}(잡음내)"
            else:
                이김[승] += 1
            꼬리 = f"   폭 {폭:.1f}" if 폭 is not None else ""
            print(f"{qid:6s}{k:10s}{t:>9.1f}{s:>9.1f}{판:>11s}{꼬리}"
                  + (f"   {이름}" if k == 견줄것[0] else ""))
        print()
    print("이긴 횟수 (잡음 밖만) — " + " · ".join(f"{k} {v}" for k, v in 이김.items()))
    print("   팀 칸이 1편뿐인 질문은 폭을 못 재므로 그대로 셌다 — 그것도 못 믿는다")

    print("\n뺀 지표와 이유")
    for k, v in json.loads(
            (ROOT / "runs" / 대조[0].name).read_text(encoding="utf-8")).get("견줄수있나", {}).items():
        if v.startswith("아니오"):
            print(f"   {k:8s} {v}")
    print("\n⚠ 이 표는 숫자로 거른 것일 뿐이다. 어느 쪽이 나은지는 읽고 정한다 (16강).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
