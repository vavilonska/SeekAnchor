# SeekAnchor runtime extension

This directory is the Pi-loadable runtime. It contains only:

- `native`, `minimal`, and `anchor` modes;
- anchor variants A and B;
- DSH-compatible `bash` and `str_replace_editor` tools;
- `/ds-mode`, `/ds-anchor-variant`, and `/ds-status`.

Developer-only experiments, logging, composition dumps and linguistic
fingerprinting are kept outside `.pi/extensions/` under `developer/`, so Pi
does not load them during normal use.

The default mode is `native`. Switch with:

```text
/ds-mode minimal
/ds-mode anchor
/ds-anchor-variant A
/ds-status
```

Minimal mode replaces the model-visible system prompt with the DSH Minimal
prompt and exposes only `bash` plus `str_replace_editor`. It does not directly
instruct the model to emit "We need" or "Let's".
