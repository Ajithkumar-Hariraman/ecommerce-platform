import type { Product } from "./product.types";
import type { Category } from "../categories/category.types";
const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
export function ProductList({
  products,
  categories,
  busy,
  onEdit,
  onDelete,
}: {
  products: Product[];
  categories: Category[];
  busy: boolean;
  onEdit: (id: string) => void;
  onDelete: (product: Product) => void;
}) {
  if (!products.length)
    return (
      <div className="empty">
        <h3>No products to show</h3>
        <p>Create a product or choose another status.</p>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">Products in the selected status</caption>
        <thead>
          <tr>
            {["Product", "SKU", "Price", "Stock", "Status", "Category", "Actions"].map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id}>
              <td>
                <strong>{product.name}</strong>
              </td>
              <td className="sku">{product.sku}</td>
              <td className="numeric">{currency.format(product.priceInMinorUnits / 100)}</td>
              <td className={`numeric ${product.stock < 10 ? "low-stock" : ""}`}>
                {product.stock}
              </td>
              <td>
                <span className={`badge ${product.status.toLowerCase()}`}>{product.status}</span>
              </td>
              <td>
                {product.categoryId === null ? (
                  <span className="muted">Uncategorized</span>
                ) : (
                  (categories.find((c) => c.id === product.categoryId)?.name ??
                  "Unavailable category")
                )}
              </td>
              <td>
                <div className="actions">
                  <button
                    className="subtle"
                    disabled={busy}
                    onClick={() => onEdit(product.id)}
                    aria-label={`Edit ${product.name}`}
                  >
                    Edit
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => onDelete(product)}
                    aria-label={`Delete ${product.name}`}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
