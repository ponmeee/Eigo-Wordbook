/**
 * Fill in Japanese meanings in words_generated.js using EJDict-hand
 *
 * Dataset : EJDict by kujirahand
 *           https://github.com/kujirahand/EJDict
 *           Licence : Public Domain
 *
 * For words not found by exact match, common suffixes are stripped to
 * find the base form in EJDict (e.g. "abnormally" → "abnormal").
 * For words still not found, LM Studio local API is used as fallback
 * and meanings are marked with "(AI)".
 *
 * Usage
 *   node fill_meanings.js [--out <file>] [--concurrency <n>]
 *   Default: --out words_translated.js  --concurrency 1
 *
 * Output
 *   words_translated.js — fill in "meaning" (Japanese) to produce words_formatted.js
 *   Default output: words_translated.js
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const EJDICT_BASE   = 'https://raw.githubusercontent.com/kujirahand/EJDict/master/src/';
const LETTERS       = 'abcdefghijklmnopqrstuvwxyz'.split('');
const TEMPLATE_FILE = 'words_generated.js';

const outIndex    = process.argv.indexOf('--out');
const concIndex   = process.argv.indexOf('--concurrency');
const OUTPUT_FILE = outIndex  !== -1 ? process.argv[outIndex  + 1] : 'words_translated.js';
const CONCURRENCY = concIndex !== -1 ? parseInt(process.argv[concIndex + 1], 10) : 1;

const MAX_MEANINGS = 2; // max "/" segments to keep per EJDict entry

// LM Studio local API (OpenAI-compatible)
const LM_STUDIO_HOST  = 'localhost';
const LM_STUDIO_PORT  = 1234;
const LM_STUDIO_MODEL = 'local-model'; // LM Studio ignores this value

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
// LM Studio
// ---------------------------------------------------------------------------

function askLMStudio(word, pos) {
  const prompt =
    `英単語「${word}」（品詞: ${pos}）の日本語の意味を簡潔に教えてください。` +
    `日本語の意味のみ答えてください。`;
  const body = JSON.stringify({
    model:       LM_STUDIO_MODEL,
    messages:    [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens:  80,
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: LM_STUDIO_HOST,
        port:     LM_STUDIO_PORT,
        path:     '/v1/chat/completions',
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data',  chunk => chunks.push(chunk));
        res.on('end',   () => {
          try {
            const json    = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const content = json.choices?.[0]?.message?.content?.trim() || null;
            resolve(content);
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
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
  const startTime = Date.now();
  process.stderr.write('Fetching EJDict (26 files) ...\n');
  const dict = new Map();
  await Promise.all(LETTERS.map(async (letter) => {
    const text = await fetchText(`${EJDICT_BASE}${letter}.txt`);
    parseEJDict(text, dict);
  }));
  process.stderr.write(`Loaded ${dict.size} entries from EJDict.\n\n`);

  const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');

  let filled   = 0;
  const needAI = []; // { word, spaces, pos } for EJDict misses

  // --- Pass 1: EJDict ---
  let output = template.replace(
    /\{ word: "([^"]+)",(\s+)meaning: "TODO", pos: "([^"]+)" \}/g,
    (match, word, spaces, pos) => {
      const parts = lookupInDict(word, dict);
      if (parts) {
        const meaning = pickMeaning(parts).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        filled++;
        return `{ word: "${word}",${spaces}meaning: "${meaning}", pos: "${pos}" }`;
      }
      needAI.push({ word, spaces, pos });
      return match; // keep "TODO" for pass 2
    }
  );

  // --- Pass 2: LM Studio fallback ---
  let aiCount  = 0;
  let notFound = 0;
  const stillMissing = [];

  if (needAI.length > 0) {
    process.stderr.write(`\nAsking LM Studio for ${needAI.length} missing words (concurrency=${CONCURRENCY})...\n`);

    const aiResults = new Array(needAI.length);
    let next = 0;

    async function aiWorker() {
      while (next < needAI.length) {
        const i = next++;
        const { word, spaces, pos } = needAI[i];
        try {
          const raw = await askLMStudio(word, pos);
          aiResults[i] = { word, spaces, pos, raw };
          process.stderr.write(`  [AI ${i + 1}/${needAI.length}] ${word}: ${raw ?? '(empty)'}\n`);
        } catch (err) {
          aiResults[i] = { word, spaces, pos, raw: null };
          process.stderr.write(`  [AI error] ${word}: ${err.message}\n`);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, needAI.length) }, aiWorker));

    for (const { word, spaces, pos, raw } of aiResults) {
      if (raw) {
        const meaning = (raw + ' (AI)').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        output = output.replace(
          `{ word: "${word}",${spaces}meaning: "TODO", pos: "${pos}" }`,
          `{ word: "${word}",${spaces}meaning: "${meaning}", pos: "${pos}" }`
        );
        aiCount++;
        filled++;
      } else {
        notFound++;
        stillMissing.push(word);
      }
    }
  }

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

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  process.stderr.write(`\nWrote ${OUTPUT_FILE}\n`);
  process.stderr.write(`  Filled (EJDict): ${filled - aiCount}\n`);
  process.stderr.write(`  Filled (AI)    : ${aiCount}\n`);
  process.stderr.write(`  Not found      : ${notFound}\n`);
  if (stillMissing.length) {
    const unique = [...new Set(stillMissing)].sort();
    process.stderr.write(`  Missing words: ${unique.join(', ')}\n`);
  }
  process.stderr.write(`  Time           : ${elapsed}s\n`);
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
