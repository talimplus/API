-- Claude MCP uchun FAQAT O'QIYDIGAN Postgres roli (`talimplus_ro`).
--
-- Ishga tushirish (superuser yoki jadval egasi nomidan, idempotent):
--   sudo -u postgres psql -d talimplus -v ro_password='KUCHLI_PAROL' -f mcp/setup-readonly.sql
-- Parolni o'zgartirmasdan faqat ruxsatlarni yangilash:
--   sudo -u postgres psql -d talimplus -f mcp/setup-readonly.sql
--
-- ⚠️ Yangi jadval qo'shgan migratsiyadan keyin qayta ishga tushiring — yangi
-- jadvallar avtomatik ochilmaydi (ataylab: yangi jadvalda sir bo'lishi mumkin).
--
-- Nega view emas, ustun darajasidagi GRANT: view'ga bog'langan ustunni
-- migratsiya o'chira/o'zgartira olmaydi (deploy yiqilardi). GRANT esa
-- migratsiyalarga hech qanday to'siq qo'ymaydi.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talimplus_ro') THEN
    CREATE ROLE talimplus_ro LOGIN;
  END IF;
END $$;

ALTER ROLE talimplus_ro WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 5;

\if :{?ro_password}
ALTER ROLE talimplus_ro WITH PASSWORD :'ro_password';
\endif

-- Server tomondan ham, rol darajasida ham: har qanday tranzaksiya read-only.
ALTER ROLE talimplus_ro SET default_transaction_read_only = on;
ALTER ROLE talimplus_ro SET statement_timeout = '20s';
ALTER ROLE talimplus_ro SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE talimplus_ro SET lock_timeout = '2s';
ALTER ROLE talimplus_ro SET "TimeZone" = 'Asia/Tashkent';

SELECT format('GRANT CONNECT ON DATABASE %I TO talimplus_ro', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO talimplus_ro;

DO $$
DECLARE
  -- Umuman ko'rinmaydigan jadvallar
  hidden_tables text[] := ARRAY['blacklisted_tokens'];
  -- Sirlar va shaxsiy hujjat ma'lumotlari (tahlilga kerak emas)
  hidden_columns text[] := ARRAY[
    'users.password',
    'telegram_bot_settings.botToken',
    'telegram_link_tokens.token',
    'students.passportSeries',
    'students.passportNumber',
    'students.jshshir',
    'leads.passportSeries',
    'leads.passportNumber',
    'leads.jshshir'
  ];
  r record;
  all_cols text;
  visible_cols text;
  has_hidden boolean;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum),
           string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
             FILTER (WHERE NOT (r.relname || '.' || a.attname) = ANY (hidden_columns)),
           bool_or((r.relname || '.' || a.attname) = ANY (hidden_columns))
      INTO all_cols, visible_cols, has_hidden
    FROM pg_attribute a
    WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped;

    -- Avvalgi ruxsatlarni tozalaymiz (ro'yxat o'zgargan bo'lsa ham to'g'ri bo'lsin)
    EXECUTE format('REVOKE ALL ON public.%I FROM talimplus_ro', r.relname);
    IF all_cols IS NOT NULL THEN
      EXECUTE format('REVOKE ALL (%s) ON public.%I FROM talimplus_ro', all_cols, r.relname);
    END IF;

    CONTINUE WHEN r.relname = ANY (hidden_tables) OR visible_cols IS NULL;

    IF has_hidden THEN
      EXECUTE format('GRANT SELECT (%s) ON public.%I TO talimplus_ro', visible_cols, r.relname);
    ELSE
      EXECUTE format('GRANT SELECT ON public.%I TO talimplus_ro', r.relname);
    END IF;
  END LOOP;
END $$;

-- Tekshiruv: rolda yozish huquqi umuman bo'lmasligi kerak (0 qator).
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'talimplus_ro' AND privilege_type <> 'SELECT';
