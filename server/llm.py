# -*- coding: utf-8 -*-
"""LLM 추상화 — 기본은 강의와 같은 gpt-4o-mini, 환경변수로 Claude 교체 가능.

    OFFICE_LLM=openai     (기본)  · OPENAI_API_KEY 필요
    OFFICE_LLM=anthropic          · ANTHROPIC_API_KEY 필요
"""
import os, time
from pathlib import Path

# .env 를 server/ → 프로젝트 루트 순으로 찾아 읽는다 (키는 저장소 밖으로 나가지 않는다)
try:
    from dotenv import load_dotenv
    for _p in (Path(__file__).parent / ".env", Path(__file__).parent.parent / ".env"):
        if _p.exists():
            load_dotenv(_p)
            break
except ImportError:
    pass

COST = {"calls": 0, "sub_chars": 0, "coord_chars": 0}  # ⑥ 평가가 읽는 계량기
TRANSIENT = ("RateLimit", "APIConnection", "Timeout", "InternalServer", "Overloaded")
CAP = 60000  # 한 번에 모델에 넣는 최대 글자 수


def reset_cost():
    COST.update(calls=0, sub_chars=0, coord_chars=0)


class _OpenAI:
    name = "gpt-4o-mini"

    def __init__(self):
        from langchain_openai import ChatOpenAI
        self.llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, timeout=90, max_retries=0)

    def __call__(self, system, user):
        return self.llm.invoke([{"role": "system", "content": system},
                                {"role": "user", "content": user}]).content


class _Anthropic:
    name = "claude-haiku-4-5-20251001"

    def __init__(self):
        import anthropic
        self.client = anthropic.Anthropic()

    def __call__(self, system, user):
        r = self.client.messages.create(
            model=self.name, max_tokens=2000, temperature=0,
            system=system, messages=[{"role": "user", "content": user}])
        return r.content[0].text


_backend = None


def backend():
    global _backend
    if _backend is None:
        _backend = _Anthropic() if os.getenv("OFFICE_LLM") == "anthropic" else _OpenAI()
    return _backend


def ask(system: str, user: str, coord: bool = False, cap: int = CAP) -> str:
    """강의의 ask() 와 같다 — 계량기를 올리고, 일시적 오류만 재시도한다."""
    body = user[:cap]
    COST["calls"] += 1
    COST["coord_chars" if coord else "sub_chars"] += len(body)
    for attempt in range(3):
        try:
            return backend()(system, body)
        except Exception as e:
            transient = any(k in type(e).__name__ for k in TRANSIENT)
            if attempt == 2 or not transient:   # 설정 오류라면 바로 드러내는 편이 낫다
                raise
            time.sleep(2 ** attempt)
