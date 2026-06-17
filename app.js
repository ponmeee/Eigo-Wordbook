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
  slideAnimation: true,
  deckSize: 20,
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
let drag = { startX: 0, startY: 0, deltaX: 0, deltaY: 0, isDragging: false, isSwipeDragging: false, isDownSwipe: false };

// isAnimating is ONLY set during card fly-off (animateOffScreen).
// The flip animation does NOT set this flag, so flipping is freely interruptible.
let isAnimating = false;

let resultReason = '';

// ===========================
// LocalStorage
// ===========================
function storageKey() {
  return 'wordbook-' + state.level;
}

function saveToLocalStorage() {
  const data = {
    wrongCount: state.wrongCount,
    studyCount: state.studyCount,
    savedAt: formatDate(new Date()),
  };
  localStorage.setItem(storageKey(), JSON.stringify(data));
}

function loadFromLocalStorage(level) {
  const raw = localStorage.getItem('wordbook-' + level);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (typeof data.wrongCount !== 'object' || typeof data.studyCount !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

function clearLocalStorage() {
  localStorage.removeItem(storageKey());
}

function updateSaveStatus() {
  const data = loadFromLocalStorage(state.level);
  if (!data) {
    els.saveStatus.textContent = 'セーブデータなし';
    els.btnClearSave.hidden = true;
    return;
  }
  els.saveStatus.textContent = `セーブデータあり（${data.savedAt}）`;
  els.btnClearSave.hidden = false;
}

// ===========================
// Helpers
// ===========================
function getClientX(e) {
  return e.touches ? e.touches[0].clientX : e.clientX;
}

function getClientY(e) {
  return e.touches ? e.touches[0].clientY : e.clientY;
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
      updateSaveStatus();
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

  els.deckSizeInput.addEventListener('change', () => {
    let v = parseInt(els.deckSizeInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    els.deckSizeInput.value = v;
    state.deckSize = v;
  });

  els.btnStart.addEventListener('click', () => {
    state.wrongCount = {};
    state.studyCount = {};

    const saved = loadFromLocalStorage(state.level);
    if (saved) {
      state.wrongCount = saved.wrongCount;
      state.studyCount = saved.studyCount;
    }

    buildDeck();

    if (state.deck.length === 0) {
      showResult('complete');
      els.resultTitle.textContent = 'すべての単語を習得済みです！';
      return;
    }

    state.currentIndex = 0;
    state.isFlipped = false;
    // ウェルカム画面の設定を設定モーダルに同期してから適用
    els.settingsFlipAnim.checked  = els.welcomeFlipAnim.checked;
    els.settingsSlideAnim.checked = els.welcomeSlideAnim.checked;
    state.slideAnimation = els.settingsSlideAnim.checked;
    els.cardInner.classList.toggle('no-flip-animation', !els.settingsFlipAnim.checked);
    showScreen('screen-study');
    renderCard();
  });
}

function updateMasteryInputVisibility() {
  els.masteryInputRatio.style.display = state.mastery.mode === 'ratio' ? 'flex' : 'none';
  els.masteryInputCount.style.display = state.mastery.mode === 'count' ? 'flex' : 'none';
}

function generateSaveText(level, wrongCount, studyCount) {
  const words = wordData[level] || [];
  const lines = [
    'CEFR-J英単語帳 セーブデータ',
    `レベル: ${level}`,
    `日付: ${formatDate(new Date())}`,
    '---',
    '単語,間違えた回数,やった回数',
    ...words.map(w => `${w.word},${wrongCount[w.word] || 0},${studyCount[w.word] || 0}`),
    '---',
  ];
  return lines.join('\n');
}

function parseSaveData(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (!lines[0]?.includes('CEFR-J英単語帳')) return null;
  const first = lines.findIndex(l => l === '---');
  if (first === -1) return null;
  const second = lines.indexOf('---', first + 1);
  if (second === -1) return null;

  const wrongCount = {}, studyCount = {};
  for (let i = first + 2; i < second; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;
    const word = parts[0].trim();
    const col1 = parts[1].trim();
    if (col1 === 'true' || col1 === 'false') {
      wrongCount[word] = parseInt(parts[2]?.trim(), 10) || 0;
      studyCount[word] = parseInt(parts[3]?.trim(), 10) || 0;
    } else {
      wrongCount[word] = parseInt(col1, 10) || 0;
      studyCount[word] = parseInt(parts[2].trim(), 10) || 0;
    }
  }
  return { wrongCount, studyCount };
}

function initSaveSection() {
  updateSaveStatus();

  // 5秒長押しでデータ削除
  let pressTimer = null, pressRaf = null, pressStart = null;

  function startPress(e) {
    if (e.type === 'touchstart') e.preventDefault();
    pressStart = Date.now();
    els.btnClearSave.classList.add('pressing');

    (function tick() {
      const pct = Math.min((Date.now() - pressStart) / 5000, 1) * 100;
      const remaining = Math.ceil((5000 - (Date.now() - pressStart)) / 1000);
      els.btnClearSave.textContent = `削除中... ${remaining}`;
      els.btnClearSave.style.background =
        `linear-gradient(to right, #e74c3c ${pct}%, #fff ${pct}%)`;
      if (pct < 100) {
        pressRaf = requestAnimationFrame(tick);
      }
    })();

    pressTimer = setTimeout(() => {
      clearLocalStorage();
      updateSaveStatus();
      cancelPress();
    }, 5000);
  }

  function cancelPress() {
    clearTimeout(pressTimer);
    cancelAnimationFrame(pressRaf);
    pressTimer = pressRaf = pressStart = null;
    els.btnClearSave.classList.remove('pressing');
    els.btnClearSave.style.background = '';
    els.btnClearSave.textContent = 'データをリセット';
  }

  els.btnClearSave.addEventListener('mousedown', startPress);
  els.btnClearSave.addEventListener('touchstart', startPress, { passive: false });
  els.btnClearSave.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('mouseup', cancelPress);
  document.addEventListener('touchend', cancelPress);

  // テキスト I/O トグル
  els.btnToggleTextIo.addEventListener('click', () => {
    const isHidden = els.textIoArea.hidden;
    els.textIoArea.hidden = !isHidden;
    els.btnToggleTextIo.textContent = isHidden ? 'テキスト ▴' : 'テキスト ▾';
    els.importWarning.textContent = '';
  });

  // エクスポート（LocalStorage → クリップボード）
  els.btnExportText.addEventListener('click', () => {
    const saved = loadFromLocalStorage(state.level);
    if (!saved) {
      els.importWarning.textContent = 'このレベルのセーブデータがありません。';
      return;
    }
    const text = generateSaveText(state.level, saved.wrongCount, saved.studyCount);
    navigator.clipboard.writeText(text).then(() => {
      const orig = els.btnExportText.textContent;
      els.btnExportText.textContent = 'コピーしました！';
      setTimeout(() => { els.btnExportText.textContent = orig; }, 2000);
      els.importWarning.textContent = '';
    }).catch(() => {
      els.importWarning.textContent = 'クリップボードへのアクセスが拒否されました。';
    });
  });

  // インポート（テキスト → LocalStorage）
  els.btnImportText.addEventListener('click', () => {
    const raw = els.importTextarea.value.trim();
    if (!raw) { els.importWarning.textContent = 'テキストを貼り付けてください。'; return; }
    const result = parseSaveData(raw);
    if (!result) {
      els.importWarning.textContent = '形式が正しくありません。';
      return;
    }
    const data = { wrongCount: result.wrongCount, studyCount: result.studyCount, savedAt: formatDate(new Date()) };
    localStorage.setItem(storageKey(), JSON.stringify(data));
    updateSaveStatus();
    els.importTextarea.value = '';
    els.importWarning.textContent = '読み込みました。';
    setTimeout(() => { els.importWarning.textContent = ''; }, 2000);
  });
}

// ===========================
// Deck Management
// ===========================
function buildDeck() {
  const words = wordData[state.level] || [];
  state.deck = shuffle(words.filter(w => !isMastered(w.word))).slice(0, state.deckSize);
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
  drag.startY = getClientY(e);
  drag.deltaX = 0;
  drag.deltaY = 0;
  drag.isDragging = false;
  drag.isSwipeDragging = false;
  drag.isDownSwipe = false;

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('mouseup', onDragEnd);
  document.addEventListener('touchend', onDragEnd);
}

function onDragMove(e) {
  drag.deltaX = getClientX(e) - drag.startX;
  drag.deltaY = getClientY(e) - drag.startY;

  const absDX = Math.abs(drag.deltaX);
  const absDY = Math.abs(drag.deltaY);

  if (!drag.isDragging && Math.max(absDX, absDY) > 5) {
    drag.isDragging = true;
    drag.isDownSwipe = drag.deltaY > 0 && absDY > absDX;
    if (!drag.isDownSwipe) drag.isSwipeDragging = true;
  }

  if (drag.isDragging) {
    e.preventDefault();

    if (drag.isDownSwipe) {
      const dy = Math.max(0, drag.deltaY);
      els.cardContainer.style.transition = 'none';
      els.cardContainer.style.transform  = `translateY(${dy}px)`;
      const pct = Math.min(dy / 100, 1);
      els.overlaySkip.style.opacity      = pct * 0.5;
      els.overlayRemembered.style.opacity = 0;
      els.overlayForgotten.style.opacity  = 0;
    } else {
      els.cardContainer.style.transition = 'none';
      els.cardContainer.style.transform  =
        `translateX(${drag.deltaX}px) rotate(${drag.deltaX * 0.05}deg)`;
      const pct = Math.min(absDX / 100, 1);
      if (drag.deltaX > 0) {
        els.overlayRemembered.style.opacity = pct * 0.5;
        els.overlayForgotten.style.opacity  = 0;
      } else {
        els.overlayForgotten.style.opacity  = pct * 0.5;
        els.overlayRemembered.style.opacity = 0;
      }
    }
  }
}

function onDragEnd() {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('touchmove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  document.removeEventListener('touchend', onDragEnd);

  if (drag.isDownSwipe) {
    if (drag.deltaY > 100) {
      animateOffScreenDown(skipCard);
    } else {
      snapBackDown();
    }
  } else if (drag.isSwipeDragging) {
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
  drag.isDownSwipe = false;
}

function snapBack() {
  els.overlayRemembered.style.opacity = 0;
  els.overlayForgotten.style.opacity  = 0;

  if (!state.slideAnimation) {
    els.cardContainer.style.transition = 'none';
    els.cardContainer.style.transform  = '';
    return;
  }

  els.cardContainer.style.transition = 'transform 0.3s ease';
  els.cardContainer.style.transform  = 'translateX(0) rotate(0deg)';

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

function snapBackDown() {
  els.overlaySkip.style.opacity = 0;

  if (!state.slideAnimation) {
    els.cardContainer.style.transition = 'none';
    els.cardContainer.style.transform  = '';
    return;
  }

  els.cardContainer.style.transition = 'transform 0.3s ease';
  els.cardContainer.style.transform  = 'translateY(0)';

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

function animateOffScreenDown(callback) {
  isAnimating = true;

  if (!state.slideAnimation) {
    els.overlaySkip.style.opacity       = 0;
    els.cardContainer.style.transition  = 'none';
    els.cardContainer.style.opacity     = '0';
    els.cardInner.style.transition      = 'none';
    void els.cardInner.offsetHeight;
    els.cardInner.classList.remove('flipped');
    state.isFlipped = false;
    isAnimating = false;
    callback();
    return;
  }

  els.cardContainer.style.transition = 'transform 0.35s ease';
  els.cardContainer.style.transform  = 'translateY(600px)';

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    els.overlaySkip.style.opacity       = 0;
    els.cardContainer.style.transition  = 'none';
    els.cardContainer.style.opacity     = '0';
    els.cardInner.style.transition      = 'none';
    void els.cardInner.offsetHeight;
    els.cardInner.classList.remove('flipped');
    state.isFlipped = false;
    isAnimating = false;
    callback();
  };
  els.cardContainer.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 450);
}

function skipCard() {
  nextCard();
}

function animateOffScreen(dir, callback) {
  isAnimating = true;

  if (!state.slideAnimation) {
    els.overlayRemembered.style.opacity = 0;
    els.overlayForgotten.style.opacity  = 0;
    els.cardContainer.style.transition = 'none';
    els.cardContainer.style.opacity    = '0';
    els.cardInner.style.transition = 'none';
    void els.cardInner.offsetHeight;
    els.cardInner.classList.remove('flipped');
    state.isFlipped = false;
    isAnimating = false;
    callback();
    return;
  }

  els.cardContainer.style.transition = 'transform 0.35s ease';
  els.cardContainer.style.transform  = `translateX(${dir * 600}px) rotate(${dir * 20}deg)`;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    els.overlayRemembered.style.opacity = 0;
    els.overlayForgotten.style.opacity  = 0;
    els.cardContainer.style.transition = 'none';
    els.cardContainer.style.opacity    = '0';
    // Reset to front face in 0 seconds while card is hidden
    els.cardInner.style.transition = 'none';
    void els.cardInner.offsetHeight;
    els.cardInner.classList.remove('flipped');
    state.isFlipped = false;
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

  saveToLocalStorage();
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
    showResult('round_complete');
  }
}

// ===========================
// Result Screen
// ===========================
function showResult(reason) {
  showScreen('screen-result');

  resultReason = reason;
  const titles = { complete: '完了！', round_complete: '区間終了！', interrupt: '中断' };
  els.resultTitle.textContent   = titles[reason] ?? '中断';
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

  saveToLocalStorage();
}

// ===========================
// Actions
// ===========================
function restartApp() {
  // clearLocalStorage();
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
  els.levelBtns.forEach(b => b.classList.remove('selected'));
  els.levelBtns[0].classList.add('selected');
  els.modeBtns.forEach(b => b.classList.remove('selected'));
  els.modeBtns[0].classList.add('selected');
  els.masteryBtns.forEach(b => b.classList.remove('selected'));
  els.masteryBtns[0].classList.add('selected');
  els.ratioThresholdInput.value = '80';
  els.countThresholdInput.value = '2';
  els.deckSizeInput.value = '20';
  updateMasteryInputVisibility();
  updateSaveStatus();
  showScreen('screen-welcome');
}

function continueStudy() {
  if (resultReason === 'round_complete') {
    buildDeck();
    state.currentIndex = 0;
  }
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
    deckSizeInput:       document.getElementById('deck-size-input'),
    saveStatus:          document.getElementById('save-status'),
    btnClearSave:        document.getElementById('btn-clear-save'),
    btnToggleTextIo:     document.getElementById('btn-toggle-text-io'),
    textIoArea:          document.getElementById('text-io-area'),
    btnExportText:       document.getElementById('btn-export-text'),
    importTextarea:      document.getElementById('import-textarea'),
    importWarning:       document.getElementById('import-warning'),
    btnImportText:       document.getElementById('btn-import-text'),
    welcomeFlipAnim:     document.getElementById('welcome-flip-anim'),
    welcomeSlideAnim:    document.getElementById('welcome-slide-anim'),
    btnStart:            document.getElementById('btn-start'),
    levelLabel:          document.getElementById('level-label'),
    progressLabel:       document.getElementById('progress-label'),
    btnSettings:         document.getElementById('btn-settings'),
    settingsModal:       document.getElementById('settings-modal'),
    settingsFlipAnim:    document.getElementById('flip-animation-checkbox'),
    settingsSlideAnim:   document.getElementById('slide-animation-checkbox'),
    btnSettingsClose:    document.getElementById('btn-settings-close'),
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
    overlaySkip:         document.getElementById('overlay-skip'),
    resultTitle:         document.getElementById('result-title'),
    statTotal:           document.getElementById('stat-total'),
    statRemembered:      document.getElementById('stat-remembered'),
    statForgotten:       document.getElementById('stat-forgotten'),
    statAccuracy:        document.getElementById('stat-accuracy'),
    btnRestart:          document.getElementById('btn-restart'),
    btnContinue:         document.getElementById('btn-continue'),
  };

  initWelcomeScreen();
  initSaveSection();

  els.btnSettings.addEventListener('click', () => {
    els.settingsModal.hidden = false;
  });
  els.btnSettingsClose.addEventListener('click', () => {
    els.settingsModal.hidden = true;
  });
  els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) els.settingsModal.hidden = true;
  });
  els.settingsFlipAnim.addEventListener('change', () => {
    els.cardInner.classList.toggle('no-flip-animation', !els.settingsFlipAnim.checked);
  });
  els.settingsSlideAnim.addEventListener('change', () => {
    state.slideAnimation = els.settingsSlideAnim.checked;
  });

  els.btnInterrupt.addEventListener('click', () => showResult('interrupt'));
  els.cardContainer.addEventListener('mousedown', onDragStart);
  els.cardContainer.addEventListener('touchstart', onDragStart, { passive: true });
  els.btnRestart.addEventListener('click', restartApp);
  els.btnContinue.addEventListener('click', continueStudy);

  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('screen-study').classList.contains('active')) return;
    if (isAnimating) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      animateOffScreen(-1, () => registerSwipe('forgotten'));
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      animateOffScreen(1, () => registerSwipe('remembered'));
    } else if (e.key === ' ' || e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
      e.preventDefault();
      flipCard();
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      e.preventDefault();
      animateOffScreenDown(skipCard);
    }
  });
});
