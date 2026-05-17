const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const HOST = '0.0.0.0';

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a']);

// Security headers added to every response
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Explicitly allow Firebase / Google domains so auth works on any hosting
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdn.jsdelivr.net https://apis.google.com",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com",
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
  ].join('; ')
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', ...SECURITY_HEADERS });
    res.end();
    return;
  }

  let urlPath = req.url.split('?')[0];

  if (urlPath === '/api/config') {
    const config = {
      apiKey:            process.env.FIREBASE_API_KEY            || '',
      authDomain:        process.env.FIREBASE_AUTH_DOMAIN        || '',
      projectId:         process.env.FIREBASE_PROJECT_ID         || '',
      storageBucket:     process.env.FIREBASE_STORAGE_BUCKET     || '',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId:             process.env.FIREBASE_APP_ID             || '',
      vapidKey:          process.env.FIREBASE_VAPID_KEY          || ''
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(config));
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(__dirname, urlPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // Serve index.html with Firebase config injected inline so the SW can never serve stale config
  if (urlPath === '/index.html') {
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) { res.writeHead(500); res.end('Server error'); return; }
      const config = {
        apiKey:            process.env.FIREBASE_API_KEY            || '',
        authDomain:        process.env.FIREBASE_AUTH_DOMAIN        || '',
        projectId:         process.env.FIREBASE_PROJECT_ID         || '',
        storageBucket:     process.env.FIREBASE_STORAGE_BUCKET     || '',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId:             process.env.FIREBASE_APP_ID             || ''
      };
      const injected = html.replace(
        '<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>',
        `<script>window.__FIREBASE_CONFIG__ = ${JSON.stringify(config)};</script>\n  <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>`
      );
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      res.end(injected);
    });
    return;
  }

  // Audio files: stream with range request support (required for mobile browsers)
  if (AUDIO_EXTS.has(ext)) {
    fs.stat(filePath, (err, stat) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const fileSize = stat.size;
      const range = req.headers.range;
      if (range) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(startStr, 10) || 0;
        const end = endStr ? Math.min(parseInt(endStr, 10), fileSize - 1) : fileSize - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'index.html'), (err2, data2) => {
          if (err2) { res.writeHead(404); res.end('Not found'); }
          else { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(data2); }
        });
      } else { res.writeHead(500); res.end('Server error'); }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Syllabus Tracker running at http://${HOST}:${PORT}`);
});
