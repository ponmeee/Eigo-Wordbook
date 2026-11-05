'use strict';

// ===========================
// Config
// ===========================
const POS_JA = {
  noun: '名詞', verb: '動詞', adjective: '形容詞',
  adverb: '副詞', preposition: '前置詞', conjunction: '接続詞',
  pronoun: '代名詞', determiner: '限定詞', interjection: '感動詞',
};
const LEVELS  = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const COURSES = { 60: 'スプリント', 90: 'スタンダード', 120: 'エンデュランス' };
const MODES   = { show: '英単語を見て打つ', recall: '意味から思い出す' };
const MODE_NOTES = {
  show:   '意味と英単語を見ながら打ちます。',
  recall: '意味と頭文字だけが出ます。Space キーを押すか、カードが半分まで来るか、その単語で5回ミスすると答えが表示されます（その単語の得点は下がります）。',
};
const HINT_MISSES  = 5;    // 「意味から思い出す」で、1語あたりこの回数ミスすると答えを出す

const COMBO_STEP   = 5;    // この数だけノーミスで打ち切るごとに…
const BONUS_SEC    = 3;    // …残り時間がこれだけ増える
// 1語の得点 = (文字数 × LETTER_POINT + CLEAR_POINT) × 速さ倍率 × ミス倍率 × コンボ倍率 × モード倍率
const LETTER_POINT = 10;   // 1文字あたりの基本点
const CLEAR_POINT  = 50;   // 1単語打ち切りの基本点
const SPEED_MAX    = 2.0;  // 単語が出た直後に打ち切ったときの倍率
const SPEED_MIN    = 0.5;  // カードが消える寸前に打ち切ったときの倍率
const MISS_PENALTY = 0.15; // その単語でミスするたびに倍率から引く量
const MISS_FLOOR   = 0.2;  // ミス倍率の下限
const RECALL_BONUS = 1.5;  // 「意味から思い出す」でヒントなしの倍率

// ランク判定: (1秒あたりの正打鍵数 × 正確率 × モード補正) の下限
const RANKS = [
  { rank: 'S', min: 4.5 },
  { rank: 'A', min: 3.2 },
  { rank: 'B', min: 2.2 },
  { rank: 'C', min: 1.2 },
  { rank: 'D', min: 0 },
];

// ===========================
// Helpers
// ===========================
const $ = id => document.getElementById(id);

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
  },
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===========================
// Settings
// ===========================
const settings = (() => {
  const s = Object.assign({ levels: ['A1'], sec: 60, mode: 'show', sound: true, speech: true, showPoints: true }, store.get('wordrush-settings', {}));
  s.levels = Array.isArray(s.levels) ? s.levels.filter(l => LEVELS.includes(l) && wordData[l]?.length) : [];
  if (!s.levels.length) s.levels = ['A1'];
  if (!COURSES[s.sec]) s.sec = 60;
  if (!MODES[s.mode]) s.mode = 'show';
  s.sound = s.sound !== false;
  s.speech = s.speech !== false;
  s.showPoints = s.showPoints !== false;
  return s;
})();

function saveSettings() { store.set('wordrush-settings', settings); }

function bestKey() {
  return `wordrush-best-${settings.sec}-${settings.mode}-${LEVELS.filter(l => settings.levels.includes(l)).join('')}`;
}

// ===========================
// Sound (WebAudio の短いビープ音)
// ===========================
let audioCtx = null;

function beep(freq, dur, type = 'sine', vol = 0.05, delay = 0) {
  if (!settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime + delay;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
  } catch { /* 音が出せない環境では鳴らさない */ }
}

const sfx = {
  key:   () => beep(880, 0.04, 'triangle', 0.03),
  miss:  () => beep(140, 0.12, 'square', 0.035),
  clear: () => { beep(660, 0.08, 'triangle', 0.05); beep(990, 0.1, 'triangle', 0.05, 0.07); },
  lost:  () => beep(200, 0.3, 'sawtooth', 0.03),
  bonus: () => [523, 659, 784].forEach((f, i) => beep(f, 0.12, 'triangle', 0.05, i * 0.06)),
  count: (hi) => beep(hi ? 1046 : 523, 0.12, 'sine', 0.06),
};

// ===========================
// Speech (Web Speech API で英単語を読み上げる)
// ===========================
const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
let englishVoice = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  englishVoice =
    voices.find(v => v.lang === 'en-US' && /natural|google/i.test(v.name)) ||
    voices.find(v => v.lang === 'en-US') ||
    voices.find(v => v.lang.startsWith('en')) ||
    null;
}
if (canSpeak) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

function speak(text) {
  if (!canSpeak || !settings.speech) return;
  try {
    speechSynthesis.cancel();   // 前の単語の読み上げが残っていたら止める
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (englishVoice) u.voice = englishVoice;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  } catch { /* 読み上げできない環境では何もしない */ }
}

function stopSpeech() {
  if (canSpeak) try { speechSynthesis.cancel(); } catch { /* noop */ }
}

// ===========================
// Screens
// ===========================
let screen = 'title';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  screen = name;
}

// ===========================
// Title screen
// ===========================
function renderTitle() {
  document.querySelectorAll('#level-chips .chip').forEach(b => {
    const lv = b.dataset.level;
    b.disabled = !wordData[lv]?.length;
    b.classList.toggle('selected', settings.levels.includes(lv));
  });
  document.querySelectorAll('#course-chips .chip').forEach(b =>
    b.classList.toggle('selected', Number(b.dataset.sec) === settings.sec));
  document.querySelectorAll('#mode-chips .chip').forEach(b =>
    b.classList.toggle('selected', b.dataset.mode === settings.mode));
  $('mode-note').textContent = MODE_NOTES[settings.mode];
  $('sound-toggle').checked = settings.sound;
  $('speech-toggle').checked = canSpeak && settings.speech;
  $('speech-toggle').disabled = !canSpeak;
  $('points-toggle').checked = settings.showPoints;

  const best = store.get(bestKey(), null);
  $('best-line').textContent = best
    ? `この条件のベスト: ${best.score.toLocaleString()} 点（ランク ${best.rank}）`
    : 'この条件ではまだ記録がありません';
}

function initTitle() {
  // マウスで押したボタンにフォーカスが残ると Space が押しっぱなし扱いになるので外す
  const blurIfMouse = (e) => { if (e.detail > 0) e.currentTarget.blur(); };

  document.querySelectorAll('#level-chips .chip').forEach(b => b.addEventListener('click', (e) => {
    const lv = b.dataset.level;
    if (settings.levels.includes(lv)) {
      if (settings.levels.length === 1) return; // 最低1つは選ぶ
      settings.levels = settings.levels.filter(l => l !== lv);
    } else {
      settings.levels.push(lv);
    }
    saveSettings(); renderTitle(); blurIfMouse(e);
  }));
  document.querySelectorAll('#course-chips .chip').forEach(b => b.addEventListener('click', (e) => {
    settings.sec = Number(b.dataset.sec);
    saveSettings(); renderTitle(); blurIfMouse(e);
  }));
  document.querySelectorAll('#mode-chips .chip').forEach(b => b.addEventListener('click', (e) => {
    settings.mode = b.dataset.mode;
    saveSettings(); renderTitle(); blurIfMouse(e);
  }));
  $('sound-toggle').addEventListener('change', (e) => {
    settings.sound = e.target.checked;
    saveSettings();
  });
  $('speech-toggle').addEventListener('change', (e) => {
    settings.speech = e.target.checked;
    saveSettings();
  });
  $('points-toggle').addEventListener('change', (e) => {
    settings.showPoints = e.target.checked;
    saveSettings();
  });
  $('btn-start').addEventListener('click', startGame);
  $('btn-retry').addEventListener('click', startGame);
  $('btn-title').addEventListener('click', goTitle);
  $('pause').addEventListener('click', resume);
  $('type-word').addEventListener('animationend', (e) => e.currentTarget.classList.remove('shake'));
}

// ===========================
// Game state
// ===========================
const card = $('card');
const lane = $('lane');

let g = null;          // 現在のゲーム
let rafId = 0;
let countdownTimers = [];
let resultShownAt = 0;

function startGame() {
  cancelAnimationFrame(rafId);
  clearCountdown();
  stopSpeech();

  const pool = shuffle(settings.levels.flatMap(l => wordData[l] || []));
  g = {
    pool, poolIdx: 0,
    total: settings.sec, remaining: settings.sec, elapsed: 0,
    score: 0, combo: 0, maxCombo: 0,
    correctKeys: 0, missKeys: 0, cleared: 0,
    review: new Map(),
    cur: null, next: null,
    running: false, paused: false, lastTs: 0,
  };
  g.next = drawWord();

  showScreen('play');
  hideIme();
  $('type-points').hidden = !settings.showPoints;
  $('play-help').innerHTML = settings.mode === 'recall'
    ? '<kbd>Space</kbd> でヒント　<kbd>Esc</kbd> でやめる'
    : '<kbd>Esc</kbd> でやめる';
  $('pause').hidden = true;
  lane.querySelectorAll('.ghost, .pop').forEach(n => n.remove());
  spawn();
  updateHud();
  runCountdown();
}

function drawWord() {
  if (g.poolIdx >= g.pool.length) { shuffle(g.pool); g.poolIdx = 0; }
  return g.pool[g.poolIdx++];
}

function spawn() {
  const w = g.next;
  g.next = drawWord();
  const chars = [...w.word];

  // 長い単語ほどゆっくり、時間が経つほど少しずつ速く
  const speedUp = 1 + Math.min(g.elapsed / 120, 1) * 0.35;
  const base = (1.8 + chars.length * 0.5) * (settings.mode === 'recall' ? 1.5 : 1);

  g.cur = { w, chars, pos: 0, progress: 0, duration: base / speedUp, hadMiss: false, missCount: 0, hinted: false, cardW: 0 };

  $('card-pos').textContent = POS_JA[w.pos] || w.pos;
  $('card-meaning').textContent = w.meaning;
  // 流れるカードとは別に、中央のパネルにも意味を固定表示する
  $('type-pos').textContent = POS_JA[w.pos] || w.pos;
  $('type-meaning-text').textContent = w.meaning;
  card.classList.remove('danger');
  measure();
  positionCard();
  renderWord();
  $('type-next').hidden = settings.mode === 'recall';
  $('next-word').textContent = g.next.word;

  // 「英単語を見て打つ」は単語が出た時点で読み上げる（最初の1語はカウントダウン後の GO で読む）
  if (settings.mode === 'show' && g.running) speak(w.word);
}

// 「意味から思い出す」で答えを表示し、読み上げる
function giveHint() {
  if (g.cur.hinted) return;
  g.cur.hinted = true;
  renderWord();
  speak(g.cur.w.word);
}

function measure() {
  g.laneW = lane.clientWidth;
  if (g.cur) g.cur.cardW = card.offsetWidth;
}

// progress 0 で右端に全体が見え、1 で左端から完全に消える
const LANE_PAD = 14;
function cardX() {
  const start = g.laneW - g.cur.cardW - LANE_PAD;
  return start - g.cur.progress * (start + g.cur.cardW);
}

function positionCard() {
  card.style.setProperty('--x', cardX() + 'px');
  card.classList.toggle('danger', g.cur.progress > 0.72);
}

function renderWord() {
  const { chars, pos, hinted } = g.cur;
  const reveal = settings.mode === 'show' || hinted;
  const el = $('type-word');
  el.textContent = '';
  chars.forEach((c, i) => {
    const s = document.createElement('span');
    s.className = 'ch';
    let shown = c;
    if (i < pos) {
      s.classList.add('done');
    } else {
      s.classList.add(i === pos ? 'cur' : 'rest');
      if (!reveal && i > 0 && /[a-z]/i.test(c)) { shown = '_'; s.classList.add('blank'); }
    }
    s.textContent = shown === ' ' ? ' ' : shown;
    el.appendChild(s);
  });
  el.classList.toggle('hinted', settings.mode === 'recall' && hinted);
  fitWord();
}

// 英単語は折り返さず1行で表示する。パネルに収まらない長さなら文字を縮める
function fitWord() {
  const el = $('type-word');
  el.style.fontSize = '';
  const cs = getComputedStyle($('type-panel'));
  const avail = lane.clientWidth - 24 - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const width = el.scrollWidth;
  if (width > avail) {
    el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * avail / width * 0.98) + 'px';
  }
}

function multiplier() {
  const combo = 1 + Math.min(Math.floor(g.combo / COMBO_STEP), 4) * 0.25;  // 最大 2 倍
  const mode = settings.mode === 'recall' && !g.cur.hinted ? RECALL_BONUS : 1;
  return combo * mode;
}

// 今この瞬間に打ち切ったら入る点数
function wordPoints() {
  const cur = g.cur;
  const base = cur.chars.length * LETTER_POINT + CLEAR_POINT;
  const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * Math.max(0, 1 - cur.progress);
  const accuracy = Math.max(MISS_FLOOR, 1 - cur.missCount * MISS_PENALTY);
  return Math.round(base * speed * accuracy * multiplier());
}

function updateHud() {
  const points = $('type-points');
  points.textContent = `+${wordPoints()}`;
  points.classList.toggle('dim', g.cur.missCount > 0 || g.cur.progress > 0.72);
  $('hud-score').textContent = g.score.toLocaleString();
  $('hud-combo').textContent = g.combo;
  $('hud-time').textContent = Math.ceil(g.remaining);
  const ratio = Math.max(0, Math.min(1, g.remaining / g.total));
  $('time-fill').style.width = (ratio * 100) + '%';
  $('time-fill').classList.toggle('low', g.remaining <= 10);
}

// ===========================
// Countdown / loop / pause
// ===========================
function runCountdown() {
  const el = $('countdown');
  el.hidden = false;
  [3, 2, 1].forEach((n, i) => countdownTimers.push(setTimeout(() => {
    el.textContent = n; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
    sfx.count(false);
  }, i * 650)));
  countdownTimers.push(setTimeout(() => {
    el.textContent = 'GO!'; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
    sfx.count(true);
    g.running = true;
    if (settings.mode === 'show') speak(g.cur.w.word);
    g.lastTs = performance.now();
    rafId = requestAnimationFrame(loop);
  }, 3 * 650));
  countdownTimers.push(setTimeout(() => { el.hidden = true; }, 3 * 650 + 450));
}

function clearCountdown() {
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
  $('countdown').hidden = true;
}

function loop(ts) {
  if (!g || !g.running || g.paused) return;
  // タブが裏に回ると rAF が止まるので、dt を上限で切って実質一時停止にする
  const dt = Math.max(0, Math.min((ts - g.lastTs) / 1000, 0.1));
  g.lastTs = ts;

  g.remaining -= dt;
  g.elapsed += dt;
  g.cur.progress += dt / g.cur.duration;

  if (settings.mode === 'recall' && !g.cur.hinted && g.cur.progress >= 0.5) giveHint();
  if (g.cur.progress >= 1) loseWord();

  if (g.remaining <= 0) {
    g.remaining = 0;
    updateHud();
    finish();
    return;
  }
  positionCard();
  updateHud();
  rafId = requestAnimationFrame(loop);
}

function pause() {
  if (!g || !g.running || g.paused) return;
  g.paused = true;
  cancelAnimationFrame(rafId);
  $('pause').hidden = false;
}

function resume() {
  if (!g || !g.paused) return;
  g.paused = false;
  $('pause').hidden = true;
  g.lastTs = performance.now();
  rafId = requestAnimationFrame(loop);
}

// ===========================
// Typing
// ===========================
function handleChar(key) {
  const cur = g.cur;
  const expected = cur.chars[cur.pos];
  hideIme();

  if (key.toLowerCase() === expected.toLowerCase()) {
    cur.pos++;
    g.correctKeys++;
    sfx.key();
    if (cur.pos >= cur.chars.length) clearWord();
    else renderWord();
  } else {
    g.missKeys++;
    cur.hadMiss = true;
    cur.missCount++;
    g.combo = 0;
    sfx.miss();
    if (settings.mode === 'recall' && !cur.hinted && cur.missCount >= HINT_MISSES) giveHint();
    const word = $('type-word');
    word.classList.remove('shake'); void word.offsetWidth; word.classList.add('shake');
  }
  updateHud();
}

function clearWord() {
  const cur = g.cur;
  const gained = wordPoints();
  g.score += gained;
  g.cleared++;

  if (cur.hadMiss) addReview(cur.w, 'miss');
  if (cur.hinted)  addReview(cur.w, 'hint');

  // 「意味から思い出す」でヒントなしに打ち切ったら、ここで答え合わせとして読み上げる
  if (settings.mode === 'recall' && !cur.hinted) speak(cur.w.word);

  if (!cur.hadMiss) {
    g.combo++;
    g.maxCombo = Math.max(g.maxCombo, g.combo);
    if (g.combo % COMBO_STEP === 0) {
      g.remaining += BONUS_SEC;
      pop(`+${BONUS_SEC}秒`, 'pop-time');
      sfx.bonus();
    } else {
      sfx.clear();
    }
  } else {
    sfx.clear();
  }

  pop(`+${gained}`, 'pop-score');
  ghost('clear');
  spawn();
}

function loseWord() {
  addReview(g.cur.w, 'lost');
  g.combo = 0;
  sfx.lost();
  ghost('lost');
  spawn();
}

const REASON_ORDER = { miss: 1, hint: 2, lost: 3 };
const REASON_LABEL = { miss: 'ミスあり', hint: 'ヒント使用', lost: '時間切れ' };

function addReview(w, reason) {
  const key = w.word + '|' + w.pos;
  const prev = g.review.get(key);
  if (!prev || REASON_ORDER[reason] > REASON_ORDER[prev.reason]) g.review.set(key, { w, reason });
}

// 打ち切った / 流れていったカードの残像
function ghost(kind) {
  const el = card.cloneNode(true);
  el.removeAttribute('id');
  el.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  el.classList.remove('danger');
  el.classList.add('ghost', kind);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  lane.appendChild(el);
}

function pop(text, cls) {
  const el = document.createElement('span');
  el.className = 'pop ' + cls;
  el.textContent = text;
  const x = Math.max(40, Math.min(g.laneW - 40, cardX() + g.cur.cardW / 2));
  el.style.left = x + 'px';
  el.addEventListener('animationend', () => el.remove(), { once: true });
  lane.appendChild(el);
}

function showIme() { $('ime-warning').hidden = false; }
function hideIme() { $('ime-warning').hidden = true; }

// ===========================
// Result
// ===========================
function finish() {
  g.running = false;
  cancelAnimationFrame(rafId);

  const typed = g.correctKeys + g.missKeys;
  const acc = typed ? g.correctKeys / typed : 0;
  const kps = g.elapsed > 0 ? g.correctKeys / g.elapsed : 0;
  const effective = kps * acc * (settings.mode === 'recall' ? RECALL_BONUS : 1);
  const rank = RANKS.find(r => effective >= r.min).rank;

  const key = bestKey();
  const best = store.get(key, null);
  const isBest = g.score > 0 && (!best || g.score > best.score);
  if (isBest) store.set(key, { score: g.score, rank, date: new Date().toISOString() });

  const levels = LEVELS.filter(l => settings.levels.includes(l)).join(' / ');
  $('result-course').textContent = `${COURSES[settings.sec]}（${settings.sec}秒）・${MODES[settings.mode]}・${levels}`;
  const rankEl = $('rank');
  rankEl.textContent = rank;
  rankEl.className = 'rank-' + rank;
  $('result-score').textContent = `${g.score.toLocaleString()} 点`;
  $('best-badge').hidden = !isBest;

  $('r-cleared').textContent = `${g.cleared} 語`;
  $('r-keys').textContent    = `${g.correctKeys} 回`;
  $('r-miss').textContent    = `${g.missKeys} 回`;
  $('r-acc').textContent     = `${(acc * 100).toFixed(1)}%`;
  $('r-kps').textContent     = `${kps.toFixed(2)} 打`;
  $('r-combo').textContent   = `${g.maxCombo}`;

  const items = [...g.review.values()].sort((a, b) => REASON_ORDER[b.reason] - REASON_ORDER[a.reason]);
  const list = $('review-list');
  list.textContent = '';
  items.slice(0, 50).forEach(({ w, reason }) => {
    const li = document.createElement('li');
    const word = document.createElement('span');
    word.className = 'rv-word';
    word.textContent = w.word;
    const meaning = document.createElement('span');
    meaning.className = 'rv-meaning';
    meaning.textContent = `${POS_JA[w.pos] || w.pos}｜${w.meaning}`;
    const tag = document.createElement('span');
    tag.className = 'rv-tag rv-' + reason;
    tag.textContent = REASON_LABEL[reason];
    li.append(word, tag, meaning);
    list.appendChild(li);
  });
  $('review').hidden = items.length === 0;

  showScreen('result');
  resultShownAt = performance.now();
}

function goTitle() {
  if (g) { g.running = false; g.paused = false; }
  cancelAnimationFrame(rafId);
  clearCountdown();
  stopSpeech();
  renderTitle();
  showScreen('title');
}

// ===========================
// Keyboard
// ===========================
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (screen === 'title') {
    if ((e.key === ' ' || e.key === 'Enter') && !e.target.closest('button, input')) {
      e.preventDefault();
      startGame();
    }
    return;
  }

  if (screen === 'result') {
    // 打ち終わった直後の勢いで押したキーで再スタートしないよう、少し待つ
    if (performance.now() - resultShownAt < 800) return;
    if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); startGame(); }
    else if (e.key === 'Escape') goTitle();
    return;
  }

  // play
  if (e.key === 'Escape') { goTitle(); return; }
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229) { showIme(); return; }
  if (g.paused) { e.preventDefault(); resume(); return; }
  if (!g.running) return;
  if (e.key.length !== 1) return;   // Shift / Tab などは無視
  e.preventDefault();               // Space でのスクロールや ' のクイック検索を止める
  if (e.repeat) return;
  // Space はヒント（単語自体に空白が含まれ、今その位置を打つ場面だけは文字として扱う）
  if (e.key === ' ' && g.cur.chars[g.cur.pos] !== ' ') {
    if (settings.mode === 'recall') { giveHint(); updateHud(); }
    return;
  }
  handleChar(e.key);
});

window.addEventListener('blur', pause);
window.addEventListener('resize', () => {
  if (!g || screen !== 'play') return;
  measure();
  positionCard();
  fitWord();
});

// ===========================
// Init
// ===========================
initTitle();
renderTitle();
