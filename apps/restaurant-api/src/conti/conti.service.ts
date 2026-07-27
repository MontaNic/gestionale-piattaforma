// =============================================================================
// conti.service.ts — Operatività COMANDE (PR-2, ADR-0068)
// =============================================================================
// Segue il template tables.service 1:1:
// - read single-op → this.db.prisma (context ALS attivo)
// - mutazioni → withTenantContextAtomicTx (multi-statement + audit atomici)
// - audit inline dentro il tx (action namespaced conto.*/conto_riga.*)
// - soft-delete via tx.update({ deletedAt }) — MAI tx.delete() (caveat ADR-0021)
//
// Regole di dominio (scope-lock PR-2):
// - Coerenza canale↔tavolo (D3): cassa ⇒ tavoloId obbligatorio; asporto/delivery/
//   menu_online ⇒ tavoloId assente. Violazione → E_CONTO_CHANNEL_TAVOLO_MISMATCH.
// - State machine (D5): StatoConto aperto → {chiuso, annullato} (terminali).
//   Ogni mutazione (righe, chiudi, annulla) esige stato `aperto` → E_CONTO_NOT_OPEN.
// - Snapshot pricing (D2): prezzo/nome/reparto congelati via PricingService.
// - Totale conto: derivato in read (mai persistito — YAGNI).
//
// Cassa pre-fiscale (ADR-0081):
// - Pagamenti = child table (D1), split payment nativo. `registraPagamento` /
//   `stornaPagamento` esigono conto `aperto` come ogni altra mutazione.
// - `residuo` / `statoPagamento` / `riepilogoIva` sono DERIVATI (D2), mai
//   persistiti — stessa scelta di `totale`. Unica eccezione: il riepilogo IVA
//   viene CONGELATO su `Conto.riepilogoIvaSnapshot` alla chiusura (D4).
// - `chiudi` ha una guardia di saldo (D3): residuo == 0 oppure totale == 0.
//   ⚠️ CAMBIO DI CONTRATTO rispetto a PR-2/ADR-0068 (dove `chiudi` era una pura
//   transizione di stato). `annulla` resta la via per chiudere senza incasso.
// - Il predicato della guardia è esposto in lettura come `chiudibile` su
//   `getById` (ADR-0082): stessa funzione `isChiudibile` per l'UI e per il throw.
// =============================================================================

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Channel,
  type Comanda,
  type Conto,
  type ContoRiga,
  id,
  type Pagamento,
  Prisma,
  type PrintDepartment,
  type StatoConto,
  withTenantContextAtomicTx,
} from '@gestionale/db';

import { DbService } from '@gestionale/db/nest';
import { catchUniqueViolation } from '@gestionale/platform';
import type { TenantTx } from '../common/tenant-tx.type';
import { PricingService } from '../pricing/pricing.service';
import type { CreateContoDto } from './dto/create-conto.dto';
import type { AddRigaDto } from './dto/add-riga.dto';
import type { UpdateRigaDto } from './dto/update-riga.dto';
import type { RegistraPagamentoDto } from './dto/registra-pagamento.dto';

/**
 * Stato di pagamento DERIVATO (ADR-0081 D2) — mai persistito. Precedenza:
 * `saldato` (residuo azzerato, incluso il conto a totale 0) → `da_pagare`
 * (nessun incasso) → `parziale` (incassato in parte).
 */
export type StatoPagamento = 'da_pagare' | 'parziale' | 'saldato';

/**
 * Un gruppo del riepilogo IVA (scorporo dal lordo, ADR-0070 + ADR-0081 D4).
 * Importi come stringhe decimali a 2 cifre: Decimal→string sul wire, mai float.
 *
 * `type` e NON `interface`: solo i type alias ricevono l'index signature
 * implicita che `Prisma.InputJsonValue` esige per scriverlo su una colonna Json
 * (il congelamento in `transitionStato`) senza cast.
 */
export type RiepilogoIvaGruppo = {
  vatPercent: number;
  lordo: string;
  imponibile: string;
  iva: string;
};

export type ContoWithRighe = Conto & {
  righe: ContoRiga[];
  totale: string;
  // Cassa (ADR-0081): pagamenti reali + tre derivati. `pagamenti` include gli
  // stornati (restano visibili marcati, come le righe stornate).
  pagamenti: Pagamento[];
  residuo: string;
  statoPagamento: StatoPagamento;
  riepilogoIva: RiepilogoIvaGruppo[];
  /**
   * Predicato della guardia di saldo D3 esposto come dato (ADR-0082): il client
   * lega il bottone "chiudi" a QUESTO campo invece di ri-derivarlo. Stessa
   * funzione (`isChiudibile`) che `assertSettled` usa per throware
   * `E_CONTO_NOT_SETTLED` → UI e guardia non possono divergere.
   */
  chiudibile: boolean;
};

/**
 * Guardia di saldo D3 come PREDICATO PURO (ADR-0081 D3, esposto da ADR-0082).
 * Chiudibile se `residuo == 0` **oppure** `totale == 0`.
 *
 * ⚠️ `isZero()` STRETTO, non `<= 0`: la divergenza da `computeStatoPagamento`
 * (che usa `residuo <= 0` → `saldato`) è VOLUTA. Un conto sovra-pagato
 * (residuo < 0, totale > 0 — storno parziale di un conto già saldato) è
 * `saldato` ma NON chiudibile: la via d'uscita è stornare il pagamento e
 * ri-registrarlo al nuovo totale, oppure `annulla`. Armonizzare i due predicati
 * rimetterebbe il sovra-pagato tra i chiudibili → NON farlo.
 *
 * La seconda clausola (`totale.isZero()`) non è ridondante: con un solo articolo
 * stornato dopo il pagamento il totale va a 0 e la chiusura resta possibile.
 */
export function isChiudibile(totale: Prisma.Decimal, pagato: Prisma.Decimal): boolean {
  return totale.minus(pagato).isZero() || totale.isZero();
}

/** Esito dell'invio: una Comanda creata per ogni reparto presente tra le righe pending. */
export interface ComandaInviata {
  id: string;
  reparto: PrintDepartment;
  stato: Comanda['stato'];
  inviataIl: Date;
  righeCount: number;
}

@Injectable()
export class ContiService {
  private readonly logger = new Logger(ContiService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  // --- reads -----------------------------------------------------------------

  async list(
    tenantId: string,
    filters?: { stato?: StatoConto; tavoloId?: string },
  ): Promise<Conto[]> {
    // Filtri opzionali (PR-1 FE): applicati solo se presenti → nessun param =
    // comportamento identico al precedente (backward-compat).
    const where: Prisma.ContoWhereInput = { tenantId };
    if (filters?.stato) where.stato = filters.stato;
    if (filters?.tavoloId) where.tavoloId = filters.tavoloId;

    return this.db.prisma.conto.findMany({
      where,
      orderBy: [{ apertoIl: 'desc' }],
    });
  }

  async getById(tenantId: string, contoId: string): Promise<ContoWithRighe> {
    const conto = await this.db.prisma.conto.findFirst({
      where: { id: contoId, tenantId },
      include: {
        // filtro esplicito deletedAt: le righe stornate non entrano nel totale
        righe: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        // `pagamenti` non ha deletedAt (storno via `stornato`) → nessun filtro:
        // gli stornati arrivano al client marcati, come le righe stornate.
        pagamenti: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conto) {
      throw new NotFoundException({ errorCode: 'E_CONTO_NOT_FOUND', message: 'Conto not found' });
    }
    const totale = this.totaleDecimal(conto.righe);
    const pagato = this.pagatoDecimal(conto.pagamenti);
    return {
      ...conto,
      totale: totale.toFixed(2),
      residuo: totale.minus(pagato).toFixed(2),
      statoPagamento: this.computeStatoPagamento(totale, pagato),
      riepilogoIva: this.computeRiepilogoIva(conto.righe),
      chiudibile: isChiudibile(totale, pagato),
    };
  }

  /** Lista dei pagamenti di un conto (gate `cassa.visualizza`). Include gli stornati. */
  async listPagamenti(tenantId: string, contoId: string): Promise<Pagamento[]> {
    // Il conto deve esistere nel tenant: senza questo check un id di altro tenant
    // restituirebbe [] (indistinguibile da "conto senza pagamenti") invece di 404.
    const conto = await this.db.prisma.conto.findFirst({
      where: { id: contoId, tenantId },
      select: { id: true },
    });
    if (!conto) {
      throw new NotFoundException({ errorCode: 'E_CONTO_NOT_FOUND', message: 'Conto not found' });
    }
    return this.db.prisma.pagamento.findMany({
      where: { contoId, tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // --- derivati (mai persistiti) ---------------------------------------------

  /**
   * Totale LORDO del conto — ex `computeTotale` (ADR-0068), ora reso Decimal
   * perché residuo e scorporo lo compongono: la serializzazione a stringa avviene
   * al bordo (`getById`). Semantica IDENTICA e volutamente invariata (ADR-0070 D1:
   * Σ prezzo×qta, nessuna IVA aggiunta) — chi cerca lo scorporo qui non lo trova,
   * è in `computeRiepilogoIva`.
   *
   * Escluse le stornate (ADR-storno): il cliente non paga una riga revocata. Le
   * soft-deleted sono già fuori (getById filtra deletedAt); qui filtriamo
   * `stornata` che NON è coperto dalla soft-delete extension (boolean normale).
   * Le righe stornate restano però nel payload `righe` per il rendering (barrata).
   */
  private totaleDecimal(righe: ContoRiga[]): Prisma.Decimal {
    return righe
      .filter((r) => !r.stornata)
      .reduce((acc, r) => acc.plus(r.prezzoUnitario.times(r.quantita)), new Prisma.Decimal(0));
  }

  /** Σ degli importi APPLICATI: i pagamenti stornati non contano (ADR-0081). */
  private pagatoDecimal(pagamenti: Pagamento[]): Prisma.Decimal {
    return pagamenti
      .filter((p) => !p.stornato)
      .reduce((acc, p) => acc.plus(p.importo), new Prisma.Decimal(0));
  }

  /**
   * Stato di pagamento derivato (D2). `residuo == 0` vince su tutto: copre sia il
   * conto saldato sia il conto a totale 0 (nulla da incassare). Un conto può avere
   * residuo NEGATIVO solo dopo lo storno di una riga già pagata → resta `saldato`,
   * non è un quarto stato. ⚠️ `saldato` NON implica chiudibile: il predicato di
   * chiusura è `isChiudibile` (isZero stretto), volutamente più severo.
   */
  private computeStatoPagamento(totale: Prisma.Decimal, pagato: Prisma.Decimal): StatoPagamento {
    const residuo = totale.minus(pagato);
    if (residuo.lessThanOrEqualTo(0)) return 'saldato';
    if (pagato.isZero()) return 'da_pagare';
    return 'parziale';
  }

  /**
   * Riepilogo IVA per aliquota — SCORPORO dal lordo (ADR-0070 D1/D2 + ADR-0081 D4).
   * I prezzi sono lordi: `imponibile = lordo / (1 + vat/100)` arrotondato a 2
   * decimali HALF_UP, e `iva = lordo − imponibile` (differenza, NON un secondo
   * arrotondamento) così che imponibile + iva == lordo **esattamente** per ogni
   * gruppo. L'aliquota è quella snapshottata sulla riga (`vatPercent`), non quella
   * corrente dell'articolo. Gruppi ordinati per aliquota crescente (output stabile
   * → confrontabile con lo snapshot congelato). Esclude stornate e soft-deleted.
   */
  private computeRiepilogoIva(righe: ContoRiga[]): RiepilogoIvaGruppo[] {
    const lordoPerAliquota = new Map<number, Prisma.Decimal>();
    for (const r of righe.filter((x) => !x.stornata)) {
      const acc = lordoPerAliquota.get(r.vatPercent) ?? new Prisma.Decimal(0);
      lordoPerAliquota.set(r.vatPercent, acc.plus(r.prezzoUnitario.times(r.quantita)));
    }

    return [...lordoPerAliquota.entries()]
      .sort(([a], [b]) => a - b)
      .map(([vatPercent, lordo]) => {
        const divisore = new Prisma.Decimal(1).plus(new Prisma.Decimal(vatPercent).dividedBy(100));
        const imponibile = lordo
          .dividedBy(divisore)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        return {
          vatPercent,
          lordo: lordo.toFixed(2),
          imponibile: imponibile.toFixed(2),
          iva: lordo.minus(imponibile).toFixed(2),
        };
      });
  }

  // --- lifecycle conto -------------------------------------------------------

  async create(tenantId: string, userId: string, dto: CreateContoDto): Promise<Conto> {
    this.assertChannelTavoloCoherent(dto.channel, dto.tavoloId);

    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      if (dto.tavoloId) {
        const tavolo = await tx.tavolo.findFirst({ where: { id: dto.tavoloId, tenantId } });
        if (!tavolo) {
          throw new NotFoundException({
            errorCode: 'E_TAVOLO_NOT_FOUND',
            message: 'Tavolo not found',
          });
        }
      }

      // DP-2 "un tavolo, un conto aperto": il partial unique index
      // `conti_tenant_tavolo_aperto_uq` (migration 20260702090000) vincola a UN
      // solo conto 'aperto' per tavolo. È l'UNICO unique index su `conti` → un
      // P2002 da questa create è inequivocabilmente quel conflitto → 409.
      const conto = await catchUniqueViolation(
        () =>
          tx.conto.create({
            data: {
              id: id(),
              tenantId,
              channel: dto.channel,
              coperti: dto.coperti ?? null,
              tavoloId: dto.tavoloId ?? null,
              stato: 'aperto',
            },
          }),
        'E_CONTO_TAVOLO_ALREADY_OPEN',
      );

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto.aperto',
          entityType: 'Conto',
          entityId: conto.id,
          afterValue: {
            channel: conto.channel,
            coperti: conto.coperti,
            tavoloId: conto.tavoloId,
            stato: conto.stato,
          },
        },
      });

      this.logger.log(`Conto aperto: ${conto.id} channel=${conto.channel} tenant=${tenantId}`);
      return conto;
    });
  }

  async chiudi(tenantId: string, userId: string, contoId: string): Promise<Conto> {
    return this.transitionStato(tenantId, userId, contoId, 'chiuso', 'conto.chiuso');
  }

  async annulla(tenantId: string, userId: string, contoId: string): Promise<Conto> {
    return this.transitionStato(tenantId, userId, contoId, 'annullato', 'conto.annullato');
  }

  private async transitionStato(
    tenantId: string,
    userId: string,
    contoId: string,
    target: 'chiuso' | 'annullato',
    action: 'conto.chiuso' | 'conto.annullato',
  ): Promise<Conto> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const conto = await this.loadOpenConto(tx, tenantId, contoId);

      // Guardia di saldo (D3) — SOLO su `chiudi`. `annulla` resta la via per
      // uscire da un conto senza incasso (errore, no-show, cliente andato via).
      // Il riepilogo IVA si congela solo quando c'è una chiusura vera.
      let riepilogoIvaSnapshot: Prisma.InputJsonValue | undefined;
      if (target === 'chiuso') {
        const righe = await tx.contoRiga.findMany({
          where: { contoId, tenantId },
          orderBy: { createdAt: 'asc' },
        });
        const pagamenti = await tx.pagamento.findMany({ where: { contoId, tenantId } });
        const totale = this.totaleDecimal(righe);
        this.assertSettled(totale, this.pagatoDecimal(pagamenti));
        // Congelato UNA SOLA VOLTA (D4): questo è l'unico path che lo scrive, e la
        // transizione è terminale → nessun secondo passaggio possibile.
        riepilogoIvaSnapshot = this.computeRiepilogoIva(righe);
      }

      const updated = await tx.conto.update({
        where: { id: contoId },
        data: {
          stato: target,
          // chiusoIl valorizzato solo alla chiusura; annullato non è "chiuso".
          chiusoIl: target === 'chiuso' ? new Date() : conto.chiusoIl,
          // key omessa su `annulla` → colonna invariata (resta NULL).
          riepilogoIvaSnapshot,
        },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action,
          entityType: 'Conto',
          entityId: contoId,
          beforeValue: { stato: conto.stato },
          // Il riepilogo congelato entra in audit solo su `chiudi` (undefined su
          // annulla → key assente nel JSON). L'action mantiene il nome storico
          // `conto.chiuso` (anchor stability per i consumer audit esistenti).
          afterValue: {
            stato: updated.stato,
            chiusoIl: updated.chiusoIl,
            riepilogoIvaSnapshot,
          },
        },
      });

      this.logger.log(`Conto ${target}: ${contoId} tenant=${tenantId}`);
      return updated;
    });
  }

  // --- pagamenti (Cassa pre-fiscale, ADR-0081) -------------------------------

  /**
   * Registra un pagamento sul conto. Split payment nativo: N chiamate → N righe
   * `Pagamento`, il pagamento singolo è il caso degenere N=1 (D1).
   * @throws NotFound E_CONTO_NOT_FOUND — conto assente o di altro tenant
   * @throws Conflict E_CONTO_NOT_OPEN — conto già chiuso/annullato
   * @throws Conflict E_PAGAMENTO_EXCEEDS_RESIDUO — overpay non modellato (il resto
   *         contanti è concern FE, TD-cassa-resto-drawer)
   */
  async registraPagamento(
    tenantId: string,
    userId: string,
    contoId: string,
    dto: RegistraPagamentoDto,
  ): Promise<Pagamento> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await this.loadOpenConto(tx, tenantId, contoId);

      const residuo = await this.residuoInTx(tx, tenantId, contoId);
      // Decimal, non float: `importo` arriva come number dal DTO (max 2 decimali
      // validati) e va confrontato in decimale esatto col residuo.
      const importo = new Prisma.Decimal(dto.importo);
      if (importo.greaterThan(residuo)) {
        throw new ConflictException({
          errorCode: 'E_PAGAMENTO_EXCEEDS_RESIDUO',
          message: `Importo ${importo.toFixed(2)} exceeds residuo ${residuo.toFixed(2)}`,
        });
      }

      const pagamento = await tx.pagamento.create({
        data: {
          id: id(),
          tenantId,
          contoId,
          metodo: dto.metodo,
          importo,
          operatoreId: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto.pagamento_registrato',
          entityType: 'Pagamento',
          entityId: pagamento.id,
          beforeValue: { residuoPrima: residuo.toFixed(2) },
          afterValue: {
            contoId,
            metodo: pagamento.metodo,
            importo: pagamento.importo.toString(),
            residuoDopo: residuo.minus(importo).toFixed(2),
          },
        },
      });

      this.logger.log(
        `Pagamento registrato: ${pagamento.id} conto=${contoId} metodo=${pagamento.metodo} tenant=${tenantId}`,
      );
      return pagamento;
    });
  }

  /**
   * Storna un pagamento (soft, `stornato=true`): l'incasso è ESISTITO — resta
   * visibile e in audit, esce solo dal residuo. Terminale, no toggle (come
   * `ContoRiga.stornata`).
   * @throws Conflict E_CONTO_NOT_OPEN — su conto chiuso lo storno riaprirebbe un
   *         residuo su un conto terminale (e invaliderebbe lo snapshot IVA)
   * @throws NotFound E_PAGAMENTO_NOT_FOUND — pagamento assente o di altro conto
   * @throws Conflict E_PAGAMENTO_ALREADY_STORNATO — idempotenza esplicita
   */
  async stornaPagamento(
    tenantId: string,
    userId: string,
    contoId: string,
    pagamentoId: string,
  ): Promise<Pagamento> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await this.loadOpenConto(tx, tenantId, contoId);

      const before = await tx.pagamento.findFirst({
        where: { id: pagamentoId, contoId, tenantId },
      });
      if (!before) {
        throw new NotFoundException({
          errorCode: 'E_PAGAMENTO_NOT_FOUND',
          message: 'Pagamento not found',
        });
      }
      if (before.stornato) {
        throw new ConflictException({
          errorCode: 'E_PAGAMENTO_ALREADY_STORNATO',
          message: 'Pagamento already stornato',
        });
      }

      const updated = await tx.pagamento.update({
        where: { id: pagamentoId },
        data: { stornato: true, stornatoIl: new Date() },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto.pagamento_stornato',
          entityType: 'Pagamento',
          entityId: pagamentoId,
          beforeValue: {
            contoId,
            metodo: before.metodo,
            importo: before.importo.toString(),
            stornato: before.stornato,
          },
          afterValue: { stornato: updated.stornato, stornatoIl: updated.stornatoIl },
        },
      });

      this.logger.log(`Pagamento stornato: ${pagamentoId} conto=${contoId} tenant=${tenantId}`);
      return updated;
    });
  }

  /** Residuo corrente del conto letto DENTRO la tx (evita race sul concorrente). */
  private async residuoInTx(
    tx: TenantTx,
    tenantId: string,
    contoId: string,
  ): Promise<Prisma.Decimal> {
    const righe = await tx.contoRiga.findMany({ where: { contoId, tenantId } });
    const pagamenti = await tx.pagamento.findMany({ where: { contoId, tenantId } });
    return this.totaleDecimal(righe).minus(this.pagatoDecimal(pagamenti));
  }

  /**
   * Guardia di saldo (D3): si chiude solo un conto saldato. ⚠️ CAMBIO DI CONTRATTO
   * rispetto ad ADR-0068 (dove `chiudi` era una pura transizione di stato).
   *
   * Il predicato vive in `isChiudibile` (modulo, puro e testabile) ed è LO STESSO
   * che `getById` espone nel campo `chiudibile` (ADR-0082): la UI non può mostrare
   * un bottone che il BE poi rifiuta. Qui resta solo il throw con il contesto.
   */
  private assertSettled(totale: Prisma.Decimal, pagato: Prisma.Decimal): void {
    if (isChiudibile(totale, pagato)) return;
    const residuo = totale.minus(pagato);
    throw new ConflictException({
      errorCode: 'E_CONTO_NOT_SETTLED',
      message: `Conto not settled: residuo ${residuo.toFixed(2)} (totale ${totale.toFixed(2)}, pagato ${pagato.toFixed(2)})`,
    });
  }

  // --- invio comanda (KDS) ---------------------------------------------------

  /**
   * Invia in cucina le righe PENDING del conto (`comandaId IS NULL`, non stornate).
   * Split server-side PER REPARTO: N comande, una per reparto presente. Le righe
   * inviate ricevono `comandaId` → diventano immutabili. Audit-in-tx per comanda.
   * @throws NotFound/Conflict E_CONTO_NOT_OPEN — conto assente o non `aperto`
   * @throws Conflict E_COMANDA_NO_RIGHE_PENDING — nessuna riga pending da inviare
   */
  async invia(tenantId: string, userId: string, contoId: string): Promise<ComandaInviata[]> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await this.loadOpenConto(tx, tenantId, contoId);

      // Pending = non ancora inviate; soft-deleted escluse dall'extension.
      const pending = await tx.contoRiga.findMany({
        where: { contoId, tenantId, comandaId: null },
        orderBy: { createdAt: 'asc' },
      });
      if (pending.length === 0) {
        throw new ConflictException({
          errorCode: 'E_COMANDA_NO_RIGHE_PENDING',
          message: 'No pending rige to send',
        });
      }

      // Raggruppa per reparto (ordine deterministico = prima occorrenza in createdAt asc).
      const byReparto = new Map<PrintDepartment, ContoRiga[]>();
      for (const riga of pending) {
        const group = byReparto.get(riga.reparto) ?? [];
        group.push(riga);
        byReparto.set(riga.reparto, group);
      }

      const inviate: ComandaInviata[] = [];
      for (const [reparto, righe] of byReparto) {
        const comanda = await tx.comanda.create({
          data: { id: id(), tenantId, contoId, reparto, stato: 'inviata' },
        });
        await tx.contoRiga.updateMany({
          where: { id: { in: righe.map((r) => r.id) }, tenantId },
          data: { comandaId: comanda.id },
        });
        await tx.auditLog.create({
          data: {
            id: id(),
            tenantId,
            userId,
            action: 'comanda.inviata',
            entityType: 'Comanda',
            entityId: comanda.id,
            afterValue: {
              contoId,
              reparto,
              righeCount: righe.length,
              righeIds: righe.map((r) => r.id),
            },
          },
        });
        inviate.push({
          id: comanda.id,
          reparto,
          stato: comanda.stato,
          inviataIl: comanda.inviataIl,
          righeCount: righe.length,
        });
      }

      this.logger.log(
        `Comande inviate: conto=${contoId} reparti=${inviate.length} tenant=${tenantId}`,
      );
      return inviate;
    });
  }

  // --- righe -----------------------------------------------------------------

  async addRiga(
    tenantId: string,
    userId: string,
    contoId: string,
    dto: AddRigaDto,
  ): Promise<ContoRiga> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      const conto = await this.loadOpenConto(tx, tenantId, contoId);

      const snapshot = await this.pricing.resolveLineSnapshot(
        tx,
        tenantId,
        dto.articleId,
        conto.channel,
      );

      const riga = await tx.contoRiga.create({
        data: {
          id: id(),
          tenantId,
          contoId,
          articleId: dto.articleId,
          nomeArticolo: snapshot.nomeArticolo,
          prezzoUnitario: snapshot.prezzoUnitario,
          vatPercent: snapshot.vatPercent,
          quantita: dto.quantita,
          reparto: snapshot.reparto,
          portata: snapshot.portata,
          note: dto.note ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto_riga.aggiunta',
          entityType: 'ContoRiga',
          entityId: riga.id,
          afterValue: {
            contoId,
            articleId: riga.articleId,
            nomeArticolo: riga.nomeArticolo,
            prezzoUnitario: riga.prezzoUnitario.toString(),
            quantita: riga.quantita,
            reparto: riga.reparto,
            note: riga.note,
          },
        },
      });

      this.logger.log(`ContoRiga aggiunta: ${riga.id} conto=${contoId} tenant=${tenantId}`);
      return riga;
    });
  }

  async updateRiga(
    tenantId: string,
    userId: string,
    contoId: string,
    rigaId: string,
    dto: UpdateRigaDto,
  ): Promise<ContoRiga> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await this.loadOpenConto(tx, tenantId, contoId);
      const before = await this.loadRiga(tx, tenantId, contoId, rigaId);
      this.assertRigaNotSent(before);

      const updated = await tx.contoRiga.update({
        where: { id: rigaId },
        // `dto.note === undefined` (campo omesso) → Prisma ignora la key → note
        // invariata. Stringa (incl. "") → aggiornata. Solo su riga pending (l'invio
        // congela la riga: assertRigaNotSent sopra).
        data: { quantita: dto.quantita, note: dto.note },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto_riga.modificata',
          entityType: 'ContoRiga',
          entityId: rigaId,
          beforeValue: { quantita: before.quantita, note: before.note },
          afterValue: { quantita: updated.quantita, note: updated.note },
        },
      });

      return updated;
    });
  }

  async stornaRiga(
    tenantId: string,
    userId: string,
    contoId: string,
    rigaId: string,
  ): Promise<{ id: string; deleted: true }> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await this.loadOpenConto(tx, tenantId, contoId);
      const before = await this.loadRiga(tx, tenantId, contoId, rigaId);
      this.assertRigaNotSent(before);

      // Soft-delete via update deletedAt (ADR-0021): mai tx.delete().
      await tx.contoRiga.update({ where: { id: rigaId }, data: { deletedAt: new Date() } });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto_riga.stornata',
          entityType: 'ContoRiga',
          entityId: rigaId,
          beforeValue: {
            articleId: before.articleId,
            nomeArticolo: before.nomeArticolo,
            prezzoUnitario: before.prezzoUnitario.toString(),
            quantita: before.quantita,
          },
        },
      });

      this.logger.log(`ContoRiga stornata: ${rigaId} conto=${contoId} tenant=${tenantId}`);
      return { id: rigaId, deleted: true };
    });
  }

  /**
   * Storno di una riga INVIATA (ADR-storno). Distinto da `stornaRiga` (pending,
   * soft-delete): qui la riga è già in cucina (`comandaId != null`), non si
   * cancella — si marca `stornata=true` (resta visibile, esce dal totale). La
   * perdita post-preparazione è ricostruibile via audit `conto_riga.storno_inviata`
   * (filtrabile per action) con lo `StatoComanda` corrente nel payload.
   * @throws Conflict E_RIGA_NOT_SENT — riga pending (usa DELETE /righe)
   * @throws Conflict E_RIGA_ALREADY_STORNATA — già stornata (idempotenza esplicita)
   */
  async stornaRigaInviata(
    tenantId: string,
    userId: string,
    contoId: string,
    rigaId: string,
  ): Promise<{ id: string; stornata: true }> {
    return withTenantContextAtomicTx(this.db.prisma, tenantId, async (tx) => {
      await this.loadOpenConto(tx, tenantId, contoId);
      const before = await this.loadRiga(tx, tenantId, contoId, rigaId);

      if (before.comandaId === null) {
        throw new ConflictException({
          errorCode: 'E_RIGA_NOT_SENT',
          message: 'Riga not sent (pending) — use DELETE to remove it',
        });
      }
      if (before.stornata) {
        throw new ConflictException({
          errorCode: 'E_RIGA_ALREADY_STORNATA',
          message: 'Riga already stornata',
        });
      }

      // Stato comanda al momento dello storno → distingue "annulla prima che parta"
      // (inviata) da "perdita" (in_preparazione/pronta). Salvato in audit.
      const comanda = await tx.comanda.findFirst({
        where: { id: before.comandaId, tenantId },
        select: { stato: true },
      });

      await tx.contoRiga.update({
        where: { id: rigaId },
        data: { stornata: true, stornataIl: new Date() },
      });

      await tx.auditLog.create({
        data: {
          id: id(),
          tenantId,
          userId,
          action: 'conto_riga.storno_inviata',
          entityType: 'ContoRiga',
          entityId: rigaId,
          beforeValue: {
            articleId: before.articleId,
            nomeArticolo: before.nomeArticolo,
            prezzoUnitario: before.prezzoUnitario.toString(),
            quantita: before.quantita,
            comandaId: before.comandaId,
          },
          afterValue: { comandaStato: comanda?.stato ?? null },
        },
      });

      this.logger.log(
        `ContoRiga stornata (inviata): ${rigaId} conto=${contoId} tenant=${tenantId}`,
      );
      return { id: rigaId, stornata: true };
    });
  }

  // --- helpers ---------------------------------------------------------------

  /** Coerenza canale↔tavolo (D3). Pura sul DTO, prima del tx. */
  private assertChannelTavoloCoherent(channel: Channel, tavoloId: string | undefined): void {
    const requiresTavolo = channel === Channel.cassa;
    if (requiresTavolo && !tavoloId) {
      throw new BadRequestException({
        errorCode: 'E_CONTO_CHANNEL_TAVOLO_MISMATCH',
        message: `Channel '${channel}' requires a tavoloId`,
      });
    }
    if (!requiresTavolo && tavoloId) {
      throw new BadRequestException({
        errorCode: 'E_CONTO_CHANNEL_TAVOLO_MISMATCH',
        message: `Channel '${channel}' must not have a tavoloId`,
      });
    }
  }

  /**
   * Immutabilità righe inviate (KDS): una riga con `comandaId != null` è già in
   * cucina → no update quantità, no storno. Implementa la semantica "non ancora
   * inviate" del permesso `comande.modifica`.
   */
  private assertRigaNotSent(riga: ContoRiga): void {
    if (riga.comandaId !== null) {
      throw new ConflictException({
        errorCode: 'E_RIGA_ALREADY_SENT',
        message: 'Riga already sent to kitchen (comanda)',
      });
    }
  }

  /** Carica un conto e ne esige lo stato `aperto` (state machine D5). */
  private async loadOpenConto(tx: TenantTx, tenantId: string, contoId: string): Promise<Conto> {
    const conto = await tx.conto.findFirst({ where: { id: contoId, tenantId } });
    if (!conto) {
      throw new NotFoundException({ errorCode: 'E_CONTO_NOT_FOUND', message: 'Conto not found' });
    }
    if (conto.stato !== 'aperto') {
      throw new ConflictException({
        errorCode: 'E_CONTO_NOT_OPEN',
        message: `Conto is '${conto.stato}', not 'aperto'`,
      });
    }
    return conto;
  }

  /** Carica una riga live del conto (soft-deleted escluse dall'extension). */
  private async loadRiga(
    tx: TenantTx,
    tenantId: string,
    contoId: string,
    rigaId: string,
  ): Promise<ContoRiga> {
    const riga = await tx.contoRiga.findFirst({ where: { id: rigaId, contoId, tenantId } });
    if (!riga) {
      throw new NotFoundException({
        errorCode: 'E_CONTO_RIGA_NOT_FOUND',
        message: 'Conto riga not found',
      });
    }
    return riga;
  }
}
