# -*- coding: utf-8 -*-
"""
마블 리서치 데스크 · 6노드 파이프라인

강의 「8. 딥리서치 에이전트 만들기 — 오케스트레이션」의 여섯 노드를 따르되,
관제실 화면이 알아들을 수 있는 **의미 이벤트**를 방출한다.

  ① 기획 plan ─▶ 🔏 승인 게이트 ─▶ ② 배치 dispatch ⇉ ③ 조사 researcher ─▶ ④ 점검 review ─┬─▶ ⑤ 종합 ─▶ ⑥ 평가
                                          ▲                                                │
                                          └──────────────── 재위임 ─────────────────────────┘

캐릭터 10명
  한기획(편집장 ①) · 나배정(배정 ②) · 김·이·박·최·정기자(현장기자 ③ ×5)
  정반송(점검 ④) · 윤카피(카피에디터 ⑤) · 최계량(평가 ⑥)
"""
import json, operator, re, time
from collections import Counter
from pathlib import Path
from typing import Annotated, TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.types import Send

try:                                    # 패키지로 부를 때 (api/ · python -m server.pipeline)
    from . import llm
except ImportError:                       # server/ 안에서 곧바로 돌릴 때
    import llm

ask, COST, reset_cost = llm.ask, llm.COST, llm.reset_cost

# ── 코퍼스 ───────────────────────────────────────────────────────────────
CORPUS = json.loads((Path(__file__).parent.parent / "corpus.json").read_text(encoding="utf-8"))
DOCS, LINKS = CORPUS["docs"], CORPUS["links"]

# ── 설정 — 15강 절제 실험에서 하나씩 꺼 보는 스위치 ──────────────────────
설정 = {
    "절수": 5,        # 편집장이 세울 목차의 최대 절 수 (기자 5명)
    "절예산": 3,      # 기자 한 명이 한 바퀴에 읽을 문서 수
    "최대바퀴": 2,    # 점검 후 재위임을 몇 바퀴까지
    "역할": True,     # False 면 전원 범용 기자 (명찰 없음)
    "배정": True,     # False 면 시작 문서를 나눠 주지 않는다
    "구역": True,     # False 면 남의 구역을 피하지 않는다
    "재위임": True,   # False 면 한 바퀴로 끝낸다
    "최대반려": 2,    # 승인 게이트에서 몇 번까지 다시 짜게 할 것인가
    # ④ 점검이 자기신고 말고 **인용 0곳** 도 빈 칸으로 볼 것인가.
    # 10강은 ②(자기신고)를 골랐지만 *"①을 완전히 버리지는 않았다 — 인용 0곳 같은 규칙은
    # ⑥ 평가에서 지표로 남긴다"* 고 했다. 우리는 그 지표를 **재기만 하고 고치지는 않고** 있었다.
    # 실측: 절 제출 113건 중 자기신고 '부족' 8건(7.1%)인데, '충분' 이라 해놓고 인용 0곳인 것이
    # 13건(11.5%) — 진짜 빈 절의 62%를 놓쳤다.
    # 껐다 켤 수 있게 둔다. 그래야 이것 자체가 값을 하는지 나중에 잰다.
    "인용0곳점검": True,
    # 재위임으로 같은 절이 두 번 올라왔을 때 **2바퀴 원고를 무조건 덮어쓸 것인가.**
    # 과제 필수 ②가 고르라는 결정이다 — *"무조건 덮어쓰면 인용을 빠뜨린 원고가
    # 멀쩡한 원고를 지웁니다."*
    # 우리는 「지킨다」를 고른다. 이유는 아래 절모음() 에 적었다.
    "원고지키기": True,
}

# ── 명찰 10장 — 편집장이 축 하나를 골라 5장을 배부한다 ───────────────────
def 본문만(raw: str) -> str:
    """JSON 이 깨졌을 때 본문만 도려낸다 — 앞머리와 꼬리를 둘 다 뗀다."""
    s = re.sub(r'^.*?"본문"\s*:\s*"?', "", raw, flags=re.S)
    s = re.sub(r'"?\s*,\s*"충분".*$', "", s, flags=re.S)
    s = re.sub(r'"?\s*\}\s*$', "", s)
    return s.replace("\\n", "\n").replace('\\"', '"').strip()[:2000]


# ── 보고서 조판 — 본문과 출처를 갈라 놓는다 ──────────────────────────
# 기자는 문장 끝에 «문서 제목» 을 달아 근거를 남긴다. 그게 이 보고서의 값어치인데,
# 제목이 문장 사이에 박혀 있으면 읽기가 어렵다. 본문에는 번호만 두고 제목은 맨 끝으로 모은다.
# ⚠ 절 본문 자체는 건드리지 않는다 — ⑥ 평가의 「근거가 달린 문장」이 그걸 세기 때문이다.
# web/js/report.js 와 같은 규칙이다. 한쪽만 고치지 않는다.
def 조판(md: str):
    """보고서 한 장을 (본문, 참고) 로 가른다. 이미 갈라져 있으면 그대로 (멱등)."""
    m = re.search(r"\n##\s*참고자료\s*\n", md)
    if m:
        꼬리 = md[m.start():]
        return md[:m.start()].rstrip(), [t.strip() for _, t in
                                         re.findall(r"^\[(\d+)\]\s+(.+)$", 꼬리, re.M)]
    참고: list[str] = []

    # **줄 첫머리**에 붙은 인용은 번호만 남기면 주어가 숫자가 된다 —
    # 실제로 「[8]는 MCU의 세 번째 페이즈에 속합니다」 가 나왔다. 그럴 때만 제목을 남긴다.
    #
    # ⚠ 「마침표 뒤」까지 첫머리로 보면 안 된다. 기자는 «문서»를 그 문장의 **앞**에 다는 일이
    #    잦아서(실측 — q4-역할끔은 거의 모든 문장이 그렇다) 제목이 문장마다 박힌다.
    #    실제로 그렇게 고쳤다가 보고서가 「「Marvel Cinematic Universe — Overview」¹ 이 영화는…」
    #    의 반복이 되는 것을 캡처에서 보고 되돌렸다.
    # (web/js/report.js 와 같은 규칙이어야 한다 — 만들 때와 볼 때가 갈리면 안 된다)
    def 바꿔(mo):
        앞공백, t = mo.group(1), mo.group(2).strip()
        if t not in 참고:
            참고.append(t)
        n = 참고.index(t) + 1
        앞 = md[:mo.start()].rstrip(" \t")
        줄첫머리 = (not 앞) or 앞.endswith("\n")
        return f"{앞공백}「{t}」[{n}]" if 줄첫머리 else f"[{n}]"

    return re.sub(r"([ \t]*)«([^»]+)»", 바꿔, md).rstrip(), 참고


def 참고블록(참고) -> str:
    """출처가 없으면 빈 문자열 — 없는 섹션을 만들지 않는다."""
    if not 참고:
        return ""
    목록 = "\n".join(f"[{i+1}] {d}" for i, d in enumerate(참고))
    return f"\n\n## 참고자료\n\n{목록}"


ROSTER = {
    "서사": {   # 질문이 "왜·어떻게 이어졌나" 일 때
        "큰그림 담당": "주제의 윤곽을 잡고 핵심 사건과 인물을 간추린다",
        "시간순 담당": "사건을 일어난 순서대로 늘어놓고 언제였는지를 못 박는다",
        "인물 담당": "한 사람이 무엇에 관여했고 어떤 일을 겪었는지 좇는다",
        "원인 담당": "무엇이 무엇으로 이어졌는지 자료에 적힌 대로 따라간다",
        "비교 담당": "둘 이상을 같은 잣대로 견주어 어디가 다른지 정리한다",
    },
    "측면": {   # 질문이 "어떻게 만들었나·얼마나 벌었나" 일 때
        "스토리 담당": "작품 속 사건 전개를 따라간다 (Plot)",
        "제작 담당": "기획·촬영·예산·감독 교체 등 제작 과정을 좇는다 (Production)",
        "흥행 담당": "박스오피스 성적과 평단 반응을 정리한다 (Reception)",
        "캐스팅 담당": "배우와 배역, 출연 계약이 어떻게 정해졌는지 좇는다 (Cast)",
        "세계관 담당": "페이즈·연표·크로스오버가 어떻게 이어지는지 정리한다 (Phase)",
    },
}
CALLSIGNS = ["김기자", "이기자", "박기자", "최기자", "정기자"]   # 자리는 고정, 명찰만 바뀐다
CARD = 250   # 편집장이 보는 문서 한 건의 앞부분 길이 — 코퍼스의 0.8%

# 이야기 알맹이가 거의 없는 조각들 — 폴백으로 집으면 기자가 빈손으로 돌아온다
주변섹션 = ("— Music", "— Reception", "— Marketing", "— Release", "— Future",
           "— Recurring cast and characters", "— Outside media", "— Character rights")

# ── 출처 대조 — 인용이 제자리에 붙었는가 ────────────────────────────────
# 「읽지 않은 문서를 인용했다」(허위인용)는 코드가 이미 잡는다.
# 여기서 보는 것은 다르다 — **읽긴 했는데 엉뚱한 문장에 갖다 붙인 경우.**
#
# 판정 모델을 쓰지 않는다. 문장에서 단서(작품명·영문 고유명사·연도)를 뽑아
# 인용한 문서 원문에 그 단서가 있는지 **문자열로만** 본다. 재현되는 숫자여야
# 절제 실험에 쓸 수 있기 때문이다 (14강 — 채점은 코드로만).
#
# ⚠ 한계를 숫자로 함께 남긴다. 우리 절 본문은 한국어인데 문서는 영문 위키라
#    단서가 아예 안 잡히는 문장이 많다. 실측 — 인용 문장 558개 중 판정 대상 186개(33%).
#    그래서 `출처불일치` 는 **판정한 것 중에서** 센 수이고, `출처대조가능` 을 같이 본다.
_KO2EN = {}
try:                                    # 한글 표기는 화면용 racks.json 에만 있다 (없어도 돈다)
    _racks = json.loads((Path(__file__).parent.parent / "web" / "racks.json").read_text(encoding="utf-8"))
    _KO2EN = {ko: en for r in _racks["racks"] for en, ko in zip(r["docs"], r["ko"])}
except Exception:
    pass

_인용따옴 = re.compile(r"['‘’“”\"]([^'‘’“”\"]{2,40})['‘’“”\"]")
_영문 = re.compile(r"[A-Z][A-Za-z]{3,}")
_연도 = re.compile(r"(?:19|20)\d{2}")
# 어느 문서에나 나오는 말은 단서에서 뺀다 — 맞아도 아무것도 말해 주지 않는다
_흔함 = {"Marvel", "Cinematic", "Universe", "Avengers", "Overview", "Phase",
         "Studios", "Film", "Music", "Production", "Reception", "Comics"}
# 문장 끝(.!?) 뒤 공백, 또는 줄바꿈에서 자른다 — 마침표 없이 줄만 바뀌는 목록도 한 문장으로 센다
_문장쪼개기 = re.compile(r"(?<=[.!?])\s+|\n+")


def _단서(문장: str) -> list:
    """문장에서 원문과 맞댈 만한 조각을 뽑는다. 인용 표시(«…») 자체는 뺀다."""
    본문 = re.sub(r"«[^»]+»", "", 문장)
    out = []
    for q in _인용따옴.findall(본문):                      # '토르' · '어벤져스: 엔드게임'
        q = q.strip()
        en = _KO2EN.get(q) or next((v for k, v in _KO2EN.items()
                                    if len(q) >= 3 and k.startswith(q)), None)
        if not en:
            continue
        핵 = re.sub(r"\s*[—(].*$", "", en).strip()        # 'Iron Man (2008 film)' → 'Iron Man'
        # 전체 제목이 원문에 그대로 없을 수 있다 ('Avengers: Endgame' 은 없고 'Endgame' 은 있다).
        # 그래서 제목과 **구별되는 꼬리** 를 둘 다 단서로 둔다.
        for x in {핵, 핵.split(":")[-1].strip()}:
            if len(x) >= 3:
                out.append(x)
    out += [w for w in _영문.findall(본문) if w not in _흔함]
    out += _연도.findall(본문)
    return list(dict.fromkeys(out))


def 출처대조(정렬: list) -> tuple:
    """(불일치 수, 판정 대상 수, 예시 몇 개)"""
    불일치, 판정, 예시 = 0, 0, []
    for sec in 정렬:
        for 문장 in _문장쪼개기.split(sec.get("본문", "")):
            문장 = 문장.strip()
            인용 = re.findall(r"«([^»]+)»", 문장)
            if len(문장) < 10 or not 인용:
                continue
            단서 = _단서(문장)
            원문 = " ".join(DOCS.get(c, "") for c in 인용).lower()
            if not 단서 or not 원문:
                continue                                   # 맞댈 것이 없다 — 판정하지 않는다
            판정 += 1
            if not any(x.lower() in 원문 for x in 단서):
                불일치 += 1
                if len(예시) < 5:
                    예시.append({"절": sec.get("절"), "인용": 인용[0],
                                 "단서": 단서[:4], "문장": 문장[:120]})
    return 불일치, 판정, 예시


# ── 이벤트 · 승인 게이트 훅 ──────────────────────────────────────────────
_sink = None        # 이벤트를 받을 곳 (SSE 서버 또는 기록기)
_approver = None    # 승인 게이트 — (plan) -> (approved: bool, reason: str)
_START = [time.time()]


def on_event(fn):
    global _sink
    _sink = fn


def on_approval(fn):
    """결재자를 등록한다. 등록하지 않으면 자동 승인."""
    global _approver
    _approver = fn


def emit(type_, **payload):
    ev = {"type": type_, "t": round(time.time() - _START[0], 2), **payload}
    if _sink:
        _sink(ev)
    return ev


# ── 상태 ─────────────────────────────────────────────────────────────────
class Research(TypedDict):
    question: str
    plan: dict
    sections: Annotated[list, operator.add]   # 다섯이 동시에 쓰므로 리듀서 필수
    visited: Annotated[list, operator.add]
    report: str
    metrics: dict
    log: Annotated[list, operator.add]
    task: dict
    prior: dict


def jload(raw: str, default):
    try:
        m = re.search(r"\[.*\]" if isinstance(default, list) else r"\{.*\}", raw, re.S)
        return json.loads(m.group(0))
    except Exception:
        return default


def cards() -> str:
    """코퍼스 전체를 제목 + 앞 250자로 줄인 카드 목록 — 전체의 0.8%."""
    return "\n".join(f"- {t}: {re.sub(chr(10), ' ', v[:CARD])}" for t, v in DOCS.items())


def 절모음(s: dict) -> dict:
    """재위임되면 같은 절이 두 번 올라온다 — **인용이 줄지 않은 쪽**의 원고를 남긴다.

    과제 필수 ②가 고르라는 결정이다: *"두 번째 원고를 어떻게 할지 정하고 이유를 적습니다.
    무조건 덮어쓰면 인용을 빠뜨린 원고가 멀쩡한 원고를 지웁니다."*

    **「지킨다」를 고른 이유.** 재위임은 빈 칸을 메우라고 보내는 것이지 다시 쓰라고
    보내는 것이 아니다. 2바퀴 기자는 1바퀴 메모를 물려받아 더 많은 자료로 쓰므로
    보통 더 낫지만, 그것은 **보통**이지 **언제나**가 아니다. 더 나빠진 한 번에
    멀쩡한 원고를 잃는 쪽이, 더 나아진 경우를 놓치는 쪽보다 나쁘다 — 잃은 것은
    화면에도 지표에도 안 보이기 때문이다.

    **읽은 기록은 언제나 나중 것을 쓴다.** 2바퀴가 1바퀴를 물려받으므로 상위집합이고,
    원고를 안 썼다고 읽은 것이 안 읽은 것이 되지는 않는다. 허위인용 판정(인용 ⊄ 읽은문서)도
    읽은 쪽이 넓어지므로 그대로 성립한다.

    실측 — 녹화 22편에서 재위임으로 두 번 올라온 절은 3개뿐이고 셋 다 1바퀴 인용이
    0곳이라 잃을 것이 없었다. 그런데 「인용0곳점검」이 재위임 대상을 3건 → 최대 21건으로
    늘린다. 이제부터 실제로 생길 수 있는 일이다.

    껐다 켤 수 있게 둔다(`원고지키기`) — 그래야 이 결정 자체가 값을 하는지 나중에 잰다.
    """
    out = {}
    for sec in s["sections"]:
        앞 = out.get(sec["절"])
        if 앞 is None or not 설정["원고지키기"]:
            out[sec["절"]] = sec
            continue
        이긴 = sec if len(sec["인용"]) >= len(앞["인용"]) else 앞
        나중 = sec if len(sec["읽은문서"]) >= len(앞["읽은문서"]) else 앞
        out[sec["절"]] = {**이긴, "읽은문서": 나중["읽은문서"], "메모": 나중["메모"],
                          "원고지킴": 이긴 is 앞}
    return out


# ── ① 기획 — 편집장 한기획 ─────────────────────────────────────────────
def _기획요청(question: str, 반려사유: str = "") -> dict:
    roster_txt = "\n".join(
        f"[{axis} 축]\n" + "\n".join(f"- {k}: {v}" for k, v in badges.items())
        for axis, badges in ROSTER.items())
    되돌림 = f"\n\n[이전 목차가 반려되었다] 사유: {반려사유}\n이 사유를 반영해 목차를 다시 짜라." if 반려사유 else ""
    raw = ask(
        "You are the editor-in-chief of a research desk. Build a table of contents for a report that answers "
        f"the question below, and assign each section to one reporter. At most {설정['절수']} sections.\n"
        "STEP 1 — Choose ONE axis:\n"
        "  '서사' when the question asks what happened and why (events, causes, people, chronology).\n"
        "  '측면' when the question asks how things were made or how they performed "
        "(production, box office, reception, casting, franchise structure).\n"
        "STEP 2 — Split the outline by **content units** inside that axis. Do NOT mix the two axes.\n"
        "STEP 3 — For each section assign the ONE document that should be read first. "
        "Give different documents to different sections.\n"
        "STEP 4 — Give each section a badge from the chosen axis only.\n"
        # 명찰이 겹쳐도 막는 코드가 없다. 실측 — 작품 축(측면)은 서로 다른 명찰이 2.2/5 뿐.
        # 코드로 강제하면 없는 다양성을 지어내 측정이 흐려지므로 프롬프트로 권하기만 한다.
        "  Prefer DIFFERENT badges for different sections. Repeat a badge only when the question "
        "genuinely has no other facet to split on — never force a badge that does not fit the section.\n"
        f"\n[명찰 목록]\n{roster_txt}\n"
        '\n답은 한국어로. JSON만: {"축":"서사" 또는 "측면","제목":"보고서 제목",'
        '"목차":[{"절":"절 제목","지시":"이 절에서 밝혀야 할 것 한두 문장",'
        '"명찰":"고른 축의 명찰 이름 그대로","시작문서":"목록에 있는 제목"}]}',
        f"[질문] {question}{되돌림}\n[읽을 수 있는 문서 카드]\n{cards()}",
        coord=True)
    return jload(raw, {})


def _목차정리(obj: dict, question: str) -> tuple[str, str, list]:
    """모델 출력을 그대로 믿지 않는다 — 축과 명찰을 코드가 검사한다.
    시작 문서는 편집장이 정하지 않는다. ② 배정 담당(나배정)의 몫이다."""
    축 = obj.get("축") if obj.get("축") in ROSTER else "서사"
    badges = ROSTER[축]
    toc = []
    for item in (obj.get("목차") or [])[:설정["절수"]]:
        명찰 = item.get("명찰") if 설정["역할"] else next(iter(badges))
        명찰 = 명찰 if 명찰 in badges else next(iter(badges))
        toc.append({"절": item.get("절", "(제목 없음)"), "지시": item.get("지시", question),
                    "명찰": 명찰, "시작문서": "", "예산": 설정["절예산"],
                    "콜사인": CALLSIGNS[len(toc) % len(CALLSIGNS)]})
    if not toc:
        toc = [{"절": "개요", "지시": question, "명찰": next(iter(badges)),
                "시작문서": "", "예산": 설정["절예산"], "콜사인": CALLSIGNS[0]}]
    return 축, obj.get("제목", question), toc


def plan(s: dict) -> dict:
    """목차와 명찰까지만 정한다. 시작 문서 배정은 ② 배정 담당의 몫이고,
    사람의 결재는 배정까지 끝난 뒤에 받는다(그래야 오배정을 잡을 수 있다)."""
    축, 제목, toc = _목차정리(_기획요청(s["question"]), s["question"])
    emit("plan.done", title=제목, axis=축, attempt=1,
         sections=[{"idx": i, "name": t["절"], "brief": t["지시"],
                    "badge": t["명찰"], "cast": t["콜사인"], "startDoc": ""}
                   for i, t in enumerate(toc)])
    return {"plan": {"제목": 제목, "축": 축, "목차": toc,
                     "배치": list(range(len(toc))), "바퀴": 1},
            "log": [f"① 기획   [{축} 축] 목차 {len(toc)}절"]}


# ── ② 배정 — 나배정 · 문서 배정 · 결재 · 파견 ────────────────────────────
_허브 = sorted(DOCS, key=lambda d: -len(LINKS.get(d, [])))   # 링크가 많은 문서 = 중심 문서


def 알맹이(taken: set, 축: str = "서사") -> str:
    """폴백 — 링크가 가장 많은(중심에 있는) 문서를 고른다.

    예전에는 코퍼스 저장 순서대로 맨 앞을 집었는데, 그 순서는 크롤링 순서라 의미가 없어서
    「아이언맨 1편」 같은 엉뚱한 문서가 걸렸다.

    **축을 받는다.** 배정 프롬프트는 작품 축이면 *"'— Production' '— Reception' 조각이
    오히려 알맹이다"* 라고 말하는데, 이 폴백은 축과 무관하게 그 조각들을 피하고 있었다 —
    **프롬프트와 코드가 반대 방향을 가리켰다.** 실제로 q2-기본-2(작품 축)에서 폴백이
    1/3 터졌고, 그 한 번은 답이 들어 있는 조각을 피해 간 것이다 (docs/읽고-판단.md 4-1).
    """
    피할것 = () if 축 == "측면" else 주변섹션
    for d in _허브:
        if d not in taken and not any(d.endswith(x) for x in 피할것):
            return d
    return next((d for d in _허브 if d not in taken), "")


def 배정(question: str, toc: list, idxs: list, 읽은: set, 축: str = "서사") -> dict:
    """나배정의 판단 — 절마다 '먼저 읽을 문서' 를 하나씩 정한다.

    목차를 나누는 것이 '무엇을 쓸지' 의 분할이라면, 배정은 '무엇을 읽을지' 의 분할이다.
    둘은 다른 일이라 다른 사람이 맡는다.
    """
    if not 설정["배정"]:
        return {i: "" for i in idxs}
    목록 = "\n".join(f"{n}) {toc[i]['절']} — {toc[i]['지시']} (담당: {toc[i]['명찰']})"
                    for n, i in enumerate(idxs, 1))
    이미 = f"\n[이미 읽힌 문서 — 다시 주지 마라]\n{', '.join(sorted(읽은))}" if 읽은 else ""
    주변안내 = ("이 보고서는 제작·흥행 쪽을 다루므로 '— Production' '— Reception' 조각이 오히려 알맹이다."
              if 축 == "측면" else
              "'— Music' '— Reception' '— Marketing' '— Release' 로 끝나는 조각은 줄거리가 없으니 피하라.")
    raw = ask(
        "You are the dispatcher of a research desk. For each section listed below, pick exactly ONE "
        "document the reporter should read FIRST.\n"
        f"Give DIFFERENT documents to different sections. {주변안내}\n"
        "Copy titles EXACTLY as they appear in the card list — including any ' — Section' suffix.\n"
        'Answer with a JSON array ONLY, same length and same order as the section list: '
        '["title for 1)", "title for 2)", ...]',
        f"[질문] {question}\n[절 목록]\n{목록}{이미}\n[읽을 수 있는 문서 카드]\n{cards()}",
        coord=True)
    picks = jload(raw, [])
    if not isinstance(picks, list):
        picks = []
    out, taken, 폴백 = {}, set(읽은), 0
    for n, i in enumerate(idxs):
        d = picks[n] if n < len(picks) and isinstance(picks[n], str) else ""
        if d not in DOCS or d in taken:          # 없는 제목을 지어내면 코드가 바로잡는다
            d, 폴백 = 알맹이(taken, 축), 폴백 + 1
        taken.add(d)
        out[i] = d
    if 폴백:
        emit("dispatch.fallback", count=폴백, total=len(idxs))   # 배정이 몇 번 빗나갔는지 남긴다
    return out


def _배정이벤트(toc, idxs, wheel, attempt):
    emit("assign.done", wheel=wheel, attempt=attempt,
         assignees=[{"idx": i, "cast": toc[i]["콜사인"], "badge": toc[i]["명찰"],
                     "name": toc[i]["절"], "startDoc": toc[i]["시작문서"]} for i in idxs])


def dispatch(s: dict) -> dict:
    """나배정 — 절마다 먼저 읽을 문서를 정하고, 남의 구역을 붙여 동시에 내보낸다.

    첫 바퀴에는 파견 전에 사람의 결재를 받는다. 목차(편집장)와 배정(나배정)을
    한 화면에 나란히 놓아야 오배정을 잡을 수 있기 때문이다.
    """
    p = s["plan"]
    toc = [dict(x) for x in p["목차"]]
    read = {d for _, d in s.get("visited", [])}
    축, 제목, idxs = p.get("축", "서사"), p.get("제목", ""), p["배치"]
    시도 = 0

    # 승인된 배정은 **다시 돌리지 않는다.** 서버리스에서 2단계로 나눌 때,
    # 사람이 승인한 시작 문서가 2단계에서 바뀌어 버리면 결재가 헛것이 된다.
    # (assign.done 도 1단계에서 이미 보냈으니 다시 보내지 않는다)
    승인됨 = bool(p.get("승인됨")) and p["바퀴"] == 1

    while True:
        if not 승인됨:
            for i, d in 배정(s["question"], toc, idxs, read, 축).items():
                toc[i]["시작문서"] = d
            _배정이벤트(toc, idxs, p["바퀴"], 시도 + 1)

        if 승인됨 or p["바퀴"] != 1 or _approver is None:   # 재위임 바퀴는 결재를 묻지 않는다
            break
        emit("approval.request", attempt=시도 + 1)
        approved, 사유 = _approver({"축": 축, "제목": 제목, "목차": toc})
        emit("approval.result", approved=bool(approved), reason=사유 or "")
        if approved or 시도 >= 설정["최대반려"]:
            break

        시도 += 1                                    # 반려 — 목차부터 다시 짠다
        축, 제목, toc = _목차정리(_기획요청(s["question"], 사유 or "사유 없음"), s["question"])
        idxs = list(range(len(toc)))
        emit("plan.done", title=제목, axis=축, attempt=시도 + 1,
             sections=[{"idx": i, "name": t["절"], "brief": t["지시"],
                        "badge": t["명찰"], "cast": t["콜사인"], "startDoc": ""}
                       for i, t in enumerate(toc)])

    assignees = []
    for i in idxs:
        남의구역 = {t["시작문서"] for j, t in enumerate(toc) if j != i and t["시작문서"]}
        피하기 = sorted(남의구역 | read) if 설정["구역"] else []
        assignees.append({"idx": i, "cast": toc[i]["콜사인"], "badge": toc[i]["명찰"],
                          "name": toc[i]["절"], "startDoc": toc[i]["시작문서"], "avoid": 피하기})
    emit("dispatch", wheel=p["바퀴"], assignees=assignees)
    return {"plan": {**p, "축": 축, "제목": 제목, "목차": toc, "배치": idxs},
            "log": [f"② 배치   {p['바퀴']}바퀴 · 기자 {len(idxs)}명 동시 파견"]}


def fanout(s: dict):
    """②가 여는 갈림길 — 절마다 Send 를 하나씩. 빈 목록이면 곧장 점검으로."""
    p = s["plan"]
    idxs = p.get("배치", [])
    if not idxs:
        return "review"
    toc, read = p["목차"], {d for _, d in s.get("visited", [])}
    sends = []
    for i in idxs:
        남의구역 = {t["시작문서"] for j, t in enumerate(toc) if j != i and t["시작문서"]}
        task = {**toc[i], "번호": i, "피하기": sorted(남의구역 | read) if 설정["구역"] else []}
        prior = 절모음(s).get(toc[i]["절"], {}) if p["바퀴"] > 1 else {}
        sends.append(Send("researcher", {"question": s["question"], "task": task, "prior": prior}))
    return sends


# ── ③ 조사 — 현장기자 5명 · 노드 하나가 에이전트 한 명 ───────────────────
# 인용·문체 규칙 — **팀과 혼자(baseline)가 같은 문자열을 쓴다.**
# 따로 적어 두면 "프롬프트가 달라서 진 것"이라는 반론이 성립한다. 15강이 대조군을
# 약하게 만들지 말라고 한 것은 예산만이 아니라 이런 것도 포함한다.
인용규칙 = (
    "Append the source document title as «Document Title» to each sentence that rests on a source. "
    "Do not write anything not in the notes.\n"
    # 문체는 **쓰는 자리에서** 맞춘다. ⑤ 종합에서 다시 쓰면 문체는 통일되지만
    # 격리가 무너지고 인용이 샌다 (12강). 여기서 어미만 지정하면 둘 다 지킨다.
    "[문체] 모든 문장은 '~습니다/~입니다' 체로 끝낸다. '~이다/~한다' 체와 섞지 않는다.\n")


def 요약(doc: str, 지시: str, 명찰: str, coord: bool = False) -> str:
    """도구 하나 — 문서를 통째로 읽고 지시에 맞는 대목만 간추려 돌려준다.

    `coord=True` 는 혼자 하는 대조군이 쓴다. 프롬프트는 같고 **계량만** 달라진다 —
    혼자 하는 쪽은 요약이 전부 자기 창에 쌓이므로 그 글자는 코디네이터 몫으로 센다.
    """
    return ask(
        f"You are a field reporter ({명찰}). Read the document and summarize ONLY what relates to the "
        "instruction, in at most six sentences, in Korean. If nothing relates, answer exactly '관련 없음'.",
        f"[지시] {지시}\n\n[문서]\n{DOCS.get(doc, '')}", coord=coord)


def 후보목록(read: set, 피하기: list, frontier: set) -> list:
    """읽은 문서의 링크가 다음 후보다. 막히면 전체에서, 그것도 막히면 구역 제한을 푼다."""
    for cand in (frontier - read - set(피하기), set(DOCS) - read - set(피하기), set(DOCS) - read):
        if cand:
            return sorted(cand)
    return []


def 다음문서(절: str, 지시: str, read: set, cand: list, 빈손: bool = False, coord: bool = False):
    """빈손(모은 자료가 0)이면 그만두지 못한다 — 자료 없이 절을 쓰면 모델이 상식으로 채운다."""
    if not cand:
        return None
    금지 = ("\nYou have collected NOTHING so far, so you MUST pick one. Returning null is forbidden."
            if 빈손 else "")
    raw = ask(
        "You pick the next document to read. Choose exactly one title from the candidates, or stop if "
        'there is nothing more worth reading. JSON only: {"문서":"후보에 있는 제목"} 또는 {"문서":null}'
        + 금지,
        f"[맡은 절] {절} — {지시}\n[이미 읽음] {', '.join(sorted(read)) or '없음'}\n"
        "[후보]\n" + "\n".join(f"- {c}" for c in cand[:60]), coord=coord)
    pick = jload(raw, {}).get("문서")
    if pick in cand:
        return pick
    return cand[0] if 빈손 else None       # 빈손이면 모델이 뭘 답하든 첫 후보로 밀어붙인다


def 인용교정(본문: str, read: set) -> tuple[str, int, int]:
    """모델이 붙인 «인용» 을 코드가 검사한다.

    우리 코퍼스에는 「Phase Two」 처럼 다른 작품을 잔뜩 나열하는 문서가 있어서,
    기자가 요약 안에 등장한 작품 이름을 근거처럼 «» 로 감싸는 일이 구조적으로 일어난다.
    프롬프트로는 막히지 않아 코드가 마무리한다.

      · 읽은 문서와 정확히 일치        → 그대로
      · 읽은 문서의 축약형             → 정식 명칭으로 교정
      · 읽은 문서 어디에도 없음        → «» 만 벗긴다 (내용은 남긴다)
    """
    # 모델이 «…» 대신 «…" 로 닫는 일이 있다. 그대로 두면 정규식이 다음 절까지 삼킨다.
    본문 = re.sub(r'«([^«»\n]{2,100})["”’\']', r"«\1»", 본문)

    def norm(x): return re.sub(r"[^a-z0-9]+", "", x.lower())
    읽은 = {norm(d): d for d in read}
    교정 = 제거 = 0

    def 치환(m):
        nonlocal 교정, 제거
        c = m.group(1)
        if c in read:
            return m.group(0)
        n = norm(c)
        후보 = sorted({d for k, d in 읽은.items() if n and (k.startswith(n) or n in k)})
        if len(후보) == 1:
            교정 += 1
            return f"«{후보[0]}»"
        제거 += 1
        return c

    return re.sub(r"«([^»]+)»", 치환, 본문), 교정, 제거


def researcher(s: dict) -> dict:
    """절 하나를 통째로 맡는다 — 탐색하고, 쓰고, 올린다. 원문은 이 함수 밖으로 나가지 않는다."""
    t, idx, 콜 = s["task"], s["task"]["번호"], s["task"]["콜사인"]
    prior = s.get("prior") or {}
    read, notes = set(prior.get("읽은문서", [])), list(prior.get("메모", []))
    frontier = set()
    for d in read:
        frontier |= set(LINKS.get(d, []))

    다음 = t["시작문서"] if t["시작문서"] and t["시작문서"] not in read else None
    for _ in range(t["예산"]):                       # 코드라 모델이 어길 수 없다
        if 다음 is None:
            다음 = 다음문서(t["절"], t["지시"], read,
                         후보목록(read, t.get("피하기", []), frontier), 빈손=not notes)
        if 다음 is None:
            break
        memo = 요약(다음, t["지시"], t["명찰"])
        관련 = not memo.strip().startswith("관련 없음")
        read.add(다음)
        if 관련:
            notes.append(f"«{다음}» {memo}")
        frontier |= set(LINKS.get(다음, []))          # 읽은 것이 다음 후보를 만든다
        emit("research.read", idx=idx, cast=콜, doc=다음, chars=len(DOCS.get(다음, "")),
             relevant=관련, readCount=len(read))
        다음 = None

    raw = ask(
        f"You are the {t['명찰']} of a research desk. Write ONE section of the report using ONLY the notes "
        "below. 6~12 sentences, at least 600 characters, in Korean. "
        + 인용규칙 +                                   # 혼자 하는 대조군과 **같은 문자열**
        "If the notes were not enough to cover the instruction, set 충분 to false and say what is missing.\n"
        '답은 한국어로. JSON만: {"본문":"...","충분":true,"부족":""}',
        # 인용을 금지하는 경고는 두지 않는다 — 넣었더니 모델이 위축해 인용을 아예 안 붙였다.
        # 자유롭게 달게 하고, 잘못 단 것은 아래 인용교정() 이 코드로 정리한다.
        f"[맡은 절] {t['절']} — {t['지시']}\n"
        f"[읽은 문서 — 인용할 때 이 제목을 그대로 옮겨 적는다]\n"
        + "\n".join(f"- {d}" for d in sorted(read)) + "\n\n"
        "[모은 자료]\n" + ("\n\n".join(notes) or "(읽은 자료 없음)"))
    obj = jload(raw, {})
    # JSON 파싱이 실패하면 본문만 도려낸다 — 앞머리와 꼬리를 둘 다 떼야 한다.
    # 앞머리만 떼면 «…»","충분":true,"부족":""} 가 본문 끝에 그대로 남는다.
    본문 = obj.get("본문") or 본문만(raw)
    본문, 교정, 제거 = 인용교정(본문, read)          # 코드가 인용을 검사하고 마무리한다
    인용 = re.findall(r"«([^»]+)»", 본문)
    sec = {"번호": idx, "절": t["절"], "명찰": t["명찰"], "콜사인": 콜, "본문": 본문,
           "읽은문서": sorted(read), "메모": notes, "인용": 인용,
           "허위인용": [c for c in set(인용) if c not in read],   # 교정 후엔 0이어야 한다
           "교정": 교정, "제거": 제거,
           "충분": bool(obj.get("충분", True)), "부족": obj.get("부족", "")}
    emit("research.done", idx=idx, cast=콜, chars=len(본문), citations=len(인용),
         fake=len(sec["허위인용"]), fixed=교정, stripped=제거,
         enough=sec["충분"], missing=sec["부족"])
    return {"sections": [sec], "visited": [(t["절"], d) for d in read],
            "log": [f"   ③ {콜} «{t['절'][:20]}» {len(read)}건 읽고 {len(본문)}자"]}


# ── ④ 점검 — 정반송 · LLM 호출 0회 (집계하고 되돌려 보낼 뿐) ─────────────
def review(s: dict) -> dict:
    p, latest = s["plan"], 절모음(s)
    wheel = p["바퀴"]
    # 빈 칸 = 자기신고 '부족'  또는  (스위치가 켜져 있으면) 인용 0곳
    def 빈칸인가(sec):
        if not sec["충분"]:
            return True
        return 설정["인용0곳점검"] and not sec.get("인용")
    gaps = [sec["번호"] for sec in latest.values() if 빈칸인가(sec)]
    if (not 설정["재위임"]) or wheel >= 설정["최대바퀴"] or not gaps:
        reason = "빈 칸 없음" if not gaps else ("예산 소진" if wheel >= 설정["최대바퀴"] else "재위임 꺼짐")
        emit("review.done", wheel=wheel, gaps=[], gapNames=[], stopped=True, reason=reason)
        return {"plan": {**p, "배치": [], "멈춘이유": reason},
                "log": [f"④ 점검   {len(latest)}절 중 빈 칸 {len(gaps)}개 — 종합으로 ({reason})"]}

    newtoc = [dict(x) for x in p["목차"]]
    for i in gaps:                                   # '무엇이 비었는지' 를 지시에 실어야 겨냥이 된다
        prev = next((x for x in latest.values() if x["번호"] == i), {})
        # 무엇이 비었는지를 지시에 실어야 겨냥이 된다 (10강 — ①의 약점이 '그 문장을 못 준다' 였다).
        # 인용 0곳은 자기신고가 없어도 무엇이 빈지 자명하다 — 근거가 하나도 없다는 것이다.
        빈이유 = (prev.get("부족")
                  or ("근거(«문서»)를 한 곳도 붙이지 못했다" if not prev.get("인용")
                      else "근거가 모자랐다"))
        newtoc[i]["지시"] = (f"{p['목차'][i]['지시']} (재위임: 지난번에 "
                            f"«{'», «'.join(prev.get('읽은문서', [])) or '없음'}» 를 읽었지만 "
                            f"{빈이유}. 그 빈 칸을 겨냥해 아직 안 본 문서를 찾아라)")
    emit("review.done", wheel=wheel, gaps=gaps, stopped=False,
         gapNames=[p["목차"][i]["절"] for i in gaps], reason=f"빈 칸 {len(gaps)}개 — 재위임")
    return {"plan": {**p, "목차": newtoc, "배치": gaps, "바퀴": wheel + 1},
            "log": [f"④ 점검   빈 칸 {len(gaps)}개 — 재위임"]}


def route(s: dict) -> str:
    return "more" if s["plan"].get("배치") else "done"


# ── ⑤ 종합 — 윤카피 · 절 본문은 손대지 않는다 ───────────────────────────
def synthesize(s: dict) -> dict:
    secs = sorted(절모음(s).values(), key=lambda x: x["번호"])
    outline = "\n".join(f"{i+1}. {x['절']}: {x['본문'][:90]}…" for i, x in enumerate(secs))
    raw = ask(
        "You are the copy editor closing out a report. Below are the section titles and openings written by "
        "the reporters. Do NOT touch the body text — write only an opening and a closing, three sentences "
        "each, in Korean. 모든 문장은 '~습니다/~입니다' 체로 끝낸다. "
        'JSON만: {"머리말":"...","맺음말":"..."}',
        f"[보고서 제목] {s['plan']['제목']}\n[절 목록]\n{outline}", coord=True)
    obj = jload(raw, {})
    parts = [f"# {s['plan']['제목']}", "", obj.get("머리말", "")]
    for i, x in enumerate(secs):
        # 절 머리글에는 제목만 — 누가 썼는지는 화면의 편집국이 보여 준다
        parts += ["", f"## {i+1}. {x['절']}", "", x["본문"]]
    parts += ["", "## 맺음말", "", obj.get("맺음말", "")]
    본문, 참고 = 조판("\n".join(parts))          # 출처를 맨 끝 참고자료로 모은다
    report = 본문 + 참고블록(참고)
    # **글자수는 참고자료를 뺀 본문만 센다.**
    emit("synthesize.done", chars=len(본문), sections=len(secs), title=s["plan"]["제목"])
    return {"report": report, "본문자수": len(본문), "참고자료수": len(참고),
            "log": [f"⑤ 종합   {len(secs)}절 → 보고서 {len(본문)}자 · 참고자료 {len(참고)}건"]}


# ── ⑥ 평가 — 최계량 · 정답표도 판정 모델도 쓰지 않는다 ──────────────────
def 문장들(t: str) -> list:
    return [x.strip() for x in re.split(r"(?<=[.!?。])\s+|\n+", t) if len(x.strip()) > 10]


def evaluate(s: dict) -> dict:
    secs = list(절모음(s).values())
    문장 = 문장들("\n".join(x["본문"] for x in secs))
    근거붙은 = [x for x in 문장 if "«" in x]
    인용 = [c for x in secs for c in x["인용"]]
    쓰임 = Counter(인용)
    읽은 = {d for x in secs for d in x["읽은문서"]}
    중복 = sum(1 for _, c in Counter(d for x in secs for d in x["읽은문서"]).items() if c > 1)
    빈절 = [x["절"] for x in secs if not x["인용"]]   # 보고서 전체 근거율로는 안 보이는 절 단위 구멍
    불일치, 판정, 예시 = 출처대조(secs)
    m = {
        "근거율": round(100 * len(근거붙은) / max(len(문장), 1), 1),
        "허위인용": sum(len(x["허위인용"]) for x in secs),
        "읽고안쓴": sorted(읽은 - set(인용)),
        "편중": round(100 * max(쓰임.values()) / max(sum(쓰임.values()), 1), 1) if 쓰임 else 0.0,
        "중복률": round(100 * 중복 / max(len(읽은), 1), 1),
        "격리율": round(100 * COST["coord_chars"] / max(COST["coord_chars"] + COST["sub_chars"], 1), 1),
        "인용0절": len(빈절), "인용0절이름": 빈절,
        # 2바퀴 원고가 더 나빠서 1바퀴를 지킨 절의 수 — 안 보이면 확인할 수 없는 결정이라 센다
        "원고지킴": sum(1 for x in secs if x.get("원고지킴")),
        # 읽긴 했는데 엉뚱한 문장에 붙인 인용 — 판정할 수 있었던 것 중에서만 센다
        "출처불일치": 불일치, "출처대조가능": 판정, "출처불일치예": 예시,
        # 코드가 인용을 몇 번 손봤나 — 모델이 얼마나 헛인용을 하는지 관찰하는 값
        "인용정정": sum(x.get("교정", 0) + x.get("제거", 0) for x in secs),
        "읽은문서수": len(읽은), "인용수": len(인용),
        "보고서자수": s.get("본문자수", len(조판(s["report"])[0])),      # 참고자료 제외
        "참고자료수": s.get("참고자료수", len(조판(s["report"])[1])),
        "호출": COST["calls"],
        # 모델에 넣은 입력량 — 토큰과 비용을 여기서 환산한다 (출력값은 재지 않는다)
        "입력자수": COST["coord_chars"] + COST["sub_chars"],
        "입력토큰": (COST["coord_chars"] + COST["sub_chars"]) // 4,
        "입력비용": round((COST["coord_chars"] + COST["sub_chars"]) / 4 / 1_000_000 * 0.15, 4),
        "모델": getattr(llm.backend(), "name", "gpt-4o-mini"),
    }
    emit("evaluate.done", metrics=m)
    log = [f"⑥ 평가   근거율 {m['근거율']}% · 허위인용 {m['허위인용']}곳 "
           f"· 편중 {m['편중']}% · 중복률 {m['중복률']}% · 인용0절 {m['인용0절']}개 "
           f"· 인용정정 {m['인용정정']}회"]
    if 판정:
        log.append(f"         출처불일치 {불일치}/{판정}곳 (문장 {len(근거붙은)}개 중 "
                   f"{round(100 * 판정 / max(len(근거붙은), 1))}%만 대조 가능)")
    if m["원고지킴"]:
        log.append(f"         2바퀴 원고가 근거를 덜 달아 1바퀴를 지킨 절 {m['원고지킴']}개")
    return {"metrics": m, "log": log}


# ── 그래프 ───────────────────────────────────────────────────────────────
NODES = ("plan", "dispatch", "researcher", "review", "synthesize", "evaluate")


def build(start: str = "plan"):
    """start="dispatch" 면 ①기획을 건너뛴다 — 결재를 받고 나서 이어 돌릴 때 쓴다."""
    g = StateGraph(Research)
    for name in NODES:
        g.add_node(name, globals()[name])          # 이름으로 찾으니 갈아 끼울 수 있다
    g.add_edge(START, start)
    g.add_edge("plan", "dispatch")
    g.add_conditional_edges("dispatch", lambda s: globals()["fanout"](s), ["researcher", "review"])
    g.add_edge("researcher", "review")
    g.add_conditional_edges("review", lambda s: globals()["route"](s),
                            {"more": "dispatch", "done": "synthesize"})
    g.add_edge("synthesize", "evaluate")
    g.add_edge("evaluate", END)
    return g


# ── 두 단계로 잘라 쓰기 (서버리스) ──────────────────────────────────────
# 서버리스 함수는 **사람을 기다리는 동안에도 실행 시간을 태운다.** 결재 게이트가 있는
# 우리 파이프라인은 그래서 한 번에 돌릴 수 없다. 두 번 나눠 부른다.
#
#   1) plan_only()  ① 기획 + ② 배정까지 (LLM 2회, 몇 초) → 목차를 돌려주고 끝낸다
#      ── 사람이 승인/반려를 누른다. 이 동안 함수는 돌지 않는다 ──
#   2) run_from()   승인된 목차를 받아 파견부터 끝까지
#
# 브라우저 안에서 돌 때는 run() 하나로 충분하다 — 둘 다 남겨 둔다.

def 설정적용(overrides: dict | None) -> dict:
    """요청마다 오는 설정을 씌운다. 아는 열쇠만 받고, 숫자는 범위를 자른다.

    ⚠ **bool 을 int 보다 먼저 본다.** 파이썬에서 bool 은 int 의 하위형이라
    `isinstance(True, int)` 가 참이다. 순서를 반대로 뒀더니 `역할=False` 가
    `max(1, min(8, 0))` = **1** 이 되어, 라이브에서 스위치를 꺼도 켜진 채 돌았다.
    녹화 22편은 record.py 가 `설정.update()` 를 직접 써서 무사하다.
    """
    if overrides:
        for k, v in overrides.items():
            if k not in 설정:
                continue
            if isinstance(설정[k], bool):
                설정[k] = bool(v)
            elif isinstance(설정[k], int):
                설정[k] = max(1, min(8, int(v)))
    return dict(설정)


def _빈상태(question: str) -> dict:
    return {"question": question, "plan": {}, "sections": [], "visited": [], "report": "",
            "metrics": {}, "log": [], "task": {}, "prior": {}}


def plan_only(question: str, overrides: dict | None = None,
              반려사유: str = "", attempt: int = 1) -> dict:
    """① 기획 + ② 배정. **결재 직전에서 멈춘다.**

    approval.request 까지 내보내고, 사람이 볼 목차를 돌려준다.
    반려되면 사유를 실어 다시 부르면 된다 — 편집장이 그 사유를 반영해 다시 짠다.
    attempt 는 몇 번째 결재인지 (화면이 「1차 / 2차」를 보여 준다).
    """
    _START[0] = time.time()
    reset_cost()
    설정적용(overrides)
    if attempt == 1:                                   # 다시 짜는 중이면 무대를 비우지 않는다
        emit("run.start", question=question, corpus=len(DOCS), settings=dict(설정),
             cast=CALLSIGNS, staff=["편집장", "최계량"])

    if 반려사유:
        축, 제목, toc0 = _목차정리(_기획요청(question, 반려사유), question)
        p = {"축": 축, "제목": 제목, "목차": toc0, "배치": list(range(len(toc0))), "바퀴": 1}
        emit("plan.done", title=제목, axis=축, attempt=attempt,
             sections=[{"idx": i, "name": t["절"], "brief": t["지시"], "badge": t["명찰"],
                        "cast": t["콜사인"], "startDoc": ""} for i, t in enumerate(toc0)])
    else:
        p = plan(_빈상태(question))["plan"]              # ① 기획 — plan.done 을 내보낸다
    toc = [dict(x) for x in p["목차"]]
    idxs = p["배치"]
    for i, d in 배정(question, toc, idxs, set(), p.get("축", "서사")).items():
        toc[i]["시작문서"] = d                          # ② 배정
    _배정이벤트(toc, idxs, 1, attempt)
    emit("approval.request", attempt=attempt)
    return {"plan": {**p, "목차": toc}, "calls": COST["calls"]}


def run_from(question: str, plan_state: dict, overrides: dict | None = None) -> dict:
    """승인된 목차를 받아 **파견부터 끝까지.** 배정은 다시 돌리지 않는다."""
    _START[0] = time.time()
    설정적용(overrides)
    p = {**plan_state, "바퀴": plan_state.get("바퀴", 1), "승인됨": True}
    p.setdefault("배치", list(range(len(p.get("목차", [])))))
    res = build(start="dispatch").compile().invoke({**_빈상태(question), "plan": p})
    emit("run.end", elapsed=round(time.time() - _START[0], 1), calls=COST["calls"],
         report=res["report"], metrics=res["metrics"])
    return res


def run(question: str) -> dict:
    _START[0] = time.time()
    reset_cost()
    emit("run.start", question=question, corpus=len(DOCS), settings=dict(설정),
         cast=CALLSIGNS, staff=["편집장", "최계량"])
    init = {"question": question, "plan": {}, "sections": [], "visited": [], "report": "",
            "metrics": {}, "log": [], "task": {}, "prior": {}}
    res = build().compile().invoke(init)
    emit("run.end", elapsed=round(time.time() - _START[0], 1), calls=COST["calls"],
         report=res["report"], metrics=res["metrics"])
    return res


if __name__ == "__main__":
    import sys
    q = sys.argv[1] if len(sys.argv) > 1 else \
        "인피니티 스톤을 둘러싼 주요 사건들은 무엇이고 각각의 원인은 무엇인가?"
    on_event(lambda e: print(json.dumps(e, ensure_ascii=False)[:150]))
    out = run(q)
    print()
    for line in out["log"]:
        print(line)
