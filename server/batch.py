# -*- coding: utf-8 -*-
"""
8단계 — 절제 실험 녹화 배치.

    질문 5개 × 설정 4가지 = 20편 (+ Q1 반려 시나리오 1편)

한 번에 하나만 끈다. 둘을 같이 끄면 어느 쪽 효과인지 알 수 없기 때문이다.
실패한 편은 건너뛰고 계속 간다 — 끝에 표로 정리한다.
"""
import io, json, sys, time, traceback
from pathlib import Path

from record import record

질문 = [
    ("q1", "서사형", "인피니티 스톤을 둘러싼 주요 사건들은 무엇이고 각각의 원인은 무엇인가?"),
    ("q2", "측면형", "MCU 영화들은 어떻게 제작되었고 흥행 성적과 평단 반응은 어땠는가?"),
    ("q3", "단일형", "아이언맨(2008)은 어떤 영화인가?"),
    ("q4", "인물형", "토니 스타크가 관여한 사건들과 그 결과는 무엇인가?"),
    ("q5", "구조형", "MCU 페이즈 1부터 3까지는 어떻게 이어지는가?"),
]
설정들 = [
    ("기본",     {}),
    ("구역끔",   {"배정": False, "구역": False}),
    ("역할끔",   {"역할": False}),
    ("재위임끔", {"재위임": False}),
]

def 요약(events):
    m = next((e["metrics"] for e in events if e["type"] == "evaluate.done"), {})
    p = next((e for e in events if e["type"] == "plan.done"), {})
    fb = next((e for e in events if e["type"] == "dispatch.fallback"), None)
    end = next((e for e in events if e["type"] == "run.end"), {})
    return {"축": p.get("axis", "?"), "근거율": m.get("근거율"), "허위인용": m.get("허위인용"),
            "편중": m.get("편중"), "중복률": m.get("중복률"), "인용0절": m.get("인용0절"),
            "읽은문서수": m.get("읽은문서수"), "호출": m.get("호출"),
            "폴백": (fb or {}).get("count", 0), "초": end.get("elapsed"),
            "보고서자수": m.get("보고서자수")}

def main():
    결과, 시작 = [], time.time()
    작업 = [(f"{qid}-{sname}", q, sv, qkind, sname)
            for qid, qkind, q in 질문 for sname, sv in 설정들]
    작업.append(("q1-반려", 질문[0][2], {}, "서사형", "반려"))

    for n, (name, q, sv, qkind, sname) in enumerate(작업, 1):
        sys.stderr.write(f"\n[{n}/{len(작업)}] {name} — {qkind} / {sname}\n")
        try:
            out = record(q, name, sv, 반려사유="목차가 질문의 범위를 벗어납니다. 인피니티 스톤 자체에 집중해 주세요."
                         if sname == "반려" else "")
            결과.append({"name": name, "질문유형": qkind, "설정": sname, **요약(out["events"])})
        except Exception as e:
            sys.stderr.write(f"   실패: {e}\n"); traceback.print_exc(file=sys.stderr)
            결과.append({"name": name, "질문유형": qkind, "설정": sname, "축": "실패"})

    print("\n" + "=" * 104)
    print(f"{'녹화':14s}{'유형':7s}{'설정':8s}{'축':5s}{'근거율':>7s}{'허위':>5s}{'편중':>7s}"
          f"{'중복':>7s}{'0절':>4s}{'읽음':>5s}{'폴백':>5s}{'호출':>5s}{'초':>6s}")
    print("=" * 104)
    for r in 결과:
        print(f"{r['name']:14s}{r['질문유형']:7s}{r['설정']:8s}{str(r.get('축','')):5s}"
              f"{str(r.get('근거율','—')):>7s}{str(r.get('허위인용','—')):>5s}"
              f"{str(r.get('편중','—')):>7s}{str(r.get('중복률','—')):>7s}"
              f"{str(r.get('인용0절','—')):>4s}{str(r.get('읽은문서수','—')):>5s}"
              f"{str(r.get('폴백','—')):>5s}{str(r.get('호출','—')):>5s}{str(r.get('초','—')):>6s}")
    print("=" * 104)
    print(f"총 {len(결과)}편 · {int(time.time()-시작)}초 소요")
    Path("batch-summary.json").write_text(json.dumps(결과, ensure_ascii=False, indent=1), encoding="utf-8")

if __name__ == "__main__":
    main()
