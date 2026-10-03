import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: { message: error.message } });
    return;
  }
  // Recognize JSON parser errors without returning the submitted body or message.
  if (error instanceof Error && "type" in error) {
    if (error.type === "entity.parse.failed") {
      res.status(400).json({ error: { message: "Invalid JSON body" } });
      return;
    }
    if (error.type === "entity.too.large") {
      res.status(413).json({ error: { message: "Request body too large" } });
      return;
    }
  }
  // No query string, request body, headers, or arbitrary thrown objects in logs.
  console.error("Unexpected request error", {
    method: req.method,
    stack: error instanceof Error ? error.stack : "Non-Error value thrown",
  });
  res.status(500).json({ error: { message: "Internal server error" } });
};
