/** "1 host" / "N hosts". */
export function hosts(n: number): string {
  return `${n} ${n === 1 ? 'host' : 'hosts'}`;
}

/** "1 test" / "N tests". */
export function tests(n: number): string {
  return `${n} ${n === 1 ? 'test' : 'tests'}`;
}
