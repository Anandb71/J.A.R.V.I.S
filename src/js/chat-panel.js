export class ChatPanel {
  constructor(root) {
    this.root = root;
    this.messages = [];
  }

  add(role, text, meta = {}) {
    this.messages.push({ role, text, meta, ts: Date.now() });
    if (this.messages.length > 50) this.messages.shift();
    this.render();
  }

  render() {
    this.root.innerHTML = '';
    for (const message of this.messages) {
      const item = document.createElement('div');
      item.className = `chat-item chat-${message.role}`;
      const header = document.createElement('div');
      header.className = 'chat-meta';
      header.textContent = `${message.role.toUpperCase()} · ${new Date(message.ts).toLocaleTimeString()}`;
      const body = document.createElement('div');
      body.className = 'chat-body';
      body.textContent = message.text;
      item.append(header, body);
      this.root.appendChild(item);
    }
    this.root.scrollTop = this.root.scrollHeight;
  }
}
