#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'CookLikeHOC');
const OUT_DIR = path.join(ROOT, 'assets');
const OUT_FILE = path.join(OUT_DIR, 'cook_manifest.json');

const IGNORE = new Set([
  '.git', '.gitignore', '.vitepress',
  'banner.png', 'logo.png', 'tg.png',
  'index.md', 'README.md', 'package.json', 'package-lock.json'
]);

function generate() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('Missing CookLikeHOC directory');
    process.exit(1);
  }

  const entries = fs.readdirSync(SRC_DIR, { withFileTypes: true });
  const categories = entries
    .filter((d) => d.isDirectory() && !IGNORE.has(d.name))
    .map((dir) => {
      const dirPath = path.join(SRC_DIR, dir.name);
      const items = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith('.md') && f.name !== 'README.md')
        .map((f) => ({
          title: f.name.replace(/\.md$/,'') ,
          path: path.posix.join('CookLikeHOC', dir.name, f.name)
        }));
      return { category: dir.name, items };
    })
    // sort categories and items by locale-aware order
    .sort((a, b) => a.category.localeCompare(b.category, 'zh-Hans-CN'))
    .map((c) => ({ ...c, items: c.items.sort((a,b)=>a.title.localeCompare(b.title, 'zh-Hans-CN')) }));

  const manifest = { base: 'CookLikeHOC', categories };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Wrote ${OUT_FILE} with ${categories.length} categories`);
}

generate();

