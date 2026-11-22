import { useState, type FormEvent } from "react";
import { productsApi, type ProductImportResult } from "../../api/products";
import { errorMessage } from "../../api/http";

export function ProductImport({ onFinished }: { onFinished: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProductImportResult>();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("csv");
    if (!(file instanceof File) || file.size === 0 || file.size > 25 * 1024 * 1024) {
      setError("Choose a nonempty CSV file up to 25 MB.");
      return;
    }
    setBusy(true);
    setResult(undefined);
    setError("");
    try {
      setResult(await productsApi.importCsv(file));
      form.reset();
    } catch (error) {
      setError(
        errorMessage(error) +
          " Some rows may already have been imported. Check the catalog before retrying.",
      );
    } finally {
      setBusy(false);
      onFinished();
    }
  }

  return (
    <details className="disclosure">
      <summary>Import products from CSV</summary>
      <p>Required columns are sku, name, priceInMinorUnits and stock. Prices use paise.</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Product CSV <input type="file" name="csv" accept=".csv,text/csv" required />
          </label>
          <button type="submit">{busy ? "Importing…" : "Import CSV"}</button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <>
          <p role="status" className="notice">
            {result.imported} imported · {result.failed} failed
          </p>
          {result.failures.length > 0 && (
            <ul>
              {result.failures.map((failure) => (
                <li key={failure.row}>
                  Row {failure.row}
                  {failure.sku && ` (${failure.sku})`} — {failure.message}
                </li>
              ))}
            </ul>
          )}
          {result.failuresTruncated && (
            <p>Only the first {result.failures.length} errors are shown.</p>
          )}
        </>
      )}
    </details>
  );
}
