import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { embedPatterns, embeddedFiles, embeddedFilesLeftOut } from '../embeddedFiles.js';

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('embedPatterns (the patterns of every //go:embed directive)', () => {
  it('reads every pattern of a line, not only the first', () => {
    expect(embedPatterns('//go:embed a.ps1 assets/*.pem helpers/run.sh\nvar files embed.FS\n'))
      .toEqual([
        { pattern: 'a.ps1', all: false },
        { pattern: 'assets/*.pem', all: false },
        { pattern: 'helpers/run.sh', all: false },
      ]);
  });

  it('reads quoted and back-quoted patterns, and the all: prefix', () => {
    expect(embedPatterns('//go:embed "with space.txt" `back tick.txt` all:assets "all:quoted dir"\n'))
      .toEqual([
        { pattern: 'with space.txt', all: false },
        { pattern: 'back tick.txt', all: false },
        { pattern: 'assets', all: true },
        { pattern: 'quoted dir', all: true },
      ]);
  });

  it('counts an indented directive and several directives', () => {
    const src = 'var (\n\t//go:embed one.txt\n\ta string\n    //go:embed two.txt\n\tb string\n)\n';
    expect(embedPatterns(src).map(p => p.pattern)).toEqual(['one.txt', 'two.txt']);
  });

  it('does not count a comment that only mentions the directive', () => {
    const src = '// Files are bundled with //go:embed payload.bin at build time.\n// go:embed spaced.txt\n/* //go:embed block.txt */\n';
    expect(embedPatterns(src)).toEqual([]);
  });
});

describe('embeddedFiles (what a test folder really embeds)', () => {
  let dir: string;

  const write = (rel: string, content = 'x'): void => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedded-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('lists a named file, a later pattern on the line, and files a glob matches', () => {
    write('main.go', '//go:embed first.bin second.ps1 certs/*.pem\nvar f embed.FS\n');
    write('first.bin'); write('second.ps1'); write('third.ps1');
    write('certs/a.pem'); write('certs/b.pem'); write('certs/README.md'); write('certs/deep/c.pem');

    expect(embeddedFiles(dir)).toEqual(['certs/a.pem', 'certs/b.pem', 'first.bin', 'second.ps1']);
  });

  it('lists everything under an embedded folder, without hidden files unless all: is used', () => {
    write('main.go', '//go:embed assets\nvar f embed.FS\n');
    write('assets/a.txt'); write('assets/sub/b.txt'); write('assets/.hidden'); write('assets/_skipped'); write('assets/sub/.also');
    expect(embeddedFiles(dir)).toEqual(['assets/a.txt', 'assets/sub/b.txt']);

    write('main.go', '//go:embed all:assets\nvar f embed.FS\n');
    expect(embeddedFiles(dir)).toEqual(['assets/.hidden', 'assets/_skipped', 'assets/a.txt', 'assets/sub/.also', 'assets/sub/b.txt']);
  });

  it('a glob that matches a folder embeds what is under it', () => {
    write('main.go', '//go:embed data/*\nvar f embed.FS\n');
    write('data/one.txt'); write('data/nested/two.txt');
    expect(embeddedFiles(dir)).toEqual(['data/nested/two.txt', 'data/one.txt']);
  });

  it('resolves the patterns of a sub-package against its own folder, and ignores _test.go files', () => {
    write('main.go', 'package main\n');
    write('cmd/tool/tool.go', '//go:embed script.sh\nvar s string\n');
    write('cmd/tool/script.sh'); write('script.sh');
    write('main_test.go', '//go:embed testdata.bin\nvar t []byte\n');
    write('testdata.bin');

    expect(embeddedFiles(dir)).toEqual(['cmd/tool/script.sh']);
  });

  it('matches ? and character classes, and never crosses a folder with *', () => {
    write('main.go', '//go:embed stage?.bin part[0-9].dat *.cfg\nvar f embed.FS\n');
    write('stage1.bin'); write('stage22.bin'); write('part7.dat'); write('partx.dat'); write('a.cfg'); write('sub/b.cfg');

    expect(embeddedFiles(dir)).toEqual(['a.cfg', 'part7.dat', 'stage1.bin']);
  });

  it('lists nothing for a pattern that matches no file, or for a test without Go files', () => {
    write('main.go', '//go:embed missing.bin nothing/*.x\nvar f embed.FS\n');
    expect(embeddedFiles(dir)).toEqual([]);
    expect(embeddedFiles(path.join(dir, 'no-such-folder'))).toEqual([]);
  });

  describe('embeddedFilesLeftOut (embedded, but not part of the fingerprint)', () => {
    it('names an embedded file the fingerprint leaves out by name', () => {
      write(`${UUID}.go`, `//go:embed ${UUID}_hardening.ps1\nvar script string\n`);
      write(`${UUID}_hardening.ps1`);

      expect(embeddedFilesLeftOut(dir)).toEqual([`${UUID}_hardening.ps1`]);
    });

    it('finds one behind a glob, as a later pattern, and inside an embedded folder', () => {
      write(`${UUID}.go`, `//go:embed payload.bin *.ps1 rules\nvar f embed.FS\n`);
      write('payload.bin'); write('helper.ps1');
      write(`${UUID}_hardening.ps1`);
      write(`rules/${UUID}_sigma_rules.yml`); write('rules/notes.md'); write('rules/config.yml');

      expect(embeddedFilesLeftOut(dir)).toEqual([
        `${UUID}_hardening.ps1`,
        `rules/${UUID}_sigma_rules.yml`,
        'rules/notes.md',
      ]);
    });

    it('names an embedded file the fingerprint leaves out by extension', () => {
      write('main.go', '//go:embed report.html detect.yara\nvar f embed.FS\n');
      write('report.html'); write('detect.yara');

      expect(embeddedFilesLeftOut(dir)).toEqual(['detect.yara', 'report.html']);
    });

    it('is empty when left-out files sit next to embedded ones without being embedded', () => {
      // The shape of a real library test: certificates embedded by glob, with
      // a README and the detection files beside them.
      write(`${UUID}.go`, '//go:embed assets/chains/*.pem helpers/validator.ps1\nvar f embed.FS\n');
      write('assets/chains/a.pem'); write('assets/chains/README.md');
      write('helpers/validator.ps1');
      write(`${UUID}_hardening.ps1`); write(`${UUID}_sigma_rules.yml`); write('README.md'); write(`${UUID}_rules.yar`);

      expect(embeddedFilesLeftOut(dir)).toEqual([]);
    });
  });
});
