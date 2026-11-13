export function createEngineBridge() {
  const listeners = new Map();
  const state = { status: 'starting', sceneId: null, error: null };
  let resolveReady;
  let rejectReady;
  let settled = false;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});

  const getSnapshot = () => Object.freeze({ ...state });

  const subscribe = (type, listener) => {
    if (typeof type !== 'string' || !type) throw new TypeError('Имя события должно быть непустой строкой');
    if (typeof listener !== 'function') throw new TypeError('Обработчик события должен быть функцией');

    let subscribers = listeners.get(type);
    if (!subscribers) {
      subscribers = new Set();
      listeners.set(type, subscribers);
    }
    subscribers.add(listener);

    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) listeners.delete(type);
    };
  };

  const publish = (type, detail = {}) => {
    if (type === 'scene:loading') {
      state.status = 'loading';
      state.sceneId = detail.sceneId || null;
      state.error = null;
    } else if (type === 'scene:ready') {
      state.status = 'ready';
      state.sceneId = detail.id || null;
      state.error = null;
    } else if (type === 'scene:error') {
      state.status = 'error';
      state.error = detail.message || 'Не удалось загрузить сцену';
    }

    const event = Object.freeze({ type, detail, state: getSnapshot() });
    for (const listener of listeners.get(type) || []) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[engine-bridge] ошибка обработчика ${type}:`, error);
      }
    }

    if (type === 'scene:ready' && !settled) {
      settled = true;
      resolveReady(detail);
      publish('engine:ready', detail);
    } else if (type === 'scene:error' && !settled) {
      settled = true;
      rejectReady(new Error(state.error));
    }
  };

  return {
    api: Object.freeze({
      version: 1,
      ready,
      waitUntilReady: () => ready,
      getSnapshot,
      subscribe
    }),
    publish
  };
}
