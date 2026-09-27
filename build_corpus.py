# -*- coding: utf-8 -*-
"""
MCU 코퍼스 빌더 — 영어 위키백과에서 인피니티 사가 문서를 모아
강의의 corpus.json 과 같은 {docs, links} 구조로 저장한다.

강의 코퍼스와 맞추기 위해 세 가지를 처리한다.
  ① 목록 문서 제외      — «List of …» 류는 서사가 아니라 나열이라 조사관이 쓸 재료가 못 된다
  ② 본문 링크만 추출    — {{템플릿}}(내비게이션 박스)을 제거하지 않으면 링크가 완전 그래프가 된다
  ③ 긴 문서 섹션 분할   — 강의 코드의 ask(cap=60000) 에 걸려 뒷부분이 통째로 잘리는 것을 막는다
"""
import urllib.request, urllib.parse, json, time, re, sys
from pathlib import Path

HEADERS = {"User-Agent": "Mozilla/5.0 (mcu-deepresearch; contact:study@example.com)"}
LANG = "en"
CAP = 60000          # 강의 코드의 ask(cap=60000)
SPLIT_OVER = 55000   # 이 길이를 넘으면 섹션 단위로 나눈다
CHUNK_MAX = 40000    # 나눈 조각 하나의 상한
MIN_CHARS = 2000     # 이보다 짧으면 코퍼스에 넣지 않는다 (재료가 안 되는 문서)

# ── 인피니티 사가 영화 23편 + 핵심 개념/인물 문서 ────────────────────────────
SEEDS = [
    "Iron Man (2008 film)", "The Incredible Hulk (film)", "Iron Man 2", "Thor (film)",
    "Captain America: The First Avenger", "The Avengers (2012 film)", "Iron Man 3",
    "Thor: The Dark World", "Captain America: The Winter Soldier",
    "Guardians of the Galaxy (film)", "Avengers: Age of Ultron", "Ant-Man (film)",
    "Captain America: Civil War", "Doctor Strange (2016 film)",
    "Guardians of the Galaxy Vol. 2", "Spider-Man: Homecoming", "Thor: Ragnarok",
    "Black Panther (film)", "Avengers: Infinity War", "Ant-Man and the Wasp",
    "Captain Marvel (film)", "Avengers: Endgame", "Spider-Man: Far From Home",
    # 개념·세계관 문서 — 영화들을 서로 이어 주는 허브 역할
    "Marvel Cinematic Universe", "Infinity Stones",
    "Marvel Cinematic Universe: Phase One", "Marvel Cinematic Universe: Phase Two",
    "Marvel Cinematic Universe: Phase Three", "Marvel Studios",
]

# 제목이 이것으로 시작하거나 포함하면 버린다 (목록·부속 문서)
DROP_PREFIX = ("List of", "Characters of", "Index of", "Outline of")
DROP_CONTAINS = ("cast members", "filmography", "soundtrack", "video game",
                 "(soundtrack)", "home media")


def api(params, retries=5):
    qs = urllib.parse.urlencode(params)
    url = f"https://{LANG}.wikipedia.org/w/api.php?{qs}"
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(2 ** i)


def strip_templates(wt):
    """{{...}} 를 안쪽부터 반복 제거한다 — 내비게이션 템플릿이 링크를 완전 그래프로 만든다."""
    prev = None
    while prev != wt:
        prev = wt
        wt = re.sub(r"\{\{[^{}]*\}\}", "", wt)
    return wt


def is_junk(title):
    if any(title.startswith(p) for p in DROP_PREFIX):
        return True
    low = title.lower()
    return any(k in low for k in DROP_CONTAINS)


def split_sections(text):
    """평문에서 '== 제목 ==' 으로 (제목, 본문) 목록을 만든다."""
    parts = re.split(r"\n==\s*([^=\n]+?)\s*==\n", "\n" + text)
    out = [("Overview", parts[0].strip())]
    for i in range(1, len(parts) - 1, 2):
        out.append((parts[i].strip(), parts[i + 1].strip()))
    return [(h, b) for h, b in out if b]


def section_links(wikitext):
    """섹션별 본문 링크 — 어느 대목에서 어디로 이어지는지를 살린다."""
    body = strip_templates(wikitext)
    parts = re.split(r"\n==\s*([^=\n]+?)\s*==\n", "\n" + body)
    res = {}

    def links_of(s):
        return {m.strip() for m in re.findall(r"\[\[([^\[\]|#]+)", s)
                if not m.startswith(("File:", "Image:", "Category:"))}

    res["Overview"] = links_of(parts[0])
    for i in range(1, len(parts) - 1, 2):
        res[parts[i].strip()] = links_of(parts[i + 1])
    return res


def fetch(title):
    d = api({"action": "query", "redirects": 1, "prop": "extracts", "explaintext": 1,
             "titles": title, "format": "json"})
    real, text = title, ""
    for pid, pg in d["query"]["pages"].items():
        if pid == "-1":
            return None
        real, text = pg.get("title", title), pg.get("extract", "")
    if len(text) < MIN_CHARS or is_junk(real):
        return None
    time.sleep(0.25)
    p = api({"action": "parse", "page": real, "prop": "wikitext", "format": "json"})
    return {"title": real, "text": text, "wikitext": p["parse"]["wikitext"]["*"]}


def to_docs(page):
    """긴 문서는 섹션 경계에서 나눈다. 짧으면 통째로 한 건."""
    title, text = page["title"], page["text"]
    slinks = section_links(page["wikitext"])
    if len(text) <= SPLIT_OVER:
        all_links = set().union(*slinks.values()) if slinks else set()
        return [(title, text, all_links)]

    chunks, cur_name, cur_text, cur_links = [], None, "", set()
    for head, body in split_sections(text):
        piece = f"== {head} ==\n{body}" if head != "Overview" else body
        if cur_text and len(cur_text) + len(piece) > CHUNK_MAX:
            chunks.append((f"{title} — {cur_name}", cur_text, cur_links))
            cur_name, cur_text, cur_links = head, piece, set(slinks.get(head, ()))
        else:
            cur_name = cur_name or head
            cur_text = (cur_text + "\n\n" + piece).strip()
            cur_links |= set(slinks.get(head, ()))
    if cur_text:
        chunks.append((f"{title} — {cur_name}", cur_text, cur_links))
    return chunks


def main():
    pages = []
    for t in SEEDS:
        try:
            pg = fetch(t)
            if pg:
                pages.append(pg)
                sys.stderr.write(f"  받음 [{len(pages):2d}] {pg['title'][:50]} ({len(pg['text']):,}자)\n")
            else:
                sys.stderr.write(f"  건너뜀 {t}\n")
        except Exception as e:
            sys.stderr.write(f"  실패 {t}: {e}\n")
        time.sleep(0.3)

    # 문서 확정 (긴 것은 분할)
    docs, raw_links, origin = {}, {}, {}
    for pg in pages:
        for name, text, links in to_docs(pg):
            docs[name] = text
            raw_links[name] = links
            origin.setdefault(pg["title"], []).append(name)

    # 링크를 코퍼스 안의 문서 이름으로 해석 (분할된 문서는 그 조각 전부로 이어진다)
    links = {}
    for name, lset in raw_links.items():
        resolved = []
        for l in lset:
            for target in origin.get(l, []):
                if target != name:
                    resolved.append(target)
        links[name] = sorted(set(resolved))

    out = Path(__file__).parent / "corpus.json"
    out.write_text(json.dumps({"docs": docs, "links": links}, ensure_ascii=False), encoding="utf-8")

    # ── 검증 리포트 — 강의 조건을 만족하는지 ────────────────────────────
    lens = [len(v) for v in docs.values()]
    total, n = sum(lens), len(docs)
    tokens = total / 4  # 영어 기준 약 4자 = 1토큰
    lc = [len(v) for v in links.values()]
    isolated = [k for k, v in links.items() if not v]
    print("=" * 62)
    print("MCU 코퍼스 검증")
    print("=" * 62)
    print(f"문서 수            : {n}건                     (강의 34건)")
    print(f"총 글자수          : {total:,}자              (강의 447,487자)")
    print(f"평균/최소/최대     : {total//n:,} / {min(lens):,} / {max(lens):,}자")
    print(f"토큰 환산          : 약 {int(tokens):,} 토큰")
    print(f"창(128,000) 대비   : {tokens/128000:.2f}배 "
          f"{'✅ 통과' if tokens > 128000 else '❌ 미달'}")
    print(f"내부 링크 총합     : {sum(lc)}개                  (강의 428개)")
    print(f"문서당 평균 링크   : {sum(lc)/n:.1f}개 = {sum(lc)/n/n*100:.0f}%   (강의 37%)")
    print(f"고립 문서          : {len(isolated)}건 {isolated[:3]}")
    print(f"cap({CAP:,}) 초과  : {sum(1 for l in lens if l > CAP)}건 "
          f"{'✅ 잘림 없음' if all(l <= CAP for l in lens) else '⚠ 잘림 발생'}")
    print(f"{MIN_CHARS:,}자 미만     : {sum(1 for l in lens if l < 3000)}건")
    print(f"\n저장: {out}")


if __name__ == "__main__":
    main()
