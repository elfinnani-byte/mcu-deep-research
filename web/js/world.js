// 4층 — 관제실 상태 모델.
// "무엇이 어디 있고 어떤 상태인가"만 담는다. 그리기도, 이벤트 해석도 하지 않는다.

import { STAGE, MEET, CALLSIGNS, STAFF, BADGE_COLORS, C, FLOW } from './config.js';

export function createWorld() {
  return {
    t: 0,
    question: '', title: '', axis: '', wheel: 1, corpus: 0,
    settings: {}, metrics: null, report: '',
    approval: null,                 // {attempt} — 결재 대기 중이면 값이 있다
    approvalHandled: false,         // 결재 결과를 이미 한 번 처리했나 (아래 주석)
    finished: false,
    live: false,                    // 라이브 실행이면 true — 사용량을 정확히 보여줄 수 있다

    // 공정 — 키마다 'idle' | 'run' | 'done'. 공정 바가 이것만 본다.
    node: '',
    nodes: Object.fromEntries(FLOW.map(f => [f.key, 'idle'])),
    usage: { calls: 0, tokens: 0, cost: 0, model: '' },

    racks: [],                      // [{name, docs:[{doc, ko, readers:[color]}], at}]
    docIndex: new Map(),            // 문서제목 → {rackIdx, bladeIdx}

    reporters: CALLSIGNS.map((name, i) => ({
      name, idx: i, badge: '', color: BADGE_COLORS[i],
      home: STAGE.desks[i], gx: STAGE.desks[i].gx, gy: STAGE.desks[i].gy,
      pose: 'idle', say: '', sayTone: 'paper', phase: i * 1.3,
      active: false, reads: 0, miss: 0, chars: 0, citations: 0, enough: null,
    })),
    // 직원도 기자와 같은 모양으로 둔다 — 편집장이 회의 탁자로 걸어가야 하기 때문이다.
    staff: STAFF.map((s, i) => ({
      ...s, home: STAGE[s.seat], gx: STAGE[s.seat].gx, gy: STAGE[s.seat].gy,
      pose: 'wait', phase: i * .8, say: '', sayFull: '', sayT: 0,
    })),

    // 말 — 자막 한 줄과, 차례로 나오는 대사 큐
    caption: null,              // [꼬리표, 문장]
    convo: [],                  // [[누구, 할 말], …]  누구 = 'editor' | 기자번호
    talk: null,                 // { actors, full, t } — 지금 말하는 중
    afterTalk: null,            // 대사가 다 끝나면 한 번 부른다

    papers: [],                     // 날아다니는 원고
    moves: [],                      // 진행 중인 이동
    reviewLamp: null,               // 'gap' | 'pass'
    outbox: null,                   // 'done'
    fallback: null,                 // {count,total} — 배정이 빗나간 횟수
    log: [],
  };
}

// 서고 자료 적재 — racks.json 을 월드에 싣는다
export function loadRacks(w, racksJson) {
  // **건수가 많은 것부터** 벽을 따라 세운다.
  // 랙 높이는 건수에 비례하므로, 높은 랙이 뒤(왼쪽)로 가야 앞쪽 낮은 랙을 가리지 않고
  // 이름표도 왼쪽에서 오른쪽으로 계단처럼 일정하게 내려간다.
  const 높은순 = [...racksJson.racks].sort((a, b) => b.docs.length - a.docs.length);
  w.racks = 높은순.map((r, i) => ({
    i, name: r.name, desc: r.desc, at: STAGE.racks[i],
    docs: r.docs.map((d, k) => ({ doc: d, ko: r.ko[k], sec: r.sections[k], readers: [] })),
  }));
  w.docIndex.clear();
  w.racks.forEach((r, ri) => r.docs.forEach((b, bi) => w.docIndex.set(b.doc, { ri, bi })));
}

export const findBlade = (w, doc) => {
  const at = w.docIndex.get(doc);
  return at ? w.racks[at.ri].docs[at.bi] : null;
};
export const koOf = (w, doc) => {          // 영문 문서 제목 → 한글 표기
  const b = findBlade(w, doc);
  return b ? b.ko : doc;
};
export const findRack = (w, doc) => {
  const at = w.docIndex.get(doc);
  return at ? w.racks[at.ri] : null;
};

// 이동 예약 — 렌더 루프가 매 프레임 진행시킨다
// 한 사람에게 이동은 **한 번에 하나**다.
// 조사 귀환(1.1초)이 끝나기 전에 보고 회의 소집이 들어오면 두 이동이 같은 사람을
// 동시에 끌어당겨 좌표가 튄다. 새 이동을 걸 때 그 사람의 이전 이동은 버린다.
export function moveTo(w, who, gx, gy, dur, then) {
  for (let i = w.moves.length - 1; i >= 0; i--) if (w.moves[i].who === who) w.moves.splice(i, 1);
  who.pose = 'walk';
  w.moves.push({ who, x0: who.gx, y0: who.gy, x1: gx, y1: gy, t: 0, dur, then });
}

export function stepMoves(w, dt) {
  const ease = t => t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
  for (let i = w.moves.length - 1; i >= 0; i--) {
    const m = w.moves[i]; m.t += dt / m.dur;
    const k = ease(Math.min(1, m.t));
    m.who.gx = m.x0 + (m.x1 - m.x0) * k;
    m.who.gy = m.y0 + (m.y1 - m.y0) * k;
    if (m.t >= 1) { w.moves.splice(i, 1); m.who.pose = 'idle'; m.then && m.then(); }
  }
  for (let i = w.papers.length - 1; i >= 0; i--) {
    const p = w.papers[i]; p.t += dt / (p.dur || 1);
    if (p.t >= 1) { w.papers.splice(i, 1); p.then && p.then(); }
  }
}

// 공정 전환 — 지금 돌아가는 노드를 'run' 으로 두고, 그 앞은 전부 'done' 으로 만든다.
// 재위임으로 ②로 되돌아가면 뒤쪽 노드는 다시 'idle' 이 된다.
export function setNode(w, key) {
  const i = FLOW.findIndex(f => f.key === key);
  if (i < 0) return;
  w.node = key;
  FLOW.forEach((f, k) => { w.nodes[f.key] = k < i ? 'done' : k === i ? 'run' : 'idle'; });
}
export const doneNode = (w, key) => { if (w.nodes[key] === 'run') w.nodes[key] = 'done'; };

// ── 말하기 ───────────────────────────────────────────────────
// **한 번에 한 명만 말한다.** 각자 자기 큐를 돌리면 다섯이 동시에 떠들어 회의로 안 보인다.
export const CPS = 26;          // 말풍선 타자 속도 (초당 글자)
export const HOLD = 0.8;        // 다 치고 나서 머무는 시간

const 모두 = w => [...w.staff, ...w.reporters];

// 누가 말하는가 — 'all' 이면 기자 전원이 한목소리로 답한다
const 배우들 = (w, who) =>
  who === 'all'            ? w.reporters.filter(r => r.section)
  : typeof who === 'number' ? [w.reporters[who]].filter(Boolean)
  : [w.staff.find(x => x.id === who)].filter(Boolean);

export function say(w, lines) {                    // 대사 큐에 밀어 넣는다
  lines.forEach(l => w.convo.push(l));
}
export const 말하는중 = w => !!w.talk || w.convo.length > 0;

// 대사 한 줄 = [누구, 할 말, 시작할 때 할 일(선택)]
export function stepTalk(w, dt) {
  if (!w.talk) {
    if (!w.convo.length) {
      // 회의가 끝났다 — 예약해 둔 일을 한 번만 한다 (보통 각자 자리로 흩어지기)
      if (w.afterTalk) { const f = w.afterTalk; w.afterTalk = null; f(); }
      return;
    }
    const [who, text, onStart] = w.convo.shift();
    const actors = 배우들(w, who);
    if (!actors.length) return;
    모두(w).forEach(x => { x.say = ''; });
    w.talk = { actors, full: text, t: 0 };
    if (onStart) onStart();
    return;
  }
  const t = w.talk;
  t.t += dt;
  const 보이는 = t.full.slice(0, Math.floor(t.t * CPS));
  t.actors.forEach(a => { a.say = 보이는; });
  if (t.t >= t.full.length / CPS + HOLD) {
    t.actors.forEach(a => { a.say = ''; });
    w.talk = null;
  }
}

// 편집장이 기자마다 쪽지를 날린다 — 시작 문서는 회의에서 말하지 않고 따로 건넨다.
// (실제로는 '남이 맡은 문서' 목록도 함께 가지만, 그건 공통 규칙이라 말로 한다.)
export function 메모전달(w, dur = 0.9) {
  const ed = w.staff.find(x => x.id === 'editor');
  if (!ed) return;
  const 받는이 = w.reporters.filter(r => r.section);
  받는이.forEach((r, i) => {
    w.papers.push({
      from: { gx: ed.gx, gy: ed.gy }, to: { gx: r.gx, gy: r.gy },
      t: -i * 0.42,                     // 한 사람씩 차례로 — 한꺼번에 뿌리면 뭉쳐 보인다
      dur, memo: true,
      // 받으면 들고 선다. 다음에 걸어갈 때 moveTo 가 자세를 walk 로 덮는다.
      then: () => { r.pose = 'carry'; },
    });
  });
}


// ── 모이고 흩어지기 ──────────────────────────────────────────
export function gather(w, dur = 1.8) {
  const ed = w.staff.find(x => x.id === 'editor');
  if (ed) moveTo(w, ed, MEET.editor.gx, MEET.editor.gy, dur);
  w.reporters.forEach((r, i) => {
    const s = MEET.reps[i]; if (s) moveTo(w, r, s.gx, s.gy, dur);
  });
}
export function scatter(w, dur = 1.5) {
  const ed = w.staff.find(x => x.id === 'editor');
  if (ed) moveTo(w, ed, ed.home.gx, ed.home.gy, dur);
  w.reporters.forEach(r => moveTo(w, r, r.home.gx, r.home.gy, dur));
}

export function pushLog(w, text) {
  w.log.push(text);
  if (w.log.length > 60) w.log.shift();
}
