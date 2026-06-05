-- @target: tenant
-- ============================================================
-- migrations/64_seed_catalogo.sql
-- Fase 3 modulo Preventivi: seed iniziale di 6 categorie e 20
-- voci catalogo tipiche di uno studio commercialista italiano.
--
-- Le voci sono idempotenti (INSERT IGNORE su `codice`):
-- chi rilancia la migration non vede duplicati. Lo studio può
-- successivamente disattivare/modificare/eliminare quelle che
-- non usa.
-- ============================================================

-- ── CATEGORIE ────────────────────────────────────────────
INSERT IGNORE INTO servizi_categorie (nome, descrizione, colore, icona, ordine) VALUES
    ('Contabilità',        'Tenuta contabile (ordinaria, semplificata, forfettario)', '#2563eb', 'bi-journal-bookmark-fill', 10),
    ('Dichiarativi',       'Modelli Redditi, 730, IVA, IRAP, IMU',                   '#7c3aed', 'bi-file-earmark-text-fill', 20),
    ('Adempimenti',        'CU, 770, Intrastat, Esterometro, Spesometro',            '#0e7490', 'bi-clipboard-data-fill', 30),
    ('Bilancio e Società', 'Bilancio, deposito CCIAA, costituzioni e modifiche',     '#b45309', 'bi-bank2', 40),
    ('Consulenza',         'Consulenze straordinarie, pareri, perizie',              '#15803d', 'bi-lightbulb-fill', 50),
    ('Lavoro e Paghe',     'Buste paga, CU dipendenti, F24, gestione personale',     '#dc2626', 'bi-people-fill', 60);

-- ── VOCI CATALOGO ────────────────────────────────────────
-- INSERT IGNORE su `codice` (UNIQUE): re-run sicuro
INSERT IGNORE INTO servizi_catalogo
    (codice, nome, descrizione, categoria_id, unita_misura, prezzo_base, iva_aliquota, tipo_ricorrenza, ai_keywords, ordine, attivo)
SELECT * FROM (
    SELECT 'CONT-ORD'    AS codice, 'Tenuta contabilità ordinaria'  AS nome, 'Registrazione documenti, libri obbligatori, riconciliazioni mensili.' AS descrizione, (SELECT id FROM servizi_categorie WHERE nome='Contabilità') AS categoria_id, 'mese' AS unita_misura, 350.00 AS prezzo_base, 22.00 AS iva, 'mensile' AS ric, 'contabilità,ordinaria,libri,registrazioni,iva' AS kw, 1 AS ordine, 1 AS attivo UNION ALL
    SELECT 'CONT-SEM',    'Tenuta contabilità semplificata', 'Adatta a ditte individuali e società di persone sotto soglia.', (SELECT id FROM servizi_categorie WHERE nome='Contabilità'), 'mese', 220.00, 22.00, 'mensile', 'contabilità,semplificata,ditta individuale', 2, 1 UNION ALL
    SELECT 'CONT-FOR',    'Gestione regime forfettario',     'Calcolo coefficienti, ritenute, contributi.',                  (SELECT id FROM servizi_categorie WHERE nome='Contabilità'), 'anno', 600.00, 22.00, 'annuale', 'forfettario,partita iva,flat tax', 3, 1 UNION ALL
    SELECT 'CONT-RIC',    'Liquidazione IVA periodica',      'Calcolo, ravvedimento, F24, comunicazione LIPE.',              (SELECT id FROM servizi_categorie WHERE nome='Contabilità'), 'mese', 60.00,  22.00, 'mensile', 'iva,lipe,liquidazione,trimestrale', 4, 1 UNION ALL
    SELECT 'DICH-730',    'Dichiarazione 730',               'Compilazione e invio Modello 730 con allegati.',               (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 80.00, 22.00, 'una_tantum', 'dichiarazione,730,redditi,dipendenti', 1, 1 UNION ALL
    SELECT 'DICH-RED',    'Dichiarazione Redditi PF',        'Compilazione e invio Modello Redditi Persone Fisiche.',        (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 250.00, 22.00, 'annuale', 'redditi,unico,persone fisiche', 2, 1 UNION ALL
    SELECT 'DICH-RED-SC', 'Dichiarazione Redditi SC',        'Modello Redditi Società di Capitali (SRL/SPA).',               (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 800.00, 22.00, 'annuale', 'redditi,sc,srl,società capitali', 3, 1 UNION ALL
    SELECT 'DICH-IVA',    'Dichiarazione IVA annuale',       'Quadri VE/VF, prospetti, invio telematico.',                   (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 180.00, 22.00, 'annuale', 'iva,annuale,quadri,ve,vf', 4, 1 UNION ALL
    SELECT 'DICH-IRAP',   'Dichiarazione IRAP',              'Modello IRAP con quadri specifici.',                            (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 220.00, 22.00, 'annuale', 'irap,regionale', 5, 1 UNION ALL
    SELECT 'DICH-IMU',    'Calcolo e versamento IMU',        'Determinazione imposta, F24, dichiarazione se dovuta.',        (SELECT id FROM servizi_categorie WHERE nome='Dichiarativi'), 'documento', 60.00,  22.00, 'annuale', 'imu,immobile,acconto,saldo', 6, 1 UNION ALL
    SELECT 'ADEM-CU',     'Certificazione Unica (CU)',       'Trasmissione CU per lavoratori autonomi/dipendenti.',          (SELECT id FROM servizi_categorie WHERE nome='Adempimenti'), 'documento', 25.00,  22.00, 'annuale', 'certificazione unica,cu,sostituto', 1, 1 UNION ALL
    SELECT 'ADEM-770',    'Modello 770',                     'Sostituti d''imposta: riepilogo ritenute.',                    (SELECT id FROM servizi_categorie WHERE nome='Adempimenti'), 'documento', 250.00, 22.00, 'annuale', '770,sostituto,ritenute', 2, 1 UNION ALL
    SELECT 'ADEM-INT',    'Modello Intrastat',               'Cessioni/acquisti intracomunitari.',                            (SELECT id FROM servizi_categorie WHERE nome='Adempimenti'), 'mese', 90.00,  22.00, 'mensile', 'intrastat,intracomunitario', 3, 1 UNION ALL
    SELECT 'ADEM-ESTERO', 'Esterometro / Comunicazione esteri', 'Operazioni con soggetti esteri non residenti.',              (SELECT id FROM servizi_categorie WHERE nome='Adempimenti'), 'mese', 50.00,  22.00, 'mensile', 'esterometro,esteri,san marino', 4, 1 UNION ALL
    SELECT 'BIL-ANNUALE', 'Bilancio annuale',                'Predisposizione bilancio CEE, nota integrativa, verbali.',     (SELECT id FROM servizi_categorie WHERE nome='Bilancio e Società'), 'documento', 900.00, 22.00, 'annuale', 'bilancio,nota integrativa,cee', 1, 1 UNION ALL
    SELECT 'BIL-DEP',     'Deposito bilancio CCIAA',         'Deposito XBRL, diritti camerali, registro imprese.',           (SELECT id FROM servizi_categorie WHERE nome='Bilancio e Società'), 'documento', 250.00, 22.00, 'annuale', 'deposito,cciaa,xbrl,registro imprese', 2, 1 UNION ALL
    SELECT 'SOC-COST-SRL','Costituzione SRL',                'Atto, statuto, registrazione, iscrizioni preliminari.',        (SELECT id FROM servizi_categorie WHERE nome='Bilancio e Società'), 'forfait', 1500.00, 22.00, 'una_tantum', 'costituzione,srl,società,notaio', 3, 1 UNION ALL
    SELECT 'CONS-STRAORD','Consulenza straordinaria',        'Pareri specifici, analisi, supporto operazioni straordinarie.',(SELECT id FROM servizi_categorie WHERE nome='Consulenza'), 'ora', 90.00,  22.00, 'una_tantum', 'consulenza,parere,straordinaria', 1, 1 UNION ALL
    SELECT 'CONS-FISC',   'Pianificazione fiscale',          'Analisi e ottimizzazione carico fiscale annuale.',             (SELECT id FROM servizi_categorie WHERE nome='Consulenza'), 'forfait', 800.00, 22.00, 'annuale', 'pianificazione,fiscale,ottimizzazione', 2, 1 UNION ALL
    SELECT 'LAV-BUSTA',   'Elaborazione busta paga',         'Per dipendente / mese, comprensivo F24 e CU finale.',          (SELECT id FROM servizi_categorie WHERE nome='Lavoro e Paghe'), 'dipendente', 30.00, 22.00, 'mensile', 'busta paga,dipendente,cedolino', 1, 1
) AS d;
