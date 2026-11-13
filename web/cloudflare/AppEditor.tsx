import { useEffect, useId, useRef, useState } from "react";
import type { App } from "../../src/cloudflare/model";
import type { SettingsWriter } from "./types";

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "app";

/**
 * Modal editor for an app's name, visibility and budget. It takes focus when it
 * opens, closes on Escape, Cancel or a successful save, and hands focus back
 * through `restoreFocus` (the invoking button) when it unmounts.
 */
export function AppEditor({
  app,
  save,
  close,
  restoreFocus,
}: {
  app: App;
  save: SettingsWriter;
  close: () => void;
  restoreFocus: () => void;
}) {
  const [name, setName] = useState(app.name),
    [visibility, setVisibility] = useState(app.visibility),
    [budget, setBudget] = useState(
      app.budget === null ? "" : String(app.budget / 1e6),
    ),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    nameInput = useRef<HTMLInputElement>(null),
    titleId = useId(),
    restore = useRef(restoreFocus);
  restore.current = restoreFocus;
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    nameInput.current?.focus();
    // Unmounting removes the dialog from the top layer; focus goes back to the invoker.
    return () => restore.current();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="cf-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      // Browsers may close a modal on Escape without a cancel event.
      onClose={close}
    >
      <form
        className="cf-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          setSaving(true);
          setError("");
          try {
            await save({
              id: app.id || `custom:${slug(name)}`,
              name,
              visibility,
              budget: budget === "" ? null : Math.round(Number(budget) * 1e6),
            });
            close();
          } catch {
            setError("Could not save app settings. Try again.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <h2 id={titleId}>{app.id ? `Edit ${app.name}` : "Add app"}</h2>
        <label>
          App name
          <input
            ref={nameInput}
            value={name}
            maxLength={100}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="app-select">
          Visibility
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as App["visibility"])}
          >
            <option value="unknown">Not classified</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label>
          Metered usage budget · USD / billing period
          <input
            type="number"
            min="0.01"
            max="1000000"
            step="0.01"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="No budget"
          />
        </label>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="cf-actions">
          <button className="primary" aria-disabled={saving || undefined}>
            {saving ? "Saving…" : "Save app"}
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
