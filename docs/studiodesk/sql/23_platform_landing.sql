-- ============================================================
-- 23_platform_landing.sql
-- Editor della landing platform (www.studiodesk.cloud).
-- Schema key-value JSON: ogni voce = una sezione del template.
--
-- Applicare con:
--   sudo mysql portal_master < migrations/23_platform_landing.sql
--
-- GRANT (per portal_master_user):
--   GRANT SELECT, INSERT, UPDATE, DELETE
--     ON portal_master.platform_landing TO 'portal_master_user'@'localhost';
--   FLUSH PRIVILEGES;
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_landing (
  k          VARCHAR(60) NOT NULL PRIMARY KEY,
  data       JSON        NOT NULL,
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT         NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed con i contenuti correnti hardcoded in platform/index.php.
-- INSERT IGNORE: idempotente, ri-eseguibile senza sovrascrivere modifiche.

INSERT IGNORE INTO platform_landing (k, data) VALUES
('hero', JSON_OBJECT(
    'title_part1', 'Il portale clienti',
    'title_accent', 'che il tuo studio meritava',
    'lead', 'Comunicazioni con allegati, scadenziario condiviso, assistente AI e bot Telegram per i tuoi clienti — tutto in un''unica piattaforma pensata per studi commercialisti, consulenti del lavoro e avvocati.',
    'cta_primary_label', 'Richiedi una demo gratuita',
    'cta_primary_href', '#contatti',
    'cta_secondary_label', 'Accedi al tuo portale',
    'cta_secondary_href', '/accedi',
    'trust', JSON_ARRAY(
        'Setup in 24 ore',
        'Dati su server in Europa',
        'Nessuna carta richiesta'
    )
)),

('features_header', JSON_OBJECT(
    'tag', 'Funzionalità',
    'h2',  'Tutto quello che serve. Niente in più.',
    'p',   'Pensato per come lavorano davvero gli studi professionali. Ogni voce qui sotto risolve un problema vero della tua settimana.'
)),

('features_items', JSON_ARRAY(
    JSON_OBJECT('icon','chat-dots-fill',      'g1','#6366f1','g2','#8b5cf6','title','Tutte le richieste in un posto solo',     'desc','Niente più email che si perdono, WhatsApp dimenticati, file sparsi nel Drive. Ogni cliente ha la sua chat: ordinata, ricercabile, con allegati e storia chiara.'),
    JSON_OBJECT('icon','broadcast-pin',       'g1','#f97316','g2','#ef4444','title','Il cliente ti scrive dove vuole lui',      'desc','Email, Telegram, WhatsApp — il portale parla con tutti. Tu rispondi sempre da un posto, e arriva al cliente sul canale che usa già.'),
    JSON_OBJECT('icon','people-fill',         'g1','#10b981','g2','#059669','title','Il team coordinato al primo sguardo',     'desc','Vedi chi ha quanti clienti aperti, chi è in pausa, chi può prendere una pratica in più. Le scrivanie sovraccariche non sono più una sorpresa di lunedì mattina.'),
    JSON_OBJECT('icon','stars',               'g1','#ec4899','g2','#db2777','title','Un assistente che non si stanca mai',     'desc','L''AI risponde alle domande di routine al posto tuo. Scadenze, procedure, documenti — i clienti se le chiariscono da soli, senza chiamarti la domenica.'),
    JSON_OBJECT('icon','calendar-check-fill', 'g1','#06b6d4','g2','#0891b2','title','Le scadenze prima che diventino urgenze', 'desc','Il cliente apre il portale e sa cosa lo aspetta questo mese. Smetti di ripetere "quando scade l''F24?" venti volte al giorno.'),
    JSON_OBJECT('icon','shield-check',        'g1','#8b5cf6','g2','#6366f1','title','Il neo-assunto vede solo ciò che deve',   'desc','Decidi chi tocca quali clienti, quali pratiche, quali bilanci. Lo stagista non finisce sui numeri della direzione, e la riservatezza dei tuoi clienti resta blindata.'),
    JSON_OBJECT('icon','palette-fill',        'g1','#f59e0b','g2','#d97706','title','Il sito del tuo studio in cinque minuti', 'desc','Scegli un template, cambi tre colori, sei online. Hai una vetrina seria senza assumere un grafico — e la cambi quando vuoi senza chiamare nessuno.'),
    JSON_OBJECT('icon','phone-fill',          'g1','#14b8a6','g2','#0d9488','title','Funziona benissimo anche dal divano',     'desc','I tuoi clienti rispondono dal telefono, di sera, in metro, in vacanza. È la stessa identica interfaccia del desktop — niente da scaricare, niente password da reinserire.'),
    JSON_OBJECT('icon','shield-lock-fill',    'g1','#64748b','g2','#475569','title','I tuoi dati, solo tuoi',                  'desc','Ogni studio sul suo spazio dedicato — non si toccano mai con quelli degli altri. Salvataggi automatici ogni notte, recupero immediato se serve. Un pensiero in meno.')
)),

('pricing_header', JSON_OBJECT(
    'tag', 'Prezzi',
    'h2',  'Trasparenti. Senza sorprese.',
    'p',   'Paghi quello che vedi. Cambi piano in qualsiasi momento. Cancellazione con un click — niente vincoli.'
)),

('testimonials_header', JSON_OBJECT(
    'tag', 'Cosa dicono',
    'h2',  'Studi pilota che ci hanno scelto',
    'p',   'Le prime impressioni di chi sta già usando {BRAND} per gestire centinaia di clienti.'
)),

('testimonials_items', JSON_ARRAY(
    JSON_OBJECT('stars',5,'text','Prima usavamo email + Whatsapp + Drive. Adesso c''è tutto in un posto solo, i clienti smettono di chiamarci per chiederci "hai ricevuto?". Il bot Telegram poi è una chicca.','initials','MR','name','Marco R.','role','Commercialista, Verona'),
    JSON_OBJECT('stars',5,'text','L''assistente AI ci ha tagliato del 30% le richieste banali da parte dei clienti — quelle "qual è la scadenza X?" o "come faccio Y". Lo staff può concentrarsi sul lavoro vero.','initials','AF','name','Anna F.','role','Consulente del lavoro, Milano'),
    JSON_OBJECT('stars',5,'text','Setup in mezza giornata, formazione del team in un''altra mezza. I clienti più anziani hanno apprezzato la semplicità — non c''è bisogno di scaricare niente.','initials','LB','name','Luca B.','role','Studio associato, Bologna')
)),

('faq_header', JSON_OBJECT(
    'tag', 'Domande frequenti',
    'h2',  'Quello che ci chiedono'
)),

('faq_items', JSON_ARRAY(
    JSON_OBJECT('q','Quanto tempo serve per partire?','a','Il provisioning dello studio richiede pochi minuti. Per la migrazione dei dati esistenti (anagrafiche clienti, prime comunicazioni) prevediamo tipicamente 24-48 ore lavorative, dipendentemente dalla quantità di dati.'),
    JSON_OBJECT('q','Dove sono ospitati i dati?','a','I dati risiedono su server in Europa, conformi GDPR. Ogni studio ha un database dedicato — non c''è "mescolanza" tra clienti. Backup automatici giornalieri con retention 30 giorni.'),
    JSON_OBJECT('q','I miei clienti devono installare un''app?','a','No. Il portale è web-based: si apre da browser, sia desktop che mobile. È installabile come PWA con un tap sia su iOS che Android — diventa un''icona sulla home come un''app nativa, ma senza passare dagli store.'),
    JSON_OBJECT('q','Posso provare senza impegno?','a','Sì. Compila il form qui sotto e ti contattiamo per una demo personalizzata di 30 minuti. Se decidi di partire, il primo mese è gratuito — se non sei soddisfatto cancelli senza dare spiegazioni.'),
    JSON_OBJECT('q','Cambia piano in corso d''anno?','a','In qualsiasi momento. L''upgrade è immediato (paghi la differenza pro-rata). Il downgrade parte dal mese successivo. Nessun vincolo annuale, nessuna penale di uscita.'),
    JSON_OBJECT('q','Cosa include l''assistenza?','a','Base: assistenza email entro 24h lavorative. Pro: chat in giornata + onboarding guidato. Enterprise: account manager dedicato, SLA 4h, formazione on-site.'),
    JSON_OBJECT('q','Posso integrare il mio dominio personalizzato?','a','Sì, puoi puntare il tuo dominio (portale.tuostudio.it) sul nostro server. Configuriamo noi il certificato SSL gratuito (Let''s Encrypt). Incluso da piano Pro.')
)),

('contact_header', JSON_OBJECT(
    'tag', 'Iniziamo',
    'h2',  'Parliamone.',
    'p',   'Compila il form e ti ricontatteremo entro 24 ore lavorative per una demo personalizzata. Niente automazioni, niente call center: ti scriviamo o chiamiamo personalmente.',
    'bullets', JSON_ARRAY(
        JSON_OBJECT('icon','clock-fill',         'text','Risposta entro 24h lavorative'),
        JSON_OBJECT('icon','camera-video-fill',  'text','Demo personalizzata di 30 minuti'),
        JSON_OBJECT('icon','gift-fill',          'text','Primo mese gratuito senza carta'),
        JSON_OBJECT('icon','shield-lock-fill',   'text','Nessuno spam, mai')
    )
));
