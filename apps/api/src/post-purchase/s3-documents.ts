import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { OrderDocumentStore } from "./documents.js";
import { AppError } from "../errors/app-error.js";
const maximumBytes = 2 * 1024 * 1024;
export class S3OrderDocumentStore implements OrderDocumentStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}
  async putIfAbsent(key: string, bytes: Buffer): Promise<void> {
    if (bytes.length > maximumBytes) throw new AppError(503, "Order document exceeds size limit");
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: "application/pdf",
          CacheControl: "private,no-store",
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "$metadata" in error &&
        (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 412
      ))
        throw new AppError(503, "Order document storage unavailable");
    }
  }
  async read(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (
        !response.Body ||
        response.ContentType !== "application/pdf" ||
        (response.ContentLength ?? Infinity) > maximumBytes
      )
        throw new Error();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > maximumBytes) throw new Error("Document exceeds size bound");
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch {
      throw new AppError(503, "Order document unavailable");
    }
  }
}
