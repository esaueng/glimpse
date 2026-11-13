import { useRef, useState } from "react";
import { parseReport, type Report } from "../src/expanded";
import { appName, number } from "./data";
import { bucketLabel, eventLabel } from "./labels";
import { TableScroll } from "./charts";
const MAX_BYTES = 65536;
/** Parse report text, describing empty input, JSON syntax and schema problems separately. */
export function readReport(text: string): { report: Report } | { error: string } {
  if (!text.trim()) return { error: "Paste or choose a report first; this one is empty." };
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES)
    return { error: "Report rejected: maximum size is 64 KiB." };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return {
      error: `Report rejected: this is not valid JSON${e instanceof SyntaxError && e.message ? ` (${e.message})` : ""}. Check that the whole file was pasted.`,
    };
  }
  const report = parseReport(value);
  return report
    ? { report }
    : {
        error:
          "Report rejected: the JSON is valid but is not a Glimpse v2 report. Reports contain only schema, app and allowlisted aggregate counts.",
      };
}
export function ReportInspector({ demo = false }: { demo?: boolean }) {
  const input = useRef<HTMLInputElement>(null),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [paste, setPaste] = useState(false),
    [text, setText] = useState(""),
    [announcement, setAnnouncement] = useState("");
  const sequence = useRef(0);
  // On error the pasted text stays so it can be corrected.
  function parse(text: string) {
    setReport(null);
    setError("");
    setAnnouncement("");
    const result = readReport(text);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const value = result.report;
    setReport(value);
    setText("");
    setPaste(false);
    setAnnouncement(
      `Loaded ${appName(value.app)} report with ${number(value.rows.length)} count${value.rows.length === 1 ? "" : "s"}.`,
    );
  }
  async function inspect(file: File | undefined) {
    const current = ++sequence.current;
    setReport(null);
    setError("");
    if (!file) return;
    if (file.size > MAX_BYTES) {
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
                      { event: "error_gpu_lost", bucket: "none", count: 2 },
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
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "report-error" : undefined}
            />
          </label>
          <div>
            <button type="submit" disabled={!text.trim()}>
              Inspect pasted report
            </button>
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
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {error && (
        <p id="report-error" className="error-message" role="alert">
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
                setAnnouncement("Report cleared.");
              }}
            >
              Clear report
            </button>
          </div>
          <TableScroll label="Local diagnostic report">
            <table>
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>Range or kind</th>
                  <th className="numeric">Count</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.length ? (
                  report.rows.map((r) => (
                    <tr key={`${r.event}:${r.bucket}`}>
                      <td title={r.event}>{eventLabel(r.event)}</td>
                      <td title={r.bucket}>{bucketLabel(r.event, r.bucket)}</td>
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
          </TableScroll>
        </>
      )}
    </section>
  );
}
