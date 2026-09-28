// 캔버스 바깥의 DOM 전부 — 공정 바 · 관제 보드 · 계기판 · 결재 모달 · 보고서 뷰어 · 로그
// 무대(캔버스)는 "누가 어디서 무엇을 하는가"만 보여주고, 읽을 거리는 전부 여기에 있다.

import { DASH, 그물, C, BADGE_COLORS, FLOW, STAFF, shortRole, 축이름, 축설명, 유형설명 } from './config.js';
import { 조판, 본문자수 } from './report.js';
import { getKey, setKey, hasKey } from './key.js';

const $ = id => document.getElementById(id);
const pct = v => `${(v ?? 0).toFixed(1)}%`;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const num = n => (n ?? 0).toLocaleString();

export function createUI(world, queue, { onApprove, onRun, replays = [], current = '' } = {}) {
  const el = {
    question: $('q'), axis: $('axis'), clock: $('clock'),
    flow: $('flow'), team: $('team'), usage: $('usage'), outputs: $('outputs'),
    gauges: $('gauges'), log: $('log'), caption: $('caption'),
    modal: $('modal'), modalBody: $('modalBody'), reason: $('reason'),
    report: $('report'), reportBody: $('reportBody'), progress: $('progress'),
  };

  // ── 편집국 · 공정 ───────────────────────────────────────
  // 공정 바(가로)와 편집국 목록(세로)은 **같은 것을 두 번** 말하고 있었다 —
  // 칩마다 담당자가 적혀 있고, 사람 줄의 상태도 결국 world.nodes 에서 나왔다.
  // 그래서 하나로 합쳤다. 세로축은 **공정 순서 ①→⑥**, 각 단계 안에 담당자를 넣는다.
  // ③ 조사 밑에만 기자 5명이 들여쓰기로 묶인다 — 그게 팬아웃의 모양이다.
  //
  // 이 배열이면 "편집장 혼자 ①②④⑤를 다 한다"는 강의 구조가 한눈에 보인다.
  const 단계상태 = { idle: ['대기', '⏸'], run: ['진행중', '●'], done: ['완료', '✓'] };

  const 줄 = f => {
    const st = STAFF.find(x => x.id === f.by);
    const 담당 = st
      ? `<i class="dot" style="background:${st.color}"></i>${st.name}`
      // 앰버는 **사람(당신)** 자리에만 쓴다 — 기자 5명까지 앰버면 어디가 사람 차례인지 안 보인다
      : `<span class="${f.who === '당신' ? 'you' : 'many'}">${f.who}</span>`;
    // ①②③ 같은 동그라미 숫자를 **동그란 배경 위에** 얹으니 원이 겹쳐 숫자가 안 보였다.
    // 배경(진행 상태를 색으로 알린다)은 남기고 글자만 맨 숫자로 바꾼다. 🔏 는 그대로.
    const 번호 = '①②③④⑤⑥'.includes(f.no) ? String('①②③④⑤⑥'.indexOf(f.no) + 1) : f.no;
    return `<div class="stp${f.key === 'research' ? ' lead' : ''}" data-k="${f.key}" title="${f.hint}">
        <i class="no">${번호}</i>
        <b class="lb">${f.label}</b>
        <span class="own">${담당}</span>
        ${f.loop ? `<span class="loop" id="loopChip">↺ <b id="loopTxt">재위임 1/2</b></span>` : ''}
        <em class="stt"><s>⏸</s>대기</em>
      </div>`;
  };

  const 기자줄 = i => `
    <div class="mem rep" data-r="${i}">
      <i class="dot" style="background:${BADGE_COLORS[i]}"></i>
      <b class="nm">${world.reporters[i].name}</b>
      <em class="st"><s>⏸</s>대기</em>
      <span class="rl"><b class="bd" style="color:${BADGE_COLORS[i]}"></b><i class="sc">배정 대기</i></span>
    </div>`;

  el.team.innerHTML = FLOW.map(f => f.key === 'research'
    ? 줄(f) + `<div class="reps">${[0,1,2,3,4].map(기자줄).join('')}</div>`
    : 줄(f)).join('')
    + '<div class="hint">동그라미 색은 서고 블레이드 색과 같습니다 — 한 블레이드가 두 색으로 갈리면 두 기자가 같은 문서를 읽은 것(중복)입니다.</div>';

  $('teamCount').textContent = `${STAFF.length + 5}명`;

  // 상태 = [글자, 상태키, 아이콘]
  const 기자상태 = r => {
    if (!r.section) return ['대기', 'idle', '⏸'];
    // ① 기획이 목차·담당·명찰을 한 번에 정하므로(교재 5강 "목차를 짜고 조사관을 붙인다")
    // 결재 전에도 배정이 보인다. 확정된 것처럼 보이면 안 되니 **아직 승인 전**이라고 못 박는다.
    if (world.nodes.approval !== 'done') return ['결재 전', 'hold', '🔏'];
    if (r.active && !r.chars) return r.reads ? [`조사중 ${r.reads}건`, 'run', '💻'] : ['출발', 'run', '💻'];
    // 헛읽음이 있으면 끝난 뒤에도 남긴다 — "왜 이 절만 짧은가"의 답이 거기 있다
    if (r.chars) return [`${num(r.chars)}자 · 인용 ${r.citations}` + (r.miss ? ` · 헛읽음 ${r.miss}` : ''),
                         r.enough === false ? 'warn' : 'done', r.enough === false ? '!' : '✓'];
    return ['대기', 'idle', '⏸'];
  };
  const 직원상태 = { idle: ['대기', '⏸'], run: ['작업중', '💻'], done: ['완료', '✓'] };

  function renderTeam() {
    el.team.querySelectorAll('.stp').forEach(row => {
      const k = row.dataset.k, state = world.nodes[k] || 'idle';
      const [txt, ic] = 단계상태[state];
      row.className = 'stp ' + (k === 'research' ? 'lead ' : '') + state;
      // 재위임 바퀴에는 결재를 다시 묻지 않는다 — 그걸 글자로 못 박는다
      const 글 = k === 'approval'
        ? (state === 'run' ? '확인 대기' : world.wheel > 1 && state === 'done' ? '1바퀴만' : txt)
        : txt;
      row.querySelector('.stt').innerHTML = `<s>${ic}</s>${글}`;
    });
    const max = world.settings.최대바퀴 ?? 2;
    $('loopTxt').textContent = `재위임 ${world.wheel}/${max}`;
    $('loopChip').classList.toggle('on', world.wheel > 1);

    el.team.querySelectorAll('.mem.rep').forEach(row => {
      const r = world.reporters[+row.dataset.r];
      const [txt, k, ic] = 기자상태(r);
      row.className = 'mem rep ' + k;
      row.querySelector('.nm').textContent = r.name;
      row.querySelector('.st').innerHTML = `<s>${ic}</s>${txt}`;
      // 명찰은 기자 색으로, 절 이름은 흐리게 — 두 조각을 따로 채운다.
      const bd = row.querySelector('.bd'), sc = row.querySelector('.sc');
      if (r.section) {
        const 명찰 = shortRole(r.badge);
        bd.textContent = 명찰 || '';
        bd.style.display = 명찰 ? '' : 'none';
        sc.textContent = 명찰 ? ` · ${r.section}` : r.section;
      } else {
        bd.style.display = 'none';
        sc.textContent = '배정 대기';
      }
    });
  }

  // ── 사용량 ───────────────────────────────────────────────
  // 재생 모드에서는 호출 수만 센다. 토큰·비용은 실제로 모델에 넣은 양이라 라이브에서만 정확하다.
  el.usage.innerHTML = ['모델', 'LLM 호출', '입력 토큰', '추정 비용'].map((k, i) =>
    `<div class="u" data-u="${i}"><span>${k}</span><b>—</b></div>`).join('')
    + '<div class="hint" id="usageHint"></div>';

  // 사용량은 **⑥ 평가가 센 값**을 그대로 보여 준다 (world.metrics).
  // 예전에는 브라우저가 모델을 직접 불러서 실시간으로 셀 수 있었는데,
  // 파이프라인이 서버로 옮겨 가면서 그 자리가 없어졌다. 대신 끝나면 정확한 값이 온다.
  function renderUsage() {
    const live = world.live, m = world.metrics, u = world.usage || {};
    // **없는 값은 「—」 로 둔다.** 녹화 22편에는 호출 수만 들어 있어서,
    // 0 으로 채우면 "토큰 0개·비용 $0" 이라는 거짓말이 된다.
    const 호출 = m?.호출 ?? u.calls ?? world.calls ?? 0;
    const v = [
      // world.usage.model 은 빈 문자열로 시작한다 — ?? 는 '' 를 안 걸러내므로 || 를 쓴다
      m?.모델 || u.model || (live ? '실행 중…' : '기록 없음'),
      호출 ? `${호출}회` : '—',
      m?.입력토큰 != null ? `≈ ${num(m.입력토큰)}` : '—',
      m?.입력비용 != null ? `≈ $${m.입력비용.toFixed(4)}` : '—',
    ];
    v.forEach((x, i) => { el.usage.querySelector(`[data-u="${i}"] b`).textContent = x; });
    $('usageMode').textContent = live ? '라이브' : '재생';
    $('usageHint').textContent = m?.입력토큰 != null
      ? '모델에 실제로 넣은 글자 수를 4로 나눈 추정치입니다 (출력 토큰은 세지 않습니다).'
      : live ? '⑥ 평가가 끝나면 호출 수·토큰·비용이 한 번에 들어옵니다.'
             : '재생 모드는 저장된 호출 수만 보여 줍니다 — 토큰·비용은 라이브에서만 정확합니다.';
  }

  // ── 산출물 ───────────────────────────────────────────────
  el.outputs.innerHTML = `
    <div class="out" data-o="plan"><span>📋 목차</span><b>—</b></div>
    <div class="out" data-o="draft"><span>📝 절 원고</span><b>0 / 5</b></div>
    <div class="out" data-o="report"><span>📄 보고서</span><b>—</b></div>`;

  function renderOutputs() {
    const 절 = world.reporters.filter(r => r.section).length;
    const 원고 = world.reporters.filter(r => r.chars).length;
    const set = (o, txt, cls) => {
      const row = el.outputs.querySelector(`[data-o="${o}"]`);
      row.querySelector('b').textContent = txt;
      row.className = 'out ' + (cls || '');
    };
    set('plan', world.title ? `${절}절 · ${world.title}` : '—', world.title ? 'done' : '');
    set('draft', `${원고} / 5`, 원고 === 5 ? 'done' : 원고 ? 'run' : '');
    // **글자수는 참고자료를 뺀 본문만 센다**
    set('report', world.report ? `${num(본문자수(world.report))}자 · 열기` : '—',
      world.report ? 'done click' : '');
  }
  el.outputs.querySelector('[data-o="report"]').onclick = () => { if (world.report) openReport(); };

  // ── 팩트체크 대시보드 ────────────────────────────────────
  // 비슷한 것끼리 묶고, 읽는 사람이 궁금해하는 순서로 놓는다.
  el.gauges.innerHTML =
    `<div class="verdict" id="verdict"><b>—</b><span>아직 재지 않았습니다</span></div>` +
    DASH.map(g => `
      <div class="dgroup">
        <h5>${g.title}<span>${g.hint}</span></h5>
        ${g.items.map(i => `
          <div class="drow" data-k="${i.key}" title="${i.tip}">
            <span class="dl">${i.label}</span>
            <b class="dv">—</b>
            <i class="dbar"><u></u></i>
          </div>`).join('')}
      </div>`).join('');

  function renderMetrics(m) {
    if (!m) return;
    DASH.forEach(g => g.items.forEach(i => {
      const row = el.gauges.querySelector(`[data-k="${i.key}"]`);
      const v = m[i.key] ?? 0;
      // fmt 가 있는 항목은 분모까지 같이 보여야 뜻이 통한다 (예: 출처불일치 3/186곳)
      row.querySelector('.dv').textContent =
        i.fmt ? i.fmt(m) : (i.kind === 'pct' ? pct(v) : `${v}${i.unit}`);
      row.querySelector('.dbar u').style.width =
        i.kind === 'pct' ? `${Math.min(100, v)}%` : (v ? '100%' : '4%');
      row.className = 'drow' + (i.warn(v, m) ? (i.alarm ? ' alarm' : ' warn') : ' ok');
    }));
    const 판 = 그물(m);
    const vd = $('verdict');
    vd.className = 'verdict ' + (판.통과 ? 'pass' : 'fail');
    vd.querySelector('b').textContent = 판.통과 ? '읽어 볼 가치 · 통과' : '확인 필요';
    vd.querySelector('span').textContent = 판.통과
      ? '그물에 걸린 것이 없습니다 — 다만 "좋다"는 뜻은 아닙니다'
      : 판.사유.join(' · ') + ' 가 걸렸습니다';
  }

  // 자막 — 무대 위 띠. 꼬리표 하나와 문장 하나.
  let lastCap = null;
  function renderCaption() {
    const c = world.caption;
    if (c === lastCap) return;
    lastCap = c;
    if (!c) { el.caption.classList.remove('on'); return; }
    el.caption.querySelector('b').textContent = c[0];
    el.caption.querySelector('span').textContent = c[1];
    el.caption.classList.add('on');
  }

  function renderHUD() {
    el.question.textContent = world.question ? `"${world.question}"` : '';
    el.axis.textContent = world.axis ? `${축이름(world.axis)} 축` : '—';
    el.axis.title = 축설명(world.axis);
    el.axis.className = 'tag axis' + (world.axis ? '' : ' off');
    el.progress.style.width = `${(queue.progress * 100).toFixed(1)}%`;
  }

  let lastLog = 0;
  function renderLog() {
    if (world.log.length === lastLog) return;
    lastLog = world.log.length;
    el.log.innerHTML = world.log.slice(-40).map(x => `<div>${esc(x)}</div>`).join('');
    el.log.scrollTop = el.log.scrollHeight;
  }

  // ── 결재 모달 ────────────────────────────────────────────
  // ── 결재 모달 ────────────────────────────────────────────
  // 한 화면에 다 들어가야 한다 — 스크롤이 생기면 아래를 안 보고 누른다.
  //   질문 한 줄 │ 구분선 │ 보고서 제목 + 축 배지 │ 목차 5줄 │ 확인 문구 + 버튼
  //
  // 목차 한 줄 = 「N  절 제목 — 기자 / 명찰 / 시작문서 먼저」 + 다음 줄에 설명.
  // 5강이 확인하라고 한 세 가지 중 앞의 둘(절 수·시작 문서 중복)은 코드가 볼 수 있어서
  // 제목 아래 작은 글씨 한 줄로 접어 두고, 셋째(주제가 맞는가)만 아래 문구로 묻는다.
  function openApproval() {
    const 절 = world.reporters.filter(r => r.section);
    const 배정켬 = world.settings.배정 !== false;
    const 문서 = 절.map(r => r.startDocKo).filter(Boolean);
    const 겹침 = 문서.length - new Set(문서).size;
    const 점검 = 배정켬
      ? `${절.length}절 · 시작 문서 ${겹침 ? `${겹침}건 겹침` : `${문서.length}개 모두 다름`}`
      : `${절.length}절 · 시작 문서를 주지 않는 실험입니다`;

    el.modalBody.innerHTML = `
      <div class="mq"><span>질문</span><em>${esc(world.question)}</em></div>
      <div class="mtop">
        <b class="mtitle">${esc(world.title || '(제목 없음)')}</b>
        <i class="maxis" data-ax="${esc(world.axis || '')}" title="${esc(축설명(world.axis))}">${esc(축이름(world.axis))} 축</i>
      </div>
      <div class="mchk${겹침 ? ' bad' : ''}">${esc(점검)}</div>
      <ol class="mlist">${절.map((r, i) => `
        <li>
          <b class="mno" style="color:${r.color}">${i + 1}</b>
          <div class="mrow">
            <span class="mhead">
              <b class="msec">${esc(r.section)}</b>
              <u style="color:${r.color}">${esc(r.name)}</u>
              ${shortRole(r.badge) ? `<s style="color:${r.color}">${esc(shortRole(r.badge))}</s>` : ''}
              <i>${esc(r.startDocKo || (배정켬 ? '(미정)' : '직접 고름'))} 먼저</i>
            </span>
            <span class="mbrief">${esc(r.brief || '')}</span>
          </div>
        </li>`).join('')}</ol>`;
    $('sfoot').classList.remove('rejecting');
    $('btnReject').textContent = '반려';
    el.reason.value = '';
    el.modal.classList.add('on');
  }

  const closeApproval = () => el.modal.classList.remove('on');

  $('btnApprove').onclick = () => { closeApproval(); onApprove?.(true, ''); };
  $('btnReject').onclick = () => {
    const foot = $('sfoot');
    if (!foot.classList.contains('rejecting')) {      // 첫 클릭 — 사유 칸을 연다
      foot.classList.add('rejecting');
      $('btnReject').textContent = '반려 확정';
      el.reason.focus();
      return;
    }
    closeApproval(); onApprove?.(false, el.reason.value.trim());
  };
  el.reason.onkeydown = e => { if (e.key === 'Enter') $('btnReject').click(); };

  // ── 보고서 뷰어 ──────────────────────────────────────────
  function openReport() {
    // 녹화 22편은 **고치지 않는다**(실제 실행 기록이다). 대신 볼 때 두 가지를 걷어낸다.
    //   ① 절 머리글의 `_(명찰 · 콜사인)_` — 배역이 7명으로 바뀌기 전 콜사인(알파·브라보…)이
    //      박혀 있고, 보고서에 누가 썼는지는 이제 넣지 않는다 (왼쪽 편집국이 보여 준다)
    //   ② 파싱이 깨진 절 끝에 남은 `","충분":true,"부족":""}` — 내용이 아니라 파서 흔적이다.
    //      파이프라인 쪽은 본문만() 으로 고쳤으니 앞으로 뜨는 기록에는 없다.
    const md = (world.report || '(아직 보고서가 없습니다)')
      .replace(/^(##\s.+?)\s+_\([^)]*\)_\s*$/gm, '$1')
      .replace(/"?\s*,\s*"충분"\s*:\s*(?:true|false)\s*,\s*"부족"\s*:\s*"[^"]*"\s*\}/g, '');

    // 본문과 출처를 가른다. 녹화 22편은 «문서» 가 문장 사이에 박힌 채로 저장돼 있어서
    // 여기서 번호로 바꾸고, 파이프라인이 이미 갈라 둔 새 기록은 그대로 쓴다 (조판은 멱등).
    const { 본문, 참고 } = 조판(md);

    const 본문HTML = esc(본문)
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/\[(\d+)\]/g, '<sup class="cn">$1</sup>')
      .replace(/\n{2,}/g, '<br><br>');
    const 참고HTML = 참고.length
      ? '<h2>참고자료</h2><ol class="refs">' +
        참고.map(d => `<li>${esc(d)}</li>`).join('') + '</ol>'
      : '';
    el.reportBody.innerHTML = 본문HTML + 참고HTML;
    el.report.classList.add('on');
  }
  $('btnCloseReport').onclick = () => el.report.classList.remove('on');

  // ── 설정 패널 — 라이브 · 재생 · 설정 ─────────────────────
  const setup = $('setup');
  // 탭은 **상단 바에 늘 있다.** 모달 안에 두면 지금 어느 갈래인지 볼 수 없고,
  // 갈래를 바꾸려고 매번 창을 열어야 한다. 누르면 바로 아래에 그 갈래의 칸이 펼쳐진다.
  let 열린탭 = null;
  const 탭보이기 = t => {
    // 없는 이름이면 아무것도 하지 않는다 — 예전에는 칸만 열리고 안이 비었다(?tab=settings).
    if (!document.querySelector(`#setupTabs button[data-tab="${t}"]`)) return;
    열린탭 = t;
    setup.classList.add('on');
    renderKey();
    document.querySelectorAll('#setupTabs button').forEach(b => b.classList.toggle('open', b.dataset.tab === t));
    document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('on', p.dataset.pane === t));
  };
  const 닫기 = () => { 열린탭 = null; setup.classList.remove('on');
                       document.querySelectorAll('#setupTabs button').forEach(b => b.classList.remove('open')); };

  document.querySelectorAll('#setupTabs button').forEach(b => {
    b.onclick = e => { e.stopPropagation(); 열린탭 === b.dataset.tab ? 닫기() : 탭보이기(b.dataset.tab); };
  });
  document.querySelectorAll('[data-goto]').forEach(b => { b.onclick = () => 탭보이기(b.dataset.goto); });
  $('btnCloseSetup').onclick = 닫기;
  // 바깥을 누르거나 Esc 로 닫는다 — 화면을 가리지 않는 칸이라 가볍게 닫혀야 한다
  setup.onclick = e => e.stopPropagation();
  document.addEventListener('click', () => { if (열린탭) 닫기(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && 열린탭) 닫기(); });

  // 지금 어느 갈래로 돌고 있는지 상단 바에 늘 표시한다
  const 모드표시 = () => {
    const m = world.live ? 'live' : 'replay';
    document.querySelectorAll('#setupTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === m));
  };
  모드표시();

  // ── 재생 — 질문 하나 × 설정 하나 ────────────────────────
  // 22편을 그냥 늘어놓으면 무엇이 무엇의 대조군인지 안 보인다.
  // **같은 질문을 설정만 바꿔 돌린 것**이 짝이므로 두 축으로 나눠 고르게 한다.
  const 변형 = [
    { key:'',            label:'전부 켜고',          hint:'기준' },
    { key:'배정·구역',    label:'시작 문서를 안 나눠 줌', hint:'배정·구역 끔' },
    { key:'역할',        label:'기자 역할을 안 줌',    hint:'역할 끔' },
    { key:'재위임',      label:'빈 절을 안 되돌림',    hint:'재위임 끔' },
  ];
  const 변형키 = r => (r.off || []).join('·');
  // 반려 분기는 메뉴에 두지 않는다 — q1-기본 재생 중 [반려] 를 누르면 그때 이어 붙는다
  const 본편 = replays.filter(r => !r.rejected);
  const 질문들 = [];
  본편.forEach(r => { if (!질문들.some(q => q.question === r.question)) 질문들.push(r); });

  let 고른질문 = (본편.find(r => r.name === current) || 본편[0] || {}).question;
  let 고른변형 = 변형키(본편.find(r => r.name === current) || {});

  const 찾기 = () => 본편.find(r => r.question === 고른질문 && 변형키(r) === 고른변형);

  function renderPicks() {
    $('pickQ').innerHTML = 질문들.map((r, i) => `
      <button class="pick one ${r.question === 고른질문 ? 'on' : ''}" data-q="${i}">
        <i class="ax" data-ax="${r.axis || ''}" title="${esc(축설명(r.axis))}">${축이름(r.axis)}</i>
        ${r.유형 ? `<i class="qt" data-qt="${r.유형}" title="${esc(유형설명(r.유형))}">${r.유형}</i>` : ''}
        <b>${esc(r.question)}</b>
      </button>`).join('');
    $('pickV').innerHTML = 변형.map(v => {
      const 있 = 본편.some(r => r.question === 고른질문 && 변형키(r) === v.key);
      return `<button class="pick sm ${v.key === 고른변형 ? 'on' : ''}${있 ? '' : ' none'}"
                data-v="${v.key}" ${있 ? '' : 'disabled'}>
        <b>${v.label}</b><span>${v.hint}</span></button>`;
    }).join('');

    const r = 찾기();
    const m = r?.metrics || {};
    $('pickInfo').innerHTML = r
      ? `<div class="pi"><b>${r.name}</b>
           ${r.여기서볼것 ? `<em class="why">여기서 볼 것 — ${esc(r.여기서볼것)}</em>` : ''}
           <span>근거가 달린 문장 ${m.근거율 ?? '—'}% · 지어낸 인용 ${m.허위인용 ?? '—'}곳
                · 한 문서에 쏠림 ${m.편중 ?? '—'}% · 근거 없는 절 ${m.인용0절 ?? '—'}개</span>
           ${r.name === current ? '<i class="now">지금 재생 중</i>'
                                : `<button class="go" data-go="${r.name}">이 기록 재생</button>`}</div>`
      : '<div class="pi none">이 조합으로 돌린 기록이 없습니다</div>';

    document.querySelectorAll('#pickQ .pick').forEach(b => {
      b.onclick = () => { 고른질문 = 질문들[+b.dataset.q].question; renderPicks(); };
    });
    document.querySelectorAll('#pickV .pick').forEach(b => {
      if (!b.disabled) b.onclick = () => { 고른변형 = b.dataset.v; renderPicks(); };
    });
    const go = document.querySelector('[data-go]');
    if (go) go.onclick = () => { location.search = `?replay=${encodeURIComponent(go.dataset.go)}`; };

    // **같은 설정을 두 번 돌린 기록**은 그 질문 아래에만 둔다.
    // q2 는 전부 켠 조건으로 두 번 돌렸고 결과가 꽤 달랐다 (근거 23.7% ↔ 29.3%).
    // 설정이 아니라 **흔들림**을 보여 주는 기록이라 두 축에는 들어가지 않는다.
    // 고른 조합에 기록이 둘 이상이면, 첫 번째(위에 띄운 것) 말고 나머지가 '다시 돌림' 이다
    // ⚠ 세대가 다른 기록을 「조건은 같다」고 말하면 안 된다. 「인용0곳점검」이 들어오기
    //   전에 뜬 것은 ④ 점검이 자기신고만 보던 시절이라 재위임 바퀴 수부터 다르다.
    const 또 = 본편.filter(x => x.question === 고른질문 && 변형키(x) === 고른변형 && x !== r);
    const 칸 = (편들, 제목, 풀이) => 편들.length
      ? `<h5>${제목} <span class="ro">${풀이}</span></h5>
         <div class="picks">${편들.map(x => {
            const mm = x.metrics || {};
            return `<button class="pick sm" data-go2="${x.name}">
              <b>${x.name}</b><span>근거 ${mm.근거율 ?? '—'}% · 쏠림 ${mm.편중 ?? '—'}% · 근거 없는 절 ${mm.인용0절 ?? '—'}개</span>
            </button>`; }).join('')}</div>`
      : '';
    $('pickExtra').innerHTML =
      칸(또.filter(x => x.세대 === r?.세대), '같은 설정 다시 돌림',
         '조건은 같고 결과만 다릅니다 — 흔들리는 폭을 보세요')
      // 「이전」이라 쓰면 어느 쪽을 띄웠느냐에 따라 뒤집힌다 — 어느 쪽에서 봐도 맞는 말로 둔다
      + 칸(또.filter(x => x.세대 !== r?.세대), '코드가 다르던 때의 기록',
           '설정 이름은 같지만 ④ 점검이 달랐습니다 — 나란히 재면 안 됩니다');
    document.querySelectorAll('[data-go2]').forEach(b => {
      b.onclick = () => { location.search = `?replay=${encodeURIComponent(b.dataset.go2)}`; };
    });
  }
  renderPicks();

  // ── 키 · 라이브 실행 ─────────────────────────────────────
  // 서버의 PRESETS(api/_common.py) 와 같은 값. 화면이 규모를 못 고르던 때에는 preset 을
  // 아예 안 보내서 배포판 라이브가 **항상 「간단」**이었고, 방문자는 그 사실을 알 수 없었다.
  const 프리셋 = { 간단: { 절수: 3, 절예산: 2, 최대바퀴: 1 },
                   정식: { 절수: 5, 절예산: 3, 최대바퀴: 2 } };
  let 규모 = '간단';
  const 라이브설정 = { 역할: true, 배정: true, 구역: true, 재위임: true };

  function renderKey() {
    const ok = hasKey();
    $('keyState').textContent = ok
      ? '✓ 키가 이 브라우저에 저장되어 있습니다 — 라이브 모드를 쓸 수 있습니다'
      : '키가 없습니다 — 지금은 저장된 실행 기록만 재생합니다';
    $('keyState').className = 'keystate ' + (ok ? 'ok' : 'no');
    $('btnRun').disabled = !ok || !$('liveQ').value.trim();
    $('apiKey').value = ok ? '••••••••••••••••' : '';
    $('liveNoKey').style.display = ok ? 'none' : '';      // 키가 없을 때만 설정 탭으로 안내
  }
  $('btnSaveKey').onclick = () => {
    const v = $('apiKey').value.trim();
    if (v && !v.startsWith('•')) setKey(v);
    renderKey();
  };
  $('btnClearKey').onclick = () => { setKey(''); $('apiKey').value = ''; renderKey(); };
  $('liveQ').oninput = renderKey;

  function renderLiveKnobs() {
    const p = 프리셋[규모];
    // 최대바퀴가 1이면 ④ 점검이 **첫 바퀴에 곧바로 상한**이라 재위임이 돌 자리가 없다.
    // 켜 둔 채로 두면 「켜짐」이라고 적힌 죽은 스위치가 된다 — 사실대로 「불가」로 적는다.
    const 재위임가능 = p.최대바퀴 > 1;
    const 규모설명 = `간단 ${프리셋.간단.절수}절·${프리셋.간단.절예산}문서·${프리셋.간단.최대바퀴}바퀴 / ` +
                     `정식 ${프리셋.정식.절수}절·${프리셋.정식.절예산}문서·${프리셋.정식.최대바퀴}바퀴 ` +
                     `— 정식은 느려서 60초 제한에 끊길 수 있습니다`;
    $('liveKnobs').innerHTML =
      `<div class="knob sw2" data-k="__규모" title="${규모설명}">규모` +
      `<b class="${규모 === '정식' ? 'on' : 'off'}">${규모}</b></div>` +
      Object.keys(라이브설정).map(k => {
        const 죽음 = k === '재위임' && !재위임가능;
        const on = !죽음 && 라이브설정[k];
        const 툴팁 = 죽음 ? ' title="「간단」은 최대바퀴가 1이라 재위임이 한 바퀴도 못 돕니다 — 「정식」으로 바꾸세요"' : '';
        return `<div class="knob sw2${죽음 ? ' dead' : ''}" data-k="${k}"${툴팁}>${k}` +
               `<b class="${on ? 'on' : 'off'}">${죽음 ? '불가' : (on ? '켜짐' : '꺼짐')}</b></div>`;
      }).join('');
    // 표기는 실측이다. 녹화 12편(정식) 중앙값 $0.0276 · 33초(최대 59초),
    // 간단은 라이브 1편 $0.0086 · 17.4초. 한때 규모와 무관하게 「$0.025 · 1~3분」이라
    // 적혀 있었는데, 1분을 넘긴 실행은 한 번도 없었다.
    const 비용칸 = $('liveCost');
    if (비용칸) {
      비용칸.textContent = 규모 === '정식'
        ? '예상 ≈ $0.03 · 30~60초 — 60초 제한에 닿을 수 있습니다'
        : '예상 ≈ $0.01 · 20초 안팎';
      비용칸.title = 규모 === '정식'
        ? '녹화 12편 실측 — 비용 중앙값 $0.0276(최대 $0.0401) · 시간 중앙값 33초(최대 59초)'
        : '라이브 1편 실측 — $0.0086 · 17.4초 (표본 1편)';
    }
    $('liveKnobs').querySelectorAll('.sw2').forEach(sw => {
      sw.onclick = () => {
        const k = sw.dataset.k;
        if (k === '__규모') 규모 = 규모 === '간단' ? '정식' : '간단';
        else if (sw.classList.contains('dead')) return;     // 죽은 스위치는 눌러도 거짓말하지 않는다
        else 라이브설정[k] = !라이브설정[k];
        renderLiveKnobs();
      };
    });
  }
  renderLiveKnobs();

  $('btnRun').onclick = async () => {
    const q = $('liveQ').value.trim(); if (!q) return;
    // 재생이 결재 앞에서 멈춰 있을 수 있다 — 그 모달을 닫고 시작한다.
    // 안 닫으면 라이브의 결재 모달과 겹쳐 어느 쪽을 승인하는지 알 수 없다.
    closeApproval(); approvalShown = false;
    $('btnRun').disabled = true;
    $('runState').className = 'runstate';
    $('runState').textContent = '코퍼스를 받고 편집장을 부르는 중… (탭을 닫으면 중단됩니다)';
    setup.classList.remove('on');
    try {
      await onRun?.(q, { ...라이브설정, preset: 규모 });
      $('runState').textContent = '완료';
    } catch (e) {
      $('runState').className = 'runstate err';
      $('runState').textContent = '실패 — ' + (e?.message || e);
      setup.classList.add('on');
    } finally { renderKey(); }
  };

  function renderKnobs() {
    const st = world.settings || {};
    const 스위치 = ['역할', '배정', '구역', '재위임'];
    const 숫자 = ['절수', '절예산', '최대바퀴'];
    // 칩 한 줄로 — 칸 7개를 격자로 깔면 재생 탭이 한 화면을 넘겼다
    $('knobs').innerHTML =
      숫자.map(k => `<span class="chip">${k} <b>${st[k] ?? '—'}</b></span>`).join('') +
      스위치.map(k => `<span class="chip">${k}
        <b class="${st[k] === false ? 'off' : 'on'}">${st[k] === false ? '꺼짐' : '켜짐'}</b></span>`).join('');
  }

  // ── 접는 카드 ───────────────────────────────────────────
  // 진행 중에는 접어 두고, 필요할 때만 편다. 화면에서 동시에 움직이는 곳을 줄이려는 것이다.
  document.querySelectorAll('.card.fold .foldhead').forEach(h => {
    h.onclick = () => h.closest('.card').classList.toggle('open');
  });
  let 대시펼침 = false;

  // 배속 · 일시정지
  // 버튼이 부르는 것과 URL·도구가 부르는 것을 **같은 함수**로 묶는다.
  // 따로 두면 ?auto=0 으로 멈춘 화면에서 버튼 글자만 ❚❚ 로 남는다.
  const 속도설정 = v => {
    queue.speed = v;
    document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', Number(x.dataset.speed) === v));
  };
  const 멈춤설정 = on => {
    queue.paused = !!on;
    $('btnPause').textContent = queue.paused ? '▶' : '❚❚';
  };
  document.querySelectorAll('[data-speed]').forEach(b => {
    b.onclick = () => 속도설정(Number(b.dataset.speed));
  });
  $('btnPause').onclick = () => 멈춤설정(!queue.paused);

  let approvalShown = false, knobsDone = false, doneShown = false;
  function tick() {
    renderHUD(); renderCaption(); renderTeam(); renderUsage(); 모드표시();
    renderOutputs(); renderLog(); renderMetrics(world.metrics);
    if (!knobsDone && world.settings.절수) { knobsDone = true; renderKnobs(); }

    // 최계량이 계량을 끝내면 대시보드가 저절로 펼쳐진다
    if (!대시펼침 && world.metrics) {
      대시펼침 = true;
      $('dashCard').classList.add('open', 'ready');
      $('dashHint').textContent = '계량 완료';
    }
    $('logCount').textContent = world.log.length ? `${world.log.length}줄` : '';
    el.clock.textContent = world.finished
      ? `완료 ${world.elapsed ?? 0}초`
      : `${world.t.toFixed(1)}초`;
    if (world.approval && !approvalShown) { approvalShown = true; openApproval(); }
    if (!world.approval) approvalShown = false;

    // 끝나면 **보고서를 바로 펼친다.**
    // 예전에는 아래쪽 배너가 자수·근거율·지어낸 인용·경과·호출 수를 알려 줬는데,
    // 그 다섯은 전부 오른쪽 칸(산출물·대시보드·사용량)과 상단 시계에 이미 있는 값이었다.
    // 결과물 자체를 보여주는 편이 낫다.
    //
    // 마무리 대사가 끝난 뒤에 연다 — 편집장이 "이대로 올리겠습니다" 하는 장면을 가리지 않는다.
    if (world.finished && !doneShown && !world.talk && !world.convo.length) {
      doneShown = true;
      openReport();
    }
    if (!world.finished) doneShown = false;
  }
  return { tick, openReport, renderKey, 탭보이기, 닫기, 속도설정, 멈춤설정 };
}
