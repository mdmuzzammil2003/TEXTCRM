import { describe, expect, it } from 'vitest';
import {
  completedMonth,
  ebCheckResults,
  financeSchema,
  gridApplicationSchema,
  gridTiming,
  stcTotals,
} from './project-sections.ts';

describe('ebCheckResults', () => {
  it('passes the accepted answers and compares the meter phase with the site', () => {
    const results = ebCheckResults(
      {
        customerNameMatch: 'Yes',
        addressMatch: 'Pending Land Title / Sub-lot',
        meterPhase: 'Two Phase / Split',
        openSolarSystemMatch: 'Variance Verified',
      },
      'Split Phase',
    );
    expect(Object.fromEntries(results.map((r) => [r.key, r.state]))).toEqual({
      customerNameMatch: 'passed',
      addressMatch: 'attention',
      meterMatch: 'unanswered',
      meterPhase: 'passed',
      openSolarSystemMatch: 'passed',
      openSolarPricingMatch: 'unanswered',
    });
  });

  it('flags a meter phase that differs from the site, or a site with no phase', () => {
    expect(ebCheckResults({ meterPhase: 'Single Phase' }, 'Three Phase')[3]).toMatchObject({
      state: 'attention',
      note: 'The site is recorded as Three Phase.',
    });
    expect(ebCheckResults({ meterPhase: 'Single Phase' }, null)[3]?.state).toBe('attention');
  });
});

describe('stcTotals', () => {
  const empty = {
    solarStcs: null,
    solarStcsAmountAud: null,
    solarStcsReceivedDate: null,
    batteryStcs: null,
    batteryStcsAmountAud: null,
    batteryStcsReceivedDate: null,
  };
  const noRates = { customerRateAud: null, internalRateAud: null, adminChargesAud: null };

  it('is all null when nothing is entered', () => {
    expect(stcTotals(empty, noRates)).toEqual({
      totalStcs: null,
      solarAud: null,
      batteryAud: null,
      totalReceivedAud: null,
      outstandingAud: null,
      netReceivedAud: null,
      customerValueAud: null,
      internalValueAud: null,
    });
  });

  it('uses typed amounts when no internal rate is set; counts only received ones', () => {
    expect(
      stcTotals(
        {
          ...empty,
          solarStcs: 81,
          solarStcsAmountAud: '3077.19',
          solarStcsReceivedDate: '2026-10-30',
          batteryStcs: 33,
          batteryStcsAmountAud: '1254.01',
        },
        { ...noRates, adminChargesAud: '0.10' },
      ),
    ).toMatchObject({
      totalStcs: 114,
      totalReceivedAud: '3077.19',
      outstandingAud: '1254.01',
      netReceivedAud: '3077.09',
      internalValueAud: null,
    });
  });

  it('works the amounts out from the internal rate in settings, in exact cents', () => {
    expect(
      stcTotals(
        {
          ...empty,
          solarStcs: 81,
          solarStcsAmountAud: '1.00',
          solarStcsReceivedDate: '2026-10-30',
          batteryStcs: 33,
          batteryStcsReceivedDate: '2026-10-31',
        },
        { customerRateAud: '38.00', internalRateAud: '37.10', adminChargesAud: '0.10' },
      ),
    ).toEqual({
      totalStcs: 114,
      solarAud: '3005.10',
      batteryAud: '1224.30',
      totalReceivedAud: '4229.40',
      outstandingAud: '0.00',
      netReceivedAud: '4229.30',
      customerValueAud: '4332.00',
      internalValueAud: '4229.40',
    });
  });
});

describe('section rules', () => {
  it('grid: a decision needs an applied date that is not after it', () => {
    expect(gridApplicationSchema.safeParse({ approvalDate: '2026-10-01' }).success).toBe(false);
    expect(
      gridApplicationSchema.safeParse({ appliedDate: '2026-10-01', rejectedDate: '2026-10-05' })
        .success,
    ).toBe(true);
    expect(
      gridTiming(
        { appliedDate: '2026-10-01', approvalDate: null, rejectedDate: null },
        '2026-10-11',
      ),
    ).toEqual({ days: 10, decided: false });
  });

  it('finance: cash jobs carry no finance details', () => {
    expect(financeSchema.safeParse({ financeOption: 'No (Cash / Direct Payment)' }).success).toBe(
      true,
    );
    expect(financeSchema.safeParse({ financeCompany: 'Brighte' }).success).toBe(false);
  });

  it('completedMonth names the month of the date', () => {
    expect(completedMonth('2026-01-31')).toBe('January 2026');
    expect(completedMonth(null)).toBeNull();
  });
});
