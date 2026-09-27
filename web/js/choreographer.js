// 3층 — 의미 이벤트를 월드 상태 변화로 번역한다.
// 여기서만 "이벤트가 화면에서 무엇이 되는가"를 정한다 (계획서 5.3 번역 규칙 표).

import { moveTo, pushLog, findBlade, findRack, koOf, setNode, doneNode,
         say, gather, scatter, 메모전달 } from './world.js';
import { caption, 기획혼잣말, 배정혼잣말, 반려대사, 소집대사, 재소집대사,
         회의대사, 재파견대사, 점검대사, 종합대사, 마무리대사 } from './script.js';
import { STAGE, BADGE_COLORS } from './config.js';

// 코디네이터는 한 명이다 — 편집장이 ①②④⑤ 를 전부 맡는다 (강의 1강).
// ⑥ 평가만 사람이 아니라 재는 노드다.
const 직원 = (w, id) => w.staff.find(x => x.id === id) || 직원(w,'editor');

// 이벤트의 cast 는 녹화 당시 이름이다. 화면은 언제나 지금 설정의 이름을 쓴다.
const 이름 = (w, idx) => w.reporters[idx]?.name ?? `${idx+1}번`;

const 앞자리 = at => ({ gx: at.gx + 1.3, gy: at.gy + 1.3 });   // 랙 바로 앞(화면상 아래)

export function apply(w, e) {
  // 자막은 매 이벤트마다 갈린다. 같은 문장이 연달아 오면 무시한다 —
  // 결재 결과처럼 이벤트가 두 번 들어오는 경우가 있다.
  const 새자막 = caption(w, e);
  if (새자막 && (!w.caption || w.caption[1] !== 새자막[1])) w.caption = 새자막;
  switch (e.type) {

    case 'run.start':
      w.question = e.question; w.corpus = e.corpus; w.settings = e.settings || {};
      w.wheel = 1; w.finished = false; w.metrics = null; w.outbox = null;
      setNode(w, 'plan');
      직원(w,'editor').pose = 'type';            // 자기 자리에서 자료를 훑는다 — 아직 회의 전
      pushLog(w, `실행 시작 — 코퍼스 ${e.corpus}건`);
      break;

    case 'plan.done': {
      w.title = e.title; w.axis = e.axis;
      e.sections.forEach((s, i) => {
        const r = w.reporters[i];
        if (!r) return;
        r.badge = s.badge; r.section = s.name; r.brief = s.brief;
        r.color = BADGE_COLORS[i];
      });
      setNode(w, 'assign');
      say(w, 기획혼잣말(e));
      직원(w,'editor').say = `[${e.axis} 축] 목차 ${e.sections.length}절`;
      pushLog(w, `① 기획 · ${직원(w,'editor').name} — [${e.axis} 축] 「${e.title}」 ${e.sections.length}절`);
      break;
    }

    case 'assign.done': {
      say(w, 배정혼잣말());
      직원(w,'editor').say = `배정 ${e.assignees.length}건`;
      e.assignees.forEach(a => {
        const r = w.reporters[a.idx]; if (!r) return;
        r.startDoc = a.startDoc; r.startDocKo = koOf(w, a.startDoc);
        r.badge = a.badge; r.section = a.name || r.section;
      });
      pushLog(w, `② 배정 · ${직원(w,'editor').name} — ${e.assignees.map(a =>
        `${이름(w, a.idx)}→${koOf(w, a.startDoc)}`).join(' · ')}`);
      break;
    }

    case 'approval.request':
      w.approval = { attempt: e.attempt || 1 };          // 큐가 여기서 멈춘다
      w.approvalHandled = false;                        // 이번 차수의 결과를 기다린다
      setNode(w, 'approval');
      직원(w,'editor').pose = 'wait';
      pushLog(w, `🔏 결재 요청 — 목차 승인이 필요합니다 (${e.attempt||1}차)`);
      break;

    // 결재 결과는 두 곳에서 온다 — 녹화에도 들어 있고, 사람이 버튼을 누른 순간
    // main.js 가 하나를 만들어 넣는다(사용자가 적은 반려 사유를 살리려고).
    // 그대로 두면 소집 멘트가 두 번 나오므로, 첫 번째만 처리한다.
    case 'approval.result':
      if (w.approvalHandled) break;
      w.approvalHandled = true;
      w.approval = null;
      if (e.approved) {
        doneNode(w, 'approval');
        say(w, 소집대사());
        gather(w, 1.9);                          // ★ 승인이 나야 회의를 연다
      } else {
        setNode(w, 'plan');
        w.reporters.forEach(r => { r.badge=''; r.section=''; r.startDocKo=''; r.reads=0; r.miss=0; });
        say(w, 반려대사(e));
        직원(w,'editor').pose = 'type';           // 자리에서 다시 짠다
      }
      직원(w,'editor').pose = e.approved ? 'wait' : 'reject';
      직원(w,'editor').say = e.approved ? '' : `반려: ${e.reason || '사유 없음'}`;
      pushLog(w, e.approved ? '🔏 승인 — 배정으로 넘어갑니다'
                            : `🔏 반려 — ${e.reason||''} · 목차를 다시 짭니다`);
      break;

    case 'dispatch': {
      w.wheel = e.wheel;
      setNode(w, 'research');
      say(w, e.wheel === 1 ? 회의대사(w, e, () => 메모전달(w)) : 재파견대사(e));
      w.afterTalk = () => scatter(w, 1.4);       // 회의가 끝나야 흩어진다
      직원(w,'editor').say = `${e.assignees.length}명 파견`;
      w.reporters.forEach(r => r.active = false);
      e.assignees.forEach(a => {
        const r = w.reporters[a.idx]; if (!r) return;
        r.active = true; r.badge = a.badge; r.startDoc = a.startDoc;
        r.section = a.name || r.section;
        r.chars = 0; r.citations = 0; r.enough = null;   // 이번 바퀴 원고는 아직 없다
      });
      pushLog(w, `② 파견 · ${직원(w,'editor').name} — ${e.wheel}바퀴 · 기자 ${e.assignees.length}명 동시 출발`);
      break;
    }

    case 'dispatch.fallback':
      w.fallback = { count: e.count, total: e.total };
      직원(w,'editor').say = `배정 ${e.count}건 빗나감`;
      pushLog(w, `⚠ 배정 ${e.count}/${e.total}건이 빗나가 코드가 대신 골랐습니다`);
      break;

    case 'research.read': {
      const r = w.reporters[e.idx]; if (!r) break;
      const rack = findRack(w, e.doc), blade = findBlade(w, e.doc);
      const ko = blade ? blade.ko : e.doc;

      // **한 번 나가면 다 읽고 돌아온다.**
      // pipeline.js 의 조사() 는 for 루프 안에서 예산만큼 연달아 읽고, 그 사이에
      // 코디네이터와 주고받는 것이 없다. 다음 문서도 방금 읽은 문서의 링크(frontier)에서
      // 고른다 — 즉 **서가 사이를 옆으로 옮겨 다니는** 동작이다.
      // 예전에는 문서 한 건마다 자리로 돌아와서, 있지도 않은 왕복을 3번 했고
      // 둘러보다 남의 구역과 겹치는 장면이 가려졌다. 귀환은 research.done 에서 한 번만 한다.
      //
      // **도착해야 불이 들어온다.**
      // 이벤트가 오는 즉시 점등하면 기자가 걸어가는 1초 동안 결과가 먼저 보인다.
      let 기록됨 = false;                  // 이동이 두 번 끝나도 한 번만 센다
      const 도착 = () => {
        if (기록됨) return;
        기록됨 = true;
        r.reads = e.readCount;
        if (!e.relevant) r.miss++;        // 갔다 왔는데 이 절과 상관없던 문서
        if (blade) {
          if (!blade.readers.includes(r.color)) blade.readers.push(r.color);
          blade.relevant = e.relevant;
        }
        r.say = ko; r.sayTone = e.relevant ? 'paper' : 'warn';
        // **자리로 돌아가지 않는다.** 메모를 들고 그 서가에 선 채로 다음 문서를 고른다.
        setTimeout(() => { r.say = ''; r.pose = 'carry'; }, 900);
      };

      if (rack) moveTo(w, r, 앞자리(rack.at).gx, 앞자리(rack.at).gy, 1.0, 도착);
      else 도착();                          // 서가를 못 찾으면 이동 없이 바로
      pushLog(w, `③ ${r.name} · ${rack ? rack.name : '?'} 서가 → 「${ko}」` +
                 (e.relevant ? ' 읽는 중' : ' — 관련 없음'));
      break;
    }

    case 'research.done': {
      const r = w.reporters[e.idx]; if (!r) break;
      r.chars = e.chars; r.citations = e.citations; r.enough = e.enough;
      // 다 읽었으니 **이제 한 번** 자리로 돌아온다 — 메모만 들고(carry).
      // 자리에 앉아 절을 쓰고(type), 그 원고가 편집장에게 날아간다.
      r.pose = 'carry';
      moveTo(w, r, r.home.gx, r.home.gy, 1.1, () => {
        r.pose = 'type';
        w.papers.push({ from: { gx: r.home.gx, gy: r.home.gy }, to: STAGE.editor,  // ④ 점검은 편집장이 한다
                        t: 0, dur: 1.0, fake: e.fake > 0, cites: e.citations });
      });
      pushLog(w, `③ ${r.name} 원고 ${e.chars}자 · 인용 ${e.citations}곳` +
                 (e.fake ? ` · 허위 ${e.fake}` : '') +
                 (e.enough ? '' : ` · 부족 신고: ${(e.missing||'').slice(0,24)}`));
      break;
    }

    case 'review.done':
      setNode(w, e.stopped ? 'review' : 'assign');
      // ②로 되돌아가도 **결재는 다시 묻지 않는다** (재위임 바퀴엔 게이트가 없다).
      // setNode 가 뒤쪽 노드를 전부 idle 로 되돌리는 바람에 결재 줄이 '대기' 로 보였다.
      if (!e.stopped) w.nodes.approval = 'done';
      say(w, 재소집대사());
      gather(w, 1.6);
      say(w, 점검대사(w, e));
      if (e.stopped) doneNode(w, 'review');
      w.reviewLamp = e.stopped ? 'pass' : 'gap';
      직원(w,'editor').say = e.reason || '';
      if (!e.stopped) {
        (e.gaps || []).forEach(i => { const r = w.reporters[i]; if (r) r.pose = 'reject'; });
      }
      pushLog(w, `④ 점검 · ${직원(w,'editor').name} — ${e.reason}` +
                 (e.gapNames && e.gapNames.length ? ` (${e.gapNames.join(', ')})` : ''));
      break;

    case 'synthesize.done':
      setNode(w, 'synth'); doneNode(w, 'synth');
      say(w, 종합대사(w, e));
      직원(w,'editor').say = `${e.sections}절 → ${e.chars}자`;
      w.outbox = 'done';
      pushLog(w, `⑤ 종합 · ${직원(w,'editor').name} — ${e.sections}절을 이어 붙여 ${e.chars}자`);
      break;

    case 'evaluate.done':
      setNode(w, 'eval'); doneNode(w, 'eval');
      w.metrics = e.metrics;
      w.usage = { calls: e.metrics.호출 ?? 0, tokens: e.metrics.입력토큰 ?? 0,
                  cost: e.metrics.입력비용 ?? 0, model: e.metrics.모델 || '' };
      직원(w,'score').say = `근거가 달린 문장 ${e.metrics.근거율}%`;
      pushLog(w, `⑥ 평가 — 근거가 달린 문장 ${e.metrics.근거율}% · 지어낸 인용 ${e.metrics.허위인용}곳 ` +
                 `· 한 문서에 쏠림 ${e.metrics.편중}% · 겹쳐 읽음 ${e.metrics.중복률}%`);
      break;

    case 'run.end':
      w.finished = true; w.report = e.report || ''; w.elapsed = e.elapsed; w.calls = e.calls;
      Object.keys(w.nodes).forEach(k => w.nodes[k] = 'done'); w.node = '';
      say(w, 마무리대사(w, e));
      w.afterTalk = () => scatter(w, 1.6);
      w.usage.calls = e.calls ?? w.usage.calls;
      w.reporters.forEach(r => { r.pose = 'idle'; r.say = ''; });
      pushLog(w, `발행 완료 — ${e.elapsed}초 · LLM 호출 ${e.calls}회`);
      break;
  }
}
