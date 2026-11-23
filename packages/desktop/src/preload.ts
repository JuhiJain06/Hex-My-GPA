import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { isChannel, type BuddyApi, type Channel } from './shared/ipc';

function check(channel: Channel): void {
  if (!isChannel(channel)) throw new Error(`Blocked IPC channel: ${String(channel)}`);
}

const api: BuddyApi = {
  send(channel, payload) {
    check(channel);
    ipcRenderer.send(channel, payload);
  },
  invoke(channel, payload) {
    check(channel);
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, listener) {
    check(channel);
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => { ipcRenderer.removeListener(channel, wrapped); };
  },
};

contextBridge.exposeInMainWorld('buddy', api);
