const pad = (value) => String(value).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export function formatDate(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Keeps entries whose date or name contains the text, ignoring case. */
export function filterRuns(runs, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return runs;
  return runs.filter((run) => formatDate(run.modifiedMs).includes(needle) || run.name.toLowerCase().includes(needle));
}
