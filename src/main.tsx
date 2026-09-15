import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
// Importing the store rehydrates the persisted storefront mode and re-applies
// its data-mode attribute, so the palette is right on first paint.
import "./app/hooks/useStorefrontMode.ts";
import "./styles/index.css";

// Sentry is configured entirely from the environment.
//
// The DSN used to carry a hardcoded fallback to the live KithLy project. A DSN
// is not a secret -- it ships in every client bundle by design -- but one
// committed to the repository is an open ingestion endpoint that anyone reading
// the source can post to. Flooding it is cheap, and the cost lands exactly when
// it hurts most: quota exhausted and real errors buried during an incident.
//
// No DSN means no fallback and no reporting. Sentry.init() with an undefined
// dsn is a documented no-op rather than a throw, so a missing variable degrades
// to "unmonitored" instead of taking the app down -- but it says so loudly,
// because silently unmonitored is how you discover the gap during an outage.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;

if (!sentryDsn) {
  console.warn(
    "[sentry] VITE_SENTRY_DSN is not set — error reporting is disabled for this build.",
  );
}

// 100% tracing is fine at zero users and expensive and noisy at any real
// volume. Sample hard in production, keep full traces in development where the
// whole point is to see the transaction you just triggered.
//
// Parsed defensively, because `??` alone is not enough here. Vite injects env
// vars as strings, so `VITE_SENTRY_TRACES_SAMPLE_RATE=` — the most natural way
// to write "leave this unset" — yields "" rather than undefined, sails past the
// nullish coalescing, and `Number("")` is 0. That silently disables tracing
// entirely, which is the opposite of what an empty value is meant to express.
// A non-numeric value would likewise have produced NaN.
//
// An out-of-range number is clamped rather than rejected: Sentry expects 0..1,
// and someone writing `50` meant half, not fifty times.
const DEFAULT_TRACES_SAMPLE_RATE = import.meta.env.PROD ? 0.1 : 1.0;

function resolveTracesSampleRate(): number {
  const raw = import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(
      `[sentry] VITE_SENTRY_TRACES_SAMPLE_RATE=${JSON.stringify(raw)} is not a number — falling back to ${DEFAULT_TRACES_SAMPLE_RATE}.`,
    );
    return DEFAULT_TRACES_SAMPLE_RATE;
  }
  return Math.min(1, Math.max(0, parsed));
}

Sentry.init({
  dsn: sentryDsn,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: resolveTracesSampleRate(),
  replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%
  replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur
});

createRoot(document.getElementById("root")!).render(<App />);
