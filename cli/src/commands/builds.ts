import { registerCommand } from './registry.js';
import * as api from '../api/builds.js';
import { writeFileSync } from 'fs';
import { colors } from '../output/colors.js';

registerCommand({
  name: 'builds',
  description: 'Manage test builds and dependencies',
  subcommands: {
    show: {
      description: 'Show build info for a test',
      args: [{ name: 'uuid', required: true }],
      handler: async (ctx) => {
        const build = await api.getBuild(ctx.args.uuid);
        ctx.output.detail(build as unknown as Record<string, unknown>);
      },
    },
    create: {
      description: 'Build and sign a test binary',
      args: [{ name: 'uuid', required: true }],
      handler: async (ctx) => {
        ctx.output.raw(`  Building ${ctx.args.uuid}...`);
        const build = await api.createBuild(ctx.args.uuid);
        ctx.output.success(`Built ${build.name} — ${formatBytes(build.size)}, signed: ${build.signed}`);
      },
    },
    download: {
      description: 'Download a built test binary',
      args: [{ name: 'uuid', required: true }],
      flags: {
        output: { type: 'string' as const, alias: 'o', description: 'Output file path' },
      },
      handler: async (ctx) => {
        const response = await api.downloadBuild(ctx.args.uuid);
        const disposition = response.headers.get('content-disposition');
        const filename = disposition?.match(/filename="?([^"]+)"?/)?.[1] ?? `${ctx.args.uuid}.bin`;
        const outPath = (ctx.flags.output as string) ?? filename;
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(outPath, buffer);
        ctx.output.success(`Downloaded to ${outPath} (${formatBytes(buffer.length)})`);
      },
    },
    delete: {
      description: 'Delete a build artifact',
      args: [{ name: 'uuid', required: true }],
      handler: async (ctx) => {
        await api.deleteBuild(ctx.args.uuid);
        ctx.output.success(`Build ${ctx.args.uuid} deleted`);
      },
    },
    deps: {
      description: 'List embed dependencies for a test',
      args: [{ name: 'uuid', required: true }],
      handler: async (ctx) => {
        const deps = await api.getDependencies(ctx.args.uuid);
        ctx.output.table(
          deps as unknown as Record<string, unknown>[],
          [
            { key: 'filename', label: 'Name', width: 25 },
            { key: 'required', label: 'Required', width: 9, transform: (v) => v ? colors.yellow('yes') : 'no' },
            { key: 'exists', label: 'Present', width: 8, transform: (v) => v ? colors.green('yes') : colors.red('no') },
            { key: 'sourceBuilt', label: 'Source', width: 8, transform: (v) => v ? colors.cyan('auto') : 'upload' },
            { key: 'size', label: 'Size', width: 10, align: 'right', transform: (v) => v ? formatBytes(Number(v)) : colors.dim('—') },
          ],
        );
      },
    },
    'upload-dep': {
      description: 'Upload an embed dependency',
      args: [{ name: 'uuid', required: true }],
      flags: {
        file: { type: 'string' as const, required: true, description: 'Path to dependency file' },
      },
      handler: async (ctx) => {
        const filePath = ctx.flags.file as string;
        const file = Bun.file(filePath);
        if (!await file.exists()) {
          ctx.output.error(`File not found: ${filePath}`);
          process.exit(1);
        }
        const filename = filePath.split('/').pop() ?? 'unknown';
        await api.uploadDependency(ctx.args.uuid, file, filename);
        ctx.output.success(`Uploaded dependency: ${filename}`);
      },
    },
  },
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
