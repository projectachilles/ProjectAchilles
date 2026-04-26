export type CellState = 'empty' | 'protected' | 'partial' | 'gap';

// Generate a deterministic-looking pseudo-random matrix. Three columns
// (Defense Evasion, Credential Access, Impact) get lower coverage to
// dramatize gap density.
export function genMatrix(): CellState[][] {
  const out: CellState[][] = [];
  for (let c = 0; c < 11; c++) {
    const col: CellState[] = [];
    for (let r = 0; r < 8; r++) {
      const v = Math.random();
      const colWeight = c === 4 || c === 5 || c === 10 ? 0.55 : 0.78;
      let s: CellState = 'empty';
      if (v < colWeight * 0.7) s = 'protected';
      else if (v < colWeight * 0.85) s = 'partial';
      else if (v < colWeight) s = 'gap';
      col.push(s);
    }
    out.push(col);
  }
  return out;
}
