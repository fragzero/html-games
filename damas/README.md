# Damas Brasileiras

Jogo de damas completo em HTML5 + Canvas, sem dependências e sem build.
Abra `index.html` no navegador e jogue.

![tabuleiro](https://img.shields.io/badge/HTML5-Canvas-e0b262?style=flat-square)

## O que tem

- **Regras oficiais brasileiras**: captura obrigatória, lei da maioria,
  dama voadora, captura da pedra para trás, promoção só ao terminar o lance
  na última fileira, empate por repetição e pela regra dos 20 lances.
- **Três níveis de dificuldade** contra o computador.
- **Modo 2 jogadores** no mesmo dispositivo.
- **Tabuleiro e peças desenhados por procedimento** — madeira com veios,
  casas embutidas com bisel, moldura com filete de latão, peças com espessura,
  ranhuras torneadas na borda e coroa dourada nas damas. Nenhuma imagem externa.
- **Movimentos animados**: a peça levanta, descreve um arco sobre a peça
  capturada, assenta com um leve recuo; a peça capturada encolhe e se desfaz;
  na promoção um segundo disco cai e se encaixa.
- **Som sintetizado** em WebAudio (estalo de madeira, captura, coroação) —
  também sem arquivos externos.
- Arrastar e soltar ou clicar; capturas múltiplas escolhidas casa por casa;
  dica, desfazer, girar o tabuleiro e numeração das casas (1–32).

## Níveis

| Nível | Como joga | Profundidade típica |
|---|---|---|
| Fácil | avaliação simplificada e erros propositais (~30% dos lances) | 2 |
| Médio | vê armadilhas curtas, pequeno ruído na avaliação | 7 |
| Difícil | aprofundamento iterativo com ~1,5 s por lance | 10 e mais nos finais |

Em testes automatizados de 6 partidas por confronto: difícil e médio venceram
o fácil por 6 a 0, e o difícil venceu o médio por 3 a 0 com 1 empate.

## Controles

| Ação | Como |
|---|---|
| Mover | clique na peça e na casa de destino, ou arraste a peça |
| Cancelar a jogada | `Esc` ou botão direito |
| Desfazer | botão **Desfazer** ou `Ctrl`+`Z` |
| Dica | botão **Dica** ou `H` |
| Novo jogo | botão **Novo jogo** ou `N` |

As peças que **precisam** capturar aparecem com um anel dourado tracejado.
Nas capturas múltiplas com mais de um caminho, cada pouso é escolhido
separadamente e a peça que vai ser capturada é marcada com um `✕`.

## Notação dos lances

As 32 casas escuras são numeradas de 1 a 32, da esquerda para a direita e de
cima para baixo. Lances simples usam `-` (`24-19`) e capturas usam `x`, listando
todas as casas de pouso (`32x23x16x7`).

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `rules.js` | representação do tabuleiro, geração de lances, captura obrigatória, lei da maioria, fim de jogo e notação |
| `ai.js` | negamax com poda alfa-beta, tabela de transposição (Zobrist), ordenação de lances, extensão de capturas forçadas e aprofundamento iterativo |
| `render.js` | textura de madeira procedural, sprites das peças e sombras |
| `game.js` | estado da partida, animações, entrada do jogador, som e interface |

O motor de regras e a IA não dependem do DOM e podem ser usados em Node:

```js
const R = require('./rules.js');
const AI = require('./ai.js');

let board = R.initialBoard();
const { move } = AI.bestMoveSync(board, R.WHITE, { level: 'dificil' });
console.log(R.moveNotation(move));
R.applyMove(board, move);
```

## Detalhes de implementação

- O tabuleiro é um `Int8Array(64)`; as peças só ocupam as 32 casas escuras, e
  tanto a geração de lances quanto a avaliação percorrem apenas essas casas.
- As sequências de captura são geradas por busca em profundidade mantendo as
  peças capturadas no tabuleiro como obstáculos, o que garante que nenhuma peça
  seja saltada duas vezes.
- Como a captura é obrigatória, a busca resolve as sequências forçadas até o
  fim antes de avaliar a posição (quiescência natural do jogo) e não gasta
  profundidade em posições de lance único.
- O tabuleiro e as peças são pré-renderizados em canvas fora de tela; cada
  quadro é só uma composição de imagens.
