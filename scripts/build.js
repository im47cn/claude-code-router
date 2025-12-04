#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('Building Claude Code Router...');

try {
  // Ensure dist directory exists
  const distDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distDir)) {
    console.log('Creating dist directory...');
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Build the main CLI application
  console.log('Building CLI application...');
  execSync('esbuild src/cli.ts --bundle --platform=node --outfile=dist/cli.js --external:proper-lockfile', { stdio: 'inherit' });

  // Build the main index module for testing
  console.log('Building index module for testing...');
  execSync('esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js --external:proper-lockfile', { stdio: 'inherit' });

  // Copy the tiktoken WASM file
  console.log('Copying tiktoken WASM file...');
  const wasmSource = path.join(__dirname, '..', 'node_modules', 'tiktoken', 'tiktoken_bg.wasm');
  if (!fs.existsSync(wasmSource)) {
    console.error(`Error: ${wasmSource} not found. Run 'npm install' first.`);
    process.exit(1);
  }
  execSync('shx cp node_modules/tiktoken/tiktoken_bg.wasm dist/tiktoken_bg.wasm', { stdio: 'inherit' });

  // Build the UI
  console.log('Building UI...');
  const uiDir = path.join(__dirname, '..', 'ui');
  if (!fs.existsSync(uiDir)) {
    console.error('Error: ui directory does not exist');
    process.exit(1);
  }

  // Check if node_modules exists in ui directory, if not install dependencies
  const uiNodeModules = path.join(uiDir, 'node_modules');
  if (!fs.existsSync(uiNodeModules)) {
    console.log('Installing UI dependencies...');
    execSync('npm install', { stdio: 'inherit', cwd: uiDir });
  }
  execSync('npm run build', { stdio: 'inherit', cwd: uiDir });

  // Copy the built UI index.html to dist
  console.log('Copying UI build artifacts...');
  const uiIndexSource = path.join(uiDir, 'dist', 'index.html');
  if (!fs.existsSync(uiIndexSource)) {
    console.error(`Error: ${uiIndexSource} not found. UI build may have failed.`);
    process.exit(1);
  }
  execSync('shx cp ui/dist/index.html dist/index.html', { stdio: 'inherit' });

  console.log('Build completed successfully!');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
