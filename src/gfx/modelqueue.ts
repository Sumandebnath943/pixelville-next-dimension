// The cast, fleet and zoo share the decode limit during startup.
const MAX_LOADING = 4;
let loading = 0;
const waiting: (() => void)[] = [];

export async function loadModel<T>(load: () => Promise<T>): Promise<T> {
  if (loading < MAX_LOADING) loading++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await load();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else loading--;
  }
}
