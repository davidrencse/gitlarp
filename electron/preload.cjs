// Electron bridge for a secure preload script.
const { contextBridge } = require('electron');
// Expose only the platform name to the page as window.gitlarpDesktop.
contextBridge.exposeInMainWorld('gitlarpDesktop', { platform: process.platform });
