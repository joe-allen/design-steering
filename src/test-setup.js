import '@testing-library/svelte/vitest';

// Lets convertFileSrc work without the Tauri runtime.
window.__TAURI_INTERNALS__ = { convertFileSrc: (path) => `asset://localhost/${encodeURIComponent(path)}` };

// JSDOM does not implement modal dialogs; browser checks cover native modality.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
