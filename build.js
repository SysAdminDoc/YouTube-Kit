#!/usr/bin/env node
// build.js — Minifies YTKit.user.js for production
// Strips comments, collapses whitespace, preserves the ==UserScript== header block.
// Usage: node build.js

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'YTKit.user.js');
const OUT = path.join(__dirname, 'YTKit.min.user.js');

const src = fs.readFileSync(SRC, 'utf8');
const lines = src.split('\n');

// Extract UserScript header block (must be preserved verbatim)
let headerEnd = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('// ==/UserScript==')) { headerEnd = i + 1; break; }
}
const header = lines.slice(0, headerEnd).join('\n');
const body = lines.slice(headerEnd).join('\n');

// Minification passes on the body:
let out = body;

// 1. Remove lines that are ONLY comments (no code on the line)
//    This is the safest approach — avoids breaking strings containing //
out = out.replace(/^\s*\/\/[^\n]*$/gm, '');

// 2. Remove multi-line comments — only standalone ones (line starts with /* or whitespace/*)
//    Skip anything that could be inside a string
out = out.replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '');

// 3. Collapse multiple blank lines into one
out = out.replace(/\n{3,}/g, '\n\n');

// 4. Remove leading whitespace (indent) — collapse to minimal
out = out.split('\n').map(line => {
    // Preserve empty lines as-is
    if (line.trim() === '') return '';
    // Strip leading whitespace beyond what's needed for readability
    const trimmed = line.trimStart();
    // Keep 0 indent for top-level, minimal for nested
    const indent = line.length - trimmed.length;
    const compressed = indent > 0 ? ' '.repeat(Math.min(indent, 2)) : '';
    return compressed + trimmed;
}).join('\n');

// 5. Remove trailing whitespace
out = out.replace(/[ \t]+$/gm, '');

// 6. Final collapse of blank lines
out = out.replace(/\n{3,}/g, '\n');

const result = header + '\n' + out;

fs.writeFileSync(OUT, result, 'utf8');

const srcSize = Buffer.byteLength(src, 'utf8');
const outSize = Buffer.byteLength(result, 'utf8');
const saved = srcSize - outSize;
const pct = ((saved / srcSize) * 100).toFixed(1);

console.log(`Source:  ${(srcSize / 1024).toFixed(1)} KB`);
console.log(`Output:  ${(outSize / 1024).toFixed(1)} KB`);
console.log(`Saved:   ${(saved / 1024).toFixed(1)} KB (${pct}%)`);
console.log(`Written: ${OUT}`);
