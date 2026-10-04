import { useEffect, useState } from "react";
import { storefrontApi } from "../../api/storefront";
import { productsApi } from "../../api/products";
export function ProductImage({
  id,
  generation,
  name,
  publicRead = false,
  large = false,
}: {
  id: string;
  generation: string;
  name: string;
  publicRead?: boolean;
  large?: boolean;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    setUrl(undefined);
    void (publicRead ? storefrontApi : productsApi)
      .imageUrl(id)
      .then((result) => {
        if (active) setUrl(result.url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id, generation, publicRead]);
  return url ? (
    <img
      src={url}
      alt={name}
      width={large ? 480 : 48}
      height={large ? 480 : 48}
      loading="lazy"
      onError={() => setUrl(undefined)}
      style={{ objectFit: "contain" }}
    />
  ) : null;
}
