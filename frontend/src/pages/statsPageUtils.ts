import type { ArchiveSlim } from '../api/client';
import type { Metric } from '../components/MetricToggle';

export interface PrinterBreakdownValue {
  psi_prints: number;
  private_prints: number;
  psi_weight: number;
  private_weight: number;
  partial_weight: number;
  psi_time: number;
  private_time: number;
}

export function buildPrinterBreakdown(archives: ArchiveSlim[]): Map<string, PrinterBreakdownValue> {
  const map = new Map<string, PrinterBreakdownValue>();

  archives.forEach((archive) => {
    if (!archive.printer_id) return;

    const id = String(archive.printer_id);
    const entry = map.get(id) || {
      psi_prints: 0,
      private_prints: 0,
      psi_weight: 0,
      private_weight: 0,
      partial_weight: 0,
      psi_time: 0,
      private_time: 0,
    };

    const weight = archive.filament_used_grams || 0;
    const time = (archive.actual_time_seconds || archive.print_time_seconds || 0) / 3600;

    if (archive.private_job) {
      entry.private_prints += 1;
      entry.private_time += time;
    } else {
      entry.psi_prints += 1;
      entry.psi_time += time;
    }

    if (archive.private_material) entry.private_weight += weight;
    else if (archive.private_material_partial) entry.partial_weight += weight;
    else entry.psi_weight += weight;

    map.set(id, entry);
  });

  return map;
}

export function getPrinterMetricValue(entry: PrinterBreakdownValue, metric: Metric) {
  if (metric === 'prints') {
    return {
      psi: entry.psi_prints,
      private: entry.private_prints,
      partial: 0,
    };
  }

  if (metric === 'time') {
    return {
      psi: Math.round(entry.psi_time * 10) / 10,
      private: Math.round(entry.private_time * 10) / 10,
      partial: 0,
    };
  }

  return {
    psi: Math.round(entry.psi_weight),
    private: Math.round(entry.private_weight),
    partial: Math.round(entry.partial_weight),
  };
}

export function getPrivateJobCostSummary(archives: ArchiveSlim[]) {
  return archives.reduce(
    (summary, archive) => {
      if (!archive.private_job) return summary;

      const cost = archive.cost || 0;
      if (archive.private_material) {
        summary.fullPrivateMaterial += cost;
      } else if (archive.private_material_partial) {
        summary.partialMaterial += cost;
      } else {
        summary.companyMaterial += cost;
      }

      return summary;
    },
    {
      companyMaterial: 0,
      partialMaterial: 0,
      fullPrivateMaterial: 0,
    }
  );
}
