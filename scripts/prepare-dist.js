/**
 * Prepares the clean frontend distribution folder (`dist/`) for the Rust Tauri bundler.
 * Copies index.html, app.js, and style.css so Tauri packages only the web UI assets.
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const assets = ['index.html', 'app.js', 'style.css'];

for (const file of assets) {
  const src = path.join(rootDir, file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[prepare-dist] Copied ${file} -> dist/${file}`);
  } else {
    console.warn(`[prepare-dist] Warning: ${file} not found in root directory`);
  }
}

console.log('[prepare-dist] Frontend assets ready in dist/ for Rust Tauri compilation.');
