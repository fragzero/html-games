/* ============================================================================
   Damas Brasileiras — motor de regras e geração de lances
   ----------------------------------------------------------------------------
   Regras implementadas (regras oficiais brasileiras / FMJD 64):
   - Tabuleiro 8x8, 12 pedras por jogador, jogo nas casas escuras.
   - Pedra move 1 casa na diagonal para frente.
   - Pedra captura para frente E para trás (salto curto).
   - Dama move e captura em qualquer distância nas 4 diagonais (dama voadora).
   - Captura é obrigatória.
   - Lei da maioria: entre as sequências possíveis é obrigatório escolher
     uma que capture o MAIOR número de peças.
   - Peças capturadas só saem do tabuleiro no fim do lance; elas bloqueiam
     o caminho e não podem ser saltadas duas vezes.
   - Promoção acontece somente se a pedra TERMINAR o lance na última fileira.
     Passar pela fileira de promoção durante uma sequência não promove.
   ========================================================================== */
(typeof window !== 'undefined' ? window : globalThis).Rules = (function () {
  'use strict';

  /* ---------------------------- constantes ------------------------------- */
  var EMPTY = 0;
  var W_MAN = 1, W_KING = 2, B_MAN = 3, B_KING = 4;
  var WHITE = 1, BLACK = 2;

  var DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  /* Numeração oficial das 32 casas escuras (1..32, da esquerda para a
     direita, de cima para baixo) usada na notação dos lances. */
  var SQ_NUM = new Int8Array(64).fill(-1);
  var NUM_SQ = new Int8Array(32);
  (function () {
    var n = 0;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        if (((r + c) & 1) === 1) {
          SQ_NUM[r * 8 + c] = n + 1;
          NUM_SQ[n] = r * 8 + c;
          n++;
        }
      }
    }
  })();

  /* ------------------------------ helpers -------------------------------- */
  function idx(r, c) { return r * 8 + c; }
  function rowOf(s) { return s >> 3; }
  function colOf(s) { return s & 7; }
  function inside(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function isDark(r, c) { return ((r + c) & 1) === 1; }
  function colorOf(p) { return p === EMPTY ? 0 : (p <= W_KING ? WHITE : BLACK); }
  function isKing(p) { return p === W_KING || p === B_KING; }
  function isMan(p) { return p === W_MAN || p === B_MAN; }
  function opponent(side) { return side === WHITE ? BLACK : WHITE; }

  function initialBoard() {
    var b = new Int8Array(64);
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        if (!isDark(r, c)) continue;
        if (r < 3) b[idx(r, c)] = B_MAN;
        else if (r > 4) b[idx(r, c)] = W_MAN;
      }
    }
    return b;
  }

  function cloneBoard(b) { return Int8Array.from(b); }

  /* ------------------------- geração de lances --------------------------- */
  /*  Um lance é representado por:
      {
        from:     casa de origem,
        to:       casa final,
        path:     [casas de pouso em ordem],   (quiet: [to])
        captures: [casas das peças capturadas em ordem],
        promote:  true se a pedra vira dama no fim do lance,
        king:     true se a peça que se move já era dama
      }                                                                    */

  function makeMove(from, path, captures, piece, side) {
    var to = path[path.length - 1];
    var lastRow = side === WHITE ? 0 : 7;
    return {
      from: from,
      to: to,
      path: path,
      captures: captures,
      promote: isMan(piece) && rowOf(to) === lastRow,
      king: isKing(piece)
    };
  }

  /**
   * Coleta todas as sequências maximais de captura para a peça em `start`.
   * Muta `board` temporariamente e restaura antes de retornar.
   */
  function collectCaptures(board, start, out) {
    var piece = board[start];
    var side = colorOf(piece);
    var enemy = opponent(side);
    var king = isKing(piece);
    var path = [];
    var taken = [];

    board[start] = EMPTY;           // a peça está "na mão" durante a sequência
    walk(start);
    board[start] = piece;

    function walk(sq) {
      var extended = false;
      var r = rowOf(sq), c = colOf(sq);

      for (var d = 0; d < 4; d++) {
        var dr = DIRS[d][0], dc = DIRS[d][1];
        var vr, vc, victim;

        if (king) {
          /* dama: percorre casas vazias até encontrar a primeira peça */
          vr = r + dr; vc = c + dc;
          while (inside(vr, vc) && board[idx(vr, vc)] === EMPTY) { vr += dr; vc += dc; }
          if (!inside(vr, vc)) continue;
          victim = idx(vr, vc);
          if (colorOf(board[victim]) !== enemy) continue;   // própria peça: bloqueia
          if (taken.indexOf(victim) !== -1) continue;       // já capturada: bloqueia
          /* pode pousar em qualquer casa vazia depois da vítima */
          var lr = vr + dr, lc = vc + dc;
          while (inside(lr, lc) && board[idx(lr, lc)] === EMPTY) {
            extended = true;
            taken.push(victim); path.push(idx(lr, lc));
            walk(idx(lr, lc));
            taken.pop(); path.pop();
            lr += dr; lc += dc;
          }
        } else {
          /* pedra: salto curto, para frente ou para trás */
          vr = r + dr; vc = c + dc;
          var jr = r + 2 * dr, jc = c + 2 * dc;
          if (!inside(jr, jc)) continue;
          victim = idx(vr, vc);
          var land = idx(jr, jc);
          if (colorOf(board[victim]) !== enemy) continue;
          if (taken.indexOf(victim) !== -1) continue;
          if (board[land] !== EMPTY) continue;
          extended = true;
          taken.push(victim); path.push(land);
          walk(land);
          taken.pop(); path.pop();
        }
      }

      /* sequência maximal: não há mais captura possível daqui */
      if (!extended && path.length > 0) {
        out.push(makeMove(start, path.slice(), taken.slice(), piece, side));
      }
    }
  }

  function quietMovesFor(board, sq, out) {
    var piece = board[sq];
    var side = colorOf(piece);
    var r = rowOf(sq), c = colOf(sq);

    if (isKing(piece)) {
      for (var d = 0; d < 4; d++) {
        var rr = r + DIRS[d][0], cc = c + DIRS[d][1];
        while (inside(rr, cc) && board[idx(rr, cc)] === EMPTY) {
          out.push(makeMove(sq, [idx(rr, cc)], [], piece, side));
          rr += DIRS[d][0]; cc += DIRS[d][1];
        }
      }
    } else {
      var dr = side === WHITE ? -1 : 1;
      for (var i = -1; i <= 1; i += 2) {
        var nr = r + dr, nc = c + i;
        if (inside(nr, nc) && board[idx(nr, nc)] === EMPTY) {
          out.push(makeMove(sq, [idx(nr, nc)], [], piece, side));
        }
      }
    }
  }

  /**
   * Todos os lances legais de `side`, já aplicando captura obrigatória
   * e a lei da maioria.
   */
  function generateMoves(board, side) {
    var caps = [];
    var i, s, p;

    /* as peças só ocupam as 32 casas escuras */
    for (i = 0; i < 32; i++) {
      s = NUM_SQ[i];
      p = board[s];
      if (p !== EMPTY && colorOf(p) === side) collectCaptures(board, s, caps);
    }

    if (caps.length > 0) {
      var max = 0;
      for (var i = 0; i < caps.length; i++) {
        if (caps[i].captures.length > max) max = caps[i].captures.length;
      }
      if (caps.length === 1) return caps;
      var best = [];
      for (var j = 0; j < caps.length; j++) {
        if (caps[j].captures.length === max) best.push(caps[j]);
      }
      return best;
    }

    var quiet = [];
    for (i = 0; i < 32; i++) {
      s = NUM_SQ[i];
      p = board[s];
      if (p !== EMPTY && colorOf(p) === side) quietMovesFor(board, s, quiet);
    }
    return quiet;
  }

  function hasCaptures(moves) {
    return moves.length > 0 && moves[0].captures.length > 0;
  }

  function applyMove(board, move) {
    var piece = board[move.from];
    board[move.from] = EMPTY;
    for (var i = 0; i < move.captures.length; i++) board[move.captures[i]] = EMPTY;
    if (move.promote) {
      board[move.to] = colorOf(piece) === WHITE ? W_KING : B_KING;
    } else {
      board[move.to] = piece;
    }
    return board;
  }

  /* ----------------------------- contagem -------------------------------- */
  function count(board) {
    var o = { wMan: 0, wKing: 0, bMan: 0, bKing: 0, white: 0, black: 0, total: 0 };
    for (var i = 0; i < 32; i++) {
      switch (board[NUM_SQ[i]]) {
        case W_MAN: o.wMan++; break;
        case W_KING: o.wKing++; break;
        case B_MAN: o.bMan++; break;
        case B_KING: o.bKing++; break;
      }
    }
    o.white = o.wMan + o.wKing;
    o.black = o.bMan + o.bKing;
    o.total = o.white + o.black;
    return o;
  }

  /** Chave compacta da posição (para detectar repetição tripla). */
  function positionKey(board, side) {
    var out = side === WHITE ? 'w' : 'b';
    for (var i = 0; i < 32; i++) out += board[NUM_SQ[i]];
    return out;
  }

  /* --------------------------- fim de partida ---------------------------- */
  /**
   * Estado da partida. `state` = { board, turn, idleMoves, repetitions }
   * Retorna null se o jogo continua, ou
   * { winner: WHITE|BLACK|0, reason: string }
   */
  function gameResult(board, turn, idleMoves, repeatCount) {
    var c = count(board);
    if (c.white === 0) return { winner: BLACK, reason: 'sem-pecas' };
    if (c.black === 0) return { winner: WHITE, reason: 'sem-pecas' };

    if (generateMoves(board, turn).length === 0) {
      return { winner: opponent(turn), reason: 'sem-lances' };
    }
    /* empate: 20 lances de cada lado (40 meios-lances) só com damas,
       sem captura e sem movimento de pedra */
    if (idleMoves >= 40) return { winner: 0, reason: 'regra-20-lances' };
    if (repeatCount >= 3) return { winner: 0, reason: 'repeticao' };

    /* finais teoricamente empatados: 2 damas x 1 dama, 1x1, etc. */
    if (c.total <= 3 && c.wMan === 0 && c.bMan === 0 && idleMoves >= 10) {
      if (c.white >= 1 && c.black >= 1 && Math.abs(c.white - c.black) <= 1) {
        return { winner: 0, reason: 'final-empatado' };
      }
    }
    return null;
  }

  /* ------------------------------ notação -------------------------------- */
  function moveNotation(move) {
    var sep = move.captures.length ? 'x' : '-';
    var s = String(SQ_NUM[move.from]);
    for (var i = 0; i < move.path.length; i++) s += sep + SQ_NUM[move.path[i]];
    return s;
  }

  function sameMove(a, b) {
    if (!a || !b) return false;
    if (a.from !== b.from || a.path.length !== b.path.length) return false;
    for (var i = 0; i < a.path.length; i++) if (a.path[i] !== b.path[i]) return false;
    return true;
  }

  /** Lances cujo caminho começa exatamente por `prefix` (seleção de sequência). */
  function movesWithPrefix(moves, prefix) {
    var out = [];
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (m.path.length < prefix.length) continue;
      var ok = true;
      for (var j = 0; j < prefix.length; j++) {
        if (m.path[j] !== prefix[j]) { ok = false; break; }
      }
      if (ok) out.push(m);
    }
    return out;
  }

  /* ------------------------------ exports -------------------------------- */
  return {
    EMPTY: EMPTY, W_MAN: W_MAN, W_KING: W_KING, B_MAN: B_MAN, B_KING: B_KING,
    WHITE: WHITE, BLACK: BLACK, DIRS: DIRS,
    SQ_NUM: SQ_NUM, NUM_SQ: NUM_SQ,
    idx: idx, rowOf: rowOf, colOf: colOf, inside: inside, isDark: isDark,
    colorOf: colorOf, isKing: isKing, isMan: isMan, opponent: opponent,
    initialBoard: initialBoard, cloneBoard: cloneBoard,
    generateMoves: generateMoves, hasCaptures: hasCaptures, applyMove: applyMove,
    count: count, positionKey: positionKey, gameResult: gameResult,
    moveNotation: moveNotation, sameMove: sameMove, movesWithPrefix: movesWithPrefix
  };
})();

/* suporte a require() para os testes em node */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).Rules;
}
