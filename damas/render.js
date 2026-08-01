/* ============================================================================
   Damas Brasileiras — renderização
   ----------------------------------------------------------------------------
   Todo o visual é gerado por procedimento (nenhuma imagem externa):

   - Tabuleiro: madeira com veios desenhados linha por linha, casas
     embutidas com bisel, moldura com veio próprio, filete de latão,
     coordenadas gravadas e iluminação vinda do canto superior esquerdo.
   - Peças: discos com espessura real (parede lateral construída por
     empilhamento de círculos), ranhuras na borda como nas peças de
     madeira torneada, bisel, veio concêntrico gravado e brilho especular.
     A dama é um segundo disco empilhado com coroa dourada em relevo.

   Tabuleiro e peças são pré-renderizados em canvas fora de tela e apenas
   compostos a cada quadro — o custo por frame é de alguns drawImage.
   ========================================================================== */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  /* ------------------------------- paletas ------------------------------- */
  var WOOD = {
    lightSquare: { base: '#e8c9a0', dark: '#b98f5f', light: '#f7e3c6' },
    darkSquare: { base: '#7c4a26', dark: '#4e2c13', light: '#a4693c' },
    frame: { base: '#48291a', dark: '#25130a', light: '#6d4227' }
  };

  var PIECE_PAL = {
    white: {
      face: '#efe0c4', faceHi: '#fffdf6', faceLo: '#c7ae87',
      sideTop: '#d8bf98', sideBottom: '#8d7450',
      groove: 'rgba(90,64,32,0.55)', grooveHi: 'rgba(255,250,235,0.65)',
      rim: 'rgba(74,50,24,0.45)', crown: ['#fff0bd', '#e8bf5c', '#9c6f16'],
      crownLine: 'rgba(70,44,6,0.85)'
    },
    black: {
      face: '#3b2c24', faceHi: '#6e5647', faceLo: '#180f0b',
      sideTop: '#2d211a', sideBottom: '#0d0806',
      groove: 'rgba(0,0,0,0.62)', grooveHi: 'rgba(190,158,128,0.35)',
      rim: 'rgba(0,0,0,0.6)', crown: ['#ffeab0', '#dfae44', '#8a5d0d'],
      crownLine: 'rgba(35,20,0,0.9)'
    }
  };

  /* ------------------------------ utilitários ---------------------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hex2rgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(hex, a) {
    var c = hex2rgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  function mix(hexA, hexB, t) {
    var a = hex2rgb(hexA), b = hex2rgb(hexB);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }

  function makeCanvas(w, h) {
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    return cv;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ------------------------------ veio de madeira ------------------------ */
  /**
   * Desenha madeira com veios dentro do retângulo dado.
   * @param {boolean} horizontal direção do veio
   */
  function woodGrain(ctx, x, y, w, h, pal, horizontal, rnd) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.fillStyle = pal.base;
    ctx.fillRect(x, y, w, h);

    var span = horizontal ? h : w;
    var len = horizontal ? w : h;
    var lines = Math.max(6, Math.round(span / 1.7));

    for (var i = 0; i < lines; i++) {
      var pos = (i + rnd() * 0.85) * (span / lines);
      var amp = 0.5 + rnd() * 2.4;
      var freq = 0.5 + rnd() * 1.7;
      var phase = rnd() * TAU;
      var alpha = 0.03 + rnd() * 0.11;
      var isDark = rnd() < 0.72;

      ctx.strokeStyle = isDark ? rgba(pal.dark, alpha) : rgba(pal.light, alpha * 0.85);
      ctx.lineWidth = 0.5 + rnd() * 1.5;
      ctx.beginPath();

      var steps = 16;
      for (var k = 0; k <= steps; k++) {
        var t = k / steps;
        var along = t * len;
        var off = Math.sin(t * TAU * freq + phase) * amp +
          Math.sin(t * TAU * freq * 3.1 + phase * 2) * amp * 0.28;
        var px = horizontal ? x + along : x + pos + off;
        var py = horizontal ? y + pos + off : y + along;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    /* poros e pequenos nós da madeira */
    var specks = Math.round(w * h / 30);
    for (var s = 0; s < specks; s++) {
      ctx.fillStyle = 'rgba(0,0,0,' + (0.012 + rnd() * 0.05).toFixed(3) + ')';
      ctx.fillRect(x + rnd() * w, y + rnd() * h, 0.8 + rnd() * 1.6, 0.8 + rnd() * 1.2);
    }
    for (var g = 0; g < 2; g++) {
      if (rnd() < 0.55) continue;
      var kx = x + rnd() * w, ky = y + rnd() * h, kr = 1.5 + rnd() * 3;
      var kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      kg.addColorStop(0, rgba(pal.dark, 0.35));
      kg.addColorStop(1, rgba(pal.dark, 0));
      ctx.fillStyle = kg;
      ctx.beginPath(); ctx.arc(kx, ky, kr, 0, TAU); ctx.fill();
    }

    ctx.restore();
  }

  /* ============================ TABULEIRO ================================ */
  /**
   * Gera a imagem do tabuleiro (moldura + 64 casas + coordenadas).
   * @param {object} o { size, frame, cell, dpr, flip, seed }
   * @returns {HTMLCanvasElement}
   */
  function createBoardTexture(o) {
    var size = o.size, frame = o.frame, cell = o.cell, dpr = o.dpr || 1;
    var flip = !!o.flip;
    var rnd = mulberry32(o.seed || 20260801);

    var cv = makeCanvas(size * dpr, size * dpr);
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    /* ---------- moldura ---------- */
    var radius = Math.max(4, size * 0.018);
    ctx.save();
    roundRect(ctx, 0, 0, size, size, radius);
    ctx.clip();

    /* madeira da moldura: veio horizontal em cima/baixo, vertical nas laterais */
    woodGrain(ctx, 0, 0, size, frame, WOOD.frame, true, rnd);
    woodGrain(ctx, 0, size - frame, size, frame, WOOD.frame, true, rnd);
    woodGrain(ctx, 0, frame, frame, size - 2 * frame, WOOD.frame, false, rnd);
    woodGrain(ctx, size - frame, frame, frame, size - 2 * frame, WOOD.frame, false, rnd);

    /* emendas em 45° nos cantos da moldura */
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    var corners = [[0, 0, frame, frame], [size, 0, size - frame, frame],
    [0, size, frame, size - frame], [size, size, size - frame, size - frame]];
    for (var i = 0; i < corners.length; i++) {
      ctx.beginPath();
      ctx.moveTo(corners[i][0], corners[i][1]);
      ctx.lineTo(corners[i][2], corners[i][3]);
      ctx.stroke();
    }

    /* verniz: luz vinda do canto superior esquerdo */
    var vg = ctx.createLinearGradient(0, 0, size, size);
    vg.addColorStop(0, 'rgba(255,235,200,0.16)');
    vg.addColorStop(0.45, 'rgba(255,255,255,0.02)');
    vg.addColorStop(1, 'rgba(0,0,0,0.20)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    /* bisel externo da moldura */
    ctx.save();
    roundRect(ctx, 0.75, 0.75, size - 1.5, size - 1.5, radius);
    ctx.strokeStyle = 'rgba(255,225,185,0.22)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    roundRect(ctx, 2.2, 2.2, size - 4.4, size - 4.4, radius);
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    /* ---------- casas ---------- */
    var play = cell * 8;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var x = frame + c * cell;
        var y = frame + r * cell;
        var dark = ((r + c) & 1) === 1;
        var pal = dark ? WOOD.darkSquare : WOOD.lightSquare;
        /* casas embutidas: veio alternado como em tabuleiros marchetados */
        woodGrain(ctx, x, y, cell, cell, pal, ((r + c) & 1) === 0, rnd);

        /* bisel da casa (luz em cima/esquerda, sombra embaixo/direita) */
        ctx.strokeStyle = 'rgba(255,240,215,0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + cell - 0.5);
        ctx.lineTo(x + 0.5, y + 0.5);
        ctx.lineTo(x + cell - 0.5, y + 0.5);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.20)';
        ctx.beginPath();
        ctx.moveTo(x + cell - 0.5, y + 0.5);
        ctx.lineTo(x + cell - 0.5, y + cell - 0.5);
        ctx.lineTo(x + 0.5, y + cell - 0.5);
        ctx.stroke();
      }
    }

    /* sombra interna projetada pela moldura sobre as casas */
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame, frame, play, play);
    ctx.clip();
    var inner = 10;
    var sg = ctx.createLinearGradient(frame, frame, frame, frame + inner);
    sg.addColorStop(0, 'rgba(0,0,0,0.38)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(frame, frame, play, inner);
    sg = ctx.createLinearGradient(frame, frame, frame + inner, frame);
    sg.addColorStop(0, 'rgba(0,0,0,0.34)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(frame, frame, inner, play);
    sg = ctx.createLinearGradient(frame, frame + play, frame, frame + play - inner);
    sg.addColorStop(0, 'rgba(0,0,0,0.16)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(frame, frame + play - inner, play, inner);
    sg = ctx.createLinearGradient(frame + play, frame, frame + play - inner, frame);
    sg.addColorStop(0, 'rgba(0,0,0,0.16)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(frame + play - inner, frame, inner, play);

    /* leve gradiente de iluminação geral sobre a área de jogo */
    var lg = ctx.createRadialGradient(frame + play * 0.28, frame + play * 0.22, play * 0.08,
      frame + play * 0.5, frame + play * 0.5, play * 0.85);
    lg.addColorStop(0, 'rgba(255,248,230,0.13)');
    lg.addColorStop(0.6, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.17)');
    ctx.fillStyle = lg;
    ctx.fillRect(frame, frame, play, play);
    ctx.restore();

    /* filete de latão entre a moldura e as casas */
    ctx.save();
    var bx = frame - 2.5, bw = play + 5;
    var bg = ctx.createLinearGradient(bx, bx, bx + bw, bx + bw);
    bg.addColorStop(0, '#f4dd9a');
    bg.addColorStop(0.5, '#b8912f');
    bg.addColorStop(1, '#6d4f12');
    ctx.strokeStyle = bg;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, bx, bw, bw);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(frame - 4.5, frame - 4.5, play + 9, play + 9);
    ctx.restore();

    /* ---------- coordenadas gravadas ---------- */
    var fs = Math.max(8, Math.min(frame * 0.46, cell * 0.26));
    ctx.font = '600 ' + fs.toFixed(1) + 'px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var k = 0; k < 8; k++) {
      var letter = String.fromCharCode(97 + (flip ? 7 - k : k));
      var number = String(flip ? k + 1 : 8 - k);
      var cxp = frame + (k + 0.5) * cell;
      var cyp = frame + (k + 0.5) * cell;

      engrave(ctx, letter, cxp, size - frame * 0.5);
      engrave(ctx, letter, cxp, frame * 0.5);
      engrave(ctx, number, frame * 0.5, cyp);
      engrave(ctx, number, size - frame * 0.5, cyp);
    }

    return cv;
  }

  function engrave(ctx, text, x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(text, x, y + 0.8);
    ctx.fillStyle = 'rgba(255,226,180,0.42)';
    ctx.fillText(text, x, y - 0.4);
  }

  /* ============================== PEÇAS ================================== */
  /** Parede lateral + topo de um disco. */
  function drawDisc(ctx, cx, cy, r, t, pal) {
    var steps = Math.max(7, Math.round(t));
    var i, k;

    /* parede lateral: círculos empilhados, o mais baixo primeiro */
    for (i = steps; i >= 1; i--) {
      k = i / steps;
      ctx.beginPath();
      ctx.arc(cx, cy + k * t, r, 0, TAU);
      ctx.fillStyle = mix(pal.sideBottom, pal.sideTop, 1 - k);
      ctx.fill();
    }

    /* contorno inferior */
    ctx.beginPath();
    ctx.arc(cx, cy + t, r, 0, Math.PI);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    ctx.stroke();

    /* ranhuras torneadas na borda */
    var n = 46;
    var lw = Math.max(0.7, r * 0.038);
    for (i = 0; i < n; i++) {
      var a = (i / n) * TAU;
      var sa = Math.sin(a);
      if (sa < 0.015) continue;
      var ex = cx + Math.cos(a) * r * 0.995;
      var ey = cy + sa * r * 0.995;
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(0,0,0,' + (0.06 + 0.22 * sa).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex, ey + t * 0.92);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,215,' + (0.03 + 0.10 * sa).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(ex + lw, ey);
      ctx.lineTo(ex + lw, ey + t * 0.9);
      ctx.stroke();
    }

    /* ---------- face superior ---------- */
    var g = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.38, r * 0.05, cx, cy, r * 1.12);
    g.addColorStop(0, pal.faceHi);
    g.addColorStop(0.52, pal.face);
    g.addColorStop(1, pal.faceLo);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    /* centro levemente rebaixado */
    var cg = ctx.createRadialGradient(cx - r * 0.18, cy - r * 0.20, r * 0.02, cx, cy, r * 0.62);
    cg.addColorStop(0, 'rgba(255,255,255,0.10)');
    cg.addColorStop(0.75, 'rgba(0,0,0,0.05)');
    cg.addColorStop(1, 'rgba(0,0,0,0.13)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, TAU);
    ctx.fillStyle = cg;
    ctx.fill();

    /* veios concêntricos gravados */
    var rings = [0.88, 0.80, 0.66];
    for (i = 0; i < rings.length; i++) {
      ctx.lineWidth = Math.max(0.7, r * 0.022);
      ctx.strokeStyle = pal.groove;
      ctx.beginPath();
      ctx.arc(cx, cy, r * rings[i], 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = pal.grooveHi;
      ctx.beginPath();
      ctx.arc(cx, cy - Math.max(0.7, r * 0.022), r * rings[i], Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }

    /* aro externo */
    ctx.lineWidth = Math.max(0.9, r * 0.045);
    ctx.strokeStyle = pal.rim;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.978, 0, TAU);
    ctx.stroke();
    /* luz batendo no aro superior esquerdo */
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    ctx.strokeStyle = 'rgba(255,248,232,0.42)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.972, Math.PI * 1.02, Math.PI * 1.72);
    ctx.stroke();

    /* brilho especular */
    ctx.save();
    ctx.translate(cx - r * 0.30, cy - r * 0.36);
    ctx.rotate(-0.5);
    ctx.scale(1, 0.62);
    var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.46);
    sg.addColorStop(0, 'rgba(255,255,255,0.34)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0.10)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.46, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** Coroa dourada em relevo (marca da dama). */
  function drawCrown(ctx, cx, cy, r, pal) {
    var s = r * 0.52;
    ctx.save();
    ctx.translate(cx, cy);

    function crownPath() {
      ctx.beginPath();
      ctx.moveTo(-s, s * 0.34);
      ctx.lineTo(-s, -s * 0.42);
      ctx.lineTo(-s * 0.46, s * 0.02);
      ctx.lineTo(0, -s * 0.60);
      ctx.lineTo(s * 0.46, s * 0.02);
      ctx.lineTo(s, -s * 0.42);
      ctx.lineTo(s, s * 0.34);
      ctx.closePath();
    }

    /* sombra em relevo */
    ctx.save();
    ctx.translate(s * 0.07, s * 0.10);
    crownPath();
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fill();
    ctx.restore();

    var g = ctx.createLinearGradient(0, -s * 0.7, 0, s * 0.6);
    g.addColorStop(0, pal.crown[0]);
    g.addColorStop(0.48, pal.crown[1]);
    g.addColorStop(1, pal.crown[2]);
    crownPath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(0.7, s * 0.09);
    ctx.strokeStyle = pal.crownLine;
    ctx.stroke();

    /* base da coroa */
    ctx.beginPath();
    ctx.rect(-s, s * 0.14, s * 2, s * 0.22);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s, s * 0.16);
    ctx.lineTo(s, s * 0.16);
    ctx.lineWidth = Math.max(0.6, s * 0.07);
    ctx.strokeStyle = 'rgba(255,246,205,0.55)';
    ctx.stroke();

    /* pérolas nas pontas */
    var tips = [[-s, -s * 0.42], [0, -s * 0.60], [s, -s * 0.42]];
    for (var i = 0; i < tips.length; i++) {
      var pr = s * 0.20;
      var pg = ctx.createRadialGradient(tips[i][0] - pr * 0.3, tips[i][1] - pr * 0.35, 0,
        tips[i][0], tips[i][1], pr);
      pg.addColorStop(0, '#fff8d8');
      pg.addColorStop(0.6, pal.crown[1]);
      pg.addColorStop(1, pal.crown[2]);
      ctx.beginPath();
      ctx.arc(tips[i][0], tips[i][1], pr, 0, TAU);
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.lineWidth = Math.max(0.5, s * 0.05);
      ctx.strokeStyle = pal.crownLine;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Sprite de uma peça.
   * @param {string} color 'white' | 'black'
   * @param {boolean} king
   * @param {number} radius raio em px CSS
   * @param {number} dpr
   * @returns {{canvas: HTMLCanvasElement, ax: number, ay: number, w: number, h: number}}
   *          ax/ay = ponto de apoio da peça (centro da base), em px CSS
   */
  function createPieceSprite(color, king, radius, dpr) {
    dpr = dpr || 1;
    var pal = PIECE_PAL[color];
    var r = radius;
    var t = Math.max(3, r * 0.30);          /* espessura do disco */
    var stack = king ? t * 0.80 : 0;        /* altura do segundo disco */
    var pad = Math.ceil(r * 0.16) + 2;

    var w = 2 * r + pad * 2;
    var h = 2 * r + pad * 2 + t + stack;
    var cx = pad + r;
    var yTop = pad + r + stack;             /* face superior do disco de baixo */

    var cv = makeCanvas(w * dpr, h * dpr);
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    drawDisc(ctx, cx, yTop, r, t, pal);
    if (king) {
      drawDisc(ctx, cx, yTop - stack, r * 0.995, t, pal);
      drawCrown(ctx, cx, yTop - stack, r, pal);
    }

    return {
      canvas: cv, w: w, h: h,
      ax: cx,
      ay: yTop + t * 0.86                   /* base da peça */
    };
  }

  /** Sombra projetada da peça no tabuleiro. */
  function drawShadow(ctx, x, y, r, lift, alpha) {
    var spread = 1.06 + lift * 0.5;
    var a = (alpha != null ? alpha : 0.42) * (1 - lift * 0.28);
    ctx.save();
    ctx.translate(x + lift * r * 0.45, y + r * 0.10 + lift * r * 0.30);
    ctx.scale(1, 0.46);
    var g = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r * spread);
    g.addColorStop(0, 'rgba(0,0,0,' + a.toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(0,0,0,' + (a * 0.5).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * spread, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** Peça avulsa (usada nas bandejas de capturadas, fora do canvas do jogo). */
  function renderPieceTo(canvas, color, king) {
    var dpr = global.devicePixelRatio || 1;
    var size = Math.min(canvas.clientWidth || 22, canvas.clientHeight || 22) || 22;
    var r = size * 0.42;
    var sp = createPieceSprite(color, king, r, dpr);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.drawImage(sp.canvas, 0, 0, sp.w, sp.h,
      size / 2 - sp.ax, size / 2 - sp.ay + r * 0.32, sp.w, sp.h);
    return canvas;
  }

  global.Render = {
    WOOD: WOOD,
    PIECE_PAL: PIECE_PAL,
    createBoardTexture: createBoardTexture,
    createPieceSprite: createPieceSprite,
    drawShadow: drawShadow,
    drawCrown: drawCrown,
    renderPieceTo: renderPieceTo,
    roundRect: roundRect,
    rgba: rgba,
    mix: mix
  };
})(typeof window !== 'undefined' ? window : globalThis);
