# Developer-only material

Nothing in this directory is automatically loaded by Pi.

`reference-implementation/deepseek-rl-anchor/` is the instrumented version
from the supplied ZIP. It contains experiment switching, provider-payload
inspection, JSONL logging, fingerprint counting and composition dumps.

It is retained for future development and controlled benchmarks, while the
normal runtimes live in `.pi/extensions/deepseek-rl-anchor/`,
`.omp/extensions/deepseek-rl-anchor/`, and `.opencode/plugins/seek-anchor/`.

The supplied ZIP did not include the tests, docs, vendor snapshot, package
manifest or benchmark artifacts described by its README. Do not interpret the
reference implementation's reported test count as independently verified.

Repository-level developer checks are in `developer/tests/` and can be run
with `npm test`. They import the runtime modules but are never loaded by Pi.
The OpenCode adapter is type-checked separately with
`npm run typecheck:opencode`; this command is also developer-only.

The global OpenCode installer has an isolated smoke test:

```powershell
npm run test:global-install
```

The Oh My Pi global runtime copy has a separate isolated smoke test:

```powershell
npm run test:omp-global-install
```

It installs into a generated system-temporary directory, verifies the copied
runtime, settings, dependency, and conflict stop, then removes that temporary
directory. It never writes to the user's real OpenCode configuration.
