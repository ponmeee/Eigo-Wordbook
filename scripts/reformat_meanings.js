/**
 * Reformat Japanese meanings in words_translated.js using LM Studio
 *
 * Reads each entry's meaning + pos, sends it to LM Studio's local API for
 * simplification (removes EJDict markers like 『』《》…), then writes the
 * result to words_formatted.js.
 *
 * Usage:
 *   node scripts/reformat_meanings.js [--in <file>] [--out <file>] [--concurrency <n>]
 *   Defaults: --in data/words_translated.js  --out data/words_formatted.js  --concurrency 3
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
};

const INPUT_FILE  = arg('--in',          path.join(DATA_DIR, 'words_translated.js'));
const OUTPUT_FILE = arg('--out',         path.join(DATA_DIR, 'words_formatted.js'));
const CONCURRENCY = parseInt(arg('--concurrency', '3'), 10);

const LM_STUDIO_HOST  = 'localhost';
const LM_STUDIO_PORT  = 1234;
const LM_STUDIO_MODEL = 'local-model';

// ---------------------------------------------------------------------------
// LM Studio
// ---------------------------------------------------------------------------

function askLMStudio(word, pos, meaning) {
  const prompt =
    `英単語「${word}」（品詞: ${pos}）の日本語訳を以下の元の意味から簡潔に整形してください。\n` +
    `元の意味: ${meaning}\n\n` +
    `出力ルール:\n` +
    `・「 『 』 《 》 … 〈 〉 〈 〉 」などの記号を除去する\n` +
    `・最重要な意味を1〜3個だけ残す（複数は「；」で区切る）\n` +
    `・品詞「${pos}」として自然な日本語にする\n` +
    `・日本語の意味のみを出力する（前置き・説明文は不要）`;

  const body = JSON.stringify({
    model:       LM_STUDIO_MODEL,
    messages:    [{ role: 'user', content: prompt }],
    temperature: 0.2,
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
        res.on('data',  c => chunks.push(c));
        res.on('end',   () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(json.choices?.[0]?.message?.content?.trim() || null);
          } catch (e) { reject(e); }
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
// Concurrency pool
// ---------------------------------------------------------------------------

async function pool(items, fn, limit) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const source = fs.readFileSync(INPUT_FILE, 'utf8');

  // Match entries — handles escaped quotes/backslashes inside strings
  const pattern = /\{ word: "((?:[^"\\]|\\.)+)",(\s+)meaning: "((?:[^"\\]|\\.)*)", pos: "((?:[^"\\]|\\.)+)" \}/g;

  const entries = [];
  let m;
  while ((m = pattern.exec(source)) !== null) {
    entries.push({
      start:   m.index,
      end:     m.index + m[0].length,
      word:    m[1],
      spaces:  m[2],
      meaning: m[3],
      pos:     m[4],
    });
  }

  process.stderr.write(`Input : ${INPUT_FILE}\n`);
  process.stderr.write(`Output: ${OUTPUT_FILE}\n`);
  process.stderr.write(`Found ${entries.length} entries — reformatting (concurrency=${CONCURRENCY})...\n\n`);

  let success = 0;
  let failed  = 0;

  const results = await pool(entries, async (entry, i) => {
    // Unescape JS string escapes before sending to LM Studio
    const rawMeaning = entry.meaning
      .replace(/\\"/g,  '"')
      .replace(/\\\\/g, '\\')
      .replace(/\s*\(AI\)$/, '');  // strip "(AI)" tag if present

    try {
      const result = await askLMStudio(entry.word, entry.pos, rawMeaning);
      if (result) {
        success++;
        process.stderr.write(`[${i + 1}/${entries.length}] ${entry.word} (${entry.pos}): ${result}\n`);
        return result;
      }
      failed++;
      process.stderr.write(`[${i + 1}/${entries.length}] ${entry.word}: (empty response)\n`);
      return null;
    } catch (err) {
      failed++;
      process.stderr.write(`[${i + 1}/${entries.length}] ${entry.word}: ERROR ${err.message}\n`);
      return null;
    }
  }, CONCURRENCY);

  // Apply replacements from end to start to preserve string indices
  const changes = entries
    .map((e, i) => ({ ...e, result: results[i] }))
    .filter(e => e.result !== null)
    .sort((a, b) => b.start - a.start);

  let output = source;
  for (const { start, end, word, spaces, pos, result } of changes) {
    const escaped = result.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    output =
      output.slice(0, start) +
      `{ word: "${word}",${spaces}meaning: "${escaped}", pos: "${pos}" }` +
      output.slice(end);
  }

  fs.writeFileSync(OUTPUT_FILE, output, 'utf8');

  process.stderr.write(`\nDone.\n`);
  process.stderr.write(`  Reformatted: ${success}\n`);
  process.stderr.write(`  Failed     : ${failed}\n`);
  process.stderr.write(`  Wrote      : ${OUTPUT_FILE}\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
