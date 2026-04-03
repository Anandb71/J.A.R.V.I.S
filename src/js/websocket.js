export class JarvisSocket {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.listeners = new Set();
    this.binaryListeners = new Set();
    this.reconnectDelay = 1200;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
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
      this.emit({ event: 'socket', payload: { state: 'closed' } });
      setTimeout(() => this.connect(), this.reconnectDelay);
    };

    this.ws.onerror = () => {
      this.emit({ event: 'socket', payload: { state: 'error' } });
    };
  }

  send(event, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ event, payload }));
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
}

