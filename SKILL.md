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

### 1. Get the targets

Read the targets sheet named in `references/setup.md`. Use `download_file_content` with
`exportMimeType: "text/csv"`, base64-decode the result, and split on `/\r?\n/` — the export uses CRLF, and
splitting on `\n` alone leaves a trailing `\r` welded to every URL, which breaks them silently.

Skip the header row. Each remaining non-empty cell is one LinkedIn profile or company URL.

If the user names a different sheet, or pastes a URL, use that instead — the file ID is the long string
between `/d/` and `/edit`.

### 2. Run the Actor

Call `numerous_hierarchy/linkedin-engagement-leads` with:

```json
{
  "targets": ["<from the sheet>"],
  "postedWithin": "week",
  "maxEngagersPerPost": 20,
  "excludeJobSeekers": true
}
```

Only `targets` is required. Raise `maxEngagersPerPost` for more coverage, lower it to spend less — it caps
commenters and reactors separately per post, and it is the main cost dial. Widen `postedWithin` only if a
run comes back nearly empty.

**Tell the user the estimated cost before a large run.** Billing is per upstream result, roughly
`(posts fetched + people found + profiles looked up) × $0.005`. Three targets on a week at 20 runs about
**$3**. Do not silently spend more than that without saying so.

### 3. Read the results

The dataset has one row per person. Also read the `RUN_SUMMARY` record from the key-value store — it
carries the funnel, and you should surface anything it flags: targets that failed identity validation,
targets truncated at the post cap, and posts upstream failed to scrape.

Fields you will rank on:

| Field | Use |
| --- | --- |
| `currentTitle`, `currentCompany` | **Rank on these.** They come from the person's profile. |
| `enriched` | False means we never learned an employer. Treat those rows with suspicion. |
| `commentText` | Their own words. Null for reactors. |
| `engagementType` | `comment`, `reply` or `reaction`. |
| `timesSeen`, `targetsEngaged` | Volume. More than one target is real attention, not a stray click. |
| `headline` | Context only. **Never rank on it** — it is self-written marketing copy. |
| `leadId` | Stable per person. The dedupe key across runs. |

### 4. Exclude anyone already surfaced

List the output folder (`references/setup.md` has the ID) for prior run sheets, read them, and collect
their `leadId` values. Drop anyone already there.

There is no separate state file — the run history *is* the record, so it cannot drift out of sync. Say how
many you excluded, so a thin run reads as "we already had these" rather than "this failed".

### 5. Score everyone

For each person, against `references/icp.md`:

- **`icpFit`, 0–100.** Judge the role *and* the employer. A matching title at a company that does not fit
  is a low score — "Founder" is not a qualification on its own, and a founder of a stealth or pre-product
  company cannot buy anything. If `enriched` is false, cap the score at 60; you are working from a
  self-written headline.
- **`verdict`** — `buyer`, `practitioner`, `competitor`, `employee` or `irrelevant`. Score competitors 0
  however well their title matches. `references/icp.md` draws the line that matters: a company that
  *sells* a competing product is a competitor; an agency that *uses* one for clients is a customer.
- **`whyNow`** — one sentence, only for people whose comment reveals a question or their own workflow.
  It must add a reason, not repeat their comment back; the comment is already in the next column. Leave it
  empty for reactors and for generic praise.

Rank by `icpFit`, then by whether they wrote something, then `timesSeen`.

Judge the comment, not the enthusiasm. A comment aimed at another commenter is thread banter even when it
ends in a question mark, and a long third-person take on the industry reveals nothing about the writer.

### 6. Write the results back

Create a new sheet in the output folder — `create_file` with `contentMimeType: "text/csv"`, which Drive
converts to a real spreadsheet. Title it `Leads YYYY-MM-DD`.

Quote any field containing a comma, and never paste a raw comment without quoting it.

Columns, in this order:

```
icpFit, verdict, name, currentTitle, currentCompany, profileUrl, whyNow,
commentText, engagementType, timesSeen, targetsEngaged, postUrl, leadId
```

A **new file**, not a tab on the targets sheet — the Drive connector cannot write into an existing
spreadsheet, and keeping runs separate means a bad run can never touch the target list.

### 7. Report back

In chat, give the user:

- The funnel from `RUN_SUMMARY`: posts in window, people found, what was dropped and why
- How many were new versus already seen
- The count scoring 70+
- The link to the new sheet
- **The top 5 leads**, each with their title, employer, the line they actually wrote, and a suggested
  opening message built from `references/outreach.md`

Openers for the top 5 only. Nobody reads thirty drafts, and quality falls off fast once people stop having
written anything worth quoting.

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
