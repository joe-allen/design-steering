import '@testing-library/svelte/vitest';

// Lets convertFileSrc work without the Tauri runtime.
window.__TAURI_INTERNALS__ = { convertFileSrc: (path) => `asset://localhost/${encodeURIComponent(path)}` };
