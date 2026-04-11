const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

test('project has essential runtime files', () => {
  const required = [
    'package.json',
    path.join('electron', 'main.js'),
    path.join('electron', 'preload.js'),
    path.join('src', 'index.html'),
    path.join('src', 'js', 'app.js'),
    path.join('backend', 'main.py'),
  ];

  required.forEach((file) => {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);
  });
});

test('package scripts include start/dev/test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.start, 'start script missing');
  assert.ok(pkg.scripts.dev, 'dev script missing');
  assert.ok(pkg.scripts.test, 'test script missing');
});
