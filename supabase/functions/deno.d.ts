// Minimal Deno global type shim for TypeScript IDE support.
// This file is NOT bundled at runtime — Supabase Edge Functions run on real Deno.

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    toObject(): Record<string, string>;
  }

  export const env: Env;

  export function serve(
    handler: (request: Request) => Response | Promise<Response>,
    options?: {
      port?: number;
      hostname?: string;
      signal?: AbortSignal;
      onListen?: (params: { hostname: string; port: number }) => void;
    }
  ): Promise<void>;

  export const version: {
    deno: string;
    v8: string;
    typescript: string;
  };

  export const build: {
    target: string;
    arch: string;
    os: string;
    vendor: string;
    env?: string;
  };

  export const pid: number;
  export const ppid: number;
  export const noColor: boolean;
}

// ---------------------------------------------------------------------------
// Ambient module re-exports: maps Deno URL specifiers → installed node_modules
// The TS language server doesn't understand npm:/jsr: prefixes, so we tell it
// "these specifiers have exactly the same types as their node_modules counterpart"
// ---------------------------------------------------------------------------

declare module "npm:hono" {
  export * from "hono";
  export { default } from "hono";
}

declare module "npm:hono/cors" {
  export * from "hono/cors";
}

declare module "npm:hono/logger" {
  export * from "hono/logger";
}

declare module "jsr:@supabase/supabase-js@2.49.8" {
  export * from "@supabase/supabase-js";
  export { default } from "@supabase/supabase-js";
}

declare module "jsr:@supabase/supabase-js" {
  export * from "@supabase/supabase-js";
  export { default } from "@supabase/supabase-js";
}
