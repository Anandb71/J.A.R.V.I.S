const { app } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

class PythonBridge {
  constructor() {
    this.process = null;
    this.restarts = 0;
    this.maxRestarts = 3;
    this.intentionalStop = false;
  }

  start() {
    if (this.process) return;

    const projectRoot = path.resolve(__dirname, '..');
    const runtimeRoot = app.isPackaged ? process.resourcesPath : projectRoot;
    const venvPython = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python';

    this.intentionalStop = false;
    this.process = spawn(pythonCmd, ['-m', 'backend.main'], {
      cwd: runtimeRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    this.process.stdout.on('data', (chunk) => {
      console.log(`[python] ${chunk.toString().trim()}`);
    });

    this.process.stderr.on('data', (chunk) => {
      console.error(`[python:err] ${chunk.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      const wasIntentional = this.intentionalStop;
      this.process = null;

      if (!wasIntentional && this.restarts < this.maxRestarts) {
        this.restarts += 1;
        console.warn(`Python backend exited (${code}). Restarting (${this.restarts}/${this.maxRestarts})...`);
        setTimeout(() => this.start(), 1200);
      }
    });
  }

  stop() {
    if (!this.process) return;

    this.intentionalStop = true;
    if (process.platform === 'win32') {
      this.process.kill('SIGINT');
    } else {
      this.process.kill('SIGTERM');
    }

    setTimeout(() => {
      if (this.process) {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(this.process.pid), '/T', '/F'], {
            stdio: 'ignore',
            shell: false,
          });
        } else {
          this.process.kill('SIGKILL');
        }
      }
    }, 3000);
  }
}

module.exports = { PythonBridge };
