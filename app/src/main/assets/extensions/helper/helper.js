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
  // The feed is virtualised and reserves space for posts by their measured height. A post with
  // display:none is never measured (it would leave a growing hole and stop loading), so hidden
  // posts collapse to 1px instead, which Instagram measures normally.
  const hideStyle = document.createElement("style");
  hideStyle.textContent = "[data-mg-hidden]{height:1px!important;min-height:0!important;max-height:1px!important;"
    + "margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;opacity:0!important;"
    + "pointer-events:none!important}";
  (document.head || document.documentElement).appendChild(hideStyle);
  const hide = (el, why) => {
    if (!el || el.dataset.mgHidden) return;
    el.dataset.mgHidden = why;
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

  function clean() {
    dismissNags();
    for (const el of document.querySelectorAll("article span, article a, article div[role=button], main span, div[role=dialog] span, div[role=dialog] a, a, button")) {
      if (el.children.length > 2) continue;
      const t = el.textContent.trim();
      if (!t || t.length > 30) continue;
      if (AD_LABEL.test(t)) {
        const post = el.closest("article");
        if (post) hide(post, "ad");
        else if (location.pathname.startsWith("/reels")) skipReel(el);
      } else if (SUGGESTED.test(t) || PEOPLE.test(t)) {
        hide(el.closest("article") || block(el), "suggested");
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
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; try { if (!skipLanding()) clean(); } catch (e) { } }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (!skipLanding()) clean();

  port.onMessage.addListener((msg) => {
    try {
      if (msg.type === "find") find(msg.text);
      else if (msg.type === "html") html(msg.sel, msg.max);
      else if (msg.type === "hidden") log("hidden: " + [...document.querySelectorAll("[data-mg-hidden]")].map((e) => e.dataset.mgHidden).join(","));
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
