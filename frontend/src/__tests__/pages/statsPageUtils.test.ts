import { describe, expect, it } from 'vitest';

import type { ArchiveSlim } from '../../api/client';
import { buildPrinterBreakdown, getPrinterMetricValue, getPrivateJobCostSummary } from '../../pages/statsPageUtils';

const archives: ArchiveSlim[] = [
  {
    printer_id: 1,
    print_name: 'PSI print',
    print_time_seconds: 3600,
    actual_time_seconds: 3600,
    filament_used_grams: 100,
    filament_type: 'PLA',
    filament_color: '#ffffff',
    status: 'completed',
    started_at: '2024-01-01T10:00:00Z',
    completed_at: '2024-01-01T11:00:00Z',
    cost: 10,
    quantity: 1,
    private_job: false,
    private_material: false,
    private_material_partial: false,
    created_at: '2024-01-01T10:00:00Z',
  },
  {
    printer_id: 1,
    print_name: 'Private full',
    print_time_seconds: 5400,
    actual_time_seconds: 5400,
    filament_used_grams: 50,
    filament_type: 'PLA',
    filament_color: '#000000',
    status: 'completed',
    started_at: '2024-01-02T10:00:00Z',
    completed_at: '2024-01-02T11:30:00Z',
    cost: 5,
    quantity: 1,
    private_job: true,
    private_material: true,
    private_material_partial: false,
    created_at: '2024-01-02T10:00:00Z',
  },
  {
    printer_id: 2,
    print_name: 'Private partial',
    print_time_seconds: 1800,
    actual_time_seconds: 1800,
    filament_used_grams: 25,
    filament_type: 'PETG',
    filament_color: '#ff0000',
    status: 'failed',
    started_at: '2024-01-03T10:00:00Z',
    completed_at: null,
    cost: 2.5,
    quantity: 1,
    private_job: true,
    private_material: false,
    private_material_partial: true,
    created_at: '2024-01-03T10:00:00Z',
  },
];

describe('statsPageUtils', () => {
  it('splits printer counts by PSI and private jobs for prints metric', () => {
    const breakdown = buildPrinterBreakdown(archives);

    expect(getPrinterMetricValue(breakdown.get('1')!, 'prints')).toEqual({
      psi: 1,
      private: 1,
      partial: 0,
    });
    expect(getPrinterMetricValue(breakdown.get('2')!, 'prints')).toEqual({
      psi: 0,
      private: 1,
      partial: 0,
    });
  });

  it('keeps partial material separated for weight metric', () => {
    const breakdown = buildPrinterBreakdown(archives);

    expect(getPrinterMetricValue(breakdown.get('1')!, 'weight')).toEqual({
      psi: 100,
      private: 50,
      partial: 0,
    });
    expect(getPrinterMetricValue(breakdown.get('2')!, 'weight')).toEqual({
      psi: 0,
      private: 0,
      partial: 25,
    });
  });

  it('counts private PSI-material and partial-material jobs in the private cost summary', () => {
    expect(getPrivateJobCostSummary(archives)).toEqual({
      companyMaterial: 0,
      partialMaterial: 2.5,
      fullPrivateMaterial: 5,
    });
  });
});
