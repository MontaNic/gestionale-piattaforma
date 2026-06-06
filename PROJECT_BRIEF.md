# PROJECT BRIEF — Piattaforma Gestionale Ristorazione

> **Documento di riferimento del progetto.** Tutti gli agenti AI (Claude Code, Cursor, ecc.) e gli sviluppatori umani devono leggere questo file PRIMA di scrivere o modificare qualsiasi parte del codice. È la "fonte unica di verità" per scope, architettura, fasi, decisioni tecniche e criteri di accettazione.

> **⚠️ Scope ridefinito da ADR-0025 (2026-06-01):** da gestionale ristorazione a **piattaforma a verticali con core condiviso**. La ristorazione è ora lo starter/boilerplate; primo verticale reale = commercialisti. Leggere l'ADR prima di questo brief.

---

## 0. Come usare questo documento

- È diviso in **3 macro-sezioni**: (A) Visione e architettura generale, (B) Specifiche funzionali per modulo, (C) Standard tecnici e di qualità.
- Ogni feature è etichettata con la sua **fase** di rilascio:
  - `[F1]` (MVP/lancio)
  - `[F2]` (seconda fase)
  - `[F3]` (terza fase)
  - `[PRE]` (predisposto in F1 — struttura dati e API pronti — feature disattivata via feature flag)
  - `[BACKLOG]` (considerata e scartata da F1-F3, ripresa solo se appare un caso d'uso reale)
- Quando in dubbio: privilegia **architettura modulare e dati ben strutturati** anche per le feature `[PRE]`. È sempre più costoso ristrutturare dopo che progettare bene da subito.
- **Disciplina sul focus**: il brief è stato volutamente ripulito da feature di nicchia o premature. Vedi sezione **F. Decisioni di scope (cosa NON facciamo e perché)** alla fine.
- **Lingua di sviluppo**: codice e commit in inglese, UI in italiano (con i18n predisposta per altre lingue).

---

# A. VISIONE E ARCHITETTURA GENERALE

## A1. Cosa stiamo costruendo

Una **piattaforma SaaS modulare multi-tenant, AI-native ed estensibile**, organizzata in **verticali su un core tecnico condiviso** (ADR-0025). Il dominio **ristorazione** è il primo banco di prova ed è ora lo **starter/boilerplate** da cui si estrae il core; il **primo verticale reale** sviluppato sulla base condivisa sarà quello per **studi commercialisti / consulenti del lavoro**.

Funzionalità chiave: mappa tavoli, comande, KDS, cassa, asporto, delivery proprio, sito vetrina, prenotazioni online, fidelity, marketing, magazzino, food cost, gestione personale, dashboard direzione con AI Assistant integrato.

La piattaforma è progettata fin dall'inizio come **ecosistema estensibile** (API pubbliche stabili, webhook system, plugin loader interno) e **AI-first** (assistente Claude integrato, AI insights, generazione contenuti).

**Nota:** un eventuale futuro modulo retail (non previsto in roadmap) si svilupperà come **applicazione separata** che riusa solo i singleton condivisi (utenti, anagrafica clienti, fidelity, fatturazione). Vedi **F. Decisioni di scope**.

### Utenti principali (lato gestionale)

- **Super Admin** (gestione tecnica piattaforma)
- **Admin sede** (configurazione singola sede)
- **Direzione** (gestione operativa e strategica)
- **Cassiere/Operatore** (cassa + supervisione comande, dispositivo principale: tablet)
- **Cameriere** (presa comande, dispositivo principale: smartphone)
- **Cucina/Bar** (visualizzazione comande su KDS)

### Utenti lato pubblico

- **Cliente finale** (sito vetrina, prenotazione tavolo, ordine asporto/delivery, fidelity, app cliente PWA)

## A2. Principi architetturali non negoziabili

1. **Multi-tenant strict**: ogni record isolato per `tenant_id`. Row Level Security PostgreSQL + filtro middleware applicativo.
2. **Multi-sede**: gerarchia `Tenant → Sede → Operatività`. Dati globali (clienti, fidelity, fornitori, ricette base) condivisi a livello tenant; dati operativi (cassa, turni, magazzino fisico, prenotazioni) per sede.
3. **Modulare con feature flag**: ogni feature attivabile/disattivabile a runtime per tenant e sede.
4. **Estensibile via API e plugin interni**: API pubbliche stabili + webhook system + plugin loader interno dal giorno 1 (B11). Marketplace pubblico aperto a terzi: **scartato da roadmap** (vedi sezione F).
5. **AI-native**: integrazione AI come prima cittadina, non add-on (B12).
6. **Offline-first** per operatività cucina/sala + **disaster mode** per failover completo locale (B16).
7. **Real-time**: WebSocket per sync mappa tavoli, KDS, ordini live, notifiche.
8. **Audit log**: ogni azione sensibile loggata con chi/quando/cosa/da-dove (incluse azioni AI e plugin).
9. **API-first**: backend espone REST documentate (OpenAPI/Swagger). Frontend è uno dei consumatori.
10. **Security by default**: HTTPS, argon2, JWT con rotation, rate limiting, ORM parametrizzato, secrets in `.env`.
11. **Fiscalità delegata**: il software NON è un registratore fiscale. Driver pluggable per RT esterni.
12. **Scalabilità target medio**: 5-30 sedi, ~300 utenti concorrenti totali. Scalabile oltre senza riscrivere.
13. **Observability dal giorno 1**: status page interno + audit log + monitoring (B19).

## A3. Stack tecnico (vincolante)

| Layer | Tecnologia |
|---|---|
| Frontend | Next.js 14+ (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| State / Data | TanStack Query + Zustand |
| UI specializzata | dnd-kit (drag&drop), Konva.js (editor mappa), Recharts/Tremor (grafici), cmdk (command palette) |
| Backend | NestJS (Node.js) + TypeScript |
| ORM | Prisma |
| Database | PostgreSQL 16+ |
| Cache / Queue / Pub-Sub | Redis 7+ |
| Real-time | Socket.io |
| Storage file | MinIO (S3-compatible self-hosted) |
| Search | MeiliSearch |
| Reverse Proxy + SSL | Caddy (Let's Encrypt automatico) |
| Container | Docker + Docker Compose v2 |
| OS server | Ubuntu 22.04 LTS |
| i18n | i18next (FE) + nestjs-i18n (BE), IT + EN attivi in F1 |
| Feature Flags | Unleash self-hosted |
| AI Integration | Anthropic Claude API (via `packages/ai-tools`) |
| Onboarding/Tour | Driver.js o Shepherd.js |
| Testing | Vitest (FE) + Jest (BE) + Playwright (E2E) |
| CI/CD | GitHub Actions |
| Monitoring | Uptime Kuma (F1), Grafana + Prometheus + Loki (F2) |

## A4. Struttura del progetto (monorepo)

```
/
├── apps/
│   ├── web/                  # Next.js (gestionale + sito vetrina + app cliente PWA)
│   ├── api/                  # NestJS backend
│   └── kds/                  # Kitchen Display System (PWA dedicata)
├── packages/
│   ├── ui/                   # design system condiviso (shadcn customizzato)
│   ├── shared/               # tipi TypeScript, validatori Zod, utility
│   ├── fiscal-drivers/       # driver registratori telematici (Epson, Custom, RCH…)
│   ├── plugin-sdk/           # SDK per sviluppo plugin interni / partner selezionati
│   ├── ai-tools/             # function calling tools per AI Assistant
│   └── eslint-config/        # config condivisa
├── plugins/                  # plugin ufficiali sviluppati internamente
│   └── (es. fatture-in-cloud, thefork, mailchimp, ...)
├── infra/
│   ├── docker/               # Dockerfile per ogni app
│   ├── compose/              # docker-compose.yml (dev, staging, prod)
│   └── caddy/                # configurazione reverse proxy
├── docs/
│   ├── architecture/         # ADR e schemi
│   ├── api/                  # documentazione API
│   ├── plugin-development/   # guida sviluppatori plugin (interni + partner)
│   ├── ai-prompts/           # system prompt e tool defs AI (versionati)
│   └── user-manual/          # manuale utente
├── PROJECT_BRIEF.md          # questo file
├── ROADMAP.md                # fasi F1/F2/F3 dettagliate
└── README.md                 # quickstart sviluppatore
```

Tooling: **pnpm workspaces** + **Turborepo**.

## A5. Fasi di rilascio (overview)

> **Nota (ADR-0025):** la roadmap funzionale qui sotto (mappa tavoli, KDS, cassa, magazzino…) descrive il **dominio ristorazione**, ora **congelato allo stato di scaffold**: serve come riferimento del boilerplate, non come lavoro attivo. Le fasi realmente attive ora sono: (1) **estrazione del core tecnico** nei `packages/` condivisi, (2) avvio del **verticale commercialisti**. La roadmap ristorazione resta come materiale di riferimento.

### FASE 1 (MVP — lancio)

**Core operativo:**
- Utenti, ruoli, RBAC, audit log
- Mappa tavoli con editor drag&drop e versionamento layout
- Menu/listini multipli/comande offline-first
- Cassa + 1 driver RT (Epson) + fattura elettronica via API
- KDS + stampa termica
- Sito vetrina + prenotazioni online + ordini asporto online
- App driver delivery proprio (PWA)
- Dashboard widget + report standard + briefing mattutino automatico
- Gestione turni base + timbrature + costo lavoro live
- Magazzino base + ricette + scarico automatico + food cost
- Feature flag, i18n IT+EN

**Estensibilità, AI, UX (architettura + base):**
- API pubbliche v1 documentate (OpenAPI)
- Webhook system attivo
- Plugin loader architetturale per plugin interni `[PRE]`
- AI Assistant Claude base: query dati linguaggio naturale, generazione descrizioni menu, AI Insight widget
- Onboarding interattivo base (tour primo login per ruolo, checklist setup)
- **Centro notifiche unificato base** (B17)
- **Status page interno** (B19)
- **Disaster mode architettura** `[PRE]` (B16)

### FASE 2

**Operativo avanzato:**
- Fidelity attiva
- DEM email + SMS
- Pagamenti online Stripe (incluso pagamento al tavolo via QR)
- Delivery proprio con tracking real-time + mappa
- Integrazione middleware Deliverect
- HACCP attivo
- Report builder + anomaly detection
- Ordini fornitori intelligenti
- 2° driver RT
- Mance integrate con turni
- Integrazione software paghe esterno

**Esperienza, qualità operativa, differenziazione:**
- AI Assistant avanzato (analisi pattern, suggerimenti, risposta recensioni, generazione campagne, menu degustazione)
- **Gamification dipendenti** (leaderboard, badge, obiettivi, bonus)
- **Dynamic pricing**: happy hour automatico + anti-spreco articoli a scadenza + bundle + promo flash
- **CO2 per piatto** (calcolo + etichetta menu pubblico + tag Low impact / Local sourcing)
- **Onboarding completo** (video tutorial in-app, knowledge base cercabile)
- **Plugin SDK** pubblico per partner selezionati (non marketplace pubblico)
- **Plugin ufficiali F2**: Fatture in Cloud, Mailchimp, TheFork, Trustpilot, Make/Zapier, Zucchetti, Deliverect
- **Disaster mode attivo** (B16)
- **Chiamata cameriere dal tavolo** (B18)
- **Escalation notifiche** (B17 avanzato)
- **Versionamento configurazioni** (menu, listini, ricette) (B20)
- **Sandbox/Demo/Training mode** (B21)
- **Cmd+K command palette** (B22)
- **Centro note interne / passaggio consegne** (B24)
- **App cliente PWA completa** (B25)

### FASE 3

**Espansione e innovazione:**
- OCR fatture fornitori
- WhatsApp Business attivo
- A/B test campagne
- **Carta prepagata / wallet credito cliente** (B23)
- **Cluster comportamentali AI** con personalizzazione campagne
- **Forecast incassi AI** con confidence interval
- **Chatbot prenotazioni multicanale** (WhatsApp + Instagram + sito + Telegram) `[PRE in F1]` come endpoint agent
- **Integrazioni dirette piattaforme delivery** (Glovo/Deliveroo se necessario oltre Deliverect)
- **Status page pubblica** opzionale per tenant

`[PRE]` = strutture dati, API e moduli base esistono in F1 ma sono inattivi (feature flag), pronti per attivazione senza refactoring.

`[BACKLOG]` = features considerate e scartate dalla roadmap F1-F3. Vedi sezione **F. Decisioni di scope** per dettagli.

---

# B. SPECIFICHE FUNZIONALI PER MODULO

## B1. Autenticazione, ruoli, permessi `[F1]`

### Ruoli predefiniti

| Ruolo | Dispositivo | Cosa fa | Cosa NON vede |
|---|---|---|---|
| Super Admin | Web desktop | Tenant, sedi, moduli, integrazioni, backup, utenti high-level | — |
| Admin sede | Web desktop | Configurazione sede: mappa, menu, stampanti, ruoli locali, plugin installati | Dati altre sedi, config tenant |
| Direzione | Desktop + tablet | Report, fatturato, margini, menu/prezzi, turni, chiusura, anagrafica clienti, AI Assistant | Config tecnica sistema |
| Cassiere/Operatore | Tablet | Tavoli, cassa, incassi, asporto, comande di tutti | Report fatturato, costi, margini |
| Cameriere | Smartphone | Comande proprie, mappa tavoli, invio cucina, **gamification dashboard personale [F2]** | Incassi, totali, dati altri camerieri |
| Cucina/Bar | KDS + web read-only | Comande in arrivo, cambio stato | Tutto il resto |

### Sistema RBAC granulare

- I ruoli sono **collezioni di permessi atomici** namespaced (`comande.crea`, `report.fatturato.visualizza`, `menu.prezzi.modifica`, `cassa.storno.esegui`, `ai.assistant.usa`, `plugin.installa`, ecc.).
- Admin sede può creare ruoli custom mixando permessi.

### Autenticazione

- Email + password con argon2 + JWT (access 15min + refresh 7d con rotation).
- **2FA** TOTP `[PRE]` in F1, `[F2]` attivo.
- **Login rapido con PIN** 4-6 cifre per operatori da tablet/smartphone (PIN hashed, sessione legata a dispositivo).
- **Badge NFC/QR** `[PRE]` (campo dati pronto, lettore non implementato in F1).
- Sessioni separate per dispositivo.
- Auto-logout per inattività configurabile.

### Audit log

- Tabella `audit_log` con: `id, tenant_id, sede_id, user_id, device_id, action, entity_type, entity_id, before_value, after_value, ip, user_agent, timestamp`.
- Loggare almeno: login/logout, storni, sconti, modifiche conti già emessi, modifiche prezzi/menu, eliminazione record, cambi permessi, **azioni eseguite via AI Assistant**, **installazione/disinstallazione plugin**, **modifiche pricing rules**, **rollback configurazioni**.
- Visibile a direzione e admin con filtri e ricerca.

### Modalità manager override `[F2]` `[PRE in F1]`
Cameriere/cassiere richiede autorizzazione per azione bloccata; direzione digita PIN; azione eseguita e loggata con doppio nome.

### Scadenza account `[F2]` `[PRE in F1]`
Campo `valid_until` su user; account stagionali si disattivano automaticamente.

### Geofencing `[F2]` `[PRE in F1]`
Login operatore solo da IP/posizione approvati.

## B2. Mappa tavoli e gestione sale `[F1]`

### Editor visuale drag & drop

- Accessibile a admin e direzione.
- Canvas con griglia, snap-to-grid configurabile.
- Aggiunta tavoli: forma (tondo/quadrato/rettangolare), dimensioni, posizione X/Y, rotazione, coperti, etichetta.
- Aggiunta aree (sala interna, dehor, sala privata, banco) con nome, colore, immagine sfondo opzionale.
- Salvataggio per sede + **versionamento layout** con rollback (parte del sistema unificato di versioning configurazioni, B20).

### Aree attivabili

- Flag `attiva` per area.
- Regole orarie opzionali (es. "Dehor solo dopo 18:30").
- Regole stagionali (es. "Dehor attivo 01/04 - 30/09").
- Aree non attive non visibili in vista operativa.

### Tipi di tavolo (6)

1. Tavolo singolo numerato
2. Banco/Bancone (conti rapidi singoli)
3. Tavolo unibile (5+6, conto unico o split)
4. Tavolo volante/asporto (no posizione fisica, identificato da nome o numero progressivo)
5. Tavolo prenotabile online (collegato a sito vetrina)
6. Postazione take-away al banco (numero ordine, display chiamata)

### Stati tavolo (7) con colori distinti

1. Libero — verde
2. Occupato — blu
3. Conto richiesto — arancione
4. Pagato, da pulire — viola
5. Prenotato — giallo
6. In attesa — azzurro tratteggiato
7. Bloccato/fuori servizio — grigio

Colori configurabili da admin (CSS variables).

### Vista operativa

- Vista grafica (canvas) per tablet e desktop.
- **Vista compatta a lista** per smartphone (cameriere): tavoli per area, ordinati per stato/urgenza.
- Real-time sync via WebSocket.

## B3. Menu, articoli, comande, cucina `[F1]`

### Struttura menu (3 livelli)

```
Menu (es. "Pranzo", "Cena", "Estivo Dehor")
└── Categorie (Antipasti, Primi, Pizze…)
    └── Articoli (con varianti/modificatori)
```

Più menu attivi, scelti per canale/fascia oraria/sede.

### Caratteristiche articolo

- Nome, descrizione breve, descrizione estesa (**generabili con AI**, B12)
- Foto (auto-ottimizzazione WebP, multi-risoluzione)
- Prezzo base + prezzi per listino
- IVA per articolo (4/10/22)
- Allergeni (lista standard UE)
- Tag dietetici (vegano, vegetariano, gluten-free, piccante)
- **Punteggio CO2** (kg CO2 eq.) calcolato da ricetta + DB CO2 `[F2]`
- Tempo preparazione stimato
- Reparto stampa (cucina/pizzeria/bar)
- Ingredienti collegati (food cost + scarico)
- Disponibilità (in carta / esaurito / sospeso)
- Ordine visualizzazione (drag & drop)
- Visibilità per canale (cassa, menu online, asporto, delivery)
- **Pricing rules** collegabili per dynamic pricing (B10)

### Listini multipli

Stesso articolo, prezzi diversi per: canale, fascia oraria, giorno settimana, sede.

### Comande — flusso cameriere (smartphone)

1. Tap su tavolo → apertura
2. Selezione coperti
3. Sfoglia menu con icone grandi + ricerca veloce
4. Tap articolo → aggiunta con varianti/note
5. Invio per portate (antipasti, primi, secondi…)
6. Tap "Invia" → stampa cucina/bar/pizzeria + comparsa KDS
7. Comanda inviata = non modificabile senza autorizzazione (storno con motivo, loggato)

### Funzionalità chiave comande

- **Modalità offline** (IndexedDB) + sync alla riconnessione
- **Real-time sync** WebSocket
- **Note libere** per articolo
- **Conto divisibile**: alla romana, per articolo, per persona (drag & drop articoli su "persone")
- **Trasferimento tavolo**: sposta conto da X a Y
- **Articoli al peso/consumo** (kg, bottiglia aperta)
- **Coperto automatico** configurabile per area/canale
- **Sconti**: per articolo o conto, %, importo fisso, motivazione obbligatoria

### KDS (Kitchen Display System)

- App web dedicata, touch-friendly.
- Monitor verticale/orizzontale configurabile per reparto.
- Comanda mostra: tavolo, cameriere, orario, articoli con note, tempo trascorso.
- Cambio colore automatico per soglie tempo (verde → giallo → rosso).
- Tap articolo: in preparazione → pronto.
- Tap comanda completa: servita → sparisce + notifica al cameriere.
- Storico ultime N comande richiamabile.

### Stampa termica come fallback/alternativa

- Configurabile per reparto.
- Layout personalizzabile.
- Doppia stampa per articoli a due reparti.
- Supporto stampanti ESC/POS via rete (Epson, Star, ecc.).

## B4. Pagamenti, cassa, fiscalità `[F1]`

### Architettura fiscale

- Software **NON** sistema fiscale certificato.
- Modulo "Fiscalizzatore" con **driver pluggable** per Registratori Telematici esterni.
- F1: driver **Epson FP**. Altri `[PRE]`.
- Driver implementa interfaccia comune: `emitReceipt`, `voidReceipt`, `getZReport`, `getCorrispettivi`, ecc.
- Fattura elettronica via **provider API esterno** (Aruba/Fatture in Cloud/Register.it) — può essere plugin interno.

### Cassa tablet-first

- Apertura cassa con fondo iniziale.
- Chiusura cassa con confronto incassi attesi vs reali, ammanchi/eccedenze con note.
- Tasti rapidi: Contanti, Carta, Bancomat, Buoni Pasto, Satispay, App.
- Pagamento misto (parte cash + parte carta).
- **Pagamento con wallet/credito cliente prepagato** `[F3]` `[PRE in F1]` (B23).
- Resto automatico con suggerimento taglio.
- Divisione conto.
- Storno scontrino entro giornata fiscale (motivazione, log).
- Reso/rimborso post-chiusura → nota di credito via RT.

### Integrazione POS bancario

- **F1**: importo inserito manualmente dopo conferma POS fisico separato.
- **F2**: driver POS (Nexi SmartPOS, SumUp, Stripe Terminal, Worldline) via Bluetooth/Ethernet.

### Buoni pasto digitali

- F1: campo nel pagamento, gestione manuale.
- F2: integrazione almeno Edenred e Pellegrini (API).

### Documenti

| Doc | Emesso da | Quando |
|---|---|---|
| Preconto | Stampante termica software | Cliente chiede il conto |
| Documento Commerciale | Registratore Telematico | Pagamento |
| Fattura elettronica | Provider API esterno | Su richiesta |
| Ricevuta di cortesia | Stampante termica software | Su richiesta |
| Bolla asporto/delivery | Stampante termica software | Preparazione |

## B5. Magazzino, ricette, food cost, fornitori `[F1]`

### Magazzino — Livello 1: materie prime

- Anagrafica: nome, UoM (kg/l/pz/conf), categoria, fornitore preferito
- Giacenza, soglia minima, soglia ottimale
- Prezzo medio acquisto (calcolato su carichi pesati)
- Lotto + scadenza (per HACCP)
- Locazione (cella, dispensa, freezer)
- **Punteggio CO2 per kg** (per calcolo CO2 piatti, B14)
- **Flag "produttore locale"** (km da sede, per tag "Local sourcing")

### Magazzino — Livello 2: ricette

- Ogni articolo menu ha ricetta (BOM): N ingredienti × quantità.
- Varianti modificano ricetta (sostituzioni).
- Vendita articolo → scarico automatico ingredienti.
- Storico ricette versionato (parte di B20 versionamento configurazioni).

### Movimenti magazzino

- Carico (acquisto, con bolla/fattura collegata)
- Scarico automatico (vendita)
- Scarico manuale (consumo personale, omaggio, scarto, danneggiato) **con causale obbligatoria**
- Inventario fisico (conta reale, sistema calcola differenze)
- Trasferimento tra sedi

### Alert automatici

- Sottoscorta
- Scadenza imminente (default 3 giorni, configurabile)
- Anomalie consumo (scarico molto > venduto)
- **Articoli a scadenza imminente → dynamic pricing automatico** (B10)

### Food cost e marginalità

- Costo piatto = somma costi ingredienti × giacenze pesate
- Margine = prezzo vendita - costo - IVA
- Food cost % = (costo / prezzo netto) × 100
- Dashboard articoli alto/basso margine
- Alert se margine sotto soglia configurabile

### Fornitori

- Anagrafica: ragione sociale, P.IVA, contatti, giorni consegna, condizioni pagamento, sedi consegna
- Listini fornitore con storico variazioni
- Ordini fornitore (manuali in F1, suggeriti in F2 con AI)
- Invio ordine via email/PEC (PDF formattato)
- Ricezione bolla/fattura → carico magazzino con verifica scostamenti

### HACCP `[PRE in F1]` `[F2]` attivo
Struttura dati pronta (lotti, scadenze, temperature). Modulo registri/schede in F2.

## B6. Clienti, prenotazioni, fidelity, marketing

### Anagrafica clienti `[F1]` — condivisa tenant-wide

- Dati base + indirizzi multipli + preferenze + allergie + note staff + storico
- Consensi GDPR separati con data e fonte (trattamento, newsletter, profilazione, SMS)
- Registrazione: auto da sito, da cassa/cameriere, import CSV, auto-creazione da ordine online

### Prenotazioni tavoli `[F1]`

- Calendario per sede (giorno/settimana)
- Prenotazione manuale o da sito vetrina pubblico
- Conferma automatica via email
- Promemoria SMS/email 24h prima `[PRE]` → `[F2]`
- Capienza intelligente (turnover medio, slot)
- Lista d'attesa, overbooking controllato, blacklist no-show
- Deposito/caparra online `[PRE]` → `[F2]` con Stripe
- Annullamento self-service via link

### Chatbot prenotazioni multicanale `[F3]` `[PRE in F1]` come endpoint API agent

- Bot AI risponde 24/7 su WhatsApp Business, Instagram DM, chat sito, Telegram.
- Prende prenotazioni con verifica disponibilità real-time.
- Risponde a FAQ.
- Inoltra a umano se domanda fuori scope, con notifica direzione.
- Multilingua automatico.
- Implementazione: Claude API con function calling; canali via webhook (Twilio per WhatsApp, Meta Graph API per Instagram).
- `[PRE in F1]`: endpoint API "agent" pronto, canali sociali abilitabili in F3.

### Fidelity `[PRE in F1]` `[F2]` attiva

- Card digitale (QR/email/telefono) o tessera fisica con barcode
- Regole punti configurabili (X punti per €1, bonus per occasioni)
- Premi configurabili (sconto fisso/%, articolo omaggio, esperienza)
- Livelli/tier (Bronze/Silver/Gold) con benefit progressivi
- Scadenza punti configurabile

### DEM e marketing `[PRE in F1]` `[F2]` attivo

- Email via Brevo / SendGrid / Amazon SES (configurabile via plugin interno)
- SMS via Skebby / MessageBird / Twilio (configurabile via plugin)
- WhatsApp Business `[F3]` (vedi chatbot)
- Push PWA `[F2]`
- Campagne broadcast + automatiche (welcome, compleanno, anniversario, "ti manchiamo", post-visita)
- Editor drag&drop con template e variabili
- **Generazione contenuti AI**: pulsante "Scrivi con AI" propone testi accattivanti basati su tipo campagna e tono di voce locale (B12)
- Segmenti dinamici (per spesa, frequenza, preferenze, sede, età)
- Compliance GDPR: doppio opt-in, link disiscrivi, cancellazione dati

## B7. Asporto, delivery, sito vetrina, menu online

### Sito vetrina `[F1]`

- Homepage, Chi siamo, Menu pubblico (sync con gestionale, con etichetta CO2 e badge "local sourcing" `[F2]`), Prenota, Ordina online, Galleria, Contatti+mappa+orari, Eventi/Promo, Blog `[F2]`
- Mobile-first responsive, SEO ottimizzato (Schema.org Restaurant), multi-lingua IT+EN
- Performance < 2s, immagini auto-ottimizzate WebP
- CMS interno per direzione
- Multi-sede: pagina dedicata per sede con SEO locale
- Tema personalizzabile per tenant (palette, font, logo, favicon)
- Dominio custom o sottodominio piattaforma

### Ordini online (asporto + delivery proprio) `[F1]`

- Flusso cliente: scelta sede + canale → menu → carrello → checkout → indirizzo (delivery) → slot → note → pagamento (online o alla consegna) → conferma email+SMS
- Tracking ordine `[PRE]` → `[F2]`
- Gestionale: notifica sonora + popup (parte di B17 centro notifiche), conferma manuale, rifiuto con rimborso automatico se prepagato, stampa cucina + bolla, stati lifecycle completi
- Aree copertura delivery (poligoni su mappa) con costo variabile per zona
- Orari ordini separati da orari locale
- Soglia minima ordine, costo consegna fisso/variabile/gratis sopra X
- Slot con limite ordini, pausa ordini rapida
- Tempo preparazione dinamico
- **Dynamic pricing yield management** `[F3]`: prezzi delivery variabili per fascia di domanda con tetti configurabili (B10)

### App driver delivery proprio `[F1]`

- PWA su smartphone, login con PIN
- Lista consegne con ordine ottimizzato
- Mappa + link Google Maps/Waze
- Dati cliente, importo da incassare (contrassegno)
- Stati: ritirato → in consegna → consegnato (con foto/firma opzionale)
- Notifica cliente quando driver parte
- Vista mappa real-time per gestionale `[PRE]` → `[F2]`
- Statistiche per driver

### Piattaforme delivery terze `[PRE in F1]` `[F2]` attivo

- **Strada scelta: middleware Deliverect**
- Ordini da piattaforme entrano nel gestionale come ordini interni
- Menu sincronizzato (modifica prezzo → aggiornamento automatico)
- Disponibilità sincronizzata, statistiche unificate
- F3: integrazioni dirette per piattaforme prioritarie se necessario

### QR menu al tavolo `[F1]`

- QR univoco per tavolo
- Cliente vede menu aggiornato real-time, foto, allergeni, prezzi, **etichetta CO2 `[F2]`**
- F1: solo consultazione
- F2: ordine al tavolo (arriva a cameriere/cassa per conferma)
- Multi-lingua selezionabile

## B8. Dashboard, report, gestione personale

### Dashboard direzione `[F1]` con widget drag & drop

- Layout a griglia personalizzabile per utente
- Selettore periodo + confronto periodo precedente
- Filtro per sede
- Real-time via WebSocket
- **Chat AI Assistant laterale** (B12): pannello apribile per query naturali sui dati
- **Cmd+K command palette** `[F2]` (B22)

**Widget F1:**
- Incasso live (oggi vs ieri vs stesso giorno settimana scorsa)
- Coperti + scontrino medio
- Tavoli occupazione live
- Comande in cucina (attive, tempo medio)
- Top venditori del giorno
- Performance camerieri
- Split pagamenti
- Ordini online (in arrivo, preparazione, consegna)
- Prenotazioni (prossime, oggi, settimana)
- Alert (sottoscorta, scadenze, anomalie)
- **AI Insight del giorno** (consiglio AI proattivo basato su dati recenti)
- **Centro notifiche** (B17)
- **Status sistema** sintetico (B19)

**Widget F2:**
- Meteo + correlazione affluenza
- Confronto sedi
- **Gamification leaderboard** (top camerieri)
- **CO2 footprint del menu** (media kg CO2/scontrino vs target)

### Report `[F1]` standard preconfigurati

Vendite per giorno/settimana/mese/anno, per categoria/articolo/cameriere/sede, per fascia oraria (heatmap), per canale; articoli mai venduti; top/flop con trend; tempo medio servizio; tempo preparazione; coperti per turno; tavoli per cameriere; no-show rate; sprechi con causali; cassa giornaliera; riconciliazione; food cost reale vs target; margine per piatto/categoria; nuovi vs ricorrenti; frequenza media; spesa media; CLV; redemption fidelity; rotazione magazzino; turnover articoli stagnanti; variazioni prezzi fornitori.

Export PDF (con logo) + Excel/CSV + stampa.

### Report builder `[F2]`

- Costruzione custom (metriche, dimensioni, filtri, grafico)
- Template salvabili
- Invio schedulato email
- **Generazione report da prompt AI**: _"Crea un report sui dolci venduti negli ultimi 3 mesi raggruppati per fascia oraria"_ → report pre-compilato

### Aggiunte intelligenti

- **Confronti intelligenti** `[F1]`: oltre a "ieri", anche "stesso giorno anno scorso" + "media ultimi 4 stesso-giorno-settimana"
- **Forecast incassi AI** `[F3]` `[PRE]`
- **Anomaly detection** `[F2]`: alert se metriche fuori pattern
- **Briefing mattutino automatico** `[F1]`: email ore 9 con incasso ieri, top/flop, prenotazioni, alert, turni, **suggerimento AI del giorno** `[F2]`
- **Mobile report** `[F1]`: dashboard ottimizzata smartphone per direzione in mobilità
- **Mance integrate con turni** `[F2]`: divisione automatica per regole configurabili

### Gestione personale `[F1]`

- Anagrafica dipendenti (dati, ruolo, sede, contratto, costo orario, disponibilità, competenze)
- Pianificazione turni drag & drop (giorno/settimana/mese)
- Notifica turno via email/SMS (via centro notifiche, B17)
- Richiesta cambio turno tra colleghi (con approvazione)
- Richiesta ferie/permessi con workflow
- Suggerimento turni automatico `[F2]` `[PRE]`

### Gamification dipendenti `[F2]` `[PRE in F1]`

- Leaderboard mensile camerieri con metriche configurabili (scontrino medio, upsell %, recensioni positive, velocità servizio).
- Badge sbloccabili (es. "100 tavoli serviti", "Re del weekend", "Champion upsell", "Zero errori del mese").
- Obiettivi personali e di team configurabili da direzione, con bonus economici opzionali.
- Notifiche motivazionali (via centro notifiche).
- Dashboard personale dipendente accessibile da smartphone.
- **Opt-in per sede**: la direzione sceglie se attivare.
- Schema dati `[PRE in F1]`: tabelle `employee_stats`, `badges`, `objectives`, `leaderboards`.

### Timbrature `[F1]`

- Login al sistema = timbratura automatica
- Alternativa: badge NFC/QR/PIN su tablet "timbratore"
- Geolocalizzazione `[PRE]` → `[F2]`
- Calcolo ore + straordinari
- Export per buste paga

### Costo lavoro `[F1]`

- Dashboard costo lavoro live vs incasso
- Alert sovradimensionamento

### Integrazione paghe `[F2]`

- Software esterno via API o plugin interno (Zucchetti, TeamSystem, Fluida)
- Niente generazione buste paga interna

## B10. Dynamic Pricing `[F2]` `[PRE in F1]`

Sistema centrale di **regole di pricing dinamico** applicabili agli articoli del menu.

### Tipi di regole

- **Happy hour automatico** `[F2]`: sconto % o prezzo fisso in fasce orarie/giorni configurabili.
- **Anti-spreco a scadenza** `[F2]`: articoli/ingredienti vicino a scadenza → sconto automatico + tag "Last minute" nel menu pubblico.
- **Bundle dinamici** `[F2]`: regole tipo _"se pizza, suggerisci birra scontata"_ — cassiere/cameriere riceve suggerimento upsell.
- **Yield management delivery** `[F3]`: prezzi delivery variabili per fascia di domanda, tetti configurabili, sempre opt-in tenant.
- **Promo flash** `[F2]`: regole temporanee con data inizio/fine, attivazione rapida.

### Trasparenza

- Regole sempre visibili al cliente nel menu pubblico.
- Lista regole attive accessibile a direzione + audit log modifiche.
- Stampa scontrino mostra prezzo originale + sconto + nome regola.

### Schema dati `[PRE in F1]`

- Tabella `pricing_rules`: tipo, condizioni (JSON), azione (JSON), priorità, validità, scope (tenant/sede/canale).
- Engine valutazione regole eseguito su ogni aggiunta articolo a comanda.

## B11. API pubbliche, webhook, plugin interni `[F1 base]` `[F2 SDK partner]`

> Architettura estensibile dal giorno 1, **senza marketplace pubblico**. Vedi sezione F per il razionale della scelta.

### API pubbliche `[F1]`

- REST documentate OpenAPI/Swagger, versionate (`/api/v1`, `/api/v2`...).
- Autenticazione plugin/integrazioni tramite API Key + OAuth2.
- Rate limiting per chiave API.
- Scopes granulari (un'integrazione chiede solo i permessi che le servono).
- Documentazione pubblica con esempi.
- **Vincolo: API marcate "stable v1" non hanno mai breaking changes**.

### Webhook system `[F1]`

- Tenant configura webhook URL su eventi (`order.received`, `payment.completed`, `reservation.created`, `customer.created`, ecc.).
- Retry automatico con exponential backoff.
- Audit log invii/ricezioni.
- Firme HMAC per autenticità.

### Plugin loader interno `[PRE in F1]` → `[F2]` attivo

- Plugin = pacchetto npm con manifest standardizzato (`plugin.json`: nome, versione, scopes, hooks, UI extensions).
- Tipi di plugin:
  - **Integration** (es. "Fatture in Cloud", "TheFork", "Mailchimp"): collega gestionale a SaaS esterni.
  - **Payment driver** (es. "Stripe Terminal", "Nexi Smart"): aggiunge metodo pagamento.
  - **Fiscal driver** (es. driver RT custom).
  - **UI Widget** (es. dashboard widget custom).
  - **Automation** (es. trigger Make/Zapier/n8n).
- **In F1-F2**: plugin tutti sviluppati internamente o da partner selezionati (whitelist).
- **Nessun marketplace pubblico**: niente sandbox isolation, niente revenue share, niente certificazione plugin terzi. Vedi sezione F.

### Plugin SDK per partner `[F2]`

- SDK TypeScript pubblicato su npm (`@piattaforma/plugin-sdk`).
- Tooling: scaffolding CLI, dev mode con hot reload, test framework.
- Documentazione developer in `docs/plugin-development/`.
- **Distribuito solo a partner con accordo commerciale firmato** (non pubblicamente).

### Plugin ufficiali F2 (sviluppati internamente)

- Fatture in Cloud / Aruba Fatturazione (commercialista)
- Mailchimp / Brevo (DEM)
- TheFork (prenotazioni esterne)
- Trustpilot / Google Recensioni
- Make / Zapier / n8n (automazione)
- Zucchetti / TeamSystem (paghe)
- Deliverect (delivery aggregator)

### Schema dati `[PRE in F1]`

- Tabelle `plugins`, `plugin_installations`, `plugin_configurations`, `api_keys`, `webhooks`, `webhook_deliveries`.

## B12. AI Assistant integrato (Claude API) `[F1 base]` `[F2 avanzato]` `[F3 enterprise]`

> Integrazione AI come **prima cittadina** del software, non add-on. Usa Anthropic Claude API tramite package `packages/ai-tools`.

### Visione

L'AI Assistant è un **copilota della direzione**: assistente conversazionale che capisce i dati del locale e può: interrogarli, generare contenuti, suggerire azioni, automatizzare task ripetitivi.

### Architettura

- Package `packages/ai-tools`: function calling tools tipizzati per ogni capability (query dati, scrittura testi, analisi report).
- Backend NestJS espone endpoint `/api/v1/ai/chat` con streaming SSE.
- Frontend: pannello chat laterale apribile dalla dashboard.
- RAG: per query su dati storici lunghi, indice MeiliSearch + chunking.
- Token usage tracciato per tenant in tabella `ai_usage` (limiti mensili configurabili per piano commerciale).
- Audit log su ogni azione eseguita via AI.

### F1 — Base

- **Query dati in linguaggio naturale**: _"Quanto ho fatturato venerdì scorso vs medio dei venerdì?"_, _"Quali piatti hanno margine sotto 60%?"_, _"Mostrami i clienti che non vengono da 3 mesi"_.
- **Generazione descrizioni articoli menu**: pulsante "Scrivi con AI" su scheda articolo → genera descrizione accattivante per sito/delivery basata su nome + ingredienti.
- **AI Insight del giorno**: widget dashboard con consiglio AI proattivo basato su dati recenti.

### F2 — Avanzato

- **Analisi pattern e suggerimenti azione**: _"Hai venduto -30% bevande questa settimana, prova queste 3 promo: ..."_.
- **Risposta recensioni**: bozze AI per rispondere a recensioni Google/Trustpilot con tono configurabile.
- **Generazione campagne DEM**: editor email con pulsante "Scrivi con AI".
- **Generazione menu degustazione**: _"Suggerisci menu degustazione 5 portate sotto €60 con i miei top venditori e ingredienti freschi disponibili"_.
- **Report da prompt**: _"Crea report dolci venduti ultimi 3 mesi raggruppati per fascia oraria"_ → report builder pre-compilato.

### F3 — Enterprise

- **Forecast incassi AI** con confidence interval.
- **Cluster comportamentali clienti** AI con personalizzazione campagne.
- **Chatbot prenotazioni multicanale** (B6) — stesso motore agentico.

### Privacy e sicurezza

- Dati clienti **mai** inviati ad API esterne senza necessità: AI vede dati aggregati o anonimizzati dove possibile.
- PII (nomi, indirizzi, telefoni) mascherata prima dell'invio quando non necessaria.
- Logging completo prompt e risposte in `ai_chat_logs` per audit.
- Opt-in tenant esplicito per attivare AI.
- Configurazione tenant: scegliere "shared key" (token piattaforma) o "BYO key" (chiave API tenant per controllo costi/privacy).

## B14. CO2 e sostenibilità `[F2]` `[PRE in F1]`

> Calcolo automatico impatto ambientale dei piatti, con etichetta menu e dashboard direzione.

### Database CO2 ingredienti

- Tabella `ingredient_co2`: ingrediente, categoria, kg CO2 equivalente per kg prodotto, fonte dato.
- Dataset di partenza: **Agribalyse** (database pubblico francese) + estensioni manuali.
- Aggiornamento periodico dataset versionato.

### Calcolo per piatto

- CO2 piatto = somma (CO2 ingrediente × quantità ricetta) per ogni ingrediente.
- Ricalcolo automatico quando cambia ricetta o database.
- Storico per consistenza dati storici (parte di B20 versionamento).

### UI

- **Menu pubblico sito vetrina e QR menu**: badge "CO2: 1.2 kg eq." con tooltip esplicativo.
- **Tag automatici**: "Low impact" (sotto soglia), "Local sourcing" (se >70% ingredienti da fornitori locali).
- **Dashboard direzione**: widget "CO2 footprint medio scontrino" + trend + suggerimenti AI (_"Sostituendo manzo con lenticchie su 2 piatti riduci 40% CO2 medio"_).

### Compliance

- Predisposto per normativa UE **CSRD**.
- Export report CO2 per consulenze ESG.

## B15. Onboarding interattivo e training in-app `[F1 base]` `[F2 completo]`

> Sistema di tutorial guidati e knowledge base in-app, contestuali per ruolo.

### F1 — Base

- **Tour guidato al primo login** per ruolo (Driver.js o Shepherd.js).
  - Cassiere: tour cassa, comanda, pagamento.
  - Cameriere: tour smartphone, presa comanda, invio cucina.
  - Direzione: tour dashboard, menu, report.
- **Tooltip contestuali** ("?" cliccabile su elementi UI complessi).
- **Checklist setup** per Admin sede al primo accesso (configura sede, mappa, menu, stampanti, utenti).
- **Tracking completamento onboarding** in tabella `user_onboarding`.

### F2 — Completo

- **Video tutorial in-app** (15-30s ciascuno) integrati nei punti chiave.
- **Knowledge base cercabile** in-app (Cmd+K / icona "?" globale, vedi B22).
- **Tutorial guidati per scenari** ("Come gestire un no-show", "Come fare chiusura cassa", "Come creare promo").
- **Suggerimenti contestuali** al primo utilizzo di feature non ancora usata.
- **Report onboarding per direzione**: chi ha completato cosa, chi serve aiuto.

### Architettura

- Tour definiti come JSON config in `apps/restaurant-web/onboarding/`.
- Knowledge base come MDX files versionati in repo.
- Search via MeiliSearch (stesso indice della search globale).

## B16. Disaster Mode / Failover offline completo `[F2]` `[PRE in F1]`

> Se internet o il server centrale sono irraggiungibili, il locale **continua a operare** in modalità degradata.

### Funzionamento

- **Cache locale critica** su ogni tablet cassa: menu, prezzi, ricette base, anagrafica clienti consultati di recente, fidelity card scansionate ultimamente.
- **Cassa funziona offline**: prende pagamenti (cash + carta via POS separato), salva comande, stampa scontrini fiscali via RT (il RT è autonomo).
- **Indicatore "MODALITÀ OFFLINE"** sempre visibile quando attiva, con orario inizio modalità.
- **Al ripristino**: sync automatico con conflict resolution (ordini offline → push al server; eventuali conflitti loggati per review direzione).
- **Tetto temporale di sicurezza**: max 4-8 ore offline (configurabile), poi cassa blocca pagamenti e richiede intervento.

### Architettura `[PRE in F1]`

- IndexedDB strutturato per cache critica (oltre alle comande, vedi C4).
- Service Worker con strategia "stale-while-revalidate" per dati di servizio.
- Endpoint `/api/v1/sync/disaster` per push bulk dati offline.
- Tabella `disaster_events` per audit dei periodi offline.

### F1
Setup architettura (Service Worker, IndexedDB, endpoint sync). Flag spento.

### F2
Modalità attivabile per tenant. Test e documentazione operativa.

## B17. Centro notifiche unificato + escalation `[F1 base]` `[F2 escalation]`

> Hub unico dove arrivano tutte le notifiche operative del locale, con priorità ed escalation automatica.

### F1 — Base

- **Inbox notifiche per ruolo** (cameriere, cassa, cucina, direzione, admin).
- **Tipi**: comanda urgente, ordine online ricevuto, prenotazione in arrivo, alert magazzino, problema pagamento, recensione negativa, anomalia rilevata, stato sistema (B19), notifica AI (B12).
- **Canali**: in-app (sempre), push PWA (opt-in), email (per critiche e digest), SMS (solo per emergenze tenant configurate).
- **Priorità**: info / warning / critical.
- **Bell icon** persistente con counter unread.
- **Audit log**: chi ha visto cosa quando.

### F2 — Escalation policy

- Configurabile per tipo di notifica.
- Esempio: ordine online ignorato → 5min: notifica al cassiere → 10min: notifica direzione → 15min: SMS al titolare.
- Configurabile da admin sede.
- Notifica di "escalation avvenuta" loggata.

### Architettura

- Tabella `notifications` con eventi tipizzati.
- Sistema pub/sub Redis per delivery real-time.
- Cron job per controllo escalation (ogni minuto verifica notifiche scadute).

## B18. Chiamata cameriere dal tavolo `[F2]` `[PRE in F1]`

> Sistema per il cliente di chiamare cameriere/cassiere senza alzare la mano.

### Funzionamento

- Cliente preme bottone fisico Bluetooth ("campanello tavolo") OR scansiona QR sul tavolo → mini web app con bottoni di chiamata.
- **Tipi di chiamata configurabili**: "ho bisogno di un cameriere", "il conto", "acqua/bevande", "errore in cucina", "chiama il manager".
- **Notifica sullo smartphone del cameriere assegnato al tavolo**: vibrazione + visual + suono. Se non gestita entro X minuti → escalation (via B17).
- **Statistiche**: tempo medio di risposta per cameriere/sede, chiamate gestite vs ignorate.

### Architettura `[PRE in F1]`

- Tabella `table_calls`: tavolo, tipo, timestamp_call, timestamp_acknowledged, user_acknowledged.
- Endpoint `/api/v1/tables/:id/call` (pubblico via token tavolo QR).
- Integrazione con centro notifiche (B17).

### F1
Schema dati + endpoint pronti. Disattivato.

### F2
UI bottoni QR + notifiche real-time + statistiche.

## B19. Status Page interna `[F1 base]` `[F2 pubblica opzionale]`

> Pagina che mostra in tempo reale lo stato di tutti i componenti del software.

### F1 — Status page interna

Accessibile a admin sede e direzione. Mostra:

- **Servizi core**: API, DB, cache Redis, MinIO storage, MeiliSearch, Unleash.
- **Hardware locale**: stampanti termiche (ping), KDS, POS bancario (se integrato), RT (registratore telematico).
- **Integrazioni esterne**: Stripe, fattura elettronica, Deliverect, Claude API, provider email/SMS.
- **Per ogni componente**: stato (verde/giallo/rosso), latenza media, ultimo errore, ultimo check.
- **Storico uptime ultimi 30 giorni** per componente.
- **Notifica automatica admin** quando qualcosa si rompe (via centro notifiche B17).

### F2 — Status page pubblica opzionale

Tenant può attivare `status.tuodominio.com` pubblica per i propri clienti finali (vedono se il locale può ricevere ordini online).

### Architettura

- Worker dedicato che esegue health check ogni N secondi.
- Tabella `health_checks` con risultati storici.
- Endpoint `/api/v1/status` (autenticato per interno, opzionalmente pubblico per status page).

## B20. Versionamento configurazioni `[F1 base mappa]` `[F2 esteso]`

> Ogni configurazione importante è versionata con possibilità di rollback.

### F1 — Mappa tavoli (vedi B2)
Già versionata dal giorno 1.

### F2 — Esteso a tutte le configurazioni critiche

- **Menu e listini**: ogni modifica = nuovo snapshot.
- **Ricette**: già versionate per coerenza dati storici (B5).
- **Pricing rules**: snapshot ad ogni modifica.
- **Ruoli e permessi**: snapshot ad ogni modifica.
- **Regole gamification**: snapshot ad ogni modifica.

### Funzionalità

- Ogni snapshot ha: autore, timestamp, commento opzionale.
- **Confronto fra versioni** (diff visuale).
- **Rollback con un click** (es. _"ripristina il menu di mercoledì scorso prima del cambio prezzi"_).
- **Snapshot "pubblicabili"**: menu in bozza vs menu live (modifichi prezzi senza pubblicarli subito).
- **Programmazione**: _"pubblica questo menu lunedì alle 6:00"_.

### Architettura

- Pattern: ogni entità versionata ha tabella `entity_versions` con `entity_id`, `version_number`, `data` (JSON snapshot), `author_id`, `timestamp`, `comment`, `is_published`, `published_at`.
- Per entità con relazioni complesse (es. menu): snapshot serializzato completo del grafo.

## B21. Sandbox / Demo / Training mode `[F2]` `[PRE in F1]`

> Ambiente isolato identico al produttivo ma con dati finti.

### Use case

- **Formazione nuovi assunti**: cameriere nuovo si esercita su comande/cassa senza toccare dati reali.
- **Demo a clienti potenziali**: agente commerciale mostra il software con dati realistici.
- **Test feature nuove**: direzione prova una nuova promo/menu prima di attivarla in prod.

### Funzionamento

- Switch rapido tra "Prod" e "Sandbox" dall'UI (admin/direzione).
- Sandbox auto-reset a fine giornata (configurabile).
- Sandbox NON può:
  - Inviare email/SMS reali
  - Emettere fattura elettronica reale
  - Comunicare con POS bancario o RT reale (modalità "training" o mock)
  - Comunicare con piattaforme delivery reali

### Architettura `[PRE in F1]`

- Schema database con flag `is_sandbox` su tenant (o tenant separato "shadow" con stesso schema).
- Decisione di design da formalizzare in ADR: sandbox-as-tenant-flag vs sandbox-as-separate-tenant.

## B22. Command palette globale (Cmd+K) `[F2]` `[PRE in F1]`

> Barra di ricerca/comando rapida stile Linear/Notion.

### Funzionamento

- Shortcut `Cmd+K` (Mac) / `Ctrl+K` (Win) / icona lente in header.
- **Cerca trasversalmente**: ordini, clienti, articoli, prenotazioni, fornitori, dipendenti, report, pagine settings.
- **Azioni rapide**: _"crea prenotazione tavolo 5 sabato 20:30 4 persone"_, _"vai a report mese"_, _"apri tavolo 12"_, _"chiama AI Assistant"_.
- Suggerimenti contestuali in base al ruolo e cosa stai facendo.
- Risultati raggruppati per categoria.

### Architettura `[PRE in F1]`

- MeiliSearch index globale già presente in F1 (usato per ricerche di sezione e knowledge base onboarding).
- F2: libreria `cmdk` (React) per UI, registry azioni globali.

## B23. Wallet credito cliente / Gift card `[F3]` `[PRE in F1]`

> Cliente carica credito presso il locale, paga successivamente scalando dal wallet.

### Funzionamento

- Cliente carica €X → riceve €Y di credito (Y >= X, eventuale bonus configurabile, es. +10%).
- Paga al ristorante scalando dal wallet.
- Storico ricariche/utilizzi visibili al cliente.
- **Trasferibile come regalo** (gift card digitale) a un altro cliente: invio QR/codice via email o WhatsApp.
- Tessera fisica opzionale con barcode.
- Compatibile e cumulabile con fidelity.

### Architettura `[PRE in F1]`

- Tabelle `wallets` (uno per cliente per tenant), `wallet_movements` (ricariche, utilizzi, regali, scadenze).
- Endpoint pagamento cassa già pronto per accettare metodo "wallet" (UI cassa F1 mostra l'opzione disattivata).
- Integrazione gift card via DEM (B6) per invio.

### Compliance

- **Verifica fiscale obbligatoria** prima di andare in produzione: in Italia il prepagato può essere considerato "buono multiuso" con implicazioni IVA specifiche. Validazione commercialista non opzionale.

## B24. Note interne / Passaggio consegne `[F2]` `[PRE in F1]`

> Registro digitale per appunti di servizio e passaggio di consegne tra turni.

### Funzionamento

- Direzione/cassiere/cameriere lascia note: _"Tavolo 7 abituale: cliente VIP, no glutine"_, _"Domani consegna fornitore alle 9"_, _"Domenica scorsa contestazione cliente XY, attenzione se torna"_.
- **Scope nota**: per turno, per giorno, per dipendente specifico, per tavolo, per cliente (collegata ad anagrafica).
- **Bacheca digitale** visibile al login del turno successivo.
- **Marcabili come "letta"** (audit log).
- Sostituisce post-it sulla cassa che si perdono.

### Architettura `[PRE in F1]`

- Tabella `internal_notes`: scope, target_id, content, author_id, created_at, expires_at, read_by[].
- Integrazione con centro notifiche (B17) per "hai N note da leggere all'inizio turno".

## B25. App cliente PWA completa `[F2]` `[PRE in F1]`

> Vera "app" cliente (PWA installabile) con tutte le funzioni cliente-finale.

### Funzionalità

- Installabile dal browser (icona home come app nativa).
- **Funzioni**:
  - Ordinare asporto/delivery
  - Prenotare tavolo
  - Vedere fidelity/punti, livello tier, premi disponibili
  - Ricevere notifiche push (offerte, conferme ordini, promemoria prenotazioni)
  - Vedere storico ordini con possibilità "riordina"
  - Gestire indirizzi salvati
  - Recensire (post-visita)
  - Condividere referral
  - **Wallet credito** `[F3]` (B23): saldo, ricariche, regali
- Funziona offline per consultazione menu e storico.
- **Una sola PWA per la piattaforma** (oppure white-label per tenant premium): l'utente vede il "suo" locale ma l'app è la stessa codebase.
- **Niente App Store/Play Store** = niente revenue share Apple/Google del 30%, niente review process.

### Architettura `[PRE in F1]`

- Next.js già PWA-ready: aggiungi manifest, service worker, push notification subscription.
- Sezione `/app` o sottodominio dedicato (`app.tuodominio.com`).
- F1: UI base account cliente sul sito vetrina (login, ordini, prenotazioni) — è già il primo step della PWA.
- F2: estensione completa funzionalità + installabilità promossa.

---

# C. STANDARD TECNICI E DI QUALITÀ

## C1. Modello dati — convenzioni vincolanti

- Ogni tabella ha: `id` (uuid v7 per ordinamento naturale), `tenant_id`, `created_at`, `updated_at`, `deleted_at` (soft delete dove sensato)
- Tabelle operative hanno anche: `sede_id`
- Audit log per modifiche sensibili (B1)
- Row Level Security PostgreSQL attiva su tutte le tabelle multi-tenant
- Foreign key sempre con `ON DELETE` esplicito (mai default)
- Indici: su `tenant_id`, `sede_id`, foreign key, colonne ricercate frequentemente
- Migrazioni versionate con Prisma Migrate, **mai modificare migrazioni già applicate**
- **Pattern versioning per entità versionate** (B20): tabella `*_versions` parallela con snapshot JSON

## C2. API design

- REST con risorse pluralizzate (`/tenants/:id/sedi/:id/comande`)
- Versionamento URL (`/api/v1/...`)
- OpenAPI/Swagger autogenerato, esposto su `/api/docs`
- Risposte coerenti: `{ data, meta, error }`
- Paginazione cursor-based per liste lunghe
- Validazione input con Zod / class-validator
- Error handling centralizzato con codici applicativi (`E_TAVOLO_OCCUPATO`, `E_COMANDA_INVIATA`, …)
- Rate limiting (Redis) su API pubbliche
- **API pubbliche stabili e versionate per integrazioni/plugin** (B11): mai breaking changes su API marcate "stable"

## C3. WebSocket / Real-time

- Socket.io con stanze per tenant/sede/dispositivo
- Eventi tipizzati (TypeScript shared types)
- Esempi eventi: `tavolo.stato.changed`, `comanda.inviata`, `comanda.pronta`, `ordine.online.received`, `ai.insight.new`, `notification.new`, `system.status.changed`, `table.call.received`
- Riconciliazione: alla riconnessione, client riceve snapshot e poi diff

## C4. Offline-first per cameriere smartphone + Disaster mode

- IndexedDB locale per comande in corso + cache critica disaster mode (B16)
- Service Worker per shell PWA
- Coda sync alla riconnessione con conflict resolution last-write-wins su comande non inviate; comande inviate sono immutabili
- UI mostra chiaramente stato connessione e queue pendente
- **Disaster mode**: cache estesa configurata in F1 anche se attivazione modalità completa in F2

## C5. Sicurezza

- HTTPS forzato (Caddy auto-redirect 80→443)
- HSTS, CSP, X-Frame-Options, X-Content-Type-Options headers
- argon2id per password
- JWT firmati con chiave robusta + refresh token rotation
- Rate limiting login (max 5 tentativi/15min per IP, lockout temporaneo)
- Logging tentativi falliti
- Backup cifrati con chiave separata
- Secrets in `.env` (mai in repo), `.env.example` versionato
- Dipendenze monitorate (Dependabot/Renovate)
- **PII masking per AI**: dati personali mascherati prima invio API esterne quando non necessari
- **Plugin solo da fonti fidate** (interni + partner whitelisted), no sandbox isolation perché no marketplace pubblico (B11)

## C6. Testing

- Unit test su business logic critica (calcolo conti, food cost, RBAC, regole listini, **dynamic pricing engine**, **AI tools function calling**, **CO2 calculator**, **escalation policy**, **versioning rollback**)
- Integration test su API principali
- E2E Playwright per flussi critici: login, presa comanda, invio cucina, pagamento, ordine online, prenotazione, **AI chat base**, **onboarding tour**, **centro notifiche**, **command palette**
- Coverage target: 60% in F1, 80% in F2 sui moduli critici
- Test isolati con DB di test (Docker)

## C7. CI/CD

- GitHub Actions
- Pipeline: lint → typecheck → unit test → build → E2E (su PR)
- Deploy staging automatico su merge in `develop`
- Deploy produzione manuale su merge in `main` (workflow_dispatch)
- Artifacts Docker image firmati e versionati
- Rollback rapido tramite tag immagini precedenti

## C8. Deployment su Ubuntu 22.04

```bash
# Prerequisiti server
- Docker Engine 24+
- Docker Compose v2
- Caddy (auto-SSL Let's Encrypt)
- UFW (firewall: 22, 80, 443)
- Fail2ban (anti brute-force SSH)
- Cron per backup
```

**Compose con servizi:**
- `web` (Next.js)
- `api` (NestJS)
- `kds` (Next.js dedicata)
- `postgres` con volume persistente
- `redis` con volume persistente
- `minio` con volume persistente
- `meilisearch` con volume persistente
- `unleash` (feature flags)
- `caddy` reverse proxy

**Backup automatici:**
- `pg_dump` notturno + compressione + cifratura GPG
- `rsync` incrementale volumi MinIO
- Retention: 7d daily + 4w weekly + 12m monthly
- Destinazione: secondo disco locale **+** cloud off-site (Backblaze B2 / Wasabi)
- Test restore mensile documentato

**Monitoring F1:**
- Uptime Kuma per disponibilità servizi + notifiche Telegram/email
- **Status page interna** (B19): vista applicativa dello stato sistema

**Monitoring F2:**
- Grafana + Prometheus + Loki (metriche + log)
- **Dashboard token AI usage** per tenant

## C9. Internazionalizzazione

- `i18next` (FE) + `nestjs-i18n` (BE)
- Chiavi namespaced (`common.save`, `comanda.invia`)
- File JSON per lingua in `/locales`
- IT default, EN attivo in F1
- Numero/data/valuta formattati per locale
- Predisposto altre lingue (DE/FR/ES) in F2
- **AI Assistant**: risposte nella lingua dell'utente loggato (automatico via system prompt)

## C10. Feature flags

- Unleash self-hosted (container Docker)
- Flag per tenant, per sede, per ruolo, per percentuale rollout
- Tutto ciò che è `[PRE]` controllato da flag
- Nomenclatura flag: `module.feature.subfeature` (es. `fidelity.points.enabled`, `delivery.tracking.realtime`, `ai.assistant.advanced`, `gamification.leaderboard.enabled`, `pricing.dynamic.happy_hour`, `disaster.mode.enabled`, `notifications.escalation.enabled`, `wallet.customer.enabled`, `command_palette.enabled`)

## C11. Documentazione

- `README.md`: quickstart sviluppatore
- `PROJECT_BRIEF.md`: questo file (mai modificare senza approvazione)
- `ROADMAP.md`: fasi dettagliate con user story e criteri di accettazione
- `docs/architecture/`: ADR per ogni decisione architetturale importante
- `docs/api/`: documentazione API (auto-generata + esempi)
- `docs/plugin-development/`: guida sviluppatori plugin (interni + partner)
- `docs/ai-prompts/`: system prompt e tool definitions per AI Assistant (versionati)
- `docs/user-manual/`: manuale utente (F1 minimal, F2 completo)

## C12. Convenzioni di codice

- ESLint + Prettier obbligatori (CI fallisce su violazioni)
- Husky + lint-staged pre-commit
- Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`)
- Branch: `main`, `develop`, `feature/*`, `fix/*`, `release/*`
- PR template con checklist (test, docs, migrazione DB, breaking changes, **impatto API pubbliche**, **token AI usage**, **impatto feature flag**)
- Code review obbligatoria (anche se sviluppi solo, simula la review)

## C13. Glossario terminologia (ambiguità da evitare)

- **Tenant** = azienda cliente della piattaforma (es. "Pizzerie Mario SRL")
- **Sede** = singolo punto vendita fisico di un tenant
- **Plugin** = estensione installabile (in F1-F2 solo interni o da partner selezionati)
- **Listino** = insieme di prezzi per un canale/contesto
- **Pricing Rule** = regola di dynamic pricing
- **Comanda** = ordine preso al tavolo o asporto in corso di servizio
- **Ordine** = termine generico, usare comanda per sala, "ordine online" per asporto/delivery
- **Conto** = stato pagamento di una comanda (può contenere più comande accorpate)
- **Documento Commerciale** = ex scontrino fiscale (terminologia AdE italiana)
- **Driver fiscale** = modulo software che interfaccia un RT specifico
- **KDS** = Kitchen Display System (monitor cucina)
- **RT** = Registratore Telematico
- **AdE** = Agenzia delle Entrate
- **AI Assistant** = copilota Claude API integrato nel gestionale
- **Webhook** = chiamata HTTP automatica verso URL terzo su evento
- **API Key** = credenziale per accesso programmatico (plugin, integrazioni)
- **CO2 score** = punteggio impatto ambientale piatto (kg CO2 eq.)
- **Disaster Mode** = modalità di funzionamento offline completo locale (B16)
- **Wallet** = credito prepagato del cliente nel locale (B23)
- **Snapshot configurazione** = versione salvata di una configurazione (menu, listini, ecc.) con possibilità rollback (B20)
- **Sandbox** = ambiente di test/training del tenant (B21)

---

# D. CRITERI DI ACCETTAZIONE FASE 1 (MVP)

Il software è considerato "F1 completo" quando:

1. ✅ Setup completo via `docker compose up` su Ubuntu 22.04 pulito
2. ✅ Multi-tenant funzionante con isolamento dati verificato
3. ✅ 6 ruoli operativi con permessi granulari + audit log
4. ✅ Mappa tavoli con editor drag&drop + versionamento layout
5. ✅ Menu 3 livelli + listini multipli + comande da smartphone offline-first
6. ✅ KDS funzionante + stampa termica
7. ✅ Cassa completa con driver Epson FP + fattura elettronica via API
8. ✅ Magazzino base + ricette + scarico automatico + food cost
9. ✅ Sito vetrina + prenotazioni online + ordini asporto online
10. ✅ App driver delivery proprio (PWA)
11. ✅ Dashboard widget + report standard + briefing mattutino automatico
12. ✅ Gestione turni + timbrature + costo lavoro live
13. ✅ Feature flags Unleash attivi e tutti i `[PRE]` controllati da flag
14. ✅ i18n IT+EN
15. ✅ Audit log completo (incluse azioni AI e plugin)
16. ✅ Backup automatici + Uptime Kuma + documentazione operativa
17. ✅ Coverage test ≥ 60% sui moduli critici
18. ✅ E2E test sui flussi principali (login, comanda, pagamento, ordine online, prenotazione, AI chat base, onboarding tour, command palette base, notifiche)
19. ✅ Manuale utente minimal
20. ✅ Penetration test base superato (OWASP Top 10)
21. ✅ **API pubbliche v1 documentate e stabili** (per integrazioni)
22. ✅ **Webhook system attivo e testato**
23. ✅ **Plugin loader interno presente** (per plugin sviluppati internamente)
24. ✅ **AI Assistant base operativo**: query dati naturali + generazione descrizioni menu + AI Insight widget
25. ✅ **Onboarding interattivo**: tour primo login per ogni ruolo + checklist setup admin sede
26. ✅ **Centro notifiche unificato base** attivo
27. ✅ **Status page interna** operativa con health check di tutti i componenti
28. ✅ **Disaster mode architettura** pronta (Service Worker, IndexedDB esteso, endpoint sync)
29. ✅ **Schema dati `[PRE]` completi** per tutte le feature F2/F3 (pricing rules, CO2, gamification, fidelity, DEM, wallet, sandbox, note interne, chiamate tavolo, versioning configurazioni)
30. ✅ **Account cliente base** sul sito (login, storico ordini, prenotazioni) — primo step della PWA cliente F2

---

# E. AVVERTENZE LEGALI / PROFESSIONALI

Prima di passare in produzione reale (non test) è **obbligatorio**:

1. **Validazione fiscale**: commercialista + fornitore RT certificato verificano integrazione corrispettivi
2. **Validazione GDPR**: consulente privacy verifica trattamento dati + privacy policy + registro trattamenti
3. **Validazione giuslavoristica**: consulente del lavoro verifica modulo turni/timbrature + gamification vs CCNL applicato
4. **Validazione AI Act UE**: verifica conformità per uso AI in contesti operativi
5. **Validazione dataset CO2**: verifica licenze e accuratezza dati (Agribalyse MIT-friendly ma da citare)
6. **Validazione wallet/prepagato**: il prepagato in Italia ha implicazioni IVA come "buono multiuso", validazione commercialista obbligatoria prima di attivare B23
7. **Penetration test professionale**: prima di esporre dati reali su internet
8. **Disaster Recovery test**: ripristino completo da backup testato e documentato

Questo brief NON sostituisce queste validazioni.

---

# F. DECISIONI DI SCOPE (cosa NON facciamo e perché)

> **Sezione critica.** Documenta le feature considerate e **scartate** dalla roadmap F1-F3. La capacità di dire no è il vero superpotere progettuale. Ogni voce qui ha un razionale che deve essere riletto prima di decidere di reintrodurla.

## F1. `[BACKLOG]` Modulo Retail integrato

**Scartata da:** roadmap F1-F3.

**Motivo:** progettare astrazioni "POS generico" per supportare ristorazione + retail senza un caso reale di retail introduce:
- Naming/schemi generici che complicano il core ristorazione
- Decisioni di astrazione premature che difficilmente saranno corrette
- Refactoring inevitabile quando il caso retail reale apparirà (con esigenze diverse da quelle immaginate ora)

**Posizione alternativa:** se in futuro emerge un caso retail reale, sarà sviluppato come **applicazione separata** che riusa solo i singleton già condivisi (utenti, anagrafica clienti, fidelity, fatturazione, magazzino base). L'architettura modulare attuale lo rende possibile **senza bisogno di predisposizioni specifiche**.

**Trigger per riconsiderare:** richiesta esplicita di almeno 3 tenant reali con esigenza retail concreta.

## F2. `[BACKLOG]` Computer Vision controllo qualità piatti

**Scartata da:** F1 (schema dati e UI). Resta possibile aggiungerla in F3 senza predisposizione attuale.

**Motivo:** feature molto cool in demo, utilità reale concentrata in due nicchie estreme (catene franchising con problemi di consistenza, ristoranti stellati). Per il 95% dei locali è inutile. Predisporre schema, upload foto e storage extra in F1 è costo non giustificato.

**Trigger per riconsiderare:** ingresso di un tenant franchising con >5 sedi che lo richiede esplicitamente.

## F3. `[BACKLOG]` Voice ordering / voice commands

**Scartata da:** F1 (predisposizione). Resta possibile aggiungerla in F3 senza predisposizione attuale.

**Motivo:**
- Riconoscimento vocale degrada in ambienti rumorosi (cucina, sala piena = casi d'uso target)
- Pattern di adozione reale: cameriere lo usa i primi giorni, poi torna al tap (più veloce per pattern ripetitivi)
- Problemi di privacy (parlare voci di clienti vicini)
- "Predisporre 2 endpoint API" non è vera predisposizione: aggiungerli quando servono costa uguale

**Trigger per riconsiderare:** richiesta da locali specifici con caso d'uso ben definito (es. catena di drive-thru o accessibilità documentata).

## F4. `[BACKLOG]` Benchmark anonimo tra tenant (predisposizione in F1)

**Scartata da:** F1 (predisposizione). Resta come idea in F3 da progettare ex novo.

**Motivo:** richiede **massa critica** di tenant (~50-100 simili per categoria/area) per generare confronti statisticamente significativi. In F1-F2 si avranno ~5-30 tenant. Predisporre adesso "profilo tenant" per aggregazione futura significa:
- Codice e dati che resteranno inutilizzati per 2+ anni
- Definizioni che cambieranno comunque quando si arriverà al volume necessario
- Distrazione architettonica nel presente

**Trigger per riconsiderare:** raggiungimento di 50+ tenant attivi sulla piattaforma.

## F5. `[BACKLOG]` Plugin Marketplace pubblico (con revenue share, sandbox, ToS pubblici)

**Scartata da:** roadmap F1-F3.

**Motivo:** un marketplace pubblico aperto a terzi richiede:
- Programma developer pubblico (recruitment, onboarding, supporto)
- Processo di review e certificazione plugin
- Sandbox di sicurezza con isolation reale (container, permission system, rate limiting per plugin)
- ToS legali complessi (responsabilità, indemnification, revenue share, data processing)
- Sistema di pagamento ai developer
- Governance qualità (rimozione plugin malevoli, dispute resolution)
- Marketing del marketplace stesso

È **un'azienda dentro un'azienda**. Per F1-F3 i plugin saranno **interni** (sviluppati dal team) o di **partner whitelisted** (accordo commerciale firmato, accesso SDK).

**Cosa resta in roadmap:**
- ✅ API pubbliche v1 stabili (F1) — base tecnica del marketplace futuro
- ✅ Webhook system (F1) — idem
- ✅ Plugin loader interno (F1 [PRE], F2 attivo)
- ✅ Plugin SDK distribuito a partner selezionati (F2)
- ✅ ~10 plugin ufficiali sviluppati internamente (F2)

**Trigger per riconsiderare:** raggiungimento di ≥3 partner attivi che producono plugin con qualità verificata + caso d'uso commerciale chiaro per il marketplace (es. richiesta da 50+ tenant).

---

## F6. Principi guida per future decisioni di scope

Per ogni nuova feature proposta in futuro, valutare:

1. **Esiste un caso d'uso reale documentato** (non ipotetico)?
2. **Quanti tenant lo userebbero davvero** (non "potenzialmente")?
3. **Il costo di aggiungerla dopo** è significativamente maggiore di farla ora?
4. **Aumenta cognitive load** per chi sviluppa e usa il software?
5. **Distrae dalle priorità core** (operatività affidabile, esperienza cassiere/cameriere, dashboard direzione)?

Se le risposte sono: 1) no, 2) pochi, 3) no, 4) sì, 5) sì → **scartare** o **mettere in BACKLOG**.

> "Il prodotto perfetto non è quello a cui non si può più aggiungere nulla, ma quello da cui non si può più togliere nulla." (parafrasi Antoine de Saint-Exupéry)

## F7. Naming / brand (idee future)

**Naming / brand (idea futura, decisione differita):** valutare rebrand della piattaforma a **"One Platform"**. Tre livelli a costo crescente: brand/display (banale) → repo GitHub (`gestionale-piattaforma` → `one-platform`, meccanico, redirect GitHub) → scope tecnico (`@gestionale/*` → `@oneplatform/*`: epica — ogni package/app, path-alias, build-order, CI). Se mai eseguito, il livello 3 va fatto **prima** di aggiungere altri verticali (il churn scala col numero di package). Non deciso.
