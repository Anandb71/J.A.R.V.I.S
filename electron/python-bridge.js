const { app } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

class PythonBridge {
  constructor() {
    this.process = null;
    this.restarts = 0;
    this.maxRestarts = 12;
    this.intentionalStop = false;
    this.restartTimer = null;
    this.bindConflictDetected = false;
  }

  start() {
    if (this.process) return;

    const projectRoot = path.resolve(__dirname, '..');
    let cmd = '';
    let args = [];
    let runtimeRoot = projectRoot;

    if (app.isPackaged) {
      cmd = path.join(process.resourcesPath, 'backend', 'jarvis-backend.exe');
      runtimeRoot = path.join(process.resourcesPath, 'backend');
    } else {
      const venvPython = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
      cmd = fs.existsSync(venvPython) ? venvPython : 'python';
      args = ['-m', 'backend.main'];
    }

    this.intentionalStop = false;
    this.bindConflictDetected = false;
    this.process = spawn(cmd, args, {
      cwd: runtimeRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    this.process.stdout.on('data', (chunk) => {
      console.log(`[python] ${chunk.toString().trim()}`);
    });

    this.process.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text.includes('error while attempting to bind on address') || text.includes('Only one usage of each socket address')) {
        this.bindConflictDetected = true;
      }
      console.error(`[python:err] ${text}`);
    });

    this.process.on('error', (error) => {
      console.error(`[python:spawn:error] ${error?.message || error}`);
    });

    this.process.on('exit', (code) => {
      const wasIntentional = this.intentionalStop;
      this.process = null;

      if (this.bindConflictDetected) {
        console.warn('Python backend port already in use; assuming backend is already running and skipping auto-restart.');
        return;
      }

      if (!wasIntentional && this.restarts < this.maxRestarts) {
        this.restarts += 1;
        const backoffMs = Math.min(1200 * (2 ** (this.restarts - 1)), 12000);
        console.warn(`Python backend exited (${code}). Restarting (${this.restarts}/${this.maxRestarts}) in ${backoffMs}ms...`);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.start();
        }, backoffMs);
      }
    });
  }

  stop() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (!this.process) return;

    this.intentionalStop = true;
    const pid = this.process.pid;
    if (process.platform === 'win32') {
      if (pid) {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          shell: false,
        });
      }
      this.process = null;
      return;
    }

    this.process.kill('SIGTERM');
    setTimeout(() => {
      if (this.process) {
        this.process.kill('SIGKILL');
      }
    }, 1500);
  }
}

module.exports = { PythonBridge };
