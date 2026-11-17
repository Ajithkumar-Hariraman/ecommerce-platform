import { localCatalogImageUrl } from "./local-catalog-image.js";
import { AppError } from "../../errors/app-error.js";
import type { ProductService } from "./product.service.js";
import type { ProductImageStore, ImageUploadInput } from "./product-image.js";
export class ProductImageService {
  constructor(
    private readonly products: ProductService,
    private readonly store?: ProductImageStore,
  ) {}
  private images() {
    if (!this.store) throw new AppError(503, "Product images are not configured");
    return this.store;
  }
  async createUpload(id: string, input: ImageUploadInput) {
    await this.products.findById(id);
    return this.images().createUpload(id, input);
  }
  async complete(id: string, objectName: string) {
    await this.products.findById(id);
    const image = await this.images().validate(id, objectName);
    return this.products.setImage(id, image);
  }
  async readUrl(id: string) {
    const product = await this.products.findById(id);
    if (!product.image) throw new AppError(404, "Product image not found");
    if (product.image.bucket === "local-catalog") return {
      url: localCatalogImageUrl(product.image), expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    return this.images().readUrl(product.image);
  }
}
