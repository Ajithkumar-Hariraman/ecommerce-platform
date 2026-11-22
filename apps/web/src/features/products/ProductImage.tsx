import { useEffect, useState } from "react";
import { storefrontApi } from "../../api/storefront";
import { productsApi } from "../../api/products";

const links = new Map<string, { url: string; expiresAt: string }>();
const maxCachedLinks = 250;

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
  const key = JSON.stringify([publicRead, id, generation]);
  const [loaded, setLoaded] = useState<{ key: string; url: string; fromCache: boolean }>();
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    const cached = links.get(key);
    if (cached && Date.parse(cached.expiresAt) > Date.now() + 5000) {
      setLoaded({ key, url: cached.url, fromCache: true });
      return;
    }
    links.delete(key);
    void (publicRead ? storefrontApi : productsApi)
      .imageUrl(id)
      .then((result) => {
        if (!active) return;
        if (links.size >= maxCachedLinks) {
          const oldest = links.keys().next().value;
          if (oldest !== undefined) links.delete(oldest);
        }
        links.set(key, result);
        setLoaded({ key, url: result.url, fromCache: false });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [id, key, publicRead, revision]);

  if (failed && !publicRead) return <small className="muted">Image unavailable</small>;
  if (loaded?.key !== key) return null;
  return (
    <img
      src={loaded.url}
      alt={name}
      width={large ? 480 : 48}
      height={large ? 480 : 48}
      loading="lazy"
      onError={() => {
        links.delete(key);
        setLoaded(undefined);
        if (loaded.fromCache) setRevision((current) => current + 1);
        else setFailed(true);
      }}
      style={{ objectFit: "contain" }}
    />
  );
}
