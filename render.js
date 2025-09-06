// render.js
import { GRID, GameState, ENTRY, EXIT, getDragonStats } from './state.js';

const canvas = () => document.getElementById('game');
const ctx = () => canvas().getContext('2d');

export function draw() {
  const c = canvas();
  const g = ctx();
  if (!c || !g || !GameState.grid) return;

  // clear
  g.clearRect(0, 0, c.width, c.height);

  // grid background (walls vs empty)
  for (let r = 0; r < GRID.rows; r++) {
    for (let cc = 0; cc < GRID.cols; cc++) {
      const x = cc * GRID.tile;
      const y = r * GRID.tile;
      g.fillStyle = GameState.grid[r][cc] === 1 ? '#1c253b' : '#0c1222';
      g.fillRect(x, y, GRID.tile - 1, GRID.tile - 1);
    }
  }

  // path highlight
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (const p of GameState.path) {
    g.fillRect(p.c * GRID.tile, p.r * GRID.tile, GRID.tile - 1, GRID.tile - 1);
  }

  // entry/exit tiles
  g.fillStyle = '#3aa675';
  g.fillRect(ENTRY.c * GRID.tile, ENTRY.r * GRID.tile, GRID.tile - 1, GRID.tile - 1);
  g.fillStyle = '#a63a3a';
  g.fillRect(EXIT.c * GRID.tile, EXIT.r * GRID.tile, GRID.tile - 1, GRID.tile - 1);

  // dragon (at EXIT)
  g.fillStyle = '#e46e2e';
  g.beginPath();
  g.arc(
    EXIT.c * GRID.tile + GRID.tile / 2,
    EXIT.r * GRID.tile + GRID.tile / 2,
    GRID.tile * 0.35,
    0,
    Math.PI * 2
  );
  g.fill();

  // enemies
  for (const e of GameState.enemies) {
    if (e.pathIndex < 0 || e.hp <= 0 || GameState.path.length === 0) continue;
    const node = GameState.path[Math.min(e.pathIndex, GameState.path.length - 1)];
    const x = node.c * GRID.tile + GRID.tile / 2;
    const y = node.r * GRID.tile + GRID.tile / 2;

    // color by type
    const color = {
      Villager: '#b3c1d1',
      Squire: '#92a7ff',
      Hero: '#ffd76a',
      Knight: '#8dd18d',
      Kingsguard: '#ff7e7e',
      Engineer: '#ffad66',
    }[e.type] || '#ddd';

    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, GRID.tile * 0.25, 0, Math.PI * 2);
    g.fill();

    // health bar
    g.fillStyle = '#400';
    g.fillRect(x - 16, y - 18, 32, 5);
    g.fillStyle = '#e44';
    g.fillRect(x - 16, y - 18, Math.max(0, 32 * (e.hp / e.maxHP)), 5);

    // special effects
    if (e.type === 'Hero' && e.shieldUp) {
      g.strokeStyle = 'rgba(255, 235, 120, 0.8)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, GRID.tile * 0.30, 0, Math.PI * 2);
      g.stroke();
    }
    if (e.burning.t > 0) {
      g.strokeStyle = 'rgba(255, 120, 50, 0.7)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, GRID.tile * 0.33, 0, Math.PI * 2);
      g.stroke();
    }
  }

  // breath visualization (highlight tiles within reach from the front of the pack)
  const ds = getDragonStats();
  const front = Math.max(0, ...GameState.enemies.filter(e => e.pathIndex >= 0).map(e => e.pathIndex));
  const start = Math.max(0, front - ds.reach);
  const tiles = GameState.path.slice(start, front + 1);
  for (const p of tiles) {
    g.fillStyle = 'rgba(255,120,50,0.15)';
    g.fillRect(p.c * GRID.tile, p.r * GRID.tile, GRID.tile - 1, GRID.tile - 1);
  }
}
