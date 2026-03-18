import { registerCommand } from './registry.js';
import * as api from '../api/certs.js';
import { writeFileSync } from 'fs';
import { colors } from '../output/colors.js';

registerCommand({
  name: 'certs',
  description: 'Manage code signing certificates',
  subcommands: {
    list: {
      description: 'List certificates',
      handler: async (ctx) => {
        const raw = await api.listCertificates();
        // API may return { certificates: [...], activeCertId } or [...] directly
        const certs = Array.isArray(raw) ? raw : (raw.certificates ?? []);
        const activeCertId = Array.isArray(raw) ? null : raw.activeCertId;
        ctx.output.table(
          certs as unknown as Record<string, unknown>[],
          [
            { key: 'id', label: 'ID', width: 16 },
            { key: 'label', label: 'Label', width: 16 },
            {
              key: 'subject', label: 'CN', width: 20,
              transform: (v) => {
                if (typeof v === 'object' && v !== null) return String((v as Record<string, unknown>).commonName ?? '—');
                return String(v ?? '—');
              },
            },
            {
              key: 'subject', label: 'Org', width: 16,
              transform: (v) => {
                if (typeof v === 'object' && v !== null) return String((v as Record<string, unknown>).organization ?? '—');
                return '—';
              },
            },
            {
              key: 'id', label: 'Active', width: 7,
              transform: (v, row) => {
                const isActive = activeCertId ? String(v) === activeCertId : (row as Record<string, unknown>).isActive;
                return isActive ? colors.brightGreen('★') : colors.dim('—');
              },
            },
            {
              key: 'expiry', label: 'Valid Until', width: 12,
              transform: (v) => v ? new Date(String(v)).toLocaleDateString() : colors.dim('—'),
            },
          ],
        );
      },
    },
    upload: {
      description: 'Upload a PFX certificate',
      flags: {
        file: { type: 'string' as const, required: true, description: 'Path to PFX/P12 file' },
        password: { type: 'string' as const, required: true, description: 'Certificate password' },
        label: { type: 'string' as const, description: 'Display label' },
      },
      handler: async (ctx) => {
        const filePath = ctx.flags.file as string;
        const file = Bun.file(filePath);
        if (!await file.exists()) {
          ctx.output.error(`File not found: ${filePath}`);
          process.exit(1);
        }
        const cert = await api.uploadCertificate(
          file,
          ctx.flags.password as string,
          ctx.flags.label as string | undefined,
        );
        ctx.output.success(`Certificate uploaded: ${cert.commonName} (${cert.id})`);
      },
    },
    generate: {
      description: 'Generate a self-signed certificate',
      flags: {
        cn: { type: 'string' as const, required: true, description: 'Common Name' },
        org: { type: 'string' as const, required: true, description: 'Organization' },
        country: { type: 'string' as const, required: true, description: 'Country code (2-letter)' },
        label: { type: 'string' as const, description: 'Display label' },
        password: { type: 'string' as const, description: 'Certificate password' },
      },
      handler: async (ctx) => {
        ctx.output.raw('  Generating certificate...');
        const cert = await api.generateCertificate({
          commonName: ctx.flags.cn as string,
          organization: ctx.flags.org as string,
          country: ctx.flags.country as string,
          label: ctx.flags.label as string | undefined,
          password: ctx.flags.password as string | undefined,
        });
        ctx.output.success(`Certificate generated: ${cert.commonName} (${cert.id})`);
      },
    },
    activate: {
      description: 'Set a certificate as active for signing',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        await api.activateCertificate(ctx.args.id);
        ctx.output.success(`Certificate ${ctx.args.id} activated`);
      },
    },
    rename: {
      description: 'Rename a certificate label',
      args: [{ name: 'id', required: true }, { name: 'label', required: true }],
      handler: async (ctx) => {
        await api.renameCertificate(ctx.args.id, ctx.args.label);
        ctx.output.success(`Certificate ${ctx.args.id} renamed to "${ctx.args.label}"`);
      },
    },
    download: {
      description: 'Download certificate PFX file',
      args: [{ name: 'id', required: true }],
      flags: { output: { type: 'string' as const, alias: 'o', description: 'Output file path' } },
      handler: async (ctx) => {
        const response = await api.downloadCertificate(ctx.args.id);
        const outPath = (ctx.flags.output as string) ?? `cert-${ctx.args.id}.pfx`;
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(outPath, buffer);
        ctx.output.success(`Downloaded to ${outPath}`);
      },
    },
    delete: {
      description: 'Delete a certificate',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        await api.deleteCertificate(ctx.args.id);
        ctx.output.success(`Certificate ${ctx.args.id} deleted`);
      },
    },
  },
});
