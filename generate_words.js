/**
 * Generate words_template.js from Open Language Profiles / CEFR-J data
 *
 * Sources
 *   CEFR-J Wordlist v1.5 — Tono Lab, TUFS (CC BY-SA 4.0)
 *   Octanove Vocabulary Profile C1/C2 v1.0 — Octanove Labs (CC BY 4.0)
 *   https://github.com/openlanguageprofiles/olp-en-cefrj
 *
 * Usage
 *   node generate_words.js [words_per_level]
 *   Default: 50 words per level
 *
 * Output
 *   words_template.js  — fill in "meaning" (Japanese) to produce words.js
 */

'use strict';

const https = require('https');
const fs    = require('fs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const WORDS_PER_LEVEL = parseInt(process.argv[2], 10) || 50;
const OUTPUT_FILE     = 'words_template.js';

const SOURCES = [
  {
    url:    'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv',
    levels: new Set(['A1', 'A2', 'B1', 'B2']),
  },
  {
    url:    'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv',
    levels: new Set(['C1', 'C2']),
  },
];

// POS tags the flashcard app recognises
const ALLOWED_POS = new Set(['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction']);

// Normalise CEFR-J POS tags → app POS tags
const POS_MAP = {
  'modal auxiliary': 'verb',
  'have-verb':       'verb',
  'be-verb':         'verb',
  'do-verb':         'verb',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} — ${url}`));
        return;
      }
      const chunks = [];
      res.on('data',  chunk => chunks.push(chunk));
      res.on('end',   ()    => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseCSV(text) {
  return text.split(/\r?\n/).slice(1).map(line => {
    const cols = line.split(',');
    return {
      headword: (cols[0] || '').trim(),
      pos:      (cols[1] || '').trim().toLowerCase(),
      cefr:     (cols[2] || '').trim(),
    };
  }).filter(e => e.headword && e.pos && /^[ABC][12]$/.test(e.cefr));
}

function normalisePos(raw) {
  return POS_MAP[raw] || raw;
}

function isUsable(entry) {
  const pos = normalisePos(entry.pos);
  if (!ALLOWED_POS.has(pos)) return false;
  if (/[\s/]/.test(entry.headword))   return false; // multi-word / variant forms
  if (/^[A-Z]{2,}$/.test(entry.headword)) return false; // acronyms
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const LEVELS  = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const byLevel = Object.fromEntries(LEVELS.map(l => [l, []]));
  const seen    = new Set();

  for (const src of SOURCES) {
    process.stderr.write(`Fetching ${src.url} ...\n`);
    const text    = await fetchText(src.url);
    const entries = parseCSV(text);

    for (const e of entries) {
      if (!src.levels.has(e.cefr)) continue;
      if (!isUsable(e))             continue;

      const pos = normalisePos(e.pos);
      const key = `${e.cefr}:${e.headword}:${pos}`;
      if (seen.has(key)) continue;
      seen.add(key);

      byLevel[e.cefr].push({ word: e.headword, pos });
    }
  }

  // Build output lines
  const lines = [
    '// Generated from Open Language Profiles / CEFR-J',
    '// Source  : https://github.com/openlanguageprofiles/olp-en-cefrj',
    '// Licence : CEFR-J Wordlist v1.5 © Tono Lab, TUFS (CC BY-SA 4.0)',
    '//           Octanove Profile C1/C2 v1.0 © Octanove Labs (CC BY 4.0)',
    '//',
    '// Fill in each "meaning" field (Japanese) to produce words.js.',
    '',
    'const wordData = {',
  ];

  for (const level of LEVELS) {
    const words = byLevel[level].slice(0, WORDS_PER_LEVEL);
    lines.push(`  ${level}: [`);
    for (const w of words) {
      const pad = ' '.repeat(Math.max(1, 16 - w.word.length));
      lines.push(`    { word: "${w.word}",${pad}meaning: "TODO", pos: "${w.pos}" },`);
    }
    lines.push('  ],');
  }

  lines.push('};', '');

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8');

  process.stderr.write(`\nWrote ${OUTPUT_FILE}\n`);
  for (const level of LEVELS) {
    const n = Math.min(byLevel[level].length, WORDS_PER_LEVEL);
    process.stderr.write(`  ${level}: ${n} words\n`);
  }
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
