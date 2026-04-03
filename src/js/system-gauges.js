class Gauge {
  constructor(canvas, label, color) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.label = label;
    this.color = color;
    this.value = 0;
    this.target = 0;
    this.render();
  }

  update(value) {
    this.target = Number.isFinite(value) ? value : 0;
    this.value += (this.target - this.value) * 0.15;
    this.render();
  }

  render() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    const radius = Math.min(width, height) * 0.34;
    const start = Math.PI * 0.75;
    const end = Math.PI * 2.25;

    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, end);
    ctx.stroke();

    ctx.strokeStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, start + (end - start) * Math.max(0, Math.min(this.value / 100, 1)));
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.font = '600 13px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(this.label, 0, -6);
    ctx.font = '700 18px Consolas';
    ctx.fillText(`${Math.round(this.value)}%`, 0, 16);
    ctx.restore();
  }
}

export class SystemGauges {
  constructor(elements) {
    this.cpu = new Gauge(elements.cpu, 'CPU', '#00ff88');
    this.ram = new Gauge(elements.ram, 'RAM', '#00b4ff');
    this.gpu = new Gauge(elements.gpu, 'GPU', '#b44dff');
    this.net = new Gauge(elements.net, 'NET', '#ff6b35');
  }

  update(payload) {
    this.cpu.update(payload.cpu_percent ?? 0);
    this.ram.update(payload.ram_percent ?? 0);
    this.gpu.update(payload.gpu_percent ?? 0);
    this.net.update(Math.min((payload.net_recv_kbps ?? 0) / 20, 100));
  }
}
