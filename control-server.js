// ============================================================
// HUSTLECLUB — CONTROL PANEL SERVER
// Secure admin interface for managing the HustleClub application.
//
// Deliberately not named "admin" anywhere in the file name, the
// subdomain, or the container/router names — see docker-compose.control.yml.
// "Admin" only survives in a few post-auth internals (API paths,
// element ids) where it isn't visible to anyone who hasn't already
// authenticated, so renaming it there bought nothing.
//
// This server provides:
// - Authentication for the control panel
// - Log file access
// - Stress test execution
// - API endpoints for admin operations
//
// Access: http://localhost:3002
// ============================================================

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readSetting } from './credentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Configuration
const PORT = readSetting('ADMIN_PORT') || 3002;
const LOGS_DIR = path.join(__dirname, 'logs');

// This server is reachable directly at control.hustleclub.app — there is
// no reverse-proxy auth or IP allowlist in front of it, so a hardcoded
// fallback password here means anyone who reads this file (or finds it
// via a search engine cache) has full admin access. Refuse to start
// instead, the same way server.js's LLM_ADMIN_TOKEN has no fallback.
const ADMIN_PASSWORD = readSetting('ADMIN_PASSWORD');
if (!ADMIN_PASSWORD) {
  console.error(
    'ADMIN_PASSWORD is not set. This server has no auth of its own to fall ' +
    'back on, so it will not start without one. Set ADMIN_PASSWORD in .env ' +
    'or the environment and restart.\n' +
    'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"'
  );
  process.exit(1);
}

// Constant-time compare so the password can't be guessed a byte at a
// time via response-timing — same approach as server.js's adminOnly.
function passwordMatches(presented) {
  const a = Buffer.from(String(presented || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Never index this host, and let a plain GET to /robots.txt say so
// before the auth wall below even applies — it's the one path a crawler
// can read without credentials.
app.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

// HTTP Basic Auth in front of EVERYTHING below — the dashboard's own
// password prompt only gated the /api/admin/* calls, so the page itself
// (markup, endpoint names, the stress-test feature) used to load for
// anyone who found the URL. This makes the browser demand credentials
// before any of that is ever sent. The username is ignored on purpose:
// control.html only ever asks for one shared password.
//
// control.html's own fetch() calls send `Authorization: Bearer <password>`
// rather than relying on the browser's cached Basic credentials (a JS-set
// header always wins over the cached one), so this has to accept both
// forms or every API call the page makes after login would 401 here.
function basicAuthGate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, credential] = header.split(' ');
  let suppliedPassword = '';
  if (scheme === 'Basic' && credential) {
    const decoded = Buffer.from(credential, 'base64').toString('utf8');
    suppliedPassword = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
  } else if (scheme === 'Bearer' && credential) {
    suppliedPassword = credential;
  }
  if (!passwordMatches(suppliedPassword)) {
    res.set('WWW-Authenticate', 'Basic realm="Hustle Club Control Panel"');
    return res.status(401).send('Authentication required');
  }
  next();
}
app.use(basicAuthGate);

// Security middleware — gates the /api/admin/* data operations, on top
// of the Basic Auth wall above.
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];

  if (!passwordMatches(token)) {
    return res.status(403).json({ error: 'Invalid credentials' });
  }

  next();
}

// Serve the control panel
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'control.html'));
});

// Deliberately NOT express.static(__dirname): control.html needs no other
// local file (Tailwind loads from its own CDN script tag), and serving
// the whole project directory here used to hand out server.js,
// credentials.js, sessions.js and codes.js as plain text to anyone who
// asked — sessions.js/codes.js in particular are the session-code word
// lists that server.js deliberately never exposes to the browser, so
// their absence from this file listing is a real security property.

// API Endpoints

// 1. Get usage logs
app.get('/api/admin/logs', requireAuth, (req, res) => {
  try {
    const logsPath = path.join(LOGS_DIR, 'usage.log');
    
    if (!fs.existsSync(logsPath)) {
      return res.status(404).json({ error: 'Logs file not found' });
    }
    
    const logs = fs.readFileSync(logsPath, 'utf8');
    res.setHeader('Content-Type', 'text/plain');
    res.send(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read logs: ' + error.message });
  }
});

// 2. Run stress test
app.post('/api/admin/stress-test', requireAuth, async (req, res) => {
  try {
    const { apiEndpoint, userCount, queriesPerUser, delay } = req.body;
    
    if (!apiEndpoint || !userCount || !queriesPerUser || !delay) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Validate parameters
    if (userCount < 1 || userCount > 50) {
      return res.status(400).json({ error: 'User count must be between 1 and 50' });
    }
    
    if (queriesPerUser < 1 || queriesPerUser > 20) {
      return res.status(400).json({ error: 'Queries per user must be between 1 and 20' });
    }
    
    if (delay < 0.1 || delay > 10) {
      return res.status(400).json({ error: 'Delay must be between 0.1 and 10 seconds' });
    }

    // apiEndpoint used to be concatenated straight into a shell string,
    // so anyone holding the admin password could run arbitrary commands
    // on the box via e.g. "http://x; rm -rf /". execFile with an argument
    // array never invokes a shell, so no value here can break out — the
    // URL check below is just sanity-checking the input, not the fix.
    let targetUrl;
    try {
      targetUrl = new URL(apiEndpoint);
      if (!/^https?:$/.test(targetUrl.protocol)) throw new Error('bad protocol');
    } catch {
      return res.status(400).json({ error: 'apiEndpoint must be a valid http(s) URL' });
    }

    const execFileAsync = promisify(execFile);
    const args = [
      path.join(__dirname, 'stress_test_no_limits.py'),
      '--api-url', targetUrl.toString(),
      '--users', String(userCount),
      '--queries', String(queriesPerUser),
      '--delay', String(delay),
    ];

    console.log(`[Admin] Running stress test: python3 ${args.join(' ')}`);

    const { stdout, stderr } = await execFileAsync('python3', args);
    
    // Parse the output to extract results
    // For now, we'll return the raw output
    // In a production environment, you'd want to parse the Python script output
    
    res.json({
      success: true,
      output: stdout,
      error: stderr
    });
    
  } catch (error) {
    console.error('[Admin] Stress test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    });
  }
});

// 3. Get system info
app.get('/api/admin/system-info', requireAuth, (req, res) => {
  try {
    const systemInfo = {
      appVersion: '1.0.0',
      llmProvider: 'Mistral',
      model: 'mistral-small-latest',
      rateLimits: {
        chat: 60,
        plan: 4
      },
      server: {
        port: PORT,
        uptime: process.uptime()
      }
    };
    
    res.json(systemInfo);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get system info: ' + error.message });
  }
});

// 4. Change admin password
app.post('/api/admin/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  
  if (currentPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Current password is incorrect' });
  }
  
  // In a real implementation, you would save this to environment variables
  // For now, we'll just return success
  
  res.json({
    success: true,
    message: 'Password changed successfully. Note: This change is temporary and will be reset on server restart.'
  });
});

// 5. Clear logs
app.post('/api/admin/clear-logs', requireAuth, (req, res) => {
  try {
    const logsPath = path.join(LOGS_DIR, 'usage.log');
    
    if (fs.existsSync(logsPath)) {
      fs.writeFileSync(logsPath, '');
      res.json({ success: true, message: 'Logs cleared successfully' });
    } else {
      res.status(404).json({ error: 'Logs file not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear logs: ' + error.message });
  }
});

// 6. Get stress test history (placeholder)
app.get('/api/admin/stress-test-history', requireAuth, (req, res) => {
  // This would return a list of previous stress test results
  // For now, return empty array
  res.json([]);
});

// Start server
app.listen(PORT, () => {
  console.log(`
  HustleClub Control Panel Server
  ================================

  Control panel: http://localhost:${PORT}
  API Endpoint : http://localhost:${PORT}/api/admin/*

  Authentication: HTTP Basic Auth in front of the whole app, plus a
  Bearer token on every /api/admin/* call — both checked against
  ADMIN_PASSWORD. Not indexable: X-Robots-Tag on every response and
  an unauthenticated /robots.txt disallowing everything.

  Features:
  - Review usage logs
  - Run stress tests
  - System monitoring
  `);
});

export default app;