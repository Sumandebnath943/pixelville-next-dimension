# Launch checklist

> **Done: the game is live at https://pixelvillenextdimension.houseofnamus.com/**, and every push to `main` deploys it. The steps below are how it was set up (they need the owner's own accounts: Vercel, the Groq key, the domain's DNS), kept for a redeploy or a second domain. The domain first planned was `pixelville.next.houseofnamus.com`; read it as whichever domain the project uses.

## 1. Create the Vercel project (once)
1. Sign in at vercel.com with the GitHub account that owns `Sumandebnath943/pixelville-next-dimension`.
2. **Add New → Project → Import** that repository. Vercel reads `vercel.json`: framework Vite, build `npm run build`, output `dist`. Nothing else to set.
3. Before the first deploy, open **Environment Variables** and add (Production and Preview):
   - `GROQ_API_KEY`: the key from console.groq.com (the same one as in `.env.local`). Without it the villagers still talk, from their template lines.
   - Optional: `GROQ_MODEL` (a Groq model id), `CHAT_DAILY_CAP` (default 4000 requests a day per server instance), `CHAT_ORIGINS` (other sites allowed to call the chat; leave empty).
4. **Deploy.** Every push to `main` then deploys to production, and every other branch (`milestone-7`…) gets its own preview link.

## 2. The domain
1. In the Vercel project: **Settings → Domains → Add** `pixelville.next.houseofnamus.com`.
2. At the DNS provider for `houseofnamus.com`, add the record Vercel shows, normally:
   `CNAME  pixelville.next  →  cname.vercel-dns.com`
3. Wait for Vercel to show the domain as valid (HTTPS is issued automatically).

## 3. Check the live site
- Opens on the loading screen, then the first-day guide (in a fresh browser).
- `https://pixelville.next.houseofnamus.com/api/chat` answers `{"ready":true}` once the key is set.
- Talk to a villager: a natural reply (AI) rather than a template line means the key works.
- On a phone: the touch controls show, the first tap goes full screen; "Add to Home Screen" installs it.

## Notes
- Saves live in each player's browser (IndexedDB), per site: a village made on a preview link doesn't appear on the main domain.
- The chat proxy only answers pages from its own site (and localhost); each address gets 12 lines a minute and 400 a day, and each server instance 90 a minute and `CHAT_DAILY_CAP` a day. Past Groq's free-tier limits, villagers fall back to their template lines.
- V1 stays where it is (pixelville.houseofnamus.com); nothing here touches it.
- **Returning players:** a browser that has played before keeps its village (IndexedDB) and its settings (localStorage `pixelville-nd-settings`), so after a deploy check the live site in a browser with an old village as well as in a private window. If a village crashes the tab while it loads, the next visit offers a way in (open again, lighter graphics, or start afresh with the old one kept safe). A graphics reset lowers the quality for the next load only.
- **Caching:** `vercel.json` serves `index.html` with `no-cache` and the hashed `assets/` as immutable, so a deploy reaches returning players on their next load. Generated textures are cached per browser in IndexedDB (`pv-textures`), keyed by the code that paints them.
