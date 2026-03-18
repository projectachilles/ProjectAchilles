import { registerCommand } from './registry.js';
import * as api from '../api/versions.js';
import { colors } from '../output/colors.js';

registerCommand({
  name: 'versions',
  description: 'Manage agent binary versions',
  subcommands: {
    list: {
      description: 'List registered agent versions',
      handler: async (ctx) => {
        const versions = await api.listVersions();
        ctx.output.table(
          versions as unknown as Record<string, unknown>[],
          [
            { key: 'version', label: 'Version', width: 10 },
            { key: 'os', label: 'OS', width: 8 },
            { key: 'arch', label: 'Arch', width: 6 },
            { key: 'binary_size', label: 'Size', width: 10, align: 'right', transform: (v) => formatBytes(Number(v)) },
            { key: 'signed', label: 'Signed', width: 7, transform: (v) => v ? colors.green('yes') : colors.dim('no') },
            { key: 'mandatory', label: 'Mandatory', width: 10, transform: (v) => v ? colors.yellow('yes') : colors.dim('no') },
            { key: 'created_at', label: 'Created', width: 20 },
          ],
        );
      },
    },
    upload: {
      description: 'Upload an agent binary',
      flags: {
        version: { type: 'string', required: true, description: 'Version string (e.g., 1.2.3)' },
        os: { type: 'string', required: true, choices: ['windows', 'linux', 'darwin'], description: 'Target OS' },
        arch: { type: 'string', required: true, choices: ['amd64', 'arm64'], description: 'Target arch' },
        file: { type: 'string', required: true, description: 'Path to binary file' },
        notes: { type: 'string', description: 'Release notes' },
        mandatory: { type: 'boolean', description: 'Mark as mandatory update' },
      },
      handler: async (ctx) => {
        const filePath = ctx.flags.file as string;
        const file = Bun.file(filePath);
        if (!await file.exists()) {
          ctx.output.error(`File not found: ${filePath}`);
          process.exit(1);
        }
        const result = await api.uploadVersion({
          version: ctx.flags.version as string,
          os: ctx.flags.os as 'windows' | 'linux' | 'darwin',
          arch: ctx.flags.arch as 'amd64' | 'arm64',
          file: file,
          release_notes: ctx.flags.notes as string | undefined,
          mandatory: ctx.flags.mandatory as boolean | undefined,
        });
        ctx.output.success(`Uploaded ${result.version} (${result.os}/${result.arch}) — ${formatBytes(result.binary_size)}`);
      },
    },
    build: {
      description: 'Build agent binary from source',
      flags: {
        version: { type: 'string', required: true, description: 'Version string' },
        os: { type: 'string', required: true, choices: ['windows', 'linux', 'darwin'] },
        arch: { type: 'string', required: true, choices: ['amd64', 'arm64'] },
      },
      handler: async (ctx) => {
        ctx.output.raw(`  Building ${ctx.flags.os}/${ctx.flags.arch}...`);
        const result = await api.buildVersion({
          version: ctx.flags.version as string,
          os: ctx.flags.os as 'windows' | 'linux' | 'darwin',
          arch: ctx.flags.arch as 'amd64' | 'arm64',
        });
        ctx.output.success(`Built ${result.version} (${result.os}/${result.arch}) — ${formatBytes(result.binary_size)}, signed: ${result.signed}`);
      },
    },
    delete: {
      description: 'Delete a version binary',
      args: [{ name: 'version', required: true }, { name: 'os', required: true }, { name: 'arch', required: true }],
      handler: async (ctx) => {
        await api.deleteVersion(
          ctx.args.version,
          ctx.args.os as 'windows' | 'linux' | 'darwin',
          ctx.args.arch as 'amd64' | 'arm64',
        );
        ctx.output.success(`Deleted ${ctx.args.version} (${ctx.args.os}/${ctx.args.arch})`);
      },
    },
  },
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
