# linkedin-engagement-leads (Claude Code skill)

A skill for [Claude Code](https://claude.com/claude-code) that turns LinkedIn post engagement into a
ranked prospect list.

Point it at a handful of creators or company pages in your category. It finds everyone who commented or
reacted to their recent posts, looks up **who each person actually works for**, drops the noise, ranks the
rest against your ICP, and writes a ranked sheet to Google Drive.

The premise: someone commenting on a post in your category is raising their hand. That is a better signal
than any firmographic filter, and it comes with their own words attached — which is the difference between
a cold email and a relevant one.

## How the work is split

| | Does what | How |
| --- | --- | --- |
| **The Actor** | Fetch, verify, filter, dedupe | Deterministic. No model, no API key. |
| **This skill** | Judge fit, rank, write openers | Your agent, using `references/` |

The Actor never guesses. It drops a person only on a fact: their profile URL is a company page, their
employer's LinkedIn URL exactly matches the target, or LinkedIn's own open-to-work flag is set. Everything
requiring judgement is left to the agent, which has your ICP in context and a far better model than
anything worth embedding in a scraper.

## Install

```bash
npx skills add -g https://github.com/0xmerkle/linkedin-engagement-leads-skill
```

That installs it for Claude Code and tracks it, so `npx skills update` later pulls down changes. One
consequence worth knowing: **update overwrites the installed copy from GitHub without prompting**, so edit
your clone of this repo and push, rather than editing the installed files in place.

A plain `git clone` into `~/.claude/skills/linkedin-engagement-leads` also works if you would rather manage
it yourself, and is the better choice while you are actively changing the reference files.

Then edit the two files that describe your business:

- `references/company.md` — what you sell
- `references/icp.md` — who you sell to, and who your competitors are

They ship filled in as an example (written as Instantly.ai) so you can see the level of detail that
works. **`references/icp.md` is the one that matters** — a vague ICP produces a list where nearly half of
everyone comes back labelled "buyer", which is the same as having no ranking at all.

Then put your IDs in `references/setup.md`: the Apify Actor, your targets sheet, and the Drive folder.

## What's in here

```
SKILL.md              the procedure the agent follows
references/
  company.md          what we sell
  icp.md              who we sell to, and who competes with us
  setup.md            Actor ID, Drive IDs, exact tool-call shapes
scripts/
  run-actor.mjs       run the Actor, page the dataset, save the result
  filter-new.mjs      drop anyone surfaced in an earlier run
  to-sheet-csv.mjs    scored JSON to the ranked CSV plus the seen-id file
```

The scripts are plain Node with **no dependencies** — nothing to install. They exist so the agent spends
its tokens on judgement rather than on pagination, polling and CSV quoting. That last one is not
cosmetic: LinkedIn comments routinely contain commas, quotation marks and newlines, and a hand-assembled
CSV row breaks silently, shifting every column from that row onward.

Google Drive has no scriptable path here, so reading targets and writing results stay as connector calls.

## Before your first run

Three things have to be in place. The skill fails at a different step for each, so it is worth checking
all three up front rather than discovering them one at a time mid-run.

### 1. Google Drive connected to Claude Code

**This is the one people miss.** Steps 1, 3 and 6 are Drive connector calls — reading your targets sheet,
reading past runs to skip people you already have, and writing the result. Without Drive the skill cannot
start, and the failure looks like Claude saying it has no tool to read the sheet rather than anything
obviously about a connector.

Connect Google Drive from Claude Code's connector settings before you run anything. Once it is on, check
it actually works by asking Claude:

> list the files in my Google Drive folder `<your folder ID>`

If you get the file list back, you are set. If Claude says it has no tool for that, Drive is not connected
to this session, and reconnecting it is the fix.

The connector needs to both **read** your targets sheet and **create files** in your output folder. Read-only
access gets you through step 1 and then fails at step 6 with a full run already paid for.

### 2. `APIFY_TOKEN` in your shell

```bash
export APIFY_TOKEN=apify_api_...
```

The scripts read that environment variable and nothing else. They deliberately do not fall back to the
Apify CLI's stored credentials — a script should not go looking through credential files it was never
pointed at. If the variable is unset, `run-actor.mjs` says so and stops before spending anything.

You also need the `linkedin-engagement-leads` Actor itself available to that token's account.

### 3. A targets sheet

A Google Sheet with one column of LinkedIn URLs, profiles and company pages mixed freely. A header row,
blanks and `#` comments are all ignored. Put its ID in `references/setup.md` along with your output folder
ID.

Node 20+ is the only other requirement, and the scripts have no npm dependencies.

## What it writes

Each run creates **two** sheets in your output folder, because they do different jobs:

| Sheet | Holds |
| --- | --- |
| `Leads YYYY-MM-DD` | The ranked shortlist. The thing you open and work. |
| `Seen YYYY-MM-DD` | One `leadId` per line for **everyone** scored, including the ones below the cut. |

The split exists because the Drive connector takes file content as text inside the tool call, so every byte
written is a byte the agent has to generate. A 240KB sheet is minutes of silence and past a point cannot
complete at all. So the ranked sheet is capped at ~50KB, raising the fit floor until it fits, and the tiny
seen sheet carries the full dedupe record.

Nothing is lost. People below the floor are still remembered and never resurface, and the complete run with
every column stays on disk as `leads.csv`.

## Cost

Billed per upstream result, roughly `(posts fetched + people found + profiles looked up) × $0.005`.

| Run | Cost | People |
| --- | --- | --- |
| 3 targets, one week, `--max 20` | ~$3 | ~200 |
| 5 targets, one week, `--max 20` | ~$8 | ~550 |

`maxEngagersPerPost` is the dial. It caps commenters and reactors *separately*, so 20 means up to 20 of
each per post. If your best targets come back at 38–40 engagers on a cap of 20, they are saturated and
there are more people on those posts you never fetched.

## What it deliberately does not do

Find email addresses or phone numbers — that is a separate waterfall through Apollo, getleads or similar.
Send anything. It stops at a ranked sheet and a handful of suggested openers.

## Two things that decide whether a run is any good

**Target individuals, not company pages.** On live runs, every high-value lead came from an individual's
posts. Company pages produced none — their engagement is overwhelmingly their own staff, which the Actor
correctly drops. Company pages are still useful for finding a *competitor's* audience; just do not expect
the good rows to come from there.

**An empty result is a real answer.** If a week's engagement contains nobody worth contacting, the skill
says so. That is information about the target, not a failure.
