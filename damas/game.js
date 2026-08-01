/* ============================================================================
   Damas Brasileiras — jogo, animação e interface
   ----------------------------------------------------------------------------
   Fluxo de uma jogada humana:
     clique/arraste na peça -> destinos legais -> escolha do pouso
     -> animação do salto -> (se a sequência continua, volta para a escolha)
     -> lance confirmado -> promoção -> vez do adversário

   O tabuleiro "verdadeiro" (S.board) só é alterado quando o lance termina.
   Durante a animação desenha-se anim.board; durante uma sequência de capturas
   em construção desenha-se S.stage.board.
   ========================================================================== */
(function () {
  'use strict';

  var R = window.Rules;
  var AI = window.AI;
  var RN = window.Render;
  var TAU = Math.PI * 2;

  /* ============================== som ==================================== */
  var Sound = (function () {
    var ctx = null, master = null, noise = null, enabled = true;

    function ensure() {
      if (ctx) return ctx;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      var len = Math.floor(ctx.sampleRate * 0.2);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      return ctx;
    }

    function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

    /* estalo de madeira: corpo senoidal curto + transiente de ruído filtrado */
    function clack(o) {
      if (!enabled) return;
      var c = ensure();
      if (!c) return;
      resume();
      o = o || {};
      var t0 = c.currentTime + 0.001;
      var vol = o.vol == null ? 0.6 : o.vol;
      var dur = o.dur || 0.075;
      var body = o.body || 190;

      var osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(body, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, body * 0.55), t0 + dur);
      var og = c.createGain();
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.linearRampToValueAtTime(vol * 0.85, t0 + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0007, t0 + dur * 1.7);
      osc.connect(og); og.connect(master);
      osc.start(t0); osc.stop(t0 + dur * 2);

      var src = c.createBufferSource();
      src.buffer = noise;
      var bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = o.tone || 2000;
      bp.Q.value = o.q || 1.1;
      var hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 260;
      var ng = c.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.linearRampToValueAtTime(vol * 0.7, t0 + 0.002);
      ng.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
      src.connect(bp); bp.connect(hp); hp.connect(ng); ng.connect(master);
      src.start(t0); src.stop(t0 + dur + 0.05);
    }

    function tones(list, step, vol) {
      if (!enabled) return;
      var c = ensure();
      if (!c) return;
      resume();
      for (var i = 0; i < list.length; i++) {
        var t0 = c.currentTime + 0.01 + i * step;
        var osc = c.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = list[i];
        var g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0005, t0 + step * 2.4);
        osc.connect(g); g.connect(master);
        osc.start(t0); osc.stop(t0 + step * 2.6);
      }
    }

    return {
      setEnabled: function (v) { enabled = v; if (v) { ensure(); resume(); } },
      unlock: function () { if (enabled) { ensure(); resume(); } },
      lift: function () { clack({ vol: 0.16, body: 340, tone: 3400, dur: 0.028 }); },
      tap: function () { clack({ vol: 0.34, body: 235, tone: 2500, dur: 0.05 }); },
      place: function () { clack({ vol: 0.62, body: 175, tone: 1850, dur: 0.085 }); },
      capture: function () {
        clack({ vol: 0.5, body: 150, tone: 2700, q: 0.85, dur: 0.09 });
        setTimeout(function () { clack({ vol: 0.26, body: 115, tone: 1400, dur: 0.06 }); }, 60);
      },
      invalid: function () { clack({ vol: 0.28, body: 88, tone: 520, q: 2.2, dur: 0.12 }); },
      promote: function () { tones([523, 659, 784, 1047], 0.075, 0.26); },
      win: function () { tones([523, 659, 784, 1047, 1319], 0.1, 0.28); },
      lose: function () { tones([440, 392, 330, 247], 0.14, 0.24); },
      drawEnd: function () { tones([440, 415, 440], 0.15, 0.2); }
    };
  })();

  /* ============================ estado =================================== */
  var S = {
    board: R.initialBoard(),
    turn: R.WHITE,
    mode: 'ai',
    level: 'medio',
    humanSide: R.WHITE,
    flip: false,
    soundOn: true,
    showNumbers: false,

    legal: [],
    selected: -1,
    candidates: [],
    prefix: [],
    targets: [],
    stage: null,
    hover: -1,

    drag: null,
    anim: null,
    effects: [],
    shake: null,

    lastMove: null,
    hint: null,
    hintTimer: 0,

    history: [],
    plies: [],
    captured: { 1: [], 2: [] },

    idle: 0,
    positions: {},

    thinking: false,
    thinkHandle: null,
    over: null,
    engine: { depth: '—', nodes: '—', score: '—' }
  };

  /* ========================== geometria / cache ========================== */
  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');

  var G = { css: 520, frame: 27, cell: 58, radius: 23, dpr: 1 };
  var boardTex = null;
  var sprites = {};
  var shadowImg = null;

  function sprite(color, king) {
    var k = color + (king ? 'k' : 'm');
    if (!sprites[k]) sprites[k] = RN.createPieceSprite(color, king, G.radius, G.dpr);
    return sprites[k];
  }

  function getShadow() {
    if (!shadowImg) {
      var r = G.radius, s = Math.ceil(r * 3.2);
      var cv = document.createElement('canvas');
      cv.width = cv.height = Math.ceil(s * G.dpr);
      var c = cv.getContext('2d');
      c.scale(G.dpr, G.dpr);
      RN.drawShadow(c, s / 2, s / 2, r, 0, 0.5);
      shadowImg = { canvas: cv, size: s };
    }
    return shadowImg;
  }

  function layout() {
    var wrap = canvas.parentElement;
    var w = Math.max(220, Math.floor(wrap.clientWidth));
    if (!w) return false;

    G.css = w;
    G.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    G.frame = Math.max(16, Math.round(w * 0.052));
    G.cell = (w - 2 * G.frame) / 8;
    G.radius = G.cell * 0.40;

    canvas.width = Math.round(w * G.dpr);
    canvas.height = Math.round(w * G.dpr);
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);

    boardTex = RN.createBoardTexture({
      size: w, frame: G.frame, cell: G.cell, dpr: G.dpr, flip: S.flip
    });
    sprites = {};
    shadowImg = null;
    return true;
  }

  /* --------------------------- coordenadas ------------------------------- */
  function center(sq) {
    var r = R.rowOf(sq), c = R.colOf(sq);
    if (S.flip) { r = 7 - r; c = 7 - c; }
    return { x: G.frame + (c + 0.5) * G.cell, y: G.frame + (r + 0.5) * G.cell };
  }

  function squareTopLeft(sq) {
    var r = R.rowOf(sq), c = R.colOf(sq);
    if (S.flip) { r = 7 - r; c = 7 - c; }
    return { x: G.frame + c * G.cell, y: G.frame + r * G.cell };
  }

  function pointerSquare(ev) {
    var rect = canvas.getBoundingClientRect();
    var scale = G.css / rect.width;
    var x = (ev.clientX - rect.left) * scale;
    var y = (ev.clientY - rect.top) * scale;
    var c = Math.floor((x - G.frame) / G.cell);
    var r = Math.floor((y - G.frame) / G.cell);
    if (r < 0 || r > 7 || c < 0 || c > 7) return -1;
    if (S.flip) { r = 7 - r; c = 7 - c; }
    return r * 8 + c;
  }

  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    var scale = G.css / rect.width;
    return { x: (ev.clientX - rect.left) * scale, y: (ev.clientY - rect.top) * scale };
  }

  /* ============================= easing ================================== */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function outCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function inOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function outBack(t) { var c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  function outBounce(t) {
    var n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
    if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
    t -= 2.625 / d; return n * t * t + 0.984375;
  }

  /* =========================== animação ================================== */
  var LIFT_MS = 105, HOLD_MS = 80, DROP_MS = 150, PROMO_MS = 480;

  function hopDuration(hop) {
    var d = Math.max(
      Math.abs(R.rowOf(hop.to) - R.rowOf(hop.from)),
      Math.abs(R.colOf(hop.to) - R.colOf(hop.from))
    );
    return Math.min(520, 145 + d * 68);
  }

  function hopsOf(move, startIndex) {
    var hops = [];
    var prev = startIndex === 0 ? move.from : move.path[startIndex - 1];
    for (var i = startIndex; i < move.path.length; i++) {
      hops.push({
        from: prev,
        to: move.path[i],
        victim: i < move.captures.length ? move.captures[i] : -1
      });
      prev = move.path[i];
    }
    return hops;
  }

  /**
   * Anima a peça ao longo de uma lista de saltos.
   * @param {Int8Array} baseBoard tabuleiro visual no início da animação
   * @param {Array} hops [{from,to,victim}]
   * @param {boolean} promote anima a coroação no final
   * @param {function} onDone
   */
  function animateHops(baseBoard, hops, promote, onDone) {
    var board = R.cloneBoard(baseBoard);
    var piece = board[hops[0].from];
    board[hops[0].from] = R.EMPTY;

    S.anim = {
      board: board,
      piece: piece,
      hops: hops,
      i: 0,
      phase: 'lift',
      t: 0,
      promote: !!promote,
      popped: {},
      onDone: onDone
    };
    Sound.lift();
  }

  function popVictim(sq) {
    var a = S.anim;
    if (!a || a.popped[sq]) return;
    a.popped[sq] = true;
    var piece = a.board[sq];
    if (!piece) return;
    a.board[sq] = R.EMPTY;
    S.effects.push({ type: 'capture', sq: sq, piece: piece, t: 0, dur: 380 });
    Sound.capture();
  }

  function updateAnim(dt) {
    var a = S.anim;
    if (!a) return;
    a.t += dt;

    var hop = a.hops[a.i];

    if (a.phase === 'lift') {
      if (a.t >= LIFT_MS) { a.t = 0; a.phase = 'hop'; }

    } else if (a.phase === 'hop') {
      var dur = hopDuration(hop);
      if (hop.victim >= 0 && a.t >= dur * 0.5) popVictim(hop.victim);
      if (a.t >= dur) {
        a.t = 0;
        if (a.i < a.hops.length - 1) { a.phase = 'hold'; Sound.tap(); }
        else a.phase = 'drop';
      }

    } else if (a.phase === 'hold') {
      if (a.t >= HOLD_MS) { a.t = 0; a.i++; a.phase = 'hop'; }

    } else if (a.phase === 'drop') {
      if (a.t >= DROP_MS) {
        a.t = 0;
        Sound.place();
        if (a.promote) { a.phase = 'promote'; Sound.promote(); }
        else a.phase = 'done';
      }

    } else if (a.phase === 'promote') {
      if (a.t >= PROMO_MS) {
        a.phase = 'done';
        S.effects.push({ type: 'crown', sq: a.hops[a.hops.length - 1].to, t: 0, dur: 520 });
      }
    }

    if (a.phase === 'done') {
      var cb = a.onDone;
      S.anim = null;
      if (cb) cb();
    }
  }

  function updateEffects(dt) {
    for (var i = S.effects.length - 1; i >= 0; i--) {
      S.effects[i].t += dt;
      if (S.effects[i].t >= S.effects[i].dur) S.effects.splice(i, 1);
    }
    if (S.shake) {
      S.shake.t += dt;
      if (S.shake.t >= S.shake.dur) S.shake = null;
    }
    if (S.hint && S.hintTimer > 0) {
      S.hintTimer -= dt;
      if (S.hintTimer <= 0) S.hint = null;
    }
  }

  /* ============================ desenho ================================== */
  function visualBoard() {
    if (S.anim) return S.anim.board;
    if (S.stage) return S.stage.board;
    return S.board;
  }

  function paintPiece(x, y, piece, o) {
    o = o || {};
    var lift = o.lift || 0;
    var scale = o.scale == null ? 1 : o.scale;
    var alpha = o.alpha == null ? 1 : o.alpha;
    var r = G.radius;

    /* sombra */
    var sh = getShadow();
    var ss = sh.size * scale * (1 + lift * 0.22);
    ctx.save();
    ctx.globalAlpha = alpha * clamp(1 - lift * 0.25, 0.25, 1);
    ctx.drawImage(sh.canvas,
      x - ss / 2 + lift * r * 0.5,
      y - ss / 2 + lift * r * 0.34,
      ss, ss);
    ctx.restore();

    /* corpo */
    var color = R.colorOf(piece) === R.WHITE ? 'white' : 'black';
    var sp = sprite(color, R.isKing(piece));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y - lift * r * 0.9);
    if (o.rot) ctx.rotate(o.rot);
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.drawImage(sp.canvas, -sp.ax, -sp.ay, sp.w, sp.h);
    ctx.restore();
  }

  function fillSquare(sq, style) {
    var p = squareTopLeft(sq);
    ctx.fillStyle = style;
    ctx.fillRect(p.x, p.y, G.cell, G.cell);
  }

  function drawHighlights(now) {
    var pulse = 0.5 + 0.5 * Math.sin(now / 430);

    /* último lance */
    if (S.lastMove && !S.anim) {
      fillSquare(S.lastMove.from, 'rgba(224,178,98,0.13)');
      fillSquare(S.lastMove.to, 'rgba(224,178,98,0.20)');
      var p = squareTopLeft(S.lastMove.to);
      ctx.strokeStyle = 'rgba(240,205,140,0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x + 0.75, p.y + 0.75, G.cell - 1.5, G.cell - 1.5);
    }

    /* peças obrigadas a capturar */
    if (!S.anim && !S.over && R.hasCaptures(S.legal) && S.selected < 0 && canAct()) {
      ctx.save();
      ctx.setLineDash([G.cell * 0.10, G.cell * 0.075]);
      ctx.lineDashOffset = -now / 26;
      ctx.strokeStyle = 'rgba(226,182,104,' + (0.30 + 0.22 * pulse).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.4, G.cell * 0.028);
      var seen = {};
      for (var i = 0; i < S.legal.length; i++) {
        var f = S.legal[i].from;
        if (seen[f]) continue;
        seen[f] = true;
        var c = center(f);
        ctx.beginPath();
        ctx.arc(c.x, c.y, G.radius * 1.16, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* origem da jogada em construção */
    if (S.selected >= 0) {
      fillSquare(S.selected, 'rgba(240,208,140,0.22)');
      for (var k = 0; k < S.prefix.length; k++) {
        fillSquare(S.prefix[k], 'rgba(240,208,140,0.14)');
      }
      var cs = squareTopLeft(currentSquare());
      ctx.strokeStyle = 'rgba(248,224,170,' + (0.55 + 0.35 * pulse).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.6, G.cell * 0.035);
      var m = G.cell * 0.16;
      var e = G.cell * 0.30;
      /* cantos */
      var corners = [[0, 0, 1, 1], [1, 0, -1, 1], [0, 1, 1, -1], [1, 1, -1, -1]];
      for (var q = 0; q < 4; q++) {
        var ox = cs.x + corners[q][0] * G.cell + (corners[q][2] > 0 ? m : -m);
        var oy = cs.y + corners[q][1] * G.cell + (corners[q][3] > 0 ? m : -m);
        ctx.beginPath();
        ctx.moveTo(ox + corners[q][2] * e, oy);
        ctx.lineTo(ox, oy);
        ctx.lineTo(ox, oy + corners[q][3] * e);
        ctx.stroke();
      }
    }

    /* destinos possíveis */
    for (var t = 0; t < S.targets.length; t++) {
      var tg = S.targets[t];
      var pc = center(tg.sq);
      var hovered = S.hover === tg.sq;
      var grow = hovered ? 1.32 : 1;

      if (tg.capture) {
        ctx.save();
        ctx.strokeStyle = hovered ? 'rgba(232,124,92,0.95)' : 'rgba(214,104,78,0.72)';
        ctx.lineWidth = Math.max(2, G.cell * 0.05) * (hovered ? 1.2 : 1);
        ctx.beginPath();
        ctx.arc(pc.x, pc.y, G.radius * 0.82 * grow, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = hovered ? 'rgba(232,124,92,0.30)' : 'rgba(214,104,78,0.16)';
        ctx.beginPath();
        ctx.arc(pc.x, pc.y, G.cell * 0.11 * grow, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.save();
        var g = ctx.createRadialGradient(pc.x, pc.y, 0, pc.x, pc.y, G.cell * 0.19 * grow);
        g.addColorStop(0, hovered ? 'rgba(255,244,220,0.95)' : 'rgba(248,232,200,0.72)');
        g.addColorStop(0.62, hovered ? 'rgba(248,224,180,0.55)' : 'rgba(240,216,175,0.32)');
        g.addColorStop(1, 'rgba(240,216,175,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pc.x, pc.y, G.cell * 0.19 * grow, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    /* peça que será capturada pelo destino sob o cursor */
    if (S.hover >= 0) {
      for (var v = 0; v < S.targets.length; v++) {
        if (S.targets[v].sq === S.hover && S.targets[v].victim >= 0) {
          markVictim(S.targets[v].victim, pulse);
        }
      }
    }
  }

  function markVictim(sq, pulse) {
    var c = center(sq);
    ctx.save();
    ctx.strokeStyle = 'rgba(236,116,84,' + (0.75 + 0.2 * pulse).toFixed(3) + ')';
    ctx.lineWidth = Math.max(2, G.cell * 0.045);
    ctx.beginPath();
    ctx.arc(c.x, c.y, G.radius * 1.06, 0, TAU);
    ctx.stroke();
    var d = G.radius * 0.5;
    ctx.beginPath();
    ctx.moveTo(c.x - d, c.y - d); ctx.lineTo(c.x + d, c.y + d);
    ctx.moveTo(c.x + d, c.y - d); ctx.lineTo(c.x - d, c.y + d);
    ctx.stroke();
    ctx.restore();
  }

  function drawNumbers() {
    var fs = Math.max(8, G.cell * 0.19);
    ctx.save();
    ctx.font = '600 ' + fs.toFixed(1) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (var i = 0; i < 32; i++) {
      var sq = R.NUM_SQ[i];
      var p = squareTopLeft(sq);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText(String(i + 1), p.x + G.cell * 0.09, p.y + G.cell * 0.07 + 1);
      ctx.fillStyle = 'rgba(255,226,182,0.42)';
      ctx.fillText(String(i + 1), p.x + G.cell * 0.09, p.y + G.cell * 0.07);
    }
    ctx.restore();
  }

  function drawPieces() {
    var b = visualBoard();
    var skip = S.drag && S.drag.active ? S.drag.sq : -1;
    for (var i = 0; i < 32; i++) {
      var sq = R.NUM_SQ[i];
      var p = b[sq];
      if (!p || sq === skip) continue;
      var c = center(sq);
      var dx = 0, dy = 0;
      if (S.shake && S.shake.sq === sq) {
        var k = 1 - S.shake.t / S.shake.dur;
        dx = Math.sin(S.shake.t / 28) * G.cell * 0.055 * k;
      }
      var isSel = sq === currentSquare() && S.selected >= 0 && !S.anim;
      paintPiece(c.x + dx, c.y + dy, p, {
        lift: isSel ? 0.35 : 0,
        scale: isSel ? 1.035 : 1
      });
    }
  }

  function drawEffects() {
    for (var i = 0; i < S.effects.length; i++) {
      var e = S.effects[i];
      var k = clamp(e.t / e.dur, 0, 1);
      var c = center(e.sq);

      if (e.type === 'capture') {
        var ke = outCubic(k);
        paintPiece(c.x, c.y - G.cell * 0.22 * ke, e.piece, {
          scale: 1 - 0.62 * ke,
          alpha: 1 - k,
          rot: ke * 0.5
        });
        ctx.save();
        ctx.strokeStyle = 'rgba(236,116,84,' + ((1 - k) * 0.5).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1.2, G.cell * 0.03) * (1 - k);
        ctx.beginPath();
        ctx.arc(c.x, c.y, G.radius * (0.7 + ke * 0.9), 0, TAU);
        ctx.stroke();
        ctx.restore();

      } else if (e.type === 'crown') {
        ctx.save();
        var rr = G.radius * (0.8 + outCubic(k) * 1.5);
        var g = ctx.createRadialGradient(c.x, c.y, rr * 0.55, c.x, c.y, rr);
        g.addColorStop(0, 'rgba(255,225,150,0)');
        g.addColorStop(0.7, 'rgba(255,222,142,' + ((1 - k) * 0.5).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,222,142,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rr, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,232,170,' + ((1 - k) * 0.75).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1.5, G.cell * 0.035) * (1 - k * 0.7);
        ctx.beginPath();
        ctx.arc(c.x, c.y, rr * 0.92, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawAnim() {
    var a = S.anim;
    if (!a) return;

    var pos, lift = 1, scale = 1.045;
    var hop = a.hops[a.i];

    if (a.phase === 'lift') {
      var kl = outCubic(clamp(a.t / LIFT_MS, 0, 1));
      pos = center(hop.from);
      lift = kl;
      scale = 1 + 0.045 * kl;

    } else if (a.phase === 'hop') {
      var dur = hopDuration(hop);
      var k = clamp(a.t / dur, 0, 1);
      var e = inOutCubic(k);
      var p0 = center(hop.from), p1 = center(hop.to);
      pos = { x: p0.x + (p1.x - p0.x) * e, y: p0.y + (p1.y - p0.y) * e };
      var arc = Math.sin(Math.PI * k) * (hop.victim >= 0 ? 0.85 : 0.4);
      lift = 1 + arc;
      scale = 1.045 + 0.05 * arc;

    } else if (a.phase === 'hold') {
      pos = center(hop.to);

    } else if (a.phase === 'drop') {
      var kd = clamp(a.t / DROP_MS, 0, 1);
      pos = center(a.hops[a.hops.length - 1].to);
      lift = 1 - outBack(kd);
      if (lift < 0) lift = 0;
      scale = 1 + 0.045 * (1 - kd) - 0.05 * Math.sin(Math.PI * kd);

    } else {
      pos = center(a.hops[a.hops.length - 1].to);
      lift = 0;
      scale = 1;
    }

    paintPiece(pos.x, pos.y, a.piece, { lift: lift, scale: scale });

    /* coroação: o segundo disco desce e se encaixa */
    if (a.phase === 'promote') {
      var kp = clamp(a.t / PROMO_MS, 0, 1);
      var fall = 1 - outBounce(clamp(kp * 1.15, 0, 1));
      var color = R.colorOf(a.piece) === R.WHITE ? 'white' : 'black';
      var sp = sprite(color, false);
      var stack = Math.max(3, G.radius * 0.30) * 0.80;
      var y = pos.y - stack - fall * G.cell * 1.7;
      ctx.save();
      ctx.globalAlpha = clamp(kp * 4, 0, 1);
      ctx.drawImage(sp.canvas, pos.x - sp.ax, y - sp.ay, sp.w, sp.h);
      ctx.restore();
    }
  }

  function drawDrag() {
    if (!S.drag || !S.drag.active) return;
    var piece = visualBoard()[S.drag.sq];
    if (!piece) return;
    paintPiece(S.drag.x, S.drag.y, piece, { lift: 1.15, scale: 1.10 });
  }

  function drawHint(now) {
    if (!S.hint) return;
    var pulse = 0.5 + 0.5 * Math.sin(now / 260);
    var a = center(S.hint.from);
    var b = center(S.hint.to);

    ctx.save();
    ctx.strokeStyle = 'rgba(120,200,235,' + (0.55 + 0.3 * pulse).toFixed(3) + ')';
    ctx.lineWidth = Math.max(2, G.cell * 0.05);
    ctx.beginPath();
    ctx.arc(a.x, a.y, G.radius * 1.16, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, G.radius * 0.8, 0, TAU);
    ctx.stroke();

    /* seta curva */
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var nx = -(b.y - a.y), ny = (b.x - a.x);
    var nl = Math.hypot(nx, ny) || 1;
    var bow = G.cell * 0.42;
    var cx2 = mx + (nx / nl) * bow, cy2 = my + (ny / nl) * bow;
    var ang = Math.atan2(b.y - cy2, b.x - cx2);
    var tipX = b.x - Math.cos(ang) * G.radius * 0.85;
    var tipY = b.y - Math.sin(ang) * G.radius * 0.85;

    ctx.strokeStyle = 'rgba(140,214,244,' + (0.6 + 0.3 * pulse).toFixed(3) + ')';
    ctx.lineWidth = Math.max(2.5, G.cell * 0.055);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x + Math.cos(Math.atan2(cy2 - a.y, cx2 - a.x)) * G.radius * 1.2,
      a.y + Math.sin(Math.atan2(cy2 - a.y, cx2 - a.x)) * G.radius * 1.2);
    ctx.quadraticCurveTo(cx2, cy2, tipX, tipY);
    ctx.stroke();

    var hs = G.cell * 0.17;
    ctx.fillStyle = 'rgba(150,220,248,' + (0.7 + 0.25 * pulse).toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(tipX + Math.cos(ang) * hs, tipY + Math.sin(ang) * hs);
    ctx.lineTo(tipX + Math.cos(ang + 2.5) * hs, tipY + Math.sin(ang + 2.5) * hs);
    ctx.lineTo(tipX + Math.cos(ang - 2.5) * hs, tipY + Math.sin(ang - 2.5) * hs);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  var lastTs = 0;

  function frame(ts) {
    var dt = lastTs ? Math.min(60, ts - lastTs) : 16;
    lastTs = ts;

    updateAnim(dt);
    updateEffects(dt);

    ctx.clearRect(0, 0, G.css, G.css);
    if (boardTex) ctx.drawImage(boardTex, 0, 0, G.css, G.css);
    drawHighlights(ts);
    if (S.showNumbers) drawNumbers();
    drawPieces();
    drawEffects();
    drawAnim();
    drawDrag();
    drawHint(ts);

    requestAnimationFrame(frame);
  }

  /* ========================== lógica da jogada =========================== */
  function currentSquare() {
    if (S.prefix.length) return S.prefix[S.prefix.length - 1];
    return S.selected;
  }

  function canAct() {
    if (S.over || S.anim || S.thinking) return false;
    if (S.mode === 'ai' && S.turn !== S.humanSide) return false;
    return true;
  }

  function refreshLegal() {
    S.legal = R.generateMoves(S.board, S.turn);
  }

  function movesFrom(sq) {
    var out = [];
    for (var i = 0; i < S.legal.length; i++) if (S.legal[i].from === sq) out.push(S.legal[i]);
    return out;
  }

  function clearSelection() {
    S.selected = -1;
    S.candidates = [];
    S.prefix = [];
    S.targets = [];
    S.stage = null;
    S.hover = -1;
    S.drag = null;
  }

  function selectPiece(sq) {
    S.selected = sq;
    S.candidates = movesFrom(sq);
    S.prefix = [];
    S.stage = null;
    computeTargets();
    Sound.lift();
  }

  function computeTargets() {
    S.targets = [];
    if (S.selected < 0) return;
    var cands = R.movesWithPrefix(S.candidates, S.prefix);
    var idx = S.prefix.length;
    var seen = {};
    for (var i = 0; i < cands.length; i++) {
      var m = cands[i];
      if (idx >= m.path.length) continue;
      var sq = m.path[idx];
      if (seen[sq]) continue;
      seen[sq] = true;
      S.targets.push({
        sq: sq,
        capture: m.captures.length > 0,
        victim: idx < m.captures.length ? m.captures[idx] : -1,
        last: idx === m.path.length - 1
      });
    }
  }

  function targetAt(sq) {
    for (var i = 0; i < S.targets.length; i++) if (S.targets[i].sq === sq) return S.targets[i];
    return null;
  }

  /** O jogador escolheu a próxima casa de pouso. */
  function chooseTarget(sq) {
    var prefix = S.prefix.concat([sq]);
    var cands = R.movesWithPrefix(S.candidates, prefix);
    if (!cands.length) return;

    var move = cands[0];
    var startIndex = S.prefix.length;
    var base = visualBoard();

    if (prefix.length === move.path.length) {
      /* lance completo */
      var hops = hopsOf(move, startIndex);
      S.targets = [];
      S.drag = null;
      pushHistory();
      animateHops(base, hops, move.promote, function () { commit(move); });
      return;
    }

    /* sequência continua: anima só este salto e espera a próxima escolha */
    var hop = hopsOf(move, startIndex)[0];
    S.targets = [];
    S.drag = null;
    animateHops(base, [hop], false, function () {
      var nb = R.cloneBoard(base);
      var piece = nb[hop.from];
      nb[hop.from] = R.EMPTY;
      if (hop.victim >= 0) nb[hop.victim] = R.EMPTY;
      nb[hop.to] = piece;
      S.stage = { board: nb, at: hop.to };
      S.prefix = prefix;
      computeTargets();
      updateUI();
    });
  }

  function pushHistory() {
    S.history.push({
      board: R.cloneBoard(S.board),
      turn: S.turn,
      idle: S.idle,
      positions: Object.assign({}, S.positions),
      plies: S.plies.slice(),
      captured: { 1: S.captured[1].slice(), 2: S.captured[2].slice() },
      lastMove: S.lastMove,
      engine: S.engine
    });
    if (S.history.length > 240) S.history.shift();
  }

  function restoreHistory(h) {
    S.board = h.board;
    S.turn = h.turn;
    S.idle = h.idle;
    S.positions = h.positions;
    S.plies = h.plies;
    S.captured = h.captured;
    S.lastMove = h.lastMove;
    S.engine = h.engine;
  }

  function commit(move) {
    var wasMan = R.isMan(S.board[move.from]);

    for (var i = 0; i < move.captures.length; i++) {
      S.captured[S.turn].push(S.board[move.captures[i]]);
    }

    R.applyMove(S.board, move);
    S.lastMove = move;
    S.plies.push({
      side: S.turn,
      notation: R.moveNotation(move),
      caps: move.captures.length,
      promote: move.promote
    });
    S.idle = (move.captures.length > 0 || wasMan) ? 0 : S.idle + 1;
    S.turn = R.opponent(S.turn);

    var key = R.positionKey(S.board, S.turn);
    S.positions[key] = (S.positions[key] || 0) + 1;

    clearSelection();
    S.hint = null;
    refreshLegal();
    checkOver();
    updateUI();

    if (!S.over) scheduleAI();
  }

  function checkOver() {
    var key = R.positionKey(S.board, S.turn);
    var res = R.gameResult(S.board, S.turn, S.idle, S.positions[key] || 1);
    if (!res) return;
    S.over = res;
    showBanner(res);
    if (res.winner === 0) Sound.drawEnd();
    else if (S.mode === '2p') Sound.win();
    else if (res.winner === S.humanSide) Sound.win();
    else Sound.lose();
  }

  function scheduleAI() {
    if (S.mode !== 'ai' || S.over) return;
    if (S.turn === S.humanSide) return;

    S.thinking = true;
    updateUI();

    S.thinkHandle = AI.think(S.board, S.turn, S.level, function (move, info) {
      S.thinking = false;
      S.thinkHandle = null;
      if (!move) { refreshLegal(); checkOver(); updateUI(); return; }

      S.engine = {
        depth: info.forced ? 'lance único' : (info.random ? 'intuição' : String(info.depth)),
        nodes: info.nodes ? info.nodes.toLocaleString('pt-BR') : '—',
        score: info.random || info.forced ? '—' : fmtScore(info.score)
      };

      pushHistory();
      animateHops(S.board, hopsOf(move, 0), move.promote, function () { commit(move); });
      updateUI();
    });
  }

  function fmtScore(score) {
    if (Math.abs(score) > AI.MATE - 500) {
      return score > 0 ? 'vitória forçada' : 'derrota forçada';
    }
    var v = score / 100;
    return (v > 0 ? '+' : '') + v.toFixed(2);
  }

  /* ============================ interação ================================ */
  function onPointerDown(ev) {
    Sound.unlock();
    if (ev.button === 2) return;
    if (!canAct()) return;

    var sq = pointerSquare(ev);
    if (sq < 0) return;

    /* clicou num destino válido */
    if (S.selected >= 0 && targetAt(sq)) {
      chooseTarget(sq);
      return;
    }

    var board = visualBoard();
    var piece = board[sq];

    /* durante uma sequência de capturas só os destinos valem */
    if (S.prefix.length) {
      if (sq === currentSquare()) return;
      Sound.invalid();
      S.shake = { sq: currentSquare(), t: 0, dur: 260 };
      return;
    }

    if (piece && R.colorOf(piece) === S.turn) {
      if (sq === S.selected) { clearSelection(); return; }
      if (!movesFrom(sq).length) {
        Sound.invalid();
        S.shake = { sq: sq, t: 0, dur: 260 };
        flashStatus(R.hasCaptures(S.legal)
          ? 'Captura obrigatória: você precisa jogar com uma peça destacada.'
          : 'Essa peça não tem lance possível.');
        return;
      }
      selectPiece(sq);
      S.drag = { sq: sq, x: 0, y: 0, active: false, start: pointerPos(ev) };
      canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
      updateUI();
      return;
    }

    if (piece) { Sound.invalid(); S.shake = { sq: sq, t: 0, dur: 220 }; return; }
    clearSelection();
    updateUI();
  }

  function onPointerMove(ev) {
    var pos = pointerPos(ev);
    var sq = pointerSquare(ev);

    if (S.drag) {
      var d = Math.hypot(pos.x - S.drag.start.x, pos.y - S.drag.start.y);
      if (!S.drag.active && d > G.cell * 0.18) S.drag.active = true;
      if (S.drag.active) {
        S.drag.x = pos.x;
        S.drag.y = pos.y;
        canvas.classList.add('grabbing');
      }
    }

    var hov = -1;
    if (S.selected >= 0 && sq >= 0 && targetAt(sq)) hov = sq;
    S.hover = hov;

    if (!S.drag) {
      var b = visualBoard();
      var grab = canAct() && ((sq >= 0 && b[sq] && R.colorOf(b[sq]) === S.turn && movesFrom(sq).length) || hov >= 0);
      canvas.classList.toggle('can-grab', !!grab);
    }
  }

  function onPointerUp(ev) {
    canvas.classList.remove('grabbing');
    if (!S.drag) return;

    var wasActive = S.drag.active;
    var sq = pointerSquare(ev);
    S.drag = null;

    if (wasActive) {
      if (sq >= 0 && targetAt(sq)) chooseTarget(sq);
      else Sound.tap();
    }
    updateUI();
  }

  function onContextMenu(ev) {
    ev.preventDefault();
    if (S.selected >= 0) {
      clearSelection();
      updateUI();
    }
  }

  /* ============================== interface ============================== */
  var el = {
    status: document.getElementById('status'),
    statusText: document.getElementById('status-text'),
    cardTop: document.getElementById('card-top'),
    cardBottom: document.getElementById('card-bottom'),
    selMode: document.getElementById('sel-mode'),
    selLevel: document.getElementById('sel-level'),
    selSide: document.getElementById('sel-side'),
    fieldLevel: document.getElementById('field-level'),
    fieldSide: document.getElementById('field-side'),
    btnNew: document.getElementById('btn-new'),
    btnUndo: document.getElementById('btn-undo'),
    btnHint: document.getElementById('btn-hint'),
    btnFlip: document.getElementById('btn-flip'),
    btnSound: document.getElementById('btn-sound'),
    btnRules: document.getElementById('btn-rules'),
    chkNumbers: document.getElementById('chk-numbers'),
    engLevel: document.getElementById('eng-level'),
    engDepth: document.getElementById('eng-depth'),
    engNodes: document.getElementById('eng-nodes'),
    engScore: document.getElementById('eng-score'),
    moves: document.querySelector('#moves tbody'),
    movesEmpty: document.getElementById('moves-empty'),
    movesScroll: document.querySelector('.moves-scroll'),
    banner: document.getElementById('banner'),
    bannerTitle: document.querySelector('.banner-title'),
    bannerSub: document.querySelector('.banner-sub'),
    bannerAgain: document.getElementById('banner-again'),
    modal: document.getElementById('modal-rules')
  };

  var statusFlash = 0;

  function flashStatus(msg) {
    el.statusText.textContent = msg;
    el.status.classList.add('is-alert');
    statusFlash = Date.now() + 2600;
  }

  function sideName(side) { return side === R.WHITE ? 'Brancas' : 'Pretas'; }

  function updateUI() {
    /* --- cartões dos jogadores --- */
    var topSide = S.flip ? R.WHITE : R.BLACK;
    var bottomSide = S.flip ? R.BLACK : R.WHITE;

    fillCard(el.cardTop, topSide);
    fillCard(el.cardBottom, bottomSide);

    /* --- status --- */
    if (statusFlash > Date.now()) {
      // mantém a mensagem de alerta por alguns instantes
    } else {
      el.status.classList.remove('is-alert', 'is-good', 'is-thinking');
      el.statusText.innerHTML = statusMessage();
      if (S.thinking) el.status.classList.add('is-thinking');
      if (S.over) el.status.classList.add('is-good');
    }

    /* --- botões --- */
    var busy = !!S.anim || S.thinking;
    el.btnUndo.disabled = busy || !S.history.length;
    el.btnHint.disabled = busy || !!S.over || (S.mode === 'ai' && S.turn !== S.humanSide);
    el.fieldLevel.style.display = S.mode === 'ai' ? '' : 'none';
    el.fieldSide.style.display = S.mode === 'ai' ? '' : 'none';

    /* --- motor --- */
    el.engLevel.textContent = S.mode === 'ai' ? AI.LEVELS[S.level].label : '—';
    el.engDepth.textContent = S.thinking ? 'pensando…' : S.engine.depth;
    el.engNodes.textContent = S.engine.nodes;
    el.engScore.textContent = S.engine.score;

    renderMoves();
  }

  function fillCard(card, side) {
    var isHumanCard = S.mode === '2p' ? false : side === S.humanSide;
    var name = S.mode === '2p'
      ? 'Jogador ' + (side === R.WHITE ? '1' : '2')
      : (isHumanCard ? 'Você' : 'Computador · ' + AI.LEVELS[S.level].label);

    card.querySelector('.player-name').textContent = name;
    card.querySelector('.player-sub').textContent = sideName(side);

    var chip = card.querySelector('.player-chip');
    if (chip.dataset.side !== String(side)) {
      chip.dataset.side = String(side);
      RN.renderPieceTo(chip, side === R.WHITE ? 'white' : 'black', false);
    }

    /* peças capturadas por este jogador */
    var tray = card.querySelector('.tray');
    var list = S.captured[side];
    if (tray.dataset.n !== String(list.length)) {
      tray.dataset.n = String(list.length);
      tray.innerHTML = '';
      var sorted = list.slice().sort(function (a, b) { return b - a; });
      for (var i = 0; i < sorted.length; i++) {
        var cv = document.createElement('canvas');
        cv.width = cv.height = 19;
        tray.appendChild(cv);
        RN.renderPieceTo(cv, R.colorOf(sorted[i]) === R.WHITE ? 'white' : 'black', R.isKing(sorted[i]));
      }
    }

    var cnt = R.count(S.board);
    var mine = side === R.WHITE ? cnt.white : cnt.black;
    var theirs = side === R.WHITE ? cnt.black : cnt.white;
    var scoreEl = card.querySelector('.player-score');
    scoreEl.querySelector('.score-num').textContent = String(list.length);
    scoreEl.classList.toggle('ahead', mine > theirs);

    card.classList.toggle('is-turn', !S.over && S.turn === side);
    card.classList.toggle('is-thinking', S.thinking && S.turn === side);
  }

  function statusMessage() {
    if (S.over) {
      if (S.over.winner === 0) return '<b>Empate.</b> ' + reasonText(S.over.reason);
      var who = sideName(S.over.winner);
      if (S.mode === 'ai') {
        return S.over.winner === S.humanSide
          ? '<b>Você venceu!</b> ' + reasonText(S.over.reason)
          : '<b>O computador venceu.</b> ' + reasonText(S.over.reason);
      }
      return '<b>' + who + ' venceram.</b> ' + reasonText(S.over.reason);
    }

    if (S.thinking) return 'O computador está pensando…';

    if (S.prefix.length) return '<b>Continue capturando</b> — escolha a próxima casa de pouso.';

    var mustCapture = R.hasCaptures(S.legal);
    var maxCaps = mustCapture ? S.legal[0].captures.length : 0;

    if (S.mode === '2p' || S.turn === S.humanSide) {
      if (mustCapture) {
        return '<b>Vez das ' + sideName(S.turn).toLowerCase() + ':</b> captura obrigatória de ' +
          maxCaps + (maxCaps > 1 ? ' peças' : ' peça') + '.';
      }
      return '<b>Vez das ' + sideName(S.turn).toLowerCase() + '.</b> Clique ou arraste uma peça.';
    }
    return 'Vez do computador (' + sideName(S.turn).toLowerCase() + ').';
  }

  function reasonText(reason) {
    switch (reason) {
      case 'sem-pecas': return 'Todas as peças adversárias foram capturadas.';
      case 'sem-lances': return 'O adversário não tem lances possíveis.';
      case 'regra-20-lances': return '20 lances de damas sem captura.';
      case 'repeticao': return 'Posição repetida três vezes.';
      case 'final-empatado': return 'Final teoricamente empatado.';
      default: return '';
    }
  }

  function renderMoves() {
    var rows = [];
    for (var i = 0; i < S.plies.length; i++) {
      var p = S.plies[i];
      if (p.side === R.WHITE) rows.push({ w: p, b: null });
      else if (rows.length && !rows[rows.length - 1].b) rows[rows.length - 1].b = p;
      else rows.push({ w: null, b: p });
    }

    if (el.moves.dataset.n === String(S.plies.length)) return;
    el.moves.dataset.n = String(S.plies.length);

    el.movesEmpty.hidden = rows.length > 0;
    var html = '';
    for (var k = 0; k < rows.length; k++) {
      var last = k === rows.length - 1;
      html += '<tr' + (last ? ' class="last"' : '') + '>' +
        '<td class="n">' + (k + 1) + '</td>' +
        '<td class="w">' + plyHtml(rows[k].w) + '</td>' +
        '<td class="b">' + plyHtml(rows[k].b) + '</td></tr>';
    }
    el.moves.innerHTML = html;
    el.movesScroll.scrollTop = el.movesScroll.scrollHeight;
  }

  function plyHtml(p) {
    if (!p) return '';
    var s = p.caps ? '<span class="cap">' + p.notation + '</span>' : p.notation;
    if (p.promote) s += '<span class="promo" title="promoção a dama">D</span>';
    return s;
  }

  function showBanner(res) {
    var title, sub;
    if (res.winner === 0) {
      title = 'Empate';
      sub = reasonText(res.reason);
    } else if (S.mode === 'ai') {
      title = res.winner === S.humanSide ? 'Você venceu!' : 'O computador venceu';
      sub = res.winner === S.humanSide
        ? 'Nível ' + AI.LEVELS[S.level].label.toLowerCase() + ' derrotado. ' + reasonText(res.reason)
        : reasonText(res.reason) + ' Tente novamente.';
    } else {
      title = sideName(res.winner) + ' venceram';
      sub = reasonText(res.reason);
    }
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub;
    el.banner.hidden = false;
  }

  function hideBanner() { el.banner.hidden = true; }

  /* ============================== comandos =============================== */
  function newGame() {
    if (S.thinkHandle) { S.thinkHandle.cancel(); S.thinkHandle = null; }
    S.thinking = false;
    S.anim = null;
    S.effects = [];
    S.board = R.initialBoard();
    S.turn = R.WHITE;
    S.history = [];
    S.plies = [];
    S.captured = { 1: [], 2: [] };
    S.idle = 0;
    S.positions = {};
    S.lastMove = null;
    S.over = null;
    S.hint = null;
    S.engine = { depth: '—', nodes: '—', score: '—' };
    clearSelection();
    hideBanner();
    refreshLegal();

    var key = R.positionKey(S.board, S.turn);
    S.positions[key] = 1;

    el.moves.dataset.n = '-1';
    document.querySelectorAll('.tray').forEach(function (t) { t.dataset.n = '-1'; });
    updateUI();
    scheduleAI();
  }

  function undo() {
    if (S.anim || S.thinking) return;
    if (!S.history.length) return;
    restoreHistory(S.history.pop());
    if (S.mode === 'ai') {
      while (S.turn !== S.humanSide && S.history.length) restoreHistory(S.history.pop());
    }
    S.over = null;
    S.effects = [];
    S.hint = null;
    hideBanner();
    clearSelection();
    refreshLegal();
    el.moves.dataset.n = '-1';
    document.querySelectorAll('.tray').forEach(function (t) { t.dataset.n = '-1'; });
    updateUI();
    Sound.tap();
  }

  function askHint() {
    if (!canAct()) return;
    el.btnHint.disabled = true;
    AI.hint(S.board, S.turn, function (move) {
      if (move) {
        S.hint = move;
        S.hintTimer = 4200;
      }
      updateUI();
    });
  }

  function setFlip(v) {
    S.flip = v;
    layout();
    updateUI();
  }

  /* ============================== eventos ================================ */
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', onContextMenu);

  el.selMode.addEventListener('change', function () {
    S.mode = el.selMode.value;
    if (S.mode === '2p') S.flip = false;
    else S.flip = S.humanSide === R.BLACK;
    layout();
    newGame();
  });

  el.selLevel.addEventListener('change', function () {
    S.level = el.selLevel.value;
    updateUI();
  });

  el.selSide.addEventListener('change', function () {
    S.humanSide = parseInt(el.selSide.value, 10);
    S.flip = S.humanSide === R.BLACK;
    layout();
    newGame();
  });

  el.btnNew.addEventListener('click', newGame);
  el.bannerAgain.addEventListener('click', newGame);
  el.btnUndo.addEventListener('click', undo);
  el.btnHint.addEventListener('click', askHint);
  el.btnFlip.addEventListener('click', function () { setFlip(!S.flip); });

  el.btnSound.addEventListener('click', function () {
    S.soundOn = !S.soundOn;
    Sound.setEnabled(S.soundOn);
    el.btnSound.setAttribute('aria-pressed', String(S.soundOn));
    if (S.soundOn) Sound.tap();
  });

  el.chkNumbers.addEventListener('change', function () {
    S.showNumbers = el.chkNumbers.checked;
  });

  el.btnRules.addEventListener('click', function () { el.modal.hidden = false; });
  el.modal.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-close]')) el.modal.hidden = true;
  });

  window.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (!el.modal.hidden) { el.modal.hidden = true; return; }
      if (S.selected >= 0) { clearSelection(); updateUI(); }
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      undo();
      return;
    }
    if (ev.key.toLowerCase() === 'h' && !ev.ctrlKey && !ev.metaKey) askHint();
    if (ev.key.toLowerCase() === 'n' && !ev.ctrlKey && !ev.metaKey) newGame();
  });

  /* redimensionamento (a textura de madeira é cara: redesenha com atraso) */
  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (layout()) updateUI();
    }, 110);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(onResize).observe(canvas.parentElement);
  } else {
    window.addEventListener('resize', onResize);
  }

  /* mantém o status atualizado após as mensagens temporárias */
  setInterval(function () {
    if (statusFlash && Date.now() > statusFlash) {
      statusFlash = 0;
      updateUI();
    }
  }, 400);

  /* pequeno acesso para depuração no console do navegador */
  window.Damas = {
    state: S, geometry: G,
    newGame: newGame, undo: undo, hint: askHint,
    center: center, setBoard: function (b, turn) {
      S.board = R.cloneBoard(b);
      S.turn = turn || R.WHITE;
      S.history = []; S.plies = []; S.over = null;
      clearSelection(); hideBanner(); refreshLegal(); updateUI();
    }
  };

  /* ================================ início =============================== */
  layout();
  newGame();
  requestAnimationFrame(frame);
})();
