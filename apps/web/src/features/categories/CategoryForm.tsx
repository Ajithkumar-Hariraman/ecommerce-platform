import { useState } from "react";
import type { FormEvent } from "react";
import { categoriesApi } from "../../api/categories";
import { errorMessage } from "../../api/http";
export function CategoryForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await categoriesApi.create({ name, slug, status });
      setName("");
      setSlug("");
      setStatus("ACTIVE");
      onCreated();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <h3>New category</h3>
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
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option>ACTIVE</option>
            <option>INACTIVE</option>
          </select>
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit">{busy ? "Creating…" : "Create category"}</button>
      </fieldset>
    </form>
  );
}
