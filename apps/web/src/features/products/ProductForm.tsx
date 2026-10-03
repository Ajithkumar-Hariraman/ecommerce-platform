import { useState } from "react";
import type { FormEvent } from "react";
import type { Product, ProductStatus } from "./product.types";
import type { Category } from "../categories/category.types";
import { productsApi } from "../../api/products";
import { errorMessage } from "../../api/http";
import { priceText, toMinorUnits } from "./price";
export function ProductForm({
  product,
  categories,
  onSaved,
  onCancel,
}: {
  product: Product | null;
  categories: Category[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product ? priceText(product.priceInMinorUnits) : "");
  const [stock, setStock] = useState(String(product?.stock ?? 0));
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? "ACTIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const input = {
        sku,
        name,
        description: description || null,
        priceInMinorUnits: toMinorUnits(price),
        stock: Number(stock),
        categoryId: categoryId || null,
      };
      if (product) await productsApi.update(product.id, { ...input, status });
      else await productsApi.create(input);
      onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="editor panel">
      <h2>{product ? "Edit product" : "New product"}</h2>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              Product name
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              SKU
              <input required value={sku} onChange={(e) => setSku(e.target.value)} />
            </label>
            <label>
              Price (major units)
              <input
                required
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label>
              Stock
              <input
                required
                type="number"
                step="1"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
            </label>
            <label>
              Category
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Uncategorized</option>
                {categoryId && !categories.some((c) => c.id === categoryId) && (
                  <option value={categoryId}>Unavailable category ({categoryId})</option>
                )}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.status === "INACTIVE" ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {product && (
              <label>
                Product status
                <select value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)}>
                  <option>ACTIVE</option>
                  <option>INACTIVE</option>
                </select>
              </label>
            )}
            <label className="wide">
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="actions">
            <button type="submit">{busy ? "Saving…" : "Save product"}</button>
            <button className="subtle" type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
