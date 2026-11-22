import { Router } from "express";
import { Readable } from "node:stream";
import { z } from "zod";
import type { OrderDocumentService } from "./documents.js";
import type { PostPurchaseRepository } from "./repository.js";
import { AppError } from "../errors/app-error.js";
import { orderPrincipal } from "../modules/orders/order-access.js";
export function postPurchaseOrderRouter(documents: OrderDocumentService) {
  const router = Router();
  for (const kind of ["invoice", "receipt"] as const)
    router.get(`/:id/${kind}`, async (req, res) => {
      const id = z.uuid().safeParse(req.params.id);
      if (!id.success) throw new AppError(400, "Invalid Order ID");
      const bytes = await documents.forOwner(id.data, kind, orderPrincipal(res.locals.principal));
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${kind}-${id.data.slice(0, 8)}.pdf"`,
        "Cache-Control": "private,no-store",
        "X-Content-Type-Options": "nosniff",
      });
      Readable.from(bytes).pipe(res);
    });
  return router;
}
export function notificationRouter(repo: PostPurchaseRepository) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private,no-store");
    next();
  });
  router.patch("/:id/read", async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new AppError(400, "Invalid notification ID");
    if (!(await repo.markRead(orderPrincipal(res.locals.principal).subject, id.data.toLowerCase())))
      throw new AppError(404, "Notification not found");
    res.sendStatus(204);
  });
  router.get("/", async (req, res) => {
    const q = z
      .strictObject({
        page: z
          .string()
          .regex(/^[0-9]+$/)
          .optional(),
        limit: z
          .string()
          .regex(/^[0-9]+$/)
          .optional(),
      })
      .safeParse(req.query);
    if (!q.success) throw new AppError(400, "Invalid notification query");
    const page = Number(q.data.page ?? 1),
      limit = Number(q.data.limit ?? 20),
      offset = (page - 1) * limit;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset + limit)
    )
      throw new AppError(400, "Invalid notification pagination");
    const { notifications, total, unreadCount } = await repo.list(
      orderPrincipal(res.locals.principal).subject,
      offset,
      limit,
    );
    res.json({
      notifications,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1 && total > 0,
      },
    });
  });
  return router;
}
