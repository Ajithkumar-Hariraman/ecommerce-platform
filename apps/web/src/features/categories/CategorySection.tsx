import { useState } from "react";
import { categoriesApi } from "../../api/categories";
import { errorMessage } from "../../api/http";
import type { Category } from "./category.types";
import { CategoryForm } from "./CategoryForm";
export function CategorySection({
  categories,
  loading,
  error,
  onRefresh,
}: {
  categories: Category[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState<Category>();
  const [deleting, setDeleting] = useState<Category>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>();
  function saved(message: string) {
    setFeedback({ message });
    setEditing(undefined);
    setDeleting(undefined);
    onRefresh();
  }
  async function remove(category: Category) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await categoriesApi.remove(category.id);
      saved("Category deleted.");
    } catch (error) {
      setFeedback({ message: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel categories">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ORGANIZE</p>
          <h2>Categories</h2>
        </div>
        <button className="subtle" onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
      </div>
      {feedback && (
        <p
          role={feedback.error ? "alert" : "status"}
          className={feedback.error ? "error" : "notice"}
        >
          {feedback.message}
        </p>
      )}
      {loading ? (
        <p role="status">Loading categories…</p>
      ) : error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : categories.length === 0 ? (
        <p className="empty">No categories yet. Create your first below.</p>
      ) : (
        <ul className="category-list">
          {categories.map((category) => (
            <li key={category.id}>
              <div>
                <strong>{category.name}</strong>
                <small>{category.slug}</small>
              </div>
              <span className={`badge ${category.status.toLowerCase()}`}>{category.status}</span>
              <div className="actions">
                <button
                  className="subtle"
                  disabled={busy}
                  onClick={() => {
                    setEditing(category);
                    setDeleting(undefined);
                    setFeedback(undefined);
                  }}
                >
                  Edit
                </button>
                <button
                  className="subtle"
                  disabled={busy}
                  onClick={() => {
                    setDeleting(category);
                    setEditing(undefined);
                    setFeedback(undefined);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <CategoryForm
          key={editing.id}
          category={editing}
          onSaved={() => saved("Category updated.")}
          onCancel={() => setEditing(undefined)}
        />
      )}
      {deleting && (
        <div className="confirmation">
          <p>
            Delete <strong>{deleting.name}</strong>?
          </p>
          <button className="danger" disabled={busy} onClick={() => void remove(deleting)}>
            {busy ? "Deleting…" : "Confirm category deletion"}
          </button>
          <button className="subtle" disabled={busy} onClick={() => setDeleting(undefined)}>
            Cancel
          </button>
        </div>
      )}
      <details className="disclosure">
        <summary>+ New category</summary>
        <CategoryForm onSaved={() => saved("Category created.")} />
      </details>
    </section>
  );
}
