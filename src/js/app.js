(() => {
  const clock = document.getElementById('clock');
  const wsLog = document.getElementById('ws-log');
  const backendStatus = document.getElementById('backend-status');
  const btnClickThrough = document.getElementById('btn-toggle-clickthrough');
  const btnHud = document.getElementById('btn-toggle-hud');
  const orbLabel = document.querySelector('.orb-label');

  function setClock() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString();
  }

  function appendLog(line) {
    const stamp = new Date().toLocaleTimeString();
    wsLog.textContent = `[${stamp}] ${line}\n` + wsLog.textContent.slice(0, 2000);
  }

  function setOrbState(state, detail = '') {
    if (!orbLabel) return;
    const suffix = detail ? ` • ${detail}` : '';
    orbLabel.textContent = `JARVIS ${state.toUpperCase()}${suffix}`;
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

  const ws = new window.JarvisSocket('ws://127.0.0.1:8765/ws');
  ws.onMessage((message) => {
    switch (message.event) {
      case 'brain:routing':
        setOrbState('routing');
        break;
      case 'brain:routed':
        setOrbState('routed', `${message.payload.tier}/${message.payload.intent}`);
        break;
      case 'brain:thinking':
        setOrbState('thinking');
        break;
      case 'brain:tool_call':
        setOrbState('tool', message.payload.tool_name || 'requested');
        break;
      case 'brain:chunk':
        setOrbState('speaking');
        break;
      case 'brain:done':
        setOrbState('idle');
        break;
      case 'brain:error':
        setOrbState('error');
        break;
      case 'voice:state':
        setOrbState(message.payload.state || 'idle', message.payload.last_wake_word || '');
        break;
      case 'voice:wake_word':
        setOrbState('listening', message.payload.keyword || '');
        break;
      case 'voice:transcript':
        setOrbState('thinking', 'transcribing');
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
      default:
        break;
    }
    appendLog(`${message.event}: ${JSON.stringify(message.payload)}`);
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
})();
