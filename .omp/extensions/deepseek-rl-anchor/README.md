# SeekAnchor runtime extension

This directory is the Oh My Pi-loadable runtime. It contains only:

- `native`, `minimal`, and `anchor` modes;
- anchor variants A and B;
- DSH-compatible `bash` and `str_replace_editor` tools;
- `/ds-mode`, `/ds-anchor-variant`, and `/ds-status`.

Developer-only experiments, logging, composition dumps and linguistic
fingerprinting are kept outside `.omp/extensions/` under `developer/`, so Oh My
Pi does not load them during normal use.

The default mode is `native`. Switch with:

```text
/ds-mode minimal
/ds-mode anchor
/ds-anchor-variant A
/ds-status
```

Minimal mode replaces the model-visible system prompt with the DSH Minimal
prompt and exposes only `bash` plus `str_replace_editor`. Native mode and the
promoted Anchor phase delegate `bash` to Oh My Pi's built-in executor. The
extension does not directly instruct the model to emit "We need" or "Let's".

Project settings live in `.omp/deepseek-rl-anchor/settings.json`. Run
`.omp/install-global.ps1` from the repository root for the default user profile,
or use `PI_CODING_AGENT_DIR` to select another Oh My Pi agent directory.

SeekAnchor only steers the reasoning trajectory. It cannot guarantee output
quality, correctness, safety, task success, or downstream effects.
