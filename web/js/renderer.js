// 4층 — 월드 상태를 아이소메트릭 캔버스에 그린다.
// 캐릭터·집기의 생김새는 전부 sprites.js 에 있다. 여기서는 "어디에 무엇을" 만 정한다.

import { TILE, C, STAGE, MEET, ROOM, FONT } from './config.js';
import { stepMoves } from './world.js';
import * as S from './sprites.js';

export function createRenderer(canvas, world) {
  const ctx = canvas.getContext('2d');
  let s = 1, ox = 0, oy = 0;

  function resize() {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    // 방 네 귀퉁이를 화면 좌표(sx = gx-gy, sy = gx+gy)로 옮겨 딱 맞게 담는다.
    // 사람·집기가 벽 밖으로 조금 넘치므로 여유 1칸.
    const 여 = 1.0;
    const sx0 = ROOM.gx0 - ROOM.gy1 - 여, sx1 = ROOM.gx1 - ROOM.gy0 + 여;
    const sy0 = ROOM.gx0 + ROOM.gy0,      sy1 = ROOM.gx1 + ROOM.gy1 + 여;
    const 중심 = (sx0 + sx1) / 2;
    const 폭단위 = (sx1 - sx0) * TILE.W / 2;
    const 벽높이 = ROOM.h + 22, 깊이 = (sy1 - sy0) * TILE.H / 2;
    const 가용폭 = Math.max(360, W - 24);
    s = Math.max(.5, Math.min(1.25, Math.min(가용폭 / 폭단위, (H - 32) / (벽높이 + 깊이))));
    ox = W / 2 - 중심 * TILE.W / 2 * s;
    oy = 16 + (H - 32 - (벽높이 + 깊이) * s) / 2 + 벽높이 * s - sy0 * TILE.H / 2 * s;
  }
  const iso = (gx, gy) => ({ x: ox + (gx - gy) * TILE.W / 2 * s, y: oy + (gx + gy) * TILE.H / 2 * s });

  // 바닥 — 마름모 격자. 방 사각형으로 **잘라서** 그린다.
  // 예전에는 격자를 무한 평면으로 깔아 사무실이 아니라 허허벌판으로 보였다.
  function drawFloor() {
    const P = (gx, gy) => { const p = iso(gx, gy); return [p.x, p.y]; };
    const 방 = [P(ROOM.gx0, ROOM.gy0), P(ROOM.gx1, ROOM.gy0),
                P(ROOM.gx1, ROOM.gy1), P(ROOM.gx0, ROOM.gy1)];
    const 윤곽 = () => {
      ctx.beginPath();
      방.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
    };
    ctx.save();
    윤곽(); ctx.fillStyle = C.floorB; ctx.fill(); ctx.clip();
    const w2 = TILE.W / 2 * s, h2 = TILE.H / 2 * s;
    for (let gx = Math.floor(ROOM.gx0) - 1; gx <= Math.ceil(ROOM.gx1) + 1; gx++)
      for (let gy = Math.floor(ROOM.gy0) - 1; gy <= Math.ceil(ROOM.gy1) + 1; gy++) {
        const p = iso(gx, gy);
        ctx.beginPath(); ctx.moveTo(p.x, p.y - h2); ctx.lineTo(p.x + w2, p.y);
        ctx.lineTo(p.x, p.y + h2); ctx.lineTo(p.x - w2, p.y); ctx.closePath();
        ctx.fillStyle = (gx + gy) % 2 ? C.floorA : C.floorB; ctx.fill();
        ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.stroke();
      }
    ctx.restore();
    윤곽(); ctx.strokeStyle = 'rgba(42,111,135,.34)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // ── 서고 랙 ────────────────────────────────────────────────
  // 바닥 격자에 맞춘 **진짜 아이소메트릭 상자**로 그린다.
  //
  // 예전에는 화면에 정면으로 붙은 납작한 상자였다. 격자에 대해 45° 돌아간 셈이라
  // 바닥의 마름모 무늬와 따로 놀았고, 아이소메트릭으로 그린 에셋과도 각도가 어긋났다.
  //
  // 이 투영에서 눈에 보이는 세로 면은 둘뿐이다 —
  //   +gx 면(화면 오른쪽 아래를 봄) · +gy 면(화면 왼쪽 아래를 봄).
  // 칸 단위를 gx 쪽으로 얇게, gy 쪽으로 길게 잡아 **+gx 면을 넓은 앞면**으로 쓰고
  // 블레이드를 거기 붙인다.
  // 벽에 등을 대고 한 줄로 서므로 **앞면은 +gy(화면 왼쪽 아래)** 다.
  // gx 쪽으로 넓고 gy 쪽으로 얇아야 옆 서고를 가리지 않는다.
  const RACK = { gw: 1.35, gd: .62, minH: 84, perDoc: 8.2, base: 42 };

  function drawRackShape(R, t) {
    const { gw, gd } = RACK;
    const H = Math.max(RACK.minH, RACK.base + R.docs.length * RACK.perDoc) * s;
    // 격자 오프셋 → 화면 좌표. dy 는 화면상 수직(아이소메트릭에서 높이는 언제나 수직이다).
    const P = (dgx, dgy, dy = 0) => {
      const p = iso(R.at.gx + dgx, R.at.gy + dgy);
      return [p.x, p.y - dy];
    };
    const N = P(-gw/2, -gd/2), E = P(+gw/2, -gd/2);
    const S = P(+gw/2, +gd/2), W = P(-gw/2, +gd/2);
    const Nt = P(-gw/2, -gd/2, H), Et = P(+gw/2, -gd/2, H);
    const St = P(+gw/2, +gd/2, H), Wt = P(-gw/2, +gd/2, H);

    const poly = (pts, fill, stroke) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.1; ctx.stroke(); }
    };

    poly([E, S, St, Et], '#0b1421');                  // +gx 면 — 그늘진 옆면
    poly([S, W, Wt, St], '#111c2b', C.holoDim);       // +gy 면 — 블레이드가 붙는 앞면
    poly([Nt, Et, St, Wt], '#16202f', C.holoDim);     // 윗면

    // 앞면 좌표계 — u 는 S→W 를 따라 0~1, v 는 바닥에서 위로(px)
    const at = (u, v) => [S[0] + (W[0]-S[0])*u, S[1] + (W[1]-S[1])*u - v];
    const band = (u0, u1, v0, v1, fill) =>
      poly([at(u0,v1), at(u1,v1), at(u1,v0), at(u0,v0)], fill);

    // 블레이드 — 한 줄이 문서 한 건. 읽은 기자 색으로 점등하고, 둘이 읽었으면 색이 갈린다.
    // 앞면 높이를 문서 수로 나눠 채운다. 그래야 건수가 적어도 아래가 휑하지 않고,
    // 많을수록 촘촘해져 **건수가 밀도로 읽힌다.**
    //
    // 세 가지 상태가 구분되어야 한다.
    //   안 읽음   흐린 시안 토막
    //   읽음      읽은 기자 색 꽉 찬 막대 (+ 은은한 번짐)
    //   헛읽음    같은 색이지만 **끊어진 막대** — 갔다 왔는데 이 절과 상관없던 문서다
    //
    // 예전에는 헛읽음도 꽉 찬 막대로 그려져 제대로 읽은 것과 구분이 안 됐다.
    // (회색으로 칠하는 가지가 있었지만 readers 가 0일 때만 닿아서 죽은 코드였다 —
    //  relevant 는 research.read 에서만 정해지고 그 자리에서 readers 도 채워지기 때문.)
    const top = H - 30*s, floor = 9*s;
    const pitch = (top - floor) / R.docs.length;
    const bh = Math.min(7*s, pitch * .72);
    R.docs.forEach((b, i) => {
      const v1 = top - i * pitch, v0 = v1 - bh;
      band(.06, .94, v0, v1, '#0a1320');
      const n = b.readers.length;
      if (n === 0) {                                   // 아직 아무도 안 읽었다
        ctx.globalAlpha = .75;
        band(.09, .09 + .85*.25, v0 + 1.2*s, v1 - 1.2*s, '#1d3a4a');
        ctx.globalAlpha = 1;
        return;
      }
      const 헛 = b.relevant === false;                 // 읽었는데 이 절과 상관없었다
      const seg = .85 / n;
      b.readers.forEach((col, k) => {
        const u0 = .09 + k * seg, u1 = .09 + (k+1) * seg - .01;
        if (!헛) { band(u0, u1, v0 + 1.2*s, v1 - 1.2*s, col); return; }
        ctx.globalAlpha = .42;                         // 끊어진 막대 — 네 토막
        const 칸 = (u1 - u0) / 7;
        for (let d = 0; d < 4; d++)
          band(u0 + d*2*칸, u0 + (d*2 + 1)*칸, v0 + 1.2*s, v1 - 1.2*s, col);
        ctx.globalAlpha = 1;
      });
      if (!헛) {                                       // 번짐은 건진 것에만
        ctx.globalAlpha = .2; band(.04, .96, v0 - 1*s, v1 + 1*s, b.readers[0]); ctx.globalAlpha = 1;
      }
      if (n > 1) band(.09, .94, v1 - 1.2*s, v1, 'rgba(255,255,255,.55)');   // 중복 — 흰 띠
    });

    // 팬 — 앞면 위쪽에서 돌아간다
    const [fx, fy] = at(.14, H - 14*s);
    ctx.save(); ctx.translate(fx, fy); ctx.rotate(t * 2.2);
    ctx.strokeStyle = C.holoDim; ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(i*2.1)*4*s, Math.sin(i*2.1)*4*s); ctx.stroke();
    }
    ctx.restore();

    // 명판 — 윗면 위에 띄운다. 상자를 가리지 않게 마름모 꼭대기보다 위로.
    // 이름표는 **그 랙 윗면 바로 위**에 붙인다.
    // 서고를 건수 내림차순으로 세우면 오른쪽으로 갈수록 랙이 낮아지고 바닥은 내려가므로,
    // 이름표 줄 간격이 최소 27px 벌어진다 — 겹치지 않는다.
    const cx = (N[0] + S[0]) / 2;
    drawRackPlate(R, cx, Nt[1] - 7*s, s);
  }

  // 서가 이름 — 배경판 없이 **한 줄**. 「아이언맨(3건)」
  // 어두운 벽 위에 글자만 올리면 안 읽히므로 글자 뒤에 짙은 외곽선을 깐다.
  function drawRackPlate(R, x, base, s) {
    const 이름 = R.name, 건수 = `(${R.docs.length}건)`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${11.5*s}px ${FONT}`;
    const w1 = ctx.measureText(이름).width;
    ctx.font = `600 ${10*s}px ${FONT}`;
    const w2 = ctx.measureText(건수).width;
    let px = x - (w1 + w2 + 2*s) / 2;

    const 글 = (txt, font, fill) => {
      ctx.font = font;
      ctx.lineWidth = 3.4*s; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(6,14,24,.9)'; ctx.strokeText(txt, px, base);
      ctx.fillStyle = fill; ctx.fillText(txt, px, base);
      px += ctx.measureText(txt).width;
    };
    글(이름, `700 ${11.5*s}px ${FONT}`, '#d6f2ff');
    px += 2*s;
    글(건수, `600 ${10*s}px ${FONT}`, 'rgba(126,186,212,.92)');
    ctx.textAlign = 'center';
  }

  const drawRack = drawRackShape;

  // 뒤쪽 **두 면**에 벽을 세운다.
  //   ① gy = ROOM.gy0 를 따라 gx 로 뻗는 면 — 서고가 등을 대는 오른쪽 뒷벽
  //   ② gx = ROOM.gx0 를 따라 gy 로 뻗는 면 — 왼쪽 뒷벽
  // 두 면이 방 꼭대기에서 만나 모서리를 이룬다. 벽이 없으면 바닥이 허공에 뜬다.
  function drawWalls() {
    const h = ROOM.h * s, 굽 = 7 * s;
    const quad = (pts, fill) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    };
    const line = (a, b, c) => {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.stroke();
    };

    // 한 면 그리기 — 바닥선 위 두 점(u0→u1)을 받아 h 만큼 세운다.
    // 왼쪽 벽은 빛을 덜 받으므로 한 톤 어둡게 칠해 모서리가 드러난다.
    const 면 = (u0, u1, 밝기, 이음) => {
      const A = u0(0), B = u1(0), At = u0(h), Bt = u1(h);
      const g = ctx.createLinearGradient(0, Math.min(At[1], Bt[1]), 0, Math.max(A[1], B[1]));
      g.addColorStop(0, 밝기[0]); g.addColorStop(.55, 밝기[1]); g.addColorStop(1, 밝기[2]);
      quad([A, B, Bt, At], g);
      이음.forEach(P => line(P(0), P(h), 'rgba(74,158,189,.12)'));
      quad([A, B, [B[0], B[1] - 굽], [A[0], A[1] - 굽]], 'rgba(42,111,135,.20)');
      line(At, Bt, 'rgba(93,214,255,.38)');
      line(u0(h - 10*s), u1(h - 10*s), 'rgba(74,158,189,.15)');
    };

    // ① 오른쪽 뒷벽 (gy 고정)
    const R점 = gx => dy => { const p = iso(gx, ROOM.gy0); return [p.x, p.y - dy]; };
    const R이음 = [];
    for (let gx = ROOM.gx0 + 1.55; gx < ROOM.gx1 - .2; gx += 1.55) R이음.push(R점(gx));
    면(R점(ROOM.gx0), R점(ROOM.gx1), ['#1b2c44', '#132038', '#0d1626'], R이음);

    // ② 왼쪽 뒷벽 (gx 고정) — 한 톤 어둡게
    const L점 = gy => dy => { const p = iso(ROOM.gx0, gy); return [p.x, p.y - dy]; };
    const L이음 = [];
    for (let gy = ROOM.gy0 + 1.8; gy < ROOM.gy1 - .2; gy += 1.8) L이음.push(L점(gy));
    면(L점(ROOM.gy0), L점(ROOM.gy1), ['#13223a', '#0e1a2e', '#0a1320'], L이음);

    // 두 벽이 만나는 모서리
    const c0 = iso(ROOM.gx0, ROOM.gy0);
    line([c0.x, c0.y], [c0.x, c0.y - h], 'rgba(93,214,255,.22)');
  }

  function draw(t, dt) {
    const w = world;
    stepMoves(w, dt);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFloor();
    drawWalls();
    w.racks.forEach(R => drawRack(R, t));

    // ── 집기와 사람을 깊이 순으로 함께 그린다 ────────────────
    // 아이소메트릭에서는 gx+gy 가 클수록 카메라에 가깝다. 집기든 사람이든
    // 이 값 하나로 순서를 정해야 앞뒤가 맞는다.
    //
    // 책상·부스는 사람보다 **반 칸 앞**(+gx·+gy)에 둔다. 그래야 사람이 집기 뒤에
    // 선 모습이 되고, 집기가 다리를 살짝 가려 바닥에 붙어 보인다.
    const 앞 = .55;
    const 집기 = [
      ...STAGE.desks.map(d => ({ gx:d.gx+앞, gy:d.gy+앞, kind:'console' })),
      { gx:STAGE.editor.gx+앞,   gy:STAGE.editor.gy+앞,   kind:'console' },
      // 최계량 책상 하나가 심사대와 발행함을 겸한다 — 이단 결재함으로 그린다
      { gx:STAGE.score.gx+앞,    gy:STAGE.score.gy+앞,    kind:'outbox', state:w.outbox },
      // ④ 점검(빈 절 반송)은 이 탁자에서 일어난다 — 점검 램프도 여기 뜬다
      { gx:MEET.table.gx,        gy:MEET.table.gy,        kind:'table', state:w.reviewLamp }
    ];
    const 사람 = [
      ...w.staff.map(x => ({ o:x, gx:x.gx, gy:x.gy, staff:true })),
      ...w.reporters.map(x => ({ o:x, gx:x.gx, gy:x.gy, staff:false })),
    ];

    [...집기.map(x => ({ ...x, prop:true })), ...사람]
      .sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy))
      .forEach(it => {
        const p = iso(it.gx, it.gy);
        if (it.prop) { S.drawProp(ctx, { ...p, kind:it.kind, s, t, state:it.state }); return; }
        S.drawCharacter(ctx, { ...p, color: it.o.color,
                               pose:it.o.pose, s, t, phase:it.o.phase });
      });

    // 날아가는 원고
    w.papers.forEach(p => {
      if (p.t < 0) return;                       // 쪽지는 차례로 날아간다 — 아직 차례가 아니다
      const a = iso(p.from.gx, p.from.gy), b = iso(p.to.gx, p.to.gy);
      const k = Math.min(1, p.t), 호 = p.memo ? 14 : 70;   // 쪽지는 낮게 — 말풍선에 걸리지 않게
      S.drawPaper(ctx, {
        x: a.x + (b.x - a.x) * k,
        y: a.y - 40*s + ((b.y - 30*s) - (a.y - 40*s)) * k - Math.sin(k*Math.PI) * 호 * s,
        rot: Math.sin(k*6) * .35, s, fake: p.fake, memo: p.memo });
    });

    // ── 라벨은 맨 마지막에 ──────────────────────────────────
    // 이름표와 말풍선은 읽으라고 있는 것이다. 집기 뒤로 숨으면 안 되므로
    // 깊이 정렬에서 빼고 전부 위에 얹는다.
    사람.forEach(({ o, gx, gy, staff }) => {
      const p = iso(gx, gy);
      const color = o.color;
      // 무대에는 이름표 하나만 남긴다. 명찰·상태·수치는 왼쪽 관제 보드가 맡는다.
      S.drawNamePlate(ctx, { ...p, text: o.name, color, s });   // 직함은 관제 보드가 말한다
      // 말풍선 — 회의 대사(편집장·기자)와, 기자가 문서를 펼쳐 든 순간.
      if (o.say) S.drawBubble(ctx, { ...p, text:o.say, s, tone:o.sayTone || 'paper' });
    });
  }

  // 창 크기 변화만 듣던 것을 **캔버스 자체**를 보게 바꿨다.
  // 부팅 시점에 clientWidth 가 0이면 canvas.width 도 0이 되고, 그 뒤 창이 안 바뀌면
  // resize 가 영영 안 불려 무대가 빈 채로 남는다 — headless 캡처에서 실제로 그랬다.
  resize();
  addEventListener('resize', resize);
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(canvas);
  return { draw, resize, iso, get scale(){ return s; } };
}
