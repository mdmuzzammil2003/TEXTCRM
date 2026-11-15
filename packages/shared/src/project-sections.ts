import { z } from 'zod';
import { optionalId, optionalText } from './contacts.ts';
import { moneyField } from './lead-details.ts';
import { businessToday } from './leads.ts';
import { optionalDate, wholeNumberField } from './projects.ts';

// The project workspace sections of §1.4 that follow the sale: EB verification, grid
// application, finance, warehouse, installation, and STC claim (Step 2.7).
// Dropdown fields hold option values; the server checks them against the option lists.

const option = optionalText(100);
const reference = optionalText(100);

type Issue = { code: 'custom'; path: string[]; message: string };
type Ctx = { addIssue: (issue: Issue) => void };

function notInFuture(ctx: Ctx, date: string | null, path: string, what: string) {
  if (date && date > businessToday()) {
    ctx.addIssue({ code: 'custom', path: [path], message: `The ${what} can't be in the future.` });
  }
}

/** `later` may not come before `earlier` (ISO dates compare as text). */
function notBefore(
  ctx: Ctx,
  later: string | null,
  earlier: string | null,
  path: string,
  message: string,
) {
  if (later && earlier && later < earlier) ctx.addIssue({ code: 'custom', path: [path], message });
}

function amountAddsUp(cents: (string | null)[]): string {
  return (
    cents.reduce((sum, value) => sum + Math.round(Number(value ?? 0) * 100), 0) / 100
  ).toFixed(2);
}

// ── EB (electricity bill) verification ───────────────────────────────────

export const ebVerificationSchema = z
  .object({
    customerNameMatch: option,
    addressMatch: option,
    meterMatch: option,
    meterPhase: option,
    openSolarSystemMatch: option,
    openSolarPricingMatch: option,
    docsReceived: option,
    docsReceivedDate: optionalDate,
  })
  .superRefine((eb, ctx) => {
    notInFuture(ctx, eb.docsReceivedDate, 'docsReceivedDate', 'date the documents arrived');
  });

export type EbVerificationInput = z.input<typeof ebVerificationSchema>;
export type EbVerificationValues = z.output<typeof ebVerificationSchema>;

type EbAnswerKey = Exclude<keyof EbVerificationValues, 'docsReceived' | 'docsReceivedDate'>;

/** The six checks, their option lists, and which answers count as passed. */
export const EB_CHECKS: readonly {
  key: EbAnswerKey;
  label: string;
  list: string;
  passes: readonly string[];
}[] = [
  {
    key: 'customerNameMatch',
    label: 'Customer name matches the bill',
    list: 'ebCustomerNameMatchOptions',
    passes: ['Yes'],
  },
  {
    key: 'addressMatch',
    label: 'Address matches the bill',
    list: 'ebAddressMatchOptions',
    passes: ['Yes'],
  },
  {
    key: 'meterMatch',
    label: 'Meter number matches',
    list: 'ebMeterMatchOptions',
    passes: ['Yes'],
  },
  // Passes when it agrees with the site's phase (Customer & site).
  { key: 'meterPhase', label: 'Meter phase', list: 'ebMeterPhaseOptions', passes: [] },
  {
    key: 'openSolarSystemMatch',
    label: 'OpenSolar system matches',
    list: 'ebOpenSolarSystemMatchOptions',
    passes: ['Yes', 'Variance Verified'],
  },
  {
    key: 'openSolarPricingMatch',
    label: 'OpenSolar pricing matches',
    list: 'ebOpenSolarPricingMatchOptions',
    passes: ['Yes', 'Discrepancy Adjusted'],
  },
];

export type EbCheckState = 'passed' | 'attention' | 'unanswered';

/** "Single Phase" / "Three Phase" / "Split Phase" / "Two Phase / Split" → one word. */
function phaseKind(phase: string | null): string | null {
  if (!phase) return null;
  const text = phase.toLowerCase();
  if (text.includes('three')) return 'three';
  if (text.includes('split') || text.includes('two')) return 'split';
  if (text.includes('single')) return 'single';
  return text;
}

/** Each check's state. The meter phase is compared with the site's phase. */
export function ebCheckResults(
  eb: Partial<Record<EbAnswerKey, string | null>>,
  sitePhase: string | null,
) {
  return EB_CHECKS.map((check) => {
    const answer = eb[check.key] ?? null;
    let state: EbCheckState;
    let note: string | null = null;
    if (!answer) state = 'unanswered';
    else if (check.key === 'meterPhase') {
      if (!sitePhase) {
        state = 'attention';
        note = "Set the site's phase in Customer & site to compare.";
      } else if (phaseKind(answer) === phaseKind(sitePhase)) state = 'passed';
      else {
        state = 'attention';
        note = `The site is recorded as ${sitePhase}.`;
      }
    } else state = check.passes.includes(answer) ? 'passed' : 'attention';
    return { key: check.key, label: check.label, answer, state, note };
  });
}

// ── Grid application ─────────────────────────────────────────────────────

export const GRID_APPROVED = 'Grid App Approved';
export const GRID_REJECTED = 'Grid Rejected';

export const gridApplicationSchema = z
  .object({
    electricityDistributor: option,
    applicationRef: reference,
    status: option,
    appliedDate: optionalDate,
    approvalDate: optionalDate,
    rejectedDate: optionalDate,
  })
  .superRefine((grid, ctx) => {
    notInFuture(ctx, grid.appliedDate, 'appliedDate', 'applied date');
    notInFuture(ctx, grid.approvalDate, 'approvalDate', 'approval date');
    notInFuture(ctx, grid.rejectedDate, 'rejectedDate', 'rejected date');
    for (const key of ['approvalDate', 'rejectedDate'] as const) {
      if (grid[key] && !grid.appliedDate) {
        ctx.addIssue({ code: 'custom', path: ['appliedDate'], message: 'When was it applied?' });
      }
      notBefore(ctx, grid[key], grid.appliedDate, key, 'This is before the applied date.');
    }
    if (grid.status === GRID_APPROVED && !grid.approvalDate) {
      ctx.addIssue({ code: 'custom', path: ['approvalDate'], message: 'When was it approved?' });
    }
    if (grid.status === GRID_REJECTED && !grid.rejectedDate) {
      ctx.addIssue({ code: 'custom', path: ['rejectedDate'], message: 'When was it rejected?' });
    }
  });

export type GridApplicationInput = z.input<typeof gridApplicationSchema>;
export type GridApplicationValues = z.output<typeof gridApplicationSchema>;

// ── Net meter application ────────────────────────────────────────────────
// The energy retailer's side of the connection. Stored with the grid application.

export const netMeterApplicationSchema = z.object({
  energyRetailer: option,
  retailerRef: reference,
});

export type NetMeterApplicationInput = z.input<typeof netMeterApplicationSchema>;
export type NetMeterApplicationValues = z.output<typeof netMeterApplicationSchema>;

/** Whole days from one ISO date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** How long the DNSP took to decide, or has been deciding so far. */
export function gridTiming(
  grid: { appliedDate: string | null; approvalDate: string | null; rejectedDate: string | null },
  today: string = businessToday(),
): { days: number; decided: boolean } | null {
  if (!grid.appliedDate) return null;
  const decidedOn = grid.approvalDate ?? grid.rejectedDate;
  return { days: daysBetween(grid.appliedDate, decidedOn ?? today), decided: decidedOn !== null };
}

// ── Finance ──────────────────────────────────────────────────────────────

/** The `isFinanceOptions` value meaning the customer pays directly. */
export const FINANCE_NONE = 'No (Cash / Direct Payment)';

export const isOnFinance = (financeOption: string | null) =>
  financeOption !== null && financeOption !== FINANCE_NONE;

export const financeSchema = z
  .object({
    financeOption: option,
    financeCompany: option,
    status: option,
    appliedDate: optionalDate,
    approvedDate: optionalDate,
    approvedAmountAud: moneyField('the approved amount'),
  })
  .superRefine((finance, ctx) => {
    const details =
      finance.financeCompany ??
      finance.status ??
      finance.appliedDate ??
      finance.approvedDate ??
      finance.approvedAmountAud;
    if (!isOnFinance(finance.financeOption) && details) {
      ctx.addIssue({
        code: 'custom',
        path: ['financeOption'],
        message: 'The job is not on finance — choose a finance option or clear the details.',
      });
    }
    notInFuture(ctx, finance.appliedDate, 'appliedDate', 'applied date');
    notInFuture(ctx, finance.approvedDate, 'approvedDate', 'approved date');
    notBefore(
      ctx,
      finance.approvedDate,
      finance.appliedDate,
      'approvedDate',
      'This is before the applied date.',
    );
  });

export type FinanceInput = z.input<typeof financeSchema>;
export type FinanceValues = z.output<typeof financeSchema>;

// ── Warehouse & stock ────────────────────────────────────────────────────

/**
 * A job's sales order numbers. The form sends what was typed as tags (one string, split on spaces,
 * commas or semicolons); the API also takes a list. Repeats are dropped, order is kept.
 */
export const salesOrderNumbersField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    const parts = typeof value === 'string' ? value.split(/[\s,;]+/) : (value ?? []);
    return [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
  })
  .pipe(
    z
      .array(z.string().max(100, 'A sales order number can be at most 100 characters.'))
      .max(20, 'A job can have at most 20 sales order numbers.'),
  );

export const warehouseSchema = z
  .object({
    warehouse: option,
    salesOrderNumbers: salesOrderNumbersField,
    stockStatus: option,
    stockUsedProject: optionalText(200),
    invoiceNumber: reference,
    invoiceDate: optionalDate,
    invoiceAmountAud: moneyField('the invoice amount'),
    invoiceStatus: option,
    invoicePaidDate: optionalDate,
  })
  .superRefine((warehouse, ctx) => {
    notInFuture(ctx, warehouse.invoicePaidDate, 'invoicePaidDate', 'paid date');
    notBefore(
      ctx,
      warehouse.invoicePaidDate,
      warehouse.invoiceDate,
      'invoicePaidDate',
      'This is before the invoice date.',
    );
  });

export type WarehouseInput = z.input<typeof warehouseSchema>;
export type WarehouseValues = z.output<typeof warehouseSchema>;

// ── Installation ─────────────────────────────────────────────────────────

export const installationSchema = z
  .object({
    status: option,
    installerCompanyId: optionalId,
    installerQuotedAud: moneyField('the quote'),
    bookingDate: optionalDate,
    bookedByUserId: optionalId,
    completedDate: optionalDate,
    docsStatus: option,
    docsReceivedDate: optionalDate,
  })
  .superRefine((install, ctx) => {
    notInFuture(ctx, install.completedDate, 'completedDate', 'completion date');
    notInFuture(ctx, install.docsReceivedDate, 'docsReceivedDate', 'date the documents arrived');
    notBefore(
      ctx,
      install.completedDate,
      install.bookingDate,
      'completedDate',
      'This is before the installation date.',
    );
  });

export type InstallationInput = z.input<typeof installationSchema>;
export type InstallationValues = z.output<typeof installationSchema>;

/**
 * Installation status <-> project status, kept in step both ways by a database trigger
 * (migration 0023): the project status an installation status means.
 */
export function projectStatusForInstallation(status: string | null): string {
  if (status === 'Installation Completed' || status === 'Complete') return 'Completed';
  if (status === 'Closed') return 'Closed';
  if (status === 'Cancelled') return 'Lost';
  return 'Active';
}

// ── Installer invoice ────────────────────────────────────────────────────
// Stored on the installation row, edited in its own box.

export const installerInvoiceSchema = z.object({
  installerInvoiceNumber: reference,
  installerInvoiceDate: optionalDate,
  installerInvoiceAmountAud: moneyField('the invoice amount'),
  installerInvoiceStatus: option,
});

export type InstallerInvoiceInput = z.input<typeof installerInvoiceSchema>;
export type InstallerInvoiceValues = z.output<typeof installerInvoiceSchema>;

/** "November 2026" — the legacy "installation completed month", derived from the date. */
export function completedMonth(completedDate: string | null): string | null {
  if (!completedDate) return null;
  return new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${completedDate}T00:00:00Z`));
}

// ── STC claim ────────────────────────────────────────────────────────────

const stcCount = wholeNumberField(10_000);

export const stcClaimSchema = z
  .object({
    portal: option,
    jobNumber: reference,
    status: option,
    submittedDate: optionalDate,
    solarStcs: stcCount,
    solarStcsAmountAud: moneyField('the solar STC amount'),
    solarStcsReceivedDate: optionalDate,
    batteryStcs: stcCount,
    batteryStcsAmountAud: moneyField('the battery STC amount'),
    batteryStcsReceivedDate: optionalDate,
  })
  .superRefine((stc, ctx) => {
    notInFuture(ctx, stc.submittedDate, 'submittedDate', 'submitted date');
    for (const kind of ['solar', 'battery'] as const) {
      const received = stc[`${kind}StcsReceivedDate`];
      const path = `${kind}StcsReceivedDate`;
      notInFuture(ctx, received, path, 'received date');
      notBefore(ctx, received, stc.submittedDate, path, 'This is before the submitted date.');
      if (received && stc[`${kind}Stcs`] === null && !stc[`${kind}StcsAmountAud`]) {
        ctx.addIssue({
          code: 'custom',
          path: [`${kind}Stcs`],
          message: 'Enter the certificates (or the amount) that were received.',
        });
      }
    }
  });

export type StcClaimInput = z.input<typeof stcClaimSchema>;
export type StcClaimValues = z.output<typeof stcClaimSchema>;

// ── STC settings (Admin only) ─────────────────────────────────────────────

/** The business-wide STC rates and charges (Settings → STC settings). */
export const stcSettingsSchema = z.object({
  customerRateAud: moneyField('the customer rate'),
  internalRateAud: moneyField('the internal rate'),
  adminChargesAud: moneyField('the admin charges'),
});

export type StcSettingsInput = z.input<typeof stcSettingsSchema>;
export type StcSettingsValues = z.output<typeof stcSettingsSchema>;
export type StcRates = StcSettingsValues;

export const NO_STC_RATES: StcRates = {
  customerRateAud: null,
  internalRateAud: null,
  adminChargesAud: null,
};

/** rate × count in exact cents, or null when either is missing. */
function timesRate(rate: string | null, count: number | null): string | null {
  return rate !== null && count !== null
    ? ((Math.round(Number(rate) * 100) * count) / 100).toFixed(2)
    : null;
}

/**
 * STC money worked out on the server (§1.4). Each kind's amount is its certificates × the
 * internal rate from STC settings (the typed amount when there is no count or no rate).
 * Received = amounts with a received date; still to come = the rest; net = received less the
 * admin charges; customer/internal value = all certificates × that rate. Exact cents; null when
 * there's nothing to add up.
 */
export function stcTotals(
  stc: {
    solarStcs: number | null;
    solarStcsAmountAud: string | null;
    solarStcsReceivedDate: string | null;
    batteryStcs: number | null;
    batteryStcsAmountAud: string | null;
    batteryStcsReceivedDate: string | null;
  },
  rates: StcRates,
) {
  const certificates =
    stc.solarStcs === null && stc.batteryStcs === null
      ? null
      : (stc.solarStcs ?? 0) + (stc.batteryStcs ?? 0);
  const solarAud = timesRate(rates.internalRateAud, stc.solarStcs) ?? stc.solarStcsAmountAud;
  const batteryAud = timesRate(rates.internalRateAud, stc.batteryStcs) ?? stc.batteryStcsAmountAud;
  const received = [
    stc.solarStcsReceivedDate ? solarAud : null,
    stc.batteryStcsReceivedDate ? batteryAud : null,
  ];
  const anyAmount = solarAud !== null || batteryAud !== null;
  const totalReceivedAud = anyAmount ? amountAddsUp(received) : null;
  const outstanding = [
    stc.solarStcsReceivedDate ? null : solarAud,
    stc.batteryStcsReceivedDate ? null : batteryAud,
  ];
  return {
    totalStcs: certificates,
    solarAud,
    batteryAud,
    totalReceivedAud,
    outstandingAud: anyAmount ? amountAddsUp(outstanding) : null,
    netReceivedAud:
      totalReceivedAud !== null && rates.adminChargesAud !== null
        ? amountAddsUp([totalReceivedAud, `-${rates.adminChargesAud}`])
        : totalReceivedAud,
    customerValueAud: timesRate(rates.customerRateAud, certificates),
    internalValueAud: timesRate(rates.internalRateAud, certificates),
  };
}
