export class JarvisSocket {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.listeners = new Set();
    this.binaryListeners = new Set();
    this.baseReconnectDelay = 1200;
    this.maxReconnectDelay = 30000;
    this.reconnectAttempts = 0;
    this.connected = false;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit({ event: 'socket', payload: { state: 'connected' } });
    };

    this.ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        this.binaryListeners.forEach((listener) => listener(evt.data));
        return;
      }
      try {
        const data = JSON.parse(evt.data);
        this.emit(data);
      } catch {
        this.emit({ event: 'socket', payload: { state: 'parse_error' } });
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.emit({ event: 'socket', payload: { state: 'closed' } });
      const delay = Math.min(
        this.baseReconnectDelay * (2 ** this.reconnectAttempts),
        this.maxReconnectDelay,
      );
      const jitteredDelay = Math.floor(delay * (0.5 + Math.random() * 0.5));
      this.reconnectAttempts += 1;
      setTimeout(() => this.connect(), jitteredDelay);
    };

    this.ws.onerror = () => {
      this.connected = false;
      this.emit({ event: 'socket', payload: { state: 'error' } });
    };
  }

  send(event, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ event, payload }));
    return true;
  }

  sendBinary(buffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(buffer);
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onBinary(listener) {
    this.binaryListeners.add(listener);
    return () => this.binaryListeners.delete(listener);
  }

  emit(message) {
    this.listeners.forEach((listener) => listener(message));
  }

  isOpen() {
    return Boolean(this.connected && this.ws && this.ws.readyState === WebSocket.OPEN);
  }
}

