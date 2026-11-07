// Page helper for MarkGram.
(() => {
  const port = browser.runtime.connectNative("markgram");
  const log = (text) => port.postMessage({ type: "log", text });

  // ---- Debug: describe elements, so cleanup rules can be written against the real page ----
  const describe = (el) => {
    const a = [el.tagName.toLowerCase()];
    for (const n of ["id", "class", "role", "aria-label", "href"]) {
      const v = el.getAttribute && el.getAttribute(n);
      if (v) a.push(n + "=" + JSON.stringify(v.slice(0, 60)));
    }
    const r = el.getBoundingClientRect();
    a.push("@" + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height));
    return a.join(" ");
  };
  function find(text) {
    const re = new RegExp(text, "i");
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      const label = el.getAttribute("aria-label") || "";
      if ((own && re.test(own)) || (label && re.test(label))) hits.push(el);
      if (hits.length >= (window.__mgMax || 4)) break;
    }
    log("find '" + text + "': " + hits.length + " hits on " + location.href);
    hits.forEach((el, i) => {
      const chain = [];
      for (let e = el; e && e !== document.body && chain.length < 14; e = e.parentElement) chain.push(describe(e));
      log("#" + i + " text=" + JSON.stringify((el.textContent || "").slice(0, 80)) + "\n  " + chain.join("\n  "));
    });
  }
  function html(sel, max) {
    const el = document.querySelector(sel);
    log("html " + sel + ": " + (el ? el.outerHTML.slice(0, max || 3000) : "none"));
  }

  // ---- Cleanup: sponsored posts, suggested posts and "use the app" prompts ----
  const AD_LABEL = /^(sponsored|ad|sponzorisano|спонзорисано|reklama|реклама|oglas)$/i;
  const SUGGESTED = /^(suggested for you|suggested posts|suggested reels|predloženo za tebe|predlozeno za tebe|predloženo za vas|предложено за тебе|предложено за вас)$/i;
  const APP_PROMO = /^(open app|open instagram|get the app|use the app|get app|switch to the app|otvori aplikaciju|otvori instagram|preuzmi aplikaciju|koristi aplikaciju|отвори апликацију|отвори instagram|преузми апликацију)$/i;
  // "Suggestions for you" (people to follow) is a carousel between posts, not an <article>.
  const PEOPLE = /^(suggestions for you|predlozi za tebe|predlozi za vas|предлози за тебе|предлози за вас)$/i;
  // The block around a heading: the largest ancestor that still holds no post and is not taller
  // than a carousel. Never anything that contains an <article> (that would be the whole feed).
  const block = (el) => {
    let best = null;
    for (let e = el, i = 0; e && e !== document.body && i < 10; e = e.parentElement, i++) {
      if (e.matches("main, [role=main]") || e.querySelector("article")) break;
      const h = e.getBoundingClientRect().height;
      if (h > 600) break;
      if (h >= 150) best = e;
    }
    return best;
  };
  // The feed is virtualised: Instagram measures every post as it is inserted and positions the
  // rest from those heights. Shrinking a post it has already measured makes it re-correct the
  // scroll position, which threw fast scrolling back by several posts. So a post is collapsed
  // only while it is still below the screen (nothing you see moves); one that is already on or
  // above the screen keeps its size and is only blanked out.
  const hideStyle = document.createElement("style");
  hideStyle.textContent =
    "[data-mg-hidden=collapsed]{height:1px!important;min-height:0!important;max-height:1px!important;"
    + "margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;opacity:0!important;"
    + "pointer-events:none!important}"
    + "[data-mg-hidden=masked]{visibility:hidden!important;pointer-events:none!important}"
    // Ads and the "Suggestions for you" carousel are recognised by their links, so a stylesheet
    // collapses them before Instagram even measures them: no jumping at all.
    + "article:has(a[href*='facebook.com/ads/']),article:has(a[href*='a_mpk=']),"
    + "div[style*='flex-direction: column'] > div:has(a[href='/explore/people/']):not(:has(article))"
    + "{height:1px!important;min-height:0!important;max-height:1px!important;margin:0!important;padding:0!important;"
    + "border:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}";
  (document.head || document.documentElement).appendChild(hideStyle);
  /** Suggested posts: collapsed only while at least a screen below view, otherwise left alone. */
  const hideLater = (el, why) => {
    if (!el || el.dataset.mgHidden || window.__mgOff) return;
    if (el.getBoundingClientRect().top >= innerHeight * 2) {
      el.dataset.mgWhy = why;
      el.dataset.mgHidden = "collapsed";
    }
  };
  const hide = (el, why) => {
    if (!el || el.dataset.mgHidden || window.__mgOff) return;
    el.dataset.mgWhy = why;
    const fixed = why === "promo";
    el.dataset.mgHidden = fixed || el.getBoundingClientRect().top >= innerHeight ? "collapsed" : "masked";
  };
  // "Turn on Notifications" and similar nags: MarkGram never shows notifications, so say no.
  const NAG = /turn on notifications|uključi obaveštenja|укључи обавештења|add instagram to your home screen|get the full experience/i;
  const NOT_NOW = /^(not now|ne sada|не сада|cancel|otkaži|откажи)$/i;
  function dismissNags() {
    for (const d of document.querySelectorAll("div[role=dialog]")) {
      if (!NAG.test(d.textContent)) continue;
      const b = [...d.querySelectorAll("button, div[role=button]")].find((x) => NOT_NOW.test(x.textContent.trim()));
      if (b) b.click();
    }
  }

  // Reels are full-screen pages in a snapping scroller; a sponsored one on screen is skipped by
  // scrolling that scroller one screen further.
  let lastSkip = 0;
  function skipReel(label) {
    const r = label.getBoundingClientRect();
    if (r.height === 0 || r.top < 0 || r.bottom > innerHeight || Date.now() - lastSkip < 1500) return;
    for (let e = label.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 10) {
        lastSkip = Date.now();
        e.scrollBy({ top: e.clientHeight, behavior: "smooth" });
        log("skipped sponsored reel");
        return;
      }
    }
  }

  function check(el) {
    if (el.children.length > 2) return;
    const t = el.textContent.trim();
    if (!t || t.length > 30) return;
    if (AD_LABEL.test(t)) {
      // Feed ads are collapsed by the stylesheet above; here only Reels are skipped.
      if (!el.closest("article") && location.pathname.startsWith("/reels")) skipReel(el);
    } else if (SUGGESTED.test(t)) {
      // Suggested posts are left in place: shrinking them confuses Instagram's scrolling.
    } else if (APP_PROMO.test(t)) {
      // A banner or a dialog asking to open the official app.
      const dialog = el.closest("div[role=dialog]");
      if (dialog) {
        const close = dialog.querySelector('[aria-label="Close" i], [aria-label="Zatvori" i], [aria-label="Затвори" i]');
        if (close) close.click(); else hide(dialog.parentElement || dialog, "promo");
      } else {
        // The "Open app" bar above the tab bar (._acc8): hide the whole bar, not just the
        // button, or a strip with its close "x" stays behind.
        hide(el.closest("._acc8") || el.closest("a, button, div[role=button]") || el, "promo");
      }
    }
  }
  const CANDIDATES = "span, a, button, div[role=button]";
  function clean() {
    dismissNags();
    for (const el of document.querySelectorAll(CANDIDATES)) check(el);
  }
  /** New nodes are checked right away, while Instagram still keeps them below the screen. */
  function scan(n) {
    if (n.nodeType !== 1) return;
    if (n.matches(CANDIDATES)) check(n);
    for (const el of n.querySelectorAll(CANDIDATES)) check(el);
  }
  // Logged out: skip the "Open Instagram / Log in / sign up" landing page and go straight to the
  // login form.
  let landingSkipped = false;
  const LOGIN = /^(log in|prijavi se|пријави се)$/i;
  const SIGNUP = /^(sign up|registruj se|региструј се)$/i;
  function skipLanding() {
    if (landingSkipped || location.pathname !== "/") return false;
    const spans = [...document.querySelectorAll("span, a, button, div[role=button]")];
    const login = spans.find((e) => e.children.length === 0 && LOGIN.test(e.textContent.trim()));
    if (!login || !spans.some((e) => e.children.length === 0 && SIGNUP.test(e.textContent.trim()))) return false;
    landingSkipped = true;
    login.click();
    return true;
  }

  let queued = false;
  new MutationObserver((list) => {
    try {
      for (const m of list) {
        if (m.type === "characterData") { if (m.target.parentElement) check(m.target.parentElement); }
        else for (const n of m.addedNodes) scan(n);
      }
    } catch (e) { }
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; try { if (!skipLanding()) clean(); } catch (e) { } }, 80);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (!skipLanding()) clean();

  // ---- Pull down at the top of the feed to refresh (the website has no pull-to-refresh) ----
  function setupPullToRefresh(isFeed) {
    const PULL = 110, MAX = 170;
    let startY = -1, startX = 0, pulling = false, dist = 0;
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:50%;top:0;z-index:2147483647;width:44px;height:44px;margin-left:-22px;"
      + "border-radius:22px;background:#2b2f36;box-shadow:0 2px 8px rgba(0,0,0,.45);display:none;"
      + "align-items:center;justify-content:center;color:#fff;font:600 22px sans-serif;pointer-events:none;"
      + "transition:opacity .15s;";
    box.textContent = "↻";
    const attach = () => { if (!box.isConnected) (document.body || document.documentElement).appendChild(box); };
    const show = (d) => {
      attach();
      box.style.display = "flex";
      const p = Math.min(d / PULL, 1);
      box.style.transform = "translateY(" + Math.round(Math.min(d, MAX) * 0.6) + "px) rotate(" + Math.round(p * 300) + "deg)";
      box.style.opacity = String(0.35 + p * 0.65);
      box.style.background = p >= 1 ? "#4f8cff" : "#2b2f36";
    };
    const hideBox = () => { box.style.display = "none"; };
    // Something scrolled inside the page (a comment sheet, a carousel) takes priority.
    const innerScrolled = (el) => {
      for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        if (e.scrollTop > 0) return true;
        if (e.getAttribute && (e.getAttribute("role") === "dialog")) return true;
      }
      return false;
    };
    document.addEventListener("touchstart", (e) => {
      pulling = false; dist = 0; startY = -1;
      if (e.touches.length !== 1 || !isFeed() || window.scrollY > 0 || innerScrolled(e.target)) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    }, { passive: true, capture: true });
    document.addEventListener("touchmove", (e) => {
      if (startY < 0) return;
      const dy = e.touches[0].clientY - startY, dx = Math.abs(e.touches[0].clientX - startX);
      if (!pulling) {
        if (window.scrollY > 0 || dx > Math.abs(dy) || dy < -5) { startY = -1; return; }
        if (dy < 15) return;
        pulling = true;
      }
      dist = Math.max(0, dy - 15);
      show(dist);
    }, { passive: true, capture: true });
    const end = () => {
      if (pulling && dist >= PULL) {
        box.style.transition = "none";
        box.style.background = "#4f8cff";
        box.animate([{ transform: box.style.transform }, { transform: box.style.transform + " rotate(720deg)" }],
          { duration: 900, iterations: Infinity });
        location.reload();
      } else {
        hideBox();
      }
      startY = -1; pulling = false; dist = 0;
    };
    document.addEventListener("touchend", end, { passive: true, capture: true });
    document.addEventListener("touchcancel", () => { hideBox(); startY = -1; pulling = false; }, { passive: true, capture: true });
  }

  setupPullToRefresh(() => location.pathname === "/");

  // ---- Download button: saves the photo or video on screen (post, reel or story) ----
  setupDownload();
  // Media Instagram's own page has loaded (photos/videos with their file URLs), keyed by id.
  // Stories play from blob: URLs and their API refuses direct calls, so their file URLs are
  // taken from the page's own responses.
  const seenMedia = new Map();
  function remember(text) {
    if (!text || (text.indexOf("video_versions") < 0 && text.indexOf("image_versions2") < 0)) return;
    const walk = (o, depth) => {
      if (!o || typeof o !== "object" || depth > 40) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      // A user's story reel: { user: {username}, items: [...] }; the items don't name the user.
      if (Array.isArray(o.items) && (o.user || o.id)) {
        for (const it of o.items) {
          if (!it || typeof it !== "object") continue;
          if (o.user && o.user.username) it.__owner = o.user.username;
          if (o.id) it.__reel = String(o.id); // "highlight:123" for highlights
        }
      }
      if ((o.video_versions || o.image_versions2) && (o.pk || o.id)) {
        const key = String(o.pk || o.id).split("_")[0];
        seenMedia.delete(key);
        seenMedia.set(key, o);
        if (seenMedia.size > 600) seenMedia.delete(seenMedia.keys().next().value);
      }
      for (const k in o) if (o[k] && typeof o[k] === "object") walk(o[k], depth + 1);
    };
    for (const line of text.replace(/^for \(;;\);/, "").split("\n")) {
      const t = line.trim();
      if (!t || (t[0] !== "{" && t[0] !== "[")) continue;
      try { walk(JSON.parse(t), 0); } catch (e) { }
    }
  }
  try {
    const W = window.wrappedJSObject;
    const proto = W.XMLHttpRequest.prototype;
    const origSend = proto.send;
    exportFunction(function (body) {
      const xhr = this;
      xhr.addEventListener("load", exportFunction(() => {
        try { if (!xhr.responseType || xhr.responseType === "text") remember(xhr.responseText); } catch (e) { }
      }, W));
      return origSend.call(xhr, body);
    }, proto, { defineAs: "send" });
    const origFetch = W.fetch;
    exportFunction(function (input, init) {
      const p = origFetch.call(W, input, init);
      try {
        const url = String(typeof input === "string" ? input : input && input.url || "");
        if (/graphql|\/api\//.test(url)) {
          p.then(exportFunction((r) => {
            try { r.clone().text().then(exportFunction((t) => { try { remember(t); } catch (e) { } }, W)); } catch (e) { }
          }, W));
        }
      } catch (e) { }
      return p;
    }, W, { defineAs: "fetch" });
  } catch (e) {
    log("media hook failed " + e);
  }

  function setupDownload() {
    const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const mediaId = (code) => {
      let id = 0n;
      for (const c of code.slice(0, 11)) id = id * 64n + BigInt(ABC.indexOf(c));
      return id.toString();
    };
    const CODE_RE = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{6,})/;
    const pageKind = () => {
      const p = location.pathname;
      if (p === "/") return "feed";
      if (/^\/stories\/[^/]+/.test(p)) return "story";
      if (CODE_RE.test(p)) return "post";
      return null;
    };
    // The post nearest the middle of the screen in the feed.
    const centerArticle = () => {
      let best = null, dist = 1e9;
      for (const a of document.querySelectorAll("article")) {
        const r = a.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight || r.height < 50) continue;
        const d = r.top <= innerHeight / 2 && r.bottom >= innerHeight / 2 ? 0 : Math.min(Math.abs(r.top - innerHeight / 2), Math.abs(r.bottom - innerHeight / 2));
        if (d < dist) { dist = d; best = a; }
      }
      return best;
    };
    const codeIn = (el) => {
      for (const a of el.querySelectorAll("a[href]")) {
        const m = CODE_RE.exec(a.getAttribute("href"));
        if (m) return m[1];
      }
      return null;
    };
    // Carousels: the dots under the photos, one of which looks different (the current one).
    const carouselIndex = (root, n) => {
      if (!root) return -1;
      for (const box of root.querySelectorAll("div")) {
        if (box.children.length !== n) continue;
        const kids = [...box.children];
        if (!kids.every((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.width <= 12 && r.height <= 12; })) continue;
        const counts = {};
        for (const k of kids) counts[k.className] = (counts[k.className] || 0) + 1;
        const odd = kids.findIndex((k) => counts[k.className] === 1);
        if (odd >= 0) return odd;
      }
      return -1;
    };
    const best = (item) => {
      if (item.video_versions && item.video_versions.length) {
        const v = item.video_versions.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
        return { url: v.url, video: true };
      }
      const c = item.image_versions2 && item.image_versions2.candidates || [];
      const i = c.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
      return i ? { url: i.url, video: false } : null;
    };

    // The same headers Instagram's own page sends with its API calls.
    const apiHeaders = () => {
      const h = { "X-IG-App-ID": "936619743392459", "X-Requested-With": "XMLHttpRequest", "X-ASBD-ID": "129477" };
      const csrf = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie);
      if (csrf) h["X-CSRFToken"] = csrf[1];
      try { const c = sessionStorage.getItem("www-claim-v2"); if (c) h["X-IG-WWW-Claim"] = c; } catch (e) { }
      return h;
    };
    const api = async (path) => {
      const r = await content.fetch("https://www.instagram.com" + path,
        cloneInto({ credentials: "include", headers: apiHeaders() }, window));
      if (!r.ok) throw new Error("HTTP " + r.status + " " + path);
      return JSON.parse(await r.text());
    };
    // File name of a CDN URL ("…/12345_n.jpg"): the same for every size of one photo or video.
    const fileOf = (u) => { try { return new URL(u, location.href).pathname.split("/").pop(); } catch (e) { return ""; } };
    // Fallback for stories: the video or picture element on screen, when it has a real file URL.
    function storyFromPage() {
      const media = [...document.querySelectorAll("video, img")].map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter((x) => x.r.width > innerWidth * 0.6 && x.r.height > innerHeight * 0.4 && x.r.top < innerHeight && x.r.bottom > 0)
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
      const v = media.find((x) => x.e.tagName === "VIDEO");
      if (v) {
        const src = v.e.currentSrc || v.e.src || (v.e.querySelector("source") || {}).src || "";
        if (src && !src.startsWith("blob:")) return { video_versions: [{ url: src, width: 1 }], pk: "story" + Date.now() };
        return null;
      }
      const im = media.find((x) => x.e.tagName === "IMG");
      if (!im) return null;
      let url = im.e.currentSrc || im.e.src, w = 0;
      for (const part of (im.e.srcset || "").split(",")) {
        const [u, d] = part.trim().split(/\s+/);
        const n = parseInt(d, 10) || 0;
        if (u && n > w) { w = n; url = u; }
      }
      return { image_versions2: { candidates: [{ url, width: w }] }, pk: "story" + Date.now() };
    }
    // Stories: the URL names the user and, once a story has played, its id. The media API
    // answers for an id; otherwise the story is picked from what the page itself loaded for
    // that user (by its file, or by the progress bars). Direct story API calls are refused.
    async function storyItem() {
      const m = /^\/stories\/([^/]+)\/(\d+)?/.exec(location.pathname);
      if (m[1] !== "highlights" && m[2]) {
        try {
          const d = await api("/api/v1/media/" + m[2] + "/info/");
          if (d.items && d.items[0]) return d.items[0];
        } catch (e) { log("story by id: " + e); }
      }
      const own = [...seenMedia.values()].filter((o) => m[1] === "highlights"
        ? o.__reel === "highlight:" + m[2]
        : (o.expiring_at || o.product_type === "story") && ((o.user && o.user.username) || o.__owner) === m[1])
        .sort((a, b) => (a.taken_at || 0) - (b.taken_at || 0));
      return own.length ? pickStory(own) : null;
    }

    // Which of a user's stories is on screen.
    function pickStory(items) {
      // What is on screen: the biggest visible video or picture.
      const media = [...document.querySelectorAll("video, img")].map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter((x) => x.r.width > innerWidth * 0.6 && x.r.height > innerHeight * 0.4)
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
      const names = new Set();
      for (const x of media) {
        const src = x.e.currentSrc || x.e.src || "";
        if (src && !src.startsWith("blob:")) names.add(fileOf(src));
        if (x.e.poster) names.add(fileOf(x.e.poster));
      }
      const hit = items.find((it) => {
        const urls = [...(it.video_versions || []), ...((it.image_versions2 && it.image_versions2.candidates) || [])].map((v) => fileOf(v.url));
        return urls.some((u) => names.has(u));
      });
      if (hit) return hit;
      // Progress bars at the top: one per story; finished ones are full, the current one partly.
      for (const box of document.querySelectorAll("div")) {
        if (box.children.length !== items.length) continue;
        const r = box.getBoundingClientRect();
        if (r.top > innerHeight * 0.25 || r.width < innerWidth * 0.5) continue;
        const kids = [...box.children];
        if (!kids.every((k) => { const kr = k.getBoundingClientRect(); return kr.height > 0 && kr.height <= 6; })) continue;
        const fill = kids.map((k) => {
          const inner = k.querySelector("div");
          return inner ? inner.getBoundingClientRect().width / Math.max(1, k.getBoundingClientRect().width) : 0;
        });
        let i = fill.findIndex((f) => f < 0.99);
        if (i < 0) i = items.length - 1;
        return items[i];
      }
      return items.length === 1 ? items[0] : null;
    }

    const btn = document.createElement("div");
    btn.style.cssText = "position:fixed;right:8px;top:42%;z-index:2147483646;width:42px;height:42px;border-radius:21px;"
      + "background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;"
      + "box-shadow:0 1px 4px rgba(0,0,0,.4);-webkit-tap-highlight-color:transparent;";
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" '
      + 'stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
    for (const t of ["touchstart", "touchend", "pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
      btn.addEventListener(t, (e) => {
        e.stopPropagation();
        if (t === "click") { e.preventDefault(); download(); }
      }, { passive: false });
    }
    let busy = false;
    const flash = (ok) => {
      btn.style.background = ok ? "rgba(46,160,67,.85)" : "rgba(200,50,50,.85)";
      setTimeout(() => { btn.style.background = "rgba(0,0,0,.45)"; }, 900);
    };
    async function download() {
      if (busy) return;
      const kind = pageKind();
      let id = null, code = null, root = null;
      if (kind === "post") {
        code = CODE_RE.exec(location.pathname)[1];
        // Reels: the URL follows the reel on screen. A /p/ page shows one post.
        root = document.querySelector("article") || document.querySelector("main");
      } else if (kind === "feed") {
        root = centerArticle();
        code = root && codeIn(root);
      }
      if (code) id = mediaId(code);
      if (kind !== "story" && !id) { log("download: nothing on screen"); flash(false); return; }
      busy = true;
      btn.style.opacity = "0.6";
      try {
        let item;
        if (kind === "story") {
          try { item = await storyItem(); } catch (e) { log("story api: " + e); }
          if (!item) item = storyFromPage();
          if (!item) throw new Error("story on screen not found");
          code = String(item.pk || item.id || "story").split("_")[0];
        } else {
          const data = await api("/api/v1/media/" + id + "/info/");
          item = data.items && data.items[0];
        }
        if (!item) throw new Error("no item");
        let parts = item.carousel_media && item.carousel_media.length ? item.carousel_media : [item];
        if (parts.length > 1) {
          const i = carouselIndex(root, parts.length);
          if (i >= 0) parts = [parts[i]];
        }
        const files = [];
        parts.forEach((p, i) => {
          const b = best(p);
          if (b) files.push({ url: b.url, video: b.video, name: "markgram_" + code + (parts.length > 1 ? "_" + (i + 1) : "") });
        });
        if (!files.length) throw new Error("no media urls");
        port.postMessage({ type: "download", files });
        log("download " + files.length + " file(s) for " + code);
        flash(true);
      } catch (e) {
        log("download failed " + e);
        flash(false);
      } finally {
        busy = false;
        btn.style.opacity = "1";
      }
    }
    const update = () => {
      const kind = pageKind();
      const show = kind === "post" || kind === "story" || (kind === "feed" && !!centerArticle());
      if (show && !btn.isConnected) document.documentElement.appendChild(btn);
      btn.style.display = show ? "flex" : "none";
    };
    setInterval(() => { if (document.visibilityState === "visible") update(); }, 700);
    update();
  }

  port.onMessage.addListener((msg) => {
    try {
      if (msg.type === "find") find(msg.text);
      else if (msg.type === "html") html(msg.sel, msg.max);
      else if (msg.type === "hidden") log("hidden: " + [...document.querySelectorAll("[data-mg-hidden]")].map((e) => e.dataset.mgWhy + ":" + e.dataset.mgHidden).join(","));
      else if (msg.type === "css") {
        const sheets = [...document.styleSheets].map((x) => { let n = -1; try { n = x.cssRules.length; } catch (e) { n = "x"; } return (x.href || "inline") .slice(0, 90) + " rules=" + n; });
        const links = [...document.querySelectorAll("link[rel~=stylesheet], link[as=style]")].map((l) => l.href.slice(0, 90) + " " + l.rel);
        log("css sheets=" + sheets.length + "\n" + sheets.slice(0, 15).join("\n") + "\nlinks=" + links.length + "\n" + links.slice(0, 10).join("\n"));
      }
      else if (msg.type === "imgs") {
        const out = [];
        for (const im of document.querySelectorAll("article img")) {
          const r = im.getBoundingClientRect();
          if (r.width < 100) continue;
          out.push("w=" + Math.round(r.width) + " top=" + Math.round(r.top) + " done=" + im.complete + " nat=" + im.naturalWidth
            + " vis=" + getComputedStyle(im).visibility + "/" + getComputedStyle(im).opacity + " src=" + (im.currentSrc || im.src).slice(0, 70)
            + " srcset=" + (im.srcset ? "yes" : "no") + " alt=" + (im.alt || "").slice(0, 25));
        }
        log("imgs " + out.length + " | " + out.slice(0, 8).join(" | "));
        const first = [...document.querySelectorAll("article img")].find((i) => i.getBoundingClientRect().width > 100 && !i.complete);
        if (first) log("src " + (first.currentSrc || first.src));
        if (first) fetch(first.currentSrc || first.src).then((r) => r.blob().then((b) => log("fetch " + r.status + " type=" + r.headers.get("content-type") + " size=" + b.size)))
          .catch((e) => log("fetch failed " + e));
      }
      else if (msg.type === "net") {
        const es = performance.getEntriesByType("resource").filter((e) => /fbcdn|cdninstagram/.test(e.name));
        const by = {};
        for (const e of es) {
          const k = e.initiatorType + (/\.mp4|video/.test(e.name) ? ":video" : /\.jpg|\.webp|\.heic/.test(e.name) ? ":img" : "");
          by[k] = by[k] || { n: 0, bytes: 0, maxMs: 0 };
          by[k].n++; by[k].bytes += e.transferSize || e.encodedBodySize || 0; by[k].maxMs = Math.max(by[k].maxMs, Math.round(e.duration));
        }
        const slow = es.filter((e) => e.duration > 3000).slice(0, 6).map((e) => e.initiatorType + " " + Math.round(e.startTime) + "+" + Math.round(e.duration) + "ms " + Math.round((e.encodedBodySize || 0) / 1024) + "KB " + e.nextHopProtocol);
        const big = es.filter((e) => /\.jpg/.test(e.name)).sort((a, b) => (b.encodedBodySize || 0) - (a.encodedBodySize || 0))[0];
        if (big) log("bigurl " + big.name);
        log("net " + JSON.stringify(by) + " now=" + Math.round(performance.now()) + " slow: " + slow.join(" ; "));
      }
      else if (msg.type === "adcheck") {
        const ads = [...document.querySelectorAll("article")].filter((a) => a.querySelector("a[href*='facebook.com/ads/'], a[href*='a_mpk=']"));
        const people = [...document.querySelectorAll("a[href='/explore/people/']")];
        const sponsoredVisible = [...document.querySelectorAll("span")].filter((x) => x.children.length === 0 && /^(sponsored|ad)$/i.test(x.textContent.trim()) && x.getBoundingClientRect().height > 0 && getComputedStyle(x.closest("article") || x).opacity !== "0");
        log("adcheck ads=" + ads.length + " heights=" + ads.map((a) => Math.round(a.getBoundingClientRect().height)).join(",")
          + " people=" + people.map((p) => Math.round(p.getBoundingClientRect().height)).join(",") + " visibleSponsoredLabels=" + sponsoredVisible.length);
      }
      else if (msg.type === "adinfo") {
        for (const a of [...document.querySelectorAll("[data-mg-hidden]")].slice(0, 6)) {
          const links = [...a.querySelectorAll("a[href]")].map((x) => x.getAttribute("href")).filter((h) => !/^\/[^/]+\/$/.test(h)).slice(0, 6);
          const lbl = [...a.querySelectorAll("[aria-label]")].map((x) => x.getAttribute("aria-label")).slice(0, 6);
          const spans = [...a.querySelectorAll("span")].filter((x) => x.children.length === 0).map((x) => x.textContent.trim()).filter((t) => t && t.length < 30).slice(0, 8);
          log("adinfo " + a.dataset.mgWhy + " tag=" + a.tagName + " links=" + JSON.stringify(links) + " labels=" + JSON.stringify(lbl) + " spans=" + JSON.stringify(spans));
        }
      }
      else if (msg.type === "at") {
        const els = document.elementsFromPoint(msg.x * innerWidth, msg.y * innerHeight);
        log("at " + msg.x + "," + msg.y + ": " + els.slice(0, 10).map(describe).join("\n  "));
      }
      else if (msg.type === "feed") {
        const art = document.querySelector("article");
        if (!art) { log("feed: no article"); return; }
        const chain = [];
        for (let e = art, i = 0; e && e !== document.body && i < 8; e = e.parentElement, i++) {
          const st = e.getAttribute("style") || "";
          chain.push(describe(e) + " kids=" + e.children.length + " style=" + st.slice(0, 80));
        }
        log("feed chain:\n  " + chain.join("\n  "));
        const list = art.parentElement && art.parentElement.parentElement;
        if (list) log("siblings: " + [...list.children].slice(0, 30).map((k) => k.tagName + "/" + Math.round(k.getBoundingClientRect().height) + (k.getAttribute("style") ? "{" + k.getAttribute("style").slice(0, 40) + "}" : "") + (k.querySelector("[data-mg-hidden]") || k.dataset.mgHidden ? "*H" : "")).join(" "));
        log("scrollY=" + Math.round(scrollY) + " docH=" + document.documentElement.scrollHeight);
      }
      else if (msg.type === "errors") log("errors (" + errs.length + "): " + errs.join(" | ") + " vis=" + document.visibilityState + " ready=" + document.readyState + " scripts=" + document.scripts.length + " hidden=" + [...document.querySelectorAll("[data-mg-hidden]")].map((e) => e.dataset.mgHidden + ":" + e.tagName).join(","));
      else if (msg.type === "info") log("info url=" + location.href + " first=" + JSON.stringify(document.body.innerText.slice(0, 300)));
    } catch (e) {
      log("error " + e);
    }
  });
  // Debug: page script errors.
  const errs = [];
  window.addEventListener("error", (e) => {
    const t = e.message ? e.message + " @" + (e.filename || "").slice(-60) + ":" + e.lineno
      : "load error " + (e.target && (e.target.src || e.target.href) || "?");
    if (errs.length < 30) errs.push(t);
  }, true);
  window.addEventListener("unhandledrejection", (e) => { if (errs.length < 30) errs.push("rejection " + String(e.reason).slice(0, 120)); });
  log("helper on " + location.href);
})();
