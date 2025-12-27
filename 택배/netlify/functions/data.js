import { getStore } from "@netlify/blobs";

const j = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const nowStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

async function listReservations(store) {
  const { blobs } = await store.list({ prefix: "res:" });
  const out = [];
  for (const b of blobs) {
    const s = await store.get(b.key);
    if (s) out.push(JSON.parse(s));
  }
  out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return out;
}

async function getByReserve(store, reserveNo) {
  const s = await store.get(`res:${reserveNo}`);
  return s ? JSON.parse(s) : null;
}

async function getByWaybill(store, waybillNo) {
  const reserveNo = await store.get(`wb:${waybillNo}`);
  if (!reserveNo) return null;
  return getByReserve(store, reserveNo);
}

async function upsertReservation(store, rec) {
  rec.updatedAt = nowStr();
  await store.set(`res:${rec.reserveNo}`, JSON.stringify(rec));
  if (rec.waybillNo) await store.set(`wb:${rec.waybillNo}`, rec.reserveNo);
  return rec;
}

// ✅ Netlify Functions v2: Request -> Response
export default async (request) => {
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // store 생성: 문서 예시대로 object 옵션 가능 (name/consistency) :contentReference[oaicite:1]{index=1}
    const store = getStore({ name: "sunwoo-takbae-v1", consistency: "strong" });

    // /.netlify/functions/data/<...> 로 들어오는 걸 기준으로 path 추출
    const base = "/.netlify/functions/data";
    let path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
    if (!path.startsWith("/")) path = "/" + path;
    path = path.replace(/\/+$/, "") || "/";

    // ---- Reservations ----
    if (method === "GET" && path === "/reservations") {
      return j(200, await listReservations(store));
    }

    if (method === "GET" && path.startsWith("/reservations/byReserve/")) {
      const reserveNo = decodeURIComponent(path.replace("/reservations/byReserve/", ""));
      const rec = await getByReserve(store, reserveNo);
      return rec ? j(200, rec) : j(404, { error: "NOT_FOUND" });
    }

    if (method === "GET" && path.startsWith("/reservations/byWaybill/")) {
      const waybillNo = decodeURIComponent(path.replace("/reservations/byWaybill/", ""));
      const rec = await getByWaybill(store, waybillNo);
      return rec ? j(200, rec) : j(404, { error: "NOT_FOUND" });
    }

    if (method === "POST" && path === "/reservations/upsert") {
      const rec = await request.json();
      if (!rec?.reserveNo) return j(400, { error: "reserveNo required" });
      const saved = await upsertReservation(store, rec);
      return j(200, { ok: true, rec: saved });
    }

    // ---- Stores ----
    if (method === "POST" && path === "/stores/register") {
      const body = await request.json();
      const name = String(body?.name || "").trim();
      const code = String(body?.code || "").trim();
      if (!name || !code) return j(400, { error: "name/code required" });

      const exist = await store.get(`store:${code}`);
      if (exist) return j(409, { error: "DUPLICATE_CODE" });

      await store.set(`store:${code}`, JSON.stringify({ name, code, createdAt: nowStr() }));
      return j(200, { ok: true });
    }

    if (method === "POST" && path === "/stores/login") {
      const body = await request.json();
      const name = String(body?.name || "").trim();
      const code = String(body?.code || "").trim();

      const s = await store.get(`store:${code}`);
      if (!s) return j(404, { error: "NO_STORE" });
      const obj = JSON.parse(s);
      if (obj.name !== name) return j(404, { error: "NO_STORE" });

      return j(200, { ok: true, store: obj });
    }

    // ---- Couriers ----
    if (method === "POST" && path === "/couriers/register") {
      const body = await request.json();
      const name = String(body?.name || "").trim();
      const phone = String(body?.phone || "").trim();
      const code = String(body?.code || "").trim();
      if (!name || !phone || !code) return j(400, { error: "name/phone/code required" });

      const exist = await store.get(`courier:${code}`);
      if (exist) return j(409, { error: "DUPLICATE_CODE" });

      await store.set(`courier:${code}`, JSON.stringify({ name, phone, code, createdAt: nowStr() }));
      return j(200, { ok: true });
    }

    if (method === "POST" && path === "/couriers/login") {
      const body = await request.json();
      const code = String(body?.code || "").trim();

      const s = await store.get(`courier:${code}`);
      if (!s) return j(404, { error: "NO_COURIER" });

      return j(200, { ok: true, courier: JSON.parse(s) });
    }

    return j(404, { error: "NO_ROUTE", method, path });
  } catch (e) {
    return j(500, { error: "SERVER_ERROR", detail: String(e?.message || e) });
  }
};
