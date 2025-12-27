import { getStore } from "@netlify/blobs";

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// key 규칙
// 예약: res:<reserveNo>  -> { ...rec }
// 운송장 인덱스: wb:<waybillNo> -> reserveNo
// 점포: store:<code> -> {name, code, createdAt}
// 기사: courier:<code> -> {name, phone, code, createdAt}

async function listReservations(store) {
  const { blobs } = await store.list({ prefix: "res:" });
  const out = [];
  for (const b of blobs) {
    const s = await store.get(b.key, { consistency: "strong" });
    if (s) out.push(JSON.parse(s));
  }
  out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return out;
}

async function getByReserve(store, reserveNo) {
  const s = await store.get(`res:${reserveNo}`, { consistency: "strong" });
  return s ? JSON.parse(s) : null;
}

async function getByWaybill(store, waybillNo) {
  const reserveNo = await store.get(`wb:${waybillNo}`, { consistency: "strong" });
  if (!reserveNo) return null;
  return getByReserve(store, reserveNo);
}

async function upsertReservation(store, rec) {
  rec.updatedAt = nowStr();
  await store.set(`res:${rec.reserveNo}`, JSON.stringify(rec));
  if (rec.waybillNo) {
    await store.set(`wb:${rec.waybillNo}`, rec.reserveNo);
  }
  return rec;
}

// ✅ Netlify Functions v2: Request/Response 형태로 export default
export default async (request) => {
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // /api/*  -> /.netlify/functions/data/:splat
    // 여기서는 /data/ 뒤의 경로를 뽑아냄
    const base = "/.netlify/functions/data";
    let path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
    if (!path.startsWith("/")) path = "/" + path;
    path = path.replace(/\/+$/, "") || "/";

    // store 준비 (강일관으로)
    const store = getStore("sunwoo-takbae-v1");


    // ---- Reservations ----
    if (method === "GET" && path === "/reservations") {
      return json(200, await listReservations(store));
    }

    if (method === "GET" && path.startsWith("/reservations/byReserve/")) {
      const reserveNo = decodeURIComponent(path.replace("/reservations/byReserve/", ""));
      const rec = await getByReserve(store, reserveNo);
      if (!rec) return json(404, { error: "NOT_FOUND" });
      return json(200, rec);
    }

    if (method === "GET" && path.startsWith("/reservations/byWaybill/")) {
      const waybillNo = decodeURIComponent(path.replace("/reservations/byWaybill/", ""));
      const rec = await getByWaybill(store, waybillNo);
      if (!rec) return json(404, { error: "NOT_FOUND" });
      return json(200, rec);
    }

    if (method === "POST" && path === "/reservations/upsert") {
      const rec = await request.json();
      if (!rec?.reserveNo) return json(400, { error: "reserveNo required" });
      const saved = await upsertReservation(store, rec);
      return json(200, { ok: true, rec: saved });
    }

    // ---- Stores ----
    if (method === "POST" && path === "/stores/register") {
      const body = await request.json();
      const name = String(body?.name || "").trim();
      const code = String(body?.code || "").trim();
      if (!name || !code) return json(400, { error: "name/code required" });

      const exist = await store.get(`store:${code}`, { consistency: "strong" });
      if (exist) return json(409, { error: "DUPLICATE_CODE" });

      await store.set(`store:${code}`, JSON.stringify({ name, code, createdAt: nowStr() }));
      return json(200, { ok: true });
    }

    if (method === "POST" && path === "/stores/login") {
      const body = await request.json();
      const name = String(body?.name || "").trim();
      const code = String(body?.code || "").trim();

      const s = await store.get(`store:${code}`, { consistency: "strong" });
      if (!s) return json(404, { error: "NO_STORE" });
      const obj = JSON.parse(s);
      if (obj.name !== name) return json(404, { error: "NO_STORE" });

      return json(200, { ok: true, store: obj });
    }

    // ---- Couriers ----
    if (method === "POST" && path === "/couriers/register") {
      const body = await request.json();
      const name = String(body?.name || "").trim();
      const phone = String(body?.phone || "").trim();
      const code = String(body?.code || "").trim();
      if (!name || !phone || !code) return json(400, { error: "name/phone/code required" });

      const exist = await store.get(`courier:${code}`, { consistency: "strong" });
      if (exist) return json(409, { error: "DUPLICATE_CODE" });

      await store.set(
        `courier:${code}`,
        JSON.stringify({ name, phone, code, createdAt: nowStr() })
      );
      return json(200, { ok: true });
    }

    if (method === "POST" && path === "/couriers/login") {
      const body = await request.json();
      const code = String(body?.code || "").trim();

      const s = await store.get(`courier:${code}`, { consistency: "strong" });
      if (!s) return json(404, { error: "NO_COURIER" });

      return json(200, { ok: true, courier: JSON.parse(s) });
    }

    return json(404, { error: "NO_ROUTE", method, path });
  } catch (e) {
    return json(500, { error: "SERVER_ERROR", detail: String(e?.message || e) });
  }
};