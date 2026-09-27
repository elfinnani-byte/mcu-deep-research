# -*- coding: utf-8 -*-
"""
실행을 녹화해 web/replay/*.json 으로 저장한다.

    python -u record.py "질문" 출력이름 [설정키=값 ...]
    python -u record.py "질문" q1-기본
    python -u record.py "질문" q1-구역끔 배정=False 구역=False
    python -u record.py "질문" q1-반려  --반려="1894년 범위를 벗어난 절이 있다"

녹화 파일은 화면(ScriptedSource)이 그대로 재생한다.
"""
import io, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 사전등록 — 「돌리기 전에 적었다」는 것이 유일한 근거다.
# 문서를 먼저 커밋해도 **녹화 파일만 보면** 그게 먼저였는지 알 수 없다.
# 그래서 그 커밋을 녹화 안에 박는다. 녹화 시각보다 앞선 해시가 증거가 된다.
사전등록파일 = ("docs/사전등록.md", "data/questions.json")


def _커밋(경로: str) -> str:
    """그 파일이 마지막으로 바뀐 커밋 — 없거나 git 이 아니면 빈 문자열."""
    try:
        r = subprocess.run(["git", "log", "-1", "--format=%h %ad", "--date=iso", "--", 경로],
                           cwd=ROOT, capture_output=True, text=True, timeout=10)
        return r.stdout.strip()
    except Exception:
        return ""

try:
    from . import pipeline
    from .pipeline import run, on_event, on_approval, 설정
except ImportError:
    import pipeline
    from pipeline import run, on_event, on_approval, 설정

OUT_DIR = Path(__file__).parent.parent / "web" / "replay"


def record(question: str, name: str, overrides: dict = None, 반려사유: str = "") -> dict:
    events = []

    def sink(e):
        events.append(e)
        # 진행 상황은 짧게, 저장은 통째로 — 잘라 쓰면 나중에 분석을 못 한다
        print(json.dumps(e, ensure_ascii=False)[:130], flush=True)

    on_event(sink)
    # 반려 사유가 있으면 첫 목차는 반려하고 두 번째를 승인한다
    상태 = {"차례": 0}

    def approver(plan):
        상태["차례"] += 1
        if 반려사유 and 상태["차례"] == 1:
            return False, 반려사유
        return True, ""

    on_approval(approver)

    원래설정 = dict(설정)
    if overrides:
        설정.update(overrides)
    try:
        res = run(question)
    finally:
        설정.clear()
        설정.update(원래설정)          # 되돌리지 않으면 다음 녹화가 엉뚱한 설정으로 돈다

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{name}.json"
    out.write_text(json.dumps({
        "name": name, "question": question,
        "settings": {**원래설정, **(overrides or {})},
        "rejected": bool(반려사유),
        # 이 녹화가 어느 사전등록 아래에서 떠졌나 — 해시가 녹화 시각보다 앞서야 뜻이 있다
        "사전등록": {p: _커밋(p) for p in 사전등록파일},
        "events": events,
    }, ensure_ascii=False), encoding="utf-8")
    print(f"\n저장: {out}  ({len(events)} 이벤트, {out.stat().st_size:,} bytes)")
    return {"res": res, "events": events, "path": out}


def 진단(events: list):
    """인용이 실제로 읽은 문서를 가리키는지 절마다 대조한다."""
    corpus = json.loads((Path(__file__).parent.parent / "corpus.json").read_text(encoding="utf-8"))
    docs = set(corpus["docs"])
    읽음 = {}
    for e in events:
        if e["type"] == "research.read":
            읽음.setdefault(e["cast"], []).append(e["doc"])
    done = [e for e in events if e["type"] == "research.done"]
    end = next((e for e in events if e["type"] == "run.end"), {})

    print("\n" + "=" * 70)
    print("진단 — 인용 대조")
    print("=" * 70)
    for d in done:
        if not d.get("fake"):
            continue
        print(f"\n[{d['cast']}] 허위 인용 {d['fake']}곳")
        print("  읽은 문서:")
        for x in 읽음.get(d["cast"], []):
            print(f"    - {x}")

    rep = end.get("report", "")
    import re
    인용 = re.findall(r"«([^»]+)»", rep)
    없는것 = [c for c in dict.fromkeys(인용) if c not in docs]
    print(f"\n보고서 인용 {len(인용)}개 중, 코퍼스에 그 이름이 아예 없는 것 {len(없는것)}개:")
    for c in 없는것:
        비슷 = [x for x in docs if c.lower()[:18] in x.lower()]
        print(f"  «{c}»" + (f"   → 실제 문서명: {비슷[0]}" if 비슷 else "   → 유사 문서 없음"))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    q, name = sys.argv[1], sys.argv[2]
    ov, 반려 = {}, ""
    for a in sys.argv[3:]:
        if a.startswith("--반려="):
            반려 = a.split("=", 1)[1]
        elif "=" in a:
            k, v = a.split("=", 1)
            ov[k] = {"True": True, "False": False}.get(v, int(v) if v.isdigit() else v)
    out = record(q, name, ov, 반려)
    진단(out["events"])
    for line in out["res"]["log"]:
        print(line)
