// In-memory stand-in for @tauri-apps/plugin-store. `disk` plays the settings file: each load()
// reads it afresh, like a relaunch, and only save() writes back.
export const disk = new Map();

export async function load() {
  const data = new Map(disk);
  return {
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
    save: async () => {
      disk.clear();
      for (const [key, value] of data) disk.set(key, value);
    },
  };
}
