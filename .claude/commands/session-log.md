# /session-log — Append current turn to the active session log

Append the most recent user/assistant exchange to the active PixiCred Claude Code session file.

## Steps

1. **Locate the active session file**
   - Check working memory for `SESSION_FILE` (set during session initialization)
   - If not in memory (e.g. after context compaction): run `ls -t .claude/sessions/*.claude-session.md | head -1` to find the most recently created session file; use that file and note "(resumed after context compaction)" in the Thinking block

2. **Determine the next turn number**
   - Count occurrences of `### Turn` in the file: `grep -c '^### Turn' <SESSION_FILE>`
   - Next turn = count + 1

3. **Get the current timestamp**
   - Run: `date -u +"%H:%M:%S"`

4. **Append the turn block** (use the Edit or Write tool — append only, do NOT overwrite):

```
### Turn N — HH:MM:SS UTC

**User:**
{exact verbatim user message — copy word for word, no paraphrasing or summarizing}

**Thinking:**
{Claude's internal reasoning for this turn: what the request required, what approaches were considered, why this approach was chosen over alternatives, any constraints or tradeoffs weighed, what prior context or spec rules shaped the decision}

**Assistant:**
{concise factual summary: decisions made, files changed or created, commands executed, key outputs, errors encountered}

---

```

## Rules

- **User block**: verbatim only — exact words, punctuation, and formatting the user typed. Never paraphrase.
- **Thinking block**: genuine reasoning — not a restatement of what was done, but WHY: what was considered, what was ruled out, what shaped the approach. This is the record of deliberation.
- **Assistant block**: factual outcomes only — file paths, function names, what changed. Not prose.
- Append only — never overwrite or truncate the session file
- If `$ARGUMENTS` is provided, include it as additional context in the Thinking or Assistant block

## Manual invocation

`/session-log` — appends the current turn
`/session-log <note>` — appends the current turn with `<note>` as additional context
