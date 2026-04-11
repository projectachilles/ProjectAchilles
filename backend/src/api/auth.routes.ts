/**
 * Authentication routes.
 *
 * POST /api/auth/login — authenticate with username/password (basic method)
 */

import { Router } from 'express';
import { authenticateBasic } from '../services/auth/basic.service.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password, method } = req.body ?? {};

  if (method && method !== 'basic') {
    res.status(400).json({ success: false, error: `Auth method "${method}" not supported yet` });
    return;
  }

  if (!username || !password) {
    res.status(400).json({ success: false, error: 'Username and password required' });
    return;
  }

  const result = authenticateBasic(username, password);
  if (!result) {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }

  res.json({ success: true, ...result });
});

export default router;
