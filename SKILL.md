---
name: linkedin-engagement-leads
description: Turn LinkedIn post engagement into a ranked prospect list. Use when the user wants leads or prospects from LinkedIn, asks who engaged with specific creators or company pages, or mentions engagement-based outbound or signal-based prospecting. Reads targets from a Sheet, runs an Apify Actor, scores everyone against our ICP, writes a ranked sheet to Drive.
---

# LinkedIn engagement leads

People who comment on or react to posts in our category are raising their hand. This finds them, verifies
who they actually work for, ranks them against our ICP, and writes the result to Drive.

The Actor does the deterministic half: fetch, verify, filter, dedupe. **You do the judgement.** It has no
model inside it and no notion of who we sell to. That lives in `references/`.

## Before you start

Read `references/icp.md` and `references/company.md`. You cannot rank anyone without them. Load
`references/setup.md` when you need an ID or a tool-call shape.

## Steps

Steps 1, 3 and 6 are Drive tool calls, because Drive has no scriptable path. Everything else runs through
`scripts/`. Use those rather than assembling API calls yourself. They handle pagination, polling, dedupe
keys and CSV quoting.

### 1. Get the targets

Read the targets sheet from `references/setup.md` with `download_file_content` and
`exportMimeType: "text/csv"`. Base64-decode, then split on `/\r?\n/`. The export is CRLF, and splitting on
`\n` alone leaves a `\r` on every URL, which breaks them silently.

Write the URLs to `targets.txt`, one per line. Header rows, blanks and `#` comments are ignored downstream.

If the user names a different sheet, use that instead. The file ID is the string between `/d/` and `/edit`.

### 2. Run the Actor

```bash
node scripts/run-actor.mjs --targets targets.txt --posted-within week --max 20 --out run.json
```

Needs `APIFY_TOKEN`. Polls to completion, pages the dataset, saves the people and the run summary to
`run.json`.

`--max` caps commenters and reactors separately per post and is the main cost dial. Widen
`--posted-within` only when a run comes back nearly empty.

**Say what a run will cost before starting a large one.** Billing is per upstream result, roughly
`(posts fetched + people found + profiles looked up) × $0.005`. Three targets on a week at `--max 20`
costs about **$3**. Do not quietly spend multiples of that.

### 3. Exclude anyone already surfaced

List the output folder from `references/setup.md` with `search_files`, read each prior run sheet, and
collect its `leadId` values into `seen.txt`, one per line. Skip the targets sheet.

```bash
node scripts/filter-new.mjs --run run.json --seen seen.txt --out new.json
```

There is no state file. The run history *is* the record, so it cannot drift. Report how many were
excluded, so a thin run reads as "we already had these" rather than "this failed".

### 4. Score everyone in `new.json`

This is the part only you can do. For each person, against `references/icp.md`, add three fields and write
`scored.json`.

- **`icpFit`, 0 to 100.** Judge the role *and* the employer. A matching title at a company that does not
  fit is a low score. "Founder" is not a qualification on its own, and a founder of a stealth or
  pre-product company cannot buy anything. When `enriched` is false, cap at 60. You are working from a
  self-written headline.
- **`verdict`.** One of `buyer`, `practitioner`, `competitor`, `employee`, `irrelevant`. Competitors score
  0 however well their title matches.
- **`whyNow`.** One sentence, only for people whose comment reveals a question or their own workflow. It
  must add a reason rather than repeat the comment, which is already in the next column. Leave it empty
  for reactors and for generic praise.

Rank on `currentTitle` and `currentCompany`, which come from the person's profile. **Never rank on
`headline`.** That is self-written marketing copy, and it is why the Actor looks up real employers at all.
`AI GTM Loop Maxxing Engineer` tells you nothing. `GTM Engineer @ CommerceIQ` tells you everything.

Judge the comment, not the enthusiasm. A comment aimed at another commenter is thread banter even when it
ends in a question mark, and a long third-person take on the industry reveals nothing about the writer.

### 5. Build the CSV

```bash
node scripts/to-sheet-csv.mjs --scored scored.json --out leads.csv
```

Sorts by fit, then by whether they wrote something, then frequency. It also quotes correctly. LinkedIn
comments contain commas, quotation marks and newlines, and a hand-assembled row breaks *silently*. The
sheet just shifts columns from some row onward.

### 6. Write it to Drive

`create_file` with the contents of `leads.csv`, `contentMimeType: "text/csv"`, `parentId` set to the output
folder, titled `Leads YYYY-MM-DD`. Drive converts it to a real spreadsheet.

A **new file**, not a tab on the targets sheet. The Drive connector cannot write into an existing
spreadsheet, and separate files mean a bad run can never touch the target list.

### 7. Report back

In chat, give the user:

- The funnel from the run summary: posts in window, people found, what was dropped and why
- How many were new versus already seen
- The count scoring 70+
- The link to the new sheet
- **The top 5 leads**, each with their title, employer and the line they actually wrote

Write an opener only for leads that earned a `whyNow`. No `whyNow` means they gave you nothing to react
to, and an invented hook is worse than no message. Two or three sentences: quote their actual words, name
the specific problem they named rather than the category, and ask one easy question. Say you saw their
comment on the post. Never claim to have met them, been referred, or used their product.

## The fields that matter

| Field | Use |
| --- | --- |
| `currentTitle`, `currentCompany` | **Rank on these.** From the person's profile. |
| `enriched` | False means we never learned an employer. Cap those at 60. |
| `commentText` | Their own words. Null for reactors, who are still rankable on title and employer, just never quotable. |
| `engagementType` | `comment`, `reply` or `reaction`. |
| `timesSeen`, `targetsEngaged` | Volume. More than one target is real attention, not a stray click. |
| `headline` | Context only. Never rank on it. |
| `leadId` | The dedupe key across runs. Not yet stable per person: commenters and reactors come back with different URL forms, so one person can get two IDs. Check the top of a ranked list for repeated names. |

## Judgement calls worth getting right

**An empty result is a real answer.** If nobody scores well, say so. On a live run against a company page,
every lead came back irrelevant, because the target's engagement was its own staff and passing traffic.
Report that as "this target is not working" rather than padding it out.

**Personal profiles beat company pages.** On live runs, the high-value leads come from individual posts.
If the target list is mostly company pages, say so early and suggest adding operators in the category.

**Check what the posts were about, not just who engaged.** A week of brand and event posts draws fans and
staff. A week of posts about the problem we solve draws buyers. If nobody in the results talks about our
category, the targets are wrong, not the scoring.

## Out of scope

Email addresses and phone numbers. That is a separate waterfall through Apollo, getleads or similar.
Sending anything. This skill stops at a ranked sheet and a few openers.
