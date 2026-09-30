export type ProductImportStatus = "ACTIVE" | "INACTIVE";

export interface ProductImportInput {
  sku: string;
  name: string;
  description: string | null;
  priceInMinorUnits: number;
  stock: number;
  status: ProductImportStatus;
  categoryId: string | null;
}

export interface ProductImportFailure {
  row: number;
  sku: string | null;
  message: string;
}

export interface ProductImportResult {
  totalRows: number;
  imported: number;
  failed: number;
  failures: ProductImportFailure[];
  failuresTruncated: boolean;
}
