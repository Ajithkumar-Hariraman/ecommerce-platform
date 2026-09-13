import type { Category } from "./category.types";
import { CategoryForm } from "./CategoryForm";
export function CategorySection({
  categories,
  loading,
  error,
  onRefresh,
  onCreated,
}: {
  categories: Category[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onCreated: () => void;
}) {
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
              <span className={`badge ${category.status.toLowerCase()}`}>
                {category.status}
              </span>
            </li>
          ))}
        </ul>
      )}
      <CategoryForm onCreated={onCreated} />
    </section>
  );
}
