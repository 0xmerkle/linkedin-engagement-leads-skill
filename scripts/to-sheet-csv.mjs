#!/usr/bin/env node
/**
 * Turn scored people into CSV ready for Google Sheets.
 *
 * Usage:
 *   node scripts/to-sheet-csv.mjs --scored scored.json [--out leads.csv] [--min-fit 0]
 *
 *   --scored <file>    JSON array, or {people:[...]}, where each entry is an Actor row plus your
 *                      icpFit, verdict and whyNow
 *   --out <file>       where to write the CSV                    (default leads.csv)
 *   --min-fit <n>      drop anyone below this score              (default 0, keep everyone)
 *   --max-bytes <n>    raise the fit floor until the CSV fits    (default 0, no ceiling)
 *   --seen-out <file>  also write every leadId, one per line, regardless of score
 *   --drop <cols>      comma-separated columns to leave out of the sheet
 *
 * Exists so nothing has to hand-write CSV. LinkedIn comments routinely contain commas, quotation marks
 * and newlines; all three break a naively assembled row, and the break is silent — the sheet just ends up
 * with columns shifted from some row onward.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const COLUMNS = [
    'icpFit',
    'verdict',
    'name',
    'currentTitle',
    'currentCompany',
    'profileUrl',
    'whyNow',
    'commentText',
    'engagementType',
    'timesSeen',
    'targetsEngaged',
    'postUrl',
    'leadId',
];

/** RFC 4180: quote when the value holds a comma, quote, or line break; double any inner quotes. */
function cell(value) {
    if (value === null || value === undefined) return '';
    const s = Array.isArray(value) ? value.join('; ') : String(value);
    const flattened = s.replace(/\r\n|\r|\n/g, ' ').trim();
    return /[",]/.test(flattened) ? `"${flattened.replace(/"/g, '""')}"` : flattened;
}

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];

if (!args.scored) {
    console.error('Usage: node scripts/to-sheet-csv.mjs --scored scored.json [--out leads.csv] [--min-fit 0]');
    process.exit(1);
}

const parsed = JSON.parse(readFileSync(args.scored, 'utf8'));
const people = Array.isArray(parsed) ? parsed : (parsed.people ?? []);
const minFit = Number(args['min-fit'] ?? 0);

const byRank = (a, b) => {
    const byFit = Number(b.icpFit ?? 0) - Number(a.icpFit ?? 0);
    if (byFit !== 0) return byFit;
    const aWrote = a.engagementType !== 'reaction' ? 0 : 1;
    const bWrote = b.engagementType !== 'reaction' ? 0 : 1;
    if (aWrote !== bWrote) return aWrote - bWrote;
    return Number(b.timesSeen ?? 0) - Number(a.timesSeen ?? 0);
};

const ranked = people.filter((p) => Number(p.icpFit ?? 0) >= minFit).sort(byRank);

// Dropping a column buys rows. postUrl is the usual candidate: it is a quarter of the file and the
// least useful column in it, because commentText already carries the thing you would open the post to read.
const dropped = String(args.drop ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
const columns = COLUMNS.filter((c) => !dropped.includes(c));

const render = (rows) => `${[columns.join(','), ...rows.map((p) => columns.map((c) => cell(p[c])).join(','))].join('\n')}\n`;

/**
 * Raise the fit threshold until the sheet fits the budget.
 *
 * The Drive connector takes file content only as text inside the tool call, so every byte written to a
 * sheet is a byte the model has to generate. A 158KB sheet is roughly 40,000 output tokens: minutes of
 * silence, and past a point it cannot complete in one call at all. Degrading to a shorter, higher-quality
 * sheet beats hanging, and nobody was going to read row 400 anyway.
 *
 * Nobody is lost by this. The seen file below still records every leadId, and the full local CSV keeps
 * every row and column.
 */
function fitToBudget(rows, budgetBytes) {
    let out = rows;
    let floor = minFit;
    while (Buffer.byteLength(render(out)) > budgetBytes && out.length > 1) {
        floor += 5;
        const shorter = rows.filter((p) => Number(p.icpFit ?? 0) >= floor);
        if (!shorter.length) break;
        out = shorter;
    }
    return { rows: out, floor };
}

const budget = Number(args['max-bytes'] ?? 0);
const { rows: kept, floor } = budget > 0 ? fitToBudget(ranked, budget) : { rows: ranked, floor: minFit };

const outPath = args.out ?? 'leads.csv';
writeFileSync(outPath, render(kept));

// One leadId per line, for every person scored — not just the ones that made the sheet.
// Cross-run dedupe reads this back, so trimming the sheet must never trim the memory of who was seen.
if (args['seen-out']) {
    writeFileSync(args['seen-out'], `${['leadId', ...people.map((p) => p.leadId).filter(Boolean)].join('\n')}\n`);
}

const kb = (b) => `${(b / 1024).toFixed(1)}KB`;
const strong = kept.filter((p) => Number(p.icpFit ?? 0) >= 70).length;
console.error(`${kept.length} rows (${strong} scoring 70+) → ${outPath}  ${kb(Buffer.byteLength(render(kept)))}`);
if (floor > minFit) {
    console.error(`  NOTE: raised the fit floor to ${floor} to fit ${kb(budget)}; ${ranked.length - kept.length} lower-scoring rows are in the seen file only.`);
}
if (args['seen-out']) {
    console.error(`${people.length} leadIds → ${args['seen-out']}  ${kb(Buffer.byteLength(readFileSync(args['seen-out'])))}`);
}
