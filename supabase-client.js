const createClient = globalThis.supabase?.createClient;

if (!createClient) {
  throw new Error("The local Supabase client failed to load.");
}

export { createClient };
