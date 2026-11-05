/** "1 host" / "N hosts". */
export function hosts(n: number): string {
  return `${n} ${n === 1 ? 'host' : 'hosts'}`;
}
