# -*- coding: utf-8 -*-
"""혼자 하는 대조군 — 팀과 붙여 본다 (15강 실습 · 과제 필수 ④).

    python -u server/baseline.py q1          # 팀이 실제로 읽은 만큼 읽는다
    python -u server/baseline.py q1 --예산 15
    python -u server/baseline.py --전부      # questions.json 의 녹화 대상 전부

**공정성이 이 실험의 전부다.** 팀에게만 유리한 조건을 주면 이긴 것이 아니라
상대를 묶어 둔 것이다. 그래서 넷을 **코드로** 같게 맞춘다.

  같은 자료   corpus.json 51건 그대로
  같은 모델   llm.backend() — 팀이 쓰는 바로 그 모델
  같은 도구   요약() · 후보목록() · 다음문서() — 팀의 기자가 쓰는 함수 그대로
  같은 예산   **팀이 그 질문에서 실제로 읽은 문서 수.** 절수×절예산이 아니다 —
             팀은 재위임 때문에 그보다 더 읽는다. 적게 주면 실험이 아니다

다른 것은 하나뿐이다: **나누지 않는다.** 하나가 순서대로 고르고, 읽고, 혼자 다 쓴다.
읽은 요약이 전부 한 창에 쌓인다.

인용·문체 규칙은 `pipeline.인용규칙` **같은 문자열**을 쓴다. 따로 적으면
"프롬프트가 달라서 진 것"이라는 반론이 성립한다.

⚠ 15강이 짚은 함정 — 처음 짜면 대조군이 예산을 다 안 쓰고 멈춘다(모델이 후보에 없는
  제목을 답하면 루프가 끊긴다). 그 상태로 재면 팀이 압승한다. 당연하다, 상대는 예산의
  3분의 1만 쓴 것이다. 아래 `빈손=True` 가 그 교정이다 — **매 바퀴 강제로 고르게 한다.**

⚠ 비교할 수 있는 지표와 없는 지표가 있다. 아래 `견줄수있나` 에 적었다.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llm                                                    # noqa: E402
import pipeline as P                                          # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "runs"

# 혼자 하는 쪽은 절이 없으므로 「분담」 지표가 성립하지 않는다.
# 못 재는 것을 0으로 적어 두면 이긴 것처럼 보인다 — 아예 빼고 이유를 적는다.
견줄수있나 = {
    "근거율": "예 — 같은 방식으로 문장을 세고 «인용»을 본다",
    "허위인용": "예",
    "출처불일치": "예",
    "보고서자수": "예",
    "읽은문서수": "예 — 예산을 같게 맞췄다",
    "편중": "예 — 인용이 한 문서에 몰렸나는 혼자여도 잰다",
    "인용0절": "아니오 — 혼자 하는 쪽은 절이 하나다",
    "중복률": "아니오 — 겹쳐 읽을 상대가 없다",
    "격리율": "아니오 — 혼자 하는 쪽은 정의상 100%다. 그게 이 실험이 보여 주려는 것이다",
}


def 팀예산(qid: str) -> tuple[int, list]:
    """팀이 그 질문에서 **실제로** 읽은 문서 수. 같은 세대 기본 녹화들의 중앙값."""
    읽음 = []
    for p in sorted((ROOT / "web" / "replay").glob(f"{qid}-기본*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        if "인용0곳점검" not in (d.get("settings") or {}):
            continue                                  # 옛 코드 실행은 조건이 다르다
        읽음.append((p.stem, sum(1 for e in d["events"] if e["type"] == "research.read")))
    if not 읽음:                                      # 새 세대가 없으면 옛 것이라도 쓴다
        for p in sorted((ROOT / "web" / "replay").glob(f"{qid}-기본*.json")):
            d = json.loads(p.read_text(encoding="utf-8"))
            읽음.append((p.stem, sum(1 for e in d["events"] if e["type"] == "research.read")))
    if not 읽음:
        raise SystemExit(f"{qid} 의 팀 녹화가 없다 — 예산을 정할 근거가 없다")
    값 = sorted(x[1] for x in 읽음)
    return 값[len(값) // 2], 읽음


def 혼자(question: str, 예산: int, 말하기=print) -> dict:
    """나누지 않는다. 하나가 순서대로 고르고, 읽고, 혼자 다 쓴다."""
    llm.reset_cost()
    t0 = time.time()
    read, notes, frontier = set(), [], set()

    for i in range(예산):
        cand = P.후보목록(read, [], frontier)
        if not cand:
            break
        # **빈손=True 를 늘 준다.** 모델이 그만두겠다고 해도 고르게 한다 —
        # 예산을 다 안 쓴 대조군은 묶어 둔 상대다 (15강).
        다음 = P.다음문서("(전체)", question, read, cand, 빈손=True, coord=True)
        if 다음 is None:
            break
        memo = P.요약(다음, question, "범용 조사", coord=True)   # 요약이 자기 창에 쌓인다
        read.add(다음)
        관련 = not memo.strip().startswith("관련 없음")
        if 관련:
            notes.append(f"«{다음}» {memo}")
        frontier |= set(P.LINKS.get(다음, []))
        말하기(f"   [{i+1}/{예산}] {다음[:44]:46s} {'관련' if 관련 else '관련 없음'}")

    # 길이도 맞춘다. 팀은 절마다 600자 이상을 요구받으므로 절수×600 이 팀의 하한이다.
    # 처음엔 2,000자라고 적어 놓고 3,648자 vs 2,038자를 「팀이 이겼다」로 읽을 뻔했다 —
    # 예산은 코드로 맞춰 놓고 프롬프트에서 묶어 둔 꼴이었다 (runs/길이불일치/).
    하한 = P.설정["절수"] * 600
    raw = P.ask(
        "You are a research writer working alone. Write ONE long report answering the question using "
        f"ONLY the notes below. At least {하한:,} characters, in Korean, with section headings (## ). "
        + P.인용규칙 +                                  # 팀과 **같은 문자열**
        "답은 한국어로. 보고서 본문만 쓴다 (JSON 아님).",
        f"[질문] {question}\n"
        f"[읽은 문서 — 인용할 때 이 제목을 그대로 옮겨 적는다]\n"
        + "\n".join(f"- {d}" for d in sorted(read)) + "\n\n"
        "[모은 자료]\n" + ("\n\n".join(notes) or "(읽은 자료 없음)"),
        coord=True)                                     # 쓰는 것도 같은 창에서 한다

    본문, 교정, 제거 = P.인용교정(raw, read)
    인용 = re.findall(r"«([^»]+)»", 본문)
    sec = {"번호": 0, "절": "(혼자)", "명찰": "범용 조사", "콜사인": "혼자", "본문": 본문,
           "읽은문서": sorted(read), "메모": notes, "인용": 인용,
           "허위인용": [c for c in set(인용) if c not in read],
           "교정": 교정, "제거": 제거, "충분": True, "부족": ""}
    쪽, 참고 = P.조판(본문)
    보고서 = 쪽 + P.참고블록(참고)
    m = P.evaluate({"sections": [sec], "plan": {"제목": question},
                    "report": 보고서, "본문자수": len(쪽), "참고자료수": len(참고)})["metrics"]
    return {"question": question, "예산": 예산, "읽은문서": sorted(read),
            "report": 보고서, "metrics": m, "초": round(time.time() - t0, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("질문id", nargs="?", help="q1 … q5")
    ap.add_argument("--예산", type=int)
    ap.add_argument("--전부", action="store_true")
    ap.add_argument("--계획", action="store_true", help="예산만 보이고 끝낸다 (돈 안 씀)")
    a = ap.parse_args()

    qs = {q["id"]: q for q in
          json.loads((ROOT / "data/questions.json").read_text(encoding="utf-8"))["질문"]}
    대상 = [q for q in qs.values() if q.get("녹화")] if a.전부 else [qs[a.질문id]]

    OUT.mkdir(exist_ok=True)
    표 = []
    for q in 대상:
        예산, 근거 = (a.예산, []) if a.예산 else 팀예산(q["id"])
        print(f"\n── {q['id']} 혼자 · 예산 {예산}건 ──")
        if 근거:
            print("   예산 근거: " + " · ".join(f"{n} {v}건" for n, v in 근거))
        if a.계획:
            continue
        out = 혼자(q["질문"], 예산)
        out |= {"질문id": q["id"], "견줄수있나": 견줄수있나,
                "사전등록": {p: _도장(p) for p in ("docs/사전등록.md", "data/questions.json")}}
        (OUT / f"대조군-{q['id']}.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        m = out["metrics"]
        표.append((q["id"], 예산, len(out["읽은문서"]), m["근거율"], m["편중"],
                   m["허위인용"], m["보고서자수"]))
        print(f"   → 근거율 {m['근거율']}% · 편중 {m['편중']}% · 허위인용 {m['허위인용']}곳 "
              f"· {m['보고서자수']}자 · {out['초']}초")

    if 표:
        print(f"\n{'질문':6s}{'예산':>5s}{'읽음':>5s}{'근거율':>8s}{'편중':>7s}{'허위':>5s}{'자수':>7s}")
        for r in 표:
            print(f"{r[0]:6s}{r[1]:>5d}{r[2]:>5d}{r[3]:>8.1f}{r[4]:>7.1f}{r[5]:>5d}{r[6]:>7d}")
        print("\n다음: python tools/팀대혼자.py")


def _도장(경로: str) -> str:
    import subprocess
    try:
        r = subprocess.run(["git", "log", "-1", "--format=%h %ad", "--date=iso", "--", 경로],
                           cwd=ROOT, capture_output=True, text=True, timeout=10)
        return r.stdout.strip()
    except Exception:
        return ""


if __name__ == "__main__":
    main()
