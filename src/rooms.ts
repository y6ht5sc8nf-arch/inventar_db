import type { Env } from "./env";
import { HttpError, int, json, readJson, text, uuid, now } from "./http";

interface RoomRow { id: string; name: string; sort: number; items: number }
interface ContainerRow { id: string; room_id: string; name: string; note: string | null; items: number }

export async function listRooms(env: Env): Promise<Response> {
  const [rooms, containers] = await env.DB.batch([
    env.DB.prepare(
      `SELECT r.id, r.name, r.sort, (SELECT COUNT(*) FROM items i WHERE i.room_id = r.id) AS items
       FROM rooms r ORDER BY r.sort, r.name`,
    ),
    env.DB.prepare(
      `SELECT c.id, c.room_id, c.name, c.note, (SELECT COUNT(*) FROM items i WHERE i.container_id = c.id) AS items
       FROM containers c ORDER BY c.name`,
    ),
  ]);
  const byRoom = new Map<string, ContainerRow[]>();
  for (const c of containers.results as unknown as ContainerRow[]) {
    const list = byRoom.get(c.room_id) ?? [];
    list.push(c);
    byRoom.set(c.room_id, list);
  }
  return json({
    rooms: (rooms.results as unknown as RoomRow[]).map((r) => ({ ...r, containers: byRoom.get(r.id) ?? [] })),
  });
}

// Anlegen ist idempotent (gleiche ID aus der Offline-Warteschlange = kein Duplikat).
export async function createRoom(req: Request, env: Env): Promise<Response> {
  const b = await readJson(req);
  const id = uuid(b.id);
  const name = text(b.name, "Name", 80, true)!;
  const sort = int(b.sort, "Reihenfolge", 0, 10000, 100);
  await env.DB.prepare(`INSERT INTO rooms (id, name, sort) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .bind(id, name, sort)
    .run();
  return json({ id }, 201);
}

export async function updateRoom(req: Request, env: Env, id: string): Promise<Response> {
  const b = await readJson(req);
  const name = b.name !== undefined ? text(b.name, "Name", 80, true) : null;
  const sort = b.sort !== undefined ? int(b.sort, "Reihenfolge", 0, 10000, 100) : null;
  const r = await env.DB.prepare(`UPDATE rooms SET name = COALESCE(?, name), sort = COALESCE(?, sort) WHERE id = ?`)
    .bind(name, sort, uuid(id))
    .run();
  if (!r.meta.changes) throw new HttpError(404, "Raum nicht gefunden");
  return json({ id });
}

export async function deleteRoom(env: Env, id: string): Promise<Response> {
  // Gegenstände bleiben erhalten und verlieren nur die Raumzuordnung (ON DELETE SET NULL).
  const rid = uuid(id);
  await env.DB.batch([
    env.DB.prepare(`UPDATE items SET room_id = NULL, container_id = NULL, updated_at = ? WHERE room_id = ?`).bind(now(), rid),
    env.DB.prepare(`DELETE FROM rooms WHERE id = ?`).bind(rid),
  ]);
  return json({ ok: true });
}

export async function createContainer(req: Request, env: Env): Promise<Response> {
  const b = await readJson(req);
  const id = uuid(b.id);
  const roomId = uuid(b.room_id, "Raum");
  const name = text(b.name, "Name", 80, true)!;
  const note = text(b.note, "Notiz", 500);
  const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(roomId).first();
  if (!room) throw new HttpError(404, "Raum nicht gefunden");
  await env.DB.prepare(`INSERT INTO containers (id, room_id, name, note) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .bind(id, roomId, name, note)
    .run();
  return json({ id }, 201);
}

export async function updateContainer(req: Request, env: Env, id: string): Promise<Response> {
  const b = await readJson(req);
  const cid = uuid(id);
  const name = b.name !== undefined ? text(b.name, "Name", 80, true) : null;
  const note = b.note !== undefined ? text(b.note, "Notiz", 500) ?? "" : null;
  const roomId = b.room_id !== undefined ? uuid(b.room_id, "Raum") : null;
  if (roomId && !(await env.DB.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(roomId).first())) {
    throw new HttpError(404, "Raum nicht gefunden");
  }
  const stmts = [
    env.DB.prepare(
      `UPDATE containers SET name = COALESCE(?, name), note = CASE WHEN ? IS NULL THEN note ELSE NULLIF(?, '') END,
         room_id = COALESCE(?, room_id) WHERE id = ?`,
    ).bind(name, note, note, roomId, cid),
  ];
  // Beim Verschieben eines Behälters wandern seine Gegenstände mit.
  if (roomId) {
    stmts.push(env.DB.prepare(`UPDATE items SET room_id = ?, updated_at = ? WHERE container_id = ?`).bind(roomId, now(), cid));
  }
  const [r] = await env.DB.batch(stmts);
  if (!r.meta.changes) throw new HttpError(404, "Behälter nicht gefunden");
  return json({ id: cid });
}

export async function deleteContainer(env: Env, id: string): Promise<Response> {
  await env.DB.prepare(`DELETE FROM containers WHERE id = ?`).bind(uuid(id)).run();
  return json({ ok: true });
}
