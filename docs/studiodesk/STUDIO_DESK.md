# Portal — Guida sviluppatore (CLAUDE.md)

Documentazione operativa per agenti AI / sviluppatori che lavorano su questo
codebase. Conciso e pratico: cosa c'è, dove sta, come si modifica.

## TL;DR

- **Cos'è**: SaaS multi-tenant in PHP + MySQL per studi professionali (brand
  marketing **StudioDesk**, dominio `studiodesk.cloud`). Ogni studio = 1 DB
  dedicato. Pannelli: cliente (`/`), admin (`/admin/`), super admin (`/superadmin/`).
  Quando l'host è uno dei `PLATFORM_HOSTS`, viene servita la **landing
  marketing** in `/platform/` invece dei pannelli tenant.
- **Brand assets** in `public/assets/images/`: `logo.svg` (full con testo,
  per sfondo chiaro), `logo-light.svg` (testo bianco per sfondo scuro),
  `logo-icon.svg` (solo monogramma S+scrivania), `favicon.ico` (16/32/48).
  Generati con ImageMagick. Solo le pagine **platform** e **email** usano
  il brand StudioDesk; i pannelli tenant continuano col branding del
  singolo studio (favicon dinamico via `/icona.php`).
- **Stack**: PHP 8.2 (PHP-FPM), MySQL 8, Bootstrap 5.3 + Bootstrap Icons,
  Inter font, Apache 2.4 (`mpm_event`, HTTP/2). Niente framework, niente
  composer per i controller (vendor solo per librerie esterne: dompdf,
  phpmailer, robthree).
- **Auth**: 3 livelli — `superadmin` (master DB), ruoli interni
  (`admin`/`direzione`/`responsabile`/`operatore`/`capoufficio`), `cliente`.
  Admin/direzione sono **governance/supervisione**: nelle regole operative
  (assegnazione ticket, RFM, candidati portafoglio) sono esclusi sistematicamente.
  Costanti `AuthController::RUOLI_OPERATIVI` / `RUOLI_RFM` / `RUOLI_INTERNI`
  centralizzano la classificazione. Vedi "Ruoli operativi vs manageriali".
- **Sicurezza** (Portal26 2.0): brute-force protection sul login (captcha
  math a 5+ fail, lockout a 10+, alert email a 20+/h), **2FA TOTP** opt-in
  per ruoli interni (robthree/twofactorauth + recovery codes), **CSRF**
  validato automaticamente su ogni POST con auto-injection del token negli
  AJAX via wrap di `window.fetch`. Vedi sezione "Auth & sicurezza".
- **Backup automatici** daily 03:00 in `/var/backups/portal/<slug>/` —
  mysqldump + tar storage + sha256, retention 30gg, widget "Stato backup"
  in superadmin/sistema con bottone "Esegui ora". Vedi sezione dedicata.
- **Documenti**: visibilità a 4 livelli (tutti/azienda/reparto/utente),
  **versioning** lineare (catena flat con `versione_padre_id` → root v.1)
  e **firma elettronica via OTP email** (codice 6 cifre, validità 10 min,
  max 5 tentativi, traccia IP/UA). Vedi "Versioning + firma".
- **AI**: Groq (`llama-3.3-70b-versatile`) per assistant cliente, generazione
  e revisione notturna KB, **AI Polish** sul thread admin (riformulazione
  della risposta operatore prima dell'invio). Costanti `GROQ_API_KEY`/`GROQ_MODEL`
  in `src/config/config.php`. L'assistant chat-style nel pannello operatori
  è stato rimosso (poco utile in pratica); resta il Polish puntuale che è
  riservato ai ruoli interni.
- **Canali inbound**: Telegram bot (qualsiasi piano) e **WhatsApp Cloud API**
  (add-on Pro/Enterprise, inbound-only). Entrambi seguono lo stesso pattern
  "thread caldo" 24h. Per WhatsApp l'operatore risponde SEMPRE dal portale
  (mai via WA) e le comunicazioni vengono auto-chiuse dopo 24h senza risposta
  per rispettare il customer service window Meta. Vedi sezione dedicata
  "WhatsApp Cloud API".
- **Asset condivisi**: `public/assets/portal.{css,js}` (design system + tema
  scuro) + `portal-tour.js` (tour guidato multi-pagina) + `sa.css` (UI
  superadmin). Cache busting automatico via `?v=<filemtime>` dalle sidebar.
- **Front Controller** (clean URL): `public/index.php` + `src/Router.php` +
  `src/routes.php`. URL puliti senza `.php` (es. `/admin/aziende`,
  `/superadmin/studi`). Vedi sezione dedicata sotto.
- **Portafogli (visibilità ristretta operatori)**: toggle opt-in
  `portafogli_scoping_attivo` (OFF di default) che limita la visibilità di
  clienti/ticket/documenti ai membri del portafoglio. Direzione ha un switch
  topbar "Vista globale ↔ Miei clienti". Aziende orfane = default-allow.
  Helper `PortafoglioACL::whereForUser($user, alias)` applicato in 9 punti
  (lista aziende, comunicazioni, ricerca, badge polling, KPI home).
  Vedi sezione "Portafogli".

---

## Struttura cartelle

```
/var/www/portal/
├── public/             ← DocumentRoot Apache
│   ├── index.php           landing → login o dashboard
│   ├── login.php           auth utenti studio (cliente + operatori)
│   ├── logout.php
│   ├── recupera-password.php / reset-password.php
│   ├── registrati.php      accept invito (?token=...)
│   ├── dashboard.php       home cliente (hero + tile + ultime comunicazioni)
│   ├── comunicazioni.php / comunicazione.php   chat con studio
│   ├── profilo.php         3 tab (dati, password, account) — avatar a iniziali
│   ├── azienda.php         admin azienda — vista dati
│   ├── utenti-azienda.php  admin azienda — CRUD utenti
│   ├── calendario.php      scadenze fiscali
│   ├── documenti.php       DMS lato cliente — lista + scarica + conferma lettura
│   ├── circolari.php       Lista circolari ricevute + conferma esplicita
│   ├── questionari.php     Questionari assegnati al cliente (da compilare + storico)
│   ├── questionario.php    Compilazione di un questionario
│   ├── guida.php           guida cliente (TOC, scrollspy, PDF, tour)
│   ├── sidebar-cliente.php topbar+sidebar+menu utente+AI FAB+credenziali demo
│   ├── _credenziali-demo.php  parziale modal credenziali (incluso da sidebar)
│   ├── banner-ispezione.php striscia viola superadmin
│   ├── maintenance.php     pagina di emergenza
│   └── assets/
│       ├── portal.css       design system + tokens + dark mode + portal-list
│       ├── portal.js        toast, dark mode toggle, sidebar mobile
│       ├── portal-tour.js   tour guidato multi-pagina (cliente/admin)
│       ├── portal-list.js   componente lista riusabile (search live, virtual scroll, card/table)
│       └── sa.css           design system pannello superadmin (tema scuro fisso)
│
├── admin/              ← pannello operatori
│   ├── home.php            dashboard inbox-first (KPI + inbox + scadenze)
│   │                         · Operatore vede meno widget (no carico, scadenze, audit, ecc.)
│   ├── comunicazioni.php / comunicazione-detail.php
│   ├── aziende.php / inviti.php
│   ├── utenti.php / reparti.php / acl.php
│   ├── knowledge-base.php / revisioni-ai.php
│   ├── scadenze.php
│   ├── documenti.php       DMS — lista + upload (wizard 3-step) + filtri + letture
│   ├── circolari.php       Circolari (broadcast) — lista + composizione
│   ├── questionari.php     Questionari — lista (bozze/inviati/chiusi/modelli)
│   ├── questionario-edit.php   editor questionario (testata + domande + AI + invio)
│   ├── questionario-detail.php risposte di un questionario (KPI + per cliente)
│   ├── impostazioni.php / audit-log.php / sito-editor.php
│   ├── notifiche.php       editor notifiche email per-tenant (admin)
│   ├── profilo.php / direzione.php / guida.php
│   └── sidebar.php / topbar.php (con ricerca globale + AI FAB + user menu)
│
├── platform/           ← landing marketing Studiodesk (servita quando IS_PLATFORM)
│   ├── index.php           hero + features + prezzi + testimonianze + FAQ + form contatti
│   │                         · form contatti via AJAX (no scroll/reload, fallback redirect)
│   ├── accedi.php          "trova il tuo portale" — cerca tenant per nome → redirect login
│   └── legal.php           privacy / cookie / termini (?doc=privacy|cookie|termini)
│                            · disclaimer "sito in sviluppo, non per vendita reale"
│
├── superadmin/         ← piattaforma multi-tenant
│   ├── auth.php            guard separato (sessione superadmin_*) + step1/completa login
│   ├── login.php / logout.php
│   ├── login-2fa.php       step 2 login: OTP / recovery / passkey
│   ├── profilo.php         profilo + Sicurezza (Passkey + 2FA TOTP)
│   ├── passkey-*.php       endpoint WebAuthn superadmin (register/login/delete)
│   ├── dashboard.php       overview compatto (KPI + ultimi studi + audit + sistema)
│   ├── studi.php           lista studi con filtri stato/piano + ricerca live
│   ├── audit.php           log completo attività (filtri, paginazione 10/pag)
│   ├── sistema.php         info server, disco, memoria, DB per tenant, riavvio
│   ├── crea-studio.php     wizard provisioning (con template grafici)
│   ├── ispeziona.php       impersona admin/cliente di uno studio (RO)
│   ├── esci-ispezione.php
│   ├── guida.php           guida superadmin (15 sezioni)
│   ├── restart.php         endpoint POST riavvio server (sudo reboot)
│   ├── ping.php            health-check pubblico (polling post-reboot)
│   ├── _topbar.php / _topbar-end.php   topbar + nav tabs condivisi
│   ├── _helpers.php        saTempoRel, saInfoDisco, saAuditIcona, ecc.
│   ├── _standby.php        pagina d'attesa quando MySQL non è ancora pronto
│   └── templates/
│       ├── _data.php       6 template grafici (classico/minimal/tech/...)
│       └── preview.php     anteprima full-page in iframe (893 righe)
│
├── api/                ← endpoint JSON
│   ├── com-allegato.php    download sicuro
│   ├── documento.php       download documento DMS (con eventuale prompt password)
│   ├── documento-conferma.php  POST conferma lettura esplicita (cliente)
│   ├── documento-letture.php   JSON elenco letture (admin only)
│   ├── kb-genera-ai.php    genera FAQ con Groq
│   ├── telegram-link.php / telegram-webhook.php
│   ├── notifiche.php       polling badge comunicazioni topbar
│   ├── ricerca.php         ricerca globale (aziende/com/KB/utenti)
│   ├── ai-cliente.php      AI assistant cliente (multi-turno, max 500 tokens)
│   ├── ai-polish.php       AI Polish operatore: riformula la bozza di
│                            risposta su richiesta. Solo ruoli interni,
│                            no clienti, blocco automatico in ispezione.
│                            (NB: l'AI chat nel pannello operatori è stata rimossa,
│                             non era abbastanza utile)
│   ├── guida-pdf.php       export guida (cliente/admin/superadmin/tutto)
│   ├── questionario-ai-genera.php  genera le domande di un questionario con Groq
│   ├── azienda-clienti.php / lookup-piva.php
│   └── seed-demo.php       rigenera dati demo (endpoint admin, non più esposto in UI)
│
├── src/
│   ├── config/
│   │   ├── master.php      credenziali DB master + provisioning
│   │   ├── config.php      tenant detection + costanti DB_*/APP_*/GROQ_*
│   │   └── database.php    Singleton PDO sul DB tenant attivo
│   ├── controllers/
│   │   ├── AuthController.php           login + ispezione + homeUrlPerRuolo
│   │   ├── ACLController.php            ruoli/permessi/override
│   │   ├── ComunicazioneController.php  thread + allegati + telegram + notifiche email
│   │   ├── InvitoController.php
│   │   ├── StudioProvisioningController.php  (legacy — non più usato)
│   │   └── PianoController.php
│   ├── services/
│   │   ├── MailerService.php           PHPMailer wrapper + invio notifiche eventi
│   │   ├── TelegramService.php
│   │   ├── UserDisponibilitaService.php disponibilità operatore (orari + assenze + alert)
│   │   ├── CircolariService.php         circolari broadcast (CRUD + ACL + tracking)
│   │   ├── QuestionariService.php       questionari (CRUD + invio + risposte + solleciti)
│   │   ├── QuestionariAIService.php     generazione AI delle domande (Groq)
│   │   └── TotpService.php              wrapper robthree per 2FA TOTP (Portal26 2.0)
│   ├── ai/
│   │   ├── AIService.php       chiamate Groq + KB-aware
│   │   └── KBRevisorService.php revisione notturna FAQ
│   ├── helpers/
│   │   ├── Storage.php        facade + driver (local|s3) per documenti
│   │   └── Csrf.php           token CSRF + validate (Portal26 2.0)
│   ├── piani.php              definizioni base/pro/enterprise (limiti + features)
│   ├── routes.php             tabella rotte clean URL
│   ├── Router.php             dispatcher front controller
│   ├── version.php            PORTAL_VERSION (convenzione ANNO.MAJOR.MINOR)
│   ├── guide_content.php      single source of truth contenuti guide (con ruolo_min)
│   ├── notifiche_default.php  template default 12 eventi notifiche email
│   └── com_reazioni_ui.php    partial: CSS + JS + helper render reazioni emoji
│
├── bin/                              ← script CLI (cron + manutenzione + seed)
│   │  # Backup, GC, retention
│   ├── cron-backup-tenant.php        backup daily 03:00 → /var/backups/portal/<slug>/
│   ├── cron-backup-offsite-b2.sh     sync notturno a Backblaze B2 (DISATTIVO di default)
│   ├── cron-storage-gc.php           GC settimanale file orfani in storage/docs/
│   ├── cron-gc-documenti.php         purge fisico soft-deleted >30gg
│   ├── cron-archive-audit.php        rotazione audit_log → *_archive (mensile)
│   ├── cron-purge-studi.php          eliminazione definitiva studi nel cestino scaduti
│   │  # Sicurezza + monitoring
│   ├── cron-cleanup-security.php     cleanup login_attempts/telegram_tokens/password_reset
│   ├── cron-monitor.php              alert backup stale, cert <30gg, disco >85%
│   ├── cron-collect-metrics.php      CPU/RAM/load ogni minuto per grafico storico
│   ├── cron-update-alerts.php        email digest apt updates urgenti/importanti
│   │  # Comunicazioni / canali
│   ├── cron-com-auto-close.php       auto-chiusura comunicazioni inattive ogni 6h
│   ├── cron-whatsapp-auto-close.php  WA inbound auto-close 24h sla
│   ├── cron-circolari-scheduler.php  pubblicazione schedulata + solleciti + questionari
│   ├── cron-alert-disponibilita.php  alert team coverage 08:00 feriale
│   ├── cron-alert-scadenze-doc.php   alert scadenze documenti
│   ├── cron-scadenze-memo.php        memo email 7gg/1gg prima scadenza
│   ├── cron-sync-scadenze.php        sync scadenze fiscali ufficiali su tutti i tenant
│   │  # Agevolazioni
│   ├── cron-bandi-import.php         import bandi pubblici → portal_master
│   ├── cron-rna-import.php           import RNA aiuti (Open Data)
│   ├── cron-agevolazioni-monitoraggi.php          monitoraggi proattivi giornalieri
│   ├── cron-agevolazioni-snapshot.php             snapshot mensile portafoglio
│   ├── cron-agevolazioni-cleanup-sganciate.php    cleanup aziende sganciate
│   │  # DMS Drive
│   ├── cron-dms-mirror.php           mirror storage docs → drive cloud (outbound)
│   ├── cron-dms-inbound.php          import file dal drive cloud (inbound)
│   │  # Billing
│   ├── cron-billing-emit.php         emissione fatture (FIC)
│   ├── cron-billing-reconcile.php    riconciliazione pagamenti
│   │  # Sistema
│   ├── system-updates.php            wrapper apt scan/upgrade/reboot (sudoers)
│   ├── opcache-reload.sh             reload graceful PHP-FPM + ri-preload
│   ├── install-superadmin-sudoers.sh installa /etc/sudoers.d/portal-superadmin
│   ├── portal-superadmin.sudoers     whitelist sudoers (binari ammessi a www-data)
│   │  # Seed + migrate
│   ├── seed-demo.php                 seed dati demo (--yes / --dry-run)
│   ├── seed-acl-defaults.php         (re)applica permessi ACL canonici
│   ├── seed-billing-demo.php         seed dati billing demo
│   ├── migrate-tenants.php           applica una migration su tutti i tenant
│   ├── migrate-ai-cliente.php
│   ├── migrate-audit-immutable.php
│   ├── migrate-com-indexes.php
│   ├── migrate-documenti-user-state.php
│   ├── migrate-firma-canali.php
│   ├── migrate-firma-delega.php
│   ├── migrate-kb-origine.php
│   ├── migrate-scadenze-visibilita.php
│   ├── migrate-search-indexes.php
│   ├── migrate-whatsapp.php
│   └── migrate-wizard.php
│
├── uploads/comunicazioni/  ← allegati comunicazioni (chown www-data:www-data, 775)
├── storage/                ← FUORI dal DocumentRoot — solo Storage::serve via PHP
│   ├── docs/{slug}/...     archivio documenti (serviti via /api/documento.php)
│   ├── tmp/                upload temporanei
│   └── .htaccess           Require all denied
├── migrations/                                ← .sql idempotenti, numerati per ordine
│   ├── 00_master.sql                          schema portal_master
│   ├── 01_studio_template.sql                 schema per ogni studio (placeholder portal_template)
│   ├── 02_crm_upgrade.sql                     CRM (aziende campi estesi)
│   ├── 03_scadenze_origine.sql                scadenze: tracciamento origine
│   ├── 04_notifiche_config.sql                config notifiche email per-tenant
│   ├── 05_documenti.sql                       sistema documenti (tipi + documenti + letture)
│   ├── 06_disponibilita.sql                   disponibilità operatore (orari + assenze)
│   ├── 07_circolari.sql                       circolari broadcast
│   ├── 08_com_reazioni.sql                    reazioni emoji sui messaggi
│   ├── 09_reparti_azienda.sql                 reparti interni alle aziende cliente
│   ├── 10_security.sql                        2FA users.totp_* + brute-force alert
│   ├── 11_backup.sql                          master.studios.last_backup_*
│   ├── 12_versioning_firma.sql                documenti versione/padre + firme OTP
│   ├── 13_circolari_v2.sql                    circolari schema v2
│   ├── 13_search_indexes.sql                  FULLTEXT ngram + soundex aziende/users
│   ├── 14_passkey.sql                         tenant webauthn_credentials
│   ├── 15_ai_cliente.sql                      ai_audit (metadati GDPR)
│   ├── 15_circolari_summary.sql               summary AI on-demand
│   ├── 16_circolari_telegram.sql              telegram_broadcast flag
│   ├── 16_firma_canali.sql                    canali firma (email/SMS)
│   ├── 16_kb_origine.sql                      KB origine (manuale/AI)
│   ├── 17_circolari_tags.sql                  tag M:N normalizzati
│   ├── 17_firma_delega.sql                    delega firma a terzo
│   ├── 18_circolari_ab_test.sql               A/B test linea oggetto
│   ├── 19_platform_settings.sql               portal_master.platform_settings
│   ├── 20_superadmin_security.sql             superadmin TOTP + passkey
│   ├── 21_documenti_user_state.sql            stato per-utente (archiviato/eliminato)
│   ├── 22_backup_duration.sql                 studios.last_backup_duration_sec
│   ├── 22_superadmin_security.sql             pannello SA (geoip, ip_ban, metrics)
│   ├── 23_com_indici.sql                      indici comunicazioni
│   ├── 23_platform_landing.sql                landing editor (key/value JSON)
│   ├── 24_audit_archive.sql                   tabelle *_archive
│   ├── 25_audit_immutable.sql                 trigger SIGNAL su UPDATE/DELETE audit
│   ├── 26_whatsapp.sql                        WhatsApp inbound (origine, log, numeri)
│   ├── 27_scadenze_visibilita.sql             ACL scadenze (tutti/azienda/reparto/utente)
│   ├── 28_email_per_servizio.sql              email destinazione per evento
│   ├── 29_maintenance_mode.sql                modalità manutenzione globale
│   ├── 30_agevolazioni_master.sql             bandi master
│   ├── 31_agevolazioni_tenant.sql             monitoraggi/precheck tenant
│   ├── 32_aziende_arricchimento.sql           profilo arricchito da CF/OpenAPI
│   ├── 33_agevolazioni_sgancio.sql            (legacy opt-out)
│   ├── 34_agevolazioni_app_v2.sql
│   ├── 35_provider_bilanci.sql                provider bilanci esterni
│   ├── 36_bandi_filtri_estesi.sql
│   ├── 37_provider_api_log.sql                log chiamate API esterne
│   ├── 38_dms_mirror.sql                      DMS mirror state
│   ├── 39_agevolazioni_quota.sql              quota per-studio aziende attivabili
│   ├── 40_agevolazioni_aziende_attivazione.sql opt-in per-azienda
│   ├── 41_rna_aiuti_dettaglio.sql             aiuti RNA dettaglio
│   ├── 42_bandi_dettaglio_scraper.sql         scraper dettaglio bandi
│   ├── 43_password_scadenza.sql               policy scadenza password
│   ├── 44_questionari.sql                     modulo Questionari (5 tabelle + ACL)
│   ├── 45_questionari_notifiche.sql           solleciti + eventi notifica
│   ├── 46_questionari_sezioni.sql             sezioni nei questionari
│   ├── 47_dms_inbound.sql                     DMS inbound (import da Drive)
│   ├── 48_questionari_documento.sql           questionario → documento generato
│   ├── 49_import_tracciati.sql                import strutturato F24
│   ├── 50_documenti_modelli.sql               modelli documenti (template)
│   ├── 51_studios_lifecycle.sql               sospensione/cestino/eliminazione studi
│   ├── 52_pannello_azienda.sql                scheda azienda admin (RFM, ecc.)
│   ├── 53_wizard.sql                          wizard onboarding W1/W2/W3
│   ├── 54_azienda_operatore_riferimento.sql   RFM
│   ├── 55_wizard_snooze.sql                   wizard snooze/reset/skip
│   ├── 56_scadenze_memo.sql                   idempotenza memo email 7gg/1gg
│   ├── 57_comunicazioni_snooze.sql            comunicazioni snooze fino a data
│   ├── 58_schema_migrations.sql               tracking migrazioni applicate
│   ├── 59_agev_notifiche_inbox.sql            inbox notifiche agevolazioni
│   ├── 60_portafogli.sql                      portafogli (visibilità ristretta operatori)
│   └── 61_fic_billing.sql                     integrazione Fatture in Cloud
└── vendor/                 ← composer (dompdf, phpmailer, robthree, web-auth, web-push)
```

## Database

### Master `portal_master`

Registry centrale. Tre tabelle:

- `studios` — registry tenants. Colonne chiave: `slug`, `db_host`, `db_name`,
  `db_user`, `db_pass`, `dominio`, `piano`, `attivo`.
- `superadmin_users` — account piattaforma (separati dagli utenti studio).
- `superadmin_audit` — traccia ispezioni e operazioni superadmin.

### Per-tenant `portal_<slug>`

Schema in `migrations/01_studio_template.sql`. Lavora con FK esplicite
(CASCADE/SET NULL coerenti) e indici minimi. Tabelle principali:

- `users` — operatori interni + clienti (discriminati da `ruolo`)
- `aziende` — anagrafica clienti
- `comunicazioni` + `com_messaggi` + `com_allegati` — sistema chat
  - `comunicazioni.operatore_assegnato_id` — operatore studio in carico (NULL = "da assegnare")
  - `com_messaggi.lato` ENUM `'studio'|'cliente'|'interno'` — `'interno'` = note tra
    operatori, **mai visibili al cliente** (filtrate da `getDettaglio($id, true)`)
  - `com_messaggi.origine` ENUM `'portale'|'telegram'|'email'|'sa'` — tracciamento canale
- `knowledge_base` + `categorie` + `kb_revisioni` — KB AI
- `ruoli` + `permessi` + `ruoli_permessi` + `utenti_permessi` — ACL
- `reparti` + `reparti_utenti` — gruppi team
- `inviti` — onboarding clienti via token
- `password_reset` — reset password
- `notifiche`, `audit_log`, `impostazioni`, `richieste_modifica`,
  `user_preferenze`, `telegram_tokens`, `scadenze`
- `notifiche_config` — configurazione email automatiche per-tenant: per ogni
  evento (apertura/risposta/chiusura ticket, assegnazione operatore, scadenze,
  documenti) si decide se attivare e si possono sovrascrivere subject/body/CTA.
  Default in `src/notifiche_default.php`. Migrazione: `migrations/04_notifiche_config.sql`.
- `documenti_tipi` — catalogo tipi documento (F24, CU, fattura, ecc.). Righe
  con `studio_id IS NULL` = predefiniti di piattaforma (immutabili, 16 seedati);
  `studio_id = ID` = tipi custom del tenant. Migrazione: `migrations/05_documenti.sql`.
- `documenti` — file caricati con visibilità (`tutti`/`azienda`/`utente`),
  password opzionale (`password_hash`), conferma di lettura, soft delete via
  `deleted_at`. `path` è relativo a `STORAGE_LOCAL_PATH`, `nome_file` è UUID
  (mai il nome originale).
- `documenti_letture` — tracking letture: `(documento_id, user_id)` UNIQUE,
  `tipo_conferma ENUM('implicita','esplicita')`. `'esplicita'` non viene mai
  degradata a `'implicita'` da letture successive.
- `documenti_user_state` — stato per-utente del documento: `(documento_id,
user_id)` PK, `stato ENUM('archiviato','eliminato')`. Permette al cliente
  di "archiviare" (recuperabile) o "eliminare definitivamente" un documento
  dalla **propria vista**, senza toccare il record in `documenti` (lo studio
  continua a vedere tutto). Migrazione: `migrations/21_documenti_user_state.sql`.
  Vedi sezione "Archivio/cancellazione lato cliente".

Niente più: `tickets`, `messaggi` (legacy), `routing_*`, `numerixl_*`,
`operatori_competenze`, `clienti_operatori`.

## Hosting & DNS (produzione)

- **Dominio**: `studiodesk.cloud` (Aruba registrar)
- **DNS authoritative**: Cloudflare (`journey.ns.cloudflare.com`, `peter.ns.cloudflare.com`).
  Aruba mantiene solo registrar + mail server (`mx.studiodesk.cloud`).
- **Wildcard A record**: `*.studiodesk.cloud → 178.104.235.33` — ogni
  sub-dominio risolve al server (per i tenant `<slug>.studiodesk.cloud`).
- **SSL wildcard**: cert Let's Encrypt `*.studiodesk.cloud + studiodesk.cloud`
  in `/etc/letsencrypt/live/studiodesk.cloud-0001/`. Rinnovo automatico via
  plugin `python3-certbot-dns-cloudflare` con API token in `/etc/letsencrypt/cloudflare.ini`
  (chmod 600). Zero manutenzione manuale.
- **Vhost Apache** in `/etc/apache2/sites-available/` (copia versionata in
  [`ops/apache/`](ops/apache/) — `sites-enabled/` deve essere SOLO symlink a
  `sites-available/`; in passato erano copie separate e causava drift di
  config — fix in security-audit-2026-05-23. Workflow: edit `sites-available/` →
  sync a `ops/apache/` → `sudo apache2ctl configtest && sudo systemctl reload apache2`):
  - `portal.conf` — risponde su IP `178.104.235.33` (legacy + sviluppo)
  - `studiodesk.cloud.conf` (`:80`) — tutto HTTP redirect 301 a HTTPS canonical
    ([copia](ops/apache/studiodesk.cloud.conf))
  - `studiodesk.cloud-le-ssl.conf` (`:443`) — 3 vhost: apex→www, www landing,
    `*.studiodesk.cloud` tenant catch-all
    ([copia](ops/apache/studiodesk.cloud-le-ssl.conf)). Tutti e 4 i blocchi
    `<Directory /var/www/portal/{public,admin,api,superadmin}>` hanno
    `Options -Indexes` (no directory listing pubblico).
- **HTTPS-only**: niente HTTP esposto, HSTS attivo (`max-age=31536000`)
- **Runtime PHP**: Apache gira con `mpm_event` e serve PHP via **PHP-FPM**
  (`php8.2-fpm`, socket `/run/php/php8.2-fpm.sock`) attraverso `mod_proxy_fcgi`
  — non più `mod_php`/`mpm_prefork`, incompatibili con HTTP/2. **HTTP/2**
  (`h2`) attivo su tutti i vhost (`Protocols h2 http/1.1`). Config versionata
  in [ops/apache/portal-http2.conf](ops/apache/portal-http2.conf) (conf-available
  `portal-http2`) + la conf di sistema `php8.2-fpm`.
- **OPcache + preload**: tuning produzione in `/etc/php/8.2/fpm/conf.d/10-opcache.ini`
  (`memory_consumption=256`, preload di 10 file core via [src/preload.php](src/preload.php)).
  ⚠ In produzione `validate_timestamps=0`: dopo ogni modifica al codice PHP
  serve `sudo bin/opcache-reload.sh`. Su questo **box di test**
  [ops/php/99-portal-test-opcache.ini](ops/php/99-portal-test-opcache.ini) forza
  `validate_timestamps=1` (modifiche riprese entro ~2s); restano da ricaricare
  a mano solo i 10 file di `src/preload.php` (vedi "Comandi utili → PHP-FPM").

## Tenant detection

`src/config/config.php` decide quale studio servire all'inizio di ogni
richiesta. **Prima** della tenant detection viene controllato se l'host
è uno dei `PLATFORM_HOSTS` (definiti in `master.php`): se sì, viene definita
la costante `IS_PLATFORM=true` e `public/index.php` serve la landing
marketing in `/platform/index.php` invece di un tenant.

Ordine della tenant detection (solo se NON in platform mode):

1. `?_studio=slug` (override dev) — viene memorizzato in
   `$_SESSION['_dev_studio']` per rimanere persistente
2. `studios.dominio` matchato esattamente con `$_SERVER['HTTP_HOST']`
3. Subdomain (es. `studio1.host.it` → slug `studio1`)
4. `DEFAULT_STUDIO_SLUG` (`portal`) come fallback
5. Primo studio attivo

Una volta trovato, definisce le costanti `DB_HOST`, `DB_NAME`, `DB_USER`,
`DB_PASS`, `STUDIO_ID`, `STUDIO_SLUG`, `APP_NAME`, `APP_URL`.

`Database::getInstance()` apre poi la connessione al tenant attivo.

## Auth & sicurezza

### `AuthController::richiediLogin($ruoloMinimo)`

Da chiamare in cima a OGNI pagina protetta. `'cliente'` accetta tutti i
loggati, `'operatore'` solo i ruoli interni. Verifica anche:

- Sessione scaduta (>2h inattività)
- Operatori (esclusi admin) bloccati su `/public/*` per evitare ambiguità
- **Blocco POST** automatico se è in corso un'ispezione superadmin
- **Validazione CSRF automatica** su ogni POST (eccetto whitelist) — vedi sezione "CSRF" sotto

### Brute-force protection sul login

[`public/login.php`](public/login.php) + [`AuthController::stateRateLimit`](src/controllers/AuthController.php) +
tabella `login_attempts(email, ip, successo, ts)`.

Soglie (`AuthController` costanti):

- **0-4 fail / 15 min** → login normale
- **5-9 fail** → richiede captcha math (operandi random 1-9, token HMAC firmato, validità 10 min)
- **10+ fail** → lockout 15 min con messaggio specifico
- **20+ fail/h sullo stesso IP** → email-alert ad admin/direzione (cooldown 1h, evento `login_brute_force` in `notifiche_default.php`)

Il captcha è auto-contenuto (no reCAPTCHA né dipendenze esterne):
`AuthController::generateCaptcha()` produce `{q: "5 + 3 = ?", token}` dove
il token è `base64(payload).hmac_short` con payload firmato in `captchaKey()`
(seed = `GROQ_API_KEY + session_name + hostname`). `verifyCaptcha()` verifica
firma, scadenza e match della risposta.

Cleanup automatico via [`bin/cron-cleanup-security.php`](bin/cron-cleanup-security.php)
(daily 04:00) — pulisce login_attempts >7gg + telegram_tokens scaduti +
password_reset >24h. Su tutti i tenant attivi.

### 2FA TOTP per ruoli interni

Implementato con `robthree/twofactorauth` (già in vendor). Wrapper in
[`src/services/TotpService.php`](src/services/TotpService.php).

**Schema** ([users](migrations/01_studio_template.sql)):

- `totp_secret VARBINARY(64)` — base32, valorizzato dopo verify
- `totp_enabled TINYINT` — flag attivo
- `totp_recovery_codes JSON` — array di 8 hash bcrypt (one-time-use)
- `totp_enabled_at DATETIME`

**Setup** ([/admin/profilo](admin/profilo.php) tab "Sicurezza"):

1. Bottone "Attiva 2FA" → genera secret + 8 recovery codes (sessione, NON in DB ancora)
2. Pagina mostra: QR code (generato lato client con qrcodejs CDN, niente terze parti che vedono il secret) + codice manuale + recovery codes (visibili UNA SOLA VOLTA)
3. Utente inserisce primo OTP → verifica → INSERT in DB con `totp_enabled=1`
4. Audit log `totp_attivato`

**Login** ([/login](public/login.php) → [/login-2fa](public/login-2fa.php)):

1. Step 1: email+password normali. Se `totp_enabled=1`, NON setta `user_id`; setta `totp_pending_uid` + scadenza 5 min + IP-binding.
2. Step 2: form 6 cifre con autocomplete `one-time-code` (iOS/Android suggeriscono il codice). Toggle "Usa recovery code" per fallback (consuma il codice).
3. Max 5 tentativi 2FA per pending session; al 6° → kick out e ritorno al login.
4. On success: `session_regenerate_id(true)` + `Csrf::rotate()` per anti-fixation.

**Disattivazione**: tab Sicurezza → password attuale + 1 OTP corrente per conferma. Audit log `totp_disattivato`.

### Passkey / WebAuthn (FIDO2)

2° fattore alternativo al TOTP. Usa il riconoscimento biometrico del
dispositivo (Face ID, Touch ID, Windows Hello) o security key fisica
(YubiKey). Più sicure perché resistenti al phishing.

**Stack**: `web-auth/webauthn-lib` v5.x + Symfony Serializer.

**Schema** (per-tenant, `migrations/14_passkey.sql`):

- `webauthn_credentials(user_id, credential_id, public_key, transports, aaguid, sign_count, label)`

**Service**: [`PasskeyService`](src/services/PasskeyService.php) — wrapper che
gestisce sia il flusso 2FA pending (utente già noto) sia quello **passwordless
discoverable** (utente risolto dal `credential.id` → `userHandle`).

**Endpoint**:

- `/api/passkey-register-options` + `/api/passkey-register-verify` (autenticato)
- `/api/passkey-login-options` (durante 2FA pending) + `/api/passkey-login-discoverable-options` (utente non noto)
- `/api/passkey-login-verify` — completa il login, gestisce sia caso pending sia discoverable
- `/api/passkey-delete`

**RP ID** = host completo del tenant (es. `rossi.studiodesk.cloud`). Le
passkey sono per-dominio: una passkey di un tenant non funziona su un altro.

**UI**: Profilo → tab Sicurezza → sezione "Passkey · login senza password"
(prima del 2FA, perché è il metodo più moderno consigliato). Stesso pattern
visuale del 2FA: box verde se attive, box ambra se nessuna registrata.

### 2FA + Passkey per superadmin

Specchio del 2FA/Passkey tenant ma agganciato al pannello platform-wide
(DB master, sessione separata, RP ID fisso al dominio platform).

**Schema** ([migrations/20_superadmin_security.sql](migrations/20_superadmin_security.sql)):

- `superadmin_users` esteso con `totp_secret` / `totp_enabled` / `totp_recovery_codes` / `totp_enabled_at`
- nuova tabella `superadmin_webauthn_credentials` con FK su `superadmin_users(id)` ON DELETE CASCADE

**Servizi**:

- TOTP riusa [`TotpService`](src/services/TotpService.php) (stateless)
- Passkey: nuovo wrapper [`SuperadminPasskeyService`](src/services/SuperadminPasskeyService.php)
  con `_portal_master_pdo()`, tabella separata, sessione separata
  (`sa_passkey_*`), userHandle namespace `master:<id>`, RP ID fisso a
  `PLATFORM_HOSTS[0]` (= `studiodesk.cloud`). In dev (`localhost`/`*.local`/IP)
  usa l'host corrente come fallback.

**Flusso login** ([superadmin/auth.php](superadmin/auth.php)):

- `superadminLoginStep1(email, password)` ritorna
  `['ok'=>true, 'pending_2fa'=>true, 'uid'=>N]` se l'utente ha 2FA attivo
  o almeno una passkey, altrimenti completa il login subito.
- `superadminCompletaLogin($id)` setta `$_SESSION['superadmin_*']`,
  fa `session_regenerate_id(true)` + `Csrf::rotate()`, pulisce `sa_2fa_*`.
- [superadmin/login-2fa.php](superadmin/login-2fa.php) — step 2: form OTP
  (toggle "recovery code") + bottone "Accedi con passkey" se l'utente ne ha.
  Stato pending in `$_SESSION['sa_2fa_pending_uid']` (5 min, IP-binding,
  max 5 tentativi). Se entrambi i metodi attivi, l'UI mostra divider "oppure".

**Endpoint passkey** (sotto `/superadmin/`, non `/api/`, perché autenticati
contro `superadmin_*`):

- `passkey-register-options` / `passkey-register-verify` — autenticati
- `passkey-login-options` / `passkey-login-verify` — usano `sa_2fa_pending_uid`
  (no autenticazione completa, ma sessione pending valida)
- `passkey-delete` — autenticato

**UI** ([superadmin/profilo.php](superadmin/profilo.php)) — pagina con stile
`sa.css` (dark theme): card "Account" + card "Passkey" + card "2FA TOTP".
Pulsante setup 2FA mostra QR + recovery codes (visibili una sola volta).
La voce è raggiungibile dal user-pill nel topbar (cliccabile, evidenziato
quando attivo). Audit log: `totp_attivato`, `totp_disattivato`,
`passkey_registrata`, `passkey_eliminata`, `login_2fa`, `login_passkey`.

### Web Push notifications

**Stack**: `minishlink/web-push` v10.x + service worker `public/sw.js`.

**Schema** (per-tenant): `push_subscriptions(user_id, endpoint, p256dh, auth, user_agent)`.

**VAPID keys** in `master.php` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`). La pubblica è esposta al browser, la privata firma le
notifiche dal server.

**Service**: [`PushNotifyService`](src/services/PushNotifyService.php) —
`registra()`, `rimuovi()`, `inviaABroadcast()`. Pulisce automaticamente gli
endpoint scaduti (404/410).

**UI**: Profilo cliente → tab Notifiche → toggle "Notifiche push del browser".
Richiede consenso del browser e service worker registrato.

**Trigger**: per ora solo circolari con priorità `alta` o `urgente` vengono
broadcast via Push. Espandibile ad altri eventi (es. nuove comunicazioni,
scadenze imminenti) chiamando `PushNotifyService::inviaABroadcast` dal flow
appropriato.

### AI Privacy — 4 livelli di protezione

Tutte le chiamate a provider AI esterni (Groq, USA-based) passano per il
nuovo helper [`AIPolicy`](src/helpers/AIPolicy.php) che applica 4 layer:

1. **Toggle tenant** (`impostazioni.ai_features_enabled`, default 1).
   `AIPolicy::guard()` chiamato in tutti i 13 endpoint AI; se 0 → 403 JSON
   "AI disattivate dall'amministratore". UI in `/admin/impostazioni` → tab
   "🤖 AI &amp; Privacy".
2. **Consenso utente** (`user_preferenze.ai_consent_at`, valido 1 anno).
   `window.AIConsent.ensure(label)` in `public/assets/portal.js` mostra un
   modal one-time prima di chiamare l'AI. Wrappa Smart Reply, Riassumi
   thread, AI Polish (i 3 endpoint con dati cliente più sensibili).
3. **Pseudonimizzazione automatica** (`AIPolicy::pseudonimizza`). Sostituisce
   CF, P.IVA, IBAN, email, telefoni con placeholder `[CF]`, `[PIVA]`, ecc.
   prima dell'invio. Applicata centralmente in `chiamaGroq()` di
   `CircolariAIService` e `eseguiChiamata()` di `AIService`, più nei 3
   endpoint diretti (`ai-cliente`, `ai-polish`, `kb-genera-ai`). Nomi e
   cognomi NON sono pseudonimizzati (richiederebbe NER).
4. **Audit log metadati** (tabella `ai_audit`). `AIPolicy::audit()` registra
   user_id, endpoint, dimensioni payload (in/out), latenza ms, esito ok/err.
   **Nessun payload viene loggato** — solo metadati per compliance GDPR.
   Vista admin in `/admin/ai-audit` (solo admin/direzione).

I 13 endpoint coperti:

- Circolari: `circolare-ai-{migliora,genera}`, `circolare-{summary,suggest-tags,compliance-check,quiz}`, `circolare-modelli`
- Comunicazioni: `comunicazione-summary`, `com-smart-reply`, `ai-polish`
- Documenti: `documento-classifica`
- KB & Cliente: `ai-cliente`, `kb-genera-ai`

**Nota sul confine `Storage::upload` ↔ AI**: `Storage::upload` NON
chiama mai `AIPolicy::guard` né innesca la classificazione AI. La
classificazione di un documento è sempre **azione esplicita** lanciata
dall'operatore via `/api/documento-classifica` (che a sua volta ha il
proprio `AIPolicy::guardWithBudget()`). Lato upload restano solo i
controlli "tradizionali": MIME magic bytes, ClamAV best-effort, quota
piano.

Privacy policy aggiornata in `/platform/legal.php?doc=privacy` con
sezione 7 "Funzionalità AI e trasferimento dati extra-UE" (SCC, opt-out,
diritto di opposizione).

### CSRF protection

Helper [`Csrf`](src/helpers/Csrf.php) caricato globalmente da `config.php`.

**API**:

- `Csrf::token()` — token sessione (64 hex char, generato lazy)
- `Csrf::field()` — `<input type="hidden" name="_csrf" value="...">` da incollare in ogni form POST
- `Csrf::check()` — valida (POST `_csrf` o header `X-CSRF-Token` o JSON body `_csrf`); 403 se invalid
- `Csrf::rotate()` — chiamato a login/logout per anti-fixation
- `Csrf::isExempt($path)` — whitelist (webhook Telegram, form contatti landing)

**Validazione automatica**: `AuthController::richiediLogin()` chiama `Csrf::check()` su ogni POST
non in whitelist. Quindi qualsiasi pagina protetta è automaticamente coperta — basta che il
form ABBIA il `<?= Csrf::field() ?>`.

**Auto-injection AJAX**: [`portal.js`](public/assets/portal.js) avvolge `window.fetch` per
aggiungere `X-CSRF-Token: window.PORTAL_CSRF` a ogni POST/PUT/PATCH/DELETE same-origin se
l'header non è già presente. `window.PORTAL_CSRF` è esposto da:

- [`admin/sidebar.php`](admin/sidebar.php)
- [`public/sidebar-cliente.php`](public/sidebar-cliente.php)
- [`superadmin/_topbar.php`](superadmin/_topbar.php)

**Modalità di enforcement** (in `master.php`):

- `CSRF_MODE = 'log'` (default attuale, soft-rollout): valida ma se invalid logga in `error_log`
  e LASCIA PASSARE. Permette di scoprire form/AJAX che non hanno ancora il token.
- `CSRF_MODE = 'enforce'`: rifiuta con 403 + messaggio HTML/JSON.
- **Da flippare a `'enforce'`** dopo aver verificato i log per qualche giorno (cerca `[CSRF SOFT]`).

**Codemod**: 96 form in 31 file aggiornati con `<?= Csrf::field() ?>` via script
`/tmp/inject-csrf.php` (idempotente, riapplicabile in sicurezza).

### `AuthController::homeUrlPerRuolo($ruolo)`

Single source of truth per il "dove atterra l'utente":

- `cliente` → `/dashboard`
- `operatore` / `capoufficio` → `/admin/comunicazioni` (ruoli operativi, niente cruscotto)
- `admin` / `direzione` / `responsabile` → `/admin/home` (cruscotto direzionale)

Usato da: `AuthController::login()`, redirect "operatore-su-public", banner ispezione
("Esci"), CTA della landing pubblica, redirect dei controller admin-only e fallback
del POST-blocked. Lato JS lo specchio è in `portal-tour.js` (`HOME_URL_PER_RUOLO`).
Sidebar admin imposta `window.PORTAL_USER_ROLE` per i tour contestuali.

### Ruoli operativi vs manageriali

Costanti single-source-of-truth in [AuthController](src/controllers/AuthController.php)
per le query "chi può essere usato in questa azione":

| Costante          | Ruoli inclusi                                           | Quando usarla                                                                                                   |
| ----------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `RUOLI_OPERATIVI` | `responsabile`, `operatore`, `capoufficio`              | Dropdown assegnazione ticket, validazione `assegnaOperatore`, KPI carico operatori, pulsante "Prendi in carico" |
| `RUOLI_RFM`       | `direzione`, `responsabile`, `operatore`, `capoufficio` | Dropdown "Operatore di riferimento" scheda azienda, candidati membri portafoglio                                |
| `RUOLI_INTERNI`   | tutti i 5 ruoli interni                                 | Ricerca utenti, ACL "è interno", KPI gestionali aggregati, notifiche catch-all                                  |

Helper `AuthController::ruoloInWhere(array $ruoli, string $col = 'ruolo')` ritorna
`[whereSql, params]` da appendere a una prepared statement:

```php
[$w, $p] = AuthController::ruoloInWhere(AuthController::RUOLI_OPERATIVI, 'u.ruolo');
$stmt = $db->prepare("SELECT id FROM users u WHERE $w AND u.attivo = 1");
$stmt->execute($p);
```

**Principio**: `admin` e `direzione` sono ruoli di **configurazione, supervisione,
governance** — non di lavoro operativo. Mostrarli nei dropdown "assegna ticket"
o "operatore di riferimento" inquina l'attribuzione di responsabilità (un ticket
"assegnato all'admin" è quasi sempre un click sbagliato). Esclusi sistematicamente
dalle regole operative; restano nelle ricerche, nei KPI aggregati e nei catch-all.

**Eccezioni esplicite (D5 spec)**:

- `emailOperatoriResponsabili(null)` in `ComunicazioneController` → ticket non
  preso: la mail va a `admin+direzione` (è gestionale, deve sapere che nessuno
  l'ha preso). Comportamento corretto.
- Webhook Telegram/WhatsApp inbound fallback: lista `RUOLI_INTERNI` per
  notifica di emergenza. Corretto (catch-all).
- Filtri facet ricerca aziende, KPI count `operatori_totali`, ACL `isInterno`:
  `RUOLI_INTERNI` invariato.

**RFM storico**: se un'azienda ha `operatore_riferimento_id` puntato a un admin
(da prima del refactor), il valore resta nel DB ma il dropdown non lo mostra più.
[`_az-anagrafica.php`](admin/_az-anagrafica.php) mostra un banner ambra "Operatore
di riferimento storico" che invita a riassegnare. Nessuna migrazione automatica.

**Audit code**: `assegnazione_negata_ruolo_manageriale` viene loggato quando un
admin/dir tenta POST `prendi_in_carico` (difesa profonda — il pulsante non è
mostrato a quei ruoli, ma un curl manuale viene rifiutato server-side).

Spec dettagliata: [docs/prompt-ruoli-operativi.md](docs/prompt-ruoli-operativi.md).

### Security headers (CSP, HSTS, ecc.)

Layer Apache (statico) + layer PHP runtime (stateful).

**Apache** — `/etc/apache2/conf-available/portal-security-headers.conf` (copia
versionata in [`ops/apache/portal-security-headers.conf`](ops/apache/portal-security-headers.conf)).
Header impostati:

- `Content-Security-Policy` con `upgrade-insecure-requests`, `frame-ancestors 'self'`,
  `object-src 'none'`, CDN whitelist (`cdn.jsdelivr.net`, `fonts.googleapis.com`,
  `fonts.gstatic.com`). Direttiva con flag `Header setifempty` per il CSP, così
  PHP override pulito (vedi sotto "CSP nonce hardening"); le altre direttive
  restano `Header always set`.
- `Strict-Transport-Security`: 1 anno + `includeSubDomains` (solo su HTTPS effettivo via `expr`)
- `X-Frame-Options: SAMEORIGIN` (back-compat per CSP3), `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` comprehensive (19 directive — camera/microphone/geolocation/payment/USB/ecc.
  tutte off; `fullscreen=(self)`, `publickey-credentials-get=(self)` per WebAuthn passkey)
- `Cross-Origin-Opener-Policy: same-origin-allow-popups` (preserva apertura `t.me/<bot>` per Telegram link)
- `Cross-Origin-Resource-Policy: same-origin`, `X-Permitted-Cross-Domain-Policies: none`
- `Header unset X-Powered-By` + `Header unset Server` per ridurre fingerprinting

Dopo modifiche: `sudo apache2ctl configtest && sudo systemctl reload apache2`.

**PHP runtime** — [`src/helpers/SecurityHeaders.php`](src/helpers/SecurityHeaders.php) per
header che dipendono dallo stato applicativo:

- `applyAuthCacheControl()` → chiamato da `AuthController::richiediLogin()`. Imposta
  `Cache-Control: no-store, no-cache, must-revalidate, private` + `Pragma: no-cache` su tutte
  le pagine autenticate. Impedisce che dati sensibili restino nella cache del browser
  dopo logout/back-button.
- `applyClearSiteData()` → chiamato da `AuthController::logout()`. Emette
  `Clear-Site-Data: "cache","cookies","storage"` forzando wipe browser-side.

**SRI (Subresource Integrity) sui CDN**: tutti i `<link>` / `<script>` esterni hanno
`integrity="sha384-..." crossorigin="anonymous"`. Se jsDelivr venisse compromesso, il
browser rifiuta gli asset. Asset attualmente coperti: Bootstrap 5.3.0 CSS+JS,
Bootstrap 5.3.2 CSS, Bootstrap Icons 1.11.0, qrcodejs 1.0.0.

**Per ricalcolare un hash SRI**:

```bash
curl -sf https://cdn.jsdelivr.net/npm/PACCHETTO@VERSIONE/path/file.js | openssl dgst -sha384 -binary | openssl base64 -A
# → output: hash da incollare come integrity="sha384-<hash>"
```

**Aggiungere un nuovo CDN**: (1) ricalcola hash come sopra; (2) aggiungi l'host nella
direttiva `script-src`/`style-src` di `/etc/apache2/conf-available/portal-security-headers.conf`

- ricarica Apache; (3) usa `integrity="sha384-..." crossorigin="anonymous"` sui tag.

### CSP nonce hardening (Livello A)

Da maggio 2026 il CSP usa **nonce per-request** invece di `'unsafe-eval'` +
`'unsafe-inline'` puro. Riduce ~95% del rischio XSS reale a parità di compatibilità.

**Componenti**:

- [`src/helpers/Csp.php`](src/helpers/Csp.php) — `Csp::nonce()` (singleton
  per-request, base64 16-byte random URL-safe) + `Csp::sendHeader()` che emette
  il CSP via PHP, sovrascrivendo l'Apache `setifempty`.
- [`src/config/config.php`](src/config/config.php) — chiama `Csp::sendHeader()`
  ASAP, prima di qualsiasi output PHP.
- [`ops/apache/portal-security-headers.conf`](ops/apache/portal-security-headers.conf)
  — il CSP statico è ora `Header setifempty` (non `always set`): PHP override
  pulito per response dinamiche, Apache fa fallback per asset statici / pagine
  errore.
- Tutti i `<script>` inline del codebase (107 occorrenze su 86 file PHP) hanno
  `nonce="<?= Csp::nonce() ?>"`. Sed massivo applicato una volta.
- Heredoc PHP (`<<<HTML`) NON interpreta `<?= ?>` — usare `{$nonce}` con
  `$nonce = Csp::nonce();` prima dell'heredoc (vedi `src/wizard/Wizard.php`).

**Policy attuale**:

```
default-src 'self'
script-src 'self' 'nonce-X' 'unsafe-inline' https://cdn.jsdelivr.net
script-src-attr 'unsafe-inline'              ← per ~388 onclick/onchange inline
style-src 'self' 'unsafe-inline' ...          ← stili inline ancora permessi
...
report-uri /api/csp-report
```

- `'unsafe-eval'` **rimosso** (verificato 0 `eval()`/`new Function()`/`setTimeout-string` nel codebase JS).
- `'unsafe-inline'` su `script-src` è IGNORATO dai browser CSP2+ quando `nonce-X` è presente
  → gli `<script>` inline non noncati sono bloccati.
- `script-src-attr 'unsafe-inline'` lascia passare i 388 inline handlers
  (`onclick=`, `onchange=`, ecc.) — alternativa Livello B/C richiede refactor
  in `addEventListener`.

**Quando scrivi un nuovo `<script>` inline** in un template PHP:

```html
<script nonce="<?= Csp::nonce() ?>">
  console.log('nuovo script inline');
</script>
```

Senza nonce → bloccato dai browser moderni con un `securitypolicyviolation`.

### Health check `/healthz`

Endpoint pubblico [`public/healthz.php`](public/healthz.php) (rotta `/healthz`)
per monitoring esterno. NO auth, leggero, no cache.

Verifica:

1. PHP-FPM risponde
2. MySQL master (SELECT 1, timeout 3s)
3. Conteggio tenant attivi (sanity check schema)
4. MySQL tenant default (portal)
5. Spazio disco (`warn` <15%, `fail` <5%)
6. Path scrivibili (`uploads/`, `storage/`, `storage/docs`)

Output JSON strutturato:

```json
{
  "status": "ok",           // | "degraded" | "down"
  "elapsed_ms": 3,
  "host": "fiscai-dev",
  "checks": {
    "php": {"state":"ok"},
    "mysql_master": {"state":"ok","ms":1},
    ...
  }
}
```

HTTP 200 per `ok`/`degraded`, HTTP **503** per `down` (qualsiasi check fail).
Monitor esterno (Better Stack) lo usa con keyword match su `"status": "ok"`.

**Nota implementativa**: `Csp::sendHeader()` viene chiamato anche su `/healthz`
(ereditato da `config.php`), ma è solo un header in più — nessun impatto sui
probe esterni. Le funzioni in healthz usano `closure` (`$addCheck = function ...`)
e NON `global` perché healthz viene incluso da `Router::dispatch` (lo scope
non è global — regola documentata sopra).

### Monitoring esterno + status page

Servizio: **Better Stack** (Better Uptime + Status pages, free tier 10 monitor).

- Monitor 1: `https://portal.studiodesk.cloud/healthz` con keyword check
  `"status": "ok"` — copre il pannello tenant + DB + disco.
- Monitor 2: `https://www.studiodesk.cloud/` "URL becomes unavailable" —
  copre la landing platform.
- Status page pubblica: rinominate "Pannello clienti" + "Sito web", URL
  da girare ai pilota.
- Alert email automatici quando `/healthz` non risponde o non contiene
  `"status": "ok"` (cattura sia 503 down sia 200 `degraded`).

Guida operativa completa in [`MONITORING-AND-BACKUP-SETUP.md`](MONITORING-AND-BACKUP-SETUP.md).

### Backup off-site Backblaze B2 (predisposto, non attivo)

Lo script di sync notturno è installato ma il cron è **disabilitato per default**
(riga commentata in `/etc/cron.d/portal-backup-offsite`).

- [`bin/cron-backup-offsite-b2.sh`](bin/cron-backup-offsite-b2.sh): rclone sync
  `/var/backups/portal/` → `b2:studiodesk-backups/` con `--backup-dir` per
  versioning rollback + retention 90gg + sanity checks (rclone configurato +
  bucket raggiungibile + backup locali esistono).
- Costo stimato per 10-50 GB: **<1€/mese** (storage $0.006/GB + download gratis
  fino a 3× storage).
- Setup completo (rclone config + bucket creation + test + attivazione cron):
  vedi [`MONITORING-AND-BACKUP-SETUP.md`](MONITORING-AND-BACKUP-SETUP.md).
- **Per attivare** dopo aver configurato rclone:
  ```bash
  sudo sed -i 's|^# 30 4|30 4|' /etc/cron.d/portal-backup-offsite
  sudo systemctl reload cron
  ```

### MIME validation upload documenti

[`Storage::upload()`](src/helpers/Storage.php) fa cross-check estensione ↔ MIME via
magic bytes (`finfo_open(FILEINFO_MIME_TYPE)` con fallback `mime_content_type`). La
mappa `MIME_OK` in `src/helpers/Storage.php` definisce per ogni estensione quali MIME
sono accettabili. Office files (DOCX/XLSX/PPTX) accettano sia il MIME OOXML ufficiale
sia `application/zip` (sono ZIP container).

Difesa contro file-type masquerading: un `.exe` rinominato in `.pdf` viene rilevato
perché i magic bytes non corrispondono a `application/pdf`. **Mai fidarsi di
`$_FILES['type']`**: il client lo controlla.

**Scansione antivirus**: superato il check MIME e prima della scrittura su
disco, `Storage::upload()` passa il file temporaneo a `Storage::scanVirus()`
→ `clamdscan --fdpass` (demone ClamAV `clamav-daemon`; fallback `clamscan`
on-demand). File infetto → `RuntimeException`, upload rifiutato e file
scartato. Se nessuno scanner è installato o il demone non risponde lo scan è
**best-effort**: logga e lascia passare (un AV assente non deve rompere gli
upload). È una difesa in più, non l'unica — restano whitelist estensioni,
cross-check MIME e quota.

### Rate-limit endpoint pubblici con token URL

Endpoint con token URL (reset password, accept invito) sono protetti da
[`RateLimit`](src/helpers/RateLimit.php). Pattern:

```php
$ip   = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$rlT  = RateLimit::state("prefisso:tok:" . substr($token, 0, 32), 60, 10);  // 10/h per token
$rlI  = RateLimit::state("prefisso:ip:$ip", 60, 30);                         // 30/h per IP
if (!$rlT['ok'] || !$rlI['ok']) { /* soft-fail, log, skip-post */ }
RateLimit::log("prefisso:tok:..."); RateLimit::log("prefisso:ip:$ip");
```

Coperti: [`/reset-password`](public/reset-password.php), [`/registrati`](public/registrati.php).

### Accessibilità (WCAG)

- **Skip-link** "Vai al contenuto" auto-iniettato da [`portal.js`](public/assets/portal.js)
  al `DOMContentLoaded`. Visibile solo su `:focus` (Tab dalla prima posizione). Targeta
  il primo `.main` aggiungendo `id="mainContent"` + `tabindex="-1"`. WCAG 2.4.1.
- **Focus-visible** uniforme su `[role="button"]` e `[tabindex]` (oltre ai default già
  presenti per button/a/input).
- **Scrollbar tematizzata in dark mode** (Firefox `scrollbar-color` + WebKit `::-webkit-scrollbar*`).
- **`@media (prefers-reduced-motion: reduce)`** — animazioni a 0.01ms e
  `scroll-behavior: auto` per chi ha preferenze sistema anti-motion.

### Modalità ispezione

Il superadmin può "entrare" in qualsiasi studio (link
`/superadmin/ispeziona?studio_id=N&come=admin|cliente`). L'endpoint:

1. Imposta `$_SESSION['user_id']`/`user_ruolo`/... con i dati dell'utente
   target del studio
2. Imposta `$_SESSION['_dev_studio']` per forzare il tenant
3. Imposta `$_SESSION['superadmin_inspecting']` come marker

Da quel momento `AuthController::isModalitaIspezione()` ritorna `true` e:

- **Tutti i POST** (eccetto sotto `/superadmin/*`) vengono bloccati
  automaticamente in `richiediLogin()` (chiamando
  `bloccaScritturaSuperadminInspect()`)
- `topbar.php` (admin e cliente) mostra avatar viola "SA" e menu utente con
  "Esci ispezione"
- `banner-ispezione.php` mostra la striscia viola in basso
- La sezione **Credenziali demo** (se attiva) viene **nascosta** in ispezione

`/superadmin/esci-ispezione` ripulisce la sessione studio mantenendo i
campi `superadmin_*`.

Dalla pagina **Studi** ogni card ha 4 azioni: **Admin** (ispezione), **Cliente**
(ispezione), **Sito** (apre il sito pubblico in nuova scheda — no login,
vista come la vede un visitatore), **Modifica**.

### Editor landing platform (`/superadmin/landing-editor`)

Dal 2026-05-18 i contenuti della landing marketing `www.studiodesk.cloud` (file [platform/index.php](platform/index.php)) sono **editabili dal pannello** senza redeploy.

**Schema** ([migrations/23_platform_landing.sql](migrations/23_platform_landing.sql)) — in `portal_master`:

- `platform_landing(k VARCHAR PK, data JSON, updated_at, updated_by)`
- 9 chiavi: `hero`, `features_header`, `features_items`, `pricing_header`, `testimonials_header`, `testimonials_items`, `faq_header`, `faq_items`, `contact_header`
- Seed iniziale con i contenuti correnti (idempotente: `INSERT IGNORE`)
- Grant per `portal_master_user` (SELECT/INSERT/UPDATE/DELETE)

**Render** ([platform/index.php](platform/index.php)) — legge dal DB con fallback hardcoded se key/tabella mancano. Pattern: `$LND[$key] ?? []` + fallback `?: '...'` su ogni campo, garantisce che la landing funzioni anche senza seed applicato.

**Editor** ([superadmin/landing-editor.php](superadmin/landing-editor.php)):

- Sezione per ogni chiave, form strutturato (no JSON raw)
- Hero: titolo (parte normale + accent), lead, 2 CTA (label+href), trust items
- Features/Testimonianze/FAQ: lista item con sposta-su/giù + delete + add
- Color picker per gradient (HTML5 `<input type=color>` accoppiato a text)
- Save per-sezione (no commit globale)
- Bottone "Default": ripristina i valori del seed per quella sezione (re-esegue gli `INSERT IGNORE` della migration)
- Submit serializza form fields → JSON → POST con CSRF
- Audit log: `landing_edit` e `landing_reset` in `superadmin_audit`

**Cosa NON è editabile** (volutamente):

- I prezzi dei piani — vivono in [src/piani.php](src/piani.php) come codice (collegati a logica di provisioning, limiti, enforcement). L'header della sezione Prezzi sì editabile.
- Mockup hero (le card finte del browser screenshot) — pura decorazione, hardcoded.
- Form contatti — collegato a `/api/contatto.php`, non template-able.
- Footer — al momento hardcoded; aggiungibile come future `footer_*` key se serve.

**Accesso**: `/superadmin/sistema` → tile "Landing", oppure URL diretta `/superadmin/landing-editor`. Auth = `superadminGuard()`.

**Placeholder**: nel campo `testimonials_header.p` è supportato `{BRAND}` che viene sostituito a render-time con `PLATFORM_BRAND`.

### Pannello superadmin esteso (sicurezza/server/log)

Dal 2026-05-18 il pannello SA è strutturato in **6 tab principali** (più Backup/Aggiornamenti/Audit/Guida come pagine top-level raggiungibili da link/sotto-nav):

| Tab          | URL                                                      | Cosa fa                                                                   |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| 🏠 Dashboard | `/superadmin/dashboard`                                  | Overview, KPI, attività recente. Barra alert globale in cima.             |
| 🏢 Studi     | `/superadmin/studi`                                      | Lista tenant, creazione studio, ispezione.                                |
| 🔐 Sicurezza | `/superadmin/sicurezza?sub=ssh\|fail2ban\|ufw\|ssl`      | SSH brute-force monitor, fail2ban, UFW, certificati SSL.                  |
| 🖥️ Server    | `/superadmin/server?sub=risorse\|servizi\|rete\|console` | CPU/RAM/disco/load gauges, restart servizi, network, console diagnostica. |
| ⚙️ Sistema   | `/superadmin/sistema` + `/aggiornamenti` + `/backup`     | Info sistema, aggiornamenti apt, backup tenant.                           |
| 📋 Log       | `/superadmin/log?sub=azioni\|accessi\|php\|eventi`       | Audit cross-tenant, login CRM, errori PHP, eventi sistema.                |

#### Architettura

- **Backend pages**: [`superadmin/sicurezza.php`](superadmin/sicurezza.php), [`superadmin/server.php`](superadmin/server.php), [`superadmin/log.php`](superadmin/log.php) — wrapper PHP con sotto-tab orizzontali ([superadmin/\_widgets/sotto-tab.php](superadmin/_widgets/sotto-tab.php)). I dati live sono caricati via JS.
- **API JSON** (sotto `/api/superadmin/`):
  - [`monitor.php`](api/superadmin/monitor.php) — `GET` unificato. Query `?tab=alerts|ssh|fail2ban|ufw|ssl|resources|services|network|log_php|log_eventi|ip_info`.
  - [`action.php`](api/superadmin/action.php) — `POST` con whitelist azioni. Re-auth obbligatoria per azioni critiche.
- **Helper sicuri**:
  - [`SuperadminShell.php`](src/helpers/SuperadminShell.php) — wrapper unico per `proc_open` con whitelist binari+sub-comandi, `escapeshellarg()` su ogni argomento, timeout per comando, audit log automatico delle AZIONI (non delle letture).
  - [`SuperadminParser.php`](src/helpers/SuperadminParser.php) — parser dell'output di fail2ban/ufw/ss/df/ps/openssl/certbot/auth.log/ufw.log in array PHP strutturati.
- **Services**:
  - [`GeoIPService.php`](src/services/GeoIPService.php) — geolocalizzazione IP via ip-api.com con cache DB 30gg. Batch fino a 100 IP/chiamata. Tabella `portal_master.geoip_cache`.
  - [`SuperadminNotifier.php`](src/services/SuperadminNotifier.php) — façade UNICA per audit + email a `PLATFORM_CONTACT_EMAIL` per azioni critiche. I controller chiamano SOLO `SuperadminNotifier::notify(...)`.
- **Re-auth critica** ([superadmin/auth.php](superadmin/auth.php)): `superadminCriticalChallenge(password, otp)` valida password+OTP e setta marker 5min in sessione. `superadminCriticalRequire()` esige la marker, altrimenti 401 JSON. Usata dalle azioni in `CRITICAL_ACTIONS` di `action.php`.
- **Widget condivisi** ([superadmin/\_widgets/](superadmin/_widgets/)): alert-bar, ban-ip, ip-info, service-badge, confirm-modal, console-output, sotto-tab — istanziati con `require` + variabili locali e pilotati da JS (`SA.openBanIp`, `SA.openIpInfo`, `SA.confirm`). La barra alert è inclusa automaticamente da `_topbar.php` (per saltarla: `$SA_HIDE_ALERT_BAR = true;`). Il motore `sa-core.js` è caricato **globalmente nel `<head>` di `_topbar.php`** (non più solo dalle pagine monitor): la barra vive su OGNI pagina SA e senza sa-core.js resterebbe su "Caricamento stato sistema…". È **idempotente** (`window.__saCoreLoaded`), quindi le pagine che lo includono ancora a fine body non lo re-inizializzano (niente doppio polling).

#### Frontend (vanilla JS, no librerie)

| File                                                             | Cosa fa                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`sa-core.js`](public/assets/sa-core.js)                         | Polling visibility-aware, toast, fetch wrapper con CSRF auto, barra alert globale (auto-refresh 30s + badge nav), `SA.openIpInfo`, `SA.openBanIp`. **Caricato globalmente dal `<head>` di `_topbar.php`**, idempotente (`window.__saCoreLoaded`). |
| [`sa-charts.js`](public/assets/sa-charts.js)                     | Canvas API minimali: `line`, `line2`, `bar`, `donut`, `gauge`. Zero dipendenze.                                                                                                                                                                   |
| [`sa-actions.js`](public/assets/sa-actions.js)                   | Dispatcher delegato per `[data-action]` con conferme progressive (warn → reason → type-token → reauth → countdown). Driver di `confirm-modal.php`.                                                                                                |
| [`sa-security-monitor.js`](public/assets/sa-security-monitor.js) | Refresh dati di SSH/Fail2ban/UFW/SSL ogni 30s.                                                                                                                                                                                                    |
| [`sa-server-monitor.js`](public/assets/sa-server-monitor.js)     | Refresh risorse (10s) e servizi/rete (20s). Console exec form.                                                                                                                                                                                    |
| [`sa-log-monitor.js`](public/assets/sa-log-monitor.js)           | Tab "Errori PHP" (legge `/var/log/php8.2-fpm.log` via sudo) + "Eventi sistema" (aggrega auth/ufw/fail2ban per timestamp, **paginato** 25/pag client-side).                                                                                        |

#### Sicurezza implementativa (4 strati)

1. **PHP**: tutta la logica passa per `SuperadminShell` con whitelist, `escapeshellarg`, validazione `SuperadminShell::validateArg($value, $type)` per IP, jail, port, service_restart, cert_name, ecc.
2. **Sudoers**: [`bin/portal-superadmin.sudoers`](bin/portal-superadmin.sudoers) — `www-data` può eseguire SOLO i binari elencati (fail2ban-client, ufw, systemctl restart/status di servizi specifici, sysctl drop_caches, tail dei log, certbot). NO `kill`, NO `crontab`, NO `ufw disable`.
3. **Critical Re-auth**: le azioni in `CRITICAL_ACTIONS` di `action.php` (stop fail2ban, unban_all, svc_restart, drop_caches, certbot_renew_force, console_exec, ufw_delete) richiedono password (+OTP se 2FA attivo).
4. **Audit**: ogni azione finisce in `superadmin_audit` via `SuperadminNotifier::notify()`. Le azioni in `SuperadminNotifier::CRITICAL_EVENTS` triggerano anche email a `PLATFORM_CONTACT_EMAIL`.

#### Schema DB ([migrations/22_superadmin_security.sql](migrations/22_superadmin_security.sql))

Tutto in `portal_master`:

- `geoip_cache` — cache geolocalizzazione IP (TTL 30gg)
- `ip_ban_history` — storico ban con motivo + esito
- `superadmin_console_log` — log dedicato console (`ping`/`traceroute`/`dig`/`nslookup`)
- `server_metrics` — snapshot CPU/RAM/load per grafici storici (da popolare con cron 1-5min, opz.)
- `ssh_attempts_hourly` — pre-aggregazione tentativi SSH per IP+ora (da popolare con parser cron, opz.)

#### Installazione sudoers

```bash
sudo bash /var/www/portal/bin/install-superadmin-sudoers.sh
```

Lo script: (1) valida la sintassi via `visudo -cf`, (2) installa in `/etc/sudoers.d/portal-superadmin` con `install -m 0440 -o root -g root`, (3) testa una chiamata reale (`fail2ban-client status` da `www-data`). **Senza questa installazione tutte le azioni del pannello sicurezza/server falliscono con "sudo: a password is required"**.

#### Vincolo namespace FPM: `ProtectSystem=full` (gotcha critico)

Il servizio `php8.2-fpm` gira con `ProtectSystem=full` (default Debian/Ubuntu): **`/etc` è
read-only nel namespace del servizio, anche per i processi che diventano root via `sudo`**
(la restrizione è sul mount namespace, non sull'uid). Casi reali:

- **SSL** (`?sub=ssl`): `certbot certificates` non poteva scrivere il lock
  `/etc/letsencrypt/.certbot.lock` → "Read-only file system" → il pannello mostrava
  "Nessun certificato". Fix: drop-in [`ops/systemd/php8.2-fpm-portal-letsencrypt.conf`](ops/systemd/php8.2-fpm-portal-letsencrypt.conf)
  con `[Service] ReadWritePaths=/etc/letsencrypt` + `daemon-reload` + `restart php8.2-fpm`.
  Stesso vincolo per "Rinnova ora" e, potenzialmente, per le scritture UFW (`/etc/ufw`).
- **Letture di file root-only** (`/var/log/php8.2-fpm.log`, `/etc/letsencrypt/live/*/cert.pem`):
  servono `sudo` (flag `true` nella whitelist `SuperadminShell::READS`) **+** la riga in
  `bin/portal-superadmin.sudoers` (reinstallare con `install-superadmin-sudoers.sh`). Senza
  ENTRAMBI → "Permission denied". Le letture in `/var/log` funzionano (è solo `/etc` ad essere
  read-only), ma il file dev'essere comunque root → serve sudo.

**Debug nel contesto FPM reale** — NON riproducibile con `sudo -u www-data php -r` (usa il
namespace normale con `/etc` scrivibile). Interrogare il socket FPM:

```bash
SCRIPT_FILENAME=/tmp/diag.php REQUEST_METHOD=GET cgi-fcgi -bind -connect /run/php/php8.2-fpm.sock
```

È così che è emerso il lock read-only di certbot (euid 33 + `/etc` read-only).

#### Decisioni di design (cosa **non** è incluso)

- **Disattivazione UFW dal pannello**: rimossa per ridurre il rischio operativo. Per disabilitare UFW serve SSH (`sudo ufw disable`).
- **Cron job CRUD**: solo viewer (rischio command injection troppo alto da UI).
- **Cancellazione log PHP**: solo rotation, no delete (mantenimento forensic).
- **Kill processo**: non esposto (rischio + complessità mappatura UID/perm).
- **CRM tab**: non implementato — gli utenti/sessioni/impostazioni sono **per-tenant** e si gestiscono tramite ispezione o `/admin/*`, non da SA.
- **Notifiche Telegram canale studio**: SA non ha un canale Telegram. Notifiche critiche via email a `PLATFORM_CONTACT_EMAIL`.

### Pannello superadmin (6 aree)

Il pannello è organizzato in pagine specializzate, raggiungibili dalle tab in
topbar (con hamburger su mobile). Tutte le pagine condividono `_topbar.php` +
`_topbar-end.php` e `public/assets/sa.css`. Ogni pagina apre con:

```php
require_once 'auth.php'; superadminGuard();
try { _portal_master_pdo()->query('SELECT 1')->fetchColumn(); }
catch (Throwable $e) { require __DIR__ . '/_standby.php'; exit; }
require_once __DIR__ . '/_helpers.php';
$SA_PAGE = 'studi'; $SA_TITLE = 'Studi';
require __DIR__ . '/_topbar.php';
// ... contenuto pagina ...
require __DIR__ . '/_topbar-end.php';
```

| Pagina            | URL                         | Cosa fa                                                                                                                                                                |
| ----------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**     | `/superadmin/dashboard`     | Stato sistema in testa, 4 KPI tenant-only (totali/attivi/inattivi/backup OK), banner alert backup problematici, ultimi 5 studi creati, ultime 6 attività audit         |
| **Studi**         | `/superadmin/studi`         | Lista completa con filtri stato (tutti/attivi/inattivi) + piano (base/pro/enterprise), ricerca live, card con stats per studio, 4 azioni (admin/cliente/sito/modifica) |
| **Audit**         | `/superadmin/audit`         | Log completo `superadmin_audit` con filtri tipo (tutti/ispezioni/gestione/sistema), filtro studio, ricerca libera, paginazione 10/pag                                  |
| **Sistema**       | `/superadmin/sistema`       | PHP/MySQL/uptime, disco con barra colorata, memoria, load average, dimensione DB per tenant ordinata DESC, riavvio server, eventi sistema recenti                      |
| **Aggiornamenti** | `/superadmin/aggiornamenti` | Gestione aggiornamenti apt: scansione, classificazione (urgente/importante/facoltativo), selezione e installazione async, banner reboot-required                       |
| **Guida**         | `/superadmin/guida`         | Documentazione superadmin (15 sezioni) — TOC sticky, scrollspy, export PDF                                                                                             |

**Helper condivisi** in `superadmin/_helpers.php`:

- `saTempoRel($dt)` — "5 min fa", "3 g fa", o data assoluta
- `saIniziali($nome)` — iniziali per avatar testuali
- `saInfoDisco()` — totale/usato/libero in GB + percentuale + classe
- `saInfoSistema()` — PHP, MySQL, uptime, kernel
- `saStudiPdo($studio)` — connessione PDO al DB di un tenant (null se fail)
- `saAuditIcona($azione)` / `saAuditDescrizione($a)` — render uniforme delle entry audit

**Stand-by page**: dopo un riavvio Apache è online prima di MySQL. Tutte le
pagine SA fanno un probe `SELECT 1` all'avvio: se fallisce, mostrano
`_standby.php` (HTTP 503 + meta refresh ogni 3s) invece di un fatal error.

### Provisioning di un nuovo studio

`/superadmin/crea-studio` (POST). Step:

1. Pre-check DB orfano (da tentativi precedenti falliti) → cleanup automatico
2. `CREATE DATABASE portal_<slug>` + `CREATE USER` + `GRANT ALL` solo sul DB
3. Import schema da `migrations/01_studio_template.sql`. **Strip dei commenti
   `-- ...` PRIMA dello split per `;`** — altrimenti chunks che iniziano con un
   commento di sezione vengono scartati e il `CREATE TABLE` successivo va
   perso (causa errori FK 1824).
4. Crea utente admin (bcrypt) nello studio
5. **Applica template grafico**: scrive `studio_colore_primario`,
   `studio_colore_scuro`, `studio_settore`, `studio_template`,
   `studio_iniziale` in `impostazioni`; aggiorna `studio_sezioni` di tipo
   `hero` con titolo/sottotitolo del template
6. Registra in `portal_master.studios` + audit

**Rollback automatico**: se uno step fallisce dopo `CREATE DATABASE`, il
sistema fa `DROP DATABASE` + `DROP USER` e mostra l'errore con suffisso
"(rollback automatico eseguito)" — niente DB orfani da pulire a mano.

**Privilegi MySQL richiesti**: l'utente `portal_provision` deve avere `ALL
PRIVILEGES ON *.* WITH GRANT OPTION`. I privilegi pattern-based (es.
`portal\_%`) **non sono accettati** da MySQL come sorgente per `GRANT` su un
DB specifico — è un comportamento by-design di MySQL.

### Ciclo di vita di uno studio (sospensione / cestino / eliminazione)

Da `/superadmin/studi` ogni card studio ha, oltre a ispezione/modifica, le
azioni di ciclo di vita. Logica centralizzata in
[`StudioLifecycleService`](src/services/StudioLifecycleService.php), usata sia
dalla pagina (web) sia dal cron di purge.

**Stati** (colonne aggiunte a `portal_master.studios` da
[migrations/51_studios_lifecycle.sql](migrations/51_studios_lifecycle.sql):
`sospeso_at`, `eliminato_at`, `purge_at`, `eliminato_da`):

| Stato       | Condizione                          | Effetto                                         |
| ----------- | ----------------------------------- | ----------------------------------------------- |
| Attivo      | `attivo=1`                          | operativo                                       |
| Sospeso     | `attivo=0 AND eliminato_at IS NULL` | inaccessibile, DB intatto, riattivabile         |
| Nel cestino | `eliminato_at IS NOT NULL`          | sospeso + purge schedulato a `purge_at` (+30gg) |
| Purgato     | riga rimossa                        | DB + storage eliminati                          |

**Azioni** (POST handler in cima a `superadmin/studi.php`, modal di conferma):

- **Sospendi** / **Riattiva** — toggle `attivo`. Conferma semplice.
- **Sposta nel cestino** — `eliminato_at=NOW()`, `purge_at=+30gg`. Richiede di
  digitare lo slug. Ripristinabile.
- **Elimina definitivamente** — purge immediato. Richiede slug + re-auth
  superadmin (`superadminCriticalChallenge`: password + OTP se 2FA attivo).
- **Ripristina** (dal cestino) — azzera `eliminato_at`/`purge_at`, `attivo=1`.

**Purge** (`StudioLifecycleService::purga`, da `eliminaSubito` e dal cron): (1)
dump finale DB+storage; (2) pota la cartella backup tenendo solo il dump
finale; (3) `DROP DATABASE` + `DROP USER` (gate critico: se fallisce si ferma
e ritenta); (4) `rm -rf` di `storage/docs/<slug>` + mirror; (5) archivia la
cartella in `/var/backups/portal/_eliminati/<slug>-<data>` — **fuori dal
namespace dei backup attivi, conservata per sempre** (l'unico backup che resta
dopo l'eliminazione); (6) `DELETE` della riga master. Anti perdita dati: se non
si riesce a creare un backup e il DB è ancora vivo, il purge si annulla.

**Cron** [`bin/cron-purge-studi.php`](bin/cron-purge-studi.php) (daily 05:00 in
`/etc/cron.d/portal-backup`) — Task 1: elimina gli studi nel cestino con
`purge_at` scaduto. Task 2: invia i promemoria pre-eliminazione. È anche la
rete di sicurezza dell'eliminazione immediata (che marca `purge_at=NOW()`
prima del purge sincrono).

**Email all'operatore di piattaforma** (`PLATFORM_CONTACT_EMAIL`, via
`MailerService` su SMTP platform): `StudioLifecycleService::notificaEmail()`
manda una mail contestuale per `sospeso`, `cestinato` (con la data di
eliminazione definitiva), `purgato`, e `memo` (promemoria a 7 e 1 giorni dalla
scadenza, dal Task 2 del cron via `inviaMemoPurge()`). Best-effort: un errore
di invio non interrompe mai l'operazione.

**Studio non attivo lato pubblico**: la tenant detection in `config.php`, se
l'host punta esattamente a uno studio sospeso o nel cestino, serve
[`public/sospeso.php`](public/sospeso.php) (HTTP 503, messaggio neutro) invece
di degradare in silenzio allo studio di default.

### Template grafici

Single source of truth: `superadmin/templates/_data.php`. 6 template
(`classico`, `minimal`, `tech`, `solare`, `couture`, `nordic`) con: nome,
descrizione, colori primario/scuro, settore, emoji, hero text, layout.

**Anteprima**: ogni card ha bottone "Anteprima" che apre overlay con iframe
su `/superadmin/templates/preview.php?tpl=<slug>` — landing page demo
renderizzata con i colori/layout del template. Tasto ESC per chiudere.

### Riavvio server

Da `/superadmin/sistema` → bottone rosso "Riavvia server" → modale conferma →
POST a `/superadmin/restart` (audit log + `sleep 3 && sudo /usr/sbin/reboot &`)
→ overlay full-screen con polling su `/superadmin/ping` (no auth) → reload
automatico della dashboard quando il server torna online.

**Requisito sistema**: `/etc/sudoers.d/portal` deve contenere
`www-data ALL=(ALL) NOPASSWD: /usr/sbin/reboot`.

### ACL / permessi

Sistema a due livelli (vedi [admin/acl.php](admin/acl.php) + `ACLController`):

- **Permessi per ruolo** (`ruoli_permessi`) — default applicato a tutti gli
  utenti con quel ruolo
- **Override personali** (`utenti_permessi.concesso=1|0`) — eccezioni per
  singolo utente, sovrascrivono il ruolo

`admin` e `direzione` hanno sempre **tutti** i permessi (`ACLController::puo()`
ritorna early-true). Per gli altri ruoli si verifica con
`ACLController::puo('codice.permesso')`. La pagina `acl.php` salva via
**AJAX** (header `X-Requested-With: XMLHttpRequest` → JSON) — niente reload,
toast di feedback, rollback UI in caso di errore (es. ultimo admin).

Audit codes: `acl_ruolo_permesso`, `acl_set_ruolo`, `acl_override_utente`.

#### Matrice default canonica

I default per ogni ruolo sono **single-source-of-truth** in due luoghi (mantenuti
allineati a mano): la sezione `INSERT IGNORE INTO ruoli_permessi` di
[migrations/01_studio_template.sql](migrations/01_studio_template.sql) (per i
nuovi tenant) e la costante `ACL_DEFAULTS` in
[bin/seed-acl-defaults.php](bin/seed-acl-defaults.php) (per ri-applicarli ai
tenant esistenti).

| Permesso                   | operatore | responsabile | direzione | admin  | Gate effettivo                                                                                                              |
| -------------------------- | :-------: | :----------: | :-------: | :----: | --------------------------------------------------------------------------------------------------------------------------- |
| comunicazioni.gestire      |     ✓     |      ✓       |     ✓     | (auto) | `/api/com-smart-reply`                                                                                                      |
| kb.gestire                 |     ✓     |      ✓       |     ✓     | (auto) | `/admin/knowledge-base`, `/admin/revisioni-ai`, `/admin/ai-domande`, `/api/kb-*-ai`                                         |
| ai.usare                   |     ✓     |      ✓       |     ✓     | (auto) | tutti gli endpoint AI lato studio (17 endpoint, vedi sotto)                                                                 |
| questionari.gestire        |     ✓     |      ✓       |     ✓     | (auto) | `/admin/questionari*`, `/api/questionario-ai-genera`                                                                        |
| circolari.create           |     ✓     |      ✓       |     ✓     | (auto) | `/admin/circolari-edit`, `/api/circolare-ai-*`                                                                              |
| circolari.publish          |           |      ✓       |     ✓     | (auto) | pubblicazione circolare in `CircolariService::pubblica`                                                                     |
| circolari.read_report      |           |      ✓       |     ✓     | (auto) | tab Letture / export CSV circolari                                                                                          |
| aziende.gestire            |           |      ✓       |     ✓     | (auto) | `/admin/aziende`, scheda azienda (POST handlers)                                                                            |
| utenti.gestire             |           |      ✓       |     ✓     | (auto) | `/admin/utenti`, `/admin/inviti`, tab dipendenti scheda azienda                                                             |
| reparti.gestire            |           |      ✓       |     ✓     | (auto) | `/admin/reparti`, tab reparti scheda azienda                                                                                |
| portafogli.gestire         |           |              |     ✓     | (auto) | `/admin/portafogli`, `/admin/portafoglio/:id`, tab portafogli scheda azienda                                                |
| approvazioni.gestire       |           |      ✓       |     ✓     | (auto) | **riservato modulo futuro** (vedi sotto)                                                                                    |
| agevolazioni.vedere        |     ✓     |      ✓       |     ✓     | (auto) | `/admin/agevolazioni-*` (lato studio)                                                                                       |
| agevolazioni.gestire       |           |      ✓       |     ✓     | (auto) | CRUD bandi/monitoraggi                                                                                                      |
| circolari.archive          |           |              |     ✓     | (auto) | archivio circolari (soft-delete)                                                                                            |
| circolari.config_solleciti |           |              |     ✓     | (auto) | regole globali solleciti                                                                                                    |
| impostazioni.gestire       |           |              |     ✓     | (auto) | `/admin/impostazioni`, `/admin/notifiche`, `/admin/sito-editor`, `/admin/sistema`, `/admin/documenti-modelli`, `/admin/acl` |
| audit.vedere               |           |              |     ✓     | (auto) | `/admin/audit-log`, tab log scheda azienda                                                                                  |

Logica: **operatore** = operatività pura (comunicazioni, KB, AI, bozze
circolari), **responsabile** = team lead (gestione clienti/utenti/reparti +
pubblica circolari + report), **direzione** = strategico + sistema. Il ruolo
**admin** non ha righe in `ruoli_permessi`: `ACLController::puo()` ritorna
early-true.

#### Permessi riservati a moduli futuri

`approvazioni.gestire` esiste in tabella (modulo "Code richieste modifica"
pianificato in TODO future) ma è **dormiente**: nascosto dal pannello ACL
via `ACLController::PERMESSI_RISERVATI` (costante con whitelist di codici).
Quando il modulo verrà implementato, basta togliere il codice da quella
costante e il toggle riappare nel pannello.

#### Doppio gate sugli endpoint AI

Gli endpoint AI lato studio (17 endpoint) richiedono `ai.usare` PIÙ il permesso
del modulo che li chiama:

- `circolari.create + ai.usare`: `/api/circolare-ai-genera`, `circolare-ai-migliora`,
  `circolare-compliance-check`, `circolare-modelli`, `circolare-suggest-tags`
- `comunicazioni.gestire + ai.usare`: `/api/com-smart-reply`
- `kb.gestire + ai.usare`: `/api/kb-da-domande-ai`, `kb-genera-ai`,
  `kb-migliora-ai`, `kb-suggerisci-ai`
- `questionari.gestire + ai.usare`: `/api/questionario-ai-genera`
- solo `ai.usare`: `/api/ai-polish`, `/api/comunicazione-summary`,
  `/api/documento-arricchisci`, `/api/documento-classifica`,
  `/api/azienda-ai-digest?vista=studio`

Endpoint AI lato cliente (`/api/ai-cliente`, `/api/spiegamelo`,
`/api/circolare-quiz`, `/api/circolare-summary`, `/api/azienda-ai-digest?vista=cliente`):
**non** gated da `ai.usare` (sono per i clienti, controllati da
`impostazioni.ai_features_enabled` + consenso utente AIConsent). **Per ri-applicare i default** dopo un'aggiunta di permesso o per
un tenant disallineato:

```bash
sudo -u www-data php /var/www/portal/bin/seed-acl-defaults.php --dry-run -v
sudo -u www-data php /var/www/portal/bin/seed-acl-defaults.php
```

Lo script è **idempotente** (`INSERT IGNORE`): aggiunge solo le righe mancanti,
non rimuove eventuali permessi extra concessi a mano dal pannello ACL.

## Pattern di pagina

Ogni pagina segue questo schema:

```php
<?php
require_once dirname(__DIR__) . '/src/config/config.php';
require_once dirname(__DIR__) . '/src/controllers/AuthController.php';

AuthController::richiediLogin('operatore');  // o 'cliente'
AuthController::bloccaScritturaSeIspezione();  // solo in /public/*

// POST handler (action dispatcher)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    if ($action === 'crea') { /* ... */ header('Location: ...?msg=creato'); exit; }
    elseif ($action === 'modifica') { /* ... */ }
    // ...
}

$messaggio = match($_GET['msg'] ?? '') { /* ... */ };

// Carica dati per il render
$db = Database::getInstance()->getConnection();
// ...
?>
<!DOCTYPE html>
<html>
<head>...</head>
<body>
<?php require __DIR__ . '/sidebar.php'; ?>
<?php require __DIR__ . '/topbar.php'; ?>

<div class="main">
    <!-- Page header gradient + KPI pills -->
    <div class="page-header">...</div>

    <!-- Toolbar (search live, filters) -->
    <div class="toolbar">...</div>

    <!-- Content cards -->
    ...

    <!-- Modali per crea/modifica/elimina -->
    ...
</div>

<script src="bootstrap.bundle.min.js"></script>
<script>
    // Inline JS per modali, search live (debounce 350ms + restore focus)
    ...
</script>
<?php require dirname(__DIR__) . '/public/banner-ispezione.php'; ?>
</body>
</html>
```

### Componenti UI ricorrenti

- **Page header** — gradient scuro `linear-gradient(135deg, #0f172a, #1e293b, #334155)`,
  border-radius 16, padding 18×24, KPI pills inline
- **KPI pills** — `background: rgba(255,255,255,.15); border: 1px solid;
border-radius: 30px; padding: 5px 14px`
- **Card content** — white, border-radius 12-16, shadow leggera
- **Modali** — `border-radius: 16px; border: none`, header senza border, btn
  `rounded-3 fw-bold px-4`
- **Search live** — `<input id="cercaInput">` + JS debounce 350ms + restore
  focus sull'input dopo reload
- **Paginazione liste** — `/admin/documenti`, `/admin/circolari`,
  `/admin/questionari` mostrano **9 elementi per pagina**. Paginatore
  server-side (link `?pag=N`, classe CSS `.docs-pager`, filtri/ricerca
  preservati nei link, pagina fuori range riportata all'ultima valida).
  Costante `$perPage` in cima a ciascuna pagina. Differenze:
  **documenti** — all'ingresso (nessun filtro) carica solo i 9 più recenti
  _senza_ conteggio sull'intera tabella; la paginazione completa parte solo
  con un filtro attivo. **circolari/questionari** — ogni tab di stato è
  paginato a 9 (il totale viene dai badge dei tab dove possibile, da un
  `COUNT` mirato altrimenti).
- **Action dispatcher** — sempre POST con `<input type="hidden" name="action">`
- **Flash messages** — `?msg=key` riconvertito in `match` dopo il redirect
- **Topbar** (admin + cliente):
  - Ricerca globale (admin) con shortcut `/`, dropdown raggruppato per tipo
  - Bottone notifiche comunicazioni (polling `/api/notifiche.php` ogni 30s)
  - **Menu utente** (pill cliccabile con avatar+nome) → dropdown con info
    contestuali, toggle disponibilità (operatori/responsabili), tema scuro,
    profilo, tour, guida, logout
- **AI Assistant** lato cliente (FAB viola in basso a destra del portale clienti).
  Endpoint server-side: `/api/ai-cliente.php` (multi-turno fiscale, 500 tokens).
  La chiave Groq **non viene mai esposta** al frontend. Il pannello operatori
  **non ha più** un proprio assistant AI (rimosso perché poco utile in pratica;
  l'AI resta usata internamente da `KBRevisorService` e da `kb-genera-ai.php`).
- **Tour guidato** — `portal-tour.js` caricato globalmente dalle sidebar.
  Step in `STEPS.cliente`/`STEPS.admin`. Stato in `sessionStorage` per
  attraversare i redirect. Avvio: `PortalTour.start('admin'|'cliente')`,
  esposto nel menu utente.

### Tema scuro / cache busting

- Toggle nel menu utente. Stato salvato in `localStorage('portal_theme')` +
  cookie `portal_theme` (1 anno).
- **Init script inline** all'inizio di `admin/sidebar.php` e
  `public/sidebar-cliente.php` applica `data-theme="dark"` su `<html>`
  prima del primo render → niente FOUC.
- `portal.css` definisce variabili (`--c-bg`, `--c-card`, `--c-text`...) +
  blocco `[data-theme="dark"]` che le ridefinisce + override mirati per
  componenti hardcoded.
- Cache busting: le sidebar caricano `portal.{css,js}?v=<filemtime>` —
  modifiche ai file frontend si vedono al primo refresh senza dipendere
  dalla cache del browser.

## Flussi chiave

### Onboarding cliente

1. Admin crea azienda in `/admin/aziende.php`
2. Admin invia invito da `/admin/inviti.php` → genera token 32 char, scadenza 7gg.
   Nel modal c'è il flag opt-in **"Sarà admin azienda"**: persiste in
   `inviti.cliente_ruolo` (`admin`|`utente`) e all'accettazione il valore
   viene applicato a `users.cliente_ruolo`. Badge "Admin azienda" in lista
   inviti per riconoscerli a colpo d'occhio.
3. Cliente apre `/registrati.php?token=...` → form nome+password.
   **Auto-promote**: se l'azienda non ha ancora alcun admin attivo, il primo
   utente che accetta diventa automaticamente `cliente_ruolo='admin'` (così
   l'azienda non resta orfana di gestione anche se l'admin studio si è
   dimenticato di spuntare il flag).
4. Login automatico, cliente atterra su `/dashboard.php`

### Comunicazioni

1. Cliente apre comunicazione da `/comunicazioni.php` (modal) o invia testo
   al bot Telegram (se collegato)
2. Studio risponde da `/admin/comunicazione-detail.php`
3. La risposta studio viene **automaticamente inoltrata** ai chat_id
   Telegram dei clienti dell'azienda (vedi `ComunicazioneController::inviaRispostaTelegram`)
4. Allegati salvati in `uploads/comunicazioni/<comId>/` con filename safe
   `<timestamp>_<i>_<orig>`

#### Note interne

La pagina admin del thread ha un toggle "Risposta cliente / Nota interna" sopra
il textarea: la nota è gialla, mostra label "NOTA INTERNA — non visibile al
cliente", non innesca notifiche né forward Telegram, non aggiorna `urgente`/`updated_at`.
Sono filtrate dal lato cliente via `getDettaglio($id, soloVisibileAlCliente: true)`.
La sicurezza è server-side: `public/comunicazione.php` usa sempre il flag.

#### Lista comunicazioni — design Linear/Front style

La pagina [`/admin/comunicazioni`](admin/comunicazioni.php) usa una **gerarchia
visiva chiara** ispirata ai migliori sistemi di ticketing. Ogni riga ha una
striscia di priorità a sinistra (4px) con colore dipendente dallo stato:

| Stato                 | Classe CSS    | Colore              | Quando si applica                       |
| --------------------- | ------------- | ------------------- | --------------------------------------- |
| Urgente non assegnato | `.s-urgnoass` | rosso pulsante      | `urgente=1` + nessun operatore + aperta |
| Da rispondere         | `.s-darisp`   | arancio             | aperta + ultimo messaggio dal cliente   |
| Mia                   | `.s-mia`      | primary             | assegnata a me + aperta                 |
| Da prendere           | `.s-noass`    | indigo dashed       | aperta + non assegnata + non urgente    |
| Assegnata altri       | `.s-altri`    | grigio              | assegnata a un altro operatore          |
| Chiusa                | `.s-chiusa`   | grigio + opacità .6 | `chiusa=1`                              |

La gerarchia è **mutually exclusive** (la prima che matcha vince) — calcolata
con `match (true)` in PHP all'interno del loop di render.

**Avatar azienda** rotondo (40×40, color hash su `azienda_nome`) con badge
non-letti `Intercom-style` in alto-destra. **Colonna destra**: chip
assegnatario con avatar+nome (sfondo blu se "in carico a te") oppure CTA
"Prendi in carico" se nessuno l'ha presa (operatore base può solo prendere a
sé, vedi `comunicazione-detail.php` POST `prendi_in_carico`).

**Filter pills** con counter colorato a tema: la classe `has-items`
(applicata se count > 0) abilita un **pallino pulsante** sull'angolo del pill
quando ci sono ticket bisognosi di attenzione e il filtro non è attivo.
Su mobile (≤700px) la riga collassa in column, le tag inline restano sopra
e la sezione assegnatario passa sotto con border-top.

#### Assegnazione operatore

Ogni comunicazione ha `operatore_assegnato_id` (NULL = da assegnare).

- Dropdown "Assegna a..." in alto a destra del thread admin — mostra solo
  i ruoli **operativi** (`responsabile`, `operatore`, `capoufficio`), vedi
  costante `AuthController::RUOLI_OPERATIVI` e sezione "Ruoli operativi vs
  manageriali". Admin/direzione esclusi: sono ruoli di governance.
- `ComunicazioneController::assegnaOperatore()` valida server-side gli stessi
  ruoli: un POST diretto con `operatore_id` admin/direzione viene rifiutato
  con `InvalidArgumentException`.
- Pulsante "Prendi in carico": il template lo mostra solo agli operatori
  base (`!$puoAssegnareAltri`). Defense in depth: il POST handler comunque
  rifiuta admin/direzione con audit `assegnazione_negata_ruolo_manageriale`
  - redirect `?msg=no_assign_manager`.
- KPI "Da assegnare" sulla home admin + filtro `?filtro=non_assegnate`
- Filtro `?filtro=mie` mostra le mie comunicazioni assegnate
- Card "Carico operatori" sulla home admin con aperte/urgenti/non_lette per ogni operatore.
  Esclude `admin` e `direzione` dalla lista (vedi `getCaricoOperatori()`).
- Visibile solo a chi ha visione manageriale (admin/direzione/responsabile):
  i ruoli **operativi** (`operatore`, `capoufficio`) non la vedono sulla home,
  perché atterrano direttamente su `/admin/comunicazioni` (vedi `homeUrlPerRuolo`).
- Quando un operatore viene assegnato riceve email di notifica (se opt-in)
- Mail catch-all "ticket aperto e nessuno assegnato" → va sempre ad admin+direzione
  (gestionale: devono sapere che un cliente è in attesa). Non rispetta `RUOLI_OPERATIVI`.

#### Notifiche email (sistema configurabile)

Sistema generico in `MailerService::inviaNotificaSistema($evento, $destinatari, $context, $linkUrl)`:

- **Eventi configurabili** (chiavi in `notifiche_config.evento`):
  - `ticket_aperta_cliente`, `ticket_aperta_studio`, `ticket_risposta_studio`,
    `ticket_risposta_cliente`, `ticket_chiusa`, `ticket_assegnato_operatore`
  - `scadenza_memo_7gg`, `scadenza_memo_1gg`
  - `documento_caricato` (studio → cliente), `documento_caricato_studio` (cliente → studio)
  - `questionario_assegnato` (studio → cliente), `questionario_completato`
    (cliente → studio), `questionario_sollecito` (promemoria → cliente)
- **Template di default** in `src/notifiche_default.php` (HTML inline + placeholder)
- **Override per-tenant** in `notifiche_config` — l'admin di studio può attivare/disattivare
  e personalizzare subject/body/CTA da `/admin/notifiche`. Se l'override è NULL, vince il default.
- **Placeholder** risolti da `MailerService::risolviPlaceholder()`:
  `{cliente_nome}`, `{azienda_nome}`, `{operatore_nome}`, `{ticket_codice}`,
  `{ticket_oggetto}`, `{scadenza_titolo}`, `{scadenza_data}`, `{scadenza_giorni}`,
  `{documento_nome}`, `{studio_nome}`, `{link}`, `{anno}`.
- `ComunicazioneController::inviaNotificaEmail($comId, $tipo)` ora è un wrapper:
  mappa il `$tipo` (`'aperta_cliente'`, ecc.) → chiave evento configurabile,
  costruisce il context e delega a `inviaNotificaSistema()`.
- **Invito al portale** e **reset password** restano hardcoded (`MailerService::inviaInvito()`
  e `inviaReset()`): sono critici per l'autenticazione e non sono modificabili dall'admin.
- Se SMTP non configurato (`isDevMode`) gli eventi vengono solo loggati — nessun errore.
  Fallback automatico tenant SMTP → platform SMTP (Brevo) — vedi `MailerService::__construct()`.
- Rispetta opt-in cliente in `user_preferenze.notif_email_ticket` (default '1').
- Best-effort: errori non bloccano mai il flusso principale (try/catch + error_log).

**Pagina admin** `/admin/notifiche` (solo admin):

- Lista 9 eventi con toggle on/off (salvato via fetch, no reload)
- Editor inline: oggetto + body HTML + label CTA + chip placeholder cliccabili
- Anteprima live in iframe con dati di esempio
- Bottone "Invia test a me" (manda al proprio indirizzo con dati fittizi)
- Bottone "Ripristina default" (svuota override → torna al default di sistema)

#### AI Polish (riformulazione bozza operatore)

Pulsante **"AI Polish"** accanto a "Invia" sulla card di risposta in
[/admin/comunicazione/:id](admin/comunicazione-detail.php). L'operatore può
"sistemare" la bozza prima dell'invio. Funziona sia in modalità "Risposta
cliente" che "Nota interna".

- **Endpoint**: [`/api/ai-polish`](api/ai-polish.php) — POST JSON
  `{testo, formalita, lunghezza, tono}` → `{ok, polished}`. Auth: solo
  ruoli interni (`admin`/`direzione`/`responsabile`/`operatore`/`capoufficio`).
  Bloccato in modalità ispezione.
- **Wizard 3 step**:
  1. **Formalità** (`informale` / `neutro` / `formale`)
  2. **Lunghezza** (`mantieni` / `sintetica` / `estesa`, max ±30%)
  3. **Tono** (`cordiale` / `professionale` / `empatico` / `diretto`)
- **Preview side-by-side**: colonna sinistra = originale (read-only),
  colonna destra = riformulato editabile. Bottoni: **Accetta** (sostituisce
  il testo del textarea), **Originale** (ripristina la bozza iniziale),
  **Indietro** (torna agli step), **Annulla** (chiude senza modifiche).
  Su mobile la diff diventa stack verticale.
- **Vincoli del system prompt** (in `api/ai-polish.php`):
  - NO modifiche al significato; NO informazioni nuove (date, importi,
    articoli di legge, scadenze ecc.)
  - Mantenimento della voce personale dell'operatore
  - Output = solo testo finale, niente commenti/markdown/preamboli
  - `temperature: 0.4`, `max_tokens: 1200`
- **Sanitizzazione output**: rimuove eventuali wrapping `"..."`/code
  fences che il modello a volte aggiunge nonostante il prompt.
- Niente persistenza: la richiesta è stateless, non viene loggata né
  associata al ticket. Se l'operatore non clicca "Accetta", nulla cambia.

### Telegram bot

1. Admin configura token in `/admin/impostazioni.php` → tab Telegram. Il
   sistema chiama `getMe()` per validare e salvare username
2. Admin clicca "Imposta webhook" → registra
   `https://host/api/telegram-webhook.php` su Telegram
3. Cliente apre `/comunicazioni.php` → banner azzurro "Connetti Telegram" →
   API `telegram-link.php` genera token monouso 15min
4. Cliente apre `t.me/<bot>?start=<token>` → bot riceve `/start TOKEN` →
   collega `users.telegram_chat_id`
5. Cliente invia messaggi liberi al bot — vengono ruotati in base al **pattern "thread caldo"**:
   - Se c'è una comunicazione APERTA dell'azienda con ultimo messaggio entro
     **24 ore** → il testo viene appeso come `rispondi(lato='cliente', origine='telegram')`
     (no nuovo codice ticket). Bot risponde "💬 Aggiunto a [codice]".
   - Altrimenti → `crea()` nuova com. Bot risponde "✅ Nuova comunicazione aperta".
   - Comando `/nuova [oggetto]` forza sempre nuova comunicazione (override).
   - Soglia hardcoded `$threadCaldoMin = 60*24` in `api/telegram-webhook.php` —
     facilmente parametrizzabile se serve cambiarla per studio.

### WhatsApp Cloud API (add-on Pro+ inbound-only)

Canale **secondario** affiancato a Telegram, **solo in ricezione** (l'operatore
risponde dal portale, mai via WA). Gating doppio: feature `whatsapp_inbound`
nel piano (Pro/Enterprise — vedi `pianoHasFeature` in [`src/piani.php`](src/piani.php)) +
toggle tenant `impostazioni.whatsapp_attivo`.

**Flusso**:

1. Admin attiva l'add-on da `/admin/impostazioni` → tab **💚 WhatsApp**: incolla
   Phone Number ID, Permanent Access Token (System User Meta), App Secret e
   genera un Verify Token. Salva e attiva il toggle.
2. Admin va sulla console Meta WhatsApp → Configuration → Webhook → incolla
   l'URL `/api/whatsapp-webhook` mostrato + Verify Token, sottoscrive `messages`.
3. Cliente da `/profilo` (tab Notifiche) inserisce il proprio numero WhatsApp →
   normalizzato in E.164 senza `+` e salvato in `users.whatsapp_numero`.
   Vincolo univoco per tenant (impedisce a 2 utenti di "rivendicare" lo stesso
   numero). Nessuna conferma OTP in v1: WhatsApp stesso autentica il sender.
4. Cliente invia un messaggio al numero pubblico dello studio →
   [`api/whatsapp-webhook.php`](api/whatsapp-webhook.php) valida firma
   `X-Hub-Signature-256: sha256=<HMAC>` e applica lo **stesso pattern
   thread-caldo di Telegram** (24h, no `/nuova` perché WA non ha comandi).
   Origine messaggio = `'whatsapp'` (ENUM esteso in `com_messaggi.origine`).
5. Operatore vede la comunicazione in `/admin/comunicazioni` e risponde dal
   portale. **`ComunicazioneController::inviaRispostaTelegram` non è
   triggerato** per messaggi WA: niente outbound.

**Schema** ([migrations/26_whatsapp.sql](migrations/26_whatsapp.sql)):

- `com_messaggi.origine` esteso con `'whatsapp'`
- `users.whatsapp_numero` (E.164 senza `+`) + indice per lookup webhook
- `comunicazioni.auto_chiusa_motivo` (marker delle chiusure cron, es. `'wa_24h_sla'`)
- Tabella `whatsapp_inbound_log` con UNIQUE su `wa_message_id` per dedup
  (Meta a volte rispedisce lo stesso update se non rispondiamo 200 in tempo)
- Seed `impostazioni`: 8 chiavi `whatsapp_*` (attivo, phone_id, token, app_secret,
  verify_token, numero_display, auto_close_ore, business_account_id)

**Service** ([src/services/WhatsAppService.php](src/services/WhatsAppService.php)):

- `fromSettings(PDO)` — factory che ritorna `null` se non configurato
- `verifyChallenge(array $get)` — handshake GET su `?hub.mode=subscribe&hub.challenge=X&hub.verify_token=Y`
- `verifySignature(string $rawBody, ?string $hdr)` — HMAC-SHA256 timing-safe con `whatsapp_app_secret`
- `parseInbound(array $payload)` — estrae il primo messaggio `type='text'` dall'envelope Meta
- `normalizzaNumero(string)` — E.164 senza `+` (stesso usato sia su `users.whatsapp_numero` sia su `wa_from`)
- **Nessun `sendMessage`** — design inbound-only in v1.

**Auto-close 24h** ([bin/cron-whatsapp-auto-close.php](bin/cron-whatsapp-auto-close.php)):

- Cron ogni 30 min in `/etc/cron.d/portal-backup`
- Trova `comunicazioni` aperte il cui ULTIMO messaggio non interno è
  `lato='cliente' AND origine='whatsapp'` con `created_at <= NOW() - INTERVAL N HOUR`
- Soglia per-tenant in `impostazioni.whatsapp_auto_close_ore` (default 24, `0`
  disattiva)
- Chiude con `chiusa=1`, `auto_chiusa_motivo='wa_24h_sla'` e inserisce una
  nota interna automatica con il dettaglio (lato='interno', origine='sa')

**Modello "thread caldo" condiviso**: identico a Telegram. Una comunicazione
auto-chiusa per WA non viene riaperta se arriva un nuovo messaggio entro 24h
(filtro `chiusa=0` nella query) — viene aperta una com nuova.

**Sicurezza**:

- Webhook **fuori** dalla CSRF protection: vedi `Csrf::isExempt` (POST firmati
  HMAC-SHA256 e GET handshake con verify_token costante)
- Firma timing-safe (`hash_equals`)
- Difesa profonda: il service verifica anche `phone_number_id` ricevuto vs
  configurato (un attaccante con app_secret di un'altra WABA non può
  comunque postare update qui)
- Numero univoco per tenant: l'UI di linking rifiuta numeri già rivendicati
- Modalità ispezione superadmin: il webhook NON viene bloccato (è inbound da
  Meta, non un POST utente)

**Limitazioni note v1** (per future iterazioni):

- Solo testo: image/audio/video/document non gestiti (parser ritorna `null` →
  skip pulito)
- Niente outbound: operatore NON può rispondere via WA. Per abilitarlo si
  aggiunge un metodo `sendMessage` al service + un hook in
  `ComunicazioneController::rispondi` simile a `inviaRispostaTelegram`,
  rispettando la _customer service window_ Meta (24h)
- Niente conferma OTP del numero cliente — TODO se serve hardening

### Modalità demo

Studio dimostrativo identificato da `impostazioni.is_demo='1'`. Il flag
viene impostato **solo** dallo script seed (`bin/seed-demo.php`) — il
provisioning di superadmin non lo tocca, quindi gli studi reali sono
sempre fuori da questa modalità.

Effetti quando attivo:

- Sidebar (admin + cliente) mostra il bottone giallo **"Credenziali demo"**
  in fondo, che apre un modal con tutti gli account `@demo.test` /
  `@studiodemo.test` raggruppati per ruolo, password condivisa `Demo123!`,
  ricerca live e bottone copia.
- Stats live nel modal (utenti, aziende, comunicazioni, KB, scadenze).
- La sezione è **sempre nascosta** in modalità ispezione superadmin.

Il rigenera-dati-demo da browser è stato **rimosso** (era un'azione distruttiva
a un click): la rigenerazione si fa solo da CLI. L'endpoint `/api/seed-demo.php`
esiste ancora (admin + header `X-Demo-Confirm: YES`) ma non è più esposto in UI.

Seed da CLI: `php bin/seed-demo.php --yes` (oppure `--dry-run` per anteprima).
Il seed cancella tutto eccetto admin di sistema, ricrea 10 staff (1
direzione + 1 capoufficio + 8 operatori) + 30 aziende + 50 clienti + 12
voci KB + 12 scadenze + ~35 comunicazioni con messaggi.

### Guide e tour

- Contenuti unica fonte in `src/guide_content.php` (`guide_cliente()`,
  `guide_admin()`, `guide_superadmin()`). Riusati da: pagine HTML
  (`/admin/guida.php`, `/guida.php`) e PDF generator (`/api/guida-pdf.php`
  → dompdf).
- Pagine HTML hanno TOC sticky con scrollspy che gestisce anche il fine
  pagina (forza l'ultima sezione attiva).
- Tour avviato dal menu utente o da bottoni nelle pagine guida.
  Selettori `#userPill`/`#userPillCli`, `.demo-trigger`, `.ai-fab`,
  `#tbSearchInput`, `.kpi-row`, ecc. Step `optional: true` vengono saltati
  se il selettore non c'è (utile per step demo-only).

#### Filtraggio per ruolo (guide_admin + tour admin)

Sia la guida admin sia il tour admin sono **contestuali al ruolo**: un operatore
non vede sezioni e step che riguardano permessi che non ha (audit, ACL, sito,
impostazioni, ecc.).

- **Guida admin** — ogni sezione di `guide_admin()` ha un campo `ruolo_min`:
  `'operatore' | 'responsabile' | 'admin'`. Helper `guida_filtra_per_ruolo($g, $ruolo)`
  rimuove le sezioni che il ruolo corrente non vede. Usato da `/admin/guida.php`
  e da `/api/guida-pdf.php?ruolo=admin` (il PDF rispetta il ruolo dell'utente che
  lo richiede). Conteggio risultante: operatore/capoufficio = 6 sezioni,
  responsabile = 10, admin/direzione = 16. I bottoni "PDF cliente" e "PDF completo"
  sono visibili solo a admin/direzione.
- **Tour admin** — ogni step in `STEPS.admin` (in `portal-tour.js`) ha un campo
  `ruoloMin`. Filtro applicato in `getStepsForState()` prima di renderizzare.
  Il ruolo viene letto da `window.PORTAL_USER_ROLE`, esposto dalla sidebar admin
  prima di caricare lo script. Le url `/admin/home` vengono rimappate dinamicamente
  via `HOME_URL_PER_RUOLO` (operatore/capoufficio → `/admin/comunicazioni`).
  Conteggio: operatore/capoufficio = 6 passi, responsabile = 11, admin/direzione = 16.
- Gerarchia ruoli usata per il filtro (lato PHP e JS):
  `operatore | capoufficio` < `responsabile` < `direzione | admin`.
- Per aggiungere una nuova voce: imposta `ruolo_min` (guida) o `ruoloMin` (tour);
  se omesso, il default è `'operatore'` (visibile a tutti gli interni).

## Storage documenti

Sistema centralizzato per documenti scambiati studio↔cliente (F24, CU,
cedolini, fatture, ecc.). **Distinto dagli allegati di comunicazione**
(`com_allegati` in `uploads/comunicazioni/`) che restano legati al thread
della chat e hanno regole d'accesso diverse.

### UI

- **Lato studio** — `/admin/documenti` (sidebar Lavoro → Documenti). Lista a card
  con filtri (tipo / visibilità / azienda / ricerca), pill di quota, modal upload
  con auto-default per tipo, modal "Letture" che mostra chi ha aperto/confermato.
- **Lato cliente** — `/documenti` (sidebar Lavoro). Lista raggruppata per tipo,
  badge "🆕 Nuovo" per documenti non aperti, badge "⚠ Conferma richiesta" per
  documenti formali, modal di conferma con nota opzionale.
- **KPI Documenti** sulla home admin (cliccabile, link a `/admin/documenti`):
  spazio usato + barra colorata. Tile "Documenti" sulla dashboard cliente
  con badge dei non aperti.

### Architettura

- **Configurazione** in `src/config/master.php` (costanti `STORAGE_*`):
  `STORAGE_DRIVER` (`'local'` ora, `'s3'` in futuro), `STORAGE_LOCAL_PATH`,
  più stub `STORAGE_S3_*` per la migrazione futura su object storage.
- **Cartella fisica** in `/var/www/portal/storage/docs/` — **fuori dal
  DocumentRoot Apache**. Tre livelli di blocco HTTP: (1) fuori dal DocRoot,
  (2) `<DirectoryMatch>` `Require all denied` nei vhost (`portal.conf` +
  `studiodesk.cloud-le-ssl.conf`), (3) `.htaccess` di fallback dentro storage/.
- **Classe `Storage`** in `src/helpers/Storage.php` (facade statico + driver
  pluggable: `LocalStorageDriver`, `S3StorageDriver` come stub).
- **3 tabelle DB** (per-tenant): `documenti_tipi`, `documenti`, `documenti_letture`.
- **3 endpoint API**:
  - `GET/POST /api/documento?id=N` → download via `Storage::serve()`. Se il
    doc ha password e arriva una GET senza, restituisce un form HTML inline
    in stile login (POST con la password fa partire il download).
  - `POST /api/documento-conferma` → conferma esplicita di lettura
    (`Storage::confermaLettura`).
  - `GET /api/documento-letture?id=N` (admin only) → JSON con la cronologia
    delle letture, per il modal "Letture" lato studio.
- **Trigger notifica email**: `admin/documenti.php` chiama
  `MailerService::inviaNotificaSistema('documento_caricato', ...)` dopo l'upload
  per visibilità `azienda` o `utente`. Per `tutti` non manda email (sarebbe
  un broadcast a tutto il tenant — l'admin lo configura via /admin/notifiche
  se davvero lo vuole). L'evento è in `notifiche_config` (default `attiva=0`).

### API pubblica

```php
Storage::upload($file, $studioSlug, $contesto)
  // $file = item $_FILES normalizzato
  // $contesto = ['tipo_id'=>int, 'visibilita'=>'tutti|azienda|utente',
  //              'azienda_id'=>?int, 'user_id'=>?int (destinatario),
  //              'password'=>?string, 'note'=>?string,
  //              'conferma_lettura'=>?'nessuna|implicita|esplicita',
  //              'created_by'=>?int (default: $_SESSION['user_id'])]
  // → valida (max 20 MB, 17 estensioni whitelisted), genera UUID,
  //   crea le dir, salva il file, INSERT in documenti, rollback file
  //   se l'INSERT fallisce.
  // → ritorna ['id','path','nome_file','nome_originale','size','mime']

Storage::serve($docId, $userId, $password = null): void
  // ACL + verifica password + registra lettura implicita + stream del file.
  // Termina la richiesta con exit. Errori sicuri (no path leak):
  //   404 'Documento non trovato'   (anche se soft-deleted)
  //   403 'Accesso negato'
  //   401 'Password richiesta o errata'
  //   410 'File non più disponibile' (file fisico mancante)

Storage::confermaLettura($docId, $userId, $nota = null): bool
  // Upgrade a 'esplicita'. Idempotente. Salva ip+user_agent+nota.

Storage::statoLettura($docId, $userId): array
  // ['letto' => bool, 'tipo' => 'implicita'|'esplicita'|null, 'data' => ts|null]

Storage::delete($docId): bool
  // Soft delete: aggiorna deleted_at, il file fisico resta.
```

### Regole di accesso (in `userPuoVedere`)

- Utenti **interni** (admin/direzione/responsabile/operatore/capoufficio):
  accesso totale ai documenti del proprio tenant.
- **Cliente**:
  - `visibilita='tutti'` → tutti i clienti del tenant
  - `visibilita='azienda'` → solo se `user.azienda_id == doc.azienda_id`
  - `visibilita='utente'` → solo se `user.id == doc.user_id`
- Se `password_hash` è valorizzato → `password_verify()` obbligatorio,
  altrimenti 401.

### Path layout (sharding 2 char per evitare directory mostruose)

```
{slug}/condivisi/{ab}/{uuid}.{ext}                ← visibilita='tutti'
{slug}/aziende/{azid}/generale/{ab}/{uuid}.{ext}  ← visibilita='azienda'
{slug}/aziende/{azid}/{uid}/{ab}/{uuid}.{ext}     ← 'utente' (utente di azienda)
{slug}/privati/{uid}/{ab}/{uuid}.{ext}            ← 'utente' (cliente persona fisica)
```

### Quota per-tenant

Lo spazio storage è limitato dal **piano** del tenant (definito in
[`src/piani.php`](src/piani.php) → `getPiano($slug)['limiti']['storage_gb']`):

- `base` → **1 GB**
- `pro` → **10 GB**
- `enterprise` → **100 GB**

API esposta in `Storage`:

```php
Storage::quotaStato(): array
  // ['usato'=>byte, 'limite'=>byte, 'pct'=>0..100,
  //  'classe'=>'ok'|'warn'(>=80%)|'crit'(>=95%)|'unlimited',
  //  'piano'=>string, 'ok'=>bool]
Storage::quotaPermette(int $size): array
  // come sopra + 'futuro'=>byte; 'ok'=>false se l'upload sforerebbe.
Storage::formattaSize(int $bytes): string  // "1.5 GB", "200 MB", "12 KB"
```

`Storage::upload()` invoca automaticamente `quotaPermette($size)` **prima**
di scrivere il file: se la quota sforerebbe, lancia `RuntimeException`
con messaggio leggibile per l'utente:

> _"Spazio storage esaurito (XXX / YYY usati nel piano base). Per caricare
> nuovi documenti elimina file inutili o passa a un piano superiore."_

**KPI sulla home admin** (visibile solo a admin/direzione/responsabile/
capoufficio): tile "Documenti" con `usato / limite` + barra di progresso
colorata (ok blu, warn arancio, crit rosso). L'operatore non la vede
(coerente con `mostraSezManageriali`).

**Note**:

- Lo spazio "usato" include anche i `documenti` con `deleted_at` valorizzato:
  i file fisici esistono ancora (soft-delete). Un futuro garbage collector
  li eliminerà fisicamente dopo N giorni di retention, allora `quotaStato`
  rifletterà l'occupazione reale del disco.
- `pianoCorrente()` legge il piano dalla tabella master `studios.piano`,
  con fallback `'base'` in caso di errore di connessione (fail-safe: meglio
  bloccare l'upload che permettere consumi non controllati).

### Archivio/cancellazione lato cliente

Il cliente può rimuovere un documento dalla **propria vista** in due modi,
senza mai toccare il record in `documenti` (lo studio continua a vederlo
intatto). Lo stato è per-utente in `documenti_user_state` (PK composto
`(documento_id, user_id)`, ENUM `'archiviato'|'eliminato'`).

| Azione                      | Effetto cliente                                     | Recupero                     | Visibilità studio |
| --------------------------- | --------------------------------------------------- | ---------------------------- | ----------------- |
| **Archivia**                | sparisce dalla lista principale, va in "Archiviati" | sì, dalla sezione Archiviati | invariata         |
| **Elimina definitivamente** | sparisce per sempre da entrambe le vista            | no, solo da DB               | invariata         |

**UI**:

- [`/documenti`](public/documenti.php) — bottone kebab `⋮` su ogni riga
  apre il modal **wizard "Rimuovi"** con due card (Archivia / Elimina
  definitivamente). Step 2 = conferma con bullet point + warning se il
  doc richiede ancora firma o conferma di lettura.
- Pill "📦 N archiviati" in hero (cliccabile → vista archivio) appare
  solo se ci sono doc archiviati.
- [`/documenti?vista=archivio`](public/documenti.php) — lista degli
  archiviati con due bottoni per riga: **Ripristina** (form POST
  `action=ripristina`) e **Elimina** (riapre il wizard saltando lo
  step di scelta, perché siamo già "uno step più avanti").

**Server**: i 3 POST handler (`archivia`/`elimina`/`ripristina`) sono in
cima a `public/documenti.php`, validano l'ACL riusando la stessa logica
di `Storage::userPuoVedere` (per visibilità tutti/azienda/reparto/utente)
prima di toccare lo stato.

**Query lista**: la `WHERE` ora include `LEFT JOIN documenti_user_state`

- filtro `s.stato IS NULL` (vista attivi) o `s.stato='archiviato'` (vista
  archivio). Gli `'eliminato'` sono esclusi da entrambe le vista.

**Counter** "da leggere/firmare/confermare" in hero ignorano i doc archiviati
o eliminati: archiviare = "lo metto da parte, smetti di sollecitarmi".

**Studio**: la pagina admin (`/admin/documenti`) **non vede** lo stato
per-utente — è una preferenza di vista del cliente, non un'informazione
operativa. Se in futuro serve esporla (es. tracking "il cliente l'ha
archiviato"), basta JOIN su `documenti_user_state`.

### Switch a S3 (futuro)

Cambiare `STORAGE_DRIVER` in `master.php` da `'local'` a `'s3'`, valorizzare
le costanti `STORAGE_S3_*`, installare `aws/aws-sdk-php` (composer) e
implementare `S3StorageDriver::write/absolutePath/exists/deleteFile`. Il
resto del codice (caller di `Storage::upload`/`serve`) non cambia: la facade
delega tutto al driver.

## Disponibilità operatori

Sistema a 3 livelli per gestire la presenza degli operatori interni.
Logica in [`src/services/UserDisponibilitaService.php`](src/services/UserDisponibilitaService.php).

### Tre livelli

1. **Override manuale** — colonna `users.disponibile` (TINYINT). Bottone
   "in pausa adesso" sul profilo. Quando cambia, `users.disponibilita_aggiornata`
   viene aggiornato (per detectare pause prolungate).
2. **Orari standard settimanali** — tabella `user_orari_lavorativi`
   (giorno 0-6, ora_inizio TIME, ora_fine TIME). Multi-fascia per giorno
   (es. lun 9-13 + lun 14-18). Fuori dagli orari l'utente è automaticamente
   non disponibile, anche se il toggle è "disponibile".
3. **Assenze pianificate** — tabella `user_assenze` (data_inizio, data_fine,
   tipo ferie/malattia/permesso/altro, motivo). Coperti da queste, l'utente
   risulta non disponibile a prescindere.

Helper `UserDisponibilitaService::isDisponibile($userId, $when)` combina
tutti e tre. `perchéNonDisponibile()` ritorna il motivo umano.

### UI

- **Profilo operatore** ([`/admin/profilo`](admin/profilo.php) → tab Disponibilità):
  toggle, griglia settimanale orari, lista assenze + form aggiunta.
- **Widget home admin** (manager-only): card "Alert disponibilità" se ci sono
  operatori in pausa lunga o giorni con scarsa copertura nei prossimi 14 giorni.

### Cron alert

[`bin/cron-alert-disponibilita.php`](bin/cron-alert-disponibilita.php) —
scansiona tutti i tenant attivi, calcola criticità tramite il Service e
invia email-riepilogo a admin/direzione/responsabile.

```bash
# Esecuzione consigliata: 08:00 ogni giorno feriale
0 8 * * 1-5 www-data php /var/www/portal/bin/cron-alert-disponibilita.php
# Test manuale:
php /var/www/portal/bin/cron-alert-disponibilita.php --dry-run
php /var/www/portal/bin/cron-alert-disponibilita.php --tenant=portal
```

Soglie configurabili nel Service:

- `ALERT_PAUSA_MANUALE_GIORNI = 3` — giorni in pausa manuale prima dell'alert
- `ALERT_COPERTURA_PCT = 50` — % di assenti in un giorno che innesca alert
- `ALERT_COPERTURA_GG_AVANTI = 14` — giorni futuri scansionati

## Reparti team interno (organigramma studio)

Tabella `reparti` + `reparti_utenti` — sono i **team interni dello studio**
(Contabilità, Dichiarativi, Direzione, ecc.). **Distinti da `reparti_azienda`**
(sotto-gruppi del cliente, sezione successiva).

### Stato funzionale

Attualmente sono **organigramma puro**: nessuna logica operativa li consulta
(no routing ticket per reparto, no filtri lista, no visibilità documenti, no
notifiche per reparto). Sono mostrati in [`/admin/reparti`](admin/reparti.php)
come gruppi con membri + responsabile. La visibilità documenti `'reparto'` si
riferisce a `reparti_azienda`, non a questi.

**TODO future** (non pianificato a breve): trasformarli in vera primitiva
operativa, es. routing inbound "ticket di un cliente con tag X → reparto Y" o
notifiche "tutti i membri del reparto Y ricevono email".

### Tipi di reparto + vincolo ruoli

| Tipo      | `solo_team` | Candidati membri                                                       | Esempio                         |
| --------- | :---------: | ---------------------------------------------------------------------- | ------------------------------- |
| Operativo |     `0`     | `AuthController::RUOLI_OPERATIVI` (responsabile/operatore/capoufficio) | Contabilità, Dichiarativi       |
| Direzione |     `1`     | `['admin','direzione']`                                                | "Direzione" (seedato, protetto) |

I reparti `solo_team=1` sono **protetti** (no rename, no delete, no toggle attivo).
"Direzione" è seedato automaticamente per ogni tenant in
[migrations/01_studio_template.sql:534](migrations/01_studio_template.sql#L534).

### Validazione UI + server-side

- Dropdown "+ aggiungi membro…" filtra i candidati per tipo reparto (lo style HTML)
- POST handler `aggiungi_membro` in [admin/reparti.php](admin/reparti.php) valida
  che l'utente abbia un ruolo coerente, altrimenti redirect con
  `?err=ruolo_incoerente`
- Pattern speculare al refactor "ruoli operativi vs manageriali": admin/dir
  non possono entrare in reparti operativi; viceversa, operatori non possono
  entrare in "Direzione". Vedi sezione "Ruoli operativi vs manageriali".

### Membri storici (badge ambra)

Tenant già esistenti possono avere membri con ruolo non coerente (es. operatore
in "Direzione" da prima del refactor). Il chip viene mostrato con bordo dashed
ambra + label del ruolo `(direzione)`, e un alert in cima alla card invita a
rimuovere/riassegnare. Nessuna migrazione automatica.

## Reparti azienda (sotto-gruppi cliente)

Ogni **azienda cliente** può essere suddivisa in reparti interni (HR /
Amministrazione / Operations…) per circoscrivere la visibilità di documenti e
(in futuro) circolari ai soli dipendenti di un sotto-gruppo. **Distinti da**
`reparti` (tabella nel template) che si riferisce ai team interni dello STUDIO.

### Schema (`migrations/09_reparti_azienda.sql`)

- `reparti_azienda` — id, azienda_id (FK→aziende, CASCADE), nome (UNIQUE per
  azienda), descrizione, created_at
- `reparti_azienda_utenti` — (reparto_id, user_id) PRIMARY KEY composto
- `documenti.visibilita` — esteso con valore `'reparto'`
- `documenti.reparto_id` — FK → `reparti_azienda(id)` ON DELETE SET NULL
- `documenti_tipi.visibilita_default` — esteso anche lui con `'reparto'`
- `inviti.cliente_ruolo ENUM('admin','utente')` — vedi sezione "Onboarding cliente"

### UI (lato cliente admin)

- [`/reparti-azienda`](public/reparti-azienda.php) — solo `cliente_ruolo='admin'`,
  CRUD reparti + modal "Membri" con lista checkbox di tutti i dipendenti
  attivi. Conteggio membri per reparto in tempo reale.
- [`/utenti-azienda`](public/utenti-azienda.php) — chip viola "Reparto X"
  accanto al nome di ogni dipendente che fa parte di reparti. Bottone
  "Reparti" nell'header che porta a `/reparti-azienda`.
- [`/azienda`](public/azienda.php) — sezione dedicata con CTA "Gestisci reparti".

### UI (lato studio admin)

- [`/admin/documenti`](admin/documenti.php) — il segmented control nel wizard
  upload ora ha 4 opzioni: Tutti / Azienda / **Reparto** / Utente. Quando si
  sceglie "Reparto" appare un dropdown popolato dinamicamente via
  [`/api/azienda-clienti`](api/azienda-clienti.php) (che ora ritorna anche
  `reparti[]` con `id/nome/n_membri`). Validazione client+server: serve
  sempre azienda + reparto coerenti.
- Filtro lista visibilità nella toolbar include "Per reparto".
- Badge `vis-reparto` ambra sulla card del documento.

### ACL ([`Storage::userPuoVedere`](src/helpers/Storage.php))

- Utente interno → vede tutto (come prima).
- Cliente con `visibilita='reparto'`:
  1. `user.azienda_id == doc.azienda_id` (deve essere lo stesso tenant logico)
  2. `user.id` deve essere in `reparti_azienda_utenti(reparto_id = doc.reparto_id)`
- Se uno dei due fallisce → 403.

### Path layout storage

`{slug}/aziende/{azid}/reparti/{repid}/{ab}/{uuid}.{ext}` — i documenti per
reparto stanno in una sotto-dir dedicata, sharded per i primi 2 char del UUID
come gli altri livelli.

### Quota dipendenti per azienda

Il limite per-azienda è in `src/piani.php` come `dipendenti_per_azienda`:

- `base` → **10** dipendenti per azienda
- `pro` → **50** dipendenti per azienda
- `enterprise` → **0** (illimitati)

**Enforcement attivo**:

- [`/utenti-azienda`](public/utenti-azienda.php) — al click "Crea utente"
  conta `users` attivi non eliminati per quell'azienda; se ≥ cap → errore
  "Hai raggiunto il limite del piano X (Y/Z)". La pill quota in alto è
  cliccabile e cambia colore (warn ≥80%, crit ≥95%); barra di progresso
  sotto le KPI quando il limite è impostato.
- [`/admin/inviti`](admin/inviti.php) — al click "Crea invito" conta
  `users` attivi + `inviti` pendenti non scaduti; blocca se ≥ cap.

Helper globale per recuperare il piano del tenant: `pianoSlugCorrente()` in
[`src/piani.php`](src/piani.php) — letto da master via `STUDIO_SLUG`,
fallback `'base'` su errore.

## Scadenze: visibilità per cliente

La tabella `scadenze` raccoglie sia le **scadenze fiscali nazionali**
(`origine='import_ufficiale'`, sincronizzate dal cron sui dataset JSON in
`src/data/scadenze-italia-*.json`) sia i **memo personalizzati dello studio**
(`origine='manuale'`, es. "Scadenza CIE — Mario Rossi", "Rinnovo passaporto",
"Data assemblea"). Prima della migration 27 erano **tutte globali al tenant**:
ogni cliente vedeva tutti i memo, anche quelli personali di altri clienti.
Data leak GDPR.

Dalla migration 27 ogni scadenza dichiara la propria visibilità con lo
stesso pattern di documenti e circolari:

| Visibilità | Campi richiesti             | Vede chi                          |
| ---------- | --------------------------- | --------------------------------- |
| `tutti`    | —                           | tutti i clienti del tenant        |
| `azienda`  | `azienda_id`                | dipendenti di quell'azienda       |
| `reparto`  | `azienda_id` + `reparto_id` | solo i dipendenti di quel reparto |
| `utente`   | `user_id`                   | solo quel cliente                 |

### Helper centrale

[`src/helpers/ScadenzaACL.php`](src/helpers/ScadenzaACL.php) caricato
globalmente da `config.php`. API minimale:

```php
// $user = ['id'=>int, 'ruolo'=>string, 'azienda_id'=>?int]
[$where, $params] = ScadenzaACL::whereForUser($user, 's');  // 's' = alias tabella
// Append a una query:
$stmt = $db->prepare("SELECT … FROM scadenze s WHERE … AND $where");
$stmt->execute(array_merge([...], $params));

// Comodo: costruisce $user dalla sessione corrente
$user = ScadenzaACL::userFromSession();
```

Per i ruoli interni (`admin`/`direzione`/`responsabile`/`operatore`/`capoufficio`)
`whereForUser` ritorna `'1=1'` con zero parametri — visibilità totale per la
gestione. Il pannello admin (`/admin/scadenze`) **non** usa il filtro e vede
tutte le scadenze del tenant.

### Punti di consumo

- [`public/calendario.php`](public/calendario.php) — 3 query (mese, tutte, memo)
- [`public/dashboard.php`](public/dashboard.php) — count "scadenze prossime"
- [`api/ai-cliente.php`](api/ai-cliente.php) — context per AI assistant

### Quarantena retroattiva

La migration imposta `attivo=0` e `da_revisionare=1` per tutte le scadenze
`manuale` esistenti al momento dell'esecuzione — perché prima della migration
non avevano destinatario e l'admin deve revisionarle prima di ripubblicarle.

Il pannello [`/admin/scadenze`](admin/scadenze.php) mostra un **banner ambra
in cima** finché esiste almeno una scadenza in quarantena (`da_revisionare=1`
AND `attivo=0`). Il banner linka direttamente al filtro
`?filtro=tutte&origine=manuale`.

Quando l'admin riapre una scadenza in quarantena, salva con visibilità
esplicita e `attivo=1`, il POST handler azzera automaticamente
`da_revisionare`. Edit handler:

```sql
UPDATE scadenze SET …, da_revisionare = IF(? = 1, 0, da_revisionare) WHERE id=?
```

### Form admin (anti-errore)

Il modale "Nuova/Modifica scadenza" forza la scelta di visibilità (radio
group con 4 opzioni). Server-side validation respinge submit senza
`visibilita` valido o senza i campi richiesti dal livello scelto.

Per ridurre l'errore "memo personale pubblicato a tutti", c'è un
**JS warning anti-pasticcio**: se l'operatore sceglie `tutti` ma il titolo
contiene una sequenza di 2+ parole con iniziale maiuscola (regex match
su nome+cognome italiano), un `confirm()` chiede esplicitamente:

> Il titolo contiene "Mario Rossi" — sembra un nome di persona. Confermi
> che NON è una scadenza personale?

Server-side i campi `azienda_id`/`reparto_id`/`user_id` vengono azzerati
automaticamente se non pertinenti al livello scelto (coerenza dello stato
DB). La coerenza `reparto ∈ azienda` e `user.ruolo='cliente'` sono
verificate con query di lookup prima dell'INSERT/UPDATE (anti-tampering
del form).

### Cosa NON cambia

- Le scadenze `import_ufficiale` (Modello 770, IMU, F24, CCIAA, …) hanno
  `visibilita='tutti'` per default e via DEFAULT della colonna. Il cron
  [`bin/cron-sync-scadenze.php`](bin/cron-sync-scadenze.php) lo imposta
  esplicitamente sugli INSERT per chiarezza.
- Le scadenze `ai` (generate da Knowledge Base) restano `'tutti'` (basso
  rischio, sono suggerimenti generici).
- L'admin (`/admin/scadenze`) vede tutto, indipendentemente dalla
  visibilità.

## Circolari

Sistema completo di **comunicazioni broadcast** dello studio verso clienti
con motore AI integrato (riassunto, generazione, quiz comprensione, compliance
check, suggerimento tag), notifiche multi-canale (email + Telegram + Web Push),
A/B testing, calendario editoriale e versionamento. **Distinte da**:

- Comunicazioni 1-a-1 (`comunicazioni`) → ticket conversazionali
- Documenti (`documenti`) → file singoli con destinatario specifico

### Schema (8 tabelle)

| Tabella                                 | Cosa contiene                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `circolari`                             | testata + body_html + metadati + flag opzionali (vedi sotto)                                          |
| `circolari_destinatari`                 | routing: `target_tipo ENUM('tutti','azienda','reparto','utente')`                                     |
| `circolari_letture`                     | UNIQUE(circ, user) — `letta_at`, `confermata_at`, `tipo_lettura`, `email_variant` (A/B), `quiz_score` |
| `circolari_fonti`                       | URL+testo usati come grounding per AI generata                                                        |
| `circolari_solleciti_inviati`           | log idempotente solleciti (auto + manuali)                                                            |
| `circolari_audit`                       | append-only (trigger SIGNAL su UPDATE/DELETE) — log immutabile                                        |
| `circolari_tags` + `circolari_tag_link` | M:N tag normalizzati (slug-based dedup)                                                               |
| `circolari_email_invii`                 | tracciamento A/B test: ogni invio email con la variante assegnata                                     |

Colonne di `circolari` (estratto):

- `stato ENUM('bozza','scheduled','pubblicata','archiviata')`
- `modalita ENUM('upload','editor','ai_polish','ai_genera')`
- `versione INT, versione_padre_id INT NULL` — catena flat → root v.1
- `pdf_doc_id, pdf_hash` — PDF generato/uploadato + sha256 integrità
- `summary_html, summary_generated_at` — TL;DR AI on-demand
- `telegram_broadcast TINYINT` — invio anche su Telegram (priorità alta/urgente)
- `subject_variant_a/b VARCHAR(255)` — A/B test linea oggetto email
- `conferma_quiz TINYINT, quiz_json JSON` — quiz 3 domande generato dall'AI
- `solleciti_override JSON, sollecito_disabilitato TINYINT` — regole solleciti

### UI

- [`/admin/circolari`](admin/circolari.php) — lista con tab stato + **smart filters**
  (chip preimpostati: "Scadono entro 7g", "Ultime 30g", "<50% conferme dopo 3g",
  "100% confermate"). 4 azioni per riga (Apri/Modifica/Nuova versione/Riusa per
  nuovi destinatari/PDF/Archivia).
- [`/admin/circolari-edit`](admin/circolari-edit.php) — wizard 5-step con 3
  modalità (Upload PDF / Editor / AI Polish / AI Genera). AI Genera supporta:
  fonti URL multiple, **upload file PDF/DOCX/TXT** come fonti, **modello base**
  da circolare passata, **suggerimento tag AI** automatico.
- [`/admin/circolari-detail`](admin/circolari-detail.php) — 5 tab: Riepilogo,
  Letture (con **A/B test stats** se attivo), Versioni, Audit, Solleciti.
- [`/admin/circolari-config`](admin/circolari-config.php) — 2 tab:
  **Solleciti & retention** + **Struttura grafica PDF** (logo upload, header
  testo, colore, firma, footer, mockup live).
- [`/admin/circolari-calendario`](admin/circolari-calendario.php) — vista
  mensile drag-drop (vanilla JS, no fullcalendar). Drag delle "scheduled"
  per riprogrammare la `publish_at`.
- [`/circolari`](public/circolari.php) — lista cliente con filtri, badge
  "Da leggere"/"Confermata"/"v.N · aggiornata"/"PDF".
- [`/circolare/:id`](public/circolare.php) — vista singola con **TL;DR AI**
  (toggle on-demand), banner "Versione aggiornata" se l'utente aveva letto v.N-1,
  storico versioni collapsible. Quiz comprensione invece del bottone "Confermo"
  se attivo (3 domande, soglia 2/3).

### Modulo AI (CircolariAIService)

Tutti i metodi sono anti-allucinazione by design (system prompt severo +
low temperature + post-validation regex). Endpoint:

| Endpoint                          | Metodo service                          | Cosa fa                                                                        |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| `/api/circolare-ai-migliora`      | `migliora()`                            | Riformula testo dell'operatore (no fatti nuovi)                                |
| `/api/circolare-ai-genera`        | `scriviPerMe()`                         | Genera dal brief + fonti (URL/file). Opzionale `riferimento_id` (modello base) |
| `/api/circolare-fetch-url`        | `CircolariFonteService::fetchPreview()` | Estrae main content da URL (anti-SSRF, readability)                            |
| `/api/circolare-extract-file`     | `CircolariFileExtractor::estrai()`      | PDF/DOCX/TXT → testo (max 10 MB, max 50K chars)                                |
| `/api/circolare-summary`          | `riassunto()`                           | TL;DR 3-5 punti, persistito in `summary_html`                                  |
| `/api/circolare-suggest-tags`     | `suggerisciTags()`                      | Categoria + 1-4 tag dal body                                                   |
| `/api/circolare-compliance-check` | `complianceCheck()`                     | Euristici (date impossibili, importi sospetti) + AI (refusi, incoerenze)       |
| `/api/circolare-quiz`             | `generaQuiz()`                          | 3 domande a risposta multipla generate alla pubblicazione                      |

Provider: **Groq** (`llama-3.3-70b-versatile`). Costanti `GROQ_API_KEY` e
`GROQ_MODEL` in `master.php`.

### Notifiche multi-canale

Triggerate da `CircolariService::pubblica()` quando una circolare passa a
stato `pubblicata`:

1. **Email** (sempre) → `MailerService::inviaNotificaSistema('circolare_pubblicata')`
   con opt-in cliente. Se sono settati `subject_variant_a/b`, split A/B 50/50
   con tracciamento per utente in `circolari_email_invii`.
2. **Telegram** (se `telegram_broadcast=1`) → `TelegramService::sendMessage`
   ai chat_id linkati con opt-in cliente (`user_preferenze.notif_telegram_circolari`).
3. **Web Push** (se priorità in `{alta, urgente}`) →
   `PushNotifyService::inviaABroadcast` agli endpoint sottoscritti.
   Cleanup automatico endpoint scaduti (404/410).

### Solleciti automatici

Cron `/etc/cron.d/portal-backup` (5 min) → [`bin/cron-circolari-scheduler.php`](bin/cron-circolari-scheduler.php):

- Pubblica circolari `scheduled` con `publish_at <= NOW()`
- Invia solleciti dovuti per `richiede_conferma=1` non confermate
- Regole globali in `impostazioni.circolari_solleciti_default` (default `{ritardi:[3,7], max:2}`)
- Override per-circolare in `circolari.solleciti_override`
- Idempotente via `circolari_solleciti_inviati` (UNIQUE su circ+user+indice)

### Predisposto per futuro

Il campo `circolari.azienda_mittente_id` è già nello schema. Quando si vorrà
permettere all'admin di un'azienda cliente di inviare circolari ai propri
dipendenti, basta:

1. Aggiungere ACL: chi è `cliente_admin` può creare circolari della sua azienda
2. Costruire UI lato cliente per la composizione (oggi non esiste)
3. Filtrare `puoVedere` per controllare la coerenza azienda mittente/destinatari

## Questionari

Modulo per **raccogliere dati strutturati dai clienti**: lo studio crea
questionari (a mano o con AI), li invia a 1+ clienti, raccoglie e consulta
le risposte. È lo speculare delle Circolari (broadcast OUT vs raccolta IN);
vive nel modulo **Documenti & Circolari** (nav voce `Questionari`).

### Schema (5 tabelle per-tenant — `migrations/44_questionari.sql` + `45_questionari_notifiche.sql`)

- `questionari` — testata: `titolo`, `descrizione`, `stato`
  (`bozza`/`inviato`/`chiuso`/`archiviato`), `is_template`, `template_padre_id`,
  `modalita` (`manuale`/`ai`), `created_by`, `inviato_at`, `chiuso_at`
- `questionari_domande` — `tipo` ENUM (`testo_breve`/`testo_lungo`/
  `scelta_singola`/`scelta_multipla`/`numero`/`data`), `testo`, `descrizione`,
  `opzioni` JSON, `obbligatoria`, `ordine`
- `questionari_destinatari` — targeting `tutti`/`azienda`/`reparto`/`utente`
  (stesso pattern di `circolari_destinatari`)
- `questionari_risposte` — stato per cliente: `(questionario_id,user_id)` UNIQUE,
  `stato` (`da_compilare`/`in_corso`/`completato`), `iniziato_at`,
  `completato_at`, `sollecitato_at` (marker sollecito, una sola volta)
- `questionari_risposte_dettaglio` — risposta per domanda:
  `(risposta_id,domanda_id)` UNIQUE, `valore` TEXT, `valore_multi` JSON

Le 5 tabelle sono anche in `01_studio_template.sql` per i nuovi tenant.

### Service — `src/services/QuestionariService.php`

Motore del modulo: `listForStudio`/`listForCliente`, `get`/`getDomande`,
CRUD testata, `salvaDomande`, `duplica` (anche come modello), `invia`
(espande il targeting in righe `questionari_risposte` + notifica email),
`salvaRisposte` (compilazione cliente, parziale o definitiva), `getRisposte`/
`getRisposteUtente`, `statoCompilazione`, `inviaSolleciti` (per il cron).
I questionari **bozza** e i **modelli** sono modificabili; gli **inviati** no.

### AI — `QuestionariAIService` + `/api/questionario-ai-genera`

`generaDomande($brief)` genera le domande tipizzate da un brief in linguaggio
naturale, riusando il canale Groq di `CircolariAIService::chiamaGroqPubblica`
(pseudonimizzazione + audit AI inclusi). Solo ruoli interni con
`questionari.gestire`, bloccato in modalità ispezione.

### UI

- **Studio**: `/admin/questionari` (lista con tab bozze/inviati/chiusi/modelli),
  `/admin/questionario-edit` (editor: testata, domande, AI, destinatari,
  salva bozza / salva e invia), `/admin/questionario/:id` (risposte: KPI +
  stato per cliente + dettaglio domanda/risposta, chiudi/duplica).
- **Cliente**: `/questionari` (da compilare + storico), `/questionario/:id`
  (compilazione; sola lettura dopo l'invio o se il questionario è chiuso).
  Voce sidebar + badge "da compilare" + tile sulla dashboard.

### Notifiche & solleciti

3 eventi in `notifiche_config` (configurabili da `/admin/notifiche`, gruppo
Questionari): `questionario_assegnato` (→ cliente all'invio),
`questionario_completato` (→ studio al completamento), `questionario_sollecito`
(promemoria). Template in `src/notifiche_default.php`. I solleciti automatici
girano come **Task 3** di `bin/cron-circolari-scheduler.php`:
`QuestionariService::inviaSolleciti(7, 200)` invia un promemoria ai clienti
che non hanno compilato dopo 7 giorni dall'invio (idempotente via
`sollecitato_at`; skip pulito se le tabelle non esistono sul tenant).

### ACL

Permesso `questionari.gestire` (operatore/responsabile/direzione; admin
sempre). Il lato cliente non richiede permessi: il cliente vede solo i
questionari che ha ricevuto.

## Reazioni emoji ed emoji picker (chat)

I messaggi delle comunicazioni supportano **reazioni emoji** stile WhatsApp/Slack:

- **Toolbar reazioni**: bottone `+ 😊` sotto ogni messaggio → apre popup
  con 8 emoji rapide (👍 ❤️ 😂 😮 😢 🙏 👏 🔥). Click aggiunge la reazione.
  Click di nuovo sulla pillola la rimuove (toggle).
- **Pillole aggregate** sotto la bubble: `👍 3` `❤️ 1` con stato "mine"
  evidenziato (la mia reazione ha bordo + sfondo primary).
- **Whitelist server-side** in `api/com-reazione.php` (10 emoji ammesse):
  `['👍','❤️','😂','😮','😢','🙏','👏','🔥','✅','💯']` — niente input free,
  evita spam e mantiene UI consistente.
- **DB**: tabella `com_reazioni (messaggio_id, user_id, emoji)` con
  `UNIQUE (messaggio_id, user_id, emoji)` — stessa emoji da stesso utente
  non si può duplicare.

**Emoji picker nell'input**: bottone 😊 accanto al campo di scrittura
apre un picker con ~50 emoji organizzate per categoria (Frequenti, Volti,
Lavoro, Avvisi). Click inserisce l'emoji nella posizione del cursore.

**Implementazione**: tutto in [`src/com_reazioni_ui.php`](src/com_reazioni_ui.php):
helper PHP `renderReazioniHtml($msg)` per stampare le pillole e
`renderReazioniAssets()` per emettere CSS+JS una volta sola. Incluso da
[`/admin/comunicazione-detail`](admin/comunicazione-detail.php) e
[`/comunicazione/:id`](public/comunicazione.php). Le reazioni sono
pre-caricate in batch in `ComunicazioneController::getDettaglio()` per
evitare N+1 (singola query GROUP BY su `com_reazioni`).

## Pagine legali

[`platform/legal.php`](platform/legal.php) serve 3 documenti via parametro
`?doc=privacy|cookie|termini`. Rotte clean: `/privacy`, `/cookie`, `/termini`.

Sono **versioni provvisorie** con disclaimer esplicito "sito in fase di
sviluppo, non addibito alla reale vendita". Saranno sostituite da termini
contrattuali completi prima del lancio.

Il footer della landing linka tutti e 3. Il form di contatto linka `/privacy`
nel disclaimer di trattamento dati. Cookie banner minimale informativo
(solo cookie tecnici → no consenso obbligatorio, ma è buona prassi avvisare).

## Front Controller / Clean URL

Da inizio 2026 (build interno `26.0.X`) il portale usa un front controller per
esporre URL puliti senza estensione `.php`. La pagina di partenza è [public/index.php](public/index.php),
il router è [src/Router.php](src/Router.php) e la tabella delle rotte è in
[src/routes.php](src/routes.php).

### Architettura

```
URL pubblico                   ↓ rewrite ↓             Controller
─────────────────────────────────────────────────────────────────────
/login                         /index.php?_r=login     public/login.php
/dashboard                     /index.php?_r=dashboard public/dashboard.php
/comunicazione/12              ...                     public/comunicazione.php (id=12)
/admin/aziende                 ...                     admin/aziende.php
/admin/comunicazione/5         ...                     admin/comunicazione-detail.php
/api/ricerca?q=test            ...                     api/ricerca.php
/superadmin/login              ...                     superadmin/login.php
```

I 4 `.htaccess` (`public/`, `admin/`, `api/`, `superadmin/`) fanno rewrite
**solo** per file/dir non esistenti. I vecchi URL `.php` legacy continuano
a rispondere senza modifiche (transparent passthrough = backward compat 100%).

### Pattern di pagina (con clean URL)

Le pagine continuano a essere file `.php` standalone. Il router le include
direttamente. Differenze:

- **Parametri URL**: arrivano sia in `$_GET[id]` (compat) sia in
  `$_ROUTE[id]`. Esempio: `/comunicazione/12` → `$_GET['id']=12`.
- **Pagina corrente nelle sidebar**: deriva da `$_SERVER['REQUEST_URI']`
  via `basename` + `.php` aggiunto, NON più da `PHP_SELF` (che ora è
  sempre `/index.php`). Vedi `admin/sidebar.php` e `public/sidebar-cliente.php`.

### Aggiungere una rotta clean

```php
// In src/routes.php
$router->add('/nuova-pagina', $PUB . 'nuova-pagina.php', 'nuova');
$router->add('/dettaglio/:id', $PUB . 'dettaglio.php', 'dettaglio');
```

Poi nei link:

```php
$router = require dirname(__DIR__) . '/src/routes.php';
$url = $router->url('dettaglio', ['id' => 42]);   // → /dettaglio/42
```

Oppure puoi scriverlo direttamente: `<a href="/dettaglio/42">`.

### Cosa NON fare

- **Niente `.php` nei nuovi link interni**: `<a href="/admin/aziende">`,
  non `<a href="/admin/aziende.php">`. Tutti i link nella sidebar/topbar
  sono già migrati. I link `.php` esistenti continuano a funzionare ma
  vanno gradualmente puliti.
- **Niente `header('Location: pagina.php')` nei nuovi controller**: usare
  l'URL pulito (`header('Location: /pagina')`).
- **Non rimuovere** i `.htaccess` di admin/api/superadmin: senza, le clean
  URL su quei pannelli smettono di funzionare (vhost ha `Alias` che
  bypassano `public/.htaccess`).

## Convenzioni

- **CSS variables**: `--primary` impostata da branding studio
  (`impostazioni.studio_colore_primario`)
- **Indentazione**: 4 spazi PHP/JS, 2 in HTML/CSS
- **Naming DB**: snake*case, prefissi tabelle = nome modulo (`com*_`, `kb\__`,
`numerixl\_\*` se mai si reintegra)
- **Upload paths**: salvati come `comunicazioni/<comId>/<file>` (relativi a
  `uploads/`), serviti via API `/api/com-allegato.php?id=N` con check
  autorizzazione
- **Audit**: chiamare `auditLog($azione, $entita, $entitaId, $dettagli)` per
  ogni modifica significativa

## Design system / Standard UI

Single source of truth: **`public/assets/portal.css`** — token + componenti
base. Layer dell'app admin: **`public/assets/portal-app.css`** — la "chrome"
app-style (classi `.pa-*`). Obiettivo: bottoni, menu e stili con dimensioni
e colori uguali ovunque, salvo motivo esplicito per variarli.

**Token** (definiti in `portal.css :root`) — usarli SEMPRE, mai valori fissi:

| Gruppo          | Token                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Radius          | `--r-sm 6` · `--r-md 10` · `--r-lg 14` · `--r-xl 18` · `--r-2xl 24`                                                                 |
| Spacing         | `--sp-1`…`--sp-10` (4→40px)                                                                                                         |
| Type            | `--fs-xs`…`--fs-2xl`                                                                                                                |
| Colori          | `--c-bg/-card/-text/-muted/-light/-border/-divider/-hover`; stati `--c-success/-warning/-danger/-info` (+ `-bg`); brand `--primary` |
| Shadow / easing | `--sh-sm/-md/-lg` · `--ease`                                                                                                        |

I colori `--c-*` si adattano da soli al tema scuro: usarli = dark mode gratis.

**Componenti pronti** — usarli, NON ridefinirli nel `<style>` di pagina:

- `portal.css`: `.btn`/`.btn-primary`, `.page-header` (+`.brand/.purple/…`),
  `.kpi-grid`/`.kpi-card`, `.kpi-pills`/`.kpi-pill`, `.card-pad`, `.sezione-title`
- `portal-app.css`: chrome → `.pa-topbar`/`.pa-nav`/`.pa-rail`/`.pa-user-*`;
  azioni → `.pa-btn-primary` / `.pa-btn-soft` / `.pa-btn-danger` (+ `.pa-btn-sm`);
  `.pa-page-head`, `.pa-stat-pill`

**Bottoni**: per le pagine app-style esiste UN solo set — `.pa-btn-primary`
(azione principale), `.pa-btn-soft` (secondaria), `.pa-btn-danger`. Stessa
dimensione/raggio/peso per tutti. NON creare nuove classi bottone
(`.btn-cta`, `.btn-xyz`, …): è la causa storica dell'incoerenza.

**Regole per ogni nuova pagina o evoluzione UI:**

1. Solo classi standard per bottoni/card/header — niente nuove varianti.
2. Niente valori hardcoded di radius/spacing/colore: usare i token
   (`var(--r-md)`, `var(--c-border)`, `var(--sp-3)`, …).
3. Il `<style>` di pagina contiene SOLO CSS specifico di QUELLA pagina
   (es. `.com-row` della lista comunicazioni), mai componenti generici.
4. Mai `background: white` o hex fissi per superfici/testo: rompono il
   tema scuro — usare `var(--c-card)`, `var(--c-text)`, ecc.

**Legacy da far convergere**: ~27 pagine admin hanno ancora un blocco
`<style>` inline che ri-definisce componenti generici (es. `.btn-cta`
duplicato identico in 11 file) con valori fissi. Non vanno riscritte in
massa: quando si tocca una pagina, sostituire le classi custom con quelle
standard e togliere la CSS duplicata. Ogni pagina NUOVA nasce conforme.

## Portafogli (visibilità ristretta operatori)

Sistema opt-in per limitare la visibilità di aziende, ticket, documenti
ecc. a sottoinsiemi di operatori (scenari "studio associato",
"specializzazione per area", "VIP riservati"). **Toggle OFF di default**:
finché l'admin non lo attiva esplicitamente, ogni operatore continua a
vedere tutto come prima — zero blast radius. Spec completa in
[docs/prompt-portafogli-scoping.md](docs/prompt-portafogli-scoping.md).

### Primitiva

Un **portafoglio** è un gruppo M:N di N aziende ↔ M operatori. Ogni
azienda può stare in N portafogli, ogni operatore in N portafogli. Le
aziende **orfane** (non in alcun portafoglio) sono visibili a TUTTI gli
operatori per default (D4 "default-allow"): l'admin decide cosa
riservare, il resto resta open.

Schema in [migrations/60_portafogli.sql](migrations/60_portafogli.sql) +
template per i nuovi tenant. 3 tabelle: `portafogli`,
`portafoglio_aziende`, `portafoglio_operatori`. CASCADE su eliminazione
azienda/operatore. Audit codes: `portafoglio_creato/modificato/eliminato`,
`portafoglio_membro_aggiunto/rimosso`, `portafoglio_azienda_aggiunta/rimossa`,
`scoping_attivato/disattivato`, `vista_globale_attivata/disattivata`,
`com_accesso_negato_scoping`.

### Gerarchia ruoli (D3)

| Ruolo                                      | Comportamento                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `admin`                                    | SEMPRE above-scope (no switch)                                                                                                                               |
| `direzione`                                | Scoped di default ai propri portafogli, con **switch persistente** "Vista globale studio" in topbar (`user_preferenze.vista_portafogli` = `scoped`/`global`) |
| `responsabile`, `operatore`, `capoufficio` | Scoped fissi ai loro portafogli (no switch)                                                                                                                  |
| `cliente` e altri                          | Mai usato — lato cliente esistono ACL diverse (`ScadenzaACL` ecc.)                                                                                           |

### Helper centrale: `PortafoglioACL`

[src/helpers/PortafoglioACL.php](src/helpers/PortafoglioACL.php), pattern
speculare di `ScadenzaACL`. API:

```php
// Toggle tenant (cache per-request)
PortafoglioACL::attivo(): bool

// True se utente è above-scope (admin, direzione/global, oppure toggle OFF)
PortafoglioACL::aboveScope(array $user): bool

// Set azienda_id visibili (membri portafogli + ORFANE). Cache per-request.
PortafoglioACL::aziendeVisibili(array $user): array

// [whereSql, params] da appendere a una query. '1=1' se above-scope.
PortafoglioACL::whereForUser(array $user, string $alias = '', string $col = 'azienda_id'): array

// Gate booleano (apertura scheda azienda, gate ticket, ecc.)
PortafoglioACL::puoVedere(int $aziendaId, array $user): bool

// Filtro destinatari email: appartenenza OGGETTIVA (non vista_portafogli)
PortafoglioACL::filtraDestinatari(int $aziendaId, array $userIds): array

// Switch vista_portafogli (solo direzione). Audit log.
PortafoglioACL::impostaVistaGlobale(int $userId, bool $globale): bool

// $user dalla sessione con vista_portafogli risolta
PortafoglioACL::userFromSession(): ?array

// EXISTS subquery per entità con destinatari M:N (Fase 3:
//   circolari_destinatari, questionari_destinatari).
// Gestisce target_tipo 'tutti'|'azienda'|'reparto'|'utente' con
// risoluzione automatica reparto/utente → azienda.
PortafoglioACL::whereExistsDestinatari(
    array $user, string $linkTable, string $linkCol, string $parentAlias, string $parentIdCol='id'
): array

// Gate booleano corrispondente per pagine detail. Fail-closed su errore DB.
PortafoglioACL::puoVedereDestinatari(
    int $entityId, array $user, string $linkTable, string $linkCol
): bool
```

Caricato globalmente da [src/config/config.php](src/config/config.php). Quando
il toggle è OFF, `aboveScope()` ritorna `true` sempre → overhead zero.

### Punti di applicazione (Fase 2 — completata)

| File                                                                                       | Cosa filtra                                                            |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [api/aziende-search.php](api/aziende-search.php)                                           | Lista + facet (città/settore/RFM) + COUNT                              |
| [admin/azienda-detail.php](admin/azienda-detail.php)                                       | Gate 404 (non 403, per non rivelare esistenza)                         |
| [src/AziendaScope.php](src/AziendaScope.php)                                               | `notFound()` ora `public` per riuso dei gate                           |
| [src/controllers/ComunicazioneController.php](src/controllers/ComunicazioneController.php) | `getTutte` + `countTutte` + `getConteggi`                              |
| [admin/comunicazione-detail.php](admin/comunicazione-detail.php)                           | Gate view + tutti i POST handlers (audit `com_accesso_negato_scoping`) |
| [api/ricerca.php](api/ricerca.php)                                                         | Blocchi aziende, comunicazioni, documenti, reparti                     |
| [api/notifiche.php](api/notifiche.php)                                                     | Badge polling topbar (com + urgenti)                                   |
| [admin/\_moduli.php](admin/_moduli.php)                                                    | KPI home `comunicazioni` + `clienti`                                   |
| [admin/home.php](admin/home.php)                                                           | Cache key per-user quando scoped (vs tenant-wide above-scope)          |

UI già installata in Phase 1:

- Pill "Vista" in [admin/\_app_head.php](admin/_app_head.php) (solo direzione +
  toggle ON), JS `paSetVista()` chiama
  [api/preferenze-vista-portafogli.php](api/preferenze-vista-portafogli.php)
- Banner globale "Vista globale studio attiva" sotto la topbar quando
  direzione è in `global`
- Hub `/admin/portafogli` + tab "Portafogli" nella scheda azienda +
  sezione nel modal utente

### Punti di applicazione (Fase 3 — completata, PR #27)

Pattern: i documenti/scadenze con `visibilita='tutti'` (broadcast tenant)
restano visibili a chiunque; gli altri target (azienda/reparto/utente)
sono filtrati per appartenenza azienda al portafoglio.

| File                                                                                                                                    | Cosa filtra                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [admin/documenti.php](admin/documenti.php)                                                                                              | Lista + count (forza count se utente scoped)                                                                                                        |
| [admin/scadenze.php](admin/scadenze.php)                                                                                                | Lista                                                                                                                                               |
| [admin/circolari.php](admin/circolari.php)                                                                                              | Lista via `whereExistsDestinatari`                                                                                                                  |
| [admin/circolari-detail.php](admin/circolari-detail.php)                                                                                | Gate 404-like (`?msg=non_trovata`) via `puoVedereDestinatari`                                                                                       |
| [admin/questionari.php](admin/questionari.php) + [src/services/QuestionariService::buildListWhere](src/services/QuestionariService.php) | Lista + count, filtro centrale nel service                                                                                                          |
| [admin/questionario-detail.php](admin/questionario-detail.php)                                                                          | Gate 404-like (redirect lista)                                                                                                                      |
| [src/helpers/Storage::userPuoVedere](src/helpers/Storage.php)                                                                           | Gate download interni scoped (`'tutti'` sempre permesso, altrimenti `azienda IN scope`). Popola `vista_portafogli` da `user_preferenze` se mancante |

### Punti di applicazione (Fase 4 — completata, PR #30)

Filtro centrale nelle notifiche email automatiche. Opt-in tramite
`context.azienda_id`: i caller che non lo passano restano invariati.

| File                                                                                                       | Cosa                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [src/services/MailerService::inviaNotificaSistema](src/services/MailerService.php)                         | Filtro centrale: se `context.azienda_id > 0` e scoping attivo, applica `PortafoglioACL::filtraDestinatari` ai destinatari con `id`. Email-only (senza `id`) sempre dentro. Log error_log + `skipped_reason: 'tutti_fuori_scope'` se rimane vuoto |
| [src/controllers/ComunicazioneController::inviaNotificaEmail](src/controllers/ComunicazioneController.php) | Passa `azienda_id` nel context (5 eventi `ticket_*`)                                                                                                                                                                                             |
| [public/documenti.php](public/documenti.php) `inviaNotificaUploadDaCliente`                                | Passa `azienda_id` nel context (cliente carica → notifica operatori)                                                                                                                                                                             |

**Bugfix in Fase 4**: `PortafoglioACL::filtraDestinatari` escludeva
clienti dal return (regola scoped tratteneva solo `scopedRuoli`). Fix:
split `alwaysInIds` (admin + clienti + ruoli non scoped) vs `candidati`
(solo scoped). Tutti gli `alwaysInIds` finiscono sempre nel set finale.

**Caller NON modificati per design** (destinatari clienti o broadcast):
`CircolariService::pubblica`, `QuestionariService` notifiche,
`CircolariSollecitiService`, `admin/documenti.php documento_caricato`,
`bin/cron-scadenze-memo.php`, `bin/cron-alert-disponibilita.php`,
`AuthController` eventi auth.

### Fase 5 — completata (PR #31)

- [src/guide_content.php](src/guide_content.php): voce "Portafogli ·
  visibilità ristretta operatori" in guida admin (`ruolo_min='admin'`),
  dopo "Ruoli e permessi (ACL)"
- [platform/legal.php](platform/legal.php): §6bis "Controllo accessi
  interni allo studio" (privacy GDPR — responsabilità studio vs platform)

### Aziende orfane (D4)

Le aziende non assegnate ad alcun portafoglio sono visibili a TUTTI gli
operatori per default. Politica chiamata "default-allow": l'admin decide
cosa riservare, il resto resta libero. Quando un'azienda viene rimossa da
tutti i portafogli torna orfana → riappare a tutti.

### Notifiche email e Push (D7, Fase 4)

Quando una notifica ha un `azienda_id` nel context, `MailerService` filtra
i destinatari via `PortafoglioACL::filtraDestinatari($aid, $userIds)`. Il
filtro usa l'**appartenenza al portafoglio**, NON `vista_portafogli`: la
direzione in vista globale NON riceve email per clienti che non sono nei
suoi portafogli (sarebbe noise). Admin sempre dentro.

### Seed demo

[bin/seed-portafogli-demo.php](bin/seed-portafogli-demo.php) crea 3
portafogli demo (Team Mario / Team Lucia / VIP riservati) con
cross-link per testare l'unione dei set. Riusa aziende e operatori
esistenti del tenant. Idempotente (`INSERT IGNORE`). Flag `--reset`
per pulire prima del seed.

```bash
# Anteprima
sudo -u www-data php /var/www/portal/bin/seed-portafogli-demo.php --tenant=portal --dry-run -v

# Applica
sudo -u www-data php /var/www/portal/bin/seed-portafogli-demo.php --tenant=portal -v

# Reset + re-seed
sudo -u www-data php /var/www/portal/bin/seed-portafogli-demo.php --tenant=portal --reset -v
```

### Cosa NON fare con i portafogli

- **Non usare `vista_portafogli='global'` come "bypass di sicurezza"**: il
  filtro destinatari email/Push usa l'appartenenza oggettiva al portafoglio,
  non la vista UI. Un direzione in `global` vede tutto MA non riceve email
  per clienti che non sono nei suoi portafogli.
- **Non rispondere con 403** sui gate scoped: usare 404 (non rivelare
  l'esistenza dell'azienda/ticket fuori scope). Vedi `AziendaScope::notFound()`.
- **Non passare `$user` come parametro ai metodi del ComunicazioneController**:
  il controller legge `PortafoglioACL::userFromSession()` internamente per
  retro-compat con tutti i caller esistenti.
- **Non rinominare la chiave `vista_portafogli`** in `user_preferenze`: è
  l'unica fonte di verità per lo switch della direzione, e c'è già del
  codice JS (`paSetVista`) che la cerca per nome.
- **Non filtrare un broadcast `target_tipo='tutti'`** per scoped (circolari,
  scadenze, documenti `visibilita='tutti'`): è broadcast tenant-wide per
  design. Lo scoping si applica SOLO ai target azienda/reparto/utente.

## Comandi utili

### DB

```bash
# Connessione master
mysql -u portal_master_user -p'Portal#Master2026!' portal_master

# Studio default
mysql -u portal_main_user -p'Portal#Main2026!' portal_main

# Backup tenant
mysqldump -u root portal_main > backup_$(date +%F).sql
```

### Provisioning nuovo studio (manuale)

In genere usare `/superadmin/crea-studio` dal pannello. Solo per emergenze:

```bash
# Crea DB + user
mysql -u root <<SQL
CREATE DATABASE portal_<slug> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'portal_<slug>_user'@'localhost' IDENTIFIED BY '<pass>';
GRANT ALL ON portal_<slug>.* TO 'portal_<slug>_user'@'localhost';
SQL

# Importa schema
sed 's/portal_template/portal_<slug>/g' /var/www/portal/migrations/01_studio_template.sql \
  | mysql -u root

# Registra in master
mysql -u root portal_master <<SQL
INSERT INTO studios (nome, slug, db_host, db_name, db_user, db_pass, piano)
VALUES ('Studio Demo', '<slug>', 'localhost', 'portal_<slug>',
        'portal_<slug>_user', '<pass>', 'base');
SQL

# Crea admin nello studio
mysql -u portal_<slug>_user -p portal_<slug> <<SQL
INSERT INTO users (nome, email, password_hash, ruolo, attivo)
VALUES ('Admin', 'admin@example.com', '<bcrypt_hash>', 'admin', 1);
SQL
```

### Apache

```bash
# Test config
apache2ctl configtest

# Reload
systemctl reload apache2

# Log errori (filtra portal)
tail -f /var/log/apache2/portal-error.log
```

### PHP-FPM / OPcache

```bash
# Reload graceful: drena le request in volo, ricicla i worker,
# ri-esegue il preload (src/preload.php). Nessun downtime visibile.
sudo /var/www/portal/bin/opcache-reload.sh     # = systemctl reload php8.2-fpm

# Stato del servizio + log
systemctl status php8.2-fpm
sudo tail -f /var/log/php8.2-fpm.log
```

Da lanciare dopo aver modificato uno dei 10 file in `src/preload.php`
(AuthController, Storage, Router, Csrf, ACLController, database, RateLimit,
AIPolicy): sono congelati all'avvio del worker. Gli altri file PHP, su questo
box di test, vengono ripresi automaticamente entro ~2s.

**Pool tuning** (`/etc/php/8.2/fpm/pool.d/www.conf`):

```ini
pm = dynamic
pm.max_children = 15
pm.start_servers = 4
pm.min_spare_servers = 2
pm.max_spare_servers = 8
pm.max_requests = 500
```

Tarati per ~50 utenti concorrenti (15 worker × ~40 MB busy ≈ 600 MB
nominale, su un host con ~1 GB libero). `pm.max_requests=500` ricicla il
worker dopo N richieste rilasciando la RAM trattenuta da OPcache + handle
PDO. Backup della config precedente in `pool.d/www.conf.bak-<data>`.

Prima di ridimensionare oltre questi valori, ri-lanciare lo stress test in
`/var/www/portal-stresstest/` e leggere `capacity-<run-id>.md`. Lo stress
test del 2026-05-26 con 5 worker mostrava 8 % di campioni con tutti i
worker busy (saturazione FCGI) e p95 = 139 ms vs p50 = 33 ms: la nuova
config porta il buffer a 15.

**Swap di emergenza**: `/swapfile` 2 GB attivo + persistente in
`/etc/fstab` (`/swapfile none swap sw 0 0`). Non per uso normale, è una
rete di sicurezza contro OOM su picchi anomali (il box non ha RAM ridondante).

### Permessi uploads

```bash
chown -R www-data:www-data /var/www/portal/uploads
chmod -R u+rwX,g+rwX /var/www/portal/uploads
```

## Cose da NON fare

- **Non aggiungere `mysqli` o framework** — il codice è puro PHP+PDO
- **Non includere file da `vendor/`** se non strettamente necessario; preferire
  composer autoloader (`vendor/autoload.php`) dove serve
- **Non hardcodare URLs** — usare `APP_URL` o costruire da
  `$_SERVER['HTTP_HOST']`
- **Non bypassare AuthController** — sempre `richiediLogin()` come prima
  istruzione delle pagine protette
- **Non esporre la chiave Groq al frontend** — sempre via endpoint server-side
- **Non aggiungere emoji decorative** nelle UI nuove; usare Bootstrap Icons
  (es. `bi-robot`, `bi-shield-fill`). Le emoji sono OK solo come "valore"
  (avatar, reparto icon) o nei contenuti utente
- **Non scrivere `background: white` hardcoded** in nuove pagine: usare
  `var(--c-card)` per beneficiare del tema scuro. Se proprio serve, aggiungere
  override `[data-theme="dark"]` esplicito
- **Non duplicare la topbar superadmin**: tutte le pagine SA includono
  `_topbar.php` + `_topbar-end.php`. Aggiungere stili specifici solo dentro
  un `<style>` locale, gli stili condivisi vivono in `public/assets/sa.css`.
- **Non parsare SQL splittando solo per `;`**: i commenti `-- ...` possono
  catturare interi statement. Stripparli con `preg_replace('/^\s*--.*$/m', '', $sql)`
  PRIMA dello split. È il fix in `crea-studio.php` per l'errore FK 1824.
- **Non usare `SELECT *` con `PDO::FETCH_UNIQUE`**: la modalità indicizza
  l'array per la **prima colonna** del SELECT, che con `SELECT *` è quasi
  sempre `id` — non quello che vuoi. Esplicita le colonne mettendo per prima
  quella che fa da chiave (es. `SELECT evento, id, ... FROM notifiche_config`).
  È il fix per [admin/notifiche.php](admin/notifiche.php) — le card non
  rendevano perché `$cfgRows[$evento]` cercava chiavi che erano gli ID numerici.
- **Non scrivere `?>` nei commenti `//` di file PHP**: i commenti single-line
  PHP terminano alla `?>` o al `\n`, **whichever comes first**. Quindi
  `// vedi <?php require ?>` chiude prematuramente il blocco PHP e tutto
  il codice successivo viene trattato come HTML. Pattern corretto: scrivi
  i tag in modo descrittivo (`require_once …` senza `<?php`) o usa commenti
  block `/* ... */` che non hanno questo problema.
- **Non ignorare il probe MySQL** nelle pagine superadmin: se chiami
  direttamente `_portal_master_pdo()` senza il try/catch + `_standby.php`,
  dopo un riavvio l'utente vede 500 invece della pagina di attesa.
- **Non lasciare `master.php` con group `root`** dopo una modifica via tool:
  PHP-FPM gira come `www-data`, e `master.php` ha permessi `640` per non
  esporlo. Se il group salta a `root`, il file diventa illeggibile e tutto
  il sito risponde 500. Dopo qualsiasi edit di `master.php` ripristinare:
  `sudo chown root:www-data /var/www/portal/src/config/master.php && sudo chmod 640 $_`.
- **Non servire mai i file di `storage/` direttamente via Apache**: l'unica
  via è `Storage::serve()` (che applica ACL + password + tracking lettura).
  La cartella è fuori dal DocumentRoot, ma se si aggiunge un Alias o un
  symlink dentro `public/` si crea un'esposizione critica. Vedi i 3 livelli
  di blocco in "Storage documenti".
- **Non fare `header('Location: home.php')` né `header('Location: /admin/home')`
  hardcodati**: usa sempre `AuthController::homeUrlPerRuolo($_SESSION['user_ruolo'] ?? '')`,
  così operatori e capoufficio atterrano su `/admin/comunicazioni` invece che sul
  cruscotto inutile. Pattern corretto:
  `header('Location: ' . AuthController::homeUrlPerRuolo($_SESSION['user_ruolo'] ?? ''));`
- **Non riusare `PasskeyService` (tenant) per il pannello superadmin**:
  legge da `Database::getInstance()` (DB tenant) e da `STUDIO_ID` per il
  userHandle, e l'`rpId` viene dal sub-dominio corrente. Per il superadmin
  c'è [`SuperadminPasskeyService`](src/services/SuperadminPasskeyService.php)
  che usa `_portal_master_pdo()`, tabella `superadmin_webauthn_credentials`,
  RP ID fisso al primo entry di `PLATFORM_HOSTS`. Sessione separata
  (`sa_passkey_*` vs `passkey_*`) per evitare collisioni. Stesso discorso
  vale per le rotte: gli endpoint passkey superadmin vivono sotto
  `/superadmin/passkey-*` (autenticati contro `superadmin_*`), non sotto
  `/api/passkey-*` (autenticati contro `user_*`).
- **Non assumere che `capoufficio` sia un ruolo manageriale**: è equiparato a
  `operatore` (rank 0 nella gerarchia di guide/tour, niente cruscotto, niente
  card carico/scadenze/audit sulla home). Per i livelli di management usa
  `responsabile` (rank 1) o `admin`/`direzione` (rank 2).
- **Non hardcodare `ruolo IN ('admin','direzione','responsabile','operatore','capoufficio')`**
  per le regole operative (assegnazione ticket, RFM, candidati portafoglio):
  usa `AuthController::RUOLI_OPERATIVI`, `RUOLI_RFM` o `RUOLI_INTERNI` a seconda
  del contesto. Vedi sezione "Ruoli operativi vs manageriali" + helper
  `AuthController::ruoloInWhere()`. `admin` e `direzione` non lavorano i ticket
  e non devono apparire nei dropdown "assegna a" — è governance, non
  operatività. Per query genuinamente "tutti gli interni" (ricerca utenti, KPI
  count totali, gating ACL "isInterno") usa `RUOLI_INTERNI` esplicito.
- **Non mescolare reparti team interno con reparti azienda**: sono due tabelle
  diverse (`reparti` vs `reparti_azienda`) con scopi opposti. I primi sono
  organigramma studio (oggi cosmetico, vedi "Reparti team interno"), i secondi
  sono usati per visibilità documenti/circolari/scadenze (`visibilita='reparto'`
  punta a `reparti_azienda.id`). Mai usare `reparti.id` per gating visibilità.
- **Non usare `global $var` in file inclusi tramite `Router::dispatch`**:
  quando un endpoint `/api/...` viene servito attraverso il front controller
  (`public/index.php` → `Router::dispatch` → `require $file`), il top-level
  del file incluso gira nello scope del **metodo** del Router, non in
  global scope. Quindi `$var = ...` al top di api/foo.php è LOCALE al metodo,
  e una funzione che fa `global $var` riceve null. È stato il bug che faceva
  rispondere 302/HTML invece di JSON al form contatti — vedi
  [api/contatto.php](api/contatto.php). Pattern corretto: leggi direttamente
  da superglobals (`$_SERVER`, `$_POST`, `$_GET`) dentro la funzione, oppure
  passa il valore come parametro. Non affidarti a `global`.
- **Non dimenticare `/api/*` tra le path "neutrali" di `richiediLogin`**:
  in `AuthController.php` c'è un blocco che reindirizza i ruoli interni
  non-admin (operatore/responsabile/capoufficio) fuori dalle pagine cliente.
  Tale blocco classifica come "interno" tutto ciò che inizia per `/admin/*`,
  `/superadmin/*` o `/api/*`. Se un endpoint API non rientra in nessuna
  di queste, gli operatori non-admin verranno **sempre redirezionati**
  dalla loro fetch e il client riceverà HTML al posto del JSON
  ("Errore di connessione"). Era il bug che bloccava `/api/ai-polish`
  e in generale ogni `/api/*` per gli operatori.
- **Non far rispondere un endpoint AJAX con un redirect 302**: il front-end
  ha bisogno di JSON. Pattern: leggi prima la response come `text()`,
  prova `JSON.parse`, e se fallisce mostra un messaggio diagnostico utile
  (status code + prime righe del body + euristica "sessione scaduta"
  cercando `/login` nell'URL finale) invece del generico "Errore di
  connessione". Vedi i fix in [api/contatto.php](api/contatto.php) e
  [admin/comunicazione-detail.php](admin/comunicazione-detail.php).
- **Non assumere che `MATCH() AGAINST()` con ngram parser copra tutti i
  match testuali**: il parser ha quirk noti (vedi sezione "Ricerca aziende
  e utenti" → "Quirk MySQL ngram"). Soluzione: la WHERE clause deve sempre
  combinare `MATCH(...) OR LIKE %x% OR nome_soundex = SOUNDEX(?)` con OR,
  così LIKE compensa le righe che FULLTEXT non trova. Stesso pattern nel
  `selectScore` per il ranking (FULLTEXT score + boost LIKE). Senza il
  fallback, query come "Maria" possono restituire 0 risultati anche se
  "Maria Rossi" è in tabella.
- **Non scrivere `header('Location: aziende.php')` con il vecchio formato
  della pagina lista**: il nuovo `admin/aziende.php` mantiene il pattern
  legacy POST → redirect → reload solo per `crea/modifica/toggle/elimina`.
  La lista in sé è AJAX e si auto-aggiorna. Il redirect server-side dopo
  il POST resta corretto perché il flash message viene mostrato e poi la
  lista si ricarica via JS.
- **Non aggiungere costanti/metodi a file in `src/preload.php` senza
  fare `sudo bin/opcache-reload.sh` subito dopo**: il box ha
  `opcache.preload` attivo sui 10 file core (AuthController, Storage,
  Router, Csrf, ACLController, database, RateLimit, AIPolicy). Le
  definizioni sono **congelate all'avvio di PHP-FPM**. Se modifichi
  AuthController per aggiungere una costante (`RUOLI_OPERATIVI`) o un
  metodo (`ruoloInWhere`) e poi un file consumer la referenzia, PHP
  fatal-erra con `Undefined constant` / `Call to undefined method`
  finché non rilanci `opcache-reload.sh`. Il bug è subdolo perché
  validate_timestamps=1 sui file NON in preload (modifiche riprese
  entro 2s), quindi sembra "tutto live" finché non tocchi un file
  preloaded. Bug reale catturato dallo stress test 2026-05-27 con 500
  ricorrenti su `/admin/comunicazione/N` dopo refactor RUOLI_OPERATIVI.

### Convenzione "no PWA external app"

Regola portal-wide: **mai aprire contenuto in modalità "app esterna" del
sistema operativo**. Quando il portale è installato come PWA su iOS o
Android, i link e i file aperti in modo sbagliato si rendono come un'app
fluttuante senza la chrome del browser — UX confusionaria, niente Indietro,
niente URL bar, niente tab. Le regole concrete:

1. **PDF e altri file scaricabili → sempre `?download=1`** (forza
   `Content-Disposition: attachment` lato `Storage::serve`). Il browser
   scarica il file invece di aprirlo nel viewer integrato. Pattern:

   ```php
   <a href="/api/documento?id=<?= $docId ?>&download=1" target="_blank">
       <i class="bi bi-download"></i> Scarica
   </a>
   ```

   Anti-pattern: `<a href="/api/documento?id=N" target="_blank">` senza
   `&download=1` → su PWA mobile apre il viewer "in-app" che ha l'aspetto
   di un'app esterna.

2. **Link a pagine esterne al dominio del tenant → URL assoluto +
   `target="_blank" rel="noopener noreferrer"`**. Su PWA mobile l'apertura
   nel browser di sistema è inevitabile (impostata dall'OS), ma con URL
   assoluto la pagina si carica correttamente; con URL relativo a una
   rotta che non esiste sul tenant host (es. `/privacy` su
   `rossi.studiodesk.cloud`) ottieni un 404 in-app che SEMBRA un'app
   esterna rotta. Pattern:

   ```php
   <a href="https://www.studiodesk.cloud/privacy" target="_blank"
      rel="noopener noreferrer">Privacy policy</a>
   ```

   Le rotte `/privacy`, `/cookie`, `/termini` vivono SOLO sui
   `PLATFORM_HOSTS` (vedi `public/index.php:45`) — non sui tenant.

3. **Link a pagine INTERNE del tenant → URL relativo, no `target="_blank"`**.
   Restano dentro la PWA, niente "app esterna" del SO. Pattern:

   ```php
   <a href="/admin/comunicazioni">Vai alla lista</a>
   ```

4. **Link a app esterne (Telegram, WhatsApp, Maps) → URL assoluto +
   `target="_blank"`**. `t.me/...`, `wa.me/...`, `maps.google.com/...`
   sono ATTESI aprirsi nell'app corrispondente — è il loro purpose. OK.

Bug reali catturati 2026-05-27:

- Link `/privacy` relativo in `AIConsent` modal (`portal.js:701`) e in
  `/admin/impostazioni` → 404 sui tenant host. Fix in commit `97a3266`.
- 3 link PDF `<a href="/api/documento?id=N" target="_blank">` (in
  `circolare.php`, `_az-documenti.php`, `questionario.php`) senza
  `&download=1` → su PWA mobile aprivano viewer "in-app". Fix nello
  stesso ciclo.

## Backup automatici

Daily-job che salva DB + storage di ogni tenant attivo in
`/var/backups/portal/<slug>/`. Eseguito da
[`bin/cron-backup-tenant.php`](bin/cron-backup-tenant.php) via cron alle 03:00.

### Pipeline

1. `flock` su `/tmp/portal-backup.lock` evita doppia esecuzione
2. Per ogni studio attivo (loop su `portal_master.studios WHERE attivo=1`):
   - `mysqldump --single-transaction --routines --triggers | gzip` → `<slug>-<ts>.sql.gz`
   - `tar -czf` di `storage/docs/<slug>/` (se esiste) → `<slug>-storage-<ts>.tar.gz`
   - `sha256sum` di entrambi → `<slug>-<ts>.sha256`
   - UPDATE `studios` con `last_backup_at/size/status`
   - INSERT in `superadmin_audit` evento `backup_eseguito`
3. Retention: file con `mtime > 30 giorni` vengono eliminati

### Schema (master `studios`)

Aggiunto da [`migrations/11_backup.sql`](migrations/11_backup.sql):

- `last_backup_at DATETIME`
- `last_backup_size BIGINT` (byte totali)
- `last_backup_status ENUM('never','running','ok','failed')`
- `last_backup_error VARCHAR(500)` (dettaglio in caso di failure)

### UI superadmin

[`/superadmin/sistema`](superadmin/sistema.php) → widget **"Stato backup"**:

- una riga per studio attivo con: nome+slug, "ultimo backup: X tempo fa", dimensione, badge stato (ok/vecchio/fallito/in corso/mai)
- bottone ▶ "Esegui ora" (POST con CSRF) → spawn async via `nohup ... &`, lo studio passa a stato `running`
- riga `failed` mostra il primo errore troncato a 80 char
- entry `stale` (giallo) se ultimo backup >2gg fa pur essendo `ok` (warning soft)

### Comandi CLI

```bash
# Tutti i tenant
sudo -u www-data php /var/www/portal/bin/cron-backup-tenant.php -v

# Singolo
sudo -u www-data php /var/www/portal/bin/cron-backup-tenant.php --tenant=rossi -v

# Anteprima
sudo -u www-data php /var/www/portal/bin/cron-backup-tenant.php --dry-run -v
```

### Restore

Procedura completa (DB + storage) documentata in
[`/var/backups/portal/README.md`](README in /var/backups/portal). In sintesi:

```bash
zcat /var/backups/portal/<slug>/<slug>-<TS>.sql.gz | mysql portal_<slug>
tar -xzf /var/backups/portal/<slug>/<slug>-storage-<TS>.tar.gz \
   -C /var/www/portal/storage/docs/
sha256sum -c /var/backups/portal/<slug>/<slug>-<TS>.sha256
```

### Cron

`/etc/cron.d/portal-backup`:

```
0 3 * * * www-data /usr/bin/php /var/www/portal/bin/cron-backup-tenant.php > /dev/null 2>&1
0 4 * * * www-data /usr/bin/php /var/www/portal/bin/cron-cleanup-security.php > /dev/null 2>&1
```

### Off-site

La soluzione installata è **Backblaze B2 via rclone**: lo script
[`bin/cron-backup-offsite-b2.sh`](bin/cron-backup-offsite-b2.sh) è
presente, il cron `/etc/cron.d/portal-backup-offsite` è **disattivato
per default** (riga commentata). Vedi la sezione dedicata
"Backup off-site Backblaze B2 (predisposto, non attivo)" per il setup
completo e il comando di attivazione.

Alternativa long-term per portabilità: implementare lo stub
`S3StorageDriver` in `Storage.php` e usare object storage S3-compatibile
nativamente — vedi `Storage::upload`/`serve` (il driver pattern è già
pronto, basta riempire i 4 metodi di `S3StorageDriver`).

### Garbage collection storage

Lo stato filesystem ↔ DB resta in sync quando la cancellazione passa da
`Storage::delete()` (soft-delete) e dal purge settimanale di
[`bin/cron-gc-documenti.php`](bin/cron-gc-documenti.php) (che elimina
fisicamente i `documenti` con `deleted_at` > 30gg + relativo file).

Ci sono però scenari in cui un file su disco resta privo della propria
riga in `documenti`:

- upload abortito a metà (file scritto, INSERT poi fallita)
- cancellazione manuale di righe via SQL senza passare per `Storage::delete()`
- FK su tabelle correlate che, per concatenazione, rimuovono indirettamente la riga
- dump/restore parziali o copia di tenant fra ambienti

Per questo gira [`bin/cron-storage-gc.php`](bin/cron-storage-gc.php)
ogni **domenica alle 04:45** (dopo `cron-gc-documenti.php` delle 04:30):
scansiona `storage/docs/<slug>/` di ogni studio (attivi + cestinati, no
purgati), e per ogni file con estensione in `Storage::EXT_OK` verifica
`SELECT 1 FROM documenti WHERE nome_file = ?`. Se nessuna riga e `mtime`

> 48 h (margine sicuro contro race upload-in-corso), `unlink`. I file
> soft-deleted NON sono orfani: la riga in `documenti` con `deleted_at`
> valorizzato li protegge fino a quando `cron-gc-documenti.php` purga sia
> la riga sia il file.

Audit log: ogni run con almeno 1 rimozione produce un evento
`storage_gc_run` in `superadmin_audit` con `dettagli={tenant, rimossi,
bytes_freed, scansionati}`.

```bash
# Tutti i tenant
sudo -u www-data php /var/www/portal/bin/cron-storage-gc.php -v

# Anteprima senza unlink (consigliato prima del primo run su un tenant grande)
sudo -u www-data php /var/www/portal/bin/cron-storage-gc.php --dry-run -v

# Singolo
sudo -u www-data php /var/www/portal/bin/cron-storage-gc.php --tenant=rossi -v
```

## Backup DMS su Drive (add-on)

Add-on che ricostruisce i documenti del DMS in un albero di cartelle
**leggibile e navigabile** (Azienda > Dipendente > Tipo) e lo sincronizza
**monodirezionalmente** sul drive cloud dello studio (Google Drive,
OneDrive, SharePoint). Distinto dal backup di disaster-recovery
(`cron-backup-tenant.php`, archivio compresso): questo e' un mirror
sfogliabile come una cartella normale.

- **Gating**: feature `dms_mirror` (pro/enterprise) + toggle
  `impostazioni.dms_mirror_attivo`. Vedi `addonAttivo()` in `src/piani.php`.
- **Service** [`DmsMirrorService`](src/services/DmsMirrorService.php):
  - `ricostruisci()` — costruisce `storage/mirror/{slug}/` in **hardlink**
    verso i file reali di `storage/docs/` (costo disco ~zero). I file su
    disco hanno nome UUID: l'albero leggibile viene dai metadati nel DB.
    Solo ultima versione, esclusi i soft-deleted; i riferimenti orfani
    finiscono in `Studio - Condivisi/_Non assegnati`.
  - `sincronizzaRclone()` — `rclone sync` del mirror verso il remote, con
    `--backup-dir <remote>:_Cestino-DMS/<data>`: rimozioni e sostituzioni
    non si perdono, finiscono nel cestino datato.
- **Cron** [`bin/cron-dms-mirror.php`](bin/cron-dms-mirror.php) — per ogni
  tenant attivo: mirror + sync. `flock` anti-sovrapposizione. Installato in
  `/etc/cron.d/portal-dms-mirror` ogni 30 min. Flag: `--tenant=`,
  `--dry-run`, `-v`.
- **UI** `/admin/impostazioni` → tab **Backup su Drive**: toggle, provider,
  nome remote rclone, cartella base, stato ultimo sync, "Sincronizza ora"
  (→ [`api/dms-mirror-sync.php`](api/dms-mirror-sync.php), spawn async).
- **Collegamento del drive** (`/admin/impostazioni` → Backup su Drive):
  wizard **incolla-token** — lo studio esegue `rclone config` sul proprio
  PC e incolla l'output di `rclone config show`; il portale scrive e
  verifica il remote ([`api/dms-mirror-connect.php`](api/dms-mirror-connect.php)).
  È predisposto anche il flusso **OAuth "1 clic"**
  ([`api/dms-oauth.php`](api/dms-oauth.php), Google Drive, scope
  `drive.file`), **inerte** finché `OAUTH_GOOGLE_CLIENT_ID`/`_SECRET` non
  sono valorizzati in `master.php`.
- **rclone**: i remote per-tenant vivono in `RCLONE_CONFIG`
  (`storage/rclone.conf`, chmod 600 — contiene i refresh-token). Helper di
  gestione in `DmsMirrorService` (`scriviConfigRemote`/`verificaRemote`/
  `rimuoviConfigRemote`).
- **Schema** `migrations/38_dms_mirror.sql`: `dms_mirror_state`
  (documento -> path nel mirror, per l'incrementale) + impostazioni.

## Importazione da Drive / Inbox DMS (add-on)

Direzione **inversa** del mirror: invece di copiare il DMS sul drive, importa
nel DMS i file che lo studio lascia in una "casella di ingresso" sul drive.
Parte dello **stesso add-on** `dms_mirror` (stesso remote rclone, toggle
indipendente `dms_inbound_attivo`). Backup e importazione si attivano
separatamente da `/admin/impostazioni` -> tab **Backup su Drive**.

**Approccio "B" — cartelle pre-create dal portale.** Il rischio di un import
da cartelle a nome libero e' instradare un cedolino al dipendente sbagliato
(data leak GDPR). Per eliminarlo alla radice: e' il **portale** che crea
l'albero di cartelle sul drive, quindi la risoluzione cartella -> ID e'
deterministica. Tutto cio' che non si risolve NON viene importato: finisce
nella **coda di revisione** e il file resta dov'e'.

### Flusso

1. Il cron pre-crea sul drive (cartella `dms_inbound_base_path`, default
   `StudioDesk-Inbox`, **separata** da quella del mirror) un albero di
   cartelle leggibile + un `_LEGGIMI.txt` che spiega allo studio dove
   mettere i file.
2. Lo studio molla i file nelle cartelle.
3. Il cron elenca l'inbox (`rclone lsjson`), per ogni file nuovo e _stabile_
   (fermo da >=3 min, anti upload-a-meta') risolve la cartella, scarica il
   file e lo importa con `Storage::upload()`.
4. Il file importato viene tolto dall'inbox attiva (`archiviaImportato()`):
   impostazione `dms_inbound_post_import` — `sposta` (default: `rclone moveto`
   in `_Importati/<data>/`, resta su Drive come ricevuta) oppure `elimina`
   (`rclone deletefile`, Drive usato come solo transito). Configurabile da
   `/admin/impostazioni` → Backup su Drive.

### Mappa cartelle <-> visibilita'

| Cartella inbox                         | visibilita' documento             |
| -------------------------------------- | --------------------------------- |
| `Studio - Condivisi/`                  | `tutti`                           |
| `Aziende/<Azienda>/`                   | `azienda`                         |
| `Aziende/<Azienda>/Reparti/<Reparto>/` | `reparto`                         |
| `Aziende/<Azienda>/<Dipendente>/`      | `utente`                          |
| `Persone/<Persona>/`                   | `utente` (cliente persona fisica) |

Una sotto-cartella opzionale col nome di un tipo documento (es. `Cedolino
paga`) imposta il `tipo_id`; senza, vale `dms_inbound_tipo_default` (o
`altro`). Nomi azienda/dipendente **ambigui** (omonimi) -> coda di revisione,
mai una scelta a caso.

### Componenti

- **Service** [`DmsInboundService`](src/services/DmsInboundService.php):
  `mappa()` (entita' -> cartelle + lookup inverso), `risolviCartella()`
  (cartella -> contesto upload o `_errore`), `sincronizza()` (run completo).
  Riusa `DmsMirrorService::sanitize()` e `DmsMirrorService::rcloneExec()`
  (resa `public`).
- **Cron** [`bin/cron-dms-inbound.php`](bin/cron-dms-inbound.php) — stesso
  pattern di `cron-circolari-scheduler.php`: il 1deg tenant gira in-process,
  gli altri come sub-process `--tenant=slug` (le costanti `STUDIO_*`/`DB_*`
  richieste da `Storage::upload()` non sono ridefinibili). Cron `15,45` in
  `/etc/cron.d/portal-dms-mirror`.
- **API** [`api/dms-inbound-sync.php`](api/dms-inbound-sync.php) — "Importa
  ora" sincrono, solo admin. Forza anche la ricreazione dell'albero cartelle.
- **Schema** [`migrations/47_dms_inbound.sql`](migrations/47_dms_inbound.sql):
  `dms_inbound_state` (un record per file visto: deduplica via
  `remote_path` + firma `size|modtime`, e log della coda di revisione) +
  impostazioni `dms_inbound_*`.

### Note

- **Scope OAuth obbligatorio `drive` (completo).** Il mirror funziona anche con
  scope `drive.file` perche' rclone vede i file che crea lui; l'inbound NO:
  deve leggere i file che lo studio carica a mano, invisibili con `drive.file`.
  `DmsInboundService::scopeRemote()` legge lo scope dal `rclone.conf` e
  `sincronizza()` rifiuta il run con un messaggio esplicito se trova
  `drive.file`. Il drive va (ri)collegato scegliendo lo scope `drive` completo
  in `rclone config`.
- La creazione dell'albero cartelle e' costosa (1 chiamata API per cartella):
  si rifa' al massimo ogni 6h (`SKELETON_TTL`, timestamp in
  `dms_inbound_skeleton_at`) oppure su richiesta dal bottone "Importa ora".
  L'import dei file gira invece a ogni run.
- `created_by` degli import = primo utente interno attivo del tenant (non
  c'e' sessione nel cron).
- L'inbox **non deve** coincidere con la cartella del mirror: il mirror fa
  `rclone sync` distruttivo e cancellerebbe i file in arrivo. Il service
  rifiuta la configurazione se i due path coincidono.
- v1: nessuna email al cliente sull'import (i documenti compaiono comunque
  col badge "Nuovo"); solo testo/estensioni in `Storage::EXT_OK`.

## Import strutturato (tracciati F24)

Sezione che importa file **strutturati** prodotti da software esterni
(gestionali di contabilita') e li splitta per beneficiario, instradando ogni
documento al cliente giusto. Distinto dall'inbound DMS: lì 1 file = 1 documento
instradato per **cartella**; qui 1 file = N documenti instradati per
**contenuto** (codice fiscale dentro ogni record). Modulo "Documenti &
Circolari", voce nav "Import".

La voce nav "Import" apre l'**hub** [`/admin/import`](admin/import.php): una
pagina-catalogo dove si sceglie _cosa_ importare. I tracciati F24 sono il primo
servizio; quelli futuri si aggiungono come card nell'hub (array `$servizi` in
`import.php`), **senza** nuove voci nella topbar.

### Flusso (con conferma operatore)

1. L'operatore carica un file in [`/admin/import-tracciati`](admin/import-tracciati.php).
2. Un parser lo splitta in deleghe; ognuna viene abbinata a un'azienda cliente
   per **codice fiscale / P.IVA** — chiave univoca e ufficiale, **mai il nome**.
3. [`/admin/import-tracciato-detail`](admin/import-tracciato-detail.php) mostra
   la tabella di revisione: `abbinato` / `non_trovato` / `ambiguo`. I non
   risolti si assegnano a mano da un menu a tendina.
4. "Pubblica" → per ogni delega abbinata: PDF F24 nel DMS (`Storage::upload`,
   tipo `f24`, visibilita `azienda`) + scadenza di versamento nel calendario.

Nessun invio alla persona sbagliata: 0 match o 2+ match → coda di revisione,
mai una scelta automatica. La pubblicazione è esplicita (bottone), non automatica.

### Componenti

- **Schema** [`migrations/49_import_tracciati.sql`](migrations/49_import_tracciati.sql):
  `import_tracciati` (batch) + `import_tracciati_righe` (una delega: esito
  abbinamento, `dati_json` normalizzato, `documento_id`/`scadenza_id` creati).
- **Parser** [`TracciatoParser`](src/services/TracciatoParser.php) pluggable:
  `F24XmlParser` (completo), `F24TelematicoParser` (scaffold — il telematico
  AdE a record fissi va implementato su un file reale d'esempio).
- **Service** [`ImportTracciatiService`](src/services/ImportTracciatiService.php):
  `importa()`, `abbina()`, `validaDelega()`, `riassegna()`, `pubblica()`, `annulla()`.
  `htmlF24()` genera il PDF in **stile modulo ufficiale Agenzia Entrate**, con
  due layout (Ordinario / Semplificato) scelti da `tipoModello`.
  NB: `dati_json` è una colonna JSON e MySQL **non conserva l'ordine delle
  chiavi** degli oggetti — l'ordine delle colonne va imposto a render-time.
- **UI**: [`admin/import.php`](admin/import.php) (hub: scelta del servizio),
  [`admin/import-tracciati.php`](admin/import-tracciati.php) (F24: lista + upload)
  e [`admin/import-tracciato-detail.php`](admin/import-tracciato-detail.php)
  (revisione + pubblicazione).

### Aggiungere un formato

Implementa l'interfaccia `TracciatoParser` (`formato`/`etichetta`/`riconosce`/
`parse`) restituendo il modello normalizzato (vedi commento in testa a
[`src/services/TracciatoParser.php`](src/services/TracciatoParser.php)) e
aggiungi la classe a `ImportTracciatiService::parsers()`. Abbinamento,
validazione e pubblicazione restano generici.

## Modulo Agevolazioni (add-on)

Modulo per scoprire **bandi e incentivi pubblici** adatti all'azienda cliente,
con catalogo bandi (nazionali/regionali/europei), monitoraggi con avvisi email,
e calcolo del **plafond De Minimis** (RNA). Logica in
[`AgevolazioniService`](src/services/AgevolazioniService.php); pagine cliente
`public/agevolazioni*.php`; dati bandi/RNA nel DB `portal_master`; cron
`cron-bandi-import.php` / `cron-agevolazioni-*` / `cron-rna-import.php`.

**Doppio gating**:

1. **Add-on tenant** — feature `agevolazioni` nel piano + toggle attivo
   (`addonAttivo('agevolazioni')`, `AgevolazioniService::guard()`).
2. **Opt-in per-azienda** — le aziende **non** entrano automaticamente: lo
   studio le attiva una a una (`aziende.agev_attivata_at`,
   [migrations/40_agevolazioni_aziende_attivazione.sql](migrations/40_agevolazioni_aziende_attivazione.sql)),
   fino alla quota `portal_master.studios.agevolazioni_quota`. Helper:
   `AgevolazioniService::isAziendaAttiva($aziendaId)`. Rimpiazza il vecchio
   modello opt-out `agev_sganciata_at` (colonne legacy ancora presenti).

**Lato cliente** (solo `cliente_ruolo='admin'`): se l'add-on tenant è attivo la
voce **Agevolazioni** compare nella sidebar come **vetrina**. Se la singola
azienda non è attivata, `/agevolazioni` mostra
[`public/_agevolazioni-promo.php`](public/_agevolazioni-promo.php) — pagina
promozionale con **"Richiedi informazioni allo studio"** che apre una
comunicazione pre-compilata + email ad admin/direzione (idempotente). Le
sotto-pagine (bandi/bando/monitoraggi) per un'azienda non attivata
reindirizzano alla vetrina.

## Aggiornamenti di sistema (apt da pannello)

Pannello [`/superadmin/aggiornamenti`](superadmin/aggiornamenti.php) per
scoprire e applicare aggiornamenti del sistema operativo (Ubuntu apt) senza
SSH. **Tutto async** sul pattern dei backup (`setsid nohup` + status JSON
polling).

**Cgroup + mount-namespace escape**: all'inizio di `--upgrade` il wrapper
chiama `detachFromApacheCgroupIfNeeded()` che, se rileva di girare nel
cgroup di `apache2.service` (caso normale: lanciato da PHP servito da
Apache), si ri-esegue via `nsenter --target 1 --mount systemd-run --scope
--collect --quiet --unit=portal-update-… env PORTAL_UPDATES_DETACHED=1 php
…`. Servono entrambi i livelli, e nell'ordine giusto:

- `nsenter --target 1 --mount` → entra nel mount namespace di PID 1.
  `apache2.service` ha `PrivateTmp=yes`, quindi i figli di apache vedono un
  `/tmp` privato. Quando dpkg riavvia apache nel postinst, quel namespace
  privato diventa inconsistente per i nostri processi orfani e apt fallisce
  con `Unable to mkstemp /tmp/... - No such file or directory`.
- `systemd-run --scope --collect` → cgroup transient separato. Senza,
  systemd manda `SIGKILL` all'intero cgroup di apache durante il restart
  (`KillMode=mixed`), uccidendo anche apt → dpkg resta interrotto.

`setsid` da solo non basta: cambia la session ma non il cgroup né il mount
namespace.

**Auto-repair dpkg**: subito dopo il detach, `repairDpkgIfNeeded()` esegue
`dpkg --audit` e, se trova pacchetti half-configured/half-installed da un
crash precedente, lancia `DEBIAN_FRONTEND=noninteractive dpkg --configure -a`
prima di procedere con apt. Così il pannello resta zero-touch anche dopo un
crash. NB: `-o Dpkg::Options::=...` sono opzioni di apt-get, dpkg le rifiuta
con "unknown option -o" — non passarle a dpkg --configure.

### Architettura

- **Wrapper CLI** [`bin/system-updates.php`](bin/system-updates.php) eseguibile
  solo come root via `sudo`. Sub-commands:
  - `--scan` → `apt-get update` + parse `apt list --upgradable` → `updates.json`
  - `--upgrade --packages=p1,p2,...` → `apt-get install -y --only-upgrade ...`
    (whitelist server-side: solo pacchetti realmente upgradable, regex
    sanitization sui nomi). Reload Apache / restart php-fpm automatici se
    pacchetti relativi vengono toccati.
  - `--reboot` → `sleep 3 && /usr/sbin/reboot &` (stesso pattern di
    `superadmin/restart.php`)
  - `--status` → stampa `upgrade-status.json`
- **Sudoers** in `/etc/sudoers.d/portal-updates`: www-data può eseguire
  **solo** questo wrapper come root. NON ha apt diretto. La whitelist è
  ulteriormente difesa nel wrapper stesso.
- **File di stato** in `/var/cache/portal/`:
  - `updates.json` — risultato ultimo scan
  - `upgrade-status.json` — stato corrente (`idle`/`scanning`/`upgrading`/`done`/`failed`/`rebooting`)
  - `upgrade.log` — output dell'ultimo upgrade (mostrato live nella UI)
  - `system-updates.lock` — flock per evitare doppia esecuzione

### Classificazione automatica delle priorità

Per ogni pacchetto upgradable, il wrapper assegna una di tre priorità:

| Priorità                 | Criterio                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Urgente** (rosso)      | nome inizia con `openssl`/`libssl`/`libc6`/`sudo`/`openssh`/`linux-image`/`linux-headers`/`systemd`/`dbus`/`glibc`/`curl`/`libcurl` **OR** sources contiene `security` |
| **Importante** (arancio) | nome inizia con `apache2`/`libapache2`/`php8`/`php7`/`mysql`/`mariadb`/`certbot`/`fail2ban`/`nginx`/`postfix`/`dovecot`/`redis`/`memcached`/`python3`                  |
| **Facoltativo** (grigio) | tutto il resto (vim, iproute2, ecc.)                                                                                                                                   |

### UI

- **Header**: timestamp ultima scansione + bottone "Riscansiona"
- **KPI per priorità**: 4 card (Totale / Urgenti / Importanti / Facoltativi)
- **Banner reboot-required** (giallo) se `/var/run/reboot-required` esiste
  o se l'ultimo upgrade ha settato il flag → bottone "Riavvia ora"
- **Sezioni collassabili per priorità** con checkbox per pacchetto
- **Quick-select buttons**: "Seleziona tutto" / "Solo urgenti" / "Urgenti +
  importanti" / "Deseleziona". Pre-selezionati di default solo gli urgenti.
- **Toolbar sticky in fondo** con conteggio selezionati + hint dinamico
  ("· Apache reload + PHP-FPM restart") + bottone "Aggiorna selezionati"
- **Conferma prima dell'azione**: alert nativo con dettaglio degli impatti
- **Stato live** durante scan/upgrade/reboot: card blu animata con tail
  delle ultime 30 righe del log + polling JSON ogni 2s che ricarica la
  pagina alla transizione `upgrading → done/failed`

### Sicurezza (4 strati)

1. **Filesystem**: il wrapper rifiuta esecuzione non-CLI (`PHP_SAPI !== 'cli'`)
2. **Sudoers**: solo questo wrapper è elevabile, non apt
3. **Whitelist runtime**: solo pacchetti presenti in `updates.json` come
   upgradable possono passare al `--packages`
4. **Sanitize regex**: nomi pacchetto validati contro `/^[a-z0-9][a-z0-9+\-.]*$/`
   (Debian package naming)

### Audit log

Ogni azione web triggera un record in `superadmin_audit`:

- `updates_scan` — riscansione manuale
- `updates_upgrade` — upgrade lanciato (con lista pacchetti in `dettagli`)
- `updates_reboot` — riavvio dal pannello

### Cron automatico scan + email digest critici

In [/etc/cron.d/portal-updates](ops/cron/portal-updates) (versionato in
`ops/cron/portal-updates`):

```
30 3 * * * root /usr/bin/php /var/www/portal/bin/system-updates.php --scan > /dev/null 2>&1
35 3 * * * www-data /usr/bin/php /var/www/portal/bin/cron-update-alerts.php > /dev/null 2>&1
```

- **03:30 root** — `system-updates.php --scan` aggiorna `/var/cache/portal/updates.json`
  (no installazione, solo `apt-get update` + parse + classificazione).
- **03:35 www-data** — [`cron-update-alerts.php`](bin/cron-update-alerts.php)
  legge `updates.json`, e se ci sono **≥ 1 urgenti** OR **≥ 5 importanti** invia
  un digest a `PLATFORM_CONTACT_EMAIL` con lista pacchetti + link al pannello.
  **Cooldown 7 giorni** sulla stessa signature (lista urgenti + count importanti):
  se la composizione cambia (es. 3→5 urgenti) la mail riparte subito anche
  dentro il cooldown.

L'installazione è **automatica** ora (non più "futuro"). Niente upgrade auto:
quelli restano manuali dal pannello superadmin.

CLI helpers:

```bash
sudo -u www-data php /var/www/portal/bin/cron-update-alerts.php --dry-run -v     # mostra cosa farebbe
sudo -u www-data php /var/www/portal/bin/cron-update-alerts.php --force -v       # invia subito (ignora cooldown)
```

### AI hint contestuale sugli aggiornamenti

In [/superadmin/aggiornamenti](superadmin/aggiornamenti.php), accanto al
bottone "Aggiorna selezionati" c'è un bottone **"Chiedi a AI"** (icona stelle).
Cliccando, la lista dei pacchetti selezionati va a
[`/api/superadmin/update-hint`](api/superadmin/update-hint.php), che chiama
Groq (`llama-3.3-70b-versatile`) con un system prompt severo:

- max 4 frasi
- non inventare CVE
- per security/urgenti dì sempre "applica subito"
- suggerimento timing (notte vs subito) solo se ha senso

Il bottone è disabilitato finché non selezioni almeno 1 pacchetto. Risposta
mostrata in un box viola sopra la toolbar. Costo stimato: <1€/anno (~1
chiamata/giorno × ~7k token).

Rate-limit dell'endpoint: **6 chiamate/h per IP** (su master DB, prefisso
virtuale `update-hint:*` di `RateLimit::log`). Niente decisioni automatiche:
è un assistente, non un gatekeeper.

## Versioning documenti + firma elettronica OTP

Funzionalità sviluppate in [`migrations/12_versioning_firma.sql`](migrations/12_versioning_firma.sql)
e relativi endpoint. Pensata per atti formali (contratti, dichiarazioni,
documenti normativi) dove serve traccia legale di "chi ha firmato cosa quando".

### Schema

`documenti` esteso con:

- `versione INT NOT NULL DEFAULT 1`
- `versione_padre_id INT NULL` — FK self-reference; NULL su v.1, contiene l'id della v.1 (la "root") sulle versioni successive (catena flat)
- `richiede_firma TINYINT(1)`

`documenti_tipi` esteso con `richiede_firma_default TINYINT` (per pre-spuntare il toggle in base al tipo).

Nuova tabella `documenti_firme(documento_id, user_id)` UNIQUE — una sola riga per (doc, utente):

- `codice_otp_hash` bcrypt del codice 6 cifre
- `codice_inviato_at`, `tentativi` (max 5), `firmato_at`
- `ip`, `user_agent`, `nota_utente`

### Versioning

**Lato admin** ([/admin/documenti](admin/documenti.php)):

- Bottone "Nuova versione" sulla card di ogni doc → riapre il wizard upload con campi pre-compilati (tipo, visibilità, azienda, reparto/utente, conferma, firma) presi dal padre
- Il form passa `versione_padre_id` al POST handler; `Storage::upload()` calcola `MAX(versione)+1` lungo la catena e setta `versione_padre_id = root_id`
- Lista normale mostra solo l'ULTIMA versione di ogni catena (subquery `NOT EXISTS figlio più recente`); flag `?show_history=1` rimuove il filtro
- Badge `v.N` ambra sulla card se versione > 1; bottone "Storia" apre modal con tabella tutte le versioni precedenti
- Endpoint [`/api/documento-versioni`](api/documento-versioni.php) (admin) — ritorna catena versioni JSON

**Lato cliente** ([/documenti](public/documenti.php)):

- Stesso filtro `NOT EXISTS figlio più recente` → vede solo la versione più aggiornata
- Tag "v.N · aggiornato" se la catena ha più di 1 versione (così sa che esiste storia)
- La conferma di lettura del padre **non vale** per la nuova versione (l'utente deve rileggere)

### Firma elettronica via OTP email

**Configurazione (lato admin)**:

- Wizard upload step 3: nuovo toggle "**Richiedi firma elettronica**" (icona penna viola)
- Persiste in `documenti.richiede_firma=1`
- Card admin: badge ambra "Da firmare" → diventa "N firmate" quando arrivano firme
- Bottone "Firme" sulla card → modal con tabella firme: utente, stato (in attesa / codice inviato / firmato), timestamp, IP

**Flusso firma (lato cliente)** ([/documenti](public/documenti.php)):

1. Card del doc che richiede firma mostra bottone viola **"Firma"** invece di "Confermo"
2. Click → modal con info, bottone "Invia codice"
3. POST [`/api/documento-firma-richiedi`](api/documento-firma-richiedi.php):
   - Verifica ACL (cliente del tenant + visibilità coerente con reparto/utente)
   - Verifica che il doc abbia `richiede_firma=1` e che l'utente non abbia già firmato
   - Rate-limit: max 1 richiesta/60s per (doc, utente)
   - Genera 6 cifre random + bcrypt + INSERT/UPDATE `documenti_firme.codice_otp_hash` con `codice_inviato_at = NOW()`
   - Invia email via `MailerService::inviaNotificaSistema('firma_otp', ...)` — template in `notifiche_default.php` con codice in monospace + spacing letter `.4em`
   - In dev mode (SMTP off) restituisce `dev_otp` nella response per testabilità
4. Frontend mostra step 2 con input 6 cifre + autocomplete `one-time-code` + countdown 60s per "Invia di nuovo"
5. POST [`/api/documento-firma-conferma`](api/documento-firma-conferma.php):
   - Verifica `password_verify(codice, codice_otp_hash)`
   - Validità 10 minuti dal `codice_inviato_at`
   - Max 5 tentativi prima di invalidare il codice (richiede reinvio)
   - On success: `firmato_at = NOW()`, `codice_otp_hash = NULL`, salva IP + UA + nota opzionale
   - Idempotente: registra anche conferma esplicita di lettura (`documenti_letture.tipo_conferma = 'esplicita'`)
6. Audit log: `documento_firma_richiesta` + `documento_firmato`

**Sicurezza**:

- Codice è hashato bcrypt in DB (mai in chiaro)
- IP-binding del pending step (vedi 2FA)
- Rate-limit invio + tentativi → 5 fail = invalidazione codice → richiede nuovo codice
- Validità 10 minuti
- La firma equivale alla conferma esplicita di lettura (riusa stesso schema `documenti_letture`)

### Migrazione esistenti

Tutti i documenti caricati prima di questa migration hanno:

- `versione = 1`, `versione_padre_id = NULL` → automaticamente "ultima versione" della loro catena (singleton)
- `richiede_firma = 0` → invariato, comportamento legacy preservato

## Ricerca aziende e utenti (componente PortalList)

Modulo unificato per le liste anagrafica/utenti che combina **ricerca live
debounced**, **fuzzy via FULLTEXT ngram + LIKE + Soundex**, **filtri AND
combinabili**, **virtual scroll**, **vista card/tabella** con toggle utente
e **highlight termini**. Sostituisce il vecchio pattern "form GET → reload
pagina" su 3 schermate: aziende, utenti studio, utenti azienda.

### Architettura (3 layer)

**1. DB** — migrazione `migrations/13_search_indexes.sql`, applicata via
runner idempotente `bin/migrate-search-indexes.php` (skip i pezzi già
presenti, sicuro da ri-eseguire). Schema:

- `aziende.citta / provincia / cap / settore` — campi nuovi NULL, popolabili
  gradualmente (zero impatto sul codice legacy)
- `aziende.nome_soundex` + `users.nome_soundex` — colonne `GENERATED ALWAYS
AS (SOUNDEX(...)) STORED`, **VARCHAR(32)** (MySQL non rispetta lo standard
  4-char, il SOUNDEX cresce con le consonanti)
- FULLTEXT `aziende.ft_search` su `(nome, codice, partita_iva, codice_fiscale,
email, citta)` con `WITH PARSER ngram` — token size 2 (per match parziali
  tipo "ros" → "Rossi")
- FULLTEXT `users.ft_search` su `(nome, cognome, email)` con stesso parser
- Indici composti: `idx_az_citta_attivo`, `idx_az_tipo_attivo`,
  `idx_az_settore`, `idx_az_created`, `idx_az_soundex`, `idx_u_soundex`

**2. Endpoint JSON** — auth + filtri + paginazione cursor-based:

| Endpoint                           | File                     | Scope                                                                |
| ---------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| `/api/aziende-search`              | `api/aziende-search.php` | Aziende (admin/dir/resp)                                             |
| `/api/utenti-search?scope=staff`   | `api/utenti-search.php`  | Utenti interni studio                                                |
| `/api/utenti-search?scope=clienti` | `api/utenti-search.php`  | Clienti del tenant (interni) o della propria azienda (cliente_admin) |

GET params comuni: `q`, `sort`, `dir`, `cursor`, `limit` (max 100).
Specifici aziende: `stato` (attive/inattive/tutte), `tipo` (azienda/persona_fisica),
`citta`, `settore`, `da`, `a` (range data). Specifici utenti: `ruolo`,
`cliente_ruolo`, `azienda_id`, `reparto_id`.

Output: `{items, has_more, next_cursor, total_approx, facets, sort, dir}`.
`facets` contiene top-12 città e settori per popolare le dropdown filtri
dinamicamente (solo prima pagina, no cursor).

**3. Frontend** — `public/assets/portal-list.js` (~370 righe, vanilla JS).
Componente `window.PortalList` riusabile. Caricato solo dalle pagine che ne
hanno bisogno (no global), cache-busted via `?v=<filemtime>`. Stili in
`public/assets/portal.css` sotto `/* PORTAL-LIST */`.

```js
new PortalList({
  mount, // HTMLElement contenitore
  endpoint, // URL API (es. '/api/aziende-search')
  baseQuery, // {scope, azienda_id, ...} sempre passati
  filters, // [{key, label, options:[{val,label,count?}]}]
  sortFields, // [{key, label, defaultDir?}]
  viewModes, // ['card','table'] o solo ['card']
  renderCard, // (item, ctx) => HTMLString
  renderTableRow, // (item, ctx) => HTMLString  (se 'table' attivo)
  tableHeader, // <tr><th>…</th></tr>
  onItemAction, // (action, item, btn) => void  per data-pl-action="…"
  onFacets, // (facets) => void  per popolare filtri da risposta
  emptyMessage, // {icona, titolo, sottotitolo}
  instanceKey, // chiave persistenza vista/sort in localStorage
  pageSize, // default 50
});
```

### Comportamento ricerca

- **Debounce 350 ms** sull'input (coerente con altre liste del progetto)
- **AbortController**: ogni nuova richiesta cancella la precedente → no race
- **Cache LRU client**: 10 entry × 30s (stessa query → no fetch). Invalidata
  da `list.invalidate()` o automaticamente alle CRUD
- **Virtual scroll**: `IntersectionObserver` sul sentinel finale, fetch
  della pagina successiva quando entra in viewport (rootMargin 400px)
- **Skeleton shimmer** durante il primo load
- **Highlight**: i token query (≥2 char) vengono avvolti in `<mark>` nel
  render via `ctx.highlight(text)`, accent-folded
- **Persistenza preferenze**: vista (card/tabella) e sort scelti dall'utente
  vengono salvati in `localStorage` per `instanceKey`

### Ranking ibrido (pattern endpoint)

Per ogni record che matcha:

```
score = MATCH(...) AGAINST('+token*' IN BOOLEAN MODE)
      + (LIKE 'token%' su nome     → +2/3)
      + (LIKE 'token%' su codice   → +1)
WHERE …
  AND (
    MATCH(...) AGAINST('+token*' IN BOOLEAN MODE)
    OR nome_soundex = SOUNDEX(token)
    OR nome    LIKE '%token%'
    OR codice  LIKE '%token%'
  )
```

Il `MATCH` cattura il caso veloce (FULLTEXT con ngram). Il `LIKE %x%` è
fallback completo che cattura **tutto** quello che FULLTEXT non trova
(ngram in MySQL ha quirk — vedi nota sotto). Il `SOUNDEX` cattura refusi
sul nome completo ("maria rosi" → "Maria Rossi").

### Quirk MySQL ngram da conoscere

Il parser `ngram` di MySQL 8 ha comportamenti non sempre intuitivi:

- Token size 2 → "ross" tokenizza in "ro","os","ss" e cerca **phrase**
  (tutti consecutivi nel target). Funziona bene per nomi unici ("Romana")
- Per certe coppie di lettere ("ma","ar","ri","in","ni") l'index può non
  popolarsi su tabelle con dataset piccolo o con righe modificate dopo la
  creazione dell'indice — non sempre riproducibile, e la causa esatta non
  è documentata. **Workaround**: il fallback `LIKE %x%` nel WHERE OR copre
  questi casi a costo trascurabile (dataset piccoli).
- "in" è nella stopword list InnoDB di default → bigram "in" droppato dal
  query parser. Stesso fallback LIKE compensa.

### Comandi utili

```bash
# Applica migration su tutti i tenant attivi (idempotente)
sudo -u www-data php /var/www/portal/bin/migrate-search-indexes.php -v

# Solo un tenant
sudo -u www-data php /var/www/portal/bin/migrate-search-indexes.php --tenant=portal

# Anteprima senza applicare
sudo -u www-data php /var/www/portal/bin/migrate-search-indexes.php --dry-run -v

# Rebuilding del FULLTEXT su un tenant (se l'indice sembra incompleto)
mysql -u root portal_<slug> <<'SQL'
ALTER TABLE aziende DROP INDEX ft_search;
ALTER TABLE aziende ADD FULLTEXT INDEX ft_search
    (nome, codice, partita_iva, codice_fiscale, email, citta) WITH PARSER ngram;
SQL

# Ispeziona token nel FULLTEXT (per debug)
mysql -u root <<'SQL'
SET GLOBAL innodb_ft_aux_table = 'portal_main/aziende';
SELECT word, COUNT(*) FROM information_schema.INNODB_FT_INDEX_TABLE
GROUP BY word ORDER BY COUNT(*) DESC LIMIT 20;
SQL
```

### Performance attese

- Dataset 30 aziende: search "ross" → ~3-5 ms (FULLTEXT) o ~10 ms (LIKE)
- Dataset stimato 1k aziende: ~10-15 ms (FULLTEXT) o ~50 ms (LIKE)
- Dataset stimato 10k aziende: ~20-30 ms (FULLTEXT) o ~300 ms (LIKE)
- Dataset 100k+ aziende: dipende dalla complessità query, ma con cursor
  pagination è O(log n) per pagina invece che O(n) come con OFFSET

### Test performance con dataset grandi

Per simulare 10k aziende:

```sql
-- Insert ~10k righe sintetiche partendo dalle esistenti
INSERT INTO aziende (codice, nome, tipo_cliente, partita_iva, citta, attivo)
SELECT
    CONCAT('TST', LPAD(seq, 5, '0')),
    CONCAT(ELT(1+(seq%10),'Studio','Officina','Ditta','Imp.','Cooper.','Group','Network','Service','Consulting','Tech'),
           ' ', ELT(1+(seq%20),'Rossi','Bianchi','Verdi','Russo','Esposito','Romano','Conti','Greco','Bruno','Mariani','Costa','Galli','Ferrari','Marini','Marchetti','Lombardi','Barbieri','Riva','Caputo','Rinaldi'),
           ' ', LPAD(seq, 4, '0')),
    'azienda',
    LPAD(seq, 11, '0'),
    ELT(1+(seq%8),'Roma','Milano','Napoli','Torino','Bologna','Firenze','Bari','Verona'),
    1
FROM (SELECT @r:=@r+1 AS seq FROM aziende a, aziende b, (SELECT @r:=0) r LIMIT 10000) seq_gen;

-- Misura
SET profiling = 1;
SELECT id, nome FROM aziende
WHERE eliminato=0 AND attivo=1 AND
  MATCH(nome,codice,partita_iva,codice_fiscale,email,citta) AGAINST('+rossi*' IN BOOLEAN MODE)
LIMIT 50;
SHOW PROFILES;
```

Per cleanup: `DELETE FROM aziende WHERE codice LIKE 'TST%'`.

## Wizard onboarding (W1 / W2 / W3)

Tre wizard guidati per ridurre il time-to-value al primo login, riusando i
flow esistenti senza duplicarli. Tutti **non bloccanti**, **skippable per
step e per wizard intero**, salvataggio incrementale dopo ogni "Avanti".

| Wizard | Pubblico                                        | Step                                                                                 | Tempo   | Trigger                 |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------- | ----------------------- |
| **W1** | Cliente standard (ogni `ruolo='cliente'`)       | 4 (benvenuto · profilo · notifiche · sicurezza)                                      | ~2 min  | Banner su `/dashboard`  |
| **W2** | Cliente admin azienda (`cliente_ruolo='admin'`) | 6 (benvenuto · anagrafica · reparti · referenti · inviti · preferenze)               | ~5 min  | Banner su `/dashboard`  |
| **W3** | Studio (`admin`/`direzione`)                    | 8 (benvenuto · brand · sito · team · reparti · notifiche · integrazioni · riepilogo) | ~10 min | Banner su `/admin/home` |

### Architettura

Tutto il driver è in [`src/wizard/Wizard.php`](src/wizard/Wizard.php) (un solo
file con `WizardStep` abstract + `WizardController` + `WizardRegistry`). Gli
step concreti vivono in `src/wizard/StepsW1.php`, `StepsW2.php`, `StepsW3.php`,
caricati lazy dal Registry. Schema unico in [`migrations/53_wizard.sql`](migrations/53_wizard.sql)

- replicato in [`01_studio_template.sql`](migrations/01_studio_template.sql).

* **Tabella** `wizard_state(id, wizard_id, user_id, azienda_id, studio_scope,
step_corrente, state_json JSON, done, skipped, completed_at, ...)`.
  - `UNIQUE (wizard_id, user_id)` → ogni utente ha la propria istanza.
  - `state_json` contiene anche i marker `__steps_done[]` e `__steps_skipped[]`
    per il render dello stepper visivo.
* **Entry-point**:
  - `/wizard?id=W1|W2` → [`public/wizard.php`](public/wizard.php) (auto-seleziona da `cliente_ruolo` se `id` omesso)
  - `/admin/wizard` → [`admin/wizard.php`](admin/wizard.php) (sempre W3)
* **Pattern**: form POST classico (no AJAX), `action=save|skip|back|skip_all` +
  redirect a se stesso. Un "Avanti" salva e avanza in un solo round-trip.
* **ACL**: `WizardRegistry::canAccess($wizardId, $user)`. Il banner home
  rispetta la stessa ACL.

### Step skeleton (interfaccia)

```php
class MyStep extends WizardStep {
    public string $id = 'mio_step';
    public string $title = 'Titolo dello step';
    public string $sub = 'Sottotitolo discorsivo.';

    public function shortLabel(): string { return 'Mio'; }    // stepper visivo
    public function skippable(): bool    { return true; }     // bottone "Salta"

    public function render(array $state, array $ctx): string {
        // ritorna HTML del body. Il chrome (stepper + bottoni) lo mette il template.
        return '<input type="text" name="foo" value="' . htmlspecialchars($state['foo'] ?? '') . '">';
    }
    public function save(array $input, array $state, array $ctx): array {
        // valida → throw WizardValidationException su errori
        // persisti su DB
        // ritorna l'array da MERGE con lo state (per ripopolare i campi in caso di "Indietro")
        return ['foo' => trim((string)($input['foo'] ?? ''))];
    }
    public function shouldShow(array $state, array $ctx): bool {
        // step condizionale (es. "mostra solo se hai un'azienda"). Default true.
        return !empty($ctx['azienda']);
    }
}
```

### Banner home

`WizardController::banner(PDO $db, array $user)` ritorna HTML autosufficiente
(CSS inline) da incollare sopra l'hero di `/dashboard` o `/admin/home`. Si
auto-seleziona W1/W2/W3 dal ruolo + cliente_ruolo. **Sparisce** quando il
wizard è `done=1` o `skipped=1`.

```php
echo WizardController::banner($db, [
    'id'            => (int)($_SESSION['user_id'] ?? 0),
    'ruolo'         => $_SESSION['user_ruolo']   ?? '',
    'cliente_ruolo' => $_SESSION['cliente_ruolo'] ?? '',
    'azienda_id'    => $_SESSION['azienda_id']   ?? null,
]);
```

### Context degli step

Lo `$ctx` passato a `render()`/`save()` contiene:

- `user` — riga utente loggato (id, ruolo, cliente_ruolo, azienda_id, ...)
- `db` — PDO tenant attivo
- `azienda` — riga `aziende` (solo W2)
- `azienda_id` — per comodità
- `studio_scope` — true solo per W3

### Riapertura / reset / snooze

UI in `/admin/impostazioni?sez=workflow` (sezione "Wizard onboarding
studio"): bottoni **Apri/Riapri wizard** (POST `action=wizard_reset`),
**Posticipa** (`wizard_snooze` con `days=`), **Non mostrare più**
(`wizard_skip`). Lato cliente lo stesso si raggiunge dal dropdown
"···" del banner sulla home.

Programmaticamente in [`WizardController`](src/wizard/Wizard.php):
`reset($wid,$uid)` azzera `snoozed_until` ma preserva
`step_corrente`+`state_json` (no perdita progressi), `snooze($wid,$uid,$giorni)`
posticipa, `skipAll($wid,$uid)` nasconde definitivamente,
`isDismissed($db,$wid,$uid)` / `statusFor($db,$wid,$uid)` per check.

Per testare ricominciando da zero (bypass del soft-reset):
`DELETE FROM wizard_state WHERE user_id=X AND wizard_id='W1'`.

### Cosa NON fa il wizard

- **Non duplica i flow esistenti**: gli step "team", "sito", "notifiche",
  "integrazioni" del W3 sono cards con link a `/admin/utenti`,
  `/admin/sito-editor`, `/admin/notifiche`, `/admin/impostazioni`. L'utente
  clicca "Avanti" per marcare done quando ha finito sull'altra tab.
- **Non usa AI** (in v1). I reparti hanno preset hardcoded (7 voci per W2,
  7 per W3). Espandibile in futuro con `AIClient::for('wizard-suggest-reparti')`
  - step `ai_suggest` separato.
- **Non blocca mai**: c'è sempre "Chiudi e configura più tardi" in fondo
  alla card (POST `action=skip_all`). Riproposto al prossimo login finché
  non lo skippi esplicitamente.

## Scheda azienda lato studio

Pannello specchio del pannello cliente per gli operatori dello studio: dalla
lista [`/admin/aziende`](admin/aziende.php) si entra in
[`/admin/azienda/:id`](admin/azienda-detail.php) — vista 360° con 11 tab che
mostrano cross-modulo tutto quello che la piattaforma sa di un singolo cliente.

### Rotta + chrome

URL canonico: `/admin/azienda/:id?sez=panoramica|comunicazioni|dipendenti|reparti|anagrafica|documenti|circolari|questionari|scadenze|fatturazione|log`.
Backward-compat: `?azione=vedi_clienti&id=N` → 301 `?sez=dipendenti`. 404 dedicato se l'azienda non esiste / è soft-deleted, via [`AziendaScope::requireAziendaContext`](src/AziendaScope.php).

Header viola con avatar, codice, stato, città + 4 KPI pill (utenti / ticket aperti / storage usato / RFM). I 4 KPI quick sono precomputati in `azienda-detail.php` con 1 query batch (gli altri KPI completi vivono solo dentro `_az-panoramica.php`).

### Tabella ACL (matrice tab × ruolo)

Calcolata una volta nel controller (`$puoVederTab` + `$puoScrivereTab`) e riusata in 3 punti: render del nav tab, guard del partial, POST dispatcher.

| Tab           | Visibile a        | Modifica                         |
| ------------- | ----------------- | -------------------------------- |
| Panoramica    | tutti interni     | —                                |
| Comunicazioni | tutti             | tutti                            |
| Dipendenti    | tutti (read)      | admin / direzione / responsabile |
| Reparti       | tutti (read)      | admin / direzione / responsabile |
| Anagrafica    | tutti (read)      | admin / direzione                |
| Documenti     | tutti             | tutti                            |
| Circolari     | tutti             | admin / direzione / responsabile |
| Questionari   | tutti             | admin / direzione / responsabile |
| Scadenze      | tutti             | admin / direzione / responsabile |
| Fatturazione  | admin / direzione | admin / direzione                |
| Log           | admin / direzione | —                                |

### Componenti chiave

- **[`src/AziendaScope.php`](src/AziendaScope.php)** — helper centrale per le viste filtrate. 4 metodi `where*(int $aziendaId): array` (Documenti / Circolari / Questionari / Scadenze) che ritornano `[$whereSql, $params]` con placeholder **posizionali `?`** (no named, per non collidere con altri filtri positional nelle query chiamanti). + `userIdsAzienda`, `repartoIdsAzienda`, `requireAziendaContext`.
- **11 partial `admin/_az-*.php`** con guard `defined('AZIENDA_ADMIN_DETAIL')`. Pattern di richiamo: `require __DIR__ . "/_az-{$sez}.php"` dal controller. Variabili in scope: `$db`, `$aziendaId`, `$az`, `$myId`, `$puoScrivereTab` + alcune specifiche per partial.
- **POST handler** (oltre 17 azioni) tutti gated da `$puoScrivereTab[<sezione>]`, audit log con prefisso **`studio_azienda_*`**, anti-self-modifica (no `id === $myId` su dipendenti). Esempi: `dipendente_modifica`, `dipendente_cambia_ruolo`, `reparto_membri`, `anagrafica_salva`, `referente_salva`, `scadenza_crea`, `comunicazione_crea`.
- **Delta tracking anagrafica**: ogni modifica via `anagrafica_salva` confronta `$az[$campo]` con il POST e inserisce una riga in `aziende_modifiche_log` (stesso log che usa il cliente in `public/azienda.php`), distinguendo via JOIN con `users.ruolo`. Il badge "Mod. dal cliente" sui 6 campi auto-modificabili compare se l'ultima modifica registrata è di un `ruolo='cliente'`.

### Operatore di riferimento (RFM)

[migrations/54_azienda_operatore_riferimento.sql](migrations/54_azienda_operatore_riferimento.sql) aggiunge `aziende.operatore_riferimento_id` (FK `users(id)` ON DELETE SET NULL). È il **riferimento relazionale** dello studio per il cliente (es. "responsabile commerciale"), distinto dall'assegnatario del ticket. Impostato in `_az-anagrafica.php` da admin/direzione/responsabile (handler `anagrafica_set_rfm`).

**Ruoli assegnabili**: solo `AuthController::RUOLI_RFM` (`direzione`, `responsabile`, `operatore`, `capoufficio`). Admin escluso: ruolo di governance, non di relazione cliente. Vedi sezione "Ruoli operativi vs manageriali".

**RFM storico**: se un'azienda ha già un RFM con ruolo `admin` (da prima del refactor), il valore rimane nel DB ma il dropdown non lo mostra più come opzione. [`_az-anagrafica.php`](admin/_az-anagrafica.php) rileva il mismatch e mostra un banner ambra "Operatore di riferimento storico" che invita a riassegnare. Nessuna migrazione automatica.

Wiring globale:

- [`api/aziende-search.php`](api/aziende-search.php) — filtro `?rfm=mie|unassigned|<int>` + facet `rfm` (top-12 operatori) + `rfm_unassigned` count.
- [`admin/aziende.php`](admin/aziende.php) — pill filtro "Operatore RFM" con 2 slot speciali ("⭐ Le mie aziende", "Senza operatore RFM") + top-N dal facet. Chip lato card mostra il nome dell'RFM se assegnato.
- [`admin/home.php`](admin/home.php) — tile **"Le mie aziende"** (top-5 by `adempimenti_tot`, cache 120s in `Cache::remember`). Visibile solo se l'operatore ha almeno 1 azienda in RFM.

### Log cross-source

[`admin/_az-log.php`](admin/_az-log.php) UNIONa 5 fonti (tutte filtrate per azienda):

1. `aziende_modifiche_log` (azienda_id = :id)
2. `audit_log` (entita='aziende' AND entita_id = :id)
3. `audit_log` (entita='users' AND entita_id IN clienti azienda — anche eliminati)
4. `audit_log` (entita='reparti_azienda' AND entita_id IN reparti azienda)
5. `audit_log` (entita='aziende_referenti' AND entita_id IN referenti azienda)

Filtri pill: tutti / cliente / studio (basati su `user_ruolo`). Ricerca su `azione`/`descrizione`/`user_nome`/`dettagli`. Paginazione 20/pag classica.

Export CSV: [`/api/azienda-log-csv?id=N&orig=..&q=..`](api/azienda-log-csv.php) — admin/direzione only, audit `export_csv_azienda_log`, BOM UTF-8 per Excel, hard cap 50k righe.

### Modulo-bridge

Le 4 tab Documenti/Circolari/Questionari/Scadenze sono **viste filtrate per azienda** delle pagine madre, **non** rifacimenti. Pattern: paginazione classica 9/pag, link "Vista completa" che apre la pagina madre con filtro corrispondente. Le **azioni di creazione**:

- Documenti: deep-link a `/admin/documenti?azienda_id=N&upload=1` (il modal upload è quello esistente).
- Circolari: deep-link a `/admin/circolari-edit?dest_azienda=N`.
- Questionari: deep-link a `/admin/questionario-edit?dest_azienda=N`.
- Scadenze: **modal locale** "Nuovo memo" con form (titolo + data + descrizione + visibilità azienda/reparto/utente) e POST handler `scadenza_crea` nel controller della scheda. La visibilità preimpostata è `'azienda'` per ridurre l'errore "memo personale → tutti".

Il partial Circolari include `target_tipo='tutti'` nel filtro (le circolari broadcast riguardano anche l'azienda), mentre il partial Scadenze **esclude** `visibilita='tutti'` (le scadenze fiscali nazionali vivono già in `/admin/scadenze`).

### Pulizia legacy

[admin/aziende.php](admin/aziende.php) ha **perso 281 righe** con il rifacimento: rimossi modal `#modalMod` (Modifica) e `#modalCli` (Vedi clienti), funzioni JS `apriModifica`/`apriClienti`/`renderClienteCard`/`apriResetPwdCliente`, azioni inline `data-pl-action="modifica|elimina|vedi-clienti"`. Conservati: modal `#modalCrea` (Nuova azienda), azioni inline `arricchisci` + `toggle attivo`. Le pill "👥 N clienti" e "💬 N com" della lista ora linkano direttamente a `/admin/azienda/:id?sez=dipendenti|comunicazioni`.

### Vincoli di sicurezza ricorrenti

- **Anti self-mod**: il dispatcher delle azioni dipendenti rifiuta operazioni dove `$_POST['id'] === $myId` con messaggio "Non puoi modificare il tuo account da qui".
- **Coerenza azienda**: il helper `$checkDipendente` di `azienda-detail.php` valida che il dipendente sia `azienda_id = $aziendaId AND ruolo='cliente' AND eliminato=0` prima di ogni operazione.
- **Type-to-confirm** sulle azioni distruttive: eliminare dipendente richiede di digitare la sua email; eliminare azienda richiede di digitare il codice azienda. Validato server-side con `strcasecmp`.
- **Modalità ispezione superadmin**: tutti i POST sono già bloccati da `bloccaScritturaSuperadminInspect()` chiamato da `richiediLogin()`.

## Firma automatica risposte studio

Da `/admin/impostazioni?sez=workflow` (toggle + textarea max 500 char,
chiavi `impostazioni.firma_studio_attiva` + `firma_studio_testo`).
Quando attiva, `ComunicazioneController` aggiunge la firma in coda ad
ogni messaggio inviato lato studio. Helper privato `applicaFirmaStudio()`
con cache statica per richiesta (1 query/request) e idempotenza:
se la firma è già in coda al testo (es. operatore l'ha incollata a mano)
non viene duplicata. Applicato in `crea()` (se `apertaDa='studio'`) e
`rispondi()` (se `lato='studio'`). NON viene applicato alle note interne
né alle risposte cliente.

## Export CSV anagrafica aziende

[`/api/aziende-export-csv?stato=..&tipo=..&citta=..&settore=..&q=..`](api/aziende-export-csv.php)
— ACL admin/direzione, riusa gli stessi filtri di `/api/aziende-search`.
27 colonne (identità, contatti, sede, profilo arricchito, conteggi
clienti/comunicazioni). BOM UTF-8 per Excel su Windows. Audit
`export_csv_aziende`. Bottone "📥 Esporta CSV" in toolbar di
`/admin/aziende` visibile solo a admin/direzione.

## Auto-chiusura comunicazioni inattive

Da `/admin/impostazioni?sez=workflow` → "Auto-chiusura comunicazioni inattive".
Setting per-tenant `impostazioni.com_auto_close_giorni` (int 0..365,
`0=off`). Il cron [`bin/cron-com-auto-close.php`](bin/cron-com-auto-close.php)
gira **ogni 6 ore** e chiude le `comunicazioni` aperte dove l'ULTIMO
messaggio non interno è del cliente (`lato='cliente'`) ed è più vecchio
della soglia in giorni. Marca `chiusa=1` + `auto_chiusa_motivo='inattivo_<N>gg'`
e inserisce una **nota interna automatica** (lato='interno', origine='sa') con
spiegazione, per audit. Non tocca i thread dove l'operatore ha già risposto
(anche solo con nota interna). Per riaprire, l'operatore risponde
normalmente: il sistema rende di nuovo attivo il thread.

Generalizzazione del pattern `cron-whatsapp-auto-close.php` (qualsiasi
canale invece di solo WhatsApp, soglia in giorni invece di ore). CLI:
`--dry-run`, `--tenant=slug`, `-v`.

## Memo email pre-scadenza

Da `/admin/impostazioni?sez=workflow` → "Promemoria email scadenze". Toggle
`impostazioni.scadenze_memo_attivo`. Il cron
[`bin/cron-scadenze-memo.php`](bin/cron-scadenze-memo.php) gira **daily
alle 08:00** e invia email-promemoria ai destinatari delle scadenze
`attivo=1` che cadono fra **7 giorni e 1 giorno**, riusando gli eventi
notifica `scadenza_memo_7gg` e `scadenza_memo_1gg` già configurabili
da [`/admin/notifiche`](admin/notifiche.php) (template in
[`src/notifiche_default.php`](src/notifiche_default.php) con override
per-tenant via `notifiche_config`).

Destinatari in base a `scadenze.visibilita`:

- `tutti` → tutti i clienti attivi del tenant
- `azienda` → tutti i dipendenti dell'azienda con email
- `reparto` → membri del reparto (via `reparti_azienda_utenti`)
- `utente` → solo quel cliente

**Idempotenza** via [migrations/56_scadenze_memo.sql](migrations/56_scadenze_memo.sql):
tabella `scadenze_memo_inviati` con `UNIQUE (scadenza_id, soglia_gg, user_id)`.
Ogni cliente riceve ogni soglia **una sola volta**. In caso di errore SMTP la
riga viene rimossa per dare un altro tentativo il giorno dopo (no perdita
di promemoria silenziose).

Pattern bootstrap multi-tenant come [`cron-circolari-scheduler.php`](bin/cron-circolari-scheduler.php):
1° tenant in-process, gli altri come sub-process con `--no-lock` (per non
collidere con il lock globale del parent). CLI: `--dry-run`, `--tenant=slug`,
`-v`, `--no-lock`.

## E2E UX testing (suite Playwright)

Suite end-to-end **read-only** in [tests/e2e/](tests/e2e/) che scansiona ~113 rotte
su 4 ruoli (anon, cliente, cliente_admin, direzione, superadmin) e raccoglie:
console errors, HTTP 4xx/5xx, failed requests, violazioni axe-core (WCAG 2.1 AA +
best-practice), screenshot full-page, Lighthouse (perf+a11y+BP+SEO) e keyboard
navigation. Tutto auto-contenuto (Node 20 binario locale ~95MB + Chromium
~170MB + node_modules ~200MB).

**Quando rilanciarla:** prima di un release per scoprire console errors,
asset rotti, regressione di accessibilità. Non parte del CI per ora (è suite
manuale stile "smoke + audit").

**Comandi rapidi** (da `/var/www/portal/tests/e2e/`):

```bash
PATH="$PWD/.node/bin:$PATH"
# Pulisci eventuali login_attempts accumulati da CSP report durante il sweep
sudo mysql portal_main -e "DELETE FROM login_attempts WHERE email LIKE 'csp-report:%' OR (successo=0 AND ip='178.104.235.33' AND created_at > NOW() - INTERVAL 6 HOUR);"
# Sweep completo (113 rotte, ~3 minuti)
sudo -u www-data env PATH="$PATH" node run-sweep.cjs
# Sweep mobile / dark / cliente_admin / lighthouse
sudo -u www-data env PATH="$PATH" node run-sweep.cjs --routes=routes-key.json --viewport=mobile --suffix=mobile
sudo -u www-data env PATH="$PATH" node run-sweep.cjs --routes=routes-key.json --theme=dark    --suffix=dark
sudo -u www-data env PATH="$PATH" node run-sweep.cjs --only-role=cliente_admin --suffix=ca
sudo -u www-data env PATH="$PATH" node run-lighthouse.cjs        # 10 rotte chiave
sudo -u www-data env PATH="$PATH" node run-keyboard.cjs          # tab order + focus ring
# Aggregator → ux-report.md
sudo -u www-data env PATH="$PATH" node analyze.cjs
```

**Output** in `tests/e2e/report/`: `sweep-results*.json`, `screenshots*/`,
`lighthouse-summary.json`, `keyboard-results.json`, `UX-FINDINGS.md` (report
finale curato).

**Aggiungere una rotta**: edita `routes.json` (lista completa) o `routes-key.json`
(subset per mobile/dark/lighthouse). Per le rotte parametriche usa l'ID di un
record demo (`comunicazione 40`, `azienda 37`, ecc. — vedi sezione `ids` in cima al JSON).

**Bug noto interno alla suite**: il browser headless emette CSP-report verso
`/api/csp-report` per ogni page load. Il backend logga la chiamata in
`login_attempts` via `RateLimit::log` (è un bug del codebase: vedi
`AuthController::stateRateLimit` filter `email NOT LIKE '%:%'`), quindi senza
la pulizia preliminare il 16° tentativo dello stesso IP lockerebbe i login.
Il fix è già in `sweep.cjs` (intercetta `/api/csp-report` lato Playwright).

**Cosa la suite NON testa** (candidate per estensioni future): flow POST (è
solo GET), touch/swipe mobile, WebSocket, stampa/export PDF, visual regression
vs baseline, penetration testing.

**Audit UX 2026-05-24** — sweep iterativo (8 round) che ha portato:

| Metrica             | baseline | dopo fix |     Δ |
| ------------------- | -------: | -------: | ----: |
| a11y critical       |      141 |        0 | −100% |
| a11y serious        |      998 |      167 |  −83% |
| a11y moderate       |      202 |        1 | −100% |
| a11y minor          |        3 |        0 | −100% |
| console errors      |       87 |        1 |  −99% |
| failed network reqs |      170 |        1 |  −99% |

Dettaglio dei fix applicati (bug del codebase + a11y) in
[UX-FIXES-REPORT.md](UX-FIXES-REPORT.md). Tra i più rilevanti:

- **Rate-limit login conta record virtuali** in `login_attempts` (csp-report:_,
  firma:_, trova:\*) come tentativi falliti. Fix: `AND email NOT LIKE '%:%'` in
  [AuthController::stateRateLimit](src/controllers/AuthController.php).
- **7 file admin con guard `$ruolo !== 'admin'` hardcoded** che reindirizzavano
  silenziosamente alla home anche `direzione` (in contrasto col CLAUDE.md
  "admin e direzione hanno sempre tutti i permessi"). Sostituito con
  `ACLController::puo('impostazioni.gestire'|'audit.vedere')`.
- **CSP `connect-src` bloccava Google Fonts preconnect** (111 pagine). Aggiunto
  `fonts.googleapis.com fonts.gstatic.com` in
  [ops/apache/portal-security-headers.conf](ops/apache/portal-security-headers.conf).
- **`/api/ai-consent` 404 su 24 pagine superadmin**: l'endpoint esiste solo su
  tenant. Fix runtime: skip se `location.pathname.startsWith('/superadmin')`
  o host è platform.
- **Skip-link assente in `/admin/*`**: portal.js non era caricato (lo è solo
  sul cliente). Aggiunto `<a class="skip-link" href="#paMain">` + `<main id="paMain">`
  in [admin/\_app_head.php](admin/_app_head.php).
- **SRI integrity mismatch** per bootstrap-icons in admin/wizard.php — hash
  ricalcolato.
- **Link rotti `header('Location: comunicazioni.php')`** (relativi) →
  `header('Location: /comunicazioni')` (assoluti), 5 occorrenze.
- **a11y runtime promotion** in portal.js + admin/\_app_head.php: promuove
  `<div class="main">` → `<main>`, primo titolo grande → `<h1>`, e auto-injecta
  `aria-label` su button icona-only/select-filtro/checkbox/input/textarea senza
  nome accessibile (mappa 25 icone Bootstrap → testo italiano).
- **Token CSS contrasto**: `--c-muted` light-mode da `#64748b` (4.78:1) a
  `#475569` (7.20:1); `--c-light` light-mode `#94a3b8` → `#64748b`;
  `--c-sidebar-text` `#94a3b8` → `#cbd5e1` (7.2:1 su dark sidebar). Sostituiti
  globalmente `#94a3b8` → `#64748b` in CSS/PHP per testi (preservati per
  decorazioni canvas/gradient).
- **`<h6>` → `<h3>` in `src/guide_content.php`** (186 occorrenze), per non
  saltare livelli di heading nella guida.
- **`is-empty` opacity .65 → .9** sulle card KPI vuote (riduceva contrasto a 3.2:1).
- **`<select>` filtri** ottengono `aria-label` derivato dall'option vuoto
  ("Tutte le categorie", ecc.) via runtime in `portal.js`.
- **Module color palette** in `admin/_moduli.php`: amber/green/cyan → versioni
  più scure (slate-700 family) per garantire contrasto su `pa-btn-primary`.

I 167 color-contrast residui sono in classi decorative (`badge`, `pill`,
`cat-color` dinamico da DB, link blu-300 in paragrafi) che richiedono scelte
di design palette, non meccaniche.

## Stress test monitor + launcher

Pagina superadmin con **lancio + monitor live** dei test in
`/var/www/portal-stresstest/`. Lo stress test è stato spostato dalla
posizione originale `/home/admin/stress-test/` per evitare la dipendenza
da sudo: ora gira come `www-data` (stesso owner del codebase portal).

### Spostamento da /home/admin/stress-test/

Storia: la dir originale era in `/home/admin/stress-test/` (owner
admin). Per consentire al pannello SA di lanciare i test dal browser
servivano sudoers + ACLs (privilege escalation). Soluzione adottata:
spostata in `/var/www/portal-stresstest/` chown `www-data:www-data`.

- `run.php` patchato: rimosso `shell_exec("sudo grep ...")` per leggere
  master.php (ora legge direttamente, master.php è 640 root:www-data) e
  rimosso `shell_exec("sudo mysql ...")` per le metriche (ora usa
  `masterPdo()` via PDO).

### Repo separato

Lo stress test ha un proprio repo git: **https://github.com/MontaNic/portal-stresstest**
(private). Non è incluso nel repo `portal` perché è un'utility, non
parte del prodotto. Workdir locale `/var/www/portal-stresstest/`.

- **Owner repo**: `www-data:www-data` (allineato col workdir, niente
  permission drift)
- **Git ops as admin**: serve `safe.directory` exception perché il repo
  è di `www-data` ma admin lancia `git` con le proprie credenziali GH.
  Fix one-shot: `git config --global --add safe.directory /var/www/portal-stresstest`
- **Workflow modifiche playbook/run.php**:
  ```bash
  # editing diretto se sei in www-data group, altrimenti via /tmp + sudo install
  cd /var/www/portal-stresstest
  sudo -u www-data git add <file>
  sudo -u www-data git commit -m "..."
  git push origin main   # come admin, GH creds qui
  ```
- **`.gitignore`** esclude `data/*.{csv,json,out,md}` e
  `.current-run.json` (runtime artifacts) e `server-info-*.txt`

### URL e endpoint

- **UI**: [/superadmin/stresstest](superadmin/stresstest.php), auth
  `superadminGuard()`, link tile in `/superadmin/sistema`.
- **Stats**: [/api/superadmin/stresstest-stats](api/superadmin/stresstest-stats.php)
  — **polling adattivo**: 3 s solo mentre un test è IN ESECUZIONE, 15 s da fermo (per
  rilevare un nuovo run), zero polling a tab nascosto/errore sessione. Refresh immediato
  dopo Avvia/Ferma (evento `focus`).
- **Actions**: [/api/superadmin/stresstest-action](api/superadmin/stresstest-action.php)
  — POST con `{action: 'start'|'stop'|'cleanup'|'status', ...}`. CSRF +
  superadminGuard. Rate-limit 1 azione / 30s per superadmin.
  - **Stop**: lo spawn invoca `run.php` con **path ASSOLUTO** (`/usr/bin/php /var/www/portal-stresstest/run.php`),
    così `pgrep` (scrive il pidfile allo start) e `pkill -f portal-stresstest/run.php` (stop)
    matchano l'orchestratore. Con `php run.php` (relativo) il cmdline non conteneva
    `portal-stresstest/run.php` → pidfile mai scritto → "Nessun run in corso".
  - Catena spawn `seed && run ; cleanup`: la cleanup (con `;`, non `&&`) gira SEMPRE anche se
    seed/run falliscono → niente seed parziali orfani che bloccherebbero i run successivi.

### Launcher (modal + form)

Bottone verde "Avvia test" nel page-header apre modal con 3 dimensioni:

- **Scale**: 1x | 2x (default) | 4x | 8x — moltiplicatore seed (staff,
  aziende, clienti). Validato 1-8 server-side.
- **Durata**: 5 min | 15 min | 30 min | 1 ora (default) | 2 ore. Validata
  60-7200 sec server-side.
- **Workers**: 5 | 10 (default) | 15 | 20 | 30. Validata 1-30.

Riepilogo live (es. "20 staff · 10 aziende · 60 clienti · 60 min · 10
workers"). Avvisi soft se workers > FPM max (15) o se durata + scale
elevati richiedono molto disco.

**Spawn**: `nohup bash -c "php run.php --phase=seed ... && php run.php
--phase=run ... && php run.php --phase=cleanup ..."` (chain). Niente
sudo, gira come www-data. PID + run-id salvati in
`/var/www/portal-stresstest/.current-run.json` per lo status. Log in
`/var/log/portal/stresstest-<run-id>.log`.

Bottone rosso "Ferma test" appare quando un run è attivo: `pkill -f
portal-stresstest/(run|worker).php` + cleanup automatico dopo 1.5s.

Bottone "Cleanup" (sempre presente): esegue `--phase=cleanup` sull'ultimo
registry trovato, anche se il test è già finito (utile per rimuovere dati
residui di run interrotti).

### Rilevazione stato run

- glob su `log-*.csv` ordinato per `filemtime`
- regex `log-([A-Za-z0-9_-]+)\.csv$` (accetta prefissi non-numerici tipo
  `web20260527`, `2x`, `smoke`)
- se ultimo evento < 30s fa → `active`, altrimenti `idle`
- `state='no_runs'` se la dir non ha file `log-*.csv`

### Sorgenti dati + metriche

- `log-<run-id>.csv` — 12 colonne (ts, run_id, worker, user_id, ruolo,
  op, url, method, status, latency_ms, ok, error). Tail ~256 KB.
- `monitor-<run-id>.csv` / `snapshot-<run-id>.csv` — ultimo record per
  risorse server (load, RAM, MySQL threads, FPM busy/idle).
- Metriche esposte: ops totali finestra 60s, ops/sec, success%,
  p50/p95/p99 (globale + per endpoint top 15), errori per op,
  ops by ruolo, sparkline 12 bucket × 5s per ops/sec / p50 / p95 / p99.

### Grafici (vanilla canvas, no deps)

UI ha **MiniChart** custom (~150 LOC) per line chart con gradient fill,
griglia 4 livelli, hover crosshair + tooltip, etichette X temporali.
Riusabile tra refresh (chart instances mantenute, `.update()` ridisegna).

### Sicurezza

- **CSRF** validato su tutti i POST
- **Validation rigida**: scale 1-8, duration 60-7200, workers 1-30,
  tenant `[a-z0-9_]+`, run-id `[A-Za-z0-9_-]+`
- **Rate-limit**: 30 azioni/min per superadmin (anti-spam)
- **Audit log**: ogni start/stop/cleanup va in `superadmin_audit`
  (`stresstest_start`, `stresstest_stop`, `stresstest_cleanup`,
  `stresstest_start_failed`)
- **Niente sudo / privilege escalation** — spawn diretto come www-data
- **PIDfile** in `/var/www/portal-stresstest/.current-run.json` con
  metadati del run (chi l'ha avviato, quando, parametri)

**Limiti noti**: le aggregazioni live sono sul tail (~256 KB), non
sull'intero log. Per stats complete a fine corsa usare
`/var/www/portal-stresstest/report.php` da CLI. La pagina è ottimizzata
per "vedo cosa sta succedendo adesso", non per autopsy post-test.

## TODO future

- Code richieste modifica (`admin/approvazioni.php`)
- Studio editor (CSS personalizzato per branding avanzato)
- Driver `S3StorageDriver` in `Storage.php` (oggi stub, attivabile
  con `composer require aws/aws-sdk-php` + implementazione di
  `write/absolutePath/exists/deleteFile`)

## Dove fare cosa

| Voglio...                                                              | File / metodo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aggiungere endpoint API                                                | `api/<nome>.php` con `richiediLogin()` + rotta in `src/routes.php`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Cambiare schema DB tenant                                              | `migrations/01_studio_template.sql` + migrazione su tenant esistenti                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Aggiungere voce sidebar                                                | `admin/sidebar.php` (sezioni `pagPersonale/pagLavoro/...`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Aggiungere pagina superadmin                                           | Nuovo file `superadmin/<nome>.php` con pattern del topbar (vedi sezione "Pannello superadmin") + entry in `$NAV` di `_topbar.php` + rotta in `src/routes.php`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Aggiungere/modificare un template grafico                              | `superadmin/templates/_data.php` (nome, colori, hero text, layout). L'anteprima `preview.php` legge automaticamente i nuovi template                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Cambiare limiti/features di un piano                                   | `src/piani.php` — array `getPiani()` con `limiti.utenti_staff/aziende/clienti/dipendenti_per_azienda/storage_gb` + `features` + `no_features`. Verifica nei controller con `pianoVerifica($studioId, 'feature.codice')`. Per risorse "per-azienda" usa `getPiano(pianoSlugCorrente())['limiti'][...]` ed enforcement nei punti di INSERT.                                                                                                                                                                                                                                       |
| Creare un reparto azienda                                              | UI: `/reparti-azienda` (solo cliente_admin) → "+ Nuovo reparto". Gestisci membri dal modal "person-gear". Programmaticamente: `INSERT INTO reparti_azienda (azienda_id, nome, descrizione)` + INSERT in `reparti_azienda_utenti`.                                                                                                                                                                                                                                                                                                                                               |
| Caricare un documento per un solo reparto                              | UI: wizard documenti → step 2 → "Reparto" + dropdown reparti dell'azienda. Programmaticamente: `Storage::upload(..., ['visibilita'=>'reparto', 'azienda_id'=>X, 'reparto_id'=>Y, ...])`. ACL filtra automaticamente solo gli utenti dentro `reparti_azienda_utenti`.                                                                                                                                                                                                                                                                                                            |
| Invitare un cliente come admin azienda                                 | UI: `/admin/inviti` → "Nuovo invito" → spunta "Sarà admin azienda". L'invito persiste `cliente_ruolo='admin'` e `registrati.php` lo applica. **Auto-promote**: il primo utente di un'azienda che accetta diventa admin a prescindere dal flag (fail-safe per evitare aziende orfane).                                                                                                                                                                                                                                                                                           |
| Cambiare colori UI                                                     | `impostazioni.studio_colore_primario` (per studio) o variabili CSS hardcoded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Bloccare azioni in ispezione                                           | Già automatico se chiami `richiediLogin()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Audit di un'azione (studio)                                            | `auditLog('azione_nome', 'entita', $id, ['dettagli'=>...])`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Audit di un'azione superadmin                                          | `INSERT INTO superadmin_audit (superadmin_id, studio_id, azione, ip, dettagli) VALUES (...)` su `_portal_master_pdo()`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Generare token sicuro                                                  | `bin2hex(random_bytes(24))` o `(32)` per token più lunghi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Aggiungere voce nel menu utente                                        | `admin/topbar.php` o `public/sidebar-cliente.php` (sezione `<div class="user-menu">`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Aggiungere voce al tour                                                | `STEPS.cliente`/`STEPS.admin` in `public/assets/portal-tour.js`. Step con `selector: null` = modale centrale. Usa `optional: true` per saltare se non trovato. **Per il tour admin** imposta anche `ruoloMin: 'operatore'\|'responsabile'\|'admin'` per filtrare per ruolo.                                                                                                                                                                                                                                                                                                     |
| Aggiornare contenuti guida                                             | `src/guide_content.php` — propaga automaticamente a HTML (cliente/admin/superadmin) + PDF. **Per la guida admin** imposta `'ruolo_min' => 'operatore'\|'responsabile'\|'admin'` su ogni sezione (operatore = visibile a tutti, default se omesso).                                                                                                                                                                                                                                                                                                                              |
| Aggiungere un nuovo evento di notifica email                           | 1) Aggiungi la riga in `notifiche_config` (migrazione + seed) con `evento`/`destinatario`/`attiva`. 2) Aggiungi il template default in `src/notifiche_default.php` con `titolo`/`descrizione`/`subject`/`body`/`cta_label`. 3) Trigger via `MailerService::inviaNotificaSistema($evento, $destinatari, $context, $linkUrl)` dal punto di flusso. 4) Eventualmente aggiungi i placeholder usati al `placeholdersPerEvento` di `/admin/notifiche.php`.                                                                                                                            |
| Personalizzare un template di notifica per uno studio                  | Pannello admin → **Notifiche email** (`/admin/notifiche`, solo admin) → click sull'evento → editor live con anteprima → "Salva". Per riportare al default: bottone "Ripristina default".                                                                                                                                                                                                                                                                                                                                                                                        |
| Cambiare la "home" di un ruolo                                         | `AuthController::homeUrlPerRuolo($ruolo)` in `src/controllers/AuthController.php`. È la single source of truth: login redirect, banner ispezione "Esci", CTA landing, fallback POST-bloccato. Lato JS lo specchio è `HOME_URL_PER_RUOLO` in `portal-tour.js`.                                                                                                                                                                                                                                                                                                                   |
| Filtrare un dropdown "operatore" o una query "WHERE ruolo IN (...)"    | Usa le costanti di [AuthController](src/controllers/AuthController.php): `RUOLI_OPERATIVI` (responsabile/operatore/capoufficio) per assignment ticket e regole di lavoro, `RUOLI_RFM` (+ direzione) per RFM e membri portafoglio, `RUOLI_INTERNI` (+ admin) per ricerca/KPI/ACL. Helper `AuthController::ruoloInWhere($ruoli, 'col')` ritorna `[whereSql, params]` per prepared statements. Mai hardcodare la lista.                                                                                                                                                            |
| Attivare la visibilità ristretta operatori (portafogli)                | UI: `/admin/impostazioni?sez=workflow` → toggle "Visibilità ristretta operatori". Poi `/admin/portafogli` → crea portafogli + assegna aziende + assegna operatori. Toggle OFF di default → zero impatto runtime. Vedi sezione "Portafogli".                                                                                                                                                                                                                                                                                                                                     |
| Filtrare una query lista per portafoglio                               | `[$w, $p] = PortafoglioACL::whereForUser($user, 'alias', 'azienda_id'); if ($w !== '1=1') { $where .= " AND $w"; $params = array_merge($params, $p); }`. Per gate puntuali: `PortafoglioACL::puoVedere($aid, $user)`. Per costruire `$user`: `PortafoglioACL::userFromSession()`.                                                                                                                                                                                                                                                                                               |
| Switchare la vista globale come direzione                              | Topbar → pill "Vista" → "Tutto lo studio" / "Miei clienti". POST a `/api/preferenze-vista-portafogli` (CSRF auto). Persistente in `user_preferenze.vista_portafogli`. Solo `direzione` può switchare; per gli altri ruoli è no-op silenzioso.                                                                                                                                                                                                                                                                                                                                   |
| Filtrare destinatari email per portafoglio (Fase 4)                    | `PortafoglioACL::filtraDestinatari($aziendaId, $userIds)`: ritorna solo gli user_id in-scope per l'azienda. Admin sempre dentro. Le aziende orfane vengono trattate come "tutti dentro" (D4). Usa **appartenenza oggettiva al portafoglio**, NON la preferenza `vista_portafogli`.                                                                                                                                                                                                                                                                                              |
| Caricare un documento (lato studio)                                    | UI: `/admin/documenti` → modal "+ Carica documento". Programmaticamente: `Storage::upload($file, STUDIO_SLUG, $contesto)` con `tipo_id`, `visibilita`, eventuale `password` e `azienda_id`/`user_id`. La classe valida (max 20 MB, 17 estensioni), genera UUID, fa `INSERT` con rollback file se l'INSERT fallisce.                                                                                                                                                                                                                                                             |
| Servire un documento                                                   | UI: link a `/api/documento?id=N` (gestisce auth + password prompt automaticamente). Programmaticamente: `Storage::serve($docId, $userId, $password)` da un endpoint server-side. La classe applica ACL, verifica password, registra lettura implicita e fa stream del file. Termina con `exit`. Mai linkare direttamente la cartella `storage/`.                                                                                                                                                                                                                                |
| Confermare la lettura di un documento (cliente)                        | UI: bottone verde "Confermo" sulla riga del doc su `/documenti`. Programmaticamente: `POST /api/documento-conferma` con `id` e opzionale `nota`. Idempotente, non sovrascrive `'esplicita'` con `'implicita'`.                                                                                                                                                                                                                                                                                                                                                                  |
| Archiviare/eliminare un documento dalla vista cliente                  | UI: kebab `⋮` sulla riga in `/documenti` → wizard "Rimuovi" → scelta Archivia / Elimina definitivamente. Vista archivio in `/documenti?vista=archivio`. Programmaticamente: 3 POST handler in `public/documenti.php` (`action=archivia\|elimina\|ripristina`) che fanno upsert/delete in `documenti_user_state`. Lo stato è **per-utente**: lo studio non lo vede. Il record in `documenti` non viene mai toccato.                                                                                                                                                              |
| Vedere chi ha aperto un documento (admin)                              | UI: bottone "Letture" sulla card del documento in `/admin/documenti` → modal con tabella (utente, tipo conferma, timestamp, IP). Endpoint: `GET /api/documento-letture?id=N`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Aggiungere un nuovo tipo documento                                     | Catalogo in `documenti_tipi`. Tipi predefiniti di piattaforma con `studio_id IS NULL` (immutabili, in `migrations/05_documenti.sql`). Tipi custom del tenant: `INSERT INTO documenti_tipi (studio_id, codice, etichetta, direzione, ...) VALUES (STUDIO_ID, ...)`.                                                                                                                                                                                                                                                                                                              |
| Cambiare driver storage (local → S3)                                   | Modificare `STORAGE_DRIVER` in `master.php`, valorizzare `STORAGE_S3_*`, installare `composer require aws/aws-sdk-php` e implementare `S3StorageDriver::{write,absolutePath,exists,deleteFile}` in `src/helpers/Storage.php`. Il resto del codice non cambia (driver pattern).                                                                                                                                                                                                                                                                                                  |
| Attivare l'importazione documenti da Drive                             | `/admin/impostazioni` → tab **Backup su Drive**: collega un drive (sezione mirror), poi nella sezione **Importazione da Drive (Inbox)** attiva il toggle e salva. Il cron `bin/cron-dms-inbound.php` (e il bottone "Importa ora") crea le cartelle sul drive e importa i file. Logica in [`DmsInboundService`](src/services/DmsInboundService.php). Vedi sezione "Importazione da Drive / Inbox DMS".                                                                                                                                                                           |
| Cambiare la mappa cartelle inbox → visibilità                          | `DmsInboundService::mappa()` (costruzione albero) e `risolviCartella()` (risoluzione inversa) in [src/services/DmsInboundService.php](src/services/DmsInboundService.php). Le due funzioni vanno tenute speculari.                                                                                                                                                                                                                                                                                                                                                              |
| Importare un tracciato F24 (split per cliente)                         | UI: `/admin/import` (hub) → "Tracciati F24" → carica il file → revisione → "Pubblica". Logica in [`ImportTracciatiService`](src/services/ImportTracciatiService.php), abbinamento per codice fiscale. Vedi sezione "Import strutturato (tracciati F24)".                                                                                                                                                                                                                                                                                                                        |
| Aggiungere un nuovo tipo di import                                     | Aggiungi una card all'array `$servizi` in [admin/import.php](admin/import.php) + crea la pagina dedicata del servizio. La topbar non cambia (resta la sola voce "Import").                                                                                                                                                                                                                                                                                                                                                                                                      |
| Attivare il modulo Agevolazioni per un'azienda                         | È opt-in: serve l'add-on `agevolazioni` attivo sul tenant + l'attivazione della singola azienda (`aziende.agev_attivata_at`, entro `studios.agevolazioni_quota`). Gate cliente via `AgevolazioniService::isAziendaAttiva()`. Un'azienda non attivata vede la vetrina `/agevolazioni` con "Richiedi informazioni". Vedi "Modulo Agevolazioni (add-on)".                                                                                                                                                                                                                          |
| Aggiungere un formato all'import strutturato                           | Implementa l'interfaccia `TracciatoParser` in [src/services/TracciatoParser.php](src/services/TracciatoParser.php) e aggiungilo a `ImportTracciatiService::parsers()`. Il modello normalizzato di ritorno è documentato in testa al file.                                                                                                                                                                                                                                                                                                                                       |
| Bloccare i POST in modalità ispezione                                  | Già automatico per il pannello admin: `richiediLogin()` chiama internamente `bloccaScritturaSuperadminInspect()`. Per pagine cliente (`/public/*`) chiama esplicitamente `AuthController::bloccaScritturaSeIspezione()` dopo il login (caso "admin che naviga il portale come cliente").                                                                                                                                                                                                                                                                                        |
| Pubblicare una circolare                                               | UI `/admin/circolari` → "+ Nuova circolare". Programmaticamente: `CircolariService::crea(['titolo','body_html','priorita','destinatari'=>[['tipo'=>'tutti'\|'azienda'\|'utente', ...]],...])`. La logica di visibilità è in `CircolariService::puoVedere()` + `listForCliente()`.                                                                                                                                                                                                                                                                                               |
| Creare e inviare un questionario                                       | UI `/admin/questionari` → "+ Nuovo questionario" (editor: domande manuali o via AI, destinatari, salva e invia). Programmaticamente: `QuestionariService::crea()` + `salvaDomande()` + `invia($id, $destinatari)`. Vedi sezione "Questionari".                                                                                                                                                                                                                                                                                                                                  |
| Aggiungere un tipo di domanda al questionario                          | Estendi `QuestionariService::TIPI_DOMANDA` + l'ENUM di `questionari_domande.tipo` (migrazione) + il render input in `questionario-edit.php` (editor) e `public/questionario.php` (compilazione).                                                                                                                                                                                                                                                                                                                                                                                |
| Gestire orari/assenze di un operatore                                  | Profilo `/admin/profilo` → tab Disponibilità. API: `UserDisponibilitaService::salvaOrariStandard($userId, $fasce)`, `aggiungiAssenza()`, `eliminaAssenza()`, `getCopertura(DateTimeImmutable)`.                                                                                                                                                                                                                                                                                                                                                                                 |
| Cambiare le soglie alert disponibilità                                 | Costanti in `UserDisponibilitaService`: `ALERT_PAUSA_MANUALE_GIORNI` (default 3), `ALERT_COPERTURA_PCT` (default 50), `ALERT_COPERTURA_GG_AVANTI` (default 14).                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Limitare cosa fa l'operatore base                                      | `operatore` (e `capoufficio`) NON possono assegnare ticket ad altri (vedi `admin/comunicazione-detail.php` POST handler `assegna`). Possono solo "prendi in carico" (assegna a sé) e "rilascia". I filtri lista comunicazioni mostrano: Le mie · Da assegnare · Chiuse. La sidebar è "flat" (no sezioni collassabili) con classe `.sidebar-flat` aggiunta da `sidebar.php`.                                                                                                                                                                                                     |
| Aggiornare prezzi piani                                                | `src/piani.php` campo `prezzo` (stringa numerica = €/mese, "Custom" = personalizzato). La landing legge dinamicamente. Attuali: base 45€, pro 125€, enterprise Custom.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Aggiungere una nuova emoji ammessa nelle reazioni                      | Whitelist in [`api/com-reazione.php`](api/com-reazione.php) (`$emojiAmmessi`) + array `COM_REAZ_QUICK` in [`src/com_reazioni_ui.php`](src/com_reazioni_ui.php) per la toolbar rapida.                                                                                                                                                                                                                                                                                                                                                                                           |
| Estendere l'emoji picker dell'input                                    | Categorie + emoji in `COM_EMOJI` in `src/com_reazioni_ui.php`. Il picker aggiorna automaticamente il render.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Configurare il webhook Telegram                                        | `/admin/impostazioni` → tab Telegram → "Imposta webhook". **Telegram richiede HTTPS** — il codice forza `https://` su tutti gli host eccetto `.local`/`localhost`/IP privati. Se il certificato wildcard è OK il webhook si registra senza errori.                                                                                                                                                                                                                                                                                                                              |
| Attivare l'add-on WhatsApp per uno studio                              | (1) il piano deve essere `pro` o `enterprise` (`pianoHasFeature($piano, 'whatsapp_inbound')`). (2) admin va su `/admin/impostazioni` → tab **💚 WhatsApp**, incolla Phone Number ID + Permanent Access Token + App Secret + Verify Token (bottone "Genera nuovo Verify Token" crea una stringa random), incolla numero pubblico, salva e attiva il toggle. (3) console Meta → WhatsApp → Webhook → incolla URL `/api/whatsapp-webhook` + Verify Token mostrato, sottoscrivi `messages`. Verifica E2E con `curl` su `?hub.mode=subscribe&...`.                                   |
| Collegare il proprio WhatsApp (cliente)                                | Profilo cliente → tab Notifiche → sezione "Collega WhatsApp" (visibile solo se l'add-on tenant è attivo). Il cliente digita il proprio numero, normalizzazione in E.164 senza `+` via `WhatsAppService::normalizzaNumero`. Vincolo univoco intra-tenant: numero già usato → errore. Per scollegare: svuota il campo e clicca "Aggiorna".                                                                                                                                                                                                                                        |
| Cambiare soglia auto-chiusura WhatsApp                                 | UI: `/admin/impostazioni` → tab WhatsApp → campo "Auto-chiusura comunicazioni dopo (ore)". Persistito in `impostazioni.whatsapp_auto_close_ore` (0=off, max 168=7gg). Il cron `bin/cron-whatsapp-auto-close.php` legge il valore per-tenant ogni 30 min.                                                                                                                                                                                                                                                                                                                        |
| Aggiungere un tipo di messaggio WhatsApp gestito (image/audio/…)       | Estendi `WhatsAppService::TIPI_GESTITI` e il branch in `parseInbound()`. Per gli allegati: scarica il media da Meta via Graph API col token, salva in `uploads/comunicazioni/<comId>/` come fanno le rispondi del portale, e crea il record in `com_allegati`. Lasciato fuori dalla v1 inbound-only.                                                                                                                                                                                                                                                                            |
| Aggiungere media query mobile a una nuova pagina                       | Default project: `@media (max-width:900px)` per mobile (sidebar nascosta, hamburger), `@media (max-width:600px)` per smartphone (form in colonna, input `font-size: 16px` per evitare zoom iOS), `@media (max-width:480px)` per smartphone narrow (modali quasi-fullscreen).                                                                                                                                                                                                                                                                                                    |
| Verificare un permesso ACL                                             | `ACLController::puo('codice.permesso')` (admin/direzione → sempre `true`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Esporre dati nella ricerca globale                                     | `api/ricerca.php` — aggiungi un blocco SELECT con i campi `tipo/titolo/sottotitolo/icona/colore/badge/url`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Modificare il system prompt AI                                         | `api/ai-cliente.php` (clienti) o `api/ai-polish.php` (riformulazione bozza operatori, system prompt con vincoli "no fatti nuovi / no significato / no preamboli").                                                                                                                                                                                                                                                                                                                                                                                                              |
| Cambiare le opzioni del wizard AI Polish                               | Whitelist parametri in `api/ai-polish.php` (`$formalitaOk` / `$lunghezzaOk` / `$tonoOk`) + corrispondenti label nel `match` del prompt + `<input type="radio">` nel modal di [admin/comunicazione-detail.php](admin/comunicazione-detail.php).                                                                                                                                                                                                                                                                                                                                  |
| Marcare uno studio come demo                                           | `INSERT INTO impostazioni (chiave,valore) VALUES ('is_demo','1')` (lo fa già il seed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Sospendere / cestinare / eliminare uno studio                          | `/superadmin/studi` → card studio → "Sospendi" o "Elimina" (scelta cestino 30gg o eliminazione definitiva). Logica in [`StudioLifecycleService`](src/services/StudioLifecycleService.php); purge schedulato + promemoria email da [`bin/cron-purge-studi.php`](bin/cron-purge-studi.php). Vedi "Ciclo di vita di uno studio".                                                                                                                                                                                                                                                   |
| Aggiungere una rotta clean URL                                         | `src/routes.php` con `$router->add('/path', $FILE, 'nome')`. Vedi sezione "Front Controller"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Modificare la landing marketing                                        | `platform/index.php` (one long page) + `public/assets/platform.css` per gli stili                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Modificare la pagina "trova il tuo portale"                            | `platform/accedi.php` + endpoint `api/trova-studio.php` (cerca su `nome`/`slug`/`dominio` di `portal_master.studios`)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Cambiare email destinataria del form contatti                          | UI: `/superadmin/sistema` → "Email contatti piattaforma" (override DB in `portal_master.platform_settings`). Default in `master.php` (`PLATFORM_CONTACT_EMAIL_DEFAULT`); il valore effettivo è risolto in `config.php` come override-or-default. Mai esposta al browser.                                                                                                                                                                                                                                                                                                        |
| Attivare 2FA o passkey su superadmin                                   | UI: `/superadmin/profilo` → cards Passkey + 2FA. Programmaticamente: `superadminLoginStep1()` in [superadmin/auth.php](superadmin/auth.php) controlla `totp_enabled` e count passkey, e se uno dei due è presente fa pending in `sa_2fa_pending_uid` (5 min, IP-binding). Login step 2 in [superadmin/login-2fa.php](superadmin/login-2fa.php). Il superadmin ha la propria sessione `superadmin_*` separata da quella tenant `user_*`.                                                                                                                                         |
| Aggiungere un host marketing                                           | Aggiungi a `PLATFORM_HOSTS` in `src/config/master.php` (senza `www.`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Rinnovare/rigenerare il cert wildcard                                  | Già automatico via `certbot.timer`. Per forzare: `sudo certbot renew --cert-name studiodesk.cloud-0001 --force-renewal`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Cambiare il token Cloudflare per certbot                               | Edita `/etc/letsencrypt/cloudflare.ini` (chmod 600). Token con scope minimo: `Zone-DNS-Edit` su `studiodesk.cloud`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Aggiungere/aggiornare scadenze fiscali ufficiali                       | Modifica `src/data/scadenze-italia-<anno>.json`. Il cron `/etc/cron.d/studiodesk-sync` (04:00 daily) propaga i diff a tutti i tenant attivi via `bin/cron-sync-scadenze.php`. Le modifiche vengono loggate su `audit_log` con azione `scadenze_sync`                                                                                                                                                                                                                                                                                                                            |
| Importare scadenze in un tenant manualmente                            | Pannello admin → **Scadenze** → "Importa scadenze ufficiali" → wizard con anno + tipologia studio + checkbox per cherry-pick                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Pubblicare un memo (scadenza manuale) a un cliente                     | `/admin/scadenze` → "+ Nuova scadenza". Il form **forza la scelta di visibilità** (utente / azienda / reparto / tutti). Server-side rigetta submit senza destinatario coerente; un JS warning compare se il titolo contiene un nome proprio e visibilità = "tutti". Vedi sezione "Scadenze: visibilità per cliente".                                                                                                                                                                                                                                                            |
| Filtrare scadenze per il cliente loggato                               | `ScadenzaACL::whereForUser($user, 'alias')` ritorna `[$whereSql, $params]` da appendere alla query. `$user = ScadenzaACL::userFromSession()`. Ruoli interni → tautologia (vedono tutto). Vedi `public/calendario.php` per il pattern.                                                                                                                                                                                                                                                                                                                                           |
| Aggiornare la versione del portale                                     | Modifica `PORTAL_VERSION` + `PORTAL_VERSION_DISPLAY` + `PORTAL_VERSION_DATE` in [src/version.php](src/version.php). Convenzione (alla Apple): display `Portal26 Beta 1.X` durante la beta, `Portal26 X.Y` in produzione (numero dopo "Portal" = anno solare). Internal `26.0.X` (beta) o `26.X.Y` (GA) — semver-compatibile per `version_compare`. Appare nel footer di sidebar/login/landing                                                                                                                                                                                   |
| Aggiungere una nuova pagina con lista filtrabile (aziende-style)       | Crea `<div id="mioMount"></div>` nella pagina, includi `/assets/portal-list.js?v=<?= filemtime ?>`, istanzia `new PortalList({mount, endpoint:'/api/...', filters:[…], sortFields:[…], renderCard:fn, renderTableRow:fn?, viewModes:['card','table']?})`. Il componente gestisce search, debounce, virtual scroll, vista toggle, highlight. Vedi pattern in [admin/aziende.php](admin/aziende.php), [admin/utenti.php](admin/utenti.php), [public/utenti-azienda.php](public/utenti-azienda.php)                                                                                |
| Cambiare quanti elementi per pagina in documenti/circolari/questionari | Costante `$perPage` (default 9) in cima a [admin/documenti.php](admin/documenti.php), [admin/circolari.php](admin/circolari.php), [admin/questionari.php](admin/questionari.php). Paginatore server-side `?pag=N` con classe CSS `.docs-pager`. Vedi "Paginazione liste" in Componenti UI ricorrenti.                                                                                                                                                                                                                                                                           |
| Aggiungere un campo cercabile su aziende                               | Estendi: (1) FULLTEXT — `ALTER TABLE aziende DROP INDEX ft_search; ADD FULLTEXT … WITH PARSER ngram` con il nuovo campo; (2) `selectScore` e `searchClauses` in [api/aziende-search.php](api/aziende-search.php); (3) opzionale: render del campo nel `renderCard` di `admin/aziende.php` (con `ctx.highlight()`).                                                                                                                                                                                                                                                              |
| Aggiungere un nuovo filtro alla lista aziende                          | (1) Lato server: aggiungi parsing del param + clausola `WHERE` in [api/aziende-search.php](api/aziende-search.php) (opzionalmente uno **facet** in fondo all'endpoint); (2) Lato client: nell'array `filters` del `new PortalList(...)` di [admin/aziende.php](admin/aziende.php) — un `key`, `label` e `options[]` (oppure popolate via `onFacets` dalla risposta server)                                                                                                                                                                                                      |
| Aggiungere uno step a un wizard                                        | Crea una classe `WxNomeStep extends WizardStep` nel file [src/wizard/StepsWN.php](src/wizard/StepsW1.php) con `$id`/`$title`, `render(state, ctx): HTML`, `save(input, state, ctx): patch`. Aggiungila all'array di `WizardStepsWN::all()`. Lo state machine, il render del chrome (stepper + bottoni), CSRF e il flow back/skip sono automatici. Vedi "Wizard onboarding".                                                                                                                                                                                                     |
| Resettare un wizard per testarlo                                       | `DELETE FROM wizard_state WHERE user_id=? AND wizard_id='W1'\|'W2'\|'W3'`. Al prossimo `/dashboard` (o `/admin/home` per W3) il banner ricompare e il wizard riparte dallo step 1. Niente endpoint UI in v1 — è un follow-up.                                                                                                                                                                                                                                                                                                                                                   |
| Aggiungere un wizard nuovo (es. W4)                                    | (1) Crea `src/wizard/StepsW4.php` con classe `WizardStepsW4::all()` che ritorna gli step. (2) Aggiungi il case `W4` a `WizardRegistry::title()` e `WizardRegistry::canAccess()` (ACL). (3) Decidi entry-point: estendi `public/wizard.php` (cliente) o `admin/wizard.php` (studio), oppure crea uno nuovo. (4) Estendi `WizardController::banner()` se vuoi auto-trigger dalla home.                                                                                                                                                                                            |
| Posticipare / riaprire un wizard                                       | UI: banner home → dropdown "···" → "Ricordamelo tra 7/30 giorni" (POST `action=snooze` con `days`) o "Non mostrare più" (POST `action=skip_all`). Per riaprire: `/admin/impostazioni?sez=workflow` → sezione "Wizard onboarding studio" → "Riapri wizard". Programmaticamente: `WizardController::snooze($wid,$uid,$days)` / `reset($wid,$uid)` / `skipAll($wid,$uid)` / `isDismissed($db,$wid,$uid)` / `statusFor($db,$wid,$uid)`. La colonna `wizard_state.snoozed_until` viene azzerata da `reset()` ma `step_corrente`+`state_json` sono preservati (no perdita progressi). |
| Aggiungere una tab alla scheda azienda admin                           | (1) Aggiungi la chiave a `$TABS` in `admin/azienda-detail.php` (label + icona + badge opzionale). (2) Aggiungi ACL in `$puoVederTab` + `$puoScrivereTab`. (3) Crea il partial `admin/_az-<sez>.php` con guard `defined('AZIENDA_ADMIN_DETAIL')` e ricevi `$db`, `$aziendaId`, `$az`, `$myId`, `$puoScrivereTab`. (4) Se servono POST handler, aggiungili al dispatcher con audit `studio_azienda_*` e gating `$puoScrivereTab[<sez>]`. (5) Per query filtrate per azienda riusa `AziendaScope::where*` (placeholder posizionali).                                               |
| Aggiungere il filtro RFM o assegnare RFM                               | `aziende.operatore_riferimento_id` (FK SET NULL). Set: handler `anagrafica_set_rfm` da `_az-anagrafica.php`. Filtro lista: `/api/aziende-search?rfm=mie\|unassigned\|<int>`. Facet automatica nei top-12 operatori. Tile "Le mie aziende" su `/admin/home` riusa `azienda_kpi.php` per ordinare per `adempimenti_tot` (cache 120s).                                                                                                                                                                                                                                             |
| Esportare la lista aziende o il log di un'azienda                      | UI: `/admin/aziende` → bottone "Esporta CSV" (admin/dir, riusa filtri attivi) oppure scheda → tab Log → "Esporta CSV". Endpoint: [api/aziende-export-csv.php](api/aziende-export-csv.php) e [api/azienda-log-csv.php](api/azienda-log-csv.php). BOM UTF-8 per Excel. Audit log: `export_csv_aziende` / `export_csv_azienda_log`. Hard cap 50k righe.                                                                                                                                                                                                                            |
| Attivare/configurare la firma automatica nei messaggi studio           | `/admin/impostazioni?sez=workflow` → sezione "Firma automatica nelle risposte". Toggle `firma_studio_attiva` + textarea `firma_studio_testo` (max 500 char). Applicata da `ComunicazioneController::applicaFirmaStudio()` solo lato `studio`, idempotente (no duplicazione). Non si applica alle note interne.                                                                                                                                                                                                                                                                  |
| Attivare l'auto-chiusura dei ticket abbandonati dal cliente            | `/admin/impostazioni?sez=workflow` → "Auto-chiusura comunicazioni inattive". Imposta giorni di soglia (`com_auto_close_giorni`, 0=off). Cron `bin/cron-com-auto-close.php` ogni 6h chiude i thread dove l'ultimo messaggio è del cliente da più di N giorni, con `auto_chiusa_motivo='inattivo_<N>gg'` + nota interna automatica. CLI: `--dry-run`, `--tenant=slug`, `-v`.                                                                                                                                                                                                      |
| Attivare i promemoria email automatici per le scadenze                 | `/admin/impostazioni?sez=workflow` → "Promemoria email scadenze". Toggle `scadenze_memo_attivo`. Cron `bin/cron-scadenze-memo.php` daily 08:00 invia email a 7gg e 1gg dalla scadenza, riusando gli eventi `scadenza_memo_7gg`/`scadenza_memo_1gg` (configurabili in `/admin/notifiche`). Idempotente via tabella `scadenze_memo_inviati`. Per testare un singolo tenant: `php bin/cron-scadenze-memo.php --tenant=slug --dry-run -v`.                                                                                                                                          |
