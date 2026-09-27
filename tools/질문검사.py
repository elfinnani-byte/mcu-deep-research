#!/usr/bin/env python3
"""질문 세트가 코퍼스·녹화와 어긋나지 않는지 검사한다.

    python tools/질문검사.py

문서 제목을 지어내는 것은 모델만이 아니다 — 사람도 질문을 적다가 지어낸다.
그리고 더 흔한 사고는 **문서만 고치고 숫자를 안 고치는 것**이다. 이번 세션에만
두 번 그랬다(q1-기본을 34.6으로 적었다가 61.8, 명찰 4.1/2.2로 적었다가 5.0/2.6).
그래서 적어 둔 실측값이 실제 녹화와 같은지까지 본다.

과제 필수 ① 의 요구도 함께 센다 — 질문 8건 이상 · 성격이 갈리게 · 한 건으로
답이 나오는 질문을 일부러 하나.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
유형들 = {"단일", "다갈래", "추적"}


def main() -> int:
    corpus = json.loads((ROOT / "corpus.json").read_text(encoding="utf-8"))
    제목 = set(corpus["docs"])
    서고 = {r["name"] for r in json.loads((ROOT / "web/racks.json").read_text(encoding="utf-8"))["racks"]}
    qs = json.loads((ROOT / "data/questions.json").read_text(encoding="utf-8"))["질문"]

    탈 = 0
    본 = set()
    for q in qs:
        왜 = []
        if q["id"] in 본:
            왜.append("id 가 겹친다")
        본.add(q["id"])
        왜 += [f"없는 문서 {d!r}" for d in q["핵심 문서"] if d not in 제목]
        왜 += [f"없는 서고 {s!r}" for s in q["닿아야 할 서고"] if s not in 서고]
        if q["유형"] not in 유형들:
            왜.append(f"모르는 유형 {q['유형']!r}")
        if not q.get("왜 나눌 만한가", "").strip():
            왜.append("「왜 나눌 만한가」 가 비었다")
        if not q["핵심 문서"]:
            왜.append("핵심 문서가 비었다")

        if q.get("녹화"):
            이름 = q.get("녹화이름")
            if not 이름:
                왜.append("녹화 대상인데 녹화이름이 없다")
            elif not list((ROOT / "web/replay").glob(f"{이름}-*.json")):
                왜.append(f"녹화 파일이 없다 ({이름}-*.json)")
            # 적어 둔 값이 실제 기록과 같은가 — 문서만 고치고 숫자를 안 고치는 일을 막는다
            m = q.get("실측")
            if m:
                p = ROOT / m["기록"]
                if not p.exists():
                    왜.append(f"기록 없음 {m['기록']}")
                else:
                    참 = None
                    for e in json.loads(p.read_text(encoding="utf-8"))["events"]:
                        if e["type"] == "evaluate.done":
                            참 = e["metrics"]["근거율"]
                    if 참 is None:
                        왜.append(f"{m['기록']} 에 evaluate.done 이 없다")
                    elif abs(참 - m["근거율"]) > 1e-6:
                        왜.append(f"근거율 적힌 값 {m['근거율']} ≠ 기록 {참} ({m['기록']})")
        elif q.get("실측"):
            왜.append("녹화한 적 없는데 실측이 적혀 있다")

        if 왜:
            탈 += 1
            print(f"X  {q['id']}")
            for w in 왜:
                print(f"       {w}")

    셈 = {}
    for q in qs:
        셈[q["유형"]] = 셈.get(q["유형"], 0) + 1
    녹화수 = sum(1 for q in qs if q.get("녹화"))
    print(f"\n질문 {len(qs)}건 · 유형 {셈} · 녹화 {녹화수}건 · 미녹화 {len(qs) - 녹화수}건")

    # 과제 필수 ① 의 요구
    if len(qs) < 8:
        print(f"X  과제 요구는 8건 이상이다 (지금 {len(qs)}건)")
        탈 += 1
    if not 셈.get("단일"):
        print("X  한 건으로 답이 나오는 질문이 하나는 있어야 한다 (이 구조를 쓰면 안 되는 경우)")
        탈 += 1
    if len(셈) < 3:
        print(f"X  성격이 갈려야 한다 — 유형 3종 중 {len(셈)}종뿐이다")
        탈 += 1

    print("문제 없음" if not 탈 else f"문제 {탈}건")
    return 1 if 탈 else 0


if __name__ == "__main__":
    raise SystemExit(main())
