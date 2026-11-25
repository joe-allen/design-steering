/** Svelte attachment: shows a `<dialog>` modally, focuses it, and restores focus when it is removed. */
export function modal(dialog, opener = dialog.ownerDocument.activeElement) {
  dialog.showModal();
  dialog.focus();
  return () => {
    if (dialog.open) dialog.close();
    opener?.focus?.({ preventScroll: true });
  };
}
