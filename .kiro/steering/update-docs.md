---
inclusion: manual
---

# /update-docs — refresh docs from the Kiro log

When this command is invoked, run the update-docs script and report what changed:

```
node tests/update-docs.mjs "manual /update-docs run"
```

This appends a dated entry to `KIRO_LOG.md` and refreshes the README "How we used Kiro"
section from the log's bullet summaries. It is the runnable counterpart of the
`update-docs` Agent Hook (v1 has no general-purpose manual hook trigger, so this
manual-inclusion steering command is how we invoke it on demand as `/update-docs`).
