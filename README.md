# linkedin-engagement-leads (Claude Code skill)

A skill for [Claude Code](https://claude.com/claude-code) that turns LinkedIn post engagement into a
ranked prospect list.

Point it at a handful of creators or company pages in your category. It finds everyone who commented or
reacted to their recent posts, looks up **who each person actually works for**, drops the noise, ranks the
rest against your ICP, and writes the result to a Google Sheet.

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
git clone <this repo> ~/.claude/skills/linkedin-engagement-leads
```

Then edit the three files that describe your business:

- `references/company.md` — what you sell
- `references/icp.md` — who you sell to, and who your competitors are
- `references/outreach.md` — your voice

They ship filled in as an example (written as Instantly.ai) so you can see the level of detail that
works. **`references/icp.md` is the one that matters** — a vague ICP produces a list where nearly half of
everyone comes back labelled "buyer", which is the same as having no ranking at all.

Then put your IDs in `references/setup.md`: the Apify Actor, your targets sheet, and the Drive folder.

## Requires

- The `linkedin-engagement-leads` Apify Actor, and an Apify token
- A Google Drive connector, for reading targets and writing results
- A Google Sheet with one column of LinkedIn URLs — profiles or company pages, mixed freely

## Cost

Billed per upstream result, roughly `(posts fetched + people found + profiles looked up) × $0.005`. Three
targets on a one-week window runs about **$3** and returns ~200 people. `maxEngagersPerPost` is the dial.

## What it deliberately does not do

Find email addresses or phone numbers — that is a separate waterfall through Apollo, getleads or similar.
Send anything. It stops at a ranked sheet and a handful of suggested openers.

## Two things worth knowing before your first run

**Target individuals, not company pages.** On live runs, every high-value lead came from an individual's
posts. Company pages produced none — their engagement is overwhelmingly their own staff, which the Actor
correctly drops. Company pages are still useful for finding a *competitor's* audience; just do not expect
the good rows to come from there.

**An empty result is a real answer.** If a week's engagement contains nobody worth contacting, the skill
says so. That is information about the target, not a failure.
