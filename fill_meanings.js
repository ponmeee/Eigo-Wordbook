/**
 * Fill in Japanese meanings in words_generated.js using EJDict-hand
 *
 * Dataset : EJDict by kujirahand
 *           https://github.com/kujirahand/EJDict
 *           Licence : Public Domain
 *
 * For words not found by exact match, common suffixes are stripped to
 * find the base form in EJDict (e.g. "abnormally" → "abnormal").
 *
 * Usage
 *   node fill_meanings.js [--out <file>]
 *   Default output: words_translated.js
 */

'use strict';

const https = require('https');
const fs    = require('fs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const EJDICT_BASE   = 'https://raw.githubusercontent.com/kujirahand/EJDict/master/src/';
const LETTERS       = 'abcdefghijklmnopqrstuvwxyz'.split('');
const TEMPLATE_FILE = 'words_generated.js';

const outIndex    = process.argv.indexOf('--out');
const OUTPUT_FILE = outIndex !== -1 ? process.argv[outIndex + 1] : 'words_translated.js';

const MAX_MEANINGS = 2; // max "/" segments to keep per EJDict entry

// ---------------------------------------------------------------------------
// HTTP helper
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

// ---------------------------------------------------------------------------
// EJDict
// ---------------------------------------------------------------------------

function parseEJDict(text, dict) {
  for (const line of text.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const headwords  = line.slice(0, tab).split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
    const rawMeaning = line.slice(tab + 1).trim();
    if (!rawMeaning) continue;
    const parts = rawMeaning.split('/').map(s => s.trim()).filter(Boolean);
    for (const word of headwords) {
      if (dict.has(word)) dict.get(word).push(...parts);
      else                dict.set(word, [...parts]);
    }
  }
}

function pickMeaning(parts) {
  const japanese = parts.filter(p => /[　-鿿豈-﫿＀-￯]/.test(p));
  const chosen   = (japanese.length ? japanese : parts).slice(0, MAX_MEANINGS);
  return chosen.join('；');
}

// ---------------------------------------------------------------------------
// Stemming — generate candidate base-forms to look up in EJDict
// ---------------------------------------------------------------------------

function getCandidates(word) {
  const w = word.toLowerCase();
  const seen = new Set([w]);
  const push = (s) => { if (s && s.length > 1) seen.add(s); };
  /*
  // un- prefix (unpromising → promising)
  if (w.startsWith('un') && w.length > 4) push(w.slice(2));

  // -ically (dynamically → dynamic)
  if (w.endsWith('ically') && w.length > 8) push(w.slice(0, -6) + 'ic');

  // -ingly (admiringly → admire)
  if (w.endsWith('ingly') && w.length > 7) push(w.slice(0, -5) + 'e');

  // -ly (abnormally → abnormal, adversely → adverse)
  if (w.endsWith('ly') && w.length > 4) push(w.slice(0, -2));

  // -ness (naturalness → natural)
  if (w.endsWith('ness') && w.length > 6) push(w.slice(0, -4));

  // -able/-ible (affordable → afford)
  if (w.endsWith('able') && w.length > 6) { push(w.slice(0, -4)); push(w.slice(0, -4) + 'e'); }
  if (w.endsWith('ible') && w.length > 6) { push(w.slice(0, -4)); push(w.slice(0, -4) + 'e'); }

  // -ed past participle (adopted → adopt, addicted → addict)
  if (w.endsWith('ed') && w.length > 4) {
    const stem = w.slice(0, -2);
    push(stem);
    push(stem + 'e'); // hoped → hope
    // doubled consonant (metalled → metal)
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      push(stem.slice(0, -1));
    }
  }
    */

  // -s plural (norms → norm)
  if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) push(w.slice(0, -1));

  return [...seen];
}

function lookupInDict(word, dict) {
  for (const candidate of getCandidates(word)) {
    const parts = dict.get(candidate);
    if (parts && parts.length) return parts;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  process.stderr.write('Fetching EJDict (26 files) ...\n');
  const dict = new Map();
  await Promise.all(LETTERS.map(async (letter) => {
    const text = await fetchText(`${EJDICT_BASE}${letter}.txt`);
    parseEJDict(text, dict);
  }));
  process.stderr.write(`Loaded ${dict.size} entries from EJDict.\n\n`);

  const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');

  let filled   = 0;
  let notFound = 0;
  const missing = [];

  const output = template.replace(
    /\{ word: "([^"]+)",(\s+)meaning: "TODO", pos: "([^"]+)" \}/g,
    (match, word, spaces, pos) => {
      const parts = lookupInDict(word, dict);
      if (parts) {
        const meaning = pickMeaning(parts).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        filled++;
        return `{ word: "${word}",${spaces}meaning: "${meaning}", pos: "${pos}" }`;
      }
      notFound++;
      missing.push(word);
      return match;
    }
  );

  const header = [
    '// English vocabulary flashcard data — CEFR-J levels',
    '//',
    '// Word list sourced from:',
    '//   Open Language Profiles / CEFR-J Wordlist v1.5',
    '//   © Tono Lab, Tokyo University of Foreign Studies (CC BY-SA 4.0)',
    '//   https://github.com/openlanguageprofiles/olp-en-cefrj',
    '//',
    '//   Octanove Vocabulary Profile C1/C2 v1.0',
    '//   © Octanove Labs (CC BY 4.0)',
    '//',
    '// Japanese translations sourced from EJDict (Public Domain)',
    '//   https://github.com/kujirahand/EJDict',
    '// Run `node fill_meanings.js` to regenerate from words_template.js.',
  ].join('\n');

  const finalOutput = output.replace(
    /^(?:\/\/[^\n]*\n)+\n(?=const wordData)/,
    header + '\n\n'
  );

  fs.writeFileSync(OUTPUT_FILE, finalOutput, 'utf8');

  process.stderr.write(`Wrote ${OUTPUT_FILE}\n`);
  process.stderr.write(`  Filled   : ${filled}\n`);
  process.stderr.write(`  Not found: ${notFound}\n`);
  if (missing.length) {
    const unique = [...new Set(missing)].sort();
    process.stderr.write(`  Missing words: ${unique.join(', ')}\n`);
  }
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
