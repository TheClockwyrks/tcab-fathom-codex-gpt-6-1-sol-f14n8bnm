import * as C from "./constants";
import {
  type FathomState,
  type Body,
  type Direction,
  type Predator,
  type Pulse,
  DIRECTIONS,
  VECTOR,
  opposite,
  center,
  locate,
  replace,
  reconcileMutable,
  roster,
  arrive,
  initial,
} from "./state";
// Clamp negligible floating-point residues at a tick boundary to zero.
function countdown(seconds: number) {
  return seconds <= C.TICK_DT + 1e-10 ? 0 : seconds - C.TICK_DT;
}
export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.hypot(a.x - b.x, a.y - b.y);
export function tile(
  s: { readonly tiles: readonly string[] },
  tx: number,
  ty: number,
) {
  return s.tiles[ty]?.[tx] ?? "#";
}
export function neighbor(
  s: { readonly tiles: readonly string[] },
  tx: number,
  ty: number,
  d: Direction,
): { tx: number; ty: number } {
  const [dx, dy] = VECTOR[d];
  let x = tx + dx;
  if (
    (x < 0 || x >= C.GRID_COLS) &&
    tile(s, 0, ty) === "." &&
    tile(s, C.GRID_COLS - 1, ty) === "."
  )
    x = (x + C.GRID_COLS) % C.GRID_COLS;
  return { tx: x, ty: ty + dy };
}
export function open(
  s: { readonly tiles: readonly string[] },
  tx: number,
  ty: number,
  den = false,
) {
  const t = tile(s, tx, ty);
  return t === "." || (den && (t === "d" || t === "g"));
}
export function options(s: FathomState, b: Body, den = false) {
  return DIRECTIONS.filter((d) => {
    const n = neighbor(s, b.tx, b.ty, d);
    return open(s, n.tx, n.ty, den);
  });
}
export function flood(
  s: { readonly tiles: readonly string[] },
  tx: number,
  ty: number,
  den = false,
): Map<number, number> {
  const map = new Map<number, number>();
  if (!open(s, tx, ty, den)) return map;
  const queue = [{ tx, ty }];
  map.set(ty * C.GRID_COLS + tx, 0);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]!;
    const n = map.get(p.ty * C.GRID_COLS + p.tx)!;
    for (const d of DIRECTIONS) {
      const u = neighbor(s, p.tx, p.ty, d);
      const key = u.ty * C.GRID_COLS + u.tx;
      if (open(s, u.tx, u.ty, den) && !map.has(key)) {
        map.set(key, n + 1);
        queue.push(u);
      }
    }
  }
  return map;
}
function random(s: FathomState) {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
function wander(s: FathomState, b: Body, den = false): Direction {
  const all = options(s, b, den);
  const dirs = all.filter((d) => d !== opposite(b.dir));
  const choices = dirs.length ? dirs : all;
  return choices[Math.floor(random(s) * choices.length)] ?? b.dir;
}
export function path(
  s: FathomState,
  b: Body,
  target: { tx: number; ty: number },
  den = false,
): Direction {
  const map = flood(s, target.tx, target.ty, den);
  const dirs = options(s, b, den);
  let best = Infinity;
  let chosen = b.dir;
  for (const d of dirs) {
    const n = neighbor(s, b.tx, b.ty, d);
    const v = map.get(n.ty * C.GRID_COLS + n.tx) ?? Infinity;
    if (v < best) {
      best = v;
      chosen = d;
    }
  }
  return chosen;
}
export function move(
  s: FathomState,
  b: Body,
  speed: number,
  choose: () => Direction,
  den = false,
): boolean {
  if (!open(s, b.tx, b.ty, den)) return false;
  let remaining = speed * C.TICK_DT;
  let moved = false;
  while (remaining > 1e-8) {
    const c = center(b.tx, b.ty);
    const centered = Math.abs(c.x - b.x) < 1e-7 && Math.abs(c.y - b.y) < 1e-7;
    if (centered) {
      b.x = c.x;
      b.y = c.y;
      b.dir = choose();
      const n = neighbor(s, b.tx, b.ty, b.dir);
      if (!open(s, n.tx, n.ty, den)) break;
    }
    const [dx, dy] = VECTOR[b.dir];
    const coord = dx ? b.x : b.y;
    const origin = dx ? C.GRID_ORIGIN_X : C.GRID_ORIGIN_Y;
    const sign = dx || dy;
    const z = (coord - origin - C.TILE / 2) / C.TILE;
    let next = sign > 0 ? Math.floor(z + 1e-8) + 1 : Math.ceil(z - 1e-8) - 1;
    // At a non-center, the next center may be the center of the current tile.
    if (!centered) next = sign > 0 ? Math.ceil(z - 1e-8) : Math.floor(z + 1e-8);
    const length = Math.abs(origin + C.TILE / 2 + next * C.TILE - coord);
    const step = Math.min(remaining, length);
    b.x += dx * step;
    b.y += dy * step;
    remaining -= step;
    moved = moved || step > 0;
    const width = C.GRID_COLS * C.TILE;
    if (b.x < C.GRID_ORIGIN_X) b.x += width;
    if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    locate(b);
    if (step < 1e-8) break;
  }
  return moved;
}
/** Traverse every grid cell crossed by a segment, including very short corner crossings. */
export function lineClear(
  s: { readonly tiles: readonly string[] },
  a: { x: number; y: number },
  b: { x: number; y: number },
  targetRock = false,
) {
  const ax = (a.x - C.GRID_ORIGIN_X) / C.TILE,
    ay = (a.y - C.GRID_ORIGIN_Y) / C.TILE;
  const bx = (b.x - C.GRID_ORIGIN_X) / C.TILE,
    by = (b.y - C.GRID_ORIGIN_Y) / C.TILE;
  let tx = Math.floor(ax),
    ty = Math.floor(ay);
  const endX = Math.floor(bx),
    endY = Math.floor(by),
    dx = bx - ax,
    dy = by - ay;
  const sx = Math.sign(dx),
    sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx),
    deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let crossX = dx === 0 ? Infinity : ((sx > 0 ? tx + 1 : tx) - ax) / dx;
  let crossY = dy === 0 ? Infinity : ((sy > 0 ? ty + 1 : ty) - ay) / dy;
  for (let steps = 0; steps <= C.GRID_COLS + C.GRID_ROWS; steps++) {
    if (tile(s, tx, ty) === "#" && !(targetRock && tx === endX && ty === endY))
      return false;
    if (tx === endX && ty === endY) return true;
    if (Math.abs(crossX - crossY) < 1e-12) {
      tx += sx;
      ty += sy;
      crossX += deltaX;
      crossY += deltaY;
    } else if (crossX < crossY) {
      tx += sx;
      crossX += deltaX;
    } else {
      ty += sy;
      crossY += deltaY;
    }
  }
  return false;
}

function blinded(s: FathomState, p: Predator) {
  const f = s.forager;
  const vx = f.x - p.x,
    vy = f.y - p.y;
  const norm = vx * vx + vy * vy;
  return s.inkClouds.some((c) => {
    const t = norm
      ? Math.max(0, Math.min(1, ((c.x - p.x) * vx + (c.y - p.y) * vy) / norm))
      : 0;
    return distance(c, { x: p.x + t * vx, y: p.y + t * vy }) <= c.radius;
  });
}
function fix(s: FathomState, p: Predator, fresh = false) {
  if (p.state !== "chase" || fresh) {
    p.alertLeft = p.kind === "lanternjaw" ? 0 : C.ALERT_TIME;
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
  }
  p.state = "chase";
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") {
    if (p.flareTime > 0) p.fade = 0.4;
    p.flareTime = 0;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
  }
  const d = path(s, p, p.fix);
  if (d === opposite(p.dir)) p.dir = d;
}
function drop(p: Predator) {
  p.state = "wander";
  p.fix = null;
  p.flareIn = C.FLARE_INTERVAL;
  p.flareTime = 0;
}
function castPing(
  s: FathomState,
  p: Predator,
  index: number,
  tint: "violet" | "orange",
  cues: Set<C.CueName>,
) {
  s.pulses.push({
    source: "gloamfin",
    tint,
    ox: p.tx,
    oy: p.ty,
    front: 0,
    range: C.GLOAMFIN_PING_RANGE,
    owner: index,
    caught: false,
  });
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.sincePing = 0;
  cues.add(C.CUES.predatorPing);
}
export function castSonar(s: FathomState, cues: Set<C.CueName>) {
  if (s.sonar.cooldown > 0) return;
  s.sonar.cooldown = C.SONAR_COOLDOWN;
  s.pulses.push({
    source: "forager",
    tint: "cyan",
    ox: s.forager.tx,
    oy: s.forager.ty,
    front: 0,
    range: s.sonar.range,
    owner: null,
    caught: false,
  });
  cues.add(C.CUES.sonar);
}
export function castInk(s: FathomState, cues: Set<C.CueName>) {
  if (s.ink.cooldown > 0) return;
  s.ink.cooldown = C.INK_COOLDOWN;
  s.inkClouds.push({
    x: s.forager.x,
    y: s.forager.y,
    radius: C.INK_RADIUS,
    remaining: C.INK_LIFE,
  });
  cues.add(C.CUES.ink);
}
function predators(s: FathomState, cues: Set<C.CueName>) {
  s.predators.forEach((p, index) => {
    p.alertLeft = countdown(p.alertLeft);
    p.mark = countdown(p.mark);
    p.fade = countdown(p.fade);
    if (
      p.slot !== null &&
      !p.released &&
      s.playTime + 1e-8 >= p.slot * C.DEN_RELEASE_GAP
    )
      p.released = true;
    if (!p.mind) return;
    if (p.state === "den") {
      if (!p.released || !s.tiles.some((r) => r.includes("d"))) return;
      const gate = findGate(s);
      if (!gate) return;
      const exit = DIRECTIONS.map((d) => neighbor(s, gate.tx, gate.ty, d)).find(
        (n) => tile(s, n.tx, n.ty) === ".",
      );
      if (!exit) return;
      if (p.travel) move(s, p, p.speed, () => path(s, p, exit, true), true);
      if (tile(s, p.tx, p.ty) === ".") p.state = "wander";
      return;
    }
    if (p.kind === "gloamfin") {
      const was = p.hearingLock;
      p.hearingLock = distance(p, s.forager) <= C.GLOAMFIN_HEAR;
      p.pingIn = countdown(p.pingIn);
      p.sincePing += C.TICK_DT;
      if (p.hearingLock) fix(s, p);
      if (was && !p.hearingLock) p.pingIn = 0;
      if (
        p.state === "chase" &&
        p.fix &&
        p.tx === p.fix.tx &&
        p.ty === p.fix.ty &&
        !p.hearingLock &&
        !(p.tx === s.forager.tx && p.ty === s.forager.ty)
      ) {
        p.state = "search";
        p.searchTime = 0;
        p.searchPing = false;
      }
      if (p.state === "search") {
        p.searchTime += C.TICK_DT;
        if (p.searchTime + 1e-10 >= C.GLOAMFIN_GIVEUP) drop(p);
      }
      if (!p.hearingLock && p.sincePing + 1e-8 >= C.GLOAMFIN_PING_MIN_GAP) {
        if (
          p.state === "search" &&
          !p.searchPing &&
          p.searchTime + 1e-10 >= C.GLOAMFIN_SEARCH_DELAY
        ) {
          castPing(s, p, index, "orange", cues);
          p.searchPing = true;
        } else if (p.pingIn <= 0) castPing(s, p, index, "violet", cues);
      }
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * C.TICK_DT) /
            C.GLOAMFIN_RAMP_TIME,
      );
    } else {
      const blind = blinded(s, p);
      const sensing =
        !blind &&
        distance(p, s.forager) <= p.detectRange! &&
        lineClear(s, p, s.forager);
      if (blind) {
        if (p.state === "chase") drop(p);
      } else if (sensing) fix(s, p);
      else if (p.state === "chase") {
        p.linger = countdown(p.linger);
        if (p.linger <= 0) drop(p);
      }
      if (p.kind === "flarefish") {
        if (p.state === "wander") {
          if (p.flareTime > 0) {
            p.flareTime += C.TICK_DT;
            if (p.flareTime + 1e-10 >= C.FLARE_CHARGE + C.FLARE_BLOOM) {
              p.flareTime = 0;
              p.fade = 0.4;
              p.flareIn = C.FLARE_INTERVAL;
            }
          } else {
            p.flareIn = countdown(p.flareIn);
            if (p.flareIn <= 0) p.flareTime = Number.EPSILON;
          }
        }
        const blooming = p.flareTime + 1e-10 >= C.FLARE_CHARGE;
        if (blooming && !p.flaring) cues.add(C.CUES.flare);
        p.flareCharging = p.flareTime > 0 && !blooming;
        p.flaring = blooming;
        p.flareRadius = blooming ? C.FLARE_RADIUS : 0;
        if (blooming && !blind && distance(p, s.forager) <= C.FLARE_RADIUS)
          fix(s, p);
      }
    }
    reconcileMutable(s);
    const atFix =
      p.state === "chase" &&
      p.fix &&
      distance(p, center(p.fix.tx, p.fix.ty)) < 1e-7;
    if (p.travel && !atFix)
      move(s, p, p.speed, () => {
        let dir: Direction;
        if (p.state === "chase" && p.fix) {
          if (p.tx === p.fix.tx && p.ty === p.fix.ty) return p.dir;
          dir = path(s, p, p.fix);
        } else if (p.state === "search" && p.fix) {
          const map = flood(s, p.fix.tx, p.fix.ty);
          const allowed = options(s, p).filter((d) => {
            const n = neighbor(s, p.tx, p.ty, d);
            return (
              (map.get(n.ty * C.GRID_COLS + n.tx) ?? Infinity) <=
              C.GLOAMFIN_SEARCH_ROAM
            );
          });
          dir =
            allowed[Math.floor(random(s) * allowed.length)] ??
            path(s, p, p.fix);
        } else dir = wander(s, p);
        if (
          p.kind === "gloamfin" &&
          p.state === "chase" &&
          dir !== p.dir &&
          dir !== opposite(p.dir)
        )
          p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
        return dir;
      });
  });
}
export function findGate(s: { readonly tiles: readonly string[] }) {
  for (let y = 0; y < C.GRID_ROWS; y++) {
    const x = s.tiles[y]!.indexOf("g");
    if (x >= 0) return { tx: x, ty: y };
  }
  return null;
}
export function sense(s: FathomState) {
  const vis: string[][] = s.visibility.map((r) =>
    [...r].map((c) => (c === "u" ? "u" : "r")),
  );
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const c = center(tx, ty);
      if (
        (distance(c, s.forager) <= s.visionRadius &&
          lineClear(s, s.forager, c, true)) ||
        s.predators.some((p) => p.flaring && distance(c, p) <= C.FLARE_RADIUS)
      )
        vis[ty]![tx] = "l";
    }
  s.visibility = vis.map((r) => r.join(""));
  const bodyLit = (b: Body) =>
    (distance(b, s.forager) <= s.visionRadius && lineClear(s, s.forager, b)) ||
    s.predators.some((p) => p.flaring && distance(b, p) <= C.FLARE_RADIUS);
  s.predators.forEach((p) => {
    p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
    p.lit =
      p.state !== "den" &&
      (bodyLit(p) || p.alert || (p.kind !== "lanternjaw" && p.mark > 0));
  });
  s.drifters.forEach((d) => (d.lit = bodyLit(d)));
}
function pulses(s: FathomState) {
  for (const p of s.pulses) {
    const old = p.front;
    p.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const map = flood(s, p.ox, p.oy, true);
    const crossed = (n: number | undefined) =>
      n !== undefined &&
      n <= p.range &&
      n <= p.front &&
      (n > old || (old === 0 && n === 0));
    for (const [key, n] of map) {
      if (!crossed(n)) continue;
      const tx = key % C.GRID_COLS,
        ty = Math.floor(key / C.GRID_COLS);
      if (p.source === "forager") {
        replace(s.visibility, tx, ty, "l");
        for (const d of DIRECTIONS) {
          const u = neighbor(s, tx, ty, d);
          if (
            tile(s, u.tx, u.ty) === "#" &&
            u.tx >= 0 &&
            u.tx < C.GRID_COLS &&
            u.ty >= 0 &&
            u.ty < C.GRID_ROWS
          )
            replace(s.visibility, u.tx, u.ty, "l");
        }
      }
    }
    if (p.source === "forager")
      for (const enemy of s.predators) {
        if (
          enemy.state === "den" ||
          !crossed(map.get(enemy.ty * C.GRID_COLS + enemy.tx))
        )
          continue;
        if (enemy.kind !== "lanternjaw") enemy.mark = C.SONAR_MARK_TIME;
        if (enemy.kind === "gloamfin" && enemy.mind) fix(s, enemy, true);
      }
    else if (
      !p.caught &&
      crossed(map.get(s.forager.ty * C.GRID_COLS + s.forager.tx))
    ) {
      p.caught = true;
      const enemy = p.owner === null ? undefined : s.predators[p.owner];
      if (enemy?.mind && enemy.state !== "den") fix(s, enemy, true);
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
export function resetAttempt(s: FathomState) {
  s.forager = { ...center(s.start.tx, s.start.ty), dir: "left", moving: false };
  s.desired = "left";
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s.depth);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.playTime = 0;
  arrive(s, "countdown");
  reconcileMutable(s);
}
export function freshDive(
  s: FathomState,
  screen: "countdown" | "title" = "countdown",
) {
  const n = initial(s.assets, s.muted);
  n.titleIndex = s.titleIndex;
  n.simTime = s.simTime;
  n.remainder = s.remainder;
  arrive(n, screen);
  return n;
}
export function tick(s: FathomState, held: boolean, cues: Set<C.CueName>) {
  s.simTime += C.TICK_DT;
  s.screenTime += C.TICK_DT;
  if (s.screen === "countdown") {
    sense(s);
    if (s.screenTime + 1e-8 >= 2) {
      arrive(s, "playing");
      s.predators.forEach((p) => {
        if (p.slot === 0) p.released = true;
      });
    }
    return;
  }
  if (s.screen === "cleared") {
    if (s.screenTime + 1e-8 >= 2) {
      const n = initial(s.assets, s.muted);
      n.depth = s.depth + 1;
      n.predators = roster(n.depth);
      n.score = s.score;
      n.lives = s.lives;
      n.titleIndex = s.titleIndex;
      n.simTime = s.simTime;
      n.remainder = s.remainder;
      arrive(n, "countdown");
      Object.assign(s, n);
      reconcileMutable(s);
    }
    return;
  }
  if (s.screen !== "playing") return;
  const decayTime = Math.max(0, C.TICK_DT - s.brightHold);
  s.brightHold = countdown(s.brightHold);
  s.brightness *= 0.5 ** (decayTime / C.BRIGHT_HALFLIFE);
  s.sonar.cooldown = countdown(s.sonar.cooldown);
  s.ink.cooldown = countdown(s.ink.cooldown);
  s.inkClouds = s.inkClouds
    .map((c) => ({ ...c, remaining: countdown(c.remaining) }))
    .filter((c) => c.remaining > 0);
  if (held) {
    if (s.desired === opposite(s.forager.dir)) s.forager.dir = s.desired;
    s.forager.moving = move(s, s.forager, C.FORAGER_SPEED, () =>
      options(s, s.forager).includes(s.desired) ? s.desired : s.forager.dir,
    );
  } else s.forager.moving = false;
  const f = s.forager;
  if (s.plankton[f.ty]?.[f.tx] === "*" && tile(s, f.tx, f.ty) === ".") {
    replace(s.plankton, f.tx, f.ty, "-");
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    reconcileMutable(s);
    if (s.planktonRemaining === 0) {
      s.score += C.SCORE_CLEAR;
      cues.add(C.CUES.descend);
      arrive(s, "cleared");
      sense(s);
      return;
    }
  }
  reconcileMutable(s);
  predators(s, cues);
  s.drifterIn = countdown(s.drifterIn);
  if (
    s.drifterIn === 0 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const gate = findGate(s);
    const exit = gate
      ? DIRECTIONS.map((d) => neighbor(s, gate.tx, gate.ty, d)).find(
          (n) => tile(s, n.tx, n.ty) === ".",
        )
      : null;
    if (exit) {
      s.drifters.push({
        ...center(exit.tx, exit.ty),
        dir: "up",
        mind: true,
        travel: true,
        lit: false,
      });
      s.drifterIn = C.DRIFTER_INTERVAL;
    }
  }
  s.drifters.forEach((d) => {
    if (d.mind && d.travel) move(s, d, C.DRIFTER_SPEED, () => wander(s, d));
  });
  s.drifters = s.drifters.filter((d) => {
    if (d.tx === f.tx && d.ty === f.ty) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  sense(s);
  pulses(s);
  s.predators.forEach((p) => {
    p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
    if (
      p.state !== "den" &&
      ((p.mark > 0 && p.kind !== "lanternjaw") || p.alert)
    )
      p.lit = true;
  });
  if (
    s.predators.some((p) => p.state !== "den" && p.tx === f.tx && p.ty === f.ty)
  ) {
    cues.add(C.CUES.caught);
    if (s.lives === 0) arrive(s, "gameover");
    else {
      s.lives--;
      resetAttempt(s);
    }
  }
  s.playTime += C.TICK_DT;
  reconcileMutable(s);
}
export function pulseMap(
  s: { readonly tiles: readonly string[] },
  p: Readonly<Pulse>,
) {
  return flood(s, p.ox, p.oy, true);
}
