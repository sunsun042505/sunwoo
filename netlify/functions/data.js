// Netlify Function: /.netlify/functions/data
// Persistent JSON storage using Netlify Blobs.
// Docs: https://docs.netlify.com/blobs/  (package: @netlify/blobs)

import { getStore } from "@netlify/blobs";

const store = getStore("sunwootakbae");

function json(statusCode, body){
  return {
    statusCode,
    headers: {
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    },
    body: JSON.stringify(body)
  };
}

export default async (req) => {
  try{
    const url = new URL(req.url);
    const method = req.method || "GET";

    if(method === "GET"){
      const key = url.searchParams.get("key");
      if(!key) return json(400, { ok:false, error:"Missing key" });
      const value = await store.get(key, { type: "json" });
      return json(200, { ok:true, key, value: value ?? null });
    }

    if(method === "POST"){
      const { key, value } = JSON.parse(req.body || "{}");
      if(!key) return json(400, { ok:false, error:"Missing key" });
      await store.set(key, value, { type: "json" });
      return json(200, { ok:true, key });
    }

    if(method === "DELETE"){
      const { key } = JSON.parse(req.body || "{}");
      if(!key) return json(400, { ok:false, error:"Missing key" });
      await store.delete(key);
      return json(200, { ok:true, key });
    }

    return json(405, { ok:false, error:"Method not allowed" });
  }catch(e){
    return json(500, { ok:false, error: String(e?.message || e) });
  }
};
