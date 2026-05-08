# TASK — Advisory only

The deterministic planner has selected the following issues to work in parallel this iteration:

```json
{{FRONTIER_JSON}}
```

Their bodies are below.

{{ISSUE_BODIES}}

# Look for risks of working these in parallel

1. **Implicit file overlap** — two issues likely to touch the same files (auth middleware, shared types, generated schema files).
2. **Implicit state coupling** — one issue assumes a schema/API the other changes.
3. **Test interactions** — one issue's tests rely on data or fixtures the other modifies.
4. **Anything `/to-issues` may have missed declaring as a "Blocked by"** dependency.

# OUTPUT

If you find concerns, list them as concise bullets inside `<concerns>` tags.

If all looks clean, output `<concerns>None</concerns>`.

# RULES

- You are advisory only. You CANNOT remove or reorder issues from the frontier.
- The merger handles real conflicts at merge time; this is just an early warning.
- Be terse. One bullet per concrete concern, naming the issues by number.
- Do not propose fixes — just flag risks.
