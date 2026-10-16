import { useRef, useState } from "react";
import { parseReport, type Report } from "../src/expanded";
import { appName, number } from "./data";
export function ReportInspector({ demo = false }: { demo?: boolean }) {
  const input = useRef<HTMLInputElement>(null),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [paste, setPaste] = useState(false),
    [text, setText] = useState("");
  const sequence = useRef(0);
  function parse(text: string) {
    setReport(null);
    setError("");
    if (new TextEncoder().encode(text).byteLength > 65536) {
      setError("Report rejected: maximum size is 64 KiB.");
      return;
    }
    try {
      const value = parseReport(JSON.parse(text));
      if (!value) throw new Error();
      setReport(value);
      setText("");
      setPaste(false);
    } catch {
      setText("");
      setError(
        "Report rejected: expected a Glimpse v2 report with allowlisted aggregate counts only.",
      );
    }
  }
  async function inspect(file: File | undefined) {
    const current = ++sequence.current;
    setReport(null);
    setError("");
    if (!file) return;
    if (file.size > 65536) {
      setError("Report rejected: maximum size is 64 KiB.");
      return;
    }
    try {
      const text = await file.text();
      if (current === sequence.current) parse(text);
    } catch {
      if (current === sequence.current) setError("Report could not be read.");
    }
  }
  return (
    <section className="panel report-panel">
      <div className="panel-heading">
        <div>
          <h2>User-shared reports</h2>
          <p>Opened locally. No automatic upload.</p>
        </div>
        <div className="report-actions">
          {demo && (
            <button
              type="button"
              onClick={() => {
                sequence.current++;
                parse(
                  JSON.stringify({
                    schema: 2,
                    app: "openfea",
                    rows: [
                      { event: "error_mesh", bucket: "none", count: 7 },
                      { event: "solver_backend", bucket: "webgpu", count: 124 },
                      { event: "mesh_latency", bucket: "1s_10s", count: 83 },
                    ],
                  }),
                );
              }}
            >
              Load sample report
            </button>
          )}
          <button type="button" onClick={() => input.current?.click()}>
            Inspect a report
          </button>
          <button
            type="button"
            onClick={() => {
              sequence.current++;
              setPaste(!paste);
            }}
            aria-expanded={paste}
          >
            Paste JSON
          </button>
        </div>
        <input
          ref={input}
          aria-label="Diagnostic report file"
          type="file"
          accept=".json,application/json"
          className="file-input"
          onChange={(e) => {
            void inspect(e.currentTarget.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
      </div>
      {paste && (
        <form
          className="report-paste"
          onSubmit={(e) => {
            e.preventDefault();
            sequence.current++;
            parse(text);
          }}
        >
          <label>
            Report JSON
            <textarea
              value={text}
              maxLength={65536}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
          </label>
          <div>
            <button type="submit">Inspect pasted report</button>
            <button
              type="button"
              onClick={() => {
                setText("");
                setPaste(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <div className="report-status">
            <strong>{appName(report.app)} · user-shared counts</strong>
            <span>Current opted-in page only; no event order or identity.</span>
            <button
              onClick={() => {
                sequence.current++;
                setReport(null);
                setError("");
                setText("");
              }}
            >
              Clear report
            </button>
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Local diagnostic report"
          >
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Bucket</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.length ? (
                  report.rows.map((r) => (
                    <tr key={`${r.event}:${r.bucket}`}>
                      <td>
                        <code>{r.event}</code>
                      </td>
                      <td>{r.bucket}</td>
                      <td className="numeric">{number(r.count)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>Report contains no diagnostic counts.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
