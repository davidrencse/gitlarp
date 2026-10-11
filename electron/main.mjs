// Electron APIs: app lifecycle, windows, menu, theme, session, and the system shell.
import { app, BrowserWindow, Menu, nativeTheme, session, shell } from 'electron';
// createServer is used to find a free network port.
import { createServer } from 'node:net';
// Path helpers.
import path from 'node:path';
// Convert between file URLs and paths (ES modules).
import { fileURLToPath, pathToFileURL } from 'node:url';

// Project root: the parent of the electron folder.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Height of the custom title bar in pixels.
const titleBarHeight = 44;

// Find a free loopback port so the app never collides with a dev server.
// Find a free loopback port.
function freePort() {
  // Wrap the callback API in a promise.
  return new Promise((resolve, reject) => {
    // Listen on port 0 so the OS picks a free port.
    const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      // Read the port, close the probe, and return the port.
      const { port } = probe.address(); probe.close(() => resolve(port));
    });
  });
}

// Start the bundled Express server inside the Electron process.
async function startServer() {
  // Run from the project root so relative paths such as dist work.
  process.chdir(root);
  // Pick a free port.
  const port = await freePort();
  // Configure the server through environment variables: desktop mode, loopback host, port, and URL.
  Object.assign(process.env, { GITLARP_DESKTOP: '1', HOST: '127.0.0.1', PORT: String(port), APP_URL: `http://127.0.0.1:${port}` });
  // Load the built server (server-dist/index.js), which starts listening.
  await import(pathToFileURL(path.join(root, 'server-dist/index.js')).href);
  // The app origin.
  const origin = process.env.APP_URL;
  // Wait up to about 10 seconds for the server to respond.
  for (let attempt = 0; attempt < 100; attempt++) {
    // Once /api/session answers OK, return the origin.
    try { if ((await fetch(`${origin}/api/session`)).ok) return origin; } catch {}
    // Otherwise wait 100 ms and try again.
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Give up with an error.
  throw new Error('The GitLarp server did not start.');
}

// Create the main window.
function createWindow(origin) {
  // Always use the dark theme.
  nativeTheme.themeSource = 'dark';
  // Create the window with its size limits.
  const win = new BrowserWindow({
    // Size and minimum size.
    width: 1360, height: 880, minWidth: 940, minHeight: 620,
    // Title, background color, and hidden until ready.
    title: 'GitLarp', backgroundColor: '#0a0a0b', show: false,
    // Hide the native title bar (the app draws its own).
    titleBarStyle: 'hidden',
    // Window controls overlay on Windows and Linux.
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#0a0a0b', symbolColor: '#a1a1aa', height: titleBarHeight },
    // Position of the macOS window buttons.
    trafficLightPosition: { x: 16, y: 15 },
    // Secure web settings: preload script, context isolation, sandbox, no Node in the page.
    webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  // Links to GitHub and docs open in the system browser; only the app origin stays in-window.
  // Open https links externally and block new windows.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  // Block navigation away from the app.
  win.webContents.on('will-navigate', (event, url) => {
    // Allow navigation within the app origin.
    if (new URL(url).origin === origin) return;
    // Cancel other navigation and open https links externally.
    event.preventDefault(); if (/^https:\/\//.test(url)) void shell.openExternal(url);
  });
  // Show the window once it has rendered, avoiding a white flash.
  win.once('ready-to-show', () => win.show());
  // Load the app.
  void win.loadURL(origin);
}

// Allow only one running instance.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  // Remove the default menu.
  Menu.setApplicationMenu(null);
  // When another instance starts, focus the existing window.
  app.on('second-instance', () => { const [win] = BrowserWindow.getAllWindows(); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  // When Electron is ready:
  app.whenReady().then(async () => {
    // Deny all web permission requests.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    // Deny all permission checks.
    session.defaultSession.setPermissionCheckHandler(() => false);
    // Start the server.
    const origin = await startServer();
    // Open the window.
    createWindow(origin);
    // On macOS, reopen a window when the dock icon is clicked.
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(origin); });
  // Exit with an error if startup fails.
  }).catch(error => { console.error(error); app.exit(1); });
  // Quit when all windows are closed.
  app.on('window-all-closed', () => app.quit());
}
