import * as C from "./constants";
import {
  type ReadState,
  type FathomState,
  type Direction,
  type Screen,
  type PredatorKind,
  clone,
  initial,
  arrive,
  center,
  layer,
  replace,
  roster,
  predator,
  reconcileMutable,
  DIRECTIONS,
} from "./state";
import { tile } from "./core";
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export function menuItems(s: Pick<FathomState, "screen">): readonly string[] {
  return s.screen === "title"
    ? C.TITLE_ITEMS
    : s.screen === "paused"
      ? C.PAUSE_ITEMS
      : s.screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuItemRect(s: ReadState, index: number): Rect | null {
  return Number.isInteger(index) && index >= 0 && index < menuItems(s).length
    ? { x: 480, y: 390 + index * 64, w: 320, h: 50 }
    : null;
}
function valid(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RangeError(`Fathom: ${message}`);
}
function number(n: number, min = 0, max = Infinity, integer = false) {
  valid(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n)),
    "invalid number",
  );
}
function position(s: ReadState, tx: number, ty: number, chars = ".") {
  number(tx, 0, C.GRID_COLS - 1, true);
  number(ty, 0, C.GRID_ROWS - 1, true);
  valid(chars.includes(tile(s, tx, ty)), "tile is closed");
}
function direction(d: Direction) {
  valid(DIRECTIONS.includes(d), "invalid direction");
}
function pose(s: ReadState, fn: (s: FathomState) => void) {
  const n = clone(s);
  fn(n);
  reconcileMutable(n);
  return n;
}
function subject<T>(list: T[], index: number): T {
  number(index, 0, list.length - 1, true);
  return list[index]!;
}
export function snapshot(s: ReadState) {
  const {
    assets: _assets,
    pendingSonar: _sonar,
    pendingInk: _ink,
    remainder: _remainder,
    screenTime: _screenTime,
    playTime: _playTime,
    desired: _desired,
    rng: _rng,
    start: _start,
    pointerStart: _pointer,
    ...world
  } = clone(s);
  return {
    ...world,
    forager: { ...world.forager },
    drifters: world.drifters.map(({ dir: _dir, ...d }) => d),
    predators: world.predators.map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      dir: p.dir,
      state: p.state,
      released: p.released,
      mind: p.mind,
      travel: p.travel,
      speed: p.speed,
      alert: p.alert,
      lit: p.lit,
      detectRange: p.detectRange,
      hearingRange: p.hearingRange,
      hearingLock: p.hearingLock,
      flareCharging: p.flareCharging,
      flaring: p.flaring,
      flareRadius: p.flareRadius,
    })),
    pulses: world.pulses.map(({ owner: _owner, caught: _caught, ...p }) => p),
  };
}
export const debug = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s: ReadState) =>
    initial(s.assets as Record<string, ImageBitmap[]>, s.muted),
  snapshot,
  reconcile: (s: ReadState) => pose(s, () => {}),
  menuItemRect,
  setScreen: (s: ReadState, screen: Screen) => {
    valid(
      [
        "title",
        "howto",
        "countdown",
        "playing",
        "paused",
        "cleared",
        "gameover",
      ].includes(screen),
      "invalid screen",
    );
    return pose(s, (n) => arrive(n, screen));
  },
  setMenuIndex: (s: ReadState, index: number) => {
    number(index, 0, menuItems(s).length - 1, true);
    return pose(s, (n) => (n.menuIndex = index));
  },
  setTitleIndex: (s: ReadState, index: number) => {
    number(index, 0, C.TITLE_ITEMS.length - 1, true);
    return pose(s, (n) => (n.titleIndex = index));
  },
  setScore: (s: ReadState, points: number) => {
    number(points, 0, Infinity, true);
    return pose(s, (n) => (n.score = points));
  },
  setLives: (s: ReadState, lives: number) => {
    number(lives, 0, Infinity, true);
    return pose(s, (n) => (n.lives = lives));
  },
  setDepth: (s: ReadState, depth: number) => {
    number(depth, 1, Infinity, true);
    return pose(s, (n) => {
      n.depth = depth;
      n.predators = roster(depth);
      n.playTime = 0;
    });
  },
  setMaze: (s: ReadState, rows: readonly string[]) => {
    valid(
      rows.length === C.GRID_ROWS &&
        rows.every((r) => r.length === C.GRID_COLS && /^[#.gd]+$/.test(r)),
      "invalid maze",
    );
    const all = rows.join("");
    valid(
      !/[gd]/.test(all) || [...all].filter((c) => c === "g").length === 1,
      "invalid den gate",
    );
    return pose(s, (n) => (n.tiles = [...rows]));
  },
  setPlankton: (s: ReadState, tx: number, ty: number, present: boolean) => {
    position(s, tx, ty);
    valid(typeof present === "boolean", "invalid present");
    return pose(s, (n) => replace(n.plankton, tx, ty, present ? "*" : "-"));
  },
  clearPlankton: (s: ReadState) => pose(s, (n) => (n.plankton = layer("-"))),
  clearFog: (s: ReadState) => pose(s, (n) => (n.visibility = layer("u"))),
  setForagerTile: (s: ReadState, tx: number, ty: number) => {
    position(s, tx, ty);
    return pose(
      s,
      (n) => (n.forager = { ...n.forager, ...center(tx, ty), moving: false }),
    );
  },
  setForagerDir: (s: ReadState, dir: Direction) => {
    direction(dir);
    return pose(s, (n) => {
      n.forager.dir = dir;
      n.forager.moving = false;
      n.desired = dir;
    });
  },
  setBrightness: (s: ReadState, g: number) => {
    number(g, 0, 1);
    return pose(s, (n) => (n.brightness = g));
  },
  setBrightHold: (s: ReadState, seconds: number) => {
    number(seconds, 0, C.BRIGHT_HOLD);
    return pose(s, (n) => (n.brightHold = seconds));
  },
  clearPredators: (s: ReadState) => pose(s, (n) => (n.predators = [])),
  addPredator: (s: ReadState, kind: PredatorKind, tx: number, ty: number) => {
    valid(C.DEN_ORDER.includes(kind), "invalid kind");
    position(s, tx, ty);
    return pose(s, (n) => n.predators.push(predator(kind, tx, ty)));
  },
  setPredatorTile: (s: ReadState, index: number, tx: number, ty: number) => {
    position(s, tx, ty, ".dg");
    return pose(s, (n) =>
      Object.assign(subject(n.predators, index), center(tx, ty)),
    );
  },
  setPredatorDir: (s: ReadState, index: number, dir: Direction) => {
    direction(dir);
    return pose(s, (n) => (subject(n.predators, index).dir = dir));
  },
  setPredatorState: (
    s: ReadState,
    index: number,
    state: "den" | "wander" | "chase",
  ) =>
    pose(s, (n) => {
      valid(
        ["den", "wander", "chase"].includes(state),
        "invalid predator state",
      );
      const p = subject(n.predators, index);
      position(n, p.tx, p.ty, state === "den" ? "dg" : ".");
      p.state = state;
      p.fix = state === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      p.linger = C.LINGER_TIME;
      p.alertLeft = 0;
      p.alert = false;
      p.hearingLock = p.kind === "gloamfin" ? false : null;
      if (state === "den") p.lit = false;
      p.flareIn = C.FLARE_INTERVAL;
      p.flareTime = 0;
      p.searchTime = 0;
    }),
  setPredatorReleased: (s: ReadState, index: number, released: boolean) =>
    pose(s, (n) => {
      valid(typeof released === "boolean", "invalid released");
      subject(n.predators, index).released = released;
    }),
  setPredatorMind: (s: ReadState, index: number, enabled: boolean) =>
    pose(s, (n) => {
      valid(typeof enabled === "boolean", "invalid enabled");
      subject(n.predators, index).mind = enabled;
    }),
  setPredatorTravel: (s: ReadState, index: number, enabled: boolean) =>
    pose(s, (n) => {
      valid(typeof enabled === "boolean", "invalid enabled");
      subject(n.predators, index).travel = enabled;
    }),
  spawnDrifter: (s: ReadState, tx: number, ty: number) => {
    position(s, tx, ty);
    return pose(s, (n) =>
      n.drifters.push({
        ...center(tx, ty),
        dir: "up",
        mind: true,
        travel: true,
        lit: false,
      }),
    );
  },
  clearDrifters: (s: ReadState) => pose(s, (n) => (n.drifters = [])),
  setDrifterMind: (s: ReadState, index: number, enabled: boolean) =>
    pose(s, (n) => {
      valid(typeof enabled === "boolean", "invalid enabled");
      subject(n.drifters, index).mind = enabled;
    }),
  setDrifterTravel: (s: ReadState, index: number, enabled: boolean) =>
    pose(s, (n) => {
      valid(typeof enabled === "boolean", "invalid enabled");
      subject(n.drifters, index).travel = enabled;
    }),
  setDrifterIn: (s: ReadState, seconds: number) => {
    number(seconds, 0, C.DRIFTER_INTERVAL);
    return pose(s, (n) => (n.drifterIn = seconds));
  },
  setSonarCooldown: (s: ReadState, seconds: number) => {
    number(seconds);
    return pose(s, (n) => (n.sonar.cooldown = seconds));
  },
  setInkCooldown: (s: ReadState, seconds: number) => {
    number(seconds);
    return pose(s, (n) => (n.ink.cooldown = seconds));
  },
};
export type FathomDebugApi = typeof debug;
