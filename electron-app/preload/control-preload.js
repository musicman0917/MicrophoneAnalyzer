const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlApi', {
  runCalibration: () => ipcRenderer.invoke('calibration:run'),
  selectDevice: (payload) => ipcRenderer.invoke('device:select', payload),

  onLevelUpdate: (callback) => {
    const listener = (_event, levels) => callback(levels);
    ipcRenderer.on('level:update', listener);
    return () => ipcRenderer.removeListener('level:update', listener);
  },

  onCalibrationResult: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('calibration:result', listener);
    return () => ipcRenderer.removeListener('calibration:result', listener);
  },

  onStatusUpdate: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('status:update', listener);
    return () => ipcRenderer.removeListener('status:update', listener);
  },
  getStatus: () => ipcRenderer.invoke('status:get'),

  quit: () => ipcRenderer.invoke('app:quit'),
});
