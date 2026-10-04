import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { addCartItem, parseCart, removePurchased, type CartItem } from "./cart";
import type { Product } from "../features/products/product.types";
const key = "commerce.cart.v1";
type CartContext = {
  items: CartItem[];
  add: (product: Product) => void;
  quantity: (id: string, value: number) => void;
  remove: (id: string) => void;
  purchased: (items: { productId: string; quantity: number }[]) => void;
};
const Context = createContext<CartContext | null>(null);
export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      return parseCart(localStorage.getItem(key));
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {
      /* Cart still works when browser storage is unavailable. */
    }
  }, [items]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key) setItems(parseCart(event.newValue));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  return (
    <Context.Provider
      value={{
        items,
        add: (product) =>
          setItems((cart) =>
            addCartItem(cart, {
              productId: product.id,
              name: product.name,
              priceInMinorUnits: product.priceInMinorUnits,
              ...(product.image ? { imageGeneration: product.image.generation } : {}),
            }),
          ),
        quantity: (id, value) => {
          if (Number.isInteger(value) && value >= 1 && value <= 99)
            setItems((cart) =>
              cart.map((item) => (item.productId === id ? { ...item, quantity: value } : item)),
            );
        },
        remove: (id) => setItems((cart) => cart.filter((item) => item.productId !== id)),
        purchased: (purchased) => setItems((cart) => removePurchased(cart, purchased)),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCart() {
  const value = useContext(Context);
  if (!value) throw new Error("Cart provider required");
  return value;
}
