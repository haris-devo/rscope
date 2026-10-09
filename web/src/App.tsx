import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeDocument } from "rscope";
import { Explainer } from "./components/Explainer";
import { Hero } from "./components/Hero";
import { InputPanel } from "./components/InputPanel";
import { Report } from "./components/Report";
import { Usage } from "./components/Usage";
import { runAnalysis, type Analysis } from "./lib/analysis";
import { EXAMPLES } from "./lib/examples";

const REPO = "https://github.com/haris-devo/rscope";

export function App() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [activeExample, setActiveExample] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const analyzeRef = useRef<HTMLElement>(null);

  const heroRows = useMemo(
    () => EXAMPLES.map((e) => ({ route: e.route, report: analyzeDocument(e.html, { modules: e.modules }) })),
    [],
  );

  const show = useCallback(async (label: string, text: string, modules?: ReadonlyMap<string, string>) => {
    try {
      setAnalysis(await runAnalysis(label, text, modules));
      setError(null);
    } catch (e) {
      setAnalysis(null);
      setError((e as Error).message);
    }
  }, []);

  const loadExample = useCallback(
    (id: string) => {
      const example = EXAMPLES.find((e) => e.id === id)!;
      setActiveExample(id);
      void show(example.route, example.html, example.modules);
    },
    [show],
  );

  useEffect(() => loadExample("bloated"), [loadExample]);

  return (
    <>
      <header className="site-header">
        <a href="#top" className="wordmark" aria-label="rscope home">
          <span className="wordmark-mark" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          rscope
        </a>
        <nav aria-label="Primary">
          <a href="#analyze">Analyze</a>
          <a href="#cli">CLI &amp; CI</a>
          <a href={REPO}>GitHub</a>
        </nav>
      </header>

      <main id="top">
        <Hero rows={heroRows} onAnalyze={() => analyzeRef.current?.scrollIntoView({ behavior: "smooth" })} />

        <section id="analyze" ref={analyzeRef} className="analyze" aria-labelledby="analyze-title">
          <h2 id="analyze-title" className="section-title">
            Analyze a page
          </h2>
          <InputPanel
            activeExample={activeExample}
            onExample={loadExample}
            onInput={(label, text) => {
              setActiveExample(null);
              void show(label, text);
            }}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {analysis && <Report analysis={analysis} />}
        </section>

        <Explainer />
        <Usage />
      </main>

      <footer className="site-footer">
        <p>
          rscope is MIT-licensed and built by{" "}
          <a href="https://github.com/haris-devo">Haris Ahmed</a>, a tech lead who ships Next.js and React Native products
          and cares about what reaches the browser.
        </p>
        <p className="footer-links">
          <a href={REPO}>Source</a>
          <a href={`${REPO}/issues`}>Report an issue</a>
          <a href="https://www.linkedin.com/in/haris-ahmed-software-engineer">LinkedIn</a>
        </p>
      </footer>
    </>
  );
}
