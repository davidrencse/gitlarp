// Load variables from .env into process.env.
import 'dotenv/config';
// Import the Express app factory.
import { createApp } from './app';

// Create the app and its session store.
const { app, store } = createApp();
// Port from PORT env var, defaulting to 3001.
const port = Number(process.env.PORT || 3001);
// Start listening, by default only on localhost (127.0.0.1).
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  // Read the actual bound address (useful when port 0 is used).
  const address = server.address();
  // Log the URL the API is reachable at.
  console.log(`GitLarp API listening at http://localhost:${typeof address === 'object' && address ? address.port : port}`);
});
// Close the session store and HTTP server on shutdown.
function shutdown() { store.close(); server.close(); }
// Shut down cleanly on SIGTERM.
process.on('SIGTERM', shutdown);
// Shut down cleanly on SIGINT (Ctrl+C).
process.on('SIGINT', shutdown);
