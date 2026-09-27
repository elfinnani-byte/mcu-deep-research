// 브라우저에서 도는 6노드 파이프라인 — server/pipeline.py 와 **같은 이벤트**를 뱉는다.
// 한쪽만 고치면 화면이 깨지므로 둘을 함께 고쳐야 한다 (CLAUDE.md 절대 규칙 5).
//
//  ① 기획 ─▶ ② 배정 ─▶ 🔏 승인 ─▶ 파견 ⇉ ③ 조사 ─▶ ④ 점검 ─┬─▶ ⑤ 종합 ─▶ ⑥ 평가
//     ▲                                                     │
//     └──────────── 반려 ────────┘        ▲── 재위임 ────────┘

import { ask, jload, COST, resetCost, CAP, MODEL } from './llm.js';
import { ROSTER, CALLSIGNS } from './config.js';

const CARD = 250;
const 주변섹션 = ['— Music','— Reception','— Marketing','— Release','— Future',
                 '— Recurring cast and characters','— Outside media','— Character rights'];

export const 기본설정 = {
  절수:5, 절예산:3, 최대바퀴:2, 역할:true, 배정:true, 구역:true, 재위임:true, 최대반려:2,
};

// JSON 이 깨졌을 때 본문만 도려낸다 — 앞머리와 꼬리를 둘 다 떼고 이스케이프를 되돌린다.
function 본문만(raw) {
  return raw
    .replace(/^[\s\S]*?"본문"\s*:\s*"?/, '')                 // 앞머리
    .replace(/"?\s*,\s*"충분"[\s\S]*$/, '')                    // 꼬리 ("충분"·"부족")
    .replace(/"?\s*\}\s*$/, '')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .trim().slice(0, 2000);
}

const 역할설명 = {
  '큰그림 담당':'주제의 윤곽을 잡고 핵심 사건과 인물을 간추린다',
  '시간순 담당':'사건을 일어난 순서대로 늘어놓고 언제였는지를 못 박는다',
  '인물 담당':'한 사람이 무엇에 관여했고 어떤 일을 겪었는지 좇는다',
  '원인 담당':'무엇이 무엇으로 이어졌는지 자료에 적힌 대로 따라간다',
  '비교 담당':'둘 이상을 같은 잣대로 견주어 어디가 다른지 정리한다',
  '스토리 담당':'작품 속 사건 전개를 따라간다 (Plot)',
  '제작 담당':'기획·촬영·예산·감독 교체 등 제작 과정을 좇는다 (Production)',
  '흥행 담당':'박스오피스 성적과 평단 반응을 정리한다 (Reception)',
  '캐스팅 담당':'배우와 배역, 출연 계약이 어떻게 정해졌는지 좇는다 (Cast)',
  '세계관 담당':'페이즈·연표·크로스오버가 어떻게 이어지는지 정리한다 (Phase)',
};

export async function run({ question, settings = {}, corpus, emit, approve, signal }) {
  const 설정 = { ...기본설정, ...settings };
  const DOCS = corpus.docs, LINKS = corpus.links;
  const 제목들 = Object.keys(DOCS);
  const 허브 = [...제목들].sort((a, b) => (LINKS[b]?.length || 0) - (LINKS[a]?.length || 0));
  const t0 = performance.now();
  const T = () => +((performance.now() - t0) / 1000).toFixed(2);
  const out = (type, p = {}) => emit({ type, t: T(), ...p });

  const cards = () => 제목들.map(t => `- ${t}: ${DOCS[t].slice(0, CARD).replace(/\n/g, ' ')}`).join('\n');

  resetCost();
  out('run.start', { question, corpus: 제목들.length, settings: 설정,
                     cast: CALLSIGNS, staff: ['한기획','나배정','정반송','윤카피','최계량'] });

  // ── ① 기획 ────────────────────────────────────────────────
  async function 기획(반려사유 = '') {
    const roster = Object.entries(ROSTER).map(([axis, names]) =>
      `[${axis} 축]\n` + names.map(n => `- ${n}: ${역할설명[n]}`).join('\n')).join('\n');
    const raw = await ask(
      'You are the editor-in-chief of a research desk. Build a table of contents for a report that answers ' +
      `the question below, and assign each section to one reporter. At most ${설정.절수} sections.\n` +
      "STEP 1 — Choose ONE axis:\n" +
      "  '서사' when the question asks what happened and why (events, causes, people, chronology).\n" +
      "  '측면' when the question asks how things were made or how they performed " +
      "(production, box office, reception, casting, franchise structure).\n" +
      "STEP 2 — Split the outline by **content units** inside that axis. Do NOT mix the two axes.\n" +
      "STEP 3 — Give each section a badge from the chosen axis only.\n" +
      // 명찰이 겹쳐도 막는 코드가 없다. 실측 — 작품 축(측면)은 서로 다른 명찰이 2.2/5 뿐이고,
      // q5 는 역할을 켜고도 4편 전부 다섯이 `세계관` 하나였다. 다섯이 같은 명찰을 받으면
      // 프롬프트가 다섯 개 다 똑같아 역할이 아무 일도 하지 않는다.
      // 코드로 강제하면 없는 다양성을 지어내 측정이 흐려지므로 **프롬프트로 권하기만 한다.**
      "  Prefer DIFFERENT badges for different sections. Repeat a badge only when the question " +
      "genuinely has no other facet to split on — never force a badge that does not fit the section.\n" +
      `\n[명찰 목록]\n${roster}\n` +
      '\n답은 한국어로. JSON만: {"축":"서사" 또는 "측면","제목":"보고서 제목",' +
      '"목차":[{"절":"절 제목","지시":"이 절에서 밝혀야 할 것 한두 문장","명찰":"고른 축의 명찰 이름 그대로"}]}',
      `[질문] ${question}` +
      (반려사유 ? `\n\n[이전 목차가 반려되었다] 사유: ${반려사유}\n이 사유를 반영해 목차를 다시 짜라.` : '') +
      `\n[읽을 수 있는 문서 카드]\n${cards()}`,
      { coord: true, signal });

    const o = jload(raw, {});
    const 축 = ROSTER[o.축] ? o.축 : '서사';
    const badges = ROSTER[축];
    const toc = (o.목차 || []).slice(0, 설정.절수).map((it, i) => {
      let 명찰 = 설정.역할 ? it.명찰 : badges[0];
      if (!badges.includes(명찰)) 명찰 = badges[0];
      return { 절: it.절 || '(제목 없음)', 지시: it.지시 || question, 명찰,
               시작문서: '', 예산: 설정.절예산, 콜사인: CALLSIGNS[i % CALLSIGNS.length], 번호: i };
    });
    if (!toc.length) toc.push({ 절:'개요', 지시:question, 명찰:badges[0], 시작문서:'',
                                예산:설정.절예산, 콜사인:CALLSIGNS[0], 번호:0 });
    return { 축, 제목: o.제목 || question, toc };
  }

  // ── ② 배정 (나배정) ───────────────────────────────────────
  const 알맹이 = taken => 허브.find(d => !taken.has(d) && !주변섹션.some(x => d.endsWith(x)))
                        || 허브.find(d => !taken.has(d)) || '';

  async function 배정(toc, idxs, 읽은, 축) {
    if (!설정.배정) return Object.fromEntries(idxs.map(i => [i, '']));
    const 목록 = idxs.map((i, n) => `${n+1}) ${toc[i].절} — ${toc[i].지시} (담당: ${toc[i].명찰})`).join('\n');
    const 주변안내 = 축 === '측면'
      ? "이 보고서는 제작·흥행 쪽을 다루므로 '— Production' '— Reception' 조각이 오히려 알맹이다."
      : "'— Music' '— Reception' '— Marketing' '— Release' 로 끝나는 조각은 줄거리가 없으니 피하라.";
    const raw = await ask(
      'You are the dispatcher of a research desk. For each section listed below, pick exactly ONE ' +
      'document the reporter should read FIRST.\n' +
      `Give DIFFERENT documents to different sections. ${주변안내}\n` +
      "Copy titles EXACTLY as they appear in the card list — including any ' — Section' suffix.\n" +
      'Answer with a JSON array ONLY, same length and same order as the section list: ["title", ...]',
      `[질문] ${question}\n[절 목록]\n${목록}` +
      (읽은.size ? `\n[이미 읽힌 문서 — 다시 주지 마라]\n${[...읽은].join(', ')}` : '') +
      `\n[읽을 수 있는 문서 카드]\n${cards()}`,
      { coord: true, signal });

    const picks = jload(raw, []);
    const taken = new Set(읽은), res = {}; let 폴백 = 0;
    idxs.forEach((i, n) => {
      let d = typeof picks[n] === 'string' ? picks[n] : '';
      if (!DOCS[d] || taken.has(d)) { d = 알맹이(taken); 폴백++; }
      taken.add(d); res[i] = d;
    });
    if (폴백) out('dispatch.fallback', { count: 폴백, total: idxs.length });
    return res;
  }

  // ── ③ 조사 (기자 한 명) ───────────────────────────────────
  const 요약 = (doc, 지시, 명찰) => ask(
    `You are a field reporter (${명찰}). Read the document and summarize ONLY what relates to the ` +
    "instruction, in at most six sentences, in Korean. If nothing relates, answer exactly '관련 없음'.",
    `[지시] ${지시}\n\n[문서]\n${DOCS[doc] || ''}`, { signal });

  function 후보목록(read, 피하기, frontier) {
    const 제외 = new Set([...read, ...피하기]);
    const a = [...frontier].filter(d => !제외.has(d));
    if (a.length) return a.sort();
    const b = 제목들.filter(d => !제외.has(d));
    if (b.length) return b.sort();
    return 제목들.filter(d => !read.has(d)).sort();
  }

  async function 다음문서(절, 지시, read, cand, 빈손) {
    if (!cand.length) return null;
    const raw = await ask(
      'You pick the next document to read. Choose exactly one title from the candidates, or stop if ' +
      'there is nothing more worth reading. JSON only: {"문서":"후보에 있는 제목"} 또는 {"문서":null}' +
      (빈손 ? '\nYou have collected NOTHING so far, so you MUST pick one. Returning null is forbidden.' : ''),
      `[맡은 절] ${절} — ${지시}\n[이미 읽음] ${[...read].sort().join(', ') || '없음'}\n` +
      '[후보]\n' + cand.slice(0, 60).map(c => `- ${c}`).join('\n'), { signal });
    const pick = jload(raw, {}).문서;
    if (cand.includes(pick)) return pick;
    return 빈손 ? cand[0] : null;
  }

  // 코드가 인용을 검사한다 — 축약은 정식 명칭으로, 안 읽은 것은 «» 를 벗긴다
  function 인용교정(본문, read) {
    본문 = 본문.replace(/«([^«»\n]{2,100})["'”’]/g, '«$1»');
    const norm = x => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const 읽은 = new Map([...read].map(d => [norm(d), d]));
    let 교정 = 0, 제거 = 0;
    const 결과 = 본문.replace(/«([^»]+)»/g, (m, c) => {
      if (read.has(c)) return m;
      const n = norm(c);
      const 후보 = [...new Set([...읽은].filter(([k]) => n && (k.startsWith(n) || k.includes(n))).map(([, v]) => v))];
      if (후보.length === 1) { 교정++; return `«${후보[0]}»`; }
      제거++; return c;
    });
    return [결과, 교정, 제거];
  }

  async function 조사(task, prior) {
    const read = new Set(prior?.읽은문서 || []);
    const notes = [...(prior?.메모 || [])];
    const frontier = new Set();
    read.forEach(d => (LINKS[d] || []).forEach(x => frontier.add(x)));

    let 다음 = task.시작문서 && !read.has(task.시작문서) ? task.시작문서 : null;
    for (let k = 0; k < task.예산; k++) {
      if (!다음) 다음 = await 다음문서(task.절, task.지시, read,
                                     후보목록(read, task.피하기 || [], frontier), notes.length === 0);
      if (!다음) break;
      const memo = await 요약(다음, task.지시, task.명찰);
      const 관련 = !memo.trim().startsWith('관련 없음');
      read.add(다음);
      if (관련) notes.push(`«${다음}» ${memo}`);
      (LINKS[다음] || []).forEach(x => frontier.add(x));
      out('research.read', { idx: task.번호, cast: task.콜사인, doc: 다음,
                             chars: (DOCS[다음] || '').length, relevant: 관련, readCount: read.size });
      다음 = null;
    }

    const raw = await ask(
      `You are the ${task.명찰} of a research desk. Write ONE section of the report using ONLY the notes ` +
      'below. 6~12 sentences, at least 600 characters, in Korean. Append the source document title as ' +
      '«Document Title» to each sentence that rests on a source. Do not write anything not in the notes.\n' +
      'If the notes were not enough to cover the instruction, set 충분 to false and say what is missing.\n' +
      // 문체는 **쓰는 자리에서** 맞춘다. ⑤ 종합에서 다시 쓰면 문체는 통일되지만
      // 격리가 무너지고 인용이 샌다 (12강). 여기서 어미만 지정하면 둘 다 지킨다.
      "[문체] 모든 문장은 '~습니다/~입니다' 체로 끝낸다. '~이다/~한다' 체와 섞지 않는다.\n" +
      '답은 한국어로. JSON만: {"본문":"...","충분":true,"부족":""}',
      `[맡은 절] ${task.절} — ${task.지시}\n[읽은 문서 — 인용할 때 이 제목을 그대로 옮겨 적는다]\n` +
      [...read].sort().map(d => `- ${d}`).join('\n') + '\n\n[모은 자료]\n' +
      (notes.join('\n\n') || '(읽은 자료 없음)'), { signal });

    const o = jload(raw, {});
    // JSON 파싱이 실패하면 원문에서 본문만 도려낸다.
    // 예전에는 앞의 `{"본문":"` 만 떼어내서 **뒤의 `","충분":true,"부족":""}` 가 본문에 남았다.**
    // 실제 녹화 q1-기본 1절 끝에 그 꼬리가 그대로 찍혀 있다.
    let 본문 = o.본문 || 본문만(String(raw));
    const [고친본문, 교정, 제거] = 인용교정(본문, read);
    본문 = 고친본문;
    const 인용 = [...본문.matchAll(/«([^»]+)»/g)].map(m => m[1]);
    const sec = { 번호: task.번호, 절: task.절, 명찰: task.명찰, 콜사인: task.콜사인, 본문,
                  읽은문서: [...read].sort(), 메모: notes, 인용,
                  허위인용: [...new Set(인용)].filter(c => !read.has(c)),
                  교정, 제거, 충분: o.충분 !== false, 부족: o.부족 || '' };
    out('research.done', { idx: task.번호, cast: task.콜사인, chars: 본문.length,
                           citations: 인용.length, fake: sec.허위인용.length,
                           fixed: 교정, stripped: 제거, enough: sec.충분, missing: sec.부족 });
    return sec;
  }

  // ── 본 흐름 ───────────────────────────────────────────────
  let { 축, 제목, toc } = await 기획();
  out('plan.done', { title: 제목, axis: 축, attempt: 1,
                     sections: toc.map(t => ({ idx:t.번호, name:t.절, brief:t.지시,
                                               badge:t.명찰, cast:t.콜사인, startDoc:'' })) });

  const 절모음 = new Map();                 // 절 이름 → 최신 원고
  const visited = [];
  let 배치 = toc.map(t => t.번호), 바퀴 = 1;

  for (;;) {
    const 읽은 = new Set(visited.map(v => v[1]));

    // ② 배정 → 🔏 결재 (첫 바퀴만)
    let 시도 = 0;
    for (;;) {
      const 표 = await 배정(toc, 배치, 읽은, 축);
      배치.forEach(i => { toc[i].시작문서 = 표[i]; });
      out('assign.done', { wheel: 바퀴, attempt: 시도 + 1,
        assignees: 배치.map(i => ({ idx:i, cast:toc[i].콜사인, badge:toc[i].명찰,
                                    name:toc[i].절, startDoc:toc[i].시작문서 })) });
      if (바퀴 !== 1 || !approve) break;
      out('approval.request', { attempt: 시도 + 1 });
      const [ok, 사유] = await approve({ 축, 제목, 목차: toc });
      out('approval.result', { approved: !!ok, reason: 사유 || '' });
      if (ok || 시도 >= 설정.최대반려) break;
      시도++;
      ({ 축, 제목, toc } = await 기획(사유 || '사유 없음'));
      배치 = toc.map(t => t.번호);
      out('plan.done', { title: 제목, axis: 축, attempt: 시도 + 1,
                         sections: toc.map(t => ({ idx:t.번호, name:t.절, brief:t.지시,
                                                   badge:t.명찰, cast:t.콜사인, startDoc:'' })) });
    }

    // 파견
    const tasks = 배치.map(i => {
      const 남의구역 = toc.filter((t, j) => j !== i && t.시작문서).map(t => t.시작문서);
      return { ...toc[i], 피하기: 설정.구역 ? [...new Set([...남의구역, ...읽은])].sort() : [] };
    });
    out('dispatch', { wheel: 바퀴,
      assignees: tasks.map(t => ({ idx:t.번호, cast:t.콜사인, badge:t.명찰,
                                   name:t.절, startDoc:t.시작문서, avoid:t.피하기 })) });

    // ③ 조사 — 다섯이 동시에 (서로를 볼 수 없다)
    const secs = await Promise.all(tasks.map(t => 조사(t, 절모음.get(t.절))));
    secs.forEach(s => { 절모음.set(s.절, s); s.읽은문서.forEach(d => visited.push([s.절, d])); });

    // ④ 점검 — LLM 호출 0회
    const gaps = [...절모음.values()].filter(s => !s.충분).map(s => s.번호);
    const 끝 = !설정.재위임 || 바퀴 >= 설정.최대바퀴 || !gaps.length;
    if (끝) {
      out('review.done', { wheel: 바퀴, gaps: [], gapNames: [], stopped: true,
        reason: !gaps.length ? '빈 칸 없음' : (바퀴 >= 설정.최대바퀴 ? '예산 소진' : '재위임 꺼짐') });
      break;
    }
    out('review.done', { wheel: 바퀴, gaps, stopped: false,
      gapNames: gaps.map(i => toc[i].절), reason: `빈 칸 ${gaps.length}개 — 재위임` });
    gaps.forEach(i => {
      const prev = [...절모음.values()].find(s => s.번호 === i) || {};
      toc[i].지시 = `${toc[i].지시} (재위임: 지난번에 «${(prev.읽은문서||[]).join('», «') || '없음'}» 를 ` +
                    `읽었지만 ${prev.부족 || '근거가 모자랐다'}. 그 빈 칸을 겨냥해 아직 안 본 문서를 찾아라)`;
    });
    배치 = gaps; 바퀴++;
  }

  // ⑤ 종합 — 절 본문은 손대지 않는다
  const 정렬 = [...절모음.values()].sort((a, b) => a.번호 - b.번호);
  const outline = 정렬.map((x, i) => `${i+1}. ${x.절}: ${x.본문.slice(0, 90)}…`).join('\n');
  const raw = await ask(
    'You are the copy editor closing out a report. Below are the section titles and openings written by ' +
    'the reporters. Do NOT touch the body text — write only an opening and a closing, three sentences ' +
    "each, in Korean. 모든 문장은 '~습니다/~입니다' 체로 끝낸다. " +
    'JSON만: {"머리말":"...","맺음말":"..."}',
    `[보고서 제목] ${제목}\n[절 목록]\n${outline}`, { coord: true, signal });
  const ed = jload(raw, {});
  const 원본 = [`# ${제목}`, '', ed.머리말 || '',
    // 절 머리글에는 제목만 둔다. 누가 썼는지는 왼쪽 편집국이 보여 주고,
    // 보고서는 읽는 사람이 내용만 보게 한다.
    ...정렬.flatMap((x, i) => ['', `## ${i+1}. ${x.절}`, '', x.본문]),
    '', '## 맺음말', '', ed.맺음말 || ''].join('\n');
  // 본문의 «문서 제목» 을 번호로 바꾸고 출처는 맨 끝 참고자료로 모은다.
  // 절 본문(정렬[].본문)은 그대로 둔다 — ⑥ 평가가 그걸 세기 때문이다.
  const 갈라진 = 조판(원본);
  const report = 합치기(갈라진);
  // **글자수는 참고자료를 뺀 본문만 센다.**
  out('synthesize.done', { chars: 갈라진.본문.length, sections: 정렬.length, title: 제목 });

  // ⑥ 평가 — 정답표도 판정 모델도 쓰지 않는다
  const 문장 = 정렬.map(x => x.본문).join('\n')
    .split(/(?<=[.!?。])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 10);
  const 인용 = 정렬.flatMap(x => x.인용);
  const 쓰임 = 인용.reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {});
  const 읽은전체 = [...new Set(정렬.flatMap(x => x.읽은문서))];
  const 횟수 = {}; 정렬.forEach(x => x.읽은문서.forEach(d => 횟수[d] = (횟수[d] || 0) + 1));
  const 빈절 = 정렬.filter(x => !x.인용.length).map(x => x.절);
  const vals = Object.values(쓰임);
  const metrics = {
    근거율: +(100 * 문장.filter(s => s.includes('«')).length / Math.max(문장.length, 1)).toFixed(1),
    허위인용: 정렬.reduce((n, x) => n + x.허위인용.length, 0),
    읽고안쓴: 읽은전체.filter(d => !인용.includes(d)).sort(),
    편중: vals.length ? +(100 * Math.max(...vals) / vals.reduce((a, b) => a + b, 0)).toFixed(1) : 0,
    중복률: +(100 * Object.values(횟수).filter(c => c > 1).length / Math.max(읽은전체.length, 1)).toFixed(1),
    격리율: +(100 * COST.coord / Math.max(COST.coord + COST.sub, 1)).toFixed(1),
    인용0절: 빈절.length, 인용0절이름: 빈절,
    인용정정: 정렬.reduce((n, x) => n + (x.교정 || 0) + (x.제거 || 0), 0),
    읽은문서수: 읽은전체.length, 인용수: 인용.length,
    보고서자수: 갈라진.본문.length,        // 참고자료를 뺀 본문만
    참고자료수: 갈라진.참고.length, 호출: COST.calls,
    // 모델에 넣은 입력량 — 토큰·비용은 여기서 환산한다 (출력값은 재지 않는다)
    입력자수: COST.coord + COST.sub,
    입력토큰: Math.floor((COST.coord + COST.sub) / 4),
    입력비용: +(((COST.coord + COST.sub) / 4) / 1e6 * 0.15).toFixed(4),
    모델: MODEL,
  };
  out('evaluate.done', { metrics });
  out('run.end', { elapsed: T(), calls: COST.calls, report, metrics });
  return { report, metrics };
}
