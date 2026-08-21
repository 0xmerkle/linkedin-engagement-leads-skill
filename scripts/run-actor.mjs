#!/usr/bin/env node
/**
 * Run the linkedin-engagement-leads Actor and save everything it produced.
 *
 * Usage:
 *   node scripts/run-actor.mjs --targets targets.txt [options]
 *   node scripts/run-actor.mjs --target https://www.linkedin.com/in/someone [options]
 *
 * Options:
 *   --targets <file>        file with one LinkedIn URL per line (blank lines and # comments ignored)
 *   --target <url>          a single URL; repeatable
 *   --posted-within <w>     24h | 48h | week | 2weeks | month        (default week)
 *   --max <n>               max commenters and reactors per post      (default 20)
 *   --include-job-seekers   keep people flagged open-to-work
 *   --actor <id>            override the Actor                        (default from ACTOR_ID below)
 *   --out <file>            where to write the result JSON            (default run.json)
 *
 * Needs APIFY_TOKEN in the environment. No npm install required.
 */
const ACTOR_ID = process.env.ACTOR_ID ?? 'numerous_hierarchy/linkedin-engagement-leads';
const API = 'https://api.apify.com/v2';
const POLL_MS = 5000;

function parseArgs(argv) {
    const out = { targets: [], postedWithin: 'week', max: 20, excludeJobSeekers: true, actor: ACTOR_ID, out: 'run.json' };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        const next = () => argv[(i += 1)];
        if (a === '--targets') out.targetsFile = next();
        else if (a === '--target') out.targets.push(next());
        else if (a === '--posted-within') out.postedWithin = next();
        else if (a === '--max') out.max = Number(next());
        else if (a === '--include-job-seekers') out.excludeJobSeekers = false;
        else if (a === '--actor') out.actor = next();
        else if (a === '--out') out.out = next();
        else if (a === '--help' || a === '-h') out.help = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    return out;
}

async function api(path, init = {}) {
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('APIFY_TOKEN is not set. Run `apify login`, or export it.');
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${API}${path}${sep}token=${token}`, init);
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
}

/** The dataset endpoint caps a single response, so page until a short page comes back. */
async function readDataset(datasetId) {
    const items = [];
    const limit = 500;
    for (let offset = 0; ; offset += limit) {
        const page = await api(`/datasets/${datasetId}/items?offset=${offset}&limit=${limit}`);
        items.push(...page);
        if (page.length < limit) return items;
    }
}

const args = parseArgs(process.argv.slice(2));
const { readFileSync, writeFileSync } = await import('node:fs');

if (args.help) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*| \* ?/gm, ''));
    process.exit(0);
}

if (args.targetsFile) {
    const lines = readFileSync(args.targetsFile, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    args.targets.push(...lines);
}
if (!args.targets.length) {
    console.error('No targets. Pass --targets <file> or --target <url>.');
    process.exit(1);
}

// A header row like "LinkedIn URL" is not a target.
const targets = [...new Set(args.targets.filter((t) => /linkedin\.com/i.test(t)))];
if (!targets.length) {
    console.error('No LinkedIn URLs found among the targets given.');
    process.exit(1);
}

const input = {
    targets,
    postedWithin: args.postedWithin,
    maxEngagersPerPost: args.max,
    excludeJobSeekers: args.excludeJobSeekers,
};

console.error(`Running ${args.actor} on ${targets.length} target(s), window ${input.postedWithin}, cap ${input.maxEngagersPerPost}…`);

const actorPath = args.actor.replace('/', '~');
let run = (await api(`/acts/${actorPath}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
})).data;

console.error(`Run ${run.id} started. Watch: https://console.apify.com/actors/runs/${run.id}`);

while (run.status === 'READY' || run.status === 'RUNNING') {
    await new Promise((r) => setTimeout(r, POLL_MS));
    run = (await api(`/actor-runs/${run.id}`)).data;
    process.stderr.write('.');
}

if (run.status !== 'SUCCEEDED') {
    console.error(`\nRun ${run.status}. ${run.statusMessage ?? ''}`);
    process.exit(1);
}

const people = await readDataset(run.defaultDatasetId);
let summary = null;
try {
    summary = await api(`/key-value-stores/${run.defaultKeyValueStoreId}/records/RUN_SUMMARY`);
} catch {
    console.error('No RUN_SUMMARY record found.');
}

writeFileSync(args.out, `${JSON.stringify({ runId: run.id, input, summary, people }, null, 2)}\n`);

const commenters = people.filter((p) => p.engagementType !== 'reaction').length;
console.error(`\n${people.length} people (${commenters} with a comment) → ${args.out}`);
if (summary?.costEstimateUsd) console.error(`Estimated upstream cost: $${summary.costEstimateUsd.toFixed(2)}`);
