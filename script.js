'use strict';

/* =====================================================================
   CARD MODEL + FITCH-CHENEY ALGORITHM
   ===================================================================== */

const SUITS = [
  { code: 'C', symbol: '♣', color: 'black', name: 'Clubs',    chasedOrder: 0 },
  { code: 'H', symbol: '♥', color: 'red',   name: 'Hearts',   chasedOrder: 1 },
  { code: 'S', symbol: '♠', color: 'black', name: 'Spades',   chasedOrder: 2 },
  { code: 'D', symbol: '♦', color: 'red',   name: 'Diamonds', chasedOrder: 3 },
];
const SUIT_MAP = Object.fromEntries(SUITS.map(s => [s.code, s]));
const RANK_NAMES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function rankName(rank) { return RANK_NAMES[rank - 1]; }
function cardId(card) { return `${card.rank}-${card.suit}`; }
function sameCard(a, b) { return a && b && a.rank === b.rank && a.suit === b.suit; }
function cardLabel(card) { return `${rankName(card.rank)}${SUIT_MAP[card.suit].symbol}`; }

function fullDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 1; r <= 13; r++) deck.push({ rank: r, suit: s.code });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomCards(n, exclude = []) {
  const excluded = new Set(exclude.map(cardId));
  const pool = fullDeck().filter(c => !excluded.has(cardId(c)));
  return shuffle(pool).slice(0, n);
}

// Which convention is used to sort the 3 non-signal/non-hidden cards into
// Low/Middle/High. 'rank': rank first, suit (CHaSeD) breaks ties (default).
// 'suit': suit first (CHaSeD order), rank breaks ties within a suit.
let SORT_MODE = 'rank';

function sortRuleDescription() {
  return SORT_MODE === 'suit'
    ? 'by suit (♣<♥<♠<♦) first, then rank (A→K) within a suit'
    : 'by rank (A→K) first, suit (♣<♥<♠<♦) breaking ties';
}

function totalOrderCompare(a, b) {
  if (SORT_MODE === 'suit') {
    if (a.suit !== b.suit) return SUIT_MAP[a.suit].chasedOrder - SUIT_MAP[b.suit].chasedOrder;
    return a.rank - b.rank;
  }
  if (a.rank !== b.rank) return a.rank - b.rank;
  return SUIT_MAP[a.suit].chasedOrder - SUIT_MAP[b.suit].chasedOrder;
}

function mod13(x) { return ((x % 13) + 13) % 13; }

// Given two cards of the same suit, determines which one is the
// "signal" and which one is "hidden", and the delta (1-6) between them.
function resolveSignalHidden(c1, c2) {
  const d = mod13(c2.rank - c1.rank);
  if (d >= 1 && d <= 6) return { signal: c1, hidden: c2, delta: d };
  const d2 = mod13(c1.rank - c2.rank);
  return { signal: c2, hidden: c1, delta: d2 };
}

// The 6 permutations of (Low, Middle, High), in lexicographic order
// -> mapped to deltas 1 through 6.
const PERM_PATTERNS = [
  [0, 1, 2], // delta 1: L M H
  [0, 2, 1], // delta 2: L H M
  [1, 0, 2], // delta 3: M L H
  [1, 2, 0], // delta 4: M H L
  [2, 0, 1], // delta 5: H L M
  [2, 1, 0], // delta 6: H M L
];

function encodeDeltaToOrder(delta, sortedLMH) {
  return PERM_PATTERNS[delta - 1].map(idx => sortedLMH[idx]);
}

function decodeOrderToDelta(orderedThree) {
  const sorted = [...orderedThree].sort(totalOrderCompare);
  const pattern = orderedThree.map(c => sorted.findIndex(s => sameCard(s, c)));
  const idx = PERM_PATTERNS.findIndex(p => p.every((v, i) => v === pattern[i]));
  return { delta: idx + 1, sorted };
}

// Picks, among 5 cards, the same-suit pair to use (deterministic).
function chooseSameSuitPair(cards) {
  const bySuit = {};
  for (const c of cards) (bySuit[c.suit] ||= []).push(c);
  const candidateSuits = Object.keys(bySuit)
    .filter(s => bySuit[s].length >= 2)
    .sort((a, b) => SUIT_MAP[a].chasedOrder - SUIT_MAP[b].chasedOrder);
  const suit = candidateSuits[0];
  const group = [...bySuit[suit]].sort((a, b) => a.rank - b.rank);
  return { pair: [group[0], group[1]], suit };
}

// Automatically encodes a 5-card hand -> hidden card + 4-card message.
function encodeHand(fiveCards) {
  const { pair } = chooseSameSuitPair(fiveCards);
  const { signal, hidden, delta } = resolveSignalHidden(pair[0], pair[1]);
  const remaining = fiveCards.filter(c => !sameCard(c, pair[0]) && !sameCard(c, pair[1]));
  const sortedLMH = [...remaining].sort(totalOrderCompare);
  const orderedThree = encodeDeltaToOrder(delta, sortedLMH);
  const message = [signal, ...orderedThree];
  return { hidden, signal, delta, sortedLMH, orderedThree, message };
}

// Decodes a 4-card message (in the order received) -> the inferred hidden card.
// Total function: works even if the 4 cards don't come from a "valid"
// encoding (useful for checking answers in training mode).
function decodeMessage(fourCards) {
  const signal = fourCards[0];
  const rest = fourCards.slice(1);
  const { delta, sorted } = decodeOrderToDelta(rest);
  const hiddenRank = ((signal.rank - 1 + delta) % 13) + 1;
  const hidden = { rank: hiddenRank, suit: signal.suit };
  return { hidden, signal, delta, sorted, rest };
}

/* =====================================================================
   DOM UTILITIES
   ===================================================================== */

const $ = sel => document.querySelector(sel);

function createCardEl(card, opts = {}) {
  const div = document.createElement('div');
  div.className = `card ${SUIT_MAP[card.suit].color}${opts.extraClass ? ' ' + opts.extraClass : ''}`;
  div.innerHTML = `<span class="rank">${rankName(card.rank)}</span><span class="suit">${SUIT_MAP[card.suit].symbol}</span>`;
  if (opts.badge) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = opts.badge;
    div.appendChild(b);
  }
  if (opts.onClick) {
    div.addEventListener('click', opts.onClick);
  } else if (!opts.draggable) {
    div.classList.add('static');
  }
  if (opts.draggable) {
    div.draggable = true;
    div.addEventListener('dragstart', e => {
      draggedCard = card;
      div.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', cardId(card));
    });
    div.addEventListener('dragend', () => {
      div.classList.remove('dragging');
      draggedCard = null;
    });
  }
  return div;
}

function createBackCardEl() {
  const div = document.createElement('div');
  div.className = 'card card-back static';
  div.textContent = '?';
  return div;
}

/* =====================================================================
   STATE — ENCODER (drag & drop between 3 zones: hand / kept / order)
   ===================================================================== */

// Card currently being dragged (shared by every draggable element).
let draggedCard = null;

// allHand: the 5 drawn cards, fixed for the current round (used by
// "Solve automatically" and by reset). handCards/kept/order describe
// where each card currently sits.
const encState = { allHand: [], handCards: [], kept: null, order: [] };

function resetEncoder() {
  encState.allHand = [];
  encState.handCards = [];
  encState.kept = null;
  encState.order = [];
  $('#enc-step2').hidden = true;
  $('#enc-step3').hidden = true;
  clearEncFeedback();
  renderEncZones();
}

function clearEncFeedback() {
  $('#enc-result').classList.add('hidden');
  $('#enc-explain').classList.add('hidden');
}

function setEncHand(cards) {
  encState.allHand = cards;
  encState.handCards = cards.slice();
  encState.kept = null;
  encState.order = [];
  clearEncFeedback();
  $('#enc-step2').hidden = cards.length !== 5;
  $('#enc-step3').hidden = true;
  renderEncZones();
}

function removeCardFromEverywhere(card) {
  encState.handCards = encState.handCards.filter(c => !sameCard(c, card));
  if (encState.kept && sameCard(encState.kept, card)) encState.kept = null;
  encState.order = encState.order.filter(c => !sameCard(c, card));
}

function moveCardToHand(card) {
  removeCardFromEverywhere(card);
  encState.handCards.push(card);
  afterEncChange();
}

function moveCardToKept(card) {
  removeCardFromEverywhere(card);
  if (encState.kept) encState.handCards.push(encState.kept);
  encState.kept = card;
  afterEncChange();
}

function moveCardToOrder(card, targetIndex) {
  removeCardFromEverywhere(card);
  const idx = Math.max(0, Math.min(targetIndex, encState.order.length));
  encState.order.splice(idx, 0, card);
  if (encState.order.length > 4) {
    encState.handCards.push(encState.order.pop());
  }
  afterEncChange();
}

function afterEncChange() {
  clearEncFeedback();
  $('#enc-step3').hidden = true;
  renderEncZones();
}

function renderEncZones() {
  // "Hand" zone (cards not yet placed)
  const handZone = $('#enc-hand');
  handZone.innerHTML = '';
  encState.handCards.forEach(card => {
    handZone.appendChild(createCardEl(card, { draggable: true, onClick: () => onHandCardClick(card) }));
  });

  // "Hidden card" zone
  const keptZone = $('#enc-kept-zone');
  keptZone.innerHTML = '';
  if (encState.kept) {
    keptZone.appendChild(createCardEl(encState.kept, { draggable: true, extraClass: 'kept', onClick: () => moveCardToHand(encState.kept) }));
  } else {
    const ph = document.createElement('div');
    ph.className = 'placeholder-text';
    ph.textContent = 'Drop the card to hide here';
    keptZone.appendChild(ph);
  }

  // "Order" zone (4 numbered slots)
  const orderZone = $('#enc-order-zone');
  orderZone.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const slot = document.createElement('div');
    slot.className = 'order-slot';
    slot.dataset.index = String(i);
    const idx = document.createElement('span');
    idx.className = 'slot-index';
    idx.textContent = String(i + 1);
    slot.appendChild(idx);
    const cardArea = document.createElement('div');
    cardArea.className = 'order-slot-card';
    const card = encState.order[i];
    if (card) {
      slot.classList.add('filled');
      const cardCard = card;
      cardArea.appendChild(createCardEl(card, { draggable: true, onClick: () => moveCardToHand(cardCard) }));
    }
    slot.appendChild(cardArea);
    registerDropZone(slot, () => (encState.order[i] !== undefined ? i : encState.order.length));
    orderZone.appendChild(slot);
  }

  updateEncButtons();
}

function onHandCardClick(card) {
  if (!encState.kept) moveCardToKept(card);
  else if (encState.order.length < 4) moveCardToOrder(card, encState.order.length);
}

// Makes a DOM element able to receive the card currently being dragged.
function registerDropZone(el, getTargetIndex) {
  el.addEventListener('dragover', e => {
    if (!draggedCard) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    if (!draggedCard) return;
    const card = draggedCard;
    const zone = el.closest('[data-zone]').dataset.zone;
    if (zone === 'hand') moveCardToHand(card);
    else if (zone === 'kept') moveCardToKept(card);
    else if (zone === 'order') moveCardToOrder(card, getTargetIndex ? getTargetIndex() : 0);
    draggedCard = null;
  });
}

function updateEncButtons() {
  $('#enc-verify').disabled = !(encState.kept && encState.order.length === 4);
}

function showEncMessage(message) {
  const container = $('#enc-message');
  container.innerHTML = '';
  message.forEach(c => container.appendChild(createCardEl(c, {})));
  $('#enc-step3').hidden = false;
}

/* =====================================================================
   STATE — DECODER
   ===================================================================== */

const decState = { hand: [], guess: null };

function resetDecoder() {
  decState.hand = [];
  decState.guess = null;
  $('#dec-step2').hidden = true;
  clearDecFeedback();
  renderDecHand();
  renderDecGuess();
}

function clearDecFeedback() {
  $('#dec-result').classList.add('hidden');
  $('#dec-explain').classList.add('hidden');
}

function setDecHand(cards) {
  decState.hand = cards;
  decState.guess = null;
  clearDecFeedback();
  $('#dec-step2').hidden = cards.length !== 4;
  renderDecHand();
  renderDecGuess();
}

function renderDecHand() {
  const container = $('#dec-hand');
  container.innerHTML = '';
  decState.hand.forEach((card, i) => {
    const el = createCardEl(card, { badge: String(i + 1) });
    container.appendChild(el);
  });
}

function renderDecGuess() {
  const container = $('#dec-guess');
  container.innerHTML = '';
  if (decState.guess) container.appendChild(createCardEl(decState.guess, {}));
  else container.appendChild(createBackCardEl());
  $('#dec-verify').disabled = !decState.guess;
}

/* =====================================================================
   TEXTUAL EXPLANATIONS
   ===================================================================== */

function explainEncode(res) {
  const suit = SUIT_MAP[res.signal.suit];
  return `
    <p><strong>1. Same-suit pair:</strong> ${cardLabel(res.signal)} and ${cardLabel(res.hidden)} are both ${suit.name} (${suit.symbol}).</p>
    <p><strong>2. Circular distance:</strong> from ${cardLabel(res.signal)} to ${cardLabel(res.hidden)}, there are <strong>${res.delta}</strong> steps on the circle A→2→…→K→A. ${cardLabel(res.signal)} becomes the <em>signal</em> card, ${cardLabel(res.hidden)} stays hidden.</p>
    <p><strong>3. Remaining cards sorted</strong> (Low, Middle, High — ${sortRuleDescription()}): ${res.sortedLMH.map(cardLabel).join(', ')}.<br>To send delta ${res.delta}, they are presented in this order: <strong>${res.orderedThree.map(cardLabel).join(', ')}</strong>.</p>
    <p><strong>Final message:</strong> ${res.message.map(cardLabel).join(' → ')}</p>
  `;
}

function explainDecode(res) {
  const suit = SUIT_MAP[res.signal.suit];
  return `
    <p><strong>Signal card:</strong> ${cardLabel(res.signal)} (1st card received) → hidden suit = ${suit.symbol} ${suit.name}.</p>
    <p><strong>Next 3 cards sorted</strong> (Low, Middle, High — ${sortRuleDescription()}): ${res.sorted.map(cardLabel).join(', ')}.<br>Order received: ${res.rest.map(cardLabel).join(', ')} → delta = <strong>${res.delta}</strong>.</p>
    <p><strong>Hidden card</strong> = ${cardLabel(res.signal)} + ${res.delta} = <strong>${cardLabel(res.hidden)}</strong></p>
  `;
}

/* =====================================================================
   CARD PICKER (MODAL)
   ===================================================================== */

let pickerState = null;

function openCardPicker({ count, title, onConfirm }) {
  pickerState = { count, selected: [], onConfirm };
  $('#picker-title').textContent = title;
  renderPickerGrid();
  updatePickerStatus();
  $('#card-picker-modal').classList.remove('hidden');
}

function closeCardPicker() {
  $('#card-picker-modal').classList.add('hidden');
  pickerState = null;
}

function renderPickerGrid() {
  const grid = $('#picker-grid');
  grid.innerHTML = '';
  for (const s of SUITS) {
    const row = document.createElement('div');
    row.className = 'picker-row';
    for (let r = 1; r <= 13; r++) {
      const card = { rank: r, suit: s.code };
      const id = cardId(card);
      const selIdx = pickerState.selected.findIndex(c => cardId(c) === id);
      const disabled = selIdx < 0 && pickerState.selected.length >= pickerState.count;
      const el = createCardEl(card, {
        extraClass: (selIdx >= 0 ? 'selected' : '') + (disabled ? ' disabled' : ''),
        badge: selIdx >= 0 ? String(selIdx + 1) : null,
        onClick: disabled ? null : () => onPickerCardClick(card),
      });
      row.appendChild(el);
    }
    grid.appendChild(row);
  }
}

function onPickerCardClick(card) {
  const id = cardId(card);
  const idx = pickerState.selected.findIndex(c => cardId(c) === id);
  if (idx >= 0) pickerState.selected.splice(idx, 1);
  else if (pickerState.selected.length < pickerState.count) pickerState.selected.push(card);
  renderPickerGrid();
  updatePickerStatus();
}

function updatePickerStatus() {
  $('#picker-status').textContent = `${pickerState.selected.length} / ${pickerState.count} selected${pickerState.count > 1 ? ' — selection order matters' : ''}.`;
  $('#picker-confirm').disabled = pickerState.selected.length !== pickerState.count;
}

/* =====================================================================
   INITIALIZATION / EVENTS
   ===================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  // --- Tabs ---
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      $('#encoder-view').classList.toggle('active', mode === 'encoder');
      $('#decoder-view').classList.toggle('active', mode === 'decoder');
      document.body.dataset.mode = mode;
    });
  });

  // --- Sort convention switch ---
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.sort;
      if (mode === SORT_MODE) return;
      SORT_MODE = mode;
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
      // Encoding/decoding depend entirely on the sort convention: any card
      // already placed under the previous convention is no longer valid,
      // so start both modes over.
      resetEncoder();
      resetDecoder();
    });
  });

  // --- Info modal ---
  $('#info-btn').addEventListener('click', () => $('#info-modal').classList.remove('hidden'));
  $('#info-close').addEventListener('click', () => $('#info-modal').classList.add('hidden'));
  $('#info-modal').addEventListener('click', e => { if (e.target === $('#info-modal')) $('#info-modal').classList.add('hidden'); });

  // --- Picker modal (generic close) ---
  $('#picker-cancel').addEventListener('click', closeCardPicker);
  $('#card-picker-modal').addEventListener('click', e => { if (e.target === $('#card-picker-modal')) closeCardPicker(); });
  $('#picker-confirm').addEventListener('click', () => {
    const cards = pickerState.selected.slice();
    const cb = pickerState.onConfirm;
    closeCardPicker();
    cb(cards);
  });

  /* ---------------- ENCODER ---------------- */

  // The "hand" zone and the "hidden card" zone keep the same DOM
  // container element from one render to the next: register their drop
  // listeners only once (order slots, on the other hand, are recreated
  // on every render and register themselves in renderEncZones()).
  registerDropZone($('#enc-hand'), () => 0);
  registerDropZone($('#enc-kept-zone'), () => 0);

  $('#enc-random5').addEventListener('click', () => setEncHand(randomCards(5)));

  $('#enc-manual5').addEventListener('click', () => {
    openCardPicker({
      count: 5,
      title: 'Choose 5 cards',
      onConfirm: cards => setEncHand(cards),
    });
  });

  $('#enc-reset').addEventListener('click', resetEncoder);

  $('#enc-clear-order').addEventListener('click', () => {
    encState.handCards.push(...encState.order);
    encState.order = [];
    clearEncFeedback();
    $('#enc-step3').hidden = true;
    renderEncZones();
  });

  $('#enc-auto').addEventListener('click', () => {
    if (encState.allHand.length !== 5) return;
    const res = encodeHand(encState.allHand);
    encState.kept = res.hidden;
    encState.order = res.message.slice(); // 4 cards already in the order to send
    encState.handCards = [];
    renderEncZones();
    $('#enc-result').className = 'result-box ok';
    $('#enc-result').textContent = `Card kept: ${cardLabel(res.hidden)}. Cards to send, in order: ${res.message.map(cardLabel).join(', ')}.`;
    $('#enc-result').classList.remove('hidden');
    $('#enc-explain').innerHTML = explainEncode(res);
    $('#enc-explain').classList.remove('hidden');
    showEncMessage(res.message);
  });

  $('#enc-verify').addEventListener('click', () => {
    if (!(encState.kept && encState.order.length === 4)) return;
    const decoded = decodeMessage(encState.order);
    const correct = sameCard(decoded.hidden, encState.kept);
    $('#enc-result').className = 'result-box ' + (correct ? 'ok' : 'ko');
    $('#enc-result').textContent = correct
      ? `✅ Correct! With this order, the decoder correctly guesses ${cardLabel(encState.kept)}.`
      : `❌ Incorrect. With this order, the decoder would guess ${cardLabel(decoded.hidden)}, not ${cardLabel(encState.kept)}.`;
    $('#enc-result').classList.remove('hidden');
    $('#enc-explain').innerHTML = explainDecode(decoded);
    $('#enc-explain').classList.remove('hidden');
    if (correct) showEncMessage(encState.order);
  });

  $('#enc-send-to-decoder').addEventListener('click', () => {
    setDecHand(encState.order.slice());
    document.querySelector('.tab-btn[data-mode="decoder"]').click();
  });

  /* ---------------- DECODER ---------------- */

  $('#dec-random4').addEventListener('click', () => {
    const five = randomCards(5);
    const res = encodeHand(five);
    setDecHand(res.message);
  });

  $('#dec-manual4').addEventListener('click', () => {
    openCardPicker({
      count: 4,
      title: 'Choose the 4 received cards, in order',
      onConfirm: cards => setDecHand(cards),
    });
  });

  $('#dec-reset').addEventListener('click', resetDecoder);

  $('#dec-pick-guess').addEventListener('click', () => {
    openCardPicker({
      count: 1,
      title: 'Choose the hidden card',
      onConfirm: cards => {
        decState.guess = cards[0];
        clearDecFeedback();
        renderDecGuess();
      },
    });
  });

  $('#dec-verify').addEventListener('click', () => {
    if (decState.hand.length !== 4 || !decState.guess) return;
    const res = decodeMessage(decState.hand);
    const correct = sameCard(res.hidden, decState.guess);
    $('#dec-result').className = 'result-box ' + (correct ? 'ok' : 'ko');
    $('#dec-result').textContent = correct
      ? `✅ Correct! The hidden card was indeed ${cardLabel(res.hidden)}.`
      : `❌ Incorrect. You guessed ${cardLabel(decState.guess)}, the hidden card was ${cardLabel(res.hidden)}.`;
    $('#dec-result').classList.remove('hidden');
    $('#dec-explain').innerHTML = explainDecode(res);
    $('#dec-explain').classList.remove('hidden');
  });

  // Initial state
  renderEncZones();
  renderDecHand();
  renderDecGuess();
});
