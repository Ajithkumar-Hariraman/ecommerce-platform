import { useState } from "react";
import type { FormEvent } from "react";
import { categoriesApi } from "../../api/categories";
import { errorMessage } from "../../api/http";
import type { Category } from "./category.types";
export function CategoryForm({
  category,
  onSaved,
  onCancel,
}: {
  category?: Category;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(category?.status ?? "ACTIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const input = { name, slug, status };
      if (category) await categoriesApi.update(category.id, input);
      else await categoriesApi.create(input);
      setName("");
      setSlug("");
      setStatus("ACTIVE");
      onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <h3>{category ? "Edit category" : "New category"}</h3>
      <fieldset disabled={busy}>
        <label>
          Category name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home essentials"
          />
        </label>
        <label>
          Slug
          <input
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. home-essentials"
          />
        </label>
        <label>
          Category status
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option>ACTIVE</option>
            <option>INACTIVE</option>
          </select>
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit">
          {busy ? "Saving…" : category ? "Save category" : "Create category"}
        </button>
        {onCancel && (
          <button type="button" className="subtle" onClick={onCancel}>
            Cancel
          </button>
        )}
      </fieldset>
    </form>
  );
}
