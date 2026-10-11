import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEngine,
  ConstantClock,
  SequenceClock,
  type Engine,
  type Clock,
} from "@clockwyrks/simple-2d";
import { game, type FathomState, type FathomDebugApi } from "./game";
import { initial, center, type Direction } from "./state";
import { debug } from "./debug";
import { flood, neighbor, tile, lineClear } from "./core";
import * as C from "./constants";

// The engine is real; only the browser's pixel sink and file decoder are fakes.
function canvas(): HTMLCanvasElement {
  const gradient = { addColorStop: () => {} };
  const context = new Proxy(
    { canvas: null },
    {
      get: (target, key) =>
        key in target
          ? target[key as keyof typeof target]
          : key === "createRadialGradient" || key === "createLinearGradient"
            ? () => gradient
            : () => {},
    },
  );
  return {
    width: C.STAGE_W,
    height: C.STAGE_H,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
}
const engines: Engine<FathomState, FathomDebugApi>[] = [];
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["frame"]), { status: 200 })),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 32, height: 32, close: () => {} })),
  );
});
afterEach(() => {
  engines.splice(0).forEach((e) => e.destroy());
  vi.unstubAllGlobals();
});
async function harness(clock: Clock = new ConstantClock(1000 / C.TICK_HZ)) {
  const events = new EventTarget();
  const e = createEngine({
    canvas: canvas(),
    game,
    width: C.STAGE_W,
    height: C.STAGE_H,
    layout: C.LAYOUT,
    clock,
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
  });
  engines.push(e);
  await e.initialize();
  const key = (code: string, down = true) =>
    events.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), {
        code,
        repeat: false,
      }),
    );
  const pose = (fn: (s: Parameters<typeof debug.reset>[0]) => FathomState) =>
    e.apply(fn);
  const play = () => {
    pose((s) => debug.clearPredators(s));
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setScreen(s, "playing"));
  };
  return { e, key, pose, play, events };
}
function fixture(cells: [number, number, string][]) {
  const rows = Array.from({ length: C.GRID_ROWS }, () =>
    Array<string>(C.GRID_COLS).fill("#"),
  );
  cells.forEach(([x, y, ch]) => (rows[y]![x] = ch));
  return rows.map((r) => r.join(""));
}
function corridor(y = 5, x1 = 1, x2 = 34) {
  return fixture(
    Array.from({ length: x2 - x1 + 1 }, (_, i) => [x1 + i, y, "."]),
  );
}
function pointer(events: EventTarget, type: string, x: number, y: number) {
  events.dispatchEvent(
    Object.assign(new Event(type), {
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerdown" ? 1 : 0,
    }),
  );
}

describe("maze and state contract", () => {
  it("lays out connected symmetric one-tile corridors, no dead ends, a sealed den and one wrap", () => {
    const s = initial();
    const cells: { tx: number; ty: number }[] = [];
    let degree = 0;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const t = tile(s, x, y),
          mirror = tile(s, C.GRID_COLS - 1 - x, y);
        if (!"dg".includes(t) && !"dg".includes(mirror)) expect(t).toBe(mirror);
        if (t !== ".") continue;
        cells.push({ tx: x, ty: y });
        const count = C.ACTIONS.slice(0, 4).filter((d) => {
          const n = neighbor(s, x, y, d as Direction);
          return tile(s, n.tx, n.ty) === ".";
        }).length;
        expect(count).toBeGreaterThanOrEqual(2);
        degree += count;
        expect(
          [tile(s, x + 1, y), tile(s, x, y + 1), tile(s, x + 1, y + 1)].every(
            (t) => t === ".",
          ),
        ).toBe(false);
      }
    const map = flood(s, s.start.tx, s.start.ty);
    expect(map.size).toBe(cells.length);
    expect(
      cells.length / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2)),
    ).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(degree / cells.length).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(degree / cells.length).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    const seen = new Set<number>(),
      runs: number[] = [];
    const adj = (p: { tx: number; ty: number }) =>
      ["up", "right", "down", "left"]
        .map((d) => neighbor(s, p.tx, p.ty, d as Direction))
        .filter((n) => tile(s, n.tx, n.ty) === ".");
    for (const p of cells) {
      const key = p.ty * C.GRID_COLS + p.tx;
      if (seen.has(key) || adj(p).length !== 2) continue;
      let length = 0;
      const q = [p];
      seen.add(key);
      while (q.length) {
        const a = q.pop()!;
        length++;
        for (const b of adj(a)) {
          const k = b.ty * C.GRID_COLS + b.tx;
          if (!seen.has(k) && adj(b).length === 2) {
            seen.add(k);
            q.push(b);
          }
        }
      }
      runs.push(length);
    }
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(mean).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(mean).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    expect(
      s.tiles.filter((r) => r[0] === "." && r[C.GRID_COLS - 1] === "."),
    ).toHaveLength(1);
    for (let y = 7; y <= 9; y++)
      for (let x = 16; x <= 19; x++) {
        expect(tile(s, x, y)).toBe("d");
        expect(adj({ tx: x, ty: y })).toHaveLength(0);
        expect(
          flood(s, x, y, true).has(s.start.ty * C.GRID_COLS + s.start.tx),
        ).toBe(true);
      }
  });
  it("loads all frames, registers diagnostics and starts with a complete JSON snapshot", async () => {
    const { e } = await harness();
    expect(fetch).toHaveBeenCalledTimes(75);
    const s = e.debug.snapshot(e.state);
    expect(s.screen).toBe("title");
    expect(s.planktonRemaining).toBe(s.plankton.join("").split("*").length - 1);
    expect(s.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(e.diagnostics().some((d) => d.name === "windowRadius")).toBe(true);
  });
  it("rejects invalid poses and preserves the original immutable input", () => {
    const s = initial();
    expect(() => debug.setBrightness(s, 2)).toThrow();
    expect(() => debug.setForagerTile(s, 0, 0)).toThrow();
    expect(() => debug.setPredatorMind(s, 99, false)).toThrow();
    expect(() => debug.setMaze(s, ["."])).toThrow();
    expect(() =>
      debug.setMenuIndex(debug.setScreen(s, "playing"), 0),
    ).toThrow();
    const n = debug.setScore(s, 50);
    expect(s.score).toBe(0);
    expect(n.score).toBe(50);
    expect(debug.reconcile(debug.reconcile(n))).toEqual(debug.reconcile(n));
  });
});

describe("engine-driven controls and timing", () => {
  it("runs countdown, menus, remembered title selection, pause and mute", async () => {
    const { e, key } = await harness();
    key("ArrowDown");
    await e.advance(1);
    key("ArrowDown", false);
    key("Enter");
    await e.advance(1);
    key("Enter", false);
    expect(e.state.screen).toBe("howto");
    key("Escape");
    await e.advance(1);
    key("Escape", false);
    expect(e.state.menuIndex).toBe(1);
    key("ArrowUp");
    await e.advance(1);
    key("ArrowUp", false);
    key("Enter");
    await e.advance(1);
    key("Enter", false);
    expect(e.state.screen).toBe("countdown");
    await e.advance(239);
    expect(e.state.screen).toBe("playing");
    key("Escape");
    await e.advance(1);
    key("Escape", false);
    expect(e.state.screen).toBe("paused");
    const time = e.state.playTime;
    await e.advance(10);
    expect(e.state.playTime).toBe(time);
    key("Escape");
    await e.advance(1);
    key("Escape", false);
    expect(e.state.screen).toBe("playing");
    key("KeyM");
    await e.advance(1);
    expect(e.state.muted).toBe(true);
  });
  it("uses both pointer edges and returns from howto by click", async () => {
    const { e, events } = await harness();
    const a = e.debug.menuItemRect(e.state, 0)!,
      b = e.debug.menuItemRect(e.state, 1)!;
    pointer(events, "pointerdown", a.x + 10, a.y + 10);
    pointer(events, "pointerup", b.x + 10, b.y + 10);
    await e.advance(1);
    expect(e.state.screen).toBe("title");
    pointer(events, "pointerdown", b.x + 10, b.y + 10);
    pointer(events, "pointerup", b.x + 10, b.y + 10);
    await e.advance(1);
    expect(e.state.screen).toBe("howto");
    pointer(events, "pointerdown", 40, 40);
    pointer(events, "pointerup", 45, 45);
    await e.advance(1);
    expect(e.state.screen).toBe("title");
    expect(e.state.menuIndex).toBe(1);
  });
  it("slides at exactly four tiles per second, stops on release and reverses mid-tile", async () => {
    const { e, pose, key, play } = await harness();
    play();
    pose((s) => debug.setMaze(s, corridor()));
    pose((s) => debug.setForagerTile(s, 5, 5));
    key("ArrowRight");
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(center(6, 5).x, 8);
    key("ArrowRight", false);
    await e.advance(30);
    expect(e.state.forager.moving).toBe(false);
    expect(e.state.forager.x).toBeCloseTo(center(6, 5).x);
    key("ArrowRight");
    await e.advance(10);
    key("ArrowRight", false);
    key("ArrowLeft");
    await e.advance(10);
    expect(e.state.forager.x).toBeCloseTo(center(6, 5).x);
    expect(e.state.forager.dir).toBe("left");
  });
  it("buffers perpendicular turns until the junction center", async () => {
    const { e, pose, key, play } = await harness();
    play();
    pose((s) =>
      debug.setMaze(
        s,
        fixture([
          [5, 5, "."],
          [6, 5, "."],
          [7, 5, "."],
          [6, 4, "."],
          [6, 3, "."],
        ]),
      ),
    );
    pose((s) => debug.setForagerTile(s, 5, 5));
    key("ArrowRight");
    await e.advance(10);
    key("ArrowUp");
    await e.advance(20);
    expect(e.state.forager.y).toBe(center(6, 5).y);
    await e.advance(10);
    expect(e.state.forager.x).toBeCloseTo(center(6, 5).x);
    expect(e.state.forager.y).toBeLessThan(center(6, 5).y);
  });
  it("wraps continuously and holds on a closed or isolated fixture tile", async () => {
    const { e, pose, key, play } = await harness();
    play();
    pose((s) => debug.setMaze(s, corridor(5, 0, 35)));
    pose((s) => debug.setForagerTile(s, 0, 5));
    key("ArrowLeft");
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(center(35, 5).x);
    pose((s) => debug.setMaze(s, fixture([[35, 5, "."]])));
    const x = e.state.forager.x;
    await e.advance(60);
    expect(e.state.forager.x).toBeCloseTo(x, 8);
  });
  it("gives identical simulation under different frame partitions and retains fractional input edges", async () => {
    const a = await harness(new ConstantClock(1000 / 60)),
      b = await harness(new SequenceClock([3, 7, 10]));
    a.play();
    b.play();
    a.key("ArrowRight");
    b.key("ArrowRight");
    await a.e.advance(60);
    await b.e.advance(150);
    expect(a.e.debug.snapshot(a.e.state)).toEqual(
      b.e.debug.snapshot(b.e.state),
    );
    const tiny = await harness(new ConstantClock(1000 / 240));
    tiny.play();
    tiny.key("Space");
    await tiny.e.advance(1);
    tiny.key("Space", false);
    await tiny.e.advance(1);
    expect(tiny.e.state.pulses).toHaveLength(1);
  });
});

describe("sensing and hunting", () => {
  it("remembers terrain outside the window, stops light at rock and leaves fog untouched by reconcile", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) => debug.setMaze(s, corridor()));
    pose((s) => debug.setForagerTile(s, 5, 5));
    pose((s) => debug.clearFog(s));
    await e.advance(1);
    expect(e.state.visibility[5]![5]).toBe("l");
    expect(e.state.visibility[5]![9]).toBe("u");
    pose((s) => debug.setForagerTile(s, 20, 5));
    await e.advance(1);
    expect(e.state.visibility[5]![5]).toBe("r");
    pose((s) => debug.clearFog(s));
    pose((s) => debug.reconcile(s));
    expect(e.state.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(lineClear(e.state, center(5, 5), center(5, 3))).toBe(false);
  });
  it("sonar travels around corners, marks only non-amber hunters and alerts Gloamfin on arrival", async () => {
    const { e, pose, play, key } = await harness();
    play();
    pose((s) => debug.setMaze(s, corridor()));
    pose((s) => debug.setForagerTile(s, 2, 5));
    pose((s) => debug.addPredator(s, "gloamfin", 8, 5));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    pose((s) => debug.addPredator(s, "lanternjaw", 7, 5));
    pose((s) => debug.setPredatorMind(s, 1, false));
    pose((s) => debug.clearFog(s));
    key("Space");
    await e.advance(1);
    key("Space", false);
    expect(e.state.predators[0]!.state).toBe("wander");
    await e.advance(51);
    expect(e.state.predators[0]!.state).toBe("chase");
    expect(e.state.predators[0]!.alert).toBe(true);
    expect(e.state.predators[0]!.lit).toBe(true);
    expect(e.state.predators[1]!.lit).toBe(false);
    expect(e.state.visibility[5]![8]).not.toBe("u");
  });
  it("ink immediately breaks light fixes but has no effect on close hearing", async () => {
    const { e, pose, play, key } = await harness();
    play();
    pose((s) => debug.setMaze(s, corridor()));
    pose((s) => debug.setForagerTile(s, 5, 5));
    for (const k of ["lanternjaw", "gloamfin", "flarefish"] as const)
      pose((s) => debug.addPredator(s, k, 7, 5));
    for (let i = 0; i < 3; i++)
      pose((s) => debug.setPredatorTravel(s, i, false));
    await e.advance(1);
    expect(e.state.predators.every((p) => p.state === "chase")).toBe(true);
    key("ShiftLeft");
    await e.advance(1);
    key("ShiftLeft", false);
    expect(e.state.predators[0]!.state).toBe("wander");
    expect(e.state.predators[2]!.state).toBe("wander");
    expect(e.state.predators[1]!.hearingLock).toBe(true);
    expect(e.state.inkClouds).toHaveLength(1);
    expect(e.state.ink.cooldown).toBeGreaterThan(7);
  });
  it("keeps body travel and mind independent, paths around stone and holds at the fixed tile", async () => {
    const { e, pose, play } = await harness();
    play();
    const cells: [number, number, string][] = [];
    for (let x = 5; x <= 9; x++) cells.push([x, 5, "."], [x, 3, "."]);
    cells.push([5, 4, "."], [9, 4, "."]);
    pose((s) => debug.setMaze(s, fixture(cells)));
    pose((s) => debug.setForagerTile(s, 9, 5));
    pose((s) => debug.addPredator(s, "lanternjaw", 5, 5));
    pose((s) => debug.setPredatorState(s, 0, "chase"));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(100);
    expect(e.state.predators[0]!.x).toBe(center(5, 5).x);
    pose((s) => debug.setPredatorMind(s, 0, false));
    pose((s) => debug.setPredatorTravel(s, 0, true));
    await e.advance(100);
    expect(e.state.predators[0]!.x).toBe(center(5, 5).x);
  });
  it("releases predators at staggered times while travel can hold them in den", async () => {
    const { e, pose } = await harness();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setScreen(s, "playing"));
    for (let i = 0; i < 3; i++)
      pose((s) => debug.setPredatorTravel(s, i, false));
    await e.advance(1);
    expect(e.state.predators.map((p) => p.released)).toEqual([
      true,
      false,
      false,
    ]);
    await e.advance(600);
    expect(e.state.predators.map((p) => p.released)).toEqual([
      true,
      true,
      false,
    ]);
    expect(e.state.predators.every((p) => p.state === "den")).toBe(true);
  });
  it("flare charges then reveals through walls beyond the outer circle and later restores blackout memory", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) => debug.setMaze(s, corridor()));
    pose((s) => debug.setForagerTile(s, 2, 5));
    pose((s) => debug.addPredator(s, "flarefish", 25, 5));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(840);
    expect(e.state.predators[0]!.flareCharging).toBe(true);
    await e.advance(61);
    expect(e.state.predators[0]!.flaring).toBe(true);
    expect(e.state.visibility[5]![25]).toBe("l");
    expect(e.state.visibility[4]![25]).toBe("l");
    await e.advance(121);
    expect(e.state.predators[0]!.flaring).toBe(false);
    expect(e.state.visibility[5]![25]).toBe("r");
  });
});

describe("scoring and progression", () => {
  it("eats on tile entry, holds and decays brightness, with exact scores and clear transition", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) => debug.setPlankton(s, 17, 13, true));
    await e.advance(1);
    expect(e.state.score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
    expect(e.state.screen).toBe("cleared");
    await e.advance(240);
    expect(e.state.depth).toBe(2);
    expect(e.state.predators).toHaveLength(4);
    expect(e.state.sonar.range).toBe(8);
    expect(e.state.screen).toBe("countdown");
  });
  it("brightness holds, then halves on the specified curve", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) => debug.setBrightness(s, 1));
    pose((s) => debug.setBrightHold(s, 1));
    await e.advance(120);
    expect(e.state.brightness).toBe(1);
    await e.advance(108);
    expect(e.state.brightness).toBeCloseTo(0.5, 2);
    expect(e.state.windowRadius).toBeCloseTo(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * e.state.brightness,
    );
  });
  it("drifter cadence admits at the gate, paused minds hold, and eating pays the bonus", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) => debug.setPlankton(s, 1, 1, true));
    pose((s) => debug.setDrifterIn(s, 0));
    await e.advance(1);
    expect(e.state.drifters).toHaveLength(1);
    pose((s) => debug.setDrifterMind(s, 0, false));
    const d = e.state.drifters[0]!;
    pose((s) => debug.setForagerTile(s, d.tx, d.ty));
    await e.advance(1);
    expect(e.state.score).toBe(C.SCORE_DRIFTER);
    expect(e.state.drifters).toHaveLength(0);
  });
  it("loses reserve lives, preserves score/plankton/fog and ends the last attempt at zero reserve", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) => debug.setScore(s, 120));
    pose((s) => debug.addPredator(s, "lanternjaw", 17, 13));
    pose((s) => debug.setPredatorMind(s, 0, false));
    await e.advance(1);
    expect(e.state.lives).toBe(2);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.score).toBe(120);
    expect(e.state.planktonRemaining).toBe(0);
    expect(e.state.visibility[13]![17]).not.toBe("u");
    pose((s) => debug.clearPredators(s));
    pose((s) => debug.setScreen(s, "playing"));
    pose((s) => debug.setLives(s, 0));
    pose((s) => debug.addPredator(s, "gloamfin", 17, 13));
    pose((s) => debug.setPredatorMind(s, 0, false));
    await e.advance(1);
    expect(e.state.screen).toBe("gameover");
    expect(e.state.menuIndex).toBe(0);
  });
  it("reset returns to fresh title values with mute preserved and depth caps roster", () => {
    let s = initial();
    s = debug.setDepth(s, 80);
    expect(s.predators).toHaveLength(6);
    expect(s.sonar.range).toBe(C.SONAR_RANGE_MIN);
    s.muted = true;
    const reset = debug.reset(s);
    expect(debug.snapshot(reset)).toEqual(debug.snapshot(initial({}, true)));
  });
});

describe("predator fixes, search and effect lifecycle", () => {
  it("pursues a posed fix by a shortest route around rock", async () => {
    const { e, pose, play } = await harness();
    play();
    const cells: [number, number, string][] = [];
    for (let x = 5; x <= 9; x++) cells.push([x, 3, "."]);
    cells.push([5, 4, "."], [5, 5, "."], [9, 4, "."], [9, 5, "."]);
    pose((s) => debug.setMaze(s, fixture(cells)));
    pose((s) => debug.setForagerTile(s, 9, 5));
    pose((s) => debug.addPredator(s, "lanternjaw", 5, 5));
    pose((s) => debug.setPredatorState(s, 0, "chase"));
    await e.advance(30);
    expect(e.state.predators[0]!.dir).toBe("up");
    expect(e.state.predators[0]!.y).toBeLessThan(center(5, 5).y);
    expect(e.state.predators[0]!.x).toBe(center(5, 5).x);
  });
  it("light hunters linger on the last seen tile then return to wander without a fresh alert", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) => debug.setMaze(s, corridor()));
    pose((s) => debug.setForagerTile(s, 8, 5));
    pose((s) => debug.addPredator(s, "lanternjaw", 5, 5));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(e.state.predators[0]!.state).toBe("chase");
    pose((s) => debug.setForagerTile(s, 25, 5));
    await e.advance(239);
    expect(e.state.predators[0]!.state).toBe("chase");
    await e.advance(2);
    expect(e.state.predators[0]!.state).toBe("wander");
    expect(e.state.predators[0]!.alert).toBe(false);
  });
  it("Gloamfin hears through rock and ink, and a ping alone does not reveal ground", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) =>
      debug.setMaze(
        s,
        fixture([
          [5, 5, "."],
          [5, 3, "."],
          [20, 5, "."],
        ]),
      ),
    );
    pose((s) => debug.setForagerTile(s, 5, 5));
    pose((s) => debug.addPredator(s, "gloamfin", 5, 3));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(e.state.predators[0]!.hearingLock).toBe(true);
    expect(e.state.predators[0]!.state).toBe("chase");
    pose((s) => debug.setForagerTile(s, 20, 5));
    pose((s) => debug.clearFog(s));
    await e.advance(1);
    expect(e.state.pulses.some((p) => p.tint === "violet")).toBe(true);
    expect(e.state.visibility[3]![5]).toBe("u");
  });
  it("keeps an echo fix stationary, searches it, casts one orange ping and gives up", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) => debug.setMaze(s, corridor()));
    pose((s) => debug.setForagerTile(s, 8, 5));
    pose((s) => debug.addPredator(s, "gloamfin", 8, 5));
    pose((s) => debug.setPredatorState(s, 0, "chase"));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    pose((s) => debug.setForagerTile(s, 30, 5));
    await e.advance(1);
    expect(e.state.predators[0]!.state).toBe("search");
    await e.advance(145);
    expect(e.state.pulses.some((p) => p.tint === "orange")).toBe(true);
    expect(e.state.predators[0]!.searchPing).toBe(true);
    expect(e.state.predators[0]!.fix).toEqual({ tx: 8, ty: 5 });
    await e.advance(460);
    expect(e.state.predators[0]!.state).toBe("wander");
  });
  it("Gloamfin loses speed on a corner and ramps back to its chase cap", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) =>
      debug.setMaze(
        s,
        fixture([
          [5, 5, "."],
          [5, 4, "."],
          [5, 3, "."],
          [6, 3, "."],
          [7, 3, "."],
          [8, 3, "."],
          [9, 3, "."],
        ]),
      ),
    );
    pose((s) => debug.setForagerTile(s, 9, 3));
    pose((s) => debug.addPredator(s, "gloamfin", 5, 5));
    pose((s) => debug.setPredatorDir(s, 0, "right"));
    pose((s) => debug.setPredatorState(s, 0, "chase"));
    await e.advance(1);
    expect(e.state.predators[0]!.speed).toBe(C.GLOAMFIN_CORNER_SPEED);
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(120);
    expect(e.state.predators[0]!.speed).toBeCloseTo(
      (C.GLOAMFIN_CHASE_SPEED + C.GLOAMFIN_CORNER_SPEED) / 2,
    );
    await e.advance(120);
    expect(e.state.predators[0]!.speed).toBe(C.GLOAMFIN_CHASE_SPEED);
  });
  it("locks during a bloom through stone, ends it immediately, and alerts the player", async () => {
    const { e, pose, play } = await harness();
    play();
    pose((s) =>
      debug.setMaze(
        s,
        fixture([
          [5, 5, "."],
          [9, 5, "."],
          [30, 5, "."],
        ]),
      ),
    );
    pose((s) => debug.setForagerTile(s, 30, 5));
    pose((s) => debug.addPredator(s, "flarefish", 5, 5));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(910);
    expect(e.state.predators[0]!.flaring).toBe(true);
    pose((s) => debug.setForagerTile(s, 9, 5));
    await e.advance(1);
    expect(e.state.predators[0]!.state).toBe("chase");
    expect(e.state.predators[0]!.flaring).toBe(false);
    expect(e.state.predators[0]!.alert).toBe(true);
    expect(e.state.predators[0]!.flareRadius).toBe(0);
  });
  it("deduplicates simultaneous cue events and emits muted cues without altering gameplay", async () => {
    const { e, pose, play, key } = await harness();
    play();
    pose((s) => debug.setMaze(s, corridor()));
    pose((s) => debug.setForagerTile(s, 30, 5));
    for (let i = 0; i < 2; i++) {
      pose((s) => debug.addPredator(s, "gloamfin", 5 + i, 5));
      pose((s) => debug.setPredatorTravel(s, i, false));
    }
    const cues: { cue: string; gain: number }[] = [];
    e.events.on("cue:played", (event) => cues.push(event));
    key("KeyM");
    await e.advance(481);
    expect(cues.filter((c) => c.cue === C.CUES.predatorPing)).toHaveLength(1);
    expect(cues[0]!.gain).toBe(0);
  });
  it("enforces sonar and ink cooldowns, expires marks and clouds, and accepts oversized debug cooldowns", async () => {
    const { e, pose, play, key } = await harness();
    play();
    key("Space");
    key("ShiftLeft");
    await e.advance(1);
    key("Space", false);
    key("ShiftLeft", false);
    const counts = e.state.pulses.length;
    key("Space");
    key("ShiftLeft");
    await e.advance(1);
    key("Space", false);
    key("ShiftLeft", false);
    expect(e.state.pulses.length).toBe(counts);
    expect(e.state.inkClouds).toHaveLength(1);
    await e.advance(361);
    expect(e.state.inkClouds).toHaveLength(0);
    expect(e.state.pulses).toHaveLength(0);
    expect(e.state.sonar.ready).toBe(true);
    pose((s) => debug.setSonarCooldown(s, 100));
    pose((s) => debug.setInkCooldown(s, 200));
    await e.advance(120);
    expect(e.state.sonar.cooldown).toBeCloseTo(99);
    expect(e.state.ink.cooldown).toBeCloseTo(199);
  });
  it("restarts and quits through pause, and keeps an empty fixture live without a den", async () => {
    const { e, pose, key, play } = await harness();
    play();
    pose((s) => debug.setMaze(s, corridor()));
    pose((s) => debug.setScore(s, 150));
    pose((s) => debug.setScreen(s, "paused"));
    pose((s) => debug.setMenuIndex(s, 1));
    key("Enter");
    await e.advance(1);
    key("Enter", false);
    expect(e.state.score).toBe(0);
    expect(e.state.screen).toBe("countdown");
    pose((s) => debug.setScreen(s, "paused"));
    pose((s) => debug.setMenuIndex(s, 2));
    key("Enter");
    await e.advance(1);
    key("Enter", false);
    expect(e.state.screen).toBe("title");
    expect(e.state.lives).toBe(C.START_LIVES);
    pose((s) => debug.setMaze(s, corridor()));
    pose((s) => debug.setForagerTile(s, 5, 5));
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setDrifterIn(s, 0));
    pose((s) => debug.setScreen(s, "playing"));
    await e.advance(600);
    expect(e.state.screen).toBe("playing");
    expect(e.state.drifters).toHaveLength(0);
    expect(e.state.predators.every((p) => p.state === "den")).toBe(true);
  });
});
