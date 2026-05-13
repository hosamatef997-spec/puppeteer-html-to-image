const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'changeme';
const imageStore = new Map();

let browserPromise;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none'
      ],
      headless: 'new'
    });
  }
  return browserPromise;
}

app.post('/render', async (req, res) => {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { html, width = 1080, height = 1350 } = req.body;
  if (!html) return res.status(400).json({ error: 'html required' });

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const buffer = await page.screenshot({ type: 'jpeg', quality: 92 });

    const id = crypto.randomBytes(16).toString('hex');
    imageStore.set(id, { buffer, timestamp: Date.now() });

    const now = Date.now();
    for (const [k, v] of imageStore.entries()) {
      if (now - v.timestamp > 3600000) imageStore.delete(k);
    }

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const url = `${proto}://${host}/image/${id}.jpg`;
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

app.get('/image/:filename', (req, res) => {
  const id = req.params.filename.replace(/\.(jpg|jpeg|png)$/i, '');
  const stored = imageStore.get(id);
  if (!stored) return res.status(404).send('Not found');
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(stored.buffer);
});

app.get('/health', (req, res) => res.json({ status: 'ok', images: imageStore.size }));

app.listen(PORT, () => console.log('Server on ' + PORT));
