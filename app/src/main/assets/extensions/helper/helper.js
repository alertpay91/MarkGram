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
  const hide = (el, why) => {
    if (!el || el.dataset.mgHidden) return;
    el.dataset.mgHidden = why;
    el.style.setProperty("display", "none", "important");
  };
  function clean() {
    for (const el of document.querySelectorAll("article span, article a, article div[role=button], main span, div[role=dialog] span, div[role=dialog] a, a, button")) {
      if (el.children.length > 2) continue;
      const t = el.textContent.trim();
      if (!t || t.length > 30) continue;
      if (AD_LABEL.test(t)) {
        hide(el.closest("article"), "ad");
      } else if (SUGGESTED.test(t)) {
        hide(el.closest("article"), "suggested");
      } else if (APP_PROMO.test(t)) {
        // A banner or a dialog asking to open the official app.
        const dialog = el.closest("div[role=dialog]");
        if (dialog) {
          const close = dialog.querySelector('[aria-label="Close" i], [aria-label="Zatvori" i], [aria-label="Затвори" i]');
          if (close) close.click(); else hide(dialog.parentElement || dialog, "promo");
        } else {
          hide(el.closest("a, button, div[role=button]") || el, "promo");
        }
      }
    }
  }
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; try { clean(); } catch (e) { } }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
  clean();

  port.onMessage.addListener((msg) => {
    try {
      if (msg.type === "find") find(msg.text);
      else if (msg.type === "html") html(msg.sel, msg.max);
      else if (msg.type === "hidden") log("hidden: " + [...document.querySelectorAll("[data-mg-hidden]")].map((e) => e.dataset.mgHidden).join(","));
      else if (msg.type === "info") log("info url=" + location.href + " first=" + JSON.stringify(document.body.innerText.slice(0, 300)));
    } catch (e) {
      log("error " + e);
    }
  });
  log("helper on " + location.href);
})();
