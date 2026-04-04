/**
 * SystemGauges — Animated Arc Gauges with Smooth Transitions
 *
 * Each gauge smoothly interpolates to target values and changes
 * color based on load/stress level (cyan → amber → red).
 */
export class SystemGauges {
  constructor() {
    this.gauges = {};
    this._animHandle = null;
    this._running = false;
    this._topCpu = null;
    this._topGpu = null;
    this._topRam = null;
  }

  /**
   * Initialize all gauge canvases
   */
  init() {
    const defs = [
      { id: 'cpu-gauge', label: 'CPU', unit: '%', max: 100 },
      { id: 'ram-gauge', label: 'RAM', unit: '%', max: 100 },
      { id: 'gpu-gauge', label: 'GPU', unit: '%', max: 100 },
      { id: 'net-gauge', label: 'NET', unit: 'KB/s', max: 5000 },
    ];

    for (const def of defs) {
      const canvas = document.getElementById(def.id);
      if (!canvas) continue;

      const ctx = canvas.getContext('2d');
      this.gauges[def.label] = {
        canvas,
        ctx,
        label: def.label,
        unit: def.unit,
        max: def.max,
        current: 0,
        target: 0,
        color: '#00b4ff',
        targetColor: [0, 180, 255],
        currentColor: [0, 180, 255],
      };
    }

    // Top bar metric elements
    this._topCpu = document.getElementById('top-cpu');
    this._topGpu = document.getElementById('top-gpu');
    this._topRam = document.getElementById('top-ram');

    this._running = true;
    this._animLoop();
  }

  /**
   * Update gauge target values from system metrics
   * @param {Object} m - Metrics payload from backend
   */
  update(m) {
    if (!m) return;

    if (this.gauges.CPU) {
      this.gauges.CPU.target = m.cpu_percent ?? 0;
    }
    if (this.gauges.RAM) {
      this.gauges.RAM.target = m.ram_percent ?? 0;
    }
    if (this.gauges.GPU) {
      this.gauges.GPU.target = m.gpu_percent ?? 0;
    }
    if (this.gauges.NET) {
      const kbps = (m.net_recv_kbps ?? 0) + (m.net_sent_kbps ?? 0);
      this.gauges.NET.target = Math.min(kbps, this.gauges.NET.max);
    }

    // Update top bar metrics
    if (this._topCpu) this._topCpu.textContent = `${Math.round(m.cpu_percent ?? 0)}%`;
    if (this._topGpu) this._topGpu.textContent = m.gpu_percent != null ? `${m.gpu_percent}%` : 'N/A';
    if (this._topRam) this._topRam.textContent = `${Math.round(m.ram_percent ?? 0)}%`;

    // Detail readouts
    const ramDetail = document.getElementById('sys-ram-detail');
    if (ramDetail && m.ram_used_gb != null) {
      ramDetail.textContent = `RAM: ${m.ram_used_gb} / ${m.ram_total_gb} GB`;
    }
    const gpuName = document.getElementById('sys-gpu-name');
    if (gpuName && m.gpu_name) {
      gpuName.textContent = `GPU: ${m.gpu_name}`;
    }
    const disk = document.getElementById('sys-disk');
    if (disk && m.disk_percent != null) {
      disk.textContent = `Disk: ${m.disk_percent}%`;
    }
    const net = document.getElementById('sys-net-detail');
    if (net) {
      const up = Math.round(m.net_sent_kbps ?? 0);
      const down = Math.round(m.net_recv_kbps ?? 0);
      net.textContent = `↑ ${up} KB/s  ↓ ${down} KB/s`;
    }

    // Battery
    const battEl = document.getElementById('top-battery');
    if (battEl && m.battery_percent != null) {
      const icon = m.battery_charging ? '⚡' : '🔋';
      battEl.textContent = `${icon} ${Math.round(m.battery_percent)}%`;
    }
  }

  /**
   * Animation loop — smoothly interpolates values and redraws
   */
  _animLoop() {
    if (!this._running) return;

    for (const gauge of Object.values(this.gauges)) {
      // Lerp current → target
      gauge.current += (gauge.target - gauge.current) * 0.12;

      // Calculate stress ratio
      const ratio = gauge.max > 0 ? gauge.current / gauge.max : 0;

      // Color interpolation based on load
      let targetColor;
      if (ratio >= 0.9) {
        targetColor = [255, 51, 102]; // red
      } else if (ratio >= 0.75) {
        targetColor = [255, 184, 0]; // amber
      } else {
        targetColor = [0, 180, 255]; // cyan
      }

      // Lerp color
      gauge.currentColor = gauge.currentColor.map((c, i) =>
        c + (targetColor[i] - c) * 0.08
      );

      this._drawGauge(gauge, ratio);
    }

    this._animHandle = requestAnimationFrame(() => this._animLoop());
  }

  /**
   * Draw a single arc gauge
   */
  _drawGauge(gauge, ratio) {
    const { canvas, ctx, label, unit, current, max } = gauge;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h * 0.55;
    const radius = Math.min(w, h) * 0.38;
    const lineWidth = Math.max(4, radius * 0.13);
    const startAngle = Math.PI * 0.75;
    const endAngle = Math.PI * 2.25;

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(0, 180, 255, 0.08)';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 60% tick marks
    const ticks = 12;
    for (let i = 0; i <= ticks; i++) {
      const angle = startAngle + (endAngle - startAngle) * (i / ticks);
      const inner = radius - lineWidth * 0.8;
      const outer = radius + lineWidth * 0.6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = 'rgba(0, 180, 255, 0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Value arc
    const clampedRatio = Math.min(Math.max(ratio, 0), 1);
    const valueAngle = startAngle + (endAngle - startAngle) * clampedRatio;

    if (clampedRatio > 0.005) {
      const [r, g, b] = gauge.currentColor.map(Math.round);
      const color = `rgb(${r}, ${g}, ${b})`;

      // Glow
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, valueAngle);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }

    // Value text
    const displayValue = label === 'NET'
      ? Math.round(current) >= 1000
        ? `${(current / 1000).toFixed(1)}M`
        : `${Math.round(current)}`
      : Math.round(current);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Big number
    ctx.font = `bold ${Math.max(14, radius * 0.45)}px 'Bahnschrift', 'Segoe UI Semibold', sans-serif`;
    ctx.fillStyle = '#e0f0ff';
    ctx.fillText(String(displayValue), cx, cy - 2);

    // Unit
    ctx.font = `${Math.max(8, radius * 0.18)}px 'Bahnschrift', 'Segoe UI Semibold', sans-serif`;
    ctx.fillStyle = 'rgba(100, 144, 170, 0.7)';
    ctx.fillText(unit, cx, cy + radius * 0.32);

    // Label
    ctx.font = `${Math.max(8, radius * 0.2)}px 'Bahnschrift', 'Segoe UI Semibold', sans-serif`;
    ctx.fillStyle = 'rgba(0, 180, 255, 0.6)';
    ctx.letterSpacing = '0.1em';
    ctx.fillText(label, cx, cy + radius * 0.75);
  }

  /**
   * Cleanup
   */
  destroy() {
    this._running = false;
    if (this._animHandle) cancelAnimationFrame(this._animHandle);
  }
}
