/**
 * ChatPanel — J.A.R.V.I.S. Comms Display
 *
 * Features:
 *  - Role-based message styling (user/assistant/tool/error/system)
 *  - Streaming text with character-by-character animation
 *  - Auto-scroll with smart detection
 *  - Message deduplication for streaming chunks
 *  - Typing indicator during AI processing
 */
export class ChatPanel {
  constructor(root) {
    this.root = root;
    this.messages = [];
    this._streamBuffer = '';
    this._streamEl = null;
    this._isStreaming = false;
    this._maxMessages = 100;
    this._userScrolled = false;

    // Track user scroll position
    this.root.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.root;
      this._userScrolled = (scrollHeight - scrollTop - clientHeight) > 60;
    });
  }

  /** Add a complete message */
  add(role, text) {
    if (!text || !text.trim()) return;

    const normalized = text.trim();
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === role && last.text === normalized && (Date.now() - last.ts) < 2000) {
      return;
    }

    // If we're streaming and this is an assistant chunk, append to stream
    if (role === 'assistant' && this._isStreaming) {
      this._appendStream(text);
      return;
    }

    // End any previous stream
    this._endStream();

    const msg = { role, text: normalized, ts: Date.now() };
    this.messages.push(msg);
    if (this.messages.length > this._maxMessages) this.messages.shift();

    this._appendMessageDom(msg);
    this._autoScroll();
  }

  /** Start streaming mode for assistant responses */
  startStream() {
    this._endStream();
    this._isStreaming = true;
    this._streamBuffer = '';

    const item = document.createElement('div');
    item.className = 'chat-item chat-assistant';

    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    meta.textContent = `J.A.R.V.I.S. · ${new Date().toLocaleTimeString()}`;

    const body = document.createElement('div');
    body.className = 'chat-body';

    // Typing indicator
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(typing);

    item.append(meta, body);
    this.root.appendChild(item);
    this._streamEl = body;
    this._autoScroll();
  }

  /** Append text chunk to active stream */
  _appendStream(text) {
    if (!this._streamEl) {
      this.startStream();
    }

    this._streamBuffer += text;

    // Remove typing indicator if present
    const typing = this._streamEl.querySelector('.typing-indicator');
    if (typing) typing.remove();

    this._streamEl.textContent = this._streamBuffer;
    this._autoScroll();
  }

  /** End streaming mode */
  _endStream() {
    if (this._isStreaming && this._streamBuffer) {
      this.messages.push({
        role: 'assistant',
        text: this._streamBuffer,
        ts: Date.now(),
      });
      if (this.messages.length > this._maxMessages) this.messages.shift();
    }
    this._isStreaming = false;
    this._streamBuffer = '';
    this._streamEl = null;
  }

  /** Show typing indicator */
  showTyping() {
    this.startStream();
  }

  /** Hide typing indicator and finalize stream */
  hideTyping() {
    this._endStream();
  }

  /** Add a system message (centered, subtle) */
  addSystem(text) {
    this.add('system', text);
  }

  /** Create and append a message DOM element */
  _appendMessageDom(msg) {
    const item = document.createElement('div');
    item.className = `chat-item chat-${msg.role}`;

    const meta = document.createElement('div');
    meta.className = 'chat-meta';

    const roleLabels = {
      user: 'YOU',
      assistant: 'J.A.R.V.I.S.',
      tool: '⚡ TOOL',
      error: '⚠ ERROR',
      system: '● SYSTEM',
    };

    meta.textContent = `${roleLabels[msg.role] || msg.role.toUpperCase()} · ${new Date(msg.ts).toLocaleTimeString()}`;

    const body = document.createElement('div');
    body.className = 'chat-body';

    // Basic formatting: bold, code, newlines
    body.innerHTML = this._formatText(msg.text);

    item.append(meta, body);
    this.root.appendChild(item);
  }

  /** Simple text formatting */
  _formatText(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  /** Smart auto-scroll */
  _autoScroll() {
    if (!this._userScrolled) {
      requestAnimationFrame(() => {
        this.root.scrollTop = this.root.scrollHeight;
      });
    }
  }

  /** Clear all messages */
  clear() {
    this.messages = [];
    this._endStream();
    this.root.innerHTML = '';
  }
}
