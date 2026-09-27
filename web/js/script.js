// 대본 — 의미 이벤트를 **사람의 말**로 옮긴다.
//
// 두 층이 있다.
//   자막(caption)  3인칭 해설. 무대 위 띠에 한 줄. "무슨 일이 벌어졌나"
//   대사(lines)    1인칭. 캐릭터 머리 위 말풍선. "누가 무슨 말을 하나"
//
// 파이프라인은 이 문장들을 모른다. 여기서만 만든다 —
// 이벤트 스키마를 건드리지 않고 말을 바꿀 수 있어야 하기 때문이다.

import { shortRole, 축이름 } from './config.js';
import { 본문자수 } from './report.js';

const 수 = n => (n ?? 0).toLocaleString('ko-KR');

// ── 조사 ─────────────────────────────────────────────────────
// 받침을 보고 은/는·이/가·을/를 을 붙인다. 그냥 이어 붙이면
// 「박스오피스 성적」 **가** 비었습니다 처럼 틀린다 — 녹화에 나온 절 제목 40개 중
// 30개가 받침 있는 말이다. 기자 이름이 전부 '자' 로 끝나 우연히 안 들켰을 뿐이다.
//
// 한글이 아니면 소리 나는 대로 어림한다 — 숫자와 영문 끝 글자.
const 숫자받침 = { '0':1, '1':1, '3':1, '6':1, '7':1, '8':1 };   // 영·일·삼·육·칠·팔
export function josa(말, 짝) {
  const s = String(말 ?? '').replace(/[\s」』）)\]'"’”.…·]+$/u, '');
  const ch = s.at(-1) || '';
  const code = ch.charCodeAt(0) - 0xac00;
  let 받침, 리을 = false;
  if (code >= 0 && code < 11172) { const j = code % 28; 받침 = j > 0; 리을 = j === 8; }
  else if (/[0-9]/.test(ch)) { 받침 = !!숫자받침[ch]; 리을 = ch === '1' || ch === '7' || ch === '8'; }
  else { 받침 = /[lmnr]$/i.test(ch); 리을 = /[lr]$/i.test(ch); }
  if (짝 === '으로/로') return `${말}${받침 && !리을 ? '으로' : '로'}`;
  const [있, 없] = 짝.split('/');
  return `${말}${받침 ? 있 : 없}`;
}

// ── 어림수 ───────────────────────────────────────────────────
// **읽은 원문 글자수에만** 쓴다. 사람은 "삼만 삼천이백육 자" 라고 말하지 않는다.
// 원고·보고서 자수는 그대로 둔다 — 그건 견주려고 보는 값이라 정확해야 한다.
export function 어림(n) {
  n = n ?? 0;
  if (n >= 10000) {
    const 만 = Math.floor(n / 10000), 천 = Math.round((n % 10000) / 1000);
    return 천 === 10 ? `${만 + 1}만` : 천 ? `${만}만 ${천}천` : `${만}만`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}천`;
  return 수(n);
}
// 「3만 9천자」 는 어색하다 — 한글 수사 뒤에는 단위를 띄운다. 숫자 그대로면 붙인다.
export const 어림자 = n => { const t = 어림(n); return /[만천]$/.test(t) ? `${t} 자` : `${t}자`; };

// ── 자막 ─────────────────────────────────────────────────────
// [꼬리표, 문장] 을 돌려준다. 꼬리표는 띠 왼쪽의 작은 알약.
export function caption(w, e) {
  const 이름 = i => w.reporters[i]?.name ?? `${i + 1}번`;
  const ko = d => w.docIndex.get(d) ? w.racks[w.docIndex.get(d).ri].docs[w.docIndex.get(d).bi].ko : d;

  switch (e.type) {
    case 'run.start': {
      const s = e.settings || {};
      const 끈것 = [s.배정 === false && '시작 문서 배정', s.역할 === false && '기자 역할',
                    s.구역 === false && '구역 나누기', s.재위임 === false && '빈 절 재위임']
                   .filter(Boolean);
      return ['질문을 받았다',
        `질문을 받았습니다. 편집장이 서고 ${e.corpus}건의 목록을 훑습니다.`
        + (끈것.length ? ` (이번 실험은 ${끈것.join('·')}을 껐습니다)` : '')];
    }
    case 'plan.done':
      return ['목차를 나눴다',
        `편집장이 질문을 ${e.sections.length}개의 절로 나눴습니다. `
        + `${축이름(e.axis)} 축으로 보기로 했습니다.`];

    case 'assign.done':
      return ['문서를 배정했다',
        `절마다 먼저 읽을 문서를 정했습니다. 남이 맡은 문서는 서로 피합니다.`];

    case 'approval.request':
      return ['결재 대기',
        `여기서 멈춥니다. 목차와 배정이 맞는지 사람이 봐야 합니다 — 기자가 한번 나가면 되돌릴 수 없습니다.`];

    case 'approval.result':
      return e.approved
        ? ['승인', '승인이 났습니다. 기자들이 출발합니다.']
        : ['반려', `반려됐습니다 — ${e.reason || '사유 없음'}. 목차부터 다시 짭니다.`];

    case 'dispatch':
      return e.wheel > 1
        ? ['다시 파견', `${e.wheel}바퀴째입니다. 빈 절을 맡은 ${e.assignees.length}명만 다시 나갑니다.`]
        : ['파견', `기자 ${e.assignees.length}명이 동시에 출발합니다. 서로 무엇을 읽는지 모릅니다.`];

    case 'dispatch.fallback':
      return ['배정 빗나감',
        `배정 ${e.count}/${e.total}건이 빗나가 코드가 대신 골랐습니다.`];

    case 'research.read':
      return e.relevant
        ? ['읽었다', `${josa(이름(e.idx), '이/가')} 「${ko(e.doc)}」 ${어림자(e.chars)}를 읽고 메모만 들고 나왔습니다.`]
        : ['빈손', `${josa(이름(e.idx), '이/가')} 「${ko(e.doc)}」 — 이 절과 관련이 없어 빈손으로 나왔습니다.`];

    case 'research.done':
      return e.citations
        ? ['원고', `${josa(이름(e.idx), '이/가')} 원고 ${수(e.chars)}자를 썼습니다 · 출처 ${e.citations}곳.`]
        : ['근거 없음', `${이름(e.idx)}의 절은 근거를 한 곳도 못 찾았습니다.`];

    case 'review.done':
      return e.stopped
        ? ['점검 통과', `점검을 지납니다 — ${e.reason}.`]
        : ['되돌림', `빈 절 ${(e.gaps || []).length}개를 ②로 되돌려 보냅니다.`];

    case 'synthesize.done':
      return ['종합',
        `편집장이 ${e.sections}개 절을 묶어 ${수(e.chars)}자 보고서를 썼습니다 — 원문은 보지 않습니다.`];

    case 'evaluate.done':
      return ['평가',
        `정답표 없이 지표 7개로 쟀습니다 — 근거가 달린 문장 ${e.metrics.근거율}%.`];

    case 'run.end':
      return ['완료', `보고서가 나왔습니다. ${e.elapsed}초 · 모델 호출 ${e.calls}회.`];
  }
  return null;
}

// ── 대사 ─────────────────────────────────────────────────────
// [누가, 할 말] 의 배열. 누가 = 'editor' | 기자 번호(0~4)
// 한 줄씩 차례로 나온다 — 동시에 떠들면 회의로 안 보인다.

/** 자기 자리에서 혼잣말 — 아직 회의 전이다.
 *  「결재를 올리겠습니다」는 **배정까지 끝난 뒤**에 나와야 한다.
 *  교재 5강이 사람에게 확인하라고 한 세 가지 중 둘이 배정에 관한 것이고
 *  (*"절마다 서로 다른 시작 문서가 붙었는가"*, *"배정된 문서가 질문과 얼추 맞는가"*),
 *  *"코드 검증은 형식만 본다 — 질문에 맞는 문서인지는 확인하지 못한다"* 고 못 박았다.
 *  그러니 결재 대상은 목차 + 배정 둘 다다.  */
export const 기획혼잣말 = e => [['editor', `질문에 대해 고민하고 ${e.sections.length}절로 나눴습니다`]];
export const 배정혼잣말 = () => [
  ['editor', '먼저 읽을 문서도 정했습니다'],
  ['editor', '결재를 올리겠습니다'],
];

/** 🔏 결재 결과 — 반려면 다시 앉고, 승인이면 회의를 소집한다 */
export const 반려대사 = e => [['editor', `반려됐습니다 — ${e.reason || '사유 없음'}. 다시 짜겠습니다`]];
export const 소집대사 = () => [['editor', '승인이 났습니다. 다들 회의 탁자로 모여 주세요']];
export const 재소집대사 = () => [['editor', '다들 모여 주세요. 보고 받겠습니다']];

/** ⑤⑥ 회의 — 업무 분장.
 *
 *  시작 문서는 **말로 하지 않고 쪽지로 건넨다.** 개별 배정은 각자에게만 가는 것이고,
 *  공통 규칙("남이 보는 문서는 피하세요")만 회의에서 말하는 게 실제 구조와 맞는다.
 *  — 기자가 받는 지시는 {시작문서: 하나, 피하기: 남의 시작 문서 4건} 이다.
 */
export function 회의대사(w, e, 메모) {
  const 역할켬 = w.settings.역할 !== false;
  const 구역켬 = w.settings.구역 !== false;
  const 절 = w.reporters.filter(r => r.section);
  const 명찰 = 절.map(r => shortRole(r.badge)).filter(Boolean);
  const L = [];

  if (역할켬) L.push(['editor', `이번에는 ${축이름(w.axis)} 축으로 봅니다`]);
  L.push(['editor', `질문을 ${절.length}갈래로 나눴습니다`
                    + (역할켬 && 명찰.length ? ` — ${명찰.join('·')}` : '')]);
  L.push(['editor', '업무분장 하겠습니다']);

  절.forEach((r, i) => L.push(['editor',
    `${josa(r.name, '은/는')} ${역할켬 && r.badge ? `[${shortRole(r.badge)}] ` : ''}「${i + 1}. ${r.section}」`]));

  L.push(['editor', '나눠준 문서를 먼저 확인하세요', 메모]);   // ← 여기서 쪽지가 날아간다
  L.push(['editor', 구역켬 ? '이후에는 남이 보는 문서는 피해서 보세요'
                           : '이번엔 남의 문서를 피하지 않습니다 — 겹쳐도 그대로 둡니다']);
  L.push(['editor', '서로 무엇을 읽는지 모릅니다']);
  L.push(['editor', '각자 업무를 진행하고, 업무가 끝나면 보고합니다']);
  L.push(['all', '네. 알겠습니다']);
  return L;
}

/** 2바퀴째 — 빈 절만 다시 내보낸다 */
export const 재파견대사 = e => [
  ['editor', `${e.assignees.length}명만 다시 다녀오세요`],
  ['all', '네. 알겠습니다'],
];

/** ④ 점검 — 다시 모여 보고한다 */
export function 점검대사(w, e) {
  const 보고 = w.reporters
    .filter(r => r.section && r.chars)
    .map(r => [r.idx, r.citations
      ? `「${r.section}」 ${수(r.chars)}자 · 출처 ${r.citations}곳 찾았습니다`
      : `「${r.section}」 근거를 못 찾았습니다`]);
  const 판정 = e.stopped
    ? ['editor', (e.gapNames || []).length
        ? `${josa(e.gapNames.join('·'), '은/는')} 끝내 못 채웠습니다 — ${e.reason}`
        : '모든 절에 근거가 붙었습니다. 제가 정리하겠습니다']
    : ['editor', `${josa((e.gapNames || []).join('·'), '이/가')} 비었습니다 — 다시 다녀오세요`];
  return [...보고, 판정];
}

/** ⑤ 종합 — 편집장이 이어 붙인다 */
export function 종합대사(w, e) {
  return [
    ['editor', '저는 원문을 안 봤습니다. 각자 요약만 받았습니다'],
    ['editor', `${e.sections}개 절을 한 편으로 묶었습니다 — ${수(e.chars)}자`],
  ];
}

/** 끝 — 완료 선언과 계측 공지 */
export function 마무리대사(w, e) {
  const m = w.metrics || {};
  return [
    ['editor', `보고서 ${수(본문자수(w.report || ''))}자가 나왔습니다. 수고하셨습니다`],
    ['editor', `근거가 달린 문장 ${m.근거율 ?? '—'}% · 지어낸 인용 ${m.허위인용 ?? '—'}곳 — 이대로 올리겠습니다`],
  ];
}
