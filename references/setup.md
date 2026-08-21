# Setup and IDs

## Apify Actor

```
numerous_hierarchy/linkedin-engagement-leads
```

Needs an Apify token. Prefer the Apify MCP `call-actor` tool; `apify call <actor> --input '<json>'` via the
shell works too but the output is harder to parse. The Actor needs no other credentials — there is no
model inside it.

Inputs: `targets` (required), `postedWithin` (`24h` | `48h` | `week` | `2weeks` | `month`, default
`week`), `maxEngagersPerPost` (1–100, default 30), `excludeJobSeekers` (default true).

Output: one dataset row per person, plus a `RUN_SUMMARY` record in the key-value store.

## Google Drive

| What | ID |
| --- | --- |
| Targets sheet — *Target Accounts To Scrape* | `1twLXK4wxB2oNNC415IVOpDlFy3L8QWK7noe1nxX43JY` |
| Folder for both the targets sheet and run outputs | `1fEvf2_MP7Qs-pcq17l6CpGUeiMci-dJ4` |

Needs the Google Drive connector.

### Reading the targets

```
download_file_content(fileId: <targets sheet>, exportMimeType: "text/csv")
```

Returns base64. Decode, then `split(/\r?\n/)` — the export is CRLF, and splitting on `\n` alone leaves a
`\r` on the end of every URL.

`read_file_content` also works and needs no decoding, but returns a markdown table with a stray empty
header cell and an alignment row to strip. Prefer the CSV.

### Finding prior runs, for cross-run dedupe

```
search_files(query: "parentId = '<folder>' and mimeType = 'application/vnd.google-apps.spreadsheet'")
```

Returns every sheet in the folder, including the targets sheet — skip that one by ID, and read the rest
for their `leadId` values.

### Writing a run

```
create_file(
  title: "Leads YYYY-MM-DD",
  parentId: <folder>,
  contentMimeType: "text/csv",
  textContent: <the CSV>
)
```

Drive converts CSV to a real spreadsheet. Quoted fields containing commas survive intact.

## Known limitations

- **There is no way to write into an existing sheet.** `update_file` changes only a file's title and
  folder — no cells, no new tabs. Every run creates a new file.
- To make results appear inside the targets sheet anyway, add a tab there with an `IMPORTRANGE` formula
  pointing at the latest run sheet. One-time manual setup, repointed when you want a different run.
