// Logique de jeu Qix — refonte de la capture
//
// RÈGLE DE CAPTURE:
// 1. Le joueur se déplace sur des cases "bord" : cellule 0 adjacente à
//    une cellule capturée (1) ou au bord de l'écran.
// 2. Quand il entre dans la zone vide (case 0 non-bord), il trace une ligne.
// 3. La capture se déclenche quand il retourne sur:
//    - une case capturée (1)
//    - une case bord jouable (0 adjacente à capture)
//    - sa case de départ (même si elle est maintenant de la trail)
// 4. La plus petite composante connexe de vide qui NE contient PAS le Qix
//    est capturée (devient 1).

export const GRID_W = 80;
export const GRID_H = 50;
export const CELL = 10;
export const TOTAL = GRID_W * GRID_H;

export function winPercentForLevel(lvl: number): number {
  // Plus exigeant au fil des niveaux, plafonné à 80%
  return Math.min(80, 50 + (lvl - 1) * 4);
}

export interface Qix {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angVel: number;
  size: number;
  pulse: number;
}

export interface Spark {
  x: number;
  y: number;
  px: number;
  py: number;
  dir: number;
  timer: number;
  speed: number;
  type: "normal" | "fast" | "hunter";
}

export interface Turret {
  x: number;
  y: number;
  cooldown: number;
  angle: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  trail: { x: number; y: number }[];
}

export interface Mine {
  x: number;
  y: number;
  pulse: number;
  arming: number; // temps avant d'être active
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  glow?: boolean;
}

export interface PowerUp {
  x: number;
  y: number;
  type: "speed" | "shield" | "bomb" | "life" | "freeze" | "slow" | "magnet" | "multiplier" | "reverse" | "blind";
  life: number;
}

import { getHDImageForLevel, type LevelHDImage } from "./imageLoader";

export interface LevelData {
  levelNumber: number;
  name: string;
  themeName: string;
  hdImage: LevelHDImage;
  qixSpeed: number;
  sparkCount: number;
  sparkType: "normal" | "mixed" | "aggressive";
  powerUpChance: number;
  turretCount: number;
  mineCount: number;
  hazard: "none" | "turret" | "mine" | "chaos";
  qixCount: number;
  colors: {
    cap: string;
    capLight: string;
    capDark: string;
    capEdge: string;
  };
}

export type Status = "ready" | "playing" | "paused" | "gameover" | "won";

export const idx = (x: number, y: number) => y * GRID_W + x;
export const inBounds = (x: number, y: number) =>
  x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;

// "Hard border" = case où on peut marcher / capturer.
// Cela inclut : hors grille, case capturée (1), case vide sur le périmètre extérieur.
export function isHardBorder(x: number, y: number, cells: Uint8Array): boolean {
  if (!inBounds(x, y)) return true;
  const v = cells[idx(x, y)];
  if (v === 1) return true;
  if (v !== 0) return false;
  if (x === 0 || x === GRID_W - 1 || y === 0 || y === GRID_H - 1) return true;
  return false;
}

// "Border cell" = hard border OU case vide adjacente à une case capturée.
// C'est une case sur laquelle le joueur peut se déplacer normalement.
export function isBorderCell(x: number, y: number, cells: Uint8Array): boolean {
  if (isHardBorder(x, y, cells)) return true;
  const v = cells[idx(x, y)];
  if (v !== 0) return false;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) return true;
    if (cells[idx(nx, ny)] === 1) return true;
  }
  return false;
}

// Est-ce une case vide dans laquelle on peut tracer ?
export function isEmptyForTrail(x: number, y: number, cells: Uint8Array): boolean {
  if (!inBounds(x, y)) return false;
  return cells[idx(x, y)] === 0;
}

// Est-ce que le joueur peut marcher hors mode traçage ?
export function canWalkOn(x: number, y: number, cells: Uint8Array): boolean {
  if (!inBounds(x, y)) return false;
  const v = cells[idx(x, y)];
  if (v === 1 || v === 2) return false;
  return isBorderCell(x, y, cells);
}

// Les étincelles marchent sur les bords (comme le joueur) ET sur la trail.
export function isSparkWalkable(x: number, y: number, cells: Uint8Array): boolean {
  if (!inBounds(x, y)) return false;
  const v = cells[idx(x, y)];
  if (v === 2) return true; // trail
  if (v === 1) return false; // capturé
  return isBorderCell(x, y, cells);
}

export function computeSurface(cells: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < TOTAL; i++) if (cells[i] === 1) count++;
  return Math.min(100, (count / TOTAL) * 100);
}

// Capture proprement dite.
// On considère la trail + les cases capturées comme un mur.
// On identifie les composantes connexes de cases 0.
// On capture la plus petite composante qui ne contient pas le Qix.
// Retourne le nombre de cellules capturées.
export function tryCapture(
  cells: Uint8Array,
  trail: { x: number; y: number }[],
  qixArr: Qix[]
): number {
  if (trail.length < 2) return 0;

  // Copie temporaire : trail + capturé = 1 (mur)
  const temp = new Uint8Array(cells);
  for (const t of trail) {
    temp[idx(t.x, t.y)] = 1;
  }

  // Ensemble des positions occupées par les Qix
  const qixSet = new Set<number>();
  for (const q of qixArr) {
    qixSet.add(idx(Math.floor(q.x), Math.floor(q.y)));
  }

  const visited = new Uint8Array(TOTAL);
  const components: { cells: number[]; hasQix: boolean }[] = [];
  const stack: number[] = [];

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const start = idx(x, y);
      if (temp[start] !== 0 || visited[start]) continue;

      const comp: number[] = [];
      let hasQix = false;
      stack.push(start);
      visited[start] = 1;

      while (stack.length) {
        const cur = stack.pop()!;
        comp.push(cur);
        if (qixSet.has(cur)) hasQix = true;

        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of dirs) {
          const nx = cur % GRID_W + dx;
          const ny = Math.floor(cur / GRID_W) + dy;
          if (!inBounds(nx, ny)) continue;
          const nidx = idx(nx, ny);
          if (temp[nidx] !== 0 || visited[nidx]) continue;
          visited[nidx] = 1;
          stack.push(nidx);
        }
      }

      components.push({ cells: comp, hasQix });
    }
  }

  // Choix : la plus petite composante sans le Qix
  let best: { cells: number[]; hasQix: boolean } | null = null;
  let bestSize = Infinity;
  for (const comp of components) {
    if (!comp.hasQix && comp.cells.length < bestSize) {
      best = comp;
      bestSize = comp.cells.length;
    }
  }

  // Si aucune composante sans Qix n'existe, c'est que le Qix est dans la plus grande,
  // donc on capture tout le reste (la zone extérieure, si elle est plus petite que celle du Qix)
  if (!best && components.length > 1) {
    let largestQixSize = -1;
    let qixCompIndex = -1;
    for (let i = 0; i < components.length; i++) {
      if (components[i].hasQix && components[i].cells.length > largestQixSize) {
        largestQixSize = components[i].cells.length;
        qixCompIndex = i;
      }
    }
    // Capturer toutes les composantes sauf celle du Qix (même si plus grande)
    let captured = 0;
    for (let i = 0; i < components.length; i++) {
      if (i === qixCompIndex) continue;
      for (const c of components[i].cells) {
        cells[c] = 1;
        captured++;
      }
    }
    // Trail capturée aussi
    for (const t of trail) {
      cells[idx(t.x, t.y)] = 1;
    }
    return captured;
  }

  if (best && best.cells.length > 0) {
    for (const c of best.cells) {
      cells[c] = 1;
    }
    for (const t of trail) {
      cells[idx(t.x, t.y)] = 1;
    }
    return best.cells.length;
  }

  return 0;
}

// Replacer le joueur sur une case bord jouable proche.
export function findNearestWalkable(
  cells: Uint8Array,
  x: number,
  y: number
): { x: number; y: number } | null {
  const queue: { x: number; y: number }[] = [];
  const seen = new Uint8Array(TOTAL);
  queue.push({ x, y });
  seen[idx(x, y)] = 1;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (queue.length) {
    const cur = queue.shift()!;
    if (canWalkOn(cur.x, cur.y, cells)) return cur;
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBounds(nx, ny)) continue;
      const nidx = idx(nx, ny);
      if (seen[nidx]) continue;
      seen[nidx] = 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

export function spawnParticles(
  particles: Particle[],
  x: number,
  y: number,
  color: string,
  count: number,
  speed = 2
) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const sp = Math.random() * speed + 0.5;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp,
      life: 25 + Math.random() * 15,
      maxLife: 40,
      color,
      size: 1 + Math.random() * 2,
    });
  }
}

export function updateParticles(particles: Particle[]) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// Trouve la position centrale de la plus grande composante vide (pour relocaliser le Qix)
export function findLargestEmptyZoneCenter(cells: Uint8Array): { x: number; y: number } | null {
  const visited = new Uint8Array(TOTAL);
  let best: { x: number; y: number; size: number } | null = null;
  const stack: number[] = [];

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const start = idx(x, y);
      if (cells[start] !== 0 || visited[start]) continue;

      const comp: number[] = [];
      stack.push(start);
      visited[start] = 1;

      while (stack.length) {
        const cur = stack.pop()!;
        const cx = cur % GRID_W;
        const cy = Math.floor(cur / GRID_W);
        comp.push(cur);

        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (!inBounds(nx, ny)) continue;
          const nidx = idx(nx, ny);
          if (cells[nidx] !== 0 || visited[nidx]) continue;
          visited[nidx] = 1;
          stack.push(nidx);
        }
      }

      if (!best || comp.length > best.size) {
        const mid = comp[Math.floor(comp.length / 2)];
        best = { x: mid % GRID_W, y: Math.floor(mid / GRID_W), size: comp.length };
      }
    }
  }

  return best ? { x: best.x + 0.5, y: best.y + 0.5 } : null;
}

export function getLevelData(level: number): LevelData {
  const lvl = Math.min(level, 9);
  // Couleurs "ombres" par niveau — l'image bitmap se montre à travers
  const colorSets = [
    { cap: "#1a0a20", capLight: "#2a1430", capDark: "#0a0410", capEdge: "#7c1eda" }, // synthwave violet
    { cap: "#0a2010", capLight: "#143020", capDark: "#041008", capEdge: "#1eda7c" }, // forêt vert
    { cap: "#0a1020", capLight: "#102035", capDark: "#040810", capEdge: "#1e8eda" }, // cyberpunk bleu
    { cap: "#201408", capLight: "#302010", capDark: "#100a04", capEdge: "#eda81e" }, // désert or
    { cap: "#10081a", capLight: "#1a1030", capDark: "#080410", capEdge: "#a81eda" }, // espace violet
    { cap: "#081420", capLight: "#102530", capDark: "#040a10", capEdge: "#1edada" }, // glace cyan
    { cap: "#200808", capLight: "#301010", capDark: "#100404", capEdge: "#ed3c1e" }, // volcan rouge
    { cap: "#081a20", capLight: "#102535", capDark: "#040a10", capEdge: "#1edaC0" }, // océan teal
    { cap: "#1a1004", capLight: "#2a1c08", capDark: "#100804", capEdge: "#eda51e" }, // steampunk bronze
  ];

  const themeNames = [
    "Coucher Synthwave", "Forêt Cybernétique", "Mégapole Cyberpunk",
    "Désert de Données", "Nébuleuse Stellaire", "Caverne de Glace",
    "Royaume Volcanique", "Abysses Océaniques", "Mécanisme Steampunk",
  ];

  // Progression de difficulté soigneusement équilibrée
  const configs = [
    // Niveau 1 : tutoriel ultra doux
    { qixSpeed: 0.05, sparkCount: 0, sparkType: "normal" as const, turrets: 0, mines: 0, hazard: "none" as const, qixCount: 1, puChance: 0.30 },
    // Niveau 2 : qix lent, aucun obstacle
    { qixSpeed: 0.07, sparkCount: 0, sparkType: "normal" as const, turrets: 0, mines: 0, hazard: "none" as const, qixCount: 1, puChance: 0.28 },
    // Niveau 3 : premières étincelles
    { qixSpeed: 0.08, sparkCount: 1, sparkType: "normal" as const, turrets: 0, mines: 0, hazard: "none" as const, qixCount: 1, puChance: 0.26 },
    // Niveau 4 : étincelles mixtes + qix plus rapide
    { qixSpeed: 0.09, sparkCount: 2, sparkType: "mixed" as const, turrets: 0, mines: 0, hazard: "none" as const, qixCount: 1, puChance: 0.25 },
    // Niveau 5 : introduction des MINES
    { qixSpeed: 0.10, sparkCount: 2, sparkType: "mixed" as const, turrets: 0, mines: 2, hazard: "mine" as const, qixCount: 1, puChance: 0.25 },
    // Niveau 6 : introduction des TOURELLES laser
    { qixSpeed: 0.11, sparkCount: 3, sparkType: "aggressive" as const, turrets: 1, mines: 1, hazard: "turret" as const, qixCount: 1, puChance: 0.24 },
    // Niveau 7 : volcan - 2 qix !
    { qixSpeed: 0.11, sparkCount: 3, sparkType: "aggressive" as const, turrets: 1, mines: 2, hazard: "chaos" as const, qixCount: 2, puChance: 0.24 },
    // Niveau 8 : océan - tourelles multiples
    { qixSpeed: 0.12, sparkCount: 4, sparkType: "aggressive" as const, turrets: 2, mines: 2, hazard: "chaos" as const, qixCount: 2, puChance: 0.23 },
    // Niveau 9 : steampunk - chaos total, 3 qix
    { qixSpeed: 0.12, sparkCount: 4, sparkType: "aggressive" as const, turrets: 2, mines: 3, hazard: "chaos" as const, qixCount: 3, puChance: 0.23 },
  ];

  const cfg = configs[lvl - 1];

  return {
    levelNumber: level,
    name: `NIVEAU ${lvl}`,
    themeName: themeNames[lvl - 1],
    hdImage: getHDImageForLevel(level),
    qixSpeed: cfg.qixSpeed,
    sparkCount: cfg.sparkCount,
    sparkType: cfg.sparkType,
    powerUpChance: cfg.puChance,
    turretCount: cfg.turrets,
    mineCount: cfg.mines,
    hazard: cfg.hazard,
    qixCount: cfg.qixCount,
    colors: colorSets[lvl - 1],
  };
}
