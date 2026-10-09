import { useRef, useState, type DragEvent } from "react";
import { EXAMPLES } from "../lib/examples";

interface Props {
  activeExample: string | null;
  onExample: (id: string) => void;
  onInput: (label: string, text: string) => void;
}

export function InputPanel({ activeExample, onExample, onInput }: Props) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => onInput(file.name, await file.text());

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  return (
    <div className="input-panel">
      <div className="examples" role="group" aria-label="Examples">
        <span className="eyebrow">Example build</span>
        {EXAMPLES.map((example) => (
          <button
            key={example.id}
            type="button"
            className={`example${activeExample === example.id ? " is-active" : ""}`}
            aria-pressed={activeExample === example.id}
            onClick={() => onExample(example.id)}
          >
            <span className="mono">{example.route}</span>
            <small>{example.label}</small>
          </button>
        ))}
      </div>

      <form
        className={`paste${dragging ? " is-dragging" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onInput("Pasted payload", text);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <label htmlFor="payload" className="eyebrow">
          Your page
        </label>
        <textarea
          id="payload"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Paste a page's HTML (View Source, select all) or a raw .rsc payload, or drop a file here.\n\ncurl -s https://your.app/page > page.html\ncurl -s -H 'RSC: 1' https://your.app/page > page.rsc"}
        />
        <div className="paste-actions">
          <button type="submit" className="primary" disabled={!text.trim()}>
            Analyze
          </button>
          <button type="button" className="ghost" onClick={() => fileInput.current?.click()}>
            Open file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".html,.htm,.rsc,.txt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = "";
            }}
          />
          <span className="muted privacy">Runs in your browser. Nothing is uploaded.</span>
        </div>
      </form>
    </div>
  );
}
