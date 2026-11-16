const { contextBridge, ipcRenderer } = require('electron');
const invoke =
  (name) =>
  (...args) =>
    ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('studio', {
  bootstrap: invoke('app:bootstrap'),
  saveAccount: invoke('settings:account'),
  saveRelay: invoke('settings:relay'),
  connect: invoke('auth:connect'),
  disconnect: invoke('auth:disconnect'),
  refresh: invoke('platforms:refresh'),
  sendChat: invoke('chat:send'),
  captures: invoke('capture:list'),
  selectCapture: invoke('capture:select'),
  pickAsset: invoke('asset:pick'),
  restoreAsset: invoke('asset:restore'),
  browserStart: invoke('browser:start'),
  browserStop: invoke('browser:stop'),
  encoders: invoke('stream:encoders'),
  streamStart: invoke('stream:start'),
  streamChunk: invoke('stream:chunk'),
  streamStop: invoke('stream:stop'),
  recordingStart: invoke('recording:start'),
  recordingChunk: invoke('recording:chunk'),
  recordingStop: invoke('recording:stop'),
  openExternal: invoke('app:external'),
  onEvent: (fn) => {
    const listener = (_event, data) => fn(data);
    ipcRenderer.on('studio:event', listener);
    return () => ipcRenderer.removeListener('studio:event', listener);
  },
});
