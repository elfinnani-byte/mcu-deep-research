// ★ 그리기 어댑터 — 캐릭터·집기의 "생김새"는 전부 이 파일 안에만 있다.
//
// 바깥(renderer·world·choreographer)은 "김기자가 3번 자리에서 타이핑 중" 같은 상태만 알고,
// 그것이 도형으로 그려지는지 스프라이트 이미지로 그려지는지는 모른다.
// 나중에 Kenney 스프라이트나 다른 아트로 바꾸려면 이 파일만 갈아 끼우면 된다.
//
// 지켜야 할 계약
//   1) drawCharacter / drawProp 의 인자 모양을 바꾸지 않는다
//   2) 캐릭터는 CHAR.W × CHAR.H (32×48) 규격, 발이 (x, y) 에 닿는다
//   3) POSES 여섯 개(idle·walk·type·carry·wait·reject)를 모두 구현한다
//   4) 이름표는 몸통 위에 따로 그린다 — 이미지로 바꿔도 이름표는 코드로 남는다
//
// drawBadge 는 지금 무대에서 쓰지 않는다. 명찰은 왼쪽 관제 보드가 보여주고,
// 무대는 이름표 하나만 단다 — 글자가 겹치면 화면이 읽히지 않기 때문이다.
// 다시 무대에 명찰을 달고 싶을 때를 위해 함수는 남겨 둔다.
//
// 이미지 스프라이트로 바꿀 때:
//   const sheet = await loadImage('assets/cast.png');
//   drawCharacter 안에서 ctx.drawImage(sheet, 포즈별 프레임, ...) 로 교체하고,
//   drawNamePlate 는 그대로 둔다.

import { C, CHAR, TILE, FONT } from './config.js';

export const kind = 'shapes';        // 어떤 구현인지 — UI 표시·디버깅용

// ── 이미지 에셋 ──────────────────────────────────────────────
// 그림 파일은 여기서만 받는다. 아직 안 왔거나 실패하면 `ready()` 가 false 라서
// 부르는 쪽이 도형으로 되돌아간다 — 화면이 비는 일은 없다.
// 출처·라이선스는 web/assets/CREDITS.md 에 있다.
const IMG = {};
export function useImage(key, url) {
  if (IMG[key]) return;
  const rec = IMG[key] = { img: new Image(), ok: false };
  rec.img.onload  = () => { rec.ok = true; };
  rec.img.onerror = () => { console.warn('[sprites] 이미지를 못 받았습니다 —', url); };
  rec.img.src = url;
}
export const ready = key => !!IMG[key]?.ok;
export const image = key => IMG[key]?.img;

const shade = (hex, d) => {
  const n = parseInt(hex.slice(1), 16), f = v => Math.max(0, Math.min(255, v + d));
  return `rgb(${f(n>>16)},${f((n>>8)&255)},${f(n&255)})`;
};
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x+r, y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

// ── 캐릭터 ───────────────────────────────────────────────────
// { x, y }  발이 닿는 화면 좌표
// { color } 몸통 색 (기자는 명찰 색, 직원은 슬레이트)
// { pose }  POSES 중 하나
// { s }     배율,  { t } 시간(초) — 애니메이션 위상
export function drawCharacter(ctx, { x, y, color, pose = 'idle', s = 1, t = 0, phase = 0 }) {
  const tt = t + phase, walk = pose === 'walk';
  const H = CHAR.H * s * 0.92, W = 15 * s;
  const bob = walk ? Math.abs(Math.sin(tt*9))*3*s : Math.sin(tt*2)*1.2*s;
  const cy = y - bob;

  ctx.save();
  ctx.globalAlpha = .3; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(x, y+2*s, 11*s, 5*s, 0, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;

  // 다리
  const sw = walk ? Math.sin(tt*9)*5*s : 0;
  ctx.strokeStyle = shade(color,-70); ctx.lineWidth = 4*s; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(x-3*s, cy-14*s); ctx.lineTo(x-3*s+sw, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+3*s, cy-14*s); ctx.lineTo(x+3*s-sw, cy); ctx.stroke();

  // 몸통 + 직함 띠
  ctx.fillStyle = shade(color,-42); roundRect(ctx, x-W/2, cy-H+12*s, W, H-24*s, 5*s); ctx.fill();
  ctx.fillStyle = color; roundRect(ctx, x-W/2, cy-H+16*s, W, 4.5*s, 2*s); ctx.fill();

  // 팔 — 포즈별
  ctx.strokeStyle = shade(color,-55); ctx.lineWidth = 3.4*s;
  const arm = (dx1,dy1,dx2,dy2) => {
    ctx.beginPath(); ctx.moveTo(x+dx1, cy+dy1); ctx.lineTo(x+dx2, cy+dy2); ctx.stroke();
  };
  if (pose === 'type') {
    const a = Math.sin(tt*12)*2.5*s, b = Math.cos(tt*12)*2.5*s;
    arm(-W/2, -H+20*s, -W/2-4*s, -H+30*s+a); arm(W/2, -H+20*s, W/2+4*s, -H+30*s+b);
  } else if (pose === 'carry') {
    arm(-W/2, -H+20*s, -6*s, -H+28*s); arm(W/2, -H+20*s, 6*s, -H+28*s);
    ctx.fillStyle = C.paper; ctx.fillRect(x-7*s, cy-H+24*s, 14*s, 10*s);
    ctx.strokeStyle = 'rgba(120,105,85,.8)'; ctx.lineWidth = 1;
    ctx.strokeRect(x-7*s, cy-H+24*s, 14*s, 10*s);
  } else if (pose === 'wait') {                       // 팔짱 — 대기
    arm(-W/2, -H+21*s, 5*s, -H+26*s); arm(W/2, -H+23*s, -5*s, -H+28*s);
  } else if (pose === 'reject') {                     // 반려 — 한 팔 들기
    arm(-W/2, -H+20*s, -W/2-4*s, -H+30*s);
    arm(W/2, -H+20*s, W/2+7*s, -H+12*s);
  } else {
    const w2 = walk ? Math.sin(tt*9)*4*s : Math.sin(tt*2)*1*s;
    arm(-W/2, -H+20*s, -W/2-3*s, -H+32*s-w2); arm(W/2, -H+20*s, W/2+3*s, -H+32*s+w2);
  }

  // 머리
  ctx.fillStyle = '#f0d9c0'; ctx.beginPath(); ctx.arc(x, cy-H+4*s, 7.5*s, 0, 7); ctx.fill();
  ctx.fillStyle = shade(color,-60); ctx.beginPath(); ctx.arc(x, cy-H+2.5*s, 7.5*s, Math.PI, 0); ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.beginPath(); ctx.arc(x-2.6*s, cy-H+5*s, 1.1*s, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x+2.6*s, cy-H+5*s, 1.1*s, 0, 7); ctx.fill();
  if (pose === 'reject') {                            // 반려 시 느낌표
    ctx.fillStyle = C.red; ctx.font = `700 ${13*s}px ${FONT}`; ctx.textAlign='center';
    ctx.fillText('!', x+13*s, cy-H+2*s);
  }
  ctx.restore();
}

// ── 명찰 (역할) — 이미지로 바꿔도 이 부분은 코드로 남긴다 ──────
export function drawBadge(ctx, { x, y, text, color, s = 1 }) {
  ctx.font = `700 ${11*s}px ${FONT}`; ctx.textAlign='center';
  const w = ctx.measureText(text).width + 18*s, h = 18*s, bx = x-w/2, by = y - 70*s;
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 10*s;
  ctx.fillStyle = color; roundRect(ctx, bx, by, w, h, 9*s); ctx.fill(); ctx.restore();
  ctx.fillStyle = 'rgba(6,19,29,.92)'; ctx.fillText(text, x, by + 12.5*s);
  ctx.beginPath(); ctx.moveTo(x-4*s, by+h); ctx.lineTo(x+4*s, by+h);
  ctx.lineTo(x, by+h+5*s); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}

// ── 이름표 ───────────────────────────────────────────────────
// 머리 위에 단다. 발밑에 두면 사람 앞의 책상을 덮어 버린다.
export function drawNamePlate(ctx, { x, y, text, color, s = 1 }) {
  ctx.font = `700 ${11*s}px ${FONT}`; ctx.textAlign = 'left';
  const w = ctx.measureText(text).width + 24*s, h = 17*s, px = x - w/2, py = y - 70*s;
  ctx.fillStyle = 'rgba(8,18,30,.92)'; roundRect(ctx, px, py, w, h, h/2); ctx.fill();
  ctx.strokeStyle = 'rgba(42,111,135,.7)'; ctx.lineWidth = 1; ctx.stroke();
  // ● 색 불릿 — 왼쪽 명단과 같은 모양이라 누가 누구인지 바로 이어진다
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(px + 9*s, py + h/2, 3.4*s, 0, 7); ctx.fill();
  ctx.fillStyle = '#e8f6ff'; ctx.fillText(text, px + 16*s, py + 12*s);
}


// ── 말풍선 ───────────────────────────────────────────────────
export function drawBubble(ctx, { x, y, text, s = 1, tone = 'paper' }) {
  if (!text) return;
  ctx.font = `${11*s}px ${FONT}`; ctx.textAlign='center';
  const w = ctx.measureText(text).width + 18*s, h = 20*s, bx = x-w/2, by = y - 97*s;
  ctx.fillStyle = tone === 'warn' ? 'rgba(255,183,3,.96)' : 'rgba(244,233,216,.98)';
  roundRect(ctx, bx, by, w, h, 9*s); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x-4*s, by+h); ctx.lineTo(x+4*s, by+h);
  ctx.lineTo(x, by+h+5*s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.ink; ctx.fillText(text, x, by + 14*s);
}

// ── 아이소메트릭 기본기 ──────────────────────────────────────
// 바닥 격자 위에 놓이는 물건은 전부 이 두 함수로 그린다.
// 캐릭터만 예외 — 사람은 빌보드로 두어 언제나 카메라를 본다.

// 격자 오프셋 → 화면 오프셋. 높이(dy)는 아이소메트릭에서 언제나 화면상 수직이다.
const g2s = (x, y, dgx, dgy, dy, s) =>
  [x + (dgx - dgy) * TILE.W / 2 * s,
   y + (dgx + dgy) * TILE.H / 2 * s - dy];

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

// 격자 칸 위에 세운 상자. 보이는 세로 면은 둘뿐이다 —
// +gx 면(화면 오른쪽 아래) · +gy 면(화면 왼쪽 아래). 나머지 둘은 뒤에 숨는다.
function isoBox(ctx, x, y, gw, gd, h, s, col) {
  const P = (dgx, dgy, dy = 0) => g2s(x, y, dgx, dgy, dy, s);
  const E = P(gw/2, -gd/2), S = P(gw/2, gd/2), W = P(-gw/2, gd/2);
  const Nt = P(-gw/2, -gd/2, h), Et = P(gw/2, -gd/2, h);
  const St = P(gw/2, gd/2, h), Wt = P(-gw/2, gd/2, h);
  poly(ctx, [S, W, Wt, St], col.left);
  poly(ctx, [E, S, St, Et], col.right, col.line);
  poly(ctx, [Nt, Et, St, Wt], col.top, col.line);
  return P;
}

// 집기 공통 색 — 서고 랙보다 한 톤 밝게 두어 서로 구분된다
const PROP = { left:'#101b28', right:'#18263a', top:'#22344a', line:C.holoDim };

// ── 집기 ─────────────────────────────────────────────────────
// kind: 'console' | 'table' | 'booth' | 'outbox'
// (x, y) 는 집기가 놓인 바닥 칸의 중심이다.
export function drawProp(ctx, { x, y, kind = 'console', s = 1, t = 0, state }) {
  // 램프 — 집기 위에 띄우는 신호등. 🟠 빈 절 있음 / 🟢 통과
  const 램프 = (P, h, dy = 15) => {
    if (!state) return;
    const [lx, ly] = P(0, 0, h + dy*s);
    ctx.fillStyle = state === 'gap' ? C.amber : C.green;
    ctx.beginPath(); ctx.arc(lx, ly, 4.5*s, 0, 7); ctx.fill();
    ctx.globalAlpha = .3;
    ctx.beginPath(); ctx.arc(lx, ly, 9*s, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  };

  if (kind === 'console') {                            // 기자·편집장 책상
    // 홀로그램 판은 걷어냈다 — 홀로그램으로도 안 보이고 이 이야기와도 상관이 없었다.
    // 지금은 상판에 서류 한 장만 올린 맨 책상이다.
    const gw = .92, gd = .78, h = 12*s;
    const P = isoBox(ctx, x, y, gw, gd, h, s, PROP);
    poly(ctx, [P(-.16, -.14, h), P(.16, -.14, h), P(.16, .14, h), P(-.16, .14, h)],
         'rgba(198,214,230,.22)');

  } else if (kind === 'table') {                        // 회의 탁자 — ④ 점검도 여기서 한다
    const gw = 2.3, gd = 1.7, h = 12*s;
    const P = isoBox(ctx, x, y, gw, gd, h, s, PROP);
    for (let i = 0; i < 5; i++) {                       // 상판에 놓인 절 원고 5장
      const gy = -gd/2 + .3 + i * ((gd - .6) / 4);
      poly(ctx, [P(-.2, gy, h), P(.2, gy, h), P(.2, gy + .16, h), P(-.2, gy + .16, h)],
           `rgba(198,214,230,${state ? .34 : .18})`);
    }
    램프(P, h, 26);                                     // 탁자가 넓으니 조금 더 높이

  } else if (kind === 'booth') {                        // 심사대
    const gw = .95, gd = .95, h = 12*s;
    const P = isoBox(ctx, x, y, gw, gd, h, s, PROP);
    램프(P, h);

  } else if (kind === 'outbox') {                       // 최계량 책상 = 심사대 + 발행함
    // 상판에 결재함 두 칸이 어긋나게 겹쳐 있다 — 아래 칸이 들어온 원고, 위 칸이 발행분.
    const gw = 1.15, gd = 1.0, h = 12*s;
    const P = isoBox(ctx, x, y, gw, gd, h, s, PROP);
    const 원고 = state === 'done';
    const 칸 = (dgx, dgy, dy, fill, line) =>
      poly(ctx, [P(dgx - .30, dgy - .26, dy), P(dgx + .30, dgy - .26, dy),
                 P(dgx + .30, dgy + .26, dy), P(dgx - .30, dgy + .26, dy)], fill, line);
    칸(-.13, .13, h + 2*s, '#16283a', C.holoDim);                       // 아래 칸
    칸(.13, -.13, h + 9*s, 원고 ? C.paper : '#1b3047', C.holoDim);      // 위 칸
    if (원고) {
      const [tx, ty] = P(.13, -.13, h + 10*s);
      ctx.fillStyle = C.red; ctx.textAlign = 'center';
      ctx.font = `700 ${8*s}px ${FONT}`;
      ctx.fillText('발행', tx, ty + 3*s);
    }
  }
}

// ── 날아가는 원고 ────────────────────────────────────────────
export function drawPaper(ctx, { x, y, rot = 0, s = 1, fake = false, memo = false }) {
  const k = memo ? 0.58 : 1;                    // 쪽지는 원고보다 작다 — 한 장짜리 지시서
  const w = 18 * s * k, h = 24 * s * k;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = C.paper; ctx.fillRect(-w/2, -h/2, w, h);
  if (fake) { ctx.strokeStyle = C.red; ctx.lineWidth = 2*s; ctx.strokeRect(-w/2, -h/2, w, h); }
  ctx.fillStyle = '#c9bba2';
  const 줄 = memo ? 3 : 4;
  for (let l = 0; l < 줄; l++) ctx.fillRect(-w/3, -h/3 + l*(h/6), w*2/3, 1.2*s);
  if (memo) {                                   // 접힌 자국 — 건네받는 쪽지처럼 보이게
    ctx.strokeStyle = 'rgba(120,105,85,.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-w/2, 0); ctx.lineTo(w/2, 0); ctx.stroke();
  }
  ctx.restore();
}

