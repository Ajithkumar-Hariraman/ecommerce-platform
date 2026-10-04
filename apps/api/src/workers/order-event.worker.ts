import { createOrderDocuments } from "../post-purchase/runtime.js";
import { PostPurchaseNotificationProcessor, SmtpEmailSender } from "../post-purchase/email.js";
import { loadPostPurchaseConfig } from "../config/env.js";
import { installStructuredLogging } from "../logging.js";
import { createBusinessResources } from "../database/business.js";
import { createConsumerRuntime } from "../events/event-runtime.js";

installStructuredLogging();

async function main(): Promise<void> {
  const business = await createBusinessResources();
  const emailConfig = loadPostPurchaseConfig(),
    sender = new SmtpEmailSender(emailConfig);
  const notifications = new PostPurchaseNotificationProcessor(
    business.notifications,
    business.orders,
    business.postPurchase,
    createOrderDocuments(business.orders, business.postPurchase),
    sender,
    emailConfig.merchant,
  );
  let worker: Awaited<ReturnType<typeof createConsumerRuntime>> | undefined;
  let closing = false;
  const shutdown = async (failed = false) => {
    if (closing) return;
    closing = true;
    if (failed) process.exitCode = 1;
    const deadline = setTimeout(() => {
      console.error("Worker shutdown deadline exceeded");
      process.exit(1);
    }, 10000);
    try {
      await worker?.close();
    } catch {
      process.exitCode = 1;
    } finally {
      sender.close();
      await Promise.allSettled([business.close()]);
      clearTimeout(deadline);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      console.info("Order worker resources closed.");
    }
  };
  const stop = () => {
    void shutdown();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await business.ready();
    worker = await createConsumerRuntime(notifications, () => {
      void shutdown(true);
    });
    if (closing) {
      await worker.close();
      return;
    }
    console.info({
      operation: "Order worker started",
      consumerGroup: worker.identity,
    });
  } catch {
    console.error("Order worker startup failed");
    await shutdown(true);
  }
}
void main().catch(() => {
  console.error("Order worker configuration failed");
  process.exitCode = 1;
});
