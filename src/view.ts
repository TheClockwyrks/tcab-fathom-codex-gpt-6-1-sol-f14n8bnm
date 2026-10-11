import type { RenderApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { type ReadState, type Direction, center } from "./state";
import { menuItems, menuItemRect } from "./debug";
import { distance, tile, pulseMap, lineClear } from "./core";
export const BACKGROUND = "#03060c";
const CYAN = "#8ef9ed",
  DIM = "#557b82",
  WHITE = "#d5f5ee",
  AMBER = "#ff925e";
const FONT = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
function text(
  ctx: CanvasRenderingContext2D,
  t: string,
  x: number,
  y: number,
  size = 16,
  color = WHITE,
  align: CanvasTextAlign = "left",
) {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(t, x, y);
}
function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 0.25,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function sprite(
  ctx: CanvasRenderingContext2D,
  s: ReadState,
  sheet: string,
  frame: number,
  x: number,
  y: number,
  size = C.TILE,
) {
  const image = s.assets[sheet]?.[frame];
  if (image) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
}
const facing: Record<Direction, number> = { down: 0, up: 2, left: 4, right: 6 };
function line(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = DIM,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function ambient(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  // Deterministic suspended sediment and delicate bathymetric contours.
  for (let i = 0; i < 90; i++) {
    const x = (i * 157 + 91) % C.STAGE_W,
      y = (i * 83 + 21) % C.STAGE_H;
    ctx.fillStyle = i % 5 === 0 ? "#163c43" : "#0c252e";
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.save();
  ctx.strokeStyle = "#0b252e";
  ctx.lineWidth = 1;
  for (let k = 0; k < 8; k++) {
    ctx.beginPath();
    for (let x = 0; x <= C.STAGE_W; x += 16) {
      const y =
        530 + k * 23 + Math.sin(x / 180 + k * 0.6) * 40 + Math.sin(x / 74) * 6;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
function terrain(ctx: CanvasRenderingContext2D, s: ReadState) {
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const visibility = s.visibility[ty]![tx];
      if (visibility === "u") continue;
      const ch = tile(s, tx, ty);
      let frame = 16;
      if (ch === "#")
        frame =
          (tile(s, tx, ty - 1) === "#" ? 1 : 0) +
          (tile(s, tx + 1, ty) === "#" ? 2 : 0) +
          (tile(s, tx, ty + 1) === "#" ? 4 : 0) +
          (tile(s, tx - 1, ty) === "#" ? 8 : 0);
      if (ch === "g") frame = 18;
      const p = center(tx, ty);
      ctx.globalAlpha = visibility === "l" ? 1 : 0.22;
      sprite(ctx, s, "trench-walls", frame, p.x, p.y);
      if (s.plankton[ty]![tx] === "*") {
        ctx.fillStyle = CYAN;
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = visibility === "l" ? 8 : 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, C.PLANKTON_DOT / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  ctx.globalAlpha = 1;
}
function amber(ctx: CanvasRenderingContext2D, x: number, y: number) {
  glow(ctx, x, y, 23, AMBER, 0.5);
  ctx.fillStyle = AMBER;
  ctx.shadowColor = AMBER;
  ctx.shadowBlur = 9;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}
function mazeView(ctx: CanvasRenderingContext2D, s: ReadState) {
  const f = s.forager;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const c = center(tx, ty);
      sprite(ctx, s, "trench-walls", 17, c.x, c.y);
    }
  // The outer circle is a drawing mask only; it never changes tile memory.
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, s.windowRadius, 0, Math.PI * 2);
  ctx.clip();
  terrain(ctx, s);
  glow(ctx, f.x, f.y, s.windowRadius, "#248fa2", 0.13);
  glow(ctx, f.x, f.y, s.visionRadius, "#31d8c3", 0.11);
  s.drifters.forEach((d) => {
    amber(ctx, d.x, d.y);
    if (d.lit)
      sprite(
        ctx,
        s,
        "drifter",
        d.mind && d.travel ? Math.floor(s.playTime * 8) % 8 : 0,
        d.x,
        d.y,
      );
  });
  s.predators.forEach((p) => {
    if (p.kind === "lanternjaw" && p.state !== "den") amber(ctx, p.x, p.y);
  });
  ctx.restore();
  // A bloom grants full sight even beyond the outer circle.
  s.predators.forEach((p) => {
    if (!p.flaring) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, C.FLARE_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    terrain(ctx, s);
    s.drifters.forEach((d) => {
      if (distance(d, p) <= C.FLARE_RADIUS)
        sprite(
          ctx,
          s,
          "drifter",
          d.mind && d.travel ? Math.floor(s.playTime * 8) % 8 : 0,
          d.x,
          d.y,
        );
    });
    ctx.restore();
  });
  s.inkClouds.forEach((c) => {
    ctx.save();
    ctx.globalAlpha = Math.min(1, c.remaining / 0.4);
    glow(ctx, c.x, c.y, c.radius, "#000000", 0.98);
    ctx.fillStyle = "#010407e8";
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.radius * 0.82, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#10242b";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  });
  s.predators.forEach((p) => {
    if (p.lit) {
      ctx.save();
      const inLight =
        (distance(p, s.forager) <= s.visionRadius &&
          lineClear(s, p, s.forager)) ||
        s.predators.some(
          (flare) => flare.flaring && distance(flare, p) <= C.FLARE_RADIUS,
        );
      ctx.globalAlpha =
        p.mark > 0 && !p.alert && !inLight ? Math.min(1, p.mark / 0.4) : 1;
      const frame =
        p.kind === "lanternjaw" && p.state === "wander"
          ? 8 + (p.mind && p.travel ? Math.floor(s.playTime * 8) % 8 : 0)
          : facing[p.dir] +
            (p.mind && p.travel ? Math.floor(s.playTime * 7) % 2 : 0);
      sprite(ctx, s, p.kind, frame, p.x, p.y);
      ctx.restore();
    }
    if (p.alert) {
      const color = p.kind === "gloamfin" ? "#cb98ff" : "#ffae70";
      const age = 1 - p.alertLeft / C.ALERT_TIME;
      ctx.save();
      ctx.globalAlpha = 1 - age;
      glow(ctx, p.x, p.y, 42, color, 0.7);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        line(
          ctx,
          p.x + Math.cos(a) * (16 + age * 15),
          p.y + Math.sin(a) * (16 + age * 15),
          p.x + Math.cos(a) * (28 + age * 25),
          p.y + Math.sin(a) * (28 + age * 25),
          color,
        );
      }
      ctx.restore();
    }
    if (
      p.kind === "flarefish" &&
      (p.flareCharging || p.flaring || p.fade > 0)
    ) {
      const frame = p.flareCharging
        ? Math.min(2, Math.floor((p.flareTime / C.FLARE_CHARGE) * 3))
        : p.flaring
          ? 3 +
            Math.min(
              2,
              Math.floor(((p.flareTime - C.FLARE_CHARGE) / C.FLARE_BLOOM) * 3),
            )
          : p.fade > 0.2
            ? 6
            : 7;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      sprite(ctx, s, "flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
      ctx.restore();
    }
  });
  for (const p of s.pulses) {
    const color =
      p.tint === "cyan" ? CYAN : p.tint === "violet" ? "#b38cff" : "#ff9962";
    const map = pulseMap(s, p);
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    for (const [key, n] of map) {
      const diff = p.front - n;
      if (diff < -0.3 || diff > 1) continue;
      const tx = key % C.GRID_COLS,
        ty = Math.floor(key / C.GRID_COLS);
      const c = center(tx, ty);
      ctx.globalAlpha = Math.max(0, 1 - Math.abs(diff));
      ctx.beginPath();
      ctx.roundRect(c.x - 12, c.y - 12, 24, 24, 6);
      ctx.stroke();
    }
    ctx.restore();
  }
  glow(ctx, f.x, f.y, 32, CYAN, 0.5);
  sprite(
    ctx,
    s,
    "glimmerfin",
    facing[f.dir] + (f.moving ? Math.floor(s.playTime * 9) % 2 : 0),
    f.x,
    f.y,
  );
  ctx.restore();
  // Fine framing keeps the pitch-black field anchored to the instrument strips.
  line(ctx, 64, 79, 1216, 79, "#18343c");
  line(ctx, 64, 657, 1216, 657, "#18343c");
}
function gauge(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  ready: boolean,
  cooldown: number,
  max: number,
  color: string,
) {
  text(ctx, label, x, y, 13, ready ? color : DIM);
  text(
    ctx,
    ready ? "READY" : `${cooldown.toFixed(1)}s`,
    x + 168,
    y,
    13,
    ready ? color : DIM,
    "right",
  );
  ctx.fillStyle = "#11252c";
  ctx.fillRect(x, y + 10, 168, 4);
  ctx.fillStyle = color;
  ctx.fillRect(x, y + 10, 168 * Math.max(0, 1 - cooldown / max), 4);
}
function hud(ctx: CanvasRenderingContext2D, s: ReadState) {
  text(ctx, "F A T H O M", 64, 30, 16, CYAN);
  text(ctx, C.DIVE_LABEL, 64, 55, 12, DIM);
  text(ctx, String(s.score).padStart(6, "0"), 640, 57, 48, WHITE, "center");
  text(
    ctx,
    "DEPTH / " + String(s.depth).padStart(2, "0"),
    1216,
    32,
    14,
    CYAN,
    "right",
  );
  text(ctx, `${s.planktonRemaining} MOTES LEFT`, 1216, 55, 12, DIM, "right");
  text(ctx, `DEPTH ${s.depth}`, 64, 694, 16, WHITE);
  text(ctx, "RESERVE", 228, 694, 11, DIM);
  for (let i = 0; i < s.lives; i++)
    sprite(ctx, s, "glimmerfin", 6, 314 + i * 30, 688, 24);
  gauge(
    ctx,
    "SPACE / SONAR",
    490,
    684,
    s.sonar.ready,
    s.sonar.cooldown,
    C.SONAR_COOLDOWN,
    CYAN,
  );
  gauge(
    ctx,
    "SHIFT / INK",
    730,
    684,
    s.ink.ready,
    s.ink.cooldown,
    C.INK_COOLDOWN,
    "#a798d6",
  );
  text(
    ctx,
    s.muted ? "M / SOUND OFF" : "M / SOUND ON",
    1216,
    687,
    11,
    DIM,
    "right",
  );
  text(ctx, "ESC / PAUSE", 1216, 706, 11, DIM, "right");
}
function menus(ctx: CanvasRenderingContext2D, s: ReadState) {
  const items = menuItems(s);
  items.forEach((item, i) => {
    const r = menuItemRect(s, i)!;
    const selected = s.menuIndex === i;
    ctx.fillStyle = selected ? "#102e35" : "#08161d";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = selected ? "#5cbab4" : "#19303a";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (selected) {
      ctx.fillStyle = CYAN;
      ctx.fillRect(r.x, r.y, 3, r.h);
      text(ctx, "›", r.x + 22, r.y + 33, 24, CYAN);
    }
    text(
      ctx,
      item,
      r.x + r.w / 2,
      r.y + 31,
      18,
      selected ? CYAN : DIM,
      "center",
    );
  });
  text(
    ctx,
    "↑ ↓ SELECT     ENTER CONFIRM",
    640,
    390 + items.length * 64 + 30,
    11,
    DIM,
    "center",
  );
}
function title(ctx: CanvasRenderingContext2D, s: ReadState) {
  ambient(ctx);
  glow(ctx, 640, 256, 330, "#1b6575", 0.2);
  // A sonar survey medallion forms the title's oceanic silhouette.
  ctx.save();
  ctx.translate(640, 253);
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = i === 0 ? "#25515a" : "#102e39";
    ctx.beginPath();
    ctx.arc(0, 0, 154 + i * 40, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 48; i++) {
    const a = (i * Math.PI) / 24;
    const radius = 235;
    line(
      ctx,
      Math.cos(a) * radius,
      Math.sin(a) * radius,
      Math.cos(a) * (radius + (i % 4 === 0 ? 9 : 4)),
      Math.sin(a) * (radius + (i % 4 === 0 ? 9 : 4)),
      "#21434d",
    );
  }
  ctx.restore();
  text(
    ctx,
    "A B I O L U M I N E S C E N T   D I V E",
    640,
    153,
    12,
    DIM,
    "center",
  );
  ctx.save();
  ctx.shadowColor = "#49d2cf";
  ctx.shadowBlur = 28;
  text(ctx, C.TITLE_TEXT, 640, 283, 112, WHITE, "center");
  ctx.restore();
  text(ctx, C.TAGLINE_TEXT.split("").join(" "), 640, 328, 17, CYAN, "center");
  sprite(ctx, s, "glimmerfin", 6, 374, 336, 32);
  amber(ctx, 904, 335);
  menus(ctx, s);
  text(ctx, "01 / KINDLE", 64, 55, 12, DIM);
  text(ctx, "THE ABYSS IS LISTENING", 1216, 55, 12, DIM, "right");
  text(
    ctx,
    "Follow the light. Mind what follows you.",
    640,
    642,
    14,
    "#638f96",
    "center",
  );
  line(ctx, 64, 676, 1216, 676, "#18313b");
  text(ctx, "WASD / SWIM     SPACE / SONAR     SHIFT / INK", 64, 702, 11, DIM);
  text(
    ctx,
    s.muted ? "M / SOUND OFF" : "M / SOUND ON",
    1216,
    702,
    11,
    DIM,
    "right",
  );
}
function howto(ctx: CanvasRenderingContext2D, s: ReadState) {
  ambient(ctx);
  text(ctx, "FIELD GUIDE / 01", 96, 70, 12, DIM);
  text(ctx, "READ THE DARK", 96, 136, 44, WHITE);
  text(
    ctx,
    "Your light finds the way. It also gives you away.",
    96,
    178,
    17,
    CYAN,
  );
  const entries = [
    [
      "glimmerfin",
      "YOU / THE FORAGER",
      "Graze glowing plankton to brighten your window.",
      "Explored passages remain in memory; beyond your circle, all is dark.",
    ],
    [
      "lanternjaw",
      "LANTERNJAW / HUNTS LIGHT",
      "An amber glimmer may be dinner — or a hunter in disguise.",
      "The brighter you burn, the further its jaws can find you.",
    ],
    [
      "gloamfin",
      "GLOAMFIN / HUNTS SOUND",
      "Its violet ping hears you around corners. Your sonar calls it too.",
      "Turn often to shake its speed. Ink will not silence it.",
    ],
    [
      "flarefish",
      "FLAREFISH / HUNTS BY FLASH",
      "A warm charge warns of a flare that sees straight through stone.",
      "Its flash lights the maze, but it may find you in the bloom.",
    ],
  ];
  entries.forEach(([sheet, name, a, b], i) => {
    const y = 239 + i * 86;
    sprite(ctx, s, sheet!, sheet === "lanternjaw" ? 6 : 6, 122, y + 14, 44);
    text(
      ctx,
      name!,
      165,
      y,
      15,
      i === 0 ? CYAN : i === 1 ? AMBER : i === 2 ? "#c6a3f8" : "#fbb48d",
    );
    text(ctx, a!, 165, y + 25, 14, WHITE);
    text(ctx, b!, 165, y + 47, 13, DIM);
  });
  line(ctx, 96, 594, 1184, 594, "#23434b");
  text(ctx, "WASD / ARROWS   SWIM", 96, 630, 14, CYAN);
  text(ctx, "SPACE   SONAR", 480, 630, 14, CYAN);
  text(ctx, "SHIFT   INK", 800, 630, 14, "#b3a5de");
  text(
    ctx,
    "Sonar reveals winding corridors. Ink blinds hunters that see. Eat every mote to descend.",
    96,
    659,
    13,
    DIM,
  );
  text(
    ctx,
    "ENTER / ESC / TAP TO RETURN     P / ESC PAUSE     M MUTE",
    640,
    702,
    11,
    DIM,
    "center",
  );
}
export function render(s: ReadState, api: RenderApi) {
  const ctx = api.ctx;
  ctx.imageSmoothingEnabled = false;
  if (s.screen === "title") {
    title(ctx, s);
    return;
  }
  if (s.screen === "howto") {
    howto(ctx, s);
    return;
  }
  if (s.screen === "gameover") {
    ambient(ctx);
    glow(ctx, 640, 250, 250, "#592946", 0.25);
    text(ctx, "THE DEEP KEEPS ITS SECRETS", 640, 190, 13, DIM, "center");
    text(ctx, "DIVE ENDED", 640, 262, 56, WHITE, "center");
    text(
      ctx,
      `SCORE ${String(s.score).padStart(6, "0")}    DEPTH ${s.depth}`,
      640,
      320,
      20,
      CYAN,
      "center",
    );
    menus(ctx, s);
    return;
  }
  mazeView(ctx, s);
  hud(ctx, s);
  if (s.screen === "playing") return;
  if (s.screen === "paused") {
    ctx.fillStyle = "#03090ed9";
    ctx.fillRect(400, 175, 480, 455);
    text(ctx, "HOLDING BREATH", 640, 265, 12, DIM, "center");
    text(ctx, "PAUSED", 640, 327, 48, WHITE, "center");
    menus(ctx, s);
  }
  if (s.screen === "countdown") {
    text(ctx, C.TITLE_ITEMS[0], 640, 315, 48, CYAN, "center");
    text(
      ctx,
      String(Math.max(1, Math.ceil(2 - s.screenTime))),
      640,
      393,
      64,
      WHITE,
      "center",
    );
    text(ctx, "LET YOUR LIGHT LEAD", 640, 433, 12, DIM, "center");
  }
  if (s.screen === "cleared") {
    ctx.fillStyle = "#03090ecb";
    ctx.fillRect(300, 242, 680, 218);
    text(ctx, `DEPTH ${s.depth} CLEARED`, 640, 327, 42, CYAN, "center");
    text(
      ctx,
      `+${C.SCORE_CLEAR}   /   DESCENDING`,
      640,
      383,
      18,
      WHITE,
      "center",
    );
  }
}
