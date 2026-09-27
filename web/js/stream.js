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

// 라이브 — **파이프라인은 서버(파이썬) 한 벌뿐이다.** 브라우저는 두 번 부른다.
//
//   1) POST /api/plan   ① 기획 + ② 배정까지. 목차를 받아 결재 모달을 띄운다
//      ── 사람이 승인/반려를 누른다. 이 동안 서버 함수는 돌지 않는다 ──
//   2) POST /api/run    승인된 목차를 실어 보내고, ③ 조사부터 SSE 로 받아 큐에 넣는다
//
// 왜 나눴나 — 서버리스 함수는 **사람을 기다리는 동안에도 실행 시간을 태운다.**
// 한 번에 돌리면 결재를 기다리다 Hobby 상한(60초)을 넘긴다.
//
// 반려하면 사유를 실어 1)을 다시 부른다. 최대 2차까지, 그 뒤에는 그대로 진행한다.
const SEP = String.fromCharCode(10, 10);   // SSE 한 건의 끝 — 빈 줄

export class LiveSource {
  constructor({ question, settings, key, onEvent, onApprove }) {
    Object.assign(this, { question, settings, key, onEvent, onApprove });
    this.abort = new AbortController();
  }

  async #post(path, body) {
    const r = await fetch(path, {
      method: 'POST', signal: this.abort.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: this.question, key: this.key, ...this.settings, ...body }),
    });
    return r;
  }

  async start() {
    let attempt = 1, 사유 = '';
    for (;;) {
      const r = await this.#post('/api/plan', { 사유, attempt });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `기획 실패 (${r.status})`);
      d.events.forEach(e => this.onEvent(e));           // run.start · plan.done · assign.done · approval.request

      const [ok, reason] = await this.onApprove(d.plan);
      this.onEvent({ type: 'approval.result', approved: !!ok, reason: reason || '' });
      if (ok || attempt >= 2) return this.#stream(d.plan);   // 최대반려 2 — 그 뒤에는 그대로 간다
      attempt++; 사유 = reason || '사유 없음';
    }
  }

  /** ③ 조사부터 끝까지 — SSE 를 한 줄씩 받아 큐에 넣는다 */
  async #stream(plan) {
    const r = await this.#post('/api/run', { plan });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `실행 실패 (${r.status})`);
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf(SEP)) >= 0) {           // SSE 는 빈 줄로 한 건이 끝난다
        const 줄 = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
        if (!줄.startsWith('data:')) continue;
        const ev = JSON.parse(줄.slice(5).trim());
        if (ev.type === 'done') return;
        if (ev.type === 'error') throw new Error(ev.message);
        this.onEvent(ev);
      }
    }
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
