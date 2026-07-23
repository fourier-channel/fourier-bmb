const axios = require("axios");

// fourier-spectrum rating label -> Danbooru rating letter.
const RATING_LETTER = {
  general: "g",
  sensitive: "s",
  questionable: "q",
  explicit: "e",
};

// Autotag an in-flight image buffer via fourier-spectrum (the DERIVED tag
// bucket). One call out with the bytes, one call back with tags -- the tagger
// holds no media. Returns booru-ready { tags: [name...], rating: 'g'|'s'|'q'|'e'
// | null }. Throws on transport/HTTP error so the caller can decide to fail-soft.
async function autotag(buffer, config) {
  const at = (config && config.autotagger) || {};
  const base = String(at.url || "").replace(/\/$/, "");
  if (!base) throw new Error("autotagger.url not configured");

  const resp = await axios.post(`${base}/tag`, buffer, {
    headers: { "Content-Type": "application/octet-stream" },
    params: {
      general_threshold: at.general_threshold ?? 0.35,
      character_threshold: at.character_threshold ?? 0.75,
    },
    timeout: at.timeout_ms ?? 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  const { rating = {}, general = {}, characters = {} } = resp.data || {};
  const top = Object.entries(rating).sort((a, b) => b[1] - a[1])[0];
  return {
    tags: [...Object.keys(general), ...Object.keys(characters)],
    rating: (top && RATING_LETTER[top[0]]) || null,
  };
}

module.exports = { autotag };
