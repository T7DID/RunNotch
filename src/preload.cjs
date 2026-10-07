'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('runnotch', {
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  stopJob: (id) => ipcRenderer.invoke('job:stop', id),
  focusJob: (id) => ipcRenderer.invoke('job:focus', id),
  openFolder: (id) => ipcRenderer.invoke('job:open-folder', id),
  removeJob: (id) => ipcRenderer.invoke('job:remove', id),
  clearFinished: () => ipcRenderer.invoke('jobs:clear-finished'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setNotchOpen: (open) => ipcRenderer.send('ui:notch-open', Boolean(open)),
  setExpanded: (expanded) => ipcRenderer.send('ui:expanded', Boolean(expanded)),
  setHeight: (height) => ipcRenderer.send('ui:height', Number(height)),
  hideWindow: () => ipcRenderer.send('ui:hide'),
  onJobs: (callback) => {
    const listener = (_event, jobs) => callback(jobs);
    ipcRenderer.on('jobs:changed', listener);
    return () => ipcRenderer.removeListener('jobs:changed', listener);
  },
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ui:open-settings', listener);
    return () => ipcRenderer.removeListener('ui:open-settings', listener);
  },
  onReveal: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ui:reveal', listener);
    return () => ipcRenderer.removeListener('ui:reveal', listener);
  },
  onCapture: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ui:capture', listener);
    return () => ipcRenderer.removeListener('ui:capture', listener);
  }
});
