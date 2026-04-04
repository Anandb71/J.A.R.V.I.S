const { safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

class CredentialStore {
  constructor(basePath) {
    this.filePath = path.join(basePath, 'credentials.enc');
  }

  save(key, value) {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const store = this._load();
    store[key] = safeStorage.encryptString(String(value)).toString('base64');
    fs.writeFileSync(this.filePath, JSON.stringify(store), 'utf-8');
    return true;
  }

  get(key) {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const store = this._load();
    const encrypted = store[key];
    if (!encrypted) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return null;
    }
  }

  delete(key) {
    const store = this._load();
    if (!(key in store)) return false;
    delete store[key];
    fs.writeFileSync(this.filePath, JSON.stringify(store), 'utf-8');
    return true;
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch {
      return {};
    }
  }
}

module.exports = { CredentialStore };
