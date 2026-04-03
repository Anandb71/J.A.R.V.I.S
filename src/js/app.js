import { JarvisSocket } from './websocket.js';
import { ThreeEngine } from './three-engine.js';
import { ChatPanel } from './chat-panel.js';
import { SystemGauges } from './system-gauges.js';
import { AudioTransport } from './audio-transport.js';

(() => {
  const clock = document.getElementById('clock');
  const backendStatus = document.getElementById('backend-status');
  const btnClickThrough = document.getElementById('btn-toggle-clickthrough');
  const btnHud = document.getElementById('btn-toggle-hud');
  const orbLabel = document.querySelector('.orb-label');
  const voiceState = document.getElementById('voice-state');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const chatPanel = new ChatPanel(document.getElementById('chat-panel'));
  const gauges = new SystemGauges({
    cpu: document.getElementById('cpu-gauge'),
    ram: document.getElementById('ram-gauge'),
    gpu: document.getElementById('gpu-gauge'),
    net: document.getElementById('net-gauge'),
  });
  const threeEngine = new ThreeEngine(document.getElementById('three-canvas'));
  const audioTransport = new AudioTransport((state) => {
    if (voiceState) voiceState.textContent = state;
    threeEngine.setState(state);
  });

  function setClock() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString();
  }

  function appendLog(line) {
    chatPanel.add('system', line);
  }

  function setOrbState(state, detail = '') {
    if (!orbLabel) return;
    const suffix = detail ? ` • ${detail}` : '';
    orbLabel.textContent = `JARVIS ${state.toUpperCase()}${suffix}`;
    threeEngine.setState(state);
  }

  setClock();
  setInterval(setClock, 1000);

  if (window.jarvis) {
    window.jarvis.getBackendStatus().then((status) => {
      backendStatus.textContent = `Backend: ${status.running ? 'running' : 'down'}`;
      backendStatus.classList.toggle('online', Boolean(status.running));
      backendStatus.classList.toggle('warn', !status.running);
    });

    window.jarvis.onBackendStatus((status) => {
      const running = Boolean(status.running);
      backendStatus.textContent = `Backend: ${running ? 'running' : 'down'}`;
      backendStatus.classList.toggle('online', running);
      backendStatus.classList.toggle('warn', !running);
    });
  }

  const ws = new JarvisSocket('ws://127.0.0.1:8765/ws');
  ws.onBinary((buffer) => {
    audioTransport.playPcm16(buffer).catch((error) => appendLog(`audio error: ${error.message}`));
  });
  ws.onMessage((message) => {
    switch (message.event) {
      case 'brain:routing':
        setOrbState('routing');
        chatPanel.add('system', 'brain routing');
        break;
      case 'brain:routed':
        setOrbState('routed', `${message.payload.tier}/${message.payload.intent}`);
        chatPanel.add('system', `${message.payload.tier}/${message.payload.intent}`);
        break;
      case 'brain:thinking':
        setOrbState('thinking');
        break;
      case 'brain:tool_call':
        setOrbState('tool', message.payload.tool_name || 'requested');
        chatPanel.add('tool', JSON.stringify(message.payload, null, 2));
        break;
      case 'brain:chunk':
        setOrbState('speaking');
        chatPanel.add('assistant', message.payload.text || '');
        break;
      case 'brain:done':
        setOrbState('idle');
        break;
      case 'brain:error':
        setOrbState('error');
        chatPanel.add('error', message.payload.error || 'brain error');
        break;
      case 'system:metrics':
        gauges.update(message.payload || {});
        break;
      case 'voice:state':
        setOrbState(message.payload.state || 'idle', message.payload.last_wake_word || '');
        break;
      case 'voice:wake_word':
        setOrbState('listening', message.payload.keyword || '');
        break;
      case 'voice:transcript':
        setOrbState('thinking', 'transcribing');
        chatPanel.add('user', message.payload.text || '');
        break;
      case 'voice:reply':
        setOrbState('speaking');
        break;
      case 'voice:audio_chunk':
        setOrbState('speaking');
        break;
      case 'voice:done':
        setOrbState('idle');
        break;
      case 'vision:inspection':
        chatPanel.add('system', `vision:inspection ${JSON.stringify(message.payload.status || {}, null, 2)}`);
        break;
      default:
        break;
    }
  });
  ws.connect();

  btnClickThrough.addEventListener('click', async () => {
    if (!window.jarvis) return;
    const result = await window.jarvis.toggleClickThrough();
    appendLog(`click-through => ${result.clickThrough}`);
  });

  btnHud.addEventListener('click', async () => {
    if (!window.jarvis) return;
    const result = await window.jarvis.toggleHud();
    appendLog(`hud-visible => ${result.hudVisible}`);
  });

  btnSend.addEventListener('click', () => {
    const text = chatInput.value.trim();
    if (!text) return;
    ws.send('chat', { message: text, prefer_cloud: false });
    chatPanel.add('user', text);
    chatInput.value = '';
  });

  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      btnSend.click();
    }
  });

  threeEngine.setState('idle');
})();
