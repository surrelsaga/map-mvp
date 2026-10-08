// The small stats readout: how much of the neighbourhood is explored and how many places are found. DOM only.
export function showStats(explored: string, found: number, total: number) {
  document.getElementById('hud')!.textContent = `${explored} explored, ${total ? `${found} of ${total}` : found} places found`;
}
