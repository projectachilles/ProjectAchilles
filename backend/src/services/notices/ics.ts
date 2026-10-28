const enc = new TextEncoder();

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Fold a content line at 75 octets (continuations start with one space). */
function fold(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = ' ';
      curBytes = 1;
      limit = 75;
    }
    cur += ch;
    curBytes += n;
  }
  out.push(cur);
  return out;
}

type IcsEvent = {
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  stamp: Date;
};

export function buildIcsEvents(events: IcsEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ProjectAchilles//Pre-Execution Notice//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${escapeText(e.uid)}`,
      `SEQUENCE:${e.sequence}`,
      `DTSTAMP:${utc(e.stamp)}`,
      `DTSTART:${utc(e.start)}`,
      `DTEND:${utc(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return lines.flatMap(fold).map((l) => `${l}\r\n`).join('');
}

export function buildIcs(e: IcsEvent): string {
  return buildIcsEvents([e]);
}
