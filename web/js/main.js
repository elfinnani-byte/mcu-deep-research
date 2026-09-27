// 부팅 — 소스를 고르고 4층을 연결한다.
//
//   소스(재생|라이브) ──의미 이벤트──▶ 큐 ──▶ 연출 ──▶ 월드 ──▶ 렌더러/UI

import { createWorld, loadRacks, stepTalk, 말하는중 } from './world.js';
import { apply } from './choreographer.js';
import { createRenderer } from './renderer.js';
import { ScriptedSource, LiveSource, EventQueue } from './stream.js';
import { createUI } from './ui.js';
import { getKey } from './key.js';

const params = new URLSearchParams(location.search);
const 재생본 = params.get('replay') || 'q1-기본';

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

  // 반려 분기 기록이 있으면 미리 받아 둔다 (없으면 반려해도 승인과 같은 흐름)
  try {
    const r = await fetch(`replay/${재생본.replace(/-.*$/, '')}-반려.json`);
    if (r.ok) 반려기록 = (await r.json()).events;
  } catch {}

  document.getElementById('srcName').textContent =
    `재생 · ${src.meta.name}` + (반려기록 ? ' (반려 분기 있음)' : '');

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
