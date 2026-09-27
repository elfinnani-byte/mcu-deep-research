// 부팅 — 소스를 고르고 4층을 연결한다.
//
//   소스(재생|라이브) ──의미 이벤트──▶ 큐 ──▶ 연출 ──▶ 월드 ──▶ 렌더러/UI

import { createWorld, loadRacks, stepTalk, 말하는중 } from './world.js';
import { apply } from './choreographer.js';
import { createRenderer } from './renderer.js';
import { ScriptedSource, LiveSource, EventQueue } from './stream.js';
import { createUI } from './ui.js';
import { getKey } from './key.js';

// ── 주소로 화면을 부른다 ────────────────────────────────────────────────
//
// 발표에서 「q4 역할끔의 보고서를 보여 주세요」 를 클릭 다섯 번으로 만들지 않으려는 것이다.
// 화면을 자동으로 확인할 때도 이 문으로 들어간다 — 도구만의 뒷문을 따로 내면,
// 도구가 통과한 경로와 사람이 보는 경로가 갈라진다.
//
//   ?replay=q4-역할끔   어느 녹화를 트나 (기본 q1-기본)
//   ?tab=live|replay|key        그 갈래를 펼친 채로 연다 (settings 는 key 의 별명)
//   ?speed=1|2|4        배속
//   ?auto=0             멈춘 채로 연다 (스크린샷용)
//   ?report=1           결말로 건너뛰고 보고서를 편다
//
// 값이 이상하면 **조용히 기본값으로 돌아간다.** 주소 한 글자 때문에 빈 화면이 뜨면
// 그게 더 나쁘다.
const params = new URLSearchParams(location.search);
const 재생본 = params.get('replay') || 'q1-기본';
const 설정켜짐 = k => { const v = params.get(k); return v !== null && v !== '0' && v !== 'false'; };
// 화면의 탭 이름은 live · replay · key 다. 'settings' 는 사람이 먼저 떠올리는 말이라 받아 준다.
const 탭별명 = { live: 'live', replay: 'replay', key: 'key', settings: 'key', 설정: 'key' };
const 탭인자 = 탭별명[params.get('tab')] || null;
const 배속인자 = [1, 2, 4].includes(Number(params.get('speed'))) ? Number(params.get('speed')) : null;
const 멈춤인자 = params.get('auto') !== null && !설정켜짐('auto');   // auto=0 이면 멈춘 채로
const 보고서인자 = 설정켜짐('report');

const world = createWorld();
const queue = new EventQueue(e => {
  if (typeof e.t === 'number') world.t = e.t;   // 시계를 기록의 시각에 맞춘다
  apply(world, e);
});
queue.hold = () => 말하는중(world);      // 대사가 흐르는 동안은 다음 이벤트를 미룬다
const renderer = createRenderer(document.getElementById('stage'), world);
let 반려기록 = null;

const racksJson = await (await fetch('racks.json')).json();
let 목록 = [];
try { 목록 = (await (await fetch('replay/index.json')).json()).replays; } catch {}

let 결재대기 = null;                     // 라이브 — 사람이 누를 때까지 파이프라인을 세운다

const ui = createUI(world, queue, {
  replays: 목록, current: 재생본,
  onApprove: (ok, reason) => {
    // 라이브 — LiveSource 가 서버 응답을 보고 approval.result 를 만들어 큐에 넣는다.
    //          여기서 또 만들면 소집 대사가 두 번 나온다.
    if (결재대기) {
      const r = 결재대기; 결재대기 = null; world.approval = null;
      queue.resolveApproval(true, null);      // ★ 큐의 결재 대기를 푼다 — 안 풀면 뒤가 안 흐른다
      r([ok, reason]);                        // (반려여도 서버가 다시 짜 주므로 큐는 그냥 연다)
      return;
    }
    // 재생 — 녹화에 approval.result 가 들어 있지만, 사람이 적은 반려 사유를 살리려고 하나 만든다
    apply(world, { type:'approval.result', approved: ok, reason });
    queue.resolveApproval(ok, ok ? null : 반려기록);
  },
  onRun: async (question, settings) => {
    Object.assign(world, createWorld());          // 무대를 비우고 다시 시작
    world.live = true;
    loadRacks(world, racksJson);
    queue.load([]); queue.waiting = null; queue.i = 0;
    반려기록 = null;                               // 라이브에는 녹화 분기가 없다 — 서버가 다시 짠다
    const src = new LiveSource({
      question, settings, key: getKey(),           // 키는 요청 본문으로만 나간다
      onEvent: e => queue.push(e),                 // 도착하는 대로 큐에 쌓고, 큐가 속도를 정한다
      onApprove: () => new Promise(res => { 결재대기 = res; }),
    });
    document.getElementById('srcName').textContent = '라이브 · 실제 실행';
    await src.start();
  },
});

(async function boot() {
  // 서고 자료
  loadRacks(world, racksJson);

  // 녹화 재생
  const src = new ScriptedSource(`replay/${재생본}.json`);
  await src.load();
  queue.load(src.events());

  // 반려 분기 기록이 있으면 미리 받아 둔다 (없으면 반려해도 승인과 같은 흐름).
  // **목록에 있는지 먼저 본다.** 예전에는 무턱대고 받아 보고 404 를 삼켰는데,
  // 반려 기록은 q1 에만 있어서 나머지 21편은 열 때마다 콘솔에 빨간 줄을 남겼다 —
  // 진짜 오류가 그 틈에 묻힌다.
  const 반려이름 = `${재생본.replace(/-.*$/, '')}-반려`;
  if (목록.some(r => r.name === 반려이름)) {
    try {
      const r = await fetch(`replay/${encodeURIComponent(반려이름)}.json`);
      if (r.ok) 반려기록 = (await r.json()).events;
    } catch {}
  }

  document.getElementById('srcName').textContent =
    `재생 · ${src.meta.name}` + (반려기록 ? ' (반려 분기 있음)' : '');

  // 주소에 실린 것을 적용한다 — 순서가 있다.
  // 배속·멈춤을 먼저 걸어야 건너뛰기 뒤에 화면이 다시 흐르지 않는다.
  if (배속인자) ui.속도설정(배속인자);
  if (보고서인자) {
    queue.끝으로();                 // 연출을 태우지 않고 이벤트만 전부 적용
    ui.멈춤설정(true);
    ui.openReport();
  } else if (멈춤인자) {
    ui.멈춤설정(true);
  }
  if (탭인자) ui.탭보이기(탭인자);

  window.APP = { world, queue, renderer, ui };    // 콘솔에서 상태를 들여다보는 창구
  let last = performance.now(), frames = 0, 연출시각 = 0;

  function tick(now) {
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    window.APP.frames = ++frames;
    // **일시정지는 한 곳에서 건다.** 예전에는 queue.step 만 멈춰서
    // 이벤트는 서는데 걸음·말풍선·시계는 계속 흘렀다 — 멈춘 것처럼 보이지 않았다.
    const 흐름 = queue.paused ? 0 : dt;
    try {
      // 배속은 말·걸음·연출에 똑같이 걸려야 한다.
      // 대사만 빨라지면 아직 걸어가는 중에 회의가 끝나 버린다.
      const 실dt = 흐름 * queue.speed;
      world.t += 실dt;              // 이벤트가 오면 e.t 로 다시 맞춰진다
      연출시각 += 실dt;             // 팬·숨쉬기 같은 상시 애니메이션도 같이 선다
      stepTalk(world, 실dt);
      queue.step(흐름);
      renderer.draw(연출시각, 실dt);
      ui.tick();
    } catch (err) {
      window.APP.lastError = String(err && err.stack || err);
      console.error('[frame]', err);
    }
  }

  // 보통은 requestAnimationFrame 으로 돈다. 그런데 창이 화면에 그려지지 않는 환경
  // (미리보기 패널·배경 탭)에서는 RAF 가 아예 오지 않아 화면이 멈춘다.
  // 0.5초 안에 프레임이 안 오면 타이머로 갈아탄다.
  let raf = 0, driver = 'raf';
  const loop = now => { tick(now); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  setTimeout(() => {
    if (frames <= 1) {
      cancelAnimationFrame(raf); driver = 'timer';
      setInterval(() => tick(performance.now()), 1000 / 30);
    }
    window.APP.driver = driver;
  }, 500);
})();
