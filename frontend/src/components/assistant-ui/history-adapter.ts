import type { ThreadHistoryAdapter } from "@assistant-ui/react";

const STORAGE_KEY = "ofa-thread-history";

/**
 * LocalStorage-backed thread history adapter.
 * Only instantiate on the client — guard with typeof window check.
 */
export function createLocalHistoryAdapter(): ThreadHistoryAdapter {
  const isClient = typeof window !== "undefined";

  return {
    async load() {
      return { headId: null, messages: [] };
    },
    async append() {},
    withFormat: (fmt) => {
      function readRows(): Array<unknown> {
        if (!isClient) return [];
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      }

      return {
        async load() {
          const rows = readRows();
          return { messages: rows.map((row) => fmt.decode(row as Parameters<typeof fmt.decode>[0])) };
        },
        async append(item) {
          if (!isClient) return;
          try {
            const rows = readRows();
            rows.push({
              id: fmt.getId(item.message),
              parent_id: item.parentId,
              format: fmt.format,
              content: fmt.encode(item),
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
          } catch (e) {
            console.warn("[ofa] Failed to persist message:", e);
          }
        },
      };
    },
  };
}
