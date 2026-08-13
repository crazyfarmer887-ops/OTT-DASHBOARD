export type LatestRequestControllerOptions<T> = {
  load: (signal: AbortSignal) => Promise<T>;
  onStart: () => void;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  onFinish: () => void;
};

export type LatestRequestController = {
  run: () => Promise<void>;
  dispose: () => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function createLatestRequestController<T>(options: LatestRequestControllerOptions<T>): LatestRequestController {
  let generation = 0;
  let activeController: AbortController | null = null;
  let disposed = false;

  return {
    async run() {
      if (disposed) return;
      const requestGeneration = ++generation;
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      options.onStart();
      try {
        const value = await options.load(controller.signal);
        if (!disposed && requestGeneration === generation && !controller.signal.aborted) options.onSuccess(value);
      } catch (error) {
        if (!disposed && requestGeneration === generation && !controller.signal.aborted && !isAbortError(error)) options.onError(error);
      } finally {
        if (!disposed && requestGeneration === generation && !controller.signal.aborted) options.onFinish();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      activeController?.abort();
      activeController = null;
    },
  };
}
