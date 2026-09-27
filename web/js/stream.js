// 1층 소스 + 2층 이벤트 큐.
//
// 화면은 "의미 이벤트"만 안다. 그 이벤트가 저장된 기록에서 왔는지 실제 실행에서 왔는지 모른다.
// 그래서 키가 없어도 관제실이 똑같이 돌아간다.

import { BEAT } from './config.js';

// ── 1층: 소스 ────────────────────────────────────────────────
export class ScriptedSource {                 // 저장된 녹화 재생 — 키 불필요
  constructor(url) { this.url = url; }
  async load() {
    const r = await fetch(this.url);
    this.data = await r.json();
    return this.data;
  }
  events() { return this.data.events; }
  get meta() { return { name:this.data.name, question:this.data.question,
                        settings:this.data.settings, rejected:this.data.rejected }; }
}

// 라이브 — 실제 LLM 실행. 이벤트가 생기는 대로 큐에 밀어 넣는다.
// 재생과 달리 '이미 끝난 목록'이 없으므로, 큐가 비면 기다렸다가 이어 받는다.
export class LiveSource {
  constructor({ question, settings, onEvent, onApprove }) {
    Object.assign(this, { question, settings, onEvent, onApprove });
    this.abort = new AbortController();
  }
  async start() {
    const [{ run }, corpus] = await Promise.all([
      import('./pipeline.js'),
      fetch('corpus.json').then(r => r.json()),          // 1.6MB — 라이브 모드에서만 받는다
    ]);
    this.corpus = corpus;
    return run({
      question: this.question, settings: this.settings, corpus,
      emit: e => this.onEvent(e),
      approve: plan => this.onApprove(plan),
      signal: this.abort.signal,
    });
  }
  stop() { this.abort.abort(); }
}

// ── 2층: 이벤트 큐 ───────────────────────────────────────────
// 순서 보장 · 배속 · 일시정지 · 승인 게이트 대기 · 대기 구간 압축
export class EventQueue {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.events = []; this.i = 0;
    this.speed = 1; this.paused = false;
    this.waiting = null;            // 결재 대기 중이면 resolve 함수를 들고 있다
    this.hold = null;               // () => true 면 그동안 다음 이벤트를 꺼내지 않는다 (대사 중)
    this.timer = 0;
    this.onIdle = null;
  }
  load(events) { this.events = events; this.i = 0; this.timer = 0; }
  push(e) { this.events.push(e); }                       // 라이브 — 도착하는 대로 덧붙인다

  // 이벤트 사이 간격 — 실제 t 차이를 쓰되 3초를 넘으면 잘라낸다
  gapTo(i) {
    if (i === 0) return .4;
    const a = this.events[i-1].t ?? 0, b = this.events[i].t ?? 0;
    return Math.min(3, Math.max(BEAT[this.events[i].type] ?? .6, b - a));
  }

  step(dt) {
    if (this.paused || this.waiting || this.i >= this.events.length) return;
    if (this.hold && this.hold()) return;      // 회의 대사가 끝날 때까지 기다린다
    this.timer -= dt * this.speed;
    if (this.timer > 0) return;
    const e = this.events[this.i++];
    this.onEvent(e);
    if (e.type === 'approval.request') {          // ★ 여기서 멈추고 사람을 기다린다
      this.waiting = true;
    }
    this.timer = this.i < this.events.length ? this.gapTo(this.i) : 0;
    if (this.i >= this.events.length && this.onIdle) this.onIdle();
  }

  // 결재 응답 — 승인이면 그대로 잇고, 반려면 반려 기록으로 갈아탄다
  resolveApproval(approved, rejectedEvents) {
    this.waiting = null;
    if (!approved && rejectedEvents) {
      // 분기 지점(approval.request) 다음부터 반려 기록으로 교체
      const cut = rejectedEvents.findIndex(e => e.type === 'approval.result');
      this.events = this.events.slice(0, this.i).concat(rejectedEvents.slice(cut));
    }
  }
  get done() { return this.i >= this.events.length; }
  get progress() { return this.events.length ? this.i / this.events.length : 0; }
}
