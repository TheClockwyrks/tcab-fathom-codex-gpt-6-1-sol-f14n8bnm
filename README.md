# Fathom

**Hunt in the dark.** A bioluminescent deep-sea maze chase, playable entirely in your browser. Graze every plankton mote to descend, use sonar to survey winding passages, and release ink to escape the hunters that see. Three predators hunt by light, sound, and flare.

This is the **Kindle** dive: explored terrain stays remembered, but only the circular window around your forager shows it. Eating expands your view and makes your light easier to hunt.

## Run

Use a recent Node.js version supported by Vite, then:

```sh
npm ci
npm run dev
```

Open the address Vite prints. No backend, account, external services, or downloaded fonts are needed.

## Build

```sh
npm run build
npm run preview
```

The complete static site is in `dist/`, with `index.html` at its root. Serve that directory directly at a server root or under a sub-path; asset URLs are relative to the page.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Swim while held; select menu items with up/down |
| Space | Sonar pulse; confirm in menus |
| Shift | Release ink |
| Enter | Confirm menu selection |
| Escape / P | Pause or resume |
| Escape | Return from the field guide or game-over menu |
| M | Toggle sound |
| Backtick | Toggle the engine's diagnostic overlay |

Menus also accept pointer clicks and touch. On touch devices, the engine provides a directional pad and action buttons. Sonar and ink recharge automatically. Lives shown in the HUD are reserve attempts; zero reserves still leaves your current attempt.

## Verification and automation

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

The tests drive the Simple 2D engine with counted frames and scripted clocks. They cover maze invariants, input and menus, movement, fog, wavefronts, predator behavior, effects, and progression. The engine owns the loop, canvas fit, input, audio, asset loader, diagnostics, and recorder. Simulation runs at 120 fixed ticks per second and never reads from rendering.

`src/game.ts` exports the game, state types, and debug surface type. An engine caller reads `engine.debug.snapshot(engine.state)` and applies poses with `engine.apply(s => engine.debug.setScreen(s, "playing"))`. The debug surface is available only through the engine and installs nothing on the page. `specs/instrumentation.md` documents its operations.

The store-page description, captured screenshots, and an engine-recorded live-play replay are in `showcase/`.
