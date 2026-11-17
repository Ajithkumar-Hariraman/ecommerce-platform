import { Link } from "react-router-dom";
import type { OrderStatus } from "../../api/orders";
export function SimulatorActions({
  status,
  busy,
  onOutcome,
}: {
  status: OrderStatus;
  busy: boolean;
  onOutcome: (outcome: "succeed" | "fail") => void;
}) {
  if (status === "PAYMENT_FAILED")
    return (
      <p>
        This simulated payment failed. Your order is saved in My Orders.{" "}
        <Link to="/cart">Return to cart</Link> to start another order.
      </p>
    );
  if (status !== "PAYMENT_PENDING") return null;
  return (
    <div aria-label="Local simulator">
      <p>Choose the outcome for this saved order. No money is charged.</p>
      <button disabled={busy} onClick={() => onOutcome("succeed")}>
        Simulate successful payment
      </button>
      <button className="subtle" disabled={busy} onClick={() => onOutcome("fail")}>
        Simulate failed payment
      </button>
    </div>
  );
}
