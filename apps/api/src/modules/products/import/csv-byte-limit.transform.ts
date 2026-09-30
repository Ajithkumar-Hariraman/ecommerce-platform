import { Transform } from "node:stream";

import { ProductImportError } from "./product-import.error.js";

export class CsvByteLimitTransform extends Transform {
  private receivedBytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.receivedBytes += chunk.length;

    if (this.receivedBytes > this.maxBytes) {
      callback(new ProductImportError(413, "Product import file is too large"));

      return;
    }

    callback(null, chunk);
  }
}
