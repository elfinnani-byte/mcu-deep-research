#!/usr/bin/env python3
"""녹화 폴더를 훑어 `web/replay/index.json` 을 다시 만든다.

    python tools/녹화목록.py            # 다시 만든다
    python tools/녹화목록.py --확인      # 달라진 게 있으면 1번으로 끝낸다 (고치지 않는다)

이 파일이 없던 동안 `index.json` 은 손으로 관리됐다. 녹화를 8편 더 뜰 참이라
그대로 두면 목록과 폴더가 조용히 어긋난다.

질문의 **유형**과 **「왜 나눌 만한가」** 는 `data/questions.json` 에서 가져다 붙인다.
화면이 그것을 「여기서 볼 것」으로 보여 주므로, 질문을 고치면 화면도 따라온다.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPLAY = ROOT / "web" / "replay"
스위치 = ("배정", "구역", "역할", "재위임")      # 순서가 곧 표시 순서다 (ui.js 의 변형키)


def 한편(p: Path, 질문표: dict) -> dict:
    d = json.loads(p.read_text(encoding="utf-8"))
    축, m = "?", {}
    for e in d["events"]:
        if e["type"] == "plan.done":
            축 = e.get("axis", "?")
        if e["type"] == "evaluate.done":
            m = e["metrics"]
    q = 질문표.get(d.get("question", ""), {})
    row = {
        "name": d.get("name") or p.stem,
        "question": d.get("question", ""),
        "axis": 축,
        "rejected": bool(d.get("rejected")),
        "off": [k for k in 스위치 if d.get("settings", {}).get(k) is False],
        "metrics": {k: m.get(k) for k in
                    ("근거율", "허위인용", "편중", "중복률", "인용0절") if k in m},
    }
    if q:                                        # 질문 세트가 아는 질문일 때만 붙인다
        row["유형"] = q["유형"]
        row["여기서볼것"] = q["왜 나눌 만한가"]
    return row


def 만들기() -> dict:
    질문표 = {q["질문"]: q for q in
              json.loads((ROOT / "data/questions.json").read_text(encoding="utf-8"))["질문"]}
    편 = [한편(p, 질문표) for p in sorted(REPLAY.glob("*.json")) if p.stem != "index"]
    return {"replays": 편}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--확인", action="store_true", help="고치지 않고 어긋났는지만 본다")
    a = ap.parse_args()

    새 = 만들기()
    대상 = REPLAY / "index.json"
    옛 = json.loads(대상.read_text(encoding="utf-8")) if 대상.exists() else None

    모름 = [r["name"] for r in 새["replays"] if "유형" not in r]
    if 모름:
        print("질문 세트에 없는 질문으로 뜬 녹화: " + ", ".join(모름))

    if 옛 == 새:
        print(f"그대로 — 녹화 {len(새['replays'])}편")
        return 0
    if a.확인:
        옛이름 = {r["name"] for r in (옛 or {}).get("replays", [])}
        새이름 = {r["name"] for r in 새["replays"]}
        print(f"어긋났다 — 목록 {len(옛이름)}편 · 폴더 {len(새이름)}편")
        for n in sorted(새이름 - 옛이름):
            print(f"   목록에 없음 {n}")
        for n in sorted(옛이름 - 새이름):
            print(f"   파일이 없음 {n}")
        if 옛이름 == 새이름:
            print("   이름은 같고 내용(축·지표·유형)이 다르다")
        return 1

    대상.write_text(json.dumps(새, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"다시 만들었다 — 녹화 {len(새['replays'])}편")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
