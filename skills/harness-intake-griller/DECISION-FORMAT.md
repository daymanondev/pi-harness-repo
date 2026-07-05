# Decision Record Format

Decision records live in `docs/decisions/` with sequential numbering:
`0001-slug.md`, `0002-slug.md`, … The matching durable row is added with
`harness-cli decision add`.

## Template

```md
# {Short title of the decision}

{1–3 sentences: what's the context, what was decided, and why.}
```

That is the minimum. The value is recording *that* a decision was made and
*why* — not filling out sections.

## Optional sections

Include only when they add genuine value. Most decisions won't need them.

- **Status** (`proposed | accepted | deprecated | superseded by ADR-NNNN`) —
  useful when decisions are revisited.
- **Considered options** — only when rejected alternatives are worth
  remembering.
- **Consequences** — only when non-obvious downstream effects need calling out.

## Numbering

Scan `docs/decisions/` for the highest existing number and increment by one.
The durable `decision add --id` must match the filename slug.

## When to offer a decision record

All three must be true (same bar as an architectural decision record):

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will wonder "why did they
   do it this way?"
3. **Real trade-off** — genuine alternatives existed and one was picked for
   specific reasons.

If any of the three is missing, skip it.

## When a decision record is REQUIRED (not optional)

For high-risk work that changes any of these, a durable decision record is
required — a trace's `--decisions` field does not satisfy it:

- Behaviour or architecture direction
- Authorization or data ownership
- API shape or response envelope
- Audit/security posture
- Validation requirements (especially weakening or removing them)

## Recording the durable row

```bash
scripts/bin/harness-cli decision add \
  --id <NNNN-slug> \
  --title "<title>" \
  --doc docs/decisions/<NNNN-slug>.md \
  --notes "<optional context>"
```

The `--doc` path must point at the markdown file you just wrote. Decision text
inside a trace is evidence, not a durable record.
