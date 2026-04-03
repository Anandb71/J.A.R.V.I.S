(() => {
  class JarvisSocket {
    constructor(url) {
      this.url = url;
      this.ws = null;
      this.listeners = new Set();
      this.reconnectDelay = 1200;
    }

    connect() {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.emit({ event: 'socket', payload: { state: 'connected' } });
      };

      this.ws.onmessage = (evt) => {
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

    onMessage(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit(message) {
      this.listeners.forEach((listener) => listener(message));
    }
  }

  window.JarvisSocket = JarvisSocket;
})();
