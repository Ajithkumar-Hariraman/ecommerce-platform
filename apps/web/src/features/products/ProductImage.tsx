import { useEffect, useState } from "react";
import { productsApi } from "../../api/products";
export function ProductImage({
  id,
  generation,
  name,
}: {
  id: string;
  generation: string;
  name: string;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    setUrl(undefined);
    void productsApi
      .imageUrl(id)
      .then((result) => {
        if (active) setUrl(result.url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id, generation]);
  return url ? (
    <img
      src={url}
      alt={name}
      width={48}
      height={48}
      loading="lazy"
      style={{ objectFit: "contain" }}
    />
  ) : null;
}
