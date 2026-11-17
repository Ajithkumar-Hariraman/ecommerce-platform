import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SmtpEmailSender } from "../../apps/api/dist/post-purchase/email.js";
const subject = "local-audit-" + randomUUID();
const sender = new SmtpEmailSender({
  host: "127.0.0.1",
  port: 1025,
  from: "audit@example.invalid",
  user: "",
  password: "",
});
try {
  await sender.send({
    to: "audit@example.invalid",
    subject,
    text: "Local transport smoke only",
    html: "<p>Local transport smoke only</p>",
    messageId: `<${subject}@example.invalid>`,
    attachments: [],
  });
  const response = await fetch("http://127.0.0.1:8025/api/v1/messages");
  assert(response.ok);
  const body = await response.json();
  const message = body.messages.find((m) => m.Subject === subject);
  assert(message);
  assert(
    (
      await fetch("http://127.0.0.1:8025/api/v1/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: [message.ID] }),
      })
    ).ok,
  );
  console.log("PASS application SMTP adapter -> local Mailpit; owned message removed");
} finally {
  sender.close();
}
