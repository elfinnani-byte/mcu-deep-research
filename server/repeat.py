# -*- coding: utf-8 -*-
"""사전등록한 반복 녹화 — `docs/사전등록.md` 의 표 그대로.

    python -u server/repeat.py           # 없는 것만 뜬다
    python -u server/repeat.py --계획     # 뜰 목록만 보이고 끝낸다 (돈 안 씀)

왜 batch.py 를 안 쓰나 — batch 는 「질문 × 설정 전부」를 도는 도구다. 반복은
**정해진 네 칸만** 3회로 채우는 일이라 대상이 다르다. 여기서 섞으면 20편을
다시 뜨게 된다.

칸과 회차를 여기서 바꾸면 사전등록과 어긋난다. 바꿔야 하면 문서를 먼저 고치고,
왜 바꿨는지 적은 뒤에 고쳐라 — 결과를 보고 규칙을 바꾸는 것이 사전등록이 막으려는 것이다.
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from record import record                       # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "replay"

# docs/사전등록.md — 「돌릴 것 — 8편」 표
대상 = ("q2", "q5")
칸 = {"기본": {}, "역할끔": {"역할": False}}
# 회차 1은 **옛 코드**(인용0곳점검·원고지키기 이전) 실행이라 같은 칸이 아니다.
# 그래서 새 코드로 2·3·4 세 번을 채운다 — docs/사전등록.md 「고친 기록」.
회차 = (2, 3, 4)

# 질문 글은 data/questions.json **한 곳**에서만 온다.
# 여기 또 적어 두면 한 글자 달라진 채로 「같은 설정 반복」이라 우기게 된다.
_QS = {q["id"]: q["질문"] for q in
       json.loads((ROOT / "data/questions.json").read_text(encoding="utf-8"))["질문"]}
질문 = {k: _QS[k] for k in 대상}


def 할일():
    일 = []
    for qid, q in 질문.items():
        for 칸이름, sv in 칸.items():
            for n in 회차:
                name = f"{qid}-{칸이름}-{n}"
                if not (OUT / f"{name}.json").exists():
                    일.append((name, q, sv))
    return 일


def main():
    일 = 할일()
    계획만 = "--계획" in sys.argv
    print(f"뜰 녹화 {len(일)}편" + (" (계획만 — 돈 안 씀)" if 계획만 else ""))
    for name, _, sv in 일:
        print(f"   {name:16s} {sv or '기본'}")
    if 계획만 or not 일:
        return

    결과, 시작 = [], time.time()
    for n, (name, q, sv) in enumerate(일, 1):
        sys.stderr.write(f"\n[{n}/{len(일)}] {name}\n")
        try:
            out = record(q, name, sv)
            m = next((e["metrics"] for e in out["events"] if e["type"] == "evaluate.done"), {})
            결과.append((name, m.get("근거율"), m.get("인용0절"), m.get("호출"), m.get("원고지킴")))
        except Exception as e:                    # 한 편이 깨져도 나머지는 간다
            sys.stderr.write(f"   실패: {type(e).__name__}: {e}\n")
            결과.append((name, None, None, None, None))

    print(f"\n{'녹화':18s}{'근거율':>7s}{'0절':>5s}{'호출':>6s}{'원고지킴':>8s}")
    for name, g, z, c, k in 결과:
        print(f"{name:18s}{str(g if g is not None else '실패'):>7s}"
              f"{str(z if z is not None else '—'):>5s}{str(c if c is not None else '—'):>6s}"
              f"{str(k if k is not None else '—'):>8s}")
    print(f"\n{len(결과)}편 · {int(time.time() - 시작)}초")
    print("다음: python tools/녹화목록.py  그리고  python tools/반복분석.py")


if __name__ == "__main__":
    main()
