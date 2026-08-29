import { ipcRenderer } from "electron";

type AnyArgs = unknown[];

export function invoke<T = any>(channel: string, ...args: AnyArgs): Promise<T> {
  return ipcRenderer.invoke(channel, ...args);
}

export function send(channel: string, ...args: AnyArgs): void {
  ipcRenderer.send(channel, ...args);
}

export function sendSync<T = any>(channel: string, ...args: AnyArgs): T {
  return ipcRenderer.sendSync(channel, ...args) as T;
}

export function on<TArgs extends AnyArgs>(
  channel: string,
  callback: (...args: TArgs) => void,
): () => void {
  const listener = (_event: unknown, ...args: unknown[]) =>
    callback(...(args as TArgs));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
