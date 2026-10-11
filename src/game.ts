import type { Game } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { type FathomState, clone, initial, arrive, DIRECTIONS } from "./state";
import { debug, type FathomDebugApi, menuItems, menuItemRect } from "./debug";
import { tick, castSonar, castInk, freshDive } from "./core";
import { render, BACKGROUND } from "./view";
export { BACKGROUND };
export type {
  FathomState,
  Forager,
  Predator,
  Drifter,
  Pulse,
  InkCloud,
  Direction,
  Screen,
  PredatorKind,
} from "./state";
export type { FathomDebugApi } from "./debug";
export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const action of C.ACTIONS)
      api.input.register(action, { keys: [...C.BINDINGS[action]] });
    const sounds = [
      [720, 1080, 65],
      [180, 80, 350],
      [90, 40, 250],
      [330, 660, 220],
      [200, 1200, 450],
      [140, 32, 600],
      [440, 880, 500],
    ];
    Object.values(C.CUES).forEach((cue, i) => {
      const [freq, freqTo, durationMs] = sounds[i]!;
      api.audio.define(cue, {
        freq: freq!,
        freqTo: freqTo!,
        durationMs: durationMs!,
        gain: 0.12,
        wave: i === 2 ? "triangle" : "sine",
      });
    });
    const sheets: Record<string, number> = {
      glimmerfin: 8,
      lanternjaw: 16,
      gloamfin: 8,
      flarefish: 8,
      drifter: 8,
      "flare-bloom": 8,
      "trench-walls": 19,
    };
    const assets = Object.fromEntries(
      await Promise.all(
        Object.entries(sheets).map(async ([name, count]) => [
          name,
          await Promise.all(
            Array.from({ length: count }, (_, i) =>
              api.assets.loadImage(`${name}/${i}.png`),
            ),
          ),
        ]),
      ),
    );
    for (const name of [
      "screen",
      "depth",
      "score",
      "lives",
      "brightness",
      "visionRadius",
      "windowRadius",
      "planktonRemaining",
    ] as const)
      api.diagnostics.register(name, (s) => s[name]);
    api.diagnostics.register("sonar", (s) => s.sonar.cooldown);
    api.diagnostics.register("ink", (s) => s.ink.cooldown);
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    for (let i = 0; i < C.ROSTER_CAP * C.DEN_ORDER.length; i++)
      api.diagnostics.register(`predator ${i}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "—";
      });
    return [initial(assets), debug];
  },
  update(state, api, dt) {
    let s = clone(state);
    const input = api.input;
    if (input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
    s.muted = api.audio.muted();
    const current = s.screen;
    let confirm = input.pressed("confirm");
    const items = menuItems(s);
    const inside = (x: number, y: number) => {
      for (let i = 0; i < items.length; i++) {
        const r = menuItemRect(s, i)!;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
      }
      return null;
    };
    for (const p of input.pointerSamples()) {
      if (!p.primary) continue;
      const index = inside(p.x, p.y);
      if (index !== null) s.menuIndex = index;
      if (p.type === "down")
        s.pointerStart = { id: p.id, index, screen: current };
      if (p.type === "up") {
        const press = s.pointerStart;
        if (
          press &&
          press.id === p.id &&
          press.screen === current &&
          (current === "howto" ||
            (press.index !== null && press.index === index))
        ) {
          confirm = true;
          if (index !== null) s.menuIndex = index;
        }
        s.pointerStart = null;
      }
    }
    if (current === "playing") {
      if (input.pressed("pause")) arrive(s, "paused");
    } else if (
      current === "paused" &&
      (input.pressed("pause") || input.pressed("back"))
    ) {
      s.screen = "playing";
      s.menuIndex = null;
    } else if (current === "howto" && (confirm || input.pressed("back")))
      s = freshDive(s, "title");
    else if (items.length) {
      if (input.pressed("up"))
        s.menuIndex = ((s.menuIndex ?? 0) + items.length - 1) % items.length;
      if (input.pressed("down"))
        s.menuIndex = ((s.menuIndex ?? 0) + 1) % items.length;
      if (current === "gameover" && input.pressed("back"))
        s = freshDive(s, "title");
      else if (confirm) {
        const index = s.menuIndex ?? 0;
        if (current === "title") {
          s.titleIndex = index;
          if (index === 0) s = freshDive(s);
          else arrive(s, "howto");
        } else if (current === "paused") {
          if (index === 0) {
            s.screen = "playing";
            s.menuIndex = null;
          } else s = freshDive(s, index === 1 ? "countdown" : "title");
        } else s = freshDive(s, index === 0 ? "countdown" : "title");
      }
    }
    let held = false;
    if (current === "playing" && s.screen === "playing")
      for (const d of DIRECTIONS) {
        if (input.value(d) > 0) {
          held = true;
          if (input.pressed(d)) s.desired = d;
        }
      }
    // A held direction also works when a key was pressed before live play began.
    if (held && !DIRECTIONS.some((d) => input.value(d) > 0 && d === s.desired))
      s.desired = DIRECTIONS.find((d) => input.value(d) > 0)!;
    const sonar =
      current === "playing" && s.screen === "playing" && input.pressed("a");
    const ink =
      current === "playing" && s.screen === "playing" && input.pressed("b");
    s.pendingSonar = s.pendingSonar || sonar;
    s.pendingInk = s.pendingInk || ink;
    s.remainder += dt;
    let first = true;
    while (s.remainder + 1e-10 >= C.TICK_DT) {
      s.remainder = Math.max(0, s.remainder - C.TICK_DT);
      const cues = new Set<C.CueName>();
      if (first && s.screen === "playing") {
        if (s.pendingSonar) castSonar(s, cues);
        if (s.pendingInk) castInk(s, cues);
      }
      s.pendingSonar = false;
      s.pendingInk = false;
      first = false;
      tick(s, held, cues);
      for (const cue of cues) api.audio.play(cue);
    }
    return s;
  },
  render,
};
