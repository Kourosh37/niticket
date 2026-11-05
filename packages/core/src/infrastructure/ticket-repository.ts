import { db, Prisma } from '@niticket/database';

export const ticketSummarySelect = {
  id: true,
  number: true,
  subject: true,
  status: true,
  priority: true,
  version: true,
  creatorId: true,
  departmentId: true,
  assigneeId: true,
  createdAt: true,
  lastActivityAt: true,
  firstResponseAt: true,
  resolvedAt: true,
  reopenCount: true,
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true, image: true } },
  assignee: { select: { id: true, name: true, image: true } },
} satisfies Prisma.TicketSelect;

export const ticketRepository = {
  findForChange: (tx: Prisma.TransactionClient, id: string) =>
    tx.ticket.findUnique({ where: { id } }),
  updateAtVersion: (
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    data: Prisma.TicketUncheckedUpdateManyInput,
  ) =>
    tx.ticket.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 }, lastActivityAt: new Date() },
    }),
  detail: (id: string) => db.ticket.findUnique({ where: { id }, select: ticketSummarySelect }),
  list: (where: Prisma.TicketWhereInput, limit: number, cursor?: string) =>
    db.ticket.findMany({
      where,
      select: ticketSummarySelect,
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
};
