---
name: linkedin-engagement-leads
description: Turn LinkedIn post engagement into a ranked prospect list. Use when the user wants leads or prospects from LinkedIn, wants to know who engaged with specific creators or company pages, mentions engagement-based outbound or signal-based prospecting, or asks to run the LinkedIn engagement workflow. Reads targets from a Google Sheet, runs the linkedin-engagement-leads Apify Actor, scores everyone against our ICP, and writes a ranked sheet back to Drive.
---

# LinkedIn engagement leads

People who comment on or react to posts in our category are raising their hand. This finds them, verifies
who they actually work for, ranks them against our ICP, and writes the result back to Drive.

The Actor does the deterministic half — fetch, verify, filter, dedupe. **You do the judgement.** It has no
model inside it and no notion of who we sell to; that lives in `references/` and in your context.

## Before you start

Read `references/icp.md` and `references/company.md`. You cannot rank anyone without them. Load
`references/outreach.md` only when you get to writing openers, and `references/setup.md` when you need an
ID or an exact tool-call shape.

## Steps

`scripts/` does the deterministic work. Run those rather than assembling API calls yourself — they handle
pagination, polling, dedupe keys and CSV quoting, none of which is worth spending judgement on. Google
Drive has no scriptable path, so those two steps are tool calls.

### 1. Get the targets — tool call

Read the targets sheet named in `references/setup.md` with `download_file_content` and
`exportMimeType: "text/csv"`. Base64-decode it, then split on `/\r?\n/` — the export is CRLF, and
splitting on `\n` alone welds a `\r` onto the end of every URL, which breaks them silently.

Write the URLs to `targets.txt`, one per line. Header rows, blanks and `#` comments are ignored
downstream, so no cleaning is needed.

If the user names a different sheet or pastes a URL, use that instead — the file ID is the long string
between `/d/` and `/edit`.

### 2. Run the Actor — script

```bash
node scripts/run-actor.mjs --targets targets.txt --posted-within week --max 20 --out run.json
```

Needs `APIFY_TOKEN`. Polls to completion, pages the whole dataset, and saves the people plus the run
summary to `run.json`.

`--max` caps commenters and reactors separately per post and is the main cost dial. Widen
`--posted-within` only when a run comes back nearly empty.

**Say what a run will cost before starting a large one.** Billing is per upstream result, roughly
`(posts fetched + people found + profiles looked up) × $0.005`. Three targets on a week at `--max 20` runs
about **$3**. Do not quietly spend multiples of that.

### 3. Exclude anyone already surfaced — tool call, then script

List the output folder from `references/setup.md` with `search_files`, read each prior run sheet, and
collect its `leadId` values into `seen.txt`, one per line. Skip the targets sheet itself.

```bash
node scripts/filter-new.mjs --run run.json --seen seen.txt --out new.json
```

There is no state file — the run history *is* the record, so it cannot drift out of sync. Report how many
were excluded, so a thin run reads as "we already had these" rather than "this failed".

### 4. Score everyone in `new.json`

This is the part only you can do. For each person, against `references/icp.md`, add three fields and write
the result to `scored.json`:

- **`icpFit`, 0–100.** Judge the role *and* the employer. A matching title at a company that does not fit
  is a low score — "Founder" is not a qualification on its own, and a founder of a stealth or pre-product
  company cannot buy anything. When `enriched` is false, cap the score at 60; you are working from a
  self-written headline.
- **`verdict`** — `buyer`, `practitioner`, `competitor`, `employee` or `irrelevant`. Competitors score 0
  however well their title matches.
- **`whyNow`** — one sentence, only for people whose comment reveals a question or their own workflow. It
  must add a reason rather than repeat their comment; the comment is already in the next column. Leave it
  empty for reactors and for generic praise.

Rank on `currentTitle` and `currentCompany`, which come from the person's profile. **Never rank on
`headline`** — that is self-written marketing copy, and it is the reason the Actor looks up real employers
at all.

Judge the comment, not the enthusiasm. A comment aimed at another commenter is thread banter even when it
ends in a question mark, and a long third-person take on the industry reveals nothing about the writer.

### 5. Build the CSV — script

```bash
node scripts/to-sheet-csv.mjs --scored scored.json --out leads.csv
```

Sorts by fit, then by whether they wrote something, then frequency, and emits the agreed columns. It also
quotes correctly, which matters more than it sounds: LinkedIn comments routinely contain commas, quotation
marks and newlines, and a hand-assembled row breaks *silently* — the sheet just shifts columns from some
row onward.

### 6. Write it to Drive — tool call

`create_file` with the contents of `leads.csv`, `contentMimeType: "text/csv"`, `parentId` set to the output
folder, titled `Leads YYYY-MM-DD`. Drive converts it to a real spreadsheet.

A **new file**, not a tab on the targets sheet: the Drive connector cannot write into an existing
spreadsheet, and separate files mean a bad run can never touch the target list.

### 7. Report back

In chat, give the user:

- The funnel from the run summary: posts in window, people found, what was dropped and why
- How many were new versus already seen
- The count scoring 70+
- The link to the new sheet
- **The top 5 leads**, each with their title, employer, the line they actually wrote, and a suggested
  opener built from `references/outreach.md`

Openers for the top 5 only. Nobody reads thirty drafts, and quality falls away fast once people stop
having written anything worth quoting.

## The fields that matter

| Field | Use |
| --- | --- |
| `currentTitle`, `currentCompany` | **Rank on these.** From the person's profile. |
| `enriched` | False means we never learned an employer. Cap those at 60. |
| `commentText` | Their own words. Null for reactors. |
| `engagementType` | `comment`, `reply` or `reaction`. |
| `timesSeen`, `targetsEngaged` | Volume. More than one target is real attention, not a stray click. |
| `headline` | Context only. Never rank on it. |
| `leadId` | Stable per person. The dedupe key across runs. |

## Judgement calls worth getting right

**Trust the profile over the headline.** The Actor looks up every person's real employer precisely so
ranking does not depend on self-description. `AI GTM Loop Maxxing Engineer` tells you nothing;
`GTM Engineer @ CommerceIQ` tells you everything.

**Reactors are rankable, just not quotable.** Two thirds of a typical run left no comment. They are still
worth ranking on title and employer — a well-matched VP who only clicked like beats a poor-fit junior who
wrote three paragraphs. They just get no `whyNow`.

**An empty result is a real answer.** If nobody scores well, say so. On a live run against a company page,
every single lead came back irrelevant — the target's engagement was its own staff and passing traffic.
That is worth reporting as "this target is not working", not padded out.

**Personal profiles beat company pages, consistently.** On live runs, every high-value lead came from an
individual's posts; the company page produced none. If the user's target list is mostly company pages,
say so early and suggest adding operators in the category.

## Out of scope

Email addresses and phone numbers — that is a separate waterfall through Apollo, getleads or similar.
Sending anything. This skill stops at a ranked sheet and five suggested openers.
