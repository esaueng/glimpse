import { useEffect, useId, useRef, useState } from "react";
import {
  calendarPresets,
  formatRange,
  presetRange,
  rollingPresets,
  spanDays,
  type Preset,
} from "./ranges";
export type Timeframe = { from: string; to: string; preset?: Preset };
const today = () => new Date().toISOString().slice(0, 10);
const Check = () => (
  <svg className="check" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m5 12 5 5 9-10" />
  </svg>
);
export function RangePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Timeframe;
  onChange: (next: Timeframe) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [custom, setCustom] = useState(false),
    [draft, setDraft] = useState({ from: value.from, to: value.to });
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    id = useId();
  function close(focus = true) {
    setOpen(false);
    setCustom(false);
    if (focus) trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    setDraft({ from: value.from, to: value.to });
    panel.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"], button')
      ?.focus();
    const outside = (e: PointerEvent) => {
        if (!root.current?.contains(e.target as Node)) close(false);
      },
      escape = (e: KeyboardEvent) => {
        if (e.key === "Escape") close();
      };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const pick = (preset: Preset) => {
    onChange({ ...presetRange(preset), preset });
    close();
  };
  const option = (p: { id: Preset; label: string }) => {
    const range = presetRange(p.id),
      selected = value.preset === p.id;
    return (
      <button
        key={p.id}
        type="button"
        className="range-option"
        aria-pressed={selected}
        onClick={() => pick(p.id)}
      >
        <span className="range-badge">{spanDays(range.from, range.to)}d</span>
        <span className="range-label">{p.label}</span>
        {selected && <Check />}
      </button>
    );
  };
  const span = spanDays(value.from, value.to);
  return (
    <div className="range-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="range-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="range-badge">{span}d</span>
        <span className="range-text">
          <span className="sr-only">Timeframe: </span>
          {formatRange(value.from, value.to)}
        </span>
        <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          className="range-panel"
          id={id}
          ref={panel}
          role="dialog"
          aria-label="Choose a timeframe"
        >
          <div className="range-list">{rollingPresets.map(option)}</div>
          <div className="range-grid">
            {calendarPresets.flat().map(option)}
          </div>
          {custom ? (
            <form
              className="range-custom"
              onSubmit={(e) => {
                e.preventDefault();
                onChange({ from: draft.from, to: draft.to });
                close();
              }}
            >
              <label>
                <span>From</span>
                <input
                  autoFocus
                  required
                  type="date"
                  value={draft.from}
                  max={draft.to}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  required
                  type="date"
                  value={draft.to}
                  min={draft.from}
                  max={today()}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </label>
              <p className="range-hint">UTC days · up to 90 days</p>
              <button className="primary" type="submit">
                Apply
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="range-option range-custom-toggle"
              aria-pressed={!value.preset}
              onClick={() => setCustom(true)}
            >
              <svg className="range-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
              <span className="range-label">Custom range…</span>
              {!value.preset && <Check />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
