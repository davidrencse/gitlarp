// React.
import React from 'react';
// React DOM client.
import ReactDOM from 'react-dom/client';
// Inter font.
import '@fontsource-variable/inter';
// JetBrains Mono font.
import '@fontsource-variable/jetbrains-mono';
// Base styles.
import './styles.css';
// App styles.
import './app.css';
// Root component.
import App from './App';

// Read the Electron desktop info from preload (if running in the desktop app).
const desktop = (window as { gitlarpDesktop?: { platform: string } }).gitlarpDesktop;
// Tag the document with the platform for platform-specific CSS.
if (desktop) document.documentElement.dataset.desktop = desktop.platform;

// Render the app in StrictMode.
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
