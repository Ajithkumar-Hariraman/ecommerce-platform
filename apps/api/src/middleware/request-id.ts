import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
export const requestId: RequestHandler = (req, res, next) => {
  const supplied = req.get("X-Request-ID");
  const id = supplied && /^[A-Za-z0-9._-]{1,128}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader("X-Request-ID", id);
  requestContext.run({ requestId: id }, () => {
    res.on("finish", () =>
      console.info({
        operation: "http-request",
        requestId: id,
        method: req.method,
        status: res.statusCode,
      }),
    );
    next();
  });
};
