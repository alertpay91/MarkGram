# MarkGram

**MarkGram** is a lightweight Android app for Instagram without ads, without "suggested" junk and
without anything running in the background. It's a small browser built on Mozilla's
[GeckoView](https://mozilla.github.io/geckoview/) (the Firefox engine) that opens the Instagram
website. It contains no Instagram code and no modified Instagram app.

Created by **Marko Stevanović** ([@alertpay91](https://github.com/alertpay91)).
Sister app of [MarkTube](https://github.com/alertpay91/MarkTube) and
[MarkBook](https://github.com/alertpay91/MarkBook).

<p>
  <a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium%3A%2F%2Fapp%2F%257B%2522id%2522%253A%2522com.marko.markgram%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fgithub.com%252Falertpay91%252FMarkGram%2522%252C%2522author%2522%253A%2522alertpay91%2522%252C%2522name%2522%253A%2522MarkGram%2522%257D"><img src="docs/badge_obtainium.png" alt="Get it on Obtainium" height="48"></a>
  &nbsp;
  <a href="https://github.com/alertpay91/MarkGram/releases/latest/download/MarkGram.apk"><b>⬇ Download MarkGram.apk</b></a>
</p>

- [🇷🇸 Uputstvo (srpski)](#-uputstvo)
- [🇬🇧 English](#-english)

## 🇷🇸 Uputstvo

MarkGram je mala Android aplikacija za Instagram: feed, Reels, Stories, poruke (DM), profil i
pretraga.

**Šta skida:**
- reklame i sponzorisane objave; sponzorisani Reels se preskaču;
- predloge: *Suggested for you* i *Suggestions for you*;
- „Open app“ nagovaranje i prozore tipa „Turn on Notifications“;
- početnu stranu „Open Instagram“: odmah se otvara prijava.

**Bez pozadinskog rada i bez praćenja telefona:**
- Nema obaveštenja ni pozadinskih procesa. Čim izađeš iz aplikacije, stranica se pauzira.
- Ne traži lokaciju, kameru, mikrofon, kontakte ni pristup fajlovima. Slike za objavu biraš sam.
- uBlock Origin blokira reklame i skripte za praćenje.

### Instalacija preko Obtainium-a (preporučeno, ažurira se sam)

1. Instaliraj **Obtainium**, kako je opisano u
   [MarkTube uputstvu](https://github.com/alertpay91/MarkTube#1-instaliraj-obtainium).
2. Na telefonu otvori ovu stranicu i dodirni **Get it on Obtainium**. Zatim dodirni
   **Continue**, pa **Add**.
   - Ručno: u Obtainium-u dodirni **+ Add** i nalepi `https://github.com/alertpay91/MarkGram`.
3. Dodirni dugme za preuzimanje pored MarkGram-a.
   - Prvi put dozvoli instaliranje (**Allow from this source**).
   - Kod Play Protect-a izaberi **Scan app**, pa **Install**.
4. Otvori MarkGram i prijavi se na Instagram.

### Korišćenje

- **Dugme nazad:** vraća jedan korak, na primer iz razgovora, story-ja ili objave. Sa početnog
  feed-a izlazi iz aplikacije, kao prava Instagram aplikacija.
- **Preuzimanje:** okruglo dugme ⬇ na desnoj strani čuva sliku ili video koji gledaš (objava,
  Reels ili story) u punoj veličini, u galeriju: slike u *Pictures/MarkGram*, video u
  *Movies/MarkGram*. Kod objave sa više slika čuva onu koja se trenutno vidi.
- **Prvo pokretanje** posle instalacije može da potraje desetak sekundi, dok se Instagram ne
  učita.

### Ažuriranja

- **Aplikacija:** ažurira se sama preko Obtainium-a. GitHub svake nedelje napravi novu verziju
  sa najnovijim Firefox motorom.
- **Blokator reklama (uBlock Origin):** ažurira se sam pri svakom pokretanju.

## 🇬🇧 English

**What MarkGram removes:**
- ads and sponsored posts; sponsored Reels are skipped;
- suggestion blocks;
- "Open app" prompts and "Turn on Notifications" nags.

**Download button:** the round ⬇ button on the right saves the photo or video on screen (post,
Reel or story) at full size to the gallery: *Pictures/MarkGram* and *Movies/MarkGram*.

When you're logged out, it opens the login form directly.

**No background activity, no access to your phone:**
- MarkGram has no notifications and no background services. The page pauses as soon as you
  leave the app.
- It asks for no location, camera, microphone or contacts access.
- uBlock Origin blocks ads and trackers.

### Install

1. **Install Obtainium:** see the [MarkTube instructions](https://github.com/alertpay91/MarkTube#-how-to-install).
2. **Add MarkGram:** tap the **Get it on Obtainium** badge above on your phone.
   - Or add `https://github.com/alertpay91/MarkGram` manually.
3. **Install:** tap the download button next to MarkGram.
4. **Sign in** to Instagram.

Back steps back one page; on the home feed it leaves the app.

### Updates

- **The app:** updates through Obtainium. GitHub Actions rebuilds it every week with the newest
  GeckoView.
- **uBlock Origin:** updates itself on every start.

Requires Android 8.0+ on a 64-bit ARM (arm64-v8a) phone.

## Build it yourself

```sh
./gradlew assembleRelease
```

- Release signing reads `keystore.properties`, which is not part of this repository.
- CI uses the repository secrets `KEYSTORE_BASE64`, `STORE_PASSWORD`, `KEY_ALIAS` and
  `KEY_PASSWORD`.

## Disclaimer

MarkGram is an independent, non-commercial project and is **not affiliated with, endorsed by, or
sponsored by Meta or Instagram**. "Instagram" is a trademark of Meta Platforms, Inc.

MarkGram does not include or modify any Instagram software. It displays the public Instagram
website the way any web browser does, and only changes how that page looks on your own device.
Use it in line with the terms of the services you use.

## License

- MarkGram's own code is released under the [MIT License](LICENSE).
- GeckoView is © Mozilla and licensed under the [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/).
- uBlock Origin is downloaded at runtime from addons.mozilla.org. It belongs to its authors and
  keeps its own license.
- The "Get it on Obtainium" badge comes from the [Obtainium](https://github.com/ImranR98/Obtainium)
  project, which invites projects to use it.
