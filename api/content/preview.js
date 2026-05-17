/* =========================================================
   QUANTSIGNAL AI — /api/content/preview

   Returns a JSON preview of a generated post for one of the supported
   types: market_update | signal_idea | coin_focus | ai_radar.

   No Telegram API calls. No secrets required. Safe to call from the
   admin UI and from local tooling.

   Query parameters:
     ?type=<post_type>       default: market_update
     ?symbol=<BTC|ETH|...>   optional hero symbol (defaults pick by mover)

   Response shape:
     {
       ok: true,
       type, symbol, headline, caption_html,
       image_svg_base64, image_data_url, image_content_type,
       image_path,                 // canonical label JPEG path for sendPhoto
       snapshot: [...rows],
       mood, confidence, risk,
       warnings: [...]
     }
   ========================================================= */
"use strict";

const path = require("path");
const fs = require("fs");

const engine = require("../_lib/content-engine");
const brandImg = require("../_lib/brand-image");
const http = require("../_lib/http");

const LABEL_BANNER_RELPATH = "assets/telegram/quantsignal-label.jpeg";
const LABEL_BANNER_CONTENT_TYPE = "image/jpeg";

function parseQuery(req) {
  try {
    const u = new URL(req.url, "http://x");
    return {
      type: (u.searchParams.get("type") || "market_update").toLowerCase(),
      symbol: (u.searchParams.get("symbol") || "").toUpperCase() || null
    };
  } catch (_) {
    return { type: "market_update", symbol: null };
  }
}

module.exports = async function handler(req, res) {
  http.applyCors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method !== "GET" && req.method !== "POST") {
    http.sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const q = parseQuery(req);
  if (engine.TYPES.indexOf(q.type) < 0) {
    http.sendJson(res, 400, {
      ok: false,
      error: "invalid_type",
      allowed: engine.TYPES
    });
    return;
  }

  let plan;
  try {
    plan = await engine.planForType(q.type, { symbol: q.symbol });
  } catch (e) {
    http.sendJson(res, 502, {
      ok: false,
      error: "content_engine_failed",
      detail: String(e && e.message || e)
    });
    return;
  }

  let img;
  try {
    img = brandImg.renderForPlan(plan);
  } catch (e) {
    http.sendJson(res, 500, {
      ok: false,
      error: "image_render_failed",
      detail: String(e && e.message || e)
    });
    return;
  }

  // The canonical label JPEG is what api/channel/post.js actually
  // uploads to Telegram. Expose it here so the admin UI can show what
  // Telegram subscribers would receive even though the live preview
  // image is the programmatic SVG.
  let labelB64 = null;
  try {
    const abs = path.join(__dirname, "..", "..", LABEL_BANNER_RELPATH);
    if (fs.existsSync(abs)) {
      labelB64 = fs.readFileSync(abs).toString("base64");
    }
  } catch (_) { /* non-fatal */ }

  http.sendJson(res, 200, {
    ok: true,
    type: plan.type,
    symbol: plan.symbol,
    headline: plan.headline,
    caption_html: plan.caption_html,
    image_svg_base64: img.svg_base64,
    image_data_url: img.data_url,
    image_content_type: img.content_type,
    image_path: "/" + LABEL_BANNER_RELPATH,
    label_image_base64: labelB64,
    label_image_content_type: LABEL_BANNER_CONTENT_TYPE,
    snapshot: plan.snapshot,
    mood: plan.mood,
    confidence: plan.confidence,
    risk: plan.risk,
    hero: plan.hero,
    brand: plan.brand,
    bot_url: plan.bot_url,
    warnings: plan.warnings
  });
};
