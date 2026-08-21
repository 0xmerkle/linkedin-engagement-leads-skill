#!/usr/bin/env node
/**
 * Drop people who already appeared in an earlier run.
 *
 * Usage:
 *   node scripts/filter-new.mjs --run run.json --seen seen.txt [--out new.json]
 *
 *   --run <file>    output of run-actor.mjs
 *   --seen <file>   one leadId per line, gathered from previous run sheets. Missing file = nothing seen.
 *   --out <file>    where to write the filtered result   (default new.json)
 *
 * Deduplication is by leadId, which is a stable hash of the normalized profile URL — so it survives
 * someone changing their headline, their job, or a trailing slash.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];

if (!args.run) {
    console.error('Usage: node scripts/filter-new.mjs --run run.json --seen seen.txt [--out new.json]');
    process.exit(1);
}

const run = JSON.parse(readFileSync(args.run, 'utf8'));
const seen = new Set(
    args.seen && existsSync(args.seen)
        ? readFileSync(args.seen, 'utf8')
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean)
        : [],
);

const fresh = run.people.filter((p) => !seen.has(p.leadId));
const outPath = args.out ?? 'new.json';
writeFileSync(outPath, `${JSON.stringify({ ...run, people: fresh }, null, 2)}\n`);

const dropped = run.people.length - fresh.length;
console.error(`${fresh.length} new, ${dropped} already seen (${seen.size} in history) → ${outPath}`);
