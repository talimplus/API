# Talimplus — faqat o'qiydigan MCP server

Claude (claude.ai / Desktop → **Settings → Connectors**) bazani o'qib, tahlil
qilishi uchun. Hech narsani o'zgartira olmaydi — uchta qavatda himoyalangan:

1. **Postgres roli `talimplus_ro`** — faqat `SELECT`, rol darajasida
   `default_transaction_read_only = on`, 20 s timeout, 5 ta ulanish.
   Yashirilgan: `users.password`, Telegram bot tokeni, QR tokenlar,
   `blacklisted_tokens`, pasport va JSHSHIR (`setup-readonly.sql` boshida ro'yxat).
2. **Server** — har so'rov `BEGIN READ ONLY` ichida, bitta statement
   (extended protocol), oxirida `ROLLBACK`. Natija ko'pi bilan 2000 qator.
3. **Filtr** — faqat `SELECT / WITH / VALUES / TABLE / EXPLAIN / SHOW`.

Tool'lar: `list_tables`, `describe_table`, `query`.

## Serverga o'rnatish

```bash
cd learning-center-saas/mcp
npm ci --omit=dev

# 1) read-only rol (idempotent; yangi jadval qo'shgan migratsiyadan keyin qayta ishga tushiring)
sudo -u postgres psql -d talimplus -v ro_password='KUCHLI_PAROL' -f setup-readonly.sql

# 2) sozlamalar
cp .env.example .env
openssl rand -hex 32        # -> MCP_SECRET
nano .env                   # MCP_SECRET, MCP_DB_PASS

# 3) ishga tushirish
pm2 start ecosystem.config.cjs && pm2 save
curl http://127.0.0.1:3010/health
```

Node **20.6+** kerak (`--env-file`).

## HTTPS (nginx)

Claude.ai connector Anthropic serveridan ulanadi — manzil **ochiq HTTPS** bo'lishi
shart (`localhost` ishlamaydi). Mavjud API domeniga qo'shish:

```nginx
location /mcp/ {
    proxy_pass http://127.0.0.1:3010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 60s;
    access_log off;          # URL ichida maxfiy kalit bor — log'ga tushmasin
}
```

## Claude'ga ulash

**claude.ai / Claude Desktop:** Settings → Connectors → *Add custom connector*
- Name: `Talimplus DB`
- URL: `https://<api-domen>/mcp/<MCP_SECRET>`
- OAuth maydonlari bo'sh qoladi.

Keyin chatda: *"Talimplus DB orqali oxirgi 3 oy bo'yicha har bir tashkilotning tushumini ko'rsat"*.

**Claude Code:**
```bash
claude mcp add --transport http talimplus-db https://<api-domen>/mcp \
  --header "Authorization: Bearer <MCP_SECRET>"
```

Kalit oshkor bo'lsa — `.env` da `MCP_SECRET` ni almashtirib `pm2 restart talimplus-mcp`,
connector'ni yangi URL bilan qayta qo'shing.

## Lokal sinov

```bash
psql -d li_tech -v ro_password='test' -f setup-readonly.sql
MCP_SECRET=$(openssl rand -hex 32) MCP_DB_NAME=li_tech MCP_DB_PASS=test node server.mjs
npx @modelcontextprotocol/inspector   # Streamable HTTP, http://127.0.0.1:3010/mcp/<secret>
```
