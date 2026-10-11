import type { DeepReadonly } from "ts-essentials";
import * as C from "./constants";
export type Direction = "up" | "down" | "left" | "right";
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";
export type PredatorKind = C.PredatorKind;
export interface Body {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Direction;
}
export interface Forager extends Body {
  moving: boolean;
}
export interface Drifter extends Body {
  lit: boolean;
  mind: boolean;
  travel: boolean;
}
export interface Predator extends Drifter {
  kind: PredatorKind;
  state: "den" | "wander" | "chase" | "search";
  released: boolean;
  speed: number;
  alert: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
  fix: { tx: number; ty: number } | null;
  linger: number;
  alertLeft: number;
  mark: number;
  pingIn: number;
  sincePing: number;
  searchTime: number;
  searchPing: boolean;
  flareIn: number;
  flareTime: number;
  fade: number;
  chaseSpeed: number;
  slot: number | null;
}
export interface Pulse {
  source: "forager" | "gloamfin";
  tint: "cyan" | "violet" | "orange";
  ox: number;
  oy: number;
  front: number;
  range: number;
  owner: number | null;
  caught: boolean;
}
export interface InkCloud {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}
export interface FathomState {
  version: number;
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  windowRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: Forager;
  drifters: Drifter[];
  predators: Predator[];
  pulses: Pulse[];
  inkClouds: InkCloud[];
  simTime: number;
  assets: Record<string, ImageBitmap[]>;
  pendingSonar: boolean;
  pendingInk: boolean;
  remainder: number;
  screenTime: number;
  playTime: number;
  desired: Direction;
  rng: number;
  start: { tx: number; ty: number };
  pointerStart: { id: number; index: number | null; screen: Screen } | null;
}
export type ReadState = DeepReadonly<FathomState>;
export const DIRECTIONS: Direction[] = ["up", "right", "down", "left"];
export const VECTOR: Record<Direction, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
export const opposite = (d: Direction): Direction =>
  DIRECTIONS[(DIRECTIONS.indexOf(d) + 2) % 4]!;
export function center(tx: number, ty: number) {
  return {
    x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
    y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
    tx,
    ty,
  };
}
export function locate(b: Body) {
  b.tx = Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE);
  b.ty = Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE);
}
export function clone(s: ReadState): FathomState {
  const { assets, ...data } = s;
  return { ...structuredClone(data), assets } as FathomState;
}
export function layer(ch: string) {
  return Array.from({ length: C.GRID_ROWS }, () => ch.repeat(C.GRID_COLS));
}
export function replace(rows: string[], tx: number, ty: number, ch: string) {
  rows[ty] = rows[ty]!.slice(0, tx) + ch + rows[ty]!.slice(tx + 1);
}
export function maze(): string[] {
  const a = Array.from({ length: C.GRID_ROWS }, () =>
    Array<string>(C.GRID_COLS).fill("#"),
  );
  const columns = [1, 5, 9, 13, 22, 26, 30, 34];
  for (let y = 1; y < C.GRID_ROWS - 2; y++)
    for (let x = 1; x < C.GRID_COLS - 1; x++)
      if (y % 2 === 1 || columns.includes(x)) a[y]![x] = ".";
  for (let y = 6; y <= 10; y++) for (let x = 15; x <= 20; x++) a[y]![x] = "#";
  for (let y = 7; y <= 9; y++) for (let x = 16; x <= 19; x++) a[y]![x] = "d";
  a[6]![17] = "g";
  a[11]![0] = a[11]![C.GRID_COLS - 1] = ".";
  // Trim the short stubs beside the enclosed den; every corridor remains a loop.
  for (let y = 7; y <= 9; y += 2) {
    a[y]![14] = "#";
    a[y]![21] = "#";
  }
  return a.map((r) => r.join(""));
}
export function predator(
  kind: PredatorKind,
  tx: number,
  ty: number,
  slot: number | null = null,
): Predator {
  return {
    ...center(tx, ty),
    dir: "up",
    kind,
    state: slot === null ? "wander" : "den",
    released: slot === null,
    mind: true,
    travel: true,
    lit: false,
    speed: C.PREDATOR_SPEED,
    alert: false,
    detectRange: kind === "gloamfin" ? null : C.LANTERN_RANGE_BASE,
    hearingRange: kind === "gloamfin" ? C.GLOAMFIN_HEAR : null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    linger: 0,
    alertLeft: 0,
    mark: 0,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    sincePing: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    flareIn: C.FLARE_INTERVAL,
    flareTime: 0,
    fade: 0,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    slot,
  };
}
export function roster(depth: number): Predator[] {
  const kinds = [...C.DEN_ORDER];
  for (let i = 0; i < Math.min(depth, C.ROSTER_CAP_DEPTH) - 1; i++)
    kinds.push(C.ROSTER_ADD_ORDER[i]!);
  return kinds.map((k, i) =>
    predator(k, 16 + (i % 4), 8 + Math.floor(i / 4), i),
  );
}
export function reconcileMutable(s: FathomState) {
  locate(s.forager);
  s.drifters.forEach(locate);
  s.predators.forEach((p) => {
    locate(p);
    p.speed =
      p.kind === "lanternjaw" && p.state !== "chase"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
  });
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (s.depth - 1),
  );
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.reduce(
    (n, r) => n + [...r].filter((c) => c === "*").length,
    0,
  );
}
export function initial(
  assets: Record<string, ImageBitmap[]> = {},
  muted = false,
): FathomState {
  const tiles = maze();
  const start = { tx: 17, ty: 13 };
  const s: FathomState = {
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) => r.replace(/[^.]/g, "-").replace(/\./g, "*")),
    visibility: layer("u"),
    forager: { ...center(start.tx, start.ty), dir: "left", moving: false },
    drifters: [],
    predators: roster(1),
    pulses: [],
    inkClouds: [],
    simTime: 0,
    assets,
    pendingSonar: false,
    pendingInk: false,
    remainder: 0,
    screenTime: 0,
    playTime: 0,
    desired: "left",
    rng: 0xfa710,
    start,
    pointerStart: null,
  };
  reconcileMutable(s);
  return s;
}
export function arrive(s: FathomState, screen: Screen) {
  s.screen = screen;
  s.screenTime = 0;
  s.menuIndex =
    screen === "title"
      ? s.titleIndex
      : ["paused", "gameover"].includes(screen)
        ? 0
        : null;
  if (screen === "playing") s.playTime = 0;
}
