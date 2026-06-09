'use strict';

// ===========================
// State
// ===========================
let state = {
  level: 'A1',
  deck: [],
  currentIndex: 0,
  isFlipped: false,
  reverseMode: false,
  wrongCount: {},
  studyCount: {},
  mastery: {
    mode: 'ratio',       // 'ratio' | 'count'
    ratioThreshold: 80,  // percent (1–100)
    countThreshold: 2,   // times  (1+)
  },
};

// ===========================
// DOM References
// ===========================
let els = {};

// ===========================
// Drag State
// ===========================
let drag = { startX: 0, deltaX: 0, isDragging: false, isSwipeDragging: false };

// isAnimating is ONLY set during card fly-off (animateOffScreen).
// The flip animation does NOT set this flag, so flipping is freely interruptible.
let isAnimating = false;

// ===========================
// Helpers
// ===========================
function getClientX(e) {
  return e.touches ? e.touches[0].clientX : e.clientX;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function posLabel(pos) {
  const map = {
    noun: '名詞', verb: '動詞', adjective: '形容詞',
    adverb: '副詞', conjunction: '接続詞', preposition: '前置詞',
  };
  return map[pos] || pos;
}

// ===========================
// Mastery Check
// ===========================
function isMastered(wordStr) {
  const study   = state.studyCount[wordStr] || 0;
  const wrong   = state.wrongCount[wordStr] || 0;
  const correct = study - wrong;

  if (study === 0) return false;

  if (state.mastery.mode === 'ratio') {
    return (correct / study) * 100 >= state.mastery.ratioThreshold;
  }
  return correct >= state.mastery.countThreshold;
}

// ===========================
// Screen Management
// ===========================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===========================
// Welcome Screen
// ===========================
function initWelcomeScreen() {
  // Level buttons
  els.levelBtns[0].classList.add('selected');
  els.levelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.levelBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.level = btn.dataset.level;
    });
  });

  // Card direction (英→日 / 日→英)
  els.modeBtns[0].classList.add('selected');
  els.modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.modeBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.reverseMode = (btn.dataset.mode === 'reverse');
    });
  });

  // Mastery mode (割合 / 回数)
  els.masteryBtns[0].classList.add('selected');
  els.masteryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.masteryBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.mastery.mode = btn.dataset.mastery;
      updateMasteryInputVisibility();
    });
  });

  // Mastery thresholds — validate on blur/enter
  els.ratioThresholdInput.addEventListener('change', () => {
    let v = parseInt(els.ratioThresholdInput.value, 10);
    if (isNaN(v) || v < 1)  v = 1;
    if (v > 100)             v = 100;
    els.ratioThresholdInput.value = v;
    state.mastery.ratioThreshold = v;
  });

  els.countThresholdInput.addEventListener('change', () => {
    let v = parseInt(els.countThresholdInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    els.countThresholdInput.value = v;
    state.mastery.countThreshold = v;
  });

  els.btnStart.addEventListener('click', () => {
    const raw = els.saveInput.value.trim();
    els.saveWarning.textContent = '';
    state.wrongCount = {};
    state.studyCount = {};

    if (raw) {
      const result = parseSaveData(raw);
      if (!result) {
        els.saveWarning.textContent = 'セーブデータの形式が正しくありません。無視して開始します。';
      } else {
        if (result.warning) els.saveWarning.textContent = result.warning;
        state.wrongCount = result.wrongCount;
        state.studyCount = result.studyCount;
      }
    }

    buildDeck();

    if (state.deck.length === 0) {
      showResult('complete');
      els.resultTitle.textContent = 'すべての単語を習得済みです！';
      return;
    }

    state.currentIndex = 0;
    state.isFlipped = false;
    showScreen('screen-study');
    renderCard();
  });
}

function updateMasteryInputVisibility() {
  els.masteryInputRatio.style.display = state.mastery.mode === 'ratio' ? 'flex' : 'none';
  els.masteryInputCount.style.display = state.mastery.mode === 'count' ? 'flex' : 'none';
}

function parseSaveData(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  if (!lines[0] || !lines[0].includes('CEFR-J英単語帳')) return null;

  const firstDelim = lines.findIndex(l => l === '---');
  if (firstDelim === -1) return null;

  const secondDelim = lines.indexOf('---', firstDelim + 1);
  if (secondDelim === -1) return null;

  let warning = '';
  const levelLine = lines.find(l => l.startsWith('レベル:'));
  if (levelLine) {
    const savedLevel = levelLine.replace('レベル:', '').trim();
    if (savedLevel !== state.level) {
      warning = `セーブデータのレベル(${savedLevel})と選択レベル(${state.level})が異なります。選択レベルを使用します。`;
    }
  }

  const wrongCount = {};
  const studyCount = {};

  // firstDelim+1 is the header line; data starts at firstDelim+2
  for (let i = firstDelim + 2; i < secondDelim; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;
    const word = parts[0].trim();
    const col1 = parts[1].trim();

    if (col1 === 'true' || col1 === 'false') {
      // Backwards compat: old 4-col format (word, remembered, wrongCount, studyCount)
      wrongCount[word] = parseInt(parts[2]?.trim(), 10) || 0;
      studyCount[word] = parseInt(parts[3]?.trim(), 10) || 0;
    } else {
      // New 3-col format (word, wrongCount, studyCount)
      wrongCount[word] = parseInt(col1, 10) || 0;
      studyCount[word] = parseInt(parts[2].trim(), 10) || 0;
    }
  }

  return { wrongCount, studyCount, warning };
}

// ===========================
// Deck Management
// ===========================
function buildDeck() {
  const words = wordData[state.level] || [];
  state.deck = shuffle(words.filter(w => !isMastered(w.word)));
}

// ===========================
// Card Rendering
// ===========================
function renderCard() {
  const word = state.deck[state.currentIndex];
  if (!word) return;

  // Prevent back-face flash: force reflow after setting transition:none,
  // ensuring the instant unflip takes effect before any paint.
  els.cardInner.style.transition = 'none';
  void els.cardInner.offsetHeight;
  els.cardInner.classList.remove('flipped');

  // Reset container instantly — no entrance animation
  els.cardContainer.style.transition = 'none';
  els.cardContainer.style.transform  = '';
  els.cardContainer.style.opacity    = '';

  const frontText = state.reverseMode ? word.meaning : word.word;
  const backText  = state.reverseMode ? word.word    : word.meaning;

  els.wordText.textContent    = frontText;
  els.meaningText.textContent = backText;
  els.posText.textContent     = posLabel(word.pos);
  els.frontHintText.textContent = state.reverseMode
    ? 'タップして英単語を確認'
    : 'タップして意味を確認';

  state.isFlipped = false;
  els.swipeHint.style.display = 'none';
  els.overlayRemembered.style.opacity = 0;
  els.overlayForgotten.style.opacity  = 0;

  els.progressLabel.textContent = `${state.currentIndex + 1} / ${state.deck.length}`;
  els.levelLabel.textContent    = state.level;

  // Re-enable flip transition for future taps
  requestAnimationFrame(() => {
    els.cardInner.style.transition = '';
  });
}

function flipCard() {
  // Block only during card fly-off; the flip CSS animation itself is interruptible
  if (isAnimating) return;

  state.isFlipped = !state.isFlipped;

  if (state.isFlipped) {
    els.cardInner.classList.add('flipped');
    els.swipeHint.style.display = 'flex';
  } else {
    els.cardInner.classList.remove('flipped');
    els.swipeHint.style.display = 'none';
  }
}

// ===========================
// Swipe / Drag
// ===========================
function onDragStart(e) {
  if (isAnimating) return;
  drag.startX = getClientX(e);
  drag.deltaX = 0;
  drag.isDragging = false;
  drag.isSwipeDragging = false;

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('mouseup', onDragEnd);
  document.addEventListener('touchend', onDragEnd);
}

function onDragMove(e) {
  drag.deltaX = getClientX(e) - drag.startX;

  if (Math.abs(drag.deltaX) > 5) drag.isDragging = true;

  if (drag.isDragging) {
    drag.isSwipeDragging = true;
    e.preventDefault();

    els.cardContainer.style.transition = 'none';
    els.cardContainer.style.transform =
      `translateX(${drag.deltaX}px) rotate(${drag.deltaX * 0.05}deg)`;

    const pct = Math.min(Math.abs(drag.deltaX) / 100, 1);
    if (drag.deltaX > 0) {
      els.overlayRemembered.style.opacity = pct * 0.5;
      els.overlayForgotten.style.opacity  = 0;
    } else {
      els.overlayForgotten.style.opacity  = pct * 0.5;
      els.overlayRemembered.style.opacity = 0;
    }
  }
}

function onDragEnd() {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('touchmove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  document.removeEventListener('touchend', onDragEnd);

  if (drag.isSwipeDragging) {
    if (Math.abs(drag.deltaX) > 100) {
      const dir    = drag.deltaX > 0 ? 1 : -1;
      const result = dir > 0 ? 'remembered' : 'forgotten';
      animateOffScreen(dir, () => registerSwipe(result));
    } else {
      snapBack();
    }
  } else if (!drag.isDragging) {
    flipCard();
  }

  drag.isDragging = false;
  drag.isSwipeDragging = false;
}

function snapBack() {
  els.cardContainer.style.transition = 'transform 0.3s ease';
  els.cardContainer.style.transform  = 'translateX(0) rotate(0deg)';
  els.overlayRemembered.style.opacity = 0;
  els.overlayForgotten.style.opacity  = 0;

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    els.cardContainer.style.transition = '';
    els.cardContainer.style.transform  = '';
  };
  els.cardContainer.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 400);
}

function animateOffScreen(dir, callback) {
  isAnimating = true;
  els.cardContainer.style.transition = 'transform 0.35s ease';
  els.cardContainer.style.transform  = `translateX(${dir * 600}px) rotate(${dir * 20}deg)`;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    els.overlayRemembered.style.opacity = 0;
    els.overlayForgotten.style.opacity  = 0;
    // Hide card before content update to prevent back-face flash on next card
    els.cardContainer.style.transition = 'none';
    els.cardContainer.style.opacity    = '0';
    isAnimating = false;
    callback();
  };
  els.cardContainer.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 450);
}

function registerSwipe(result) {
  const word = state.deck[state.currentIndex];
  if (!word) return;

  if (result === 'forgotten') {
    state.wrongCount[word.word] = (state.wrongCount[word.word] || 0) + 1;
  }
  state.studyCount[word.word] = (state.studyCount[word.word] || 0) + 1;

  nextCard();
}

function nextCard() {
  state.currentIndex++;

  if (state.currentIndex < state.deck.length) {
    renderCard();
    return;
  }

  const remaining = (wordData[state.level] || []).filter(w => !isMastered(w.word));

  if (remaining.length === 0) {
    showResult('complete');
  } else {
    buildDeck();
    state.currentIndex = 0;
    renderCard();
  }
}

// ===========================
// Result Screen
// ===========================
function showResult(reason) {
  showScreen('screen-result');

  els.resultTitle.textContent   = reason === 'complete' ? '完了！' : '中断';
  els.btnContinue.style.display = reason === 'complete' ? 'none' : 'block';

  const levelWords    = wordData[state.level] || [];
  const masteredCount = levelWords.filter(w => isMastered(w.word)).length;
  const unmastered    = levelWords.length - masteredCount;
  const acc = levelWords.length > 0
    ? Math.round((masteredCount / levelWords.length) * 100)
    : 0;

  const criteriaLabel = state.mastery.mode === 'ratio'
    ? `正解率${state.mastery.ratioThreshold}%以上`
    : `正解${state.mastery.countThreshold}回以上`;

  els.statTotal.textContent      = `総単語数: ${levelWords.length}語`;
  els.statRemembered.textContent = `習得済み: ${masteredCount}語（${criteriaLabel}）`;
  els.statForgotten.textContent  = `未習得: ${unmastered}語`;
  els.statAccuracy.textContent   = `習得率: ${acc}%`;

  els.saveTextarea.value = generateSaveText();
}

function generateSaveText() {
  const words = wordData[state.level] || [];
  const lines = [
    'CEFR-J英単語帳 セーブデータ',
    `レベル: ${state.level}`,
    `日付: ${formatDate(new Date())}`,
    '---',
    '単語,間違えた回数,やった回数',
    ...words.map(w => {
      const wrong = state.wrongCount[w.word] || 0;
      const study = state.studyCount[w.word] || 0;
      return `${w.word},${wrong},${study}`;
    }),
    '---',
  ];
  return lines.join('\n');
}

function downloadSave() {
  const text = els.saveTextarea.value;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `wordbook-${state.level}-${formatDate(new Date()).slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===========================
// Actions
// ===========================
function restartApp() {
  state = {
    level: 'A1',
    deck: [],
    currentIndex: 0,
    isFlipped: false,
    reverseMode: false,
    wrongCount: {},
    studyCount: {},
    mastery: { mode: 'ratio', ratioThreshold: 80, countThreshold: 2 },
  };
  els.saveInput.value = '';
  els.saveWarning.textContent = '';
  els.levelBtns.forEach(b => b.classList.remove('selected'));
  els.levelBtns[0].classList.add('selected');
  els.modeBtns.forEach(b => b.classList.remove('selected'));
  els.modeBtns[0].classList.add('selected');
  els.masteryBtns.forEach(b => b.classList.remove('selected'));
  els.masteryBtns[0].classList.add('selected');
  els.ratioThresholdInput.value = '80';
  els.countThresholdInput.value = '2';
  updateMasteryInputVisibility();
  showScreen('screen-welcome');
}

function continueStudy() {
  showScreen('screen-study');
  renderCard();
}

// ===========================
// Init
// ===========================
document.addEventListener('DOMContentLoaded', () => {
  els = {
    levelBtns:           document.querySelectorAll('.level-btn'),
    modeBtns:            document.querySelectorAll('.mode-btn'),
    masteryBtns:         document.querySelectorAll('.mastery-btn'),
    masteryInputRatio:   document.getElementById('mastery-input-ratio'),
    masteryInputCount:   document.getElementById('mastery-input-count'),
    ratioThresholdInput: document.getElementById('ratio-threshold'),
    countThresholdInput: document.getElementById('count-threshold'),
    saveInput:           document.getElementById('save-input'),
    saveWarning:         document.getElementById('save-warning'),
    btnStart:            document.getElementById('btn-start'),
    levelLabel:          document.getElementById('level-label'),
    progressLabel:       document.getElementById('progress-label'),
    btnInterrupt:        document.getElementById('btn-interrupt'),
    cardContainer:       document.getElementById('card-container'),
    cardInner:           document.getElementById('card-inner'),
    wordText:            document.getElementById('word-text'),
    meaningText:         document.getElementById('meaning-text'),
    posText:             document.getElementById('pos-text'),
    frontHintText:       document.querySelector('#card-front .hint-text'),
    swipeHint:           document.getElementById('swipe-hint'),
    overlayRemembered:   document.getElementById('overlay-remembered'),
    overlayForgotten:    document.getElementById('overlay-forgotten'),
    resultTitle:         document.getElementById('result-title'),
    statTotal:           document.getElementById('stat-total'),
    statRemembered:      document.getElementById('stat-remembered'),
    statForgotten:       document.getElementById('stat-forgotten'),
    statAccuracy:        document.getElementById('stat-accuracy'),
    saveTextarea:        document.getElementById('save-textarea'),
    btnSave:             document.getElementById('btn-save'),
    btnRestart:          document.getElementById('btn-restart'),
    btnContinue:         document.getElementById('btn-continue'),
  };

  initWelcomeScreen();

  els.btnInterrupt.addEventListener('click', () => showResult('interrupt'));
  els.cardContainer.addEventListener('mousedown', onDragStart);
  els.cardContainer.addEventListener('touchstart', onDragStart, { passive: true });
  els.btnSave.addEventListener('click', downloadSave);
  els.btnRestart.addEventListener('click', restartApp);
  els.btnContinue.addEventListener('click', continueStudy);
});
