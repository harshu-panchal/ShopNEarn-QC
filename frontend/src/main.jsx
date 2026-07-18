import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ensureStorageSchema } from '@core/utils/storage';
import { reloadOnceForStaleChunk } from '@shared/utils/staleChunkRecovery';

// Wipe legacy persisted blobs from previous schema versions on the very first
// load after a deploy. Runs synchronously before React mounts so no component
// can ever read stale state from a bumped schema version.
ensureStorageSchema();

// Vite fires this when a lazy chunk fails to load — typically because a new
// deploy replaced the hashed asset files this session references. Reload once
// to fetch the new index.html instead of surfacing the "Oops!" error screen.
window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnceForStaleChunk()) event.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
