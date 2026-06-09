import { ENGINE_VERSION } from "@/lib/engine";

/**
 * Placeholder home route.
 *
 * The visual design for the suite is being produced separately. Until the
 * mockup lands, this route is intentionally a minimal, unstyled placeholder —
 * the work in this codebase is the data model, the computation engine and the
 * ingest/export logic, none of which depend on the screens.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">G12++ Exam Processing Suite</h1>
      <p className="mt-2 text-sm text-gray-600">
        Backend &amp; computation engine scaffold. UI screens are pending the
        design mockup and are intentionally not built yet.
      </p>
      <p className="mt-4 text-xs text-gray-400">
        Engine version: <code>{ENGINE_VERSION}</code>
      </p>
    </main>
  );
}
