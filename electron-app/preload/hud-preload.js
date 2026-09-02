const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hudApi', {
  openControlCenter: () => ipcRenderer.invoke('control:open'),
  runCalibration: () => ipcRenderer.invoke('calibration:run'),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('hud:set-always-on-top', value),
  resizeWindow: (size) => ipcRenderer.invoke('hud:resize', size),
  quit: () => ipcRenderer.invoke('app:quit'),

  sendLevelUpdate: (levels) => ipcRenderer.send('level:update', levels),
  sendStatus: (status) => ipcRenderer.send('status:update', status),

  // Main process asks the HUD (which owns the mic stream) to run a calibration pass;
  // the HUD replies on 'calibration:result' once it has a summary or an error.
  onCalibrationStart: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('calibration:start', listener);
    return () => ipcRenderer.removeListener('calibration:start', listener);
  },
  sendCalibrationResult: (result) => ipcRenderer.send('calibration:result', result),

  onDeviceSelect: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('device:select', listener);
    return () => ipcRenderer.removeListener('device:select', listener);
  },
});
