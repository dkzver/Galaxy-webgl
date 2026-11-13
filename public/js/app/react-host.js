const UI_BASE = '/ui/';

function showLoadError(root, message) {
  root.className = 'app-ui-error';
  root.setAttribute('role', 'alert');
  root.textContent = message;
}

export async function mountReactApp() {
  const root = document.getElementById('app-root');
  if (!root) throw new Error('Не найден контейнер React #app-root');

  try {
    const response = await fetch(`${UI_BASE}.vite/manifest.json`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`React manifest недоступен (${response.status})`);
    }

    const manifest = await response.json();
    const entry = manifest['index.html'];
    if (!entry || typeof entry.file !== 'string') {
      throw new Error('В manifest не найдена точка входа index.html');
    }

    for (const stylesheet of entry.css || []) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(`${UI_BASE}${stylesheet}`, location.origin).href;
      document.head.append(link);
    }

    root.dataset.engineEmbedded = 'true';
    await import(new URL(`${UI_BASE}${entry.file}`, location.origin).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[react-host] интерфейс не загрузился:', error);
    showLoadError(root, `React-интерфейс не загружен: ${message}. Соберите клиент и выполните npm run sync:engine-ui.`);
  }
}
