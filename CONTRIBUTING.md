# Contributing to Sovereign

Thanks for helping. Sovereign is a deterministic simulation, so the one rule that matters most is: **the same seed must give the same world on every machine.** Most of the tooling exists to protect that.

## Getting set up

You need Node 22+ and pnpm 10. See [docs/development.md](docs/development.md) for the full list of commands.

```bash
pnpm install
pnpm check          # typecheck, lint and the fast tests
pnpm test:determinism
```

## Making a change

1. Branch from `main`.
2. Write the test first and watch it fail for the reason you expect, then make it pass.
3. Run `pnpm check` and, if you touched `packages/simulation`, `pnpm test:determinism`. If you touched the web app, run `pnpm --filter @sovereign/web e2e`.
4. Open a pull request using the template. Keep it to one idea; a stack of small pull requests beats one large one.

Commit messages are `type(scope): summary` (`feat`, `fix`, `refactor`, `test`, `docs`, `ci`, `chore`), with the reason in the body.

## Rules the tooling enforces

- **Package boundaries** ([docs/architecture/dependency-diagram.md](docs/architecture/dependency-diagram.md)): `pnpm lint` fails on an import the graph does not allow, on a library used outside its owner (PixiJS in the renderer, React in the UI and web app, Electron in the desktop shell), and on any third-party runtime dependency of the engine.
- **Determinism** ([docs/simulation/determinism.md](docs/simulation/determinism.md)): in `packages/simulation/src` ESLint bans `Math.random`, clocks, platform transcendentals and `**`, and iteration that depends on object key order. The error message names what to use instead.
- **Goldens**: a change that moves a golden hash is a deliberate act. Regenerate in its own commit and say why in the pull request; never edit a golden to make a test pass.
- **Formatting**: Prettier. `pnpm format` fixes it.

## Adding to the engine

- A new system takes its randomness from its own **named stream**: add the name to `STREAM_NAMES` (a test pins the list), never share a stream between systems.
- It runs from `World.step()`, in an explicit order, and mutates only what it owns.
- Anything it stores must be in the state hash and the save; bump `HASH_SCHEMA_VERSION` / `SAVE_FORMAT_VERSION` and document the change.
- Ship a golden for it, and write an ADR if it changes a decision.

## Reporting a problem

Open an issue. A world is reproduced by its seed, so please include the seed, the config overrides if any, and the 128-bit hash from `pnpm sim -- --seed <seed>` along with what you expected to see.

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
