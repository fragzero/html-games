/* ============================================================================
   Damas Brasileiras — inteligência artificial
   ----------------------------------------------------------------------------
   Motor de busca:
     - Negamax com poda alfa-beta (fail-soft)
     - Aprofundamento iterativo com limite de tempo
     - Tabela de transposição com hash de Zobrist
     - Ordenação de lances: lance da TT > capturas maiores > promoções >
       killer moves > heurística de histórico
     - Extensão de capturas: como a captura é obrigatória, sequências forçadas
       são resolvidas até o fim (quiescência natural das damas)
     - Extensão de lance único (posições forçadas não gastam profundidade)

   Níveis:
     fácil   — profundidade 2, avaliação simplificada, erra de propósito
     médio   — profundidade ~6, pequeno ruído na avaliação
     difícil — aprofundamento iterativo até ~1,8s, sem erros propositais
   ========================================================================== */
(function (global) {
  'use strict';

  var R = global.Rules;

  var MATE = 100000;
  var INF = 1e9;

  var MAN_VALUE = 100;
  var KING_VALUE = 300;

  var LEVELS = {
    facil: { label: 'Fácil', maxDepth: 2, time: 300, blunder: 0.30, noise: 45, minDelay: 420, simpleEval: true },
    medio: { label: 'Médio', maxDepth: 7, time: 800, blunder: 0.06, noise: 12, minDelay: 300, simpleEval: false },
    dificil: { label: 'Difícil', maxDepth: 24, time: 1500, blunder: 0, noise: 0, minDelay: 160, simpleEval: false }
  };

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* ------------------------- tabelas de avaliação ------------------------ */
  /* bônus por avanço da pedra (0 = fileira inicial, 6 = a um passo da dama) */
  var ADV = [0, 3, 7, 12, 18, 26, 36, 0];
  /* colunas das bordas são seguras (peça na borda não pode ser capturada) */
  var EDGE = [6, 0, 2, 4, 4, 2, 0, 6];

  var MAN_PST_W = new Int16Array(64);
  var MAN_PST_B = new Int16Array(64);
  var KING_PST = new Int16Array(64);
  (function () {
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var s = r * 8 + c;
        MAN_PST_W[s] = ADV[7 - r] + EDGE[c];
        MAN_PST_B[(7 - r) * 8 + c] = MAN_PST_W[s];
        var cd = Math.abs(3.5 - r) + Math.abs(3.5 - c);
        KING_PST[s] = Math.round(14 - 3 * cd);
      }
    }
  })();

  /* ---------------------------- Zobrist / TT ----------------------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var ZA = new Int32Array(5 * 64);
  var ZB = new Int32Array(5 * 64);
  var ZSIDE_A, ZSIDE_B;
  (function () {
    var rnd = mulberry32(0x9E3779B9);
    for (var i = 0; i < ZA.length; i++) {
      ZA[i] = (rnd() * 4294967296) | 0;
      ZB[i] = (rnd() * 4294967296) | 0;
    }
    ZSIDE_A = (rnd() * 4294967296) | 0;
    ZSIDE_B = (rnd() * 4294967296) | 0;
  })();

  /* as peças só existem nas 32 casas escuras: percorrer apenas elas */
  var DARK = R.NUM_SQ;

  function hashKey(board, side) {
    var a = 0, b = 0;
    for (var i = 0; i < 32; i++) {
      var s = DARK[i];
      var p = board[s];
      if (p !== 0) { var z = p * 64 + s; a ^= ZA[z]; b ^= ZB[z]; }
    }
    if (side === R.BLACK) { a ^= ZSIDE_A; b ^= ZSIDE_B; }
    return (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36);
  }

  var TT = new Map();
  var TT_MAX = 260000;

  /* --------------------------- estado da busca --------------------------- */
  var deadline = Infinity;
  var timeUp = false;
  var nodes = 0;
  var evalCfg = LEVELS.medio;
  var history = new Int32Array(64 * 64);
  var killers = [];

  /* ------------------------------ avaliação ------------------------------ */
  /** Pontuação da posição em centésimos de pedra, do ponto de vista de `side`. */
  function evaluate(board, side) {
    var white = 0, black = 0;
    var wm = 0, wk = 0, bm = 0, bk = 0;
    var s, p, r, c, i;

    for (i = 0; i < 32; i++) {
      s = DARK[i];
      p = board[s];
      if (p === 0) continue;
      r = s >> 3; c = s & 7;

      if (p === 1) {                                  /* pedra branca */
        wm++;
        white += MAN_VALUE + MAN_PST_W[s];
        if (!evalCfg.simpleEval) {
          if (r === 7) white += 7;                    /* guarda a última fileira */
          if (c > 0 && r < 7 && R.colorOf(board[s + 7]) === 1) white += 4;   /* apoiada */
          if (c < 7 && r < 7 && R.colorOf(board[s + 9]) === 1) white += 4;
        }
      } else if (p === 2) {                           /* dama branca */
        wk++;
        white += KING_VALUE + KING_PST[s];
      } else if (p === 3) {                           /* pedra preta */
        bm++;
        black += MAN_VALUE + MAN_PST_B[s];
        if (!evalCfg.simpleEval) {
          if (r === 0) black += 7;
          if (c > 0 && r > 0 && R.colorOf(board[s - 9]) === 2) black += 4;
          if (c < 7 && r > 0 && R.colorOf(board[s - 7]) === 2) black += 4;
        }
      } else if (p === 4) {                           /* dama preta */
        bk++;
        black += KING_VALUE + KING_PST[s];
      }
    }

    var diff = white - black;

    if (!evalCfg.simpleEval) {
      var total = wm + wk + bm + bk;

      /* quem está na frente ganha trocando peças (simplificação) */
      var phase = (24 - total) * 1.5;
      if (diff > 40) diff += phase;
      else if (diff < -40) diff -= phase;

      /* final: o lado forte deve caçar as peças do lado fraco */
      if (total <= 8 && (diff > 40 || diff < -40)) {
        var strong = diff > 0 ? 1 : 2;
        var chase = 0, kings = 0;
        for (i = 0; i < 32; i++) {
          s = DARK[i];
          p = board[s];
          if (p === 0 || R.colorOf(p) !== strong || !R.isKing(p)) continue;
          kings++;
          var bestD = 14;
          for (var j = 0; j < 32; j++) {
            var t = DARK[j];
            if (board[t] === 0 || R.colorOf(board[t]) === strong) continue;
            var d = Math.max(Math.abs((s >> 3) - (t >> 3)), Math.abs((s & 7) - (t & 7)));
            if (d < bestD) bestD = d;
          }
          chase += bestD;
        }
        if (kings > 0) {
          var penalty = 3 * (chase / kings);
          diff += strong === 1 ? -penalty : penalty;
        }
      }
    }

    return side === R.WHITE ? diff : -diff;
  }

  /* -------------------------- ordenação de lances ------------------------ */
  function moveScore(m, ttMove, ply) {
    if (R.sameMove(m, ttMove)) return 1e7;
    var sc = 0;
    if (m.captures.length) sc += 100000 + m.captures.length * 1000;
    if (m.promote) sc += 4000;
    var k = killers[ply];
    if (k) {
      if (R.sameMove(m, k[0])) sc += 900;
      else if (R.sameMove(m, k[1])) sc += 800;
    }
    sc += Math.min(700, history[m.from * 64 + m.to]);
    if (m.king) sc += 10;
    return sc;
  }

  function orderMoves(moves, ttMove, ply) {
    var i, j, m, sc;
    for (i = 0; i < moves.length; i++) moves[i]._ord = moveScore(moves[i], ttMove, ply);
    for (i = 1; i < moves.length; i++) {           /* insertion sort decrescente */
      m = moves[i]; sc = m._ord; j = i - 1;
      while (j >= 0 && moves[j]._ord < sc) { moves[j + 1] = moves[j]; j--; }
      moves[j + 1] = m;
    }
    return moves;
  }

  function addKiller(m, ply) {
    if (m.captures.length) return;
    if (!killers[ply]) killers[ply] = [null, null];
    var k = killers[ply];
    if (!R.sameMove(k[0], m)) { k[1] = k[0]; k[0] = m; }
  }

  /* ------------------------------- negamax ------------------------------- */
  function negamax(board, side, depth, alpha, beta, ply) {
    nodes++;
    if ((nodes & 511) === 0 && now() > deadline) timeUp = true;
    if (timeUp) return 0;

    var moves = R.generateMoves(board, side);
    if (moves.length === 0) return -MATE + ply;        /* sem lances legais: perdeu */

    var forced = moves[0].captures.length > 0;
    /* em profundidade 0 continuamos apenas se houver captura obrigatória:
       a sequência forçada precisa ser resolvida para a avaliação fazer sentido */
    if (depth <= 0 && !forced) return evaluate(board, side);
    if (ply >= 46) return evaluate(board, side);

    var key = hashKey(board, side);
    var entry = TT.get(key);
    var ttMove = null;
    if (entry) {
      ttMove = entry.move;
      if (entry.depth >= depth) {
        if (entry.flag === 0) return entry.score;
        if (entry.flag === 1) { if (entry.score > alpha) alpha = entry.score; }
        else if (entry.flag === 2) { if (entry.score < beta) beta = entry.score; }
        if (alpha >= beta) return entry.score;
      }
    }

    orderMoves(moves, ttMove, ply);

    var origAlpha = alpha;
    var best = -INF, bestMove = null;
    var single = moves.length === 1;

    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var nb = R.cloneBoard(board);
      R.applyMove(nb, m);

      var nd = depth - 1;
      if (single && depth > 0 && ply < 30) nd = depth;   /* posição forçada: não gasta profundidade */

      var sc = -negamax(nb, R.opponent(side), nd, -beta, -alpha, ply + 1);
      if (timeUp) return 0;

      if (sc > best) { best = sc; bestMove = m; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        addKiller(m, ply);
        history[m.from * 64 + m.to] += depth > 0 ? depth * depth : 1;
        break;
      }
    }

    if (TT.size > TT_MAX) TT.clear();
    TT.set(key, {
      depth: depth,
      score: best,
      flag: best <= origAlpha ? 2 : (best >= beta ? 1 : 0),
      move: bestMove
    });

    return best;
  }

  /* ---------------------------- busca na raiz ---------------------------- */
  function rootSearch(board, side, depth, prevBest, useNoise) {
    var moves = R.generateMoves(board, side);
    if (moves.length === 0) return null;

    orderMoves(moves, prevBest, 0);

    var alpha = -INF;
    var best = moves[0], bestScore = -INF;
    var scored = [];

    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var nb = R.cloneBoard(board);
      R.applyMove(nb, m);
      var window = useNoise ? INF : -alpha;   /* com ruído avaliamos todos por inteiro */
      var sc = -negamax(nb, R.opponent(side), depth - 1, -INF, window, 1);
      if (timeUp && depth > 1) return null;

      var effective = sc;
      if (useNoise) effective += (Math.random() * 2 - 1) * evalCfg.noise;
      scored.push({ move: m, score: sc, effective: effective });

      if (effective > bestScore) { bestScore = effective; best = m; }
      if (!useNoise && sc > alpha) alpha = sc;
    }

    scored.sort(function (a, b) { return b.effective - a.effective; });
    return { move: best, score: bestScore, scored: scored, depth: depth };
  }

  /* -------------------------- API: busca síncrona ------------------------ */
  /**
   * Escolhe o melhor lance de forma síncrona.
   * @param {Int8Array} board
   * @param {number} side
   * @param {object} opts { level, maxDepth, time }
   */
  function bestMoveSync(board, side, opts) {
    opts = opts || {};
    var cfg = LEVELS[opts.level] || LEVELS.dificil;
    evalCfg = { simpleEval: !!cfg.simpleEval, noise: opts.noise != null ? opts.noise : cfg.noise };

    var maxDepth = opts.maxDepth || cfg.maxDepth;
    var budget = opts.time != null ? opts.time : cfg.time;

    var moves = R.generateMoves(board, side);
    if (moves.length === 0) return { move: null, depth: 0, score: 0, nodes: 0 };
    if (moves.length === 1) return { move: moves[0], depth: 0, score: 0, nodes: 0, forced: true };

    TT.clear();
    history.fill(0);
    killers.length = 0;
    deadline = now() + budget;
    timeUp = false;
    nodes = 0;

    var best = null, bestScore = 0, reached = 0;
    for (var d = 1; d <= maxDepth; d++) {
      var res = rootSearch(board, side, d, best, evalCfg.noise > 0);
      if (res) { best = res.move; bestScore = res.score; reached = d; }
      if (timeUp || now() > deadline) break;
      if (Math.abs(bestScore) > MATE - 200) break;      /* vitória forçada encontrada */
    }
    return { move: best, depth: reached, score: bestScore, nodes: nodes };
  }

  /* ------------------------ API: busca assíncrona ------------------------ */
  /**
   * Pensa sem travar a interface: cada profundidade do aprofundamento
   * iterativo roda em um tick separado do event loop.
   * @returns {{cancel: function}} handle para cancelar a busca
   */
  function think(board, side, level, onDone, opts) {
    opts = opts || {};
    var cfg = LEVELS[level] || LEVELS.medio;
    var handle = { cancelled: false, cancel: function () { this.cancelled = true; } };

    evalCfg = { simpleEval: !!cfg.simpleEval, noise: cfg.noise };

    var startedAt = now();
    var minDelay = opts.minDelay != null ? opts.minDelay : cfg.minDelay;
    var budget = opts.time != null ? opts.time : cfg.time;
    var maxDepth = opts.maxDepth || cfg.maxDepth;
    var work = R.cloneBoard(board);

    var moves = R.generateMoves(work, side);
    if (moves.length === 0) { settle(null, { depth: 0, score: 0, nodes: 0 }); return handle; }

    /* lance único: não há o que pensar */
    if (moves.length === 1) { settle(moves[0], { depth: 0, score: 0, nodes: 0, forced: true }); return handle; }

    /* erro propositado dos níveis mais fáceis */
    if (cfg.blunder > 0 && Math.random() < cfg.blunder) {
      settle(moves[(Math.random() * moves.length) | 0], { depth: 0, score: 0, nodes: 0, random: true });
      return handle;
    }

    TT.clear();
    history.fill(0);
    killers.length = 0;
    deadline = now() + budget;
    timeUp = false;
    nodes = 0;

    var depth = 1, best = null, bestScore = 0, reached = 0;
    setTimeout(step, 0);
    return handle;

    function step() {
      if (handle.cancelled) return;

      var res = rootSearch(work, side, depth, best, evalCfg.noise > 0);
      if (res) { best = res.move; bestScore = res.score; reached = depth; }

      var done = handle.cancelled ||
        depth >= maxDepth ||
        timeUp || now() > deadline ||
        Math.abs(bestScore) > MATE - 200;

      if (done) {
        settle(best || moves[0], { depth: reached, score: bestScore, nodes: nodes });
      } else {
        depth++;
        setTimeout(step, 0);
      }
    }

    function settle(move, info) {
      var wait = Math.max(0, minDelay - (now() - startedAt));
      setTimeout(function () {
        if (!handle.cancelled) onDone(move, info);
      }, wait);
    }
  }

  /** Sugestão de lance para o jogador humano (botão "Dica"). */
  function hint(board, side, onDone) {
    return think(board, side, 'dificil', onDone, { time: 700, maxDepth: 12, minDelay: 60 });
  }

  global.AI = {
    LEVELS: LEVELS,
    think: think,
    hint: hint,
    bestMoveSync: bestMoveSync,
    evaluate: function (board, side, simple) {
      evalCfg = { simpleEval: !!simple, noise: 0 };
      return evaluate(board, side);
    },
    MATE: MATE
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AI;
}
