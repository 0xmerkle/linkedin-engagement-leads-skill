#!/usr/bin/env node
/**
 * Turn scored people into CSV ready for Google Sheets.
 *
 * Usage:
 *   node scripts/to-sheet-csv.mjs --scored scored.json [--out leads.csv] [--min-fit 0]
 *
 *   --scored <file>   JSON array, or {people:[...]}, where each entry is an Actor row plus your
 *                     icpFit, verdict and whyNow
 *   --out <file>      where to write the CSV                    (default leads.csv)
 *   --min-fit <n>     drop anyone below this score              (default 0, keep everyone)
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

const kept = people
    .filter((p) => Number(p.icpFit ?? 0) >= minFit)
    .sort((a, b) => {
        const byFit = Number(b.icpFit ?? 0) - Number(a.icpFit ?? 0);
        if (byFit !== 0) return byFit;
        const aWrote = a.engagementType !== 'reaction' ? 0 : 1;
        const bWrote = b.engagementType !== 'reaction' ? 0 : 1;
        if (aWrote !== bWrote) return aWrote - bWrote;
        return Number(b.timesSeen ?? 0) - Number(a.timesSeen ?? 0);
    });

const csv = [COLUMNS.join(','), ...kept.map((p) => COLUMNS.map((c) => cell(p[c])).join(','))].join('\n');
const outPath = args.out ?? 'leads.csv';
writeFileSync(outPath, `${csv}\n`);

const strong = kept.filter((p) => Number(p.icpFit ?? 0) >= 70).length;
console.error(`${kept.length} rows (${strong} scoring 70+) → ${outPath}`);
