import type { Request, Response } from 'express';
import nodemailer from 'nodemailer';

// --- Should trigger ---

async function unsafeFetch(req: Request, res: Response) {
  // ruleid: projectachilles-ssrf-url
  const response = await fetch(req.body.url, { method: 'GET' });
  res.json(await response.json());
}

async function unsafeSmtp(req: Request, res: Response) {
  // ruleid: projectachilles-ssrf-url
  const transport = nodemailer.createTransport({host: req.body.smtpHost, port: 587});
}

async function unsafeFetchDestructured(req: Request, res: Response) {
  // ruleid: projectachilles-ssrf-url
  const { webhookUrl, payload } = req.body;
  await fetch(webhookUrl, { method: 'POST', body: JSON.stringify(payload) });
}

// --- Should NOT trigger ---

async function safeFetchHardcoded(req: Request, res: Response) {
  // ok: projectachilles-ssrf-url
  const response = await fetch('https://api.example.com/data', { method: 'GET' });
  res.json(await response.json());
}

async function safeFetchValidated(req: Request, res: Response) {
  const url = validateAndSanitizeUrl(req.body.url);
  // ok: projectachilles-ssrf-url
  const response = await fetch(url, { method: 'GET' });
  res.json(await response.json());
}
